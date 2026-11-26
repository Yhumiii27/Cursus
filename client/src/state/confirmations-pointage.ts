// Confirmations du badgeage virtuel (lot 12, chantier C6, étape 2), affichées par dialogs/ConfirmerDialog.tsx (modèle :
// state/confirmations.ts) : refus d'une demande de correction de pointage par son valideur, motif obligatoire (lu par le
// salarié, jamais recopié au journal), et retrait d'une demande en attente.
import type { CorrectionPointage, ZonePointage } from '../../../shared/types.ts';
import { objetCorrection } from '../components/temps/pointage-etat.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/** Refus d'une demande de correction : le salarié voit le refus et son motif dans ses pointages. */
export function refusCorrectionPointage(c: Pick<CorrectionPointage, 'id' | 'nature' | 'horodatage' | 'sens' | 'jour'>, nom: string): Confirmation {
  return {
    titre: t('Refuse the clock-in correction'),
    question: `${t('Refuse the request of ')}${nom} : ${objetCorrection(c).toLowerCase()} ?`,
    suites: [t('The clock-ins do not change.'), `${nom}${t(' sees the refusal and its reason in their clock-ins; the reason is never copied to the log.')}`],
    bouton: t('Refuse the request'),
    action: 'pointage.refuserCorrection',
    payload: { id: c.id },
    motif: {
      label: t('Reason for the refusal'), requis: true, placeholder: t('Presence not observed that day, clock-in already there…'),
      aide: `${t('The reason is visible to ')}${nom}${t(': do not put any medical information in it (300 characters at most).')}`,
    },
  };
}

/** Retrait d'une demande en attente, par le salarié (`soi`) ou son valideur. */
export function retraitCorrectionPointage(c: Pick<CorrectionPointage, 'id' | 'nature' | 'horodatage' | 'sens' | 'jour'>, nom: string, soi: boolean): Confirmation {
  return {
    titre: t('Withdraw the correction request'),
    question: `${soi ? t('Withdraw your request') : `${t('Withdraw the request of ')}${nom}`} : ${objetCorrection(c).toLowerCase()} ?`,
    suites: [t('The request stays visible as withdrawn; the clock-ins do not change.')],
    bouton: t('Withdraw the request'),
    action: 'pointage.annulerCorrection',
    payload: { id: c.id },
  };
}

/** Étape 3 : suppression d'une zone de la géolocalisation (administrateur RH) ; les verdicts déjà gardés restent. */
export function suppressionZonePointage(z: Pick<ZonePointage, 'id' | 'libelle'>): Confirmation {
  return {
    titre: t('Delete the clock-in zone'),
    question: `${t('Delete the zone ')}« ${z.libelle} » ?`,
    suites: [t('Clock-ins already made keep their verdict.'), t('Without an active zone, the position is no longer asked at clock-in.')],
    bouton: t('Delete the zone'),
    action: 'pointage.zone.supprimer',
    payload: { id: z.id },
  };
}
