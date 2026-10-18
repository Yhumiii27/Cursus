// Hiérarchie des managers (t136) : équipe parente d'une équipe, dont le manager devient le responsable (N+1) du manager
// de l'équipe (shared/rules/hierarchie.ts). Les demandes déjà en attente de ce manager (congés, feuilles soumises,
// entretiens planifiés) changent alors de valideur : elles sont listées dans le message, le nouveau valideur en est
// prévenu par e-mail (ou dans son récapitulatif) et le journal garde leurs identifiants.
import { ABS_LABEL, ENT_TYPES } from '../../../shared/constants.ts';
import { isoWeek } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { controleParente, elementsRediriges, validationsCroisees, type ElementRedirige } from '../../../shared/rules/hierarchie.ts';
import type { Equipe } from '../../../shared/types.ts';
import { periodeLongue } from '../messagerie.ts';
import { notifier } from '../notifications.ts';
import { ActionError, type ActionHandler, type Ctx, requireRh, str } from './context.ts';

/** Élément redirigé, tel qu'il est décrit au nouveau valideur et dans le message (jamais la nature d'une absence de santé : seuls les congés se demandent). */
function decrire(ctx: Ctx, x: ElementRedirige): string {
  const nom = ctx.d.personName(x.empId);
  if (x.kind === 'absence') {
    const a = ctx.ds.absences.find(y => y.id === x.id);
    return `${nom} : demande de ${(a ? ABS_LABEL[a.type] : 'congés').toLowerCase()} ${periodeLongue(x.du, x.au)}`;
  }
  if (x.kind === 'feuille') return `${nom} : feuille de temps de la semaine ${isoWeek(x.week)}, soumise`;
  const e = ctx.ds.entretiens.find(y => y.id === x.id);
  return `${nom} : ${(e ? ENT_TYPES[e.type]?.nom ?? 'entretien' : 'entretien').toLowerCase()} planifié le ${fmtIso(x.date)}`;
}

/** Prévient chaque nouveau valideur (le service RH : 0) des éléments qui lui reviennent. */
function prevenir(ctx: Ctx, equipe: string, parente: string | null, elements: ElementRedirige[]) {
  for (const v of new Set(elements.map(x => x.apres))) {
    const siens = elements.filter(x => x.apres === v);
    notifier(ctx, v, {
      type: 'hierarchie.redirection',
      objet: `${plural(siens.length, 'demande en attente vous revient', 'demandes en attente vous reviennent')} — équipe ${equipe}`,
      texte: `${parente ? `L’équipe ${equipe} est désormais rattachée à l’équipe ${parente}` : `L’équipe ${equipe} n’est plus rattachée à une équipe parente`} : `
        + `ces éléments en attente relèvent maintenant de votre décision :\n${siens.map(x => `- ${decrire(ctx, x)}`).join('\n')}\nÀ traiter dans Cursus (Congés & absences, Temps de travail, Entretiens).`,
    });
  }
}

/**
 * `nom` (équipe), `parente` (nom de l'équipe parente ; null ou vide : aucune). Refus : équipe parente inconnue, boucle,
 * profondeur au-delà de PROFONDEUR_MAX, ou deux salariés qui deviendraient chacun le valideur de l'autre.
 */
const parente: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const equipes = ctx.ds.referentiels.equipes;
  const q = equipes.find(x => x.nom === p.nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  const cible = str(p.parente) || null;
  if (cible === (q.parente ?? null)) return 'Aucune modification à enregistrer';
  const refus = controleParente(equipes, q.nom, cible);
  if (refus) throw new ActionError(refus);
  const apres: Equipe[] = equipes.map(x => (x.nom === q.nom ? { ...x, parente: cible } : x));
  const avantCroisees = new Set(validationsCroisees(equipes, ctx.ds.employes));
  const croisee = validationsCroisees(apres, ctx.ds.employes).find(c => !avantCroisees.has(c));
  if (croisee) {
    const [a, b] = croisee.split('-').map(Number);
    throw new ActionError(`${ctx.d.personName(a)} et ${ctx.d.personName(b)} deviendraient chacun le valideur de l’autre : rangez d’abord leurs fiches dans la bonne équipe`);
  }
  const elements = elementsRediriges(ctx.ds, equipes, apres);
  ctx.db.update('equipes', q.nom, { parente: cible });
  prevenir(ctx, q.nom, cible, elements);
  const nouveaux = [...new Set(elements.map(x => x.apres))].map(v => ctx.d.mgrName(v));
  const suite = elements.length
    ? ` · ${plural(elements.length, 'élément en attente redirigé', 'éléments en attente redirigés')} vers ${nouveaux.join(', ')} (message envoyé ${nouveaux.length > 1 ? 'aux nouveaux valideurs' : 'au nouveau valideur'}) : ${elements.map(x => decrire(ctx, x)).join(' ; ')}`
    : '';
  return {
    message: `${cible ? `L’équipe ${q.nom} est rattachée à l’équipe ${cible}` : `L’équipe ${q.nom} n’a plus d’équipe parente`}${suite}`,
    result: { redirections: elements.map(({ kind, id, empId, avant, apres: v }) => ({ kind, id, empId, avant, apres: v })) },
  };
};

export const hierarchieActions: Record<string, ActionHandler> = {
  'equipe.parente': parente,
};
