// Adaptateur PostgreSQL de la couche d'accès (sous-étape 8.b de la bascule vers le serveur PostgreSQL commun, plan dans
// Matrix, docs/architecture-postgres.md § 8.3) : pool `pg`, schéma de l'outil (cursus) par le search_path, migrations
// SQL de server/migrations-pg/, verrous consultatifs à la place de la file en mémoire de SqliteDb. Même API que
// l'adaptateur SQLite (classe Db de server/src/db.ts) : le code applicatif ne sait pas sur quel moteur il tourne, sauf
// pour les quelques fragments SQL propres au moteur que Db fournit (contientEntier, like, jsonTexte).
import { AsyncLocalStorage } from 'node:async_hooks';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { RACINE } from './chemins.ts';
import { type ColType, Db, type Ecriture, snake, type SqlValeur, type TableDef, type TableName, TABLES, toDb } from './db.ts';

type Row = Record<string, unknown>;

/** Schéma de Cursus sur le serveur commun : créé par le socle (Matrix, infra/postgres/init/02-schemas.sql), jamais ici. */
export const SCHEMA_PG = 'cursus';
/** Dossier des migrations PostgreSQL (fichiers NNNN_<objet>.sql, appliqués dans l'ordre de leur nom). */
export const DOSSIER_MIGRATIONS_PG = join(RACINE, 'server', 'migrations-pg');
/** Tables dont SQLite donne l'ordre par le rowid (référentiels, `Db.all(…, 'rowid')`) ou départage les tris : colonne `rang`. */
export const TABLES_RANG: ReadonlySet<TableName> = new Set<TableName>(['formations', 'habilitations', 'destinations', 'projets', 'equipes', 'chantiers', 'horaires']);

/**
 * Lecture des types par le pilote, alignée sur ce que rendait SQLite et qu'attend le domaine (shared/) :
 * - date (1082) : la chaîne « AAAA-MM-JJ » telle quelle (sans parseur, `pg` rend un objet Date : « Date d'entrée invalide ») ;
 * - numeric (1700) et bigint (20, `COUNT(*)`) : nombre JavaScript ;
 * - timestamptz (1184) : chaîne ISO de toISOString, le format écrit par Cursus.
 */
const PARSEURS: Record<number, (v: string) => unknown> = {
  1082: v => v,
  1700: v => Number(v),
  20: v => Number(v),
  1184: v => new Date(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString(),
};
const TYPES: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) => PARSEURS[oid] ?? pg.types.getTypeParser(oid, format as 'text')) as pg.CustomTypesConfig['getTypeParser'],
};

/**
 * Paramètres `?` du SQL brut (écrit pour les deux moteurs) traduits en `$1, $2…`. Les `?` des chaînes ('…'), des
 * identifiants ("…") et des commentaires restent tels quels.
 */
export function versDollar(sql: string): string {
  let n = 0, out = '', i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const fin = sql.indexOf(c, i + 1);
      const j = fin < 0 ? sql.length : fin + 1;
      out += sql.slice(i, j); i = j;
    } else if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i);
      const j = fin < 0 ? sql.length : fin;
      out += sql.slice(i, j); i = j;
    } else if (c === '?') {
      out += `$${++n}`; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

/** Démarrage refusé : schéma absent, incomplet, migration interrompue, base mise à jour par une version plus récente. */
export class SchemaPgError extends Error {}

/**
 * Portée en cours, connexion à soi tant que `active` : suite exclusive (verrou d'écriture de session, requêtes validées
 * une à une), transaction d'écriture, ou lecture stable (REPEATABLE READ READ ONLY).
 */
interface PorteePg {
  client: pg.PoolClient;
  mode: 'exclusif' | 'tx' | 'lecture';
  /** Une transaction `tx` est ouverte sur la connexion (la portée elle-même, ou une transaction ouverte dans `exclusif`). */
  tx: boolean;
  active: boolean;
  /**
   * Requêtes de la portée l'une après l'autre sur sa connexion (des appels parallèles, Promise.all, y sont admis comme
   * en SQLite) : pg 8 met en file d'office mais le déconseille, pg 9 le refusera.
   */
  file: Promise<unknown>;
}

/** Requête `fn` passée à son tour sur la connexion de la portée `p`. */
function enFile<T>(p: PorteePg, fn: () => Promise<T>): Promise<T> {
  const r = p.file.then(fn, fn);
  p.file = r.catch(() => {});
  return r;
}

export interface OptionsPg {
  /** Schéma de travail (cursus ; un schéma par base dans les tests). */
  schema?: string;
  env?: Record<string, string | undefined>;
  /** Dossier des migrations (tests). */
  migrations?: string;
}

/**
 * Adaptateur PostgreSQL. La file en mémoire de SqliteDb devient le verrou d'écriture de l'outil, commun à toutes les
 * instances : `hashtext('cursus.ecritures')` (sans lui, 5 saisies simultanées sur une feuille en perdaient 3).
 * - `tx` hors de toute portée : transaction sur une connexion du pool, verrou pris en tête
 *   (`pg_advisory_xact_lock`), validée à la fin ; imbriquée dans une transaction, elle la rejoint ;
 * - `exclusif` : verrou pris pour la session (`pg_advisory_lock`, en conflit avec le précédent), rendu à la fin ; ses
 *   requêtes sont validées une à une, comme en SQLite hors transaction (la session et les compteurs y sont écrits : pas
 *   de lecture seule) ; une `tx` ouverte dedans est une vraie transaction sur la même connexion, validée à sa fin :
 *   son échec n'annule qu'elle, et une route ne répond jamais avant la validation de ce qu'elle a écrit ;
 * - `lecture` hors de toute portée : transaction REPEATABLE READ READ ONLY, sans verrou (les lectures restent
 *   parallèles et voient un même état) ; dans `tx` ou `exclusif`, elle réutilise la portée en cours ;
 * - une requête isolée passe par le pool, sans transaction (validée aussitôt) ;
 * - `insert` lit la ligne créée par `RETURNING *` et recale la séquence quand l'identifiant est fixé par l'appelant.
 */
export class PgDb extends Db {
  readonly moteur = 'pg' as const;
  neuve = false;
  readonly schema: string;
  readonly pool: pg.Pool;
  private readonly portee = new AsyncLocalStorage<PorteePg>();
  private ferme = false;

  constructor(url: string, opts: OptionsPg = {}) {
    super();
    this.schema = opts.schema ?? SCHEMA_PG;
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) throw new SchemaPgError(`nom de schéma invalide : ${this.schema}`);
    const env = opts.env ?? process.env;
    const max = Number(env.CURSUS_PG_POOL) > 0 ? Math.floor(Number(env.CURSUS_PG_POOL)) : 10;
    this.pool = new pg.Pool({
      connectionString: url,
      application_name: 'cursus',
      // search_path aussi fixé sur le rôle par le socle (ALTER ROLE cursus_app SET search_path) : derrière PgBouncer en
      // mode transaction, qui refuse `options`, retirer cette ligne suffit.
      options: `-c search_path=${this.schema}`,
      max,
      types: TYPES,
      // Le processus peut s'arrêter sans fermer le pool (outils en ligne de commande, tests) une fois les connexions libres.
      allowExitOnIdle: true,
      idleTimeoutMillis: Number(env.CURSUS_PG_INACTIF_MS) > 0 ? Number(env.CURSUS_PG_INACTIF_MS) : 10_000,
    });
    // Connexion libre coupée par le serveur (redémarrage, délai d'inactivité) : le pool la remplace, sans arrêter Cursus.
    this.pool.on('error', err => console.error(`PostgreSQL : connexion libre perdue (${err.message})`));
  }

  get emplacement(): string | null { return null; }

  private enCours(): PorteePg | null {
    const p = this.portee.getStore();
    return p?.active ? p : null;
  }

  private async executer(sql: string, params: readonly SqlValeur[]): Promise<pg.QueryResult> {
    const texte = params.length ? versDollar(sql) : sql;
    const valeurs = params.length ? [...params] : undefined;
    const p = this.enCours();
    return p ? await enFile(p, () => p.client.query(texte, valeurs)) : await this.pool.query(texte, valeurs);
  }

  async query<T = Row>(sql: string, params: readonly SqlValeur[] = []): Promise<T[]> {
    return (await this.executer(sql, params)).rows as T[];
  }

  async run(sql: string, params: readonly SqlValeur[] = []): Promise<Ecriture> {
    const r = await this.executer(sql, params);
    const id = (r.rows?.[0] as Row | undefined)?.id;
    return { changes: r.rowCount ?? 0, lastInsertRowid: typeof id === 'number' ? id : 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.executer(sql, []);
  }

  async columns(table: TableName): Promise<string[]> {
    return (await this.query<{ c: string }>(`SELECT a.attname AS c FROM pg_attribute a
      WHERE a.attrelid = to_regclass(?) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [`${this.schema}.${snake(table)}`])).map(r => r.c);
  }

  protected versBase(t: ColType, v: unknown): SqlValeur {
    // Booléens NOT NULL DEFAULT false : une valeur absente vaut faux, comme à la lecture de SQLite.
    if (t === 'bool') return !!v;
    // NaN : SQLite l'enregistre comme NULL ; PostgreSQL le refuserait dans une colonne integer.
    if ((t === 'int' || t === 'real') && v != null && Number.isNaN(Number(v))) return null;
    return toDb(t, v);
  }

  async all<T>(table: TableName, orderBy?: string): Promise<T[]> {
    const def = this.def(table);
    const ordre = orderBy === 'rowid' ? 'rang' : snake(orderBy ?? def.pk);
    // Départage des égalités dans l'ordre d'insertion, comme le parcours de SQLite par rowid ; NULL en tête, comme SQLite.
    const departage = TABLES_RANG.has(table) ? 'rang' : snake(def.pk);
    const sql = `SELECT * FROM ${snake(table)} ORDER BY ${ordre} NULLS FIRST${ordre === departage ? '' : `, ${departage}`}`;
    return (await this.query(sql)).map(r => this.decode<T>(table, r));
  }

  async insert<T = Row>(table: TableName, obj: Partial<T> | Row): Promise<T> {
    const def = this.def(table);
    const o = obj as Row;
    const cols = Object.keys(def.cols).filter(c => o[c] !== undefined && !(c === def.pk && def.auto && o[c] == null));
    const sql = cols.length
      ? `INSERT INTO ${snake(table)} (${cols.map(snake).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`
      : `INSERT INTO ${snake(table)} DEFAULT VALUES RETURNING *`;
    const [ligne] = await this.query(sql, cols.map(c => this.versBase(def.cols[c], o[c])));
    // Identifiant fixé par l'appelant (démonstration, tests) : la séquence repart au-delà, sinon la prochaine insertion
    // sans identifiant le reprendrait.
    if (def.auto && o[def.pk] != null) await this.recaler(table);
    return this.decode<T>(table, ligne);
  }

  /** Séquence de la clé de `table` placée au-delà du plus grand identifiant, sans jamais reculer. */
  private async recaler(table: TableName): Promise<void> {
    const t = snake(table), pk = snake(this.def(table).pk);
    await this.query(`SELECT setval(s.seq, GREATEST((SELECT COALESCE(MAX(${pk}), 0) FROM ${t}), COALESCE(pg_sequence_last_value(s.seq), 0), 1),
      (SELECT COUNT(*) > 0 FROM ${t}) OR pg_sequence_last_value(s.seq) IS NOT NULL) FROM (SELECT pg_get_serial_sequence(?, ?)::regclass AS seq) s`, [t, pk]);
  }

  async resyncIds(): Promise<void> {
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) if (def.auto) await this.recaler(name);
  }

  async clearAll(): Promise<void> {
    const noms = Object.keys(TABLES).filter(n => n !== 'connexions' && n !== 'journal').map(snake);
    // SET CONSTRAINTS ALL IMMEDIATE : un contrôle différé en attente (equipes.manager_id) ferait refuser le TRUNCATE
    // (« pending trigger events ») ; le contrôle redevient ensuite différé, comme le déclare le schéma (seule clé
    // différable), pour la suite de la transaction (le jeu de démonstration insère les équipes avant les fiches).
    // Les séquences du journal ne repartent pas de zéro, comme sqlite_sequence. Sans CASCADE : une clé étrangère
    // ajoutée un jour depuis le journal ou les sessions de connexion, conservés, ferait échouer la remise à zéro au lieu
    // de les vider en silence.
    await this.tx(async () => {
      await this.exec(`SET CONSTRAINTS ALL IMMEDIATE; TRUNCATE ${noms.join(', ')} RESTART IDENTITY; SET CONSTRAINTS ALL DEFERRED`);
    });
  }

  private get cleEcritures(): string { return `${this.schema}.ecritures`; }

  /** Exécute `fn` dans la portée `p` (chaîne asynchrone de l'appelant), qui se ferme à la fin. */
  private async dans<T>(p: PorteePg, fn: () => Promise<T> | T): Promise<T> {
    try {
      return await this.portee.run(p, async () => await fn());
    } finally {
      p.active = false;
    }
  }

  /**
   * Transaction sur `client` (BEGIN fait) : validée si `fn` réussit, annulée sinon ; la révision monte à la validation.
   * `p` : portée dont la file porte les requêtes (transaction ouverte dans `exclusif`).
   */
  private async transaction<T>(client: pg.PoolClient, fn: () => Promise<T>, p?: PorteePg): Promise<T> {
    const q = async (sql: string) => {
      if (p) return await enFile(p, () => client.query(sql));
      return await client.query(sql);
    };
    let r: T;
    try {
      r = await fn();
    } catch (err) {
      await q('ROLLBACK');
      throw err;
    }
    await q('COMMIT');
    this.rev = Math.max(this.rev + 1, Date.now());
    return r;
  }

  /** Connexion du pool pour `fn`, rendue ensuite (détruite si elle a cassé). */
  private async avecConnexion<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let casse: Error | undefined;
    try {
      return await fn(client);
    } catch (err) {
      // Connexion dans un état inconnu (transaction restée ouverte, réseau coupé) : jamais rendue au pool telle quelle.
      try { await client.query('ROLLBACK'); } catch (e) { casse = e as Error; }
      throw err;
    } finally {
      client.release(casse);
    }
  }

  async tx<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.enCours();
    if (p?.mode === 'lecture') throw new Error('Transaction d’écriture demandée dans une lecture (Db.lecture) : ouvrir la transaction avant la lecture.');
    if (p?.tx) return await fn(); // transaction englobante déjà ouverte
    if (p) {
      // Dans `exclusif` : vraie transaction sur la connexion qui détient déjà le verrou, validée à sa fin (avant la
      // réponse de la route), comme la transaction SQLite ouverte dans une suite exclusive.
      await enFile(p, () => p.client.query('BEGIN'));
      p.tx = true;
      try {
        return await this.transaction(p.client, async () => await fn(), p);
      } finally {
        p.tx = false;
      }
    }
    return await this.avecConnexion(async client => {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.cleEcritures]);
      const q: PorteePg = { client, mode: 'tx', tx: true, active: true, file: Promise.resolve() };
      return await this.transaction(client, async () => await this.dans(q, fn));
    });
  }

  async lecture<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.enCours()) return await fn();
    return await this.avecConnexion(async client => {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const q: PorteePg = { client, mode: 'lecture', tx: true, active: true, file: Promise.resolve() };
      const r = await this.dans(q, fn);
      await client.query('COMMIT');
      return r;
    });
  }

  /**
   * Suite exclusive : le verrou d'écriture est pris pour la session (`pg_advisory_lock`, même clé que le verrou des
   * transactions, avec lequel il entre en conflit) et rendu à la fin ; les requêtes hors de `tx` sont validées une à une,
   * comme en SQLite. La réponse d'une route n'est donc jamais envoyée avant la validation de ce qu'elle a écrit.
   */
  async exclusif<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.enCours()) return await fn();
    return await this.avecConnexion(async client => {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [this.cleEcritures]);
      try {
        return await this.dans({ client, mode: 'exclusif', tx: false, active: true, file: Promise.resolve() }, fn);
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [this.cleEcritures]);
      }
    });
  }

  async fermer(): Promise<void> {
    if (this.ferme) return;
    this.ferme = true;
    await this.pool.end();
  }

  // — Démarrage —

  /**
   * Applique les migrations de `dossier` absentes du journal `schema_migrations`, chacune dans sa transaction. Le verrou
   * `hashtext('<schéma>.migrations')` est pris avant de créer ou de lire le journal : deux instances qui démarrent ensemble
   * appliquent chaque migration une seule fois (un journal créé avant le verrou donne « duplicate key …
   * pg_type_typname_nsp_index »). Refus si le schéma manque (le socle le crée, jamais Cursus) ou si le journal porte une
   * migration inconnue de ce code (base mise à jour par une version plus récente). Renvoie les migrations appliquées.
   */
  async migrer(dossier = DOSSIER_MIGRATIONS_PG): Promise<string[]> {
    const fichiers = migrationsPg(dossier);
    const client = await this.pool.connect();
    try {
      const { rows: [s] } = await client.query('SELECT to_regnamespace($1) IS NOT NULL AS existe, current_schema() AS courant', [this.schema]);
      if (!s.existe) {
        throw new SchemaPgError(`le schéma ${this.schema} n’existe pas sur le serveur PostgreSQL : il est créé par le socle du serveur commun `
          + '(Matrix, infra/postgres/init/02-schemas.sql), jamais par Cursus. Vérifiez DATABASE_URL (base epc2i, rôle cursus_app).');
      }
      if (s.courant !== this.schema) throw new SchemaPgError(`search_path inattendu (schéma courant : ${s.courant ?? 'aucun'}, attendu : ${this.schema}).`);
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [`${this.schema}.migrations`]);
      try {
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (nom text PRIMARY KEY, appliquee_le timestamp with time zone DEFAULT now() NOT NULL)');
        const faites = new Set((await client.query('SELECT nom FROM schema_migrations')).rows.map(r => String(r.nom)));
        const inconnues = [...faites].filter(n => !fichiers.some(f => f.nom === n)).sort();
        if (inconnues.length) {
          throw new SchemaPgError(`la base a été mise à jour par une version plus récente de Cursus (migrations inconnues : ${inconnues.join(', ')}) : `
            + 'réinstallez cette version plus récente, ou restaurez la sauvegarde du schéma faite avant la mise à jour.');
        }
        const appliquees: string[] = [];
        for (const m of fichiers) {
          if (faites.has(m.nom)) continue;
          try {
            await client.query('BEGIN');
            await client.query(m.sql);
            await client.query('INSERT INTO schema_migrations (nom) VALUES ($1)', [m.nom]);
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            throw new SchemaPgError(`migration ${m.nom} interrompue, aucune de ses modifications n’est conservée (${err instanceof Error ? err.message : String(err)})`);
          }
          appliquees.push(m.nom);
        }
        // Base créée à l'instant : rien à reprendre, les amorçages de données s'y appliquent (server/src/demarrage.ts).
        this.neuve = faites.size === 0 && appliquees.length > 0;
        return appliquees;
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`${this.schema}.migrations`]);
      }
    } finally {
      client.release();
    }
  }

  /**
   * Contrôle du schéma au démarrage : chaque table et chaque colonne de TABLES existe dans le schéma (et la colonne
   * `rang` des tables qui en ont besoin). SQLite ajoute lui-même les colonnes manquantes ; sur le serveur, un ajout à
   * TABLES sans migration est refusé ici plutôt qu'à la première requête.
   */
  async controlerSchema(): Promise<void> {
    const lignes = await this.query<{ t: string; c: string }>(`SELECT c.relname AS t, a.attname AS c FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ? AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`, [this.schema]);
    const vues = new Set(lignes.map(l => `${l.t}.${l.c}`));
    const manquantes: string[] = [];
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) {
      const cols = [...Object.keys(def.cols).map(snake), ...(TABLES_RANG.has(name) ? ['rang'] : [])];
      if (!lignes.some(l => l.t === snake(name))) manquantes.push(`table ${snake(name)}`);
      else for (const c of cols) if (!vues.has(`${snake(name)}.${c}`)) manquantes.push(`${snake(name)}.${c}`);
    }
    if (manquantes.length) {
      throw new SchemaPgError(`schéma ${this.schema} incomplet par rapport au code (${manquantes.length} manquante${manquantes.length > 1 ? 's' : ''} : `
        + `${manquantes.slice(0, 12).join(', ')}${manquantes.length > 12 ? '…' : ''}) : une migration de server/migrations-pg/ manque.`);
    }
  }
}

/** Migrations PostgreSQL du dossier, dans l'ordre de leur nom (NNNN_<objet>.sql) : nom sans extension et texte. */
export function migrationsPg(dossier = DOSSIER_MIGRATIONS_PG): { nom: string; sql: string }[] {
  return readdirSync(dossier).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
    .map(f => ({ nom: f.replace(/\.sql$/, ''), sql: readFileSync(join(dossier, f), 'utf8') }));
}

/** Ouvre le serveur PostgreSQL : pool, migrations, contrôle du schéma. Une erreur ferme le pool avant d'être rendue. */
export async function ouvrirPostgres(url: string, opts: OptionsPg = {}): Promise<PgDb> {
  const db = new PgDb(url, opts);
  try {
    await db.migrer(opts.migrations);
    await db.controlerSchema();
    return db;
  } catch (err) {
    await db.fermer();
    throw err;
  }
}
