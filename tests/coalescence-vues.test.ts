// Vues calculées hors de la lecture stable et coalescence (lot 10, chantier A ; server/src/cache-instantane.ts,
// `preparerVue`, `vueHorsLecture` ; server/src/dataset.ts, `lireParties`) :
// - pour chaque compte, chaque espace et chaque profil RH, la vue de GET /api/data (`lireParties`) est celle de la
//   lecture directe, tête comprise, avant et après une écriture ;
// - des requêtes simultanées d'une même révision partagent une seule évaluation par clé de vue ;
// - une requête qui trouve en cours le calcul de sa clé sur une révision plus ancienne l'attend, puis relit l'état de la
//   base et sert la dernière révision atteinte (exacte), sans calculer les révisions intermédiaires ;
// - une requête qui ne crée pas l'entrée rend sa lecture sans attendre que l'entrée soit lue ;
// - la réponse porte une révision au moins égale à celle de sa lecture ;
// - verdict de l'API Keystone (`jeuEnLecture`) et lecture partagée des tâches du quart d'heure (`lecturePartagee`, par
//   `donneesAction`) : égaux à loadFull.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;

const { PG } = await import('./base.ts');
const { grosseDemo, lecteurs } = await import('./support/vues-lot10.ts');
const { buildSnapshot, lireParties, loadFull, todayIso, vueDe } = await import('../server/src/dataset.ts');
const ci = await import('../server/src/cache-instantane.ts');
const { cleVue, jeuEnLecture, preparerVue, remettreStatistiques, statistiquesCache, viderCache, vueHorsLecture } = ci;
const { lecturePartagee } = await import('../server/src/lecture-partagee.ts');
const { ecart, instantaneDirect } = await import('../scripts/charge/verifier.ts');
const { PROFILS_RH } = await import('../shared/constants.ts');
type Db = Awaited<ReturnType<typeof grosseDemo>>;
type User = import('../shared/types.ts').CurrentUser;
type Dataset = import('../shared/types.ts').Dataset;

const RH: User = { role: 'rh', empId: null, nom: 'Coalescence', intitule: 'Essai', profilRh: 'rh_admin' };
const lire = (db: Db) => async (u: User) => await loadFull(db, u);

async function tous(db: Db): Promise<User[]> {
  return [...(await lecteurs(db)).map(x => x.user), ...(Object.keys(PROFILS_RH) as NonNullable<User['profilRh']>[]).map(profilRh => ({ ...RH, profilRh }))];
}

/** Promesse réglée de l'extérieur. */
function attente<T>() {
  let ok!: (v: T) => void;
  const p = new Promise<T>(r => { ok = r; });
  return { p, ok };
}

test('lireParties : vue et tête égales à la lecture directe pour chaque compte et chaque profil, avant et après une écriture', async () => {
  const db = await grosseDemo();
  for (const etape of ['départ', 'après une écriture']) {
    for (const u of await tous(db)) {
      const revision = db.revision;
      const { vue, tete } = await lireParties(db, u);
      assert.ok(tete.revision! >= revision, 'révision de la réponse : au moins celle de sa lecture');
      const directe = await instantaneDirect(db, u);
      assert.equal(ecart(directe, { ...vue, ...tete }), null, `${etape} : ${u.role} ${u.profilRh ?? u.empId}`);
    }
    await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', ['Écriture', 8]);
  }
});

test('requêtes simultanées d’une même révision : une évaluation par clé de vue', async () => {
  const db = await grosseDemo();
  viderCache(db);
  remettreStatistiques();
  const users = (await tous(db)).filter(u => u.role !== 'collaborateur');
  const n = users.length;
  const parties = await Promise.all([...users, ...users, ...users].map(u => lireParties(db, u)));
  const cles = new Set(users.map(cleVue));
  const s = statistiquesCache(db).vuesCalculees;
  assert.equal(s.rh + s.manager + s.collaborateur, cles.size, 'une évaluation par clé');
  for (let i = 0; i < n; i++) {
    assert.equal(parties[i].vue, parties[i + n].vue, 'même vue partagée');
    assert.equal(parties[i].vue, parties[i + 2 * n].vue);
  }
});

test('calcul en cours sur une révision plus ancienne : attendu une fois, puis la dernière révision servie, exacte', async () => {
  const db = await grosseDemo();
  viderCache(db);
  const u: User = { ...RH, profilRh: 'rh_gestionnaire' };
  // Calcul de la vue à la révision n, retenu (instantané rendu plus tard) : il reste « en cours ».
  const p1 = (await db.lecture(async () => await preparerVue(db, u, todayIso(), db.revision, lire(db))))!;
  const retenu = attente<Dataset>();
  const base1 = await p1.base;
  const enCours = vueHorsLecture(db, { ...p1, base: retenu.p }, full => vueDe(full, u), true);
  await new Promise(ok => setImmediate(ok));
  await new Promise(ok => setImmediate(ok));
  // Deux écritures : révisions n+1 et n+2 ; une requête arrive.
  await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', ['Tranche 1', 2]);
  await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', ['Tranche 2', 15]);
  remettreStatistiques();
  const attentes = ci.COALESCENCE.attentes;
  let servie = false;
  const requete = lireParties(db, u).then(x => { servie = true; return x; });
  await new Promise(ok => setTimeout(ok, 50));
  assert.equal(servie, false, 'la requête attend le calcul en cours');
  retenu.ok(base1);
  const ancienne = await enCours;
  assert.notEqual(ancienne, 'relire');
  const { vue, tete } = await requete;
  assert.equal(statistiquesCache(db).vuesCalculees.rh, 1, 'une seule évaluation, celle de la dernière révision');
  assert.equal(ci.COALESCENCE.attentes - attentes, 1, 'une attente, puis relecture');
  assert.equal(ecart(await instantaneDirect(db, u), { ...vue, ...tete }), null, 'dernière révision, exacte');
  assert.ok(vue.feuilles.some(f => f.comment === 'Tranche 2'), 'écritures visibles');
  // Une requête arrivée ensuite partage cette même vue.
  assert.equal((await lireParties(db, u)).vue, vue);
});

// Sur SQLite, les lectures passent une à une (file unique) : une seconde lecture ne peut commencer pendant la première.
test('PostgreSQL : lecture rendue avant que l’entrée ne soit lue, quand la requête ne la crée pas', { skip: !PG && 'lectures en file unique sur SQLite' }, async () => {
  const db = await grosseDemo();
  viderCache(db);
  const u: User = { ...RH, profilRh: 'referent_hse' };
  const retenue = attente<void>();
  let lectures = 0;
  const lente = async (x: User) => { lectures++; await retenue.p; return await loadFull(db, x); };
  // Première requête : crée l'entrée, la lecture complète est retenue.
  const premiere = db.lecture(async () => await preparerVue(db, u, todayIso(), db.revision, lente, false));
  await new Promise(ok => setTimeout(ok, 20));
  // Seconde : trouve l'entrée en cours, rend sa lecture sans l'attendre.
  const seconde = await db.lecture(async () => await preparerVue(db, u, todayIso(), db.revision, lente, false));
  assert.ok(seconde && !seconde.relire);
  let lue = false;
  void seconde!.base.then(() => { lue = true; });
  await new Promise(ok => setImmediate(ok));
  assert.equal(lue, false, 'entrée encore en cours de lecture');
  retenue.ok();
  await premiere;
  assert.equal(lectures, 1);
  const v = await vueHorsLecture(db, seconde!, full => vueDe(full, u), true);
  assert.notEqual(v, 'relire');
  if (v !== 'relire') assert.ok(v.revision >= seconde!.revision, 'révision de la réponse');
  const { vue, tete } = await lireParties(db, u);
  assert.ok(isDeepStrictEqual({ ...vue, ...tete }, await db.lecture(async () => await buildSnapshot(db, u, { cache: false }))));
});

test('API Keystone et tâches du quart d’heure : jeu de la lecture partagée égal à loadFull', async () => {
  const db = await grosseDemo();
  const keystone: User = { role: 'rh', empId: null, nom: 'Keystone', intitule: 'Intégration' };
  for (const u of [keystone, RH, { ...RH, profilRh: 'paie' as const }]) {
    const [jeu, ref] = await db.lecture(async () => [await jeuEnLecture(db, u, todayIso(), lire(db)), await loadFull(db, u)]);
    assert.equal(ecart(ref, jeu), null, `jeu en lecture : ${u.nom} ${u.profilRh ?? ''}`);
  }
  // Hors d'une lecture stable : lecture directe.
  let directes = 0;
  await jeuEnLecture(db, keystone, todayIso(), async x => { directes++; return await loadFull(db, x); });
  assert.equal(directes, 1);
  // Tâches du quart d'heure : la première lecture, dans sa transaction, reprend la lecture partagée du cache.
  await db.lecture(async () => await buildSnapshot(db, RH));
  const partagee = lecturePartagee(db);
  const [jeu, ref] = await db.tx(async () => [await partagee(RH), await loadFull(db, RH)]);
  assert.equal(ecart(ref, jeu), null, 'tâches : égal à loadFull');
  assert.equal(partagee.faites(), 1);
});
