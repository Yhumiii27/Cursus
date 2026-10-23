// Filtres et tri de l'écran Congés & absences (t145), sans React : testés sous Node (tests/ergonomie-listes.test.ts).
// Soldes : recherche (nom, poste, équipe, matricules, comme l'annuaire) et équipe. Absences : état, famille, période.
// L'ordre par défaut des absences est celui d'avant le tri par colonne : à traiter d'abord, les annulées en dernier.
import { estConge } from '../../../shared/rules/absences.ts';
import type { Absence, Employe, ISODate } from '../../../shared/types.ts';
import { correspond } from '../components/recherche.ts';

/** Équipe du filtre des soldes : toutes. */
export const TOUTES = '';

export type FiltreStatut = 'tous' | 'a-traiter' | 'validee' | 'refusee' | 'annulee';
export type FiltreType = 'tous' | 'CP' | 'RTT' | 'RECUP' | 'hors';
export type FiltrePeriode = 'toutes' | 'a-venir' | 'passees';
export interface FiltresAbsences { statut: FiltreStatut; type: FiltreType; periode: FiltrePeriode }
export const SANS_FILTRE: FiltresAbsences = { statut: 'tous', type: 'tous', periode: 'toutes' };

export const FILTRES_STATUT: [FiltreStatut, string][] = [
  ['tous', 'Tous les états'], ['a-traiter', 'À traiter'], ['validee', 'Validées ou qualifiées'], ['refusee', 'Refusées'], ['annulee', 'Annulées'],
];
export const FILTRES_TYPE: [FiltreType, string][] = [
  ['tous', 'Tous les types'], ['CP', 'Congés payés'], ['RTT', 'RTT / repos'], ['RECUP', 'Récupération'], ['hors', 'Absences hors congés'],
];
export const FILTRES_PERIODE: [FiltrePeriode, string][] = [['toutes', 'Toutes les dates'], ['a-venir', 'En cours ou à venir'], ['passees', 'Passées']];

/**
 * L'absence passe-t-elle les filtres ? « À traiter » : demandes et signalements ; « hors congés » : toute absence qui
 * n'est ni un CP, ni un RTT, ni une récupération (le manager n'en voit que « Absence ») ; une absence en cours (`au` au
 * plus tôt aujourd'hui, `ti`) est « en cours ou à venir ».
 */
export function filtrerAbsence(a: Pick<Absence, 'statut' | 'type' | 'au'>, f: FiltresAbsences, ti: ISODate): boolean {
  const statut = f.statut === 'tous' || (f.statut === 'a-traiter' ? a.statut === 'demandee' || a.statut === 'signalee' : a.statut === f.statut);
  const type = f.type === 'tous' || (f.type === 'hors' ? !estConge(a.type) : a.type === f.type);
  const periode = f.periode === 'toutes' || (f.periode === 'a-venir' ? a.au >= ti : a.au < ti);
  return statut && type && periode;
}

/** Rang de l'ordre par défaut : demandes, signalements, puis le reste, les annulées en dernier. */
export const rangAbsence = (a: Pick<Absence, 'statut'>) => a.statut === 'demandee' ? 0 : a.statut === 'signalee' ? 1 : a.statut === 'annulee' ? 3 : 2;

/** Solde affiché pour la recherche et l'équipe choisies (TOUTES : toutes les équipes ; 'À affecter' : sans équipe). */
export const filtrerSolde = (e: Employe, recherche: string, equipe: string) =>
  correspond(e, recherche) && (equipe === TOUTES || (e.equipe ?? 'À affecter') === equipe);
