// Congés payés, RTT / jours de repos, récupération et compte épargne-temps.
// CCN Industries chimiques : 25 jours ouvrés, pas de congés d'ancienneté,
// +5 jours ouvrés à partir de 59 ans.
import { ABS_LABEL } from '../constants.ts';
import { addD, addM, cpPeriods, isFerie, isoWeek, isValidDate, parse } from '../dates.ts';
import { fH, fJ, fmt, fmtShort, r1 } from '../format.ts';
import type { Domain } from '../domain.ts';
import type { AbsenceType, CongeType, Employe, ISODate, NatureAbsence } from '../types.ts';
import { absenceActive, absenceBloque, borneContrat, joursDecomptes, natureDef, periodeTexte, uniteDecompte } from './absences.ts';
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
  const ageSupp = d.year - e.naissance >= 59 ? 5 : 0;
  const recu = d.ds.reports.filter(r => r.empId === e.id && r.sens === 'recu').reduce((n, r) => n + r.jours, 0);
  const accorde = d.ds.reports.filter(r => r.empId === e.id && r.sens !== 'recu').reduce((n, r) => n + r.jours, 0);
  return { acq, ageSupp, recu, accorde, droit: acq + ageSupp + recu };
}

export function cpInfo(d: Domain, e: Employe) {
  const c = d.contratOf(e);
  if (c.interim) return null;
  const P = cpPeriods(d.ti);
  const base = cpDroit(d, e);
  const absD = (st: string) => d.ds.absences
    .filter(a => a.empId === e.id && a.type === 'CP' && a.statut === st && a.du >= P.prisStart)
    .reduce((n, a) => n + d.countDays(e, a.du, a.au, 'CP'), 0);
  const cetCp = d.ds.cet.filter(x => x.empId === e.id && x.type === 'CP' && x.periode === P.label).reduce((n, x) => n + x.jours, 0);
  const pris = reprise(d, e.id).cpPris + absD('validee') + cetCp, poses = absD('demandee');
  return { ...base, cetCp, pris, poses, solde: base.droit - pris - poses, enCours: r1(25 / 12 * monthsPresent(e, P.prisStart, P.monthsElapsed)), periodes: P };
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
 * RTT (39 h) ou jours de repos (forfait jours) : droit annuel, au prorata quand l'entrée ou le passage
 * au régime actuel (`tempsDepuis`) intervient en cours d'année. Intérim : aucun droit dans Cursus.
 */
export function rttDroit(d: Domain, e: Employe): number | null {
  const c = d.contratOf(e);
  if (c.interim || (!c.rtt && !c.forfait)) return null;
  const Y = d.year;
  const depuis = [e.entree, e.tempsDepuis ?? ''].sort().at(-1)!;
  const prorata = depuis > `${Y}-12-31` ? 0 : depuis > `${Y}-01-01` ? (12 - parse(depuis).getMonth()) / 12 : 1;
  return Math.round((c.forfait ? reposForfait(Y, c.joursForfait) : Number(d.ds.settings.rtt39) || 0) * prorata);
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
  const anticip = kind === 'CP' && !!cp && n > cp.solde && n <= cp.solde + cp.enCours;
  const insuff = n > dispo && !anticip;
  const rttLate = kind === 'RTT' && valid && au > `${d.year}-12-31`;
  const heures = valid ? heuresAvantAbsence(d, { empId: e.id, type: kind, du, au }, valider ? 'avant de poser l’absence' : 'avant la validation de l’absence') : null;
  const heuresBloquent = !!heures && (valider || heures.validee);
  const msgs: { text: string; bad: boolean }[] = [];
  const add = (text: string, bad = false) => msgs.push({ text, bad });
  if (valid) add(`Décompte : ${fJ(n)} ${kind === 'CP' ? 'ouvrés' : 'travaillés'} — week-ends et jours fériés exclus${kind !== 'CP' && c.jourOff.length ? ', jour non travaillé exclu' : ''}.`);
  if (hors) add(`Absence hors contrat : ${hors}.`, true);
  if (overlap) add('Une absence existe déjà sur ces dates.', true);
  if (insuff) add('Solde insuffisant pour cette demande.', true);
  if (anticip) add('Prise par anticipation sur les congés en cours d’acquisition — soumise à l’accord du manager.');
  if (rttLate) add(`Les RTT ${d.year} doivent être pris avant le 31 décembre : ils ne sont pas reportables.`, true);
  if (heures) add(heures.text, heuresBloquent);
  if (m) add(`Affecté au chantier ${m.projet} (${m.lieu}, ${fmtShort(parse(m.du))} → ${fmtShort(parse(m.au))}) — le chef de projet sera notifié dans Keystone.`, true);
  if (e.fin && kind === 'CP') add(`Fin de contrat le ${fmt(parse(e.fin))} : les CP non pris donneront lieu à une indemnité compensatrice.`);
  const soldeLabel = kind === 'RECUP' && rc ? `Disponible : ${fH(rc.solde)} (≈ ${fJ(rc.solde / rc.dh)})` : `Disponible : ${fJ(dispo)}`;
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
  const cant = !valid || !!hors || !!autre || !!heures || (type !== 'ABSENCE' && !def);
  return { valid, n, unite, msgs, cant, def };
}

export const absenceLabel = (t: AbsenceType) => ABS_LABEL[t];
