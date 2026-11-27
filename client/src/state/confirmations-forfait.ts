// Confirmation de l'annulation d'un avenant de renonciation d'un forfait jours (`forfait.annulerAvenant`, t043),
// affichée par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts). Motif obligatoire, lu par le service RH.
import { fJ, fmtIso } from '../../../shared/format.ts';
import type { AvenantForfait } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/**
 * Annulation d'un avenant : le plafond de l'année revient au forfait ; des jours rachetés déjà transmis à la paie se
 * régularisent dans Sage, ceux d'un lot dont l'import n'est pas confirmé exigent d'abord l'annulation du lot (refus du serveur).
 */
export function annulationAvenantForfait(a: Pick<AvenantForfait, 'id' | 'annee' | 'jours' | 'signeLe' | 'sage' | 'lotId'>, nom: string): Confirmation {
  return {
    titre: t('Cancel the waiver amendment'),
    question: `${t('Cancel the waiver amendment ')}${a.annee}${t(' of #de-name')}${nom} (${fJ(a.jours)}${t(' bought back')}${t(', signed on ')}${fmtIso(a.signeLe)})${t('?#question')}`,
    suites: [
      `${t('The ceiling ')}${a.annee}${t(' goes back to the package: the timesheets approved beyond will require a reason.')}`,
      a.sage ? t('The days bought back are already passed to payroll: the correction is made in Sage.')
        : a.lotId != null ? `${t('The days bought back are in payroll batch no. ')}${a.lotId}${t(', import to confirm: cancel this batch first (Time screen).')}`
        : t('The days bought back will not go in the next payroll batch.'),
      t('The amendment stays on the sheet, marked cancelled.'),
    ],
    bouton: t('Cancel the amendment'),
    action: 'forfait.annulerAvenant',
    payload: { id: a.id },
    motif: { label: t('Reason for the cancellation'), requis: true, aide: t('The reason is kept on the amendment, visible to HR, given to the employee in the copy of their data.'), placeholder: t('Amendment entered by mistake, employee changed their mind…') },
  };
}
