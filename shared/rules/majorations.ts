// Majorations légales du décompte hebdomadaire (`calcSheet` de ./temps.ts) : jours fériés travaillés et plafond des heures
// complémentaires du temps partiel.
// - 1er mai travaillé : payé double, majoration de 100 % fixée par la loi (art. L3133-6), non réglable : rubrique MAJ_1MAI.
// - Autres jours fériés : aucune majoration légale ; heures repérées et émises en quantité (FERIE_TRAV) pour que la paie
//   les voie, majorées seulement si le réglage `tauxMajorationFerie` le prévoit (convention ou accord : MAJ_FERIE), taux
//   figé sur la feuille à sa validation. La saisie un jour férié est permise par défaut (`feriesTravaillesAutorises`),
//   avec la mention « Férié travaillé » et une ligne au journal (`temps.ferie`). Le lundi de Pentecôte travaillé au titre
//   de la journée de solidarité est repéré comme les autres fériés : son traitement (art. L3133-8) reste à la paie.
//   Les heures d'un férié restent du travail effectif : elles comptent dans le rang des heures supplémentaires.
// - Heures complémentaires : au plus le dixième de la durée contractuelle (art. L3123-28), le tiers seulement avec la
//   référence d'un accord collectif (art. L3123-20) ; au-delà, dépassement qui exige un motif à la soumission.
import { isFerie, joursSemaine } from '../dates.ts';
import type { ISODate, Settings } from '../types.ts';

/** Majoration du 1er mai travaillé (%), fixée par la loi (art. L3133-6). */
export const MAJORATION_1ER_MAI = 100;

/** Jour férié de la feuille : 1er mai (majoration légale) ou autre férié. */
export type Ferie = '1er_mai' | 'ferie';

/** Fériés de la semaine `week` (lundi), du lundi (0) au dimanche (6) ; null les autres jours. */
export function feriesDeLaSemaine(week: ISODate | null | undefined): (Ferie | null)[] {
  if (!week) return Array(7).fill(null);
  return joursSemaine(week).map(day => (!isFerie(day) ? null : day.slice(5) === '05-01' ? '1er_mai' : 'ferie'));
}

/** Heures travaillées un jour férié d'une semaine (`perDay` : du lundi au dimanche) : 1er mai et autres fériés. */
export function heuresFeriees(week: ISODate | null | undefined, perDay: readonly number[]): { mai1: number; ferie: number } {
  const f = feriesDeLaSemaine(week);
  return {
    mai1: perDay.reduce((n, h, i) => n + (f[i] === '1er_mai' ? h : 0), 0),
    ferie: perDay.reduce((n, h, i) => n + (f[i] === 'ferie' ? h : 0), 0),
  };
}

/** Mention d'un jour férié dans la feuille : « Férié », ou « Férié travaillé » et sa majoration quand des heures y sont saisies. */
export function mentionFerie(f: Ferie, heures: number, taux: number): string {
  if (!(heures > 0)) return f === '1er_mai' ? 'Férié (1er mai)' : 'Férié';
  if (f === '1er_mai') return `Férié travaillé : majoré ${MAJORATION_1ER_MAI} %`;
  return taux ? `Férié travaillé : majoré ${taux} %` : 'Férié travaillé';
}

/** Saisie un jour férié refusée par le réglage (null : permise). */
export const ferieRefus = (s: Partial<Pick<Settings, 'feriesTravaillesAutorises'>> | undefined): string | null =>
  s?.feriesTravaillesAutorises === false ? 'Jour férié : la saisie d’heures un jour férié est désactivée (Paramètres → Décompte des heures)' : null;

/** Plafond des heures complémentaires : le tiers avec la référence d'un accord, sinon le dixième. */
export function plafondComplementaires(s: Partial<Pick<Settings, 'plafondHeuresComplementaires' | 'heuresComplementairesAccord'>> | undefined) {
  const tiers = s?.plafondHeuresComplementaires === 'tiers' && !!s.heuresComplementairesAccord;
  return tiers ? { diviseur: 3, label: 'tiers', article: 'art. L3123-20' } : { diviseur: 10, label: 'dixième', article: 'art. L3123-28' };
}
