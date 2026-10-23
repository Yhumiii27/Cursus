// Reprise d'une base SQLite sur le serveur PostgreSQL (sous-étape 8.c, server/src/reprise-postgres.ts) : à blanc sans
// écriture, copie fidèle (instantané identique, identifiants et ordre gardés, séquences recalées), comptes contrôlés,
// tracée, rejouable sans effet, refus sur une base cible utilisée, une base SQLite en service ou une référence orpheline ;
// la base SQLite n'est jamais modifiée. Sur PostgreSQL seulement (npm run test:pg).
process.env.CURSUS_TODAY ??= '2026-10-10';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nouvelleBase, PG, surServeur, urlDe } from './base.ts';

const { SqliteDb } = await import('../server/src/db.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { fichierVerrou } = await import('../server/src/sauvegarde.ts');
const R = await import('../server/src/reprise-postgres.ts');
type Db = import('../server/src/db.ts').Db;
type PgDb = import('../server/src/db-pg.ts').PgDb;

const SANS_PG = !PG && 'reprise vers PostgreSQL : npm run test:pg';
const dir = mkdtempSync(join(tmpdir(), 'cursus-reprise-test-'));
let n = 0;

/** Base SQLite de démonstration à jour (migrations nommées appliquées), avec ses comptes ; `avant` : retouches. */
async function sourceDemo(avant?: (db: InstanceType<typeof SqliteDb>) => Promise<void>): Promise<string> {
  const f = join(dir, `source-${++n}.db`);
  const db = new SqliteDb(f);
  await migrate(db);
  await appliquerMigrations(db);
  await seedDemo(db);
  await comptesDemo(db);
  if (avant) await avant(db);
  await db.fermer();
  return f;
}

/** Base cible neuve, comme au premier démarrage du serveur (migrations PostgreSQL et amorçages). */
async function cible(): Promise<PgDb> {
  const db = await nouvelleBase() as PgDb;
  await mettreAJourBase(db);
  return db;
}

const empreinte = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

/** Instantané complet vu par le service RH (toutes les tables lues par l'application). */
async function instantane(db: Db) {
  const c = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL ORDER BY id LIMIT 1'))!;
  const rh = (await currentUser(db, { compteId: c.id, role: 'rh', methode: 'demo' }))!;
  return JSON.parse(JSON.stringify(await loadFull(db, rh)));
}

test('à blanc : contrôles et comptes donnés, rien d’écrit ; la base SQLite intacte', { skip: SANS_PG }, async () => {
  const src = await sourceDemo();
  const avant = empreinte(src);
  const db = await cible();
  const cr = await R.reprendreSurPostgres(src, db, { aBlanc: true });
  assert.equal(cr.statut, 'a-blanc');
  assert.equal(cr.tables.employes, 24);
  assert.ok(cr.lignes > 400);
  assert.equal(await db.count('employes'), 0);
  assert.equal(await db.count('journal'), 0);
  assert.ok(await db.count('horaires') > 0, 'amorçages de la base neuve gardés');
  assert.equal(empreinte(src), avant);
});

test('reprise : instantané identique, identifiants, ordre et séquences gardés, tracée une fois, rejouée sans effet', { skip: SANS_PG }, async () => {
  const src = await sourceDemo(async s => {
    // Ordre d'insertion d'un référentiel différent de l'ordre des codes : gardé par la colonne rang.
    await s.insert('formations', { id: 'AAA-DERNIERE', nom: 'Ajoutée en dernier', type: 'Interne', validite: 0, validation: 'presence' });
    // Liste d'attente d'une session complète (lot 7, t120) : reprise avec ses clés étrangères (0007_formations.sql).
    await s.insert('attentesSession', {
      sessionId: 2, empId: 2, demandeId: null, certId: null, inscriptionId: 4, rang: 1, le: '2026-10-06', par: 'Sandrine Vidal', statut: 'retire',
      proposeeLe: null, issueLe: '2026-10-08', issuePar: 'Sandrine Vidal', issue: 'rh',
    });
    // Passeport de prévention (lot 7, t066) : ligne déclarée, reprise avec ses clés étrangères (0009_passeport_prevention.sql).
    await s.insert('declarationsPasseport', { empId: 2, certId: 5, suivieId: null, declareLe: '2026-10-09', le: '2026-10-09', auteur: 'Sarah Cohen', auteurId: 23 });
  });
  const avant = empreinte(src);
  const db = await cible();
  const cr = await R.reprendreSurPostgres(src, db);
  assert.equal(cr.statut, 'faite');
  assert.equal(empreinte(src), avant, 'base SQLite jamais modifiée');
  // Comparaison avec une autre copie de la source, ouverte comme le ferait Cursus.
  const temoin = join(dir, `temoin-${n}.db`);
  copyFileSync(src, temoin);
  const s = new SqliteDb(temoin);
  await migrate(s);
  await appliquerMigrations(s);
  const attendu = await instantane(s), obtenu = await instantane(db);
  // `revision` : horodatage du calcul de l'instantané, pas une donnée.
  for (const k of Object.keys(attendu).filter(k => k !== 'revision')) assert.deepEqual(obtenu[k], attendu[k], k);
  assert.equal((await db.all<{ id: string }>('formations', 'rowid')).at(-1)!.id, 'AAA-DERNIERE');
  for (const t of ['employes', 'feuilles', 'journal', 'comptes'] as const) assert.equal(await db.count(t) - (t === 'journal' ? 1 : 0), await s.count(t), t);
  await s.fermer();
  // Séquences recalées : une nouvelle fiche et une nouvelle formation viennent après les reprises.
  const e = await db.insert<{ id: number }>('employes', { nom: 'Après Reprise', entree: '2026-10-12', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' });
  assert.equal(e.id, 25);
  await db.insert('formations', { id: 'ZZZ-APRES', nom: 'Après la reprise', type: 'Interne', validite: 0, validation: 'presence' });
  assert.equal((await db.all<{ id: string }>('formations', 'rowid')).at(-1)!.id, 'ZZZ-APRES');
  const j = (await db.query<{ message: string; payload: Record<string, unknown> }>(`SELECT message, payload FROM journal WHERE action = '${R.ACTION_REPRISE}'`));
  assert.equal(j.length, 1);
  assert.match(j[0].message, /^Reprise de la base SQLite source-\d+\.db : \d+ lignes dans \d+ tables, comptes contrôlés$/);
  assert.equal(j[0].payload.lignes, cr.lignes);
  // Rejouée : rien ne change, même après usage de la base.
  const encore = await R.reprendreSurPostgres(src, db);
  assert.equal(encore.statut, 'deja-faite');
  assert.match(encore.deja!.message, /^Reprise de la base SQLite/);
  assert.equal(await db.count('employes'), 25);
});

test('refus : base cible déjà utilisée, base SQLite en service ou introuvable ; rien d’écrit', { skip: SANS_PG }, async () => {
  const src = await sourceDemo();
  const db = await cible();
  await db.insert('employes', { nom: 'Déjà Là', entree: '2026-01-05', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h' });
  await assert.rejects(R.reprendreSurPostgres(src, db), (e: unknown) => e instanceof R.RepriseError && /contient déjà des données \(employes \(1\)\)/.test(e.message));
  assert.equal(await db.count('employes'), 1);
  // Serveur SQLite en service (verrou d'un processus vivant : celui du test).
  const db2 = await cible();
  writeFileSync(fichierVerrou(src), JSON.stringify({ pid: process.pid, depuis: new Date().toISOString() }));
  await assert.rejects(R.reprendreSurPostgres(src, db2), /est en service \(processus \d+/);
  assert.equal((await R.reprendreSurPostgres(src, db2, { ignorerVerrou: true, aBlanc: true })).statut, 'a-blanc');
  await assert.rejects(R.reprendreSurPostgres(join(dir, 'absente.db'), db2), /Base SQLite introuvable/);
  assert.equal(await db2.count('employes'), 0);
});

test('valeurs : « aucun » de référence et dates vides écrites NULL, comptées ; référence orpheline ou date illisible refusées', { skip: SANS_PG }, async () => {
  const src = await sourceDemo(async s => {
    await s.exec(`UPDATE employes SET poste_id = 0 WHERE id = 3; UPDATE employes SET equipe = '' WHERE id = 23; UPDATE employes SET fin_prevue = '' WHERE id = 2`);
  });
  const db = await cible();
  const cr = await R.reprendreSurPostgres(src, db);
  assert.deepEqual(cr.aucunVersNull, { 'employes.poste_id': 1, 'employes.equipe': 1 });
  assert.deepEqual(cr.videsVersNull, { 'employes.fin_prevue': 1 });
  const e = (await db.get<{ posteId: number | null; equipe: string | null }>('employes', 3))!;
  assert.equal(e.posteId, null);
  // Orpheline (salarié absent) et date illisible : refus détaillé avant toute écriture.
  const mauvaise = await sourceDemo(async s => {
    await s.exec(`INSERT INTO certifications (emp_id, f, obtenue) VALUES (999, 'sst', '2026-01-01'); UPDATE absences SET du = '12/10/2026' WHERE id = 1`);
  });
  const db2 = await cible();
  await assert.rejects(R.reprendreSurPostgres(mauvaise, db2), (err: unknown) => err instanceof R.RepriseError
    && /certifications\.emp_id → employes : 1 référence sans ligne visée \(999\)/.test(err.message)
    && /absences\.du \(ligne 1\) : « 12\/10\/2026 » n’est pas une date AAAA-MM-JJ/.test(err.message));
  assert.equal(await db2.count('employes'), 0);
});

// — Ligne de commande (server/src/reprise-postgres-cli.ts) —
const CLI = join(import.meta.dirname, '..', 'server', 'src', 'reprise-postgres-cli.ts');
const lancer = (args: string[], env: Record<string, string>) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args],
  { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', CURSUS_TODAY: '2026-10-10', ...env } });

test('commande : usage, DATABASE_URL exigée', async () => {
  let r = lancer(['--oui'], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Option inconnue : --oui\nUsage : DATABASE_URL=/);
  r = lancer([], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DATABASE_URL \(serveur PostgreSQL de destination\) est absente/);
});

test('commande : à blanc, reprise, puis « déjà faite » ; refus sans rien écrire', { skip: SANS_PG }, async () => {
  const admin = process.env.CURSUS_TEST_DATABASE_URL!;
  const nom = `cursus_cli_${process.pid}`;
  await surServeur(admin, `DROP DATABASE IF EXISTS "${nom}"`);
  await surServeur(admin, `CREATE DATABASE "${nom}" TEMPLATE template0 ENCODING 'UTF8'`);
  const url = urlDe(admin, nom);
  try {
    await surServeur(url, 'CREATE SCHEMA cursus');
    const src = await sourceDemo();
    const env = { DATABASE_URL: url, CURSUS_DB: src, CURSUS_PIECES_DIR: join(dir, 'pieces-cli') };
    let r = lancer(['--a-blanc'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Reprise à blanc \(rien n’a été écrit\) depuis .*source-\d+\.db\n {2}\d+ lignes dans \d+ tables, comptes identiques table par table :\n/);
    assert.match(r.stdout, /employes +24\n/);
    assert.match(r.stdout, /Relancez sans --a-blanc/);
    assert.equal((await surServeur<{ n: number }>(url, 'SELECT count(*)::int AS n FROM cursus.employes'))[0].n, 0);
    r = lancer([src], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Reprise faite depuis/);
    assert.match(r.stdout, /posez le partage \(20-cursus\.sql, 90-droits\.sql, 95-matrix-journal-unifie\.sql\)/);
    assert.equal((await surServeur<{ n: number }>(url, 'SELECT count(*)::int AS n FROM cursus.employes'))[0].n, 24);
    r = lancer([], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Reprise déjà faite le .* : Reprise de la base SQLite source-\d+\.db : .* Rien n’a été modifié\.\n$/);
    r = lancer([join(dir, 'absente.db')], { ...env, DATABASE_URL: url });
    assert.equal(r.status, 0, 'déjà faite : la source n’est plus lue');
    await surServeur(url, `DELETE FROM cursus.journal WHERE action = '${R.ACTION_REPRISE}'`);
    r = lancer([join(dir, 'absente.db')], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^Reprise refusée : Base SQLite introuvable : .*absente\.db\nLa base PostgreSQL n’a pas été modifiée/);
  } finally {
    await surServeur(admin, `DROP DATABASE IF EXISTS "${nom}" WITH (FORCE)`);
  }
});
