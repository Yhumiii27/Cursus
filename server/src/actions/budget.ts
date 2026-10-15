// Plan prévisionnel de formation et enveloppes budgétaires. Un exercice clos (shared/rules/exercices.ts) ne se modifie
// plus : ni import, ni enveloppes, ni avancement.
import { fmtEur, plural } from '../../../shared/format.ts';
import { clotureDe, effectifReel, montantReel } from '../../../shared/rules/exercices.ts';
import { parsePlan } from '../../../shared/rules/imports.ts';
import type { PlanAction, PlanStatut } from '../../../shared/types.ts';
import { ActionError, type Ctx, requireRh, requireRhAdmin, str, type ActionHandler } from './context.ts';

/** Refus d'une modification du plan ou des enveloppes d'un exercice clos. */
export function refuserExerciceClos(ctx: Ctx, ex: number) {
  const clos = clotureDe(ctx.ds, ex);
  if (clos) throw new ActionError(`Exercice ${ex} clos : son plan et ses enveloppes ne se modifient plus`);
}

/**
 * Import du plan : en mode « remplacer » (administrateur RH), les lignes prévues de l'exercice issues d'un import sont
 * supprimées ; celles issues d'une demande acceptée, d'un report ou sans origine connue (ancienne base) sont conservées.
 */
const importer: ActionHandler = (ctx, p) => {
  if (p.mode === 'replace') requireRhAdmin(ctx);
  else requireRh(ctx);
  const ex = Number(p.exercice);
  if (!(ex > 2000)) throw new ActionError('Exercice invalide');
  refuserExerciceClos(ctx, ex);
  const rows = parsePlan(ctx.d, str(p.texte)).filter(r => r.ok);
  if (!rows.length) throw new ActionError('Aucune ligne valide à importer');
  if (p.mode === 'replace') ctx.ds.plan.filter(l => l.exercice === ex && l.statut === 'prevu' && l.origine === 'import').forEach(l => ctx.db.remove('planActions', l.id));
  rows.forEach(r => ctx.db.insert<PlanAction>('planActions', {
    exercice: ex, f: r.f, libelle: r.libelle, equipe: r.equipe!, periode: r.periode!, effectif: r.effectif, cout: r.cout, statut: 'prevu', origine: 'import',
  }));
  return `${plural(rows.length, 'ligne importée', 'lignes importées')} dans le plan ${ex} — ${fmtEur(rows.reduce((n, r) => n + r.cout, 0))} prévisionnels`;
};

const enveloppes: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const ex = Number(p.exercice);
  if (!(ex > 2000)) throw new ActionError('Exercice invalide');
  refuserExerciceClos(ctx, ex);
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
 * Vers « réalisé » : `coutReel` exigé (0 accepté), `effectifReel` facultatif ; ils comptent dans le réalisé des enveloppes.
 */
const avancer: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const l = ctx.ds.plan.find(x => x.id === Number(p.id));
  if (!l) throw new ActionError('Action introuvable ou déjà réalisée');
  const nom = `${l.f ? ctx.d.fm(l.f).court : l.libelle} — ${l.equipe}`;
  if (l.statut === 'reporte') throw new ActionError(`${nom} : action reportée sur l’exercice ${l.exercice + 1}`);
  refuserExerciceClos(ctx, l.exercice);
  if (p.de !== undefined) {
    const de = ORDRE_PLAN.indexOf(p.de), st = ORDRE_PLAN.indexOf(l.statut);
    if (de < 0 || de > 1) throw new ActionError('Statut attendu invalide');
    if (st > de) return `${nom} · déjà ${l.statut === 'engage' ? 'engagé' : 'réalisé'}`;
    if (st < de) throw new ActionError(`${nom} : l’action est de nouveau prévue (session annulée) — vérifiez-la, puis réessayez`);
  }
  if (l.statut === 'realise') throw new ActionError('Action introuvable ou déjà réalisée');
  if (l.statut === 'prevu') {
    ctx.db.update<PlanAction>('planActions', l.id, { statut: 'engage' });
    return `${nom} · engagé (${fmtEur(l.cout)})`;
  }
  const cout = montantReel(p.coutReel);
  if (cout === null) throw new ActionError('Coût réel de l’action à indiquer : montant en euros, 0 ou plus');
  const effectif = p.effectifReel === undefined || p.effectifReel === null || p.effectifReel === '' ? null : effectifReel(p.effectifReel);
  if (effectif === null && p.effectifReel != null && p.effectifReel !== '') throw new ActionError('Effectif réel : nombre entier de personnes, 0 ou plus');
  ctx.db.update<PlanAction>('planActions', l.id, { statut: 'realise', coutReel: cout, effectifReel: effectif });
  const ecart = cout - l.cout;
  return `${nom} · réalisé (${fmtEur(cout)}${ecart ? `, ${ecart > 0 ? '+' : '−'}${fmtEur(Math.abs(ecart))} par rapport au prévu` : ''})`;
};

export const budgetActions: Record<string, ActionHandler> = {
  'plan.importer': importer,
  'budget.enveloppes': enveloppes,
  'plan.avancer': avancer,
};
