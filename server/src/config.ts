// Configuration lue dans l'environnement et contrôlée au démarrage du serveur.
// En production (NODE_ENV=production), une configuration dangereuse empêche le
// démarrage ; ailleurs, elle est seulement signalée. Variables : .env.example.

import { lireAdressesKeystone } from './filtre-keystone.ts';

export type Env = Record<string, string | undefined>;

/** Le mode démonstration (connexion libre, sélecteur de vue, réinitialisation) ne s'active qu'avec CURSUS_DEMO=1. */
export function demoActive(env: Env = process.env): boolean {
  return env.CURSUS_DEMO === '1';
}

export function enProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** Adresses de la boucle locale : seul le poste lui-même peut joindre le serveur. */
export const BOUCLE_LOCALE = ['127.0.0.1', 'localhost', '::1'];

/** Adresse d'écoute : la boucle locale en production (derrière le reverse proxy), toutes les interfaces sinon. */
export function hoteEcoute(env: Env = process.env): string {
  return env.CURSUS_HOST || env.HOST || (enProduction(env) ? '127.0.0.1' : '0.0.0.0');
}

/**
 * Démonstration réservée au poste lui-même : adresse d'écoute de la boucle locale posée
 * explicitement (CURSUS_HOST ou HOST, comme le fait l'application de bureau). La valeur par
 * défaut de production ne suffit pas : c'est aussi celle de Cursus derrière le reverse proxy.
 */
export function demoSurBoucleLocale(env: Env = process.env): boolean {
  return demoActive(env) && BOUCLE_LOCALE.includes(env.CURSUS_HOST || env.HOST || '');
}

/**
 * Démonstration publiée derrière le reverse proxy (hébergeur à conteneurs, Coolify), autorisée explicitement par
 * CURSUS_DEMO_PUBLIQUE=1 : instance de démonstration aux données fictives seulement, dont l'accès est restreint en amont
 * (authentification du proxy, liens diffusés à quelques personnes). Jamais sur une base de production : l'espace RH
 * s'y ouvre sans mot de passe.
 */
export function demoPublique(env: Env = process.env): boolean {
  return demoActive(env) && env.CURSUS_DEMO_PUBLIQUE === '1';
}

/**
 * Écoute sur la boucle locale posée explicitement (CURSUS_HOST ou HOST), démonstration ou non : application de bureau,
 * essais locaux avec NODE_ENV=production. Même critère que demoSurBoucleLocale, sans exiger la démonstration.
 */
export function boucleLocaleExplicite(env: Env = process.env): boolean {
  return BOUCLE_LOCALE.includes(env.CURSUS_HOST || env.HOST || '');
}

/**
 * Liaisons sortantes d'une démonstration publique (constat S3 du lot 8) : envois à Keystone et déclaration à Matrix
 * coupés, sauf CURSUS_DEMO_LIAISONS=1 posée explicitement (liaison voulue entre démonstrations, Keystone de démonstration).
 * Une démonstration ouverte sans mot de passe n'écrit ainsi rien de fictif chez les autres outils par mégarde.
 */
export function liaisonsCoupees(env: Env = process.env): boolean {
  return demoPublique(env) && env.CURSUS_DEMO_LIAISONS !== '1';
}

/** Base du serveur PostgreSQL commun EPC2I (socle de Matrix) : celle de la production, jamais d'une démonstration. */
export const BASE_COMMUNE = 'epc2i';
/** Rôle de Cursus sur le serveur commun (socle de Matrix, infra/postgres-socle/01-base-et-roles.sql). */
export const ROLE_CURSUS = 'cursus_app';

/** Modes de chiffrement qui n'en garantissent aucun : la connexion peut passer en clair. */
const SSL_NON_GARANTI = ['disable', 'allow', 'prefer'];

/**
 * Rôle et base de DATABASE_URL (jamais le mot de passe), ou null si elle est absente ou illisible. Lus comme node-postgres
 * (pg-connection-string) : le paramètre ?user= de l'adresse l'emporte sur l'utilisateur, PGUSER en dernier recours (rôle
 * vide : aucun des trois, node-postgres prendrait alors le compte du système). `tls` : le réglage qui chiffre la
 * connexion (sslmode=…, ssl=true, ou PGSSLMODE quand l'adresse n'en dit rien), null si rien ne la garantit.
 */
export function cibleBase(env: Env = process.env): { role: string; base: string; hote: string; sslmode: string | null; tls: string | null } | null {
  const url = env.DATABASE_URL?.trim();
  if (!url || !/^postgres(ql)?:\/\//i.test(url) || !URL.canParse(url)) return null;
  const u = new URL(url);
  const q = u.searchParams;
  const sslmode = q.get('sslmode'), ssl = q.get('ssl'), pgsslmode = (env.PGSSLMODE ?? '').trim();
  let tls: string | null = null;
  if (sslmode) tls = SSL_NON_GARANTI.includes(sslmode) ? null : `sslmode=${sslmode}`;
  else if (ssl) tls = ['true', '1', 'no-verify'].includes(ssl) ? `ssl=${ssl}` : null;
  else if (pgsslmode && !SSL_NON_GARANTI.includes(pgsslmode)) tls = `PGSSLMODE=${pgsslmode}`;
  return {
    role: q.get('user') || decodeURIComponent(u.username) || (env.PGUSER ?? '').trim(),
    base: decodeURIComponent(u.pathname.replace(/^\//, '')), hote: u.hostname.replace(/^\[|\]$/g, ''), sslmode, tls,
  };
}

/**
 * Démonstration branchée sur la base du serveur commun (epc2i) : ses salariés fictifs seraient publiés aux autres outils
 * par les vues pub_. Dans le lot 8, signalée seulement (avertissement au démarrage, état « degrade » du point de santé),
 * pour ne pas arrêter la démonstration en ligne avant la décision du propriétaire ; interdite au jour de la bascule
 * (docs/BASCULE-PRODUCTION.md) et dès que la base porte la purge ou le réglage `exploitation` (server/src/index.ts).
 */
export function demoSurBaseCommune(env: Env = process.env): boolean {
  return demoActive(env) && cibleBase(env)?.base === BASE_COMMUNE;
}

export function portEcoute(env: Env = process.env): number {
  return Number(env.CURSUS_API_PORT || env.PORT || 3210);
}

/**
 * Réglage `trust proxy` d'Express : proxys dont les en-têtes X-Forwarded-* sont crus
 * (protocole HTTPS, adresse du client). Par défaut, un proxy sur la même machine.
 */
export function trustProxy(env: Env = process.env): boolean | number | string {
  const v = (env.CURSUS_TRUST_PROXY ?? '').trim();
  if (!v) return 'loopback';
  if (v === 'true' || v === 'false') return v === 'true';
  return /^\d+$/.test(v) ? Number(v) : v;
}

// — Exploitation : journaux du serveur et compression (server/src/logs.ts, server/src/compression.ts) —

/**
 * Format des journaux (CURSUS_LOG_FORMAT) : `json`, une ligne JSON par message et par requête, lisible par l'agrégateur
 * de Coolify ou du service informatique, par défaut en production ; `texte`, lisible à l'œil, par défaut ailleurs.
 */
export function formatJournaux(env: Env = process.env): 'json' | 'texte' {
  const v = (env.CURSUS_LOG_FORMAT ?? '').trim().toLowerCase();
  if (v === 'json' || v === 'texte') return v;
  return enProduction(env) ? 'json' : 'texte';
}

/** Compression des réponses par Cursus (CURSUS_COMPRESSION) : active par défaut, `0` si le proxy compresse déjà. */
export function compressionActive(env: Env = process.env): boolean {
  return (env.CURSUS_COMPRESSION ?? '').trim() !== '0';
}

/** Valeurs inconnues de CURSUS_LOG_FORMAT et CURSUS_COMPRESSION : la valeur par défaut s'appliquerait sans le dire. */
function problemesExploitation(env: Env): string[] {
  const out: string[] = [];
  const format = (env.CURSUS_LOG_FORMAT ?? '').trim();
  if (format && !['json', 'texte'].includes(format.toLowerCase())) out.push(`CURSUS_LOG_FORMAT vaut « ${format} » : indiquez json (par défaut en production) ou texte.`);
  const compression = (env.CURSUS_COMPRESSION ?? '').trim();
  if (compression && !['0', '1'].includes(compression)) out.push(`CURSUS_COMPRESSION vaut « ${compression} » : indiquez 1 (par défaut) ou 0 (le proxy compresse déjà).`);
  return out;
}

/** Clé Keystone publiée dans la documentation : acceptée uniquement en mode démonstration. */
export const KEYSTONE_CLE_DEMO = 'demo-keystone';

// — Connexion Microsoft 365 (Entra ID, server/src/microsoft.ts, docs/CONNEXION-MICROSOFT.md) —

/** Service de connexion de Microsoft ; CURSUS_OIDC_AUTORITE le remplace dans les tests (faux fournisseur local). */
export const AUTORITE_MICROSOFT = 'https://login.microsoftonline.com';
const VARIABLES_OIDC = ['CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET', 'CURSUS_PUBLIC_URL'] as const;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ConfigOidc {
  /** ID de l'annuaire (locataire) Entra, au format GUID, en minuscules. */
  tenant: string;
  clientId: string;
  clientSecret: string;
  /** Adresse publique de Cursus, sans « / » final (https://cursus.example.fr). */
  publicUrl: string;
  /** URI de redirection inscrite dans Entra : ${publicUrl}/api/auth/microsoft/retour. */
  redirection: string;
  autorite: string;
}

/** Adresse publique réduite à son origine (schéma, nom, port), ou null si elle n'en est pas une. */
export function originePublique(v: string): string | null {
  try {
    const u = new URL(v);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.pathname !== '/' || u.search || u.hash || u.username) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Configuration de la connexion Microsoft 365 : null si l'une des quatre variables manque ou n'est pas valable. */
export function configOidc(env: Env = process.env): ConfigOidc | null {
  const [tenant, clientId, clientSecret, url] = VARIABLES_OIDC.map(k => (env[k] ?? '').trim());
  const publicUrl = originePublique(url);
  if (!GUID.test(tenant.toLowerCase()) || !clientId || !clientSecret || !publicUrl) return null;
  return {
    tenant: tenant.toLowerCase(), clientId, clientSecret, publicUrl, redirection: `${publicUrl}/api/auth/microsoft/retour`,
    autorite: (env.CURSUS_OIDC_AUTORITE || AUTORITE_MICROSOFT).replace(/\/+$/, ''),
  };
}

/**
 * Problèmes de la configuration Microsoft 365 : tout ou rien, locataire désigné par son GUID, adresse publique en https.
 * CURSUS_PUBLIC_URL seule n'est pas une connexion Microsoft incomplète : depuis le lot 8, elle est exigée en production
 * pour elle-même (liens des e-mails, contrôle d'origine des requêtes : problemesProduction).
 */
function problemesOidc(env: Env): string[] {
  const out: string[] = [];
  const definies = VARIABLES_OIDC.filter(k => (env[k] ?? '').trim());
  const manquantes = VARIABLES_OIDC.filter(k => !definies.includes(k));
  if (definies.some(k => k !== 'CURSUS_PUBLIC_URL') && manquantes.length) out.push(`Connexion Microsoft 365 incomplète : définissez aussi ${manquantes.join(', ')} (les quatre variables, ou aucune).`);
  const tenant = (env.CURSUS_OIDC_TENANT ?? '').trim();
  if (tenant && !GUID.test(tenant.toLowerCase())) out.push(`CURSUS_OIDC_TENANT doit être l’ID de l’annuaire (locataire) Entra, au format GUID (« ${tenant} » reçu ; common, organizations et un nom de domaine ne conviennent pas).`);
  const url = (env.CURSUS_PUBLIC_URL ?? '').trim();
  if (url && !originePublique(url)) out.push(`CURSUS_PUBLIC_URL doit être l’adresse publique de Cursus, sans chemin (https://cursus.example.fr) : « ${url} » reçu.`);
  else if (url && !url.startsWith('https://')) out.push(`CURSUS_PUBLIC_URL doit être en https (« ${url} » reçu) : liens des e-mails, contrôle d’origine des requêtes, et Microsoft ne renvoie le code de connexion qu’à une adresse sûre.`);
  return out;
}

/**
 * Date d'expiration du secret client de l'application Entra (CURSUS_OIDC_SECRET_EXPIRE, AAAA-MM-JJ, relevée dans
 * « Certificats & secrets ») : facultative ; null si elle est absente ou n'est pas une date. Cursus prévient 30 jours
 * avant (server/src/secret-microsoft.ts) : point de santé « degrade » et ligne du récapitulatif des échéances.
 */
export function expirationSecretOidc(env: Env = process.env): string | null {
  return dateAaaaMmJj(env.CURSUS_OIDC_SECRET_EXPIRE);
}

/** Date AAAA-MM-JJ réelle (ni 2027-02-30, ni 27/01/2027), ou null. */
function dateAaaaMmJj(valeur: string | undefined): string | null {
  const v = (valeur ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * Date d'expiration du secret propre à l'envoi des e-mails (CURSUS_MAIL_SECRET_EXPIRE, AAAA-MM-JJ, lot 8) : facultative,
 * utile quand l'envoi passe par une application Entra distincte de la connexion (CURSUS_MAIL_CLIENT_SECRET). Le jour où
 * ce secret expire, plus aucun e-mail ne part ; Cursus prévient 30 jours avant (server/src/secret-microsoft.ts).
 */
export function expirationSecretEnvoi(env: Env = process.env): string | null {
  return dateAaaaMmJj(env.CURSUS_MAIL_SECRET_EXPIRE);
}

/** CURSUS_OIDC_SECRET_EXPIRE illisible (l'alerte ne partirait jamais), ou posée sans secret client à surveiller. */
function problemesExpirationSecret(env: Env): string[] {
  const v = (env.CURSUS_OIDC_SECRET_EXPIRE ?? '').trim();
  if (!v) return [];
  if (!expirationSecretOidc(env)) return [`CURSUS_OIDC_SECRET_EXPIRE doit être la date d’expiration du secret client, au format AAAA-MM-JJ (« ${v} » reçu) : sans elle, Cursus ne peut pas prévenir avant l’expiration.`];
  if (!(env.CURSUS_OIDC_CLIENT_SECRET ?? '').trim()) return ['CURSUS_OIDC_SECRET_EXPIRE est définie sans CURSUS_OIDC_CLIENT_SECRET : aucun secret client à surveiller. Retirez-la, ou complétez la connexion Microsoft 365.'];
  return [];
}

/** CURSUS_MAIL_SECRET_EXPIRE illisible, ou posée sans secret d'envoi distinct (CURSUS_MAIL_CLIENT_SECRET) à surveiller. */
function problemesExpirationSecretEnvoi(env: Env): string[] {
  const v = (env.CURSUS_MAIL_SECRET_EXPIRE ?? '').trim();
  if (!v) return [];
  if (!expirationSecretEnvoi(env)) return [`CURSUS_MAIL_SECRET_EXPIRE doit être la date d’expiration du secret d’envoi des e-mails, au format AAAA-MM-JJ (« ${v} » reçu) : sans elle, Cursus ne peut pas prévenir avant l’expiration.`];
  if (!(env.CURSUS_MAIL_CLIENT_SECRET ?? '').trim()) return ['CURSUS_MAIL_SECRET_EXPIRE est définie sans CURSUS_MAIL_CLIENT_SECRET : l’envoi passe par le secret de la connexion, surveillé par CURSUS_OIDC_SECRET_EXPIRE. Retirez-la.'];
  return [];
}

// — Envoi des e-mails par Microsoft Graph (server/src/integrations/email.ts, docs/EMAILS.md) —

/** API Microsoft Graph ; les tests la remplacent par un faux service local (option de `transportEmail`). */
export const GRAPH_MICROSOFT = 'https://graph.microsoft.com';

export interface ConfigMail {
  /** Locataire Entra (GUID), application et secret : CURSUS_MAIL_*, sinon ceux de la connexion Microsoft (CURSUS_OIDC_*). */
  tenant: string;
  clientId: string;
  clientSecret: string;
  /** Boîte d'envoi dédiée (cursus@entreprise.fr), seule boîte que l'application peut utiliser. */
  from: string;
  /** Service de jetons (login.microsoftonline.com, remplacé dans les tests par CURSUS_OIDC_AUTORITE) et API Graph. */
  autorite: string;
  graph: string;
}

const ADRESSE_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Variable d'envoi, sinon celle de la connexion Microsoft. */
const mailOuOidc = (env: Env, k: 'TENANT' | 'CLIENT_ID' | 'CLIENT_SECRET') => (env[`CURSUS_MAIL_${k}`] || env[`CURSUS_OIDC_${k}`] || '').trim();

/**
 * Envoi des e-mails : null (simulation : rien ne part, tout est tracé) sans CURSUS_MAIL_FROM, ou si l'application
 * Entra n'est pas entièrement désignée (locataire GUID, ID d'application, secret). Toujours null en démonstration
 * (CURSUS_DEMO=1, constat S3 du lot 8) : aucun e-mail réel ne part d'une instance aux données fictives.
 */
export function configMail(env: Env = process.env): ConfigMail | null {
  if (demoActive(env)) return null;
  const from = (env.CURSUS_MAIL_FROM ?? '').trim().toLowerCase();
  const [tenant, clientId, clientSecret] = (['TENANT', 'CLIENT_ID', 'CLIENT_SECRET'] as const).map(k => mailOuOidc(env, k));
  if (!ADRESSE_MAIL.test(from) || !GUID.test(tenant.toLowerCase()) || !clientId || !clientSecret) return null;
  return {
    tenant: tenant.toLowerCase(), clientId, clientSecret, from,
    autorite: (env.CURSUS_OIDC_AUTORITE || AUTORITE_MICROSOFT).replace(/\/+$/, ''), graph: GRAPH_MICROSOFT,
  };
}

/** Problèmes de la configuration des e-mails : boîte d'envoi valide, application Entra complète (sinon les e-mails resteraient simulés). */
function problemesMail(env: Env): string[] {
  const out: string[] = [];
  const from = (env.CURSUS_MAIL_FROM ?? '').trim();
  const propres = (['CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET'] as const).filter(k => (env[k] ?? '').trim());
  if (!from) {
    if (propres.length) out.push(`${propres.join(', ')} ${propres.length > 1 ? 'sont définies' : 'est définie'} sans CURSUS_MAIL_FROM : les e-mails restent simulés. Indiquez la boîte d’envoi dédiée (cursus@entreprise.fr).`);
    return out;
  }
  if (!ADRESSE_MAIL.test(from)) out.push(`CURSUS_MAIL_FROM doit être l’adresse de la boîte d’envoi dédiée (cursus@entreprise.fr) : « ${from} » reçu.`);
  const manquantes = (['TENANT', 'CLIENT_ID', 'CLIENT_SECRET'] as const).filter(k => !mailOuOidc(env, k)).map(k => `CURSUS_MAIL_${k}`);
  if (manquantes.length) out.push(`CURSUS_MAIL_FROM est définie, mais l’application Entra qui envoie les e-mails ne l’est pas entièrement : définissez ${manquantes.join(', ')} (ou les variables CURSUS_OIDC_* correspondantes).`);
  const tenant = mailOuOidc(env, 'TENANT');
  if (tenant && !GUID.test(tenant.toLowerCase())) out.push(`CURSUS_MAIL_TENANT doit être l’ID de l’annuaire (locataire) Entra, au format GUID (« ${tenant} » reçu).`);
  return out;
}

// — Sage Paie (server/src/integrations/sage.ts) : fichier d'import en production, pas d'envoi par API —

/**
 * SAGE_MODE inconnu (dont `api` : la paie importe le fichier dans Sage, aucun envoi par API n'est prévu) ; SAGE_URL, qui
 * faisait croire à un envoi ; simulation en production (hors application de bureau), qui marquerait des feuilles
 * transmises sans envoi.
 */
function problemesSage(env: Env): string[] {
  const out: string[] = [];
  const mode = (env.SAGE_MODE ?? '').trim();
  if (mode && !['simulation', 'fichier'].includes(mode)) {
    out.push(`SAGE_MODE vaut « ${mode} » : indiquez fichier (fichier d’import, mode de production par défaut) ou simulation.${mode === 'api' ? ' Aucun envoi à Sage Paie par API n’est prévu : la paie importe le fichier dans Sage.' : ''}`);
  }
  if (env.SAGE_URL?.trim()) out.push('SAGE_URL est définie alors qu’aucun envoi à Sage Paie par API n’est prévu : rien n’y serait envoyé. Retirez-la ; le mode de production est le fichier d’import.');
  if (mode === 'simulation' && enProduction(env) && !demoActive(env)) out.push('SAGE_MODE=simulation en production : des feuilles seraient marquées transmises à la paie sans que rien ne parte. Retirez la variable (fichier d’import par défaut).');
  return out;
}

/**
 * Serveur PostgreSQL commun (server/src/db-pg.ts) : DATABASE_URL lisible, de la forme postgres://rôle:mot de passe@hôte:port/base
 * (jamais affichée : elle porte le mot de passe), taille du pool CURSUS_PG_POOL (10 par défaut).
 */
export function problemesBase(env: Env = process.env): string[] {
  const out: string[] = [];
  const url = env.DATABASE_URL?.trim();
  if (url && (!/^postgres(ql)?:\/\/[^\s]+$/i.test(url) || !URL.canParse(url))) {
    out.push('DATABASE_URL n’est pas une adresse PostgreSQL valide : postgres://cursus_app:<mot de passe>@<hôte>:5432/epc2i (vide ou absente : base SQLite locale).');
  }
  const pool = env.CURSUS_PG_POOL?.trim();
  if (pool && !(/^\d+$/.test(pool) && Number(pool) >= 1 && Number(pool) <= 100)) out.push(`CURSUS_PG_POOL doit être un nombre de connexions entre 1 et 100 (valeur actuelle : ${pool}).`);
  return out;
}

// — Lot 8, chantier D : chiffrement des pièces justificatives au repos (server/src/pieces-chiffrement.ts) —

/**
 * Clé de chiffrement des pièces justificatives (CURSUS_PIECES_KEY, hors de la base) : 32 octets, en 64 caractères
 * hexadécimaux (openssl rand -hex 32) ou en base64 (openssl rand -base64 32) ; null si elle est absente ou invalide.
 */
export function clePieces(env: Env = process.env): Buffer | null {
  const v = (env.CURSUS_PIECES_KEY ?? '').trim();
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/]{43}=$/.test(v)) return Buffer.from(v, 'base64');
  return null;
}

/** CURSUS_PIECES_KEY posée mais illisible : les pièces seraient écrites en clair sans que rien ne le dise. */
function problemesPieces(env: Env): string[] {
  const v = (env.CURSUS_PIECES_KEY ?? '').trim();
  return v && !clePieces(env)
    ? ['CURSUS_PIECES_KEY n’est pas une clé de 32 octets : indiquez 64 caractères hexadécimaux (openssl rand -hex 32) ou sa forme base64 (openssl rand -base64 32).']
    : [];
}

/**
 * Pièces justificatives dans le dossier local sans clé de chiffrement, en production (choix du chantier D : chiffrement
 * obligatoire dès que les pièces sont activées) : message du refus, ou null si elles sont admises. Seule l'application de
 * bureau (démonstration sur la boucle locale) en est exemptée. Le réglage est en base : la règle est appliquée quand
 * l'administrateur RH active les pièces (parametres.maj) et à chaque envoi (POST /api/pieces), pas au démarrage.
 */
export function refusPiecesLocales(env: Env = process.env): string | null {
  if (!enProduction(env) || demoSurBoucleLocale(env) || clePieces(env)) return null;
  return 'Pièces justificatives refusées en production sans clé de chiffrement : le service informatique définit CURSUS_PIECES_KEY (openssl rand -hex 32, hors de la base) puis redémarre Cursus (docs/SAUVEGARDE.md).';
}

// — Lot 8 : configurations dangereuses en production et démonstration publique (docs/BASCULE-PRODUCTION.md) —

/** Variables d'envoi des e-mails : propres à la boîte de l'entreprise, jamais sur une démonstration publique. */
const VARIABLES_MAIL = ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_MAIL_SECRET_EXPIRE'] as const;
/** Variables de la connexion Microsoft 365 (CURSUS_OIDC_AUTORITE, réservée aux tests, est refusée à part). */
const VARIABLES_OIDC_DEMO = ['CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET', 'CURSUS_OIDC_SECRET_EXPIRE'] as const;
const definies = (env: Env, noms: readonly string[]) => noms.filter(k => (env[k] ?? '').trim());
const enListe = (noms: string[]) => `${noms.join(', ')} ${noms.length > 1 ? 'sont définies' : 'est définie'}`;

/**
 * Règles du lot 8, bloquantes en production : image sans base désignée, adresse publique manquante, superutilisateur
 * PostgreSQL, proxys crus sans restriction (constat S7).
 */
function problemesProduction(env: Env): string[] {
  const out: string[] = [];
  const demo = demoActive(env);
  const url = env.DATABASE_URL?.trim();
  // Image Docker (CURSUS_CONTENEUR=1, Dockerfile) : CURSUS_DB=/data/cursus.db y est posée ; sans DATABASE_URL, Cursus
  // démarrerait sur un fichier SQLite vide du volume, sans que les autres outils voient rien. La démonstration y reste
  // en SQLite (choix du lot 8).
  const choix = (env.CURSUS_BASE ?? '').trim();
  if (choix && !['sqlite', 'postgres'].includes(choix)) out.push(`CURSUS_BASE vaut « ${choix} » : indiquez postgres (serveur commun, avec DATABASE_URL) ou sqlite (fichier local, choisi explicitement).`);
  else if (choix === 'postgres' && !url) out.push('CURSUS_BASE=postgres est définie sans DATABASE_URL : indiquez l’adresse du serveur PostgreSQL commun (rôle cursus_app, base epc2i).');
  else if (choix === 'sqlite' && url) out.push('CURSUS_BASE=sqlite est définie avec DATABASE_URL : les deux se contredisent. Pour passer au serveur commun, retirez CURSUS_BASE (ou posez CURSUS_BASE=postgres) ; sinon retirez DATABASE_URL.');
  else if (env.CURSUS_CONTENEUR === '1' && !demo && !url && choix !== 'sqlite') {
    out.push('Image Docker sans DATABASE_URL : Cursus démarrerait sur un fichier SQLite vide du volume (/data/cursus.db), que les autres outils ne voient pas. '
      + 'Définissez DATABASE_URL (serveur commun, rôle cursus_app), ou CURSUS_BASE=sqlite pour garder volontairement le fichier.');
  }
  // Adresse publique : liens des e-mails et contrôle d'origine des requêtes (sans elle, il retombe sur l'en-tête Host
  // relayé). Exemptées : la démonstration et l'écoute sur la boucle locale posée explicitement (application de bureau,
  // essais locaux en NODE_ENV=production).
  if (enProduction(env) && !demo && !boucleLocaleExplicite(env) && !(env.CURSUS_PUBLIC_URL ?? '').trim()) {
    out.push('CURSUS_PUBLIC_URL est absente : indiquez l’adresse publique de Cursus, en https et sans chemin (https://cursus.entreprise.fr), pour les liens des e-mails et le contrôle d’origine des requêtes.');
  }
  // Rôle du serveur : hors démonstration seulement. Une démonstration branchée sur un serveur PostgreSQL (base inconnue,
  // réponse du propriétaire du 24 octobre) est signalée par avertissementsConfig, jamais arrêtée ; le pré-vol le bloque.
  const cible = cibleBase(env);
  if (!demo && cible?.role === 'postgres') {
    out.push('DATABASE_URL se connecte avec le rôle postgres (superutilisateur) : Cursus aurait tous les droits sur le serveur commun. Utilisez le rôle cursus_app du socle.');
  } else if (!demo && cible && !cible.role && enProduction(env)) {
    out.push('DATABASE_URL ne désigne aucun rôle (ni utilisateur dans l’adresse, ni ?user=, ni PGUSER) : node-postgres prendrait le compte du système. Indiquez le rôle cursus_app du socle (postgres://cursus_app:<mot de passe>@<hôte>:5432/epc2i).');
  }
  // Constat S7 : true, ou un réseau qui couvre toutes les adresses (préfixe /0, 0.0.0.0/0, ::/0), revient au même.
  const proxy = trustProxy(env);
  const toutes = typeof proxy === 'string' ? proxy.split(',').map(p => p.trim()).filter(p => /\/0+$/.test(p)) : [];
  if (proxy === true || toutes.length) {
    out.push(`${proxy === true ? 'CURSUS_TRUST_PROXY=true' : `CURSUS_TRUST_PROXY couvre toutes les adresses (${toutes.join(', ')}) et`} fait croire les en-têtes X-Forwarded-* de n’importe quel client : adresse du client (limites de débit, plafond des clés Keystone, journaux) et protocole falsifiables. `
      + 'Indiquez l’adresse ou le réseau du proxy (par exemple celui de Traefik).');
  }
  return out;
}

/**
 * Démonstration publique (constat S3) : l'espace RH s'y ouvre sans mot de passe, elle ne porte donc aucun secret ni
 * réglage de l'entreprise. Refus des variables d'envoi des e-mails, de la connexion Microsoft 365 et de Sage Paie (hors
 * simulation ; SAGE_URL est refusée partout par problemesSage).
 */
function problemesDemoPublique(env: Env): string[] {
  if (!demoPublique(env)) return [];
  const out: string[] = [];
  const mail = definies(env, VARIABLES_MAIL);
  if (mail.length) out.push(`Démonstration publique : ${enListe(mail)}. Retirez-les : les e-mails y restent simulés, et une instance ouverte sans mot de passe ne porte pas la boîte d’envoi ni les secrets Microsoft 365 de l’entreprise.`);
  const oidc = definies(env, VARIABLES_OIDC_DEMO);
  if (oidc.length) out.push(`Démonstration publique : ${enListe(oidc)}. Retirez-les : la connexion y est libre, et une instance ouverte sans mot de passe ne porte pas les secrets Microsoft 365 de l’entreprise.`);
  const sage = [...((env.SAGE_MODE ?? '').trim() && env.SAGE_MODE!.trim() !== 'simulation' ? ['SAGE_MODE'] : []), ...definies(env, ['SAGE_DOSSIER'])];
  if (sage.length) out.push(`Démonstration publique : ${enListe(sage)}. Retirez-les (ou SAGE_MODE=simulation) : la démonstration ne produit aucun fichier pour le dossier de paie réel.`);
  return out;
}

/**
 * Lot 8, étape 2 : fichier témoin des sauvegardes du serveur commun (CURSUS_SAUVEGARDE_TEMOIN, chemin absolu, lu par
 * server/src/sauvegarde-temoin.ts) et filtre d'adresses de l'API Keystone (CURSUS_KEYSTONE_ADRESSES,
 * server/src/filtre-keystone.ts) : une valeur illisible ne surveillerait ou ne filtrerait rien sans le dire.
 */
function problemesSurveillance(env: Env): string[] {
  const out: string[] = [];
  const temoin = (env.CURSUS_SAUVEGARDE_TEMOIN ?? '').trim();
  if (temoin && !temoin.startsWith('/')) out.push(`CURSUS_SAUVEGARDE_TEMOIN doit être le chemin absolu du fichier témoin écrit par la sauvegarde du serveur commun (/sauvegardes/cursus.temoin) : « ${temoin} » reçu.`);
  const { invalides } = lireAdressesKeystone(env.CURSUS_KEYSTONE_ADRESSES);
  if (invalides.length) out.push(`CURSUS_KEYSTONE_ADRESSES : ${invalides.map(a => `« ${a} »`).join(', ')} ${invalides.length > 1 ? 'ne sont ni des adresses IP ni des réseaux' : 'n’est ni une adresse IP ni un réseau'} (10.0.1.5, 10.0.1.0/24, fd00::/8, séparés par des virgules).`);
  return out;
}

export interface OptionsConfig {
  /**
   * false : règles propres à la démonstration écartées (démonstration exposée, CURSUS_TODAY, cookie sans Secure,
   * démonstration publique et ses liaisons) ; pour une commande d'exploitation lancée dans l'environnement d'une
   * démonstration qu'elle prépare à la production (vidage des données fictives).
   */
  reglesDemo?: boolean;
  /** Commande d'exploitation qui fait le contrôle (« npm run comptes ») : nommée dans le message de refus. */
  commande?: string;
}

/** Problèmes de configuration : bloquants en production, simples avertissements ailleurs. */
export function problemesConfig(env: Env = process.env, opts: OptionsConfig = {}): string[] {
  const out: string[] = [];
  const reglesDemo = opts.reglesDemo !== false;
  const demo = demoActive(env), local = demoSurBoucleLocale(env);
  const hote = hoteEcoute(env) + (env.CURSUS_HOST || env.HOST ? '' : ' par défaut');
  const secret = env.CURSUS_SECRET ?? '';
  if (!secret) out.push('CURSUS_SECRET est absente : définissez une clé aléatoire d’au moins 32 caractères (openssl rand -hex 32).');
  else if (secret.length < 32) out.push(`CURSUS_SECRET est trop courte (${secret.length} caractères) : 32 au minimum.`);
  if (!env.KEYSTONE_API_KEY) out.push('KEYSTONE_API_KEY est absente : définissez la clé convenue avec Keystone (sans elle, hors démonstration, ses appels reçoivent une erreur 503).');
  else if (env.KEYSTONE_API_KEY === KEYSTONE_CLE_DEMO && !demo) out.push(`KEYSTONE_API_KEY reprend la clé de démonstration « ${KEYSTONE_CLE_DEMO} », publiée dans la documentation : choisissez une autre clé.`);
  // Envois à Keystone (server/src/envois.ts) : adresse lisible, sans identifiants (refusés par fetch, qui
  // les recopierait dans ses messages d'erreur ; jamais affichés ici), et jeton d'appel.
  const keystoneUrl = env.KEYSTONE_URL?.trim();
  if (keystoneUrl) {
    if (!/^https?:\/\/[^\s/]+/i.test(keystoneUrl) || !URL.canParse(keystoneUrl)) out.push(`KEYSTONE_URL n’est pas une adresse http(s) valide (${keystoneUrl.replace(/[^/@\s]*@/, '…@')}) : indiquez l’adresse de base de Keystone, par exemple http://keystone.interne:8080.`);
    else if (new URL(keystoneUrl).username || new URL(keystoneUrl).password) out.push('KEYSTONE_URL contient un identifiant ou un mot de passe (utilisateur:motdepasse@) : indiquez l’adresse seule, le jeton passe par KEYSTONE_TOKEN.');
    if (!env.KEYSTONE_TOKEN) out.push('KEYSTONE_URL est définie sans KEYSTONE_TOKEN : les envois à Keystone partiraient sans authentification. Définissez le jeton convenu avec Keystone.');
  }
  // Jeton de supervision (détail du point de santé /api/health, server/src/supervision.ts) : aléatoire et assez long.
  const jeton = env.CURSUS_SUPERVISION_TOKEN?.trim();
  if (jeton && jeton.length < 32) out.push(`CURSUS_SUPERVISION_TOKEN est trop courte (${jeton.length} caractères) : 32 au minimum (openssl rand -hex 32).`);
  if (reglesDemo) {
    if (env.CURSUS_TODAY) out.push(`CURSUS_TODAY est définie (${env.CURSUS_TODAY}) : elle fige la date du jour et reste réservée à la démonstration et aux tests.`);
    if (demo && !local && !demoPublique(env)) out.push(`Le mode démonstration (CURSUS_DEMO=1) ouvre l’espace RH sans mot de passe : il n’est admis que sur la boucle locale posée explicitement (CURSUS_HOST=127.0.0.1, application de bureau), ou derrière le reverse proxy avec CURSUS_DEMO_PUBLIQUE=1 (instance de démonstration aux données fictives, accès restreint en amont) ; écoute actuelle : ${hote}.`);
    if (env.CURSUS_DEMO_PUBLIQUE === '1' && !demo) out.push('CURSUS_DEMO_PUBLIQUE=1 est définie sans CURSUS_DEMO=1 : elle n’a d’effet qu’en démonstration. Retirez-la.');
    if (env.CURSUS_INSECURE_COOKIE === '1' && !local) out.push('CURSUS_INSECURE_COOKIE=1 retire l’attribut Secure du cookie de session : réservé à l’application de bureau (démonstration sur la boucle locale).');
  }
  out.push(...problemesOidc(env));
  out.push(...problemesExpirationSecret(env));
  out.push(...problemesExpirationSecretEnvoi(env));
  out.push(...problemesMail(env));
  out.push(...problemesSage(env));
  out.push(...problemesExploitation(env));
  out.push(...problemesBase(env));
  out.push(...problemesPieces(env));
  out.push(...problemesProduction(env));
  if (reglesDemo) out.push(...problemesDemoPublique(env));
  out.push(...problemesSurveillance(env));
  if (env.CURSUS_OIDC_AUTORITE) out.push(`CURSUS_OIDC_AUTORITE est définie (${env.CURSUS_OIDC_AUTORITE}) : elle remplace le service de connexion de Microsoft et reste réservée aux tests.`);
  return out;
}

/**
 * Avertissements, jamais bloquants (même en production) : réglages à revoir sans danger immédiat, ou qu'il ne faut pas
 * rendre bloquants avant une décision (démonstration branchée sur le serveur commun, lot 8).
 */
export function avertissementsConfig(env: Env = process.env, opts: OptionsConfig = {}): string[] {
  const out: string[] = [];
  const matrix = env.MATRIX_URL?.trim();
  if (matrix && URL.canParse(matrix) && (new URL(matrix).username || new URL(matrix).password)) {
    out.push('MATRIX_URL contient un identifiant ou un mot de passe (utilisateur:motdepasse@) : ils peuvent apparaître dans les messages d’erreur. Préférez l’appel par le réseau interne, avec MATRIX_TOKEN seul.');
  }
  if (opts.reglesDemo === false) return out;
  if (demoActive(env) && cibleBase(env)?.role === 'postgres') {
    out.push('Démonstration (CURSUS_DEMO=1) connectée au serveur PostgreSQL avec le rôle postgres (superutilisateur) : elle a tous les droits sur ce serveur. '
      + 'Utilisez un rôle propre à la démonstration, ou une application à part en SQLite (docs/BASCULE-PRODUCTION.md) ; refusé hors démonstration.');
  }
  if (demoSurBaseCommune(env)) {
    out.push(`Démonstration (CURSUS_DEMO=1) branchée sur la base ${BASE_COMMUNE} du serveur commun : ses salariés fictifs sont publiés aux autres outils par les vues pub_. `
      + 'Déplacez-la sur une application à part, en SQLite (docs/BASCULE-PRODUCTION.md) ; elle sera refusée au jour de la bascule.');
  }
  const liaisons = definies(env, ['KEYSTONE_URL', 'MATRIX_URL']);
  if (liaisonsCoupees(env) && liaisons.length) {
    out.push(`Démonstration publique : ${enListe(liaisons)} sans CURSUS_DEMO_LIAISONS=1 : envois à Keystone et déclaration à Matrix inactifs (simulation). `
      + 'Posez CURSUS_DEMO_LIAISONS=1 pour une liaison voulue entre démonstrations, sinon retirez-les.');
  }
  if (env.CURSUS_DEMO_LIAISONS === '1' && !demoPublique(env)) out.push('CURSUS_DEMO_LIAISONS=1 est définie hors démonstration publique : elle n’a pas d’effet. Retirez-la.');
  const mail = definies(env, VARIABLES_MAIL);
  if (demoActive(env) && !demoPublique(env) && mail.length) out.push(`Démonstration : ${enListe(mail)}, mais les e-mails y restent simulés (rien ne part).`);
  return out;
}

/**
 * Contrôle exécuté au démarrage (et par les commandes d'exploitation) : en production, arrêt (code 1) tant qu'un
 * problème subsiste ; les avertissements sont écrits sans arrêter.
 */
export function verifierConfig(env: Env = process.env, opts: OptionsConfig = {}) {
  const avertissements = avertissementsConfig(env, opts);
  if (avertissements.length) console.warn(`Configuration à revoir :\n${avertissements.map(p => `  – ${p}`).join('\n')}`);
  const pbs = problemesConfig(env, opts);
  if (!pbs.length) return;
  const liste = pbs.map(p => `  – ${p}`).join('\n');
  if (enProduction(env)) {
    console.error(`${opts.commande ? `${opts.commande} refusée` : 'Cursus ne peut pas démarrer'} en production :\n${liste}\nVoir .env.example et docs/DEPLOIEMENT.md.`);
    process.exit(1);
  }
  console.warn(`Configuration à compléter avant une mise en production :\n${liste}`);
}
