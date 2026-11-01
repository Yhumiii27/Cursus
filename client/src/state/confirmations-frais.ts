// lot 11 — notes de frais (étape 2) : confirmations des renvois, refus et actions irréversibles, affichées par
// dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts). Un motif reste sur la note ou la dépense, lu par le
// salarié, son valideur et le contrôleur ; jamais recopié au journal ni dans un e-mail (server/src/journal.ts).
import type { AvanceFrais, LigneFrais, NoteFrais } from '../../../shared/types.ts';
import { CATEGORIES_FRAIS } from '../../../shared/rules/frais.ts';
import { euros, nomNote } from '../components/frais/commun.ts';
import type { Confirmation } from './confirmations.ts';

const AIDE = (lecteurs: string) => `Le motif est visible de ${lecteurs} ; il n’est ni recopié au journal ni envoyé par e-mail. N’y indiquez aucune information médicale.`;

/** Renvoi pour correction (`frais.note.renvoyer`) : par le valideur (note soumise) ou le contrôleur (validée, contrôlée). */
export function renvoiNote(n: NoteFrais, nom: string, parControleur: boolean): Confirmation {
  return {
    titre: 'Renvoyer pour correction',
    question: `Renvoyer la ${nomNote(n).toLowerCase()} de ${nom} pour correction ?`,
    suites: [
      'La note redevient modifiable par le salarié, qui la soumettra de nouveau.',
      parControleur ? 'Elle repassera par la validation du manager.' : 'Le salarié est prévenu par e-mail, sans le motif.',
    ],
    bouton: 'Renvoyer la note',
    action: 'frais.note.renvoyer',
    payload: { id: n.id },
    motif: { label: 'Motif du renvoi', requis: true, aide: AIDE(`${nom}, de son manager et du contrôleur`), placeholder: 'Justificatif illisible, date à corriger…' },
  };
}

/** Refus d'une dépense au contrôle (`frais.ligne.refuser`). */
export function refusDepense(l: LigneFrais, nom: string): Confirmation {
  return {
    titre: 'Refuser la dépense',
    question: `Refuser la dépense du ${l.date} (${CATEGORIES_FRAIS[l.categorie].label.toLowerCase()}, ${euros(l.montantEur)}) de ${nom} ?`,
    suites: ['Elle reste dans la note, sans être remboursée ; le salarié lit le motif dans Mes frais.'],
    bouton: 'Refuser la dépense',
    action: 'frais.ligne.refuser',
    payload: { id: l.id },
    motif: { label: 'Motif du refus', requis: true, aide: AIDE(nom), placeholder: 'Dépense personnelle, déjà remboursée…' },
  };
}

/** Annulation d'une note (`frais.note.annuler`) : l'intéressé avant la validation, le service RH avant le paiement. */
export function annulationNote(n: NoteFrais, nom: string | null): Confirmation {
  return {
    titre: 'Annuler la note',
    question: `Annuler la ${nomNote(n).toLowerCase()}${nom ? ` de ${nom}` : ''} ?`,
    suites: ['La note reste en base, annulée : ses dépenses ne seront pas remboursées. Une dépense se ressaisit dans une autre note.'],
    bouton: 'Annuler la note',
    action: 'frais.note.annuler',
    payload: { id: n.id },
    motif: { label: 'Motif de l’annulation', requis: false, aide: AIDE(nom ?? 'vous'), placeholder: 'Note en double, déplacement annulé…' },
  };
}

/** Suppression d'une dépense d'une note en saisie (`frais.ligne.supprimer`) : ses justificatifs sont retirés. */
export function suppressionDepense(l: LigneFrais): Confirmation {
  return {
    titre: 'Retirer la dépense',
    question: `Retirer la dépense du ${l.date} (${CATEGORIES_FRAIS[l.categorie].label.toLowerCase()}, ${euros(l.montant, l.devise)}) de la note ?`,
    suites: ['Ses justificatifs sont retirés aussi.'],
    bouton: 'Retirer la dépense',
    action: 'frais.ligne.supprimer',
    payload: { id: l.id },
  };
}

/** Refus d'une avance (`frais.avance.refuser`). */
export function refusAvance(a: AvanceFrais, nom: string): Confirmation {
  return {
    titre: 'Refuser l’avance',
    question: `Refuser l’avance de ${euros(a.montant)} demandée par ${nom} ?`,
    bouton: 'Refuser l’avance',
    action: 'frais.avance.refuser',
    payload: { id: a.id },
    motif: { label: 'Motif du refus', requis: true, aide: AIDE(nom), placeholder: 'Déplacement annulé, montant à revoir…' },
  };
}

/** Annulation d'un export comptable (`frais.export.annuler`). `telecharge` : son fichier a déjà été téléchargé. */
export function annulationExport(id: number, notes: number, telecharge: boolean): Confirmation {
  return {
    titre: 'Annuler l’export comptable',
    question: `Annuler l’export comptable n° ${id} (${notes} note${notes > 1 ? 's' : ''}) ?`,
    suites: [
      'Ses notes redeviennent à exporter et partiront dans le prochain export.',
      telecharge ? 'Son fichier a déjà été téléchargé : retirez de la comptabilité les écritures déjà importées.' : 'Son fichier n’a pas été téléchargé.',
    ],
    bouton: 'Annuler l’export',
    action: 'frais.export.annuler',
    payload: { id },
  };
}
