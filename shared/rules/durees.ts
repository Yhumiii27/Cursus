// Durées du travail sur plusieurs semaines, calculées sur les feuilles validées : alertes pour le service RH, jamais de
// blocage (écran Temps : client/src/components/AlertesDurees.tsx, récapitulatif de la feuille ; message de validation).
// - Moyenne sur 12 semaines : 44 h au plus (art. L3121-22), 46 h seulement avec la référence d'un accord (art. L3121-23,
//   réglage `moyenne12SemainesMax`). Les 12 dernières semaines travaillées : une semaine sans feuille validée ou d'absence
//   complète (sans heure) est sautée. Hors forfait jours, forfait annuel en heures et cadre dirigeant.
// - Requalification du temps partiel (art. L3123-13) : horaire réel supérieur d'au moins 2 h à l'horaire contractuel
//   pendant 12 semaines sur les 15 dernières travaillées (12 consécutives comprises) ; proposition du nouvel horaire,
//   contractuel augmenté de l'écart moyen. Seuils fixés par la loi, non réglables.
// - Contingent annuel d'heures supplémentaires (220 h par défaut, art. D3121-24 ; réglage `contingentHeuresSup`), par année
//   civile : heures supplémentaires des feuilles validées (incluses à un forfait hebdomadaire comprises), sans celles
//   remplacées par un repos (art. L3121-30) ni l'intérim (contingent de l'agence), une semaine à cheval sur deux années
//   ventilée jour par jour, et celles déjà faites dans l'année avant la reprise depuis Lucca (`heuresSupAnnee`). Alerte au
//   seuil réglé (90 %). Au-delà, contrepartie obligatoire en repos (COR) de 100 % (plus de 20 salariés, art. L3121-38),
//   figée sur chaque feuille à sa validation (`corAValider`), créditée au compteur de récupération (recupInfo de
//   ./conges.ts), même quand les heures supplémentaires sont payées, et émise dans le fichier de paie (COR_ACQUIS).
import { addD, joursSemaine, mondayOf } from '../dates.ts';
import { fH, num } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Employe, FeuilleTemps, ISODate } from '../types.ts';
import { present } from './contrats.ts';
import { calcSheet, type FeuilleCalcul, type SheetCalc } from './temps.ts';
// lot 12 — C1 (forfait annuel en heures)
import { heuresForfaitContingent } from './forfait-heures.ts';

/** Semaines de la moyenne, et de la fenêtre de la requalification du temps partiel (art. L3123-13). */
export const SEMAINES_MOYENNE = 12;
export const SEMAINES_REQUALIFICATION = 15;
/** Écart hebdomadaire au contrat qui compte pour la requalification du temps partiel (art. L3123-13). */
export const ECART_REQUALIFICATION = 2;
/** Moyenne légale sur 12 semaines, sans accord (art. L3121-22). */
export const MOYENNE_LEGALE = 44;
/** Contingent supplétif (art. D3121-24) et taux de la contrepartie obligatoire en repos, plus de 20 salariés (art. L3121-38). */
export const CONTINGENT_LEGAL = 220;
export const TAUX_COR = 100;
/** Les semaines recherchées remontent au plus d'un an. */
const RECHERCHE_SEMAINES = 52;

const arrondi = (n: number) => Math.round(n * 100) / 100;
const valideesDe = (d: Domain, empId: number) => d.ds.feuilles.filter(sh => sh.empId === empId && sh.statut === 'validee');

/** Semaine travaillée : feuille validée qui porte des heures, avec son décompte. */
interface SemaineTravaillee { week: ISODate; calc: SheetCalc }

/**
 * Dernières semaines travaillées jusqu'à `semaineFin` (comprise), les plus récentes d'abord, sur un an au plus ; `garder` :
 * régime retenu (celui figé sur chaque feuille).
 */
function semainesTravaillees(d: Domain, e: Employe, semaineFin: ISODate, n: number, garder: (c: SheetCalc) => boolean, feuilles = valideesDe(d, e.id)): SemaineTravaillee[] {
  const depuis = addD(semaineFin, -7 * RECHERCHE_SEMAINES);
  return feuilles.filter(sh => sh.week <= semaineFin && sh.week > depuis)
    .map(sh => ({ week: sh.week, calc: calcSheet(d, e, sh) }))
    .filter(x => x.calc.total > 0 && garder(x.calc))
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, n);
}

// — Moyenne sur 12 semaines —

/** Moyenne maximale en vigueur : 46 h seulement avec la référence d'un accord, sinon 44 h. */
export function moyenneMax(d: Domain): number {
  const s = d.ds.settings;
  return s?.moyenne12SemainesAccord ? s.moyenne12SemainesMax ?? MOYENNE_LEGALE : MOYENNE_LEGALE;
}

export interface Moyenne12 { semaines: number; moyenne: number; max: number; du: ISODate | null; au: ISODate | null; depasse: boolean }

/**
 * Moyenne hebdomadaire des 12 dernières semaines travaillées jusqu'à `semaineFin` : alerte (`depasse`) au-delà du maximum,
 * une fois 12 semaines réunies. Null pour un forfait jours, un forfait annuel en heures ou un cadre dirigeant.
 */
export function moyenne12Semaines(d: Domain, e: Employe, semaineFin: ISODate = mondayOf(d.ti), feuilles?: FeuilleTemps[]): Moyenne12 | null {
  const c = d.contratOf(e);
  if (c.forfait || c.annuel || c.dirigeant) return null;
  const semaines = semainesTravaillees(d, e, semaineFin, SEMAINES_MOYENNE, x => !(x.c.forfait || x.c.annuel || x.c.dirigeant), feuilles);
  const max = moyenneMax(d);
  const moyenne = semaines.length ? arrondi(semaines.reduce((n, x) => n + x.calc.total, 0) / semaines.length) : 0;
  return {
    semaines: semaines.length, moyenne, max, du: semaines.at(-1)?.week ?? null, au: semaines[0]?.week ?? null,
    depasse: semaines.length >= SEMAINES_MOYENNE && moyenne > max + 1e-9,
  };
}

// — Requalification du temps partiel —

export interface Requalification { semaines: number; auDela: number; base: number; proposition: number; depasse: boolean }

/**
 * Temps partiel : semaines, parmi les 15 dernières travaillées, où l'horaire réel dépasse le contractuel d'au moins 2 h ;
 * à 12, l'horaire du contrat est à porter à la `proposition` (contractuel + écart moyen, au quart d'heure), sauf opposition
 * du salarié et avec un préavis de 7 jours (art. L3123-13). Null hors temps partiel.
 */
export function requalificationPartiel(d: Domain, e: Employe, semaineFin: ISODate = mondayOf(d.ti), feuilles?: FeuilleTemps[]): Requalification | null {
  const c = d.contratOf(e);
  if (!c.partiel) return null;
  const semaines = semainesTravaillees(d, e, semaineFin, SEMAINES_REQUALIFICATION, x => x.c.partiel, feuilles);
  const ecarts = semaines.map(x => x.calc.total - x.calc.c.base);
  const auDela = ecarts.filter(v => v >= ECART_REQUALIFICATION - 1e-9).length;
  const ecart = ecarts.length ? ecarts.reduce((a, b) => a + b, 0) / ecarts.length : 0;
  return {
    semaines: semaines.length, auDela, base: c.base, proposition: Math.round((c.base + Math.max(0, ecart)) * 4) / 4,
    depasse: auDela >= SEMAINES_MOYENNE,
  };
}

// — Contingent annuel et contrepartie obligatoire en repos —

/** Heures supplémentaires d'une feuille qui comptent dans le contingent : ni remplacées par un repos, ni d'un intérimaire. */
function supContingent(c: SheetCalc): number {
  if (c.c.interim || c.modeHS === 'repos') return 0;
  return c.sup25 + c.sup50 + c.incluses25 + c.incluses50;
}

/**
 * Heures supplémentaires d'une feuille dans l'année civile `annee` : toutes, ou, pour une semaine à cheval sur deux années,
 * celles du décompte cumulé jusqu'au 31 décembre (les heures supplémentaires sont les dernières de la semaine).
 */
export function heuresSupDansAnnee(d: Domain, e: Employe, sh: FeuilleCalcul & Pick<FeuilleTemps, 'week'>, annee: number): number {
  const dans = joursSemaine(sh.week).map(j => j.startsWith(String(annee)));
  if (!dans.some(Boolean)) return 0;
  const toute = supContingent(calcSheet(d, e, sh));
  if (dans.every(Boolean)) return toute;
  const dernier = dans[0] ? dans.lastIndexOf(true) : dans.indexOf(true) - 1;
  const avant = supContingent(calcSheet(d, e, { ...sh, lignes: sh.lignes.map(l => ({ ...l, h: l.h.map((v, i) => (i <= dernier ? v : 0)) })) }));
  return dans[0] ? avant : toute - avant;
}

/** Heures supplémentaires déjà faites dans l'année `annee`, reprises de Lucca (année de la date d'arrêté). */
export function heuresSupReprises(d: Domain, empId: number, annee: number): number {
  const r = d.ds.soldesReprise.find(s => s.empId === empId);
  return r?.arreteLe?.startsWith(String(annee)) ? num(r.heuresSupAnnee) : 0;
}

export interface Contingent {
  annee: number; max: number; alerte: number;
  /** Heures supplémentaires de l'année (`reprises` comprises), part du contingent (%). */
  cumul: number; reprises: number; part: number;
  /** Contrepartie obligatoire en repos due pour l'année (heures faites dans Cursus au-delà du contingent). */
  cor: number;
  etat: 'depasse' | 'alerte' | null;
  /** Référence de l'accord ou de la convention renseignée (sinon : valeur conventionnelle à vérifier). */
  accord: boolean;
}

/**
 * Contingent de l'année `annee` d'un salarié, sur ses feuilles validées (`feuilles` : celles à retenir, pour le calcul d'une
 * validation). Null sans aucune heure supplémentaire dans l'année pour un régime qui n'en fait pas (forfait jours, forfait
 * annuel, cadre dirigeant, temps partiel, intérim).
 */
export function contingentAnnuel(d: Domain, e: Employe, annee: number = d.year, feuilles = valideesDe(d, e.id)): Contingent | null {
  const s = d.ds.settings, max = s?.contingentHeuresSup ?? CONTINGENT_LEGAL, alerte = s?.contingentAlerte ?? 90;
  const reprises = heuresSupReprises(d, e.id, annee);
  // lot 12 — C1 (forfait annuel en heures) : heures au-delà du forfait des clôtures confirmées, seulement avec le réglage
  // `forfaitHeuresContingent` (désactivé tant que la paie ne l'a pas confirmé).
  const forfaitAnnuel = heuresForfaitContingent(d, e.id, annee);
  const cumul = arrondi(reprises + forfaitAnnuel + feuilles.reduce((n, sh) => n + heuresSupDansAnnee(d, e, sh, annee), 0));
  const c = d.contratOf(e);
  if (!cumul && (c.forfait || c.annuel || c.dirigeant || c.partiel || c.interim)) return null;
  // Heures au-delà du contingent faites dans Cursus : celles d'avant la reprise relèvent de l'ancien outil.
  const cor = arrondi((Math.max(0, cumul - max) - Math.max(0, reprises - max)) * TAUX_COR / 100);
  const part = max ? Math.round(cumul / max * 100) : 0;
  return {
    annee, max, alerte, cumul, reprises, part, cor, accord: !!s?.contingentAccord,
    etat: cumul > max + 1e-9 ? 'depasse' : part >= alerte ? 'alerte' : null,
  };
}

/** Années civiles d'une semaine : une, ou deux pour la semaine à cheval sur le 31 décembre (dans l'ordre). */
export const anneesDeLaSemaine = (week: ISODate): number[] => [...new Set(joursSemaine(week).map(j => Number(j.slice(0, 4))))];

/**
 * Contingents des années que touche la semaine `week` (deux pour une semaine à cheval sur le 31 décembre), sans ceux qui
 * ne s'appliquent pas (contingentAnnuel null).
 */
export function contingentsDeLaSemaine(d: Domain, e: Employe, week: ISODate, feuilles?: FeuilleTemps[]): Contingent[] {
  return anneesDeLaSemaine(week).flatMap(annee => contingentAnnuel(d, e, annee, feuilles) ?? []);
}

/**
 * Contrepartie obligatoire en repos à figer sur la feuille `sh` à sa validation, par année qu'elle touche : COR de l'année
 * recalculée sur toutes les feuilles validées (celle-ci comprise, avec ce qui est figé à sa validation), moins la COR déjà
 * figée sur les autres. L'écart (une validation hors de l'ordre chronologique, une feuille rouverte, un contingent changé)
 * est porté sur la feuille validée, et le total de l'année reste juste ; négatif, il corrige une COR déjà créditée.
 * Null : aucune.
 */
export function corAValider(d: Domain, e: Employe, sh: FeuilleTemps): Record<string, number> | null {
  const autres = valideesDe(d, e.id).filter(x => x.id !== sh.id);
  const out: Record<string, number> = {};
  for (const annee of anneesDeLaSemaine(sh.week)) {
    const due = contingentAnnuel(d, e, annee, [...autres, sh])?.cor ?? 0;
    const figee = autres.reduce((n, x) => n + num(x.cor?.[annee]), 0);
    const v = arrondi(due - figee);
    if (v) out[annee] = v;
  }
  return Object.keys(out).length ? out : null;
}

// — Textes et alertes —

/** Rappel tant que la référence de l'accord ou de la convention n'est pas saisie. */
export const CONTINGENT_A_VERIFIER = 'contingent légal par défaut (art. D3121-24) : valeur conventionnelle ou d’accord à vérifier (Paramètres → Décompte des heures)';

export const moyenneTexte = (m: Moyenne12) =>
  `Moyenne de ${fH(m.moyenne)} sur les ${m.semaines} dernières semaines travaillées, au-delà de ${m.max} h (art. ${m.max > MOYENNE_LEGALE ? 'L3121-23' : 'L3121-22'})`;

export const requalificationTexte = (r: Requalification) =>
  `Temps partiel : horaire réel supérieur d’au moins ${ECART_REQUALIFICATION} h au contrat ${r.auDela} semaines sur les ${r.semaines} dernières travaillées — horaire du contrat à porter à ${fH(r.proposition)}, sauf opposition du salarié, avec un préavis de 7 jours (art. L3123-13)`;

export function contingentTexte(k: Contingent): string {
  const base = `Contingent ${k.annee} : ${fH(k.cumul)} d’heures supplémentaires sur ${fH(k.max)} (${k.part} %)`;
  const suite = k.etat === 'depasse' ? ` — dépassé : ${fH(k.cor)} de contrepartie obligatoire en repos (${TAUX_COR} %, art. L3121-30 et L3121-38)`
    : k.etat === 'alerte' ? ` — seuil d’alerte de ${k.alerte} % atteint` : '';
  return `${base}${suite}${k.accord ? '' : ` · ${CONTINGENT_A_VERIFIER}`}`;
}

export type TypeAlerteDuree = 'moyenne' | 'requalification' | 'contingent';
export interface AlerteDuree { e: Employe; type: TypeAlerteDuree; texte: string }

/**
 * Alertes de durée du service RH, salariés présents : moyenne sur 12 semaines dépassée, temps partiel à requalifier,
 * contingent de l'année en cours au seuil d'alerte ou dépassé. Rangées par salarié.
 */
export function alertesDurees(d: Domain): AlerteDuree[] {
  const semaine = mondayOf(d.ti);
  const parEmp = new Map<number, FeuilleTemps[]>();
  for (const sh of d.ds.feuilles) if (sh.statut === 'validee') parEmp.set(sh.empId, [...(parEmp.get(sh.empId) ?? []), sh]);
  return [...d.ds.employes].filter(e => present(e, d.ti)).sort((a, b) => a.nom.localeCompare(b.nom)).flatMap(e => {
    const feuilles = parEmp.get(e.id) ?? [];
    if (!feuilles.length && !heuresSupReprises(d, e.id, d.year)) return [];
    const out: AlerteDuree[] = [];
    const m = moyenne12Semaines(d, e, semaine, feuilles);
    if (m?.depasse) out.push({ e, type: 'moyenne', texte: moyenneTexte(m) });
    const r = requalificationPartiel(d, e, semaine, feuilles);
    if (r?.depasse) out.push({ e, type: 'requalification', texte: requalificationTexte(r) });
    const k = contingentAnnuel(d, e, d.year, feuilles);
    if (k?.etat) out.push({ e, type: 'contingent', texte: contingentTexte(k) });
    return out;
  });
}

/**
 * Message de validation : seuils franchis par la feuille validée (moyenne, requalification, contingent, comparés à
 * l'état sans elle, contingent de chaque année que touche la semaine) et contrepartie en repos créditée. Vide si rien.
 */
export function alertesValidation(d: Domain, e: Employe, avant: FeuilleTemps[], apres: FeuilleTemps[], week: ISODate, cor: number): string[] {
  const out: string[] = [];
  const m0 = moyenne12Semaines(d, e, week, avant), m1 = moyenne12Semaines(d, e, week, apres);
  if (m1?.depasse && !m0?.depasse) out.push(moyenneTexte(m1));
  const r0 = requalificationPartiel(d, e, week, avant), r1 = requalificationPartiel(d, e, week, apres);
  if (r1?.depasse && !r0?.depasse) out.push(requalificationTexte(r1));
  for (const annee of anneesDeLaSemaine(week)) {
    const k0 = contingentAnnuel(d, e, annee, avant), k1 = contingentAnnuel(d, e, annee, apres);
    if (k1?.etat && k1.etat !== k0?.etat) out.push(contingentTexte(k1));
  }
  if (cor) out.push(`${fH(Math.abs(cor))} de contrepartie obligatoire en repos ${cor > 0 ? 'créditées' : 'retirées'} au compteur de récupération`);
  return out;
}
