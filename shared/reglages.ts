// Réglages de Cursus (écran Paramètres) : table « champ → contrôle », une ligne par champ de `Settings`
// (shared/types.ts) avec sa valeur par défaut et son contrôle. `parametres.maj` (server/src/actions/parametres.ts)
// n'enregistre que les champs de cette table, chacun passé par son contrôle ; DEFAULT_SETTINGS (server/src/dataset.ts)
// en est tiré. Ajouter un réglage : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
import { isValidDate } from './dates.ts';
import { CONTRATS_EXCLUABLES, PREAVIS_TOUTE_ANNEE } from './rules/campagne.ts';
import type { Settings } from './types.ts';

/** Saisie refusée par un contrôle : `parametres.maj` répond 400 avec ce message et n'enregistre rien. */
export class ReglageInvalide extends Error {}

export interface Reglage<T> {
  /** Valeur tant que l'administrateur RH ne l'a pas modifiée (base neuve, ou réglage apparu depuis). */
  defaut: T;
  /**
   * Valeur reçue → valeur enregistrée (bornée, arrondie, ramenée à la liste…) ; `actuelle` : valeur en vigueur, gardée
   * pour une saisie inexploitable. Lever ReglageInvalide refuse toute la modification. Absent : réglage que
   * `parametres.maj` ne modifie pas (ignoré s'il est envoyé).
   */
  controle?: (v: unknown, actuelle: T) => T;
}

// — Contrôles courants —

/** Nombre entier borné, arrondi au pas ; une valeur non numérique garde la valeur en vigueur. */
export const entier = (min: number, max: number, pas = 1) => (v: unknown, actuelle: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n / pas) * pas)) : actuelle;
};

/** Case à cocher. */
export const booleen = (v: unknown): boolean => !!v;

/** Valeur d'une liste fermée ; hors de la liste, `sinon`, à défaut la valeur en vigueur. */
export const choix = <T extends string>(valeurs: readonly T[], sinon?: T) => (v: unknown, actuelle: T): T =>
  (valeurs as readonly unknown[]).includes(v) ? v as T : sinon ?? actuelle;

/** Valeurs cochées d'une liste fermée : inconnues écartées, sans doublon, dans l'ordre de la liste ; autre chose qu'une liste : refus. */
export const parmi = <T extends string>(valeurs: readonly T[]) => (v: unknown): T[] => {
  if (!Array.isArray(v)) throw new ReglageInvalide('Liste de valeurs attendue');
  return valeurs.filter(x => v.includes(x));
};

/** Jour de l'année « MM-JJ » qui existe chaque année (le 29 février est refusé). */
export const jourDeLAnnee = (v: unknown): string => {
  if (typeof v === 'string' && /^\d{2}-\d{2}$/.test(v) && isValidDate(`2027-${v}`)) return v;
  throw new ReglageInvalide('Date invalide : un jour et un mois qui existent chaque année');
};

/**
 * Table des réglages, groupée par section de Paramètres (client/src/pages/parametres/) : un champ de Settings sans sa
 * ligne ici est une erreur de compilation. Chaque valeur enregistrée est tracée dans le journal (anciennes et nouvelles
 * valeurs) : codes, nombres, dates et cases à cocher seulement, jamais de texte libre.
 */
export const REGLAGES: { [K in keyof Settings]-?: Reglage<Settings[K]> } = {
  // — Règles de suivi (parametres/Suivi.tsx) —
  horizonAlerte: { defaut: 90, controle: entier(30, 180, 30) },
  uniquementReglementaire: { defaut: false, controle: booleen },
  seuilBudget: { defaut: 85, controle: entier(60, 100, 5) },
  // — Intégration Keystone (parametres/Keystone.tsx) : tout autre choix que le partage détaillé vaut minimal —
  partageKeystone: { defaut: 'minimal', controle: choix(['minimal', 'detaille'], 'minimal') },
  // — Congés : RTT des contrats 39 h, réglé depuis l'écran Absences (pages/Absences.tsx) —
  rtt39: { defaut: 23, controle: entier(0, 40) },
  // — Écran d'accueil de l'espace RH : pas de contrôle, non modifiable depuis l'écran —
  vueInitiale: { defaut: 'dashboard' },
  // — Campagne d'entretiens annuels (parametres/Entretiens.tsx, shared/rules/campagne.ts) : par défaut du 1er octobre au
  //   15 décembre, sans ancienneté minimale, seul l'intérim exclu, échéance affichée toute l'année —
  campagneDebut: { defaut: '10-01', controle: jourDeLAnnee },
  campagneFin: { defaut: '12-15', controle: jourDeLAnnee },
  campagneAncienneteMois: { defaut: 0, controle: entier(0, 24) },
  campagneExclus: { defaut: [], controle: parmi(CONTRATS_EXCLUABLES) },
  campagnePreavisJours: { defaut: PREAVIS_TOUTE_ANNEE, controle: entier(0, PREAVIS_TOUTE_ANNEE) },
};

/**
 * Contrôles qui portent sur plusieurs champs, après celui de chaque champ (réglages qui vont ensemble) : lever
 * ReglageInvalide refuse toute la modification. Une ligne par contrôle.
 */
export const COHERENCES: readonly ((s: Settings) => void)[] = [
  // Campagne d'entretiens : dans l'année civile, l'ouverture au plus tard le jour de la clôture.
  s => { if (s.campagneDebut > s.campagneFin) throw new ReglageInvalide('Campagne d’entretiens : l’ouverture doit précéder la clôture, dans la même année'); },
];

/** Vue non typée de la table, pour la parcourir (les contrôles reçoivent la valeur en vigueur du même champ). */
type Table = Record<string, { defaut: unknown; controle?: (v: unknown, actuelle: never) => unknown }>;

/** Réglages par défaut : la valeur `defaut` de chaque ligne. */
export function reglagesParDefaut(table: Table = REGLAGES): Settings {
  return Object.fromEntries(Object.entries(table).map(([k, r]) => [k, r.defaut])) as unknown as Settings;
}

/**
 * Réglages après une modification : chaque champ présent dans `p` et doté d'un contrôle y passe, avec sa valeur en
 * vigueur ; les autres clés (`silent`, champ inconnu ou sans contrôle) sont ignorées. ReglageInvalide si un contrôle refuse (champ, ou cohérence de plusieurs champs : COHERENCES).
 */
export function appliquerReglages(actuels: Settings, p: Record<string, unknown>, table: Table = REGLAGES): Settings {
  const cur = actuels as unknown as Record<string, unknown>, next = { ...cur };
  for (const [k, r] of Object.entries(table)) {
    if (p[k] !== undefined && r.controle) next[k] = r.controle(p[k], cur[k] as never);
  }
  for (const c of COHERENCES) c(next as unknown as Settings);
  return next as unknown as Settings;
}
