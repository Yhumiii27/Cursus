// Appels à l'API Cursus.
import type { CurrentUser, Dataset, Envoi, EtatEnvois, Role, StatutEnvoi } from '../../shared/types.ts';

export interface LoginOption { id: number; nom: string }
export interface SessionState {
  demo: boolean;
  role: Role;
  user: CurrentUser | null;
  /** Comptes proposés à la connexion — uniquement en démonstration (null sinon). */
  loginOptions: Record<Role, LoginOption[]> | null;
  integrations: { keystone: string; sage: string };
}
/** File d'envoi (Paramètres → Envois) : état de l'intégration Keystone et derniers messages. */
export interface EnvoisState { keystone: EtatEnvois & { mode: string }; envois: Envoi[] }
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
  login: (role: Role, empId: number | null, password: string) => request<SessionState>('POST', '/api/login', { role, empId, password }),
  logout: () => request<SessionState>('POST', '/api/logout'),
  data: () => request<Dataset>('GET', '/api/data'),
  /** `keystone` : appels entrants de Keystone seulement ; sinon, toutes les autres lignes. */
  journal: (vue: 'actions' | 'keystone' = 'actions') => request<{ at: string; actor: string; role: string; action: string; message: string | null }[]>('GET', `/api/journal${vue === 'keystone' ? '?vue=keystone' : ''}`),
  envois: (statut: StatutEnvoi | null) => request<EnvoisState>('GET', `/api/envois${statut ? `?statut=${statut}` : ''}`),
  async action(name: string, payload: Record<string, unknown>): Promise<ActionResponse> {
    try {
      const r = await request<{ message: string | null; result?: unknown; data: Dataset }>('POST', `/api/actions/${name}`, payload);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, message: null, error: (err as Error).message };
    }
  },
};
