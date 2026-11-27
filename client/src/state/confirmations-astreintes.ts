// Confirmations des astreintes (t049, lot 7, étape 2 ; dialogs/ConfirmerDialog.tsx) : annulation d'une astreinte à venir,
// avec son motif (obligatoire, communiqué au salarié dans l'e-mail), et retrait d'une intervention déclarée par erreur.
import { fH, fmtIso } from '../../../shared/format.ts';
import { heureTexte, periodeAstreinteTexte } from '../../../shared/rules/astreintes.ts';
import type { Astreinte, InterventionAstreinte } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/** Annulation d'une astreinte pas encore commencée (`astreinte.annuler`) ; `nom` : le salarié d'astreinte. */
export function annulationAstreinte(a: Pick<Astreinte, 'id' | 'du' | 'debut' | 'au' | 'fin'>, nom: string): Confirmation {
  return {
    titre: t('Cancel the on-call duty'),
    question: `${t('Cancel the on-call duty of ')}${nom} ${periodeAstreinteTexte(a)}${t('?#question')}`,
    suites: [
      `${nom}${t(' receives an e-mail with the reason and the file that removes the event from their calendar.')}`,
      t('The on-call duty stays in the schedule, marked cancelled; a new on-call duty is planned with its own notice period.'),
    ],
    bouton: t('Cancel the on-call duty'),
    action: 'astreinte.annuler',
    payload: { id: a.id },
    motif: {
      label: t('Reason for the cancellation'), requis: true,
      aide: `${t('The reason is passed to ')}${nom}${t(' and visible to their manager and to HR; it is never copied into the log.')}`,
      placeholder: t('Replacement found, shutdown of the installation…'),
    },
  };
}

/** Retrait d'une intervention déclarée (`astreinte.retirerIntervention`) : ses heures quittent la feuille de temps. */
export function retraitIntervention(x: Pick<InterventionAstreinte, 'id' | 'jour' | 'debut' | 'fin' | 'heures'>, nom: string): Confirmation {
  return {
    titre: t('Remove the intervention'),
    question: `${t('Remove the on-call intervention of ')}${nom}${t(' of #du')}${fmtIso(x.jour)}${t(', from #de')}${heureTexte(x.debut)}${t(' to #a')}${heureTexte(x.fin)}${t('?#question')}`,
    suites: [`${t('Its #ses')}${fH(x.heures)}${t(' are removed from the “On-call intervention” line of the timesheet.')}`],
    bouton: t('Remove the intervention'),
    action: 'astreinte.retirerIntervention',
    payload: { id: x.id },
  };
}
