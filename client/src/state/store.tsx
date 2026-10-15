// État global du client : session, instantané de données, navigation,
// filtres d'écran, dialogue ouvert et notifications.
// La session et les données de son espace changent toujours ensemble : l'écran n'affiche jamais un
// espace avec les données d'un autre. Une session expirée (réponse 401) n'efface rien : la reconnexion
// s'affiche par-dessus l'écran (layout/Reconnexion.tsx) et les actions interrompues attendent d'être
// rejouées (compte Cursus, démonstration) ; pour un compte Microsoft, le brouillon est conservé (brouillon.ts).
// Lectures et actions portent l'espace affiché : changé dans un autre onglet, le serveur refuse (409) et
// l'onglet suit la session (`suivre`), sans rejouer l'action.
// Les données sont relues au retour sur l'onglet, toutes les 2 minutes et après une action refusée : un
// manager qui garde l'écran ouvert voit arriver les demandes de son équipe. Une lecture partie avant une
// action n'écrase jamais les données renvoyées par celle-ci.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { vuesDe, type ALLOWED_VIEWS, type HabMesureAction } from '../../../shared/constants.ts';
import { mondayOf } from '../../../shared/dates.ts';
import type { FormaliteKind, UiIntent } from '../../../shared/domain.ts';
import type { ReferentielId } from '../../../shared/rules/referentiels.ts';
import type { CompteSession, Dataset, EntretienType, ISODate, PlanStatut, ProfilRh, Role, VaccinId } from '../../../shared/types.ts';
import { api, lienMicrosoft, surSessionExpiree, type ActionResponse, type ApiError, type SessionState } from '../api.ts';
import { AppelsEnCours, cleAction } from './actions.ts';
import type { Confirmation } from './confirmations.ts';
import { effacerBrouillon, lireBrouillon, sauverBrouillon, type Champs } from './brouillon.ts';

export type View = (typeof ALLOWED_VIEWS)[Role][number];

export interface UiState {
  horizon: number | null;
  search: string;
  equipe: string;
  /** Statut de conformité affiché dans Collaborateurs, ou les salariés sortis (`sortis`). */
  statut: 'tous' | 'ok' | 'due' | 'exp' | 'sortis';
  selectedId: number | null;
  typeForm: 'toutes' | 'reg' | 'rec' | 'int';
  formationFilter: string | null;
  habFilter: 'tous' | 'due' | 'ko' | 'pending';
  habType: string | null;
  tripSel: number | null;
  echType: 'tous' | 'cert' | 'hab' | 'trip' | 'med';
  goSel: string | null;
  exercice: number | null;
  planFilter: 'tous' | PlanStatut;
  weekStart: ISODate | null;
  tsEmp: number | null;
  /** Onglet de l'écran Référentiels. */
  refOnglet: ReferentielId;
}

const INITIAL_UI: UiState = {
  horizon: null, search: '', equipe: 'Toutes', statut: 'tous', selectedId: null, typeForm: 'toutes', formationFilter: null,
  habFilter: 'tous', habType: null, tripSel: null, echType: 'tous', goSel: null, exercice: null, planFilter: 'tous', weekStart: null, tsEmp: null,
  refOnglet: 'formations',
};

/** Dialogues ouverts depuis plusieurs écrans — rendus par <DialogHost />. */
export type DialogState =
  | { type: 'plan'; empId: number; certId?: number; inscriptionId?: number }
  | { type: 'cert'; empId: number }
  | { type: 'session'; f?: string; planId?: number; places?: number; sessionId?: number }
  | { type: 'sessionDetail'; sessionId: number }
  | { type: 'cloture'; sessionId: number }
  | { type: 'hab'; empId?: number | null; h?: string | null; mode: 'new' | 'deliver' | 'renew' }
  | { type: 'habMesure'; empId: number; h: string; action: HabMesureAction }
  | { type: 'trip' }
  | { type: 'fo'; empId?: number | null; kind?: FormaliteKind; dest?: string; v?: VaccinId }
  | { type: 'detachement'; id: number }
  | { type: 'visite'; empId: number }
  | { type: 'avis'; empId: number }
  | { type: 'reqForm'; f?: string; sessionId?: number | null; empId?: number | null }
  | { type: 'reqHab'; empId?: number | null }
  | { type: 'employe'; empId?: number | null; equipe?: string | null }
  | { type: 'sortie'; empId: number }
  | { type: 'membre'; equipe?: string | null }
  | { type: 'equipe'; nom?: string | null }
  | { type: 'abs'; empId: number }
  | { type: 'absSignal'; empId?: number | null }
  | { type: 'absNature'; empId?: number | null; id?: number }
  | { type: 'absProlonger'; id: number }
  | { type: 'absAnnuler'; id: number }
  | { type: 'cet'; empId: number }
  | { type: 'report'; empId: number }
  /** Clôture d'une période de congés : CP (`periode` : année de prise) ou RTT (`periode` : année). */
  | { type: 'clotureConges'; conges: 'CP' | 'RTT'; periode: number }
  | { type: 'entPlan'; empId: number; kind: EntretienType }
  | { type: 'ent'; entId: number }
  | { type: 'tripImport' }
  | { type: 'planImport'; exercice: number }
  | { type: 'budget'; exercice: number }
  | { type: 'compte' }
  | { type: 'motDePasseProvisoire'; nom: string; identifiant: string; motDePasse: string }
  | { type: 'motDePasse' }
  /** Écran Référentiels : création (sans identifiant) ou modification d'une formation, d'une habilitation, d'une destination. */
  | { type: 'refFormation'; id?: string | null }
  | { type: 'refHabilitation'; id?: string | null }
  | { type: 'refDestination'; code?: string | null }
  /** Correspondance d'une rubrique de paie avec le plan de paie Sage (écran Temps, components/RubriquesPaie.tsx). */
  | { type: 'rubrique'; code: string }
  /** Refus ou action irréversible à confirmer (state/confirmations.ts). */
  | { type: 'confirmer'; c: Confirmation };

/** Notification : un succès s'efface seul, une erreur reste jusqu'à sa fermeture ou au message suivant. */
export interface Toast { id: number; text: string; error?: boolean }

/** Session expirée pendant le travail : la personne à reconnecter, l'espace où elle était, les actions en attente. */
export interface Reconnexion {
  compte: CompteSession;
  role: Role;
  methode: 'local' | 'demo' | 'microsoft';
  /** Actions interrompues par l'expiration, rejouées après la reconnexion (compte Cursus, démonstration). */
  enAttente: number;
}
/** Action interrompue par l'expiration de la session. */
interface Attente { rejouer: () => Promise<unknown>; abandonner: () => void }

/** Réponse d'une action interrompue puis abandonnée (« Changer de compte »). */
const NON_ENREGISTREE = 'Session expirée : action non enregistrée';

export interface Store {
  session: SessionState | null;
  data: Dataset | null;
  loading: boolean;
  view: View;
  go: (view: View, patch?: Partial<UiState>) => void;
  ui: UiState;
  setUi: (patch: Partial<UiState>) => void;
  dialog: DialogState | null;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
  toast: Toast | null;
  notify: (text: string, error?: boolean) => void;
  fermerNotification: () => void;
  /** Exécute une action serveur, met à jour les données et affiche le message. */
  run: (name: string, payload?: Record<string, unknown>, opts?: { silent?: boolean }) => Promise<ActionResponse>;
  /** Proposition du domaine : ouvre un dialogue ou lance l'action (sa réponse est alors rendue). */
  runIntent: (intent: UiIntent) => Promise<ActionResponse> | void;
  switchMode: (role: Role) => Promise<void>;
  /** Démonstration : connexion libre au compte choisi. Renvoie le message d'erreur, ou null. */
  loginDemo: (role: Role, compteId: number, password: string) => Promise<string | null>;
  /** Compte Cursus (identifiant et mot de passe). Renvoie le message d'erreur, ou null. */
  login: (identifiant: string, motDePasse: string) => Promise<string | null>;
  changerMotDePasse: (actuel: string, nouveau: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** Relit les données de l'espace, sans message en cas d'échec (une lecture plus récente l'emporte). */
  refresh: () => Promise<void>;
  /** Changement d'espace en cours : le sélecteur attend les données du nouvel espace. */
  bascule: boolean;
  /** Premier chargement impossible (serveur injoignable) : message, et nouvel essai avec `recharger`. */
  erreurChargement: string | null;
  recharger: () => void;
  /** Session expirée : reconnexion affichée par-dessus l'écran, sans démonter la page ni le dialogue. */
  reconnexion: Reconnexion | null;
  /** Compte Cursus ou démonstration : reconnexion, puis actions interrompues rejouées. Renvoie l'erreur, ou null. */
  reconnecter: (motDePasse: string) => Promise<string | null>;
  /** Compte Microsoft : conserve le brouillon et renvoie l'adresse de la connexion Microsoft. */
  reconnecterMicrosoft: () => string;
  /** Renonce à reprendre le travail : actions interrompues abandonnées, écran de connexion. */
  abandonnerReconnexion: () => Promise<void>;
  /** Champs du dialogue `d` restaurés au retour de Microsoft, remis une seule fois (components/Dialog.tsx). */
  prendreChamps: (d: DialogState | null) => Champs | null;
}

// Contexte conservé d'un rechargement à chaud à l'autre (sinon les composants déjà montés perdent le fournisseur).
const g = globalThis as { __cursusStore?: React.Context<Store | null> };
const Ctx = (g.__cursusStore ??= createContext<Store | null>(null));

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore hors de <StoreProvider>');
  return s;
}
/** Données chargées — à n'utiliser que sous un écran authentifié. */
export function useData(): Dataset {
  const { data } = useStore();
  if (!data) throw new Error('Données non chargées');
  return data;
}

function pathView(): string { return location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || ''; }

/** Relecture des données : toutes les 2 minutes sur l'onglet affiché, au retour sur l'onglet après 30 s. */
const RELECTURE_MS = 120_000;
const RETOUR_MS = 30_000;
/** Durée d'affichage d'un message de succès, allongée pour un texte long. */
const dureeNotification = (text: string) => Math.max(5000, text.length * 60);

/**
 * Données de l'espace de la session `s`. Si la session est passée à un autre espace entre-temps (autre
 * onglet, réponse 409), elle est relue une fois : la session et les données renvoyées vont ensemble.
 */
async function avecDonnees(s: SessionState): Promise<[SessionState, Dataset | null]> {
  try {
    return [s, s.user ? await api.data(s.role) : null];
  } catch (err) {
    if ((err as ApiError).status !== 409) throw err;
    const s2 = await api.session();
    return [s2, s2.user ? await api.data(s2.role) : null];
  }
}

/** Vue affichable dans l'espace (selon le profil pour l'espace RH), sinon la vue de repli, sinon la page d'accueil. */
export function allowedView(role: Role, v: string, fallback?: string, profilRh?: ProfilRh): View {
  const list = vuesDe(role, profilRh);
  if (list.includes(v)) return v as View;
  if (fallback && list.includes(fallback)) return fallback as View;
  return list[0] as View;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionState | null>(null);
  const [data, setDataState] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [rawView, setRawView] = useState(pathView());
  const [ui, setUiState] = useState<UiState>(INITIAL_UI);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [bascule, setBascule] = useState(false);
  const [reconnexion, setReconnexionState] = useState<Reconnexion | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastId = useRef(0);
  // Valeurs courantes lues hors rendu (réponse 401, actions rejouées, relecture des données).
  const sessionRef = useRef<SessionState | null>(null);
  const dataRef = useRef<Dataset | null>(null);
  // Numéro de l'instantané affiché et heure de sa réception : une lecture partie avant un autre instantané est périmée.
  const generation = useRef(0);
  const recuLe = useRef(0);
  const tenteLe = useRef(0);
  const appels = useRef(new AppelsEnCours<ActionResponse>());
  const lecture = useRef<Promise<void> | null>(null);
  const reconnexionRef = useRef<Reconnexion | null>(null);
  const attentes = useRef<Attente[]>([]);
  const enBascule = useRef(false);
  const champsRef = useRef<{ dialog: DialogState; champs: Champs } | null>(null);

  const setSession = useCallback((s: SessionState | null) => { sessionRef.current = s; setSessionState(s); }, []);
  const setData = useCallback((d: Dataset | null) => {
    generation.current++;
    recuLe.current = Date.now();
    dataRef.current = d;
    setDataState(d);
  }, []);
  const setReconnexion = useCallback((r: Reconnexion | null) => { reconnexionRef.current = r; setReconnexionState(r); }, []);

  const notify = useCallback((text: string, error = false) => {
    clearTimeout(toastTimer.current);
    const id = ++toastId.current;
    setToast({ id, text, error });
    // Une erreur reste affichée jusqu'à sa fermeture (ou au message suivant) : elle doit pouvoir être lue.
    if (!error) toastTimer.current = setTimeout(() => setToast(t => t?.id === id ? null : t), dureeNotification(text));
  }, []);
  const fermerNotification = useCallback(() => { clearTimeout(toastTimer.current); setToast(null); }, []);

  /** Session et données de son espace, appliquées ensemble (l'erreur est levée si les données ne viennent pas). */
  const applySession = useCallback(async (s0: SessionState) => {
    const [s, d] = await avecDonnees(s0);
    setSession(s);
    setData(d);
  }, [setSession, setData]);

  /** Nouvel espace ou nouvelle personne : page, filtres et dialogue précédents abandonnés. */
  const reinitialiser = useCallback(() => {
    champsRef.current = null;
    setDialog(null);
    setUiState(u => ({ ...INITIAL_UI, horizon: u.horizon }));
    setRawView('');
  }, []);

  /**
   * La session a changé d'espace hors de cet onglet (autre onglet, espace retiré au compte) : l'onglet
   * passe à l'espace actif avec ses données ; page, filtres et dialogue de l'ancien espace sont abandonnés.
   */
  const suivre = useCallback(async () => {
    try {
      const [s, d] = await avecDonnees(await api.session());
      if (s.role !== sessionRef.current?.role) reinitialiser();
      setSession(s);
      setData(d);
    } catch (err) {
      if ((err as ApiError).status !== 401) notify((err as Error).message, true);
    }
  }, [reinitialiser, setSession, setData, notify]);

  /** Instantané renvoyé par le serveur ; s'il est d'un autre espace, l'onglet suit la session. */
  const recevoir = useCallback((d: Dataset) => {
    const s = sessionRef.current;
    if (!s || d.user.role === s.role) { setData(d); return; }
    suivre();
  }, [setData, suivre]);

  /**
   * Relit les données de l'espace affiché. Écartée si un autre instantané est arrivé pendant la lecture
   * (action, changement d'espace) ou si une action est en cours : sa réponse fera foi. Sans message : une
   * erreur réseau attend la lecture suivante, une session expirée affiche la reconnexion (api.ts).
   */
  const rafraichir = useCallback((): Promise<void> => {
    if (lecture.current) return lecture.current;
    const s = sessionRef.current;
    if (!s?.user || reconnexionRef.current || enBascule.current) return Promise.resolve();
    const g = generation.current;
    tenteLe.current = Date.now();
    const p = (async () => {
      try {
        const d = await api.data(s.role);
        if (generation.current !== g || appels.current.taille > 0) return;
        // Rien de nouveau : l'écran n'est pas redessiné, une saisie en cours n'est pas dérangée.
        if (JSON.stringify(d) === JSON.stringify(dataRef.current)) { recuLe.current = Date.now(); return; }
        recevoir(d);
      } catch (err) {
        // Espace changé dans un autre onglet : l'onglet suit la session.
        if ((err as ApiError).status === 409) suivre();
      } finally {
        lecture.current = null;
      }
    })();
    lecture.current = p;
    return p;
  }, [recevoir, suivre]);

  /** Réponse 401 : session expirée ou révoquée. Une personne connectée garde son écran et se reconnecte par-dessus. */
  const expirer = useCallback(() => {
    if (reconnexionRef.current) return;
    const s = sessionRef.current;
    if (s?.user && s.compte && s.methode) {
      setReconnexion({ compte: s.compte, role: s.role, methode: s.methode, enAttente: attentes.current.length });
      return;
    }
    // Personne de connecté (mot de passe provisoire à remplacer) : retour à l'écran de connexion.
    api.session().then(applySession).catch(() => { /* hors ligne : l'écran reste tel quel */ });
  }, [applySession, setReconnexion]);
  useEffect(() => {
    surSessionExpiree(expirer);
    return () => surSessionExpiree(null);
  }, [expirer]);

  /** Met une action interrompue en attente de la reconnexion. */
  const attendre = useCallback((a: Attente) => {
    attentes.current.push(a);
    const rc = reconnexionRef.current;
    if (rc) setReconnexion({ ...rc, enAttente: attentes.current.length });
  }, [setReconnexion]);

  /**
   * Premier chargement. Au retour de Microsoft après une session expirée, le brouillon du même compte
   * est restauré : espace, page, filtres, dialogue et ses champs (brouillon.ts).
   */
  const charger = useCallback(async () => {
    setLoading(true);
    setErreurChargement(null);
    try {
      let s = await api.session();
      const b = s.user && s.compte ? lireBrouillon() : null;
      if (b && s.compte) {
        effacerBrouillon();
        if (s.compte.id === b.compteId && s.compte.espaces.includes(b.role)) {
          if (s.role !== b.role) s = await api.mode(b.role);
          await applySession(s);
          setUiState(b.ui);
          setRawView(b.view);
          if (b.dialog) {
            setDialog(b.dialog);
            if (b.champs) champsRef.current = { dialog: b.dialog, champs: b.champs };
          }
          notify(b.dialog ? 'Saisie en cours restaurée après la reconnexion : vérifiez-la, puis validez de nouveau.' : 'Reconnecté : vous reprenez où vous en étiez.');
          return;
        }
      }
      await applySession(s);
    } catch (err) {
      setErreurChargement((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applySession, notify]);

  // Un seul premier chargement, même si React rejoue l'effet (StrictMode) : le brouillon ne se lit qu'une fois.
  const lance = useRef(false);
  useEffect(() => {
    if (!lance.current) { lance.current = true; charger(); }
  }, [charger]);
  useEffect(() => {
    const onPop = () => setRawView(pathView());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const role: Role = session?.role ?? 'rh';
  const view = allowedView(role, rawView, role === 'rh' ? data?.settings.vueInitiale : undefined, (data ?? session)?.user?.profilRh);

  // Synchronise l'URL avec la vue effectivement affichée.
  useEffect(() => {
    if (session?.user && pathView() !== view) history.replaceState(null, '', `/${view}`);
  }, [view, session?.user]);

  const setUi = useCallback((patch: Partial<UiState>) => setUiState(u => ({ ...u, ...patch })), []);

  const go = useCallback((v: View, patch?: Partial<UiState>) => {
    if (patch) setUiState(u => ({ ...u, ...patch }));
    if (pathView() !== v) history.pushState(null, '', `/${v}`);
    setRawView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const executer = useCallback(async (name: string, payload: Record<string, unknown>, opts?: { silent?: boolean }): Promise<ActionResponse> => {
    const r = await api.action(name, payload, sessionRef.current?.role);
    if (r.ok) {
      if (r.data) recevoir(r.data);
      if (r.message && !opts?.silent) notify(r.message);
      return r;
    }
    // Session expirée : l'action attend la reconnexion, puis est rejouée ; l'écran qui l'a lancée attend sa réponse.
    if (r.status === 401 && sessionRef.current?.user) {
      return new Promise<ActionResponse>(resolve => attendre({
        rejouer: () => executer(name, payload, opts).then(resolve),
        abandonner: () => resolve({ ok: false, message: null, error: NON_ENREGISTREE, status: 401 }),
      }));
    }
    notify(r.error || 'Action impossible', true);
    // Espace changé dans un autre onglet : rien n'a été fait ; l'onglet suit la session, l'action n'est pas rejouée.
    if (r.status === 409) suivre();
    // Action refusée : l'écran était peut-être en retard (demande déjà traitée, feuille modifiée ailleurs).
    else if (r.status !== 401) rafraichir();
    return r;
  }, [notify, recevoir, attendre, suivre, rafraichir]);

  // La même action déjà en cours (double clic, double envoi) n'est pas renvoyée : la même réponse est rendue,
  // sauf si un appel différent de cette action est parti depuis (la dernière intention doit arriver).
  const run = useCallback<Store['run']>((name, payload = {}, opts) =>
    appels.current.lancer(cleAction(name, payload), () => executer(name, payload, opts), name), [executer]);

  const runIntent = useCallback((intent: UiIntent) => {
    switch (intent.type) {
      case 'openHab': setDialog({ type: 'hab', empId: intent.empId, h: intent.h, mode: intent.mode }); break;
      case 'openPlan': setDialog({ type: 'plan', empId: intent.empId, certId: intent.certId }); break;
      case 'goFormation': go('formations', { formationFilter: intent.f }); break;
      // Demande de visite : motif choisi, puis demande imprimable pour le service de santé au travail.
      case 'medical': setDialog({ type: 'visite', empId: intent.empId }); break;
      case 'openFormalite': setDialog({ type: 'fo', empId: intent.empId, kind: intent.kind, dest: intent.dest, v: intent.v }); break;
      case 'openCloture': setDialog({ type: 'cloture', sessionId: intent.sessionId }); break;
    }
  }, [go]);

  /**
   * Changement d'espace : le nouvel espace ne s'affiche qu'avec ses données, d'un seul coup. En cas
   * d'échec (réseau), l'espace, la page, les filtres et le dialogue ouverts restent tels quels.
   */
  const switchMode = useCallback(async (r: Role): Promise<void> => {
    if (enBascule.current) return;
    enBascule.current = true;
    setBascule(true);
    try {
      const [s, d] = await avecDonnees(await api.mode(r));
      reinitialiser();
      setSession(s);
      setData(d);
    } catch (err) {
      // Session expirée : le changement d'espace est rejoué après la reconnexion.
      if ((err as ApiError).status === 401 && sessionRef.current?.user) attendre({ rejouer: () => switchMode(r), abandonner: () => {} });
      else notify(`Changement d’espace impossible — ${(err as Error).message}`, true);
    } finally {
      enBascule.current = false;
      setBascule(false);
    }
  }, [reinitialiser, setSession, setData, attendre, notify]);

  /** Ouvre la session renvoyée par `call` ; renvoie le message d'erreur, ou null. */
  const connect = useCallback(async (call: () => Promise<SessionState>) => {
    try {
      const [s, d] = await avecDonnees(await call());
      reinitialiser();
      setSession(s);
      setData(d);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [reinitialiser, setSession, setData]);
  const loginDemo = useCallback((r: Role, compteId: number, password: string) => connect(() => api.loginDemo(r, compteId, password)), [connect]);
  const login = useCallback((identifiant: string, motDePasse: string) => connect(() => api.login(identifiant, motDePasse)), [connect]);
  const changerMotDePasse = useCallback(async (actuel: string, nouveau: string) => {
    try {
      await applySession(await api.motDePasse(actuel, nouveau));
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [applySession]);

  /** Déconnexion : session révoquée ; pour un compte Microsoft, passage par la déconnexion Microsoft. */
  const logout = useCallback(async () => {
    try {
      const s = await api.logout();
      effacerBrouillon();
      if (s.deconnexion) { location.assign(s.deconnexion); return; }
      reinitialiser();
      await applySession(s);
    } catch (err) {
      notify(`Déconnexion impossible — ${(err as Error).message}`, true);
    }
  }, [reinitialiser, applySession, notify]);

  // Relecture au retour sur l'onglet (30 s au moins après le dernier instantané) et toutes les 2 minutes
  // sur l'onglet affiché ; jamais pendant une action, qui renvoie ses propres données.
  const connecte = !!session?.user;
  useEffect(() => {
    if (!connecte) return;
    const relire = (age: number) => {
      if (document.visibilityState !== 'visible' || appels.current.taille > 0) return;
      // Serveur injoignable : une tentative par période, pas à chaque tour de la minuterie.
      if (Date.now() - Math.max(recuLe.current, tenteLe.current) >= age) rafraichir();
    };
    const auRetour = () => relire(RETOUR_MS);
    const minuterie = setInterval(() => relire(RELECTURE_MS), 15_000);
    document.addEventListener('visibilitychange', auRetour);
    addEventListener('focus', auRetour);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
      removeEventListener('focus', auRetour);
    };
  }, [connecte, rafraichir]);

  // — Reconnexion après l'expiration de la session —

  const reconnecter = useCallback(async (motDePasse: string) => {
    const rc = reconnexionRef.current;
    if (!rc) return null;
    try {
      let s = rc.methode === 'demo' ? await api.loginDemo(rc.role, rc.compte.id, motDePasse) : await api.login(rc.compte.identifiant, motDePasse);
      if (!s.user || s.compte?.id !== rc.compte.id) {
        // Mot de passe à remplacer (réinitialisé entre-temps) : rien n'est rejoué, l'écran du mot de passe s'affiche.
        for (const a of attentes.current.splice(0)) a.abandonner();
        setReconnexion(null);
        reinitialiser();
        await applySession(s);
        return null;
      }
      // La connexion ouvre le premier espace du compte : retour à celui où la personne travaillait.
      if (s.role !== rc.role && s.compte.espaces.includes(rc.role)) s = await api.mode(rc.role);
      if (s.role !== rc.role) {
        // Espace retiré entre-temps (profil RH, équipe confiée à un autre) : rien n'est rejoué ailleurs.
        for (const a of attentes.current.splice(0)) a.abandonner();
        reinitialiser();
      }
      await applySession(s);
      setReconnexion(null);
      // Actions interrompues, rejouées dans l'ordre ; chacune rend sa réponse à l'écran qui l'attend.
      const file = attentes.current.splice(0);
      (async () => { for (const a of file) await a.rejouer(); })();
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [applySession, reinitialiser, setReconnexion]);

  const reconnecterMicrosoft = useCallback(() => {
    const rc = reconnexionRef.current;
    if (!rc) return lienMicrosoft();
    // La redirection quitte la page : le brouillon (page, filtres, dialogue et ses champs) reste dans l'onglet.
    sauverBrouillon({ compteId: rc.compte.id, role: rc.role, view, ui, dialog });
    return lienMicrosoft({ retour: `/${view}`, identifiant: rc.compte.identifiant });
  }, [view, ui, dialog]);

  const abandonnerReconnexion = useCallback(async () => {
    for (const a of attentes.current.splice(0)) a.abandonner();
    setReconnexion(null);
    effacerBrouillon();
    reinitialiser();
    try {
      await applySession(await api.session());
    } catch (err) {
      // Serveur injoignable : écran d'erreur avec « Réessayer », plutôt qu'une connexion sans ses options.
      setSession(null);
      setData(null);
      setErreurChargement((err as Error).message);
    }
  }, [setReconnexion, reinitialiser, applySession, setSession, setData]);

  const prendreChamps = useCallback((d: DialogState | null) => {
    const c = champsRef.current;
    if (!c || c.dialog !== d) return null;
    champsRef.current = null;
    return c.champs;
  }, []);

  const recharger = useCallback(() => { charger(); }, [charger]);

  // Valeurs par défaut dépendant des données (seuil d'alerte, exercice, semaine).
  const effectiveUi = useMemo<UiState>(() => {
    if (!data) return ui;
    return {
      ...ui,
      horizon: ui.horizon ?? data.settings.horizonAlerte,
      exercice: ui.exercice ?? Number(data.today.slice(0, 4)),
      weekStart: ui.weekStart ?? mondayOf(data.today),
    };
  }, [ui, data]);

  const openDialog = useCallback((d: DialogState) => { champsRef.current = null; setDialog(d); }, []);
  const closeDialog = useCallback(() => { champsRef.current = null; setDialog(null); }, []);

  const value: Store = {
    session, data, loading, view, go, ui: effectiveUi, setUi, dialog, openDialog, closeDialog,
    toast, notify, fermerNotification, run, runIntent, switchMode, loginDemo, login, changerMotDePasse, logout, refresh: rafraichir,
    bascule, erreurChargement, recharger, reconnexion, reconnecter, reconnecterMicrosoft, abandonnerReconnexion, prendreChamps,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
