// Feuilles de temps : saisie, soumission, validation, transmission à Sage Paie.
import { isValidDate, isoWeek, mondayOf } from '../../../shared/dates.ts';
import { matricule, num, plural } from '../../../shared/format.ts';
import {
  buildSagePayload, contratFige, demandesAbsence, demandesEnAttenteMessage, heuresSurAbsence, heuresSurAbsenceMessage, joursAbsence, natureAbsence, sagePending, suggestLines,
} from '../../../shared/rules/temps.ts';
import type { Employe, FeuilleTemps, LigneTemps } from '../../../shared/types.ts';
import { pushToSage, SAGE_DOSSIER } from '../integrations/sage.ts';
import { heuresKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { ActionError, getEmp, isManagerOf, isRh, isSelf, isValidatorOf, requireRh, str, type ActionHandler, type Ctx } from './context.ts';

function sheetOf(ctx: Ctx, empId: number, week: string): FeuilleTemps | undefined {
  return ctx.ds.feuilles.find(f => f.empId === empId && f.week === week);
}

/**
 * Saisie autorisée : le salarié, son manager ou le service RH, tant que la feuille n'est pas validée.
 * Une feuille soumise ne peut être corrigée que par son valideur (manager direct ou RH), avant validation.
 */
function editable(ctx: Ctx, p: Record<string, any>): { emp: Employe; week: string; sh: FeuilleTemps } {
  const emp = getEmp(ctx, p.empId);
  const week = String(p.week);
  if (!isValidDate(week) || mondayOf(week) !== week) throw new ActionError('Semaine invalide');
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || isManagerOf(ctx, emp))) throw new ActionError('Seuls le salarié, son manager ou le service RH peuvent saisir cette feuille', 403);
  let sh = sheetOf(ctx, emp.id, week);
  const correction = !!sh && sh.statut === 'soumise' && isValidatorOf(ctx, emp);
  if (sh && !['brouillon', 'rejetee'].includes(sh.statut) && !correction) throw new ActionError('Feuille déjà soumise ou validée');
  if (!sh) sh = ctx.db.insert<FeuilleTemps>('feuilles', { empId: emp.id, week, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [] });
  return { emp, week, sh };
}

function saveLines(ctx: Ctx, sh: FeuilleTemps, lignes: LigneTemps[]) {
  // Une feuille corrigée par son valideur reste « soumise » ; une feuille renvoyée reste « à corriger ».
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { lignes, statut: sh.statut === 'rejetee' || sh.statut === 'soumise' ? sh.statut : 'brouillon' });
}

const setCell: ActionHandler = (ctx, p) => {
  const { sh } = editable(ctx, p);
  const li = Number(p.li), di = Number(p.di);
  if (!sh.lignes[li] || !(di >= 0 && di < 5)) throw new ActionError('Cellule invalide');
  const v = Math.round(Math.max(0, Math.min(24, num(String(p.value ?? '').replace(/[^\d.,]/g, '')))) * 100) / 100;
  // Aucune heure un jour d'absence validée ; vider la cellule reste toujours possible, pour corriger.
  const abs = joursAbsence(ctx.d, sh.empId, sh.week)[di];
  if (v > 0 && abs) throw new ActionError(`Absence validée ce jour-là (${natureAbsence(abs.type)}) : aucune heure ne peut être saisie`);
  const lignes = sh.lignes.map((l, i) => i === li ? { ...l, h: l.h.map((x, j) => j === di ? v : x) } : l);
  saveLines(ctx, sh, lignes);
  return null;
};

const addLine: ActionHandler = (ctx, p) => {
  const { sh } = editable(ctx, p);
  const projet = str(p.projet);
  // Projets transmis par Keystone (server/src/integrations/keystone-entrant.ts) ; un projet archivé n'est plus proposé.
  const pr = ctx.ds.referentiels.projets.find(x => x.code === projet);
  if (!pr) throw new ActionError('Projet inconnu');
  if (pr.statut === 'archive') throw new ActionError('Projet clos dans Keystone : aucune heure ne peut plus y être imputée');
  saveLines(ctx, sh, [...sh.lignes, { projet, tache: pr.nom, ks: false, h: [0, 0, 0, 0, 0] }]);
  return null;
};

const removeLine: ActionHandler = (ctx, p) => {
  const { sh } = editable(ctx, p);
  saveLines(ctx, sh, sh.lignes.filter((_, i) => i !== Number(p.li)));
  return null;
};

const suggest: ActionHandler = (ctx, p) => {
  const { emp, week, sh } = editable(ctx, p);
  const l = suggestLines(ctx.d, emp, week);
  // Rien de planifié cette semaine : la feuille n'est pas vidée.
  if (!l.length) throw new ActionError('Aucune tâche Keystone planifiée pour ce salarié cette semaine');
  saveLines(ctx, sh, l);
  return `Heures proposées depuis les tâches Keystone — ${plural(l.length, 'ligne', 'lignes')}, à ajuster si besoin`;
};

const submit: ActionHandler = (ctx, p) => {
  const { emp, sh } = editable(ctx, p);
  if (sh.statut === 'soumise') throw new ActionError('Feuille déjà soumise');
  const total = sh.lignes.reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
  if (!(total > 0)) throw new ActionError('Aucune heure saisie');
  const surAbsence = heuresSurAbsence(ctx.d, sh);
  if (surAbsence.length) throw new ActionError(heuresSurAbsenceMessage(surAbsence, 'avant de soumettre la feuille'));
  // Le régime de temps de travail de la semaine est figé à la soumission.
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'soumise', comment: null, contrat: sh.contrat ?? contratFige(emp) });
  return `Feuille de temps soumise à ${ctx.d.mgrName(ctx.d.mgrOf(emp))}`;
};

function submitted(ctx: Ctx, p: Record<string, any>) {
  const emp = getEmp(ctx, p.empId);
  const sh = sheetOf(ctx, emp.id, String(p.week));
  if (!sh || sh.statut !== 'soumise') throw new ActionError('Aucune feuille en attente de validation');
  if (!isValidatorOf(ctx, emp)) throw new ActionError('Validation réservée au manager du salarié ou au service RH', 403);
  return { emp, sh };
}

const validate: ActionHandler = (ctx, p) => {
  const { emp, sh } = submitted(ctx, p);
  const surAbsence = heuresSurAbsence(ctx.d, sh);
  if (surAbsence.length) throw new ActionError(heuresSurAbsenceMessage(surAbsence, 'ou renvoyez la feuille avant de la valider'));
  // Demande d'absence en attente sur ces heures : à décider d'abord (même valideur), sinon elle ne pourrait plus être validée.
  const enAttente = heuresSurAbsence(ctx.d, sh, demandesAbsence(ctx.d));
  if (enAttente.length) throw new ActionError(demandesEnAttenteMessage(enAttente));
  // Seules les heures des projets Keystone lui sont renvoyées : ni activités internes (INT-*), ni cours en CFA (ECOLE).
  const projets = heuresKeystone(sh.lignes), keystone = Object.keys(projets).length > 0;
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'validee', keystone, contrat: sh.contrat ?? contratFige(emp) });
  if (keystone) sendToKeystone(ctx.db, { type: 'heures.validees', matricule: matricule(emp.id), semaine: sh.week, projets });
  return `Semaine ${isoWeek(sh.week)} validée${keystone ? ' — heures des projets Keystone renvoyées à Keystone' : ''}`;
};

const reject: ActionHandler = (ctx, p) => {
  const { sh } = submitted(ctx, p);
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'rejetee', comment: str(p.comment) || 'Merci de vérifier la répartition par projet' });
  return 'Feuille renvoyée pour correction';
};

const pushSage: ActionHandler = (ctx) => {
  requireRh(ctx);
  const sheets = sagePending(ctx.d);
  if (!sheets.length) throw new ActionError('Aucune feuille validée en attente de transmission');
  const payload = buildSagePayload(ctx.d, sheets, SAGE_DOSSIER);
  const ack = pushToSage(payload);
  if (!ack.ok) throw new ActionError('Sage Paie a refusé la transmission', 502);
  sheets.forEach(sh => ctx.db.update<FeuilleTemps>('feuilles', sh.id, { sage: true }));
  ctx.db.setSetting('lastSagePush', payload);
  return `${plural(sheets.length, 'feuille transmise', 'feuilles transmises')} à Sage Paie — accusé de réception reçu`;
};

export const tempsActions: Record<string, ActionHandler> = {
  'temps.setCell': setCell,
  'temps.addLine': addLine,
  'temps.removeLine': removeLine,
  'temps.suggest': suggest,
  'temps.submit': submit,
  'temps.validate': validate,
  'temps.reject': reject,
  'temps.pushSage': pushSage,
};
