// Forfait annuel en jours (t043, lot 6, chantier 2) : suivi des jours travaillés de l'année, comparés au forfait (218 jours
// au plus, art. L3121-64), alertes, et avenant de renonciation à des jours de repos (art. L3121-59). Partagé par la
// validation des feuilles (server/src/actions/temps.ts, un seul appel : server/src/forfait-jours.ts), les avenants
// (server/src/actions/forfait-jours.ts), la famille « rachats » du registre des éléments de lot (rubrique JREN) et les
// écrans Temps, fiche collaborateur et Paramètres → Forfait jours.
// - Cumul : jours des feuilles validées de l'année décomptées en forfait jours (régime figé de chaque feuille), ventilés
//   jour par jour comme `cumulAnnuel` (une semaine à cheval sur le 31 décembre compte pour ses deux années) ; un jour
//   compte une demi-journée jusqu'à 4 h, une journée au-delà (comme `calcSheet`). Cible : le forfait de la fiche au
//   prorata de la présence dans l'année (entrée, fin de contrat) et des périodes sous forfait jours (historique des
//   contrats) ; cible à date : la part de l'année déjà écoulée.
// - Plafond de l'année : la cible, plus les jours rachetés par les avenants en vigueur de l'année. Alerte à
//   `forfaitJoursAlerte` % du plafond (90 par défaut) ; au-delà du plafond, dépassement : la validation de la feuille
//   exige un motif, comme pour les durées maximales.
// - Avenant de renonciation : seulement si un accord collectif l'autorise, sa référence saisie dans Paramètres
//   (`forfaitJoursRachat`, contrôle COHERENCE de shared/reglages.ts) ; forfait plus jours rachetés dans la limite du
//   plafond réglé (235 à défaut d'accord, art. L3121-66), majoration d'au moins `forfaitJoursMajorationMin` % (10 %).
//   Sans référence d'accord : suivi et alertes seulement.
// - Paie : jours rachetés sous la rubrique JREN (quantité, taux en détail), émis au mois de la signature ou à la clôture de
//   l'année (décembre) selon `forfaitJoursJren` ; un mois clos part sur la période ouverte. Rubrique désactivée par défaut :
//   l'élément est listé « à saisir dans Sage » dans le résumé du lot, puis réglé hors fichier à sa confirmation.
import { isValidDate, joursSemaine, parse } from '../dates.ts';
import type { Domain } from '../domain.ts';
import { fJ, fmtIso, plural } from '../format.ts';
import type { AvenantForfait, ElementASaisir, ElementRachatPaie, Employe, FeuilleTemps, ISODate, Settings } from '../types.ts';
import { rttInfo } from './conges.ts';
import { memeRegime, regimeFiche, segmentsContrat } from './historique-contrat.ts';
import { matriculeAffiche } from './matricules.ts';
import { moisDe, periodeOuverte, type RubriqueVue } from './paie.ts';
import { calcSheet } from './temps.ts';

/** Forfait de la loi (art. L3121-64), plafond supplétif avec avenant (art. L3121-66), majoration minimale (art. L3121-59). */
export const FORFAIT_LEGAL = 218;
export const PLAFOND_SUPPLETIF = 235;
export const MAJORATION_MINIMALE = 10;

/** Rubrique de paie des jours rachetés (RUBRIQUES_PAIE). */
export const RUBRIQUE_JREN = 'JREN';

type ReglagesForfait = Partial<Pick<Settings, 'forfaitJoursAlerte' | 'forfaitJoursRachat' | 'forfaitJoursAccord' | 'forfaitJoursPlafond' | 'forfaitJoursMajorationMin' | 'forfaitJoursJren' | 'clotureJour'>>;

/** Avenant de renonciation ouvert : case cochée et référence de l'accord collectif saisie (Paramètres → Forfait jours). */
export const rachatOuvert = (s: ReglagesForfait | undefined) => !!s?.forfaitJoursRachat && !!s?.forfaitJoursAccord;

/** Jours d'une journée de la feuille : une demi-journée jusqu'à 4 h, une journée au-delà (même règle que `calcSheet`). */
export const joursDuJour = (h: number) => (h === 0 ? 0 : h <= 4 ? 0.5 : 1);

/** Avenants en vigueur (non annulés) d'un salarié pour l'année `annee`. */
export const avenantsDe = (avenants: readonly AvenantForfait[] | undefined, empId: number, annee: number) =>
  (avenants ?? []).filter(a => a.empId === empId && a.annee === annee && !a.annuleLe);

/** État du cumul : sous le seuil d'alerte, au seuil, au-delà du plafond. */
export type EtatForfait = 'ok' | 'alerte' | 'depasse';

export interface CumulForfait {
  annee: number;
  /** Jours travaillés des feuilles validées de l'année (forfait jours). */
  done: number;
  /** Forfait de l'année au prorata de la présence et des périodes sous forfait ; `forfait` : celui de la fiche. */
  cible: number; forfait: number;
  /** Cible à date (part de l'année écoulée), pour l'année en cours. */
  prorata: number;
  /** Jours rachetés par les avenants en vigueur de l'année ; plafond : cible + jours rachetés. */
  rachetes: number; plafond: number;
  /** Seuil d'alerte en % du plafond, et état. */
  seuil: number; etat: EtatForfait;
}

/**
 * Cumul des jours travaillés d'un forfait jours pour l'année `annee` ; `feuilles` remplace celles de l'instantané (feuille
 * en cours de validation comptée comme validée). Null quand le salarié ne relève pas d'un forfait jours cette année-là
 * (ni par sa fiche, ni par une feuille validée).
 */
export function cumulForfaitJours(d: Domain, e: Employe, annee = d.year, feuilles: readonly FeuilleTemps[] = d.ds.feuilles): CumulForfait | null {
  const an = String(annee);
  let done = 0, avecFeuille = false;
  for (const sh of feuilles) {
    if (sh.empId !== e.id || sh.statut !== 'validee') continue;
    const jours = joursSemaine(sh.week);
    if (!jours.some(day => day.startsWith(an))) continue;
    const calc = calcSheet(d, e, sh);
    if (!calc.c.forfait) continue;
    avecFeuille = true;
    done += jours.reduce((n, day, i) => n + (day.startsWith(an) ? joursDuJour(calc.perDay[i]) : 0), 0);
  }
  const c = d.contratOf(e);
  if (!c.forfait && !avecFeuille) return null;
  const forfait = c.forfait ? c.joursForfait : FORFAIT_LEGAL;
  // Présence dans l'année (entrée, fin de contrat), comme `cumulAnnuel` ; périodes sous un autre régime retirées (historique
  // des contrats) : un seul régime connu sur l'année, la cible de la fiche au prorata de la présence.
  const start = new Date(annee, 0, 1).getTime(), end = new Date(annee + 1, 0, 1).getTime();
  const debut = Math.max(start, parse(e.entree).getTime());
  const fin = e.fin ? Math.min(end, parse(e.fin).getTime() + 864e5) : end;
  const presence = Math.max(0, fin - debut) / (end - start);
  const fiche = regimeFiche(e);
  const segs = segmentsContrat(d, e).filter((s, i, l) => s.du <= `${annee}-12-31` && (l[i + 1]?.du ?? '9999-12-31') > `${annee}-01-01`);
  const cible = segs.every(s => !s.regime || memeRegime(s.regime, fiche))
    ? Math.round(forfait * presence)
    : Math.round(segs.reduce((n, s, i) => {
      const du = Math.max(debut, parse(s.du).getTime()), au = Math.min(fin, segs[i + 1] ? parse(segs[i + 1].du).getTime() : end);
      const k = d.contratOf(s.regime ? { ...e, ...s.regime } : e);
      return n + (k.forfait && au > du ? k.joursForfait * (au - du) / (end - start) : 0);
    }, 0));
  const ecoule = fin > debut ? Math.min(1, Math.max(0, (d.today.getTime() - debut) / (fin - debut))) : 1;
  const rachetes = avenantsDe(d.ds.avenantsForfait, e.id, annee).reduce((n, a) => n + a.jours, 0);
  const plafond = cible + rachetes;
  const seuil = d.ds.settings?.forfaitJoursAlerte ?? 90;
  const etat: EtatForfait = done > plafond + 1e-9 ? 'depasse' : plafond > 0 && done >= plafond * seuil / 100 - 1e-9 ? 'alerte' : 'ok';
  return { annee, done, cible, forfait, prorata: Math.round(cible * ecoule * 10) / 10, rachetes, plafond, seuil, etat };
}

/** « 180 j travaillés sur 218 (forfait) » ; avec un avenant, « sur 223 (forfait 218 + 5 rachetés) ». */
export function cumulTexte(k: CumulForfait): string {
  return `${fJ(k.done)} travaillés sur ${fJ(k.plafond)}${k.rachetes ? ` (forfait ${k.cible} + ${k.rachetes} rachetés par avenant)` : ''}`;
}

/** Message d'alerte du cumul (seuil atteint ou plafond dépassé), vide sinon. */
export function alerteForfait(k: CumulForfait): string {
  if (k.etat === 'depasse') {
    return `Forfait jours ${k.annee} dépassé : ${fJ(k.done)} travaillés pour un plafond de ${fJ(k.plafond)} (${k.rachetes ? `forfait et ${plural(k.rachetes, 'jour racheté', 'jours rachetés')} par avenant` : 'aucun avenant de renonciation'})`;
  }
  if (k.etat === 'alerte') return `Forfait jours ${k.annee} : ${Math.floor(k.done / k.plafond * 100)} % du plafond atteint (${fJ(k.done)} sur ${fJ(k.plafond)}, alerte à ${k.seuil} %)`;
  return '';
}

/** Années touchées par les jours travaillés d'une feuille (deux pour une semaine à cheval sur le 31 décembre). */
const anneesDeLaFeuille = (sh: Pick<FeuilleTemps, 'week' | 'lignes'>, perDay: readonly number[]) =>
  [...new Set(joursSemaine(sh.week).filter((_, i) => perDay[i] > 0).map(day => Number(day.slice(0, 4))))];

/**
 * Contrôle de la validation d'une feuille de forfait jours : cumul de chaque année de la feuille, celle-ci comptée comme
 * validée. `depassements` : plafond dépassé (motif exigé) ; `alertes` : seuil d'alerte atteint (sans blocage).
 */
export function controleValidationForfait(d: Domain, e: Employe, validee: FeuilleTemps): { depassements: string[]; alertes: string[] } {
  const calc = calcSheet(d, e, validee);
  if (!calc.c.forfait) return { depassements: [], alertes: [] };
  const feuilles = [...d.ds.feuilles.filter(f => f.id !== validee.id), { ...validee, statut: 'validee' as const }];
  const out = { depassements: [] as string[], alertes: [] as string[] };
  for (const annee of anneesDeLaFeuille(validee, calc.perDay)) {
    const k = cumulForfaitJours(d, e, annee, feuilles);
    if (!k) continue;
    if (k.etat === 'depasse') out.depassements.push(alerteForfait(k));
    else if (k.etat === 'alerte') out.alertes.push(alerteForfait(k));
  }
  return out;
}

/** Jours de repos de l'année (`rttInfo`), moins les jours rachetés par avenant : ce qui reste à prendre. */
export function reposForfaitInfo(d: Domain, e: Employe, k: CumulForfait) {
  const r = rttInfo(d, e, k.annee);
  return r ? { ...r, rachetes: k.rachetes, reste: Math.round((r.solde - k.rachetes) * 10) / 10 } : null;
}

// — Avenant de renonciation —

export interface SaisieAvenant { annee: number; jours: number; taux: number; signeLe: ISODate; reference: string }

/** Référence d'un avenant : 60 caractères au plus. */
export const REFERENCE_AVENANT_MAX = 60;

/**
 * Erreurs d'un avenant de renonciation : rachat ouvert par un accord, salarié en forfait jours, année de son contrat,
 * jours rachetés (demi-journées) dans la limite du plafond réglé avec les autres avenants de l'année, majoration minimale,
 * signature passée, au plus tard le 31 décembre de l'année. Partagé par le dialogue et l'action.
 */
export function erreursAvenant(d: Domain, e: Employe, a: SaisieAvenant): string[] {
  const s = d.ds.settings, c = d.contratOf(e), out: string[] = [];
  if (!rachatOuvert(s)) out.push('Renonciation à des jours de repos fermée : elle suppose l’accord collectif qui autorise le forfait jours, à indiquer dans Paramètres → Forfait jours');
  if (!c.forfait) out.push(`${e.nom} ne relève pas d’un forfait annuel en jours`);
  const anneeMin = Number(e.entree.slice(0, 4));
  if (!Number.isInteger(a.annee) || a.annee < anneeMin || a.annee > d.year + 1) out.push(`Année de l’avenant : de ${anneeMin} à ${d.year + 1}`);
  const deja = avenantsDe(d.ds.avenantsForfait, e.id, a.annee).reduce((n, x) => n + x.jours, 0);
  const plafond = s?.forfaitJoursPlafond ?? PLAFOND_SUPPLETIF, max = plafond - c.joursForfait - deja;
  if (!(a.jours > 0) || Math.round(a.jours * 2) !== a.jours * 2) out.push('Jours rachetés : un nombre positif, par demi-journée');
  else if (a.jours > max) out.push(`Jours rachetés : ${max > 0 ? `${fJ(max)} au plus` : 'aucun'} — forfait de ${c.joursForfait} jours${deja ? ` et ${fJ(deja)} déjà rachetés en ${a.annee}` : ''}, plafond de ${plafond} jours travaillés (art. L3121-66)`);
  else {
    // On ne renonce qu'aux jours de repos de l'année qui restent : ni ceux déjà pris ou posés, ni ceux déjà rachetés.
    const r = Number.isInteger(a.annee) && c.forfait ? rttInfo(d, e, a.annee) : null;
    const reste = r ? Math.round((r.solde - deja) * 10) / 10 : null;
    if (reste != null && a.jours > reste) out.push(`Jours rachetés : ${reste > 0 ? `${fJ(reste)} au plus` : 'aucun'} — jours de repos ${a.annee} restants (${fJ(r!.droit)} de droit, ${fJ(r!.pris + r!.poses)} pris ou posés${deja ? `, ${fJ(deja)} déjà rachetés` : ''})`);
  }
  const min = s?.forfaitJoursMajorationMin ?? MAJORATION_MINIMALE;
  if (!Number.isInteger(a.taux) || a.taux < min || a.taux > 100) out.push(`Majoration des jours rachetés : de ${min} à 100 % (${min === MAJORATION_MINIMALE ? 'art. L3121-59' : 'accord collectif'})`);
  if (!isValidDate(a.signeLe)) out.push('Date de signature de l’avenant invalide');
  else if (a.signeLe > d.ti) out.push('Date de signature future : enregistrez l’avenant une fois signé');
  else if (a.signeLe < e.entree || a.signeLe > `${a.annee}-12-31`) out.push(`Avenant signé entre l’entrée (${fmtIso(e.entree)}) et le 31 décembre ${a.annee}`);
  if (a.reference.length > REFERENCE_AVENANT_MAX) out.push(`Référence de l’avenant : ${REFERENCE_AVENANT_MAX} caractères au plus`);
  return out;
}

// — Paie : jours rachetés (rubrique JREN) —

/** Période de paie des jours rachetés : mois de la signature ou décembre de l'année ; un mois clos part sur la période ouverte. */
export function periodeRachat(a: Pick<AvenantForfait, 'annee' | 'signeLe'>, s: ReglagesForfait | undefined, today: ISODate): string {
  const base = s?.forfaitJoursJren === 'cloture' ? `${a.annee}-12` : moisDe(a.signeLe);
  return [base, periodeOuverte(today, s?.clotureJour ?? 0)].sort().at(-1)!;
}

/** Avenants en attente de la paie : en vigueur, ni dans un lot, ni transmis, dont la période vient au plus tard `jusqua`. */
function enAttente(d: Domain, jusqua: string) {
  return (d.ds.avenantsForfait ?? []).flatMap(a => {
    if (a.annuleLe || a.lotId != null || a.sage) return [];
    const e = d.emp(a.empId);
    const periode = periodeRachat(a, d.ds.settings, d.ti);
    return e && periode <= jusqua ? [{ a, e, periode }] : [];
  });
}

/** « Avenant de renonciation 2026 signé le 12/10/2026 · majoration 25 % » : détail d'un élément JREN. */
export const detailRachat = (x: Pick<ElementRachatPaie, 'annee' | 'signeLe' | 'taux'>) =>
  `Avenant de renonciation ${x.annee} signé le ${x.signeLe.split('-').reverse().join('/')} · majoration ${x.taux} %`;

/** Éléments JREN d'un lot de la période `jusqua` : rubrique active seulement, sous son code Sage. */
export function elementsRachats(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'codeSage' | 'active'>[]): ElementRachatPaie[] {
  const r = table.find(t => t.code === RUBRIQUE_JREN);
  if (!r?.active) return [];
  return enAttente(d, jusqua).map(({ a, e, periode }) => ({
    avenant: a.id, empId: a.empId, matricule: matriculeAffiche(e), periode, rubrique: RUBRIQUE_JREN, codeSage: r.codeSage, quantite: a.jours, taux: a.taux, annee: a.annee, signeLe: a.signeLe,
  })).sort((x, y) => x.periode.localeCompare(y.periode) || x.empId - y.empId || x.avenant - y.avenant);
}

/** Jours rachetés d'un lot de la période `jusqua` quand JREN est désactivée : listés « à saisir dans Sage ». */
export function rachatsASaisir(d: Domain, jusqua: string, table: readonly Pick<RubriqueVue, 'code' | 'active'>[]): ElementASaisir[] {
  if (table.find(t => t.code === RUBRIQUE_JREN)?.active) return [];
  return enAttente(d, jusqua).map(({ a, periode }) => ({ famille: 'rachats', empId: a.empId, periode, rubrique: RUBRIQUE_JREN, quantite: a.jours, detail: detailRachat(a) }));
}

/** Avenants d'un lot (identifiant, salarié), une fois chacun. */
export const rachatsDuContenu = (elements: readonly Pick<ElementRachatPaie, 'avenant' | 'empId'>[]) =>
  [...new Map(elements.map(x => [x.avenant, { id: x.avenant, empId: x.empId }])).values()];

/** État d'un avenant pour la paie : « dans le lot n° 4 », « transmis à la paie », « saisi dans Sage », « en attente (octobre 2026) ». */
export function etatRachat(a: AvenantForfait): string {
  if (a.annuleLe) return a.sage ? 'annulé après sa transmission : à régulariser dans Sage' : 'annulé';
  if (a.horsFichier) return 'réglé hors fichier (saisi dans Sage)';
  if (a.sage) return `transmis à la paie (lot n° ${a.lotId})`;
  if (a.lotId != null) return `dans le lot de paie n° ${a.lotId}, import à confirmer`;
  return 'en attente du prochain lot de paie';
}
