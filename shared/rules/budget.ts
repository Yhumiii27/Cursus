// Plan de formation et consommation des enveloppes budgétaires. Le réalisé compte le coût réel saisi à la clôture de
// chaque action (shared/rules/exercices.ts), l'engagé et le prévu leur coût prévu ; une action reportée sur l'exercice
// suivant ne compte plus dans le sien.
import { TRIMESTRES } from '../constants.ts';
import type { Domain } from '../domain.ts';
import type { PlanAction, PlanStatut } from '../types.ts';
import { coutRetenu } from './exercices.ts';

const sum = (list: PlanAction[], st?: PlanStatut) => list.filter(l => !st || l.statut === st).reduce((n, l) => n + coutRetenu(l), 0);

export function budgetSummary(d: Domain, exercice: number, seuil: number) {
  const env = d.ds.budgets[String(exercice)] || {};
  const equipes = d.equipes;
  const envTotal = equipes.reduce((n, e) => n + (env[e] || 0), 0);
  const planEx = d.ds.plan.filter(l => l.exercice === exercice);
  const realise = sum(planEx, 'realise'), engage = sum(planEx, 'engage'), prevu = sum(planEx, 'prevu');
  // Écart du réalisé au prévu : coût réel moins coût prévu des actions réalisées (positif : dépassement).
  const realisePrevu = planEx.filter(l => l.statut === 'realise').reduce((n, l) => n + l.cout, 0), ecart = realise - realisePrevu;
  const consomme = realise + engage, dispo = envTotal - consomme;
  const pctConso = envTotal ? Math.round(consomme / envTotal * 100) : 0;
  const teams = equipes.map(nom => {
    const list = planEx.filter(l => l.equipe === nom), e = env[nom] || 0;
    const r = sum(list, 'realise'), g = sum(list, 'engage'), p = sum(list, 'prevu');
    const pct = e ? Math.round((r + g) / e * 100) : 0;
    const over = r + g > e, tension = !over && pct >= seuil, overPlan = !over && !tension && r + g + p > e;
    return { nom, env: e, r, g, p, pct, over, tension, overPlan };
  });
  const quarters = TRIMESTRES.map(t => {
    const list = planEx.filter(l => l.periode === t && l.statut !== 'reporte');
    return { t, n: list.length, r: sum(list, 'realise'), g: sum(list, 'engage'), p: sum(list, 'prevu') };
  });
  return { env, envTotal, planEx, realise, realisePrevu, ecart, engage, prevu, consomme, dispo, pctConso, teams, quarters };
}
