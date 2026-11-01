// Cumul des frais réels avec les forfaits de grand déplacement (lot 11, chantier C5). Les jours et nuits de grand
// déplacement en France (GD_JOUR, GD_NUIT) et les jours à l'étranger (ETR_JOUR) partent déjà en quantités à la paie, qui
// les valorise dans Sage (shared/rules/deplacements-paie.ts ; choix par défaut : forfaits toujours valorisés dans Sage).
// On ne cumule jamais forfait et frais réels pour une même dépense (arrêté du 20 décembre 2002) : un jour payé au forfait
// ne reçoit ni repas ni hôtel en frais réels de même nature, ni allocation forfaitaire de même nature, sans alerte
// bloquante. Croisement jour par jour :
// - GD_JOUR (repas du jour en grand déplacement) : repas, repas d'affaires (invités compris : alerte bloquante aussi,
//   le service RH tranche), forfait repas ;
// - GD_NUIT (nuit du jour au lendemain) : hôtel de cette nuit, forfait logement ;
// - ETR_JOUR (jour à l'étranger, indemnité de mission journalière) : repas et hôtel du jour.
// Les jours d'un séjour sont ceux que compte la paie (`joursSejour`, mêmes règles que `partsSejour`) : jours calendaires,
// hors absences validées ou signalées et après la sortie ; une nuit pour chaque jour compté sauf le dernier (France).
import { addD, days, parse } from '../dates.ts';
import type { CategorieFrais, CodeForfaitFrais, ISODate, LigneFrais } from '../types.ts';
import type { SejourPaie } from './deplacements-paie.ts';

/** Rubriques de forfait de déplacement croisées avec les frais réels. */
export type ForfaitJour = 'GD_JOUR' | 'GD_NUIT' | 'ETR_JOUR';

/** Forfaits payés à un salarié, jour par jour : rubriques de chaque jour. */
export type JoursForfait = ReadonlyMap<ISODate, ReadonlySet<ForfaitJour>>;

/**
 * Jours d'un séjour et rubriques de chacun, comme la paie les compte : `absent` (absence validée ou signalée ce jour-là) et
 * `fin` (sortie) écartent des jours ; une nuit de grand déplacement pour chaque jour compté sauf le dernier (France).
 */
export function joursSejour(s: Pick<SejourPaie, 'source' | 'du' | 'au'>, absent: (jour: ISODate) => boolean, fin: ISODate | null = null): Map<ISODate, Set<ForfaitJour>> {
  const n = days(parse(s.du), parse(s.au)) + 1;
  const comptes: ISODate[] = [];
  for (let i = 0; i < n; i++) {
    const j = addD(s.du, i);
    if (fin && j > fin) break;
    if (!absent(j)) comptes.push(j);
  }
  const out = new Map<ISODate, Set<ForfaitJour>>();
  comptes.forEach((j, i) => {
    const r = new Set<ForfaitJour>([s.source === 'mission' ? 'GD_JOUR' : 'ETR_JOUR']);
    if (s.source === 'mission' && i < comptes.length - 1) r.add('GD_NUIT');
    out.set(j, r);
  });
  return out;
}

/** Jours de plusieurs séjours d'un salarié réunis (un jour peut porter les rubriques de deux séjours qui se touchent). */
export function joursForfait(parSejour: readonly ReadonlyMap<ISODate, ReadonlySet<ForfaitJour>>[]): JoursForfait {
  const out = new Map<ISODate, Set<ForfaitJour>>();
  for (const m of parSejour) for (const [j, r] of m) out.set(j, new Set([...(out.get(j) ?? []), ...r]));
  return out;
}

/** Nature d'une dépense croisée avec les forfaits : repas, logement, ou rien. */
function nature(c: CategorieFrais, forfait: string | null): 'repas' | 'logement' | null {
  if (c === 'repas' || c === 'repas_affaires') return 'repas';
  if (c === 'hotel') return 'logement';
  if (c !== 'forfait' || !forfait) return null;
  const code = forfait.split(':')[0] as CodeForfaitFrais;
  if (code === 'repas_restaurant' || code === 'repas_hors_locaux' || code === 'panier' || code === 'gd_repas') return 'repas';
  if (code === 'gd_logement_idf' || code === 'gd_logement_autres') return 'logement';
  // Indemnité de mission à l'étranger : repas et logement du jour.
  return code === 'etranger' ? 'repas' : null;
}

/** Ligne en cumul avec un forfait : ligne, jour et rubrique du forfait déjà payé. */
export interface CumulForfait { ligneId: number; date: ISODate; rubrique: ForfaitJour }

/**
 * Lignes (en vigueur) qui cumulent un forfait de grand déplacement ou de mission à l'étranger déjà payé le même jour (le
 * même soir pour un hôtel), pour la même nature de dépense : alerte bloquante à la soumission et au contrôle.
 */
export function cumulsForfait(lignes: readonly Pick<LigneFrais, 'id' | 'date' | 'categorie' | 'forfait' | 'refuseeLe'>[], jours: JoursForfait): CumulForfait[] {
  const out: CumulForfait[] = [];
  for (const l of lignes) {
    if (l.refuseeLe) continue;
    const n = nature(l.categorie, l.forfait), r = jours.get(l.date);
    if (!n || !r) continue;
    const rubrique = n === 'repas' ? (r.has('GD_JOUR') ? 'GD_JOUR' : r.has('ETR_JOUR') ? 'ETR_JOUR' : null)
      : r.has('GD_NUIT') ? 'GD_NUIT' : r.has('ETR_JOUR') ? 'ETR_JOUR' : null;
    // Indemnité de mission à l'étranger saisie en forfait : elle cumule aussi le logement payé au forfait.
    if (rubrique) out.push({ ligneId: l.id, date: l.date, rubrique });
  }
  return out;
}

/** Libellé d'un cumul, sans nature de dépense médicale (aucune n'y entre) : « repas du 12/10 déjà payé au forfait GD_JOUR ». */
export const RUBRIQUE_CUMUL: Record<ForfaitJour, string> = {
  GD_JOUR: 'jour de grand déplacement (repas au forfait)',
  GD_NUIT: 'nuit de grand déplacement (logement au forfait)',
  ETR_JOUR: 'jour de mission à l’étranger (indemnité journalière)',
};
