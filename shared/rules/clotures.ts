// Clôture des périodes de congés : congés payés au 31 mai, RTT et jours de repos au 31 décembre. Cursus la propose à
// partir du 1er juin et du 1er janvier (bandeau de l'écran Congés & absences) ; le service RH la confirme
// (`conges.cloturer`, server/src/actions/clotures.ts), tracée et sans effet si on la relance.
// - CP : aucun jour n'est perdu d'office. Le solde restant de chaque salarié est photographié et le service RH choisit,
//   ligne par ligne, le report (plafonné au solde, jusqu'au 31 mai suivant) ou la perte. Report légal imposé (perte
//   impossible) des jours liés à une absence protégée — santé (maladie, longue maladie, accident du travail ou de trajet,
//   maladie professionnelle), maternité, paternité, adoption, absence encore à qualifier : jours acquis pendant ces
//   absences sur la période de référence (`acquisPendantArrets`, rules/acquisition-cp.ts) et jours ouvrés de la période
//   de prise qu'elles ont empêché de prendre (`joursEmpeches`), dans la limite du solde ; 15 mois après la fin de la
//   période, ou 15 mois à compter de l'information du salarié à son retour si elle est plus tardive (art. L3141-2 et
//   L3141-19-1 à -3, `echeanceReportArret`). Un report légal reçu qui court
//   au-delà de la période (`estReportLegal`) est reporté de nouveau jusqu'à sa propre échéance, pour ses seuls jours
//   restants ; le reste du solde est au choix du service RH. Les reports accordés en cours de période (`report.accorder`)
//   préremplissent la ligne. Une ligne n'est pas close tant qu'une demande de CP de la période attend une décision.
// - RTT : non reportables (décision par défaut) ; la clôture photographie les soldes non pris, perdus, après le rappel
//   du placement possible sur le CET (5 jours par an), encore ouvert jusqu'à la confirmation. Un salarié dont une demande
//   de RTT de l'année attend une décision n'est pas clôturé.
// - Jours rendus à une période close (refus ou annulation d'un congé déjà décompté) : reportés sur la période suivante
//   (`recrediterPeriodesCloses`, server/src/actions/clotures.ts), jamais perdus sans décision.
// Première période proposée : celle de la date d'arrêté des compteurs repris (reprise depuis Lucca).
import type { Domain } from '../domain.ts';
import { addM } from '../dates.ts';
import type { Absence, ClotureConges, Employe, ISODate, ReportCp } from '../types.ts';
import { acquisPendantArrets, joursEmpeches } from './acquisition-cp.ts';
import { anneeCp, finPeriodeCp, periodeCp, periodeReport, reportEnAttente, reprise, rttDroit, rttInfo, soldePeriode } from './conges.ts';

/** Natures d'absence qui protègent des CP de la perte : santé, maternité, paternité, adoption, absence à qualifier. */
export { ABSENCES_PROTEGEES } from './acquisition-cp.ts';

/** Motif d'un report imposé (réservé au service RH : il laisse deviner une absence de santé). */
export const MOTIF_CLOTURE_LABEL: Record<NonNullable<ClotureConges['motif']>, string> = {
  report_legal: 'Report de 15 mois : jours acquis pendant une absence de santé, de maternité, de paternité ou d’adoption, ou qu’elle a empêché de prendre',
  report_en_cours: 'Report légal reçu, encore en cours après la période',
};

/** Échéance du report de 15 mois des CP de la période `A` (art. L3141-19-1) : 15 mois après sa fin, le 31 août A+2. */
export const echeanceReportLegal = (A: number): ISODate => `${A + 2}-08-31`;
/** Fin du report de 15 mois qui court à partir de l'information du salarié à son retour (art. L3141-19-3). */
export const echeanceInformation = (le: ISODate): ISODate => addM(le, 15);
/**
 * Échéance du report légal des CP de la période `A` pour un salarié : 15 mois après la fin de la période, ou 15 mois après
 * sa dernière information au retour d'un arrêt (`informationsCp`, depuis le début de la période de référence) si elle
 * tombe plus tard. Sans information encore donnée (arrêt en cours), la première : l'information la prolongera.
 */
export function echeanceReportArret(d: Domain, empId: number, A: number): ISODate {
  const infos = (d.ds.informationsCp ?? []).filter(i => i.empId === empId && i.le >= `${A - 1}-06-01`).map(i => echeanceInformation(i.le));
  return [echeanceReportLegal(A), ...infos].sort().at(-1)!;
}

/** Jours au demi-jour supérieur (report imposé : le plus favorable au salarié). */
const demiSup = (n: number) => Math.ceil(n * 2 - 1e-9) / 2;
/**
 * Échéance d'un report décidé par le service RH (report accordé, ou report à la clôture) des CP de la période `A` : le
 * 31 mai suivant, fin de la période qui le reçoit. Seul un report légal court au-delà.
 */
export const echeanceReport = (A: number): ISODate => finPeriodeCp(A + 1);
/**
 * Report légal : report reçu dont l'échéance n'est pas la fin de sa période (15 mois après une absence de santé, de
 * maternité ou de paternité, ou reste d'un tel report reporté à la clôture). Un report décidé par le service RH s'éteint
 * toujours le 31 mai.
 */
export const estReportLegal = (r: Pick<ReportCp, 'periode' | 'expire' | 'date' | 'sens'>) => {
  const x = periodeReport(r);
  return r.sens === 'recu' && x.expire !== finPeriodeCp(x.periode);
};

/** Arrondi au centième (compteurs repris et CET au demi-jour : aucun bruit de calcul dans les soldes photographiés). */
const c2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Salarié concerné par la clôture des CP de la période `A` : congés gérés dans Cursus (pas d'intérim), entré avant la
 * fin de la période et encore présent à son terme (un salarié sorti reçoit l'indemnité compensatrice), période qui
 * n'est pas tenue par l'ancien système (date d'arrêté des compteurs repris).
 */
export function concerneCp(d: Domain, e: Employe, A: number): boolean {
  const fin = finPeriodeCp(A);
  if (d.contratOf(e).interim || e.entree > fin || (e.fin && e.fin < fin)) return false;
  return reprise(d, e.id).periodeCp <= A;
}

/** Période de CP close pour le salarié (`conges.cloturer`) : aucun congé ne s'y pose plus. */
export const cpPeriodeClose = (d: Domain, empId: number, A: number) => d.ds.clotures.some(c => c.empId === empId && c.type === 'CP' && c.periode === A);

/** Demandes de congé (`type`) du salarié en attente de décision, sur les dates `du` … `au`. */
const enAttente = (d: Domain, empId: number, type: 'CP' | 'RTT', du: ISODate, au: ISODate): Absence[] =>
  d.ds.absences.filter(a => a.empId === empId && a.type === type && a.statut === 'demandee' && a.du <= au && a.au >= du).sort((a, b) => a.du.localeCompare(b.du));

export interface LigneClotureCp {
  e: Employe;
  /** Solde restant de la période, photographié à la clôture. */
  solde: number;
  /** Clôture déjà enregistrée pour ce salarié (relance sans effet). */
  deja: ClotureConges | null;
  /** Demandes de CP de la période en attente de décision : la ligne n'est pas close avant qu'elles soient décidées. */
  attente: Absence[];
  /** Report imposé, perte impossible pour `legal` jours. */
  impose: ClotureConges['motif'];
  /**
   * Jours protégés (absences de santé, maternité, paternité, adoption, absence à qualifier) : acquis pendant ces absences
   * sur la période de référence (`acquisArret`) et jours ouvrés de la période de prise passés en absence (`empeches`).
   */
  acquisArret: number;
  empeches: number;
  /**
   * Jours au report imposé : jours protégés (au demi-jour supérieur) et jours restants d'un report légal en cours, dans
   * la limite du solde.
   */
  legal: number;
  /** Échéance du report imposé : 15 mois (après l'information du salarié si elle est plus tardive), ou celle du report légal en cours. */
  expireLegal: ISODate | null;
  /** Jours accordés en cours de période (`report.accorder`), appliqués par la clôture. */
  accorde: number;
  /**
   * Proposition : décision (null : au service RH de choisir), jours reportés en tout (report imposé compris) ; le report
   * décidé par le service RH court jusqu'au 31 mai suivant (`echeanceReport`).
   */
  proposition: { decision: 'reporter' | 'perdre' | null; jours: number };
}

/**
 * Lignes de la clôture des CP de la période `A` (année de prise : du 1er juin A au 31 mai A+1), dans l'ordre alphabétique.
 * La proposition dépend du réglage `politiqueReportCp` : sans proposition (au cas par cas, défaut) ou report du solde.
 */
export function lignesClotureCp(d: Domain, A: number): LigneClotureCp[] {
  const debut = `${A}-06-01`, fin = finPeriodeCp(A);
  return d.ds.employes.filter(e => concerneCp(d, e, A)).sort((a, b) => a.nom.localeCompare(b.nom)).map(e => {
    const deja = d.ds.clotures.find(c => c.empId === e.id && c.type === 'CP' && c.periode === A) ?? null;
    const solde = c2(soldePeriode(d, e, A));
    const attente = enAttente(d, e.id, 'CP', debut, fin);
    // Jours protégés : acquis pendant les arrêts (période de référence), empêchés pendant la période de prise.
    const acquisArret = c2(acquisPendantArrets(d, e, A)), empeches = joursEmpeches(d, e, A);
    const protege = demiSup(acquisArret + empeches);
    // Reports légaux reçus sur la période qui courent au-delà : leurs jours suivent leur échéance, comptés dans le solde
    // restant en priorité (le plus favorable au salarié).
    const enCours = d.ds.reports.filter(r => r.empId === e.id && r.sens === 'recu').map(r => ({ r, ...periodeReport(r) }))
      .filter(x => x.periode === A && x.expire > fin);
    const joursEnCours = enCours.reduce((n, x) => n + x.r.jours, 0), expireEnCours = enCours.map(x => x.expire).sort().at(-1) ?? null;
    const impose = solde <= 0 ? null : protege > 0 ? 'report_legal' as const : enCours.length ? 'report_en_cours' as const : null;
    const legal = impose === 'report_legal' ? c2(Math.min(solde, protege + joursEnCours)) : impose ? c2(Math.min(solde, joursEnCours)) : 0;
    const expireLegal = impose === 'report_legal' ? [echeanceReportArret(d, e.id, A), expireEnCours ?? ''].sort().at(-1)! : impose ? expireEnCours : null;
    const libre = c2(solde - legal);
    const accordes = d.ds.reports.filter(r => r.empId === e.id && reportEnAttente(d, r, A + 1));
    const accorde = c2(accordes.reduce((n, r) => n + r.jours, 0));
    const choisi = accorde > 0 ? Math.min(accorde, libre) : d.ds.settings.politiqueReportCp === 'proposer_report' ? libre : null;
    const proposition: LigneClotureCp['proposition'] = solde <= 0 ? { decision: null, jours: 0 }
      : choisi != null || legal > 0 ? { decision: 'reporter', jours: c2(legal + (choisi ?? 0)) }
      : { decision: null, jours: solde };
    return { e, solde, deja, attente, impose, acquisArret, empeches, legal, expireLegal, accorde, proposition };
  });
}

/** Salarié concerné par la clôture des RTT de l'année `Y` : RTT ou jours de repos, présent au 31 décembre, année tenue par Cursus. */
export function concerneRtt(d: Domain, e: Employe, Y: number): boolean {
  const fin = `${Y}-12-31`;
  if (rttDroit(d, e, Y) == null || e.entree > fin || (e.fin && e.fin < fin)) return false;
  return reprise(d, e.id).anneeRtt <= Y;
}

export interface LigneClotureRtt {
  e: Employe;
  /** Droit, jours pris et posés de l'année (`rttInfo`), solde non pris, perdu à la clôture. */
  info: NonNullable<ReturnType<typeof rttInfo>>;
  solde: number;
  deja: ClotureConges | null;
  /** Demandes de RTT de l'année en attente de décision : le salarié n'est pas clôturé avant qu'elles soient décidées. */
  attente: Absence[];
  /** RTT encore plaçables sur le CET avant la confirmation (5 par an). */
  cet: number;
}

/** Lignes de la clôture des RTT de l'année `Y`, dans l'ordre alphabétique. */
export function lignesClotureRtt(d: Domain, Y: number): LigneClotureRtt[] {
  return d.ds.employes.filter(e => concerneRtt(d, e, Y)).sort((a, b) => a.nom.localeCompare(b.nom)).map(e => {
    const info = rttInfo(d, e, Y)!;
    const deja = d.ds.clotures.find(c => c.empId === e.id && c.type === 'RTT' && c.periode === Y) ?? null;
    const solde = c2(info.solde);
    const attente = enAttente(d, e.id, 'RTT', `${Y}-01-01`, `${Y}-12-31`);
    return { e, info, solde, deja, attente, cet: deja ? 0 : Math.max(0, Math.min(5 - info.cetRtt, solde)) };
  });
}

/** Clôture proposée : période terminée dont des salariés concernés ne sont pas encore clôturés. */
export interface ClotureAFaire {
  type: 'CP' | 'RTT';
  periode: number;
  /** « Congés payés 2026-2027 », « RTT 2026 ». */
  libelle: string;
  /** Dernier jour de la période. */
  fin: ISODate;
  /** Salariés concernés pas encore clôturés, sur `total`. */
  restants: number;
  total: number;
}

/** Nombre de périodes passées encore proposées : au-delà, une période non clôturée n'est plus rappelée. */
const RAPPEL_PERIODES = 3;

/**
 * Clôtures à faire aujourd'hui : périodes de CP terminées au 31 mai et années de RTT terminées au 31 décembre, depuis la
 * première tenue par Cursus (date d'arrêté des compteurs repris), dont un salarié concerné n'est pas encore clôturé.
 */
export function cloturesAFaire(d: Domain): ClotureAFaire[] {
  const out: ClotureAFaire[] = [];
  if (!d.ds.employes.length) return out;
  const R = d.ds.employes.map(e => reprise(d, e.id));
  const A0 = anneeCp(d.ti);
  for (let A = Math.max(Math.min(...R.map(r => r.periodeCp)), A0 - RAPPEL_PERIODES); A < A0; A++) {
    const l = lignesClotureCp(d, A);
    const restants = l.filter(x => !x.deja).length;
    if (restants) out.push({ type: 'CP', periode: A, libelle: `Congés payés ${periodeCp(A)}`, fin: finPeriodeCp(A), restants, total: l.length });
  }
  for (let Y = Math.max(Math.min(...R.map(r => r.anneeRtt)), d.year - RAPPEL_PERIODES); Y < d.year; Y++) {
    const l = lignesClotureRtt(d, Y);
    const restants = l.filter(x => !x.deja).length;
    if (restants) out.push({ type: 'RTT', periode: Y, libelle: `RTT et jours de repos ${Y}`, fin: `${Y}-12-31`, restants, total: l.length });
  }
  return out;
}
