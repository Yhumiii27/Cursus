// Compteurs du cache de l'instantané (lot 9, chantier 4, étape 2 ; `statistiquesCache` de server/src/cache-instantane.ts),
// relevés par l'essai de charge (scripts/charge/executer.ts) et par le banc d'oracle : entrées lues en entier ou dérivées
// par un delta, replis et leur cause, jeux d'action, durée et taille des deltas, vues recalculées et reportées. Sur le
// moteur de la suite (SQLite par défaut, PostgreSQL avec npm run test:pg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_CACHE_INCREMENTAL;
delete process.env.CURSUS_VUES_REPORT;

const { nouvelleBase } = await import('./base.ts');
const { baseDemo } = await import('./support/oracle.ts');
const { lecteursDe } = await import('../scripts/charge/verifier.ts');
const { buildSnapshot, loadFull, todayIso } = await import('../server/src/dataset.ts');
const { donneesAction, jeuApres, remettreStatistiques, statistiquesCache, viderCache } = await import('../server/src/cache-instantane.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Awaited<ReturnType<typeof lecteursDe>>[number];

const lire = async (db: Db, u: User) => await db.lecture(async () => await buildSnapshot(db, u));
/** Jeu d'une action de `u`, dans une transaction (lecture directe comptée par `directes`). */
const jeuAction = async (db: Db, u: User) => await db.tx(async () => await donneesAction(db, u, todayIso(), async x => await loadFull(db, x)));

test('compteurs : entrée lue puis dérivée, vues recalculées ou reportées, jeux d’action, replis et remise à zéro', async () => {
  const db = await baseDemo(nouvelleBase);
  viderCache(db);
  const lecteurs = await lecteursDe(db);
  const collab = lecteurs.find(u => u.role === 'collaborateur')!;
  const rh = lecteurs.find(u => u.role === 'rh' && u.profilRh === 'rh_admin')!;
  remettreStatistiques();
  assert.deepEqual(statistiquesCache(), {
    entreesCompletes: 0, entreesDerivees: 0, replis: { ecartInconnu: 0, precedenteIndisponible: 0 }, jeuxAction: { partages: 0, derives: 0, directs: 0 },
    jeuxSuivi: { derives: 0, replis: 0 }, delta: { n: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, cles: 0, clesMax: 0 }, vuesCalculees: { rh: 0, manager: 0, collaborateur: 0 }, vuesReportees: 0,
  });

  // Première lecture : entrée lue en entier, une vue collaborateur et une vue RH calculées.
  await lire(db, collab);
  await lire(db, rh);
  let s = statistiquesCache(db);
  assert.equal(s.entreesCompletes, 1);
  assert.deepEqual(s.vuesCalculees, { rh: 1, manager: 0, collaborateur: 1 });

  // Écriture sur la feuille d'un autre salarié : entrée dérivée par un delta d'une clé, vue du collaborateur reportée, vue RH recalculée.
  const autre = (await loadFull(db, rh)).feuilles.find(f => f.empId !== collab.empId)!;
  await db.run('UPDATE feuilles SET comment = ? WHERE id = ?', ['Compteurs', autre.id]);
  await lire(db, collab);
  await lire(db, rh);
  s = statistiquesCache(db);
  assert.equal(s.entreesCompletes, 1, 'aucune relecture complète');
  assert.equal(s.entreesDerivees, 1);
  assert.equal(s.delta.n, 1);
  assert.equal(s.delta.cles, 1);
  assert.equal(s.delta.clesMax, 1);
  assert.ok(s.delta.maxMs >= s.delta.p95Ms && s.delta.p95Ms >= s.delta.p50Ms && s.delta.p50Ms >= 0);
  assert.equal(s.vuesReportees, 1, 'vue du collaborateur reprise telle quelle');
  assert.deepEqual(s.vuesCalculees, { rh: 2, manager: 0, collaborateur: 1 });

  // Jeu d'action : lecture partagée de la révision courante, puis entrée + delta après une autre écriture.
  const jeu = await jeuAction(db, collab);
  await db.run('UPDATE feuilles SET comment = ? WHERE id = ?', ['Compteurs 2', autre.id]);
  await jeuAction(db, collab);
  s = statistiquesCache(db);
  assert.deepEqual(s.jeuxAction, { partages: 1, derives: 1, directs: 0 });
  assert.equal(s.delta.n, 2, 'delta du jeu d’action compté');
  // Suivi des verdicts : jeu de l'action plus ses écritures (dérivé) ; jeu inconnu du cache : relu par l'appelant.
  await db.tx(async () => {
    const depart = await donneesAction(db, collab, todayIso(), async x => await loadFull(db, x));
    await db.run('UPDATE feuilles SET comment = ? WHERE id = ?', ['Compteurs 3', autre.id]);
    assert.ok(await jeuApres(db, depart, rh));
    assert.equal(await jeuApres(db, { ...jeu }, rh), null);
  });
  s = statistiquesCache(db);
  assert.deepEqual(s.jeuxSuivi, { derives: 1, replis: 1 });

  // Écart inconnu (journal purgé au-delà de l'entrée) : repli complet compté avec sa cause.
  await lire(db, collab);
  const avant = statistiquesCache(db);
  await db.run('UPDATE feuilles SET comment = ? WHERE id = ?', ['Compteurs 4', autre.id]);
  const { n } = await db.etatRevision();
  await db.run('UPDATE revision SET purge = ?', [n]);
  await lire(db, collab);
  s = statistiquesCache(db);
  assert.equal(s.replis.ecartInconnu, avant.replis.ecartInconnu + 1);
  assert.equal(s.entreesCompletes, avant.entreesCompletes + 1);
  // Aucune entrée : le jeu d'action est lu directement.
  viderCache(db);
  await jeuAction(db, collab);
  assert.equal(statistiquesCache(db).jeuxAction.directs, 1);

  // Le relevé est une copie ; la remise à zéro repart de rien, vues reportées comprises.
  const releve = statistiquesCache(db);
  releve.replis.ecartInconnu = 99;
  assert.notEqual(statistiquesCache(db).replis.ecartInconnu, 99);
  remettreStatistiques();
  s = statistiquesCache(db);
  assert.equal(s.entreesCompletes + s.entreesDerivees + s.vuesReportees + s.delta.n + s.jeuxAction.directs, 0);
});
