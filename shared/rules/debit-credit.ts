// Compteur débit-crédit du badgeage (lot 12, chantier C6, t191) : réalisé (pointages) moins théorique, par jour, par semaine
// et sur la période, calculé à chaque lecture (GET /api/pointages/etat, server/src/pointages.ts), jamais stocké ni mis dans
// l'instantané (il dépend de l'heure). Distinct du compteur de récupération (`recupInfo`, shared/rules/conges.ts) : un
// crédit d'horaires variables n'est pas une heure supplémentaire tant qu'il reste dans les plafonds du report (art.
// L3121-51) ; au-delà, l'excédent est signalé, à examiner sur la feuille (heures supplémentaires). Aucune rubrique de paie :
// le solde est seulement signalé dans le solde de sortie (choix par défaut du chantier).
// - Théorique d'un jour : durée de l'horaire du jour (début, fin, pause), à défaut la durée hebdomadaire du contrat divisée
//   par ses jours travaillés ; zéro un jour de repos (samedi, dimanche, jour non travaillé d'un temps partiel), férié, hors
//   contrat ou d'absence (moitié pour une demi-journée). Le motif ne dit jamais la nature d'une absence.
// - Report d'une semaine à l'autre plafonné (3 h par semaine, 10 h de cumul : valeurs supplétives ; d'autres valeurs
//   exigent la référence de l'accord, horaires variables de l'étape 2).
import { addD, weekday } from '../dates.ts';
import type { HoraireFige, ISODate } from '../types.ts';
import { dureeHoraire } from './horaires.ts';

/** Plafonds supplétifs du report des horaires variables (art. L3121-51 et suivants), en minutes. */
export const REPORT_MAX_SEMAINE_MIN = 180;
export const CUMUL_MAX_MIN = 600;
/** Durée hebdomadaire par défaut (35 h) et jours travaillés d'une semaine pleine. */
export const DUREE_LEGALE_H = 35;
export const JOURS_OUVRES = 5;

export type MotifTheorique = 'travaille' | 'repos' | 'ferie' | 'absence' | 'hors_contrat';
export interface JourTheorique { jour: ISODate; minutes: number; motif: MotifTheorique }

/** Ce que lit le théorique d'un jour. */
export interface EntreeTheorique {
  jour: ISODate;
  /** Horaire de référence du jour (choisi sur la feuille, ou celui de l'équipe), ou null. */
  horaire: HoraireFige | null;
  /** Absence ce jour-là : journée entière, demi-journée, ou aucune (toute nature confondue). */
  absence: 'journee' | 'demi' | null;
  ferie: boolean;
  horsContrat: boolean;
  /** Jours non travaillés du contrat (0 = lundi … 4 = vendredi). */
  jourOff: readonly number[];
  /** Durée hebdomadaire du contrat (heures), 35 h à défaut. */
  heuresSemaine: number | null;
}

/** Théorique du jour, en minutes, et son motif. */
export function theoriqueDuJour(x: EntreeTheorique): JourTheorique {
  const j = x.jour, wd = weekday(j);
  if (x.horsContrat) return { jour: j, minutes: 0, motif: 'hors_contrat' };
  if (wd >= 5 || x.jourOff.includes(wd)) return { jour: j, minutes: 0, motif: 'repos' };
  if (x.ferie) return { jour: j, minutes: 0, motif: 'ferie' };
  if (x.absence === 'journee') return { jour: j, minutes: 0, motif: 'absence' };
  const travailles = Math.max(1, JOURS_OUVRES - x.jourOff.length);
  const base = x.horaire ? dureeHoraire(x.horaire) * 60 : ((x.heuresSemaine ?? DUREE_LEGALE_H) * 60) / travailles;
  const minutes = Math.round(x.absence === 'demi' ? base / 2 : base);
  return { jour: j, minutes, motif: x.absence === 'demi' ? 'absence' : 'travaille' };
}

/** Solde d'une semaine (lundi `week`) : réalisé et théorique en minutes, jour par jour. */
export interface SoldeSemaine { week: ISODate; realise: number; theorique: number; solde: number; jours: { jour: ISODate; realise: number; theorique: number; solde: number }[] }

/** Solde de la semaine `week` d'après le réalisé par jour (minutes) et le théorique de chaque jour. */
export function soldeSemaine(week: ISODate, realise: ReadonlyMap<ISODate, number>, theorique: (jour: ISODate) => number): SoldeSemaine {
  const jours = Array.from({ length: 7 }, (_, i) => {
    const jour = addD(week, i), r = realise.get(jour) ?? 0, t = theorique(jour);
    return { jour, realise: r, theorique: t, solde: r - t };
  });
  const r = jours.reduce((n, x) => n + x.realise, 0), t = jours.reduce((n, x) => n + x.theorique, 0);
  return { week, realise: r, theorique: t, solde: r - t, jours };
}

/** Semaine d'une période avec son report plafonné, le cumul après elle et l'excédent écarté par les plafonds (minutes). */
export interface SemaineReportee extends SoldeSemaine { report: number; cumul: number; excedent: number }

/**
 * Cumul de la période : chaque semaine reporte son solde dans la limite de `reportMaxSemaine` (en crédit comme en débit),
 * puis le cumul est borné à `cumulMax`. L'excédent (crédit au-delà des plafonds, positif ; débit au-delà, négatif) n'est pas
 * reporté : il est signalé (heures supplémentaires possibles, ou absence à régulariser).
 */
export function cumulPeriode(semaines: readonly SoldeSemaine[], o: { reportMaxSemaine?: number | null; cumulMax?: number | null } = {}):
  { semaines: SemaineReportee[]; cumul: number; excedent: number } {
  const rmax = o.reportMaxSemaine ?? REPORT_MAX_SEMAINE_MIN, cmax = o.cumulMax ?? CUMUL_MAX_MIN;
  let cumul = 0, excedent = 0;
  const out = semaines.map(s => {
    const report = Math.max(-rmax, Math.min(rmax, s.solde));
    const avant = cumul;
    cumul = Math.max(-cmax, Math.min(cmax, cumul + report));
    const e = s.solde - (cumul - avant);
    excedent += e;
    return { ...s, report, cumul, excedent: e };
  });
  return { semaines: out, cumul, excedent };
}
