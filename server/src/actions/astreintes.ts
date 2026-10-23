// Astreintes (t049, lot 7, étape 1) : planifier, modifier et annuler une période d'astreinte (manager direct ou service
// RH, jamais pour soi-même), déclarer et retirer une intervention sur la feuille de temps (salarié, manager direct ou
// service RH, comme la saisie d'heures). Règles : shared/rules/astreintes.ts ; information du salarié (e-mail et .ics) :
// server/src/astreintes.ts. Les heures d'une intervention s'ajoutent à la ligne INT-AST de la feuille, le jour où elle
// commence : du travail effectif, décompté avec les autres (heures normales, supplémentaires, de nuit, du dimanche).
import { ACTIVITE_ASTREINTE } from '../../../shared/constants.ts';
import { isFerie } from '../../../shared/dates.ts';
import { Domain } from '../../../shared/domain.ts';
import { fH, fmtIso } from '../../../shared/format.ts';
import { jourHorsContrat } from '../../../shared/rules/absences.ts';
import {
  astreinteActive, astreinteCommencee, astreinteTerminee, bornesIntervention, controlerAstreinte, controlerIntervention, heuresAstreinte,
  heureTexte, jourIntervention, MOTIF_ASTREINTE_MAX, periodeAstreinteTexte, premiereErreur, semaineIntervention,
} from '../../../shared/rules/astreintes.ts';
import { ferieRefus } from '../../../shared/rules/majorations.ts';
import { completerSemaine } from '../../../shared/rules/semaine.ts';
import { absenceCeJour, calcSheet, HEURES_JOUR_MAX, joursAbsence } from '../../../shared/rules/temps.ts';
import type { Astreinte, Employe, FeuilleTemps, InterventionAstreinte, LigneTemps } from '../../../shared/types.ts';
import { prevenirAstreinte } from '../astreintes.ts';
import { ActionError, type ActionHandler, type Ctx, getEmp, isManagerOf, isRh, refuserSoiMeme, str } from './context.ts';
import { editable, saveLines } from './temps.ts';

/** Astreinte désignée par son identifiant. */
function astreinteDe(ctx: Ctx, id: unknown): Astreinte {
  const a = (ctx.ds.astreintes ?? []).find(x => x.id === Number(id));
  if (!a) throw new ActionError('Astreinte introuvable', 404);
  return a;
}

/** Planning des astreintes : le manager direct du salarié ou le service RH, jamais pour soi-même. */
function requirePlanificateur(ctx: Ctx, emp: Employe) {
  if (isRh(ctx)) {
    refuserSoiMeme(ctx, emp, 'Astreinte pour vous-même');
    return;
  }
  if (!isManagerOf(ctx, emp)) throw new ActionError('Astreintes planifiées par le manager du salarié ou le service RH', 403);
}

/** Manager à prévenir quand le service RH agit (aucun : le service RH lui-même). */
const managerDe = (ctx: Ctx, emp: Employe) => ctx.d.mgrOf(emp) || null;

/** Fin du message : salarié prévenu ou non, avertissements sans blocage. */
const suite = (envoye: boolean, avertissements: readonly string[] = []) =>
  `${envoye ? ' · e-mail envoyé au salarié, avec l’événement d’agenda' : ' · pas d’adresse e-mail : prévenez le salarié de vive voix'}${avertissements.length ? ` · ${avertissements.join(' ; ')}` : ''}`;

/**
 * `empId`, `du`, `debut`, `au`, `fin` (« HH:MM », « 18 h »…), `motif` (circonstances exceptionnelles, exigé sous le délai de
 * prévenance réglé) : contrôles de `controlerAstreinte` ; communiquée aujourd'hui.
 */
const planifier: ActionHandler = async (ctx, p) => {
  const emp = getEmp(ctx, p.empId);
  requirePlanificateur(ctx, emp);
  const r = controlerAstreinte(ctx.ds, emp, p, ctx.d.ti, ctx.ds.settings);
  if (!r.valeurs) throw new ActionError(premiereErreur(r.erreurs) ?? 'Astreinte invalide');
  const a = await ctx.db.insert<Astreinte>('astreintes', {
    empId: emp.id, equipe: emp.equipe ?? null, ...r.valeurs, communiqueLe: ctx.d.ti, creeLe: new Date().toISOString(), creePar: ctx.user.nom,
    modifieLe: null, modifiePar: null, annuleLe: null, annulePar: null, annuleMotif: null,
  });
  const envoye = await prevenirAstreinte(ctx, emp, a, 'planifiee', { managerId: managerDe(ctx, emp) });
  return {
    message: `Astreinte de ${emp.nom} planifiée ${periodeAstreinteTexte(a)} (${fH(heuresAstreinte(a))})`
      + (r.prevenance?.court ? ` · délai de prévenance de ${r.prevenance.jours} jours : circonstances exceptionnelles notées` : '') + suite(envoye, r.avertissements),
    result: { astreinte: { id: a.id, empId: a.empId } },
  };
};

/**
 * `id`, et les champs de `planifier` à changer (absents : inchangés). Astreinte à venir : mêmes contrôles qu'à la
 * planification, communiquée de nouveau aujourd'hui si ses dates ou ses heures changent ; commencée : sa fin seulement,
 * avancée ; annulée ou terminée : 409.
 */
const modifier: ActionHandler = async (ctx, p) => {
  const a = astreinteDe(ctx, p.id), emp = getEmp(ctx, a.empId);
  requirePlanificateur(ctx, emp);
  if (!astreinteActive(a)) throw new ActionError('Astreinte annulée : planifiez-en une nouvelle', 409);
  if (astreinteTerminee(a, ctx.d.ti)) throw new ActionError('Astreinte terminée : elle ne se modifie plus', 409);
  const ints = (ctx.ds.interventionsAstreinte ?? []).filter(x => x.astreinteId === a.id);
  const finInterventions = ints.length ? Math.max(...ints.map(x => bornesIntervention(x).fin)) : null;
  const r = controlerAstreinte(ctx.ds, emp, p, ctx.d.ti, ctx.ds.settings, a, finInterventions);
  if (!r.valeurs) throw new ActionError(premiereErreur(r.erreurs) ?? 'Astreinte invalide');
  const v = r.valeurs, dates = v.du !== a.du || v.debut !== a.debut || v.au !== a.au || v.fin !== a.fin;
  if (!dates && (v.motif ?? null) === (a.motif ?? null)) return 'Aucune modification';
  const maj = { ...v, communiqueLe: dates ? ctx.d.ti : a.communiqueLe, modifieLe: new Date().toISOString(), modifiePar: ctx.user.nom };
  await ctx.db.update<Astreinte>('astreintes', a.id, maj);
  const apres: Astreinte = { ...a, ...maj };
  const envoye = dates ? await prevenirAstreinte(ctx, emp, apres, 'modifiee', { avant: a, managerId: managerDe(ctx, emp) }) : false;
  return `Astreinte de ${emp.nom} ${dates ? `modifiée : ${periodeAstreinteTexte(apres)} (${fH(heuresAstreinte(apres))})` : 'modifiée (motif)'}`
    + (dates && astreinteCommencee(a, ctx.d.ti) ? ' · fin avancée' : '') + (dates ? suite(envoye, r.avertissements) : '');
};

/**
 * `id`, `motif` (obligatoire, 500 caractères ; gardé avec l'astreinte, jamais au journal) : astreinte à venir seulement
 * (commencée : 409, sa fin s'avance par `astreinte.modifier`) ; déjà annulée : rien n'est refait.
 */
const annuler: ActionHandler = async (ctx, p) => {
  const a = astreinteDe(ctx, p.id), emp = getEmp(ctx, a.empId);
  requirePlanificateur(ctx, emp);
  if (!astreinteActive(a)) return 'Astreinte déjà annulée';
  if (astreinteCommencee(a, ctx.d.ti)) throw new ActionError('Astreinte commencée : avancez sa fin (Modifier) plutôt que de l’annuler', 409);
  const motif = str(p.motif).replace(/\s+/g, ' ');
  if (!motif) throw new ActionError('Indiquez le motif de l’annulation : il est communiqué au salarié');
  if (motif.length > MOTIF_ASTREINTE_MAX) throw new ActionError(`Motif : ${MOTIF_ASTREINTE_MAX} caractères au plus`);
  const maj = { annuleLe: new Date().toISOString(), annulePar: ctx.user.nom, annuleMotif: motif };
  await ctx.db.update<Astreinte>('astreintes', a.id, maj);
  const envoye = await prevenirAstreinte(ctx, emp, { ...a, ...maj }, 'annulee', { managerId: managerDe(ctx, emp) });
  return `Astreinte de ${emp.nom} ${periodeAstreinteTexte(a)} annulée${suite(envoye)}`;
};

// — Interventions —

/** Ligne INT-AST d'une feuille (index), créée au besoin dans `lignes`. */
function ligneAstreinte(ctx: Ctx, lignes: LigneTemps[]): number {
  const i = lignes.findIndex(l => l.projet === ACTIVITE_ASTREINTE.code);
  if (i >= 0) return i;
  const pr = ctx.ds.referentiels.projets.find(x => x.code === ACTIVITE_ASTREINTE.code);
  if (!pr) throw new ActionError(`Activité interne ${ACTIVITE_ASTREINTE.code} absente du référentiel : redémarrez Cursus pour l’amorcer, ou créez-la (Référentiels → Activités internes)`, 409);
  if (pr.statut === 'archive') throw new ActionError(`Activité interne ${ACTIVITE_ASTREINTE.code} archivée (Référentiels) : aucune intervention ne peut y être imputée`, 409);
  lignes.push({ projet: pr.code, tache: pr.nom, ks: false, h: completerSemaine([]) });
  return lignes.length - 1;
}

/** Repos quotidien insuffisant de la feuille une fois l'intervention prise en compte (à motiver à la soumission). */
function alertesRepos(ctx: Ctx, emp: Employe, sh: FeuilleTemps, lignes: LigneTemps[], interventions: InterventionAstreinte[]): string[] {
  const ds = { ...ctx.ds, feuilles: ctx.ds.feuilles.map(f => (f.id === sh.id ? { ...f, lignes } : f)), interventionsAstreinte: interventions };
  return calcSheet(new Domain(ds), emp, { ...sh, lignes }).reposQuotidien;
}

/**
 * `astreinteId`, `jour` (jour où l'intervention commence, pas à venir), `debut`, `fin` (« HH:MM » ; une fin avant le début :
 * le lendemain) : contrôles de `controlerIntervention` et de la saisie d'heures (feuille modifiable, absence, contrat,
 * jour férié, 24 h par jour) ; heures ajoutées à la ligne INT-AST du jour.
 */
const intervention: ActionHandler = async (ctx, p) => {
  const a = astreinteDe(ctx, p.astreinteId);
  const toutes = ctx.ds.interventionsAstreinte ?? [];
  const r = controlerIntervention(a, p, toutes.filter(x => x.empId === a.empId), ctx.d.ti);
  if (!r.valeurs) throw new ActionError(r.erreurs.general ?? r.erreurs.jour ?? r.erreurs.debut ?? r.erreurs.fin ?? 'Intervention invalide');
  const x = r.valeurs, week = semaineIntervention(x), di = jourIntervention(x);
  const { emp, sh } = await editable(ctx, { empId: a.empId, week });
  const abs = joursAbsence(ctx.d, emp.id, week)[di];
  if (abs) throw new ActionError(`${absenceCeJour(abs)} : aucune intervention ne peut y être déclarée`);
  const hors = jourHorsContrat(emp, x.jour);
  if (hors) throw new ActionError(`Hors contrat ce jour-là (${hors})`);
  const ferie = isFerie(x.jour) ? ferieRefus(ctx.ds.settings) : null;
  if (ferie) throw new ActionError(ferie);
  const lignes = sh.lignes.map(l => ({ ...l, h: completerSemaine(l.h) }));
  const li = ligneAstreinte(ctx, lignes);
  lignes[li] = { ...lignes[li], h: lignes[li].h.map((v, j) => (j === di ? Math.round((Number(v) + x.heures) * 100) / 100 : v)) };
  const jour = lignes.reduce((n, l) => n + Number(l.h[di] || 0), 0);
  if (jour > HEURES_JOUR_MAX) throw new ActionError(`Plus de 24 h le ${fmtIso(x.jour)} avec cette intervention (${fH(jour)} toutes lignes cumulées) : une journée compte 24 h au plus`);
  await saveLines(ctx, sh, lignes);
  const n = await ctx.db.insert<InterventionAstreinte>('astreinteInterventions', {
    astreinteId: a.id, empId: a.empId, ...x, declareLe: new Date().toISOString(), declarePar: ctx.user.nom,
  });
  const repos = alertesRepos(ctx, emp, sh, lignes, [...toutes, n]);
  return {
    message: `Intervention d’astreinte de ${emp.nom} déclarée le ${fmtIso(x.jour)} de ${heureTexte(x.debut)} à ${heureTexte(x.fin)} (${fH(x.heures)}) : heures ajoutées à la feuille de temps`
      + (repos.length ? ` · ${repos.join(' ; ')} — motif à donner à la soumission` : ''),
    result: { intervention: { id: n.id, astreinteId: a.id, empId: a.empId, heures: x.heures } },
  };
};

/**
 * `id` : intervention retirée tant que la feuille de sa semaine se saisit (mêmes droits que la saisie d'heures) ; ses
 * heures sont retirées de la ligne INT-AST, et la ligne elle-même quand elle n'en porte plus.
 */
const retirerIntervention: ActionHandler = async (ctx, p) => {
  const x = (ctx.ds.interventionsAstreinte ?? []).find(i => i.id === Number(p.id));
  if (!x) throw new ActionError('Intervention introuvable', 404);
  const week = semaineIntervention(x), di = jourIntervention(x);
  const { emp, sh } = await editable(ctx, { empId: x.empId, week });
  let lignes = sh.lignes.map(l => ({ ...l, h: completerSemaine(l.h) }));
  const li = lignes.findIndex(l => l.projet === ACTIVITE_ASTREINTE.code);
  if (li >= 0) {
    lignes[li] = { ...lignes[li], h: lignes[li].h.map((v, j) => (j === di ? Math.max(0, Math.round((Number(v) - x.heures) * 100) / 100) : v)) };
    if (lignes[li].h.every(v => !Number(v))) lignes = lignes.filter((_, i) => i !== li);
  }
  await saveLines(ctx, sh, lignes);
  await ctx.db.remove('astreinteInterventions', x.id);
  return `Intervention d’astreinte de ${emp.nom} du ${fmtIso(x.jour)} retirée (${fH(x.heures)} retirées de la feuille de temps)`;
};

export const astreintesActions = {
  'astreinte.planifier': planifier,
  'astreinte.modifier': modifier,
  'astreinte.annuler': annuler,
  'astreinte.intervention': intervention,
  'astreinte.retirerIntervention': retirerIntervention,
} satisfies Record<string, ActionHandler>;
