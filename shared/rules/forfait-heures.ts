// Forfait annuel en heures (t044, lot 12, chantier C1) : régularisation de fin de période de référence. Partagé par les
// actions de clôture (server/src/actions/forfait-heures.ts), la famille « forfaitHeures » du registre des éléments de lot
// (server/src/forfait-heures-paie.ts) et, à l'étape 2, les écrans (bandeau de clôture, récapitulatif de Temps, fiche).
// - Période de référence : 12 mois à compter de `forfaitHeuresDebutPeriode` (« 01-01 » : l'année civile), la référence
//   de l'accord exigée pour une autre date (COHERENCE de shared/reglages.ts). Suivi borné par `forfaitHeuresDebutSuivi`
//   (mise en service, 1er janvier 2027) : le réalisé d'avant n'est pas dans Cursus (2026 est clos à la main dans Sage), une
//   période commencée avant est signalée « partielle ».
// - Plage clôturée : jours sous forfait annuel en heures (historique des contrats) de max(début de période, entrée, début du
//   suivi) à min(fin de période, sortie, veille de l'avenant qui fait quitter le forfait). Un avenant qui fait quitter le
//   forfait clôt la plage à sa veille ; la sortie, à sa date (le lot du solde de sortie l'emporte).
// - Cible : forfait au prorata des jours calendaires de chaque segment (un changement de forfait en cours de plage fait
//   deux segments), moins les absences déduites : toutes celles qui ne sont pas comprises dans les 1 607 h (CP légaux,
//   jours fériés chômés et journée de solidarité le sont), liste réglable (`forfaitHeuresAbsencesDeduites`), chaque jour
//   ouvré d'absence (lundi à vendredi hors férié chômé et journée de solidarité, demi-journée pour moitié) compté au forfait
//   divisé par les jours ouvrés théoriques de la période (jours ouvrés hors fériés chômés, moins 25 jours de CP : environ
//   7 h pour 1 607 h ; réponse du propriétaire du 1er novembre 2026), ou à la durée de l'accord (`forfaitHeuresJour`).
//   Seul le total est rendu et stocké, jamais la nature d'une absence.
// - Réalisé : heures des feuilles validées décomptées au forfait annuel (régime figé de chaque feuille, comme le forfait
//   jours), jour par jour dans la plage : une semaine à 35 h dont les heures supplémentaires ont déjà été payées n'y entre
//   jamais.
// - Écart (réalisé moins cible nette) :
//   - forfait de 1 607 h ou plus : heures au-delà du forfait, HFA25 jusqu'à `forfaitHeuresSeuil25` heures (8 h) par semaine
//     travaillée sous forfait, HFA50 au-delà (art. L3121-28, L3121-33 et L3121-36 ; ventilation de l'accord, à confirmer) ;
//   - forfait inférieur (temps partiel annualisé, art. L3123-1) : heures complémentaires, HCA10 jusqu'au dixième de la cible,
//     HCA25 au-delà (art. L3123-29) ; au-delà du plafond (le dixième, le tiers avec un accord : `plafondComplementaires`),
//     alerte ; un réalisé qui atteint la durée légale au prorata (1 607 h sur une période entière) bloque la clôture
//     (art. L3123-9 : requalification à examiner) ;
//   - écart négatif : heures non réalisées, à titre d'information, jamais émises.
// - Alertes (sans blocage) : période partielle (commencée avant le début du suivi), droits à congés payés incomplets
//   (embauche récente : cible à vérifier, sans calcul automatique), salarié non cadre (art. L3121-56 ; à défaut,
//   aménagement sur l'année, art. L3121-44), forfait inférieur à 1 607 h (mentions du contrat, art. L3123-6).
// - Blocages : plage pas terminée, feuille de la plage non validée, semaine sans feuille ni absence, durée légale atteinte
//   par un temps partiel.
// - Ligne enregistrée (table `cloturesForfaitHeures`) : « à revoir » quand une feuille de la plage a été rouverte après la
//   confirmation, n'est plus validée, ou quand le réalisé recalculé diffère de celui photographié (la ligne n'est pas
//   modifiée : l'administrateur RH la rouvre).
// - Paie : HFA25, HFA50, HCA10, HCA25 (rubriques désactivées par défaut : « à saisir dans Sage »), émises au mois de la
//   confirmation ou au dernier mois de la plage (`forfaitHeuresEmission`), un mois clos partant sur la période ouverte ; une
//   plage close par la sortie part dans le lot du solde de sortie (mois de la sortie). Une ligne rouverte après sa
//   transmission repart en nouvelle version, dont seul l'écart avec la version transmise est émis (lot correctif).
// - Contingent : heures HFA des lignes confirmées imputées sur le contingent annuel (année de la fin de la plage) et sa
//   contrepartie en repos, seulement avec `forfaitHeuresContingent` (désactivé tant que la paie ne l'a pas confirmé).
import { addD, addM, estJourneeSolidarite, isFerie, isoParis, isValidDate, joursSemaine, mondayOf, parse, weekday } from '../dates.ts';
import type { Domain } from '../domain.ts';
import { fH, fmtIso } from '../format.ts';
import type { AbsenceType, Employe, FeuilleTemps, ISODate, Settings } from '../types.ts';
import { absenceBloque } from './absences.ts';
import { moities } from './demi-journees.ts';
import { segmentsContrat } from './historique-contrat.ts';
import { plafondComplementaires } from './majorations.ts';
import { matriculeAffiche } from './matricules.ts';
import { moisDe, periodeOuverte, type RubriqueVue } from './paie.ts';
import { calcSheet } from './temps.ts';

/** Durée légale annuelle (art. L3121-41) : CP légaux, fériés chômés et journée de solidarité compris. */
export const DUREE_LEGALE_ANNUELLE = 1607;
/** Jours ouvrés de congés payés légaux compris dans la durée annuelle (5 semaines). */
export const JOURS_CP_LEGAUX = 25;
/** Début du suivi par défaut : mise en service de Cursus (le réalisé de 2026 n'y est pas repris). */
export const DEBUT_SUIVI_DEFAUT = '2027-01-01';
/** Heures par semaine travaillée majorées de 25 % (art. L3121-36, de la 36e à la 43e heure) avant la tranche à 50 %. */
export const SEUIL_25_DEFAUT = 8;

/** Rubriques de paie de la régularisation, dans l'ordre (RUBRIQUES_PAIE, désactivées par défaut). */
export const RUBRIQUES_FORFAIT_HEURES = ['HFA25', 'HFA50', 'HCA10', 'HCA25'] as const;
export type RubriqueForfaitHeures = typeof RUBRIQUES_FORFAIT_HEURES[number];
/** Colonne de la ligne qui porte chaque rubrique. */
export const COLONNE_RUBRIQUE: Record<RubriqueForfaitHeures, 'hfa25' | 'hfa50' | 'hca10' | 'hca25'> = { HFA25: 'hfa25', HFA50: 'hfa50', HCA10: 'hca10', HCA25: 'hca25' };

/**
 * Natures d'absence déduites de la cible par défaut : toutes, sauf les congés payés (légaux, déjà compris dans les 1 607 h ;
 * des congés conventionnels saisis à part en CP ne sont pas déduits, à confirmer avec l'accord). Liste réglable.
 */
export const ABSENCES_DEDUITES_DEFAUT: readonly AbsenceType[] = [
  'RTT', 'RECUP', 'CET', 'MALADIE', 'ALD', 'AT', 'TRAJET', 'MP', 'MATERNITE', 'PATERNITE', 'ADOPTION', 'PARENTAL', 'MARIAGE', 'MARIAGE_ENFANT', 'NAISSANCE',
  'DECES_ENFANT', 'DECES_ENFANT_JEUNE', 'DEUIL_ENFANT', 'DECES_PROCHE', 'HANDICAP_ENFANT', 'ENFANT_MALADE', 'SANS_SOLDE', 'INJUSTIFIEE', 'ABSENCE',
];
/** Natures qu'on peut cocher : les mêmes, plus les CP (un accord peut prévoir de les déduire). */
export const ABSENCES_DEDUCTIBLES: readonly AbsenceType[] = ['CP', ...ABSENCES_DEDUITES_DEFAUT];

/** Émission des heures de la clôture : mois de la confirmation, ou dernier mois de la plage clôturée. */
export type EmissionForfaitHeures = 'cloture' | 'periode';
/** Statut d'une ligne de clôture : à confirmer (rouverte avant transmission), confirmée, annulée. */
export type StatutClotureForfait = 'proposee' | 'confirmee' | 'annulee';
/** Fin d'une plage : fin de la période de référence, sortie du salarié, avenant qui fait quitter le forfait. */
export type MotifFinForfait = 'periode' | 'sortie' | 'avenant';

/**
 * Ligne de clôture d'une plage sous forfait (table `cloturesForfaitHeures`) : salarié, plage (`debut` à `fin`) et ce qui la
 * termine, version (1, puis une par réouverture après transmission, `remplaceId` : version transmise qu'elle corrige) ;
 * photographie en heures (forfait, cible, total des absences déduites sans nature, réalisé, heures par rubrique, heures non
 * réalisées) ; confirmation, lot de paie (`lotId`), import confirmé (`sage`) ou réglé hors fichier faute de rubrique active
 * (`horsFichier`) ; réouverture et annulation datées, signées et motivées (textes de l'administrateur RH, jamais au journal
 * ni hors du service RH).
 */
export interface ClotureForfaitHeures {
  id: number; empId: number; debut: ISODate; fin: ISODate; motifFin: MotifFinForfait; version: number; remplaceId: number | null;
  forfait: number; cible: number; absences: number; realise: number;
  hfa25: number; hfa50: number; hca10: number; hca25: number; nonRealise: number;
  statut: StatutClotureForfait;
  confirmeeLe: string | null; confirmeePar: string | null;
  lotId: number | null; sage: boolean; horsFichier: boolean;
  rouverteLe: string | null; rouvertePar: string | null; rouverteMotif: string | null;
  annuleeLe: string | null; annuleePar: string | null; annuleeMotif: string | null;
}

/**
 * Quantité d'une ligne de clôture dans un lot de paie (rubrique HFA25, HFA50, HCA10 ou HCA25), partie sur la période
 * `periode` ; `codeSage` null : rubrique désactivée (ou écart négatif refusé par le format du fichier), à saisir dans Sage.
 * `correctif` : écart d'une version qui en remplace une transmise.
 */
export interface ElementForfaitHeuresPaie {
  cloture: number; empId: number; matricule: string; periode: string; rubrique: string; codeSage: string | null; quantite: number;
  debut: ISODate; fin: ISODate; version: number; correctif?: true;
}

type ReglagesForfaitHeures = Partial<Pick<Settings, 'forfaitHeuresDebutPeriode' | 'forfaitHeuresDebutSuivi' | 'forfaitHeuresAccord' | 'forfaitHeuresSeuil25'
  | 'forfaitHeuresAbsencesDeduites' | 'forfaitHeuresJour' | 'forfaitHeuresEmission' | 'forfaitHeuresContingent' | 'plafondHeuresComplementaires' | 'heuresComplementairesAccord' | 'clotureJour'>>;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Jours calendaires de `du` à `au` compris. */
const joursEntre = (du: ISODate, au: ISODate) => Math.round((parse(au).getTime() - parse(du).getTime()) / 864e5) + 1;
const maxIso = (...l: (ISODate | null | undefined)[]) => l.filter((x): x is ISODate => !!x).sort().at(-1)!;
const minIso = (...l: (ISODate | null | undefined)[]) => l.filter((x): x is ISODate => !!x).sort()[0];

// — Période de référence et plages sous forfait —

export interface PeriodeForfait { debut: ISODate; fin: ISODate }

/** Début du suivi dans Cursus (réglage, date de mise en service par défaut). */
export const debutSuivi = (s: ReglagesForfaitHeures | undefined): ISODate =>
  (s?.forfaitHeuresDebutSuivi && isValidDate(s.forfaitHeuresDebutSuivi) ? s.forfaitHeuresDebutSuivi : DEBUT_SUIVI_DEFAUT);

/** Période de référence (12 mois) qui contient `jour`, d'après le jour de début réglé (« MM-JJ », le 1er janvier par défaut). */
export function periodeReference(s: ReglagesForfaitHeures | undefined, jour: ISODate): PeriodeForfait {
  const mmjj = s?.forfaitHeuresDebutPeriode && /^\d{2}-\d{2}$/.test(s.forfaitHeuresDebutPeriode) ? s.forfaitHeuresDebutPeriode : '01-01';
  const an = Number(jour.slice(0, 4));
  const debut = `${an}-${mmjj}` <= jour ? `${an}-${mmjj}` : `${an - 1}-${mmjj}`;
  return { debut, fin: addD(`${Number(debut.slice(0, 4)) + 1}-${mmjj}`, -1) };
}

/** Segment d'une plage sous forfait : jours de `du` à `au` compris, sous un même forfait annuel (heures). */
export interface SegmentForfait { du: ISODate; au: ISODate; forfait: number; cadre: boolean }

/** Plage clôturée : segments contigus sous forfait annuel, et ce qui la termine. */
export interface PlageForfait { debut: ISODate; fin: ISODate; motifFin: MotifFinForfait; segments: SegmentForfait[]; partielle: boolean }

/**
 * Plages sous forfait annuel en heures du salarié dans la période de référence `ref`, bornées par l'entrée, le début du
 * suivi et la sortie (fin de contrat). Régime de chaque période : historique des contrats (une période de régime inconnu,
 * antérieure à l'historique, compte avec celui de la fiche, comme `cumulAnnuel`).
 */
export function plagesForfait(d: Domain, e: Employe, ref: PeriodeForfait): PlageForfait[] {
  const suivi = debutSuivi(d.ds.settings);
  const bas = maxIso(ref.debut, e.entree, suivi), haut = minIso(ref.fin, e.fin);
  if (!haut || bas > haut) return [];
  const segs = segmentsContrat(d, e);
  const sous: SegmentForfait[] = [];
  segs.forEach((s, i) => {
    const du = maxIso(s.du, bas), au = minIso(segs[i + 1] ? addD(segs[i + 1].du, -1) : '9999-12-31', haut);
    if (du > au) return;
    const k = d.contratOf(s.regime ? { ...e, ...s.regime } : e);
    if (!k.annuel) return;
    const prec = sous.at(-1);
    // Même forfait que le segment précédent, et contigu : un seul segment.
    if (prec && prec.forfait === k.heuresAnnuelles && prec.cadre === k.cadre && addD(prec.au, 1) === du) prec.au = au;
    else sous.push({ du, au, forfait: k.heuresAnnuelles, cadre: k.cadre });
  });
  const plages: PlageForfait[] = [];
  for (const s of sous) {
    const p = plages.at(-1);
    if (p && addD(p.fin, 1) === s.du) { p.segments.push(s); p.fin = s.au; } else plages.push({ debut: s.du, fin: s.au, motifFin: 'periode', segments: [s], partielle: false });
  }
  for (const p of plages) {
    p.motifFin = p.fin === ref.fin ? 'periode' : e.fin && p.fin === e.fin ? 'sortie' : 'avenant';
    // Période commencée avant le début du suivi : ce qui précède n'est pas dans Cursus.
    p.partielle = p.debut === suivi && suivi > ref.debut && suivi > e.entree;
  }
  return plages;
}

// — Durée journalière et absences déduites —

/** Jours ouvrés théoriques de la période : lundi à vendredi hors fériés chômés, moins les 25 jours de CP légaux. */
export function joursOuvresTheoriques(ref: PeriodeForfait): number {
  let n = 0;
  for (let j = ref.debut; j <= ref.fin; j = addD(j, 1)) if (weekday(j) < 5 && !isFerie(j)) n++;
  return Math.max(1, n - JOURS_CP_LEGAUX);
}

/** Heures déduites par jour d'absence : la durée de l'accord, sinon le forfait divisé par les jours ouvrés théoriques. */
export function heuresParJour(s: ReglagesForfaitHeures | undefined, forfait: number, ref: PeriodeForfait): number {
  return s?.forfaitHeuresJour && s.forfaitHeuresJour > 0 ? s.forfaitHeuresJour : forfait / joursOuvresTheoriques(ref);
}

/** Natures déduites : réglage, sinon la liste par défaut. */
export const absencesDeduites = (s: ReglagesForfaitHeures | undefined): readonly AbsenceType[] => s?.forfaitHeuresAbsencesDeduites ?? ABSENCES_DEDUITES_DEFAUT;

/** Jour ouvré compté dans les 1 607 h : lundi à vendredi, ni férié chômé, ni journée de solidarité. */
const jourDeduit = (j: ISODate) => weekday(j) < 5 && !isFerie(j) && !estJourneeSolidarite(j);

/**
 * Heures d'absence déduites de la cible sur les segments : absences en vigueur (validées ou signalées) d'une nature de la
 * liste, jour ouvré par jour ouvré, une demi-journée pour moitié. Total seul : aucune nature n'est rendue.
 */
export function heuresAbsencesDeduites(d: Domain, e: Employe, segments: readonly SegmentForfait[], ref: PeriodeForfait): number {
  const liste = new Set(absencesDeduites(d.ds.settings));
  const absences = d.ds.absences.filter(a => a.empId === e.id && absenceBloque(a) && liste.has(a.type));
  let h = 0;
  for (const s of segments) {
    const parJour = heuresParJour(d.ds.settings, s.forfait, ref);
    for (const a of absences) {
      for (let j = maxIso(a.du, s.du); j <= minIso(a.au, s.au); j = addD(j, 1)) {
        if (!jourDeduit(j)) continue;
        const m = moities(a, j);
        h += parJour * ((m.matin ? 0.5 : 0) + (m.apres_midi ? 0.5 : 0));
      }
    }
  }
  return r2(h);
}

// — Réalisé et clôture —

/** Feuilles du salarié dont la semaine touche la plage. */
const feuillesDeLaPlage = (d: Domain, e: Employe, p: Pick<PeriodeForfait, 'debut' | 'fin'>) =>
  d.ds.feuilles.filter(sh => sh.empId === e.id && sh.week <= p.fin && addD(sh.week, 6) >= p.debut);

/**
 * Heures réalisées dans la plage : feuilles validées décomptées au forfait annuel (régime figé), jour par jour ; `semaines` :
 * semaines qui ont au moins une heure travaillée sous forfait dans la plage.
 */
export function realiseForfait(d: Domain, e: Employe, p: Pick<PeriodeForfait, 'debut' | 'fin'>): { realise: number; semaines: number } {
  let realise = 0, semaines = 0;
  for (const sh of feuillesDeLaPlage(d, e, p)) {
    if (sh.statut !== 'validee') continue;
    const calc = calcSheet(d, e, sh);
    if (!calc.c.annuel) continue;
    const h = joursSemaine(sh.week).reduce((n, j, i) => n + (j >= p.debut && j <= p.fin ? calc.perDay[i] : 0), 0);
    realise += h;
    if (h > 0) semaines++;
  }
  return { realise: r2(realise), semaines };
}

/** Résultat de la clôture d'une plage : ce que photographie la ligne, et ce qui l'accompagne à l'écran. */
export interface CalculClotureForfait {
  empId: number; reference: PeriodeForfait; debut: ISODate; fin: ISODate; motifFin: MotifFinForfait; partielle: boolean;
  segments: SegmentForfait[];
  /** Forfait annuel de la fin de la plage (heures) ; `partiel` : tous les segments sous 1 607 h (temps partiel annualisé). */
  forfait: number; partiel: boolean;
  /** Cible proratisée, absences déduites (total, sans nature), cible nette, réalisé, écart (réalisé − cible nette). */
  cible: number; absences: number; cibleNette: number; realise: number; ecart: number;
  /** Semaines travaillées sous forfait et seuil de la tranche à 25 % (heures). */
  semaines: number; seuil25: number;
  hfa25: number; hfa50: number; hca10: number; hca25: number; nonRealise: number;
  alertes: string[]; blocages: string[];
}

/** Premier 1er juin au plus tard le `jour` : début de la période d'acquisition des congés payés qui le contient. */
const premierJuin = (jour: ISODate): ISODate => (jour.slice(5) >= '06-01' ? `${jour.slice(0, 4)}-06-01` : `${Number(jour.slice(0, 4)) - 1}-06-01`);

/**
 * Clôture d'une plage sous forfait de la période de référence `ref` : celle qui commence le `debut` (la première à défaut).
 * Null : aucune plage sous forfait annuel en heures dans la période (ou aucune ne commence ce jour-là).
 */
export function clotureForfaitHeures(d: Domain, e: Employe, ref: PeriodeForfait, debut?: ISODate): CalculClotureForfait | null {
  const plages = plagesForfait(d, e, ref);
  const p = debut ? plages.find(x => x.debut === debut) : plages[0];
  return p ? calculerPlage(d, e, ref, p) : null;
}

/** Clôtures de toutes les plages sous forfait de la période de référence `ref` (une le plus souvent). */
export const cloturesDeLaPeriode = (d: Domain, e: Employe, ref: PeriodeForfait): CalculClotureForfait[] =>
  plagesForfait(d, e, ref).map(p => calculerPlage(d, e, ref, p));

function calculerPlage(d: Domain, e: Employe, ref: PeriodeForfait, p: PlageForfait): CalculClotureForfait {
  const s = d.ds.settings;
  const joursRef = joursEntre(ref.debut, ref.fin);
  const cible = r2(p.segments.reduce((n, x) => n + x.forfait * joursEntre(x.du, x.au) / joursRef, 0));
  const absences = Math.min(cible, heuresAbsencesDeduites(d, e, p.segments, ref));
  const cibleNette = r2(cible - absences);
  const { realise, semaines } = realiseForfait(d, e, p);
  const ecart = r2(realise - cibleNette);
  const forfait = p.segments.at(-1)!.forfait;
  const partiel = p.segments.every(x => x.forfait < DUREE_LEGALE_ANNUELLE);
  const seuil25 = r2((s?.forfaitHeuresSeuil25 ?? SEUIL_25_DEFAUT) * semaines);
  const out: CalculClotureForfait = {
    empId: e.id, reference: ref, debut: p.debut, fin: p.fin, motifFin: p.motifFin, partielle: p.partielle, segments: p.segments, forfait, partiel,
    cible, absences, cibleNette, realise, ecart, semaines, seuil25, hfa25: 0, hfa50: 0, hca10: 0, hca25: 0, nonRealise: 0, alertes: [], blocages: [],
  };
  if (ecart < 0) out.nonRealise = r2(-ecart);
  else if (!partiel) {
    out.hfa25 = r2(Math.min(ecart, seuil25));
    out.hfa50 = r2(ecart - out.hfa25);
  } else {
    // Temps partiel annualisé : 10 % jusqu'au dixième de la durée prévue (la cible), 25 % au-delà (art. L3123-29).
    out.hca10 = r2(Math.min(ecart, cible / 10));
    out.hca25 = r2(ecart - out.hca10);
    const plafond = plafondComplementaires(s);
    if (ecart > cible / plafond.diviseur + 1e-9) out.alertes.push(`Heures complémentaires au-delà du ${plafond.label} de la durée prévue (${fH(cible / plafond.diviseur)} au plus, ${plafond.article}) : à examiner avec le salarié`);
    const legale = DUREE_LEGALE_ANNUELLE * p.segments.reduce((n, x) => n + joursEntre(x.du, x.au), 0) / joursRef;
    if (realise >= legale - 1e-9) out.blocages.push(`Temps partiel annualisé porté à la durée légale (${fH(realise)} réalisées pour ${fH(legale)}) : heures complémentaires interdites à ce niveau (art. L3123-9), requalification à examiner avant la clôture`);
  }
  // — Alertes —
  if (p.partielle) out.alertes.push(`Période commencée avant le début du suivi dans Cursus (${fmtIso(p.debut)}) : partielle, le début est à compléter dans Sage`);
  const acquisition = premierJuin(addM(ref.debut, -12));
  if (e.entree > acquisition && e.entree <= p.fin) out.alertes.push(`Droits à congés payés incomplets (embauche le ${fmtIso(e.entree)}) : cible à vérifier`);
  if (p.segments.some(x => !x.cadre)) out.alertes.push('Salarié non cadre : le forfait annuel en heures suppose un salarié autonome (art. L3121-56) ; à défaut, aménagement du temps de travail sur l’année (art. L3121-44) : vérifier l’accord et le contrat');
  if (partiel) out.alertes.push(`Forfait inférieur à ${DUREE_LEGALE_ANNUELLE.toLocaleString('fr-FR')} h : temps partiel annualisé, vérifier les mentions du contrat (art. L3123-6)`);
  // — Blocages —
  if (d.ti <= p.fin) out.blocages.push(`Plage en cours : clôture possible à partir du ${fmtIso(addD(p.fin, 1))}`);
  const feuilles = feuillesDeLaPlage(d, e, p);
  for (const sh of feuilles) if (sh.statut !== 'validee') out.blocages.push(`Feuille de la semaine du ${fmtIso(sh.week)} non validée`);
  const absencesEnVigueur = d.ds.absences.filter(a => a.empId === e.id && absenceBloque(a));
  const couvert = (j: ISODate) => {
    const m = absencesEnVigueur.filter(a => a.du <= j && a.au >= j).map(a => moities(a, j));
    return m.some(x => x.matin) && m.some(x => x.apres_midi);
  };
  for (let w = mondayOf(p.debut); w <= p.fin; w = addD(w, 7)) {
    if (feuilles.some(sh => sh.week === w)) continue;
    const ouvres = joursSemaine(w).filter(j => j >= p.debut && j <= p.fin && weekday(j) < 5 && !isFerie(j));
    if (ouvres.some(j => !couvert(j))) out.blocages.push(`Semaine du ${fmtIso(w)} sans feuille de temps ni absence`);
  }
  return out;
}

/** Quantités d'une ligne de clôture, par rubrique de paie. */
export const quantitesLigne = (l: Pick<ClotureForfaitHeures, 'hfa25' | 'hfa50' | 'hca10' | 'hca25'>): Record<RubriqueForfaitHeures, number> =>
  ({ HFA25: l.hfa25, HFA50: l.hfa50, HCA10: l.hca10, HCA25: l.hca25 });

// — Lignes enregistrées —

/** Lignes d'une même plage (salarié, début), de la plus ancienne version à la plus récente. */
export const versionsDe = (lignes: readonly ClotureForfaitHeures[] | undefined, empId: number, debut: ISODate) =>
  (lignes ?? []).filter(l => l.empId === empId && l.debut === debut).sort((a, b) => a.version - b.version);

/** Dernière version transmise à la paie (confirmée, import confirmé), base de l'écart d'une version suivante. */
export const derniereTransmise = (lignes: readonly ClotureForfaitHeures[] | undefined, l: Pick<ClotureForfaitHeures, 'empId' | 'debut' | 'version'>) =>
  versionsDe(lignes, l.empId, l.debut).filter(x => x.version < l.version && x.statut === 'confirmee' && x.sage).at(-1) ?? null;

/** Ligne en vigueur d'une plage : la dernière version non annulée, ou null. */
export const ligneEnVigueur = (lignes: readonly ClotureForfaitHeures[] | undefined, empId: number, debut: ISODate) =>
  versionsDe(lignes, empId, debut).filter(l => l.statut !== 'annulee').at(-1) ?? null;

/**
 * Ligne confirmée à revoir : une feuille de sa plage rouverte après la confirmation ou qui n'est plus validée, ou un
 * réalisé recalculé qui diffère de celui photographié. Rendue comme motif (null : rien à revoir).
 */
export function aRevoir(d: Domain, l: ClotureForfaitHeures): string | null {
  if (l.statut !== 'confirmee' || !l.confirmeeLe) return null;
  const e = d.emp(l.empId);
  if (!e) return null;
  const feuilles = feuillesDeLaPlage(d, e, l);
  const rouverte = feuilles.find(sh => (sh.reouverture?.le ?? '') > l.confirmeeLe!);
  if (rouverte) return `feuille de la semaine du ${fmtIso(rouverte.week)} rouverte après la clôture`;
  const nonValidee = feuilles.find((sh: FeuilleTemps) => sh.statut !== 'validee');
  if (nonValidee) return `feuille de la semaine du ${fmtIso(nonValidee.week)} non validée`;
  const r = realiseForfait(d, e, l).realise;
  return Math.abs(r - l.realise) > 0.005 ? `réalisé recalculé : ${fH(r)} au lieu de ${fH(l.realise)}` : null;
}

/** État d'une ligne pour la paie et l'écran. */
export function etatClotureForfait(l: ClotureForfaitHeures): string {
  if (l.statut === 'annulee') return 'annulée';
  if (l.statut === 'proposee') return l.rouverteLe ? 'rouverte, à confirmer' : 'à confirmer';
  if (l.horsFichier) return 'réglée hors fichier (saisie dans Sage)';
  if (l.sage) return `transmise à la paie (lot n° ${l.lotId})`;
  if (l.lotId != null) return `dans le lot de paie n° ${l.lotId}, import à confirmer`;
  return 'confirmée, en attente du prochain lot de paie';
}

// — Paie —

/**
 * Période de paie des heures d'une ligne : mois de la sortie ou de la plage, sinon de la confirmation (jour de Paris, au plus
 * tard le jour de Cursus) ; un mois clos part sur la période ouverte.
 */
export function periodeEmission(l: Pick<ClotureForfaitHeures, 'fin' | 'motifFin' | 'confirmeeLe'>, s: ReglagesForfaitHeures | undefined, today: ISODate): string {
  const base = l.motifFin === 'sortie' || s?.forfaitHeuresEmission === 'periode' || !l.confirmeeLe ? moisDe(l.fin) : moisDe(minIso(isoParis(new Date(l.confirmeeLe)), today));
  return [base, periodeOuverte(today, s?.clotureJour ?? 0)].sort().at(-1)!;
}

/**
 * Quantités à émettre pour une ligne confirmée : les siennes, ou, pour une version qui en remplace une transmise, l'écart
 * avec celle-ci (positif ou négatif). Quantités nulles omises.
 */
export function quantitesAEmettre(lignes: readonly ClotureForfaitHeures[] | undefined, l: ClotureForfaitHeures): Partial<Record<RubriqueForfaitHeures, number>> {
  const base = derniereTransmise(lignes, l);
  const q = quantitesLigne(l), b = base ? quantitesLigne(base) : null;
  const out: Partial<Record<RubriqueForfaitHeures, number>> = {};
  for (const r of RUBRIQUES_FORFAIT_HEURES) {
    const v = r2(q[r] - (b?.[r] ?? 0));
    if (v) out[r] = v;
  }
  return out;
}

/**
 * Éléments d'un lot de la période `jusqua` : lignes confirmées ni dans un lot ni transmises, dont la période d'émission
 * vient au plus tard, une par rubrique ; code Sage de la rubrique active, sinon null (« à saisir dans Sage ») ; une
 * quantité négative (écart d'une version suivante) sans code Sage quand le format du fichier refuse les négatifs.
 */
export function elementsForfaitHeures(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[], negatifs = true): ElementForfaitHeuresPaie[] {
  const lignes = d.ds.cloturesForfaitHeures ?? [];
  return lignes.flatMap(l => {
    if (l.statut !== 'confirmee' || l.lotId != null || l.sage) return [];
    const e = d.emp(l.empId);
    const periode = periodeEmission(l, d.ds.settings, d.ti);
    if (!e || periode > jusqua) return [];
    const correctif = !!derniereTransmise(lignes, l);
    return Object.entries(quantitesAEmettre(lignes, l)).map(([rubrique, quantite]) => {
      const r = table.find(t => t.code === rubrique);
      const codeSage = r?.active && (negatifs || quantite > 0) ? r.codeSage : null;
      return { cloture: l.id, empId: l.empId, matricule: matriculeAffiche(e), periode, rubrique, codeSage, quantite, debut: l.debut, fin: l.fin, version: l.version, ...(correctif ? { correctif: true as const } : {}) };
    });
  }).sort((x, y) => x.periode.localeCompare(y.periode) || x.empId - y.empId || x.cloture - y.cloture || x.rubrique.localeCompare(y.rubrique));
}

/** Lignes d'un lot (identifiant, salarié), une fois chacune. */
export const cloturesDuContenu = (elements: readonly Pick<ElementForfaitHeuresPaie, 'cloture' | 'empId'>[]) =>
  [...new Map(elements.map(x => [x.cloture, { id: x.cloture, empId: x.empId }])).values()];

/** « Forfait annuel en heures du 01/01/2027 au 31/12/2027 · version 2, écart » : détail d'un élément. */
export const detailForfaitHeures = (x: Pick<ElementForfaitHeuresPaie, 'debut' | 'fin' | 'version'> & { correctif?: boolean }) =>
  `Forfait annuel en heures du ${fmtIso(x.debut)} au ${fmtIso(x.fin)}${x.version > 1 ? ` · version ${x.version}${x.correctif ? ', écart avec la version transmise' : ''}` : ''}`;

/** Heures au-delà du forfait des lignes confirmées dont la plage finit dans l'année `annee` (imputation sur le contingent). */
export function heuresForfaitContingent(d: Domain, empId: number, annee: number): number {
  if (!d.ds.settings?.forfaitHeuresContingent) return 0;
  const lignes = (d.ds.cloturesForfaitHeures ?? []).filter(l => l.empId === empId && l.fin.startsWith(String(annee)) && l.statut === 'confirmee');
  // Une seule version par plage : la dernière confirmée.
  const parPlage = new Map<string, ClotureForfaitHeures>();
  for (const l of lignes) if ((parPlage.get(l.debut)?.version ?? 0) < l.version) parPlage.set(l.debut, l);
  return r2([...parPlage.values()].reduce((n, l) => n + l.hfa25 + l.hfa50, 0));
}

// — Réglages —

/** Réglages qui supposent la référence de l'accord dès qu'ils diffèrent du défaut. */
export function forfaitHeuresHorsDefaut(s: ReglagesForfaitHeures): boolean {
  const liste = s.forfaitHeuresAbsencesDeduites ?? ABSENCES_DEDUITES_DEFAUT;
  const memeListe = liste.length === ABSENCES_DEDUITES_DEFAUT.length && ABSENCES_DEDUITES_DEFAUT.every(x => liste.includes(x));
  return (s.forfaitHeuresDebutPeriode ?? '01-01') !== '01-01' || (s.forfaitHeuresSeuil25 ?? SEUIL_25_DEFAUT) !== SEUIL_25_DEFAUT || !memeListe || !!s.forfaitHeuresJour;
}
