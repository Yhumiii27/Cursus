// Information du salarié sur ses congés payés à son retour d'un arrêt de maladie ou d'accident (art. L3141-19-3, loi
// 2024-364) : dans le mois qui suit la reprise, l'employeur lui fait connaître le nombre de jours de congé dont il dispose
// et la date jusqu'à laquelle il peut les prendre. Cursus en fait une tâche du service RH (écran Congés & absences,
// « Informations au retour ») ; `conges.informer` (server/src/actions/information-retour.ts) envoie l'information au
// salarié, l'enregistre (table `informationsCp`) et fait courir le report de 15 mois à partir de ce jour
// (`echeanceReportArret` de rules/clotures.ts).
// - Arrêts concernés : natures de la catégorie santé (maladie, longue maladie, accident du travail ou de trajet, maladie
//   professionnelle), validées ou signalées, terminées ; une absence à qualifier l'est une fois qualifiée. Deux arrêts qui
//   se suivent (prolongation enregistrée à part, accident puis maladie) ne font qu'un retour, au dernier : l'information
//   porte sur toute la suite (`suiteArrets` : dates, jours acquis, reports échus pendant la suite).
// - Une information vaut pour la fin de l'arrêt qu'elle a connue (`au` de `informationsCp`) : un arrêt prolongé après
//   l'information (`absence.prolonger` repousse sa fin) redevient à informer à son nouveau terme.
// - Salariés : congés tenus par Cursus (pas d'intérim), présents à la reprise, arrêts terminés depuis la date d'arrêté des
//   compteurs repris de Lucca ou peu avant : retours dont le délai d'un mois n'était pas échu à cette date (les autres
//   relevaient de l'ancien outil).
import { NATURES_ABSENCE } from '../constants.ts';
import { addM } from '../dates.ts';
import type { Domain } from '../domain.ts';
import { fJ, fmtIso } from '../format.ts';
import type { Absence, Employe, ISODate } from '../types.ts';
import { absenceBloque, estNature, lendemainOuvre, periodeTexte } from './absences.ts';
import { acquisPendantArret } from './acquisition-cp.ts';
import { echeanceInformation, echeanceReportLegal } from './clotures.ts';
import { anneeCp, finPeriodeCp, periodeCp, reprise, soldePeriode } from './conges.ts';

/** Arrêt de maladie ou d'accident (catégorie santé du référentiel) : son retour appelle l'information du salarié. */
export const estArretSante = (t: string) => estNature(t) && NATURES_ABSENCE[t].categorie === 'sante';

export interface RetourAInformer {
  /** Dernier arrêt de la suite d'arrêts, celui que l'information vise. */
  a: Absence;
  /** Arrêts de la suite, du premier au dernier (`a`) ; `du` : premier jour de la suite. */
  suite: Absence[];
  du: ISODate;
  e: Employe;
  /** Jour de la reprise : premier jour ouvré après l'arrêt. */
  retour: ISODate;
  /** Information attendue au plus tard un mois après la reprise ; dépassée (`retard`) au-delà. */
  avant: ISODate;
  retard: boolean;
}

/** Arrêt suivi d'un autre arrêt sans reprise entre les deux (jour ouvré suivant au plus tard). */
const suiviDUnAutre = (d: Domain, a: Absence) => {
  const reprise = lendemainOuvre(a.au);
  return d.ds.absences.some(x => x.id !== a.id && x.empId === a.empId && absenceBloque(x) && estArretSante(x.type) && x.du <= reprise && x.au > a.au);
};

/**
 * Suite d'arrêts qui se termine par `a` : arrêts du salarié qui le précèdent sans reprise entre deux (le suivant commence
 * au plus tard le jour ouvré qui suit la fin du précédent), du premier au dernier.
 */
export function suiteArrets(d: Domain, a: Absence): Absence[] {
  const arrets = d.ds.absences.filter(x => x.empId === a.empId && absenceBloque(x) && estArretSante(x.type) && x.au <= a.au);
  const suite = [a];
  let du = a.du;
  for (;;) {
    const avant = arrets.filter(x => !suite.includes(x) && x.du < du && lendemainOuvre(x.au) >= du);
    if (!avant.length) break;
    suite.push(...avant);
    du = avant.map(x => x.du).sort()[0];
  }
  return suite.sort((x, y) => x.du.localeCompare(y.du));
}

/** Information déjà donnée pour l'arrêt `a` à sa fin actuelle (une prolongation postérieure la rend caduque). */
export const informationDonnee = (d: Domain, a: Pick<Absence, 'id' | 'au'>) =>
  (d.ds.informationsCp ?? []).find(i => i.absenceId === a.id && i.au === a.au) ?? null;

/** Retours d'arrêt dont le salarié n'a pas encore été informé, le plus ancien d'abord. */
export function retoursAInformer(d: Domain): RetourAInformer[] {
  const faites = new Set((d.ds.informationsCp ?? []).map(i => `${i.absenceId}|${i.au}`));
  const out: RetourAInformer[] = [];
  for (const a of d.ds.absences) {
    if (!estArretSante(a.type) || !absenceBloque(a) || a.au >= d.ti || faites.has(`${a.id}|${a.au}`)) continue;
    const e = d.emp(a.empId);
    if (!e || d.contratOf(e).interim) continue;
    const retour = lendemainOuvre(a.au), avant = echeanceInformationRetour(retour), arrete = d.ds.soldesReprise.find(s => s.empId === e.id)?.arreteLe;
    if ((e.fin && e.fin < retour) || (arrete && avant < arrete) || suiviDUnAutre(d, a)) continue;
    const suite = suiteArrets(d, a);
    out.push({ a, suite, du: suite[0].du, e, retour, avant, retard: d.ti > avant });
  }
  return out.sort((x, y) => x.a.au.localeCompare(y.a.au) || x.e.nom.localeCompare(y.e.nom));
}

/** L'information est due dans le mois qui suit la reprise (art. L3141-19-3). */
export const echeanceInformationRetour = (retour: ISODate): ISODate => addM(retour, 1);

export interface ContenuInformation {
  /** Période de prise en cours au jour de l'information (année de prise). */
  periode: number;
  /** Jours de CP dont le salarié dispose sur cette période (solde, congés posés déduits), à prendre jusqu'au `limite`. */
  jours: number;
  limite: ISODate;
  /** Jours acquis pendant la suite d'arrêts, toutes périodes de référence comprises. */
  arret: number;
  /** Jours non pris du fait de l'arrêt : reportés jusqu'au `echeance` (15 mois après l'information, au plus tôt ceux de la période). */
  echeance: ISODate;
}

/** Ce que l'information du jour `le` communique au salarié pour la suite d'arrêts `suite` (un seul arrêt le plus souvent). */
export function contenuInformation(d: Domain, e: Employe, suite: readonly Pick<Absence, 'id' | 'du' | 'au'>[], le: ISODate): ContenuInformation {
  const A = Math.max(anneeCp(le), reprise(d, e.id).periodeCp);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const echeance = [echeanceReportLegal(A), echeanceInformation(le)].sort().at(-1)!;
  return { periode: A, jours: Math.max(0, r2(soldePeriode(d, e, A))), limite: finPeriodeCp(A), arret: r2(suite.reduce((n, a) => n + acquisPendantArret(d, e, a), 0)), echeance };
}

/** Texte de l'information envoyée au salarié (e-mail) : jamais la nature de l'arrêt, seulement les dates de la suite. */
export function texteInformation(c: ContenuInformation, a: Pick<Absence, 'du' | 'au'>): string {
  return `À la suite de votre absence ${periodeTexte(a.du, a.au)}, voici l’état de vos congés payés (art. L3141-19-3 du Code du travail).\n`
    + `- Vous disposez de ${fJ(c.jours)} de congés payés sur la période ${periodeCp(c.periode)}, à prendre jusqu’au ${fmtIso(c.limite)}.\n`
    + `- Pendant votre absence, vous avez continué d’acquérir des congés payés : ${fJ(c.arret)}, ajoutés aux droits de leur période.\n`
    + `- Les jours que vous n’aurez pas pu prendre du fait de votre absence restent dus : ils sont reportés jusqu’au ${fmtIso(c.echeance)} au plus tard.\n`
    + 'Le détail de vos soldes est dans Cursus (Mes absences).';
}
