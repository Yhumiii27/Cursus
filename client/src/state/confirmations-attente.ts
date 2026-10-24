// Confirmation du retrait d'une liste d'attente de session (lot 7, chantier C, t120 ; server/src/liste-attente.ts),
// affichée par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import type { Confirmation } from './confirmations.ts';
import type { DialogState } from './store.tsx';

/**
 * Retrait de la liste d'attente. `nom` : salarié ; `quoi` : « SST du 18 nov. 2026 » ; `soi` : le salarié se retire
 * lui-même ; `proposee` : une place lui était proposée, qui passe au suivant ; `retour` : dialogue rouvert ensuite.
 */
export function retraitAttente(a: { id: number }, nom: string, quoi: string, opts: { soi: boolean; proposee: boolean; retour?: DialogState }): Confirmation {
  return {
    titre: 'Retirer de la liste d’attente',
    question: opts.soi ? `Vous retirer de la liste d’attente de la session ${quoi} ?` : `Retirer ${nom} de la liste d’attente de la session ${quoi} ?`,
    suites: [
      opts.soi ? 'Vous perdez votre place dans la file : pour y revenir, une nouvelle demande vous mettra en fin de liste.'
        : `${nom} perd sa place dans la file et en est prévenu par e-mail ; sa demande le dit.`,
      opts.proposee ? 'La place libérée qui lui était proposée passe au suivant de la liste.' : '',
    ].filter(Boolean),
    bouton: 'Retirer de la liste',
    action: 'attente.retirer',
    payload: { id: a.id },
    ...(opts.retour ? { ensuite: { retour: opts.retour } } : {}),
  };
}
