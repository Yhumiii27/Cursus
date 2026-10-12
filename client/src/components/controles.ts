// Messages d'erreur des champs des formulaires (dates, périodes, nombres, textes obligatoires), affichés sous
// le champ concerné (components/Dialog.tsx, Field `erreur`). Les règles métier restent dans shared/ : ces
// contrôles ne disent que ce qui manque ou ce qui est mal saisi. Messages en phrases, terminés par un point.
import { isValidDate } from '../../../shared/dates.ts';

/** Texte obligatoire : `vide` s'il n'est fait que d'espaces. */
export const erreurTexte = (v: string, vide: string): string | null => v.trim() ? null : vide;

/** Date obligatoire : `vide` si rien n'est saisi, sinon date invalide (saisie incomplète au clavier). */
export function erreurDate(v: string, vide: string): string | null {
  if (!v) return vide;
  return isValidDate(v) ? null : 'Date invalide.';
}

/** Période du … au … : les deux dates obligatoires, la fin le jour du début au plus tôt (l'erreur va sous la fin). */
export function erreursPeriode(du: string, au: string, vides: { du: string; au: string }): { du: string | null; au: string | null } {
  const eDu = erreurDate(du, vides.du);
  const eAu = erreurDate(au, vides.au) ?? (!eDu && au < du ? 'La fin précède le début.' : null);
  return { du: eDu, au: eAu };
}

/** Nombre de jours, par demi-journée, entre 0,5 et `max` (solde disponible). */
export function erreurJours(v: string, max: number): string | null {
  const j = Number(v);
  if (!v.trim() || Number.isNaN(j)) return 'Indiquez le nombre de jours.';
  if (!(j > 0) || (j * 2) % 1 !== 0) return 'Nombre de jours par demi-journée : 0,5, 1, 1,5…';
  if (j > max) return max > 0 ? `${String(max).replace('.', ',')} j au plus.` : 'Aucun jour disponible.';
  return null;
}
