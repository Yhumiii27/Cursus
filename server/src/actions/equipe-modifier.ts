// Modification d'une équipe en une seule action (t105) : renommage et changement de manager dans la même transaction.
// Auparavant, le dialogue enchaînait `equipe.renommer` puis `equipe.manager` : un refus du second laissait le renommage
// fait et fermait le dialogue, le choix du manager était perdu. Les contrôles sont ceux des deux actions, réutilisées
// telles quelles ; un refus de l'une annule tout (transaction de l'action, server/src/index.ts).
import { loadFull } from '../dataset.ts';
import { ActionError, type ActionHandler, makeCtx, requireRh, str } from './context.ts';
import { equipesActions } from './equipes.ts';

/** Message d'une action (texte, objet `{ message }` ou rien). */
const texte = (r: unknown): string => (typeof r === 'string' ? r : r && typeof r === 'object' && 'message' in r ? String((r as { message?: unknown }).message ?? '') : '');

/**
 * `nom` (équipe), `nouveau?` (nouveau nom ; absent ou identique : inchangé), `managerId?` (null : aucun manager ; absent :
 * inchangé). Renommage d'abord, puis désignation du manager sur l'équipe renommée, relue après le renommage.
 */
const modifier: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const q = ctx.ds.referentiels.equipes.find(x => x.nom === p.nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  const nouveau = p.nouveau === undefined ? q.nom : str(p.nouveau);
  const managerId = p.managerId === undefined ? q.managerId ?? null : (p.managerId ? Number(p.managerId) : null);
  const renomme = nouveau !== q.nom, changeManager = managerId !== (q.managerId ?? null);
  if (!renomme && !changeManager) return 'Aucune modification à enregistrer';
  const messages: string[] = [];
  let result: unknown;
  if (renomme) messages.push(texte(await equipesActions['equipe.renommer'](ctx, { nom: q.nom, nouveau })));
  if (changeManager) {
    // L'instantané de l'action précède le renommage : relu pour trouver l'équipe sous son nouveau nom.
    const apres = renomme ? makeCtx(ctx.db, ctx.user, await loadFull(ctx.db, ctx.user)) : ctx;
    const r = await equipesActions['equipe.manager'](apres, { nom: nouveau, managerId });
    messages.push(texte(r));
    // Éléments en attente des managers d'équipes rattachées, redirigés (t136) : gardés pour le journal.
    if (r && typeof r === 'object' && 'result' in r) result = r.result;
  }
  const message = messages.filter(Boolean).join(' — ');
  return result ? { message, result } : message;
};

export const equipeModifierActions: Record<string, ActionHandler> = {
  'equipe.modifier': modifier,
};
