// Congés payés, RTT / jours de repos, récupération et compte épargne-temps.
// CCN Industries chimiques : 25 jours ouvrés, pas de congés d'ancienneté,
// +5 jours ouvrés à partir de 59 ans.
import { ABS_LABEL } from '../constants.ts';
import { addD, addM, cpPeriods, isFerie, isoWeek, isValidDate, parse } from '../dates.ts';
import { fH, fJ, fmt, fmtShort, r1 } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { AbsenceType, CongeType, Employe, ISODate, NatureAbsence } from '../types.ts';
import { absenceActive, absenceBloque, borneContrat, joursDecomptes, natureDef, periodeTexte, uniteDecompte } from './absences.ts';
import { conflitsDates } from './conflits.ts';
import { calcSheet, heuresSurAbsence, joursTexte, type AbsenceJour } from './temps.ts';

/** Nombre de mois (sur `n` à partir de `start`) où le salarié était présent à mi-mois. */
export function monthsPresent(e: Employe, start: ISODate, n: number): number {
  let m = 0;
  for (let k = 0; k < n; k++) {
    const mid = addD(addM(start, k), 14);
    if (e.entree <= mid && (!e.fin || e.fin >= mid)) m++;
  }
  return m;
}

function reprise(d: Domain, id: number) {
  return d.ds.soldesReprise.find(s => s.empId === id) ?? { empId: id, cpPris: 0, rttPris: 0, recupAcquis: 0, recupPris: 0 };
}

/** Droits CP de la période à prendre, avant décompte des jours pris. */
export function cpDroit(d: Domain, e: Employe) {
  const P = cpPeriods(d.ti);
  const acq = Math.ceil(25 / 12 * monthsPresent(e, P.acqStart, 12));
  const ageSupp = supplementAge(d, e, anneeCp(d.ti));
  const recu = d.ds.reports.filter(r => r.empId === e.id && r.sens === 'recu').reduce((n, r) => n + r.jours, 0);
  const accorde = d.ds.reports.filter(r => r.empId === e.id && r.sens !== 'recu').reduce((n, r) => n + r.jours, 0);
  return { acq, ageSupp, recu, accorde, droit: acq + ageSupp + recu };
}

/**
 * Année de prise d'un jour de congé : les CP pris du 1er juin A au 31 mai A+1 sont ceux acquis du 1er juin A-1
 * au 31 mai A, période de référence « A-1-A » (`periodeCp`). La période en cours est `anneeCp(d.ti)`.
 */
export const anneeCp = (s: ISODate) => Number(s.slice(0, 4)) - (s.slice(5) < '06-01' ? 1 : 0);
/** Période de référence des CP à prendre à partir du 1er juin `A` : « 2025-2026 » pour 2026 (`cpPeriods(…).label`). */
export const periodeCp = (A: number) => `${A - 1}-${A}`;

/**
 * Supplément de la CCN (5 jours à partir de 59 ans, l'âge étant connu par l'année de naissance) sur les CP de la période
 * `A`, pris du 1er juin A au 31 mai A+1 : accordé dès l'année civile des 59 ans, celle de A de juin à décembre, celle de
 * A+1 de janvier à mai. Une période passée garde la valeur de sa fin, une période à venir celle de son début : les droits
 * d'une période ne baissent ni au 1er janvier ni au 1er juin, et un congé déjà décompté sur ces 5 jours n'est pas repris
 * par anticipation sur la période suivante. Règle unique de `cpDroit` (période en cours) et `droitPeriode`.
 */
export function supplementAge(d: Domain, e: Employe, A: number): number {
  const annee = Math.min(A + 1, Math.max(A, d.year));
  return annee - e.naissance >= 59 ? 5 : 0;
}

/**
 * Droits d'une période (`A` : année de prise) : ceux de la période en cours (`cpDroit`, reports compris) ; sinon les jours
 * acquis du 1er juin A-1 au 31 mai A — pour une période à venir, ceux qui le seront d'ici là, dates du contrat comprises —
 * et les 5 jours de la CCN à partir de 59 ans (`supplementAge`).
 */
function droitPeriode(d: Domain, e: Employe, A: number): number {
  if (A === anneeCp(d.ti)) return cpDroit(d, e).droit;
  return Math.ceil(25 / 12 * monthsPresent(e, `${A - 1}-06-01`, 12)) + supplementAge(d, e, A);
}

/** Jours acquis à la date `jour` sur la période `A`, en cours d'acquisition : 2,08 j par mois écoulé depuis le 1er juin A-1. */
function acquisAu(e: Employe, A: number, jour: ISODate): number {
  const mois = (Number(jour.slice(0, 4)) - (A - 1)) * 12 + Number(jour.slice(5, 7)) - 6;
  return 25 / 12 * monthsPresent(e, `${A - 1}-06-01`, Math.max(0, Math.min(12, mois)));
}

/** Jour de CP imputé : `periode` est l'année de prise de la période qui le décompte (voir `anneeCp`). */
export interface JourCp { jour: ISODate; statut: 'validee' | 'demandee' | 'nouveau'; periode: number; anticipe: boolean; horsDroit: boolean }

/**
 * Imputation des congés payés jour par jour, dans l'ordre chronologique (congés validés et demandés ; `nouveau` : la
 * demande à contrôler). Chaque jour est décompté sur la période dont les congés se prennent à sa date : un congé de mai
 * à juin est ventilé sur deux périodes, un congé de l'été prochain est décompté sur la période en cours d'acquisition.
 * Période épuisée : le jour est pris par anticipation sur la période suivante, en cours d'acquisition, dans la limite
 * des jours qui seront acquis à la date du congé (décision de l'entreprise) ; il en est déduit quand ses congés se
 * prennent, au 1er juin. Au-delà, le jour est hors droit (solde insuffisant).
 * Déjà consommés : les compteurs repris de l'ancien système (période en cours) et les jours placés sur le CET (par période).
 */
export function imputationCp(d: Domain, e: Employe, nouveau?: { du: ISODate; au: ISODate }): JourCp[] {
  const droits = new Map<number, number>(), imputes = new Map<number, number>();
  const droit = (A: number) => droits.get(A) ?? droits.set(A, droitPeriode(d, e, A)).get(A)!;
  const impute = (A: number) => imputes.get(A) ?? 0;
  const ajoute = (A: number, n: number) => imputes.set(A, impute(A) + n);
  /** Encore un jour de place sur la période `A` dans la limite donnée (droits, ou jours acquis à la date). */
  const place = (A: number, limite: number) => impute(A) + 1 <= limite + 1e-9;
  ajoute(anneeCp(d.ti), reprise(d, e.id).cpPris);
  d.ds.cet.filter(x => x.empId === e.id && x.type === 'CP').forEach(x => ajoute(Number(x.periode.slice(-4)), x.jours));
  const conges: { du: ISODate; au: ISODate; statut: JourCp['statut'] }[] = [
    ...d.ds.absences.filter(a => a.empId === e.id && a.type === 'CP' && (a.statut === 'validee' || a.statut === 'demandee'))
      .map(a => ({ du: a.du, au: a.au, statut: a.statut as 'validee' | 'demandee' })),
    ...(nouveau ? [{ ...nouveau, statut: 'nouveau' as const }] : []),
  ];
  return conges
    .flatMap(a => d.countedDays(e, a.du, a.au, 'CP').map(jour => ({ jour, statut: a.statut })))
    .sort((x, y) => x.jour.localeCompare(y.jour))
    .map(({ jour, statut }) => {
      const A = anneeCp(jour);
      if (place(A, droit(A))) { ajoute(A, 1); return { jour, statut, periode: A, anticipe: false, horsDroit: false }; }
      if (place(A + 1, acquisAu(e, A + 1, jour))) { ajoute(A + 1, 1); return { jour, statut, periode: A + 1, anticipe: true, horsDroit: false }; }
      ajoute(A, 1);
      return { jour, statut, periode: A, anticipe: false, horsDroit: true };
    });
}

/** Solde d'une période (`A` : année de prise) : droits moins jours imputés (validés, demandés, CET, compteurs repris). */
function soldePeriode(d: Domain, e: Employe, A: number): number {
  const cet = d.ds.cet.filter(x => x.empId === e.id && x.type === 'CP' && Number(x.periode.slice(-4)) === A).reduce((n, x) => n + x.jours, 0);
  const repris = A === anneeCp(d.ti) ? reprise(d, e.id).cpPris : 0;
  return droitPeriode(d, e, A) - imputationCp(d, e).filter(j => j.periode === A).length - cet - repris;
}

/**
 * Solde CP de la période en cours : droits moins jours pris (compteurs repris, congés validés, CET) et posés (demandes),
 * chaque jour imputé sur sa période (`imputationCp`). `suivante` : jours déjà imputés sur la période en cours
 * d'acquisition (pris par anticipation — `anticipes` — ou posés à partir du 1er juin prochain).
 */
export function cpInfo(d: Domain, e: Employe) {
  const c = d.contratOf(e);
  if (c.interim) return null;
  const P = cpPeriods(d.ti), A = anneeCp(d.ti);
  const base = cpDroit(d, e);
  const jours = imputationCp(d, e);
  const sur = (periode: number, statut: JourCp['statut']) => jours.filter(j => j.periode === periode && j.statut === statut).length;
  const cetCp = d.ds.cet.filter(x => x.empId === e.id && x.type === 'CP' && x.periode === P.label).reduce((n, x) => n + x.jours, 0);
  const pris = reprise(d, e.id).cpPris + sur(A, 'validee') + cetCp, poses = sur(A, 'demandee');
  const suivante = jours.filter(j => j.periode === A + 1).length, anticipes = jours.filter(j => j.periode === A + 1 && j.anticipe).length;
  return {
    ...base, cetCp, pris, poses, solde: base.droit - pris - poses, suivante, anticipes,
    enCours: r1(25 / 12 * monthsPresent(e, P.prisStart, P.monthsElapsed)), periodes: P,
  };
}

/** Jours de repos d'un forfait annuel en jours (218 par défaut) pour l'année civile. */
export function reposForfait(year: number, joursForfait = 218): number {
  let we = 0, fo = 0, total = 0;
  for (let s = `${year}-01-01`; s <= `${year}-12-31`; s = addD(s, 1)) {
    total++;
    const dd = parse(s).getDay();
    if (dd === 0 || dd === 6) we++;
    else if (isFerie(s)) fo++;
  }
  return Math.max(0, total - we - 25 - fo - joursForfait);
}

/**
 * RTT (39 h) ou jours de repos (forfait jours) : droit annuel, au prorata des mois de l'année passés sous le régime
 * actuel — de l'entrée ou du passage au régime (`tempsDepuis`) jusqu'à la fin du contrat (CDD, alternance). Un mois
 * compte si le salarié y est présent, sous ce régime, à la mi-mois (`monthsPresent`, comme l'acquisition des CP) : un
 * CDD de janvier à mars reçoit 3/12 du droit annuel, un contrat d'une semaine à cheval sur deux mois aucun jour.
 * Intérim : aucun droit dans Cursus.
 */
export function rttDroit(d: Domain, e: Employe): number | null {
  const c = d.contratOf(e);
  if (c.interim || (!c.rtt && !c.forfait)) return null;
  const Y = d.year;
  const depuis = [e.entree, e.tempsDepuis ?? ''].sort().at(-1)!;
  const mois = monthsPresent({ ...e, entree: depuis }, `${Y}-01-01`, 12);
  return Math.round((c.forfait ? reposForfait(Y, c.joursForfait) : Number(d.ds.settings.rtt39) || 0) * mois / 12);
}

export function rttInfo(d: Domain, e: Employe) {
  const droit = rttDroit(d, e);
  if (droit == null) return null;
  const c = d.contratOf(e), Y = d.year;
  const absD = (st: string) => d.ds.absences
    .filter(a => a.empId === e.id && a.type === 'RTT' && a.statut === st && a.du >= `${Y}-01-01` && a.du <= `${Y}-12-31`)
    .reduce((n, a) => n + d.countDays(e, a.du, a.au, 'RTT'), 0);
  const cetRtt = d.ds.cet.filter(x => x.empId === e.id && x.type === 'RTT' && x.periode === String(Y)).reduce((n, x) => n + x.jours, 0);
  const pris = reprise(d, e.id).rttPris + absD('validee') + cetRtt, poses = absD('demandee');
  return { cetRtt, droit, pris, poses, solde: droit - pris - poses, label: c.forfait ? 'Jours de repos (forfait)' : 'RTT' };
}

/** Repos compensateur de remplacement, en heures (horaires hebdomadaires avec heures supplémentaires). */
export function recupInfo(d: Domain, e: Employe) {
  const c = d.contratOf(e);
  if (c.forfait || c.partiel || c.interim || c.dirigeant || c.annuel) return null;
  const R = reprise(d, e.id), dh = d.dayH(e);
  const acq = R.recupAcquis + d.ds.feuilles.filter(sh => sh.empId === e.id && sh.statut === 'validee').reduce((n, sh) => n + calcSheet(d, e, sh).recup, 0);
  const absH = (st: string) => d.ds.absences
    .filter(a => a.empId === e.id && a.type === 'RECUP' && a.statut === st)
    .reduce((n, a) => n + d.countDays(e, a.du, a.au, 'RECUP') * dh, 0);
  const pris = R.recupPris + absH('validee'), poses = absH('demandee');
  return { acq, pris, poses, solde: acq - pris - poses, dh };
}

/** Compte épargne-temps : 5 RTT par an et 5 CP de 5e semaine par période au maximum. */
export function cetInfo(d: Domain, e: Employe) {
  const cp = cpInfo(d, e), rt = rttInfo(d, e), list = d.ds.cet.filter(x => x.empId === e.id);
  const sum = (t: string) => list.filter(x => x.type === t).reduce((n, x) => n + x.jours, 0);
  const placeCp = cp ? Math.max(0, Math.min(5 - cp.cetCp, cp.acq - 20 - cp.cetCp, cp.solde)) : 0;
  const placeRtt = cp && rt ? Math.max(0, Math.min(5 - rt.cetRtt, rt.solde)) : 0;
  return {
    total: sum('CP') + sum('RTT'), cp: sum('CP'), rtt: sum('RTT'), placeCp, placeRtt,
    cp5: cp ? Math.max(0, cp.acq - 20) : 0, cpDone: cp ? cp.cetCp : 0, rttDone: rt ? rt.cetRtt : 0,
    rttLabel: rt ? rt.label : 'RTT', eligible: !!cp,
  };
}

/** Congés ouverts au salarié selon son contrat (les absences hors congés se signalent : `checkNature`). */
export function absenceKinds(d: Domain, e: Employe): [CongeType, string][] {
  const rt = rttInfo(d, e);
  return [
    ...(cpInfo(d, e) ? [['CP', 'Congés payés'] as [CongeType, string]] : []),
    ...(rt ? [['RTT', rt.label] as [CongeType, string]] : []),
    ...(recupInfo(d, e) ? [['RECUP', 'Récupération'] as [CongeType, string]] : []),
  ];
}

/**
 * Heures déjà saisies sur les jours d'une absence (avant de la poser validée ou de la valider) : marche à suivre,
 * feuille par feuille, ou null. `quand` : « avant de valider l’absence »…
 * Une feuille validée n'est jamais modifiée rétroactivement : l'absence ne peut alors pas couvrir ces jours (`validee`).
 */
export function heuresAvantAbsence(d: Domain, a: AbsenceJour, quand: string): { text: string; validee: boolean } | null {
  const feuilles = d.ds.feuilles
    .filter(sh => sh.empId === a.empId && sh.week <= a.au && addD(sh.week, 4) >= a.du)
    .map(sh => ({ sh, jours: heuresSurAbsence(d, sh, [a]).map(h => h.day) }))
    .filter(x => x.jours.length)
    .sort((x, y) => x.sh.week.localeCompare(y.sh.week));
  if (!feuilles.length) return null;
  const text = feuilles.map(({ sh, jours }) => {
    const j = joursTexte(jours), s = isoWeek(sh.week);
    if (sh.statut === 'validee') return `Heures déjà validées ${j} (semaine ${s}) : la feuille n’est pas modifiée rétroactivement, l’absence ne peut pas couvrir ${jours.length > 1 ? 'ces jours' : 'ce jour'}.`;
    if (sh.statut === 'soumise') return `Heures déjà saisies ${j} sur la feuille soumise de la semaine ${s} : la renvoyer pour correction (ou la corriger) puis retirer ces heures ${quand}.`;
    return `Heures déjà saisies ${j} : les retirer de la feuille de temps (semaine ${s}) ${quand}.`;
  }).join(' ');
  return { text, validee: feuilles.some(x => x.sh.statut === 'validee') };
}

/**
 * Contrôle d'une demande de congé : décompte, soldes, bornes du contrat, chevauchements, missions, heures déjà saisies.
 * `valider` : absence validée d'emblée (posée par le manager) — les heures saisies ces jours-là la bloquent.
 * Pour une simple demande, elles sont seulement signalées (la validation sera refusée tant qu'elles restent),
 * sauf sur une feuille déjà validée : l'absence ne pourra jamais couvrir ces jours, la demande est refusée.
 */
export function checkAbsence(d: Domain, e: Employe, kind: CongeType, du: string, au: string, valider = false) {
  const c = d.contratOf(e), cp = cpInfo(d, e), rt = rttInfo(d, e), rc = recupInfo(d, e);
  const kinds = absenceKinds(d, e);
  const valid = isValidDate(du) && isValidDate(au) && au >= du;
  const n = valid ? d.countDays(e, du, au, kind) : 0;
  const dispo = kind === 'CP' ? (cp ? cp.solde : 0) : kind === 'RTT' ? (rt ? rt.solde : 0) : (rc ? rc.solde / rc.dh : 0);
  // Un CP après la fin d'un CDD ou avant l'entrée n'a pas de sens : l'absence reste dans les bornes du contrat.
  const hors = valid ? borneContrat(e, du, au) : null;
  const overlap = valid && d.ds.absences.some(a => a.empId === e.id && absenceActive(a) && a.du <= au && a.au >= du);
  const m = valid ? d.ds.missions.find(x => x.empId === e.id && x.du <= au && x.au >= du) : undefined;
  // Congés payés : chaque jour est imputé sur sa période (`imputationCp`). Insuffisant si la demande laisse des jours hors
  // droit — les siens, ou ceux d'un congé déjà posé plus tard, qu'elle repousserait au-delà des jours acquis.
  const cpJours = kind === 'CP' && cp && valid ? imputationCp(d, e, { du, au }) : null;
  const nouveaux = cpJours ? cpJours.filter(j => j.statut === 'nouveau') : [];
  const horsDroit = !!cpJours && cpJours.filter(j => j.horsDroit).length > imputationCp(d, e).filter(j => j.horsDroit).length;
  const anticip = !horsDroit && nouveaux.some(j => j.anticipe);
  const autres = [...new Set(nouveaux.filter(j => !j.anticipe && j.periode !== anneeCp(d.ti)).map(j => j.periode))];
  const insuff = cpJours ? horsDroit : n > dispo;
  const rttLate = kind === 'RTT' && valid && au > `${d.year}-12-31`;
  const heures = valid ? heuresAvantAbsence(d, { empId: e.id, type: kind, du, au }, valider ? 'avant de poser l’absence' : 'avant la validation de l’absence') : null;
  const heuresBloquent = !!heures && (valider || heures.validee);
  const msgs: { text: string; bad: boolean }[] = [];
  const add = (text: string, bad = false) => msgs.push({ text, bad });
  if (valid) add(`Décompte : ${fJ(n)} ${kind === 'CP' ? 'ouvrés' : 'travaillés'} — week-ends et jours fériés exclus${kind !== 'CP' && c.jourOff.length ? ', jour non travaillé exclu' : ''}.`);
  if (hors) add(`Absence hors contrat : ${hors}.`, true);
  if (overlap) add('Une absence existe déjà sur ces dates.', true);
  if (insuff) add(cpJours ? 'Solde insuffisant pour cette demande, même par anticipation sur les jours acquis à la date du congé.' : 'Solde insuffisant pour cette demande.', true);
  autres.forEach(A => add(`Congés imputés sur la période ${periodeCp(A)}, dont les droits se prennent à partir du 1er juin ${A}.`));
  if (anticip) {
    const A = Math.max(...nouveaux.filter(j => j.anticipe).map(j => j.periode));
    add(`Prise par anticipation sur les congés en cours d’acquisition (période ${periodeCp(A)}), dans la limite des jours acquis à la date du congé — soumise à l’accord du manager.`);
  }
  if (rttLate) add(`Les RTT ${d.year} doivent être pris avant le 31 décembre : ils ne sont pas reportables.`, true);
  if (heures) add(heures.text, heuresBloquent);
  if (m) add(`Affecté au chantier ${m.projet} (${m.lieu}, ${fmtShort(parse(m.du))} → ${fmtShort(parse(m.au))}) — le chef de projet sera notifié dans Keystone.`, true);
  // Session de formation, déplacement ou entretien prévus ces jours-là : à reprogrammer si l'absence est accordée.
  if (valid) conflitsDates(d, e.id, du, au, 'absence').forEach(x => add(`${x.text} : à reprogrammer si l’absence est accordée.`));
  if (e.fin && kind === 'CP') add(`Fin de contrat le ${fmt(parse(e.fin))} : les CP non pris donneront lieu à une indemnité compensatrice.`);
  // Congé de l'été prochain : solde de la période sur laquelle il est imputé.
  const Ademande = cpJours ? anneeCp(du) : null;
  const soldeLabel = kind === 'RECUP' && rc ? `Disponible : ${fH(rc.solde)} (≈ ${fJ(rc.solde / rc.dh)})`
    : Ademande != null && Ademande !== anneeCp(d.ti) ? `Disponible sur la période ${periodeCp(Ademande)} : ${fJ(soldePeriode(d, e, Ademande))}`
    : `Disponible : ${fJ(dispo)}`;
  const cant = !valid || n === 0 || !!hors || overlap || insuff || rttLate || heuresBloquent || !kinds.some(k => k[0] === kind);
  return { valid, n, dispo, msgs, soldeLabel, cant, kinds };
}

/**
 * Contrôle d'une absence hors congés — signalement, saisie ou qualification par le RH, prolongation (`du`…`au` : la
 * seule prolongation) : décompte, bornes du contrat, chevauchements, heures déjà saisies (elles bloquent : l'absence
 * est en vigueur dès son enregistrement), durée légale (simple avertissement : la CCN peut être plus favorable).
 * Aucun solde n'est débité. `exclure` : l'absence elle-même ; `quand` : « avant de signaler l’absence »… ;
 * `depuis` : début de l'absence prolongée — la durée légale porte sur toute l'absence, prolongation comprise.
 */
export function checkNature(d: Domain, e: Employe, type: NatureAbsence | 'ABSENCE', du: string, au: string, opts: { exclure?: number; quand: string; depuis?: ISODate }) {
  const def = natureDef(type), unite = uniteDecompte(type);
  const valid = isValidDate(du) && isValidDate(au) && au >= du;
  const n = valid ? joursDecomptes(d, e, { type, du, au }) : 0;
  const debut = opts.depuis && opts.depuis < du ? opts.depuis : du;
  const total = valid && debut !== du ? joursDecomptes(d, e, { type, du: debut, au }) : n;
  const hors = valid ? borneContrat(e, du, au) : null;
  const autre = valid ? d.ds.absences.find(a => a.id !== opts.exclure && a.empId === e.id && absenceActive(a) && a.du <= au && a.au >= du) : undefined;
  const heures = valid ? heuresAvantAbsence(d, { empId: e.id, type, du, au }, opts.quand) : null;
  const m = valid ? d.ds.missions.find(x => x.empId === e.id && x.du <= au && x.au >= du) : undefined;
  const msgs: { text: string; bad: boolean }[] = [];
  const add = (text: string, bad = false) => msgs.push({ text, bad });
  if (valid) add(`Décompte : ${fJ(n)} ${unite}${total !== n ? ` (${fJ(total)} au total)` : ''}${unite === 'ouvrés' ? ' — week-ends et jours fériés exclus' : ''}.`);
  if (hors) add(`Absence hors contrat : ${hors}.`, true);
  if (autre) add(`Une absence existe déjà sur ces dates (${periodeTexte(autre.du, autre.au)}).`, true);
  if (heures) add(heures.text, true);
  if (valid && def?.duree) {
    // Enfant malade : durée annuelle, cumul de l'année civile (l'absence prolongée compte dans `total`).
    const deja = def.parAn
      ? d.ds.absences.filter(a => a.id !== opts.exclure && a.empId === e.id && a.type === type && absenceBloque(a) && a.du.slice(0, 4) === debut.slice(0, 4))
        .reduce((s, a) => s + joursDecomptes(d, e, a), 0)
      : 0;
    const duree = `${fJ(def.duree)} ${unite}${def.parAn ? ' par an' : ''}${def.dureeNote ? ` ; ${def.dureeNote}` : ''}`;
    add(total + deja > def.duree
      ? `Au-delà de la durée légale (${duree} — ${def.article}) : vérifiez le cas ou la convention collective.`
      : `Durée légale : ${duree} (${def.article}).`);
  }
  if (m) add(`Affecté au chantier ${m.projet} (${m.lieu}, ${fmtShort(parse(m.du))} → ${fmtShort(parse(m.au))}) — Keystone reçoit l’indisponibilité.`);
  // Session de formation, déplacement ou entretien prévus pendant l'absence : à reprogrammer.
  if (valid) conflitsDates(d, e.id, du, au, 'absence').forEach(x => add(`${x.text} : à reprogrammer.`));
  const cant = !valid || !!hors || !!autre || !!heures || (type !== 'ABSENCE' && !def);
  return { valid, n, unite, msgs, cant, def };
}

export const absenceLabel = (t: AbsenceType) => ABS_LABEL[t];
