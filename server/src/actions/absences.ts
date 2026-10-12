// Congés, RTT, récupération, compte épargne-temps et reports de CP.
import { ABS_LABEL } from '../../../shared/constants.ts';
import { cpPeriods } from '../../../shared/dates.ts';
import { fJ, fmt } from '../../../shared/format.ts';
import { cetInfo, checkAbsence, cpInfo, heuresAvantAbsence } from '../../../shared/rules/conges.ts';
import { parse } from '../../../shared/dates.ts';
import type { Absence, AbsenceType, CetMouvement, ReportCp } from '../../../shared/types.ts';
import { absenceKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { ActionError, getEmp, isManagerOf, isRh, isSelf, isValidatorOf, requireRh, str, type ActionHandler } from './context.ts';

/** Le salarié ou le RH demandent ; le manager qui pose pour un membre de son équipe valide du même coup. */
const demander: ActionHandler = (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  const parManager = isManagerOf(ctx, emp);
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || parManager)) throw new ActionError('Vous ne pouvez poser une absence que pour vous-même ou votre équipe', 403);
  const kind = str(p.kind) as AbsenceType;
  const chk = checkAbsence(ctx.d, emp, kind, p.du, p.au, parManager);
  if (chk.cant) throw new ActionError(chk.msgs.find(m => m.bad)?.text || 'Demande invalide');
  const a = ctx.db.insert<Absence>('absences', { empId: emp.id, type: kind, du: p.du, au: p.au, statut: parManager ? 'validee' : 'demandee', keystone: parManager });
  if (parManager) {
    sendToKeystone(ctx.db, absenceKeystone('absence.validee', a));
    return `Absence de ${emp.nom} (${ABS_LABEL[kind].toLowerCase()}) posée et validée — transmise à Keystone pour la planification`;
  }
  return `Demande de ${ABS_LABEL[kind].toLowerCase()} envoyée ${ctx.d.mgrDest(ctx.d.mgrOf(emp))}`;
};

const decider: ActionHandler = (ctx, p) => {
  const a = ctx.ds.absences.find(x => x.id === Number(p.id));
  if (!a || a.statut !== 'demandee') throw new ActionError('Demande introuvable ou déjà traitée');
  const emp = getEmp(ctx, a.empId);
  if (!isValidatorOf(ctx, emp)) throw new ActionError('Décision réservée au manager du salarié ou au service RH', 403);
  const ok = !!p.ok;
  // Pas de double paiement : les heures saisies ces jours-là doivent d'abord être retirées de la feuille de temps.
  const heures = ok ? heuresAvantAbsence(ctx.d, a, 'avant de valider l’absence') : null;
  if (heures) throw new ActionError(heures.text);
  ctx.db.update<Absence>('absences', a.id, { statut: ok ? 'validee' : 'refusee', keystone: ok });
  if (ok) sendToKeystone(ctx.db, absenceKeystone('absence.validee', a));
  return ok ? `Absence de ${emp.nom} validée — transmise à Keystone pour la planification` : `Absence de ${emp.nom} refusée`;
};

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
  const cp = cpInfo(ctx.d, emp);
  const j = Number(p.jours), motif = str(p.motif);
  if (!cp || !(j > 0) || j > cp.solde || !motif) throw new ActionError('Nombre de jours (dans la limite du solde) et motif requis');
  ctx.db.insert<ReportCp>('reports', { empId: emp.id, jours: j, motif, par: ctx.user.nom, date: ctx.d.ti, sens: 'accorde' });
  return `${fJ(j)} de CP reportés pour ${emp.nom} — utilisables jusqu’au ${fmt(parse(cp.periodes.reportDeadline))}`;
};

export const absencesActions: Record<string, ActionHandler> = {
  'absence.demander': demander,
  'absence.decider': decider,
  'cet.placer': placerCet,
  'report.accorder': accorderReport,
};
