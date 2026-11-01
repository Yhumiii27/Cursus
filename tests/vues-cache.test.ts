// Vues par salarié et corps JSON en cache (lot 9, chantier 3, étape 1 ; server/src/vues-cache.ts) :
// - l'index par salarié rend exactement le filtre d'origine (mêmes lignes, même ordre, tableau neuf), pour un, plusieurs
//   ou aucun salarié, et se reconstruit si un tableau non gelé a changé de longueur ;
// - pour chaque compte et chaque espace de la démonstration, et chaque profil de l'espace RH, la vue calculée avec
//   l'index est strictement égale à celle du parcours complet, sur la lecture propre au compte comme sur la lecture
//   partagée du cache ;
// - le corps JSON d'une vue partagée, tête recollée, est octet pour octet JSON.stringify({ ...vue, ...tete }), calculé
//   une fois par vue, jamais servi sous une autre clé ;
// - corps décompressé de GET /api/data et de la réponse d'une action identique avec et sans cache, pour chaque compte.
// Étape 2 (report des vues d'une révision à la suivante) :
// - après une saisie de X, seules `collaborateur|X`, les vues manager dont le périmètre contient X et les vues RH sont
//   recalculées ; les autres sont reportées (même objet, même corps), et chacune égale vueDe(loadFull) ;
// - liste blanche vérifiée par la valeur : un champ de CHAMPS_HORS_VUES remplacé, ou les lignes de CHAMPS_PAR_SALARIE
//   d'un salarié hors du périmètre retenu retirées ou ajoutées, ne changent aucune vue collaborateur ou manager
//   (consultation N+2 et délégation comprises) ;
// - un champ commun changé (fiche), ou CURSUS_VUES_REPORT=0 : aucune vue reportée ;
// - ni un manager N+2 ni un collaborateur ne reçoivent la ligne d'un autre salarié, vue reportée ou recalculée ;
// - suite d'écritures aléatoire (banc d'oracle) : des vues reportées, aucune divergence avec la lecture directe.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
const { buildSnapshot, corpsDe, currentUser, loadFull, partiesInstantane, scopeIds, vueDe } = await import('../server/src/dataset.ts');
const { cleVue, donneesDe, geler, suiteEntree, viderCache, vuePartagee } = await import('../server/src/cache-instantane.ts');
const { Domain } = await import('../shared/domain.ts');
const { TABLES } = await import('../server/src/db.ts');
const { LECTURES } = await import('../server/src/lecture-brute.ts');
const vc = await import('../server/src/vues-cache.ts');
const { CHAMPS_HORS_VUES, CHAMPS_PAR_SALARIE, communsInchanges, corpsAvecTete, filtreComplet, filtreIndexe, JsonBrut, lignesDe, objetJson, perimetreDe, TETE, vueReportable } = vc;
const { compteValide, espacesDuCompte } = await import('../server/src/comptes.ts');
const { creerJeton } = await import('../server/src/agenda.ts');
const { PROFILS_RH } = await import('../shared/constants.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Parameters<typeof buildSnapshot>[1];
type Compte = import('../server/src/comptes.ts').Compte;
type Dataset = import('../shared/types.ts').Dataset;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const serveurs: Server[] = [];
after(() => { for (const s of serveurs) s.close(); });

async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  return db;
}

/** Comptes et espaces de la démonstration, plus tous les profils de l'espace RH (même absents des comptes). */
async function utilisateurs(db: Db): Promise<{ compte: Compte | null; user: User }[]> {
  const users: { compte: Compte | null; user: User }[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    if (!(await compteValide(db, c.id))) continue;
    for (const role of await espacesDuCompte(db, c)) {
      const u = await currentUser(db, { id: 'essai', compteId: c.id, role } as never);
      if (u) users.push({ compte: c, user: u });
    }
  }
  for (const profilRh of Object.keys(PROFILS_RH) as (keyof typeof PROFILS_RH)[]) users.push({ compte: null, user: { ...RH, profilRh } });
  assert.ok(users.some(u => u.user.role === 'manager') && users.some(u => u.user.role === 'collaborateur') && users.filter(u => u.user.role === 'rh').length >= 5);
  return users;
}

/** Générateur pseudo-aléatoire à graine fixe (mulberry32) : tirages reproductibles. */
function hasard(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('index par salarié : exactement le filtre d’origine, ordre gardé, tableau neuf', () => {
  for (const graine of [1, 7, 42, 2027]) {
    const r = hasard(graine);
    const list = geler(Array.from({ length: 500 + Math.floor(r() * 500) }, (_, i) => ({ id: i, empId: 1 + Math.floor(r() * 40) })));
    for (let k = 0; k < 50; k++) {
      const ids = new Set(Array.from({ length: Math.floor(r() * 6) }, () => 1 + Math.floor(r() * 45)));
      const attendu = list.filter(x => ids.has(x.empId));
      const obtenu = lignesDe(list, ids);
      assert.deepEqual(obtenu, attendu, `graine ${graine}, salariés ${[...ids]}`);
      assert.ok(obtenu.every((x, i) => x === attendu[i]), 'mêmes objets');
      assert.ok(!Object.isFrozen(obtenu), 'tableau neuf, modifiable par l’appelant');
    }
  }
  const list = [{ empId: 3, n: 1 }, { empId: 1, n: 2 }, { empId: 3, n: 3 }, { empId: 2, n: 4 }, { empId: 1, n: 5 }];
  assert.deepEqual(lignesDe(list, new Set()), []);
  assert.deepEqual(lignesDe(list, new Set([9])), []);
  assert.deepEqual(lignesDe(list, new Set([3])).map(x => x.n), [1, 3]);
  assert.deepEqual(lignesDe(list, new Set([1, 3])).map(x => x.n), [1, 2, 3, 5], 'fusion par position d’origine');
  // Le groupe d'un salarié n'est jamais rendu lui-même : trier le résultat ne change pas les appels suivants.
  lignesDe(list, new Set([3])).reverse();
  assert.deepEqual(lignesDe(list, new Set([3])).map(x => x.n), [1, 3]);
  // Tableau non gelé modifié (contraire à la règle, mais sans résultat faux) : réindexé.
  list.push({ empId: 3, n: 6 });
  assert.deepEqual(lignesDe(list, new Set([3])).map(x => x.n), [1, 3, 6]);
  // Tableau creux : trous sautés, comme filter.
  const creux: { empId: number; n: number }[] = [{ empId: 1, n: 1 }];
  creux[2] = { empId: 1, n: 3 };
  assert.deepEqual(lignesDe(creux, new Set([1])), creux.filter(x => x.empId === 1));
  assert.deepEqual(filtreComplet(new Set([1, 3]))(list), filtreIndexe(new Set([1, 3]))(list));
});

test('vue indexée strictement égale à la vue du parcours complet : chaque compte, chaque espace, chaque profil RH', async () => {
  const db = await demo();
  const partage = await loadFull(db, { ...RH, profilRh: 'rh_admin' });
  let plusieurs = 0;
  for (const { user } of await utilisateurs(db)) {
    const propre = await loadFull(db, user);
    // Périmètre de plusieurs salariés (manager) : la fusion par position est exercée.
    if (new Set(vueDe(propre, user).feuilles.map(f => f.empId)).size > 1) plusieurs++;
    const nom = `${user.role} ${user.profilRh ?? user.empId}`;
    assert.deepStrictEqual(vueDe(propre, user), vueDe(propre, user, filtreComplet), `${nom} : lecture propre`);
    const tiree = donneesDe(partage, user, 1, null);
    assert.deepStrictEqual(vueDe(tiree, user), vueDe(tiree, user, filtreComplet), `${nom} : lecture partagée`);
    // Les données reçues ne sont pas modifiées (gel sous node --test) : le calcul passe deux fois au même résultat.
    assert.deepStrictEqual(vueDe(tiree, user), vueDe(tiree, user), `${nom} : second calcul`);
  }
  assert.ok(plusieurs > 0, 'au moins une vue manager à plusieurs salariés');
});

test('corps JSON : JSON.stringify({ ...vue, ...tete }) octet pour octet, une fois par vue, jamais sous une autre clé', () => {
  const vue = { a: 1, user: { nom: 'Premier' }, b: [1, 'é', null], vide: undefined, revision: 3, f: () => 1, c: { d: ' "' } };
  const cas: Record<string, unknown>[] = [
    {},
    { user: { nom: 'Second' }, revision: 9 },
    { user: { nom: 'Second' }, revision: 9, agendaJeton: null },
    { revision: 9, user: undefined, conservation: [{ empId: 1 }] },
    { agendaJeton: { creeLe: '2026-10-01' }, conservation: undefined },
  ];
  const avant = vc.corpsCalcules;
  for (const tete of cas) assert.equal(corpsAvecTete(vue, 'collaborateur|2', tete).json, JSON.stringify({ ...vue, ...tete }), JSON.stringify(tete));
  assert.equal(vc.corpsCalcules, avant + 1, 'un seul calcul pour la vue');
  // Vue sans champ de tête, ou faite de champs de tête seulement.
  assert.equal(corpsAvecTete({ x: 1 }, 'rh|paie', { user: 1, revision: 2 }).json, JSON.stringify({ x: 1, user: 1, revision: 2 }));
  assert.equal(corpsAvecTete({ user: 1 }, 'rh|paie', {}).json, '{"user":1}');
  assert.equal(corpsAvecTete({}, 'rh|paie', {}).json, '{}');
  assert.throws(() => corpsAvecTete(vue, 'collaborateur|3', {}), /Corps de la vue collaborateur\|2 demandé pour la clé collaborateur\|3/);
  assert.throws(() => corpsAvecTete(vue, 'collaborateur|2', { employes: [] }), /Champ employes hors de la tête/);
  assert.deepEqual([...TETE], ['user', 'revision', 'conservation', 'agendaJeton']);
  // Objet dont une valeur est déjà sérialisée : comme JSON.stringify de l'objet entier.
  const data = { x: [1, 2], y: 'z' };
  assert.equal(objetJson({ message: null, result: undefined, data: new JsonBrut(JSON.stringify(data)) }).json, JSON.stringify({ message: null, result: undefined, data }));
  assert.equal(objetJson({ message: 'Fait', result: { n: 1 }, data: undefined }).json, JSON.stringify({ message: 'Fait', result: { n: 1 } }));
});

test('instantané : corps de la vue partagée gardé par clé de vue, égal à l’instantané sérialisé', async () => {
  const db = await demo();
  await creerJeton(db, 2, 'Mehdi Benali');
  const users = await utilisateurs(db);
  viderCache(db);
  const avant = vc.corpsCalcules;
  for (let passe = 0; passe < 2; passe++) {
    for (const { user } of users) {
      const corps = corpsDe(await db.lecture(async () => await partiesInstantane(db, user)));
      const attendu = JSON.stringify(await db.lecture(async () => await buildSnapshot(db, user)));
      assert.equal(corps.json, attendu, `${user.role} ${user.profilRh ?? user.empId} (passage ${passe + 1})`);
      // Hors lecture stable (lecture directe), sérialisé pour la requête : même corps.
      assert.equal(corpsDe(await partiesInstantane(db, user)).json, attendu);
    }
  }
  const cles = new Set(users.map(u => cleVue(u.user)));
  assert.equal(vc.corpsCalcules - avant, cles.size, 'un corps par clé de vue, réutilisé au second passage');
  // La vue partagée de chaque clé porte son propre corps : une autre clé le refuse.
  const mehdi = users.find(u => u.user.role === 'collaborateur' && u.user.empId === 2)!.user;
  const vue = (await db.lecture(async () => await vuePartagee(db, mehdi, '2026-10-10', db.revision, async u => await loadFull(db, u), f => vueDe(f, mehdi))))!;
  assert.equal(vue.cle, 'collaborateur|2');
  assert.throws(() => corpsAvecTete(vue.vue, 'collaborateur|3', {}), /demandé pour la clé collaborateur\|3/);
  // Nouvelle révision : nouvelle entrée, nouvelles vues, nouveaux corps.
  await db.update('employes', 2, { nom: 'Mehdi B.' });
  const n = vc.corpsCalcules;
  const corps = corpsDe(await db.lecture(async () => await partiesInstantane(db, mehdi))).json;
  assert.equal(vc.corpsCalcules, n + 1);
  assert.match(corps, /"nom":"Mehdi B\."/);
});

/** Révision (horloge de la base, propre à chaque écriture) ramenée à 0 : seul champ qui diffère d'une requête à l'autre. */
const sansRevision = (corps: string) => corps.replace(/"revision":\d+/g, '"revision":0');

test('HTTP : corps décompressé de GET /api/data et de la réponse d’action identique avec et sans cache, pour chaque compte', async () => {
  const db = await demo();
  await creerJeton(db, 2, 'Mehdi Benali');
  const app = createApp(db, { production: false, journalRequetes: false, compression: true });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const sessions: { user: User; cookie: string; espace: string }[] = [];
  for (const { compte, user } of await utilisateurs(db)) {
    if (!compte) continue;
    const id = randomBytes(32).toString('base64url');
    await db.insert('connexions', { id: empreinteSession(id), compteId: compte.id, role: user.role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: new Date().toISOString() });
    sessions.push({ user, cookie: `cursus_session=${id}.${await sign(db, id)}`, espace: user.role });
  }
  assert.ok(sessions.length >= 5);
  const lire = async (s: (typeof sessions)[number]) => {
    const r = await fetch(`${base}/api/data`, { headers: { cookie: s.cookie, 'x-cursus-espace': s.espace, 'accept-encoding': 'br' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-encoding'), 'br', 'réponse compressée');
    assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
    return await r.text();
  };
  const sansCache = async <T>(f: () => Promise<T>) => {
    process.env.CURSUS_CACHE_INSTANTANE = '0';
    try { return await f(); } finally { delete process.env.CURSUS_CACHE_INSTANTANE; }
  };
  for (const s of sessions) {
    const nom = `${s.user.role} ${s.user.profilRh ?? s.user.empId}`;
    const enCache = await lire(s);
    const encore = await lire(s);
    const direct = await sansCache(async () => await lire(s));
    assert.equal(sansRevision(encore), sansRevision(enCache), `${nom} : corps servi deux fois`);
    assert.equal(sansRevision(enCache), sansRevision(direct), `${nom} : avec et sans cache`);
    const ds = JSON.parse(enCache) as Dataset;
    assert.equal(ds.user.empId, s.user.empId);
    if (s.user.role !== 'rh') assert.ok('agendaJeton' in ds, 'tête recollée');
  }
  // Réponse d'une action : même action deux fois (même état après chacune), avec puis sans cache.
  const action = async (s: (typeof sessions)[number], nom: string, p: unknown) => {
    const r = await fetch(`${base}/api/actions/${nom}`, { method: 'POST', headers: { cookie: s.cookie, 'x-cursus-espace': s.espace, 'content-type': 'application/json', 'accept-encoding': 'br' }, body: JSON.stringify(p) });
    const texte = await r.text();
    assert.equal(r.status, 200, texte.slice(0, 200));
    assert.equal(r.headers.get('content-encoding'), 'br');
    return texte;
  };
  const rh = sessions.find(s => s.user.role === 'rh' && s.user.profilRh === 'rh_admin')!;
  // Saisie d'une cellule de sa feuille en brouillon, à sa valeur actuelle (collaborateur qui en a une).
  const brouillons = (await loadFull(db, RH)).feuilles.filter(f => f.statut === 'brouillon' && f.lignes.length);
  const collab = sessions.find(s => s.user.role === 'collaborateur' && brouillons.some(f => f.empId === s.user.empId))!;
  assert.ok(collab, 'un collaborateur avec une feuille en brouillon');
  const feuille = brouillons.find(f => f.empId === collab.user.empId)!;
  const cellule = { empId: feuille.empId, week: feuille.week, li: 0, di: 0, value: String(feuille.lignes[0].h[0] ?? '') };
  for (const [s, nom, p] of [[rh, 'parametres.maj', { relancesActives: true }], [collab, 'temps.setCell', cellule]] as const) {
    const enCache = await action(s, nom, p);
    const direct = await sansCache(async () => await action(s, nom, p));
    assert.equal(sansRevision(enCache), sansRevision(direct), `${nom} : avec et sans cache`);
    const r = JSON.parse(enCache) as { message: string | null; data: Dataset };
    assert.ok('message' in r && r.data.user, 'message et instantané');
    assert.equal(sansRevision(JSON.stringify(r)), sansRevision(enCache), 'mêmes octets que res.json');
  }
});

test('HTTP : instantané sérialisé après la lecture stable (ni file des écritures ni transaction tenues), avec et sans cache', async () => {
  const db = await demo();
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const compte = (await db.all<Compte>('comptes')).find(c => c.profilRh === 'rh_admin' && c.actif)!;
  const id = randomBytes(32).toString('base64url');
  await db.insert('connexions', { id: empreinteSession(id), compteId: compte.id, role: 'rh', methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: new Date().toISOString() });
  const headers = { cookie: `cursus_session=${id}.${await sign(db, id)}`, 'x-cursus-espace': 'rh', 'content-type': 'application/json' };
  // Octets produits par JSON.stringify pendant une lecture stable (contexte asynchrone de la requête : `lectureStable`).
  const stringify = JSON.stringify;
  let enLecture = 0;
  JSON.stringify = ((...a: Parameters<typeof stringify>) => {
    const s = stringify(...a);
    if (db.lectureStable && typeof s === 'string') enLecture += s.length;
    return s;
  }) as typeof stringify;
  try {
    for (const cache of [true, false]) {
      if (!cache) process.env.CURSUS_CACHE_INSTANTANE = '0';
      try {
        viderCache(db);
        for (const [chemin, init] of [['/api/data', { headers }], ['/api/actions/parametres.maj', { method: 'POST', headers, body: stringify({ relancesActives: true }) }]] as const) {
          enLecture = 0;
          const r = await fetch(base + chemin, init);
          const texte = await r.text();
          assert.equal(r.status, 200, texte.slice(0, 200));
          assert.ok(texte.length > 100_000, 'instantané RH complet');
          // Seuls de petits morceaux (lectures, session) passent par JSON.stringify dans la lecture, jamais le corps.
          assert.ok(enLecture < texte.length / 20, `${chemin}, cache ${cache} : ${enLecture} octets sérialisés dans la lecture pour ${texte.length}`);
        }
      } finally { delete process.env.CURSUS_CACHE_INSTANTANE; }
    }
  } finally { JSON.stringify = stringify; }
});

// ——— Étape 2 : report des vues ———

const TODAY = '2026-10-10';
/** Vue partagée de `user` (lecture stable, cache), telle que le cache la garde. */
const partagee = async (db: Db, user: User) => (await db.lecture(async () => await vuePartagee(db, user, TODAY, db.revision, async u => await loadFull(db, u), f => vueDe(f, user))))!;
/** Vues partagées de tous les lecteurs, par clé de vue. */
async function vuesDe(db: Db, users: User[]): Promise<Map<string, Dataset>> {
  const out = new Map<string, Dataset>();
  for (const u of users) out.set(cleVue(u), (await partagee(db, u)).vue);
  return out;
}
/** Vue comparable : tête de la requête neutre (utilisateur et révision, recollés à chaque envoi). */
const sansTete = (v: Dataset, user: User) => ({ ...v, user, revision: 0 });
/** Salariés que lit la vue de `user` sur l'état actuel de la base, calculés à part : périmètre et membres des équipes encadrées. */
async function lusPar(db: Db, user: User): Promise<Set<number>> {
  const d = new Domain(await loadFull(db, { ...RH, profilRh: 'rh_admin' }));
  const equipes = user.role === 'manager' ? d.teamsOf(user.empId) : [];
  return new Set([...scopeIds(d, user), ...d.ds.employes.filter(e => !!e.equipe && equipes.includes(e.equipe)).map(e => e.id)]);
}

test('liste blanche : champs par salarié tirés de tables à colonne empId, aucun champ à la fois par salarié et hors des vues', () => {
  for (const champ of CHAMPS_PAR_SALARIE) {
    const tables = (LECTURES as Record<string, readonly string[]>)[champ];
    assert.ok(tables?.length, `${champ} : tables lues connues`);
    for (const t of tables) assert.ok('empId' in (TABLES as Record<string, { cols: Record<string, string> }>)[t].cols, `${champ} : table ${t} sans colonne empId`);
    assert.ok(!CHAMPS_HORS_VUES.has(champ));
  }
  for (const commun of ['employes', 'annuaire', 'referentiels', 'sessions', 'settings', 'delegations', 'mandats', 'pieces', 'attentesSession', 'today', 'effectifCse', 'debutSaisieFeuilles'] as const) {
    assert.ok(!CHAMPS_PAR_SALARIE.has(commun) && !CHAMPS_HORS_VUES.has(commun), `${commun} : champ commun`);
  }
  // Règle pure : vue RH jamais reportée ; salarié touché dans le périmètre ; champs communs changés.
  const ids = new Set([2, 3]);
  assert.equal(vueReportable('collaborateur|4', new Set([4]), true, new Set([2])), true);
  assert.equal(vueReportable('manager|3', ids, true, new Set([2])), false);
  assert.equal(vueReportable('manager|3', ids, true, new Set()), true);
  assert.equal(vueReportable('manager|3', ids, false, new Set()), false);
  assert.equal(vueReportable('rh|rh_admin', ids, true, new Set()), false);
  assert.equal(vueReportable('collaborateur|4', undefined, true, new Set()), false, 'périmètre inconnu');
  const avant = { today: TODAY, debutSaisieFeuilles: '2026-01-05', feuilles: [], employes: [] } as unknown as Dataset;
  const memeDebut = { ...avant, feuilles: [] } as Dataset;
  assert.equal(communsInchanges({ champsChanges: new Set(['feuilles', 'debutSaisieFeuilles', 'absencesPaie']), touches: new Set([2]) }, avant, memeDebut), true, 'date de début inchangée');
  assert.equal(communsInchanges({ champsChanges: new Set(['feuilles', 'debutSaisieFeuilles']), touches: new Set([2]) }, avant, { ...memeDebut, debutSaisieFeuilles: '2025-12-29' } as Dataset), false);
  assert.equal(communsInchanges({ champsChanges: new Set(['employes']), touches: new Set([2]) }, avant, { ...avant, employes: [] } as unknown as Dataset), false);
  assert.equal(communsInchanges({ champsChanges: new Set(), touches: new Set() }, avant, { ...avant, today: '2026-10-11' } as Dataset), false);
});

/**
 * Valeur de remplacement non vide et différente de `v`, pour un champ que la vue ne doit pas lire : tableau vidé ou
 * doublé (lignes recopiées sous un autre salarié et un autre identifiant), objet complété d'une clé, null remplacé.
 */
function variantes(v: unknown, autre: number): unknown[] {
  const copie = (x: unknown, k: number) => (x && typeof x === 'object'
    ? { ...x, ...('empId' in x ? { empId: autre } : {}), ...(typeof (x as { id?: unknown }).id === 'number' ? { id: 900_000 + k } : {}) }
    : x);
  if (Array.isArray(v)) return v.length ? [[], [...v, ...v.map(copie)]] : [[{ id: 900_000, empId: autre }]];
  if (v && typeof v === 'object') {
    const un = Object.values(v)[0];
    return [{}, { ...v, essai: un && typeof un === 'object' ? { ...un } : { id: 900_000, empId: autre } }];
  }
  return [{ id: 900_000, empId: autre }];
}

test('liste blanche, par la valeur : un champ hors des vues ou une ligne d’un salarié hors du périmètre ne change aucune vue collaborateur ou manager', async () => {
  const db = await demo();
  // Configurations : démonstration seule, puis consultation N+2 (Maintenance rattachée à la Production) et délégation
  // active (Karim Haddad à Sophie Lemaire), qui élargissent les périmètres lus.
  const configurations: (() => Promise<unknown>)[] = [
    async () => {},
    async () => {
      await db.run(`UPDATE equipes SET parente = 'Production' WHERE nom = 'Maintenance'`);
      await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), consultationN2: true });
      await db.insert('delegations', { managerId: 12, suppleantId: 3, du: '2026-10-05', au: '2026-10-20', perimetre: ['absences'], creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad' });
    },
  ];
  let essais = 0, lignesAjoutees = 0;
  for (const configurer of configurations) {
    await configurer();
    const partage = await loadFull(db, RH);
    const users = (await utilisateurs(db)).map(u => u.user).filter(u => u.role !== 'rh');
    for (const u of users) {
      const full = donneesDe(partage, u, 1, null);
      const vue = vueDe(full, u);
      const ids = perimetreDe(vue)!;
      assert.ok(ids, `${cleVue(u)} : périmètre retenu`);
      const dehors = full.employes.map(e => e.id).filter(id => !ids.has(id));
      assert.ok(dehors.length, `${cleVue(u)} : salariés hors du périmètre`);
      const meme = (modifie: Dataset, quoi: string) => {
        essais++;
        assert.deepStrictEqual(vueDe(modifie, u), vue, `${cleVue(u)} : ${quoi}`);
      };
      // Champs hors des vues : toute autre valeur, la vue ne change pas.
      for (const champ of CHAMPS_HORS_VUES) {
        for (const autre of variantes(full[champ], dehors[0])) meme({ ...full, [champ]: autre } as Dataset, `${champ} remplacé`);
      }
      // Lignes par salarié : celles des salariés hors du périmètre retirées, ou recopiées sous un salarié hors du périmètre.
      for (const champ of CHAMPS_PAR_SALARIE) {
        const lignes = (full[champ] ?? []) as unknown as { empId: number; id?: unknown }[];
        meme({ ...full, [champ]: lignes.filter(l => ids.has(l.empId)) } as Dataset, `${champ} sans les lignes hors du périmètre`);
        for (const [k, autre] of dehors.slice(0, 3).entries()) {
          const ajout = lignes.slice(0, 5).map((l, i) => ({ ...l, empId: autre, ...(typeof l.id === 'number' ? { id: 900_000 + 10 * k + i } : {}) }));
          lignesAjoutees += ajout.length;
          meme({ ...full, [champ]: [...lignes, ...ajout] } as Dataset, `${champ} avec des lignes du salarié ${autre}`);
        }
      }
    }
  }
  assert.ok(essais > 1000 && lignesAjoutees > 1000, `${essais} vues comparées, ${lignesAjoutees} lignes ajoutées`);
});

test('report : après une saisie de X, seules collaborateur|X et les vues manager qui lisent X sont recalculées, chaque vue reportée égale vueDe(loadFull)', async () => {
  const db = await demo();
  const users = (await utilisateurs(db)).map(u => u.user);
  viderCache(db);
  const avant = await vuesDe(db, users);
  // Corps des vues servis une fois : une vue reportée garde le sien.
  for (const u of users) corpsAvecTete(avant.get(cleVue(u))!, cleVue(u), {});
  // Saisie d'une cellule de la feuille en brouillon d'un collaborateur (X).
  const full = await loadFull(db, RH);
  const brouillons = full.feuilles.filter(f => f.statut === 'brouillon' && f.lignes.length);
  const x = users.find(u => u.role === 'collaborateur' && brouillons.some(f => f.empId === u.empId))!.empId!;
  const f = brouillons.find(b => b.empId === x)!;
  await db.update('feuilles', f.id, { lignes: f.lignes.map((l, i) => (i === 0 ? { ...l, h: l.h.map((v, j) => (j === 0 ? Number(v || 0) + 1 : v)) } : l)) });
  const reportees0 = vc.vuesReportees, corps0 = vc.corpsCalcules;
  const apres = await vuesDe(db, users);
  const suite = (await suiteEntree(db))!;
  assert.ok(suite, 'entrée dérivée par le delta');
  assert.deepEqual([...suite.touches], [x], 'seul X est touché');
  assert.ok(suite.champsChanges.has('feuilles'));
  let reportees = 0, managersRecalcules = 0, managersReportes = 0;
  for (const u of users) {
    const cle = cleVue(u), v = apres.get(cle)!, reportee = v === avant.get(cle);
    const recalculer = u.role === 'rh' || (u.role === 'collaborateur' && u.empId === x) || (u.role === 'manager' && (await lusPar(db, u)).has(x));
    assert.equal(reportee, !recalculer, `${cle} : ${recalculer ? 'à recalculer' : 'à reporter'}`);
    if (u.role === 'manager') { if (reportee) managersReportes++; else managersRecalcules++; }
    if (!reportee) continue;
    reportees++;
    assert.deepEqual(perimetreDe(v), await lusPar(db, u), `${cle} : périmètre retenu`);
    assert.deepStrictEqual(sansTete(v, u), sansTete(vueDe(await loadFull(db, u), u), u), `${cle} : vue reportée égale à la vue relue`);
  }
  assert.ok(managersRecalcules > 0 && managersReportes > 0, `managers recalculés ${managersRecalcules}, reportés ${managersReportes}`);
  assert.equal(vc.vuesReportees - reportees0, reportees, 'vues reportées comptées');
  assert.ok(reportees >= 3, `${reportees} vues reportées`);
  // Une vue recalculée égale aussi la vue relue ; la vue de X porte la saisie.
  const vx = apres.get(`collaborateur|${x}`)!;
  assert.deepStrictEqual(vx.feuilles.find(y => y.id === f.id)!.lignes[0].h[0], Number(f.lignes[0].h[0] || 0) + 1);
  // Corps : seules les vues recalculées en reçoivent un nouveau, une vue reportée garde le sien sous sa seule clé.
  for (const u of users) corpsAvecTete(apres.get(cleVue(u))!, cleVue(u), {});
  assert.equal(vc.corpsCalcules - corps0, new Set(users.map(cleVue)).size - reportees);
  const autre = users.find(u => u.role === 'collaborateur' && u.empId !== x && apres.get(cleVue(u)) === avant.get(cleVue(u)))!;
  assert.throws(() => corpsAvecTete(apres.get(cleVue(autre))!, `collaborateur|${x}`, {}), /demandé pour la clé/);
  // Corps HTTP de chaque compte inchangé : instantané servi égal à l'instantané sérialisé directement.
  for (const u of users) {
    assert.equal(corpsDe(await db.lecture(async () => await partiesInstantane(db, u))).json, JSON.stringify(await db.lecture(async () => await buildSnapshot(db, u))), `${cleVue(u)} : corps`);
  }
});

test('report : un champ commun changé, ou CURSUS_VUES_REPORT=0, et toutes les vues sont recalculées', async () => {
  const db = await demo();
  const users = (await utilisateurs(db)).map(u => u.user);
  viderCache(db);
  let avant = await vuesDe(db, users);
  // Fiche d'un salarié changée (champ commun : annuaire, fiches) : aucune vue reportée.
  await db.update('employes', 2, { poste: 'Opérateur polyvalent' });
  let apres = await vuesDe(db, users);
  assert.ok((await suiteEntree(db))!.champsChanges.has('employes'));
  for (const [cle, v] of apres) assert.notEqual(v, avant.get(cle), `${cle} : recalculée`);
  // Report coupé : même une saisie sans rapport avec la vue la fait recalculer.
  avant = apres;
  process.env.CURSUS_VUES_REPORT = '0';
  try {
    const f = (await loadFull(db, RH)).feuilles.find(y => y.statut === 'brouillon')!;
    await db.update('feuilles', f.id, { comment: 'Report coupé' });
    apres = await vuesDe(db, users);
    assert.deepEqual([...(await suiteEntree(db))!.touches], [f.empId]);
    for (const [cle, v] of apres) assert.notEqual(v, avant.get(cle), `${cle} : recalculée (report coupé)`);
  } finally { delete process.env.CURSUS_VUES_REPORT; }
  // Écriture hors de l'instantané (aucun champ changé) : toutes les vues collaborateur et manager reportées.
  avant = apres;
  await db.insert('notifications', { empId: 2, adresse: 'mehdi@example.test', type: 'essai', objet: 'Essai', texte: 'Essai', creation: new Date().toISOString(), envoiId: null });
  apres = await vuesDe(db, users);
  assert.equal((await suiteEntree(db))!.champsChanges.size, 0, 'aucun champ de l’instantané changé');
  for (const u of users) assert.equal(apres.get(cleVue(u)) === avant.get(cleVue(u)), u.role !== 'rh', `${cleVue(u)} : ${u.role === 'rh' ? 'vue RH recalculée' : 'reportée'}`);
});

test('non-fuite : ni un manager N+2 ni un collaborateur ne reçoivent la ligne d’un autre salarié, vue reportée ou recalculée', async () => {
  const db = await demo();
  // Consultation N+2 : Sophie Lemaire (Production) consulte la Maintenance de Karim Haddad, rattachée à son équipe.
  await db.run(`UPDATE equipes SET parente = 'Production' WHERE nom = 'Maintenance'`);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), consultationN2: true });
  const users = (await utilisateurs(db)).map(u => u.user);
  const sophie = users.find(u => u.role === 'manager' && u.empId === 3)!;
  assert.ok(sophie, 'Sophie Lemaire, manager');
  viderCache(db);
  let avant = await vuesDe(db, users);
  assert.ok(avant.get('manager|3')!.lectureSeule!.includes(2), 'Mehdi Benali en consultation N+2');
  const brut = await loadFull(db, RH);
  const feuilleDe = (empId: number) => brut.feuilles.find(f => f.empId === empId && f.statut === 'brouillon') ?? brut.feuilles.find(f => f.empId === empId)!;
  // Écritures sur plusieurs salariés : feuille et entretien du membre N+2, absence d'un autre, demande au service RH.
  const ecritures: (() => Promise<unknown>)[] = [
    async () => await db.update('feuilles', feuilleDe(2).id, { comment: 'Membre N+2' }),
    async () => await db.insert('entretiens', { empId: 2, type: 'annuel', date: '2026-11-20', statut: 'planifie', cr: { bilan: 'Texte du valideur' }, info: false, signSal: null, signMgr: null }),
    async () => await db.insert('absences', { empId: 12, type: 'CP', du: '2026-12-14', au: '2026-12-15', statut: 'demandee', keystone: false, justificatif: false }),
    async () => await db.update('feuilles', feuilleDe(12).id, { comment: 'Manager de la Maintenance' }),
    async () => await db.insert('cet', { empId: 2, type: 'RTT', jours: 1, date: TODAY, periode: '2026' }),
  ];
  let reportees = 0;
  for (const ecrire of ecritures) {
    await ecrire();
    const apres = await vuesDe(db, users);
    const d = new Domain(await loadFull(db, RH));
    for (const u of users) {
      if (u.role === 'rh') continue;
      const cle = cleVue(u), v = apres.get(cle)!;
      if (v === avant.get(cle)) reportees++;
      // Lignes par salarié : les siennes (collaborateur), celles de son périmètre (manager), jamais d'un autre.
      const permis = u.role === 'collaborateur' ? new Set([u.empId!]) : new Set(scopeIds(d, u));
      for (const champ of CHAMPS_PAR_SALARIE) {
        for (const l of ((v as unknown as Record<string, { empId: number }[] | undefined>)[champ] ?? [])) assert.ok(permis.has(l.empId), `${cle} : ligne de ${l.empId} dans ${champ}`);
      }
      assert.ok(v.employes.every(e => permis.has(e.id)), `${cle} : fiches du périmètre seulement`);
      // Consultation N+2 : ni entretiens, ni demandes au service RH, ni avenants, ni avis de manager des membres consultés.
      for (const id of v.lectureSeule ?? []) {
        for (const champ of ['entretiens', 'demandesCollab', 'avenantsForfait', 'evaluationsFormation'] as const) {
          assert.ok(!(v[champ] as { empId: number }[]).some(l => l.empId === id), `${cle} : ${champ} du membre consulté ${id}`);
        }
      }
      assert.deepStrictEqual(sansTete(v, u), sansTete(vueDe(await loadFull(db, u), u), u), `${cle} : vue égale à la vue relue`);
    }
    avant = apres;
  }
  assert.ok(reportees > 0, 'des vues reportées pendant la suite');
  // La vue de Sophie Lemaire, qui lit Mehdi Benali en consultation, est recalculée à chacune de ses écritures.
  const v1 = avant.get('manager|3')!;
  await db.update('feuilles', feuilleDe(2).id, { comment: 'Encore' });
  assert.notEqual((await vuesDe(db, [sophie])).get('manager|3'), v1);
  assert.ok(perimetreDe(v1)!.has(2));
});

test('oracle : suite d’écritures aléatoire, vues reportées, aucune divergence avec la lecture directe', async () => {
  const { baseDemo, rejouer, resumeRapport } = await import('./support/oracle.ts');
  const db = await baseDemo(nouvelleBase);
  const avant = vc.vuesReportees;
  // Graine 13 (lot 12 — C3) : avec les actions des objectifs, la graine 9 ne tirait plus aucune écriture validée en 12 pas.
  const rapport = await rejouer(db, { graine: 13, pas: 12 });
  assert.equal(rapport.erreurs.length, 0, rapport.erreurs.join('\n'));
  assert.equal(rapport.divergences.length, 0, resumeRapport(rapport));
  assert.ok(rapport.ecritures > 3, `${rapport.ecritures} écritures`);
  assert.ok(vc.vuesReportees > avant, `${vc.vuesReportees - avant} vues reportées`);
});
