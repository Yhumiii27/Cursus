// Suivi des feuilles de temps (t130) : relance des feuilles en retard (salarié et valideur, par e-mail ou dans leur
// récapitulatif quotidien) et validation groupée des feuilles soumises, chacune avec les contrôles de temps.validate
// (dépassement sans motif, demande d'absence en attente, heures un jour d'absence…) : les refus sont listés au lieu de
// tout annuler, et les seuils de durée franchis (moyenne, temps partiel, contingent, contrepartie en repos) repris au
// message. État des semaines : shared/rules/suivi-feuilles.ts.
import { isoWeek, isValidDate, mondayOf } from '../../../shared/dates.ts';
import { plural } from '../../../shared/format.ts';
import { etatSemaines, maintenantParis, semainesSuivies } from '../../../shared/rules/suivi-feuilles.ts';
import type { Employe } from '../../../shared/types.ts';
import { loadFull } from '../dataset.ts';
import { type FeuilleARelancer, notifierRelanceFeuilles, notifierRelanceValideur } from '../notifications.ts';
import { ActionError, type ActionHandler, type Ctx, isRh, makeCtx } from './context.ts';
import { validerFeuille } from './temps.ts';

/** Service RH (gestionnaire ou administrateur) ou manager ; ni le collaborateur, ni un profil restreint de l'espace RH. */
function exigerValideur(ctx: Ctx, quoi: string) {
  if (ctx.user.role === 'collaborateur' || (ctx.user.role === 'rh' && !isRh(ctx))) throw new ActionError(`${quoi} réservée aux managers et au service RH`, 403);
}

/** Collaborateurs suivis : tous pour le service RH ; pour un manager, les membres de son équipe (hors lui-même). */
function perimetre(ctx: Ctx): Employe[] {
  if (isRh(ctx)) return ctx.ds.employes;
  return ctx.ds.employes.filter(e => e.id !== ctx.user.empId && ctx.d.mgrOf(e) === ctx.user.empId);
}

/**
 * `empId` (facultatif) : relance d'un seul collaborateur ; sinon de tous ceux du périmètre. Feuilles relancées : celles
 * des semaines suivies (réglage `suiviSemaines`) manquantes, en brouillon ou à corriger, une fois leur échéance passée.
 * Chaque salarié reçoit ses semaines, chaque valideur (manager direct, sinon la boîte du service RH) ses membres.
 */
const relancer: ActionHandler = (ctx, p) => {
  exigerValideur(ctx, 'Relance des feuilles de temps');
  let emps = perimetre(ctx);
  if (p.empId !== undefined && p.empId !== null) {
    const id = Number(p.empId);
    emps = emps.filter(e => e.id === id);
    if (!emps.length) throw new ActionError('Collaborateur hors de votre périmètre', 403);
  }
  const semaines = semainesSuivies(ctx.d.ti, ctx.ds.settings.suiviSemaines);
  const retards = etatSemaines(ctx.d, emps.map(e => e.id), semaines, maintenantParis(ctx.d.ti))
    .map(l => ({ emp: l.emp, feuilles: l.cellules.filter(c => c.enRetard).map((c): FeuilleARelancer => ({ week: c.week, etat: c.etat as FeuilleARelancer['etat'] })) }))
    .filter(r => r.feuilles.length);
  if (!retards.length) throw new ActionError('Aucune feuille de temps en retard à relancer');
  const parValideur = new Map<number, typeof retards>();
  for (const r of retards) {
    notifierRelanceFeuilles(ctx, r.emp, r.feuilles);
    const v = ctx.d.mgrOf(r.emp);
    parValideur.set(v, [...(parValideur.get(v) ?? []), r]);
  }
  for (const [v, liste] of parValideur) notifierRelanceValideur(ctx, v, liste);
  const n = retards.reduce((k, r) => k + r.feuilles.length, 0);
  return {
    message: `Relance envoyée pour ${plural(n, 'feuille de temps', 'feuilles de temps')} — ${retards.length > 1 ? `${retards.length} collaborateurs` : retards[0].emp.nom} et ${parValideur.size > 1 ? 'leurs valideurs' : 'son valideur'}`,
    result: { feuilles: retards.flatMap(r => r.feuilles.map(f => ({ empId: r.emp.id, week: f.week }))) },
  };
};

/** Feuilles validées en groupe au plus par appel. */
const LOT_MAX = 200;
/** Alertes de durée détaillées au message d'une validation groupée ; au-delà, elles sont comptées. */
const ALERTES_MAX = 5;

/**
 * `feuilles` : [{ empId, week }] soumises. Chacune passe par temps.validate dans son propre point de reprise
 * (SAVEPOINT) : un refus annule ce qu'elle aurait écrit et s'ajoute à la liste, les autres sont validées. Aucune
 * validée : refus (403 si toutes l'étaient pour des droits, sinon 400 avec la liste).
 */
const validerLot: ActionHandler = (ctx, p) => {
  exigerValideur(ctx, 'Validation des feuilles de temps');
  const liste = Array.isArray(p.feuilles) ? p.feuilles as unknown[] : [];
  const demandees = liste.flatMap(x => {
    const o = (x && typeof x === 'object' ? x : {}) as { empId?: unknown; week?: unknown };
    const empId = Number(o.empId), week = String(o.week ?? '');
    return Number.isInteger(empId) && isValidDate(week) && mondayOf(week) === week ? [{ empId, week }] : [];
  });
  if (!demandees.length || demandees.length !== liste.length) throw new ActionError('Feuilles à valider invalides');
  if (demandees.length > LOT_MAX) throw new ActionError(`${LOT_MAX} feuilles au plus par validation groupée`);
  const validees: { empId: number; week: string }[] = [];
  const alertes: { empId: number; week: string; texte: string }[] = [];
  const refus: { empId: number; week: string; raison: string; status: number }[] = [];
  for (const f of demandees) {
    ctx.db.sql.exec('SAVEPOINT validation_groupee');
    try {
      // Instantané relu pour chaque feuille : la précédente a pu changer un relevé ou une feuille voisine.
      const v = validerFeuille(makeCtx(ctx.db, ctx.user, loadFull(ctx.db, ctx.user)), f);
      ctx.db.sql.exec('RELEASE validation_groupee');
      validees.push(f);
      alertes.push(...v.alertes.map(texte => ({ ...f, texte })));
    } catch (err) {
      ctx.db.sql.exec('ROLLBACK TO validation_groupee');
      ctx.db.sql.exec('RELEASE validation_groupee');
      if (!(err instanceof ActionError)) throw err;
      refus.push({ ...f, raison: err.message, status: err.status });
    }
  }
  const nom = (id: number) => ctx.d.emp(id)?.nom ?? `salarié n° ${id}`;
  const refusTexte = refus.map(r => `${nom(r.empId)} S${isoWeek(r.week)} (${r.raison})`).join(' ; ');
  if (!validees.length) {
    if (refus.every(r => r.status === 403)) throw new ActionError(refus.length === 1 ? refus[0].raison : `Aucune feuille validée : ${refusTexte}`, 403);
    throw new ActionError(`Aucune feuille validée — ${plural(refus.length, 'refus', 'refus')} : ${refusTexte}`);
  }
  // Seuils franchis, comme à la validation d'une seule feuille : les premiers en entier, le reste compté.
  const alertesTexte = alertes.slice(0, ALERTES_MAX).map(a => ` · ${nom(a.empId)} S${isoWeek(a.week)} : ${a.texte}`).join('')
    + (alertes.length > ALERTES_MAX ? ` · ${plural(alertes.length - ALERTES_MAX, 'autre alerte', 'autres alertes')} de durée, sur les feuilles validées` : '');
  return {
    message: `${plural(validees.length, 'feuille validée', 'feuilles validées')}${refus.length ? ` · ${plural(refus.length, 'feuille non validée', 'feuilles non validées')}, à ouvrir une à une : ${refusTexte}` : ''}${alertesTexte}`,
    result: { validees, refus: refus.map(({ empId, week }) => ({ empId, week })) },
  };
};

export const suiviFeuillesActions: Record<string, ActionHandler> = {
  'temps.relancer': relancer,
  'temps.validerLot': validerLot,
};
