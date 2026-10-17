// Acquisition des congés payés mois par mois, absences comprises (loi 2024-364 du 22 avril 2024).
// - Un mois de la période de référence (1er juin A-1 au 31 mai A) compte si le salarié est sous contrat à la mi-mois
//   (`monthsPresent`, rules/conges.ts), même en arrêt : 25/12 de jour ouvré (CCN : 25 jours ouvrés par an).
// - Effet de chaque absence en vigueur (validée ou signalée), selon sa nature (`cpAcquisition` de NatureDef) :
//   `assimile` : travail effectif (accident du travail ou de trajet, maladie professionnelle sans limite de durée,
//   maternité, paternité, adoption, événements familiaux ; art. L3141-5) ;
//   `maladie` : 2 jours ouvrables par mois d'arrêt, soit 5/3 de jour ouvré, 24 jours ouvrables (20 ouvrés) par période au
//   plus pour cette part (art. L3141-5-1) ; réglage `cpMaladie` « assimilé » si un accord ou la CCN est plus favorable.
//   Une absence encore à qualifier (« ABSENCE ») est traitée comme une maladie, ce qui la protège ;
//   `non` : congé parental, sans solde, absence injustifiée, enfant malade — le mois est réduit au prorata des jours
//   d'absence, sauf s'il reste l'équivalent d'un mois de travail : 4 semaines ou 24 jours ouvrables (art. L3141-4).
// - Les droits de la période sont arrondis au jour supérieur (art. L3141-7), comme avant.
// - Part acquise pendant un arrêt protégé (santé, maternité, paternité, adoption, absence à qualifier) : base du report
//   de 15 mois à la clôture (rules/clotures.ts) et de l'information du salarié à son retour (rules/information-retour.ts).
// Calcul mémorisé par instantané (`Domain`) : l'imputation des congés (`imputer`) le demande pour chaque jour posé.
import type { Domain } from '../domain.ts';
import { addD, addM, isFerie, weekday } from '../dates.ts';
import type { Absence, AbsenceType, CpAcquisition, Employe, ISODate } from '../types.ts';
import { absenceBloque, estConge, natureDef } from './absences.ts';

/** Jours ouvrés acquis par mois de travail effectif (25 par an). */
export const CP_PAR_MOIS = 25 / 12;
/** Jours ouvrés acquis par mois d'arrêt maladie au minimum légal : 2 jours ouvrables (art. L3141-5-1), soit 5/3 ouvré. */
export const CP_MALADIE_PAR_MOIS = 5 / 3;
/** Plafond de la part maladie par période : 24 jours ouvrables, soit 20 jours ouvrés. */
export const CP_MALADIE_PLAFOND = 20;

/**
 * Absences protégées : santé (maladie, longue maladie, accident du travail ou de trajet, maladie professionnelle),
 * maternité, paternité, adoption, absence encore à qualifier. Les jours acquis pendant ces absences, ou qu'elles ont
 * empêché de prendre, ne se perdent pas à la clôture : report de 15 mois (art. L3141-2, L3141-19-1).
 */
export const ABSENCES_PROTEGEES: readonly AbsenceType[] = ['MALADIE', 'ALD', 'AT', 'TRAJET', 'MP', 'MATERNITE', 'PATERNITE', 'ADOPTION', 'ABSENCE'];

/**
 * Effet d'une absence sur l'acquisition (null : congé, travail effectif). Absence masquée transmise au profil paie : son
 * effet (`cpAcquisition`). Une absence à qualifier, ou dont la nature médicale est masquée, compte comme une maladie.
 */
export function effetAcquisition(a: Pick<Absence, 'type' | 'cpAcquisition'>): CpAcquisition | null {
  if (estConge(a.type)) return null;
  return a.cpAcquisition ?? natureDef(a.type)?.cpAcquisition ?? 'maladie';
}

/** Année de prise des CP acquis le jour `s` : le 1er juin A-1 au 31 mai A acquièrent les CP pris à partir du 1er juin A. */
export const periodeAcquisition = (s: ISODate) => Number(s.slice(0, 4)) + (s.slice(5) >= '06-01' ? 1 : 0);

export interface AcquisitionPeriode {
  /** Jours acquis chaque mois, du 1er juin A-1 au 31 mai A (12 valeurs, avant arrondi). */
  mois: number[];
  /** Somme des mois, avant arrondi. */
  total: number;
  /** Part maladie retenue (après le plafond de 20 jours ouvrés au minimum légal). */
  maladie: number;
  /** Jours acquis pendant chaque absence protégée (identifiant de l'absence → jours). */
  arrets: Map<number, number>;
}

const memo = new WeakMap<Domain, Map<string, AcquisitionPeriode>>();

/** Acquisition de la période `A` (année de prise), mois par mois, absences en vigueur comprises. Mémorisée par instantané. */
export function acquisitionPeriode(d: Domain, e: Employe, A: number): AcquisitionPeriode {
  let parDomaine = memo.get(d);
  if (!parDomaine) memo.set(d, parDomaine = new Map());
  // Fiche passée modifiée (date d'entrée ramenée à un changement de régime…) : clé sur ses dates.
  const cle = `${e.id}|${e.entree}|${e.fin ?? ''}|${A}`;
  let r = parDomaine.get(cle);
  if (!r) parDomaine.set(cle, r = calculer(d, e, A));
  return r;
}

function calculer(d: Domain, e: Employe, A: number): AcquisitionPeriode {
  const debut: ISODate = `${A - 1}-06-01`, fin: ISODate = `${A}-05-31`;
  const absences = d.ds.absences.filter(a => a.empId === e.id && absenceBloque(a) && a.du <= fin && a.au >= debut && effetAcquisition(a));
  const assimilee = d.ds.settings.cpMaladie === 'assimile';
  const taux = assimilee ? CP_PAR_MOIS : CP_MALADIE_PAR_MOIS, plafond = assimilee ? Infinity : CP_MALADIE_PLAFOND;
  const mois: number[] = [], arrets = new Map<number, number>();
  const credite = (id: number, n: number) => { if (n > 0) arrets.set(id, (arrets.get(id) ?? 0) + n); };
  let maladie = 0;
  for (let k = 0; k < 12; k++) {
    const m0 = addM(debut, k), m1 = addD(addM(debut, k + 1), -1), mid = addD(m0, 14);
    if (!(e.entree <= mid && (!e.fin || e.fin >= mid))) { mois.push(0); continue; }
    const dansMois = absences.filter(a => a.du <= m1 && a.au >= m0);
    if (!dansMois.length) { mois.push(CP_PAR_MOIS); continue; }
    // Jours du mois par effet ; jours protégés par absence (maladie à part : ils ne sont pas du travail effectif).
    let N = 0, non = 0, mal = 0, ouvrables = 0;
    const malDe = new Map<number, number>(), protDe = new Map<number, number>();
    for (let s = m0; s <= m1; s = addD(s, 1)) {
      N++;
      const a = dansMois.find(x => x.du <= s && x.au >= s);
      const effet = a ? effetAcquisition(a) : null;
      if (effet === 'non') { non++; continue; }
      if (effet === 'maladie') { mal++; malDe.set(a!.id, (malDe.get(a!.id) ?? 0) + 1); continue; }
      if (a && ABSENCES_PROTEGEES.includes(a.type)) protDe.set(a.id, (protDe.get(a.id) ?? 0) + 1);
      if (weekday(s) < 6 && !isFerie(s)) ouvrables++;
    }
    const travail = N - non - mal;
    // Équivalence (art. L3141-4) : 4 semaines ou 24 jours ouvrables de travail effectif valent un mois entier.
    const entier = !non && !mal || travail >= 28 || ouvrables >= 24;
    const base = entier ? CP_PAR_MOIS : CP_PAR_MOIS * travail / N;
    const voulu = entier ? 0 : taux * mal / N, garde = Math.min(voulu, Math.max(0, plafond - maladie));
    maladie += garde;
    mois.push(Math.min(CP_PAR_MOIS, base + garde));
    // Part de chaque arrêt : la base au prorata de ses jours de travail effectif, la part maladie au prorata de ses jours.
    protDe.forEach((n, id) => credite(id, base * n / travail));
    malDe.forEach((n, id) => credite(id, garde * n / mal));
  }
  return { mois, total: mois.reduce((s, x) => s + x, 0), maladie, arrets };
}

/** Jours acquis sur la période `A`, arrondis au jour supérieur (art. L3141-7). */
export const joursAcquis = (d: Domain, e: Employe, A: number) => Math.ceil(acquisitionPeriode(d, e, A).total - 1e-9);

/** Jours acquis sur les `n` premiers mois de la période `A` (période en cours d'acquisition, anticipation). */
export const acquisMois = (d: Domain, e: Employe, A: number, n: number) =>
  acquisitionPeriode(d, e, A).mois.slice(0, Math.max(0, Math.min(12, n))).reduce((s, x) => s + x, 0);

/** Jours acquis sur la période `A` pendant des absences protégées (base du report de 15 mois). */
export function acquisPendantArrets(d: Domain, e: Employe, A: number): number {
  let n = 0;
  acquisitionPeriode(d, e, A).arrets.forEach(x => { n += x; });
  return n;
}

/** Jours acquis pendant une absence protégée, toutes périodes de référence qu'elle traverse comprises. */
export function acquisPendantArret(d: Domain, e: Employe, a: Pick<Absence, 'id' | 'du' | 'au'>): number {
  let n = 0;
  for (let A = periodeAcquisition(a.du); A <= periodeAcquisition(a.au); A++) n += acquisitionPeriode(d, e, A).arrets.get(a.id) ?? 0;
  return n;
}

/**
 * Jours ouvrés de la période de prise `A` (1er juin A au 31 mai A+1) passés en absence protégée : jours de congé que
 * l'arrêt a empêché de prendre (art. L3141-19-1), comptés dans le report imposé à la clôture.
 */
export function joursEmpeches(d: Domain, e: Employe, A: number): number {
  const debut: ISODate = `${A}-06-01`, fin: ISODate = `${A + 1}-05-31`;
  return d.ds.absences.filter(a => a.empId === e.id && absenceBloque(a) && ABSENCES_PROTEGEES.includes(a.type) && a.du <= fin && a.au >= debut)
    .reduce((n, a) => n + d.countDays(e, a.du < debut ? debut : a.du, a.au > fin ? fin : a.au, 'CP'), 0);
}
