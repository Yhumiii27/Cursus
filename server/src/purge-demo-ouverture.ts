// Ouverture de la base pour l'aperçu à blanc de npm run purge-demo (server/src/purge-demo-cli.ts), sans rien y écrire.
// Contrairement aux outils qui écrivent (npm run comptes, npm run reset-demo), l'aperçu ne met jamais la base au niveau
// de cette version : mettreAJourBase (server/src/demarrage.ts) ferait une copie « avant-migration » de plus (données
// fictives comprises), rejouerait les reprises historiques et les migrations nommées et poserait des réglages ; sur le
// serveur PostgreSQL, openDb appliquerait les migrations de server/migrations-pg/ et rattacherFiches écrirait des postes
// et une ligne de journal. Une base qui n'est pas à jour est donc refusée, avec le remède : démarrer une fois le service
// de cette version (il met la base à jour), l'arrêter, puis relancer l'aperçu.
// - Fichier SQLite : tout est contrôlé en lecture seule avant l'ouverture (migrations nommées inconnues ou en attente,
//   tables ou colonnes du schéma déclaratif manquantes), puis la base est ouverte : son schéma étant complet, l'ouverture
//   n'écrit rien (CREATE TABLE IF NOT EXISTS sans effet, aucune colonne à ajouter, aucune copie).
// - Serveur PostgreSQL : pool ouvert sans migrer ; journal schema_migrations lu, refus d'une migration inconnue ou en
//   attente, puis contrôle du schéma (controlerSchema, en lecture).
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { plural } from '../../shared/format.ts';
import { type Db, dbFile, snake, SqliteDb, TABLES, type TableName, urlPostgres } from './db.ts';
import { controlerMigrations, migrationsEnregistrees } from './migrations/cadre.ts';
import { MIGRATIONS } from './migrations/liste.ts';
import { PurgeRefusee } from './purge-demo.ts';

const REMEDE = 'démarrez une fois le service de cette version de Cursus (il met la base à jour), arrêtez-le, puis relancez l’aperçu ; '
  + 'l’aperçu à blanc n’écrit jamais dans la base.';

/**
 * Écarts d'un fichier SQLite avec cette version, lus sans écriture : migrations nommées en attente, tables et colonnes du
 * schéma déclaratif manquantes. Fichier illisible en lecture seule : PurgeRefusee.
 */
export function ecartsSqlite(fichier: string): { migrations: string[]; schema: string[] } {
  let sql: DatabaseSync;
  try {
    sql = new DatabaseSync(fichier, { readOnly: true });
  } catch (err) {
    throw new PurgeRefusee(`base illisible en lecture seule (${err instanceof Error ? err.message : err}) : ${REMEDE}`);
  }
  try {
    const tables = new Set((sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name));
    const faites = new Set(tables.has('migrations') ? migrationsEnregistrees(sql) : []);
    const schema: string[] = [];
    for (const [nom, def] of Object.entries(TABLES) as [TableName, (typeof TABLES)[TableName]][]) {
      if (!tables.has(snake(nom))) { schema.push(`table ${snake(nom)}`); continue; }
      const cols = new Set((sql.prepare(`PRAGMA table_info(${snake(nom)})`).all() as { name: string }[]).map(c => c.name));
      for (const c of Object.keys(def.cols)) if (!cols.has(snake(c))) schema.push(`${snake(nom)}.${snake(c)}`);
    }
    return { migrations: MIGRATIONS.filter(m => !faites.has(m.nom)).map(m => m.nom), schema };
  } finally {
    sql.close();
  }
}

const liste = (xs: string[]) => `${xs.slice(0, 8).join(', ')}${xs.length > 8 ? '…' : ''}`;

/** Fichier SQLite à jour pour cette version, contrôlé sans écriture ; PurgeRefusee sinon. */
export function controlerSqliteAJour(fichier: string) {
  if (!existsSync(fichier)) throw new PurgeRefusee(`base introuvable : ${fichier} (CURSUS_DB).`);
  try {
    controlerMigrations(fichier, MIGRATIONS);
  } catch (err) {
    throw new PurgeRefusee(err instanceof Error ? err.message : String(err));
  }
  const { migrations, schema } = ecartsSqlite(fichier);
  if (migrations.length) throw new PurgeRefusee(`la base n’est pas à jour pour cette version (${plural(migrations.length, 'migration en attente', 'migrations en attente')} : ${liste(migrations)}) : ${REMEDE}`);
  if (schema.length) throw new PurgeRefusee(`la base n’est pas à jour pour cette version (${plural(schema.length, 'table ou colonne manquante', 'tables ou colonnes manquantes')} : ${liste(schema)}) : ${REMEDE}`);
}

/** Serveur PostgreSQL ouvert sans migrer : refus si une migration de server/migrations-pg/ est inconnue ou en attente. */
async function ouvrirPostgresSansMigrer(url: string, env: Record<string, string | undefined>, schema?: string): Promise<Db> {
  const { migrationsPg, PgDb } = await import('./db-pg.ts');
  const db = new PgDb(url, { env, ...(schema ? { schema } : {}) });
  try {
    const journal = await db.one<{ existe: boolean }>(`SELECT to_regclass('schema_migrations') IS NOT NULL AS existe`);
    if (!journal?.existe) throw new PurgeRefusee(`le schéma ${db.schema} n’a jamais été initialisé par Cursus (aucun journal schema_migrations) : rien à purger.`);
    const faites = new Set((await db.query<{ nom: string }>('SELECT nom FROM schema_migrations')).map(r => String(r.nom)));
    const fichiers = migrationsPg().map(m => m.nom);
    const inconnues = [...faites].filter(n => !fichiers.includes(n)).sort();
    if (inconnues.length) throw new PurgeRefusee(`la base a été mise à jour par une version plus récente de Cursus (migrations inconnues : ${liste(inconnues)}) : lancez l’aperçu avec cette version.`);
    const attente = fichiers.filter(n => !faites.has(n));
    if (attente.length) throw new PurgeRefusee(`la base n’est pas à jour pour cette version (${plural(attente.length, 'migration en attente', 'migrations en attente')} : ${liste(attente)}) : ${REMEDE}`);
    await db.controlerSchema();
    return db;
  } catch (err) {
    await db.fermer();
    throw err;
  }
}

/**
 * Base ouverte pour l'aperçu à blanc, sans aucune écriture (fichier de CURSUS_DB, ou serveur de DATABASE_URL ; `schema` :
 * schéma de travail des tests, cursus sinon).
 */
export async function ouvrirPourApercu(env: Record<string, string | undefined> = process.env, fichier = dbFile(), schema?: string): Promise<Db> {
  const url = urlPostgres(env);
  if (url) return await ouvrirPostgresSansMigrer(url, env, schema);
  controlerSqliteAJour(fichier);
  return new SqliteDb(fichier);
}
