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
  if (env.CURSUS_TODAY) out.push(`CURSUS_TODAY est définie (${env.CURSUS_TODAY}) : elle fige la date du jour et reste réservée à la démonstration et aux tests.`);
  if (demo && !local) out.push(`Le mode démonstration (CURSUS_DEMO=1) ouvre l’espace RH sans mot de passe : il n’est admis que sur la boucle locale posée explicitement (CURSUS_HOST=127.0.0.1, application de bureau), jamais derrière le reverse proxy ; écoute actuelle : ${hote}.`);
  if (env.CURSUS_INSECURE_COOKIE === '1' && !local) out.push('CURSUS_INSECURE_COOKIE=1 retire l’attribut Secure du cookie de session : réservé à l’application de bureau (démonstration sur la boucle locale).');
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
