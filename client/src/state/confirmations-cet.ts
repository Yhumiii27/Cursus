// lot 13 — CET (monétisation) : confirmations de la décision du service RH et de l'annulation d'une demande de
// monétisation du compte épargne-temps, affichées par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
// Les contrôles (solde, origine des jours, plafond de l'année) sont refaits par le serveur à la validation.
import { fJ } from '../../../shared/format.ts';
import { periodeMonetisation } from '../../../shared/rules/cet-monetisation.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import type { MonetisationCet } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

type Demande = Pick<MonetisationCet, 'id' | 'jours' | 'statut' | 'lotId' | 'sage'>;

/** Validation : les jours partent dans le lot de paie de la période ouverte (rubrique CET_MON). */
export function validationMonetisationCet(m: Demande, nom: string, today: string, clotureJour: number): Confirmation {
  return {
    // Chaînes sources anglaises (CU-N01), comme l'écran Congés & absences qui les ouvre.
    titre: t('Approve the cash-in'),
    question: `${t('Approve the cash-in of ')}${fJ(m.jours)}${t(' of the time savings account of ')}${nom} ?`,
    suites: [
      `${t('The days are deducted from the time savings account and go to the payroll of ')}${periodeLabel(periodeMonetisation(today, today, clotureJour))}${t(' under the item CET_MON; Sage calculates the amount.')}`,
      t('As long as the item CET_MON is deactivated, they are listed “to enter in Sage” in the summary of the batch.'),
    ],
    bouton: t('Approve the cash-in'),
    action: 'cet.monetisation.valider',
    payload: { id: m.id },
  };
}

/** Refus : motif obligatoire, remis au salarié. */
export function refusMonetisationCet(m: Demande, nom: string): Confirmation {
  return {
    titre: t('Refuse the cash-in'),
    question: `${t('Refuse the cash-in of ')}${fJ(m.jours)}${t(' of the time savings account of ')}${nom} ?`,
    suites: [t('The days stay on the time savings account.')],
    bouton: t('Refuse'),
    action: 'cet.monetisation.refuser',
    payload: { id: m.id },
    motif: { label: t('Reason for the refusal'), requis: true, aide: t('The reason is shown to the employee with their request; never to their manager.'), placeholder: t('Cap of the agreement reached, request outside the planned window…') },
  };
}

/**
 * Annulation : l'intéressé retire sa demande en attente (motif facultatif) ; le service RH annule une demande en attente
 * ou validée hors de tout lot de paie (motif obligatoire).
 */
export function annulationMonetisationCet(m: Demande, nom: string, parLeSalarie: boolean): Confirmation {
  return {
    titre: t(parLeSalarie ? 'Withdraw the cash-in request' : 'Cancel the cash-in'),
    question: parLeSalarie
      ? `${t('Withdraw your cash-in request of ')}${fJ(m.jours)}${t(' of the time savings account?')}`
      : `${t('Cancel the cash-in of ')}${fJ(m.jours)}${t(' of the time savings account of ')}${nom} ?`,
    suites: [
      m.statut === 'validee' ? t('The days come back on the time savings account and will not go in the next payroll batch.') : t('The days stay on the time savings account.'),
      t('The request stays in the history, marked cancelled.'),
    ],
    bouton: t(parLeSalarie ? 'Withdraw the request' : 'Cancel the cash-in'),
    action: 'cet.monetisation.annuler',
    payload: { id: m.id },
    motif: parLeSalarie
      ? { label: t('Reason (optional)'), requis: false, aide: t('The reason is kept with the request, read by HR.') }
      : { label: t('Reason for the cancellation'), requis: true, aide: t('The reason is shown to the employee with their request; never to their manager.'), placeholder: t('Approved by mistake, employee went back on their request…') },
  };
}
