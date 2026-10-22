// Confirmation de la révocation d'une délégation des validations (t135, shared/rules/delegations-manager.ts), affichée par
// dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import { fmtIso } from '../../../shared/format.ts';
import type { DelegationValidation } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/** Révocation d'une délégation en cours ou à venir : elle cesse aussitôt, le suppléant en est prévenu. */
export function revocationDelegation(g: Pick<DelegationValidation, 'id' | 'du' | 'au'>, manager: string, suppleant: string, enCours: boolean): Confirmation {
  return {
    titre: 'Révoquer la délégation',
    question: `Révoquer la délégation des validations de ${manager} à ${suppleant} (du ${fmtIso(g.du)} au ${fmtIso(g.au)}) ?`,
    suites: [
      enCours ? `${suppleant} ne décide plus des demandes de l’équipe à partir de maintenant ; celles en attente reviennent à ${manager}.` : 'Elle ne commencera pas.',
      `${suppleant} en est prévenu par e-mail. Les décisions déjà prises par délégation restent valables.`,
    ],
    bouton: 'Révoquer la délégation',
    action: 'equipe.revoquerDelegation',
    payload: { id: g.id },
  };
}
