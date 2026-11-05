// lot 13 — CET (monétisation) : confirmations de la décision du service RH et de l'annulation d'une demande de
// monétisation du compte épargne-temps, affichées par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
// Les contrôles (solde, origine des jours, plafond de l'année) sont refaits par le serveur à la validation.
import { fJ } from '../../../shared/format.ts';
import { periodeMonetisation } from '../../../shared/rules/cet-monetisation.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import type { MonetisationCet } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

type Demande = Pick<MonetisationCet, 'id' | 'jours' | 'statut' | 'lotId' | 'sage'>;

/** Validation : les jours partent dans le lot de paie de la période ouverte (rubrique CET_MON). */
export function validationMonetisationCet(m: Demande, nom: string, today: string, clotureJour: number): Confirmation {
  return {
    titre: 'Valider la monétisation',
    question: `Valider la monétisation de ${fJ(m.jours)} du compte épargne-temps de ${nom} ?`,
    suites: [
      `Les jours sont déduits du compte épargne-temps et partent à la paie de ${periodeLabel(periodeMonetisation(today, today, clotureJour))} sous la rubrique CET_MON ; Sage calcule le montant.`,
      'Tant que la rubrique CET_MON est désactivée, ils sont listés « à saisir dans Sage » dans le résumé du lot.',
    ],
    bouton: 'Valider la monétisation',
    action: 'cet.monetisation.valider',
    payload: { id: m.id },
  };
}

/** Refus : motif obligatoire, remis au salarié. */
export function refusMonetisationCet(m: Demande, nom: string): Confirmation {
  return {
    titre: 'Refuser la monétisation',
    question: `Refuser la monétisation de ${fJ(m.jours)} du compte épargne-temps de ${nom} ?`,
    suites: ['Les jours restent sur le compte épargne-temps.'],
    bouton: 'Refuser',
    action: 'cet.monetisation.refuser',
    payload: { id: m.id },
    motif: { label: 'Motif du refus', requis: true, aide: 'Le motif est montré au salarié avec sa demande ; jamais à son manager.', placeholder: 'Plafond de l’accord atteint, demande hors de la fenêtre prévue…' },
  };
}

/**
 * Annulation : l'intéressé retire sa demande en attente (motif facultatif) ; le service RH annule une demande en attente
 * ou validée hors de tout lot de paie (motif obligatoire).
 */
export function annulationMonetisationCet(m: Demande, nom: string, parLeSalarie: boolean): Confirmation {
  return {
    titre: parLeSalarie ? 'Retirer la demande de monétisation' : 'Annuler la monétisation',
    question: parLeSalarie
      ? `Retirer votre demande de monétisation de ${fJ(m.jours)} du compte épargne-temps ?`
      : `Annuler la monétisation de ${fJ(m.jours)} du compte épargne-temps de ${nom} ?`,
    suites: [
      m.statut === 'validee' ? 'Les jours reviennent sur le compte épargne-temps et ne partiront pas dans le prochain lot de paie.' : 'Les jours restent sur le compte épargne-temps.',
      'La demande reste dans l’historique, marquée annulée.',
    ],
    bouton: parLeSalarie ? 'Retirer la demande' : 'Annuler la monétisation',
    action: 'cet.monetisation.annuler',
    payload: { id: m.id },
    motif: parLeSalarie
      ? { label: 'Motif (facultatif)', requis: false, aide: 'Le motif est gardé avec la demande, lu par le service RH.' }
      : { label: 'Motif de l’annulation', requis: true, aide: 'Le motif est montré au salarié avec sa demande ; jamais à son manager.', placeholder: 'Validée par erreur, salarié revenu sur sa demande…' },
  };
}
