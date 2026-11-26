// lot 11 — notes de frais (étape 2) : confirmations des renvois, refus et actions irréversibles, affichées par
// dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts). Un motif reste sur la note ou la dépense, lu par le
// salarié, son valideur et le contrôleur ; jamais recopié au journal ni dans un e-mail (server/src/journal.ts).
import type { AvanceFrais, LigneFrais, NoteFrais } from '../../../shared/types.ts';
import { CATEGORIES_FRAIS } from '../../../shared/rules/frais.ts';
import { euros, nomNote } from '../components/frais/commun.ts';
import type { Confirmation } from './confirmations.ts';
import { t, tn } from '../i18n/langue.ts';

const AIDE = (lecteurs: string) => `${t('The reason is visible to ')}${lecteurs}${t('; it is neither copied into the log nor sent by e-mail. Do not put any medical information in it.')}`;

/** Renvoi pour correction (`frais.note.renvoyer`) : par le valideur (note soumise) ou le contrôleur (validée, contrôlée). */
export function renvoiNote(n: NoteFrais, nom: string, parControleur: boolean): Confirmation {
  return {
    titre: t('Send back for correction'),
    question: `${t('Send back the ')}${nomNote(n).toLowerCase()}${t(' of #de')}${nom}${t(' for correction?')}`,
    suites: [
      t('The note becomes editable again by the employee, who will submit it again.'),
      parControleur ? t('It will go through the manager’s approval again.') : t('The employee is told by e-mail, without the reason.'),
    ],
    bouton: t('Send back the note'),
    action: 'frais.note.renvoyer',
    payload: { id: n.id },
    motif: { label: t('Reason for sending back'), requis: true, aide: AIDE(`${nom}${t(', of their manager and of the checker')}`), placeholder: t('Supporting document unreadable, date to correct…') },
  };
}

/** Refus d'une dépense au contrôle (`frais.ligne.refuser`). */
export function refusDepense(l: LigneFrais, nom: string): Confirmation {
  return {
    titre: t('Refuse the expense'),
    question: `${t('Refuse the expense of #du')}${l.date} (${CATEGORIES_FRAIS[l.categorie].label.toLowerCase()}, ${euros(l.montantEur)})${t(' of #de')}${nom}${t('?#question')}`,
    suites: [t('It stays in the note, without being reimbursed; the employee reads the reason in My expenses.')],
    bouton: t('Refuse the expense'),
    action: 'frais.ligne.refuser',
    payload: { id: l.id },
    motif: { label: t('Reason for the refusal'), requis: true, aide: AIDE(nom), placeholder: t('Personal expense, already reimbursed…') },
  };
}

/** Annulation d'une note (`frais.note.annuler`) : l'intéressé avant la validation, le service RH avant le paiement. */
export function annulationNote(n: NoteFrais, nom: string | null): Confirmation {
  return {
    titre: t('Cancel the note'),
    question: `${t('Cancel the #la')}${nomNote(n).toLowerCase()}${nom ? `${t(' of #de')}${nom}` : ''}${t('?#question')}`,
    suites: [t('The note stays in the base, cancelled: its expenses will not be reimbursed. An expense is entered again in another note.')],
    bouton: t('Cancel the note'),
    action: 'frais.note.annuler',
    payload: { id: n.id },
    motif: { label: t('Reason for the cancellation'), requis: false, aide: AIDE(nom ?? t('you')), placeholder: t('Duplicate note, trip cancelled…') },
  };
}

/** Suppression d'une dépense d'une note en saisie (`frais.ligne.supprimer`) : ses justificatifs sont retirés. */
export function suppressionDepense(l: LigneFrais): Confirmation {
  return {
    titre: t('Remove the expense'),
    question: `${t('Remove the expense of #du')}${l.date} (${CATEGORIES_FRAIS[l.categorie].label.toLowerCase()}, ${euros(l.montant, l.devise)})${t(' from the note?')}`,
    suites: [t('Its supporting documents are removed too.')],
    bouton: t('Remove the expense'),
    action: 'frais.ligne.supprimer',
    payload: { id: l.id },
  };
}

/** Refus d'une avance (`frais.avance.refuser`). */
export function refusAvance(a: AvanceFrais, nom: string): Confirmation {
  return {
    titre: t('Refuse the advance'),
    question: `${t('Refuse the advance of ')}${euros(a.montant)}${t(' requested by #fem')}${nom}${t('?#question')}`,
    bouton: t('Refuse the advance'),
    action: 'frais.avance.refuser',
    payload: { id: a.id },
    motif: { label: t('Reason for the refusal'), requis: true, aide: AIDE(nom), placeholder: t('Trip cancelled, amount to review…') },
  };
}

/** Annulation d'un export comptable (`frais.export.annuler`). `telecharge` : son fichier a déjà été téléchargé. */
export function annulationExport(id: number, notes: number, telecharge: boolean): Confirmation {
  return {
    titre: t('Cancel the accounting export'),
    question: `${t('Cancel the accounting export no. ')}${id} (${tn(notes, 'note', 'notes')})${t('?#question')}`,
    suites: [
      t('Its notes are to export again and will go in the next export.'),
      telecharge ? t('Its file has already been downloaded: remove from the accounts the entries already imported.') : t('Its file has not been downloaded.'),
    ],
    bouton: t('Cancel the export'),
    action: 'frais.export.annuler',
    payload: { id },
  };
}
