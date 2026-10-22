// Agenda personnel (t036, server/src/agenda.ts) : abonnement par jeton révocable.
//   agenda.creerJeton     — : nouveau jeton de la personne connectée (le précédent est révoqué), renvoyé une seule fois
//                         dans `result` ; jamais au journal. Depuis l'espace collaborateur ou manager, flux activé.
//   agenda.revoquerJeton  — : abonnement de la personne connectée révoqué.
//   agenda.revoquerTout   — : tous les abonnements révoqués (administrateur RH : fuite d'un jeton, changement de règle).
import { plural } from '../../../shared/format.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { creerJeton, revoquerJetons } from '../agenda.ts';
import { ActionError, getEmp, requireRhAdmin, type ActionHandler, type Ctx } from './context.ts';

/** Salarié de la personne connectée, hors espace RH (l'abonnement se gère depuis son portail). */
function salarie(ctx: Ctx) {
  if (ctx.user.role === 'rh' || !ctx.user.empId) throw new ActionError('Abonnement à votre agenda : depuis votre espace collaborateur', 403);
  return getEmp(ctx, ctx.user.empId);
}

const creer: ActionHandler = (ctx) => {
  const e = salarie(ctx);
  if (!ctx.ds.settings.agendaFluxActif) throw new ActionError('Abonnement à l’agenda désactivé : l’administrateur RH l’active dans Paramètres → Agenda', 409);
  if (!present(e, ctx.d.ti)) throw new ActionError('Contrat terminé : aucun agenda à publier', 409);
  const { jeton, id } = creerJeton(ctx.db, e.id, ctx.user.nom);
  return { message: 'Adresse d’abonnement créée : copiez-la maintenant dans Outlook, elle ne sera plus affichée', result: { jeton, id } };
};

const revoquer: ActionHandler = (ctx) => {
  const e = salarie(ctx);
  const n = revoquerJetons(ctx.db, ctx.user.nom, e.id);
  return n ? 'Abonnement révoqué : l’agenda abonné ne se met plus à jour' : 'Aucun abonnement en vigueur';
};

const revoquerTout: ActionHandler = (ctx) => {
  requireRhAdmin(ctx);
  const n = revoquerJetons(ctx.db, ctx.user.nom);
  return { message: n ? `${plural(n, 'abonnement révoqué', 'abonnements révoqués')} : chacun en recrée un depuis son espace` : 'Aucun abonnement en vigueur', result: { revoques: n } };
};

export const agendaActions = {
  'agenda.creerJeton': creer,
  'agenda.revoquerJeton': revoquer,
  'agenda.revoquerTout': revoquerTout,
} satisfies Record<string, ActionHandler>;
