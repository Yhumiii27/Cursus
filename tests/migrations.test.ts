// Tests des migrations nommées (server/src/migrations/) : base neuve, base existante notée à jour sans être modifiée,
// base mise à jour par une version plus récente refusée avant toute écriture (serveur compris), migration interrompue
// annulée, reconstruction d'une table (colonne renommée ou supprimée, contrainte ajoutée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-07';
delete process.env.CURSUS_BACKUP_DIR; // copies à côté de chaque base de test
delete process.env.CURSUS_BACKUP_KEEP;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations, controlerMigrations, MigrationError, migrationsEnregistrees, verifierListe } = await import('../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { colonneExiste, indexExiste, reconstruireTable } = await import('../server/src/migrations/outils.ts');
const { fichierVerrou, listerSauvegardes } = await import('../server/src/sauvegarde.ts');
type Db = InstanceType<typeof Db>;
type Migration = (typeof MIGRATIONS)[number];
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const INDEX = ['journal_at', 'journal_action', 'envois_file', 'demandes_keystone_ref', 'missions_ref', 'taches_ref'];

async function dansDossier(fn: (dir: string) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-migrations-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const copies = (dir: string) => listerSauvegardes(join(dir, 'backups')).filter(c => c.motif === 'avant-migration');
const lignes = (db: Db) => (db.sql.prepare('SELECT nom, executee FROM migrations ORDER BY rowid').all() as { nom: string; executee: number }[]).map(r => ({ ...r }));
/** Contenu complet d'une base (tables et index, lignes de chaque table), hors table des migrations. */
function contenu(sql: DatabaseSync): string {
  const objets = sql.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'migrations%' AND name NOT LIKE 'sqlite_autoindex_migrations%' ORDER BY name`).all() as { type: string; name: string }[];
  return JSON.stringify(objets.map(o => (o.type === 'table' ? { ...o, lignes: sql.prepare(`SELECT * FROM "${o.name}" ORDER BY rowid`).all() } : o)));
}
/**
 * Base telle que l'a laissée la version précédente : données, reprises faites (server/src/migrate.ts), index créés à
 * chaque démarrage, aucune table des migrations.
 */
function baseAnterieure(file: string, { sansIndex = [] as string[] } = {}) {
  const db = new Db(file);
  seedDemo(db);
  migrate(db);
  for (const m of MIGRATIONS) m.executer(db);
  for (const i of sansIndex) db.sql.exec(`DROP INDEX ${i}`);
  db.sql.close();
}

test('liste des migrations : noms bien formés, uniques et préfixés par le lot', () => {
  verifierListe(MIGRATIONS);
  assert.ok(MIGRATIONS.every(m => /^lot\d+-[a-z0-9]+(-[a-z0-9]+)+$/.test(m.nom)), MIGRATIONS.map(m => m.nom).join(', '));
  assert.throws(() => verifierListe([...MIGRATIONS, MIGRATIONS[0]]), /déclarée deux fois/);
  assert.throws(() => verifierListe([{ nom: 'Lot4 Paie', executer: () => {} }]), /mal nommée/);
});

test('base neuve : migrations exécutées et enregistrées une seule fois, sans copie de sécurité', () => dansDossier(dir => {
  const file = join(dir, 'cursus.db');
  const db = new Db(file);
  assert.equal(db.neuve, true);
  assert.deepEqual(appliquerMigrations(db), MIGRATIONS.map(m => m.nom));
  assert.ok(INDEX.every(i => indexExiste(db, i)), 'index créés');
  assert.deepEqual(lignes(db), MIGRATIONS.map(m => ({ nom: m.nom, executee: 1 })));
  assert.deepEqual(appliquerMigrations(db), [], 'rien à refaire');
  db.sql.close();
  const encore = new Db(file);
  assert.equal(encore.neuve, false);
  assert.deepEqual(appliquerMigrations(encore), []);
  encore.sql.close();
  assert.equal(copies(dir).length, 0, 'aucune copie pour une base neuve ou à jour');
  // Aucun numéro de version global : les noms suffisent.
  const sql = new DatabaseSync(file, { readOnly: true });
  assert.equal((sql.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 0);
  sql.close();
}));

test('base existante antérieure au cadre : notée à jour sans être modifiée, puis seules les migrations utiles s’exécutent', () => dansDossier(dir => {
  const file = join(dir, 'cursus.db');
  baseAnterieure(file);
  const avant = new DatabaseSync(file, { readOnly: true });
  const etat = contenu(avant);
  avant.close();
  // Démarrage comme server/src/index.ts : contrôle, schéma, reprises, migrations nommées.
  controlerMigrations(file);
  const db = new Db(file);
  migrate(db);
  assert.deepEqual(appliquerMigrations(db), [], 'aucune migration exécutée');
  assert.deepEqual(lignes(db), MIGRATIONS.map(m => ({ nom: m.nom, executee: 0 })), 'toutes notées faites');
  db.sql.close();
  const apres = new DatabaseSync(file, { readOnly: true });
  assert.equal(contenu(apres), etat, 'données, tables et index inchangés');
  apres.close();
  assert.equal(copies(dir).length, 0, 'aucune copie : la base n’a pas été modifiée');

  // Base plus ancienne, sans l'index de la file d'envoi : seule la migration qui le crée s'exécute, après une copie.
  const ancienne = join(dir, 'ancienne.db');
  baseAnterieure(ancienne, { sansIndex: ['envois_file'] });
  const db2 = new Db(ancienne);
  assert.deepEqual(appliquerMigrations(db2), ['lot4-exploitation-index-envois']);
  assert.ok(indexExiste(db2, 'envois_file'));
  assert.deepEqual(lignes(db2).filter(l => l.executee).map(l => l.nom), ['lot4-exploitation-index-envois']);
  db2.sql.close();
  assert.equal(listerSauvegardes(join(dir, 'backups')).filter(c => c.base === 'ancienne' && c.motif === 'avant-migration').length, 1);
}));

test('base mise à jour par une version plus récente : refusée avant toute écriture, avec la copie à restaurer', async () => dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  // Base de la version plus récente : une migration inconnue de ce code, et une table qui n'a pas encore toutes les
  // colonnes de ce code (l'ouvrir les ajouterait).
  const sql = new DatabaseSync(file);
  sql.exec(`CREATE TABLE employes (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT);
    CREATE TABLE migrations (nom TEXT PRIMARY KEY, appliquee TEXT NOT NULL, executee INTEGER NOT NULL);`);
  sql.prepare('INSERT INTO migrations VALUES (?, ?, 1)').run(MIGRATIONS[0].nom, '2027-01-01T00:00:00Z');
  sql.prepare('INSERT INTO migrations VALUES (?, ?, 1)').run('lot9-futur-colonne-renommee', '2027-03-01T00:00:00Z');
  sql.close();
  mkdirSync(join(dir, 'backups'));
  const copie = join(dir, 'backups', 'cursus-2027-03-01T020000Z-avant-migration.db');
  writeFileSync(copie, '');

  assert.throws(() => controlerMigrations(file), (e: unknown) => e instanceof MigrationError
    && /version plus récente de Cursus \(1 migration inconnue de cette version : lot9-futur-colonne-renommee\)/.test(e.message)
    && /restaurer la copie avant-migration/.test(e.message) && e.message.includes(copie));

  // Serveur : refus au démarrage (code 1, pour systemd), base intacte, verrou retiré.
  const env = { ...process.env, CURSUS_DB: file, CURSUS_API_PORT: '0', CURSUS_HOST: '127.0.0.1' };
  const srv = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'], { cwd: RACINE, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(srv.status, 1, srv.stdout + srv.stderr);
  assert.match(srv.stderr, /Démarrage impossible : la base a été mise à jour par une version plus récente de Cursus[\s\S]*restaurer la copie avant-migration/);
  const lu = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual((lu.prepare('PRAGMA table_info(employes)').all() as { name: string }[]).map(c => c.name), ['id', 'nom'], 'aucune colonne ajoutée');
  assert.equal(migrationsEnregistrees(lu).length, 2);
  lu.close();
  assert.equal(copies(dir).length, 1, 'aucune nouvelle copie');
  assert.ok(!existsSync(fichierVerrou(file)), 'verrou retiré');
  // npm run comptes : même refus.
  const cli = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/comptes-cli.ts', 'admin', 'rh@exemple.fr'], { cwd: RACINE, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Commande impossible : la base a été mise à jour par une version plus récente/);

  // Base ouverte malgré tout (contrôle préalable impossible) : appliquerMigrations refuse aussi.
  const db = new Db(file);
  assert.throws(() => appliquerMigrations(db), (e: unknown) => e instanceof MigrationError && /lot9-futur-colonne-renommee/.test(e.message));
  db.sql.close();
}));

test('migration interrompue : ses modifications sont annulées, les précédentes restent faites, elle est retentée ensuite', () => dansDossier(dir => {
  const file = join(dir, 'cursus.db');
  baseAnterieure(file);
  const db = new Db(file);
  appliquerMigrations(db);
  const nom = (id: number) => db.get<{ nom: string }>('employes', id)!.nom;
  const nom2 = nom(2);
  let troisieme = 0;
  const liste = (echoue: boolean): Migration[] => [
    ...MIGRATIONS,
    { nom: 'essai-premiere', executer: d => { d.update('employes', 1, { nom: 'Premier' }); } },
    {
      nom: 'essai-interrompue',
      executer: d => {
        d.update('employes', 2, { nom: 'Jamais' });
        d.sql.exec('CREATE TABLE essai (x INTEGER)');
        if (echoue) throw new Error('valeur inattendue');
        return 'reprise faite';
      },
    },
    { nom: 'essai-suivante', executer: () => { troisieme++; } },
  ];
  assert.throws(() => appliquerMigrations(db, liste(true)), (e: unknown) => e instanceof MigrationError
    && /migration essai-interrompue interrompue, aucune de ses modifications n’est conservée \(valeur inattendue\)/.test(e.message));
  assert.equal(nom(1), 'Premier', 'migration précédente conservée');
  assert.equal(nom(2), nom2, 'modification annulée');
  assert.ok(!db.sql.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'essai'`).get(), 'table créée puis annulée');
  assert.equal(troisieme, 0, 'les suivantes ne sont pas lancées');
  assert.deepEqual(lignes(db).map(l => l.nom).slice(-1), ['essai-premiere']);
  assert.equal(copies(dir).length, 1, 'copie avant-migration faite avant la première');
  assert.ok(!db.sql.isTransaction, 'aucune transaction laissée ouverte');
  // Démarrage suivant (cause corrigée) : la migration interrompue et les suivantes s'exécutent.
  assert.deepEqual(appliquerMigrations(db, liste(false)), ['essai-interrompue', 'essai-suivante']);
  assert.equal(nom(2), 'Jamais');
  assert.equal(troisieme, 1);
  db.sql.close();
}));

test('reconstruction d’une table : colonne renommée et supprimée, contrainte ajoutée, index et compteur conservés', () => dansDossier(dir => {
  const file = join(dir, 'cursus.db');
  const ancienne = new DatabaseSync(file);
  ancienne.exec(`CREATE TABLE budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, exercice INTEGER, equipe TEXT, somme REAL, obsolete TEXT);
    CREATE INDEX budgets_equipe ON budgets (equipe);
    INSERT INTO budgets (exercice, equipe, somme, obsolete) VALUES (2026, 'Production', 1000, 'x'), (2026, 'Maintenance', 500, 'y'), (2027, 'Production', 1, 'z');
    DELETE FROM budgets WHERE id = 3;`);
  ancienne.close();
  const db = new Db(file); // le schéma déclaratif ajoute `montant`, vide
  assert.ok(colonneExiste(db, 'budgets', 'montant') && colonneExiste(db, 'budgets', 'somme'));
  assert.throws(() => reconstruireTable(db, 'budgets'), /hors transaction/);
  const renommer: Migration = {
    nom: 'essai-budgets-montant',
    necessaire: d => colonneExiste(d, 'budgets', 'somme'),
    executer: d => `${reconstruireTable(d, 'budgets', { depuis: { montant: 'somme' }, ligne: r => ({ ...r, equipe: String(r.equipe).toUpperCase() }) })} lignes`,
  };
  assert.deepEqual(appliquerMigrations(db, [renommer]), ['essai-budgets-montant']);
  assert.deepEqual(db.columns('budgets'), ['id', 'exercice', 'equipe', 'montant']);
  assert.deepEqual(db.all<{ id: number; equipe: string; montant: number }>('budgets').map(b => [b.id, b.equipe, b.montant]), [[1, 'PRODUCTION', 1000], [2, 'MAINTENANCE', 500]]);
  assert.ok(indexExiste(db, 'budgets_equipe'), 'index recréé');
  assert.throws(() => db.insert('budgets', { exercice: 2026, equipe: 'PRODUCTION', montant: 1 }), /UNIQUE/, 'contrainte de TABLES appliquée');
  assert.equal(db.insert<{ id: number }>('budgets', { exercice: 2028, equipe: 'X', montant: 1 }).id, 4, 'identifiant 3 jamais réutilisé');
  assert.deepEqual(db.sql.prepare(`SELECT name FROM sqlite_sequence WHERE name LIKE 'budgets%'`).all().map(r => r.name), ['budgets']);
  db.sql.close();

  // Lignes qui violent la nouvelle contrainte : migration annulée, table intacte.
  const doublons = join(dir, 'doublons.db');
  const d2 = new DatabaseSync(doublons);
  d2.exec(`CREATE TABLE budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, exercice INTEGER, equipe TEXT, somme REAL);
    INSERT INTO budgets (exercice, equipe, somme) VALUES (2026, 'Production', 1), (2026, 'Production', 2);`);
  d2.close();
  const db2 = new Db(doublons);
  assert.throws(() => appliquerMigrations(db2, [renommer]), (e: unknown) => e instanceof MigrationError && /essai-budgets-montant interrompue.*UNIQUE/.test(e.message));
  assert.ok(colonneExiste(db2, 'budgets', 'somme'));
  assert.equal(db2.count('budgets'), 2);
  assert.ok(!db2.sql.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'budgets__reconstruction'`).get());
  db2.sql.close();
}));

test('serveur : une base antérieure au cadre démarre, notée à jour sans copie', { skip: process.platform === 'win32' }, async () => dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  baseAnterieure(file);
  const env = { ...process.env, CURSUS_DB: file, CURSUS_API_PORT: '0', CURSUS_HOST: '127.0.0.1', CURSUS_DEMO: '1' };
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const sortie = await new Promise<string>((ok, ko) => {
      let out = '';
      srv.stdout.on('data', b => { out += b; if (out.includes('Cursus — API')) ok(out); });
      srv.stderr.on('data', b => { out += b; });
      srv.on('exit', code => ko(new Error(`serveur arrêté (${code}) : ${out}`)));
    });
    assert.match(sortie, new RegExp(`Migrations : ${MIGRATIONS.length} migrations notées faites sans modification`));
    assert.doesNotMatch(sortie, /Sauvegarde avant migration/);
  } finally {
    srv.kill('SIGKILL');
  }
  const lu = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(migrationsEnregistrees(lu), MIGRATIONS.map(m => m.nom));
  lu.close();
}));
