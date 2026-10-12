// Absences hors congés (arrêts, parentalité, événements familiaux, absences non payées) : confidentialité,
// décompte, reprise, annulation et bornes du contrat. Le manager (ou le salarié) signale l'absence, le service RH
// précise sa nature. Les congés décomptés sur un solde (CP, RTT, récupération) restent dans conges.ts.
import { ABS_ST, NATURES_ABSENCE, TYPES_CONTRAT, type NatureDef } from '../constants.ts';
import { addD, days, isFerie, parse, weekday } from '../dates.ts';
import { fmtIso, fmtIsoShort } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Absence, AbsenceStatut, AbsenceType, CongeType, Employe, Entretien, ISODate, NatureAbsence } from '../types.ts';

export const estConge = (t: string): t is CongeType => t === 'CP' || t === 'RTT' || t === 'RECUP';
export const estNature = (t: string): t is NatureAbsence => Object.hasOwn(NATURES_ABSENCE, t);
export const natureDef = (t: string): NatureDef | null => estNature(t) ? NATURES_ABSENCE[t] : null;
/**
 * Donnée de santé (arrêt maladie, accident, maladie professionnelle, et la santé d'un enfant : annonce d'un handicap,
 * enfant malade) : jamais transmise au manager ni à Keystone.
 */
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

export interface Reprise {
  motif: string; date: ISODate;
  /** Début de l'absence qui l'ouvre. */
  depuis: ISODate;
}
type AbsenceReprise = Pick<Absence, 'empId' | 'type' | 'du' | 'au' | 'statut'>;

/** Reprise ouverte par une absence en vigueur dont la nature donne droit à l'entretien de reprise. */
export function repriseDe(a: Omit<AbsenceReprise, 'empId'>): Reprise | null {
  const motif = natureDef(a.type)?.reprise;
  return motif && absenceBloque(a) ? { motif, date: lendemainOuvre(a.au), depuis: a.du } : null;
}

/** Reprise la plus récente parmi les absences du salarié. */
export function repriseDesAbsences(absences: readonly AbsenceReprise[], empId: number): Reprise | null {
  return absences.filter(a => a.empId === empId).map(repriseDe).filter((r): r is Reprise => !!r)
    .sort((x, y) => y.date.localeCompare(x.date))[0] ?? null;
}

/**
 * Reprise de la fiche antérieure à `depuis` (début d'une nouvelle absence) dont l'entretien n'est pas réalisé :
 * aucun entretien de parcours professionnel ou de reprise depuis cette date (même règle que `obligations`).
 * L'obligation reste due : la reprise n'est pas remplacée par celle de la nouvelle absence.
 */
export function repriseEnAttente(e: Pick<Employe, 'id' | 'repriseDate'>, entretiens: readonly Pick<Entretien, 'empId' | 'type' | 'statut' | 'date'>[], depuis: ISODate): boolean {
  const r = e.repriseDate;
  return !!r && r < depuis && !entretiens.some(x => x.empId === e.id && (x.type === 'epp' || x.type === 'reprise') && x.statut === 'realise' && x.date >= r);
}

/**
 * Reprise à inscrire sur la fiche après l'écriture d'une absence (`avant` : son état précédent, null à la création ;
 * `type` : sa nature après l'écriture). Seule une absence qui ouvre droit à la reprise, avant ou après l'écriture, touche
 * la fiche : une reprise saisie ou effacée à la main n'est pas remise en cause par une autre absence.
 * La reprise calculée remplace celle de la fiche si elle est plus récente, ou si la fiche portait celle de l'absence
 * modifiée (prolongée, corrigée, annulée) ; une reprise saisie à la main plus récente est conservée, comme une reprise
 * antérieure à l'absence dont l'entretien n'est pas réalisé (`differee` : la reprise calculée, à inscrire ensuite).
 * `reprise` : undefined, la fiche ne change pas ; null, la reprise est effacée.
 */
export function repriseAInscrire(
  e: Pick<Employe, 'id' | 'repriseMotif' | 'repriseDate'>, absences: readonly AbsenceReprise[], entretiens: readonly Pick<Entretien, 'empId' | 'type' | 'statut' | 'date'>[],
  avant: Omit<AbsenceReprise, 'empId'> | null, type: AbsenceType,
): { reprise?: Reprise | null; differee?: Reprise } {
  if (!natureDef(type)?.reprise && !(avant && natureDef(avant.type)?.reprise)) return {};
  const r = repriseDesAbsences(absences, e.id);
  const ancienne = avant && repriseDe(avant);
  const deCetteAbsence = !!ancienne && e.repriseDate === ancienne.date && e.repriseMotif === ancienne.motif;
  if (!r) return deCetteAbsence ? { reprise: null } : {};
  if (r.date === e.repriseDate && r.motif === e.repriseMotif) return {};
  if (e.repriseDate && !deCetteAbsence) {
    if (r.date <= e.repriseDate) return {};
    if (repriseEnAttente(e, entretiens, r.depuis)) return { differee: r };
  }
  return { reprise: r };
}

/** Motifs de reprise des natures médicales (arrêt longue maladie). */
const MOTIFS_MEDICAUX = new Set(Object.values(NATURES_ABSENCE).filter(n => n.medicale && n.reprise).map(n => n.reprise));

/**
 * Reprise ouverte par un arrêt médical (arrêt longue maladie) : masquée au manager. Maternité, adoption et congé parental
 * lui sont montrés en clair : une « Absence » suivie d'une reprise trahirait la nature de l'arrêt. Le RH suit l'entretien.
 */
export function repriseMedicale(e: Pick<Employe, 'id' | 'repriseMotif' | 'repriseDate'>, absences: readonly AbsenceReprise[]): boolean {
  if (!e.repriseDate) return false;
  return MOTIFS_MEDICAUX.has(e.repriseMotif ?? '')
    || absences.some(a => a.empId === e.id && natureMedicale(a.type) && absenceBloque(a) && lendemainOuvre(a.au) === e.repriseDate);
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
 * Signalement fait par l'intéressé lui-même, jamais qualifié ni prolongé depuis : il peut le retirer tant qu'il n'a pas
 * commencé. Une absence signalée par son manager ou le RH, qualifiée (nature précisée), saisie par le RH ou prolongée
 * (ce qui la repasse « à qualifier ») ne l'est plus.
 */
export const propreSignalement = (a: Pick<Absence, 'type' | 'statut' | 'signaleParInteresse' | 'finInitiale'>) =>
  a.statut === 'signalee' && a.type === 'ABSENCE' && !!a.signaleParInteresse && !a.finInitiale;

/**
 * Annulation selon le statut et le rôle (`qui` : service RH, intéressé, manager direct) :
 * - demande en attente : l'intéressé la retire, le RH peut l'annuler ; le manager la refuse ;
 * - absence validée ou signalée qui n'a pas commencé : manager direct ou RH, et l'intéressé pour son propre signalement
 *   (`propreSignalement`) ;
 * - absence commencée ou passée : RH seul.
 */
export function droitAnnulation(a: Pick<Absence, 'du' | 'statut' | 'type' | 'signaleParInteresse' | 'finInitiale'>, today: ISODate, qui: { rh: boolean; self: boolean; manager: boolean }): DroitAnnulation {
  const ok = (libelle: string): DroitAnnulation => ({ ok: true, libelle, raison: '' });
  const non = (raison: string): DroitAnnulation => ({ ok: false, libelle: '', raison });
  if (!absenceActive(a)) return non('Absence déjà refusée ou annulée');
  if (a.statut === 'demandee') {
    if (qui.self) return ok('Retirer la demande');
    if (qui.rh) return ok('Annuler la demande');
    return non(qui.manager ? 'Demande en attente : refusez-la plutôt que de l’annuler' : 'Annulation réservée à l’intéressé ou au service RH');
  }
  if (a.du <= today) return qui.rh ? ok('Annuler l’absence') : non('Absence commencée ou passée : seul le service RH peut l’annuler');
  if (qui.rh || qui.manager || (qui.self && propreSignalement(a))) return ok(a.statut === 'signalee' && a.type === 'ABSENCE' ? 'Annuler le signalement' : 'Annuler l’absence');
  if (!qui.self) return non('Annulation réservée au manager du salarié ou au service RH');
  return non(a.statut === 'validee'
    ? 'Absence validée : demandez son annulation à votre manager ou au service RH'
    : 'Seul votre propre signalement, ni qualifié ni prolongé, se retire : demandez l’annulation à votre manager ou au service RH');
}
