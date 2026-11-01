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
// Sélection et filtres de l'écran sont aussi dans l'adresse de la page (state/url.ts) : lus au chargement, à la
// connexion et sur Précédent ; écrits à chaque changement (nouvelle entrée de l'historique pour l'ouverture d'une fiche).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VUES_COMMUNES, vuesDe, type ALLOWED_VIEWS, type HabMesureAction } from '../../../shared/constants.ts';
import { mondayOf } from '../../../shared/dates.ts';
import { organigrammeOuvertA } from '../../../shared/rules/organigramme.ts';
import type { FormaliteKind, UiIntent } from '../../../shared/domain.ts';
import type { ReferentielId } from '../../../shared/rules/referentiels.ts';
import type { CompteSession, Dataset, EntretienType, ISODate, MotifVisite, ObjetPiece, PlanStatut, ProfilRh, Role, VaccinId } from '../../../shared/types.ts';
import type { RepondantEvaluation, TypeEvaluation } from '../../../shared/types.ts';
import { api, definirEspaceOnglet, lienMicrosoft, surSessionExpiree, type ActionResponse, type ApiError, type NomAction, type SessionState } from '../api.ts';
import type { Tri } from '../components/tri.ts';
import { AppelsEnCours } from './actions.ts';
import type { Confirmation } from './confirmations.ts';
import { demandeHabilitation } from './confirmations-referentiels.ts';
import { effacerBrouillon, lireBrouillon, sauverBrouillon, type Champs } from './brouillon.ts';
import { instantanePerime } from './revision.ts';
import { executeurActions, FileAttente, lancerAction, rejouable, suiteReconnexion, type Attente } from './run.ts';
import { adresse, ecrireUrl, lireUrl, ouvreUneFiche, pageDeRetourClient } from './url.ts';
// lot 11 — pwa : saisie gardée hors ligne et rejouée (client/src/pwa/useHorsLigne.ts).
import { type HorsLigne, useHorsLigne } from '../pwa/useHorsLigne.ts';

export type View = (typeof ALLOWED_VIEWS)[Role][number] | (typeof VUES_COMMUNES)[number];

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
  /** `couverture` : couverture minimale des équipes (components/Couverture.tsx), à part des échéances par salarié. */
  echType: 'tous' | 'cert' | 'hab' | 'trip' | 'med' | 'exigence' | 'contrat' | 'couverture';
  goSel: string | null;
  exercice: number | null;
  planFilter: 'tous' | PlanStatut;
  weekStart: ISODate | null;
  tsEmp: number | null;
  /** Onglet de l'écran Référentiels (`entites` : Entités et sites, lot 11). */
  refOnglet: ReferentielId | 'postes' | 'activites' | 'horaires' | 'entites';
  /** Saisie des heures jour par jour (téléphone, tablette) : jour affiché, du lundi (0) au dimanche (6) ; null : le jour courant. */
  tsJour: number | null;
  /** Tri choisi par un clic sur un en-tête, par liste (components/tri.ts) ; absent : l'ordre par défaut de l'écran. */
  tris: Partial<Record<string, Tri | null>>;
  // lot 11 — organigramme
  /** Organigramme : entité (code) et site (code) filtrés ; null : tous. */
  orgEntite: string | null;
  orgSite: string | null;
}

const INITIAL_UI: UiState = {
  horizon: null, search: '', equipe: 'Toutes', statut: 'tous', selectedId: null, typeForm: 'toutes', formationFilter: null,
  habFilter: 'tous', habType: null, tripSel: null, echType: 'tous', goSel: null, exercice: null, planFilter: 'tous', weekStart: null, tsEmp: null,
  refOnglet: 'formations',
  tsJour: null,
  tris: {},
  // lot 11 — organigramme
  orgEntite: null, orgSite: null,
};

/** Dialogues ouverts depuis plusieurs écrans — rendus par <DialogHost />. */
export type DialogState =
  /** `sessionId` : session présélectionnée (retour de « Créer une session », t107). */
  | { type: 'plan'; empId: number; certId?: number; inscriptionId?: number; sessionId?: number }
  /** `certId` : correction d'une certification saisie par erreur (`cert.modifier`). */
  | { type: 'cert'; empId: number; certId?: number }
  /**
   * `retour` : dialogue « Planifier » d'où la session est créée ; il se rouvre ensuite, la nouvelle session
   * présélectionnée (t107). Un objet simple : il se conserve dans le brouillon de la reconnexion (brouillon.ts).
   */
  | { type: 'session'; f?: string; planId?: number; places?: number; sessionId?: number; retour?: DialogePlan }
  | { type: 'sessionDetail'; sessionId: number }
  | { type: 'cloture'; sessionId: number }
  | { type: 'hab'; empId?: number | null; h?: string | null; mode: 'new' | 'deliver' | 'renew' }
  | { type: 'habMesure'; empId: number; h: string; action: HabMesureAction }
  | { type: 'trip' }
  | { type: 'fo'; empId?: number | null; kind?: FormaliteKind; dest?: string; v?: VaccinId }
  | { type: 'detachement'; id: number }
  | { type: 'tripModifier'; id: number }
  | { type: 'visite'; empId: number; motif?: MotifVisite }
  | { type: 'avis'; empId: number }
  | { type: 'suivi'; empId: number }
  | { type: 'reqForm'; f?: string; sessionId?: number | null; empId?: number | null }
  | { type: 'reqHab'; empId?: number | null }
  | { type: 'employe'; empId?: number | null; equipe?: string | null }
  | { type: 'sortie'; empId: number }
  | { type: 'autorisation'; empId: number }
  /** Renouvellement d'un CDD (historique des contrats, t053). */
  | { type: 'renouvelerCdd'; empId: number }
  | { type: 'membre'; equipe?: string | null }
  | { type: 'equipe'; nom?: string | null }
  // lot 11 — pwa : déconnexion avec des saisies encore gardées sur l'appareil (dialogs/DeconnexionDialog.tsx).
  | { type: 'deconnexion'; n: number }
  | { type: 'abs'; empId: number }
  | { type: 'absSignal'; empId?: number | null }
  | { type: 'absNature'; empId?: number | null; id?: number }
  | { type: 'absProlonger'; id: number }
  | { type: 'absAnnuler'; id: number }
  | { type: 'cet'; empId: number }
  | { type: 'report'; empId: number }
  /** Clôture d'une période de congés : CP (`periode` : année de prise) ou RTT (`periode` : année). */
  | { type: 'clotureConges'; conges: 'CP' | 'RTT'; periode: number }
  | { type: 'fractionnement'; periode: number }
  | { type: 'entPlan'; empId: number; kind: EntretienType }
  | { type: 'ent'; entId: number }
  | { type: 'entRemise'; entId: number }
  | { type: 'planRealiser'; id: number }
  /** Formation suivie (t116) : saisie (`demandeId` : demande hors catalogue acceptée qu'elle clôt) ou correction (`id`). */
  | { type: 'formationSuivie'; empId: number; id?: number | null; demandeId?: number | null }
  /** Correction d'une ligne du plan de formation saisie par erreur (`plan.modifier`). */
  | { type: 'planLigne'; id: number }
  | { type: 'exerciceCloture'; exercice: number }
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
  /** Onglet Postes : poste (création sans identifiant) et exigences communes d'une équipe (shared/rules/exigences.ts). */
  | { type: 'refPoste'; id?: number | null }
  | { type: 'refEquipe'; nom: string }
  /** Onglet Postes : facteurs d'exposition du C2P cochés sur un poste (lot 7, shared/rules/c2p.ts). */
  | { type: 'refPosteC2p'; id: number }
  /** Écran Formations : lignes du Passeport de prévention à noter déclarées (lot 7, shared/rules/passeport-prevention.ts). */
  | { type: 'passeportDeclarer'; du: string; au: string; exportees: string[] | null }
  /** Onglet Activités internes (création sans code, renommage) ; mandat au CSE d'un salarié (fiche, service RH). */
  | { type: 'refActivite'; code?: string | null }
  /** Onglet Horaires : horaire de poste (création sans code, modification ; shared/rules/horaires.ts). */
  | { type: 'refHoraire'; code?: string | null }
  | { type: 'mandat'; empId: number; id?: number | null }
  /** Délégation des validations d'un manager absent à un suppléant (t135 : Mon espace, Équipes & managers). */
  | { type: 'delegation'; managerId: number }
  /** Correspondance d'une rubrique de paie avec le plan de paie Sage (écran Temps, components/RubriquesPaie.tsx). */
  | { type: 'rubrique'; code: string }
  /** Lots de paie (écran Temps, components/LotsPaie.tsx) : confirmation de l'import dans Sage, format du fichier d'import. */
  | { type: 'lotImport'; id: number }
  | { type: 'formatFichier' }
  /** Réouverture d'une feuille validée (administrateur RH, t131). */
  | { type: 'rouvrirFeuille'; empId: number; week: ISODate }
  /** Pièce justificative à joindre à un objet déjà enregistré (dialogs/PieceDialog.tsx, t133). */
  | { type: 'piece'; objet: ObjetPiece; objetId: number; empId: number; libelle?: string }
  /** Contact d'urgence d'un salarié (t068) : depuis son portail, ou par le service RH depuis la fiche. */
  | { type: 'contactUrgence'; empId: number }
  /** Avenant de renonciation à des jours de repos d'un forfait jours (t043) : service RH, depuis la fiche. */
  | { type: 'avenantForfait'; empId: number }
  /** Effacement des données échues ou anonymisation de dossiers de salariés sortis (t016, administrateur RH). */
  | { type: 'anonymiser'; ids: number[]; avantEcheance?: boolean }
  /** Demande de formation dont la session est complète : liste d'attente ou plan de formation (lot 7, t120). */
  | { type: 'accepterAttente'; id: number }
  /** Astreintes (t049, lot 7) : planification (`empId` présélectionné) ou modification (`id`) ; intervention déclarée. */
  | { type: 'astreinte'; empId?: number | null; id?: number | null }
  | { type: 'interventionAstreinte'; empId: number; jour?: ISODate | null; astreinteId?: number | null }
  /** Évaluation d'une formation (lot 7, t121) : `cle` de shared/rules/evaluation-formation.ts, à chaud ou à froid, avis de qui. */
  | { type: 'evaluation'; cle: string; quand: TypeEvaluation; repondant?: RepondantEvaluation }
  // lot 11 — organigramme
  /** Référentiels → Entités et sites : entité (création sans code, modification) et site (création sans code). */
  | { type: 'refEntite'; code?: string | null }
  | { type: 'refSite'; code?: string | null }
  /** Équipes & managers : entité (équipe racine), site et unité Matrix d'une équipe. */
  | { type: 'equipeRattachement'; nom: string }
  /** Refus ou action irréversible à confirmer (state/confirmations.ts). */
  | { type: 'confirmer'; c: Confirmation };

/** Dialogue « Planifier » : rouvert après la création d'une session (t107). */
export type DialogePlan = { type: 'plan'; empId: number; certId?: number; inscriptionId?: number };

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
  run: (name: NomAction, payload?: Record<string, unknown>, opts?: { silent?: boolean }) => Promise<ActionResponse>;
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
  /** lot 11 — pwa : réseau, saisies gardées sur l'appareil, rejeu, appareil partagé. */
  horsLigne: HorsLigne;
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

/**
 * Vue affichable dans l'espace (selon le profil pour l'espace RH), sinon la vue de repli, sinon la page d'accueil. Les vues
 * communes (Confidentialité) s'ouvrent dans tous les espaces, et sans connexion.
 */
export function allowedView(role: Role, v: string, fallback?: string, profilRh?: ProfilRh): View {
  if ((VUES_COMMUNES as readonly string[]).includes(v)) return v as View;
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
  const attentes = useRef(new FileAttente());
  const enBascule = useRef(false);
  const champsRef = useRef<{ dialog: DialogState; champs: Champs } | null>(null);

  // L'espace de l'onglet suit la session : il part avec les téléchargements et la lecture du journal (client/src/api.ts).
  const setSession = useCallback((s: SessionState | null) => { sessionRef.current = s; definirEspaceOnglet(s?.role); setSessionState(s); }, []);
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

  /**
   * Instantané renvoyé par le serveur ; s'il est d'un autre espace, l'onglet suit la session. Plus ancien que celui
   * affiché (réponse d'une action traitée avant une autre, arrivée après elle) : ignoré (state/revision.ts).
   */
  const recevoir = useCallback((d: Dataset) => {
    if (instantanePerime(d, dataRef.current)) return;
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
      setReconnexion({ compte: s.compte, role: s.role, methode: s.methode, enAttente: attentes.current.taille });
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
    const n = attentes.current.ajouter(a);
    const rc = reconnexionRef.current;
    if (rc) setReconnexion({ ...rc, enAttente: n });
  }, [setReconnexion]);

  /**
   * Premier chargement. Au retour de Microsoft après une session expirée, le brouillon du même compte
   * est restauré : espace, page, filtres, dialogue et ses champs (brouillon.ts).
   */
  const charger = useCallback(async () => {
    setLoading(true);
    setErreurChargement(null);
    // Adresse d'arrivée, relevée avant que la synchronisation de l'URL ne la réécrive.
    const depart = { vue: pathView(), search: location.search };
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
      // Lien partagé ou F5 : sélection et filtres repris de l'adresse, contrôlés sur les données reçues (state/url.ts).
      const d = dataRef.current;
      if (d) setUiState(u => ({ ...u, ...lireUrl(depart.vue, depart.search, d) }));
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
    // Précédent, Suivant : la vue et, pour elle, la sélection et les filtres de l'adresse.
    const onPop = () => {
      const v = pathView(), d = dataRef.current;
      setRawView(v);
      if (d) setUiState(u => ({ ...u, ...lireUrl(v, location.search, d) }));
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const role: Role = session?.role ?? 'rh';
  // lot 11 — organigramme : vue fermée au manager ou au collaborateur par le réglage `organigrammeOuvert` → page d'accueil.
  const fermee = rawView === 'organigramme' && !!data && !organigrammeOuvertA(data.settings.organigrammeOuvert, role);
  const view = allowedView(role, fermee ? '' : rawView, role === 'rh' ? data?.settings.vueInitiale : undefined, (data ?? session)?.user?.profilRh);

  // Synchronise l'URL avec la vue effectivement affichée, sa sélection et ses filtres (state/url.ts) : l'ouverture d'une
  // fiche dans la même vue ajoute une entrée à l'historique, tout autre changement remplace l'entrée courante (go a déjà
  // ajouté celle d'un changement de vue).
  const ecrit = useRef<{ view: View; ui: UiState } | null>(null);
  useEffect(() => {
    if (!session?.user) { ecrit.current = null; return; }
    const cible = adresse(view, ui), avant = ecrit.current;
    ecrit.current = { view, ui };
    if (location.pathname + location.search === cible) return;
    if (avant && avant.view === view && ouvreUneFiche(view, avant.ui, ui)) history.pushState(null, '', cible);
    else history.replaceState(null, '', cible);
  }, [view, ui, session?.user]);

  const setUi = useCallback((patch: Partial<UiState>) => setUiState(u => ({ ...u, ...patch })), []);

  const go = useCallback((v: View, patch?: Partial<UiState>) => {
    if (patch) setUiState(u => ({ ...u, ...patch }));
    if (pathView() !== v) history.pushState(null, '', `/${v}`);
    setRawView(v);
    window.scrollTo({ top: 0 });
  }, []);

  // lot 11 — pwa : une saisie admise hors ligne que le réseau n'a pas portée est gardée sur l'appareil, montrée dans
  // l'instantané en mémoire, puis rejouée (pwa/pilote.ts) ; toute autre action part comme avant.
  const horsLigne = useHorsLigne({ session, sessionRef, dataRef, montrer: setData, relire: rafraichir, notifier: notify });
  const horsLigneRef = useRef(horsLigne);
  horsLigneRef.current = horsLigne;

  // Exécution d'une action, attente de la reconnexion et relecture après un refus : state/run.ts.
  const executer = useMemo(() => executeurActions({
    appeler: (name: NomAction, payload) => horsLigneRef.current.appeler(name, payload),
    connecte: () => !!sessionRef.current?.user,
    recevoir, notifier: notify, attendre, suivre, rafraichir,
  }), [notify, recevoir, attendre, suivre, rafraichir]);

  // La même action déjà en cours (double clic, double envoi) n'est pas renvoyée : la même réponse est rendue,
  // sauf si un appel différent de cette action est parti depuis (la dernière intention doit arriver).
  const run = useCallback<Store['run']>((name, payload = {}, opts) => lancerAction(appels.current, executer, name, payload, opts), [executer]);

  const runIntent = useCallback((intent: UiIntent) => {
    switch (intent.type) {
      case 'openHab': setDialog({ type: 'hab', empId: intent.empId, h: intent.h, mode: intent.mode }); break;
      case 'openPlan': setDialog({ type: 'plan', empId: intent.empId, certId: intent.certId }); break;
      case 'goFormation': go('formations', { formationFilter: intent.f }); break;
      // Demande de visite : motif choisi, puis demande imprimable pour le service de santé au travail.
      case 'medical': setDialog({ type: 'visite', empId: intent.empId, motif: intent.motif }); break;
      case 'openFormalite': setDialog({ type: 'fo', empId: intent.empId, kind: intent.kind, dest: intent.dest, v: intent.v }); break;
      case 'openCloture': setDialog({ type: 'cloture', sessionId: intent.sessionId }); break;
      // Habilitation exigée jamais délivrée : titre demandé, « en attente » de délivrance, qui ne se retire pas (confirmé).
      case 'demanderHab': setDialog({ type: 'confirmer', c: demandeHabilitation(intent) }); break;
      // Échéances du contrat : fiche (période d'essai), sortie (fin de contrat), titre de séjour.
      case 'openContrat': setDialog(intent.quoi === 'sortie' ? { type: 'sortie', empId: intent.empId }
        : intent.quoi === 'titre' ? { type: 'autorisation', empId: intent.empId } : { type: 'employe', empId: intent.empId }); break;
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
      // Lien ouvert avant la connexion : la page, la sélection et les filtres de l'adresse (pas une page commune).
      const v = pathView();
      if (d && !(VUES_COMMUNES as readonly string[]).includes(v)) {
        setRawView(v);
        setUiState(u => ({ ...u, ...lireUrl(v, location.search, d) }));
      }
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
      // lot 11 — pwa : notifications de cet appareil désactivées tant que la session vaut, file purgée après.
      await horsLigneRef.current.avantDeconnexion();
      const s = await api.logout();
      await horsLigneRef.current.apresDeconnexion();
      effacerBrouillon();
      // La personne suivante ne reprend pas la page ni la fiche de celle qui part, y compris après la déconnexion
      // Microsoft (Précédent ne rouvre pas la fiche) : connect() relit l'adresse.
      history.replaceState(null, '', '/');
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
      // Lot 11 (C2, application mobile) : hors ligne, la relecture se tait ; l'instantané affiché reste en mémoire (rien
      // n'est gardé sur l'appareil) et la file hors ligne se rejoue au retour du réseau.
      if (!navigator.onLine) return;
      // Serveur injoignable : une tentative par période, pas à chaque tour de la minuterie.
      if (Date.now() - Math.max(recuLe.current, tenteLe.current) < age) return;
      // Lot 11 (C2) : des saisies attendent dans la file hors ligne : rejeu d'abord (il relit à la fin), pour que la
      // feuille relue ne les fasse pas disparaître quand le serveur revient sans événement « online ».
      if (horsLigneRef.current.entrees.some(e => e.etat === 'attente')) { tenteLe.current = Date.now(); void horsLigneRef.current.relecture(); return; }
      rafraichir();
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
      const suite = suiteReconnexion(rc, s);
      if (suite.quoi === 'remplacer') {
        // Mot de passe à remplacer (réinitialisé entre-temps) : rien n'est rejoué, l'écran du mot de passe s'affiche.
        attentes.current.abandonnerTout();
        setReconnexion(null);
        // Autre compte : il ne reprend pas l'écran (fiche, filtres) de la personne précédente.
        if (suite.autreCompte) history.replaceState(null, '', '/');
        reinitialiser();
        await applySession(s);
        return null;
      }
      // La connexion ouvre le premier espace du compte : retour à celui où la personne travaillait.
      if (suite.espace) s = await api.mode(suite.espace);
      if (!rejouable(rc, s)) {
        // Espace retiré entre-temps (profil RH, équipe confiée à un autre) : rien n'est rejoué ailleurs.
        attentes.current.abandonnerTout();
        reinitialiser();
      }
      await applySession(s);
      setReconnexion(null);
      // Actions interrompues, rejouées dans l'ordre ; chacune rend sa réponse à l'écran qui l'attend.
      attentes.current.rejouerTout();
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
    return lienMicrosoft({ retour: pageDeRetourClient(`/${view}`, ecrireUrl(view, ui)), identifiant: rc.compte.identifiant });
  }, [view, ui, dialog]);

  const abandonnerReconnexion = useCallback(async () => {
    attentes.current.abandonnerTout();
    setReconnexion(null);
    effacerBrouillon();
    // « Changer de compte » : la personne suivante ne reprend pas l'écran de la session expirée (connect() relit l'adresse).
    history.replaceState(null, '', '/');
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
    horsLigne,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
