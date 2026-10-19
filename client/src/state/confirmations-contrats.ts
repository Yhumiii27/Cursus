// Confirmation de l'annulation d'un avenant programmé (`employe.annulerAvenant`, historique des contrats, t074),
// affichée par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import { fmtIso } from '../../../shared/format.ts';
import type { ContratHistorique } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/**
 * Annulation d'un avenant programmé à une date future, pas encore appliqué : la fiche garde son organisation du temps.
 * `regime` : libellé du régime programmé ; `actuel` : celui de la fiche, qui reste en vigueur.
 */
export function annulationAvenant(l: Pick<ContratHistorique, 'id' | 'effet'>, nom: string, regime: string, actuel: string): Confirmation {
  return {
    titre: 'Annuler l’avenant programmé',
    question: `Annuler l’avenant de ${nom} prévu au ${fmtIso(l.effet)} (${regime}) ?`,
    suites: [
      `L’organisation du temps reste ${actuel} : rien ne change sur la fiche à cette date.`,
      'Les feuilles de temps en brouillon des semaines suivantes reprennent ce régime. L’avenant reste dans l’historique, marqué annulé.',
    ],
    bouton: 'Annuler l’avenant',
    action: 'employe.annulerAvenant',
    payload: { id: l.id },
  };
}
