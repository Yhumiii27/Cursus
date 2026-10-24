// Essai de charge sur PostgreSQL (lot 8, chantier E) : éléments communs au générateur (scripts/charge/generer.ts) et à
// l'exécuteur (scripts/charge/executer.ts). L'essai ne tourne jamais sur le serveur commun EPC2I en service : il
// travaille dans un schéma jetable `cursus_charge_<horodatage>` d'un serveur PostgreSQL 16 de test, désigné comme pour
// npm run test:pg par CURSUS_TEST_DATABASE_URL (base d'administration : postgres://postgres@127.0.0.1:5432/postgres).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { RACINE } from '../../server/src/chemins.ts';

/** Dossier des jeux générés et des rapports (data/ n'est pas versionné : .gitignore). */
export const DOSSIER_CHARGE = join(RACINE, 'data', 'charge');
/** Préfixe des schémas jetables de l'essai (un par jeu généré). */
export const PREFIXE_SCHEMA = 'cursus_charge_';

/** Arrêt de l'outil avec un message en français, sans pile. */
export class RefusCharge extends Error {}

/** Arguments `--nom valeur` et `--drapeau` de la ligne de commande. */
export function lireArguments(argv = process.argv.slice(2)): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new RefusCharge(`argument inattendu : ${a}`);
    const suivant = argv[i + 1];
    if (suivant !== undefined && !suivant.startsWith('--')) { out.set(a.slice(2), suivant); i++; } else out.set(a.slice(2), '');
  }
  return out;
}

/** Entier positif d'un argument, ou la valeur par défaut. */
export function entier(args: Map<string, string>, nom: string, defaut: number): number {
  const v = args.get(nom);
  if (v === undefined) return defaut;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new RefusCharge(`--${nom} : entier positif attendu (reçu « ${v} »)`);
  return n;
}

/** Base d'administration du serveur de test (CURSUS_TEST_DATABASE_URL), contrôlée par `refuserServeurCommun`. */
export function urlAdministration(env = process.env): string {
  const url = env.CURSUS_TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new RefusCharge('définissez CURSUS_TEST_DATABASE_URL (base d’administration d’un serveur PostgreSQL 16 de test, par exemple '
      + 'postgres://postgres@127.0.0.1:5432/postgres) : l’essai de charge ne tourne jamais sur le serveur commun EPC2I.');
  }
  return url;
}

/** Schémas des autres outils du serveur commun (socle Matrix) : leur présence désigne le serveur commun. */
const SCHEMAS_COMMUNS = ['matrix', 'keystone', 'vigie', 'codex', 'arche', 'crucible'];

/**
 * Refus du serveur commun EPC2I : base `epc2i`, rôle `cursus_app`, ou schéma d'un autre outil du socle sur la base.
 * L'essai écrit des centaines de milliers de lignes et tient le verrou d'écriture : il ralentirait Keystone, Vigie et
 * Crucible, et laisserait des données fictives à côté des vraies.
 */
export async function refuserServeurCommun(client: pg.Client): Promise<void> {
  const { rows: [s] } = await client.query<{ base: string; role: string; communs: string[] }>(
    'SELECT current_database() AS base, current_user AS role, ARRAY(SELECT nspname::text FROM pg_namespace WHERE nspname = ANY($1)) AS communs', [SCHEMAS_COMMUNS]);
  if (s.base === 'epc2i' || s.role === 'cursus_app' || s.communs.length) {
    throw new RefusCharge(`serveur commun EPC2I reconnu (base ${s.base}, rôle ${s.role}${s.communs.length ? `, schémas ${s.communs.join(', ')}` : ''}) : `
      + 'l’essai de charge ne tourne que sur un serveur PostgreSQL de test (CURSUS_TEST_DATABASE_URL).');
  }
}

/** Connexion d'administration au serveur de test, serveur commun refusé. */
export async function connecterAdministration(url = urlAdministration()): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, application_name: 'cursus-charge' });
  await client.connect();
  try {
    await refuserServeurCommun(client);
  } catch (err) {
    await client.end();
    throw err;
  }
  return client;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) : même graine, mêmes données. */
export function aleatoire(graine: number) {
  let a = graine >>> 0;
  const suivant = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    suivant,
    /** Entier de [min, max]. */
    entre: (min: number, max: number) => min + Math.floor(suivant() * (max - min + 1)),
    /** Vrai avec la probabilité `p`. */
    si: (p: number) => suivant() < p,
    /** Élément au hasard. */
    choix: <T>(liste: readonly T[]): T => liste[Math.floor(suivant() * liste.length)],
  };
}
export type Aleatoire = ReturnType<typeof aleatoire>;

/** Description d'un jeu généré, lue par l'exécuteur (data/charge/jeu-<schéma>.json) : aucun secret. */
export interface JeuCharge {
  schema: string;
  /** Base du serveur de test (nom seul : l'URL vient de CURSUS_TEST_DATABASE_URL). */
  base: string;
  aujourdhui: string;
  graine: number;
  ans: number;
  /** Comptes à simuler : collaborateurs (compte, salarié), managers (et leurs membres), service RH, paie. */
  collaborateurs: { compteId: number; empId: number }[];
  managers: { compteId: number; empId: number; equipe: string }[];
  rh: number[];
  paie: number[];
  /** Jetons d'abonnement à l'agenda (flux ICS) créés pour l'essai : valeurs d'essai, sans valeur hors du schéma jetable. */
  jetonsAgenda: string[];
  /** Semaines soumises à valider (fin de mois) et semaine en cours (saisie du vendredi). */
  soumises: string[];
  semaineCourante: string;
  /** Période de paie encore ouverte (lot du scénario paie). */
  periodePaie: string;
  chantier: string;
  volumes: Record<string, { lignes: number; octets: number }>;
}

export const fichierJeu = (schema: string) => join(DOSSIER_CHARGE, `jeu-${schema}.json`);

export function ecrireJeu(jeu: JeuCharge): string {
  mkdirSync(DOSSIER_CHARGE, { recursive: true, mode: 0o700 });
  const f = fichierJeu(jeu.schema);
  writeFileSync(f, JSON.stringify(jeu, null, 2), { mode: 0o600 });
  return f;
}

/** Jeu désigné par son schéma, sinon le plus récent (nom horodaté). */
export function lireJeu(schema?: string): JeuCharge {
  let nom = schema;
  if (!nom) {
    const jeux = (() => { try { return readdirSync(DOSSIER_CHARGE); } catch { return []; } })()
      .filter(f => f.startsWith(`jeu-${PREFIXE_SCHEMA}`) && f.endsWith('.json')).sort();
    if (!jeux.length) throw new RefusCharge('aucun jeu de charge : lancez d’abord npm run charge:generer');
    nom = jeux.at(-1)!.slice(4, -5);
  }
  try {
    return JSON.parse(readFileSync(fichierJeu(nom), 'utf8')) as JeuCharge;
  } catch {
    throw new RefusCharge(`jeu de charge ${nom} introuvable dans ${DOSSIER_CHARGE}`);
  }
}

/** URL de la base `nom` sur le serveur de `url`. */
export function urlBase(url: string, nom: string): string {
  const u = new URL(url);
  u.pathname = `/${nom}`;
  return u.toString();
}

/** Horodatage compact (schéma, dossier de rapport) : 20261024T153012. */
export const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').slice(0, 15).toLowerCase();

/** Exécute `principal` ; un refus attendu s'affiche en une ligne (code 2), toute autre erreur avec sa pile (code 1). */
export function lancer(outil: string, principal: () => Promise<void>): void {
  principal().then(() => process.exit(0), (err: unknown) => {
    if (err instanceof RefusCharge) { console.error(`${outil} : ${err.message}`); process.exit(2); }
    console.error(err);
    process.exit(1);
  });
}
