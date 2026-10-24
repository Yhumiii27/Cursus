// Connexion au serveur PostgreSQL commun en lecture seule, pour le pré-vol de la mise en production
// (npm run verifier-production, server/src/verifier-production.ts) : ni migration, ni contrôle qui écrive, ni création du
// journal des migrations. Chaque connexion du pool est mise en lecture seule dès son ouverture
// (default_transaction_read_only) : une écriture échouerait. La couche commune (server/src/db-pg.ts, propriété du
// chantier E du lot 8) n'est pas modifiée : la classe PgDb est construite sans ouvrirPostgres, qui migrerait.
import pg from 'pg';
import { PgDb, SCHEMA_PG } from './db-pg.ts';
import type { Env } from './config.ts';
import { DELAI_CONNEXION_MS, type FaitsServeur } from './pre-vol.ts';

export class ConnexionImpossible extends Error {}

/** Délai d'une requête du pré-vol (statement_timeout) : un serveur saturé fait échouer la commande plutôt que l'attendre. */
const DELAI_REQUETE_MS = 15_000;
/** Échec volontairement ignoré (requête de réglage, requête restée sans réponse, fermeture). */
const ignorer = () => {};

/**
 * Ouvre `url` en lecture seule (schéma `schema`, cursus par défaut) et vérifie la connexion dans DELAI_CONNEXION_MS :
 * ConnexionImpossible sinon, sans jamais afficher l'adresse (elle porte le mot de passe). Le pool est fermé en cas d'échec.
 */
export async function ouvrirPgLecture(url: string, opts: { schema?: string; env?: Env; delaiMs?: number } = {}): Promise<{ db: PgDb; dureeConnexionMs: number }> {
  const db = new PgDb(url, { schema: opts.schema ?? SCHEMA_PG, env: { CURSUS_PG_POOL: '2', ...opts.env } });
  // Requêtes mises en tête de file de la connexion, avant toute autre (node-postgres les exécute dans l'ordre).
  db.pool.on('connect', (client: pg.PoolClient) => { // await-ok: réglage de chaque connexion du pool (lecture seule), sans requête applicative
    client.query(`SET default_transaction_read_only = on; SET statement_timeout = ${DELAI_REQUETE_MS}`).catch(ignorer); // await-ok: file de la connexion, avant toute requête
  });
  const debut = Date.now();
  const delai = opts.delaiMs ?? DELAI_CONNEXION_MS;
  // Serveur qui accepte la connexion sans répondre : le pool coupe la connexion au bout du délai.
  db.pool.options.connectionTimeoutMillis = delai; // await-ok: réglage du pool, sans requête
  let minuterie: NodeJS.Timeout | undefined;
  try {
    const lecture = db.one<{ ro: string }>(`SELECT current_setting('default_transaction_read_only') AS ro`);
    // Requête restée en cours après le délai : son échec, à la fermeture du pool, ne doit pas arrêter le processus.
    lecture.catch(ignorer); // await-ok: attendue par Promise.race ci-dessous
    const r = await Promise.race([
      lecture,
      new Promise((_, rej) => { minuterie = setTimeout(() => rej(new ConnexionImpossible(`aucune réponse du serveur PostgreSQL en ${delai / 1000} s`)), delai); }),
    ]) as { ro: string } | undefined;
    // Garantie de la commande : rien ne peut être écrit. Sans elle, la commande renonce.
    if (r?.ro !== 'on') throw new ConnexionImpossible('lecture seule non obtenue sur la connexion PostgreSQL : contrôle abandonné');
    return { db, dureeConnexionMs: Date.now() - debut };
  } catch (err) {
    // Fermeture non attendue : une requête restée sans réponse la ferait attendre (la commande s'arrête ensuite).
    db.fermer().catch(ignorer); // await-ok: fermeture sans attendre un serveur muet
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ConnexionImpossible) throw err;
    if (/timeout exceeded when trying to connect|connection timeout/i.test(message)) throw new ConnexionImpossible(`aucune réponse du serveur PostgreSQL en ${delai / 1000} s`);
    throw new ConnexionImpossible(`connexion au serveur PostgreSQL impossible (${message.replace(/postgres(ql)?:\/\/\S+/gi, '…')})`);
  } finally {
    clearTimeout(minuterie);
  }
}

/**
 * Faits du serveur pour les contrôles de pre-vol.ts : rôle, schéma courant, droits, migrations notées, conformité du
 * schéma au code (contrôle du démarrage, en lecture), colonnes des vues pub_, écart d'horloge. Lecture seule.
 */
export async function faitsServeur(db: PgDb, dureeConnexionMs: number): Promise<FaitsServeur> {
  const avant = Date.now();
  const r = (await db.one<{ u: string; su: boolean; s: string | null; c: boolean; maintenant: string; journal: boolean }>(`SELECT current_user AS u,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, current_schema() AS s,
      has_database_privilege(current_database(), 'CREATE') AS c, clock_timestamp() AS maintenant,
      to_regclass(quote_ident(current_schema()) || '.schema_migrations') IS NOT NULL AS journal`))!;
  const apres = Date.now();
  const globaux = (await db.query<{ r: string }>(`SELECT g.rolname AS r FROM pg_roles g
      WHERE g.rolname IN ('pg_read_all_data', 'pg_write_all_data') AND pg_has_role(current_user, g.oid, 'MEMBER') ORDER BY 1`)).map(x => x.r);
  const migrations = r.s && r.journal ? (await db.query<{ nom: string }>('SELECT nom FROM schema_migrations ORDER BY nom')).map(x => x.nom) : null;
  let schemaIncomplet: string | null = null;
  if (r.s) {
    try { await db.controlerSchema(); } catch (err) { schemaIncomplet = err instanceof Error ? err.message : String(err); }
  } else schemaIncomplet = 'schéma absent';
  const vues: Record<string, string[]> = {};
  for (const l of await db.query<{ t: string; c: string }>(`SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name LIKE 'pub\\_%' ORDER BY table_name, ordinal_position`)) (vues[l.t] ??= []).push(l.c);
  return {
    utilisateur: r.u, superutilisateur: !!r.su, schemaCourant: r.s, creerDansBase: !!r.c, droitsGlobaux: globaux, migrations, schemaIncomplet, vues,
    // Heure du serveur comparée au milieu de l'aller-retour.
    ecartHorlogeMs: Date.parse(r.maintenant) - (avant + apres) / 2, dureeConnexionMs,
  };
}
