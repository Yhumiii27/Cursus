// Confirmation de la révocation d'une délégation des validations (t135, shared/rules/delegations-manager.ts), affichée par
// dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import { fmtIso } from '../../../shared/format.ts';
import type { DelegationValidation } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/** Révocation d'une délégation en cours ou à venir : elle cesse aussitôt, le suppléant en est prévenu. */
export function revocationDelegation(g: Pick<DelegationValidation, 'id' | 'du' | 'au'>, manager: string, suppleant: string, enCours: boolean): Confirmation {
  return {
    titre: t('Revoke the delegation'),
    question: `${t('Revoke the delegation of the approvals of ')}${manager}${t(' to #a')}${suppleant} (${t('from #du-min')}${fmtIso(g.du)}${t(' to #au')}${fmtIso(g.au)})${t('?#question')}`,
    suites: [
      enCours ? `${suppleant}${t(' no longer decides on the team’s requests from now on; those pending go back to ')}${manager}.` : t('It will not start.'),
      `${suppleant}${t(' is notified by e-mail. The decisions already taken by delegation remain valid.')}`,
    ],
    bouton: t('Revoke the delegation'),
    action: 'equipe.revoquerDelegation',
    payload: { id: g.id },
  };
}
