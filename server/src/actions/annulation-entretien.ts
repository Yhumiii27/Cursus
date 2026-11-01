// Annulation d'un entretien planifié (`entretien.annuler`) par l'évaluateur (manager direct) ou le service RH, jamais
// pour son propre entretien. L'entretien est retiré : l'obligation qu'il couvrait redevient « à planifier » (ou en
// retard). Un compte rendu commencé a pu servir à un entretien tenu : l'annulation, qui le supprime, n'est faite que
// sur confirmation (`confirmer`), comme celle d'un entretien qui porte des objectifs, des évaluations ou des souhaits de
// formation (lot 12). Le salarié reçoit l'annulation de l'événement de sa convocation (même UID).
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { crCommence } from '../../../shared/rules/entretiens.ts';
import { annulerConvocationEntretien } from '../notifications.ts';
// lot 12 — C3 (entretiens suivis)
import { saisiesSuivies } from '../../../shared/rules/objectifs.ts';
import { detacherEntretien, texteDetache } from '../objectifs-entretien.ts';
import { ActionError, type ActionHandler, getEmp, isValidatorOf, refuserSoiMeme } from './context.ts';

const annuler: ActionHandler = async (ctx, p) => {
  const x = ctx.ds.entretiens.find(y => y.id === Number(p.id));
  if (!x) throw new ActionError('Entretien introuvable', 404);
  const e = getEmp(ctx, x.empId);
  refuserSoiMeme(ctx, e, 'Vous ne pouvez pas annuler votre propre entretien');
  if (!isValidatorOf(ctx, e, 'entretiens')) throw new ActionError('Annulation réservée à l’évaluateur ou au service RH', 403);
  const nom = ENT_TYPES[x.type].nom;
  if (x.statut !== 'planifie') throw new ActionError(`${nom} déjà clos : il ne s’annule plus`, 409);
  if (crCommence(x) && p.confirmer !== true) {
    throw new ActionError(`${nom} du ${fmtIso(x.date)} au compte rendu commencé : s’il a eu lieu, clôturez-le ; sinon, confirmez l’annulation, qui supprime le compte rendu`, 409);
  }
  // lot 12 — C3 (entretiens suivis) : objectifs fixés, évaluations saisies et souhaits de formation seraient perdus de même.
  const saisies = saisiesSuivies(ctx.ds.objectifs ?? [], x);
  if (saisies.length && p.confirmer !== true) {
    throw new ActionError(`${nom} du ${fmtIso(x.date)} déjà préparé (${saisies.join(', ')}) : s’il a eu lieu, clôturez-le ; sinon, confirmez l’annulation, qui retire ces saisies`, 409);
  }
  // lot 12 — C3 (entretiens suivis) : objectifs fixés retirés, objectifs évalués rouverts, demandes versées détachées.
  const detache = await detacherEntretien(ctx, x);
  await ctx.db.remove('entretiens', x.id);
  // Date passée : l'événement d'agenda est derrière le salarié, rien à retirer.
  const prevenu = x.date < ctx.d.ti ? null : await annulerConvocationEntretien(ctx, e, x);
  const message = `${nom} du ${fmtIso(x.date)} annulé — ${e.nom}${prevenu === null ? '' : prevenu ? ' · annulation envoyée au salarié' : ' · à prévenir (aucune adresse e-mail)'}${texteDetache(detache)}`;
  return { message, result: detache };
};

export const annulationEntretienActions = {
  'entretien.annuler': annuler,
} satisfies Record<string, ActionHandler>;
