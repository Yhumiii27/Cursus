// lot 12 — C3 (entretiens suivis) : confirmations des retraits faits hors d'un dialogue de saisie (state/confirmations.ts) :
// le salarié retire sa proposition d'objectif tant que l'entretien est planifié (`objectif.retirer`). `retour` : compte
// rendu d'où le retrait est lancé, rouvert ensuite.
import type { Objectif } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

export function retraitProposition(o: Pick<Objectif, 'id'>, retour?: number): Confirmation {
  return {
    titre: 'Retirer la proposition',
    question: 'Retirer votre proposition d’objectif ?',
    suites: ['Elle est supprimée de l’entretien ; vous pourrez en proposer une autre tant qu’il n’est pas clos.'],
    bouton: 'Retirer',
    action: 'objectif.retirer',
    payload: { id: o.id },
    ...(retour ? { ensuite: { retour: { type: 'ent', entId: retour } } } : {}),
  };
}
