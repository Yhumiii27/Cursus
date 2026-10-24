// Cache de l'instantané et révision de la base (lot 8, chantier E, étape 2 ; server/src/cache-instantane.ts) :
// - le filtrage par espace et par profil reste identique : pour chaque compte et chaque espace du jeu de démonstration,
//   et pour chaque profil de l'espace RH, l'instantané servi par le cache est celui calculé sans cache ;
// - toute écriture d'une table lue par l'instantané (action, tâche planifiée, API Keystone, écriture SQL directe comme
//   une reprise, remise à zéro comme une purge) augmente la révision tenue en base et rend le cache périmé ; une
//   transaction annulée ne la change pas ; le journal et les sessions ne la changent pas ;
// - dans une transaction, la lecture reste directe (révision non lue, écritures non validées jamais mises en cache) ;
// - sur PostgreSQL, deux instances sur la même base voient la même révision, et chacune voit les écritures de l'autre.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
process.env.KEYSTONE_API_KEY = 'cle-keystone-essai-cache';
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { cacheActif, cleVue, donneesAction, donneesDe, viderCache, voitPaie, vueEnCache } = await import('../server/src/cache-instantane.ts');
const { espacesDuCompte } = await import('../server/src/comptes.ts');
const { tachesEmails } = await import('../server/src/notifications.ts');
const { PROFILS_RH } = await import('../shared/constants.ts');
const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Parameters<typeof buildSnapshot>[1];
type Compte = import('../server/src/comptes.ts').Compte;
type Pg = import('../server/src/db-pg.ts').PgDb;

const SEUL_PG = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien de maintenance' };
const serveurs: Server[] = [];
after(() => { for (const s of serveurs) s.close(); });

async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  return db;
}
/** Instantané par le cache (lecture stable, comme GET /api/data) et sans le cache (hors lecture : lecture directe). */
const enCache = async (db: Db, u: User) => await db.lecture(async () => await buildSnapshot(db, u));
const direct = async (db: Db, u: User) => await buildSnapshot(db, u);
const json = (x: unknown) => JSON.parse(JSON.stringify(x));

test('filtrage identique : chaque compte et chaque espace de la démonstration, chaque profil RH, avec et sans cache', async () => {
  const db = await demo();
  const users: User[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    for (const role of await espacesDuCompte(db, c)) {
      const u = await currentUser(db, { id: 'essai', compteId: c.id, role } as never);
      if (u) users.push(u);
    }
  }
  // Tous les profils de l'espace RH, même absents des comptes de démonstration.
  for (const profilRh of Object.keys(PROFILS_RH) as (keyof typeof PROFILS_RH)[]) users.push({ ...RH, profilRh });
  assert.ok(users.some(u => u.role === 'manager') && users.some(u => u.role === 'collaborateur') && users.filter(u => u.role === 'rh').length >= 5);
  // Deux passages : le second sert les vues déjà calculées.
  for (let passe = 0; passe < 2; passe++) {
    for (const u of users) assert.deepEqual(json(await enCache(db, u)), json(await direct(db, u)), `${u.role} ${u.profilRh ?? u.empId} (passage ${passe + 1})`);
  }
  // Jamais la vue d'un autre : clés distinctes par profil et par personne.
  assert.notEqual(cleVue({ ...RH, profilRh: 'paie' }), cleVue({ ...RH, profilRh: 'rh_admin' }));
  assert.notEqual(cleVue(MEHDI), cleVue({ ...MEHDI, empId: 3 }));
  assert.notEqual(cleVue(MEHDI), cleVue({ ...MEHDI, role: 'manager' }));
  assert.equal(cleVue({ ...RH, profilRh: undefined }), 'rh|rh_gestionnaire', 'profil par défaut, comme droitsRh');
});

test('révision : augmentée par toute écriture validée, sauf journal et sessions ; inchangée par une transaction annulée', async () => {
  const db = await demo();
  const r0 = await db.revisionBase();
  await db.update('employes', 2, { nom: 'Mehdi Benali-Durand' });
  const r1 = await db.revisionBase();
  assert.ok(r1 > r0, 'écriture isolée');
  await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', ['Reprise', 2]);
  const r2 = await db.revisionBase();
  assert.ok(r2 > r1, 'SQL direct (reprise)');
  await db.setSetting('essai', 1);
  const r3 = await db.revisionBase();
  assert.ok(r3 > r2, 'réglage');
  await assert.rejects(db.tx(async () => { await db.update('employes', 2, { nom: 'Annulé' }); throw new Error('annulée'); }));
  assert.equal(await db.revisionBase(), r3, 'transaction annulée');
  await db.insert('journal', { at: new Date().toISOString(), actor: 'Cursus', action: 'essai', message: null, payload: {}, salaries: [] });
  await db.run('UPDATE connexions SET activite = ?', [new Date().toISOString()]);
  assert.equal(await db.revisionBase(), r3, 'journal et sessions : sans effet');
  // Remise à zéro (comme une purge : TRUNCATE sur PostgreSQL, DELETE sur SQLite).
  await db.clearAll();
  assert.ok(await db.revisionBase() > r3, 'remise à zéro');
});

test('cache périmé après chaque écriture : action, tâche planifiée, API Keystone, SQL direct, remise à zéro', async () => {
  const db = await demo();
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const compte = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin']))!;
  const id = randomBytes(32).toString('base64url');
  await db.insert('connexions', { id: empreinteSession(id), compteId: compte.id, role: 'rh', methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: null });
  const cookie = `cursus_session=${id}.${await sign(db, id)}`;
  const donnees = async () => {
    const r = await fetch(`${base}/api/data`, { headers: { cookie, 'x-cursus-espace': 'rh' } });
    assert.equal(r.status, 200);
    return await r.json() as { employes: { id: number; nom: string }[]; referentiels: { projets: { code: string }[] }; settings: { relancesActives: boolean } };
  };
  const nom = async () => (await donnees()).employes.find(e => e.id === 2)!.nom;
  assert.equal(await nom(), 'Mehdi Benali');
  assert.equal(await nom(), 'Mehdi Benali', 'servi par le cache');
  // Action (POST /api/actions) : l'instantané renvoyé et le suivant la montrent.
  assert.equal((await donnees()).settings.relancesActives, true);
  const a = await fetch(`${base}/api/actions/parametres.maj`, { method: 'POST', headers: { cookie, 'x-cursus-espace': 'rh', 'content-type': 'application/json' }, body: JSON.stringify({ relancesActives: false }) });
  const ar = await a.json() as { data: { settings: { relancesActives: boolean } }; error?: string };
  assert.equal(a.status, 200, ar.error);
  assert.equal(ar.data.settings.relancesActives, false, 'instantané renvoyé par l’action');
  assert.equal((await donnees()).settings.relancesActives, false);
  // SQL direct (reprise, outil en ligne de commande, autre processus).
  await db.run('UPDATE employes SET nom = ? WHERE id = ?', ['Mehdi B.', 2]);
  assert.equal(await nom(), 'Mehdi B.');
  // Tâche planifiée (passage du quart d'heure, qui note ses réglages).
  const avant = await db.revisionBase();
  await tachesEmails(db, 8);
  assert.ok(await db.revisionBase() > avant, 'la tâche a écrit ses réglages');
  await db.run('UPDATE employes SET nom = ? WHERE id = ?', ['Mehdi Benali', 2]);
  assert.equal(await nom(), 'Mehdi Benali');
  // API Keystone (écriture d'un projet).
  const k = await fetch(`${base}/api/integrations/keystone/v1/projets/K-9101`, { method: 'PUT', headers: { 'x-api-key': process.env.KEYSTONE_API_KEY!, 'content-type': 'application/json' }, body: JSON.stringify({ nom: 'Arrêt technique' }) });
  assert.equal(k.status, 201);
  assert.ok((await donnees()).referentiels.projets.some(p => p.code === 'K-9101'));
  // Remise à zéro (purge ; les comptes partent avec) : plus aucune fiche dans l'instantané servi par le cache.
  assert.ok((await enCache(db, RH)).employes.length);
  await db.clearAll();
  assert.deepEqual((await enCache(db, RH)).employes, []);
});

test('dans une transaction : lecture directe, écritures non validées jamais mises en cache', async () => {
  const db = await demo();
  assert.equal(db.lectureStable, false);
  await db.lecture(async () => assert.equal(db.lectureStable, true));
  await db.tx(async () => assert.equal(db.lectureStable, false));
  await db.tx(async () => await db.lecture(async () => assert.equal(db.lectureStable, false, 'lecture dans une transaction')));
  await assert.rejects(db.tx(async () => {
    await db.update('employes', 2, { nom: 'Jamais validé' });
    // L'instantané d'une transaction voit ses propres écritures…
    assert.equal((await buildSnapshot(db, RH)).employes.find(e => e.id === 2)!.nom, 'Jamais validé');
    throw new Error('annulée');
  }));
  // … mais rien n'en reste dans le cache.
  assert.equal((await enCache(db, RH)).employes.find(e => e.id === 2)!.nom, 'Mehdi Benali');
});

test('entrée du cache : gelée sous node --test, partagée par les lectures simultanées, retirée après un échec', async () => {
  const db = await demo();
  const s = await enCache(db, MEHDI);
  assert.throws(() => { (s.employes as unknown as unknown[]).push({}); }, TypeError, 'instantané partagé non modifiable');
  // Lectures simultanées d'une même révision : une seule lecture complète.
  viderCache(db);
  let lectures = 0;
  const lire = async (u: User) => { lectures++; return await loadFull(db, u); };
  const calculer = (full: Awaited<ReturnType<typeof loadFull>>) => full;
  const today = '2026-10-10';
  const [x, y] = await Promise.all([
    db.lecture(async () => await vueEnCache(db, RH, today, 1, lire, calculer)),
    db.lecture(async () => await vueEnCache(db, MEHDI, today, 2, lire, calculer)),
  ]);
  assert.equal(lectures, 1);
  assert.deepEqual([x!.user, x!.revision, y!.user, y!.revision], [RH, 1, MEHDI, 2], 'utilisateur et révision de chaque requête');
  assert.deepEqual(y!.absencesPaie, [], 'collaborateur : rien de la paie');
  // Lecture en échec : retirée, la suivante relit.
  viderCache(db);
  await assert.rejects(db.lecture(async () => await vueEnCache(db, RH, today, 1, async () => { throw new Error('occupé'); }, calculer)), /occupé/);
  assert.ok(await db.lecture(async () => await vueEnCache(db, RH, today, 1, lire, calculer)));
  // Calcul d'une vue en échec : retiré, le suivant recalcule.
  await assert.rejects(db.lecture(async () => await vueEnCache(db, MEHDI, today, 1, lire, () => { throw new Error('calcul'); })), /calcul/);
  assert.ok(await db.lecture(async () => await vueEnCache(db, MEHDI, today, 1, lire, calculer)));
  // Hors lecture stable : null (lecture directe par l'appelant).
  assert.equal(await vueEnCache(db, RH, today, 1, lire, calculer), null);
  // Lecture d'une révision plus ancienne que l'entrée (commencée avant la dernière écriture) : servie par l'entrée plus
  // récente, sans lecture ; sauf les résumés de la paie pas encore calculés, qui se lisent sur l'état de l'entrée.
  viderCache(db);
  assert.ok(await db.lecture(async () => await vueEnCache(db, MEHDI, today, 1, lire, calculer)));
  const n = await db.revisionBase();
  await db.run('UPDATE revision SET n = ?', [n - 5]);
  lectures = 0;
  assert.ok(await db.lecture(async () => await vueEnCache(db, { ...MEHDI, empId: 3 }, today, 1, lire, calculer)), 'servie par l’entrée récente');
  assert.equal(await db.lecture(async () => await vueEnCache(db, RH, today, 1, lire, calculer)), null, 'paie : lecture directe');
  await db.run('UPDATE revision SET n = ?', [n]);
  assert.ok(await db.lecture(async () => await vueEnCache(db, RH, today, 1, lire, calculer)));
  await db.run('UPDATE revision SET n = ?', [n - 5]);
  assert.ok(await db.lecture(async () => await vueEnCache(db, { ...RH, profilRh: 'paie' }, today, 1, lire, calculer)), 'résumés déjà calculés : servie');
  await db.run('UPDATE revision SET n = ?', [n]);
  assert.equal(lectures, 0, 'aucune lecture complète : l’entrée de la révision récente est restée');
  // Données tirées de la lecture partagée : comme loadFull les lit pour chaque lecteur.
  const full = await loadFull(db, RH);
  assert.deepEqual(json(donneesDe(full, MEHDI, 7, null)), json({ ...await loadFull(db, MEHDI), revision: 7 }));
  assert.deepEqual(json(donneesDe(full, RH, 7, { absencesPaie: full.absencesPaie, deplacementsPaie: full.deplacementsPaie })), json({ ...full, revision: 7 }));
  assert.deepEqual([voitPaie(RH), voitPaie({ ...RH, profilRh: 'paie' }), voitPaie({ ...RH, profilRh: 'lecture_seule' }), voitPaie({ ...RH, profilRh: 'referent_hse' }), voitPaie(MEHDI)],
    [true, true, true, false, false]);
});

test('action : lecture partagée du cache dans sa transaction quand elle décrit l’état vu, sinon lecture directe', async () => {
  const db = await demo();
  let directes = 0;
  const lire = async (u: User) => { directes++; return await loadFull(db, u); };
  const today = '2026-10-10';
  // Sans entrée : lecture directe.
  await db.tx(async () => await donneesAction(db, RH, today, lire));
  assert.equal(directes, 1);
  // Entrée de l'état courant (instantané d'une autre requête) : reprise telle quelle, résumés de la paie compris.
  await enCache(db, MEHDI);
  for (const u of [RH, MEHDI, { ...RH, profilRh: 'paie' as const }]) {
    const ds = await db.tx(async () => await donneesAction(db, u, today, lire));
    assert.deepEqual(json({ ...ds, revision: 0 }), json({ ...await loadFull(db, u), revision: 0 }), `${u.role} ${u.profilRh ?? ''}`);
  }
  assert.equal(directes, 1, 'aucune lecture directe');
  // Écriture déjà faite dans la transaction, autre jour, cache désactivé : lecture directe.
  await db.tx(async () => { await db.setSetting('essai', 1); await donneesAction(db, RH, today, lire); });
  assert.equal(directes, 2);
  await db.tx(async () => await donneesAction(db, RH, '2026-10-11', lire));
  assert.equal(directes, 3);
  process.env.CURSUS_CACHE_INSTANTANE = '0';
  try {
    await enCache(db, MEHDI);
    await db.tx(async () => await donneesAction(db, RH, today, lire));
  } finally {
    delete process.env.CURSUS_CACHE_INSTANTANE;
  }
  assert.equal(directes, 4);
});

test('CURSUS_CACHE_INSTANTANE=0 : cache désactivé, lecture directe', async () => {
  assert.equal(cacheActif({}), true);
  assert.equal(cacheActif({ CURSUS_CACHE_INSTANTANE: '0' }), false);
  const db = await demo();
  process.env.CURSUS_CACHE_INSTANTANE = '0';
  try {
    assert.equal(await db.lecture(async () => await vueEnCache(db, RH, '2026-10-10', 1, async u => await loadFull(db, u), f => f)), null);
    assert.deepEqual(json(await enCache(db, MEHDI)), json(await direct(db, MEHDI)));
  } finally {
    delete process.env.CURSUS_CACHE_INSTANTANE;
  }
});

test('PostgreSQL : deux instances sur la même base voient la même révision et les écritures de l’autre', SEUL_PG, async () => {
  const a = await demo() as unknown as Pg;
  const url = (a.pool as unknown as { options: { connectionString: string } }).options.connectionString;
  const b = await ouvrirPostgres(url, { schema: a.schema, env: process.env });
  try {
    assert.equal(await b.revisionBase(), await a.revisionBase());
    const nom = async (db: Pg) => (await enCache(db as unknown as Db, RH)).employes.find(e => e.id === 2)!.nom;
    assert.equal(await nom(a), 'Mehdi Benali');
    assert.equal(await nom(b), 'Mehdi Benali');
    await a.update('employes', 2, { nom: 'Écrit par A' });
    assert.equal(await b.revisionBase(), await a.revisionBase());
    assert.equal(await nom(b), 'Écrit par A', 'cache de B périmé par l’écriture de A');
    await b.tx(async () => await b.update('employes', 2, { nom: 'Écrit par B' }));
    assert.equal(await nom(a), 'Écrit par B');
    // Déclencheur manquant (table ajoutée sans sa migration) : démarrage refusé.
    await b.exec('DROP TRIGGER revision ON absences');
    await assert.rejects(b.controlerSchema(), /déclencheur revision de absences/);
  } finally {
    await b.fermer();
  }
});
