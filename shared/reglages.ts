// Réglages de Cursus (écran Paramètres) : table « champ → contrôle », une ligne par champ de `Settings`
// (shared/types.ts) avec sa valeur par défaut et son contrôle. `parametres.maj` (server/src/actions/parametres.ts)
// n'enregistre que les champs de cette table, chacun passé par son contrôle ; DEFAULT_SETTINGS (server/src/dataset.ts)
// en est tiré. Ajouter un réglage : docs/ARCHITECTURE.md, « Cadre commun du lot 4 ».
import type { Settings } from './types.ts';

/** Jours de l'année (« MM-JJ ») à partir desquels les RTT de l'année suivante peuvent être posés ; vide : sans restriction. */
export const RTT_ANNEE_SUIVANTE_DES = ['', '09-01', '10-01', '11-01', '12-01'] as const;

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

/**
 * Texte court sur une ligne (référence d'un accord…), espaces réduits ; au-delà de `max` caractères, refus. Transmis à
 * toute personne connectée : jamais de donnée personnelle. Le journal n'en garde que le fait qu'il soit renseigné
 * (`masques` de la règle de parametres.maj, server/src/journal.ts).
 */
export const texte = (max: number, libelle: string) => (v: unknown): string => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length > max) throw new ReglageInvalide(`${libelle} : ${max} caractères au plus`);
  return t;
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
  // — Matricules de paie (parametres/MatriculesPaie.tsx) : Keystone garde le matricule Cursus (contrat de l'API v1) —
  identifiantKeystone: { defaut: 'cursus', controle: choix(['cursus', 'paie']) },
  // — Congés et clôtures (parametres/Conges.tsx) : aucune perte d'office, le RH décide ligne par ligne —
  politiqueReportCp: { defaut: 'cas_par_cas', controle: choix(['cas_par_cas', 'proposer_report']) },
  rttAnneeSuivanteDes: { defaut: '', controle: choix<string>(RTT_ANNEE_SUIVANTE_DES) },
  // — Paie (parametres/ReglagesPaie.tsx, shared/rules/paie.ts) : heures supplémentaires payées par défaut ; repos seulement
  // avec la référence de l'accord (COHERENCE) ; semaine à cheval sur le mois de son dimanche ; clôture le dernier jour (0) —
  heuresSupMode: { defaut: 'paiement', controle: choix(['paiement', 'repos']) },
  heuresSupAccord: { defaut: '', controle: texte(120, 'Référence de l’accord') },
  periodeRattachement: { defaut: 'dimanche', controle: choix(['dimanche', 'vendredi', 'jour']) },
  clotureJour: { defaut: 0, controle: entier(0, 28) },
};

/**
 * Contrôles qui portent sur plusieurs champs, appliqués aux réglages complets après ceux de chaque champ : un message
 * refuse toute la modification (ReglageInvalide, 400). Une ligne par règle, avec le groupe de sa section.
 */
export const COHERENCE: readonly ((s: Settings) => string | null)[] = [
  // — Paie : le repos de remplacement des heures supplémentaires suppose un accord collectif (art. L3121-33) ou, sans
  // délégué syndical, l'absence d'opposition du CSE (art. L3121-37) —
  s => (s.heuresSupMode === 'repos' && !s.heuresSupAccord
    ? 'Heures supplémentaires remplacées par un repos : indiquez la référence de l’accord collectif qui le prévoit (art. L3121-33) ou, sans délégué syndical, de la décision non contestée par le CSE (art. L3121-37)' : null),
];

/** Vue non typée de la table, pour la parcourir (les contrôles reçoivent la valeur en vigueur du même champ). */
type Table = Record<string, { defaut: unknown; controle?: (v: unknown, actuelle: never) => unknown }>;

/** Réglages par défaut : la valeur `defaut` de chaque ligne. */
export function reglagesParDefaut(table: Table = REGLAGES): Settings {
  return Object.fromEntries(Object.entries(table).map(([k, r]) => [k, r.defaut])) as unknown as Settings;
}

/**
 * Réglages après une modification : chaque champ présent dans `p` et doté d'un contrôle y passe, avec sa valeur en
 * vigueur ; les autres clés (`silent`, champ inconnu ou sans contrôle) sont ignorées. ReglageInvalide si un contrôle refuse,
 * ou si le résultat ne respecte pas une règle de COHERENCE.
 */
export function appliquerReglages(actuels: Settings, p: Record<string, unknown>, table: Table = REGLAGES, coherence = COHERENCE): Settings {
  const cur = actuels as unknown as Record<string, unknown>, next = { ...cur };
  for (const [k, r] of Object.entries(table)) {
    if (p[k] !== undefined && r.controle) next[k] = r.controle(p[k], cur[k] as never);
  }
  for (const c of coherence) {
    const refus = c(next as unknown as Settings);
    if (refus) throw new ReglageInvalide(refus);
  }
  return next as unknown as Settings;
}
