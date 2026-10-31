// Application mobile (lot 11, chantier C2, étape 1) : idempotence des envois et rejeu de la file hors ligne, par la couche
// HTTP montée dans le processus du test (createApp) :
// - même clé, même corps : la réponse gardée, l'action n'est pas refaite ; autre corps : 422 ; clé illisible : 400 ;
// - une action refusée ne garde rien (le rejeu la refait) ; la réponse est écrite dans la transaction de l'action ;
// - temps.saisir : cellule désignée par projet et tâche, valeur vue (`base`), conflit 409 sans écrasement ;
// - rejeu hors ligne (en-tête x-cursus-hors-ligne) : registre ACTIONS_HORS_LIGNE, saisie personnelle, congés seulement,
//   journal marqué `horsLigne` ; jamais une validation ni une action de paie ;
// - POST /api/pieces avec une clé : la même pièce rendue, une seule ligne ;
// - purge à 30 jours ; tables techniques jamais lues par l'instantané.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
const dir = mkdtempSync(join(tmpdir(), 'cursus-pwa-'));
process.env.CURSUS_PIECES_DIR ??= join(dir, 'pieces');

const { json, nouvelleBase } = await import('./base.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { createApp } = await import('../server/src/app.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { TABLES_SANS_REVISION } = await import('../server/src/db.ts');
const { TABLES_LUES } = await import('../server/src/lecture-brute.ts');
const idem = await import('../server/src/idempotence.ts');
const { ACTIONS_HORS_LIGNE, CONGES_HORS_LIGNE, refusHorsLigne } = await import('../shared/hors-ligne.ts');
const { ACTIONS_PAIE, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
reglerJournaux({ sortie: () => {} });

const db = await nouvelleBase();
await mettreAJourBase(db);
await seedDemo(db);
let srv: Server, port: number;
before(async () => {
  await new Promise<void>(ok => { srv = createApp(db, { production: false, journalRequetes: false, dist: join(dir, 'sans-interface') }).listen(0, '127.0.0.1', () => { port = (srv.address() as AddressInfo).port; ok(); }); });
});
after(async () => { srv.close(); await db.fermer(); rmSync(dir, { recursive: true, force: true }); });

interface Reponse { status: number; headers: IncomingHttpHeaders; json: () => Record<string, any> }
function appel(chemin: string, o: { method?: string; headers?: Record<string, string>; corps?: string | Buffer } = {}): Promise<Reponse> {
  return new Promise((ok, ko) => {
    const req = request({ host: '127.0.0.1', port, path: chemin, method: o.method ?? 'GET', headers: o.headers }, r => {
      const m: Buffer[] = [];
      r.on('data', (b: Buffer) => m.push(b));
      r.on('end', () => { const c = Buffer.concat(m).toString('utf8'); ok({ status: r.statusCode!, headers: r.headers, json: () => JSON.parse(c) }); });
    }).on('error', ko);
    req.end(o.corps);
  });
}

/** Session de démonstration dans l'espace collaborateur (Mehdi Benali, fiche 2), par la connexion de démonstration. */
async function collaborateur(): Promise<Record<string, string>> {
  const compteId = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id;
  const r = await appel('/api/login', { method: 'POST', corps: JSON.stringify({ compteId, role: 'collaborateur', password: 'demo' }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 200, JSON.stringify(r.json()));
  assert.equal(r.json().user.empId, 2, 'collaborateur de démonstration : Mehdi Benali');
  return { cookie: String(r.headers['set-cookie']).match(/cursus_session=[^;]*/)![0], 'x-cursus-espace': 'collaborateur' };
}
const action = async (s: Record<string, string>, nom: string, p: Record<string, unknown>, en: Record<string, string> = {}) =>
  await appel(`/api/actions/${nom}`, { method: 'POST', corps: JSON.stringify(p), headers: { ...s, 'content-type': 'application/json', ...en } });
const cle = () => crypto.randomUUID();
const WEEK = '2026-10-12';
const cellule = async (di: number) => {
  const f = await db.one<{ lignes: unknown }>('SELECT lignes FROM feuilles WHERE emp_id = 2 AND week = ?', [WEEK]);
  return Number((json(f?.lignes) as { projet: string; h: number[] }[]).find(l => l.projet === 'INT-MAINT')?.h[di] ?? 0);
};
const lignesIdem = async () => Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM idempotence'))!.n);

test('registre hors ligne : saisie personnelle, jamais une validation ni une action de paie', () => {
  assert.deepEqual([...ACTIONS_HORS_LIGNE], ['temps.saisir', 'temps.addLine', 'absence.demander']);
  for (const a of ACTIONS_HORS_LIGNE) {
    assert.ok(!ACTIONS_PAIE.includes(a), `${a} : action de paie`);
    assert.doesNotMatch(a, /valid|decid|decider|submit|reject|lot/i, `${a} : une validation ne part jamais hors ligne`);
  }
  assert.deepEqual([...CONGES_HORS_LIGNE], ['CP', 'RTT', 'RECUP']);
  assert.equal(refusHorsLigne('temps.saisir', { empId: 2 }, 2), null);
  assert.match(refusHorsLigne('temps.validate', { empId: 2 }, 2)!, /non admise hors ligne/);
  assert.match(refusHorsLigne('temps.saisir', { empId: 6 }, 2)!, /votre propre saisie/);
  assert.match(refusHorsLigne('temps.saisir', { empId: 2 }, null)!, /votre propre saisie/);
  assert.match(refusHorsLigne('absence.demander', { empId: 2, kind: 'MALADIE' }, 2)!, /congés payés, RTT et récupérations/);
  assert.match(refusHorsLigne('absence.demander', { empId: 2, kind: 'CET' }, 2)!, /congés payés/);
  assert.match(refusHorsLigne('absence.demander', { empId: 2, kind: 'CP', pieces: ['x'] }, 2)!, /sans pièce/);
  assert.equal(refusHorsLigne('absence.demander', { empId: 2, kind: 'RTT' }, 2), null);
  assert.ok(JOURNAL_LABEL['temps.saisir']);
});

test('idempotence : même clé et même corps → réponse gardée sans refaire l’action ; autre corps → 422 ; clé illisible → 400', async () => {
  const s = await collaborateur();
  const k = cle();
  const p = { empId: 2, week: WEEK, projet: 'INT-MAINT', tache: 'Maintenance interne', di: 0, value: '7', base: '0' };
  await db.tx(async () => { await db.insert('feuilles', { empId: 2, week: WEEK, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h: [0, 0, 0, 0, 0, 0, 0] }] }); });
  const r1 = await action(s, 'temps.saisir', p, { 'idempotency-key': k });
  assert.equal(r1.status, 200, JSON.stringify(r1.json()));
  assert.ok(r1.json().data, 'premier envoi : instantané renvoyé');
  assert.equal(await cellule(0), 7);
  // Correction faite ailleurs entre les deux envois : le rejeu de la même requête ne la défait pas.
  await db.tx(async () => {
    const f = (await db.one<{ id: number; lignes: unknown }>('SELECT id, lignes FROM feuilles WHERE emp_id = 2 AND week = ?', [WEEK]))!;
    const l = json(f.lignes) as { h: number[] }[];
    l[0].h[0] = 6;
    await db.update('feuilles', f.id, { lignes: l });
  });
  const avant = await lignesIdem();
  const r2 = await action(s, 'temps.saisir', { ...p }, { 'idempotency-key': k });
  assert.equal(r2.status, 200);
  assert.equal(r2.headers['idempotent-replayed'], 'true');
  assert.equal(r2.json().relire, true);
  assert.equal(r2.json().data, undefined);
  assert.equal(await cellule(0), 6, 'l’action n’est pas refaite');
  assert.equal(await lignesIdem(), avant);
  // Ordre des champs indifférent ; autre corps avec la même clé : refus, rien n’est fait.
  const inverse = Object.fromEntries(Object.entries(p).reverse());
  assert.equal((await action(s, 'temps.saisir', inverse, { 'idempotency-key': k })).status, 200);
  const autre = await action(s, 'temps.saisir', { ...p, value: '8' }, { 'idempotency-key': k });
  assert.equal(autre.status, 422);
  assert.equal(autre.json().error, idem.CLE_REUTILISEE);
  assert.equal((await action(s, 'temps.addLine', { empId: 2, week: WEEK, projet: 'INT-MAINT' }, { 'idempotency-key': k })).status, 422, 'autre action');
  assert.equal(await cellule(0), 6);
  const illisible = await action(s, 'temps.saisir', p, { 'idempotency-key': 'court' });
  assert.equal(illisible.status, 400);
  assert.equal(illisible.json().error, idem.CLE_INVALIDE);
  // La clé est propre au compte : la ligne gardée n’est pas la clé reçue.
  const l = await db.one<{ cle: string; action: string; resultat: unknown }>('SELECT cle, action, resultat FROM idempotence WHERE action = ?', ['temps.saisir']);
  assert.notEqual(l!.cle, k);
  assert.match(l!.cle, /^[0-9a-f]{64}$/);
});

test('idempotence : une action refusée ne garde rien (le rejeu la refait) ; temps.saisir en conflit → 409 sans écrasement', async () => {
  const s = await collaborateur();
  const k = cle();
  // La cellule vaut 6 (test précédent) ; saisie hors ligne faite quand elle valait 0 : conflit.
  const p = { empId: 2, week: WEEK, projet: 'INT-MAINT', tache: 'Maintenance interne', di: 0, value: '8', base: '0' };
  const r = await action(s, 'temps.saisir', p, { 'idempotency-key': k, 'x-cursus-hors-ligne': '1' });
  assert.equal(r.status, 409);
  assert.match(r.json().error, /^Conflit : la cellule du .* vaut maintenant 6 h, vous aviez vu 0 h et saisi 8 h/);
  assert.equal(await cellule(0), 6);
  assert.equal(await db.one('SELECT 1 FROM idempotence WHERE cle = ?', [idem.cleStockee((await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id, k)]), undefined);
  assert.equal((await action(s, 'temps.saisir', p, { 'idempotency-key': k, 'x-cursus-hors-ligne': '1' })).status, 409, 'refait, refusé de nouveau');
  // Valeur vue juste : saisie faite ; valeur déjà écrite : rien n’est refait.
  assert.equal((await action(s, 'temps.saisir', { ...p, base: '6' }, { 'idempotency-key': cle(), 'x-cursus-hors-ligne': '1' })).status, 200);
  assert.equal(await cellule(0), 8);
  assert.equal((await action(s, 'temps.saisir', { ...p, base: '0' }, { 'idempotency-key': cle() })).status, 200, 'déjà 8 h : rien à faire');
  // Ligne absente, jour invalide : refus ; règles de la saisie gardées (plus de 24 h refusé).
  assert.equal((await action(s, 'temps.saisir', { ...p, projet: 'PRJ-INCONNU', base: '0' })).status, 409);
  assert.equal((await action(s, 'temps.saisir', { ...p, di: 9 })).status, 400);
  // temps.addLine `siAbsente` : la ligne déjà présente n’est pas doublée.
  assert.equal((await action(s, 'temps.addLine', { empId: 2, week: WEEK, projet: 'INT-MAINT', siAbsente: true })).status, 200);
  const f = await db.one<{ lignes: unknown }>('SELECT lignes FROM feuilles WHERE emp_id = 2 AND week = ?', [WEEK]);
  assert.equal((json(f!.lignes) as unknown[]).length, 1);
});

test('rejeu hors ligne : action hors du registre, salarié d’autrui, nature de santé refusés (422) ; journal marqué horsLigne', async () => {
  const s = await collaborateur();
  const hl = { 'x-cursus-hors-ligne': '1', 'idempotency-key': cle() };
  assert.equal((await action(s, 'temps.submit', { empId: 2, week: WEEK }, hl)).status, 422);
  assert.equal((await action(s, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-07', au: '2026-12-08' }, { ...hl, 'idempotency-key': cle() })).status, 422);
  const sante = await action(s, 'absence.demander', { empId: 2, kind: 'MALADIE', du: '2026-12-07', au: '2026-12-08' }, { ...hl, 'idempotency-key': cle() });
  assert.equal(sante.status, 422);
  assert.match(sante.json().error, /congés payés, RTT et récupérations/);
  const k = cle();
  const ok = await action(s, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' }, { 'x-cursus-hors-ligne': '1', 'idempotency-key': k });
  assert.equal(ok.status, 200, JSON.stringify(ok.json()));
  // Réponse perdue, renvoi de la même saisie : une seule demande.
  assert.equal((await action(s, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' }, { 'x-cursus-hors-ligne': '1', 'idempotency-key': k })).headers['idempotent-replayed'], 'true');
  assert.equal(Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM absences WHERE emp_id = 2 AND du = '2026-12-07'`))!.n), 1);
  const j = await db.one<{ payload: unknown }>(`SELECT payload FROM journal WHERE action = 'absence.demander' ORDER BY id DESC LIMIT 1`);
  assert.equal((json(j!.payload) as { horsLigne?: boolean }).horsLigne, true);
  // Sans l’en-tête : pas de marque.
  await action(s, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-12-14', au: '2026-12-14' });
  const j2 = await db.one<{ payload: unknown }>(`SELECT payload FROM journal WHERE action = 'absence.demander' ORDER BY id DESC LIMIT 1`);
  assert.equal((json(j2!.payload) as { horsLigne?: boolean }).horsLigne, undefined);
});

test('POST /api/pieces avec une clé : le même fichier renvoyé rend la même pièce, une seule ligne ; autre fichier → 422', async () => {
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'local' });
  const s = await collaborateur();
  const PDF = Buffer.from('%PDF-1.4\n% reçu de restaurant\n%%EOF\n');
  const envoi = async (octets: Buffer, k?: string) => await appel('/api/pieces', { method: 'POST', corps: octets, headers: { ...s, 'content-type': 'application/pdf', 'x-nom-fichier': 'recu.pdf', ...(k ? { 'idempotency-key': k } : {}) } });
  const k = cle();
  const a = await envoi(PDF, k);
  assert.equal(a.status, 201, JSON.stringify(a.json()));
  const b = await envoi(PDF, k);
  assert.equal(b.status, 201);
  assert.equal(b.headers['idempotent-replayed'], 'true');
  assert.equal(b.json().id, a.json().id);
  assert.equal(b.json().jeton, a.json().jeton);
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM pieces WHERE id >= ?', [a.json().id]))!.n), 1);
  const autre = await envoi(Buffer.from('%PDF-1.4\n% autre\n%%EOF\n'), k);
  assert.equal(autre.status, 422);
  // Résultat gardé réduit à l’identifiant : jamais le jeton.
  const l = await db.one<{ resultat: unknown }>(`SELECT resultat FROM idempotence WHERE action = 'piece.deposer'`);
  assert.deepEqual(json(l!.resultat), { id: a.json().id });
  // Pièce jointe entre-temps (jeton effacé) : le renvoi ne rend plus de jeton.
  await db.tx(async () => { await db.update('pieces', a.json().id, { jeton: null, objet: 'absence', objetId: 1, empId: 2 }); });
  assert.equal((await envoi(PDF, k)).status, 410);
  assert.equal((await envoi(PDF, 'x')).status, 400);
});

test('idempotence : résultat réduit, empreinte stable, purge à 30 jours', async () => {
  assert.deepEqual(idem.resultatReduit({ id: 3, jeton: 'secret', ok: true, ids: [1, 2], noms: ['a'], vide: null }), { id: 3, ok: true, ids: [1, 2], vide: null });
  assert.equal(idem.resultatReduit('texte'), null);
  assert.equal(idem.resultatReduit([1]), null);
  assert.equal(idem.resultatReduit({ jeton: 'x' }), null);
  assert.equal(idem.empreinteCorps('a', { x: 1, y: [2, { b: 1, a: 2 }] }), idem.empreinteCorps('a', { y: [2, { a: 2, b: 1 }], x: 1 }));
  assert.notEqual(idem.empreinteCorps('a', { x: 1 }), idem.empreinteCorps('b', { x: 1 }));
  const req = (v: string | undefined) => ({ get: () => v }) as unknown as Parameters<typeof idem.lireCle>[0];
  assert.equal(idem.lireCle(req(undefined)), null);
  assert.equal(idem.lireCle(req('')), null);
  assert.equal(idem.lireCle(req('pas une clé !')), false);
  const compte = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id;
  await db.tx(async () => {
    await db.insert('idempotence', { cle: 'ancienne', compteId: compte, action: 'x', empreinteCorps: 'e', statut: 200, message: null, resultat: null, creation: '2026-09-01T08:00:00.000Z' });
    await db.insert('idempotence', { cle: 'recente', compteId: compte, action: 'x', empreinteCorps: 'e', statut: 200, message: null, resultat: null, creation: '2026-10-05T08:00:00.000Z' });
  });
  assert.equal(await db.tx(async () => await idem.purgerIdempotence(db, new Date('2026-10-10T08:00:00Z'))), 1);
  assert.ok(await db.get('idempotence', 'recente'));
  assert.equal(await db.get('idempotence', 'ancienne'), undefined);
});

test('tables techniques (idempotence, abonnements et file push) : sans révision, jamais lues par l’instantané', async () => {
  for (const t of ['idempotence', 'abonnementsPush', 'envoisPush'] as const) {
    assert.ok(TABLES_SANS_REVISION.has(t), t);
    assert.ok(!TABLES_LUES.has(t), t);
  }
  const lues: string[] = [];
  const query = db.query.bind(db);
  db.query = (async (sql: string, params?: readonly unknown[]) => { lues.push(sql); return await query(sql, params as never); }) as typeof db.query;
  try {
    await loadFull(db, { role: 'rh', empId: null, nom: 'RH', intitule: 'RH', profilRh: 'rh_admin' });
  } finally {
    db.query = query;
  }
  assert.ok(lues.length > 0);
  assert.deepEqual(lues.filter(q => /\b(idempotence|abonnements_push|envois_push)\b/.test(q)), []);
});

test('routes des notifications : clé publique et appareils du seul compte connecté, jamais l’adresse ni les clés', async () => {
  assert.equal((await appel('/api/push/cle')).status, 401);
  assert.equal((await appel('/api/push/appareils')).status, 401);
  const s = await collaborateur();
  const c = await appel('/api/push/cle', { headers: s });
  assert.equal(c.status, 200);
  assert.equal(c.json().active, true, 'démonstration : clé en mémoire');
  assert.match(c.json().cle, /^[A-Za-z0-9_-]{87}$/);
  assert.ok(c.json().types.includes('absence.decision'));
  const compte = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id;
  const autre = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 12'))!.id;
  await db.tx(async () => {
    for (const [compteId, n] of [[compte, 'a'], [autre, 'b']] as const) {
      await db.insert('abonnementsPush', { compteId, cleEndpoint: `cle-${n}`, endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, p256dh: 'p', auth: 'q', appareil: 'Android, Chrome', types: ['absence.decision'], creation: '2026-10-01T08:00:00.000Z', echecs: 0 });
    }
  });
  const a = await appel('/api/push/appareils', { headers: s });
  assert.equal(a.status, 200);
  assert.deepEqual(a.json().appareils.map((x: Record<string, unknown>) => [x.appareil, x.empreinte, x.types]), [['Android, Chrome', 'cle-a', ['absence.decision']]]);
  assert.doesNotMatch(JSON.stringify(a.json()), /fcm|"p256dh"|"auth"|endpoint/);
});
