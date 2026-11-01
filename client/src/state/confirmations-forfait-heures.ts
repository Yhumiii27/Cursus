// Confirmations de la réouverture et de l'annulation d'une clôture du forfait annuel en heures (lot 12, chantier C1 :
// `forfaitHeures.rouvrir`, `forfaitHeures.annuler`, administrateur RH), affichées par dialogs/ConfirmerDialog.tsx (modèle :
// state/confirmations.ts). Motif obligatoire, lu par le service RH seul (ni la paie, ni le salarié, ni le journal).
import { fmtIso } from '../../../shared/format.ts';
import type { ClotureForfaitHeures } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

const plage = (l: Pick<ClotureForfaitHeures, 'debut' | 'fin'>) => `du ${fmtIso(l.debut)} au ${fmtIso(l.fin)}`;
const motif = (quoi: string, placeholder: string) => ({
  label: `Motif de ${quoi}`, requis: true, placeholder,
  aide: 'Le motif est gardé sur la ligne, visible du seul service RH (ni la paie, ni le salarié, ni le journal des actions) : n’y indiquez aucune information médicale.',
});

/**
 * Réouverture : avant transmission, la ligne repasse « à confirmer » et se recalcule à la prochaine clôture ; après, une
 * nouvelle version la remplace, dont seul l'écart partira (lot correctif). Une ligne dans un lot dont l'import n'est pas
 * confirmé est refusée par le serveur (annuler d'abord le lot).
 */
export function rouvertureClotureForfait(l: Pick<ClotureForfaitHeures, 'id' | 'debut' | 'fin' | 'version' | 'sage' | 'lotId'>, nom: string): Confirmation {
  return {
    titre: 'Rouvrir la clôture du forfait',
    question: `Rouvrir la clôture du forfait annuel en heures de ${nom} (${plage(l)}) ?`,
    suites: [
      l.sage
        ? `Les heures sont déjà transmises à la paie : une version ${l.version + 1} est créée, à confirmer ; seul son écart avec la version transmise partira, dans un lot correctif.`
        : l.lotId != null ? `Les heures sont dans le lot de paie n° ${l.lotId}, import à confirmer : annulez d’abord ce lot (écran Temps), sinon la réouverture est refusée.`
        : 'La ligne repasse « à confirmer » : elle sera recalculée à la prochaine clôture et ne partira pas dans le prochain lot de paie d’ici là.',
      'La réouverture est tracée au journal des actions, sans le motif ni aucune heure.',
    ],
    bouton: 'Rouvrir la clôture',
    action: 'forfaitHeures.rouvrir',
    payload: { id: l.id },
    motif: motif('la réouverture', 'Feuille de décembre corrigée, arrêt déclaré après la clôture…'),
  };
}

/** Annulation avant transmission (hors d'un lot) : la plage redevient à clôturer. */
export function annulationClotureForfait(l: Pick<ClotureForfaitHeures, 'id' | 'debut' | 'fin'>, nom: string): Confirmation {
  return {
    titre: 'Annuler la clôture du forfait',
    question: `Annuler la clôture du forfait annuel en heures de ${nom} (${plage(l)}) ?`,
    suites: [
      'Les heures ne partiront pas à la paie ; la plage redevient à clôturer.',
      'La ligne reste dans l’historique, marquée annulée ; l’annulation est tracée au journal des actions, sans le motif.',
    ],
    bouton: 'Annuler la clôture',
    action: 'forfaitHeures.annuler',
    payload: { id: l.id },
    motif: motif('l’annulation', 'Plage clôturée par erreur, sortie annulée…'),
  };
}
