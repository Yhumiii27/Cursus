// Tronc commun des menus (Norma 2.4, charte/COQUE.md § 2 bis) — décision du propriétaire du 27 novembre 2026 :
// « Accueil ; Mes tâches (liste, kanban, calendrier, comme Teams) ; Mes approbations » dans tous les outils, chaque accueil
// typé selon l'outil, puis un ou deux menus propres au métier. Modèle pur, sans import d'exécution : testé par
// test/taches.test.mjs ; rendu par `BaseNav` (./BaseNav.tsx). Les icônes sont des noms Phosphor, les libellés des sources
// anglaises (traduites par l'outil, entrées françaises dans ./taches-fr.ts).
import type { ToolCode } from './ToolLogo';

export type BaseEntryId = 'home' | 'tasks' | 'approvals';
/** Phosphor icons of the common block (component names of `@phosphor-icons/react`). */
export type BaseIcon =
  | 'House' | 'CheckSquare' | 'Stamp' | 'FolderUser' | 'Gauge' | 'Books' | 'FileText' | 'Siren' | 'ListChecks' | 'Clock'
  | 'CalendarX' | 'SquaresFour' | 'CalendarDots' | 'Flask' | 'TreeStructure' | 'Key' | 'Database' | 'FlowArrow' | 'Handshake'
  | 'Cube' | 'Truck' | 'PaperPlaneTilt' | 'Gear';

export interface BaseEntryDef {
  id: string;
  /** English source string (`t(label)`); its French is in ./taches-fr.ts. */
  label: string;
  fr: string;
  icon: BaseIcon;
  /** Advised path; a tool keeps its current one if it differs (it passes it in `paths`). */
  path: string;
}

/** The three common entries, always first, in this order, in every tool (minimum required by the owner). */
export const BASE_ENTRIES: readonly (BaseEntryDef & { id: BaseEntryId })[] = [
  { id: 'home', label: 'Home', fr: 'Accueil', icon: 'House', path: '/' },
  { id: 'tasks', label: 'My tasks', fr: 'Mes tâches', icon: 'CheckSquare', path: '/my/tasks' },
  { id: 'approvals', label: 'My approvals', fr: 'Mes approbations', icon: 'Stamp', path: '/my/approvals' },
];

/** Names of the tools (proper nouns, never translated), as in registre/outils.json. */
export const TOOL_NAMES: Readonly<Record<ToolCode, string>> = {
  keystone: 'Keystone', codex: 'Codex', vigie: 'Vigie', cursus: 'Cursus', arche: 'Arche', crucible: 'Crucible',
  clavis: 'Clavis', matrix: 'Matrix', modulus: 'Modulus', vector: 'Vector', ingenium: 'Ingenium',
};

/** At most two business entries after the common three (« un ou deux menus »). */
export const MAX_TOOL_ENTRIES = 2;

export interface ToolBase {
  /** What the tool's home shows (French, COQUE.md § 2 bis.2): the home is typed per tool. */
  home: string;
  /** One or two base entries proper to the business, after « Mes approbations ». */
  extras: readonly BaseEntryDef[];
}

/** Per tool: typed home and its one or two base business entries (choice of 27 Nov 2026, justified in COQUE.md § 2 bis.3). */
export const TOOL_BASE: Readonly<Record<ToolCode, ToolBase>> = {
  keystone: {
    home: 'Mes projets en cours (avancement, alertes, prochain jalon), tâches du jour, approbations en attente, activité récente.',
    extras: [
      { id: 'myprojects', label: 'My projects', fr: 'Mes projets', icon: 'FolderUser', path: '/my/projects' },
      { id: 'dashboards', label: 'My dashboards', fr: 'Mes tableaux de bord', icon: 'Gauge', path: '/my/dashboards' },
    ],
  },
  codex: {
    home: 'Documents récents et à réviser, circuits où je suis valideur, échéances de revue et de conservation, recherche documentaire.',
    extras: [
      { id: 'documents', label: 'Documents', fr: 'Documents', icon: 'Books', path: '/documents' },
      { id: 'mydocuments', label: 'My documents', fr: 'Mes documents', icon: 'FileText', path: '/mes-documents' },
    ],
  },
  vigie: {
    home: 'Tableau de bord QHSE du site choisi : TF1 / TG, jours sans accident, événements récents, actions en retard, échéances de contrôles et d’habilitations.',
    extras: [
      { id: 'events', label: 'Events', fr: 'Événements', icon: 'Siren', path: '/evenements' },
      { id: 'actions', label: 'Action plan', fr: 'Plan d’actions', icon: 'ListChecks', path: '/actions' },
    ],
  },
  cursus: {
    home: 'Mon espace RH : soldes de congés, feuille de temps de la semaine, formations et habilitations à échéance, demandes en cours ; pour un manager, son équipe.',
    extras: [
      { id: 'mytime', label: 'My time', fr: 'Mes temps', icon: 'Clock', path: '/temps' },
      { id: 'myleave', label: 'My leave', fr: 'Mes absences', icon: 'CalendarX', path: '/absences' },
    ],
  },
  arche: {
    home: 'Mes CAPEX (phase DIG-PRODI, prochain jalon, budget et réalisé), jalons G1 / G2 / G3 à venir, alertes du portefeuille.',
    extras: [
      { id: 'mycapex', label: 'My CAPEX', fr: 'Mes CAPEX', icon: 'FolderUser', path: '/my/capex' },
      { id: 'portfolio', label: 'Portfolio', fr: 'Portefeuille', icon: 'SquaresFour', path: '/portfolio' },
    ],
  },
  crucible: {
    home: 'Occupation des moyens d’essais de la semaine, mes réservations, conflits et incidents ouverts.',
    extras: [
      { id: 'planning', label: 'Test planning', fr: 'Planning des moyens', icon: 'CalendarDots', path: '/planning' },
      { id: 'myneeds', label: 'My test needs', fr: 'Mes besoins d’essais', icon: 'Flask', path: '/my/needs' },
    ],
  },
  clavis: {
    home: 'Pour chacun : mes accès et mes demandes ; pour la DSI : comptes à activer, demandes d’accès, revues et écarts.',
    extras: [
      { id: 'directory', label: 'Directory', fr: 'Annuaire', icon: 'TreeStructure', path: '/directory' },
      { id: 'myaccess', label: 'My access', fr: 'Mes accès', icon: 'Key', path: '/account/access' },
    ],
  },
  matrix: {
    home: 'État du serveur commun : outils et publications, publications à appliquer, liens demandés, journal unifié récent.',
    extras: [
      { id: 'publications', label: 'Publications', fr: 'Publications', icon: 'Database', path: '/publications' },
      { id: 'links', label: 'Links between tools', fr: 'Liens entre outils', icon: 'FlowArrow', path: '/liens' },
    ],
  },
  modulus: {
    home: 'Mes affaires (étape, offre en cours, échéance), offres à revoir, dernières publications du catalogue et des prix.',
    extras: [
      { id: 'mydeals', label: 'My deals', fr: 'Mes affaires', icon: 'Handshake', path: '/my/deals' },
      { id: 'catalogue', label: 'Catalogue', fr: 'Catalogue', icon: 'Cube', path: '/catalogue' },
    ],
  },
  vector: {
    home: 'Expéditions en cours (prochaine étape, ETA, retard), demandes à trier, documents manquants, incidents ouverts.',
    extras: [
      { id: 'myshipments', label: 'My shipments', fr: 'Mes expéditions', icon: 'Truck', path: '/my/shipments' },
      { id: 'requests', label: 'Shipment requests', fr: 'Demandes d’expédition', icon: 'PaperPlaneTilt', path: '/requests' },
    ],
  },
  ingenium: {
    home: 'Ma discipline : entrées attendues bloquantes, livrables à diffuser cette semaine, contrôles de cohérence ouverts, repères P&ID non rattachés, articles à valider ; par projet de l’équipe, avancement des livrables, couverture P&ID et pack ingénierie.',
    extras: [
      { id: 'myprojects', label: 'My projects', fr: 'Mes projets', icon: 'FolderUser', path: '/my/projects' },
      { id: 'reference', label: 'Technical reference', fr: 'Référentiel technique', icon: 'Gear', path: '/reference' },
    ],
  },
};

export interface BaseNavItem extends BaseEntryDef {
  href: string;
  /** Common entry (true) or business entry of the tool (false). */
  common: boolean;
  badge?: number;
}

export interface BaseNavOptions {
  /** Paths kept by the tool when they differ from the advised ones (`{ tasks: '/a-faire' }`). */
  paths?: Partial<Record<string, string>>;
  /** Badge counts: open tasks and approvals of the person in the whole suite (`baseCounts` of ./task-rules). */
  counts?: Partial<Record<string, number>>;
  /** Business entries the viewer may not open are left out (rights stay the tool's). The common three always show. */
  hidden?: readonly string[];
}

/** The common block of the sidebar for a tool: Home, My tasks, My approvals, then its one or two business entries. */
export function baseNav(tool: ToolCode, opts: BaseNavOptions = {}): BaseNavItem[] {
  const base = TOOL_BASE[tool];
  if (!base) throw new Error(`base-nav : outil inconnu « ${tool} »`);
  const hide = new Set(opts.hidden ?? []);
  const item = (e: BaseEntryDef, common: boolean): BaseNavItem => {
    const n = opts.counts?.[e.id];
    return { ...e, common, href: opts.paths?.[e.id] ?? e.path, ...(n ? { badge: n } : {}) };
  };
  return [...BASE_ENTRIES.map((e) => item(e, true)), ...base.extras.filter((e) => !hide.has(e.id)).map((e) => item(e, false))];
}

/** Active entry for a pathname: exact match for Home, longest prefix for the others. */
export function activeEntry(items: readonly Pick<BaseNavItem, 'id' | 'href'>[], pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const it of items) {
    const h = it.href.replace(/\/$/, '') || '/';
    const hit = h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`);
    if (hit && (!best || h.length > best.len)) best = { id: it.id, len: h.length };
  }
  return best?.id ?? null;
}

/** Contract check of a tool's block (for its own tests): the three common entries first and in order, then at most two. */
export function baseNavProblems(items: readonly Pick<BaseNavItem, 'id' | 'common'>[]): string[] {
  const p: string[] = [];
  BASE_ENTRIES.forEach((e, i) => { if (items[i]?.id !== e.id) p.push(`entrée ${i + 1} : « ${e.fr} » attendue`); });
  const extras = items.slice(BASE_ENTRIES.length);
  if (extras.some((e) => e.common)) p.push('une entrée commune hors des trois premières');
  if (extras.length > MAX_TOOL_ENTRIES) p.push(`au plus ${MAX_TOOL_ENTRIES} entrées propres à l’outil`);
  if (new Set(items.map((e) => e.id)).size !== items.length) p.push('entrée en double');
  return p;
}
