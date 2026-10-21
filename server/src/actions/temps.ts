// Feuilles de temps : saisie, soumission, validation, transmission à Sage Paie (lots de paie : actions/paie.ts).
import { addD, isFerie, isValidDate, isoWeek, joursSemaine, mondayOf } from '../../../shared/dates.ts';
import { fH, num, plural } from '../../../shared/format.ts';
import { fusionProposition } from '../../../shared/rules/formations-temps.ts';
import { identifiantKeystone } from '../../../shared/rules/matricules.ts';
import { jourHorsContrat, semaineHorsContrat } from '../../../shared/rules/absences.ts';
import {
  absenceCeJour, calcSheet, contratFige, corDeLaFeuille, demandesEnAttenteMessage, demiJourneeRefus, HEURES_JOUR_MAX, heuresSurAbsence,
  heuresSurAbsenceMessage, heuresSurDemandes, joursAbsence, joursAuDela24, joursTexte, semaineCouverte, suggestLines,
} from '../../../shared/rules/temps.ts';
import { estActiviteInterne } from '../../../shared/rules/activites.ts';
import { regimeAFiger } from '../../../shared/rules/historique-contrat.ts';
import { completerSemaine, JOURS_FEUILLE } from '../../../shared/rules/semaine.ts';
import { ferieRefus } from '../../../shared/rules/majorations.ts';
import { horairesAFiger } from '../../../shared/rules/horaires.ts';
import { alertesValidation, corAValider } from '../../../shared/rules/durees.ts';
import { aRegulariser, projetsRevalidation } from '../../../shared/rules/regularisation.ts';
import type { Employe, FeuilleTemps, LigneTemps } from '../../../shared/types.ts';
import { heuresKeystone, sendToKeystone } from '../integrations/keystone.ts';
import { notifierFeuilleRenvoyee, notifierFeuilleSoumise } from '../notifications.ts';
import { relevesAutomatiques } from '../releves.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isManagerOf, isRh, isSelf, isValidatorOf, refuserSoiMeme, str } from './context.ts';
import { pushSageSimulation } from './paie.ts';

function sheetOf(ctx: Ctx, empId: number, week: string): FeuilleTemps | undefined {
  return ctx.ds.feuilles.find(f => f.empId === empId && f.week === week);
}

/**
 * Saisie autorisée : le salarié, son manager ou le service RH, tant que la feuille n'est pas validée.
 * Une feuille soumise ne peut être corrigée que par son valideur (manager direct ou RH, jamais pour lui-même), avant validation.
 */
export async function editable(ctx: Ctx, p: Record<string, any>): Promise<{ emp: Employe; week: string; sh: FeuilleTemps }> {
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
  // Feuille créée : figée sur le régime de sa semaine quand l'historique des contrats le dit autre que celui de la fiche
  // (semaine antérieure à un changement, postérieure à un avenant programmé : shared/rules/historique-contrat.ts).
  if (!sh) sh = await ctx.db.insert<FeuilleTemps>('feuilles', { empId: emp.id, week, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [], contrat: regimeAFiger(ctx.ds, emp, week) });
  return { emp, week, sh };
}

/** Plus de 24 h sur une journée, toutes lignes cumulées : refusé (saisie, proposition Keystone, soumission, validation). */
function controleJournees(sh: Pick<FeuilleTemps, 'week'>, lignes: LigneTemps[], quoi = 'Plus de 24 h') {
  const jours = joursAuDela24(lignes);
  if (jours.length) throw new ActionError(`${quoi} ${joursTexte(jours.map(i => joursSemaine(sh.week)[i]))}, toutes lignes cumulées : une journée compte 24 h au plus`);
}

/**
 * Durées maximales dépassées (10 h par jour, 48 h par semaine ; 13 h pour un forfait jours ; 8 h et 35 h pour un salarié
 * mineur, shared/rules/mineurs.ts) : un motif est exigé,
 * donné à la soumission (ou à la validation, quand le valideur a corrigé la feuille). Renvoie le motif à enregistrer.
 * À la validation (`valideur`), le motif du salarié est conservé : celui du valideur ne sert que s'il manque, sans quoi
 * la hiérarchie réécrirait la déclaration du salarié (justification d'un dépassement, art. L3121-18 et L3121-20).
 */
function motifDepassement(ctx: Ctx, emp: Employe, sh: FeuilleTemps, p: Record<string, any>, quand: string, valideur = false): string | null {
  const { depassements, depassementsMineur } = calcSheet(ctx.d, emp, sh);
  if (!depassements.length) return null;
  const motif = (valideur ? sh.motifDepassement || str(p.motif) : str(p.motif) || sh.motifDepassement) || '';
  // Salarié mineur (décision de l'entreprise du 17 octobre 2026) : motif, ou référence de la dérogation de l'inspection.
  const quoi = depassementsMineur.length ? 'le motif du dépassement ou la référence de la dérogation de l’inspection du travail' : 'le motif du dépassement';
  if (!motif) throw new ActionError(`${depassements.join(' ; ')} : indiquez ${quoi} ${quand}`);
  if (motif.length > 500) throw new ActionError('Motif trop long (500 caractères au plus)');
  return motif;
}

async function saveLines(ctx: Ctx, sh: FeuilleTemps, lignes: LigneTemps[]) {
  // Une feuille corrigée par son valideur reste « soumise » ; une feuille renvoyée reste « à corriger ».
  await ctx.db.update<FeuilleTemps>('feuilles', sh.id, { lignes, statut: sh.statut === 'rejetee' || sh.statut === 'soumise' ? sh.statut : 'brouillon' });
}

/**
 * Saisie d'une cellule : `di` de 0 (lundi) à 6 (dimanche). Le samedi et le dimanche, grisés dans la feuille, se saisissent
 * comme les autres jours (chantier, déplacement, impératif) ; le repos hebdomadaire est signalé sur la feuille, sans blocage.
 * Un jour férié se saisit si le réglage `feriesTravaillesAutorises` le permet (par défaut) : heures repérées et majorées
 * (shared/rules/majorations.ts), saisie tracée au journal (`temps.ferie`, server/src/journal.ts).
 */
const setCell: ActionHandler = async (ctx, p) => {
  const { emp, sh } = await editable(ctx, p);
  const li = Number(p.li), di = Number(p.di);
  if (!sh.lignes[li] || !(Number.isInteger(di) && di >= 0 && di < JOURS_FEUILLE)) throw new ActionError('Cellule invalide');
  const v = Math.round(Math.max(0, Math.min(24, num(String(p.value ?? '').replace(/[^\d.,]/g, '')))) * 100) / 100;
  // Aucune heure un jour d'absence (validée ou signalée) ni hors contrat ; vider la cellule reste toujours possible, pour corriger.
  const abs = joursAbsence(ctx.d, sh.empId, sh.week)[di];
  if (v > 0 && abs) throw new ActionError(`${absenceCeJour(abs)} : aucune heure ne peut être saisie`);
  const hors = v > 0 ? jourHorsContrat(emp, addD(sh.week, di)) : null;
  if (hors) throw new ActionError(`Hors contrat ce jour-là (${hors}) : aucune heure ne peut être saisie`);
  const ferie = v > 0 && isFerie(addD(sh.week, di)) ? ferieRefus(ctx.ds.settings) : null;
  if (ferie) throw new ActionError(ferie);
  // Ligne enregistrée avant la semaine à 7 jours (5 valeurs) : complétée d'un samedi et d'un dimanche vides.
  const lignes = sh.lignes.map((l, i) => i === li ? { ...l, h: completerSemaine(l.h).map((x, j) => j === di ? v : x) } : l);
  // Deux lignes de 20 h le même jour ne font pas une journée : 24 h au plus, toutes lignes cumulées (baisser une cellule
  // d'une journée déjà au-delà, saisie avant ce contrôle, reste possible).
  const jour = lignes.reduce((n, l) => n + num(l.h[di]), 0);
  if (jour > HEURES_JOUR_MAX && v > num(sh.lignes[li].h[di])) throw new ActionError(`Plus de 24 h ce jour-là (${fH(jour)} toutes lignes cumulées) : une journée compte 24 h au plus`);
  // Demi-journée d'absence : au plus une demi-journée de travail ce jour-là (baisser une cellule reste possible).
  const demi = v > num(sh.lignes[li].h[di]) ? demiJourneeRefus(ctx.d, sh, di, jour) : null;
  if (demi) throw new ActionError(demi);
  await saveLines(ctx, sh, lignes);
  return null;
};

const addLine: ActionHandler = async (ctx, p) => {
  const { sh } = await editable(ctx, p);
  const projet = str(p.projet);
  // Projets transmis par Keystone (server/src/integrations/keystone-entrant.ts) ; un projet archivé n'est plus proposé.
  const pr = ctx.ds.referentiels.projets.find(x => x.code === projet);
  if (!pr) throw new ActionError('Projet inconnu');
  if (pr.statut === 'archive') {
    throw new ActionError(estActiviteInterne(pr.code) ? 'Activité interne archivée (écran Référentiels) : aucune heure ne peut plus y être imputée' : 'Projet clos dans Keystone : aucune heure ne peut plus y être imputée');
  }
  await saveLines(ctx, sh, [...sh.lignes, { projet, tache: pr.nom, ks: false, h: completerSemaine([]) }]);
  return null;
};

/**
 * `projet`, `tache` et `lignes` (nombre de lignes affichées) désignent la ligne vue par la personne. Déjà
 * supprimée (double clic, autre onglet) : rien n'est refait ; feuille changée entre-temps : refus, plutôt que
 * de supprimer la ligne voisine venue prendre sa place.
 */
const removeLine: ActionHandler = async (ctx, p) => {
  const { sh } = await editable(ctx, p);
  const li = Number(p.li);
  if (p.projet !== undefined) {
    const visee = (l: LigneTemps) => l.projet === p.projet && (p.tache === undefined || l.tache === p.tache);
    if (!sh.lignes.some(visee)) return null;
    if (!sh.lignes[li] || !visee(sh.lignes[li]) || (p.lignes !== undefined && sh.lignes.length !== Number(p.lignes))) {
      throw new ActionError('La feuille a changé entre-temps : vérifiez la ligne à supprimer, puis réessayez');
    }
  }
  await saveLines(ctx, sh, sh.lignes.filter((_, i) => i !== li));
  return null;
};

/**
 * « Proposer » : tâches Keystone planifiées et heures des sessions de formation de la semaine. Les lignes déjà saisies
 * sont gardées (shared/rules/formations-temps.ts, fusionProposition) : seules les lignes Keystone d'une proposition
 * précédente et la ligne INT-FORM de la même formation sont remplacées.
 */
const suggest: ActionHandler = async (ctx, p) => {
  const { emp, week, sh } = await editable(ctx, p);
  const l = suggestLines(ctx.d, emp, week);
  // Rien de planifié cette semaine : la feuille n'est pas vidée.
  if (!l.length) throw new ActionError('Aucune tâche Keystone ni session de formation planifiée pour ce salarié cette semaine');
  // Heures de formation réduites au besoin ; tâches Keystone et lignes gardées au-delà de 24 h : refus.
  const f = fusionProposition(sh.lignes, l);
  controleJournees(sh, f.lignes, 'Tâches Keystone et lignes déjà saisies : plus de 24 h');
  const ajoutees = f.lignes.length - f.conservees;
  if (!ajoutees) throw new ActionError('Aucune heure de formation à proposer : les jours de la session comptent déjà 24 h, toutes lignes cumulées');
  await saveLines(ctx, sh, f.lignes);
  // Lignes de formation (INT-FORM) : heures prévues de la session, jamais envoyées à Keystone.
  const formations = ajoutees - l.filter(x => x.ks).length;
  const source = formations === ajoutees ? 'des sessions de formation' : formations ? 'des tâches Keystone et des sessions de formation' : 'des tâches Keystone';
  return [
    `Heures proposées depuis ${source} — ${plural(ajoutees, 'ligne', 'lignes')}, à ajuster si besoin`,
    f.conservees ? plural(f.conservees, 'ligne déjà saisie conservée', 'lignes déjà saisies conservées') : '',
    f.reduites ? 'heures de formation réduites pour rester sous 24 h par jour' : '',
  ].filter(Boolean).join(' · ');
};

const submit: ActionHandler = async (ctx, p) => {
  const { emp, sh } = await editable(ctx, p);
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
  // Renvoyée au salarié par une réouverture (t131) : le commentaire, motif du service RH, disparaît ; un retour suivant
  // vient du valideur.
  const reouverture = sh.reouverture?.renvoyee ? { reouverture: { ...sh.reouverture, renvoyee: false } } : {};
  // Horaires de poste du jour (shared/rules/horaires.ts) : ceux affichés, figés à la soumission (les choix restent à part).
  const horaires = horairesAFiger(ctx.ds.referentiels, emp.equipe, sh, calcSheet(ctx.d, emp, { ...sh, contrat }).perDay);
  await ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'soumise', comment: null, contrat, motifDepassement: motif, ...reouverture, ...horaires });
  await notifierFeuilleSoumise(ctx, emp, sh.week, ctx.d.mgrOf(emp));
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

/**
 * Validation d'une feuille soumise (temps.validate, et chaque feuille de temps.validerLot) : message de confirmation et,
 * à part, les seuils de durée franchis (`alertes`), repris par la validation groupée.
 */
export async function validerFeuille(ctx: Ctx, p: Record<string, any>): Promise<{ message: string; alertes: string[] }> {
  const { emp, sh } = submitted(ctx, p);
  // Soumise sans heure parce que la semaine était couverte : l'absence a pu être annulée ou raccourcie depuis.
  const total = sh.lignes.reduce((n, l) => n + l.h.reduce((a, b) => a + num(b), 0), 0);
  if (!(total > 0) && !semaineCouverte(ctx.d, emp, sh.week, sh)) throw new ActionError('La semaine n’est plus couverte par une absence : renvoyez la feuille pour saisie des heures');
  const surAbsence = heuresSurAbsence(ctx.d, sh);
  if (surAbsence.length) throw new ActionError(heuresSurAbsenceMessage(surAbsence, 'ou renvoyez la feuille avant de la valider'));
  // Demande d'absence en attente sur ces heures : à décider d'abord (même valideur), sinon elle ne pourrait plus être validée.
  const enAttente = heuresSurDemandes(ctx.d, sh);
  if (enAttente.length) throw new ActionError(demandesEnAttenteMessage(enAttente));
  controleJournees(sh, sh.lignes);
  const contrat = sh.contrat ?? contratFige(emp);
  const motif = motifDepassement(ctx, emp, { ...sh, contrat }, p, 'avant de valider la feuille', true);
  // Seules les heures des projets Keystone lui sont renvoyées : ni activités internes (INT-*), ni cours en CFA (ECOLE).
  // Feuille rouverte (t131) : un projet déjà renvoyé puis retiré y part à 0, l'événement remplaçant le précédent.
  const projets = projetsRevalidation(heuresKeystone(sh.lignes), sh.reouverture), keystone = Object.keys(projets).length > 0;
  // Mode des heures supplémentaires (payées ou en repos) figé à la validation, comme le régime à la soumission :
  // un changement ultérieur du réglage ne recalcule ni la paie ni le repos acquis de cette semaine. De même pour la
  // majoration des heures du dimanche et des jours fériés.
  const heuresSup = sh.heuresSup ?? ctx.ds.settings.heuresSupMode;
  const majDimanche = sh.majDimanche ?? ctx.ds.settings.majorationDimanche;
  const majFerie = sh.majFerie ?? ctx.ds.settings.tauxMajorationFerie;
  // Contrepartie obligatoire en repos au-delà du contingent (shared/rules/durees.ts) : COR de l'année recalculée sur toutes
  // les feuilles validées, moins celle déjà figée sur les autres ; l'écart est porté par cette feuille.
  const validee: FeuilleTemps = { ...sh, statut: 'validee', contrat, heuresSup, majDimanche, majFerie };
  const cor = corAValider(ctx.d, emp, validee);
  // Horaires de poste refigés après une éventuelle correction du valideur (heures d'un code déjà figé inchangées).
  const horaires = horairesAFiger(ctx.ds.referentiels, emp.equipe, sh, calcSheet(ctx.d, emp, { ...sh, contrat }).perDay);
  await ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'validee', keystone, contrat, motifDepassement: motif, heuresSup, majDimanche, majFerie, cor, ...horaires });
  // Seuils franchis par cette feuille (moyenne sur 12 semaines, temps partiel, contingent) : signalés, sans blocage.
  const autres = ctx.ds.feuilles.filter(f => f.empId === emp.id && f.statut === 'validee' && f.id !== sh.id);
  const alertes = alertesValidation(ctx.d, emp, autres, [...autres, { ...validee, cor }], sh.week, corDeLaFeuille({ cor }));

  if (keystone) await sendToKeystone(ctx.db, { type: 'heures.validees', matricule: identifiantKeystone(ctx.ds.settings.identifiantKeystone, emp), semaine: sh.week, projets });
  // Intérimaire : la dernière feuille validée d'une semaine révolue fait partir le relevé de son agence.
  const releve = emp.typeContrat === 'interim' && emp.agence ? (await relevesAutomatiques(ctx.db, { agence: emp.agence, semaine: sh.week })).length > 0 : false;
  return {
    message: `Semaine ${isoWeek(sh.week)} validée${keystone ? ' — heures des projets Keystone renvoyées à Keystone' : ''}${releve ? ` · relevé d’heures envoyé à l’agence ${emp.agence}` : ''}`
      + `${aRegulariser({ ...sh, statut: 'validee' }) ? ' · feuille déjà transmise à la paie : l’écart partira dans le prochain lot (lot correctif)' : ''}${alertes.map(a => ` · ${a}`).join('')}`,
    alertes,
  };
}

const validate: ActionHandler = async (ctx, p) => (await validerFeuille(ctx, p)).message;

const reject: ActionHandler = async (ctx, p) => {
  const { emp, sh } = submitted(ctx, p);
  await ctx.db.update<FeuilleTemps>('feuilles', sh.id, { statut: 'rejetee', comment: str(p.comment) || 'Merci de vérifier la répartition par projet' });
  await notifierFeuilleRenvoyee(ctx, emp, sh.week);
  return 'Feuille renvoyée pour correction';
};

/**
 * Transmission à la paie en un clic : administrateur RH et gestionnaire de paie, en simulation seulement (lot de toutes
 * les feuilles en attente, aussitôt marqué transmis, rien n'est envoyé : server/src/actions/paie.ts). Mode fichier : le
 * lot de chaque période passe par le fichier d'import et la confirmation de l'import (paie.lotGenerer, paie.lotConfirmer) ;
 * mode API : aucun contrat d'API. Les deux sont refusés (503) sans rien marquer ni inventer d'accusé.
 */
const pushSage: ActionHandler = async ctx => await pushSageSimulation(ctx);

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
