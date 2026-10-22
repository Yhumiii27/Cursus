// Mandats des élus au CSE (shared/rules/delegation.ts) : saisis par le service RH sur la fiche du salarié (titulaire ou
// suppléant, dates, crédit d'heures par mois proposé d'après l'art. R2314-1), modifiés ou retirés. Le compteur des heures
// de délégation en découle (feuilles validées, code INT-DELEG) ; il n'alerte qu'au dépassement, sans rien bloquer.
import { fH, fmtIso } from '../../../shared/format.ts';
import { controlerMandat, ROLES_MANDAT } from '../../../shared/rules/delegation.ts';
import type { Mandat } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, getEmp, refuserSoiMeme, requireRh } from './context.ts';

/** Création (sans `id`) ou modification d'un mandat : empId, role, du, au?, credit. */
const enregistrer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const avant = p.id != null && p.id !== '' ? ctx.db.get<Mandat>('mandats', Number(p.id)) : null;
  if (p.id != null && p.id !== '' && !avant) throw new ActionError('Mandat introuvable', 404);
  const emp = getEmp(ctx, avant?.empId ?? p.empId);
  // Un membre du RH élu ne fixe pas lui-même son crédit d'heures de délégation.
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas enregistrer votre propre mandat au CSE');
  const autres = (ctx.ds.mandats ?? []).filter(m => m.empId === emp.id && m.id !== avant?.id);
  const { erreurs, mandat } = controlerMandat(p, autres);
  if (!mandat) throw new ActionError(Object.values(erreurs)[0] ?? 'Saisie invalide');
  if (avant) ctx.db.update<Mandat>('mandats', avant.id, mandat);
  else ctx.db.insert<Mandat>('mandats', { empId: emp.id, ...mandat });
  const periode = mandat.au ? `du ${fmtIso(mandat.du)} au ${fmtIso(mandat.au)}` : `depuis le ${fmtIso(mandat.du)}`;
  return `${ROLES_MANDAT[mandat.role]} au CSE — ${emp.nom}, ${periode}, crédit de ${fH(mandat.credit)} par mois ${avant ? 'modifié' : 'enregistré'}`;
};

/** Retrait d'un mandat saisi par erreur (un mandat terminé se garde avec sa date de fin). */
const supprimer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const m = ctx.db.get<Mandat>('mandats', Number(p.id));
  if (!m) throw new ActionError('Mandat introuvable', 404);
  const emp = getEmp(ctx, m.empId);
  refuserSoiMeme(ctx, emp, 'Vous ne pouvez pas retirer votre propre mandat au CSE');
  ctx.db.remove('mandats', m.id);
  return `Mandat au CSE de ${emp.nom} retiré`;
};

export const delegationActions = {
  'mandat.enregistrer': enregistrer,
  'mandat.supprimer': supprimer,
} satisfies Record<string, ActionHandler>;
