// État global du client : session, instantané de données, navigation,
// filtres d'écran, dialogue ouvert et notifications.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ALLOWED_VIEWS, type HabMesureAction } from '../../../shared/constants.ts';
import { mondayOf } from '../../../shared/dates.ts';
import type { FormaliteKind, UiIntent } from '../../../shared/domain.ts';
import type { Dataset, EntretienType, ISODate, PlanStatut, Role, VaccinId } from '../../../shared/types.ts';
import { api, type ActionResponse, type SessionState } from '../api.ts';

export type View = (typeof ALLOWED_VIEWS)[Role][number];

export interface UiState {
  horizon: number | null;
  search: string;
  equipe: string;
  statut: 'tous' | 'ok' | 'due' | 'exp';
  selectedId: number | null;
  typeForm: 'toutes' | 'reg' | 'rec' | 'int';
  formationFilter: string | null;
  habFilter: 'tous' | 'due' | 'ko' | 'pending';
  habType: string | null;
  tripSel: number | null;
  echType: 'tous' | 'cert' | 'hab' | 'trip';
  goSel: string | null;
  exercice: number | null;
  planFilter: 'tous' | PlanStatut;
  weekStart: ISODate | null;
  tsEmp: number | null;
}

const INITIAL_UI: UiState = {
  horizon: null, search: '', equipe: 'Toutes', statut: 'tous', selectedId: null, typeForm: 'toutes', formationFilter: null,
  habFilter: 'tous', habType: null, tripSel: null, echType: 'tous', goSel: null, exercice: null, planFilter: 'tous', weekStart: null, tsEmp: null,
};

/** Dialogues ouverts depuis plusieurs écrans — rendus par <DialogHost />. */
export type DialogState =
  | { type: 'plan'; empId: number; certId: number }
  | { type: 'cert'; empId: number }
  | { type: 'session'; f?: string; planId?: number; places?: number }
  | { type: 'hab'; empId?: number | null; h?: string | null; mode: 'new' | 'deliver' | 'renew' }
  | { type: 'habMesure'; empId: number; h: string; action: HabMesureAction }
  | { type: 'trip' }
  | { type: 'fo'; empId?: number | null; kind?: FormaliteKind; dest?: string; v?: VaccinId }
  | { type: 'reqForm'; f?: string; sessionId?: number | null; empId?: number | null }
  | { type: 'reqHab'; empId?: number | null }
  | { type: 'employe'; empId?: number | null; equipe?: string | null }
  | { type: 'membre'; equipe?: string | null }
  | { type: 'equipe'; nom?: string | null }
  | { type: 'abs'; empId: number }
  | { type: 'cet'; empId: number }
  | { type: 'report'; empId: number }
  | { type: 'entPlan'; empId: number; kind: EntretienType }
  | { type: 'ent'; entId: number }
  | { type: 'tripImport' }
  | { type: 'planImport'; exercice: number }
  | { type: 'budget'; exercice: number }
  | { type: 'compte' }
  | { type: 'motDePasseProvisoire'; nom: string; identifiant: string; motDePasse: string }
  | { type: 'motDePasse' };

interface Toast { text: string; error?: boolean }

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
  /** Exécute une action serveur, met à jour les données et affiche le message. */
  run: (name: string, payload?: Record<string, unknown>, opts?: { silent?: boolean }) => Promise<ActionResponse>;
  runIntent: (intent: UiIntent) => void;
  switchMode: (role: Role) => Promise<void>;
  /** Démonstration : connexion libre au compte choisi. Renvoie le message d'erreur, ou null. */
  loginDemo: (role: Role, compteId: number, password: string) => Promise<string | null>;
  /** Compte Cursus (identifiant et mot de passe). Renvoie le message d'erreur, ou null. */
  login: (identifiant: string, motDePasse: string) => Promise<string | null>;
  changerMotDePasse: (actuel: string, nouveau: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
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

export function allowedView(role: Role, v: string, fallback?: string): View {
  const list = ALLOWED_VIEWS[role] as readonly string[];
  if (list.includes(v)) return v as View;
  if (fallback && list.includes(fallback)) return fallback as View;
  return list[0] as View;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawView, setRawView] = useState(pathView());
  const [ui, setUiState] = useState<UiState>(INITIAL_UI);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((text: string, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const loadData = useCallback(async (s: SessionState | null) => {
    if (!s?.user) { setData(null); return; }
    try {
      setData(await api.data());
    } catch (err) {
      notify((err as Error).message, true);
    }
  }, [notify]);

  const applySession = useCallback(async (s: SessionState) => {
    setSession(s);
    await loadData(s);
  }, [loadData]);

  useEffect(() => {
    api.session().then(applySession).catch(err => notify((err as Error).message, true)).finally(() => setLoading(false));
    const onPop = () => setRawView(pathView());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [applySession, notify]);

  const role: Role = session?.role ?? 'rh';
  const view = allowedView(role, rawView, role === 'rh' ? data?.settings.vueInitiale : undefined);

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

  const run = useCallback<Store['run']>(async (name, payload = {}, opts) => {
    const r = await api.action(name, payload);
    if (r.ok) {
      if (r.data) setData(r.data);
      if (r.message && !opts?.silent) notify(r.message);
    } else {
      notify(r.error || 'Action impossible', true);
      if (r.error === 'Connexion requise') api.session().then(applySession);
    }
    return r;
  }, [notify, applySession]);

  const runIntent = useCallback((intent: UiIntent) => {
    switch (intent.type) {
      case 'openHab': setDialog({ type: 'hab', empId: intent.empId, h: intent.h, mode: intent.mode }); break;
      case 'openPlan': setDialog({ type: 'plan', empId: intent.empId, certId: intent.certId }); break;
      case 'goFormation': go('formations', { formationFilter: intent.f }); break;
      case 'medical': run('medical.demander', { empId: intent.empId }); break;
      case 'openFormalite': setDialog({ type: 'fo', empId: intent.empId, kind: intent.kind, dest: intent.dest, v: intent.v }); break;
    }
  }, [go, run]);

  const switchMode = useCallback(async (r: Role) => {
    setDialog(null);
    setUiState(u => ({ ...INITIAL_UI, horizon: u.horizon }));
    const s = await api.mode(r);
    setRawView('');
    await applySession(s);
  }, [applySession]);

  /** Ouvre la session renvoyée par `call` ; renvoie le message d'erreur, ou null. */
  const connect = useCallback(async (call: () => Promise<SessionState>) => {
    try {
      const s = await call();
      setRawView('');
      setUiState(u => ({ ...INITIAL_UI, horizon: u.horizon }));
      await applySession(s);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [applySession]);
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

  const logout = useCallback(async () => {
    setDialog(null);
    const s = await api.logout();
    setRawView('');
    await applySession(s);
  }, [applySession]);

  const refresh = useCallback(() => loadData(session), [loadData, session]);

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

  const value: Store = {
    session, data, loading, view, go, ui: effectiveUi, setUi, dialog, openDialog: setDialog, closeDialog: () => setDialog(null),
    toast, notify, run, runIntent, switchMode, loginDemo, login, changerMotDePasse, logout, refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
