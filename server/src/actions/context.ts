// Contexte d'exécution des actions : données complètes, utilisateur, contrôles d'accès.
import { droitsRh, type DroitRh } from '../../../shared/constants.ts';
import { Domain, type EmpX } from '../../../shared/domain.ts';
import { delegationPour } from '../../../shared/rules/delegations-manager.ts';
import type { CurrentUser, Dataset, Employe, PerimetreDelegation } from '../../../shared/types.ts';
import type { Db } from '../db.ts';

export class ActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface Ctx {
  db: Db;
  user: CurrentUser;
  ds: Dataset;
  d: Domain;
  /**
   * Délégation des validations (t135) : managers au nom desquels l'action a été décidée par leur suppléant. La décision est
   * signée « par délégation de … » dans le message, le journal et l'e-mail au salarié (server/src/app.ts, notifications.ts).
   */
  parDelegation: Set<number>;
}

/** Valeur renvoyée par une action : message de confirmation, éventuel résultat. */
export type ActionOutput = string | null | { message: string | null; result?: unknown };
export type ActionHandler = (ctx: Ctx, p: Record<string, any>) => ActionOutput;

export function makeCtx(db: Db, user: CurrentUser, ds: Dataset): Ctx {
  return { db, user, ds, d: new Domain(ds), parDelegation: new Set() };
}

/** Droit du profil de la personne connectée, dans l'espace RH (PROFILS_RH de shared/constants.ts). */
export const aDroit = (ctx: Ctx, droit: DroitRh) => droitsRh(ctx.user).includes(droit);

/**
 * Service RH (gestionnaire ou administrateur) : gestion courante, toutes les données. Les profils restreints de
 * l'espace RH (référent HSE, paie, lecture seule) n'ont pas ce droit.
 */
export const isRh = (ctx: Ctx) => aDroit(ctx, 'rh');

export function requireRh(ctx: Ctx) {
  if (!isRh(ctx)) throw new ActionError('Action réservée au service RH', 403);
}

/** Administrateur RH : paramètres, suppressions, comptes et accès (PROFILS_RH). */
export const isRhAdmin = (ctx: Ctx) => isRh(ctx) && aDroit(ctx, 'admin');

export function requireRhAdmin(ctx: Ctx) {
  requireRh(ctx);
  if (!isRhAdmin(ctx)) throw new ActionError('Action réservée à l’administrateur RH', 403);
}

/** Sessions, présences, certifications et habilitations : service RH et référent HSE / formation. */
export function requireFormations(ctx: Ctx) {
  if (!aDroit(ctx, 'formations')) throw new ActionError('Action réservée au service RH et au référent HSE / formation', 403);
}

/** Transmission des variables de paie à Sage : administrateur RH et gestionnaire de paie. */
export function requirePaie(ctx: Ctx) {
  if (!aDroit(ctx, 'paie')) throw new ActionError('Transmission à la paie réservée à l’administrateur RH et au gestionnaire de paie', 403);
}

/**
 * Membre du service RH sur sa propre fiche (compte rattaché à ce salarié) : comme tout salarié, il ne décide pas
 * de ses propres absences, feuilles de temps ou entretiens.
 */
export const estSoiMeme = (ctx: Ctx, empId: number) => ctx.user.role === 'rh' && ctx.user.salarieId != null && ctx.user.salarieId === empId;

/** Refus clair d'une décision sur soi-même : elle revient au manager du salarié ou à un autre membre du service RH. */
export function refuserSoiMeme(ctx: Ctx, e: Employe, refus: string) {
  if (!estSoiMeme(ctx, e.id)) return;
  const m = ctx.d.mgrOf(e);
  throw new ActionError(`${refus} : la décision revient ${m ? `à votre manager (${ctx.d.personName(m)}) ou ` : ''}à un autre membre du service RH`, 403);
}

export function getEmp(ctx: Ctx, id: unknown): Employe {
  const e = ctx.d.emp(Number(id));
  if (!e) throw new ActionError('Collaborateur introuvable', 404);
  return e;
}

/** RH : tous ; manager : lui-même et son équipe ; collaborateur : lui-même. */
export function canAccess(ctx: Ctx, empId: number): boolean {
  const { user, d } = ctx;
  if (isRh(ctx)) return true;
  if (empId === user.empId) return true;
  const e = d.emp(empId);
  if (user.role !== 'manager' || !e) return false;
  // Suppléant d'un manager absent (t135) : les salariés dont il décide aujourd'hui, quel que soit le périmètre reçu.
  return d.mgrOf(e) === user.empId || (['absences', 'feuilles', 'entretiens'] as const).some(p => !!parDelegation(ctx, e, p, false));
}
export function requireAccess(ctx: Ctx, empId: number) {
  if (!canAccess(ctx, empId)) throw new ActionError('Collaborateur hors de votre périmètre', 403);
}

/**
 * Délégation par laquelle le manager connecté décide aujourd'hui pour ce salarié (t135, shared/rules/delegations-manager.ts),
 * jamais pour lui-même ; `signer` : la décision sera signée « par délégation de » son manager (`Ctx.parDelegation`).
 */
function parDelegation(ctx: Ctx, e: Employe, perimetre: PerimetreDelegation, signer = true) {
  if (ctx.user.role !== 'manager' || !ctx.user.empId) return null;
  const g = delegationPour(ctx.ds, e, ctx.user.empId, ctx.d.ti, perimetre);
  if (g && signer) ctx.parDelegation.add(g.managerId);
  return g;
}

/**
 * Valideur des heures, absences et entretiens : RH (jamais pour lui-même) ou manager direct ; avec `perimetre`, aussi le
 * suppléant d'un manager absent pendant sa délégation de ce périmètre (t135), jamais pour ce qui le concerne.
 */
export function isValidatorOf(ctx: Ctx, e: Employe, perimetre?: PerimetreDelegation): boolean {
  return (isRh(ctx) && !estSoiMeme(ctx, e.id)) || (ctx.user.role === 'manager' && ctx.d.mgrOf(e) === ctx.user.empId)
    || (!!perimetre && !!parDelegation(ctx, e, perimetre));
}

/** Manager direct d'un collaborateur (hors lui-même) ; avec `perimetre`, aussi son suppléant pendant une délégation (t135). */
export function isManagerOf(ctx: Ctx, e: Employe, perimetre?: PerimetreDelegation): boolean {
  if (ctx.user.role !== 'manager' || e.id === ctx.user.empId) return false;
  return ctx.d.mgrOf(e) === ctx.user.empId || (!!perimetre && !!parDelegation(ctx, e, perimetre));
}

export function isSelf(ctx: Ctx, empId: number) {
  return ctx.user.role !== 'rh' && ctx.user.empId === empId;
}

/** Collaborateurs enrichis selon les paramètres de suivi en vigueur, salariés sortis compris (recherche par identifiant). */
export function enriched(ctx: Ctx): EmpX[] {
  return ctx.d.enrich(ctx.ds.settings.horizonAlerte, ctx.ds.settings.uniquementReglementaire, { sortis: true });
}

export function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
