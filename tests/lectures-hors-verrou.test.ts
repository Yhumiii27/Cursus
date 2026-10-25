// Lectures hors du verrou d'écriture (lot 8, chantier E, étape 1) : les routes qui lisent (instantané, journal et son
// CSV, données personnelles, variables de paie, flux d'agenda, API Keystone en GET) lisent dans une lecture stable
// (`Db.lecture` : transaction READ ONLY sur PostgreSQL, PRAGMA query_only sur SQLite), puis écrivent leur trace dans une
// courte transaction à part ; l'identité écrit ses mises à jour de session (activité, révocation) dans une courte suite
// exclusive. Sur les deux moteurs : chaque route trace toujours, et aucune n'écrit dans sa lecture (elle échouerait). Sur
// PostgreSQL : les lectures passent pendant qu'une autre instance tient le verrou d'écriture, une action qui attend ce
// verrou au-delà de lock_timeout reçoit 503 « Cursus est occupé » sans rien écrire.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
process.env.KEYSTONE_API_KEY = 'cle-keystone-essai-lectures';
delete process.env.CURSUS_DEMO;

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { comptesDemo } = await import('../server/src/seed.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
const { CURSUS_OCCUPE } = await import('../server/src/erreurs.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type Pg = import('../server/src/db-pg.ts').PgDb;

const SEUL = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
/** Ligne ajoutée à la semaine en cours de Mehdi, encore sans feuille : l'action crée la feuille. */
const LIGNE = { empId: 2, week: '2026-10-05', projet: 'INT-MAINT' };
const serveurs: Server[] = [];
after(() => { for (const s of serveurs) s.close(); });

async function monter(env: Record<string, string> = {}) {
  const db = await nouvelleBase(env);
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), agendaFluxActif: true });
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  /** Session ouverte en base pour un compte, cookie signé comme par Cursus. */
  const session = async (where: string, params: unknown[], role: 'rh' | 'manager' | 'collaborateur') => {
    const compte = (await db.one(`SELECT id FROM comptes WHERE ${where}`, params as never[])) as { id: number };
    const id = randomBytes(32).toString('base64url');
    const maintenant = new Date();
    await db.insert('connexions', { id: empreinteSession(id), compteId: compte.id, role, methode: 'local', demoComptes: {}, creation: maintenant.toISOString(), expiration: new Date(maintenant.getTime() + 3600_000).toISOString(), activite: null });
    return { id, compteId: compte.id, role, cookie: `cursus_session=${id}.${await sign(db, id)}` };
  };
  const appel = async (s: { cookie: string; role: string } | null, chemin: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${base}${chemin}`, {
      method: init.method ?? 'GET', body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      headers: { ...(s ? { cookie: s.cookie, 'x-cursus-espace': s.role } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    const texte = await res.text();
    return { status: res.status, headers: res.headers, texte, json: () => JSON.parse(texte) };
  };
  const actions = async (action: string) => ((await db.one('SELECT COUNT(*) AS n FROM journal WHERE action = ?', [action])) as { n: number }).n;
  return {
    db, appel, actions,
    RH: await session('emp_id IS NULL AND profil_rh = ?', ['rh_admin'], 'rh'),
    PAIE: await session('emp_id = ?', [7], 'rh'),
    MEHDI: await session('emp_id = ?', [2], 'collaborateur'),
  };
}

test('chaque route de lecture trace toujours, sa trace écrite à part ; aucune écriture dans la lecture', async () => {
  const { db, appel, actions, RH, PAIE, MEHDI } = await monter();
  // Instantané : 200, activité de la session notée à part.
  const d = await appel(MEHDI, '/api/data');
  assert.equal(d.status, 200, d.texte);
  assert.ok(((await db.get<{ activite: string | null }>('connexions', empreinteSession(MEHDI.id)))!).activite, 'activité de la session notée');
  // Journal : l'archive paie est tracée à chaque consultation ; l'export CSV aussi.
  assert.equal((await appel(RH, '/api/journal?vue=archive')).status, 200);
  assert.equal(await actions('journal.archive'), 1);
  const csv = await appel(RH, '/api/journal/csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition') ?? '', /attachment; filename="journal-/);
  assert.equal(await actions('journal.export'), 1);
  // Données personnelles : export RH d'un salarié, téléchargement par l'intéressé, refus tracé.
  assert.equal((await appel(RH, '/api/salaries/2/donnees')).status, 200);
  assert.equal(await actions('salarie.export'), 1);
  assert.equal((await appel(MEHDI, '/api/mes-donnees')).status, 200);
  assert.equal(await actions('donnees.export'), 1);
  const refusesAvant = await actions('acces.refuse');
  assert.equal((await appel(RH, '/api/mes-donnees')).status, 403);
  // Variables de paie : export tracé, refus tracé.
  const v = await appel(PAIE, '/api/paie/variables/2026-09');
  assert.equal(v.status, 200, v.texte);
  assert.equal(await actions('sage.variables'), 1);
  assert.equal((await appel(MEHDI, '/api/paie/variables/2026-09')).status, 403);
  assert.equal(await actions('acces.refuse'), refusesAvant + 2);
  // Flux d'agenda : dernier accès noté après la lecture.
  const jeton = randomBytes(32).toString('base64url');
  const j = await db.insert<{ id: number }>('jetonsAgenda', { empId: 2, empreinte: createHash('sha256').update(jeton).digest('hex'), creeLe: new Date().toISOString() });
  const ics = await appel(null, `/api/agenda/${jeton}.ics`);
  assert.equal(ics.status, 200, ics.texte);
  assert.match(ics.texte, /^BEGIN:VCALENDAR/);
  assert.ok((await db.get<{ dernierAcces: string | null }>('jetonsAgenda', j.id))!.dernierAcces, 'dernier accès noté');
  // API Keystone en lecture : chaque appel tracé (keystone.appel), le verdict d'un chantier lu hors du verrou.
  const k = { 'x-api-key': process.env.KEYSTONE_API_KEY! };
  assert.equal((await appel(null, '/api/integrations/keystone/v1/referentiels', { headers: k })).status, 200);
  assert.equal((await appel(null, '/api/integrations/keystone/v1/chantiers/K-2620/go-no-go', { headers: k })).status, 200);
  assert.equal((await appel(null, '/api/integrations/keystone/v1/chantiers/K-9999/go-no-go', { headers: k })).status, 404);
  assert.equal(await actions('keystone.appel'), 3);
});

test('identité : session révoquée et compte désactivé, écritures faites hors de la lecture', async () => {
  const { db, appel, MEHDI } = await monter();
  await db.run('UPDATE comptes SET actif = FALSE WHERE id = ?', [MEHDI.compteId]);
  assert.equal((await appel(MEHDI, '/api/data')).status, 401);
  assert.ok((await db.get<{ revocation: string | null }>('connexions', empreinteSession(MEHDI.id)))!.revocation, 'session révoquée');
  // Action après le changement de compte : refusée sans rien faire.
  assert.equal((await appel(MEHDI, '/api/actions/temps.setCell', { method: 'POST', body: { empId: 2, week: '2026-10-05', li: 0, di: 0, value: '7' } })).status, 401);
});

test('action validée, instantané non relu ensuite (Cursus occupé) : message de l’action rendu, jamais 503, une seule trace', async () => {
  const { db, appel, actions, MEHDI } = await monter();
  // La lecture de l'instantané qui suit la transaction de l'action dépasse le délai de connexion du pool.
  const tx = db.tx.bind(db), lecture = db.lecture.bind(db);
  let commise = false;
  db.tx = (async (fn: () => unknown) => { const r = await tx(fn); commise = true; return r; }) as typeof db.tx;
  db.lecture = (async (fn: () => unknown) => {
    if (commise) throw new Error('timeout exceeded when trying to connect');
    return await lecture(fn);
  }) as typeof db.lecture;
  const r = await appel(MEHDI, '/api/actions/temps.addLine', { method: 'POST', body: LIGNE });
  db.tx = tx; db.lecture = lecture;
  assert.equal(r.status, 200, r.texte);
  const o = r.json();
  assert.equal(o.relire, true, 'instantané à relire par /api/data');
  assert.equal(o.data, undefined);
  assert.ok('message' in o, 'réponse de l’action rendue');
  assert.equal(await actions('temps.addLine'), 1);
  const feuille = await db.one<{ lignes: unknown }>('SELECT lignes FROM feuilles WHERE emp_id = ? AND week = ?', [LIGNE.empId, LIGNE.week]);
  assert.match(JSON.stringify(feuille?.lignes), /INT-MAINT/);
});

test('API Keystone : aucune réponse sans sa trace ; lecture : 503 OCCUPE ; écriture faite : trace retentée', async () => {
  const { db, appel, actions } = await monter();
  const k = { 'x-api-key': process.env.KEYSTONE_API_KEY! };
  const insert = db.insert.bind(db);
  /** Les `n` prochaines traces de l'appel échouent sur le délai du verrou (55P03). */
  let echecs = 0;
  db.insert = (async (table: string, ligne: unknown) => {
    if (table === 'journal' && echecs > 0) { echecs--; throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }); }
    return await insert(table as never, ligne as never);
  }) as typeof db.insert;
  echecs = 1;
  const g = await appel(null, '/api/integrations/keystone/v1/chantiers/K-2620/go-no-go', { headers: k });
  assert.equal(g.status, 503, g.texte);
  assert.equal(g.json().code, 'OCCUPE');
  assert.equal(g.headers.get('retry-after'), '5');
  assert.equal(await actions('keystone.appel'), 0, 'ni verdict ni trace');
  // Écriture (ici refusée, 404) : la trace manquée est retentée une fois, la réponse part avec sa trace.
  echecs = 1;
  const d = await appel(null, '/api/integrations/keystone/v1/affectations/A-INCONNUE', { method: 'DELETE', headers: k });
  db.insert = insert;
  assert.notEqual(d.status, 503, d.texte);
  assert.equal(await actions('keystone.appel'), 1);
});

test('lecture stable : aucune écriture admise, transaction refusée, sur les deux moteurs', async () => {
  const db: Db = await nouvelleBase();
  await assert.rejects(db.lecture(async () => await db.insert('journal', { at: new Date().toISOString(), actor: 'x', action: 'essai', message: null, payload: {}, salaries: [] })));
  await assert.rejects(db.lecture(async () => await db.tx(async () => await db.setSetting('essai', 1))), /Transaction d’écriture demandée dans une lecture/);
  // Écriture permise après la lecture, et dans une transaction (la lecture y reprend sa portée).
  await db.setSetting('essai', 1);
  await db.tx(async () => { await db.lecture(async () => await db.count('journal')); await db.setSetting('essai', 2); });
  assert.equal(await db.getSetting('essai', 0), 2);
});

test('PostgreSQL : lectures servies pendant qu’une autre instance tient le verrou ; action en attente au-delà du délai : 503, rien d’écrit', SEUL, async () => {
  const { db, appel, actions, RH, MEHDI } = await monter({ CURSUS_PG_DELAI_VERROU_MS: '400' });
  const pgdb = db as unknown as Pg;
  const autre = new pg.Client({ connectionString: (pgdb.pool as unknown as { options: { connectionString: string } }).options.connectionString });
  await autre.connect();
  try {
    await autre.query('SELECT pg_advisory_lock(hashtext($1))', [`${pgdb.schema}.ecritures`]);
    // Lectures : instantané et journal servis malgré le verrou tenu ailleurs.
    const t = Date.now();
    assert.equal((await appel(MEHDI, '/api/data')).status, 200);
    assert.equal((await appel(RH, '/api/journal')).status, 200);
    assert.ok(Date.now() - t < 5000);
    // Action : 503 « Cursus est occupé », Retry-After, et rien d'écrit.
    const journal = await db.count('journal');
    const r = await appel(MEHDI, '/api/actions/temps.addLine', { method: 'POST', body: LIGNE });
    assert.equal(r.status, 503, r.texte);
    assert.equal(r.json().error, CURSUS_OCCUPE);
    assert.equal(r.headers.get('retry-after'), '5');
    assert.deepEqual(await db.query('SELECT id FROM feuilles WHERE emp_id = 2 AND week = ?', ['2026-10-05']), [], 'aucune feuille créée');
    assert.equal(await db.count('journal'), journal);
    // Consultation de l'archive : sa trace attend le verrou, 503 aussi, sans rien écrire.
    assert.equal((await appel(RH, '/api/journal?vue=archive')).status, 503);
    assert.equal(await actions('journal.archive'), 0);
  } finally {
    await autre.end();
  }
  // Verrou rendu : l'action passe.
  const r = await appel(MEHDI, '/api/actions/temps.addLine', { method: 'POST', body: LIGNE });
  assert.equal(r.status, 200, r.texte);
  assert.equal((await db.query('SELECT id FROM feuilles WHERE emp_id = 2 AND week = ?', ['2026-10-05'])).length, 1);
});

test('PostgreSQL : lectures parallèles sur un même état, sans attendre les écritures', SEUL, async () => {
  const db = (await nouvelleBase()) as unknown as Pg;
  await seedDemo(db);
  let ouvrir!: () => void;
  const porte = new Promise<void>(ok => { ouvrir = ok; });
  // Lecture longue : elle compte, attend qu'une écriture soit validée, puis recompte sur le même état.
  const longue = db.lecture(async () => {
    const a = await db.count('journal');
    await porte;
    return [a, await db.count('journal')];
  });
  await new Promise(r => setTimeout(r, 50));
  await db.tx(async () => await db.insert('journal', { at: new Date().toISOString(), actor: 'essai', action: 'essai', message: null, payload: {}, salaries: [] }));
  // Une lecture partie après l'écriture la voit ; deux lectures simultanées voient le même état.
  const [x, y] = await Promise.all([db.lecture(async () => await db.count('journal')), db.lecture(async () => await db.count('journal'))]);
  ouvrir();
  const [a, b] = await longue;
  assert.equal(a, b, 'la lecture longue garde son état');
  assert.equal(x, y);
  assert.equal(x, a + 1);
  // Pendant une suite exclusive (verrou d'écriture tenu), une lecture passe.
  let tenu!: () => void;
  const fin = new Promise<void>(ok => { tenu = ok; });
  const exclusive = db.exclusif(async () => { await fin; });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(await db.lecture(async () => await db.count('journal')), x);
  tenu();
  await exclusive;
});

test('délai du serveur dépassé dans une route : 503 « Cursus est occupé », Retry-After, sans pile', async () => {
  const express = (await import('express')).default;
  const { gestionnaireErreurs, ATTENTE_OCCUPE } = await import('../server/src/erreurs.ts');
  const app = express();
  app.get('/verrou', () => { throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }); });
  app.get('/pool', () => { throw new Error('timeout exceeded when trying to connect'); });
  app.use(gestionnaireErreurs());
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  for (const chemin of ['/verrou', '/pool']) {
    const r = await fetch(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}${chemin}`);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), String(ATTENTE_OCCUPE));
    assert.deepEqual(await r.json(), { error: CURSUS_OCCUPE });
  }
});
