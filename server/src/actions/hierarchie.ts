// Hiérarchie des managers (t136) : équipe parente d'une équipe, dont le manager devient le responsable (N+1) du manager
// de l'équipe (shared/rules/hierarchie.ts). Les demandes déjà en attente de ce manager (congés, feuilles soumises,
// entretiens planifiés) changent alors de valideur : elles sont listées dans le message, le nouveau valideur en est
// prévenu par e-mail (ou dans son récapitulatif) et le journal garde leurs identifiants.
// Le refus des validations croisées et l'avis au nouveau valideur servent aussi au changement de manager et aux
// affectations (actions/equipes.ts) : une fois la hiérarchie en place, ces actions changent elles aussi le valideur des
// managers des équipes rattachées.
import { ABS_LABEL, ENT_TYPES } from '../../../shared/constants.ts';
import { isoWeek } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { controleParente, croiseeNouvelle, elementsRediriges, type ElementRedirige } from '../../../shared/rules/hierarchie.ts';
import type { Employe, Equipe } from '../../../shared/types.ts';
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

/**
 * Prévient chaque nouveau valideur (le service RH : 0) des éléments qui lui reviennent. `equipe` : équipe nommée dans
 * l'objet ; `cause` : ce qui a changé (« L’équipe Maintenance est désormais rattachée à l’équipe Production »).
 */
export async function prevenir(ctx: Ctx, equipe: string, cause: string, elements: ElementRedirige[]) {
  for (const v of new Set(elements.map(x => x.apres))) {
    const siens = elements.filter(x => x.apres === v);
    await notifier(ctx, v, {
      type: 'hierarchie.redirection',
      objet: `${plural(siens.length, 'demande en attente vous revient', 'demandes en attente vous reviennent')} — équipe ${equipe}`,
      texte: `${cause} : ces éléments en attente relèvent maintenant de votre décision :\n${siens.map(x => `- ${decrire(ctx, x)}`).join('\n')}\n`
        + 'À traiter dans Cursus (Congés & absences, Temps de travail, Entretiens).',
    });
  }
}

/** Suite du message d'une action qui redirige des éléments en attente (vide s'il n'y en a aucun). */
export function suiteRedirection(ctx: Ctx, elements: ElementRedirige[]): string {
  if (!elements.length) return '';
  const nouveaux = [...new Set(elements.map(x => x.apres))].map(v => ctx.d.mgrName(v));
  return ` · ${plural(elements.length, 'élément en attente redirigé', 'éléments en attente redirigés')} vers ${nouveaux.join(', ')} `
    + `(message envoyé ${nouveaux.length > 1 ? 'aux nouveaux valideurs' : 'au nouveau valideur'}) : ${elements.map(x => decrire(ctx, x)).join(' ; ')}`;
}

/** Redirections rendues dans `result` et tracées au journal : type, identifiants, ancien et nouveau valideur. */
export const redirectionsResultat = (elements: ElementRedirige[]) => elements.map(({ kind, id, empId, avant, apres }) => ({ kind, id, empId, avant, apres }));

/**
 * Refus d'une modification (équipe parente, manager d'une équipe, affectation d'un salarié) qui ferait de deux salariés
 * chacun le valideur de l'autre. `apres` : équipes ou salariés après la modification (absent : inchangés).
 */
export function refuserCroisee(ctx: Ctx, apres: { equipes?: readonly Equipe[]; employes?: readonly Employe[] }) {
  const avant = { equipes: ctx.ds.referentiels.equipes, employes: ctx.ds.employes };
  const paire = croiseeNouvelle(avant, { equipes: apres.equipes ?? avant.equipes, employes: apres.employes ?? avant.employes });
  if (!paire) return;
  throw new ActionError(`${ctx.d.personName(paire[0])} et ${ctx.d.personName(paire[1])} deviendraient chacun le valideur de l’autre : rangez d’abord leurs fiches dans la bonne équipe`);
}

/**
 * `nom` (équipe), `parente` (nom de l'équipe parente ; null ou vide : aucune). Refus : équipe parente inconnue, boucle,
 * profondeur au-delà de PROFONDEUR_MAX, ou deux salariés qui deviendraient chacun le valideur de l'autre.
 */
const parente: ActionHandler = async (ctx, p) => {
  requireRh(ctx);
  const equipes = ctx.ds.referentiels.equipes;
  const q = equipes.find(x => x.nom === p.nom);
  if (!q) throw new ActionError('Équipe introuvable', 404);
  const cible = str(p.parente) || null;
  if (cible === (q.parente ?? null)) return 'Aucune modification à enregistrer';
  const refus = controleParente(equipes, q.nom, cible);
  if (refus) throw new ActionError(refus);
  const apres: Equipe[] = equipes.map(x => (x.nom === q.nom ? { ...x, parente: cible } : x));
  refuserCroisee(ctx, { equipes: apres });
  const elements = elementsRediriges(ctx.ds, equipes, apres);
  await ctx.db.update('equipes', q.nom, { parente: cible });
  await prevenir(ctx, q.nom, cible ? `L’équipe ${q.nom} est désormais rattachée à l’équipe ${cible}` : `L’équipe ${q.nom} n’est plus rattachée à une équipe parente`, elements);
  return {
    message: `${cible ? `L’équipe ${q.nom} est rattachée à l’équipe ${cible}` : `L’équipe ${q.nom} n’a plus d’équipe parente`}${suiteRedirection(ctx, elements)}`,
    result: { redirections: redirectionsResultat(elements) },
  };
};

export const hierarchieActions: Record<string, ActionHandler> = {
  'equipe.parente': parente,
};
