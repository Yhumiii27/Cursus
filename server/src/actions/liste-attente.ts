// Liste d'attente des sessions complètes (lot 7, chantier C, t120 ; server/src/liste-attente.ts) : confirmation par le
// service RH de l'inscription d'une personne de la file (place libérée), retrait de la file par le salarié, son manager
// ou le service RH.
//   attente.confirmer  { id }   service RH et référent HSE / formation ; convocation envoyée à ce moment-là
//   attente.retirer    { id }   le salarié pour lui-même, son manager direct, le service RH et le référent HSE
import { ActionError, type ActionHandler, aDroit, getEmp, isManagerOf, requireFormations } from './context.ts';
import { confirmerAttente, retirerAttente } from '../liste-attente.ts';

const confirmer: ActionHandler = async (ctx, p) => {
  requireFormations(ctx);
  return await confirmerAttente(ctx, p.id);
};

const retirer: ActionHandler = async (ctx, p) => {
  const a = (ctx.ds.attentesSession ?? []).find(x => x.id === Number(p.id));
  if (!a) throw new ActionError('Liste d’attente : inscription introuvable', 404);
  const emp = getEmp(ctx, a.empId);
  // Le salarié pour lui-même (espace collaborateur ou manager), avant tout autre droit : son retrait est le sien.
  const issue = ctx.user.role !== 'rh' && ctx.user.empId === emp.id ? 'salarie'
    : aDroit(ctx, 'formations') ? 'rh'
    : isManagerOf(ctx, emp) ? 'manager' : null;
  if (!issue) throw new ActionError('Retrait réservé au salarié, à son manager, au service RH et au référent HSE / formation', 403);
  return await retirerAttente(ctx, a.id, issue);
};

export const listeAttenteActions = {
  'attente.confirmer': confirmer,
  'attente.retirer': retirer,
} satisfies Record<string, ActionHandler>;
