// Contrôles réseau du pré-vol (lot 8, chantier B) : `npm run verifier-production -- --url https://cursus.entreprise.fr`
// appelle l'instance comme le ferait un utilisateur, à travers le proxy (Traefik, Caddy), et vérifie ce que la
// configuration seule ne peut pas voir :
// - /api/health : 200 « ok », mode production (détail lu avec le jeton de supervision, CURSUS_SUPERVISION_TOKEN) ;
// - en-têtes de sécurité relayés par le proxy : HSTS (posé seulement si le proxy a dit « https », CURSUS_TRUST_PROXY),
//   CSP, X-Frame-Options ;
// - /api/session : démonstration inactive (`demo: false`) ;
// - l'adresse en http:// redirigée vers https:// (301 ou 308), ou fermée ;
// - l'API Keystone fermée sans clé (401, ou 403 si la route publique est fermée par le proxy ou par
//   CURSUS_KEYSTONE_ADRESSES).
// Rien n'est écrit : des GET sans cookie ni clé. Chaque appel est abandonné au bout de 10 s. `fetch` est remplaçable
// (tests : serveur local en http, en-tête X-Forwarded-Proto ajouté comme le ferait le proxy).
import type { Controle, Niveau } from './pre-vol.ts';
import type { Sante } from './supervision.ts';

/** Délai de chaque appel. */
export const DELAI_APPEL_MS = 10_000;

export interface OptionsReseau {
  /** Jeton de supervision : détail de /api/health (mode, alertes). */
  jeton?: string;
  /** Adresse en http:// à contrôler (par défaut : celle de `url` en http, sans port). */
  http?: string;
  fetch?: typeof fetch;
  delai?: number;
}

const R = 'reseau' as const;
const ok = (code: string, message: string): Controle => ({ code, domaine: R, niveau: 'ok', message });
const ko = (code: string, niveau: Exclude<Niveau, 'ok'>, message: string, remede?: string): Controle => ({ code, domaine: R, niveau, message, ...(remede ? { remede } : {}) });

/** Message d'un appel impossible (réseau, certificat, délai), sans la pile. */
const raison = (err: unknown) => {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError') return 'pas de réponse dans le délai';
  return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err);
};

/** Origine https lue dans `--url` (chemin, paramètres et identifiants refusés), ou le motif du refus. */
export function origineVerifiee(url: string): { origine: string } | { refus: string } {
  if (!URL.canParse(url)) return { refus: `« ${url} » n’est pas une adresse` };
  const u = new URL(url);
  if (u.username || u.password) return { refus: 'l’adresse ne doit porter ni identifiant ni mot de passe' };
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return { refus: 'indiquez l’adresse publique seule, sans chemin (https://cursus.entreprise.fr)' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { refus: 'adresse http(s) attendue' };
  return { origine: u.origin };
}

/** Contrôles réseau de l'instance publiée à `url` (adresse publique, CURSUS_PUBLIC_URL). */
export async function controlesReseau(url: string, opts: OptionsReseau = {}): Promise<Controle[]> {
  const out: Controle[] = [];
  const lue = origineVerifiee(url);
  if ('refus' in lue) return [ko('reseau.url', 'bloquant', `--url : ${lue.refus}.`, 'Indiquez l’adresse publique de Cursus, en https et sans chemin.')];
  const base = lue.origine;
  const f = opts.fetch ?? fetch;
  const delai = opts.delai ?? DELAI_APPEL_MS;
  const appel = (chemin: string, init: RequestInit = {}, depuis = base) => f(`${depuis}${chemin}`, { redirect: 'manual', ...init, signal: AbortSignal.timeout(delai) });
  if (!base.startsWith('https://')) out.push(ko('reseau.url', 'bloquant', `${base} n’est pas en https : cookies de session, mots de passe et données RH passeraient en clair.`, 'Publiez Cursus en https (certificat du proxy) et relancez avec l’adresse https.'));

  // Point de santé, détail avec le jeton ; ses en-têtes servent au contrôle suivant.
  let sante: Response | null = null;
  try {
    sante = await appel('/api/health', opts.jeton ? { headers: { authorization: `Bearer ${opts.jeton}` } } : {});
  } catch (err) {
    out.push(ko('reseau.sante', 'bloquant', `${base}/api/health injoignable : ${raison(err)}.`, 'Vérifiez le nom de domaine, le certificat et le routage du proxy vers le conteneur.'));
  }
  if (sante) {
    const corps = await sante.json().catch(() => null) as Sante | null;
    if (sante.status !== 200 || !corps?.statut) {
      out.push(ko('reseau.sante', 'bloquant', `/api/health répond ${sante.status}${corps?.statut ? ` (${corps.statut})` : ''} : la base ne répond pas, ou la requête n’arrive pas à Cursus.`, 'Lisez le journal du conteneur (onglet Logs de Coolify).'));
    } else if (corps.statut === 'degrade') {
      out.push(ko('reseau.sante', 'attention', `/api/health : état « degrade »${corps.alertes?.length ? ` (${corps.alertes.join(', ')})` : ' (détail : relancez avec CURSUS_SUPERVISION_TOKEN posée)'}.`, 'Examinez chaque alerte (docs/DEPLOIEMENT.md, « Exploitation courante ») avant l’ouverture.'));
    } else {
      out.push(ok('reseau.sante', '/api/health : état « ok ».'));
    }
    if (corps?.mode) {
      out.push(corps.mode === 'production'
        ? ok('reseau.mode', 'Instance en mode production.')
        : ko('reseau.mode', 'bloquant', `Instance en mode « ${corps.mode} » au lieu de production.`, 'NODE_ENV=production, sans CURSUS_DEMO (déjà posé par l’image Docker).'));
    } else {
      out.push(ko('reseau.mode', 'attention', 'Mode de l’instance non vérifié : /api/health ne donne le détail qu’avec le jeton de supervision.', 'Posez CURSUS_SUPERVISION_TOKEN dans l’environnement de la commande (le même que celui de l’instance).'));
    }
    const manquants = [['Strict-Transport-Security', 'HSTS'], ['Content-Security-Policy', 'CSP'], ['X-Frame-Options', 'X-Frame-Options']]
      .filter(([h]) => !sante!.headers.get(h)).map(([, nom]) => nom);
    out.push(manquants.length
      ? ko('reseau.en-tetes', 'bloquant', `En-têtes de sécurité absents de la réponse : ${manquants.join(', ')}.`,
        manquants.includes('HSTS') && manquants.length === 1
          ? 'HSTS n’est posé que si le proxy est cru et dit « https » : vérifiez CURSUS_TRUST_PROXY (adresse du proxy) et l’en-tête X-Forwarded-Proto.'
          : 'Le proxy retire des en-têtes de Cursus : vérifiez ses réglages (aucun middleware qui réécrit les en-têtes).')
      : ok('reseau.en-tetes', 'En-têtes de sécurité présents (HSTS, CSP, X-Frame-Options).'));
  }

  // Session anonyme : la démonstration ouvrirait l'espace RH sans mot de passe.
  try {
    const r = await appel('/api/session');
    const corps = await r.json().catch(() => null) as { demo?: unknown } | null;
    if (r.status !== 200 || typeof corps?.demo !== 'boolean') out.push(ko('reseau.session', 'bloquant', `/api/session répond ${r.status} sans l’état de la session.`, 'Vérifiez que le proxy relaie /api vers Cursus sans authentification devant.'));
    else out.push(corps.demo
      ? ko('reseau.session', 'bloquant', '/api/session : démonstration active, l’espace RH s’ouvre sans mot de passe.', 'Retirez CURSUS_DEMO et CURSUS_DEMO_PUBLIQUE de l’application, et redéployez.')
      : ok('reseau.session', '/api/session : démonstration inactive.'));
  } catch (err) {
    out.push(ko('reseau.session', 'bloquant', `/api/session injoignable : ${raison(err)}.`));
  }

  // Adresse en clair : redirigée vers https, ou fermée.
  if (base.startsWith('https://')) {
    const http = opts.http ?? `http://${new URL(base).hostname}`;
    try {
      const r = await appel('/api/health', {}, http);
      const vers = r.headers.get('location') ?? '';
      out.push([301, 308].includes(r.status) && vers.startsWith('https://')
        ? ok('reseau.http', `${http} redirigé vers https (${r.status}).`)
        : [302, 307].includes(r.status) && vers.startsWith('https://')
          ? ko('reseau.http', 'attention', `${http} redirigé vers https par une redirection temporaire (${r.status}).`, 'Préférez une redirection permanente (301 ou 308) dans le proxy.')
          : ko('reseau.http', 'bloquant', `${http} répond ${r.status} sans redirection vers https : Cursus est joignable en clair.`, 'Redirigez http vers https dans le proxy (Traefik : redirection du point d’entrée web).'));
    } catch {
      out.push(ok('reseau.http', `${http} fermé (aucune réponse en clair).`));
    }
  }

  // API Keystone sans clé : jamais servie.
  try {
    const r = await appel('/api/integrations/keystone/v1/openapi.json');
    out.push(r.status === 401
      ? ok('reseau.keystone', 'API Keystone : 401 sans clé (route publique ouverte, protégée par la clé ; la procédure recommande de la fermer dans le proxy).')
      : r.status === 403
        ? ok('reseau.keystone', 'API Keystone : 403 sans clé (route fermée par le proxy ou par CURSUS_KEYSTONE_ADRESSES).')
        : ko('reseau.keystone', r.status === 200 ? 'bloquant' : 'attention', `API Keystone : ${r.status} sans clé, au lieu de 401 ou 403.`,
          r.status === 200 ? 'Vérifiez KEYSTONE_API_KEY (obligatoire en production) et redéployez.' : 'Vérifiez le routage de /api/integrations/keystone dans le proxy.'));
  } catch (err) {
    out.push(ko('reseau.keystone', 'attention', `API Keystone injoignable : ${raison(err)}.`));
  }
  return out;
}
