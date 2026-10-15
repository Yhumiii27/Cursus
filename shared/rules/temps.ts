// Feuilles de temps : décompte des heures, majorations, variables de paie.
import { horodatageParis, isFerie, isoWeek, isoWeekYear, parse, wDays } from '../dates.ts';
import { num, r1 } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { Absence, AbsenceType, ContratFige, Employe, FeuilleTemps, ISODate, LigneTemps, ModeHeuresSupFige, SageMode, SagePush, TacheKeystone } from '../types.ts';
import { absenceBloque, jourHorsContrat, natureDef, natureMedicale } from './absences.ts';
import { matriculeAffiche } from './matricules.ts';
import { modeHeuresSup, periodesSemaine, rubriquesPaie, traduireRubriques } from './paie.ts';

/** Régime de temps de travail en vigueur d'une fiche, à figer sur une feuille soumise. */
export function contratFige(e: Employe): ContratFige {
  return { statut: e.statut, typeContrat: e.typeContrat, temps: e.temps, heures: e.heures, forfaitHeures: e.forfaitHeures, forfaitJours: e.forfaitJours, jourOff: [...(e.jourOff ?? [])] };
}
/** Le collaborateur tel qu'il était la semaine de la feuille (régime figé s'il existe). */
export function employeDeLaFeuille(e: Employe, sh: { contrat?: ContratFige | null } | null): Employe {
  return sh?.contrat ? { ...e, ...sh.contrat } : e;
}

export interface SheetCalc {
  perDay: number[]; total: number; warn: string[];
  /**
   * Durées maximales dépassées (plus de 10 h sur une journée ou de 48 h dans la semaine ; plus de 13 h pour un forfait
   * jours) : sous-ensemble de `warn`. La soumission, et la validation, exigent alors un motif (`motifDepassement`).
   */
  depassements: string[];
  /** Heures payées au taux normal (dans la limite de 35 h). */
  normal: number;
  /** Heures supplémentaires structurelles incluses dans un forfait hebdomadaire (total, dont +25 % et +50 %). */
  incluses: number; incluses25: number; incluses50: number;
  sup25: number; sup50: number; hc10: number; hc25: number;
  /** Repos compensateur acquis (heures supplémentaires majorées) : en mode « repos » (ou « historique ») seulement, hors intérim. */
  recup: number; jours: number;
  /** Mode des heures supplémentaires : figé sur la feuille à sa validation, sinon le réglage en vigueur. */
  modeHS: ModeHeuresSupFige;
  c: ReturnType<Domain['contratOf']>;
}

/**
 * Décompte hebdomadaire selon l'organisation du temps de travail en vigueur la semaine de la feuille
 * (régime figé à la soumission, sinon celui de la fiche) :
 * - 35 h, 39 h + RTT, forfait hebdomadaire : heures supplémentaires au-delà du seuil
 *   (+25 % de la 36e à la 43e heure, +50 % au-delà), payées ou remplacées par un repos compensateur équivalent selon
 *   le mode figé à la validation (`modeHS` ; « historique » : les deux, calcul d'avant le choix du mode) ;
 * - temps partiel : heures complémentaires (+10 % jusqu'au dixième de la durée, +25 % au-delà) ;
 * - forfait jours et cadre dirigeant : décompte en jours, pas d'heures supplémentaires ;
 * - forfait annuel en heures : pas de décompte hebdomadaire (cumul annuel, voir `cumulAnnuel`).
 */
export function calcSheet(d: Domain, e: Employe, sh: (Pick<FeuilleTemps, 'lignes'> & Partial<Pick<FeuilleTemps, 'contrat' | 'heuresSup'>>) | null): SheetCalc {
  const c = d.contratOf(employeDeLaFeuille(e, sh));
  const perDay = [0, 1, 2, 3, 4].map(i => (sh ? sh.lignes : []).reduce((n, l) => n + num(l.h[i]), 0));
  const total = perDay.reduce((a, b) => a + b, 0);
  const depassements: string[] = [];
  if (c.forfait) {
    // Forfait jours : durées maximales exclues (art. L3121-62) ; seuls les repos quotidien et hebdomadaire s'appliquent.
    if (perDay.some(h => h > 13)) depassements.push('Plus de 13 h sur une journée : repos quotidien de 11 h non respecté (art. L3131-1)');
  } else if (!c.dirigeant) {
    if (perDay.some(h => h > 10)) depassements.push('Plus de 10 h sur une journée (art. L3121-18)');
    if (total > 48) depassements.push('Plus de 48 h dans la semaine (art. L3121-20)');
  }
  const warn = [...depassements];
  const modeHS = modeHeuresSup(sh, d.ds.settings);
  const r: SheetCalc = { perDay, total, c, warn, depassements, normal: total, incluses: 0, incluses25: 0, incluses50: 0, sup25: 0, sup50: 0, hc10: 0, hc25: 0, recup: 0, jours: 0, modeHS };
  const jours = perDay.reduce((n, h) => n + (h === 0 ? 0 : h <= 4 ? 0.5 : 1), 0);
  if (c.forfait || c.dirigeant || c.annuel) r.jours = jours;
  else if (c.partiel) {
    const hc = Math.max(0, total - c.base);
    r.hc10 = Math.min(hc, c.base / 10);
    r.hc25 = hc - r.hc10;
    r.normal = total - hc;
    if (hc > c.base / 3) warn.push('Heures complémentaires au-delà du tiers de la durée contractuelle');
    if (total >= 35) warn.push('Temps partiel porté à 35 h ou plus');
  } else {
    const seuil = c.seuil ?? 35;
    const sup = Math.max(0, total - seuil);
    // Les taux dépendent du rang de l'heure dans la semaine : +25 % jusqu'à 43 h, +50 % au-delà.
    r.sup25 = Math.max(0, Math.min(total, 43) - Math.max(seuil, 35));
    r.sup25 = Math.min(sup, r.sup25);
    r.sup50 = sup - r.sup25;
    if (c.hebdo) {
      r.normal = Math.min(total, 35);
      r.incluses25 = Math.max(0, Math.min(total, seuil, 43) - 35);
      r.incluses50 = Math.max(0, Math.min(total, seuil) - 43);
      r.incluses = r.incluses25 + r.incluses50;
    } else r.normal = total - sup;
    // Repos de remplacement : heures et majoration (art. L3121-33) ; payées, les heures supplémentaires n'en donnent pas.
    r.recup = c.interim || modeHS === 'paiement' ? 0 : r.sup25 * 1.25 + r.sup50 * 1.5;
  }
  return r;
}

/** Durée maximale d'une journée, toutes lignes de la feuille cumulées : au-delà, la saisie est refusée. */
export const HEURES_JOUR_MAX = 24;

/** Jours (0 = lundi … 4 = vendredi) dont le total, toutes lignes cumulées, dépasse 24 h. */
export const joursAuDela24 = (lignes: Pick<LigneTemps, 'h'>[]): number[] =>
  [0, 1, 2, 3, 4].filter(i => lignes.reduce((n, l) => n + num(l.h[i]), 0) > HEURES_JOUR_MAX);

/**
 * Forfait annuel en heures : cumul des feuilles validées de l'année, cible proratisée selon la présence
 * (entrée, fin de contrat) et part de la cible correspondant à la période déjà écoulée. Une semaine à cheval
 * sur deux années est ventilée jour par jour : le lundi 29 décembre compte pour l'année qui s'achève.
 */
export function cumulAnnuel(d: Domain, e: Employe, year = d.year) {
  const c = d.contratOf(e);
  const annee = String(year);
  const done = d.ds.feuilles
    .filter(sh => sh.empId === e.id && sh.statut === 'validee' && wDays(sh.week).some(day => day.startsWith(annee)))
    .reduce((n, sh) => {
      const perDay = calcSheet(d, e, sh).perDay;
      return n + wDays(sh.week).reduce((m, day, i) => m + (day.startsWith(annee) ? perDay[i] : 0), 0);
    }, 0);
  const start = new Date(year, 0, 1).getTime(), end = new Date(year + 1, 0, 1).getTime();
  const debut = Math.max(start, parse(e.entree).getTime());
  const fin = e.fin ? Math.min(end, parse(e.fin).getTime() + 864e5) : end;
  const presence = Math.max(0, fin - debut) / (end - start);
  const cible = Math.round(c.heuresAnnuelles * presence);
  const ecoule = fin > debut ? Math.min(1, Math.max(0, (d.today.getTime() - debut) / (fin - debut))) : 1;
  return { done, cible, prorata: cible * ecoule, depasse: done > cible, annee: year };
}

/** Absence vue par la feuille de temps : une absence validée ou signalée, ou sur le point de l'être. */
export type AbsenceJour = Pick<Absence, 'empId' | 'type' | 'du' | 'au'> & Partial<Pick<Absence, 'statut'>>;

/**
 * Absence en vigueur couvrant chaque jour de la semaine `w`, du lundi au vendredi ; null les autres jours :
 * congé validé (CP, RTT / repos, récupération), absence hors congés qualifiée (arrêt, maternité, événement familial…)
 * ou signalée en attendant sa qualification. Aucune heure ne peut être saisie ces jours-là (double paiement sinon).
 * Source unique pour la saisie, la proposition Keystone, la soumission, la validation et la grille.
 * `absences` remplace les absences en vigueur pour contrôler une absence avant de la poser ou de la valider,
 * ou pour repérer les demandes en attente (`demandesAbsence`).
 */
export function joursAbsence(d: Domain, empId: number, w: ISODate, absences: AbsenceJour[] = d.ds.absences.filter(absenceBloque)): (AbsenceJour | null)[] {
  return wDays(w).map(day => absences.find(a => a.empId === empId && a.du <= day && a.au >= day) ?? null);
}

/** Demandes d'absence en attente de décision : elles ne bloquent pas la saisie, mais la validation de la feuille. */
export const demandesAbsence = (d: Domain): AbsenceJour[] => d.ds.absences.filter(a => a.statut === 'demandee');

export interface HeuresSurAbsence { di: number; day: ISODate; absence: AbsenceJour }

/** Jours d'absence de la feuille qui portent encore des heures, à retirer avant soumission et validation. */
export function heuresSurAbsence(d: Domain, sh: Pick<FeuilleTemps, 'empId' | 'week' | 'lignes'>, absences?: AbsenceJour[]): HeuresSurAbsence[] {
  const wd = wDays(sh.week);
  return joursAbsence(d, sh.empId, sh.week, absences).flatMap((absence, di) =>
    absence && sh.lignes.some(l => num(l.h[di]) > 0) ? [{ di, day: wd[di], absence }] : []);
}

/**
 * Nature d'une absence dans un message : « CP », « RTT », « récupération », « congé de maternité »…
 * Vide pour une absence à qualifier ou une nature médicale : un message ne la révèle jamais, quel que soit son lecteur.
 */
export const natureAbsence = (t: AbsenceType): string =>
  t === 'CP' || t === 'RTT' ? t : t === 'RECUP' ? 'récupération' : natureMedicale(t) ? '' : natureDef(t)?.court ?? '';
const entreParentheses = (a: AbsenceJour) => { const n = natureAbsence(a.type); return n ? ` (${n})` : ''; };
const jourCourt = (s: ISODate) => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const liste = (items: string[]) => items.length > 1 ? `les ${items.slice(0, -1).join(', ')} et ${items.at(-1)}` : `le ${items[0]}`;

/** « Absence validée ce jour-là (CP) », « Absence signalée ce jour-là ». */
export const absenceCeJour = (a: AbsenceJour) => `Absence ${a.statut === 'signalee' ? 'signalée' : 'validée'} ce jour-là${entreParentheses(a)}`;

/** « le lun. 12 oct. », « les lun. 12 oct. et mar. 13 oct. ». */
export const joursTexte = (days: ISODate[]) => liste(days.map(jourCourt));

/** « le lun. 12 oct. (CP) », « les lun. 12 oct. et mar. 13 oct. (CP) », « les lun. 12 oct. (CP) et ven. 16 oct. (RTT) ». */
export function joursAbsenceTexte(list: { day: ISODate; absence: AbsenceJour }[]): string {
  const natures = [...new Set(list.map(x => entreParentheses(x.absence)))];
  return natures.length === 1
    ? `${joursTexte(list.map(x => x.day))}${natures[0]}`
    : liste(list.map(x => `${jourCourt(x.day)}${entreParentheses(x.absence)}`));
}

/** Refus de soumission ou de validation : jours concernés et marche à suivre (`suite` : « avant de soumettre la feuille »…). */
export function heuresSurAbsenceMessage(list: HeuresSurAbsence[], suite: string): string {
  const etats = new Set(list.map(x => x.absence.statut === 'signalee' ? 'signalée' : 'validée'));
  return `Absence ${etats.size > 1 ? 'validée ou signalée' : [...etats][0]} ${joursAbsenceTexte(list)} : retirez les heures saisies ${list.length > 1 ? 'ces jours-là' : 'ce jour-là'} ${suite}`;
}

/**
 * Semaine sans heure attendue : chaque jour est férié, non travaillé (temps partiel), hors contrat ou couvert par une
 * absence en vigueur, et au moins un par une absence (semaine d'arrêt, de congés…). La feuille se soumet alors sans heure.
 */
export function semaineCouverte(d: Domain, e: Employe, w: ISODate, sh: { contrat?: ContratFige | null } | null = null): boolean {
  const off = d.contratOf(employeDeLaFeuille(e, sh)).jourOff, abs = joursAbsence(d, e.id, w);
  return abs.some(Boolean) && wDays(w).every((day, i) => !!abs[i] || isFerie(day) || off.includes(i) || !!jourHorsContrat(e, day));
}

/**
 * Demande d'absence en attente sur des jours qui portent des heures : à décider avant de valider la feuille,
 * car une feuille validée n'est plus modifiable et l'absence ne pourrait alors plus être validée.
 * `valideur` : refus de validation et marche à suivre ; sinon, simple signalement dans la grille.
 */
export function demandesEnAttenteMessage(list: HeuresSurAbsence[], valideur = true): string {
  const plus = new Set(list.map(x => x.absence)).size > 1, jours = list.length > 1 ? 'ces jours-là' : 'ce jour-là';
  const debut = `${plus ? 'Demandes' : 'Demande'} d’absence en attente ${joursAbsenceTexte(list)}`;
  return valideur
    ? `${debut} : ${plus ? 'décidez-les' : 'décidez-la'} avant de valider la feuille — pour ${plus ? 'les ' : 'l’'}accepter, retirez d’abord les heures saisies ${jours}`
    : `${debut} : des heures sont saisies ${jours}, à retirer si ${plus ? 'elles sont acceptées' : 'elle est acceptée'}`;
}

/**
 * Tâches Keystone du salarié planifiées la semaine `w` : dates de la tâche et heures prévues
 * du lundi au vendredi (le samedi et le dimanche ne figurent pas sur la feuille). Un projet archivé
 * dans Keystone ne reçoit plus d'heures (temps.addLine) : ses tâches ne sont plus proposées.
 */
export function tachesDeLaSemaine(d: Domain, empId: number, w: ISODate): TacheKeystone[] {
  const wd = wDays(w);
  const clos = new Set(d.ds.referentiels.projets.filter(p => p.statut === 'archive').map(p => p.code));
  return d.ds.taches.filter(t => t.empId === empId && !clos.has(t.projet) && t.debut <= wd[4] && t.fin >= w && wd.some(day => num(t.heures?.[day]) > 0));
}

/**
 * Lignes proposées à partir des tâches Keystone de la semaine : heures planifiées jour par jour
 * (fériés, absences, jours non travaillés et hors contrat à zéro).
 */
export function suggestLines(d: Domain, e: Employe, w: ISODate): LigneTemps[] {
  const wd = wDays(w), off = d.contratOf(e).jourOff, abs = joursAbsence(d, e.id, w);
  return tachesDeLaSemaine(d, e.id, w).map(t => ({
    projet: t.projet, tache: t.tache, ks: true,
    h: wd.map((day, i) => isFerie(day) || abs[i] || off.includes(i) || jourHorsContrat(e, day) ? 0 : num(t.heures[day])),
  }));
}

/**
 * Rubriques de paie d'une feuille (codes internes, RUBRIQUES_PAIE de shared/constants.ts). Heures supplémentaires selon
 * le mode : payées (HS25, HS50), remplacées par un repos (RCR_ACQUIS seul) ou, feuille d'avant le choix du mode, les deux.
 * Les heures incluses à un forfait hebdomadaire (HSF25, HSF50) restent payées.
 */
export function sageRubriques(d: Domain, e: Employe, sh: Pick<FeuilleTemps, 'lignes'> & Partial<Pick<FeuilleTemps, 'contrat' | 'heuresSup'>>): Record<string, number> {
  const c = calcSheet(d, e, sh);
  if (c.c.forfait) return { JTRAV: c.jours };
  if (c.c.annuel) return { HN: r1(c.total) };
  const payees = c.modeHS !== 'repos' || c.c.interim;
  return {
    HN: r1(c.normal),
    ...(c.incluses25 ? { HSF25: r1(c.incluses25) } : {}),
    ...(c.incluses50 ? { HSF50: r1(c.incluses50) } : {}),
    ...(payees && c.sup25 ? { HS25: r1(c.sup25) } : {}),
    ...(payees && c.sup50 ? { HS50: r1(c.sup50) } : {}),
    ...(c.hc10 ? { HC10: r1(c.hc10) } : {}),
    ...(c.hc25 ? { HC25: r1(c.hc25) } : {}),
    ...(c.recup ? { RCR_ACQUIS: r1(c.recup) } : {}),
  };
}

/** Variables d'une feuille dans une période de paie (codes internes) ; `origine` : période close, d'où le rappel. */
export interface RubriquesPeriode { periode: string; origine: string | null; rubriques: Record<string, number> }

/**
 * Rubriques d'une feuille par période de paie (shared/rules/paie.ts) : une seule part, sauf une semaine à cheval sur deux
 * mois ventilée jour par jour. Chaque part reçoit le décompte cumulé jusqu'à son dernier jour, moins celui des parts
 * précédentes : les heures gardent leur rang dans la semaine (les heures supplémentaires sont les dernières) et les
 * parts s'additionnent exactement au décompte de la semaine.
 */
export function rubriquesParPeriode(d: Domain, e: Employe, sh: FeuilleTemps): RubriquesPeriode[] {
  const parts = periodesSemaine(sh.week, d.ds.settings, d.ti);
  if (parts.length === 1) return [{ periode: parts[0].periode, origine: parts[0].origine, rubriques: sageRubriques(d, e, sh) }];
  let avant: Record<string, number> = {};
  return parts.map(p => {
    const dernier = Math.max(...p.jours);
    const cumul = sageRubriques(d, e, { ...sh, lignes: sh.lignes.map(l => ({ ...l, h: l.h.map((v, i) => (i <= dernier ? v : 0)) })) });
    const rubriques = Object.fromEntries(Object.entries(cumul).map(([k, v]) => [k, r1(v - (avant[k] ?? 0))]));
    avant = cumul;
    return { periode: p.periode, origine: p.origine, rubriques };
  });
}

/** Feuilles validées, non encore transmises, hors intérimaires (relevé envoyé à l'agence) et cadres dirigeants. */
export function sagePending(d: Domain): FeuilleTemps[] {
  return d.ds.feuilles.filter(sh => {
    const e = d.emp(sh.empId);
    if (!e || sh.statut !== 'validee' || sh.sage) return false;
    const c = d.contratOf(employeDeLaFeuille(e, sh));
    return !c.interim && !c.dirigeant;
  });
}

/**
 * Variables de paie transmises à Sage : une ligne par feuille et par période de paie (rappel d'une période close avec
 * `periode_origine`), rubriques traduites en codes Sage (désactivées retirées, quantités nulles omises ; une ligne sans
 * quantité n'est pas émise). Semaine ISO : son année est celle du jeudi (la semaine du 29 décembre 2025 est
 * « 2026-S01 ») ; `envoye_le` : heure réelle de l'envoi, à l'heure de Paris (décalage d'hiver ou d'été).
 */
export function buildSagePayload(d: Domain, sheets: FeuilleTemps[], dossier: string, maintenant = new Date(), mode: SageMode = 'simulation'): SagePush {
  const table = rubriquesPaie(d.ds.rubriquesPaie);
  // Matricule du dossier de paie ; à défaut (simulation seulement : une transmission réelle le refuse), le matricule Cursus.
  const lignes = sheets.flatMap(sh => rubriquesParPeriode(d, d.emp(sh.empId)!, sh).map(p => ({
    matricule: matriculeAffiche(d.emp(sh.empId) ?? { id: sh.empId, matriculePaie: null }),
    semaine: `${isoWeekYear(sh.week)}-S${String(isoWeek(sh.week)).padStart(2, '0')}`,
    periode: p.periode,
    ...(p.origine ? { periode_origine: p.origine } : {}),
    rubriques: traduireRubriques(p.rubriques, table),
  }))).filter(l => Object.keys(l.rubriques).length > 0);
  return {
    endpoint: 'POST /sage-paie/v1/variables',
    dossier,
    mode,
    envoye_le: horodatageParis(maintenant),
    periodes: [...new Set(lignes.map(l => l.periode))].sort(),
    lignes,
  };
}

/** Codes internes émis (quantité non nulle) par des feuilles : ceux dont la correspondance doit être confirmée. */
export function rubriquesEmises(d: Domain, sheets: FeuilleTemps[]): Set<string> {
  return new Set(sheets.flatMap(sh => rubriquesParPeriode(d, d.emp(sh.empId)!, sh).flatMap(p => Object.keys(p.rubriques).filter(k => p.rubriques[k]))));
}
