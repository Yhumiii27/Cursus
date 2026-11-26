// Confirmation du retrait d'une liste d'attente de session (lot 7, chantier C, t120 ; server/src/liste-attente.ts),
// affichée par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import type { Confirmation } from './confirmations.ts';
import type { DialogState } from './store.tsx';
import { t } from '../i18n/langue.ts';

/**
 * Retrait de la liste d'attente. `nom` : salarié ; `quoi` : « SST du 18 nov. 2026 » ; `soi` : le salarié se retire
 * lui-même ; `proposee` : une place lui était proposée, qui passe au suivant ; `retour` : dialogue rouvert ensuite.
 */
export function retraitAttente(a: { id: number }, nom: string, quoi: string, opts: { soi: boolean; proposee: boolean; retour?: DialogState }): Confirmation {
  return {
    titre: t('Remove from the waiting list'),
    question: opts.soi ? `${t('Remove yourself from the waiting list of the session ')}${quoi} ?` : `${t('Remove#person')} ${nom}${t(' from the waiting list of the session ')}${quoi} ?`,
    suites: [
      opts.soi ? t('You lose your place in the queue: to come back, a new request will put you at the end of the list.')
        : `${nom}${t(' loses their place in the queue and is told by e-mail; their request says so.')}`,
      opts.proposee ? t('The freed place that was offered to them goes to the next on the list.') : '',
    ].filter(Boolean),
    bouton: t('Remove from the list'),
    action: 'attente.retirer',
    payload: { id: a.id },
    ...(opts.retour ? { ensuite: { retour: opts.retour } } : {}),
  };
}
