// Tests des migrations nommées (server/src/migrations/) : base neuve, base existante notée à jour sans être modifiée,
// base mise à jour par une version plus récente refusée avant toute écriture (serveur et outils compris) avec la copie à
// restaurer, retour à la version précédente, outils qui mettent la base à jour avant d'y écrire, migration interrompue
// annulée, reconstruction d'une table (colonne renommée ou supprimée, contrainte ajoutée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-07';
delete process.env.CURSUS_BACKUP_DIR; // copies à côté de chaque base de test
delete process.env.CURSUS_BACKUP_KEEP;

const { SqliteDb: Db } = await import('../server/src/db.ts');
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
/** Noms des migrations enregistrées dans un fichier de base (copie comprise), lu sans écriture. */
function enregistreesDans(fichier: string): string[] {
  const sql = new DatabaseSync(fichier, { readOnly: true });
  try { return migrationsEnregistrees(sql); } finally { sql.close(); }
}
/** Nom du salarié 1 dans un fichier de base. */
function nomEmp1(fichier: string): string {
  const sql = new DatabaseSync(fichier, { readOnly: true });
  try { return (sql.prepare('SELECT nom FROM employes WHERE id = 1').get() as { nom: string }).nom; } finally { sql.close(); }
}
/** Outil en ligne de commande (server/src/<script>) lancé sur une base. */
const outil = (env: Record<string, string>, script: string, ...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', `server/src/${script}`, ...args],
  { cwd: RACINE, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 });
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
async function baseAnterieure(file: string, { sansIndex = [] as string[] } = {}) {
  const db = new Db(file);
  await seedDemo(db);
  await migrate(db);
  for (const m of MIGRATIONS) await m.executer(db);
  for (const i of sansIndex) db.sql.exec(`DROP INDEX ${i}`);
  db.sql.close();
}

test('liste des migrations : noms bien formés, uniques et préfixés par le lot', () => {
  verifierListe(MIGRATIONS);
  assert.ok(MIGRATIONS.every(m => /^lot\d+-[a-z0-9]+(-[a-z0-9]+)+$/.test(m.nom)), MIGRATIONS.map(m => m.nom).join(', '));
  assert.throws(() => verifierListe([...MIGRATIONS, MIGRATIONS[0]]), /déclarée deux fois/);
  assert.throws(() => verifierListe([{ nom: 'Lot4 Paie', executer: () => {} }]), /mal nommée/);
});

test('base neuve : migrations exécutées et enregistrées une seule fois, sans copie de sécurité', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  const db = new Db(file);
  assert.equal(db.neuve, true);
  assert.deepEqual(await appliquerMigrations(db), MIGRATIONS.map(m => m.nom));
  assert.ok(INDEX.every(i => indexExiste(db, i)), 'index créés');
  assert.deepEqual(lignes(db), MIGRATIONS.map(m => ({ nom: m.nom, executee: 1 })));
  assert.deepEqual(await appliquerMigrations(db), [], 'rien à refaire');
  db.sql.close();
  const encore = new Db(file);
  assert.equal(encore.neuve, false);
  assert.deepEqual(await appliquerMigrations(encore), []);
  encore.sql.close();
  assert.equal(copies(dir).length, 0, 'aucune copie pour une base neuve ou à jour');
  const lue = new DatabaseSync(file, { readOnly: true });
  assert.ok(lue.prepare('SELECT copie FROM migrations').all().every(r => r.copie === null), 'base neuve : aucune copie enregistrée');
  lue.close();

  // Aucun numéro de version global : les noms suffisent.
  const sql = new DatabaseSync(file, { readOnly: true });
  assert.equal((sql.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 0);
  sql.close();
}));

test('table des migrations sans la colonne copie (version de développement du cadre) : lue, puis complétée', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  const db = new Db(file);
  await appliquerMigrations(db);
  db.sql.exec('ALTER TABLE migrations DROP COLUMN copie');
  db.sql.close();
  controlerMigrations(file);
  const suite = new Db(file);
  assert.deepEqual(await appliquerMigrations(suite, [...MIGRATIONS, { nom: 'essai-apres', executer: () => {} }]), ['essai-apres']);
  const copie = (suite.sql.prepare(`SELECT copie FROM migrations WHERE nom = 'essai-apres'`).get() as { copie: string }).copie;
  suite.sql.close();
  assert.deepEqual(copies(dir).map(c => c.fichier), [copie], 'copie faite, et enregistrée avec le nom');
}));

test('base existante antérieure au cadre : notée à jour sans être modifiée, puis seules les migrations utiles s’exécutent', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  await baseAnterieure(file);
  const avant = new DatabaseSync(file, { readOnly: true });
  const etat = contenu(avant);
  avant.close();
  // Démarrage comme server/src/index.ts : contrôle, schéma, reprises, migrations nommées.
  controlerMigrations(file);
  const db = new Db(file);
  await migrate(db);
  assert.deepEqual(await appliquerMigrations(db), [], 'aucune migration exécutée');
  assert.deepEqual(lignes(db), MIGRATIONS.map(m => ({ nom: m.nom, executee: 0 })), 'toutes notées faites');
  db.sql.close();
  const apres = new DatabaseSync(file, { readOnly: true });
  assert.equal(contenu(apres), etat, 'données, tables et index inchangés');
  apres.close();
  // Copie quand même : les noms enregistrés suffisent à faire refuser la base par une version qui ne les connaît pas.
  assert.equal(copies(dir).length, 1, 'copie avant d’enregistrer les noms');
  assert.deepEqual(enregistreesDans(copies(dir)[0].fichier), [], 'copie de la base telle qu’avant, sans aucun nom');

  // Base plus ancienne, sans l'index de la file d'envoi : seule la migration qui le crée s'exécute, après une copie.
  const ancienne = join(dir, 'ancienne.db');
  await baseAnterieure(ancienne, { sansIndex: ['envois_file'] });
  const db2 = new Db(ancienne);
  assert.deepEqual(await appliquerMigrations(db2), ['lot4-exploitation-index-envois']);
  assert.ok(indexExiste(db2, 'envois_file'));
  assert.deepEqual(lignes(db2).filter(l => l.executee).map(l => l.nom), ['lot4-exploitation-index-envois']);
  db2.sql.close();
  assert.equal(listerSauvegardes(join(dir, 'backups')).filter(c => c.base === 'ancienne' && c.motif === 'avant-migration').length, 1);
}));

test('base mise à jour par une version plus récente : refusée avant toute écriture, avec la copie à restaurer', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  // Base de la version plus récente : une migration inconnue de ce code, et une table qui n'a pas encore toutes les
  // colonnes de ce code (l'ouvrir les ajouterait).
  // Copies avant-migration : d'une mise à jour antérieure, de celle qui a enregistré la migration inconnue (enregistrée
  // avec elle, faite quand les sauvegardes étaient ailleurs), d'une mise à jour postérieure.
  mkdirSync(join(dir, 'backups'));
  const copie = (horodatage: string) => join(dir, 'backups', `cursus-${horodatage}-avant-migration.db`);
  const [anterieure, bonne, posterieure] = ['2027-01-01T020000Z', '2027-03-01T020000Z', '2027-04-01T020000Z'].map(copie);
  for (const f of [anterieure, bonne, posterieure]) writeFileSync(f, '');
  const sql = new DatabaseSync(file);
  sql.exec(`CREATE TABLE employes (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT);
    CREATE TABLE migrations (nom TEXT PRIMARY KEY, appliquee TEXT NOT NULL, executee INTEGER NOT NULL, copie TEXT);`);
  sql.prepare('INSERT INTO migrations VALUES (?, ?, 1, ?)').run(MIGRATIONS[0].nom, '2027-01-01T02:00:03Z', anterieure);
  sql.prepare('INSERT INTO migrations VALUES (?, ?, 1, ?)').run('lot9-futur-colonne-renommee', '2027-03-01T02:00:07Z', join('/ancien/emplacement', basename(bonne)));
  sql.close();

  // La copie nommée est celle enregistrée avec la première migration inconnue (retrouvée dans le dossier actuel des
  // sauvegardes), aucune autre.
  const refus = (e: unknown) => e instanceof MigrationError
    && /version plus récente de Cursus le .* \(1 migration inconnue de cette version : lot9-futur-colonne-renommee\)/.test(e.message)
    && /restaurer la copie avant-migration faite au début de cette mise à jour/.test(e.message)
    && e.message.includes(bonne) && ![anterieure, posterieure].some(f => e.message.includes(f));
  assert.throws(() => controlerMigrations(file), refus);

  // Serveur : refus au démarrage (code 1, pour systemd), base intacte, verrou retiré.
  const env = { CURSUS_DB: file, CURSUS_API_PORT: '0', CURSUS_HOST: '127.0.0.1' };
  const srv = outil(env, 'index.ts');
  assert.equal(srv.status, 1, srv.stdout + srv.stderr);
  assert.match(srv.stderr, /Démarrage impossible : la base a été mise à jour par une version plus récente de Cursus[\s\S]*restaurer la copie avant-migration/);
  const lu = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual((lu.prepare('PRAGMA table_info(employes)').all() as { name: string }[]).map(c => c.name), ['id', 'nom'], 'aucune colonne ajoutée');
  assert.equal(migrationsEnregistrees(lu).length, 2);
  lu.close();
  assert.equal(copies(dir).length, 3, 'aucune nouvelle copie');
  assert.ok(!existsSync(fichierVerrou(file)), 'verrou retiré');
  // npm run comptes et npm run reset-demo (qui efface toute la base) : même refus, rien d'écrit.
  const cli = outil(env, 'comptes-cli.ts', 'admin', 'rh@exemple.fr');
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Commande impossible : la base a été mise à jour par une version plus récente/);
  const reset = outil({ ...env, CURSUS_DEMO: '1' }, 'reset.ts', '--yes');
  assert.equal(reset.status, 1, reset.stdout + reset.stderr);
  assert.match(reset.stderr, /Réinitialisation refusée : la base a été mise à jour par une version plus récente[\s\S]*restaurer la copie avant-migration/);
  assert.deepEqual(enregistreesDans(file), [MIGRATIONS[0].nom, 'lot9-futur-colonne-renommee']);
  const intacte = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual((intacte.prepare('PRAGMA table_info(employes)').all() as { name: string }[]).map(c => c.name), ['id', 'nom'], 'aucune colonne ajoutée');
  intacte.close();
  assert.equal(listerSauvegardes(join(dir, 'backups')).length, 3, 'aucune copie avant réinitialisation');

  // Base ouverte malgré tout (contrôle préalable impossible) : appliquerMigrations refuse aussi.
  const db = new Db(file);
  await assert.rejects(async () => await appliquerMigrations(db), (e: unknown) => e instanceof MigrationError && /lot9-futur-colonne-renommee/.test(e.message));
  db.sql.close();

  // Copie de cette mise à jour supprimée depuis (étape 6 de la mise à jour, rotation) : renvoi à la sauvegarde faite
  // avant la mise à jour, jamais à une copie plus ancienne qui ferait perdre des mois de saisies.
  rmSync(bonne);
  assert.throws(() => controlerMigrations(file), (e: unknown) => e instanceof MigrationError
    && e.message.includes(`restaurer la copie avant-migration faite au début de cette mise à jour (${basename(bonne)}, introuvable : supprimée ou déplacée depuis) ; `
      + 'à défaut, restaurer la sauvegarde faite juste avant la mise à jour')
    && ![anterieure, posterieure].some(f => e.message.includes(f)));
}));

test('retour à la version précédente : chaque mise à jour qui enregistre des noms a sa copie, que la version précédente accepte', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  // Version 1 : base créée et migrée ; une copie avant-migration d'une mise à jour bien plus ancienne traîne.
  const V1 = MIGRATIONS;
  const db = new Db(file);
  await seedDemo(db);
  await appliquerMigrations(db, V1);
  db.sql.close();
  mkdirSync(join(dir, 'backups'));
  const ancienne = join(dir, 'backups', 'cursus-2020-01-02T020000Z-avant-migration.db');
  writeFileSync(ancienne, '');
  const nom1 = nomEmp1(file);

  // Version 2 : une reprise sans objet sur cette base (seulement notée faite), puis une reprise utile.
  const sansObjet: Migration = { nom: 'lot9-essai-sans-objet', necessaire: () => false, executer: () => { throw new Error('jamais exécutée'); } };
  const utile: Migration = { nom: 'lot9-essai-utile', executer: async d => { await d.update('employes', 1, { nom: 'Repris' }); } };
  const V2 = [...V1, sansObjet, utile];
  const db2 = new Db(file);
  assert.deepEqual(await appliquerMigrations(db2, V2), ['lot9-essai-utile']);
  db2.sql.close();
  const [c2, ...autres] = copies(dir).filter(c => c.fichier !== ancienne);
  assert.equal(autres.length, 0);
  // La copie est faite avant d'enregistrer le premier nom, même seulement noté : la version 1 l'accepte.
  assert.deepEqual(enregistreesDans(c2.fichier), V1.map(m => m.nom));
  assert.equal(nomEmp1(c2.fichier), nom1);
  controlerMigrations(c2.fichier, V1);
  assert.throws(() => controlerMigrations(file, V1), (e: unknown) => e instanceof MigrationError
    && /2 migrations inconnues de cette version : lot9-essai-sans-objet, lot9-essai-utile/.test(e.message)
    && e.message.includes(c2.fichier) && !e.message.includes(ancienne));

  // Version 3 : seulement une reprise sans objet. Rien n'est modifié, mais le nom enregistré a sa copie.
  const V3 = [...V2, { nom: 'lot9-essai-suivante', necessaire: () => false, executer: () => {} }];
  const db3 = new Db(file);
  assert.deepEqual(await appliquerMigrations(db3, V3), []);
  db3.sql.close();
  const c3 = copies(dir).filter(c => c.fichier !== ancienne && c.fichier !== c2.fichier);
  assert.equal(c3.length, 1, 'copie avant le nom seulement noté');
  controlerMigrations(c3[0].fichier, V2);
  // Retour de la version 3 à la 2 : sa copie ; à la 1 : celle de la mise à jour vers la 2, enregistrée avec la première
  // migration que la version 1 ne connaît pas.
  assert.throws(() => controlerMigrations(file, V2), (e: unknown) => e instanceof MigrationError && e.message.includes(c3[0].fichier));
  assert.throws(() => controlerMigrations(file, V1), (e: unknown) => e instanceof MigrationError
    && e.message.includes(c2.fichier) && !e.message.includes(c3[0].fichier));

  // Base créée par la version 2 : aucune copie à nommer, renvoi à la sauvegarde d'avant la mise à jour.
  const neuve = join(dir, 'neuve.db');
  const db4 = new Db(neuve);
  await appliquerMigrations(db4, V2);
  db4.sql.close();
  assert.throws(() => controlerMigrations(neuve, V1), (e: unknown) => e instanceof MigrationError
    && /faite au début de cette mise à jour : aucune pour cette base \(créée par la version plus récente \?\) ; à défaut, restaurer la sauvegarde/.test(e.message)
    && !e.message.includes(ancienne));
}));

test('npm run reset-demo et npm run comptes : base mise à jour avant d’y écrire, refus si le serveur en service ne l’a pas fait', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  await baseAnterieure(file, { sansIndex: ['envois_file'] });
  // Serveur en service avec la version précédente (nouvelle version installée, service pas encore redémarré) : verrou
  // d'un processus vivant, celui des tests. Les outils refusent, sans rien écrire.
  writeFileSync(fichierVerrou(file), JSON.stringify({ pid: process.pid, depuis: new Date().toISOString() }));
  const env = { CURSUS_DB: file, CURSUS_DEMO: '1' };
  for (const [script, ...args] of [['reset.ts', '--yes'], ['comptes-cli.ts', 'admin', 'rh@exemple.fr']]) {
    const r = outil(env, script, ...args);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`le serveur Cursus en service \\(processus ${process.pid}\\) n’a pas encore mis la base à jour pour cette version `
      + `\\(${MIGRATIONS.length} migrations en attente : ${MIGRATIONS[0].nom}[\\s\\S]*Redémarrer d’abord le service`));
  }
  assert.deepEqual(enregistreesDans(file), []);
  assert.equal(copies(dir).length, 0);
  rmSync(fichierVerrou(file));

  // Service arrêté : reset-demo met la base à jour comme le serveur au démarrage (copie, migrations nommées), puis la
  // recharge. Le premier démarrage n'a plus aucune migration à faire sur les données de démonstration.
  const r = outil(env, 'reset.ts', '--yes');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Sauvegarde avant migration[\s\S]*Migration lot4-exploitation-index-envois faite[\s\S]*avant-reinitialisation[\s\S]*Données de démonstration rechargées/);
  assert.equal(copies(dir).length, 1);
  const db = new Db(file);
  assert.deepEqual(migrationsEnregistrees(db.sql), MIGRATIONS.map(m => m.nom));
  assert.ok(indexExiste(db, 'envois_file'));
  assert.deepEqual(await appliquerMigrations(db), [], 'rien à faire au démarrage suivant');
  db.sql.close();

  // npm run comptes, service arrêté : de même, avant de créer le compte.
  const autre = join(dir, 'autre.db');
  await baseAnterieure(autre, { sansIndex: ['journal_at'] });
  const c = outil({ CURSUS_DB: autre }, 'comptes-cli.ts', 'admin', 'rh@exemple.fr');
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /Migration lot4-exploitation-index-journal faite[\s\S]*Administrateur RH créé/);
  assert.deepEqual(enregistreesDans(autre), MIGRATIONS.map(m => m.nom));
}));

test('migration interrompue : ses modifications sont annulées, les précédentes restent faites, elle est retentée ensuite', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  await baseAnterieure(file);
  const db = new Db(file);
  await appliquerMigrations(db);
  const nom = async (id: number) => (await db.get<{ nom: string }>('employes', id))!.nom;
  const nom2 = await nom(2);
  let troisieme = 0;
  const liste = (echoue: boolean): Migration[] => [
    ...MIGRATIONS,
    { nom: 'essai-premiere', executer: async d => { await d.update('employes', 1, { nom: 'Premier' }); } },
    {
      nom: 'essai-interrompue',
      executer: async d => {
        await d.update('employes', 2, { nom: 'Jamais' });
        d.sql.exec('CREATE TABLE essai (x INTEGER)');
        if (echoue) throw new Error('valeur inattendue');
        return 'reprise faite';
      },
    },
    { nom: 'essai-suivante', executer: () => { troisieme++; } },
  ];
  await assert.rejects(async () => await appliquerMigrations(db, liste(true)), (e: unknown) => e instanceof MigrationError
    && /migration essai-interrompue interrompue, aucune de ses modifications n’est conservée \(valeur inattendue\)/.test(e.message));
  assert.equal(await nom(1), 'Premier', 'migration précédente conservée');
  assert.equal(await nom(2), nom2, 'modification annulée');
  assert.ok(!db.sql.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'essai'`).get(), 'table créée puis annulée');
  assert.equal(troisieme, 0, 'les suivantes ne sont pas lancées');
  assert.deepEqual(lignes(db).map(l => l.nom).slice(-1), ['essai-premiere']);
  assert.equal(copies(dir).length, 1, 'copie avant-migration faite avant la première');
  assert.ok(!db.sql.isTransaction, 'aucune transaction laissée ouverte');
  // Démarrage suivant (cause corrigée) : la migration interrompue et les suivantes s'exécutent.
  assert.deepEqual(await appliquerMigrations(db, liste(false)), ['essai-interrompue', 'essai-suivante']);
  assert.equal(await nom(2), 'Jamais');
  assert.equal(troisieme, 1);
  db.sql.close();
}));

test('reconstruction d’une table : colonne renommée et supprimée, contrainte ajoutée, index et compteur conservés', async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  const ancienne = new DatabaseSync(file);
  ancienne.exec(`CREATE TABLE budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, exercice INTEGER, equipe TEXT, somme REAL, obsolete TEXT);
    CREATE INDEX budgets_equipe ON budgets (equipe);
    INSERT INTO budgets (exercice, equipe, somme, obsolete) VALUES (2026, 'Production', 1000, 'x'), (2026, 'Maintenance', 500, 'y'), (2027, 'Production', 1, 'z');
    DELETE FROM budgets WHERE id = 3;`);
  ancienne.close();
  const db = new Db(file); // le schéma déclaratif ajoute `montant`, vide pour les lignes existantes
  assert.ok(await colonneExiste(db, 'budgets', 'montant') && await colonneExiste(db, 'budgets', 'somme'));
  // Ligne écrite par cette version avant la migration (reprise de server/src/migrate.ts…) : `montant` rempli, `somme` vide.
  await db.insert('budgets', { exercice: 2028, equipe: 'Logistique', montant: 750 });
  await assert.rejects(async () => await reconstruireTable(db, 'budgets'), /hors transaction/);
  const renommer: Migration = {
    nom: 'essai-budgets-montant',
    necessaire: async d => await colonneExiste(d, 'budgets', 'somme'),
    executer: async d => `${await reconstruireTable(d, 'budgets', { depuis: { montant: 'COALESCE(montant, somme)' }, ligne: r => ({ ...r, equipe: String(r.equipe).toUpperCase() }) })} lignes`,
  };
  assert.deepEqual(await appliquerMigrations(db, [renommer]), ['essai-budgets-montant']);
  assert.deepEqual(await db.columns('budgets'), ['id', 'exercice', 'equipe', 'montant']);
  assert.deepEqual((await db.all<{ id: number; equipe: string; montant: number }>('budgets')).map(b => [b.id, b.equipe, b.montant]),
    [[1, 'PRODUCTION', 1000], [2, 'MAINTENANCE', 500], [4, 'LOGISTIQUE', 750]], 'anciennes valeurs reprises, nouvelle conservée');
  assert.ok(indexExiste(db, 'budgets_equipe'), 'index recréé');
  await assert.rejects(async () => await db.insert('budgets', { exercice: 2026, equipe: 'PRODUCTION', montant: 1 }), /UNIQUE/, 'contrainte de TABLES appliquée');
  assert.equal((await db.insert<{ id: number }>('budgets', { exercice: 2029, equipe: 'X', montant: 1 })).id, 5, 'identifiant 3 jamais réutilisé');
  assert.deepEqual(db.sql.prepare(`SELECT name FROM sqlite_sequence WHERE name LIKE 'budgets%'`).all().map(r => r.name), ['budgets']);
  db.sql.close();

  // Lignes qui violent la nouvelle contrainte : migration annulée, table intacte.
  const doublons = join(dir, 'doublons.db');
  const d2 = new DatabaseSync(doublons);
  d2.exec(`CREATE TABLE budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, exercice INTEGER, equipe TEXT, somme REAL);
    INSERT INTO budgets (exercice, equipe, somme) VALUES (2026, 'Production', 1), (2026, 'Production', 2);`);
  d2.close();
  const db2 = new Db(doublons);
  await assert.rejects(async () => await appliquerMigrations(db2, [renommer]), (e: unknown) => e instanceof MigrationError && /essai-budgets-montant interrompue.*UNIQUE/.test(e.message));
  assert.ok(await colonneExiste(db2, 'budgets', 'somme'));
  assert.equal(await db2.count('budgets'), 2);
  assert.ok(!db2.sql.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'budgets__reconstruction'`).get());
  db2.sql.close();
}));

test('serveur : une base antérieure au cadre démarre, notée à jour sans être modifiée, après sa copie', { skip: process.platform === 'win32' }, async () => await dansDossier(async dir => {
  const file = join(dir, 'cursus.db');
  await baseAnterieure(file);
  const env = { ...process.env, CURSUS_DB: file, CURSUS_API_PORT: '0', CURSUS_HOST: '127.0.0.1', CURSUS_DEMO: '1' };
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const sortie = await new Promise<string>((ok, ko) => {
      let out = '';
      srv.stdout.on('data', b => { out += b; if (out.includes('Cursus — API')) ok(out); });
      srv.stderr.on('data', b => { out += b; });
      srv.on('exit', code => ko(new Error(`serveur arrêté (${code}) : ${out}`)));
    });
    assert.match(sortie, new RegExp(`Sauvegarde avant migration : .*-avant-migration\\.db\\n[\\s\\S]*Migrations : ${MIGRATIONS.length} migrations notées faites sans modification`));
  } finally {
    srv.kill('SIGKILL');
  }
  const lu = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(migrationsEnregistrees(lu), MIGRATIONS.map(m => m.nom));
  lu.close();
  assert.equal(copies(dir).length, 1);
}));
