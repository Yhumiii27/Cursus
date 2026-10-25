// Lecture brute et assemblage de l'instantané complet (lot 9, chantier 2, étape 1 ; server/src/lecture-brute.ts) :
// - registre des dépendances : un espion sur `db.query` pendant `loadFull` montre que les tables réellement lues sont
//   exactement l'union de `LECTURES` (sans les résumés de la paie pour un profil qui ne la voit pas), et que chaque table
//   de TABLES est lue, hors de l'instantané (`HORS_INSTANTANE`) ou sans révision (`TABLES_SANS_REVISION`) ;
// - `LECTURES` décrit chaque champ de l'instantané complet, et rien d'autre ;
// - `assembler` est pur : il ne modifie pas la lecture brute (gelée), rend le même Dataset que `loadFull`, et reprend
//   par identité les dérivés dont aucune entrée n'a changé ;
// - jointure des employés et de leurs titres : la même que le filtre par salarié d'avant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { snake, TABLES, TABLES_SANS_REVISION } = await import('../server/src/db.ts');
const { assembler, HORS_INSTANTANE, LECTURES, lireBrut, TABLES_LUES } = await import('../server/src/lecture-brute.ts');
const { geler } = await import('../server/src/cache-instantane.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Parameters<typeof loadFull>[1];
type TableName = keyof typeof TABLES;

const RH_ADMIN: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const HSE: User = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Référent HSE', profilRh: 'referent_hse' };
const PAIE: User = { role: 'rh', empId: null, nom: 'Paie', intitule: 'Gestionnaire de paie', profilRh: 'paie' };

/** Base de démonstration, plus un relevé d'intérim dont l'e-mail est en file : le statut des envois est lu. */
async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => {
    const e = await db.insert<{ id: number }>('envois', { cible: 'email', type: 'releve', cle: 'essai-lecture-brute', contenu: {}, statut: 'a_envoyer', tentatives: 0, creation: '2026-10-09T08:00:00.000Z' });
    await db.insert('releves', { agence: 'Agence essai', semaine: '2026-10-05', adresse: 'agence@exemple.fr', creation: '2026-10-09T08:00:00.000Z', par: 'RH', envoiId: e.id, interimaires: 1, heures: 35, enAttente: 0 });
  });
  return db;
}

/** Tables désignées par les requêtes passées à `db.query` pendant `fn` (FROM et JOIN). */
async function tablesLues(db: Db, fn: () => Promise<unknown>): Promise<{ tables: Set<TableName>; inconnues: Set<string> }> {
  const parNom = new Map(Object.keys(TABLES).map(t => [snake(t), t as TableName]));
  const sqls: string[] = [];
  const query = db.query.bind(db);
  // Espion posé sur l'instance : `all`, `get`, `one`, `where`, `allSans` et `getSetting` passent tous par `query`.
  db.query = (async (sql: string, params?: readonly unknown[]) => { sqls.push(sql); return await query(sql, params as never); }) as typeof db.query;
  try {
    await fn();
  } finally {
    delete (db as { query?: unknown }).query;
  }
  const tables = new Set<TableName>(), inconnues = new Set<string>();
  for (const sql of sqls) {
    for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)) {
      const t = parNom.get(m[1]);
      if (t) tables.add(t);
      else inconnues.add(m[1]);
    }
  }
  return { tables, inconnues };
}

const trie = (s: Iterable<string>) => [...s].sort();
/** Union des tables de `LECTURES`, sans les champs `sauf`. */
const unionSauf = (sauf: readonly string[]) => new Set(Object.entries(LECTURES).filter(([c]) => !sauf.includes(c)).flatMap(([, t]) => t));

test('registre des dépendances : les tables lues par loadFull sont exactement l’union de LECTURES', async () => {
  const db = await demo();
  // Profils qui voient la paie : les résumés de la paie (absences et déplacements en attente) sont lus.
  for (const u of [RH_ADMIN, PAIE]) {
    const { tables, inconnues } = await tablesLues(db, async () => await loadFull(db, u));
    assert.deepEqual(trie(tables), trie(TABLES_LUES), u.profilRh);
    assert.deepEqual(trie(inconnues), [], 'aucune requête sur une table hors de TABLES');
  }
  // Référent HSE (lecteur de la lecture partagée) : sans les résumés de la paie.
  const { tables } = await tablesLues(db, async () => await loadFull(db, HSE));
  assert.deepEqual(trie(tables), trie(unionSauf(['absencesPaie', 'deplacementsPaie'])));
});

test('chaque table de TABLES est lue par l’instantané, hors de l’instantané ou sans révision', () => {
  for (const t of Object.keys(TABLES) as TableName[]) {
    const ou = [TABLES_LUES.has(t) && 'lue', HORS_INSTANTANE.has(t) && 'hors instantané', TABLES_SANS_REVISION.has(t) && 'sans révision'].filter(Boolean);
    assert.equal(ou.length, 1, `${t} : ${ou.join(', ') || 'ni lue, ni hors instantané, ni sans révision'}`);
  }
  for (const t of [...TABLES_LUES, ...HORS_INSTANTANE]) assert.ok(t in TABLES, `${t} : table inconnue`);
});

test('LECTURES décrit chaque champ de l’instantané complet, et rien d’autre', async () => {
  const db = await demo();
  const ds = await loadFull(db, RH_ADMIN);
  const champs = Object.keys(ds).filter(c => !['today', 'revision', 'user'].includes(c));
  assert.deepEqual(trie(Object.keys(LECTURES)), trie(champs));
  for (const [c, t] of Object.entries(LECTURES)) assert.ok(t.length > 0, `${c} : aucune table`);
});

test('assembler est pur : lecture brute gelée intacte, même Dataset que loadFull, dérivés repris par identité', async () => {
  const db = await demo();
  for (const u of [RH_ADMIN, HSE]) {
    const full = await loadFull(db, u);
    const brut = geler(await db.lecture(async () => await lireBrut(db)));
    const ds = assembler(brut, full.today, full.revision, u);
    const { absencesPaie: _a, deplacementsPaie: _d, ...attendu } = full;
    assert.deepStrictEqual(ds, attendu, u.profilRh);
  }
  const brut = geler(await db.lecture(async () => await lireBrut(db)));
  const a = assembler(brut, '2026-10-10', 1, HSE);
  // Même lecture brute : chaque dérivé est repris tel quel (mêmes objets), seuls les champs de tête changent.
  const b = assembler(brut, '2026-10-10', 2, RH_ADMIN);
  for (const c of Object.keys(LECTURES) as (keyof typeof a)[]) if (c in a) assert.equal(b[c], a[c], c);
  assert.equal(b.revision, 2);
  // Nouvelle lecture des seules feuilles (comme un delta) : les dérivés des autres tables sont repris, ceux des feuilles
  // recalculés.
  const feuilles = brut.feuilles.slice(0, -1);
  const c = assembler({ ...brut, feuilles }, '2026-10-10', 3, HSE);
  assert.equal(c.feuilles, feuilles);
  for (const champ of ['employes', 'annuaire', 'sessions', 'referentiels', 'settings', 'releves', 'pieces', 'plan', 'budgets', 'reprises', 'lotsPaie', 'effectifCse'] as const) {
    assert.equal(c[champ], a[champ], champ);
  }
  // Une certification de moins : employés, annuaire et sessions recalculés, référentiels repris.
  const d = assembler({ ...brut, certifications: brut.certifications.slice(1) }, '2026-10-10', 4, HSE);
  assert.notEqual(d.employes, a.employes);
  assert.notEqual(d.sessions, a.sessions);
  assert.equal(d.referentiels, a.referentiels);
  // Autre jour : l'effectif du site est recalculé, la jointure des employés reprise.
  const e = assembler(brut, '2027-01-04', 5, HSE);
  assert.equal(e.employes, a.employes);
  assert.equal(e.effectifCse, assembler(brut, '2027-01-04', 6, HSE).effectifCse);
});

test('jointure des employés et de leurs titres : la même que le filtre par salarié', async () => {
  const db = await demo();
  const brut = await db.lecture(async () => await lireBrut(db));
  const ds = assembler(brut, '2026-10-10', 1, RH_ADMIN);
  const certs = brut.certifications.filter(c => !c.annuleLe), annulees = brut.certifications.filter(c => c.annuleLe);
  assert.equal(ds.employes.length, brut.employes.length);
  assert.ok(ds.employes.some(e => e.certs.length > 1), 'jeu de démonstration avec plusieurs certifications par salarié');
  for (const e of ds.employes) {
    assert.deepStrictEqual(e.certs, certs.filter(c => c.empId === e.id), `certs de ${e.id}`);
    assert.deepStrictEqual(e.certsAnnulees, annulees.filter(c => c.empId === e.id), `certsAnnulees de ${e.id}`);
    assert.deepStrictEqual(e.habs, brut.habTitres.filter(h => h.empId === e.id), `habs de ${e.id}`);
    assert.deepStrictEqual(e.visas, brut.visas.filter(v => v.empId === e.id), `visas de ${e.id}`);
    assert.deepStrictEqual(e.vaccins, brut.vaccinations.filter(v => v.empId === e.id), `vaccins de ${e.id}`);
  }
  // Statut de l'e-mail du relevé, lu par identifiant d'envoi.
  assert.deepEqual(ds.releves.map(r => r.envoi), ['a_envoyer']);
});
