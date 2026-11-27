// Confirmations de la réouverture et de l'annulation d'une clôture du forfait annuel en heures (lot 12, chantier C1 :
// `forfaitHeures.rouvrir`, `forfaitHeures.annuler`, administrateur RH), affichées par dialogs/ConfirmerDialog.tsx (modèle :
// state/confirmations.ts). Motif obligatoire, lu par le service RH seul (ni la paie, ni le salarié, ni le journal).
import { fmtIso } from '../../../shared/format.ts';
import type { ClotureForfaitHeures } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

const plage = (l: Pick<ClotureForfaitHeures, 'debut' | 'fin'>) => `${t('from #du-min')}${fmtIso(l.debut)}${t(' to #au')}${fmtIso(l.fin)}`;
const motif = (label: string, placeholder: string) => ({
  label, requis: true, placeholder,
  aide: t('The reason is kept on the line, visible to HR only (not payroll, nor the employee, nor the action log): do not put any medical information in it.'),
});

/**
 * Réouverture : avant transmission, la ligne repasse « à confirmer » et se recalcule à la prochaine clôture ; après, une
 * nouvelle version la remplace, dont seul l'écart partira (lot correctif). Une ligne dans un lot dont l'import n'est pas
 * confirmé est refusée par le serveur (annuler d'abord le lot).
 */
export function rouvertureClotureForfait(l: Pick<ClotureForfaitHeures, 'id' | 'debut' | 'fin' | 'version' | 'sage' | 'lotId'>, nom: string): Confirmation {
  return {
    titre: t('Reopen the package closure'),
    question: `${t('Reopen the closure of the annual hours package of ')}${nom} (${plage(l)})${t('?#question')}`,
    suites: [
      l.sage
        ? `${t('The hours are already passed to payroll: a version ')}${l.version + 1}${t(' is created, to confirm; only its difference with the version passed will go, in a corrective batch.')}`
        : l.lotId != null ? `${t('The hours are in payroll batch no. ')}${l.lotId}${t(', import to confirm: cancel this batch first (Time screen), otherwise the reopening is refused.')}`
        : t('The line goes back to “to confirm”: it will be recalculated at the next closure and will not go in the next payroll batch until then.'),
      t('The reopening is traced in the action log, without the reason or any hours.'),
    ],
    bouton: t('Reopen the closure'),
    action: 'forfaitHeures.rouvrir',
    payload: { id: l.id },
    motif: motif(t('Reason for the reopening'), t('December timesheet corrected, sick leave declared after the closure…')),
  };
}

/** Annulation avant transmission (hors d'un lot) : la plage redevient à clôturer. */
export function annulationClotureForfait(l: Pick<ClotureForfaitHeures, 'id' | 'debut' | 'fin'>, nom: string): Confirmation {
  return {
    titre: t('Cancel the package closure'),
    question: `${t('Cancel the closure of the annual hours package of ')}${nom} (${plage(l)})${t('?#question')}`,
    suites: [
      t('The hours will not go to payroll; the period is to close again.'),
      t('The line stays in the history, marked cancelled; the cancellation is traced in the action log, without the reason.'),
    ],
    bouton: t('Cancel the closure'),
    action: 'forfaitHeures.annuler',
    payload: { id: l.id },
    motif: motif(t('Reason for the cancellation'), t('Period closed by mistake, departure cancelled…')),
  };
}

/**
 * Début du suivi ou de la période de référence déplacé alors que des clôtures sont enregistrées (Paramètres → Décompte des
 * heures) : les lignes sont repérées par leur début de plage, elles passent « à revoir » et les plages recalculées qui les
 * chevauchent restent bloquées (le serveur refuse le changement sans cette confirmation : `forfaitHeuresChangementConfirme`).
 */
export function changementDebutForfait(patch: Record<string, unknown>, lignes: number): Confirmation {
  return {
    titre: t('Change the start of the annual hours package'),
    question: `${t('Change the start of the tracking or of the reference period while ')}${lignes > 1 ? `${lignes}${t(' closures are recorded')}` : t('a closure is recorded')}${t('?#question')}`,
    suites: [
      t('The recorded closures keep their dates: those the change modifies go to “to review”.'),
      t('A recalculated period that overlaps a recorded closure stays blocked, so that its hours are never paid twice: restore the setting, or cancel the closure if it is not passed.'),
    ],
    bouton: t('Change the start'),
    action: 'parametres.maj',
    payload: { ...patch, forfaitHeuresChangementConfirme: true },
  };
}
