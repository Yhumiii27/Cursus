// Adaptateur PostgreSQL de la couche d'accès (sous-étape 8.b de la bascule vers le serveur PostgreSQL commun, plan dans
// Matrix, docs/architecture-postgres.md § 8.3) : pool `pg`, schéma de l'outil (cursus) par le search_path, migrations
// SQL de server/migrations-pg/, verrous consultatifs à la place de la file en mémoire de SqliteDb. Même API que
// l'adaptateur SQLite (classe Db de server/src/db.ts) : le code applicatif ne sait pas sur quel moteur il tourne, sauf
// pour les quelques fragments SQL propres au moteur que Db fournit (contientEntier, like, jsonTexte, jsonCleEgale, jsonCle).
import { AsyncLocalStorage } from 'node:async_hooks';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { RACINE } from './chemins.ts';
import { type ColType, Db, type Ecriture, type EtatRevision, snake, type SqlValeur, type TableDef, type TableName, TABLES, TABLES_SANS_REVISION, toDb } from './db.ts';

type Row = Record<string, unknown>;

/** Schéma de Cursus sur le serveur commun : créé par le socle (Matrix, infra/postgres/init/02-schemas.sql), jamais ici. */
export const SCHEMA_PG = 'cursus';
/** Dossier des migrations PostgreSQL (fichiers NNNN_<objet>.sql, appliqués dans l'ordre de leur nom). */
export const DOSSIER_MIGRATIONS_PG = join(RACINE, 'server', 'migrations-pg');
/** Tables dont SQLite donne l'ordre par le rowid (référentiels, `Db.all(…, 'rowid')`) ou départage les tris : colonne `rang`. */
export const TABLES_RANG: ReadonlySet<TableName> = new Set<TableName>(['formations', 'habilitations', 'destinations', 'projets', 'equipes', 'chantiers', 'horaires',
  // lot 11 — organigramme : entités et sites, lus dans l'ordre de leur colonne `ordre` (ORDRE_LECTURE), départagés par `rang`.
  'entites', 'sites']);
/**
 * Déclencheurs du journal des changements posés sur chaque table hors `TABLES_SANS_REVISION` (migration
 * 0014_changements) : insertion, modification, suppression, TRUNCATE. Exigés par `PgDb.controlerSchema`.
 */
export const DECLENCHEURS_CHANGEMENTS = ['revision_lignes_i', 'revision_lignes_u', 'revision_lignes_d', 'revision_lignes_t'] as const;

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

/**
 * Délais du serveur (lot 8, chantier E), posés dans les options du pool et réglables par variable, en millisecondes
 * (0 : sans limite) :
 * - connexion du pool (`connectionTimeoutMillis`, CURSUS_PG_DELAI_CONNEXION_MS, 5 s) : pool saturé ou serveur injoignable ;
 * - attente d'un verrou (`lock_timeout`, CURSUS_PG_DELAI_VERROU_MS, 30 s), verrou d'écriture `pg_advisory_lock` compris ;
 * - durée d'une requête (`statement_timeout`, CURSUS_PG_DELAI_REQUETE_MS, 60 s).
 * Règle qui les rend cohérents : aucun traitement ne tient le verrou d'écriture plus de la moitié de `lock_timeout`
 * (validation groupée découpée en tranches, lectures et exports hors du verrou : docs/ARCHITECTURE.md, « Accès à la
 * base : PostgreSQL »). Un dépassement répond 503 « Cursus est occupé, réessayez » (server/src/erreurs.ts), sans rien écrire.
 */
export const DELAIS_PG = { connexion: 5_000, verrou: 30_000, requete: 60_000 } as const;

export function delaisPg(env: Record<string, string | undefined> = process.env): { connexion: number; verrou: number; requete: number } {
  const lire = (nom: string, defaut: number) => {
    const v = env[nom]?.trim();
    return v && /^\d+$/.test(v) ? Number(v) : defaut;
  };
  return {
    connexion: lire('CURSUS_PG_DELAI_CONNEXION_MS', DELAIS_PG.connexion),
    verrou: lire('CURSUS_PG_DELAI_VERROU_MS', DELAIS_PG.verrou),
    requete: lire('CURSUS_PG_DELAI_REQUETE_MS', DELAIS_PG.requete),
  };
}

/**
 * Places de lecture (lot 8, chantier E) : une lecture stable garde sa connexion le temps de toutes ses requêtes (une
 * seconde pour l'instantané complet sur 5 ans de données). Sans limite, des lectures simultanées prendraient toutes les
 * connexions du pool : les écritures et la sonde de santé attendraient une connexion, puis échoueraient au bout de
 * `connectionTimeoutMillis`. Les lectures en surnombre attendent donc leur tour en mémoire, sans délai : la moitié du
 * pool au plus leur est ouverte (5 sur 10), le reste sert les écritures et les requêtes isolées (session, débit, santé).
 * Le calcul de l'instantané occupe le processus : plus de lectures simultanées n'iraient pas plus vite.
 */
class PlacesLecture {
  private libres: number;
  private readonly attente: (() => void)[] = [];
  constructor(places: number) { this.libres = places; }
  async prendre(): Promise<void> {
    if (this.libres > 0) { this.libres--; return; }
    await new Promise<void>(ok => this.attente.push(ok));
  }
  rendre(): void {
    const suivant = this.attente.shift();
    if (suivant) suivant(); else this.libres++;
  }
  /** Lectures en attente d'une place (sonde de l'essai de charge). */
  get enAttente(): number { return this.attente.length; }
}

/**
 * File des écritures de l'instance (lot 8, chantier E, étape 2) : les transactions et suites exclusives de l'instance
 * attendent leur tour en mémoire avant de prendre une connexion, puis le verrou d'écriture (commun aux instances). Sans
 * elle, chaque écriture en attente du verrou gardait une connexion du pool : trente saisies simultanées prenaient les dix
 * connexions, et les lectures, l'identité des requêtes et la sonde de santé attendaient une connexion jusqu'au délai
 * (503). L'attente en mémoire est bornée par le délai du verrou (`lock_timeout`) : au-delà, la même erreur que le
 * serveur (55P03), donc 503 « Cursus est occupé », sans rien écrire.
 */
export class FileEcritures {
  private fin: Promise<void> = Promise.resolve();
  /** Écritures de l'instance en attente de leur tour (sonde de l'essai de charge). */
  enAttente = 0;
  /**
   * Plus longue attente d'un tour terminée (servie ou refusée), en millisecondes (sonde de l'essai de charge) : sur une
   * instance, une seule écriture à la fois atteint `pg_advisory_xact_lock`, les autres attendent ici, sans connexion, et
   * pg_stat_activity ne les voit pas. L'attente du verrou d'écriture se juge donc aussi sur cette valeur.
   */
  attenteMax = 0;
  private readonly debuts = new Set<{ t: number }>();
  /** Attente de la plus ancienne écriture encore dans la file (0 si la file est vide). */
  get attenteEnCours(): number {
    let plusAncien = Infinity;
    for (const d of this.debuts) plusAncien = Math.min(plusAncien, d.t);
    return plusAncien === Infinity ? 0 : performance.now() - plusAncien;
  }
  async passer<T>(delai: number, fn: () => Promise<T>): Promise<T> {
    const avant = this.fin;
    let liberer!: () => void;
    this.fin = new Promise<void>(ok => { liberer = ok; });
    this.enAttente++;
    const debut = { t: performance.now() };
    this.debuts.add(debut);
    let minuteur: NodeJS.Timeout | undefined;
    try {
      const tour = await Promise.race([
        avant.then(() => true),
        ...(delai > 0 ? [new Promise<false>(ok => { minuteur = setTimeout(() => ok(false), delai); })] : []),
      ]);
      if (!tour) {
        // Place rendue à la suivante dès la fin de la précédente : l'ordre de la file est gardé.
        void avant.then(liberer);
        throw Object.assign(new Error('canceling statement due to lock timeout (file des écritures de l’instance)'), { code: '55P03' });
      }
    } finally {
      clearTimeout(minuteur);
      this.enAttente--;
      this.debuts.delete(debut);
      this.attenteMax = Math.max(this.attenteMax, performance.now() - debut.t);
    }
    try {
      return await fn();
    } finally {
      liberer();
    }
  }
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
 *   parallèles et voient un même état), la moitié du pool à la fois (`PlacesLecture`) ; dans `tx` ou
 *   `exclusif`, elle réutilise la portée en cours ;
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
  /** Lectures stables simultanées : la moitié du pool, une au moins (`PlacesLecture`). */
  readonly placesLecture: PlacesLecture;
  /** Écritures de l'instance, une à la fois, avant toute connexion (`FileEcritures`). */
  readonly fileEcritures = new FileEcritures();
  private readonly delaiVerrou: number;

  constructor(url: string, opts: OptionsPg = {}) {
    super();
    this.schema = opts.schema ?? SCHEMA_PG;
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) throw new SchemaPgError(`nom de schéma invalide : ${this.schema}`);
    const env = opts.env ?? process.env;
    const max = Number(env.CURSUS_PG_POOL) > 0 ? Math.floor(Number(env.CURSUS_PG_POOL)) : 10;
    this.placesLecture = new PlacesLecture(Math.max(1, Math.floor(max / 2)));
    const delais = delaisPg(env);
    this.delaiVerrou = delais.verrou;
    this.pool = new pg.Pool({
      connectionString: url,
      application_name: 'cursus',
      // search_path aussi fixé sur le rôle par le socle (ALTER ROLE cursus_app SET search_path) : derrière PgBouncer en
      // mode transaction, qui refuse `options`, retirer cette ligne suffit (les délais sont alors à poser sur le rôle :
      // ALTER ROLE cursus_app SET lock_timeout / statement_timeout, demande à Matrix).
      options: `-c search_path=${this.schema} -c lock_timeout=${delais.verrou} -c statement_timeout=${delais.requete}`,
      connectionTimeoutMillis: delais.connexion,
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

  get lectureStable(): boolean { return this.enCours()?.mode === 'lecture'; }

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

  /**
   * État de la révision (lot 9, chantier 1, étape 2) : l'époque est celle de la colonne augmentée de l'OID de la table
   * `revision`. Un pg_restore qui recrée les tables (procédure de docs/SAUVEGARDE.md) remet l'ancienne valeur de la
   * colonne, mais pas l'OID : l'époque change, et tout écart qui la traverse est inconnu (relecture complète). Un
   * rechargement des données seules garde l'OID : `npm run revision:epoque` (server/src/purge-changements.ts) ou le
   * redémarrage des instances.
   */
  async etatRevision(): Promise<EtatRevision> {
    const r = await this.one<{ n: number; epoque: number; purge: number; oid: number }>(
      `SELECT n, epoque, purge, CAST(CAST(to_regclass(?) AS oid) AS bigint) AS oid FROM revision`, [`${this.schema}.revision`]);
    return { n: Number(r?.n ?? 0), epoque: Number(r?.epoque ?? 0) + Number(r?.oid ?? 0), purge: Number(r?.purge ?? 0) };
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
  private async recaler(table: TableName, colonne = snake(this.def(table).pk)): Promise<void> {
    const t = snake(table), pk = colonne;
    await this.query(`SELECT setval(s.seq, GREATEST((SELECT COALESCE(MAX(${pk}), 0) FROM ${t}), COALESCE(pg_sequence_last_value(s.seq), 0), 1),
      (SELECT COUNT(*) > 0 FROM ${t}) OR pg_sequence_last_value(s.seq) IS NOT NULL) FROM (SELECT pg_get_serial_sequence(?, ?)::regclass AS seq) s`, [t, pk]);
  }

  async resyncIds(): Promise<void> {
    for (const [name, def] of Object.entries(TABLES) as [TableName, TableDef][]) if (def.auto) await this.recaler(name);
    // Colonne d'ordre `rang` fixée à l'insertion (reprise d'une base SQLite) : les référentiels ajoutés ensuite viennent après.
    for (const name of TABLES_RANG) await this.recaler(name, 'rang');
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
    return await this.fileEcritures.passer(this.delaiVerrou, async () => await this.avecConnexion(async client => {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.cleEcritures]);
      const q: PorteePg = { client, mode: 'tx', tx: true, active: true, file: Promise.resolve() };
      return await this.transaction(client, async () => await this.dans(q, fn));
    }));
  }

  async lecture<T>(fn: () => Promise<T> | T, options: { courte?: boolean } = {}): Promise<T> {
    if (this.enCours()) return await fn();
    // Lecture courte (identité de la requête : quelques lignes) : sans place, elle n'attend pas les instantanés.
    const place = !options.courte;
    if (place) await this.placesLecture.prendre();
    try {
      return await this.avecConnexion(async client => {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const q: PorteePg = { client, mode: 'lecture', tx: true, active: true, file: Promise.resolve() };
        const r = await this.dans(q, fn);
        await client.query('COMMIT');
        return r;
      });
    } finally {
      if (place) this.placesLecture.rendre();
    }
  }

  /**
   * Suite exclusive : le verrou d'écriture est pris pour la session (`pg_advisory_lock`, même clé que le verrou des
   * transactions, avec lequel il entre en conflit) et rendu à la fin ; les requêtes hors de `tx` sont validées une à une,
   * comme en SQLite. La réponse d'une route n'est donc jamais envoyée avant la validation de ce qu'elle a écrit.
   */
  async exclusif<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.enCours()) return await fn();
    return await this.fileEcritures.passer(this.delaiVerrou, async () => await this.avecConnexion(async client => {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [this.cleEcritures]);
      try {
        return await this.dans({ client, mode: 'exclusif', tx: false, active: true, file: Promise.resolve() }, fn);
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [this.cleEcritures]);
      }
    }));
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
      // Migrations sans délai : une instance qui démarre attend celle qui migre, et une migration longue (index sur le
      // journal) n'est pas interrompue ; délais du pool rétablis avant de rendre la connexion.
      await client.query('SET lock_timeout = 0; SET statement_timeout = 0');
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
        await client.query('RESET lock_timeout; RESET statement_timeout');
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
    // Révision de la base (lot 8, chantier E, migration 0013_index_journal) : chaque table hors TABLES_SANS_REVISION porte
    // son déclencheur, sinon le cache de l'instantané servirait un état périmé après une écriture de cette table. Un
    // déclencheur ne compte que s'il s'exécute dans les sessions ordinaires (session_replication_role = origin) :
    // tgenabled 'O' (ENABLE) ou 'A' (ENABLE ALWAYS) ; désactivé ('D') ou en mode réplication ('R', ENABLE REPLICA
    // TRIGGER) compte comme manquant.
    const declencheurs = new Set((await this.query<{ t: string }>(`SELECT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ? AND g.tgname = 'revision' AND g.tgenabled IN ('O', 'A')`, [this.schema])).map(l => l.t));
    if (!lignes.some(l => l.t === 'revision')) manquantes.push('table revision');
    for (const name of Object.keys(TABLES) as TableName[]) {
      if (!TABLES_SANS_REVISION.has(name) && lignes.some(l => l.t === snake(name)) && !declencheurs.has(snake(name))) manquantes.push(`déclencheur revision de ${snake(name)}`);
    }
    // Journal des changements (lot 9, chantier 1, migration 0014_changements) : la table `changements`, la purge et
    // l'époque de `revision`, et sur chaque table hors TABLES_SANS_REVISION ses quatre déclencheurs `revision_lignes_*`,
    // actifs au même sens (insertion, modification, suppression, TRUNCATE). Sans eux, le cache passerait d'une révision à l'autre
    // par un delta qui oublie les lignes de cette table. Une table ajoutée après 0014 les reçoit dans sa propre migration.
    for (const c of ['changements.n', 'changements.tbl', 'changements.pk', 'revision.purge', 'revision.epoque']) {
      if (!vues.has(c)) manquantes.push(lignes.some(l => l.t === c.split('.')[0]) ? c : `table ${c.split('.')[0]}`);
    }
    const lignesChangees = new Set((await this.query<{ t: string; g: string }>(`SELECT c.relname AS t, g.tgname AS g FROM pg_trigger g
      JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ? AND g.tgname LIKE 'revision_lignes_%' AND g.tgenabled IN ('O', 'A')`, [this.schema])).map(l => `${l.t}.${l.g}`));
    for (const name of Object.keys(TABLES) as TableName[]) {
      if (TABLES_SANS_REVISION.has(name) || !lignes.some(l => l.t === snake(name))) continue;
      const absents = DECLENCHEURS_CHANGEMENTS.filter(g => !lignesChangees.has(`${snake(name)}.${g}`));
      if (absents.length) manquantes.push(`déclencheur${absents.length > 1 ? 's' : ''} ${absents.join(', ')} de ${snake(name)}`);
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
