// Confirmation de l'annulation d'un avenant programmé (`employe.annulerAvenant`, historique des contrats, t074),
// affichée par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import { fmtIso } from '../../../shared/format.ts';
import type { ContratHistorique } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/**
 * Annulation d'un avenant programmé à une date future, pas encore appliqué : la fiche garde son organisation du temps.
 * `regime` : libellé du régime programmé ; `actuel` : celui de la fiche, qui reste en vigueur.
 */
export function annulationAvenant(l: Pick<ContratHistorique, 'id' | 'effet'>, nom: string, regime: string, actuel: string): Confirmation {
  return {
    titre: t('Cancel the scheduled amendment'),
    question: `${t('Cancel the amendment of ')}${nom}${t(' planned for ')}${fmtIso(l.effet)} (${regime})${t('?#question')}`,
    suites: [
      `${t('The working time arrangement stays ')}${actuel}${t(': nothing changes on the sheet at this date.')}`,
      t('The draft timesheets of the following weeks take this arrangement again. The amendment stays in the history, marked cancelled.'),
    ],
    bouton: t('Cancel the amendment'),
    action: 'employe.annulerAvenant',
    payload: { id: l.id },
  };
}
