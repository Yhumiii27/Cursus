// Confirmations des astreintes (t049, lot 7, étape 2 ; dialogs/ConfirmerDialog.tsx) : annulation d'une astreinte à venir,
// avec son motif (obligatoire, communiqué au salarié dans l'e-mail), et retrait d'une intervention déclarée par erreur.
import { fH, fmtIso } from '../../../shared/format.ts';
import { heureTexte, periodeAstreinteTexte } from '../../../shared/rules/astreintes.ts';
import type { Astreinte, InterventionAstreinte } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/** Annulation d'une astreinte pas encore commencée (`astreinte.annuler`) ; `nom` : le salarié d'astreinte. */
export function annulationAstreinte(a: Pick<Astreinte, 'id' | 'du' | 'debut' | 'au' | 'fin'>, nom: string): Confirmation {
  return {
    titre: 'Annuler l’astreinte',
    question: `Annuler l’astreinte de ${nom} ${periodeAstreinteTexte(a)} ?`,
    suites: [
      `${nom} reçoit un e-mail avec le motif et le fichier qui retire l’événement de son agenda.`,
      'L’astreinte reste au planning, marquée annulée ; une nouvelle astreinte se planifie avec son propre délai de prévenance.',
    ],
    bouton: 'Annuler l’astreinte',
    action: 'astreinte.annuler',
    payload: { id: a.id },
    motif: {
      label: 'Motif de l’annulation', requis: true,
      aide: `Le motif est communiqué à ${nom} et visible de son manager et du service RH ; il n’est jamais recopié au journal.`,
      placeholder: 'Remplacement trouvé, arrêt de l’installation…',
    },
  };
}

/** Retrait d'une intervention déclarée (`astreinte.retirerIntervention`) : ses heures quittent la feuille de temps. */
export function retraitIntervention(x: Pick<InterventionAstreinte, 'id' | 'jour' | 'debut' | 'fin' | 'heures'>, nom: string): Confirmation {
  return {
    titre: 'Retirer l’intervention',
    question: `Retirer l’intervention d’astreinte de ${nom} du ${fmtIso(x.jour)}, de ${heureTexte(x.debut)} à ${heureTexte(x.fin)} ?`,
    suites: [`Ses ${fH(x.heures)} sont retirées de la ligne « Intervention d’astreinte » de la feuille de temps.`],
    bouton: 'Retirer l’intervention',
    action: 'astreinte.retirerIntervention',
    payload: { id: x.id },
  };
}
