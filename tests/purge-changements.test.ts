// Journal des changements en base (lot 9, chantier 1, étape 2), sur les deux moteurs :
// - purge planifiée (`purgerChangements`, tâches du quart d'heure) : au moins une heure et 20 000 révisions gardées ;
//   un delta parti d'en deçà de la purge rend null (repli : relecture complète), un delta parti d'au-delà reste exact ;
//   la purge ne recule jamais et ne périme pas le cache (révision inchangée) ; sur SQLite (une seule instance), la
//   purge n'attend pas de relevé d'une heure ;
// - époque : `changerEpoque` (npm run revision:epoque) fait rendre null à tout écart qui la traverse ; sur PostgreSQL,
//   l'époque compte l'OID de la table `revision` : une table recréée (pg_restore) change d'époque sans rien écrire ;
// - controlerSchema refuse un schéma sans la table `changements`, sans les colonnes de `revision`, ou dont une table a
//   perdu (ou désactivé, ou passé en mode réplication) un de ses déclencheurs `revision_lignes_*` ou `revision` ;
// - les migrations PostgreSQL publiées sont intactes (empreintes figées : une migration publiée ne se modifie jamais).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.CURSUS_DEMO;

const { PG, nouvelleBase } = await import('./base.ts');
const { openSqlite } = await import('../server/src/db.ts');
const { DECLENCHEURS_CHANGEMENTS, migrationsPg } = await import('../server/src/db-pg.ts');
const { changerEpoque, GARDE_MS, GARDE_REVISIONS, purgerChangements } = await import('../server/src/purge-changements.ts');
const { tachesEmails } = await import('../server/src/notifications.ts');
const { RACINE } = await import('../server/src/chemins.ts');
type Db = import('../server/src/db.ts').Db;
type Pg = import('../server/src/db-pg.ts').PgDb;
type Changements = import('../server/src/db.ts').Changements;

const SEUL_PG = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
const T = Date.parse('2026-10-10T08:00:00Z');

const enClair = (c: Changements | null) => c && Object.fromEntries([...c].sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => [t, v === 'tout' ? v : [...v].sort()]));
const lignesJournal = async (db: Db) => Number((await db.one<{ c: number }>('SELECT COUNT(*) AS c FROM changements'))!.c);
const plusPetit = async (db: Db) => Number((await db.one<{ n: number | null }>('SELECT MIN(n) AS n FROM changements'))?.n ?? 0);
/** `k` révisions sans ligne changée (SQL direct sur `revision`, sans déclencheur) : une longue activité, en un instant. */
const avancer = async (db: Db, k: number) => { await db.run('UPDATE revision SET n = n + ?', [k]); };

test('purge à plusieurs instances : au moins une heure et 20 000 révisions gardées ; delta parti d’en deçà = repli, d’au-delà = exact', async () => {
  const db = await nouvelleBase();
  const a = await db.insert<{ id: number }>('postes', { nom: 'A' });
  const r1 = await db.revisionBase();
  // Premier relevé : rien d'assez ancien, rien n'est purgé.
  assert.deepEqual(await purgerChangements(db, T, false), { jusqua: null, lignes: 0 });
  const b = await db.insert<{ id: number }>('postes', { nom: 'B' });
  const r2 = await db.revisionBase();
  await avancer(db, GARDE_REVISIONS);
  const c = await db.insert<{ id: number }>('postes', { nom: 'C' });
  const r3 = await db.revisionBase();
  assert.deepEqual(await purgerChangements(db, T + GARDE_MS - 1, false), { jusqua: null, lignes: 0 }, 'moins d’une heure');
  // Une heure après le premier relevé : purge jusqu'à la révision de ce relevé (la borne des 20 000 révisions est au-delà).
  const avant = await lignesJournal(db);
  const p = await purgerChangements(db, T + GARDE_MS, false);
  assert.equal(p.jusqua, r1);
  assert.ok(p.lignes > 0 && p.lignes === avant - await lignesJournal(db), 'lignes effacées comptées');
  assert.ok(await plusPetit(db) > r1, 'changements jusqu’à la purge effacés');
  const etat = await db.etatRevision();
  assert.equal(etat.purge, r1);
  assert.equal(etat.n, r3, 'révision inchangée : cache non périmé');
  assert.equal(await db.lireChangements(0, r3, etat.epoque), null, 'parti d’en deçà de la purge : repli');
  assert.equal(await db.lireChangements(r1 - 1, r3), null);
  assert.deepEqual(enClair(await db.lireChangements(r1, r3, etat.epoque)), { postes: [String(b.id), String(c.id)] }, 'parti de la purge : exact');
  // Deux heures après : le relevé d'une heure porte r3, mais 20 000 révisions restent gardées (borne r3 − 20 000 = r2 + 1).
  const q = await purgerChangements(db, T + 2 * GARDE_MS, false);
  assert.equal(q.jusqua, r3 - GARDE_REVISIONS);
  assert.equal(q.jusqua, r2 + 1);
  assert.equal(await db.lireChangements(r2, r3), null, 'B purgé : repli');
  assert.deepEqual(enClair(await db.lireChangements(r2 + 1, r3)), { postes: [String(c.id)] });
  // Rien de plus à purger : la purge ne recule jamais, même avec une borne plus basse (autre instance, relevés anciens).
  assert.deepEqual(await purgerChangements(db, T + 2 * GARDE_MS + 1, false), { jusqua: null, lignes: 0 });
  await db.run('UPDATE revision SET purge = ?', [r3]);
  assert.deepEqual(await purgerChangements(db, T + 3 * GARDE_MS, false), { jusqua: null, lignes: 0 });
  assert.equal((await db.etatRevision()).purge, r3);
  assert.equal(a.id, 1);
});

test('purge : faite par les tâches du quart d’heure, dans sa propre transaction', async () => {
  const db = await nouvelleBase();
  await db.insert('postes', { nom: 'A' });
  const r1 = await db.revisionBase();
  await avancer(db, GARDE_REVISIONS + 10);
  await tachesEmails(db, 6);
  const n = await db.revisionBase();
  if (!PG) {
    // SQLite : purgé dès ce passage, 20 000 révisions gardées.
    const { purge } = await db.etatRevision();
    assert.ok(purge >= r1 && purge <= n - GARDE_REVISIONS, `purge jusqu’à ${purge}`);
  } else {
    // PostgreSQL : le relevé de ce passage sert au passage d'une heure plus tard.
    assert.equal((await db.etatRevision()).purge, 0, 'instance qui vient de démarrer : rien de purgé');
    const p = await purgerChangements(db, Date.now() + GARDE_MS + 60_000);
    assert.ok(p.jusqua !== null && p.jusqua >= r1 && p.jusqua <= n - GARDE_REVISIONS, `purge jusqu’à ${p.jusqua}`);
  }
  assert.equal(await db.lireChangements(0, n), null);
});

test('purge, instance récente au-delà de 20 000 révisions : SQLite purge tout de suite, PostgreSQL attend une heure', async () => {
  const db = await nouvelleBase();
  const a = await db.insert<{ id: number }>('postes', { nom: 'A' });
  await avancer(db, GARDE_REVISIONS + 5);
  const b = await db.insert<{ id: number }>('postes', { nom: 'B' });
  const n = await db.revisionBase();
  // Premier passage de l'instance (relevés vides, comme après chaque démarrage).
  const p = await purgerChangements(db, T);
  if (PG) {
    assert.deepEqual(p, { jusqua: null, lignes: 0 }, 'aucun relevé d’une heure : les caches des autres instances sont gardés');
    return;
  }
  assert.equal(p.jusqua, n - GARDE_REVISIONS);
  assert.ok(p.lignes > 0);
  assert.equal(await db.lireChangements(0, n), null, 'A purgé : repli');
  assert.equal(a.id, 1);
  assert.deepEqual(enClair(await db.lireChangements(n - GARDE_REVISIONS, n)), { postes: [String(b.id)] }, '20 000 révisions gardées');
  // Un démarrage suivant (relevés perdus) reprend où la purge en était, sans reculer.
  assert.deepEqual(await purgerChangements(db, T + 1), { jusqua: null, lignes: 0 });
});

test('époque : changée par npm run revision:epoque, tout écart qui la traverse rend null', async () => {
  const db = await nouvelleBase();
  await db.insert('postes', { nom: 'A' });
  const etat = await db.etatRevision();
  assert.deepEqual(enClair(await db.lireChangements(0, etat.n, etat.epoque)), { postes: ['1'] });
  const { avant, apres } = await changerEpoque(db, T);
  assert.equal(avant, etat.epoque);
  assert.notEqual(apres, avant);
  const nouvel = await db.etatRevision();
  assert.equal(nouvel.epoque, apres);
  assert.equal(nouvel.n, etat.n, 'révision inchangée');
  assert.equal(await db.lireChangements(0, etat.n, etat.epoque), null, 'ancienne époque : repli');
  assert.deepEqual(enClair(await db.lireChangements(0, etat.n, nouvel.epoque)), { postes: ['1'] });
  // Horloge en retard sur l'époque posée : l'époque avance quand même.
  const colonne = async () => Number((await db.one<{ epoque: number }>('SELECT epoque FROM revision'))!.epoque);
  const c = await colonne();
  await changerEpoque(db, c - 1000);
  assert.equal(await colonne(), c + 1);
  // SQLite : l'époque est la colonne ; PostgreSQL : la colonne augmentée de l'OID de la table `revision`.
  if (!PG) assert.equal((await db.etatRevision()).epoque, c + 1);
  else assert.ok((await db.etatRevision()).epoque > c + 1);
});

test('PostgreSQL : table revision recréée (pg_restore), même colonne mais autre OID : nouvelle époque', SEUL_PG, async () => {
  const db = await nouvelleBase() as unknown as Pg;
  await db.insert('postes', { nom: 'A' });
  const etat = await db.etatRevision();
  const colonne = Number((await db.one<{ epoque: number }>('SELECT epoque FROM revision'))!.epoque);
  const oid = Number((await db.one<{ o: number }>(`SELECT CAST(CAST(to_regclass(?) AS oid) AS bigint) AS o`, [`${db.schema}.revision`]))!.o);
  assert.equal(etat.epoque, colonne + oid);
  // Comme un pg_restore qui recrée les tables : même contenu, nouvelle table.
  await db.exec(`CREATE TABLE revision_copie (LIKE revision INCLUDING ALL);
    INSERT INTO revision_copie SELECT * FROM revision; DROP TABLE revision; ALTER TABLE revision_copie RENAME TO revision`);
  const apres = await db.etatRevision();
  assert.equal(Number((await db.one<{ epoque: number }>('SELECT epoque FROM revision'))!.epoque), colonne, 'colonne restaurée telle quelle');
  assert.equal(apres.n, etat.n);
  assert.notEqual(apres.epoque, etat.epoque, 'époque changée par l’OID');
  assert.equal(await db.lireChangements(0, etat.n, etat.epoque), null, 'écart à travers la restauration : repli');
  // Les déclencheurs suivent la nouvelle table (désignée par son nom à chaque écriture).
  await db.insert('postes', { nom: 'B' });
  assert.deepEqual(enClair(await db.lireChangements(etat.n, await db.revisionBase(), apres.epoque)), { postes: ['2'] });
  await db.controlerSchema();
});

test('PostgreSQL : controlerSchema refuse une table sans ses déclencheurs revision_lignes_*, et un journal incomplet', SEUL_PG, async () => {
  const db = await nouvelleBase() as unknown as Pg;
  await db.controlerSchema();
  await db.exec('DROP TRIGGER revision_lignes_u ON absences');
  await assert.rejects(db.controlerSchema(), /déclencheur revision_lignes_u de absences/);
  await db.exec('DROP TRIGGER revision_lignes_i ON feuilles; DROP TRIGGER revision_lignes_d ON feuilles');
  await assert.rejects(db.controlerSchema(), /déclencheurs revision_lignes_i, revision_lignes_d de feuilles/);
  // Déclencheur désactivé : refusé comme absent.
  await db.exec('ALTER TABLE postes DISABLE TRIGGER revision_lignes_t');
  await assert.rejects(db.controlerSchema(), /déclencheur revision_lignes_t de postes/);
  assert.deepEqual([...DECLENCHEURS_CHANGEMENTS], ['revision_lignes_i', 'revision_lignes_u', 'revision_lignes_d', 'revision_lignes_t']);

  // Mode réplication (ENABLE REPLICA TRIGGER) : le déclencheur ne s'exécute pas dans les sessions ordinaires
  // (session_replication_role = origin), refusé comme absent ; ENABLE ALWAYS est admis. De même pour `revision` (0013).
  const replique = await nouvelleBase() as unknown as Pg;
  await replique.exec('ALTER TABLE postes ENABLE ALWAYS TRIGGER revision_lignes_t; ALTER TABLE postes ENABLE ALWAYS TRIGGER revision');
  await replique.controlerSchema();
  await replique.exec('ALTER TABLE absences ENABLE REPLICA TRIGGER revision_lignes_u');
  await assert.rejects(replique.controlerSchema(), /déclencheur revision_lignes_u de absences/);
  await replique.exec('ALTER TABLE absences ENABLE TRIGGER revision_lignes_u');
  await replique.controlerSchema();
  await replique.exec('ALTER TABLE absences ENABLE REPLICA TRIGGER revision');
  await assert.rejects(replique.controlerSchema(), /déclencheur revision de absences/);
  await replique.exec('ALTER TABLE absences ENABLE TRIGGER revision; ALTER TABLE feuilles DISABLE TRIGGER revision');
  await assert.rejects(replique.controlerSchema(), /déclencheur revision de feuilles/);

  const autre = await nouvelleBase() as unknown as Pg;
  await autre.exec('ALTER TABLE revision DROP COLUMN epoque');
  await assert.rejects(autre.controlerSchema(), /revision\.epoque/);
  await autre.exec('DROP TABLE changements');
  await assert.rejects(autre.controlerSchema(), /table changements/);
});

test('migrations PostgreSQL publiées intactes (empreintes figées, 0001 à 0022)', () => {
  // Une migration publiée ne se modifie jamais : une nouvelle migration reçoit le numéro suivant, et son empreinte
  // s'ajoute ici une fois publiée. Fins de ligne normalisées (copie de travail sous Windows).
  const PUBLIEES: Record<string, string> = {
    '0001_init': 'f76d5fc31e823380b636b88b47dc5b4117926c0647e563773e288fed4d2493ac',
    '0002_partage': '7d006de17005b1ff539fd3d48e39593a4437095af7d8a6e310c91165b37440eb',
    '0003_lot6_etape2': 'f7da430064537fa870217b790b6be7ae2f2c0207f98fc1fda9e2e166986f7d01',
    '0004_pub_absences': 'a7ce408c6d6efa44ed27f358798b160ac600931fb1bddb6b8cca27a2f2492769',
    '0005_astreintes': 'e434feb942b67dde0c908d717dc7a8c5148317e2f08d43e3ba5b28d0d0a39e32',
    '0006_prevention': '76e9af4a6cda95c346318115161293d45648d0ccab865f4d1c198b70d2761728',
    '0007_formations': 'e623d26d400f5880ca7299e37589decf1e4429315c281236f7e051915c0d56eb',
    '0008_astreintes_paie': '9af81a572510dac545fb9b48f4d8b7a2882bcc29a36bb8df6a81326d3a5b1fd8',
    '0009_passeport_prevention': '2ff8f636a7c677975ce7a737bc2be98a49d9edd666e5483d7896b44bfb8e723f',
    '0010_evaluations_formation': '5d61de7d56a961e1a5c0fe938353b314bfd2d4c196dfb80108ff1b38ec634a2f',
    '0011_pub_titres_valides': '18e18f1393bcf1977b27c9222a5b72a9db9c7ca089c1740ff0c7c575d51433c2',
    '0012_pieces_chiffrees': '55cbfe0e81ff61dadd96e54740152b872c216ac1a9b9c488beb3963082fd9aa9',
    '0013_index_journal': 'c17ce42c9f43cc348dedbf22809497a4fc2419cd90f0304be252d495432de66a',
    '0014_changements': '1a107a5e67d0a673ed9e4dddb04941932c55717f61d8a58af91e710cf19d2f45',
    // lot 11 — socle commun
    '0015_lot11_socle': 'fc8a1ea20f790c7d060eede504a9a74ca23c4e80ad7f4552247d11a76b811634',
    // lot 11 — organigramme et entités
    '0016_entites': '30495dd06cf8353e920b02b125615e454e95ed8abce7c7c5be39a0582a3cd7a0',
    // lot 11 — pwa
    '0017_pwa': '75d0b9975f1280466821e313e77eeb40f371b175edac5b305cc64cef4232b9c9',
    // lot 11 — indicateurs sociaux
    '0018_indicateurs': '6e2c335f8123476e21873d592334f930cadd46cefeee230cbf04c5ac85bfd95e',
    // lot 11 — dossiers OPCO
    '0019_dossiers_opco': '163ffa3e5b8ead112791390aa9f7b7dfb7e900ed40921801b02e049a85951a9a',
    // lot 11 — notes de frais
    '0020_notes_frais': 'a6f80c29e24c6c01370b629bac909f942ff3fab0fbaabe51ef2b10a4495854ac',
    // lot 12 — socle commun
    '0021_lot12_socle': 'e9e07190fdebbc53afb5c6def2231988653a3fa497c3b26e70ff0e493493b1d4',
    // lot 12 — C1 (forfait annuel en heures)
    '0022_forfait_heures': 'ef7a7c5879db40e56aba879dccbad653abaf60cd2e032b2fada3ecb3c9130fcd',
    // lot 12 — C2 (notes de frais : activation) : index de la fenêtre des notes de frais
    '0023_frais_fenetre': 'db8e6ecc7c927084337a1a3cc106354e6efc516deac79e209cf9ac9a4af73f54',
  };
  const lues = new Map(migrationsPg().map(m => [m.nom, createHash('sha256').update(m.sql.replace(/\r\n/g, '\n')).digest('hex')]));
  for (const [nom, empreinte] of Object.entries(PUBLIEES)) assert.equal(lues.get(nom), empreinte, `${nom} modifiée ou absente`);
  const suivantes = [...lues.keys()].filter(n => !(n in PUBLIEES));
  assert.ok(suivantes.every(n => n > '0021'), `migrations nouvelles numérotées après 0021 : ${suivantes.join(', ')}`);
});

test('npm run revision:epoque : époque du fichier SQLite changée, option inconnue refusée', { skip: PG && 'commande lancée sur le fichier SQLite' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-epoque-'));
  try {
    const fichier = join(dir, 'cursus.db');
    const avant = await openSqlite(fichier);
    const e = (await avant.etatRevision()).epoque;
    await avant.fermer();
    const cli = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/revision-epoque-cli.ts', ...args],
      { cwd: RACINE, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', CURSUS_DB: fichier, CURSUS_TODAY: '2026-10-10' } });
    const refus = cli('--force');
    assert.equal(refus.status, 1);
    assert.match(refus.stderr, /Usage : npm run revision:epoque/);
    const r = cli();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Époque de la base changée \(\d+ → \d+\)/);
    const apres = await openSqlite(fichier);
    assert.ok((await apres.etatRevision()).epoque > e);
    await apres.fermer();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
