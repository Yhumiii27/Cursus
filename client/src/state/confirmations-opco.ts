// lot 11 — dossiers OPCO : confirmations des retours en arrière (administrateur RH), affichées par dialogs/ConfirmerDialog.tsx
// (modèle : state/confirmations.ts) : réouverture d'un dossier d'un cran, annulation d'un versement saisi par erreur,
// suppression d'un dossier saisi par erreur. Le motif reste sur le dossier, au service RH : jamais recopié au journal ni
// transmis à la lecture seule (server/src/dataset.ts).
import { fmtIso } from '../../../shared/format.ts';
import { eurosOpco, statutPrecedent, STATUTS_OPCO } from '../../../shared/rules/opco.ts';
import type { DossierOpco, VersementOpco } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/** Où va le motif d'un retour en arrière sur un dossier OPCO. */
export const AIDE_MOTIF_OPCO = 'Le motif reste sur le dossier, lu par le service RH seulement : jamais recopié au journal ni montré à la lecture seule.';

const motif = (label: string, placeholder: string) => ({ label, requis: true, aide: AIDE_MOTIF_OPCO, placeholder });

/** Retour d'un cran (`opco.rouvrir`) : l'état d'avant et les champs effacés. `nom` : action du plan du dossier. */
export function reouvertureOpco(d: DossierOpco, nom: string, versements: number): Confirmation | null {
  const r = statutPrecedent(d, versements);
  if (!('vers' in r)) return null;
  const effaces: Partial<Record<DossierOpco['statut'], string>> = {
    depose: 'La date de dépôt est effacée.',
    accorde: 'La date, le montant et la référence de l’accord sont effacés.',
    refuse: 'La date et le motif du refus sont effacés.',
    facture: 'La date d’envoi des justificatifs et le montant facturé sont effacés.',
    solde: 'L’écart figé au solde est effacé.',
    abandonne: 'L’abandon et son motif sont effacés.',
  };
  return {
    titre: 'Rouvrir le dossier OPCO',
    question: `Ramener le dossier OPCO de ${nom} de « ${STATUTS_OPCO[d.statut].label} » à « ${STATUTS_OPCO[r.vers].label} » ?`,
    suites: [effaces[d.statut] ?? '', 'Le retour est daté et signé ; le journal garde les anciennes valeurs.'].filter(Boolean),
    bouton: 'Rouvrir le dossier',
    action: 'opco.rouvrir',
    payload: { id: d.id, de: d.statut },
    motif: motif('Motif de la réouverture', 'Accord saisi sur le mauvais dossier, refus contesté…'),
  };
}

/** Annulation d'un versement saisi par erreur (`opco.annulerVersement`). `dernier` : aucun autre versement ne reste. */
export function annulationVersementOpco(v: VersementOpco, nom: string, dernier: boolean, retour: string | null): Confirmation {
  return {
    titre: 'Annuler le versement',
    question: `Annuler le versement du ${fmtIso(v.le)} (${eurosOpco(v.montant)}) du dossier OPCO de ${nom} ?`,
    suites: [
      'Le versement reste en base, daté et signé, mais ne compte plus dans les sommes reçues.',
      dernier && retour ? `Sans autre versement, le dossier redevient « ${retour} ».` : '',
    ].filter(Boolean),
    bouton: 'Annuler le versement',
    action: 'opco.annulerVersement',
    payload: { id: v.id },
    motif: motif('Motif de l’annulation', 'Montant mal saisi, virement d’un autre dossier…'),
  };
}

/** Suppression d'un dossier saisi par erreur (`opco.supprimer`) : sans versement ni pièce en vigueur. */
export function suppressionDossierOpco(d: DossierOpco, nom: string): Confirmation {
  return {
    titre: 'Supprimer le dossier OPCO',
    question: `Supprimer le dossier OPCO de ${nom} (${STATUTS_OPCO[d.statut].label.toLowerCase()}) ?`,
    suites: ['Le dossier reste en base, daté et signé, mais sort de l’écran, des sommes et des relances.'],
    bouton: 'Supprimer le dossier',
    action: 'opco.supprimer',
    payload: { id: d.id },
    motif: motif('Motif de la suppression', 'Doublon, dossier créé sur la mauvaise action…'),
    ensuite: { ui: { opcoSel: null } },
  };
}
