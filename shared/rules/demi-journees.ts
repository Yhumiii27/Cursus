// Demi-journées de congé (décision de l'entreprise) : congés payés, RTT et jours de repos du forfait jours,
// récupération. Le premier jour peut ne compter que l'après-midi, le dernier que le matin ; un congé d'un seul jour
// porte au plus une demi-journée, matin ou après-midi (`debutDemi`). Les autres natures restent en journées entières.
// Effets : décompte pondéré (`Domain.countedDays`, 0,5 ou 1 par jour), imputation des CP au demi-jour
// (shared/rules/conges.ts), chevauchement admis de deux demi-journées opposées le même jour, au plus une demi-journée de
// travail sur la feuille de temps ce jour-là (shared/rules/temps.ts). Keystone reçoit la journée entière.
import { fmtIso, fmtIsoShort } from '../format.ts';
import type { Absence, AbsenceType, DemiJournee, ISODate } from '../types.ts';

/** Demi-journées d'une absence (null ou absentes : journées entières). */
export type DemiJournees = Partial<Pick<Absence, 'debutDemi' | 'finDemi'>>;
/** Absence vue jour par jour : période et demi-journées. */
export type PeriodeDemi = Pick<Absence, 'du' | 'au'> & DemiJournees;

export const DEMI_LABEL: Record<DemiJournee, string> = { matin: 'matin', apres_midi: 'après-midi' };
export const estDemi = (v: unknown): v is DemiJournee => v === 'matin' || v === 'apres_midi';

/** Natures posables à la demi-journée : CP, RTT ou repos du forfait jours, récupération. */
export const demiAutorisee = (t: AbsenceType) => t === 'CP' || t === 'RTT' || t === 'RECUP';

/**
 * Durée de travail admise le jour d'une demi-journée d'absence : une demi-journée, soit la moitié de la journée du
 * contrat (`dayH`), et au moins 4 h pour une journée de 7 h ou plus — le seuil d'une demi-journée travaillée du forfait
 * jours (`calcSheet`), qui laisse un matin de 8 h à 12 h à un horaire de 7 h par jour. Journée plus courte (temps
 * partiel) : la moitié seulement, le plancher de 4 h y vaudrait la journée entière.
 */
export const heuresDemiJournee = (dayH: number) => dayH >= 7 ? Math.max(4, dayH / 2) : dayH / 2;

/** Demi-journée reçue absente (null, non renseignée, chaîne vide) : journée entière. */
const nonRenseignee = (v: unknown) => v === null || v === undefined || v === '';

/**
 * Demi-journées reçues (formulaire, action) ramenées à la règle, ou refus : valeur inconnue refusée (jamais prise pour
 * une journée entière ni recopiée au journal) ; congé d'un seul jour : une seule demi-journée, portée par `debutDemi` ;
 * congé de plusieurs jours : après-midi le premier jour, matin le dernier. `erreur` : texte du refus, null si la saisie
 * est conforme.
 */
export function demiJournees(type: AbsenceType, du: ISODate, au: ISODate, debut: unknown, fin: unknown): { demi: Required<DemiJournees>; erreur: string | null } {
  const d = estDemi(debut) ? debut : null, f = estDemi(fin) ? fin : null;
  const demi = { debutDemi: d, finDemi: f };
  if (!(d || nonRenseignee(debut)) || !(f || nonRenseignee(fin))) return { demi, erreur: 'Demi-journée inconnue : indiquez le matin ou l’après-midi.' };
  if (!d && !f) return { demi, erreur: null };
  if (!demiAutorisee(type)) return { demi, erreur: 'Seuls les congés payés, les RTT ou jours de repos et la récupération se posent à la demi-journée.' };
  if (du === au) {
    return f ? { demi, erreur: 'Congé d’un seul jour : indiquez une seule demi-journée, le matin ou l’après-midi.' } : { demi, erreur: null };
  }
  if (d === 'matin') return { demi, erreur: 'Le premier jour d’un congé de plusieurs jours ne peut commencer qu’à la mi-journée (après-midi).' };
  if (f === 'apres_midi') return { demi, erreur: 'Le dernier jour d’un congé de plusieurs jours ne peut finir qu’à la mi-journée (matin).' };
  return { demi, erreur: null };
}

/** Moitiés du jour `jour` occupées par l'absence (rien si le jour est hors de sa période). */
export function moities(a: PeriodeDemi, jour: ISODate): { matin: boolean; apres_midi: boolean } {
  if (jour < a.du || jour > a.au) return { matin: false, apres_midi: false };
  let matin = true, apres_midi = true;
  if (jour === a.du && a.debutDemi) { matin = a.debutDemi === 'matin'; apres_midi = a.debutDemi === 'apres_midi'; }
  if (jour === a.au && jour !== a.du && a.finDemi) { matin = a.finDemi === 'matin'; apres_midi = a.finDemi === 'apres_midi'; }
  return { matin, apres_midi };
}

/** Demi-journée occupée le jour `jour` quand l'absence n'en prend qu'une ; null pour une journée entière (ou hors période). */
export function demiDuJour(a: PeriodeDemi, jour: ISODate): DemiJournee | null {
  const m = moities(a, jour);
  return m.matin === m.apres_midi ? null : m.matin ? 'matin' : 'apres_midi';
}

/** Poids d'un jour de l'absence dans le décompte : 0,5 pour une demi-journée, 1 sinon. */
export const poidsDuJour = (a: DemiJournees & Pick<Absence, 'du' | 'au'>, jour: ISODate) => demiDuJour(a, jour) ? 0.5 : 1;

/**
 * Deux absences occupent-elles une même demi-journée ? Deux demi-journées opposées le même jour (CP le matin, RTT
 * l'après-midi) sont admises ; tout autre recouvrement de dates est un chevauchement.
 */
export function chevauche(a: PeriodeDemi, b: PeriodeDemi): boolean {
  if (a.du > b.au || b.du > a.au) return false;
  const du = a.du > b.du ? a.du : b.du, au = a.au < b.au ? a.au : b.au;
  // Plus d'un jour en commun : au moins une moitié de journée partagée (seuls le premier et le dernier jour sont partiels).
  if (du !== au) return true;
  const x = moities(a, du), y = moities(b, du);
  return (x.matin && y.matin) || (x.apres_midi && y.apres_midi);
}

/** « (matin) », « (après-midi) » : précision d'un jour partiel, vide pour une journée entière. */
const precision = (demi: DemiJournee | null | undefined) => demi ? ` (${DEMI_LABEL[demi]})` : '';

/**
 * Période d'une absence avec ses demi-journées : « le 12 oct. 2026 (matin) », « du 12 oct. (après-midi) au 16 oct. 2026
 * (matin) » ; sans demi-journée, celle de `periodeTexte` (shared/rules/absences.ts).
 */
export function periodeDemiTexte(a: PeriodeDemi): string {
  if (a.du === a.au) return `le ${fmtIso(a.du)}${precision(a.debutDemi)}`;
  return `du ${fmtIsoShort(a.du)}${precision(a.debutDemi)} au ${fmtIso(a.au)}${precision(a.finDemi)}`;
}

/** Mention des demi-journées seule, pour une colonne d'export : « après-midi le premier jour · matin le dernier jour ». */
export function demiTexte(a: PeriodeDemi): string {
  if (a.du === a.au) return a.debutDemi ? DEMI_LABEL[a.debutDemi] : '';
  return [a.debutDemi ? `${DEMI_LABEL[a.debutDemi]} le premier jour` : '', a.finDemi ? `${DEMI_LABEL[a.finDemi]} le dernier jour` : ''].filter(Boolean).join(' · ');
}
