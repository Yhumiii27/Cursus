// Clôture d'un exercice du plan de formation (administrateur RH, shared/rules/exercices.ts) : plan et enveloppes passent
// en lecture seule ; les actions prévues ou engagées cochées dans le dialogue sont reportées sur l'exercice suivant
// (origine « report », lien vers l'action d'origine, qui passe « reportée »). Le report est proposé, jamais imposé : une
// action non cochée reste dans l'exercice clos, telle quelle. Les réalisées y restent toujours.
import { fmtIso, plural } from '../../../shared/format.ts';
import { controleCloture, reportables } from '../../../shared/rules/exercices.ts';
import { sessionActive } from '../../../shared/domain.ts';
import type { PlanAction, Session } from '../../../shared/types.ts';
import { ActionError, requireRhAdmin, type ActionHandler } from './context.ts';
import { refuserExerciceClos } from './budget.ts';

const cloturer: ActionHandler = (ctx, p) => {
  requireRhAdmin(ctx);
  const ex = Number(p.exercice);
  const refus = controleCloture(ctx.ds, ex, ctx.d.year);
  if (refus) throw new ActionError(refus);
  const possibles = reportables(ctx.ds, ex);
  const ids = [...new Set((Array.isArray(p.reporter) ? p.reporter : []).map(Number))];
  const choisies = ids.map(id => {
    const l = possibles.find(x => x.id === id);
    if (!l) throw new ActionError('Action à reporter introuvable, ou ni prévue ni engagée : rouvrez la clôture');
    return l;
  });
  if (choisies.length) refuserExerciceClos(ctx, ex + 1);
  for (const l of choisies) {
    // Nouvelle ligne au premier trimestre de l'exercice suivant, au même coût prévu et au même statut ; les sessions
    // ouvertes de l'action d'origine la suivent (leur clôture réalisera la nouvelle ligne).
    const n = ctx.db.insert<PlanAction>('planActions', {
      exercice: ex + 1, f: l.f, libelle: l.libelle, equipe: l.equipe, periode: 'T1', effectif: l.effectif, cout: l.cout, statut: l.statut,
      origine: 'report', reportDe: l.id,
    });
    ctx.db.update<PlanAction>('planActions', l.id, { statut: 'reporte' });
    ctx.ds.sessions.filter(s => s.planId === l.id && sessionActive(s)).forEach(s => ctx.db.update<Session>('sessions', s.id, { planId: n.id }));
  }
  ctx.db.insert('exercicesClos', { exercice: ex, le: ctx.d.ti, par: ctx.user.nom });
  const restees = possibles.length - choisies.length;
  return [
    `Exercice ${ex} clos le ${fmtIso(ctx.d.ti)}`,
    choisies.length ? `${plural(choisies.length, 'action reportée', 'actions reportées')} sur ${ex + 1}` : '',
    restees ? `${plural(restees, 'action non réalisée laissée', 'actions non réalisées laissées')} dans ${ex}` : '',
  ].filter(Boolean).join(' · ');
};

export const exercicesActions = {
  'plan.cloturerExercice': cloturer,
} satisfies Record<string, ActionHandler>;
