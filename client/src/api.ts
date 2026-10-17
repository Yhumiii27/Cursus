// Appels à l'API Cursus.
import type { CibleEnvoi, CompteSession, CompteVue, CurrentUser, Dataset, Envoi, EtatEnvois, Role, SageMode, StatutEnvoi } from '../../shared/types.ts';
import type { ContactsConfidentialite } from '../../shared/confidentialite.ts';

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
  /** Modes des intégrations : Keystone et e-mails (api / simulation), Sage Paie (simulation, fichier d'import, api). */
  integrations: { keystone: string; sage: SageMode; email?: string };
}
/**
 * File d'envoi (Paramètres → Envois) : état de l'intégration Keystone, de la messagerie (boîte d'envoi,
 * notifications en attente du récapitulatif quotidien) et derniers messages.
 */
export interface EnvoisState {
  keystone: EtatEnvois & { mode: string };
  email: EtatEnvois & { mode: string; expediteur: string | null; recapitulatif: number };
  envois: Envoi[];
}
export interface ActionResponse { ok: boolean; message: string | null; result?: unknown; error?: string; data?: Dataset; status?: number }

/** Erreur d'appel : `status` 0 quand le serveur n'a pas pu être joint. */
export type ApiError = Error & { status: number };

/** Vue du journal (Paramètres) : tout, opérations, connexions et accès, appels de Keystone, archive paie (sur demande). */
export type VueJournal = 'tout' | 'operations' | 'connexions' | 'keystone' | 'archive';
/** Filtres du journal : vue, période (dates incluses), personne (nom ou identifiant), action (code ou `famille:<id>`), salarié concerné. */
export interface FiltreJournal { vue: VueJournal; du?: string; au?: string; auteur?: string; action?: string; salarie?: number | null }
/** Ligne du journal : `details` porte les champs retenus et les anciennes et nouvelles valeurs (`avant`, `apres`). */
export interface LigneJournal {
  id: number; at: string; actor: string; role: string | null; action: string; message: string | null; identifiant: string | null;
  salaries: number[]; details: Record<string, unknown>; archivee: string | null;
}
export interface PageJournal { lignes: LigneJournal[]; total: number; page: number; taille: number }

/** Paramètres d'adresse d'un filtre du journal (valeurs vides omises). */
export function requeteJournal(f: FiltreJournal, page?: number, taille?: number): string {
  const p = new URLSearchParams();
  if (f.vue !== 'tout') p.set('vue', f.vue);
  for (const k of ['du', 'au', 'auteur', 'action'] as const) if (f[k]?.trim()) p.set(k, f[k]!.trim());
  if (f.salarie) p.set('salarie', String(f.salarie));
  if (page && page > 1) p.set('page', String(page));
  if (taille) p.set('taille', String(taille));
  const q = p.toString();
  return q ? `?${q}` : '';
}

export const MSG_RESEAU = 'Connexion au serveur impossible : vérifiez le réseau, puis réessayez.';
/** Lecture sans réponse dans le délai (serveur bloqué, proxy qui retient la connexion). */
export const MSG_DELAI = 'Le serveur ne répond pas : réessayez dans quelques instants.';
/** Action sans réponse dans le délai : elle a pu être enregistrée, les données sont relues avant de la refaire. */
export const MSG_DELAI_ACTION = 'Le serveur n’a pas répondu à temps : l’opération a pu être enregistrée, vérifiez-la avant de la refaire.';
/** Délais de réponse : 20 s pour une lecture, 60 s pour une action (un import volumineux reste possible). */
export const DELAI_LECTURE_MS = 20_000;
export const DELAI_ACTION_MS = 60_000;

/** Message d'une réponse en erreur sans message de Cursus (reverse proxy, analyse du corps par Express). */
export function messageHttp(status: number): string {
  // Le reverse proxy signale le serveur arrêté ou en redémarrage.
  if ([502, 503, 504].includes(status)) return `Serveur indisponible (erreur ${status}) : réessayez dans quelques instants.`;
  if (status === 413) return 'Envoi trop volumineux (erreur 413) : réduisez le texte collé, puis réessayez.';
  if (status >= 500) return `Erreur du serveur (erreur ${status}) : réessayez ; si elle persiste, prévenez l’administrateur.`;
  return `Requête refusée par le serveur (erreur ${status}).`;
}

/** Délai dépassé : `AbortSignal.timeout` interrompt l'appel avec une DOMException « TimeoutError ». */
const delaiDepasse = (err: unknown) => (err as { name?: string } | null)?.name === 'TimeoutError';

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
  // Sans réponse dans le délai, l'appel est abandonné : l'écran ne reste pas sur « Chargement… ».
  const lecture = method === 'GET';
  let json: unknown;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(lecture ? DELAI_LECTURE_MS : DELAI_ACTION_MS),
    });
    json = await res.json().catch((err: unknown) => { if (delaiDepasse(err)) throw err; return {}; });
  } catch (err) {
    // Hors ligne, serveur arrêté, réseau coupé : fetch échoue sans réponse (« Failed to fetch »).
    throw Object.assign(new Error(delaiDepasse(err) ? (lecture ? MSG_DELAI : MSG_DELAI_ACTION) : MSG_RESEAU), { status: 0 });
  }
  if (!res.ok) {
    // /api/login répond 401 à un mauvais mot de passe : ce n'est pas une session expirée.
    if (res.status === 401 && url !== '/api/login') auRefus?.();
    throw Object.assign(new Error((json as { error?: string } | null)?.error || messageHttp(res.status)), { status: res.status });
  }
  return json as T;
}

/**
 * Télécharge un fichier produit par le serveur (export CSV du journal, données personnelles d'un salarié) :
 * le nom vient de l'en-tête Content-Disposition. Le serveur trace l'export.
 */
async function telecharger(url: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw Object.assign(new Error(MSG_RESEAU), { status: 0 });
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 401) auRefus?.();
    throw Object.assign(new Error(json.error || `Erreur ${res.status}`), { status: res.status });
  }
  const nom = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export';
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: nom });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
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
  /** Page du journal (les plus récentes d'abord) : filtres, numéro de page, lignes par page (50 par défaut). */
  journal: (f: FiltreJournal = { vue: 'tout' }, page = 1, taille?: number) => request<PageJournal>('GET', `/api/journal${requeteJournal(f, page, taille)}`),
  /** Export CSV du journal filtré (toutes les pages). */
  journalCsv: (f: FiltreJournal) => telecharger(`/api/journal/csv${requeteJournal(f)}`),
  /** Service RH : données personnelles d'un salarié (droit d'accès), journal des actions le concernant compris. */
  donneesSalarie: (empId: number) => telecharger(`/api/salaries/${empId}/donnees`),
  /** Le salarié connecté : ses propres données. */
  mesDonnees: () => telecharger('/api/mes-donnees'),
  /** Paie : fichier d'import Sage d'un lot de paie (téléchargement tracé et compté sur le lot). */
  fichierLotPaie: (id: number) => telecharger(`/api/paie/lots/${id}/fichier`),
  /** Paie : variables d'une période de paie (lots et attente), export CSV tracé (server/src/variables-paie.ts). */
  variablesPaie: (periode: string) => telecharger(`/api/paie/variables/${encodeURIComponent(periode)}`),
  /**
   * Export ou impression produit par le navigateur (CSV, passeport formation, compte rendu) : signalé au serveur
   * pour le journal, sans attendre ni bloquer le téléchargement.
   */
  signalerExport: (x: { nature: 'csv' | 'impression'; titre: string; lignes?: number; empId?: number }) => {
    fetch('/api/exports', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x) }).catch(() => {});
  },
  comptes: () => request<CompteVue[]>('GET', '/api/comptes'),
  /** Page Confidentialité : coordonnées du responsable du traitement et du DPO, lisibles sans connexion. */
  confidentialite: () => request<ContactsConfidentialite>('GET', '/api/confidentialite'),
  envois: (statut: StatutEnvoi | null, cible: CibleEnvoi | null = null) => {
    const q = new URLSearchParams();
    if (statut) q.set('statut', statut);
    if (cible) q.set('cible', cible);
    return request<EnvoisState>('GET', `/api/envois${q.size ? `?${q}` : ''}`);
  },
  async action(name: string, payload: Record<string, unknown>, espace?: Role): Promise<ActionResponse> {
    try {
      const r = await request<{ message: string | null; result?: unknown; data?: Dataset }>('POST', `/api/actions/${name}`, payload, espace);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, message: null, error: (err as Error).message, status: (err as ApiError).status };
    }
  },
};
