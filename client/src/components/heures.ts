// Saisie des heures (feuilles de temps) : valeur d'une cellule, nom de chaque champ pour un lecteur d'écran, et vue
// « un jour » des téléphones et tablettes (pages/SaisieJour.tsx) : quand elle s'affiche, et quel jour elle ouvre.
import { addD, parse } from '../../../shared/dates.ts';
import { num } from '../../../shared/format.ts';
import type { ISODate, LigneTemps } from '../../../shared/types.ts';

/** Valeur affichée dans une cellule : vide pour zéro, virgule décimale. */
export const cellText = (v: number) => v ? String(v).replace('.', ',') : '';
/** Même normalisation que le serveur (0 à 24 h, au centième). */
export const cellValue = (raw: string) => Math.round(Math.max(0, Math.min(24, num(raw))) * 100) / 100;

/** Nom d'un champ d'heures : « <projet> · <tâche> — <jour> » (« INT-MAINT · Maintenance — lundi 12 octobre »). */
export const nomChamp = (l: Pick<LigneTemps, 'projet' | 'tache'>, jourLong: string) => `${l.projet} · ${l.tache} — ${jourLong}`;
/** Jour en toutes lettres, sans l'année : « lundi 12 octobre ». */
export const jourLong = (day: ISODate) => parse(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Vue « un jour » des feuilles de temps : sous 600 px de large, ou sur écran tactile (téléphone, tablette). */
export const VUE_JOUR = '(max-width: 600px), (pointer: coarse)';

/**
 * Jour ouvert par défaut dans la vue « un jour » (0 : lundi … 6 : dimanche) : aujourd'hui dans la semaine affichée ; un
 * samedi ou un dimanche, le vendredi si aucune heure n'est saisie ce jour-là (le week-end n'est normalement pas
 * travaillé : on y complète surtout la semaine), le jour même sinon ; le lundi d'une autre semaine.
 */
export function jourParDefaut(wdays: readonly ISODate[], today: ISODate, perDay: readonly number[] = []): number {
  const i = wdays.indexOf(today);
  if (i >= 0 && i < 5) return i;
  const weekEnd = today > wdays[0] && today <= addD(wdays[0], 6);
  if (!weekEnd) return 0;
  const j = i >= 0 ? i : today === addD(wdays[0], 5) ? 5 : 6;
  return perDay[j] > 0 ? j : 4;
}
