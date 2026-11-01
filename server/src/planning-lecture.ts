// Planning d'équipe dans la lecture brute de l'instantané (lot 12, chantier C5) : fenêtre de lecture des créneaux et
// dérivés assemblés (server/src/lecture-brute.ts, blocs « lot 12 — C5 »).
// - Fenêtre (`FENETRES`) : l'instantané ne lit que les créneaux de 8 semaines passées à 12 semaines à venir (environ
//   36 500 créneaux par an pour 100 salariés, cumulés sans fin) ; l'historique se lit à la demande, filtré par droits
//   (GET /api/planning/historique, server/src/planning-historique.ts).
// - Créneaux nominatifs (`creneaux`) : lignes par salarié (CHAMPS_PAR_SALARIE, server/src/vues-cache.ts), lues par une vue à
//   travers son périmètre.
// - Créneaux « à pourvoir » (`creneauxAPourvoir`, sans salarié) : rattachés à l'équipe, ils ne désignent aucun salarié et le
//   delta ne les impute à personne ; champ commun, lu par les vues manager à travers les équipes encadrées. Pour qu'une
//   écriture d'un créneau nominatif ne recalcule pas toutes les vues, la liste garde la même identité tant que ses lignes
//   (reprises telles quelles par le delta, server/src/delta.ts) ne changent pas.
import { addD } from '../../shared/dates.ts';
import type { Creneau } from '../../shared/types-planning.ts';
import type { Fenetre } from './db.ts';

/** Semaines lues avant et après le jour par l'instantané. */
export const SEMAINES_PASSEES = 8;
export const SEMAINES_A_VENIR = 12;

/** Fenêtre de lecture des créneaux au jour `today` : de 8 semaines avant à 12 semaines après, bornes comprises. */
export const fenetreCreneaux = (today: string): Fenetre =>
  ({ where: 'jour >= ? AND jour <= ?', params: [addD(today, -7 * SEMAINES_PASSEES), addD(today, 7 * SEMAINES_A_VENIR)] });

/** Créneaux nominatifs, dans l'ordre de la table, par liste lue (identité). */
const NOMINATIFS = new WeakMap<readonly Creneau[], Creneau[]>();
export function creneauxNominatifs(lignes: readonly Creneau[]): Creneau[] {
  let x = NOMINATIFS.get(lignes);
  if (!x) NOMINATIFS.set(lignes, x = lignes.filter(c => c.empId != null));
  return x;
}

/** Dernière liste « à pourvoir » rendue : reprise telle quelle quand ses lignes n'ont pas changé. */
let derniere: Creneau[] = [];
export function creneauxAPourvoir(lignes: readonly Creneau[]): Creneau[] {
  const x = lignes.filter(c => c.empId == null);
  if (x.length === derniere.length && x.every((c, i) => c === derniere[i])) return derniere;
  derniere = x;
  return x;
}
