// Base des tests, sur l'un des deux moteurs de Cursus (sous-étape 8.b, docs/ARCHITECTURE.md « Accès à la base ») :
// - par défaut, ou CURSUS_TEST_ENGINE=sqlite : SQLite en mémoire, une base neuve par appel ;
// - CURSUS_TEST_ENGINE=pg : PostgreSQL. CURSUS_TEST_DATABASE_URL désigne la base d'administration d'un serveur
//   (postgres://postgres@127.0.0.1:5432/postgres) : chaque fichier de test reçoit sa propre base, créée au premier appel
//   et supprimée à la fin du fichier ; chaque appel y crée un schéma vide (cursus, puis cursus_2, cursus_3…), où les
//   migrations de server/migrations-pg/ s'appliquent comme sur le serveur commun (Cursus ne crée jamais de schéma).
//   Les verrous consultatifs dérivent du nom du schéma : deux bases d'un même fichier ne se bloquent pas.
//   CURSUS_TEST_ENGINE=pg CURSUS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
import { after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { type Db, SqliteDb } from '../server/src/db.ts';
import { ouvrirPostgres, type PgDb } from '../server/src/db-pg.ts';

export const MOTEUR: 'sqlite' | 'pg' = process.env.CURSUS_TEST_ENGINE === 'pg' ? 'pg' : 'sqlite';
/** Vrai quand les tests tournent sur PostgreSQL : `{ skip: PG && 'raison' }` pour un test propre au fichier SQLite. */
export const PG = MOTEUR === 'pg';

const admin = process.env.CURSUS_TEST_DATABASE_URL?.trim();
if (PG && !admin) throw new Error('CURSUS_TEST_ENGINE=pg : CURSUS_TEST_DATABASE_URL (base d’administration du serveur de test) est requise.');
// Pièces justificatives d'une base PostgreSQL (aucun fichier de base) : à côté de CURSUS_DB par défaut, jamais dans le
// dossier data/ du projet pendant les tests.
if (PG && !process.env.CURSUS_PIECES_DIR) process.env.CURSUS_PIECES_DIR = mkdtempSync(join(tmpdir(), 'cursus-pieces-pg-'));

/** URL de la base `nom` sur le serveur de `url`. */
export function urlDe(url: string, nom: string): string {
  const u = new URL(url);
  u.pathname = `/${nom}`;
  return u.toString();
}

/** Exécute une instruction sur le serveur, hors de Cursus (création de base et de schéma, état des tables). */
export async function surServeur<T = Record<string, unknown>>(url: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: url, application_name: 'cursus-tests' });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

let base: Promise<string> | null = null;
let nomBase: string | null = null;
let schemas = 0;
const ouvertes = new Set<PgDb>();

/** Base PostgreSQL du fichier de test, créée au premier appel (tri C comme la base epc2i du socle). */
function urlBase(): Promise<string> {
  base ??= (async () => {
    nomBase = `cursus_test_${process.pid}_${randomBytes(4).toString('hex')}`;
    try {
      await surServeur(admin!, `CREATE DATABASE "${nomBase}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8'`);
    } catch {
      await surServeur(admin!, `CREATE DATABASE "${nomBase}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    }
    await surServeur(urlDe(admin!, nomBase), 'ALTER DATABASE "' + nomBase + '" SET timezone TO \'UTC\'');
    return urlDe(admin!, nomBase);
  })();
  return base;
}

if (PG) {
  // Après tous les tests du fichier : bases fermées, base du fichier supprimée.
  after(async () => {
    for (const db of ouvertes) await db.fermer();
    if (nomBase) await surServeur(admin!, `DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
  });
}

/** Nombre de bases ouvertes par ce fichier (schémas créés). */
export const basesOuvertes = () => schemas;

/**
 * Base neuve et vide (schéma créé, aucune donnée) : SQLite en mémoire, ou nouveau schéma PostgreSQL migré. `env` :
 * variables de l'adaptateur (taille du pool…).
 */
export async function nouvelleBase(env: Record<string, string | undefined> = {}): Promise<Db> {
  if (!PG) return new SqliteDb(':memory:');
  const url = await urlBase();
  const schema = ++schemas === 1 ? 'cursus' : `cursus_${schemas}`;
  await surServeur(url, `CREATE SCHEMA ${schema}`);
  const db = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '4', CURSUS_PG_INACTIF_MS: '500', ...env } });
  ouvertes.add(db);
  return db;
}

/** URL de la base PostgreSQL du fichier (création comprise) et schéma neuf, pour un serveur lancé par un test. */
export async function schemaNeuf(): Promise<{ url: string; schema: string }> {
  const url = await urlBase();
  const schema = ++schemas === 1 ? 'cursus' : `cursus_${schemas}`;
  await surServeur(url, `CREATE SCHEMA ${schema}`);
  return { url, schema };
}

/** Valeur d'une colonne JSON lue par une requête brute : texte en SQLite, déjà décodée en PostgreSQL. */
export const json = <T = any>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
/** Valeur d'une colonne booléenne lue par une requête brute : 0 / 1 en SQLite, false / true en PostgreSQL. */
export const bool = (v: unknown): boolean => !!v;

/** Motif des tests propres au fichier SQLite (migrations nommées, fichier de base, sauvegardes) : `{ skip: PG && SQLITE_SEUL }`. */
export const SQLITE_SEUL = 'propre au fichier SQLite (migrations nommées, fichier de base) : sans objet sur le serveur PostgreSQL';
/** La base, connue pour être SQLite (test sauté sur PostgreSQL) : accès aux migrations nommées et au fichier. */
export function sqlite(db: Db): SqliteDb {
  if (!(db instanceof SqliteDb)) throw new Error('test propre à SQLite lancé sur PostgreSQL : ajouter { skip: PG && SQLITE_SEUL }');
  return db;
}
/** Texte JSON d'une colonne JSON lue par une requête brute (le texte écrit, sur les deux moteurs). */
export const texteJson = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Écritures qui contournent les clés étrangères, comme une reprise faite hors de Cursus (lignes orphelines) : en
 * PostgreSQL, contrôles des clés suspendus le temps de `fn` (session_replication_role, rôle d'administration des
 * tests) ; SQLite ne déclare aucune clé.
 */
export async function horsContraintes(db: Db, fn: () => Promise<void>): Promise<void> {
  if (!PG) return await fn();
  await db.tx(async () => {
    await db.exec('SET LOCAL session_replication_role = replica');
    await fn();
  });
}
