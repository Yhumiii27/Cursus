// Feuilles de temps : saisie, soumission, validation, transmission à Sage Paie.
import { addD, isValidDate, isoWeek, mondayOf, wDays } from '../../../shared/dates.ts';
import { fH, matricule, num, plural } from '../../../shared/format.ts';
import { jourHorsContrat, semaineHorsContrat } from '../../../shared/rules/absences.ts';
import {
  absenceCeJour, buildSagePayload, calcSheet, contratFige, demandesAbsence, demandesEnAttenteMessage, HEURES_JOUR_MAX, heuresSurAbsence, heuresSurAbsenceMessage,
  joursAbsence, joursAuDela24, joursTexte, sagePending, semaineCouverte, suggestLines,
} from '../../../shared/rules/temps.ts';
import type { Employe, FeuilleTemps, LigneTemps } from '../../../shared/types.ts';
import { pushToSage, SAGE_DOSSIER } from '../integrations/sage.ts';
import { heuresKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { notifierFeuilleRenvoyee, notifierFeuilleSoumise } from '../notifications.ts';
import { relevesAutomatiques } from '../releves.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isManagerOf, isRh, isSelf, isValidatorOf, refuserSoiMeme, requirePaie, str } from './context.ts';

function sheetOf(ctx: Ctx, empId: number, week: string): FeuilleTemps | undefined {
  return ctx.ds.feuilles.find(f => f.empId === empId && f.week === week);
}

/**
 * Saisie autorisée : le salarié, son manager ou le service RH, tant que la feuille n'est pas validée.
 * Une feuille soumise ne peut être corrigée que par son valideur (manager direct ou RH, jamais pour lui-même), avant validation.
 */
function editable(ctx: Ctx, p: Record<string, any>): { emp: Employe; week: string; sh: FeuilleTemps } {
  const emp = getEmp(ctx, p.empId);
  const week = String(p.week);
  if (!isValidDate(week) || mondayOf(week) !== week) throw new ActionError('Semaine invalide');
  if (!(isRh(ctx) || isSelf(ctx, emp.id) || isManagerOf(ctx, emp))) throw new ActionError('Seuls le salarié, son manager ou le service RH peuvent saisir cette feuille', 403);
  // Pas de feuille avant l'entrée ni après la fin du contrat (une semaine à cheval reste saisissable).
  const hors = semaineHorsContrat(emp, week);
  if (hors) throw new ActionError(`Semaine hors contrat : ${hors}`);
  let sh = sheetOf(ctx, emp.id, week);
  const correction = !!sh && sh.statut === 'soumise' && isValidatorOf(ctx, emp);
  if (sh && !['brouillon', 'rejetee'].includes(sh.statut) && !correction) throw new ActionError('Feuille déjà soumise ou validée');
  if (!sh) sh = ctx.db.insert<FeuilleTemps>('feuilles', { empId: emp.id, week, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [] });
  return { emp, week, sh };
}

/** Plus de 24 h sur une journée, toutes lignes cumulées : refusé (saisie, proposition Keystone, soumission, validation). */
function controleJournees(sh: Pick<FeuilleTemps, 'week'>, lignes: LigneTemps[], quoi = 'Plus de 24 h') {
  const jours = joursAuDela24(lignes);
  if (jours.length) throw new ActionError(`${quoi} ${joursTexte(jours.map(i => wDays(sh.week)[i]))}, toutes lignes cumulées : une journée compte 24 h au plus`);
}

/**
 * Durées maximales dépassées (10 h par jour, 48 h par semaine ; 13 h pour un forfait jours) : un motif est exigé,
 * donné à la soumission (ou à la validation, quand le valideur a corrigé la feuille). Renvoie le motif à enregistrer.
 * À la validation (`valideur`), le motif du salarié est conservé : celui du valideur ne sert que s'il manque, sans quoi
 * la hiérarchie réécrirait la déclaration du salarié (justification d'un dépassement, art. L3121-18 et L3121-20).
 */
function motifDepassement(ctx: Ctx, emp: Employe, sh: FeuilleTemps, p: Record<string, any>, quand: string, valideur = false): string | null {
  const { depassements } = calcSheet(ctx.d, emp, sh);
  if (!depassements.length) return null;
  const motif = (valideur ? sh.motifDepassement || str(p.motif) : str(p.motif) || sh.motifDepassement) || '';
  if (!motif) throw new ActionError(`${depassements.join(' ; ')} : indiquez le motif du dépassement ${quand}`);
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  return motif;
}

function saveLines(ctx: Ctx, sh: FeuilleTemps, lignes: LigneTemps[]) {
  // Une feuille corrigée par son valideur reste « soumise » ; une feuille renvoyée reste « à corriger ».
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { lignes, statut: sh.statut === 'rejetee' || sh.statut === 'soumise' ? sh.statut : 'brouillon' });
}

const setCell: ActionHandler = (ctx, p) => {
  const { emp, sh } = editable(ctx, p);
  const li = Number(p.li), di = Number(p.di);
  if (!sh.lignes[li] || !(di >= 0 && di < 5)) throw new ActionError('Cellule invalide');
  const v = Math.round(Math.max(0, Math.min(24, num(String(p.value ?? '').replace(/[^\d.,]/g, '')))) * 100) / 100;
  // Aucune heure un jour d'absence (validée ou signalée) ni hors contrat ; vider la cellule reste toujours possible, pour corriger.
  const abs = joursAbsence(ctx.d, sh.empId, sh.week)[di];
  if (v > 0 && abs) throw new ActionError(`${absenceCeJour(abs)} : aucune heure ne peut être saisie`);
  const hors = v > 0 ? jourHorsContrat(emp, addD(sh.week, di)) : null;
  if (hors) throw new ActionError(`Hors contrat ce jour-là (${hors}) : aucune heure ne peut être saisie`);
  const lignes = sh.lignes.map((l, i) => i === li ? { ...l, h: l.h.map((x, j) => j === di ? v : x) } : l);
  // Deux lignes de 20 h le même jour ne font pas une journée : 24 h au plus, toutes lignes cumulées (baisser une cellule
  // d'une journée déjà au-delà, saisie avant ce contrôle, reste possible).
  const jour = lignes.reduce((n, l) => n + num(l.h[di]), 0);
  if (jour > HEURES_JOUR_MAX && v > num(sh.lignes[li].h[di])) throw new ActionError(`Plus de 24 h ce jour-là (${fH(jour)} toutes lignes cumulées) : une journée compte 24 h au plus`);
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

/**
 * `projet`, `tache` et `lignes` (nombre de lignes affichées) désignent la ligne vue par la personne. Déjà
 * supprimée (double clic, autre onglet) : rien n'est refait ; feuille changée entre-temps : refus, plutôt que
 * de supprimer la ligne voisine venue prendre sa place.
 */
const removeLine: ActionHandler = (ctx, p) => {
  const { sh } = editable(ctx, p);
  const li = Number(p.li);
  if (p.projet !== undefined) {
    const visee = (l: LigneTemps) => l.projet === p.projet && (p.tache === undefined || l.tache === p.tache);
    if (!sh.lignes.some(visee)) return null;
    if (!sh.lignes[li] || !visee(sh.lignes[li]) || (p.lignes !== undefined && sh.lignes.length !== Number(p.lignes))) {
      throw new ActionError('La feuille a changé entre-temps : vérifiez la ligne à supprimer, puis réessayez');
    }
  }
  saveLines(ctx, sh, sh.lignes.filter((_, i) => i !== li));
  return null;
};

const suggest: ActionHandler = (ctx, p) => {
  const { emp, week, sh } = editable(ctx, p);
  const l = suggestLines(ctx.d, emp, week);
  // Rien de planifié cette semaine : la feuille n'est pas vidée.
  if (!l.length) throw new ActionError('Aucune tâche Keystone planifiée pour ce salarié cette semaine');
  controleJournees(sh, l, 'Tâches Keystone de plus de 24 h');
  saveLines(ctx, sh, l);
  return `Heures proposées depuis les tâches Keystone — ${plural(l.length, 'ligne', 'lignes')}, à ajuster si besoin`;
};

const submit: ActionHandler = (ctx, p) => {
  const { emp, sh } = editable(ctx, p);
  if (sh.statut === 'soumise') throw new ActionError('Feuille déjà soumise');
  const total = sh.lignes.reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
  // Semaine d'arrêt, de congés… : aucun jour travaillé attendu, la feuille se soumet sans heure.
  const couverte = !(total > 0) && semaineCouverte(ctx.d, emp, sh.week, sh);
  if (!(total > 0) && !couverte) throw new ActionError('Aucune heure saisie');
  const surAbsence = heuresSurAbsence(ctx.d, sh);
  if (surAbsence.length) throw new ActionError(heuresSurAbsenceMessage(surAbsence, 'avant de soumettre la feuille'));
  controleJournees(sh, sh.lignes);
  // Le régime de temps de travail de la semaine est figé à la soumission.
  const contrat = sh.contrat ?? contratFige(emp);
  const motif = motifDepassement(ctx, emp, { ...sh, contrat }, p, 'avant de soumettre la feuille');
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'soumise', comment: null, contrat, motifDepassement: motif });
  notifierFeuilleSoumise(ctx, emp, sh.week, ctx.d.mgrOf(emp));
  return `Feuille de temps soumise ${ctx.d.mgrDest(ctx.d.mgrOf(emp))}${couverte ? ' — semaine d’absence, sans heure' : ''}`;
};

function submitted(ctx: Ctx, p: Record<string, any>) {
  const emp = getEmp(ctx, p.empId);
  const sh = sheetOf(ctx, emp.id, String(p.week));
  if (!sh || sh.statut !== 'soumise') throw new ActionError('Aucune feuille en attente de validation');
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas valider ni renvoyer votre propre feuille de temps');
  if (!isValidatorOf(ctx, emp)) throw new ActionError('Validation réservée au manager du salarié ou au service RH', 403);
  return { emp, sh };
}

const validate: ActionHandler = (ctx, p) => {
  const { emp, sh } = submitted(ctx, p);
  // Soumise sans heure parce que la semaine était couverte : l'absence a pu être annulée ou raccourcie depuis.
  const total = sh.lignes.reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
  if (!(total > 0) && !semaineCouverte(ctx.d, emp, sh.week, sh)) throw new ActionError('La semaine n’est plus couverte par une absence : renvoyez la feuille pour saisie des heures');
  const surAbsence = heuresSurAbsence(ctx.d, sh);
  if (surAbsence.length) throw new ActionError(heuresSurAbsenceMessage(surAbsence, 'ou renvoyez la feuille avant de la valider'));
  // Demande d'absence en attente sur ces heures : à décider d'abord (même valideur), sinon elle ne pourrait plus être validée.
  const enAttente = heuresSurAbsence(ctx.d, sh, demandesAbsence(ctx.d));
  if (enAttente.length) throw new ActionError(demandesEnAttenteMessage(enAttente));
  controleJournees(sh, sh.lignes);
  const contrat = sh.contrat ?? contratFige(emp);
  const motif = motifDepassement(ctx, emp, { ...sh, contrat }, p, 'avant de valider la feuille', true);
  // Seules les heures des projets Keystone lui sont renvoyées : ni activités internes (INT-*), ni cours en CFA (ECOLE).
  const projets = heuresKeystone(sh.lignes), keystone = Object.keys(projets).length > 0;
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'validee', keystone, contrat, motifDepassement: motif });
  if (keystone) sendToKeystone(ctx.db, { type: 'heures.validees', matricule: matricule(emp.id), semaine: sh.week, projets });
  // Intérimaire : la dernière feuille validée d'une semaine révolue fait partir le relevé de son agence.
  const releve = emp.typeContrat === 'interim' && emp.agence ? relevesAutomatiques(ctx.db, { agence: emp.agence, semaine: sh.week }).length > 0 : false;
  return `Semaine ${isoWeek(sh.week)} validée${keystone ? ' — heures des projets Keystone renvoyées à Keystone' : ''}${releve ? ` · relevé d’heures envoyé à l’agence ${emp.agence}` : ''}`;
};

const reject: ActionHandler = (ctx, p) => {
  const { emp, sh } = submitted(ctx, p);
  ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'rejetee', comment: str(p.comment) || 'Merci de vérifier la répartition par projet' });
  notifierFeuilleRenvoyee(ctx, emp, sh.week);
  return 'Feuille renvoyée pour correction';
};

/** Transmission à la paie : administrateur RH et gestionnaire de paie. */
const pushSage: ActionHandler = (ctx) => {
  requirePaie(ctx);
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
