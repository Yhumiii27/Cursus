// Déclaration du schéma de la base à Matrix, le catalogue des bases de Keystone, Codex, Cursus et Vigie (contrat
// matrix.schema/1). Portage du module de référence de Matrix (integration/declarer-schema.mjs : lecture SQLite pour le
// fichier de repli, lecture PostgreSQL pour le serveur commun) ; principe et contrat : docs/declaration-des-tables.md
// du dépôt Matrix.
//
// Au démarrage, juste après les migrations (server/src/index.ts), Cursus lit le schéma réel de sa base (tables,
// colonnes, clés primaires, liens, unicités) et l'envoie à POST {MATRIX_URL}/api/declarations. Variables :
// - MATRIX_URL : adresse de Matrix ; sans elle, rien n'est envoyé (tests, poste local). Un identifiant et un mot de
//   passe dans l'adresse (https://identifiant:mdp@matrix.exemple.fr, authentification HTTP de l'hébergeur) partent en
//   Basic, jamais dans l'adresse appelée ;
// - MATRIX_TOKEN : jeton partagé avec Matrix, dans l'en-tête X-Matrix-Token ;
// - MATRIX_DECLARATIONS_DIR (facultatif) : la déclaration y est aussi écrite (<app>.json), utile sans réseau.
// Jamais bloquant : l'appel n'est pas attendu et un échec n'écrit qu'un avertissement.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { type Env, liaisonsCoupees } from '../config.ts';
import { type Db, SqliteDb } from '../db.ts';

/**
 * Tables techniques, hors catalogue : `migrations` (migrations nommées faites, server/src/migrations/cadre.ts),
 * `revision` (révision de la base, clé du cache de l'instantané : lot 8, chantier E), `changements` (journal des lignes
 * changées par révision : lot 9, chantier 1 ; non déclarée, mais fermée en entier à matrix_lecture par la demande du
 * lot 8, car l'ordre de ses lignes rattache à un salarié l'activité des tables de santé) et celles d'autres outils de
 * migration, comme dans le module de référence. Les tables internes de SQLite
 * (`sqlite_sequence`…) sont écartées par leur préfixe.
 */
export const TABLES_TECHNIQUES: readonly string[] = ['migrations', '__drizzle_migrations', 'schema_migrations', 'revision', 'changements'];

export interface ColonneDeclaree { name: string; type: string; nullable: boolean; pk: boolean; default: string | null }
export interface LienDeclare { columns: string[]; table: string; refColumns: string[]; onDelete: string; declared: true }
export interface TableDeclaree { name: string; pk: string[]; fks: LienDeclare[]; uniques: string[][]; columns: ColonneDeclaree[] }
export interface DocumentSchema {
  schema: 'matrix.schema/1';
  app: string;
  version: string | null;
  declareLe: string;
  empreinte: string;
  tables: TableDeclaree[];
}

type Ligne = Record<string, unknown>;
interface ColonneSqlite { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
interface LienSqlite { id: number; table: string; from: string; to: string; on_delete: string }
interface IndexSqlite { name: string; unique: number; origin: string }

/** Lit le schéma courant d'une base SQLite (DatabaseSync de node:sqlite, `db.sql` de la classe Db). */
export function introspecterSqlite(db: DatabaseSync): TableDeclaree[] {
  const all = <T>(sql: string) => db.prepare(sql).all() as unknown as T[];
  const exclues = TABLES_TECHNIQUES.map(t => `'${t.replace(/'/g, "''")}'`).join(', ');
  const noms = all<{ name: string }>(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not in (${exclues}) order by name`)
    .map(r => r.name);
  return noms.map(name => {
    const q = `"${name.replace(/"/g, '""')}"`;
    const info = all<ColonneSqlite>(`pragma table_info(${q})`);
    const pk = info.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    const liens = new Map<number, LienDeclare>();
    for (const r of all<LienSqlite>(`pragma foreign_key_list(${q})`)) {
      let l = liens.get(r.id);
      if (!l) liens.set(r.id, l = { columns: [], table: r.table, refColumns: [], onDelete: String(r.on_delete).toLowerCase(), declared: true });
      l.columns.push(r.from); l.refColumns.push(r.to);
    }
    const uniques = all<IndexSqlite>(`pragma index_list(${q})`).filter(i => i.unique && i.origin === 'u')
      .map(i => all<{ name: string }>(`pragma index_info("${i.name.replace(/"/g, '""')}")`).map(c => c.name));
    return {
      name, pk, fks: [...liens.values()], uniques,
      columns: info.map(c => ({ name: c.name, type: c.type || 'ANY', nullable: !c.notnull && !c.pk, pk: pk.length === 1 && c.pk === 1, default: c.dflt_value ?? null })),
    };
  });
}

// Lecture du catalogue PostgreSQL, reprise du module de référence (introspecterPostgres) : tables de base du schéma
// courant (search_path=cursus), sans les vues (pub_), ni le journal des migrations, ni la révision de la base.
const PG_TABLES = `
  select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'
    and c.table_name not in ('__drizzle_migrations', 'schema_migrations', 'revision', 'changements')
  order by c.table_name, c.ordinal_position`;

const PG_CONSTRAINTS = `
  select rel.relname as table_name, con.contype as kind,
    array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as cols,
    ref.relname as ref_table,
    array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as ref_cols,
    con.confdeltype as on_delete
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  left join pg_class ref on ref.oid = con.confrelid
  where n.nspname = current_schema() and con.contype in ('p', 'u', 'f')
  order by rel.relname, con.conname`;

const ON_DELETE: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };
const tableau = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean));

/** Lit le schéma courant d'une base PostgreSQL ; `query(sql)` renvoie les lignes d'une requête sans paramètre. */
export async function introspecterPostgres(query: (sql: string) => Promise<Ligne[]>): Promise<TableDeclaree[]> {
  const tables = new Map<string, TableDeclaree>();
  for (const r of await query(PG_TABLES)) {
    const nom = String(r.table_name);
    if (!tables.has(nom)) tables.set(nom, { name: nom, columns: [], pk: [], fks: [], uniques: [] });
    const type = r.data_type === 'USER-DEFINED' ? String(r.udt_name) : r.data_type === 'ARRAY' ? `${String(r.udt_name).replace(/^_/, '')}[]` : String(r.data_type);
    tables.get(nom)!.columns.push({ name: String(r.column_name), type, nullable: r.is_nullable === 'YES', pk: false, default: (r.column_default as string | null) ?? null });
  }
  for (const r of await query(PG_CONSTRAINTS)) {
    const t = tables.get(String(r.table_name));
    if (!t) continue;
    const cols = tableau(r.cols);
    if (r.kind === 'p') {
      t.pk = cols;
      const c = cols.length === 1 ? t.columns.find(x => x.name === cols[0]) : undefined;
      if (c) c.pk = true;
    } else if (r.kind === 'u') t.uniques.push(cols);
    else t.fks.push({ columns: cols, table: String(r.ref_table), refColumns: tableau(r.ref_cols), onDelete: ON_DELETE[String(r.on_delete)] ?? 'no action', declared: true });
  }
  return [...tables.values()];
}

/** Construit le document matrix.schema/1. L'empreinte permet à Matrix d'ignorer une déclaration inchangée. */
export function documentSchema({ app, version = null, tables }: { app: string; version?: string | null; tables: TableDeclaree[] }): DocumentSchema {
  const triees = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const empreinte = createHash('sha256').update(JSON.stringify(triees)).digest('hex').slice(0, 16);
  return { schema: 'matrix.schema/1', app, version, declareLe: new Date().toISOString(), empreinte, tables: triees };
}

interface Journal { info?: (m: string) => void; warn?: (m: string) => void }

/** Envoie la déclaration à Matrix et/ou l'écrit dans un dossier. Ne lève jamais d'erreur. */
export async function declarerSchema({ app, version, tables, env = process.env, log = console }: {
  app: string; version?: string | null; tables: TableDeclaree[]; env?: Env; log?: Journal;
}): Promise<DocumentSchema> {
  const doc = documentSchema({ app, version, tables });
  try {
    if (env.MATRIX_DECLARATIONS_DIR) {
      mkdirSync(env.MATRIX_DECLARATIONS_DIR, { recursive: true });
      writeFileSync(join(env.MATRIX_DECLARATIONS_DIR, `${app}.json`), JSON.stringify(doc, null, 1));
    }
    if (env.MATRIX_URL) {
      const url = new URL('/api/declarations', env.MATRIX_URL);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (env.MATRIX_TOKEN) headers['x-matrix-token'] = env.MATRIX_TOKEN;
      if (url.username) {
        headers.authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
        url.username = ''; url.password = '';
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Matrix a répondu ${res.status} : ${await res.text()}`);
      const r = await res.json() as Ligne;
      if (Array.isArray(r.nouvellesTables) && r.nouvellesTables.length) log.info?.(`[matrix] nouvelles tables déclarées : ${r.nouvellesTables.join(', ')}`);
    }
  } catch (e) {
    log.warn?.(`[matrix] déclaration du schéma de ${app} non transmise : ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}

/**
 * Déclaration de la base de Cursus au démarrage (server/src/index.ts) : lecture du schéma puis envoi, sans jamais
 * lever d'erreur, même si la lecture échoue. Rien n'est lu ni envoyé sans MATRIX_URL ni MATRIX_DECLARATIONS_DIR.
 */
export async function declarerBase(db: Db, version: string | null, env: Env = process.env, log: Journal = console): Promise<DocumentSchema | null> {
  if (!env.MATRIX_URL && !env.MATRIX_DECLARATIONS_DIR) return null;
  // Démonstration publique sans CURSUS_DEMO_LIAISONS=1 (constat S3 du lot 8) : rien n'est déclaré au catalogue des bases.
  if (liaisonsCoupees(env)) return null;
  let tables: TableDeclaree[];
  try {
    tables = db instanceof SqliteDb ? introspecterSqlite(db.sql) : await introspecterPostgres(async sql => await db.query<Ligne>(sql));
  } catch (e) {
    log.warn?.(`[matrix] schéma de cursus illisible, rien n'est déclaré : ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  return await declarerSchema({ app: 'cursus', version, tables, env, log });
}
