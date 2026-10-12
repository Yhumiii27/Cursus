// Contexte d'exécution des actions : données complètes, utilisateur, contrôles d'accès.
import { aDroitRh } from '../../../shared/constants.ts';
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

export const isRh = (ctx: Ctx) => ctx.user.role === 'rh';

export function requireRh(ctx: Ctx) {
  if (!isRh(ctx)) throw new ActionError('Action réservée au service RH', 403);
}

/** Administrateur RH : paramètres, transmission à la paie, suppressions, comptes et accès (PROFILS_RH). */
export const isRhAdmin = (ctx: Ctx) => isRh(ctx) && aDroitRh(ctx.user.profilRh, 'admin');

export function requireRhAdmin(ctx: Ctx) {
  requireRh(ctx);
  if (!isRhAdmin(ctx)) throw new ActionError('Action réservée à l’administrateur RH', 403);
}

export function getEmp(ctx: Ctx, id: unknown): Employe {
  const e = ctx.d.emp(Number(id));
  if (!e) throw new ActionError('Collaborateur introuvable', 404);
  return e;
}

/** RH : tous ; manager : lui-même et son équipe ; collaborateur : lui-même. */
export function canAccess(ctx: Ctx, empId: number): boolean {
  const { user, d } = ctx;
  if (user.role === 'rh') return true;
  if (empId === user.empId) return true;
  const e = d.emp(empId);
  return user.role === 'manager' && !!e && d.mgrOf(e) === user.empId;
}
export function requireAccess(ctx: Ctx, empId: number) {
  if (!canAccess(ctx, empId)) throw new ActionError('Collaborateur hors de votre périmètre', 403);
}

/** Valideur des heures, absences et entretiens : RH ou manager direct. */
export function isValidatorOf(ctx: Ctx, e: Employe): boolean {
  return isRh(ctx) || (ctx.user.role === 'manager' && ctx.d.mgrOf(e) === ctx.user.empId);
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
