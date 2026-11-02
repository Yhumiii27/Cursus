// Confirmations du badgeage virtuel (lot 12, chantier C6, étape 2), affichées par dialogs/ConfirmerDialog.tsx (modèle :
// state/confirmations.ts) : refus d'une demande de correction de pointage par son valideur, motif obligatoire (lu par le
// salarié, jamais recopié au journal), et retrait d'une demande en attente.
import type { CorrectionPointage, ZonePointage } from '../../../shared/types.ts';
import { objetCorrection } from '../components/temps/pointage-etat.ts';
import type { Confirmation } from './confirmations.ts';

/** Refus d'une demande de correction : le salarié voit le refus et son motif dans ses pointages. */
export function refusCorrectionPointage(c: Pick<CorrectionPointage, 'id' | 'nature' | 'horodatage' | 'sens' | 'jour'>, nom: string): Confirmation {
  return {
    titre: 'Refuser la correction de pointage',
    question: `Refuser la demande de ${nom} : ${objetCorrection(c).toLowerCase()} ?`,
    suites: ['Les pointages ne changent pas.', `${nom} voit le refus et son motif dans ses pointages ; le motif n’est jamais recopié au journal.`],
    bouton: 'Refuser la demande',
    action: 'pointage.refuserCorrection',
    payload: { id: c.id },
    motif: {
      label: 'Motif du refus', requis: true, placeholder: 'Présence non constatée ce jour-là, pointage déjà présent…',
      aide: `Le motif est visible de ${nom} : n’y indiquez aucune information médicale (300 caractères au plus).`,
    },
  };
}

/** Retrait d'une demande en attente, par le salarié (`soi`) ou son valideur. */
export function retraitCorrectionPointage(c: Pick<CorrectionPointage, 'id' | 'nature' | 'horodatage' | 'sens' | 'jour'>, nom: string, soi: boolean): Confirmation {
  return {
    titre: 'Retirer la demande de correction',
    question: `Retirer ${soi ? 'votre demande' : `la demande de ${nom}`} : ${objetCorrection(c).toLowerCase()} ?`,
    suites: ['La demande reste visible comme retirée ; les pointages ne changent pas.'],
    bouton: 'Retirer la demande',
    action: 'pointage.annulerCorrection',
    payload: { id: c.id },
  };
}

/** Étape 3 : suppression d'une zone de la géolocalisation (administrateur RH) ; les verdicts déjà gardés restent. */
export function suppressionZonePointage(z: Pick<ZonePointage, 'id' | 'libelle'>): Confirmation {
  return {
    titre: 'Supprimer la zone de pointage',
    question: `Supprimer la zone « ${z.libelle} » ?`,
    suites: ['Les pointages déjà faits gardent leur verdict.', 'Sans zone active, la position n’est plus demandée au pointage.'],
    bouton: 'Supprimer la zone',
    action: 'pointage.zone.supprimer',
    payload: { id: z.id },
  };
}
