// Confirmations des annulations d'un déplacement (`voyage.annuler`) et d'un entretien planifié (`entretien.annuler`),
// affichées par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import type { Entretien, Voyage } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/**
 * Annulation d'un déplacement par le service RH. `quoi` : « Maroc du 2 nov. au 6 nov. 2026 ». Venu de Keystone : motif
 * obligatoire, Keystone prévenu sans le motif ; sinon motif facultatif. Le motif reste dans Cursus (service RH ; le
 * salarié le retrouve dans la copie de ses données, au titre du droit d'accès).
 */
export function annulationVoyage(v: Pick<Voyage, 'id' | 'origine' | 'chantier'>, nom: string, quoi: string): Confirmation {
  const keystone = v.origine === 'keystone';
  // Chaînes sources anglaises (CU-N01), comme l'écran Voyages qui l'ouvre.
  return {
    titre: t('Cancel the trip'),
    question: `${t('Cancel the trip of ')}${nom} : ${quoi} ?`,
    suites: [
      t('The trip stays in the history (Trips screen), but no longer counts: file to prepare, Go / No Go, date conflicts and due dates.'),
      keystone ? `${t('Keystone is told of the cancellation (worksite ')}${v.chantier}${t('), without the reason.')}` : '',
      t('The cancellation is final: a new trip is created if needed.'),
    ].filter(Boolean),
    bouton: t('Cancel the trip'),
    action: 'voyage.annuler',
    payload: { id: v.id },
    motif: {
      label: t('Reason for the cancellation'), requis: keystone,
      aide: t('The reason stays in Cursus: never sent to Keystone nor shown to the manager; the employee can read it in the copy of their data (right of access). Do not put any medical information in it.'),
      placeholder: t('Worksite postponed, assignment given to another technician…'),
    },
    ensuite: { ui: { tripSel: null } },
  };
}

/**
 * Annulation d'un entretien planifié par l'évaluateur ou le service RH : l'obligation redevient à planifier, le salarié
 * reçoit l'annulation de l'événement d'agenda (date à venir). Un compte rendu commencé est supprimé avec l'entretien (`confirmer`).
 */
export function annulationEntretien(x: Pick<Entretien, 'id' | 'type' | 'date'>, nom: string, o: { crCommence: boolean; passe: boolean; saisies?: string[] }): Confirmation {
  // lot 12 — C3 : objectifs, évaluations et souhaits de formation portés par l'entretien (`saisiesSuivies`), retirés avec lui.
  const saisies = o.saisies ?? [];
  const type = ENT_TYPES[x.type].nom;
  return {
    titre: 'Annuler l’entretien',
    question: `Annuler l’${type.charAt(0).toLowerCase()}${type.slice(1)} de ${nom} prévu le ${fmtIso(x.date)} ?`,
    suites: [
      o.crCommence ? 'Le compte rendu déjà commencé est supprimé avec l’entretien. S’il a eu lieu, fermez plutôt ce dialogue et clôturez-le.' : '',
      saisies.length ? `Retirés avec l’entretien : ${saisies.join(', ')} (les objectifs évalués redeviennent en cours).` : '',
      o.passe ? '' : `${nom} reçoit l’annulation de sa convocation (événement retiré de son agenda).`,
      'L’échéance qu’il couvrait redevient à planifier.',
    ].filter(Boolean),
    bouton: 'Annuler l’entretien',
    action: 'entretien.annuler',
    // `confirmer` seulement si la confirmation a annoncé la suppression d'un compte rendu commencé : sinon, un compte rendu
    // écrit depuis la dernière relecture (le salarié rédige au fil) fait refuser l'annulation (409), affichée dans le dialogue.
    payload: { id: x.id, ...(o.crCommence || saisies.length ? { confirmer: true } : {}) },
  };
}
