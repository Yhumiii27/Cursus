// Appels à l'API Cursus.
import type { CompteSession, CompteVue, CurrentUser, Dataset, Envoi, EtatEnvois, Role, StatutEnvoi } from '../../shared/types.ts';

/** Compte proposé à la connexion de démonstration (`id` : identifiant du compte). */
export interface LoginOption { id: number; nom: string }
export interface SessionState {
  demo: boolean;
  /** Espace actif (ou demandé, tant qu'aucun compte n'y est connecté). */
  role: Role;
  /** Personne connectée dans l'espace actif ; null tant qu'un mot de passe provisoire n'est pas remplacé. */
  user: CurrentUser | null;
  /** Compte de la session : espaces ouverts, profil RH, mot de passe à changer. */
  compte: CompteSession | null;
  /** Mode de connexion de la session : compte local (mot de passe), démonstration, Microsoft 365. */
  methode: 'local' | 'demo' | 'microsoft' | null;
  /** Comptes proposés à la connexion — uniquement en démonstration (null sinon). */
  loginOptions: Record<Role, LoginOption[]> | null;
  /** Connexion Microsoft 365 configurée : l'écran de connexion propose « Se connecter avec Microsoft ». */
  microsoft: boolean;
  /** Déconnexion d'une session Microsoft : adresse de la déconnexion Microsoft, qui revient sur Cursus. */
  deconnexion?: string;
  integrations: { keystone: string; sage: string };
}
/** File d'envoi (Paramètres → Envois) : état de l'intégration Keystone et derniers messages. */
export interface EnvoisState { keystone: EtatEnvois & { mode: string }; envois: Envoi[] }
export interface ActionResponse { ok: boolean; message: string | null; result?: unknown; error?: string; data?: Dataset; status?: number }

/** Erreur d'appel : `status` 0 quand le serveur n'a pas pu être joint. */
export type ApiError = Error & { status: number };

/** Filtre du journal (Paramètres) : opérations, connexions (et mots de passe), ou tout. */
export type FiltreJournal = 'tout' | 'operations' | 'connexions' | 'keystone';

export const MSG_RESEAU = 'Connexion au serveur impossible : vérifiez le réseau, puis réessayez.';

/** Prévenu de chaque réponse 401 (session expirée ou révoquée), hors échec de connexion. */
let auRefus: (() => void) | null = null;
export function surSessionExpiree(f: (() => void) | null) { auRefus = f; }

/**
 * `espace` : espace affiché par l'onglet, envoyé avec les lectures et les actions. Tous les onglets
 * partagent la session ; si l'espace a changé dans un autre, le serveur refuse (409) au lieu d'agir
 * avec les droits de l'autre espace.
 */
async function request<T>(method: string, url: string, body?: unknown, espace?: Role): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (espace) headers['x-cursus-espace'] = espace;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Hors ligne, serveur arrêté, réseau coupé : fetch échoue sans réponse (« Failed to fetch »).
    throw Object.assign(new Error(MSG_RESEAU), { status: 0 });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // /api/login répond 401 à un mauvais mot de passe : ce n'est pas une session expirée.
    if (res.status === 401 && url !== '/api/login') auRefus?.();
    // Réponse sans message de Cursus : le reverse proxy signale le serveur arrêté ou en redémarrage.
    const msg = json.error || ([502, 503, 504].includes(res.status) ? `Serveur indisponible (erreur ${res.status}) : réessayez dans quelques instants.` : `Erreur ${res.status}`);
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json as T;
}

/** Adresse de la connexion Microsoft 365 : page de retour, identifiant proposé, choix d'un autre compte. */
export function lienMicrosoft(o: { retour?: string; identifiant?: string; choix?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (o.retour && o.retour !== '/') p.set('retour', o.retour);
  if (o.identifiant) p.set('identifiant', o.identifiant);
  if (o.choix) p.set('choix', '1');
  const q = p.toString();
  return `/api/auth/microsoft${q ? `?${q}` : ''}`;
}

export const api = {
  session: () => request<SessionState>('GET', '/api/session'),
  mode: (role: Role) => request<SessionState>('POST', '/api/mode', { role }),
  /** Démonstration : connexion libre au compte choisi pour l'espace. */
  loginDemo: (role: Role, compteId: number, password: string) => request<SessionState>('POST', '/api/login', { role, compteId, password }),
  /** Compte Cursus : identifiant et mot de passe. */
  login: (identifiant: string, motDePasse: string) => request<SessionState>('POST', '/api/login', { identifiant, motDePasse }),
  motDePasse: (actuel: string, nouveau: string) => request<SessionState>('POST', '/api/motdepasse', { actuel, nouveau }),
  logout: () => request<SessionState>('POST', '/api/logout'),
  /** Instantané de l'espace `espace` (409 si la session est passée à un autre espace entre-temps). */
  data: (espace?: Role) => request<Dataset>('GET', '/api/data', undefined, espace),
  /** 100 dernières lignes du journal : toutes, opérations seules, connexions seules, ou appels entrants de Keystone. */
  journal: (filtre: FiltreJournal = 'tout') => request<{ at: string; actor: string; role: string | null; action: string; message: string | null; identifiant: string | null }[]>(
    'GET', filtre === 'tout' ? '/api/journal' : filtre === 'keystone' ? '/api/journal?vue=keystone' : `/api/journal?filtre=${filtre}`),
  comptes: () => request<CompteVue[]>('GET', '/api/comptes'),
  envois: (statut: StatutEnvoi | null) => request<EnvoisState>('GET', `/api/envois${statut ? `?statut=${statut}` : ''}`),
  async action(name: string, payload: Record<string, unknown>, espace?: Role): Promise<ActionResponse> {
    try {
      const r = await request<{ message: string | null; result?: unknown; data?: Dataset }>('POST', `/api/actions/${name}`, payload, espace);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, message: null, error: (err as Error).message, status: (err as ApiError).status };
    }
  },
};
