// Journal des changements en base (lot 9, chantier 1, étape 1 : table `changements`, migration PostgreSQL
// 0014_changements, déclencheurs `revision2_*` de SqliteDb.poserRevision) et primitives du contrat de la relecture
// partielle (`Db.etatRevision`, `Db.lireChangements`, `Db.lireLignes`), sur les deux moteurs :
// - toute écriture validée (méthodes génériques, transaction, SQL direct, upsert ON CONFLICT) inscrit les clés des lignes
//   changées à la révision qu'elle produit : la dernière révision du journal est celle de la base ;
// - une transaction annulée n'inscrit rien et laisse la révision inchangée ;
// - TRUNCATE (PostgreSQL), la remise à zéro et une instruction de plus de 1 000 lignes donnent « toute la table » ;
// - un écart inconnu (purge, époque, écart à rebours) rend null : l'appelant relit tout ;
// - appliquer le delta à une copie des tables redonne la relecture complète, y compris entre deux instances (deux PgDb
//   sur le même schéma, et une écriture faite hors de Cursus) ;
// - le décodeur préparé par table rend les mêmes objets que l'ancien décodage colonne par colonne ;
// - les tables fermées en entier à Matrix ne sont inscrites que par le marqueur « toute la table », et le journal
//   lui-même est demandé fermé à Matrix ; une table renommée inscrit son nouveau nom (PostgreSQL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { PG, nouvelleBase, sqlite, SQLITE_SEUL } = await import('./base.ts');
const { PAQUET_LIGNES, SEUIL_CHANGEMENTS, snake, TABLES, TABLES_CHANGEMENTS_SANS_CLE, TABLES_SANS_REVISION } = await import('../server/src/db.ts');
const { demandeMatrix, lire, socleCursus } = await import('./colonnes-sensibles.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
type Db = import('../server/src/db.ts').Db;
type TableName = import('../server/src/db.ts').TableName;
type Changements = import('../server/src/db.ts').Changements;
type Pg = import('../server/src/db-pg.ts').PgDb;
type Ligne = Record<string, unknown>;

const SEUL_PG = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
const TABLES_SUIVIES = (Object.keys(TABLES) as TableName[]).filter(t => !TABLES_SANS_REVISION.has(t));

/** Dernière révision inscrite au journal des changements. */
const dernierChangement = async (db: Db) => Number((await db.one<{ n: number | null }>('SELECT MAX(n) AS n FROM changements'))?.n ?? 0);
/** Changements en clair (tables triées, clés triées), pour les comparer. */
const enClair = (c: Changements | null) => c && Object.fromEntries([...c].sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => [t, v === 'tout' ? v : [...v].sort()]));

/**
 * Écriture `fn`, puis contrôles : révision augmentée, dernière révision du journal égale à celle de la base, et lignes
 * changées entre les deux révisions égales à `attendu`.
 */
async function ecrire(db: Db, fn: () => Promise<unknown>, attendu: Record<string, string[] | 'tout'>, quoi: string): Promise<void> {
  const avant = await db.revisionBase();
  await fn();
  const apres = await db.revisionBase();
  assert.ok(apres > avant, `${quoi} : révision augmentée`);
  assert.equal(await dernierChangement(db), apres, `${quoi} : n(changements) = n(revision)`);
  assert.deepEqual(enClair(await db.lireChangements(avant, apres)), attendu, quoi);
}

/** Copie de toutes les tables suivies, lues en entier. */
async function copie(db: Db): Promise<Map<TableName, Ligne[]>> {
  const out = new Map<TableName, Ligne[]>();
  for (const t of TABLES_SUIVIES) out.set(t, await db.all<Ligne>(t));
  return out;
}

/**
 * Delta appliqué à une copie (nouveaux tableaux, l'ancienne copie reste intacte) : table relue en entier pour `'tout'`,
 * sinon lignes relues par clé (`lireLignes`), remplacées ou retirées.
 */
async function appliquer(db: Db, base: Map<TableName, Ligne[]>, delta: Changements): Promise<Map<TableName, Ligne[]>> {
  const out = new Map(base);
  for (const [t, cles] of delta) {
    if (cles === 'tout') { out.set(t, await db.all<Ligne>(t)); continue; }
    const pk = TABLES[t].pk;
    const relues = new Map((await db.lireLignes<Ligne>(t, cles)).map(l => [String(l[pk]), l]));
    const lignes = (base.get(t) ?? []).filter(l => !cles.has(String(l[pk])));
    lignes.push(...relues.values());
    const entiere = TABLES[t].cols[pk as keyof (typeof TABLES)[typeof t]['cols']] === 'int';
    lignes.sort((a, b) => (entiere ? Number(a[pk]) - Number(b[pk]) : String(a[pk]) < String(b[pk]) ? -1 : 1));
    out.set(t, lignes);
  }
  return out;
}

/** La copie mise à jour par le delta égale la relecture complète, table par table (ordre de la clé). */
async function egaleRelecture(db: Db, obtenue: Map<TableName, Ligne[]>, quoi: string): Promise<void> {
  for (const t of TABLES_SUIVIES) {
    const pk = TABLES[t].pk;
    const tri = (l: Ligne[]) => [...l].sort((a, b) => (String(a[pk]) < String(b[pk]) ? -1 : String(a[pk]) > String(b[pk]) ? 1 : 0));
    assert.deepEqual(tri(obtenue.get(t)!), tri(await db.all<Ligne>(t)), `${quoi} : ${t}`);
  }
}

test('chaque écriture validée inscrit ses lignes à sa révision : méthodes, transaction, SQL direct, clé changée', async () => {
  const db = await nouvelleBase();
  const etat = await db.etatRevision();
  assert.ok(etat.epoque > 0, 'époque posée à la création');
  assert.equal(etat.purge, 0);
  const p1 = await db.insert<{ id: number }>('postes', { nom: 'Opérateur' });
  const p2 = await db.insert<{ id: number }>('postes', { nom: 'Technicien' });
  await ecrire(db, async () => await db.insert('postes', { nom: 'Chef d’équipe' }), { postes: [String(p2.id + 1)] }, 'insertion');
  await ecrire(db, async () => await db.update('postes', p1.id, { nom: 'Opérateur confirmé' }), { postes: [String(p1.id)] }, 'modification');
  await ecrire(db, async () => await db.remove('postes', p2.id), { postes: [String(p2.id)] }, 'suppression');
  await ecrire(db, async () => await db.setSetting('essai', { a: 1 }), { settings: ['essai'] }, 'réglage');
  await ecrire(db, async () => await db.tx(async () => {
    await db.insert('projets', { code: 'P1', nom: 'Projet 1', statut: 'actif' });
    await db.update('postes', p1.id, { sir: true });
  }), { postes: [String(p1.id)], projets: ['P1'] }, 'transaction de deux écritures');
  await ecrire(db, async () => await db.run('UPDATE postes SET nom = ? WHERE id = ?', ['Reprise', p1.id]), { postes: [String(p1.id)] }, 'SQL direct');
  await ecrire(db, async () => await db.run('UPDATE projets SET code = ? WHERE code = ?', ['P2', 'P1']), { projets: ['P1', 'P2'] }, 'clé changée : ancienne et nouvelle');
  // Écriture des tables exclues de la révision (journal, sessions, comptes, agenda) : rien n'est inscrit.
  const n = await db.revisionBase(), total = await db.count('postes');
  await db.insert('journal', { at: new Date().toISOString(), actor: 'Cursus', action: 'essai', message: null, payload: {}, salaries: [] });
  assert.equal(await db.revisionBase(), n);
  assert.equal(await dernierChangement(db), n);
  assert.deepEqual(enClair(await db.lireChangements(n, n)), {}, 'écart nul : rien');
  assert.equal(total, 2);
});

test('une transaction annulée n’inscrit rien et laisse la révision inchangée', async () => {
  const db = await nouvelleBase();
  await db.insert('postes', { nom: 'Opérateur' });
  const n = await db.revisionBase(), lignes = await db.count('postes');
  const avant = (await db.query('SELECT COUNT(*) AS c FROM changements'))[0];
  await assert.rejects(db.tx(async () => {
    await db.insert('postes', { nom: 'Annulé' });
    await db.run('UPDATE postes SET nom = ?', ['Annulé aussi']);
    throw new Error('annulée');
  }), /annulée/);
  assert.equal(await db.revisionBase(), n);
  assert.deepEqual((await db.query('SELECT COUNT(*) AS c FROM changements'))[0], avant);
  assert.equal(await db.count('postes'), lignes);
  assert.deepEqual(enClair(await db.lireChangements(0, n)), { postes: ['1'] });
});

test('upsert ON CONFLICT : ligne insérée comme ligne remplacée inscrite', async () => {
  const db = await nouvelleBase();
  const upsert = async (nom: string) => await db.run(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif') ON CONFLICT (code) DO UPDATE SET nom = excluded.nom`, ['U1', nom]);
  for (const [nom, quoi] of [['Premier', 'insertion'], ['Second', 'conflit : modification']] as const) {
    const avant = await db.revisionBase();
    await upsert(nom);
    const apres = await db.revisionBase();
    assert.ok(apres > avant, quoi);
    // PostgreSQL : l'instruction augmente la révision une fois par événement (insertion, modification), même vide ; les
    // lignes sont inscrites à la révision de l'événement qui les a écrites, dans l'écart.
    const dernier = await dernierChangement(db);
    assert.ok(dernier > avant && dernier <= apres, `${quoi} : inscrit dans l’écart`);
    assert.deepEqual(enClair(await db.lireChangements(avant, apres)), { projets: ['U1'] }, quoi);
  }
  // Rien à faire (DO NOTHING sur une clé existante) : aucune ligne inscrite.
  const avant = await db.revisionBase();
  await db.run(`INSERT INTO projets (code, nom, statut) VALUES ('U1', 'x', 'actif') ON CONFLICT (code) DO NOTHING`);
  assert.deepEqual(enClair(await db.lireChangements(avant, await db.revisionBase())), {});
  assert.equal((await db.get<{ nom: string }>('projets', 'U1'))!.nom, 'Second');
});

test('SQLite : une ligne remplacée par INSERT OR REPLACE (autre clé, même unicité) est inscrite comme supprimée', { skip: PG && SQLITE_SEUL }, async () => {
  const db = await nouvelleBase();
  const f = await db.insert<{ id: number }>('feuilles', { empId: 1, week: '2026-W40', statut: 'brouillon', lignes: [] });
  const avant = await db.revisionBase();
  await db.run(`INSERT OR REPLACE INTO feuilles (emp_id, week, statut) VALUES (1, '2026-W40', 'soumise')`);
  const nouvelle = (await db.where<{ id: number }>('feuilles', 'empId', 1))[0];
  assert.notEqual(nouvelle.id, f.id);
  assert.deepEqual(enClair(await db.lireChangements(avant, await db.revisionBase())), { feuilles: [String(f.id), String(nouvelle.id)].sort() });
});

test('tables fermées en entier à Matrix : marqueur « toute la table » seul, jamais leurs clés', async () => {
  const db = await nouvelleBase();
  await db.insert('employes', { id: 42, nom: 'Essai' });
  const v = await db.insert<{ id: number }>('vaccinations', { empId: 42, v: 'fj', date: '2026-10-01' });
  await ecrire(db, async () => await db.insert('vaccinations', { empId: 42, v: 'dtp', date: '2026-10-02' }), { vaccinations: 'tout' }, 'insertion');
  await ecrire(db, async () => await db.update('vaccinations', v.id, { date: '2026-10-03' }), { vaccinations: 'tout' }, 'modification');
  await ecrire(db, async () => await db.tx(async () => {
    await db.update('employes', 42, { nom: 'Essai bis' });
    await db.insert('demandesVisite', { empId: 42, motif: 'reprise', le: '2026-10-05', statut: 'demandee' });
  }), { demandesVisite: 'tout', employes: ['42'] }, 'transaction : la fiche par sa clé, la visite sans clé');
  await ecrire(db, async () => await db.remove('vaccinations', v.id), { vaccinations: 'tout' }, 'suppression');
  const tables = [...TABLES_CHANGEMENTS_SANS_CLE].map(t => snake(t));
  const cles = await db.query<{ tbl: string; pk: string | null }>(`SELECT tbl, pk FROM changements WHERE tbl IN (${tables.map(() => '?').join(', ')})`, tables);
  assert.ok(cles.length >= 4);
  assert.deepEqual(cles.filter(c => c.pk !== null), [], 'aucune clé inscrite pour une table fermée');
});

test('SQLite : déclencheur d’une version antérieure (clé inscrite) remplacé à l’ouverture, base à jour laissée telle quelle', { skip: PG && SQLITE_SEUL }, async () => {
  const db = sqlite(await nouvelleBase());
  const texte = () => (db.sql.prepare(`SELECT sql FROM sqlite_master WHERE name = 'revision2_vaccinations_i'`).get() as { sql: string }).sql;
  const avant = texte();
  db.sql.exec(`DROP TRIGGER revision2_vaccinations_i; CREATE TRIGGER revision2_vaccinations_i AFTER INSERT ON vaccinations BEGIN
    UPDATE revision SET n = n + 1; INSERT INTO changements (n, tbl, pk) SELECT n, 'vaccinations', NEW.id FROM revision; END`);
  db.poserRevision();
  assert.equal(texte(), avant, 'corps du code reposé');
  const version = () => Number((db.sql.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version);
  const v = version();
  db.poserRevision();
  assert.equal(version(), v, 'base à jour : aucun déclencheur recréé');
  const n = await db.revisionBase();
  await db.insert('vaccinations', { empId: 1, v: 'fj', date: '2026-10-01' });
  assert.deepEqual(enClair(await db.lireChangements(n, await db.revisionBase())), { vaccinations: 'tout' });
});

test('tables inscrites sans clé : exactement les tables fermées en entier à Matrix (socle et demande), même liste dans 0014', () => {
  const fermees = new Set([...socleCursus().values(), ...demandeMatrix()].filter(c => c.colonne === '*').map(c => c.table));
  // `changements` est elle-même fermée (demande du lot 8) : l'ordre de ses lignes rattache l'activité des tables de santé.
  assert.ok(fermees.has('changements'), 'journal des changements fermé à matrix_lecture');
  const suivies = new Set(TABLES_SUIVIES.map(t => snake(t)));
  const attendues = [...fermees].filter(t => suivies.has(t)).sort();
  assert.deepEqual([...TABLES_CHANGEMENTS_SANS_CLE].map(t => snake(t)).sort(), attendues);
  const migration = lire('server/migrations-pg/0014_changements.sql');
  const liste = /IF t IN \(([^)]*)\) THEN/.exec(migration)?.[1];
  assert.ok(liste, 'liste des tables sans clé dans 0014');
  // lot 11 — notes de frais : les tables créées après 0014 posent leurs déclencheurs dans leur propre migration (0020 :
  // lignes_frais, sans clé) ; la liste de chacune s'ajoute à celle de 0014.
  // lot 12 — C3 : 0024 (tables du feedback 360°, sans clé).
  const suivantes = ['0020_notes_frais', '0024_entretiens_suivis'].flatMap(m => /IF t IN \(([^)]*)\) THEN/.exec(lire(`server/migrations-pg/${m}.sql`))?.[1].split(',') ?? []);
  assert.deepEqual([...liste.split(','), ...suivantes].map(t => t.trim().replace(/'/g, '')).sort(), attendues);
  assert.match(migration, /COMMENT ON TABLE "changements" IS '[^\n]*Sensible \(table entière/);
  // Nom inscrit à l'écriture, jamais figé à la création des fonctions.
  assert.doesNotMatch(migration, /%1\$L/);
});

test('PostgreSQL : table renommée, le journal inscrit son nouveau nom', SEUL_PG, async () => {
  const db = await nouvelleBase();
  await assert.rejects(db.tx(async () => {
    await db.exec('ALTER TABLE postes RENAME TO postes_renommes');
    await db.run(`INSERT INTO postes_renommes (nom) VALUES ('Opérateur')`);
    const r = await db.one<{ tbl: string }>('SELECT tbl FROM changements ORDER BY n DESC LIMIT 1');
    assert.equal(r?.tbl, 'postes_renommes');
    throw new Error('annulée');
  }), /annulée/);
});

test('remise à zéro, TRUNCATE et instruction de plus de 1 000 lignes : toute la table', async () => {
  const db = await nouvelleBase();
  const serie = (n: number) => `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${n})`;
  // Plus de SEUIL_CHANGEMENTS lignes en une instruction : marqueur (PostgreSQL) ou seuil appliqué à la lecture (SQLite,
  // dont les déclencheurs sont par ligne).
  let avant = await db.revisionBase();
  await db.run(`${serie(SEUIL_CHANGEMENTS + 200)} INSERT INTO projets (code, nom, statut) SELECT 'P' || i, 'Projet', 'actif' FROM s`);
  assert.deepEqual(enClair(await db.lireChangements(avant, await db.revisionBase())), { projets: 'tout' }, 'insertion de 1 200 lignes');
  if (PG) assert.deepEqual(await db.query('SELECT pk FROM changements WHERE n > ?', [avant]), [{ pk: null }], 'un seul marqueur');
  avant = await db.revisionBase();
  await db.run(`UPDATE projets SET nom = 'Renommé'`);
  assert.deepEqual(enClair(await db.lireChangements(avant, await db.revisionBase())), { projets: 'tout' }, 'modification de 1 200 lignes');
  // Exactement le seuil : encore ligne à ligne.
  avant = await db.revisionBase();
  await db.run(`UPDATE projets SET nom = 'Seuil' WHERE code IN (SELECT code FROM projets ORDER BY code LIMIT ${SEUIL_CHANGEMENTS})`);
  const seuil = (await db.lireChangements(avant, await db.revisionBase()))!.get('projets');
  assert.ok(seuil instanceof Set && seuil.size === SEUIL_CHANGEMENTS);
  // Lecture par clés au-delà d'un paquet : mêmes lignes que la lecture complète, dans l'ordre de la clé.
  const toutes = await db.all<{ code: string }>('projets');
  const relues = await db.lireLignes<{ code: string }>('projets', toutes.map(p => p.code).reverse());
  assert.ok(toutes.length > 2 * PAQUET_LIGNES);
  assert.deepEqual(new Set(relues.map(p => JSON.stringify(p))), new Set(toutes.map(p => JSON.stringify(p))));
  // Remise à zéro : chaque table suivie, et elle seule, marquée en entier, à une révision plus récente.
  await db.setSetting('essai', 1);
  avant = await db.revisionBase();
  await db.clearAll();
  const apres = await db.revisionBase();
  assert.ok(apres > avant);
  assert.equal(await dernierChangement(db), apres);
  assert.deepEqual(enClair(await db.lireChangements(avant, apres)), Object.fromEntries([...TABLES_SUIVIES].sort().map(t => [t, 'tout'])));
  assert.equal((await db.query('SELECT COUNT(*) AS c FROM changements WHERE n > ? AND pk IS NOT NULL', [avant]))[0].c, 0, 'marqueurs seuls');
  if (PG) {
    await db.setSetting('apres', 1);
    avant = await db.revisionBase();
    await db.exec('TRUNCATE settings');
    assert.deepEqual(enClair(await db.lireChangements(avant, await db.revisionBase())), { settings: 'tout' }, 'TRUNCATE');
  }
});

test('SQLite : remise à zéro interrompue, rien n’est défait à moitié', { skip: PG && SQLITE_SEUL }, async () => {
  const db = sqlite(await nouvelleBase());
  await db.insert('postes', { nom: 'Opérateur' });
  const n = await db.revisionBase();
  db.sql.exec(`CREATE TRIGGER bloquer AFTER DELETE ON projets BEGIN SELECT RAISE(ABORT, 'refusé'); END`);
  await db.insert('projets', { code: 'P1', nom: 'Projet', statut: 'actif' });
  const m = await db.revisionBase();
  await assert.rejects(db.clearAll(), /refusé/);
  assert.equal(await db.revisionBase(), m);
  assert.equal(await db.count('postes'), 1, 'suppressions défaites');
  assert.deepEqual(enClair(await db.lireChangements(n, m)), { projets: ['P1'] });
});

test('écart inconnu : purge, époque, écart à rebours ou au-delà de la base rendent null', async () => {
  const db = await nouvelleBase();
  await db.insert('postes', { nom: 'Opérateur' });
  await db.insert('postes', { nom: 'Technicien' });
  const { n, epoque } = await db.etatRevision();
  assert.deepEqual(enClair(await db.lireChangements(0, n, epoque)), { postes: ['1', '2'] });
  assert.equal(await db.lireChangements(0, n, epoque + 1), null, 'autre époque');
  assert.equal(await db.lireChangements(n, n - 1), null, 'à rebours');
  assert.equal(await db.lireChangements(0, n + 1), null, 'au-delà de la base');
  await db.run('UPDATE revision SET purge = ?', [n - 1]);
  assert.deepEqual(await db.etatRevision(), { n, epoque, purge: n - 1 });
  assert.equal(await db.lireChangements(0, n), null, 'parti d’en deçà de la purge');
  assert.deepEqual(enClair(await db.lireChangements(n - 1, n)), { postes: ['2'] }, 'à partir de la purge');
});

test('lireLignes : par clé (texte), triées, clés absentes ignorées, décodées comme get', async () => {
  const db = await nouvelleBase();
  for (const nom of ['A', 'B', 'C']) await db.insert('postes', { nom, formations: ['f1'], sir: nom === 'B' });
  const lues = await db.lireLignes('postes', ['3', '1', '99', '1']);
  assert.deepEqual(lues, [await db.get('postes', 1), await db.get('postes', 3)]);
  assert.deepEqual(await db.lireLignes('postes', []), []);
  await db.setSetting('b', 'texte');
  await db.setSetting('a', { x: 1 });
  assert.deepEqual(await db.lireLignes('settings', ['b', 'a']), [{ key: 'a', value: { x: 1 } }, { key: 'b', value: 'texte' }]);
});

test('décodeur préparé : mêmes objets que le décodage colonne par colonne, sur tout le jeu de démonstration', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const texte = db.moteur === 'sqlite';
  // Décodage d'avant le lot 9 (Object.entries par ligne), recopié ici pour comparaison.
  const ancien = (t: TableName, r: Ligne): Ligne => {
    const o: Ligne = {};
    for (const [c, type] of Object.entries(TABLES[t].cols) as [string, string][]) {
      const v = r[snake(c)];
      o[c] = v === null || v === undefined ? (type === 'bool' ? false : null)
        : type === 'bool' ? !!v : type === 'json' ? (texte ? JSON.parse(String(v)) : v) : type === 'int' || type === 'real' ? Number(v) : v;
    }
    return o;
  };
  let lignes = 0;
  for (const t of Object.keys(TABLES) as TableName[]) {
    const pk = snake(TABLES[t].pk);
    const brutes = await db.query<Ligne>(`SELECT * FROM ${snake(t)} ORDER BY ${pk}`);
    const lues = await db.lireLignes<Ligne>(t, brutes.map(r => String(r[pk])));
    assert.deepEqual(lues.map(l => JSON.stringify(l)).sort(), brutes.map(r => JSON.stringify(ancien(t, r))).sort(), t);
    lignes += brutes.length;
  }
  assert.ok(lignes > 300, `${lignes} lignes comparées`);
});

test('delta appliqué à une copie : égal à la relecture complète après une suite d’écritures', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  let base = await copie(db);
  let n = await db.revisionBase();
  const pas: [string, () => Promise<unknown>][] = [
    ['fiche', async () => await db.update('employes', 2, { nom: 'Mehdi Benali-Durand' })],
    ['feuilles en SQL direct', async () => await db.run(`UPDATE feuilles SET comment = 'Reprise' WHERE emp_id = 2`)],
    ['absence ajoutée puis retirée', async () => await db.tx(async () => {
      const a = await db.insert<{ id: number }>('absences', { empId: 3, type: 'CP', du: '2026-11-02', au: '2026-11-03', statut: 'demandee' });
      await db.remove('absences', a.id);
    })],
    ['absence ajoutée', async () => await db.insert('absences', { empId: 3, type: 'CP', du: '2026-11-09', au: '2026-11-10', statut: 'demandee' })],
    ['réglage', async () => await db.setSetting('essai', [1, 2])],
    ['équipe renommée', async () => await db.run(`UPDATE equipes SET nom = 'Atelier bis' WHERE nom = (SELECT MIN(nom) FROM equipes)`)],
    ['suppression en masse', async () => await db.run('DELETE FROM notifications')],
  ];
  for (const [quoi, fn] of pas) {
    await fn();
    const m = await db.revisionBase();
    const delta = await db.lireChangements(n, m);
    assert.ok(delta, quoi);
    const suivante = await appliquer(db, base, delta);
    await egaleRelecture(db, suivante, quoi);
    [base, n] = [suivante, m];
  }
});

test('PostgreSQL : deux instances sur le même schéma, B suit par delta ce qu’écrivent A et un outil hors de Cursus', SEUL_PG, async () => {
  const a = await nouvelleBase() as unknown as Pg;
  await seedDemo(a as unknown as Db);
  const url = (a.pool as unknown as { options: { connectionString: string } }).options.connectionString;
  const b = await ouvrirPostgres(url, { schema: a.schema, env: { CURSUS_PG_POOL: '2' } });
  const pgmod = (await import('pg')).default;
  const outil = new pgmod.Client({ connectionString: url, options: `-c search_path=${a.schema}`, application_name: 'cursus-tests' });
  await outil.connect();
  try {
    const db = b as unknown as Db;
    let etat = await db.etatRevision();
    assert.deepEqual(etat, await (a as unknown as Db).etatRevision(), 'même état de révision');
    let base = await db.lecture(async () => await copie(db));
    const pas: [string, () => Promise<unknown>][] = [
      ['A : fiche', async () => await a.update('employes', 2, { nom: 'Écrit par A' })],
      ['A : transaction', async () => await a.tx(async () => {
        await a.insert('absences', { empId: 3, type: 'CP', du: '2026-11-02', au: '2026-11-03', statut: 'demandee' });
        await a.run(`UPDATE feuilles SET comment = 'A' WHERE emp_id = 3`);
      })],
      ['outil : SQL direct', async () => await outil.query(`UPDATE employes SET nom = 'Écrit par l''outil' WHERE id = 3`)],
      ['outil : TRUNCATE', async () => await outil.query('TRUNCATE notifications')],
      ['A : remise à zéro', async () => await a.clearAll()],
    ];
    for (const [quoi, fn] of pas) {
      await fn();
      // B lit l'état et le delta dans une même lecture stable, comme le cache de l'instantané.
      const suivante = await db.lecture(async () => {
        const nouvel = await db.etatRevision();
        const delta = await db.lireChangements(etat.n, nouvel.n, etat.epoque);
        assert.ok(delta && delta.size > 0, quoi);
        etat = nouvel;
        return await appliquer(db, base, delta);
      });
      await egaleRelecture(db, suivante, quoi);
      base = suivante;
    }
  } finally {
    await outil.end();
    await b.fermer();
  }
});

test('SQLite : base du lot 8 (déclencheurs revision_*, révision sans purge ni époque) reprise à l’ouverture', { skip: PG && SQLITE_SEUL }, async () => {
  const db = sqlite(await nouvelleBase());
  await db.insert('postes', { nom: 'Opérateur' });
  // État du lot 8 reconstitué : anciens déclencheurs, révision sans purge ni époque, pas de journal des changements.
  const declencheurs = () => (db.sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).all() as { name: string }[]).map(t => t.name);
  for (const t of declencheurs()) db.sql.exec(`DROP TRIGGER ${t}`);
  db.sql.exec(`DROP TABLE changements; DROP TABLE revision; CREATE TABLE revision (cle INTEGER PRIMARY KEY CHECK (cle = 1), n INTEGER NOT NULL);
    INSERT INTO revision (cle, n) VALUES (1, 41); CREATE TRIGGER revision_postes_i AFTER INSERT ON postes BEGIN UPDATE revision SET n = n + 1; END;
    CREATE TRIGGER revision_journal_i AFTER INSERT ON journal BEGIN UPDATE revision SET n = n + 1; END`);
  db.poserRevision();
  db.poserRevision(); // reposés après les migrations nommées : sans effet la seconde fois
  const noms = declencheurs();
  assert.ok(!noms.some(t => t.startsWith('revision_')), 'anciens déclencheurs retirés');
  assert.equal(noms.length, TABLES_SUIVIES.length * 3, 'trois déclencheurs par table suivie');
  assert.ok(!noms.some(t => /journal|connexions|comptes|jetons_agenda/.test(t)));
  const etat = await db.etatRevision();
  assert.equal(etat.n, 41, 'révision conservée');
  assert.ok(etat.epoque > 0 && etat.purge === 0);
  await db.insert('postes', { nom: 'Technicien' });
  assert.equal(await db.revisionBase(), 42, 'une seule révision par ligne');
  assert.deepEqual(enClair(await db.lireChangements(41, 42)), { postes: ['2'] });
});
