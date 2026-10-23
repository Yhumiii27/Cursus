// Délégation des validations d'un manager absent (t135) : le manager pour lui-même (espace manager ou collaborateur) ou le
// service RH enregistrent une délégation datée à un suppléant (règles : shared/rules/delegations-manager.ts) ; l'un ou
// l'autre la révoquent. Pendant la délégation, le suppléant décide des congés et des feuilles de temps de l'équipe (et des
// entretiens si le réglage l'ouvre), l'espace manager lui est ouvert, il reçoit les notifications et les relances ; ses
// décisions sont signées « par délégation de » (`signerDelegation`, server/src/app.ts).
import { fmtIso } from '../../../shared/format.ts';
import { controleDelegation, estPerimetre, perimetreTexte, suppleantPropose } from '../../../shared/rules/delegations-manager.ts';
import type { Compte } from '../comptes.ts';
import { annoncerDelegation, enAttenteDuSuppleant } from '../delegations.ts';
import { periodeLongue } from '../messagerie.ts';
import { notifier } from '../notifications.ts';
import type { ActionOutput, ActionHandler, Ctx } from './context.ts';
import { ActionError, isRh, str } from './context.ts';
import type { DelegationValidation, PerimetreDelegation } from '../../../shared/types.ts';

/**
 * Signature d'une décision prise par le suppléant : « · par délégation de Karim Haddad » ajouté au message (le journal
 * reçoit en plus les identifiants des managers remplacés). Sans délégation, le message est rendu tel quel.
 */
export function signerDelegation(ctx: Ctx, o: Exclude<ActionOutput, string | null>): Exclude<ActionOutput, string | null> {
  if (!ctx.parDelegation.size || !o.message) return o;
  return { ...o, message: `${o.message} · par délégation de ${[...ctx.parDelegation].map(id => ctx.d.personName(id)).join(' et de ')}` };
}

/** Manager qui délègue : le service RH le désigne ; un manager ne délègue que pour lui-même. */
function managerVise(ctx: Ctx, p: Record<string, any>): number {
  if (isRh(ctx)) {
    const id = Number(p.managerId);
    if (!Number.isInteger(id) || !ctx.d.emp(id)) throw new ActionError('Manager introuvable', 404);
    return id;
  }
  const moi = ctx.user.role === 'rh' ? null : ctx.user.empId;
  if (!moi || (p.managerId != null && p.managerId !== '' && Number(p.managerId) !== moi) || !ctx.d.teamsOf(moi).length) {
    throw new ActionError('Délégation réservée au manager pour lui-même et au service RH', 403);
  }
  return moi;
}

/**
 * `managerId` (service RH ; le manager : lui-même), `suppleantId` (défaut : son N+1), `du`, `au` (bornes comprises),
 * `perimetre` (codes : absences, feuilles ; entretiens si le réglage l'ouvre). Refus : contrôles de `controleDelegation`,
 * suppléant sans compte actif (il ne pourrait pas se connecter pour décider).
 */
const creer: ActionHandler = async (ctx, p) => {
  const managerId = managerVise(ctx, p);
  const suppleantId = p.suppleantId != null && p.suppleantId !== '' ? Number(p.suppleantId) : suppleantPropose(ctx.ds, managerId);
  if (!Number.isInteger(suppleantId) || !suppleantId) throw new ActionError('Choisissez le suppléant');
  const perimetre = [...new Set(Array.isArray(p.perimetre) ? p.perimetre : [])] as unknown[];
  const s = ctx.d.emp(suppleantId);
  const refus = controleDelegation(ctx.ds, { managerId, suppleantId, du: str(p.du), au: str(p.au), perimetre }, { suppleant: s, nom: id => ctx.d.personName(id) });
  if (refus) throw new ActionError(refus);
  if (!(await ctx.db.where<Compte>('comptes', 'empId', suppleantId)).some(c => c.actif)) {
    throw new ActionError(`${ctx.d.personName(suppleantId)} n’a pas de compte actif dans Cursus : il ne pourrait pas se connecter pour décider`);
  }
  const g = await ctx.db.insert<DelegationValidation>('delegations', {
    managerId, suppleantId, du: str(p.du), au: str(p.au), perimetre: perimetre.filter(estPerimetre) as PerimetreDelegation[],
    creeLe: new Date().toISOString(), creePar: ctx.user.nom, revoqueeLe: null, revoqueePar: null, annonceeLe: null,
  });
  const m = ctx.d.personName(managerId), sup = ctx.d.personName(suppleantId);
  // Délégation qui commence aujourd'hui (ou déjà commencée) : le suppléant reçoit aussitôt les demandes en attente ;
  // sinon, le jour de son début (tâches de fond).
  const commence = g.du <= ctx.d.ti;
  const attente = commence ? enAttenteDuSuppleant({ ...ctx.ds, delegations: [...(ctx.ds.delegations ?? []), g] }, g, ctx.d.ti).length : 0;
  if (commence) await annoncerDelegation({ db: ctx.db, ds: { ...ctx.ds, delegations: [...(ctx.ds.delegations ?? []), g] }, user: ctx.user }, g);
  else {
    await notifier(ctx, suppleantId, {
      type: 'delegation.prevue', objet: `${m} vous délègue ses validations ${periodeLongue(g.du, g.au)}`,
      texte: `${m} vous délègue ses validations (${perimetreTexte(g.perimetre)}) ${periodeLongue(g.du, g.au)}. L’espace Manager de Cursus vous sera ouvert pendant cette période ; un message vous rappellera les demandes en attente le premier jour.`,
    });
  }
  // Enregistrée par le service RH : le manager en est informé.
  if (isRh(ctx)) {
    await notifier(ctx, managerId, {
      type: 'delegation.prevue', objet: `Vos validations sont déléguées à ${sup} ${periodeLongue(g.du, g.au)}`,
      texte: `Le service RH a enregistré la délégation de vos validations (${perimetreTexte(g.perimetre)}) à ${sup} ${periodeLongue(g.du, g.au)}. Vous gardez la main pendant cette période.`,
    });
  }
  return {
    message: `Validations de ${m} (${perimetreTexte(g.perimetre)}) déléguées à ${sup} du ${fmtIso(g.du)} au ${fmtIso(g.au)}`
      + (commence ? ` · ${sup} est prévenu${attente ? ` (${attente} demande${attente > 1 ? 's' : ''} en attente)` : ''}` : ` · ${sup} est prévenu, l’espace Manager lui sera ouvert le ${fmtIso(g.du)}`),
    result: { delegation: g },
  };
};

/** `id` : délégation en cours ou à venir, révoquée aussitôt par le manager qui l'a donnée ou par le service RH. */
const revoquer: ActionHandler = async (ctx, p) => {
  const g = (ctx.ds.delegations ?? []).find(x => x.id === Number(p.id));
  if (!g) throw new ActionError('Délégation introuvable', 404);
  if (!isRh(ctx) && !(ctx.user.role !== 'rh' && ctx.user.empId === g.managerId)) throw new ActionError('Révocation réservée au manager qui a délégué et au service RH', 403);
  if (g.revoqueeLe) return 'Délégation déjà révoquée';
  if (g.au < ctx.d.ti) throw new ActionError('Délégation déjà terminée');
  await ctx.db.update('delegations', g.id, { revoqueeLe: new Date().toISOString(), revoqueePar: ctx.user.nom });
  const m = ctx.d.personName(g.managerId), sup = ctx.d.personName(g.suppleantId);
  await notifier(ctx, g.suppleantId, {
    type: 'delegation.fin', objet: `Délégation des validations de ${m} révoquée`,
    texte: `La délégation des validations de ${m} ${periodeLongue(g.du, g.au)} est révoquée : les demandes de son équipe reviennent à ${m}.`,
  });
  if (isRh(ctx)) await notifier(ctx, g.managerId, { type: 'delegation.fin', objet: 'Délégation de vos validations révoquée', texte: `Le service RH a révoqué la délégation de vos validations à ${sup} ${periodeLongue(g.du, g.au)}.` });
  return `Délégation à ${sup} révoquée : les validations reviennent à ${m}`;
};

export const delegationsManagerActions = {
  'equipe.delegation': creer,
  'equipe.revoquerDelegation': revoquer,
} satisfies Record<string, ActionHandler>;
