// Congés, RTT, récupération, absences hors congés (arrêts, parentalité, événements familiaux…),
// compte épargne-temps et reports de CP.
import { ABS_LABEL, NATURES_ABSENCE } from '../../../shared/constants.ts';
import { addD, cpPeriods, isValidDate, isoWeek, parse } from '../../../shared/dates.ts';
import { Domain } from '../../../shared/domain.ts';
import { fH, fJ, fmt, num } from '../../../shared/format.ts';
import {
  absenceVueManager, borneContrat, droitAnnulation, estConge, estNature, natureDef, periodeTexte, prolongeable, repriseAInscrire,
} from '../../../shared/rules/absences.ts';
import { cetInfo, checkAbsence, checkNature, cpInfo, heuresAvantAbsence } from '../../../shared/rules/conges.ts';
import { semaineCouverte } from '../../../shared/rules/temps.ts';
import type { Absence, AbsenceType, CetMouvement, CongeType, Employe, FeuilleTemps, NatureAbsence, ReportCp } from '../../../shared/types.ts';
import { absenceKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { notifierDecisionConge, notifierDemandeConge, notifierFeuilleRenvoyee } from '../notifications.ts';
import {
  ActionError, type ActionHandler, type Ctx, estSoiMeme, getEmp, isManagerOf, isRh, isSelf, isValidatorOf, refuserSoiMeme, requireRh, str,
} from './context.ts';

/** Le salarié ou le RH demandent ; le manager qui pose pour un membre de son équipe valide du même coup. */
const demander: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const parManager = isManagerOf(ctx, emp);
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || parManager)) throw new ActionError('Vous ne pouvez poser une absence que pour vous-même ou votre équipe', 403);
  const kind = str(p.kind) as CongeType;
  const chk = checkAbsence(ctx.d, emp, kind, p.du, p.au, parManager);
  if (chk.cant) throw new ActionError(chk.msgs.find(m => m.bad)?.text || 'Demande invalide');
  const a = ctx.db.insert<Absence>('absences', { empId: emp.id, type: kind, du: p.du, au: p.au, statut: parManager ? 'validee' : 'demandee', keystone: parManager });
  if (parManager) {
    keystone(ctx, 'absence.validee', a);
    notifierDecisionConge(ctx, emp, a, true, true); // e-mail : le salarié est informé
    return `Absence de ${emp.nom} (${ABS_LABEL[kind].toLowerCase()}) posée et validée — transmise à Keystone pour la planification`;
  }
  notifierDemandeConge(ctx, emp, a, ctx.d.mgrOf(emp)); // e-mail : la demande part au valideur
  return `Demande de ${ABS_LABEL[kind].toLowerCase()} envoyée ${ctx.d.mgrDest(ctx.d.mgrOf(emp))}`;
};

const decider: ActionHandler = (ctx, p) => {
  const a = ctx.ds.absences.find(x => x.id === Number(p.id));
  const ok = !!p.ok;
  // Même décision déjà prise (double clic, autre onglet, autre valideur) : rien n'est refait ni renvoyé à Keystone.
  const deja = a && a.statut === (ok ? 'validee' : 'refusee') ? ctx.d.emp(a.empId) : undefined;
  if (deja && isValidatorOf(ctx, deja)) return `Absence de ${deja.nom} déjà ${ok ? 'validée' : 'refusée'}`;
  if (!a || a.statut !== 'demandee') throw new ActionError('Demande introuvable ou déjà traitée');
  const emp = getEmp(ctx, a.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas décider de votre propre demande d’absence');
  if (!isValidatorOf(ctx, emp)) throw new ActionError('Décision réservée au manager du salarié ou au service RH', 403);
  // Demande antérieure au contrôle des bornes du contrat : jamais validée hors contrat.
  const hors = ok ? borneContrat(emp, a.du, a.au) : null;
  if (hors) throw new ActionError(`Absence hors contrat : ${hors}`);
  // Pas de double paiement : les heures saisies ces jours-là doivent d'abord être retirées de la feuille de temps.
  const heures = ok ? heuresAvantAbsence(ctx.d, a, 'avant de valider l’absence') : null;
  if (heures) throw new ActionError(heures.text);
  // Motif du refus, montré au salarié et à son manager dans leurs absences (l'écran l'exige ; un appel sans motif reste accepté).
  const motif = ok ? '' : str(p.motif);
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  ctx.db.update<Absence>('absences', a.id, { statut: ok ? 'validee' : 'refusee', keystone: ok, motifRefus: motif || null });
  if (ok) keystone(ctx, 'absence.validee', a);
  notifierDecisionConge(ctx, emp, a, ok);
  return ok ? `Absence de ${emp.nom} validée — transmise à Keystone pour la planification` : `Absence de ${emp.nom} refusée${motif ? ' · motif communiqué au salarié' : ''}`;
};

// — Absences hors congés : le manager (ou le salarié) signale, le service RH précise la nature —

function absenceOf(ctx: Ctx, id: unknown): Absence {
  const a = ctx.ds.absences.find(x => x.id === Number(id));
  if (!a) throw new ActionError('Absence introuvable', 404);
  return a;
}

/**
 * Indisponibilité transmise à Keystone : identifiant de l'absence, matricule et période complète, jamais la nature
 * (congé, arrêt…). Pour une même absence, le dernier événement remplace le précédent (docs/API-KEYSTONE.md).
 */
function keystone(ctx: Ctx, type: 'absence.validee' | 'absence.annulee', a: Pick<Absence, 'id' | 'empId' | 'du' | 'au'>) {
  sendToKeystone(ctx.db, absenceKeystone(type, a));
}

function natureDe(p: Record<string, any>): NatureAbsence {
  const n = str(p.nature);
  if (!estNature(n)) throw new ActionError('Nature d’absence inconnue');
  return n;
}

function justificatifDe(ctx: Ctx, p: Record<string, any>): Pick<Absence, 'justificatif' | 'justificatifLe'> {
  if (!p.justificatif) return { justificatif: false, justificatifLe: null };
  const le = str(p.justificatifLe) || ctx.d.ti;
  if (!isValidDate(le) || le > ctx.d.ti) throw new ActionError('Date de réception du justificatif invalide : aujourd’hui au plus tard');
  return { justificatif: true, justificatifLe: le };
}

/**
 * Reprise après une absence longue (maternité, adoption, congé parental, arrêt longue maladie) inscrite sur la fiche :
 * l'entretien de parcours professionnel de reprise est proposé à cette date (art. L6315-1). Seule l'écriture d'une absence
 * de ces natures (`avant` : son état précédent ; `type` : sa nature après l'écriture) la recalcule (`repriseAInscrire`).
 * Texte pour le message du RH.
 */
function majReprise(ctx: Ctx, emp: Employe, avant: Absence | null, type: AbsenceType): string {
  const { reprise: r, differee } = repriseAInscrire(emp, ctx.db.where<Absence>('absences', 'empId', emp.id), ctx.ds.entretiens, avant, type);
  if (r !== undefined) ctx.db.update('employes', emp.id, { repriseMotif: r?.motif ?? null, repriseDate: r?.date ?? null });
  if (!isRh(ctx)) return '';
  // Reprise antérieure dont l'entretien n'est pas réalisé : l'obligation reste sur la fiche.
  if (differee) return ` · reprise du ${fmt(parse(emp.repriseDate!))} conservée sur la fiche, entretien de reprise à réaliser : celle du ${fmt(parse(differee.date))} sera à inscrire ensuite`;
  if (r === undefined) return '';
  return r ? ` · reprise le ${fmt(parse(r.date))} : entretien de parcours professionnel à proposer` : ' · date de reprise effacée de la fiche';
}

/**
 * Absence annulée ou raccourcie (`a` : sa période avant l'écriture) : une feuille soumise sans heure parce que la semaine
 * était couverte serait validée à 0 h. Elle est renvoyée au salarié pour saisie des heures. Texte pour le message.
 */
function renvoyerFeuilles(ctx: Ctx, emp: Employe, a: Pick<Absence, 'du' | 'au'>): string {
  const apres = new Domain({ ...ctx.ds, absences: ctx.db.all<Absence>('absences') });
  const sh = ctx.ds.feuilles.filter(f => f.empId === emp.id && f.statut === 'soumise' && f.week <= a.au && addD(f.week, 4) >= a.du
    && !f.lignes.some(l => l.h.some(h => num(h) > 0)) && !semaineCouverte(apres, emp, f.week, f));
  sh.forEach(f => {
    ctx.db.update<FeuilleTemps>('feuilles', f.id, { statut: 'rejetee', comment: 'Absence annulée ou raccourcie : la semaine n’est plus couverte, saisissez les heures travaillées' });
    notifierFeuilleRenvoyee(ctx, emp, f.week, true);
  });
  const semaines = sh.map(f => isoWeek(f.week));
  if (!semaines.length) return '';
  return semaines.length > 1
    ? ` · feuilles de temps soumises sans heure (semaines ${semaines.join(', ')}) renvoyées pour saisie`
    : ` · feuille de temps soumise sans heure (semaine ${semaines[0]}) renvoyée pour saisie`;
}

const sansNature = (chk: { msgs: { text: string; bad: boolean }[] }) => new ActionError(chk.msgs.find(m => m.bad)?.text || 'Dates invalides');

/**
 * Absence imprévue signalée par l'intéressé, son manager direct ou le RH : en vigueur aussitôt (aucune heure ces jours-là,
 * indisponibilité transmise à Keystone) ; le service RH en précise ensuite la nature.
 */
const signaler: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || isManagerOf(ctx, emp))) throw new ActionError('Vous ne pouvez signaler une absence que pour vous-même ou votre équipe', 403);
  const du = str(p.du), au = str(p.au) || du;
  const chk = checkNature(ctx.d, emp, 'ABSENCE', du, au, { quand: 'avant de signaler l’absence' });
  if (chk.cant) throw sansNature(chk);
  // Un membre du RH qui signale sa propre absence depuis l'espace RH la signale comme intéressé.
  const interesse = isSelf(ctx, emp.id) || estSoiMeme(ctx, emp.id);
  const a = ctx.db.insert<Absence>('absences', {
    empId: emp.id, type: 'ABSENCE', du, au, statut: 'signalee', keystone: true, signaleLe: ctx.d.ti, signalePar: ctx.user.nom, signaleParInteresse: interesse, justificatif: false,
  });
  keystone(ctx, 'absence.validee', a);
  return `Absence de ${emp.nom} signalée ${periodeTexte(du, au)} — nature à préciser par le service RH${interesse ? ', à qui transmettre le justificatif' : ''} · indisponibilité transmise à Keystone`;
};

/** Saisie directe par le RH d'une absence hors congés, prévisible (maternité, congé parental, événement familial…) ou non. */
const saisir: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId), nature = natureDe(p), du = str(p.du), au = str(p.au);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas enregistrer une absence validée d’emblée pour vous-même');
  const chk = checkNature(ctx.d, emp, nature, du, au, { quand: 'avant d’enregistrer l’absence' });
  if (chk.cant) throw sansNature(chk);
  const just = justificatifDe(ctx, p);
  const a = ctx.db.insert<Absence>('absences', { empId: emp.id, type: nature, du, au, statut: 'validee', keystone: true, ...just });
  keystone(ctx, 'absence.validee', a);
  return `Absence de ${emp.nom} enregistrée ${periodeTexte(du, au)} : ${NATURES_ABSENCE[nature].court} — indisponibilité transmise à Keystone${majReprise(ctx, emp, null, nature)}`;
};

/** Qualification par le RH d'une absence signalée, ou correction d'une absence qualifiée : nature, justificatif, dates. */
const qualifier: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const a = absenceOf(ctx, p.id);
  if (!prolongeable(a)) throw new ActionError('Seule une absence signalée ou qualifiée, hors congés, se qualifie');
  const emp = getEmp(ctx, a.empId), nature = natureDe(p);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas qualifier votre propre absence');
  const du = str(p.du) || a.du, au = str(p.au) || a.au;
  const chk = checkNature(ctx.d, emp, nature, du, au, { exclure: a.id, quand: 'avant de qualifier l’absence' });
  if (chk.cant) throw sansNature(chk);
  const just = justificatifDe(ctx, p);
  ctx.db.update<Absence>('absences', a.id, { type: nature, du, au, statut: 'validee', keystone: true, ...just });
  // Dates corrigées : même absence, la nouvelle période remplace l'ancienne chez Keystone (jamais la nature).
  const corrigee = du !== a.du || au !== a.au;
  if (!a.keystone || corrigee) keystone(ctx, 'absence.validee', { ...a, du, au });
  const justTexte = just.justificatif ? `justificatif reçu le ${fmt(parse(just.justificatifLe!))}` : 'justificatif attendu';
  const renvoi = corrigee ? renvoyerFeuilles(ctx, emp, a) : '';
  return `Absence de ${emp.nom} qualifiée : ${NATURES_ABSENCE[nature].court} ${periodeTexte(du, au)}, ${justTexte}${renvoi}${majReprise(ctx, emp, a, nature)}`;
};

/**
 * Prolongation d'un arrêt ou d'une absence hors congés (nouvelle fin, sans chevauchement) par l'intéressé, son manager
 * direct ou le RH. Hors RH, l'absence repasse « à qualifier » : le service RH enregistre l'avis de prolongation (un
 * membre du RH qui prolonge sa propre absence le fait comme intéressé).
 */
const prolonger: ActionHandler = (ctx, p) => {
  const a = absenceOf(ctx, p.id);
  const emp = getEmp(ctx, a.empId);
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || isManagerOf(ctx, emp))) throw new ActionError('Vous ne pouvez prolonger qu’une absence de vous-même ou de votre équipe', 403);
  if (!prolongeable(a)) throw new ActionError(estConge(a.type) ? 'Un congé ne se prolonge pas : posez une nouvelle demande' : 'Absence annulée ou refusée : elle ne se prolonge pas');
  const au = str(p.au);
  if (!isValidDate(au) || au <= a.au) throw new ActionError(`Nouvelle fin requise, après le ${fmt(parse(a.au))}`);
  const debut = addD(a.au, 1);
  const chk = checkNature(ctx.d, emp, a.type as NatureAbsence | 'ABSENCE', debut, au, { exclure: a.id, quand: 'avant de prolonger l’absence', depuis: a.du });
  if (chk.cant) throw sansNature(chk);
  const statut = isRh(ctx) && !estSoiMeme(ctx, emp.id) ? a.statut : 'signalee';
  ctx.db.update<Absence>('absences', a.id, { au, statut, finInitiale: a.finInitiale ?? a.au, keystone: true });
  keystone(ctx, 'absence.validee', { ...a, au });
  const suite = statut === 'signalee' && a.statut === 'validee' ? ' — prolongation à qualifier par le service RH' : '';
  return `Absence de ${emp.nom} prolongée jusqu’au ${fmt(parse(au))}${suite} · indisponibilité transmise à Keystone${majReprise(ctx, emp, a, a.type)}`;
};

/**
 * Annulation : l'intéressé retire sa demande en attente (ou son propre signalement) ; le manager direct ou le RH annulent
 * une absence qui n'a pas commencé, le RH seul une absence commencée ou passée (`droitAnnulation`). Le solde est recrédité
 * (seuls les congés demandés ou validés le débitent), Keystone libère la période, une feuille soumise sans heure qui n'est
 * plus couverte est renvoyée et la reprise inscrite par l'absence est recalculée.
 */
const annuler: ActionHandler = (ctx, p) => {
  const a = absenceOf(ctx, p.id);
  const emp = getEmp(ctx, a.empId);
  // Périmètre d'abord : hors de celui-ci, aucun refus ne doit révéler l'état ou les dates de l'absence.
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || isManagerOf(ctx, emp))) throw new ActionError('Vous ne pouvez annuler qu’une absence de vous-même ou de votre équipe', 403);
  // Un membre du RH annule ses propres absences avec les droits de l'intéressé, jamais ceux du service RH.
  const soi = estSoiMeme(ctx, emp.id), self = isSelf(ctx, emp.id) || soi;
  const droit = droitAnnulation(a, ctx.d.ti, { rh: isRh(ctx) && !soi, self, manager: isManagerOf(ctx, emp) });
  if (!droit.ok) throw new ActionError(droit.raison, a.statut === 'refusee' || a.statut === 'annulee' ? 400 : 403);
  ctx.db.update<Absence>('absences', a.id, { statut: 'annulee', annuleeLe: ctx.d.ti, annuleePar: ctx.user.nom, keystone: false });
  if (a.keystone) keystone(ctx, 'absence.annulee', a);
  const n = estConge(a.type) ? ctx.d.countDays(emp, a.du, a.au, a.type) : 0, h = a.type === 'RECUP' ? n * ctx.d.dayH(emp) : 0;
  const recredit = !n ? '' : h ? ` — ${fH(h)} de récupération recréditée${h > 1 ? 's' : ''}` : ` — ${fJ(n)} de ${a.type} recrédité${n > 1 ? 's' : ''} sur le solde`;
  // Une feuille validée n'est jamais modifiée rétroactivement : des heures travaillées ces jours-là restent à régulariser.
  const semaines = ctx.ds.feuilles.filter(sh => sh.empId === emp.id && sh.statut === 'validee' && sh.week <= a.au && addD(sh.week, 4) >= a.du).map(sh => isoWeek(sh.week));
  const feuilles = semaines.length ? ` · ${semaines.length > 1 ? `feuilles de temps validées (semaines ${semaines.join(', ')}) non modifiées` : `feuille de temps validée (semaine ${semaines[0]}) non modifiée`}` : '';
  const nature = libelle((isRh(ctx) || isSelf(ctx, emp.id) ? a : absenceVueManager(a)).type);
  const renvoi = a.statut === 'demandee' ? '' : renvoyerFeuilles(ctx, emp, a);
  const reprise = majReprise(ctx, emp, a, a.type);
  if (a.statut === 'demandee') return `Demande de ${nature} ${periodeTexte(a.du, a.au)} ${self ? 'retirée' : 'annulée'}${recredit}`;
  return `Absence de ${emp.nom}${nature ? ` (${nature})` : ''} annulée${recredit}${a.keystone ? ' — Keystone prévenu' : ''}${feuilles}${renvoi}${reprise}`;
};

/** Nature dans un message : « congés payés », « RTT / repos », « arrêt maladie » ; rien pour une absence à qualifier. */
const libelle = (t: AbsenceType) => t === 'ABSENCE' ? '' : t === 'RTT' ? 'RTT / repos' : natureDef(t)?.court ?? ABS_LABEL[t].toLowerCase();

const placerCet: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  if (!(isRh(ctx) || isSelf(ctx, emp.id))) throw new ActionError('Vous ne pouvez alimenter que votre propre CET', 403);
  const kind = p.kind === 'CP' ? 'CP' : 'RTT';
  const j = Number(p.jours), ct = cetInfo(ctx.d, emp), max = kind === 'CP' ? ct.placeCp : ct.placeRtt;
  if (!ct.eligible) throw new ActionError('Compte épargne-temps non ouvert pour ce contrat (intérim : congés gérés par l’agence)');
  if (!(j > 0) || j > max || (j * 2) % 1 !== 0) throw new ActionError(`Nombre de jours invalide (maximum ${fJ(max)}, par demi-journée)`);
  const periode = kind === 'CP' ? cpPeriods(ctx.d.ti).label : String(ctx.d.year);
  ctx.db.insert<CetMouvement>('cet', { empId: emp.id, type: kind, jours: j, date: ctx.d.ti, periode });
  return `${fJ(j)} de ${kind === 'CP' ? 'CP (5e semaine)' : 'RTT'} placés sur le compte épargne-temps de ${emp.nom}`;
};

const accorderReport: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const emp = getEmp(ctx, p.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas vous accorder un report de congés');
  const cp = cpInfo(ctx.d, emp);
  const j = Number(p.jours), motif = str(p.motif);
  if (!cp || !(j > 0) || j > cp.solde || !motif) throw new ActionError('Nombre de jours (dans la limite du solde) et motif requis');
  ctx.db.insert<ReportCp>('reports', { empId: emp.id, jours: j, motif, par: ctx.user.nom, date: ctx.d.ti, sens: 'accorde' });
  return `${fJ(j)} de CP reportés pour ${emp.nom} — utilisables jusqu’au ${fmt(parse(cp.periodes.reportDeadline))}`;
};

export const absencesActions: Record<string, ActionHandler> = {
  'absence.demander': demander,
  'absence.decider': decider,
  'absence.signaler': signaler,
  'absence.saisir': saisir,
  'absence.qualifier': qualifier,
  'absence.prolonger': prolonger,
  'absence.annuler': annuler,
  'cet.placer': placerCet,
  'report.accorder': accorderReport,
};
