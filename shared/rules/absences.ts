// Absences hors congés (arrêts, parentalité, événements familiaux, absences non payées) : confidentialité,
// décompte, reprise, annulation et bornes du contrat. Le manager (ou le salarié) signale l'absence, le service RH
// précise sa nature. Les congés décomptés sur un solde (CP, RTT, récupération) restent dans conges.ts.
import { ABS_ST, NATURES_ABSENCE, TYPES_CONTRAT, type NatureDef } from '../constants.ts';
import { addD, days, isFerie, parse, weekday } from '../dates.ts';
import { fmtIso, fmtIsoShort } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Absence, AbsenceStatut, AbsenceType, CongeType, Employe, ISODate, NatureAbsence } from '../types.ts';

export const estConge = (t: string): t is CongeType => t === 'CP' || t === 'RTT' || t === 'RECUP';
export const estNature = (t: string): t is NatureAbsence => Object.hasOwn(NATURES_ABSENCE, t);
export const natureDef = (t: string): NatureDef | null => estNature(t) ? NATURES_ABSENCE[t] : null;
/** Donnée de santé (arrêt maladie, accident, maladie professionnelle) : jamais transmise au manager ni à Keystone. */
export const natureMedicale = (t: string) => !!natureDef(t)?.medicale;

/** Absence en vigueur, validée ou signalée en attendant sa qualification : aucune heure n'est attendue ces jours-là. */
export const absenceBloque = (a: { statut?: AbsenceStatut }) => a.statut === 'validee' || a.statut === 'signalee';
/** Absence ni refusée ni annulée : elle occupe ses dates. */
export const absenceActive = (a: { statut: AbsenceStatut }) => a.statut !== 'refusee' && a.statut !== 'annulee';
/** Arrêt ou absence hors congés en cours de validité : prolongeable par l'intéressé, son manager ou le RH. */
export const prolongeable = (a: Pick<Absence, 'type' | 'statut'>) => !estConge(a.type) && absenceBloque(a);

/**
 * Absence d'un membre de l'équipe vue par son manager : une nature médicale devient « Absence », sans justificatif.
 * Le manager n'en connaît que les dates et l'état (signalée, qualifiée).
 */
export function absenceVueManager(a: Absence): Absence {
  return natureMedicale(a.type) ? { ...a, type: 'ABSENCE', justificatif: false, justificatifLe: null } : a;
}

/** Code transmis à Keystone : CP, RTT ou RECUP ; toute autre absence n'est qu'une indisponibilité (« ABSENCE »). */
export const codeKeystone = (t: AbsenceType): string => estConge(t) ? t : 'ABSENCE';

/** « le 12 oct. 2026 », « du 12 oct. au 16 oct. 2026 ». */
export const periodeTexte = (du: ISODate, au: ISODate) => du === au ? `le ${fmtIso(du)}` : `du ${fmtIsoShort(du)} au ${fmtIso(au)}`;

/** État affiché : une absence hors congés validée est « qualifiée » par le service RH. */
export const statutAbsence = (a: Pick<Absence, 'type' | 'statut'>) => a.statut === 'validee' && !estConge(a.type) ? 'Qualifiée' : ABS_ST[a.statut];

/** Unité du décompte : calendaires (arrêts, parentalité, absence à qualifier…), ouvrés, ou travaillés (RTT, récupération). */
export function uniteDecompte(t: AbsenceType): 'calendaires' | 'ouvrés' | 'travaillés' {
  if (t === 'ABSENCE' || natureDef(t)?.decompte === 'calendaires') return 'calendaires';
  return t === 'RTT' || t === 'RECUP' ? 'travaillés' : 'ouvrés';
}

/** Jours décomptés d'une absence, selon sa nature. */
export function joursDecomptes(d: Domain, e: Employe, a: Pick<Absence, 'type' | 'du' | 'au'>): number {
  return uniteDecompte(a.type) === 'calendaires' ? days(parse(a.du), parse(a.au)) + 1 : d.countDays(e, a.du, a.au, a.type);
}

// — Reprise après une absence longue (entretien de parcours professionnel, art. L6315-1) —

/** Premier jour ouvré qui suit `au` (ni week-end ni férié) : date de reprise. */
export function lendemainOuvre(au: ISODate): ISODate {
  let s = addD(au, 1);
  while (weekday(s) > 4 || isFerie(s)) s = addD(s, 1);
  return s;
}

export interface Reprise { motif: string; date: ISODate }

/** Reprise ouverte par une absence en vigueur dont la nature donne droit à l'entretien de reprise. */
export function repriseDe(a: Pick<Absence, 'type' | 'au' | 'statut'>): Reprise | null {
  const motif = natureDef(a.type)?.reprise;
  return motif && absenceBloque(a) ? { motif, date: lendemainOuvre(a.au) } : null;
}

/** Reprise la plus récente parmi les absences du salarié. */
export function repriseDesAbsences(absences: readonly Absence[], empId: number): Reprise | null {
  return absences.filter(a => a.empId === empId).map(repriseDe).filter((r): r is Reprise => !!r)
    .sort((x, y) => y.date.localeCompare(x.date))[0] ?? null;
}

/**
 * Reprise à inscrire sur la fiche après l'écriture d'une absence (`avant` : son état précédent, null à la création).
 * La reprise calculée remplace celle de la fiche si elle est plus récente, ou si la fiche portait celle de l'absence
 * modifiée (prolongée, corrigée, annulée) ; une reprise saisie à la main plus récente est conservée.
 * undefined : la fiche ne change pas ; null : la reprise est effacée.
 */
export function repriseAInscrire(e: Pick<Employe, 'id' | 'repriseMotif' | 'repriseDate'>, absences: readonly Absence[], avant: Absence | null): Reprise | null | undefined {
  const r = repriseDesAbsences(absences, e.id);
  const ancienne = avant && repriseDe(avant);
  const deCetteAbsence = !!ancienne && e.repriseDate === ancienne.date && e.repriseMotif === ancienne.motif;
  if (r && (deCetteAbsence || !e.repriseDate || r.date > e.repriseDate)) return r.date === e.repriseDate && r.motif === e.repriseMotif ? undefined : r;
  return !r && deCetteAbsence ? null : undefined;
}

// — Bornes du contrat —

const finDe = (e: Pick<Employe, 'typeContrat'>) => TYPES_CONTRAT[e.typeContrat]?.interim ? 'fin de mission' : 'fin de contrat';

/** Borne du contrat dépassée par la période : « entrée le 15 juin 2026 », « fin de contrat le 29 janv. 2027 », sinon null. */
export function borneContrat(e: Pick<Employe, 'entree' | 'fin' | 'typeContrat'>, du: ISODate, au: ISODate): string | null {
  if (du < e.entree) return `entrée le ${fmtIso(e.entree)}`;
  if (e.fin && au > e.fin) return `${finDe(e)} le ${fmtIso(e.fin)}`;
  return null;
}
export const jourHorsContrat = (e: Pick<Employe, 'entree' | 'fin' | 'typeContrat'>, day: ISODate) => borneContrat(e, day, day);

/** Semaine (du lundi `w` au vendredi) entièrement avant l'entrée ou après la fin du contrat. */
export function semaineHorsContrat(e: Pick<Employe, 'entree' | 'fin' | 'typeContrat'>, w: ISODate): string | null {
  if (addD(w, 4) < e.entree) return `entrée le ${fmtIso(e.entree)}`;
  if (e.fin && w > e.fin) return `${finDe(e)} le ${fmtIso(e.fin)}`;
  return null;
}

// — Annulation —

export interface DroitAnnulation { ok: boolean; libelle: string; raison: string }

/**
 * Annulation selon le statut et le rôle (`qui` : service RH, intéressé, manager direct) :
 * - demande en attente : l'intéressé la retire, le RH peut l'annuler ; le manager la refuse ;
 * - absence validée ou signalée qui n'a pas commencé : manager direct ou RH, et l'intéressé pour son propre signalement ;
 * - absence commencée ou passée : RH seul.
 */
export function droitAnnulation(a: Pick<Absence, 'du' | 'statut'>, today: ISODate, qui: { rh: boolean; self: boolean; manager: boolean }): DroitAnnulation {
  const ok = (libelle: string): DroitAnnulation => ({ ok: true, libelle, raison: '' });
  const non = (raison: string): DroitAnnulation => ({ ok: false, libelle: '', raison });
  if (!absenceActive(a)) return non('Absence déjà refusée ou annulée');
  if (a.statut === 'demandee') {
    if (qui.self) return ok('Retirer la demande');
    if (qui.rh) return ok('Annuler la demande');
    return non(qui.manager ? 'Demande en attente : refusez-la plutôt que de l’annuler' : 'Annulation réservée à l’intéressé ou au service RH');
  }
  if (a.du <= today) return qui.rh ? ok('Annuler l’absence') : non('Absence commencée ou passée : seul le service RH peut l’annuler');
  if (qui.rh || qui.manager || (qui.self && a.statut === 'signalee')) return ok(a.statut === 'signalee' ? 'Annuler le signalement' : 'Annuler l’absence');
  return non(qui.self ? 'Absence validée : demandez son annulation à votre manager ou au service RH' : 'Annulation réservée au manager du salarié ou au service RH');
}
