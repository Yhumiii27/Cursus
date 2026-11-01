// Appels à l'API Cursus.
import type { CibleEnvoi, CompteSession, CompteVue, CurrentUser, Dataset, Envoi, EtatEnvois, ExportFraisVue, Role, SageMode, StatutEnvoi } from '../../shared/types.ts';
import type { ContactsConfidentialite } from '../../shared/confidentialite.ts';
import { EN_TETE_HORS_LIGNE, EN_TETE_IDEMPOTENCE } from '../../shared/hors-ligne.ts';
// Noms des actions du serveur (t164) : import de type seulement, effacé à la compilation (aucun code serveur dans
// l'interface) ; une faute dans un nom d'action est signalée par tsc.
import type { NomAction } from '../../server/src/actions/index.ts';
import type { AppareilPush } from '../../server/src/push.ts';

export type { AppareilPush, NomAction };

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
/**
 * Réponse d'une action. `relire` : action faite, mais l'instantané n'a pas pu être relu après elle (Cursus occupé) ; il
 * est à relire par GET /api/data.
 */
export interface ActionResponse { ok: boolean; message: string | null; result?: unknown; error?: string; data?: Dataset; relire?: boolean; status?: number }

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
async function request<T>(method: string, url: string, body?: unknown, espace?: Role, entetes: Record<string, string> = {}): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = { ...entetes };
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
/**
 * Espace affiché par l'onglet (tenu par le store à chaque session lue), envoyé avec les téléchargements et la lecture
 * du journal : le serveur exige cet en-tête sur les lectures qui écrivent au journal (fichier de paie, données d'un
 * salarié, archive paie), qu'une navigation provoquée depuis un autre site ne peut pas poser (lot 8, S8).
 */
let espaceOnglet: Role | undefined;
export function definirEspaceOnglet(espace: Role | undefined) { espaceOnglet = espace; }

/** Téléchargement d'un fichier produit par le serveur ; rend les en-têtes de la réponse (clés des lignes exportées…). */
async function telecharger(url: string): Promise<Headers> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: espaceOnglet ? { 'x-cursus-espace': espaceOnglet } : {} });
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
  return res.headers;
}

/** Pièce justificative envoyée, en attente d'être jointe par l'action du dialogue (`jeton`, server/src/pieces-routes.ts). */
export interface PieceEnvoyee { id: number; jeton: string; nom: string; type: string; taille: number }

/**
 * Envoie un fichier comme pièce justificative (corps brut, type du fichier, nom d'origine encodé dans un en-tête) ; lève
 * une erreur au message de Cursus (format refusé, trop volumineux, fonction désactivée).
 */
async function envoyerPiece(fichier: File, espace?: Role, cle?: string): Promise<PieceEnvoyee> {
  let res: Response;
  try {
    res = await fetch('/api/pieces', {
      method: 'POST', credentials: 'same-origin', body: fichier,
      // Lot 11 : clé d'idempotence de la file hors ligne (le même fichier renvoyé rend la même pièce).
      headers: { 'content-type': fichier.type, 'x-nom-fichier': encodeURIComponent(fichier.name), ...(espace ? { 'x-cursus-espace': espace } : {}), ...(cle ? { [EN_TETE_IDEMPOTENCE]: cle } : {}) },
      signal: AbortSignal.timeout(DELAI_ACTION_MS),
    });
  } catch (err) {
    throw Object.assign(new Error(delaiDepasse(err) ? MSG_DELAI_ACTION : MSG_RESEAU), { status: 0 });
  }
  const json = await res.json().catch(() => ({})) as Partial<PieceEnvoyee> & { error?: string };
  if (!res.ok) {
    if (res.status === 401) auRefus?.();
    throw Object.assign(new Error(json.error || (res.status === 413 ? 'Fichier trop volumineux : 10 Mo au plus.' : messageHttp(res.status))), { status: res.status });
  }
  return json as PieceEnvoyee;
}

/** Adresse du contenu d'une pièce justificative (affichage par le navigateur, ou téléchargement). */
export const lienPiece = (id: number, telecharger = false) => `/api/pieces/${id}${telecharger ? '?telecharger=1' : ''}`;

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
  journal: (f: FiltreJournal = { vue: 'tout' }, page = 1, taille?: number) => request<PageJournal>('GET', `/api/journal${requeteJournal(f, page, taille)}`, undefined, espaceOnglet),
  /** Export CSV du journal filtré (toutes les pages). */
  journalCsv: (f: FiltreJournal) => telecharger(`/api/journal/csv${requeteJournal(f)}`),
  /** Service RH : données personnelles d'un salarié (droit d'accès), journal des actions le concernant compris. */
  donneesSalarie: (empId: number) => telecharger(`/api/salaries/${empId}/donnees`),
  /** Le salarié connecté : ses propres données. */
  mesDonnees: () => telecharger('/api/mes-donnees'),
  /** Paie : fichier d'import Sage d'un lot de paie (téléchargement tracé et compté sur le lot). */
  fichierLotPaie: (id: number) => telecharger(`/api/paie/lots/${id}/fichier`),
  // lot 11 — notes de frais : exports comptables (comptabilité, service RH ; server/src/frais-exports.ts).
  /** Exports comptables des notes de frais, sans leurs écritures. */
  exportsFrais: () => request<{ exports: ExportFraisVue[] }>('GET', '/api/frais/exports', undefined, espaceOnglet),
  /** Fichier d'écritures d'un export comptable (téléchargement tracé et compté sur l'export). */
  fichierExportFrais: (id: number) => telecharger(`/api/frais/exports/${id}/fichier`),
  /** Paie : variables d'une période de paie (lots et attente), export CSV tracé (server/src/variables-paie.ts). */
  variablesPaie: (periode: string) => telecharger(`/api/paie/variables/${encodeURIComponent(periode)}`),
  /**
   * Passeport de prévention (lot 7, t066) : lignes de la période, à déclarer (intérimaires exclus) ou déjà déclarées
   * seules, export CSV produit et tracé par le serveur (server/src/passeport-prevention.ts). Rend les clés des lignes à
   * déclarer exportées (null : déjà déclarées, ou liste trop longue pour l'en-tête), le nombre de lignes du fichier et
   * celui des intérimaires écartés.
   */
  passeportPrevention: async (du: string, au: string, vue: 'a-declarer' | 'declarees') => {
    const h = await telecharger(`/api/formations/passeport-prevention?du=${encodeURIComponent(du)}&au=${encodeURIComponent(au)}&vue=${vue}`);
    const cles = h.get('X-Passeport-Lignes');
    return {
      cles: cles == null ? null : cles.split(',').filter(Boolean),
      nombre: Number(h.get('X-Passeport-Nombre') ?? 0), interimaires: Number(h.get('X-Passeport-Interimaires') ?? 0),
    };
  },
  /**
   * Export ou impression produit par le navigateur (CSV, passeport formation, compte rendu) : signalé au serveur
   * pour le journal, sans attendre ni bloquer le téléchargement.
   */
  signalerExport: (x: { nature: 'csv' | 'impression'; titre: string; lignes?: number; empId?: number }) => {
    fetch('/api/exports', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x) }).catch(() => {});
  },
  /** Pièce justificative envoyée seule, à joindre ensuite par une action (jeton). */
  envoyerPiece,
  comptes: () => request<CompteVue[]>('GET', '/api/comptes'),
  /** Notifications sur le téléphone (lot 11) : actives sur le serveur, clé publique VAPID, types proposés. */
  pushCle: () => request<{ active: boolean; cle: string | null; types: string[] }>('GET', '/api/push/cle'),
  /** Appareils abonnés du compte connecté (Mes appareils), sans adresse ni clé. */
  pushAppareils: () => request<{ active: boolean; appareils: AppareilPush[] }>('GET', '/api/push/appareils'),
  /** Page Confidentialité : coordonnées du responsable du traitement et du DPO, lisibles sans connexion. */
  confidentialite: () => request<ContactsConfidentialite>('GET', '/api/confidentialite'),
  envois: (statut: StatutEnvoi | null, cible: CibleEnvoi | null = null) => {
    const q = new URLSearchParams();
    if (statut) q.set('statut', statut);
    if (cible) q.set('cible', cible);
    return request<EnvoisState>('GET', `/api/envois${q.size ? `?${q}` : ''}`);
  },
  /**
   * `rejeu` (lot 11, file hors ligne : client/src/state/hors-ligne.ts) : clé d'idempotence de la saisie et marque du
   * rejeu hors ligne ; une réponse déjà donnée pour cette clé est rendue sans refaire l'action (`relire`).
   */
  async action(name: NomAction, payload: Record<string, unknown>, espace?: Role, rejeu?: { cle: string; horsLigne?: boolean }): Promise<ActionResponse> {
    try {
      // `horsLigne: false` (étape 2) : envoi en ligne d'une saisie admise hors ligne, avec sa clé, sans la marque du rejeu :
      // interrompu par le réseau, il repart de la file avec la même clé (client/src/pwa/useHorsLigne.ts).
      const entetes: Record<string, string> = rejeu ? { [EN_TETE_IDEMPOTENCE]: rejeu.cle, ...(rejeu.horsLigne === false ? {} : { [EN_TETE_HORS_LIGNE]: '1' }) } : {};
      const r = await request<{ message: string | null; result?: unknown; data?: Dataset; relire?: boolean }>('POST', `/api/actions/${name}`, payload, espace, entetes);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, message: null, error: (err as Error).message, status: (err as ApiError).status };
    }
  },
};
