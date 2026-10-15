// Configuration lue dans l'environnement et contrôlée au démarrage du serveur.
// En production (NODE_ENV=production), une configuration dangereuse empêche le
// démarrage ; ailleurs, elle est seulement signalée. Variables : .env.example.

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
function originePublique(v: string): string | null {
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

/** Problèmes de la configuration Microsoft 365 : tout ou rien, locataire désigné par son GUID, adresse publique en https. */
function problemesOidc(env: Env): string[] {
  const out: string[] = [];
  const definies = VARIABLES_OIDC.filter(k => (env[k] ?? '').trim());
  if (!definies.length) return out;
  const manquantes = VARIABLES_OIDC.filter(k => !definies.includes(k));
  if (manquantes.length) out.push(`Connexion Microsoft 365 incomplète : définissez aussi ${manquantes.join(', ')} (les quatre variables, ou aucune).`);
  const tenant = (env.CURSUS_OIDC_TENANT ?? '').trim();
  if (tenant && !GUID.test(tenant.toLowerCase())) out.push(`CURSUS_OIDC_TENANT doit être l’ID de l’annuaire (locataire) Entra, au format GUID (« ${tenant} » reçu ; common, organizations et un nom de domaine ne conviennent pas).`);
  const url = (env.CURSUS_PUBLIC_URL ?? '').trim();
  if (url && !originePublique(url)) out.push(`CURSUS_PUBLIC_URL doit être l’adresse publique de Cursus, sans chemin (https://cursus.example.fr) : « ${url} » reçu.`);
  else if (url && !url.startsWith('https://')) out.push(`CURSUS_PUBLIC_URL doit être en https (« ${url} » reçu) : Microsoft ne renvoie le code de connexion qu’à une adresse sûre.`);
  return out;
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
 * Entra n'est pas entièrement désignée (locataire GUID, ID d'application, secret).
 */
export function configMail(env: Env = process.env): ConfigMail | null {
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

/** Problèmes de configuration : bloquants en production, simples avertissements ailleurs. */
export function problemesConfig(env: Env = process.env): string[] {
  const out: string[] = [];
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
  if (env.CURSUS_TODAY) out.push(`CURSUS_TODAY est définie (${env.CURSUS_TODAY}) : elle fige la date du jour et reste réservée à la démonstration et aux tests.`);
  if (demo && !local) out.push(`Le mode démonstration (CURSUS_DEMO=1) ouvre l’espace RH sans mot de passe : il n’est admis que sur la boucle locale posée explicitement (CURSUS_HOST=127.0.0.1, application de bureau), jamais derrière le reverse proxy ; écoute actuelle : ${hote}.`);
  if (env.CURSUS_INSECURE_COOKIE === '1' && !local) out.push('CURSUS_INSECURE_COOKIE=1 retire l’attribut Secure du cookie de session : réservé à l’application de bureau (démonstration sur la boucle locale).');
  out.push(...problemesOidc(env));
  out.push(...problemesMail(env));
  if (env.CURSUS_OIDC_AUTORITE) out.push(`CURSUS_OIDC_AUTORITE est définie (${env.CURSUS_OIDC_AUTORITE}) : elle remplace le service de connexion de Microsoft et reste réservée aux tests.`);
  return out;
}

/** Contrôle exécuté au démarrage : en production, arrêt (code 1) tant qu'un problème subsiste. */
export function verifierConfig(env: Env = process.env) {
  const pbs = problemesConfig(env);
  if (!pbs.length) return;
  const liste = pbs.map(p => `  – ${p}`).join('\n');
  if (enProduction(env)) {
    console.error(`Cursus ne peut pas démarrer en production :\n${liste}\nVoir .env.example et docs/DEPLOIEMENT.md.`);
    process.exit(1);
  }
  console.warn(`Configuration à compléter avant une mise en production :\n${liste}`);
}
