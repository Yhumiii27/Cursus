// Clôture des périodes de congés : congés payés au 31 mai, RTT et jours de repos au 31 décembre. Cursus la propose à
// partir du 1er juin et du 1er janvier (bandeau de l'écran Congés & absences) ; le service RH la confirme
// (`conges.cloturer`, server/src/actions/clotures.ts), tracée et sans effet si on la relance.
// - CP : aucun jour n'est perdu d'office. Le solde restant de chaque salarié est photographié et le service RH choisit,
//   ligne par ligne, le report (plafonné au solde, jusqu'au 31 mai suivant) ou la perte. Perte impossible après une
//   absence de santé (maladie, longue maladie, accident du travail ou de trajet, maladie professionnelle), un congé de
//   maternité, de paternité ou d'adoption, ou une absence encore à qualifier dans la période : report de 15 mois proposé
//   (art. L3141-2 et L3141-19-1 à -3), en attendant le calcul des reports légaux ; de même tant qu'un report reçu court
//   au-delà de la période. Les reports accordés en cours de période (`report.accorder`) préremplissent la ligne.
// - RTT : non reportables (décision par défaut) ; la clôture photographie les soldes non pris, perdus, après le rappel
//   du placement possible sur le CET (5 jours par an), encore ouvert jusqu'à la confirmation.
// Première période proposée : celle de la date d'arrêté des compteurs repris (reprise depuis Lucca).
import type { Domain } from '../domain.ts';
import type { AbsenceType, ClotureConges, Employe, ISODate } from '../types.ts';
import { anneeCp, finPeriodeCp, periodeCp, periodeReport, reportEnAttente, reprise, rttDroit, rttInfo, soldePeriode } from './conges.ts';

/** Natures d'absence qui interdisent la perte des CP de la période : santé, maternité, paternité, adoption, absence à qualifier. */
export const ABSENCES_PROTEGEES: readonly AbsenceType[] = ['MALADIE', 'ALD', 'AT', 'TRAJET', 'MP', 'MATERNITE', 'PATERNITE', 'ADOPTION', 'ABSENCE'];

/** Motif d'un report imposé (réservé au service RH : il laisse deviner une absence de santé). */
export const MOTIF_CLOTURE_LABEL: Record<NonNullable<ClotureConges['motif']>, string> = {
  report_legal: 'Report de 15 mois : absence de santé, maternité, paternité ou adoption dans la période',
  report_en_cours: 'Report légal reçu, encore en cours après la période',
};

/** Échéance du report de 15 mois des CP de la période `A` (art. L3141-19-1) : 15 mois après sa fin, le 31 août A+2. */
export const echeanceReportLegal = (A: number): ISODate => `${A + 2}-08-31`;
/** Échéance la plus lointaine admise pour un report des CP de la période `A` : la fin de la période d'après. */
export const echeanceMax = (A: number): ISODate => finPeriodeCp(A + 2);

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

export interface LigneClotureCp {
  e: Employe;
  /** Solde restant de la période, photographié à la clôture. */
  solde: number;
  /** Clôture déjà enregistrée pour ce salarié (relance sans effet). */
  deja: ClotureConges | null;
  /** Report imposé, perte impossible. */
  impose: ClotureConges['motif'];
  /** Échéance la plus proche admise : fin de la période suivante, 15 mois pour un report légal. */
  echeanceMin: ISODate;
  /** Jours accordés en cours de période (`report.accorder`), appliqués par la clôture. */
  accorde: number;
  /** Proposition : décision (null : au service RH de choisir), jours reportés et échéance. */
  proposition: { decision: 'reporter' | 'perdre' | null; jours: number; expire: ISODate };
}

/**
 * Lignes de la clôture des CP de la période `A` (année de prise : du 1er juin A au 31 mai A+1), dans l'ordre alphabétique.
 * La proposition dépend du réglage `politiqueReportCp` : sans proposition (au cas par cas, défaut) ou report du solde.
 */
export function lignesClotureCp(d: Domain, A: number): LigneClotureCp[] {
  const debut = `${A}-06-01`, fin = finPeriodeCp(A), normale = finPeriodeCp(A + 1);
  return d.ds.employes.filter(e => concerneCp(d, e, A)).sort((a, b) => a.nom.localeCompare(b.nom)).map(e => {
    const deja = d.ds.clotures.find(c => c.empId === e.id && c.type === 'CP' && c.periode === A) ?? null;
    const solde = c2(soldePeriode(d, e, A));
    const sante = d.ds.absences.some(a => a.empId === e.id && ABSENCES_PROTEGEES.includes(a.type) && (a.statut === 'validee' || a.statut === 'signalee')
      && a.du <= fin && a.au >= debut);
    const reportsRecus = d.ds.reports.filter(r => r.empId === e.id && r.sens === 'recu').map(periodeReport);
    const enCours = reportsRecus.filter(x => x.periode === A && x.expire > fin).map(x => x.expire).sort().at(-1) ?? null;
    const impose = sante ? 'report_legal' as const : enCours ? 'report_en_cours' as const : null;
    const echeanceMin = [normale, sante ? echeanceReportLegal(A) : '', enCours ?? ''].sort().at(-1)!;
    const accordes = d.ds.reports.filter(r => r.empId === e.id && reportEnAttente(d, r, A + 1));
    const accorde = c2(accordes.reduce((n, r) => n + r.jours, 0));
    const expireAccorde = [echeanceMin, ...accordes.map(r => periodeReport(r).expire)].sort().at(-1)!;
    const proposition: LigneClotureCp['proposition'] = solde <= 0 ? { decision: null, jours: 0, expire: normale }
      : impose ? { decision: 'reporter', jours: solde, expire: echeanceMin }
      : accorde > 0 ? { decision: 'reporter', jours: Math.min(accorde, solde), expire: expireAccorde }
      : d.ds.settings.politiqueReportCp === 'proposer_report' ? { decision: 'reporter', jours: solde, expire: normale }
      : { decision: null, jours: solde, expire: normale };
    return { e, solde, deja, impose, echeanceMin, accorde, proposition };
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
  /** RTT encore plaçables sur le CET avant la confirmation (5 par an). */
  cet: number;
}

/** Lignes de la clôture des RTT de l'année `Y`, dans l'ordre alphabétique. */
export function lignesClotureRtt(d: Domain, Y: number): LigneClotureRtt[] {
  return d.ds.employes.filter(e => concerneRtt(d, e, Y)).sort((a, b) => a.nom.localeCompare(b.nom)).map(e => {
    const info = rttInfo(d, e, Y)!;
    const deja = d.ds.clotures.find(c => c.empId === e.id && c.type === 'RTT' && c.periode === Y) ?? null;
    const solde = c2(info.solde);
    return { e, info, solde, deja, cet: deja ? 0 : Math.max(0, Math.min(5 - info.cetRtt, solde)) };
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
