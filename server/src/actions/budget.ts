// Plan prévisionnel de formation et enveloppes budgétaires.
import { fmtEur, plural } from '../../../shared/format.ts';
import { parsePlan } from '../../../shared/rules/imports.ts';
import type { PlanAction, PlanStatut } from '../../../shared/types.ts';
import { ActionError, requireRh, requireRhAdmin, str, type ActionHandler } from './context.ts';

/** Import du plan : en mode « remplacer », les lignes prévues de l'exercice sont supprimées (administrateur RH). */
const importer: ActionHandler = (ctx, p) => {
  if (p.mode === 'replace') requireRhAdmin(ctx);
  else requireRh(ctx);
  const ex = Number(p.exercice);
  if (!(ex > 2000)) throw new ActionError('Exercice invalide');
  const rows = parsePlan(ctx.d, str(p.texte)).filter(r => r.ok);
  if (!rows.length) throw new ActionError('Aucune ligne valide à importer');
  if (p.mode === 'replace') ctx.ds.plan.filter(l => l.exercice === ex && l.statut === 'prevu').forEach(l => ctx.db.remove('planActions', l.id));
  rows.forEach(r => ctx.db.insert<PlanAction>('planActions', {
    exercice: ex, f: r.f, libelle: r.libelle, equipe: r.equipe!, periode: r.periode!, effectif: r.effectif, cout: r.cout, statut: 'prevu', origine: 'import',
  }));
  return `${plural(rows.length, 'ligne importée', 'lignes importées')} dans le plan ${ex} — ${fmtEur(rows.reduce((n, r) => n + r.cout, 0))} prévisionnels`;
};

const enveloppes: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const ex = Number(p.exercice);
  if (!(ex > 2000)) throw new ActionError('Exercice invalide');
  const input = (p.enveloppes || {}) as Record<string, unknown>;
  let total = 0;
  ctx.d.equipes.forEach(equipe => {
    const montant = Math.max(0, Number(input[equipe]) || 0);
    total += montant;
    const row = ctx.db.sql.prepare('SELECT id FROM budgets WHERE exercice = ? AND equipe = ?').get(ex, equipe) as { id: number } | undefined;
    if (row) ctx.db.update('budgets', row.id, { montant });
    else ctx.db.insert('budgets', { exercice: ex, equipe, montant });
  });
  return `Enveloppes ${ex} enregistrées — ${fmtEur(total)}`;
};

const ORDRE_PLAN: PlanStatut[] = ['prevu', 'engage', 'realise'];

/**
 * Prévu → engagé → réalisé. Une action prévue rattachée au catalogue passe par la création de session.
 * `de` : statut affiché quand la personne a cliqué. Déjà dépassé (double clic, autre onglet) : rien n'est
 * refait, l'action n'avance jamais de deux crans ; revenu en arrière (session annulée) : refus.
 */
const avancer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const l = ctx.ds.plan.find(x => x.id === Number(p.id));
  if (!l) throw new ActionError('Action introuvable ou déjà réalisée');
  const nom = `${l.f ? ctx.d.fm(l.f).court : l.libelle} — ${l.equipe}`;
  if (p.de !== undefined) {
    const de = ORDRE_PLAN.indexOf(p.de), st = ORDRE_PLAN.indexOf(l.statut);
    if (de < 0 || de > 1) throw new ActionError('Statut attendu invalide');
    if (st > de) return `${nom} · déjà ${l.statut === 'engage' ? 'engagé' : 'réalisé'}`;
    if (st < de) throw new ActionError(`${nom} : l’action est de nouveau prévue (session annulée) — vérifiez-la, puis réessayez`);
  }
  if (l.statut === 'realise') throw new ActionError('Action introuvable ou déjà réalisée');
  const next = l.statut === 'prevu' ? 'engage' : 'realise';
  ctx.db.update<PlanAction>('planActions', l.id, { statut: next });
  return `${nom} · ${next === 'engage' ? 'engagé' : 'réalisé'} (${fmtEur(l.cout)})`;
};

export const budgetActions: Record<string, ActionHandler> = {
  'plan.importer': importer,
  'budget.enveloppes': enveloppes,
  'plan.avancer': avancer,
};
