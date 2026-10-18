// Paie : période de paie d'une semaine (rattachement d'une semaine à cheval sur deux mois, clôture des variables,
// rappel d'une période close), correspondance des rubriques internes avec le plan de paie Sage (table `rubriquesPaie`,
// action `paie.rubrique`), mode de transmission et mode des heures supplémentaires (payées ou remplacées par un repos).
// Partagé par la transmission (server/src/actions/temps.ts), l'écran Temps (client/src/components/LotsPaie.tsx) et
// Paramètres → Paie. Le décompte des heures et les rubriques de chaque feuille restent dans shared/rules/temps.ts.
import { RUBRIQUES_PAIE, type UniteRubrique } from '../constants.ts';
import { addD, addM, parse } from '../dates.ts';
import { r1 } from '../format.ts';
import type { FeuilleTemps, ISODate, ModeHeuresSupFige, RattachementPeriode, RubriquePaie, SageMode, Settings } from '../types.ts';

// — Modes —

/** Transmission à Sage Paie (variable SAGE_MODE, server/src/integrations/sage.ts) : pas d'envoi par API. */
export const MODES_SAGE: Record<SageMode, { label: string; aide: string }> = {
  simulation: {
    label: 'Simulation',
    aide: 'Rien n’est envoyé à Sage Paie : les feuilles sont seulement marquées transmises, en un clic ou par un lot dont le fichier se télécharge pour essai (démonstration, essais).',
  },
  fichier: {
    label: 'Fichier d’import',
    aide: 'Mode de production : la paie génère le lot de chaque période de paie, télécharge son fichier d’import et l’importe dans Sage, puis confirme l’import, qui seul marque les feuilles transmises. Avant cette confirmation, le lot peut être annulé.',
  },
};

/** Mode des heures supplémentaires (réglage `heuresSupMode`, figé sur chaque feuille à sa validation). */
export const MODES_HEURES_SUP: Record<ModeHeuresSupFige, { label: string; aide: string }> = {
  paiement: {
    label: 'Payées avec majoration',
    aide: 'Heures supplémentaires payées avec leur majoration (rubriques HS25 et HS50, art. L3121-28 et L3121-36), sans repos de remplacement.',
  },
  repos: {
    label: 'Remplacées par un repos compensateur',
    aide: 'Heures supplémentaires et majoration remplacées par un repos compensateur équivalent (rubrique RCR_ACQUIS), sans paiement, comme le prévoit l’accord collectif (art. L3121-33) ou, sans délégué syndical, la décision de l’employeur à laquelle le CSE ne s’est pas opposé (art. L3121-37).',
  },
  historique: {
    label: 'Calcul d’avant le choix du mode',
    aide: 'Feuille transmise à la paie avant le choix du mode : heures supplémentaires payées et repos compensateur crédité, comme alors calculé.',
  },
};

/** Rattachement d'une semaine à cheval sur deux mois (réglage `periodeRattachement`). */
export const RATTACHEMENTS: Record<RattachementPeriode, { label: string; aide: string }> = {
  dimanche: {
    label: 'Mois du dimanche',
    aide: 'La semaine va sur le mois où elle se termine, le dimanche : les heures supplémentaires se décomptent par semaine civile (art. L3121-35).',
  },
  vendredi: {
    label: 'Mois du vendredi',
    aide: 'La semaine, samedi et dimanche compris, va sur le mois de son vendredi, dernier jour de la semaine de travail.',
  },
  jour: {
    label: 'Ventilation jour par jour',
    aide: 'Les heures de chaque jour vont sur leur mois ; les heures supplémentaires, dernières heures de la semaine, suivent le jour où elles sont faites.',
  },
};

/** Mode des heures supplémentaires d'une feuille : figé à sa validation, sinon celui du réglage (paiement par défaut). */
export function modeHeuresSup(sh: { heuresSup?: ModeHeuresSupFige | null } | null, s: Partial<Pick<Settings, 'heuresSupMode'>> | undefined): ModeHeuresSupFige {
  return sh?.heuresSup ?? s?.heuresSupMode ?? 'paiement';
}

// — Périodes de paie —

/** Période de paie (AAAA-MM) d'une date. */
export const moisDe = (s: ISODate) => s.slice(0, 7);
/** « octobre 2026 ». */
export const periodeLabel = (p: string) => parse(`${p}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const suivante = (p: string) => moisDe(addM(`${p}-01`, 1));
const dernierJour = (p: string) => addD(`${suivante(p)}-01`, -1);

/**
 * Parts d'une semaine (lundi `week`) par période de rattachement, dans l'ordre : jours de la feuille (0 = lundi …
 * 6 = dimanche, le week-end compris) et période. Une seule part, sauf pour une semaine à cheval sur deux mois ventilée
 * jour par jour : un samedi 31 octobre va en octobre, le dimanche 1er novembre en novembre.
 */
export function partsSemaine(week: ISODate, rattachement: RattachementPeriode = 'dimanche'): { periode: string; jours: number[] }[] {
  if (rattachement !== 'jour') return [{ periode: moisDe(addD(week, rattachement === 'vendredi' ? 4 : 6)), jours: [0, 1, 2, 3, 4, 5, 6] }];
  const parts: { periode: string; jours: number[] }[] = [];
  for (let i = 0; i < 7; i++) {

    const periode = moisDe(addD(week, i)), der = parts.at(-1);
    if (der?.periode === periode) der.jours.push(i);
    else parts.push({ periode, jours: [i] });
  }
  return parts;
}

/**
 * Clôture des variables d'une période : le `jour` du mois (0, ou au-delà de la fin du mois : le dernier jour). Après
 * elle, la période est close : ses variables partent en rappel sur la période ouverte.
 */
export function clotureDe(p: string, jour = 0): ISODate {
  const fin = dernierJour(p);
  return jour >= 1 && jour < Number(fin.slice(8)) ? `${p}-${String(jour).padStart(2, '0')}` : fin;
}

/** Première période encore ouverte le jour `today` : celle du mois, ou la suivante une fois sa clôture passée. */
export function periodeOuverte(today: ISODate, jour = 0): string {
  const p = moisDe(today);
  return today > clotureDe(p, jour) ? suivante(p) : p;
}

/** Part d'une feuille dans une période de paie : `origine`, période naturelle déjà close (la part part en rappel). */
export interface PartPaie { periode: string; origine: string | null; jours: number[] }

/**
 * Périodes où partent les heures d'une semaine transmise le jour `today` : période de rattachement tant qu'elle est
 * ouverte, sinon la période ouverte, avec la période d'origine (rappel).
 */
export function periodesSemaine(week: ISODate, s: Partial<Pick<Settings, 'periodeRattachement' | 'clotureJour'>> | undefined, today: ISODate): PartPaie[] {
  const ouverte = periodeOuverte(today, s?.clotureJour ?? 0);
  return partsSemaine(week, s?.periodeRattachement ?? 'dimanche')
    .map(x => (x.periode >= ouverte ? { ...x, origine: null } : { periode: ouverte, origine: x.periode, jours: x.jours }));
}

/**
 * Feuilles en attente d'une période (et d'une période d'origine, pour un rappel). `semaines` : feuilles du groupe
 * (« salarié|lundi »), pour compter une seule fois, par période, une semaine ventilée entre rappel et période ouverte.
 */
export interface GroupePaie { periode: string; origine: string | null; feuilles: number; salaries: number; semaines: string[] }

/**
 * Feuilles en attente de transmission regroupées par période de destination, les rappels à part : une semaine
 * ventilée jour par jour sur deux périodes compte dans chacune.
 */
export function feuillesParPeriode(sheets: Pick<FeuilleTemps, 'empId' | 'week'>[], s: Partial<Settings> | undefined, today: ISODate): GroupePaie[] {
  const groupes = new Map<string, { periode: string; origine: string | null; semaines: string[]; emps: Set<number> }>();
  for (const sh of sheets) {
    for (const p of periodesSemaine(sh.week, s, today)) {
      const cle = `${p.periode}|${p.origine ?? ''}`;
      const g = groupes.get(cle) ?? { periode: p.periode, origine: p.origine, semaines: [], emps: new Set<number>() };
      g.semaines.push(`${sh.empId}|${sh.week}`);
      g.emps.add(sh.empId);
      groupes.set(cle, g);
    }
  }
  return [...groupes.values()]
    .sort((a, b) => a.periode.localeCompare(b.periode) || (a.origine ?? '').localeCompare(b.origine ?? ''))
    .map(({ emps, ...g }) => ({ ...g, feuilles: g.semaines.length, salaries: emps.size }));
}

/** Feuilles distinctes par période de destination, rappels compris (une semaine ventilée n'y compte qu'une fois). */
export function feuillesDeLaPeriode(groupes: readonly Pick<GroupePaie, 'periode' | 'semaines'>[]): { periode: string; feuilles: number }[] {
  return [...new Set(groupes.map(g => g.periode))]
    .map(periode => ({ periode, feuilles: new Set(groupes.filter(g => g.periode === periode).flatMap(g => g.semaines)).size }));
}

// — Rubriques —

/** Rubrique telle qu'affichée et utilisée : correspondance enregistrée, libellé et unité du code interne. */
export interface RubriqueVue extends RubriquePaie { label: string; unite: UniteRubrique; confirmee: boolean }

/**
 * Table des rubriques : chaque code de RUBRIQUES_PAIE, avec sa correspondance enregistrée ou, à défaut, un code Sage égal
 * au code interne, active (désactivée pour une rubrique `inactiveParDefaut`) et à confirmer. Un code retiré de la liste n'est plus lu.
 */
export function rubriquesPaie(stockees: readonly RubriquePaie[] = []): RubriqueVue[] {
  return Object.entries(RUBRIQUES_PAIE).map(([code, def]) => {
    // Rubriques de sortie : désactivées tant que la paie ne les a pas activées (`inactiveParDefaut`).
    const r = stockees.find(x => x.code === code) ?? { code, codeSage: code, active: !def.inactiveParDefaut, confirmeLe: null, confirmePar: null };
    return { ...r, label: def.label, unite: def.unite, confirmee: !!r.confirmeLe };
  });
}

/**
 * Rubriques internes → codes Sage : rubriques désactivées retirées, quantités nulles omises, quantités de deux rubriques
 * portées sur le même code Sage additionnées (même unité, contrôlée par `paie.rubrique`).
 */
export function traduireRubriques(rubriques: Record<string, number>, table: readonly RubriqueVue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, q] of Object.entries(rubriques)) {
    const r = table.find(x => x.code === code);
    if (!q || (r && !r.active)) continue;
    const cible = r?.codeSage ?? code;
    out[cible] = r1((out[cible] ?? 0) + q);
  }
  return out;
}

/** Rubriques émises par des feuilles (codes internes) et exportées dont le code Sage n'est pas confirmé. */
export function rubriquesAConfirmer(emises: Iterable<string>, table: readonly RubriqueVue[]): RubriqueVue[] {
  const codes = new Set(emises);
  return table.filter(r => codes.has(r.code) && r.active && !r.confirmee);
}

/** « HN (Heures normales), HS25 (…) ». */
export const rubriquesTexte = (list: readonly Pick<RubriqueVue, 'code' | 'label'>[]) => list.map(r => `${r.code} (${r.label})`).join(', ');

/** Code Sage saisi : 1 à 20 caractères, lettres, chiffres, tiret, point ou soulignement. */
export function erreurCodeSage(v: string): string | null {
  const t = v.trim();
  if (!t) return 'Indiquez le code de la rubrique dans le plan de paie Sage.';
  return /^[A-Za-z0-9_.-]{1,20}$/.test(t) ? null : 'Code Sage : 20 caractères au plus, lettres, chiffres, tiret, point ou soulignement.';
}

/**
 * Case « Code vérifié dans le plan de paie Sage » après une saisie du code (client/src/dialogs/RubriqueDialog.tsx) :
 * décochée dès que le code saisi diffère du code enregistré, puisqu'il reste à vérifier ; rétablie telle qu'enregistrée
 * quand on revient au code enregistré.
 */
export const verifieApresSaisie = (r: Pick<RubriqueVue, 'codeSage' | 'confirmee'>, saisi: string): boolean =>
  saisi.trim() === r.codeSage ? r.confirmee : false;

/**
 * Valeur de `confirmer` envoyée à `paie.rubrique` : case cochée, nouvelle confirmation si le code change ou ne l'était
 * pas ; décochée, confirmation retirée d'un code inchangé (un code changé repasse de lui-même « à confirmer »).
 */
export function confirmationEnvoyee(r: Pick<RubriqueVue, 'codeSage' | 'confirmee'>, saisi: string, verifie: boolean): boolean | undefined {
  const change = saisi.trim() !== r.codeSage;
  return verifie ? (change || !r.confirmee ? true : undefined) : (r.confirmee && !change ? false : undefined);
}
