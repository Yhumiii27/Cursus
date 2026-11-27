// lot 12 — C3 (entretiens suivis) : confirmations des retraits faits hors d'un dialogue de saisie (state/confirmations.ts) :
// le salarié retire sa proposition d'objectif tant que l'entretien est planifié (`objectif.retirer`). `retour` : compte
// rendu d'où le retrait est lancé, rouvert ensuite.
import type { Objectif } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

export function retraitProposition(o: Pick<Objectif, 'id'>, retour?: number): Confirmation {
  return {
    titre: t('Withdraw the proposal'),
    question: t('Withdraw your objective proposal?'),
    suites: [t('It is deleted from the review; you can propose another one as long as it is not closed.')],
    bouton: t('Withdraw'),
    action: 'objectif.retirer',
    payload: { id: o.id },
    ...(retour ? { ensuite: { retour: { type: 'ent', entId: retour } } } : {}),
  };
}
