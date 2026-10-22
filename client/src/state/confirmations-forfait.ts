// Confirmation de l'annulation d'un avenant de renonciation d'un forfait jours (`forfait.annulerAvenant`, t043),
// affichée par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts). Motif obligatoire, lu par le service RH.
import { fJ, fmtIso } from '../../../shared/format.ts';
import type { AvenantForfait } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/**
 * Annulation d'un avenant : le plafond de l'année revient au forfait ; des jours rachetés déjà transmis à la paie se
 * régularisent dans Sage, ceux d'un lot dont l'import n'est pas confirmé exigent d'abord l'annulation du lot (refus du serveur).
 */
export function annulationAvenantForfait(a: Pick<AvenantForfait, 'id' | 'annee' | 'jours' | 'signeLe' | 'sage'>, nom: string): Confirmation {
  return {
    titre: 'Annuler l’avenant de renonciation',
    question: `Annuler l’avenant de renonciation ${a.annee} de ${nom} (${fJ(a.jours)} rachetés, signé le ${fmtIso(a.signeLe)}) ?`,
    suites: [
      `Le plafond ${a.annee} revient au forfait : les feuilles validées au-delà demanderont un motif.`,
      a.sage ? 'Les jours rachetés sont déjà transmis à la paie : la correction se fait dans Sage.' : 'Les jours rachetés ne partiront pas dans le prochain lot de paie.',
      'L’avenant reste sur la fiche, marqué annulé.',
    ],
    bouton: 'Annuler l’avenant',
    action: 'forfait.annulerAvenant',
    payload: { id: a.id },
    motif: { label: 'Motif de l’annulation', requis: true, aide: 'Le motif est gardé sur l’avenant, visible du service RH seulement.', placeholder: 'Avenant saisi par erreur, salarié revenu sur sa décision…' },
  };
}
