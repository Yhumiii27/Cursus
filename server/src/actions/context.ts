// Contexte d'exécution des actions : données complètes, utilisateur, contrôles d'accès.
import { droitsRh, type DroitRh } from '../../../shared/constants.ts';
import { Domain, type EmpX } from '../../../shared/domain.ts';
import type { CurrentUser, Dataset, Employe } from '../../../shared/types.ts';
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
}

/** Valeur renvoyée par une action : message de confirmation, éventuel résultat. */
export type ActionOutput = string | null | { message: string | null; result?: unknown };
export type ActionHandler = (ctx: Ctx, p: Record<string, any>) => ActionOutput;

export function makeCtx(db: Db, user: CurrentUser, ds: Dataset): Ctx {
  return { db, user, ds, d: new Domain(ds) };
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
  return user.role === 'manager' && !!e && d.mgrOf(e) === user.empId;
}
export function requireAccess(ctx: Ctx, empId: number) {
  if (!canAccess(ctx, empId)) throw new ActionError('Collaborateur hors de votre périmètre', 403);
}

/** Valideur des heures, absences et entretiens : RH (jamais pour lui-même) ou manager direct. */
export function isValidatorOf(ctx: Ctx, e: Employe): boolean {
  return (isRh(ctx) && !estSoiMeme(ctx, e.id)) || (ctx.user.role === 'manager' && ctx.d.mgrOf(e) === ctx.user.empId);
}

/** Manager direct d'un collaborateur (hors lui-même). */
export function isManagerOf(ctx: Ctx, e: Employe): boolean {
  return ctx.user.role === 'manager' && e.id !== ctx.user.empId && ctx.d.mgrOf(e) === ctx.user.empId;
}

export function isSelf(ctx: Ctx, empId: number) {
  return ctx.user.role !== 'rh' && ctx.user.empId === empId;
}

/** Collaborateurs enrichis selon les paramètres de suivi en vigueur. */
export function enriched(ctx: Ctx): EmpX[] {
  return ctx.d.enrich(ctx.ds.settings.horizonAlerte, ctx.ds.settings.uniquementReglementaire);
}

export function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
