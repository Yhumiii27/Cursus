// Évaluation des formations (lot 7, chantier C, t121 ; règles : shared/rules/evaluation-formation.ts). Une évaluation par
// formation (participation présente à une session clôturée, ou formation suivie), type (à chaud, à froid) et répondant (le
// salarié, son manager) : une nouvelle saisie remplace la précédente.
//   evaluation.enregistrer { participationId | formationSuivieId, type, note?, efficacite?, commentaire?, repondant? }
//       le salarié pour lui-même (son avis), son manager direct (à froid, son avis de manager), le service RH pour l'un
//       ou l'autre (avis recueilli : `repondant`, le salarié par défaut) ; ni le référent HSE, ni la paie, ni la lecture
//       seule, qui ne voient que les indicateurs agrégés
//   evaluation.retirer     { id }   le service RH, ou l'auteur de l'avis (le salarié pour le sien, le manager pour le sien)
// Fenêtres de saisie, formations concernées et répondants prévus : `refusEvaluation`, commun avec le dialogue. Le journal
// ne garde ni la note, ni l'efficacité, ni le commentaire (server/src/journal.ts).
import { fmtIso } from '../../../shared/format.ts';
import {
  cibleDe, COMMENTAIRE_EVALUATION_MAX, estEfficacite, evaluationDe, NOTE_MAX, NOTE_MIN, refusEvaluation, TYPE_EVALUATION_LABEL,
} from '../../../shared/rules/evaluation-formation.ts';
import type { EvaluationFormation, RepondantEvaluation, TypeEvaluation } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, type Ctx, estSoiMeme, getEmp, isRh, str } from './context.ts';

/** De qui est l'avis saisi par la personne connectée, ou refus (403) hors de ses droits. */
function repondantDe(ctx: Ctx, empId: number, demande: unknown): RepondantEvaluation {
  const emp = getEmp(ctx, empId);
  // Le salarié pour lui-même (espace collaborateur ou manager), avant tout autre droit : son avis est le sien.
  if (ctx.user.role !== 'rh' && ctx.user.empId === emp.id) return 'salarie';
  if (isRh(ctx)) {
    const r = demande === 'manager' ? 'manager' : 'salarie';
    if (r === 'manager' && estSoiMeme(ctx, emp.id)) throw new ActionError('Avis du manager sur votre propre formation : il revient à votre manager', 403);
    return r;
  }
  if (ctx.user.role === 'manager' && ctx.user.empId && emp.id !== ctx.user.empId && ctx.d.mgrOf(emp) === ctx.user.empId) return 'manager';
  throw new ActionError('Évaluation réservée au salarié, à son manager et au service RH', 403);
}

const enregistrer: ActionHandler = async (ctx, p) => {
  const c = cibleDe(ctx.d, p);
  if (!c) throw new ActionError('Formation à évaluer introuvable (participation à une session clôturée, ou formation suivie)', 404);
  const type = p.type as TypeEvaluation;
  if (type !== 'chaud' && type !== 'froid') throw new ActionError('Type d’évaluation inconnu : à chaud ou à froid');
  const repondant = repondantDe(ctx, c.empId, p.repondant);
  // Avis recueilli par le service RH (pas le sien) : à chaud sans limite de temps.
  const refus = refusEvaluation(ctx.ds.settings, ctx.d.ti, c, type, repondant, isRh(ctx) && ctx.user.salarieId !== c.empId);
  if (refus) throw new ActionError(refus);
  const note = type === 'chaud' ? Number(p.note) : null;
  if (type === 'chaud' && !(Number.isInteger(note) && note! >= NOTE_MIN && note! <= NOTE_MAX)) throw new ActionError(`Évaluation à chaud : note entière de ${NOTE_MIN} à ${NOTE_MAX}`);
  const efficacite = type === 'froid' ? p.efficacite : null;
  if (type === 'froid' && !estEfficacite(efficacite)) throw new ActionError('Évaluation à froid : efficace, partiellement ou pas efficace');
  const commentaire = str(p.commentaire) || null;
  if (commentaire && commentaire.length > COMMENTAIRE_EVALUATION_MAX) throw new ActionError('Commentaire trop long (1 000 caractères au plus)');
  const valeurs = {
    note, efficacite: efficacite as EvaluationFormation['efficacite'], commentaire, le: ctx.d.ti, auteur: ctx.user.nom,
    // Fiche de la personne qui saisit (null : compte du service RH sans fiche).
    auteurId: ctx.user.empId ?? ctx.user.salarieId ?? null,
  };
  const avant = evaluationDe(await ctx.db.all<EvaluationFormation>('evaluationsFormation'), c, type, repondant);
  const e = avant
    ? (await ctx.db.update<EvaluationFormation>('evaluationsFormation', avant.id, valeurs), avant)
    : await ctx.db.insert<EvaluationFormation>('evaluationsFormation', {
      empId: c.empId, participationId: c.participationId, formationSuivieId: c.formationSuivieId, type, repondant, ...valeurs,
    });
  const pour = repondant === 'manager' ? ' (avis du manager)' : ctx.user.empId === c.empId ? '' : ` (avis de ${ctx.d.personName(c.empId)})`;
  return {
    message: `Évaluation ${TYPE_EVALUATION_LABEL[type].toLowerCase()} ${avant ? 'modifiée' : 'enregistrée'} — ${c.intitule}, terminée le ${fmtIso(c.fin)}${pour}`,
    result: { id: e.id, empId: c.empId, repondant, remplace: !!avant },
  };
};

const retirer: ActionHandler = async (ctx, p) => {
  const e = await ctx.db.get<EvaluationFormation>('evaluationsFormation', Number(p.id));
  if (!e) throw new ActionError('Évaluation introuvable', 404);
  const emp = getEmp(ctx, e.empId);
  const sienne = ctx.user.role !== 'rh' && ((e.repondant === 'salarie' && ctx.user.empId === emp.id)
    || (e.repondant === 'manager' && ctx.user.role === 'manager' && emp.id !== ctx.user.empId && ctx.d.mgrOf(emp) === ctx.user.empId));
  if (!sienne && !isRh(ctx)) throw new ActionError('Retrait réservé à l’auteur de l’avis et au service RH', 403);
  await ctx.db.remove('evaluationsFormation', e.id);
  return `Évaluation ${TYPE_EVALUATION_LABEL[e.type].toLowerCase()} retirée${e.repondant === 'manager' ? ' (avis du manager)' : ''}`;
};

export const evaluationsFormationActions = {
  'evaluation.enregistrer': enregistrer,
  'evaluation.retirer': retirer,
} satisfies Record<string, ActionHandler>;
