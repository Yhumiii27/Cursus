// Messages d'erreur des champs des formulaires (dates, périodes, nombres, textes obligatoires), affichés sous
// le champ concerné (components/Dialog.tsx, Field `erreur`). Les règles métier restent dans shared/ : ces
// contrôles ne disent que ce qui manque ou ce qui est mal saisi. Messages en phrases, terminés par un point.
import { isValidDate } from '../../../shared/dates.ts';
import { type ChampPlage, controlePlage } from '../../../shared/rules/plage-session.ts';
import { controleSession } from '../../../shared/rules/sessions.ts';
import type { ISODate } from '../../../shared/types.ts';

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

/** Nombre entier obligatoire, au moins `min` : `vide` si rien n'est saisi (ou une saisie qui n'est pas un nombre). */
export function erreurEntier(v: string, min: number, vide: string): string | null {
  const n = Number(v);
  if (!v.trim() || Number.isNaN(n)) return vide;
  return Number.isInteger(n) && n >= min ? null : `Nombre entier, au moins ${min}.`;
}

/** Champs d'une session de formation (dialogs/SessionDialog.tsx) ; `fin`, `jours`, `horaires` : plage (plage-session.ts). */
export type ChampSession = 'date' | 'lieu' | 'places' | ChampPlage;

/**
 * Erreurs d'une session de formation, une sous chaque champ, tous les champs à la fois : ce qui manque ou est mal
 * saisi, puis le contrôle partagé avec le serveur (`controleSession`) sous le champ qu'il concerne. Le dernier jour, les
 * jours et les horaires (session sur plusieurs jours) sont contrôlés par `controlePlage`, comme sur le serveur.
 */
export function erreursSession(
  today: ISODate, v: { date: string; lieu: string; places: string; fin?: string; jours?: ISODate[]; horaires?: unknown[] }, opts: { dateActuelle?: ISODate; inscrits?: number } = {},
) {
  const champs: Record<ChampSession, string | null> = {
    date: erreurDate(v.date, 'Indiquez la date de la session.'),
    lieu: erreurTexte(v.lieu, 'Indiquez le lieu.'),
    places: erreurEntier(v.places, 1, 'Indiquez le nombre de places.'),
    fin: null, jours: null, horaires: null,
  };
  const plage = isValidDate(v.date) ? controlePlage(v.date, v) : null;
  if (plage && 'champ' in plage) champs[plage.champ] = `${plage.message}.`;
  const err = controleSession(today, v, opts);
  const champ: ChampSession | null = !err || (plage && 'champ' in plage && plage.message === err) ? null
    : /date/i.test(err) ? 'date' : /^Lieu/.test(err) ? 'lieu' : 'places';
  if (err && champ && !champs[champ]) champs[champ] = `${err}.`;
  const vides: Record<ChampSession, boolean> = { date: !v.date, lieu: !v.lieu.trim(), places: !v.places.trim(), fin: false, jours: false, horaires: false };
  return { champs, vides, bloque: !!err || Object.values(champs).some(Boolean) };
}

/** Nombre de jours, par demi-journée, entre 0,5 et `max` (solde disponible). */
export function erreurJours(v: string, max: number): string | null {
  const j = Number(v);
  if (!v.trim() || Number.isNaN(j)) return 'Indiquez le nombre de jours.';
  if (!(j > 0) || (j * 2) % 1 !== 0) return 'Nombre de jours par demi-journée : 0,5, 1, 1,5…';
  if (j > max) return max > 0 ? `${String(max).replace('.', ',')} j au plus.` : 'Aucun jour disponible.';
  return null;
}
