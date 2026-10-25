// Vues par salarié et corps JSON en cache (lot 9, chantier 3, étape 1 ; server/src/vues-cache.ts) :
// - l'index par salarié rend exactement le filtre d'origine (mêmes lignes, même ordre, tableau neuf), pour un, plusieurs
//   ou aucun salarié, et se reconstruit si un tableau non gelé a changé de longueur ;
// - pour chaque compte et chaque espace de la démonstration, et chaque profil de l'espace RH, la vue calculée avec
//   l'index est strictement égale à celle du parcours complet, sur la lecture propre au compte comme sur la lecture
//   partagée du cache ;
// - le corps JSON d'une vue partagée, tête recollée, est octet pour octet JSON.stringify({ ...vue, ...tete }), calculé
//   une fois par vue, jamais servi sous une autre clé ;
// - corps décompressé de GET /api/data et de la réponse d'une action identique avec et sans cache, pour chaque compte.
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
const { buildSnapshot, corpsInstantane, currentUser, loadFull, vueDe } = await import('../server/src/dataset.ts');
const { cleVue, donneesDe, geler, viderCache, vuePartagee } = await import('../server/src/cache-instantane.ts');
const vc = await import('../server/src/vues-cache.ts');
const { corpsAvecTete, filtreComplet, filtreIndexe, JsonBrut, lignesDe, objetJson, TETE } = vc;
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
      const corps = await db.lecture(async () => await corpsInstantane(db, user));
      const attendu = JSON.stringify(await db.lecture(async () => await buildSnapshot(db, user)));
      assert.equal(corps.json, attendu, `${user.role} ${user.profilRh ?? user.empId} (passage ${passe + 1})`);
      // Hors lecture stable (lecture directe), sérialisé pour la requête : même corps.
      assert.equal((await corpsInstantane(db, user)).json, attendu);
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
  const corps = (await db.lecture(async () => await corpsInstantane(db, mehdi))).json;
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
