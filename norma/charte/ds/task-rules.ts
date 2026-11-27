// Règles pures de « Mes tâches » et « Mes approbations » (Norma 2.4, charte/COQUE.md § 2 bis, contrat
// contrats/taches-v1.md). Sans import : testées par test/taches.test.mjs (Node retire les types). Aucune date figée :
// le jour (`today`, AAAA-MM-JJ) vient toujours de l'horloge métier de l'outil.

/** Columns of `<outil>.pub_taches` v1, in order (contrats/taches-v1.md § 2). A published column is never removed or renamed. */
export const PUB_TACHES_COLUMNS = [
  'outil', 'tache_id', 'nature', 'type', 'type_libelle', 'type_libelle_en', 'objet_ref', 'titre', 'personne_id',
  'pour_le_compte_de', 'etat', 'resultat', 'echeance', 'priorite', 'actions', 'decision_a_distance', 'sensible',
  'projet', 'site', 'filiale', 'lien', 'version', 'cree_le', 'maj_le',
] as const;

export type TaskNature = 'tache' | 'approbation';
/** States of a task: the four Kanban columns, plus `annulee` (never shown in the board). */
export type TaskState = 'a_faire' | 'en_cours' | 'en_attente' | 'faite' | 'annulee';
export type TaskResult = 'approuvee' | 'refusee' | null;
export type TaskPriority = 'normale' | 'haute';
/** Actions an owner tool may open on a row (`actions`); the transitions move a task between Kanban columns. */
export type TaskAction = 'ouvrir' | 'commenter' | 'approuver' | 'refuser' | 'demarrer' | 'suspendre' | 'reprendre' | 'terminer';

export const TASK_NATURES: readonly TaskNature[] = ['tache', 'approbation'];
export const TASK_STATES: readonly TaskState[] = ['a_faire', 'en_cours', 'en_attente', 'faite', 'annulee'];
export const TASK_ACTIONS: readonly TaskAction[] = ['ouvrir', 'commenter', 'approuver', 'refuser', 'demarrer', 'suspendre', 'reprendre', 'terminer'];
/** Kanban columns, left to right (Teams / Planner board). */
export const KANBAN_COLUMNS: readonly TaskState[] = ['a_faire', 'en_cours', 'en_attente', 'faite'];
/** Views of « Mes tâches » (`?vue=`), in the order of the segmented control. */
export const TASK_VIEWS = ['liste', 'kanban', 'calendrier'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
export const DEFAULT_TASK_VIEW: TaskView = 'liste';

/** One row of `pub_taches` (own tool) or `matrix.pub_taches` (whole suite), as the tool reads it. */
export interface TaskRow {
  outil: string;
  tache_id: string;
  nature: TaskNature;
  type: string;
  type_libelle: string;
  type_libelle_en?: string | null;
  objet_ref?: string | null;
  titre: string;
  personne_id: string;
  pour_le_compte_de?: string | null;
  etat: TaskState;
  resultat?: TaskResult;
  /** AAAA-MM-JJ or null. */
  echeance?: string | null;
  priorite: TaskPriority;
  actions: readonly TaskAction[];
  decision_a_distance: boolean;
  sensible: boolean;
  projet?: string | null;
  site?: string | null;
  filiale?: string | null;
  lien: string;
  version: string;
  cree_le?: string;
  maj_le: string;
}

/** Target column of each transition action. */
export const TRANSITIONS: Readonly<Partial<Record<TaskAction, TaskState>>> = {
  demarrer: 'en_cours', suspendre: 'en_attente', reprendre: 'en_cours', terminer: 'faite',
};

/** Shape of a row: problems in French (empty = valid). Used by the tools' tests on their reference query and by Matrix. */
export function rowProblems(r: Partial<TaskRow>): string[] {
  const p: string[] = [];
  for (const c of ['outil', 'tache_id', 'type', 'type_libelle', 'titre', 'personne_id', 'lien', 'version', 'maj_le'] as const)
    if (typeof r[c] !== 'string' || !(r[c] as string).trim()) p.push(`${c} vide`);
  if (!TASK_NATURES.includes(r.nature as TaskNature)) p.push('nature hors domaine');
  if (!TASK_STATES.includes(r.etat as TaskState)) p.push('etat hors domaine');
  if (r.priorite !== 'normale' && r.priorite !== 'haute') p.push('priorite hors domaine');
  if (!Array.isArray(r.actions) || !r.actions.every((a) => TASK_ACTIONS.includes(a))) p.push('actions hors domaine');
  if (r.echeance != null && !/^\d{4}-\d{2}-\d{2}$/.test(r.echeance)) p.push('echeance : AAAA-MM-JJ');
  if (r.resultat != null && r.resultat !== 'approuvee' && r.resultat !== 'refusee') p.push('resultat hors domaine');
  if (r.resultat != null && r.nature !== 'approbation') p.push('resultat réservé aux approbations');
  if (r.resultat != null && r.etat !== 'faite') p.push('resultat sans etat faite');
  if (typeof r.lien === 'string' && !/^https?:\/\//.test(r.lien)) p.push('lien : adresse absolue');
  if (r.sensible === true && r.decision_a_distance === true) p.push('une tâche sensible ne se décide pas à distance');
  return p;
}

/** One task per (outil, tache_id), the most recently updated kept — a task is counted once wherever it is seen. */
export function dedupe<T extends Pick<TaskRow, 'outil' | 'tache_id' | 'maj_le'>>(rows: readonly T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.outil}\u0000${r.tache_id}`;
    const cur = m.get(k);
    if (!cur || cur.maj_le < r.maj_le) m.set(k, r);
  }
  return [...m.values()];
}

export const isOpen = (r: Pick<TaskRow, 'etat'>) => r.etat !== 'faite' && r.etat !== 'annulee';
/** Late: open with a due date before today (computed on read, never stored). */
export const isLate = (r: Pick<TaskRow, 'etat' | 'echeance'>, today: string) => isOpen(r) && !!r.echeance && r.echeance < today;

// ── Dates (AAAA-MM-JJ, calcul en UTC pour ne dépendre d'aucun fuseau) ──────────────────────────────────────────────
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
/** Monday of the ISO week holding `iso`. */
export const mondayOf = (iso: string) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

export type DueBucket = 'retard' | 'aujourdhui' | 'semaine' | 'plus_tard' | 'sans_echeance' | 'terminee';
/** Groups of the list view, in order (Planner: late, today, this week, later, no date, done). */
export const DUE_BUCKETS: readonly DueBucket[] = ['retard', 'aujourdhui', 'semaine', 'plus_tard', 'sans_echeance', 'terminee'];

export function dueBucket(r: Pick<TaskRow, 'etat' | 'echeance'>, today: string): DueBucket {
  if (!isOpen(r)) return 'terminee';
  if (!r.echeance) return 'sans_echeance';
  if (r.echeance < today) return 'retard';
  if (r.echeance === today) return 'aujourdhui';
  return r.echeance <= addDays(mondayOf(today), 6) ? 'semaine' : 'plus_tard';
}

export type GroupBy = 'echeance' | 'outil' | 'etat' | 'type';
export type SortKey = 'echeance' | 'titre' | 'outil' | 'etat' | 'priorite';
export type SortDir = 'asc' | 'desc';

const STATE_RANK = Object.fromEntries(TASK_STATES.map((s, i) => [s, i])) as Record<TaskState, number>;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Stable sort; without a due date a task goes last whatever the direction (Planner). Ties: due date, then id. */
export function sortTasks<T extends TaskRow>(rows: readonly T[], key: SortKey = 'echeance', dir: SortDir = 'asc'): T[] {
  const s = dir === 'asc' ? 1 : -1;
  const val = (r: T): string => {
    switch (key) {
      case 'echeance': return r.echeance ?? '';
      case 'titre': return r.titre.toLocaleLowerCase('fr');
      case 'outil': return r.outil;
      case 'etat': return String(STATE_RANK[r.etat]);
      case 'priorite': return r.priorite === 'haute' ? '0' : '1';
    }
  };
  return [...rows].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (key === 'echeance' && va !== vb && (!va || !vb)) return va ? -1 : 1;
    if (va !== vb) return s * cmp(va, vb);
    return cmp(a.echeance ?? '9999', b.echeance ?? '9999') || cmp(`${a.outil}:${a.tache_id}`, `${b.outil}:${b.tache_id}`);
  });
}

/** Groups for the list view; empty groups are left out, order fixed (due buckets, Kanban columns, or by name). */
export function groupTasks<T extends TaskRow>(rows: readonly T[], by: GroupBy, today: string): { key: string; items: T[] }[] {
  const keyOf = (r: T) => (by === 'echeance' ? dueBucket(r, today) : by === 'outil' ? r.outil : by === 'etat' ? r.etat : r.type);
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = keyOf(r); m.set(k, [...(m.get(k) ?? []), r]); }
  const order = by === 'echeance' ? [...DUE_BUCKETS] : by === 'etat' ? [...TASK_STATES] : [...m.keys()].sort();
  return order.filter((k) => m.has(k)).map((key) => ({ key, items: m.get(key)! }));
}

/** Kanban columns with their cards (cancelled tasks are left out). */
export function kanban<T extends TaskRow>(rows: readonly T[]): { state: TaskState; items: T[] }[] {
  return KANBAN_COLUMNS.map((state) => ({ state, items: sortTasks(rows.filter((r) => r.etat === state)) }));
}

export interface DecideContext {
  /** Code of the tool showing the page. */
  tool: string;
  /** Phase 2 enabled in this tool (identity token exchange through Clavis, contrats/taches-v1.md § 5). */
  remote?: boolean;
}

/** May the tool act on this row here? Its own rows always (it decides locally, with its own checks); another tool's
 *  only when the row says so (`decision_a_distance`) and phase 2 is on. Never a sensitive row. */
export const canActHere = (r: Pick<TaskRow, 'outil' | 'decision_a_distance' | 'sensible'>, ctx: DecideContext) =>
  r.outil === ctx.tool || (!r.sensible && r.decision_a_distance && ctx.remote === true);

/** Kanban move allowed: an open action of the row leads to that column, and the tool may act on the row. */
export function moveAction(r: TaskRow, to: TaskState, ctx: DecideContext): TaskAction | null {
  if (r.etat === to || !canActHere(r, ctx)) return null;
  const a = r.actions.find((x) => TRANSITIONS[x] === to);
  return a ?? null;
}

/** Decision buttons of an approval (approve / refuse), empty when it must be opened in its own tool. */
export function decisionsHere(r: TaskRow, ctx: DecideContext): ('approuver' | 'refuser')[] {
  if (r.nature !== 'approbation' || !isOpen(r) || !canActHere(r, ctx)) return [];
  return (['approuver', 'refuser'] as const).filter((a) => r.actions.includes(a));
}

/** Title shown outside the owner tool: a sensitive row keeps only its type (contrats/taches-v1.md § 3). */
export const shownTitle = (r: Pick<TaskRow, 'outil' | 'sensible' | 'titre' | 'type_libelle'>, tool: string) =>
  r.sensible && r.outil !== tool ? r.type_libelle : r.titre;

export type DueFilter = 'tout' | 'retard' | 'semaine' | 'sans_echeance';
export interface ApprovalFilter { outil?: string | null; type?: string | null; due?: DueFilter }

/** Approvals list: open approvals (and those decided within `recentDays`, « décidé cette semaine »), filtered. */
export function filterApprovals<T extends TaskRow>(rows: readonly T[], f: ApprovalFilter, today: string, recentDays = 7): T[] {
  const since = addDays(today, -recentDays);
  return sortTasks(rows.filter((r) => {
    if (r.nature !== 'approbation' || r.etat === 'annulee') return false;
    if (!isOpen(r) && r.maj_le.slice(0, 10) < since) return false;
    if (f.outil && r.outil !== f.outil) return false;
    if (f.type && `${r.outil}:${r.type}` !== f.type) return false;
    const b = dueBucket(r, today);
    if (f.due === 'retard') return b === 'retard';
    if (f.due === 'semaine') return b === 'retard' || b === 'aujourdhui' || b === 'semaine';
    if (f.due === 'sans_echeance') return b === 'sans_echeance';
    return true;
  }));
}

/** Distinct values for the filters, in a stable order. */
export const toolsOf = (rows: readonly Pick<TaskRow, 'outil'>[]) => [...new Set(rows.map((r) => r.outil))].sort();
export const typesOf = (rows: readonly Pick<TaskRow, 'outil' | 'type' | 'type_libelle'>[]) => {
  const m = new Map<string, string>();
  for (const r of rows) m.set(`${r.outil}:${r.type}`, r.type_libelle);
  return [...m.entries()].sort((a, b) => cmp(a[1], b[1])).map(([value, label]) => ({ value, label }));
};

/** Badge counts of the base entries: open tasks and open approvals of the person, each counted once. */
export function baseCounts(rows: readonly TaskRow[]): { tasks: number; approvals: number } {
  const open = dedupe(rows).filter(isOpen);
  return { tasks: open.filter((r) => r.nature === 'tache').length, approvals: open.filter((r) => r.nature === 'approbation').length };
}

// ── Calendrier ─────────────────────────────────────────────────────────────────────────────────────────────────
export type CalendarMode = 'mois' | 'semaine';

/** Weeks of the month holding `iso` (Monday first, full weeks: days of the next / previous month included). */
export function monthWeeks(iso: string): string[][] {
  const first = `${iso.slice(0, 7)}-01`;
  const nextMonth = toDate(first); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const last = addDays(toIso(nextMonth), -1);
  const weeks: string[][] = [];
  for (let d = mondayOf(first); d <= last; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

/** The seven days of the week holding `iso`. */
export const weekDays = (iso: string) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(iso), i));

/** Tasks per due day (tasks without a due date are not in the calendar). */
export function byDay<T extends Pick<TaskRow, 'echeance' | 'etat'>>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) if (r.echeance && r.etat !== 'annulee') m.set(r.echeance, [...(m.get(r.echeance) ?? []), r]);
  return m;
}

/** Previous / next period of the calendar. */
export function shiftPeriod(iso: string, mode: CalendarMode, step: -1 | 1): string {
  if (mode === 'semaine') return addDays(mondayOf(iso), 7 * step);
  const d = toDate(`${iso.slice(0, 7)}-01`); d.setUTCMonth(d.getUTCMonth() + step);
  return toIso(d);
}
