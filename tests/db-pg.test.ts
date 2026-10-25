// Adaptateur PostgreSQL (server/src/db-pg.ts, sous-étape 8.b) : traduction des paramètres, types rendus comme SQLite,
// transactions et verrou d'écriture (deux pools = deux instances de Cursus), lectures stables, remise à zéro, séquences,
// migrations (journal, verrou, refus), contrôle du schéma. Tests lancés seulement sur PostgreSQL
// (CURSUS_TEST_ENGINE=pg, tests/base.ts) ; la traduction des paramètres est vérifiée sur les deux moteurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { PG, nouvelleBase, schemaNeuf, surServeur } = await import('./base.ts');
const { demandeMatrix } = await import('./colonnes-sensibles.ts');
const { DOSSIER_MIGRATIONS_PG, migrationsPg, ouvrirPostgres, PgDb, SchemaPgError, TABLES_RANG, versDollar } = await import('../server/src/db-pg.ts');
const { openDb, TABLES, urlPostgres } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { problemesBase, problemesConfig } = await import('../server/src/config.ts');
type Db = import('../server/src/db.ts').Db;
type Pg = InstanceType<typeof PgDb>;

const SEUL = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
const pause = (ms = 20) => new Promise(r => setTimeout(r, ms));
const pg = async (): Promise<Pg> => (await nouvelleBase()) as Pg;

test('paramètres ? traduits en $n, sauf dans les chaînes, les identifiants et les commentaires', () => {
  assert.equal(versDollar('SELECT * FROM t WHERE a = ? AND b IN (?, ?)'), 'SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)');
  assert.equal(versDollar(`SELECT '?' AS "x?", a FROM t WHERE b = ? -- pourquoi ?\nAND c = ?`), `SELECT '?' AS "x?", a FROM t WHERE b = $1 -- pourquoi ?\nAND c = $2`);
  assert.equal(versDollar(`SELECT 'l''apostrophe ?' , ?`), `SELECT 'l''apostrophe ?' , $1`);
  assert.equal(versDollar('SELECT 1'), 'SELECT 1');
});

test('configuration : DATABASE_URL et CURSUS_PG_POOL contrôlées au démarrage, sans afficher l’adresse', () => {
  assert.deepEqual(problemesBase({}), []);
  assert.deepEqual(problemesBase({ DATABASE_URL: 'postgres://cursus_app:secret@db:5432/epc2i', CURSUS_PG_POOL: '10' }), []);
  const pbs = problemesBase({ DATABASE_URL: 'mysql://cursus_app:secret@db/epc2i', CURSUS_PG_POOL: '0' });
  assert.equal(pbs.length, 2);
  assert.ok(pbs.every(p => !p.includes('secret')), 'mot de passe jamais affiché');
  assert.ok(problemesConfig({ DATABASE_URL: 'pas une adresse' }).some(p => /DATABASE_URL/.test(p)));
});

test('DATABASE_URL vide vaut absence : fichier SQLite', async () => {
  assert.equal(urlPostgres({ DATABASE_URL: '' }), null);
  assert.equal(urlPostgres({ DATABASE_URL: '   ' }), null);
  assert.equal(urlPostgres({}), null);
  assert.equal(urlPostgres({ DATABASE_URL: ' postgres://x@h/b ' }), 'postgres://x@h/b');
  const dir = mkdtempSync(join(tmpdir(), 'cursus-moteur-'));
  try {
    const db = await openDb(join(dir, 'cursus.db'), { DATABASE_URL: '' });
    assert.equal(db.moteur, 'sqlite');
    await db.fermer();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('types rendus comme par SQLite : dates en chaîne, nombres, horodatages ISO, JSON décodé, booléens', SEUL, async () => {
  const db = await pg();
  const r = (await db.one<Record<string, unknown>>(`SELECT DATE '2026-02-28' AS d, 1.25::numeric AS n, COUNT(*) AS c, TIMESTAMPTZ '2026-10-18 08:30:00.123+02' AS t,
    '{"b":1,"a":[2]}'::json AS j, TRUE AS v FROM (VALUES (1), (2)) x`))!;
  assert.deepEqual(r, { d: '2026-02-28', n: 1.25, c: 2, t: '2026-10-18T06:30:00.123Z', j: { b: 1, a: [2] }, v: true });
  // Colonnes JSON : texte conservé tel qu'écrit (ordre des clés compris), comme dans SQLite.
  await db.insert('settings', { key: 'ordre', value: { z: 1, a: 2 } });
  assert.deepEqual(Object.keys((await db.getSetting<Record<string, number>>('ordre', {}))), ['z', 'a']);
  await db.setSetting('chaine', 'aaaa');
  assert.equal(await db.getSetting('chaine', ''), 'aaaa', 'valeur JSON chaîne relue sans être redécodée');
  // Booléen absent : faux (NOT NULL DEFAULT false), comme la lecture de SQLite ; NaN : NULL.
  const f = await db.insert<{ id: number; sage: boolean; keystone: boolean }>('feuilles', { empId: null, week: '2026-10-05', statut: 'brouillon', lignes: [] }).catch(e => e as Error);
  assert.ok(f instanceof Error && /emp_id/.test(f.message), 'salarié obligatoire');
  await db.insert('employes', { id: 1, nom: 'Essai', entree: '2026-01-05', naissance: Number.NaN });
  assert.equal((await db.get<{ naissance: number | null }>('employes', 1))!.naissance, null);
  const feuille = await db.insert<{ id: number; sage: boolean; keystone: boolean }>('feuilles', { empId: 1, week: '2026-10-05', statut: 'brouillon', lignes: [], sage: null });
  assert.deepEqual([feuille.sage, feuille.keystone], [false, false]);
  assert.deepEqual((await db.where<{ id: number }>('feuilles', 'sage', false)).map(x => x.id), [feuille.id]);
  // Matricule partagé (D01), colonne générée.
  assert.equal((await db.one<{ m: string }>('SELECT matricule AS m FROM employes WHERE id = 1'))!.m, 'EMP-0001');
});

test('identifiants fixés : séquence recalée, jamais en arrière ; ordre d’insertion (rang) et NULL en tête', SEUL, async () => {
  const db = await pg();
  await db.insert('employes', { id: 40, nom: 'A' });
  assert.equal((await db.insert<{ id: number }>('employes', { nom: 'B' })).id, 41);
  await db.insert('employes', { id: 5, nom: 'C' });
  assert.equal((await db.insert<{ id: number }>('employes', { nom: 'D' })).id, 42, 'la séquence ne recule pas');
  await db.resyncIds();
  assert.equal((await db.insert<{ id: number }>('employes', { nom: 'E' })).id, 43);
  for (const code of ['ZZ', 'AA', 'MM']) await db.insert('projets', { code, nom: code });
  assert.deepEqual((await db.all<{ code: string }>('projets', 'rowid')).map(p => p.code), ['ZZ', 'AA', 'MM']);
  await db.insert('chantiers', { id: 'K-2', debut: '2026-01-01' });
  await db.insert('chantiers', { id: 'K-1', debut: null });
  await db.insert('chantiers', { id: 'K-3', debut: '2026-01-01' });
  assert.deepEqual((await db.all<{ id: string }>('chantiers', 'debut')).map(c => c.id), ['K-1', 'K-2', 'K-3'], 'NULL en tête, égalités dans l’ordre d’insertion');
  assert.ok([...TABLES_RANG].every(t => t in TABLES));
  assert.ok((await db.columns('formations')).includes('rang'));
});

test('transactions : annulation, imbrication, point de reprise dans exclusif, lecture dans la portée', SEUL, async () => {
  const db = await pg();
  const lire = async (k: string) => await db.getSetting<number>(k, 0);
  await assert.rejects(db.tx(async () => {
    await db.setSetting('a', 1);
    await db.tx(async () => { await db.setSetting('b', 2); });
    throw new Error('annulée');
  }), /annulée/);
  assert.deepEqual([await lire('a'), await lire('b')], [0, 0]);
  // exclusif : ce qui est écrit hors de tx est validé aussitôt, la tx en échec seule est annulée (comme en SQLite).
  const rev = db.revision;
  await db.exclusif(async () => {
    await db.setSetting('session', 1);
    await assert.rejects(db.tx(async () => { await db.setSetting('action', 1); throw new Error('refus'); }), /refus/);
    assert.equal(await lire('action'), 0);
    await db.tx(async () => { await db.setSetting('action', 2); });
    assert.equal(await db.lecture(async () => await lire('action')), 2, 'lecture dans la portée : même connexion');
  });
  assert.deepEqual([await lire('session'), await lire('action')], [1, 2]);
  assert.ok(db.revision > rev, 'révision montée par la transaction validée');
  // Erreur de la fonction d'exclusif : ses écritures hors transaction sont gardées, l'erreur est rendue.
  await assert.rejects(db.exclusif(async () => { await db.setSetting('trace', 1); throw new Error('route'); }), /route/);
  assert.equal(await lire('trace'), 1);
  // Erreur du serveur dans exclusif : la requête fautive seule échoue, la suite peut continuer (comme en SQLite).
  await db.exclusif(async () => {
    await db.setSetting('garde', 1);
    await assert.rejects(db.exec('SELECT * FROM table_absente'), /table_absente/);
    await db.setSetting('apres', 1);
  });
  assert.deepEqual([await lire('garde'), await lire('apres')], [1, 1]);
  // Écritures d'exclusif visibles des autres connexions avant sa fin (réponse d'une route envoyée dans la portée).
  await db.exclusif(async () => {
    await db.tx(async () => { await db.setSetting('visible', 1); });
    const autre = (await db.pool.query(`SELECT value FROM settings WHERE key = 'visible'`)).rows;
    assert.equal(autre.length, 1, 'transaction validée dès sa fin, verrou encore détenu');
  });
  // Écriture demandée dans une lecture : refus clair.
  await assert.rejects(db.lecture(async () => await db.tx(async () => {})), /lecture/);
  await assert.rejects(db.tx(() => { throw new Error('immédiate'); }), /immédiate/);
  assert.equal(await db.tx(async () => 'ok'), 'ok', 'pool non bloqué');
});

test('deux instances (deux pools) : écritures sérialisées par le verrou, aucune perdue ; lectures sur un état stable', SEUL, async () => {
  const { url, schema } = await schemaNeuf();
  const a = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '4' } });
  const b = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '4' } });
  try {
    await a.setSetting('compteur', 0);
    // Lecture puis écriture du même compteur, 20 fois en même temps sur les deux instances.
    const incrementer = async (db: Pg) => await db.tx(async () => {
      const v = await db.getSetting<number>('compteur', 0);
      await pause(2);
      await db.setSetting('compteur', v + 1);
    });
    await Promise.all([...Array(20).keys()].map(i => incrementer(i % 2 ? a : b)));
    assert.equal(await a.getSetting('compteur', 0), 20);
    // Lecture REPEATABLE READ : deux lectures d'une même portée voient le même état, même si l'autre instance écrit entre.
    const vu = await a.lecture(async () => {
      const avant = await a.getSetting<number>('compteur', 0);
      await b.setSetting('compteur', 99);
      return [avant, await a.getSetting<number>('compteur', 0)];
    });
    assert.deepEqual(vu, [20, 20]);
    assert.equal(await a.getSetting('compteur', 0), 99);
  } finally {
    await a.fermer();
    await b.fermer();
    await b.fermer(); // déjà fermée : sans effet
  }
});

test('remise à zéro : données vidées (journal et sessions de connexion gardés), identifiants repartis, démonstration rechargée', SEUL, async () => {
  const db = await pg();
  await mettreAJourBase(db);
  await seedDemo(db);
  const employes = await db.count('employes');
  await db.insert('journal', { at: new Date().toISOString(), actor: 'x', action: 'essai', payload: {} });
  await db.insert('connexions', { id: 'session-essai', compteId: 1, role: 'rh', methode: 'demo', creation: new Date().toISOString(), expiration: new Date().toISOString() });
  await db.clearAll();
  assert.equal(await db.count('employes'), 0);
  assert.equal(await db.count('journal'), 1);
  assert.equal(await db.count('connexions'), 1);
  await seedDemo(db);
  assert.equal(await db.count('employes'), employes);
  assert.equal((await db.insert<{ id: number }>('employes', { nom: 'Nouvelle fiche' })).id, employes + 1, 'séquence au-delà des fiches de la démonstration');
});

test('migrations : appliquées une fois sous verrou (deux démarrages simultanés), refus d’un schéma absent ou plus récent', SEUL, async () => {
  const { url, schema } = await schemaNeuf();
  const [a, b] = await Promise.all([ouvrirPostgres(url, { schema }), ouvrirPostgres(url, { schema })]);
  try {
    const noms = migrationsPg().map(m => m.nom);
    assert.ok(noms[0] === '0001_init' && noms.includes('0002_partage'));
    assert.deepEqual((await a.query<{ nom: string }>('SELECT nom FROM schema_migrations ORDER BY nom')).map(r => r.nom), noms);
    assert.equal([a.neuve, b.neuve].filter(Boolean).length, 1, 'une seule instance a créé le schéma');
    assert.equal((await surServeur<{ n: number }>(url, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = $1`, [schema]))[0].n, Object.keys(TABLES).length + 3, 'tables de TABLES, journal des migrations, révision et journal des changements');
    // Réouverture : rien à appliquer.
    const c = await ouvrirPostgres(url, { schema });
    assert.equal(c.neuve, false);
    await c.fermer();
    // Migration inconnue de ce code : refus.
    await a.run('INSERT INTO schema_migrations (nom) VALUES (?)', ['9999_futur']);
    await assert.rejects(ouvrirPostgres(url, { schema }), (e: unknown) => e instanceof SchemaPgError && /version plus récente.*9999_futur/.test(e.message));
    await a.run('DELETE FROM schema_migrations WHERE nom = ?', ['9999_futur']);
    // Colonne de TABLES absente du schéma : refus au démarrage.
    await a.exec('ALTER TABLE relances DROP COLUMN palier');
    await assert.rejects(ouvrirPostgres(url, { schema }), (e: unknown) => e instanceof SchemaPgError && /incomplet.*relances\.palier/.test(e.message));
  } finally {
    await a.fermer();
    await b.fermer();
  }
  // Schéma absent : jamais créé par Cursus.
  await assert.rejects(ouvrirPostgres(url, { schema: 'cursus_absent' }), (e: unknown) => e instanceof SchemaPgError && /n’existe pas.*jamais par Cursus/.test(e.message));
  assert.equal((await surServeur(url, `SELECT 1 FROM pg_namespace WHERE nspname = 'cursus_absent'`)).length, 0);
  assert.throws(() => new PgDb(url, { schema: 'Cursus;' }), SchemaPgError);
});

test('migration en échec : annulée, nommée, rien n’est inscrit au journal', SEUL, async () => {
  const { url, schema } = await schemaNeuf();
  const dir = mkdtempSync(join(tmpdir(), 'cursus-migrations-pg-'));
  try {
    for (const m of migrationsPg(DOSSIER_MIGRATIONS_PG)) writeFileSync(join(dir, `${m.nom}.sql`), m.sql);
    writeFileSync(join(dir, '0099_casse.sql'), 'CREATE TABLE essai_casse (a int); SELECT * FROM table_absente;');
    writeFileSync(join(dir, 'LISEZMOI.txt'), 'ignoré');
    await assert.rejects(ouvrirPostgres(url, { schema, migrations: dir }), (e: unknown) => e instanceof SchemaPgError && /migration 0099_casse interrompue/.test(e.message));
    const db = await ouvrirPostgres(url, { schema });
    try {
      assert.equal(await db.one(`SELECT 1 FROM schema_migrations WHERE nom = '0099_casse'`), undefined);
      assert.equal(await db.one(`SELECT to_regclass('essai_casse') AS t`).then(r => (r as { t: string | null }).t), null);
    } finally {
      await db.fermer();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la base des autres tests est bien sur PostgreSQL', SEUL, async () => {
  const db: Db = await nouvelleBase();
  assert.equal(db.moteur, 'pg');
  assert.equal(db.emplacement, null);
  assert.match(db.contientEntier('journal.salaries'), /jsonb/);
  assert.equal(db.like, 'ILIKE');
});

test('vue pub_absences (demande CU-1 de Crucible) : qui est absent et quand, jamais pourquoi', SEUL, async () => {
  const db = await pg();
  await db.insert('employes', { id: 1, nom: 'Essai', entree: '2026-01-05' });
  await db.insert('employes', { id: 2, nom: 'Autre', entree: '2026-01-05' });
  const a = async (statut: string, type: string, du: string, extra: Record<string, unknown> = {}) =>
    await db.insert<{ id: number }>('absences', { empId: 1, type, du, au: du, statut, motifRefus: statut === 'refusee' ? 'Charge' : null, ...extra });
  const validee = await a('validee', 'CP', '2026-11-02');
  await a('demandee', 'RTT', '2026-11-03');
  await a('signalee', 'MALADIE', '2026-11-04', { justificatif: true });
  await a('annulee', 'CP', '2026-11-05', { annuleeLe: '2026-10-20' });
  await a('refusee', 'CP', '2026-11-06');
  const vue = async () => db.query<Record<string, unknown>>('SELECT * FROM pub_absences ORDER BY du');
  const lignes = await vue();
  // Colonnes du contrat, dans l'ordre ; jamais le type, le motif, le justificatif ni les demi-journées.
  assert.deepEqual(Object.keys(lignes[0]), ['matricule', 'du', 'au', 'statut', 'annulee', 'maj_le']);
  assert.deepEqual(lignes.map(l => [l.matricule, l.du, l.statut, l.annulee]), [
    ['EMP-0001', '2026-11-02', 'validee', false],
    ['EMP-0001', '2026-11-03', 'demandee', false],
    ['EMP-0001', '2026-11-04', 'validee', false],
    ['EMP-0001', '2026-11-05', 'validee', true],
  ], 'absence refusée non publiée ; arrêt signalé publié comme validé, sans sa nature');
  const lues = (await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.view_column_usage WHERE view_name = 'pub_absences' AND table_name = 'absences'`)).map(r => r.column_name);
  for (const c of ['type', 'motif_refus', 'justificatif', 'justificatif_le', 'debut_demi', 'fin_demi', 'signale_par', 'annulee_par']) assert.ok(!lues.includes(c), c);
  // maj_le : posée par la base à chaque écriture, pour une lecture incrémentale.
  const avant = String(lignes[0].maj_le);
  await pause();
  await db.update('absences', validee.id, { au: '2026-11-03' });
  const apres = (await vue())[0];
  assert.equal(apres.au, '2026-11-03');
  assert.ok(String(apres.maj_le) > avant, 'maj_le avance à la modification');
});

// ═══ Lot 8, chantier D : vue pub_titres_detenus (migration 0011_pub_titres_valides, avenant du contrat D09) ═══
test('vue pub_titres_detenus (lot 8) : certification annulée jamais publiée, habilitation suspendue ou retirée bornée par sa mesure', SEUL, async () => {
  const db = await pg();
  await db.insert('employes', { id: 1, nom: 'Essai', entree: '2020-01-06' });
  await db.insert('formations', { id: 'elec', nom: 'Habilitation électrique (formation)', validite: 36, organisme: 'Organisme A' });
  await db.insert('formations', { id: 'caces', nom: 'CACES R489', validite: 60, organisme: 'Organisme B' });
  await db.insert('habilitations', { id: 'br', nom: 'BR', prereqs: ['elec'], validite: 36 });
  await db.insert('habilitations', { id: 'h0', nom: 'H0', prereqs: [], validite: 36 });
  await db.insert('habilitations', { id: 'b1', nom: 'B1', prereqs: [], validite: 36 });
  // CACES : la dernière obtention est annulée (saisie par erreur) ; la précédente, non annulée, reprend sa place.
  const ancienne = await db.insert<{ id: number }>('certifications', { empId: 1, f: 'caces', obtenue: '2022-03-01' });
  await db.insert('certifications', { empId: 1, f: 'caces', obtenue: '2026-09-01', annuleLe: '2026-09-15', annulePar: 'RH', annuleMotif: 'Erreur de saisie' });
  // Formation prérequise de BR : seulement une certification annulée, qui ne compte jamais comme prérequis.
  await db.insert('certifications', { empId: 1, f: 'elec', obtenue: '2026-01-10', annuleLe: '2026-02-01', annulePar: 'RH', annuleMotif: 'Doublon' });
  await db.insert('habTitres', { empId: 1, h: 'br', delivree: '2026-01-15', par: 'Direction' });
  const susp = await db.insert<{ id: number }>('habTitres', { empId: 1, h: 'h0', delivree: '2026-01-15', par: 'Direction', mesure: 'suspension', mesureDate: '2026-06-01', mesureMotif: 'Incident', mesurePar: 'RH' });
  const ret = await db.insert<{ id: number }>('habTitres', { empId: 1, h: 'b1', delivree: '2026-01-15', par: 'Direction', mesure: 'retrait', mesureDate: '2026-07-01', mesureMotif: 'Restriction', mesurePar: 'RH' });

  const lignes = await db.query<Record<string, unknown>>('SELECT * FROM pub_titres_detenus ORDER BY cursus_ref');
  // Colonnes du contrat D09, dans l'ordre : celles d'avant le lot 8 inchangées, puis mesure et mesure_le en fin.
  assert.deepEqual(Object.keys(lignes[0]), ['cursus_ref', 'matricule', 'titre_id', 'nature', 'code', 'obtenu_le', 'expire_le',
    'utilisable_jusqu_au', 'prerequis_manquant', 'organisme', 'delivre_par', 'session_prevue_le', 'mesure', 'mesure_le']);
  const par = (ref: string) => lignes.find(l => l.cursus_ref === ref);
  // Certifications : l'annulée n'est pas publiée, ni pour CACES ni pour la formation prérequise.
  assert.deepEqual(lignes.filter(l => l.nature === 'formation').map(l => l.cursus_ref), [`certification.${ancienne.id}`]);
  assert.deepEqual([par(`certification.${ancienne.id}`)!.obtenu_le, par(`certification.${ancienne.id}`)!.expire_le, par(`certification.${ancienne.id}`)!.mesure], ['2022-03-01', '2027-03-01', null]);
  // BR : prérequis manquant (sa seule certification est annulée) ; aucune mesure. Jamais utilisable (veille de la
  // délivrance), comme habInfo (« susp ») : un lecteur qui ne regarde que utilisable_jusqu_au ne le tient pas pour habilité.
  const br = lignes.find(l => l.code === 'br')!;
  assert.deepEqual([br.prerequis_manquant, br.expire_le, br.utilisable_jusqu_au, br.mesure, br.mesure_le], [true, '2029-01-15', '2026-01-14', null, null]);
  assert.equal((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM pub_titres_detenus WHERE prerequis_manquant AND utilisable_jusqu_au >= obtenu_le`))!.n, 0);
  // Suspension et retrait : utilisable jusqu'à la veille de la mesure (date incluse, comme expire_le), échéance
  // inchangée, mesure publiée sans son motif.
  assert.deepEqual([par(`hab_titre.${susp.id}`)!.expire_le, par(`hab_titre.${susp.id}`)!.utilisable_jusqu_au, par(`hab_titre.${susp.id}`)!.mesure, par(`hab_titre.${susp.id}`)!.mesure_le],
    ['2029-01-15', '2026-05-31', 'suspension', '2026-06-01']);
  assert.deepEqual([par(`hab_titre.${ret.id}`)!.utilisable_jusqu_au, par(`hab_titre.${ret.id}`)!.mesure, par(`hab_titre.${ret.id}`)!.mesure_le], ['2026-06-30', 'retrait', '2026-07-01']);
  // Lecture d'un autre outil le jour de la mesure : titre non utilisable.
  assert.equal((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM pub_titres_detenus WHERE mesure IS NOT NULL AND utilisable_jusqu_au >= mesure_le`))!.n, 0);
  // Mesure sans date (reprise d'un ancien système) : jamais utilisable (veille de la délivrance).
  await db.update('habTitres', ret.id, { mesureDate: null });
  const sansDate = (await db.query<Record<string, unknown>>('SELECT utilisable_jusqu_au, mesure_le FROM pub_titres_detenus WHERE cursus_ref = ?', [`hab_titre.${ret.id}`]))[0];
  assert.deepEqual([sansDate.utilisable_jusqu_au, sansDate.mesure_le], ['2026-01-14', '2026-01-15']);
  // Suspension levée (conformite.ts : mesure remise à null) : le titre redevient utilisable jusqu'à son échéance.
  await db.update('habTitres', susp.id, { mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null });
  const levee = (await db.query<Record<string, unknown>>('SELECT utilisable_jusqu_au, mesure FROM pub_titres_detenus WHERE cursus_ref = ?', [`hab_titre.${susp.id}`]))[0];
  assert.deepEqual([levee.utilisable_jusqu_au, levee.mesure], ['2029-01-15', null]);
  // Certification prérequise valide ajoutée : BR n'est plus en prérequis manquant, borné par l'échéance de la formation.
  await db.insert('certifications', { empId: 1, f: 'elec', obtenue: '2026-02-10' });
  const brOk = (await db.query<Record<string, unknown>>(`SELECT prerequis_manquant, utilisable_jusqu_au FROM pub_titres_detenus WHERE code = 'br'`))[0];
  assert.deepEqual([brOk.prerequis_manquant, brOk.utilisable_jusqu_au], [false, '2029-01-15']);
  // Jamais lus par la vue : motifs (textes libres), auteur de la mesure, aptitude médicale.
  const lues = (await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.view_column_usage WHERE view_name = 'pub_titres_detenus'`)).map(r => `${r.table_name}.${r.column_name}`);
  for (const c of ['hab_titres.mesure_motif', 'hab_titres.mesure_par', 'certifications.annule_motif', 'certifications.corrige_motif', 'employes.avis', 'employes.visite']) assert.ok(!lues.includes(c), c);
});

test('colonnes déclarées sensibles (lot 8) : commentaire « Sensible » posé par les migrations sur chaque colonne de la demande à Matrix', SEUL, async () => {
  const db = await pg();
  // Colonnes et tables (« * ») de docs/demandes/matrix-lot8-colonnes-sensibles.sql : toutes couvertes par le contrôle de
  // la CI (scripts/colonnes-sensibles-pg.sql), qui lit ces commentaires.
  const marque = /Sensible|à exclure de matrix_lecture/;
  for (const { table, colonne } of demandeMatrix()) {
    const r = (await db.one<{ c: string | null; t: string | null }>(
      `SELECT col_description(c.oid, a.attnum) AS c, obj_description(c.oid, 'pg_class') AS t
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = ?
       WHERE n.nspname = current_schema() AND c.relname = ?`, [colonne === '*' ? '' : colonne, table]))!;
    assert.ok(r, `${table} existe`);
    assert.match(colonne === '*' ? r.t ?? '' : r.c ?? '', marque, `${table}.${colonne}`);
  }
});

// — Pré-vol de la mise en production (lot 8, chantier B : server/src/db-pg-lecture.ts, server/src/pre-vol.ts) —

const { ConnexionImpossible, faitsServeur, ouvrirPgLecture } = await import('../server/src/db-pg-lecture.ts');
const { controlerBase, vuesAttendues } = await import('../server/src/pre-vol.ts');
const { creerCompte } = await import('../server/src/comptes.ts');

test('pré-vol : serveur injoignable ou muet, refus sans afficher l’adresse', async () => {
  // Port fermé : refus immédiat.
  const ferme = await new Promise<number>(res => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => res(p)); }); });
  const refus = await ouvrirPgLecture(`postgres://cursus_app:S3cret@127.0.0.1:${ferme}/epc2i`).catch(e => e as Error);
  assert.ok(refus instanceof ConnexionImpossible);
  assert.match(refus.message, /^connexion au serveur PostgreSQL impossible \(/);
  assert.ok(!refus.message.includes('S3cret'));
  // Serveur qui accepte la connexion sans jamais répondre : abandon au bout du délai.
  const sockets: import('node:net').Socket[] = [];
  const muet = createServer(s => { sockets.push(s); }).listen(0, '127.0.0.1');
  await new Promise(r => muet.once('listening', r));
  try {
    const port = (muet.address() as AddressInfo).port;
    const e = await ouvrirPgLecture(`postgres://cursus_app:x@127.0.0.1:${port}/epc2i`, { delaiMs: 200 }).catch(x => x as Error);
    assert.ok(e instanceof ConnexionImpossible);
    assert.equal(e.message, 'aucune réponse du serveur PostgreSQL en 0.2 s');
  } finally {
    for (const s of sockets) s.destroy();
    muet.close();
  }
});

test('pré-vol : connexion en lecture seule, sans migration ; faits du serveur et vues conformes au contrat', SEUL, async () => {
  const { url, schema } = await schemaNeuf();
  // Schéma jamais migré : rien n'est créé (pas même le journal des migrations).
  const lecture = await ouvrirPgLecture(url, { schema });
  try {
    const neuf = await faitsServeur(lecture.db, lecture.dureeConnexionMs);
    assert.deepEqual([neuf.schemaCourant, neuf.migrations, neuf.vues], [schema, null, {}]);
    assert.deepEqual((await surServeur(url, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = $1`, [schema]))[0], { n: 0 });
    // Toute écriture échoue.
    await assert.rejects(lecture.db.exec('CREATE TABLE essai (id int)'), /read-only transaction/);
  } finally {
    await lecture.db.fermer();
  }
  const migree = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '2' } });
  await migree.fermer();
  const { db, dureeConnexionMs } = await ouvrirPgLecture(url, { schema });
  try {
    const f = await faitsServeur(db, dureeConnexionMs);
    assert.deepEqual(f.migrations, migrationsPg().map(m => m.nom));
    assert.equal(f.schemaIncomplet, null);
    // Contrat des vues lu dans les migrations = colonnes réelles des vues créées par ces migrations.
    assert.deepEqual(f.vues, vuesAttendues(migrationsPg()));
    assert.ok(Math.abs(f.ecartHorlogeMs) < 5_000);
    // Colonne retirée hors de Cursus : écart au code relevé par le contrôle du démarrage, en lecture.
    await surServeur(url, `ALTER TABLE ${schema}.settings RENAME COLUMN value TO valeur`);
    assert.match((await faitsServeur(db, 0)).schemaIncomplet!, /settings\.value/);
    await surServeur(url, `ALTER TABLE ${schema}.settings RENAME COLUMN valeur TO value`);
    // Rôle d'administration des tests : refusé (superutilisateur).
    const cs = await controlerBase(db, { serveur: f, migrations: migrationsPg(), dossierPieces: tmpdir(), schema });
    assert.deepEqual(cs.filter(c => c.niveau === 'bloquant').map(c => c.code), ['base.role', 'base.droits', 'base.admin']);
    await assert.rejects(db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['essai', '1']), /read-only transaction/);
  } finally {
    await db.fermer();
  }
});

test('pré-vol : schéma absent, et schéma cursus par défaut', SEUL, async () => {
  const { url } = await schemaNeuf();
  const absent = await ouvrirPgLecture(url, { schema: 'schema_absent' });
  try {
    const f = await faitsServeur(absent.db, absent.dureeConnexionMs);
    assert.deepEqual([f.schemaCourant, f.migrations, f.schemaIncomplet, f.vues], [null, null, 'schéma absent', {}]);
  } finally {
    await absent.db.fermer();
  }
  // Options par défaut : schéma cursus (le premier schéma créé par tests/base.ts pour ce fichier).
  const defaut = await ouvrirPgLecture(url);
  try {
    assert.equal(defaut.db.schema, 'cursus');
  } finally {
    await defaut.db.fermer();
  }
});

test('pré-vol sur le serveur : base de démonstration chargée bloquante, base vide avec un administrateur conforme', SEUL, async () => {
  const { url, schema } = await schemaNeuf();
  const ecriture = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '2' } });
  // Rôle propre au test, aux droits de cursus_app sur son schéma (lecture ici) : ni superutilisateur ni CREATE sur la base.
  const role = `cursus_prevol_${process.pid}`, mdp = `mdp-${process.pid}-essai`;
  const base = new URL(url).pathname.slice(1);
  await surServeur(url, `CREATE ROLE ${role} LOGIN PASSWORD '${mdp}'`);
  try {
    await surServeur(url, `GRANT CONNECT ON DATABASE "${base}" TO ${role}; GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    const urlRole = new URL(url);
    urlRole.username = role;
    urlRole.password = mdp;
    const controler = async () => {
      const { db, dureeConnexionMs } = await ouvrirPgLecture(urlRole.toString(), { schema });
      try {
        return await controlerBase(db, { serveur: await faitsServeur(db, dureeConnexionMs), migrations: migrationsPg(), dossierPieces: tmpdir(), role, schema });
      } finally {
        await db.fermer();
      }
    };
    await creerCompte(ecriture, { type: 'local', identifiant: 'admin', nom: 'Rachel Martin', adresse: 'rachel.martin@entreprise.fr', profilRh: 'rh_admin' }, null);
    await ecriture.setSetting('confidentialite', { responsable: 'EPC France', dpo: 'dpo@entreprise.fr' });
    const vide = await controler();
    assert.deepEqual(vide.filter(c => c.niveau !== 'ok'), [], 'base vide avec un administrateur : conforme');
    await seedDemo(ecriture);
    const demo = await controler();
    const bloquants = demo.filter(c => c.niveau === 'bloquant');
    assert.deepEqual(bloquants.map(c => c.code), ['base.demo']);
    // Réglage demo posé par le chargement (lot 8, chantier A), puis les indices du jeu fictif.
    assert.match(bloquants[0].message, /^Données de démonstration présentes : réglage demo \(jeu chargé le \d{4}-\d{2}-\d{2}\), 25 comptes du jeu de démonstration, 24 fiches à une adresse @entreprise\.example, lot de paie historique « Démonstration »\.$/);
  } finally {
    await ecriture.fermer();
    await surServeur(url, `DROP OWNED BY ${role}; DROP ROLE ${role}`);
  }
});

// — Lot 8, chantier E : délais du serveur (connexion, verrou, requête) et réponse « Cursus est occupé » —

test('délais PostgreSQL : valeurs par défaut (5 s, 30 s, 60 s), réglables par variable, 0 sans limite', async () => {
  const { DELAIS_PG, delaisPg } = await import('../server/src/db-pg.ts');
  assert.deepEqual(delaisPg({}), { connexion: 5000, verrou: 30_000, requete: 60_000 });
  assert.deepEqual(delaisPg({}), { ...DELAIS_PG });
  assert.deepEqual(delaisPg({ CURSUS_PG_DELAI_CONNEXION_MS: '2000', CURSUS_PG_DELAI_VERROU_MS: '0', CURSUS_PG_DELAI_REQUETE_MS: ' 90000 ' }), { connexion: 2000, verrou: 0, requete: 90_000 });
  // Valeur illisible : le défaut (jamais « sans limite » par erreur de saisie).
  assert.deepEqual(delaisPg({ CURSUS_PG_DELAI_VERROU_MS: '30s', CURSUS_PG_DELAI_REQUETE_MS: '-1' }), { connexion: 5000, verrou: 30_000, requete: 60_000 });
  // Délai dépassé : verrou (55P03), requête (57014), connexion du pool ; le reste n'est pas « occupé ».
  const { estOccupe } = await import('../server/src/erreurs.ts');
  assert.ok(estOccupe({ code: '55P03' }) && estOccupe({ code: '57014' }) && estOccupe(new Error('timeout exceeded when trying to connect')));
  assert.ok(!estOccupe(new Error('relation absente')) && !estOccupe({ code: '23505' }) && !estOccupe(null));
});

test('délais posés sur chaque connexion du pool (rétablis après les migrations) ; requête trop longue interrompue', SEUL, async () => {
  const { estOccupe } = await import('../server/src/erreurs.ts');
  const db = (await nouvelleBase({ CURSUS_PG_DELAI_VERROU_MS: '1500', CURSUS_PG_DELAI_REQUETE_MS: '300' })) as Pg;
  // Connexion qui a servi aux migrations (délais levés pendant) : rendue avec les délais du pool.
  assert.deepEqual(await db.one('SHOW lock_timeout'), { lock_timeout: '1500ms' });
  assert.deepEqual(await db.one('SHOW statement_timeout'), { statement_timeout: '300ms' });
  await assert.rejects(db.query('SELECT pg_sleep(1)'), (e: unknown) => estOccupe(e) && (e as { code: string }).code === '57014');
  // Dans une transaction : annulée, rien d'écrit.
  await assert.rejects(db.tx(async () => { await db.setSetting('essai', 1); await db.query('SELECT pg_sleep(1)'); }), estOccupe);
  assert.equal(await db.getSetting('essai', 0), 0);
});

test('verrou d’écriture tenu par une autre instance au-delà de lock_timeout : suite exclusive et transaction refusées (55P03)', SEUL, async () => {
  const { estOccupe } = await import('../server/src/erreurs.ts');
  const { url, schema } = await schemaNeuf();
  const a = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '2' } });
  const b = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '2', CURSUS_PG_DELAI_VERROU_MS: '300' } });
  try {
    let rendre!: () => void;
    const tenu = new Promise<void>(ok => { rendre = ok; });
    const longue = a.exclusif(async () => { await tenu; });
    await pause(50);
    const t = Date.now();
    await assert.rejects(b.exclusif(async () => await b.setSetting('essai', 1)), (e: unknown) => estOccupe(e) && (e as { code: string }).code === '55P03');
    await assert.rejects(b.tx(async () => await b.setSetting('essai', 2)), estOccupe);
    assert.ok(Date.now() - t < 5000, 'refus au bout de lock_timeout, pas d’attente sans fin');
    // Lecture : servie malgré le verrou.
    assert.equal(await b.lecture(async () => await b.getSetting('essai', 0)), 0);
    rendre();
    await longue;
    await b.setSetting('essai', 3);
    assert.equal(await a.getSetting('essai', 0), 3);
  } finally {
    await a.fermer();
    await b.fermer();
  }
});

test('lectures simultanées limitées à la moitié du pool : les écritures et les lectures courtes gardent leurs connexions', SEUL, async () => {
  // Pool de 3 : une seule lecture stable à la fois, la suivante attend en mémoire ; une transaction passe pendant ce temps.
  const db = (await nouvelleBase({ CURSUS_PG_POOL: '3', CURSUS_PG_DELAI_CONNEXION_MS: '500' })) as Pg;
  let rendre!: () => void;
  const fin = new Promise<void>(ok => { rendre = ok; });
  const ordre: string[] = [];
  const premiere = db.lecture(async () => { await db.count('journal'); await fin; ordre.push('première'); });
  await pause(30);
  const seconde = db.lecture(async () => { ordre.push('seconde'); return await db.count('journal'); });
  await pause(30);
  assert.equal(db.placesLecture.enAttente, 1);
  // Les deux connexions restantes servent les écritures, sans attendre la fin des lectures.
  await Promise.all([db.tx(async () => await db.setSetting('a', 1)), db.setSetting('b', 2)]);
  // Lecture courte (identité de la requête) : sans place, elle passe aussi.
  assert.equal(await db.lecture(async () => await db.getSetting('a', 0), { courte: true }), 1);
  assert.deepEqual(ordre, []);
  rendre();
  await premiere;
  await seconde;
  assert.deepEqual(ordre, ['première', 'seconde']);
  assert.equal(db.placesLecture.enAttente, 0);
});

// — Lot 8, chantier E, étape 2 : file des écritures de l'instance —

test('écritures de l’instance une à une en mémoire, sans connexion en attente ; au-delà du délai du verrou : 55P03, rien d’écrit', SEUL, async () => {
  const db = (await nouvelleBase({ CURSUS_PG_POOL: '4', CURSUS_PG_DELAI_VERROU_MS: '300' })) as Pg;
  let rendre!: () => void;
  const fin = new Promise<void>(ok => { rendre = ok; });
  const longue = db.tx(async () => { await db.setSetting('longue', 1); await fin; });
  await pause(30);
  // Cinq écritures attendent leur tour en mémoire : le pool garde ses connexions pour les lectures.
  const attente = Promise.all([1, 2, 3, 4, 5].map(async i => await db.tx(async () => await db.setSetting(`e${i}`, i)).then(() => 'faite', (e: { code?: string }) => e.code)));
  await pause(30);
  assert.equal(db.fileEcritures.enAttente, 5);
  assert.equal(await db.lecture(async () => await db.count('journal')), 0, 'lecture servie');
  assert.equal(db.pool.waitingCount, 0);
  // Au-delà du délai du verrou (300 ms) : refus 55P03, comme le serveur (503 « Cursus est occupé »).
  assert.deepEqual(await attente, ['55P03', '55P03', '55P03', '55P03', '55P03']);
  assert.equal(db.fileEcritures.enAttente, 0);
  rendre();
  await longue;
  for (const i of [1, 2, 3, 4, 5]) assert.equal(await db.getSetting(`e${i}`, 0), 0, 'rien d’écrit');
  // Ordre gardé après les refus ; suite exclusive dans la même file.
  const ordre: string[] = [];
  await Promise.all([db.tx(async () => { ordre.push('a'); }), db.exclusif(async () => { ordre.push('b'); }), db.tx(async () => { ordre.push('c'); })]);
  assert.deepEqual(ordre, ['a', 'b', 'c']);
});
