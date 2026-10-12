// Appels à l'API Cursus.
import type { CompteSession, CompteVue, CurrentUser, Dataset, Role } from '../../shared/types.ts';

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
  /** Mode de connexion de la session : compte local (mot de passe), démonstration. */
  methode: 'local' | 'demo' | 'microsoft' | null;
  /** Comptes proposés à la connexion — uniquement en démonstration (null sinon). */
  loginOptions: Record<Role, LoginOption[]> | null;
  integrations: { keystone: string; sage: string };
}
export interface ActionResponse { ok: boolean; message: string | null; result?: unknown; error?: string; data?: Dataset }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Erreur ${res.status}`), { status: res.status });
  return json as T;
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
  data: () => request<Dataset>('GET', '/api/data'),
  journal: () => request<{ at: string; actor: string; role: string | null; action: string; message: string | null; identifiant: string | null }[]>('GET', '/api/journal'),
  comptes: () => request<CompteVue[]>('GET', '/api/comptes'),
  async action(name: string, payload: Record<string, unknown>): Promise<ActionResponse> {
    try {
      const r = await request<{ message: string | null; result?: unknown; data: Dataset }>('POST', `/api/actions/${name}`, payload);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, message: null, error: (err as Error).message };
    }
  },
};
