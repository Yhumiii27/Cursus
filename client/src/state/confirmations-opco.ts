// lot 11 — dossiers OPCO : confirmations des retours en arrière (administrateur RH), affichées par dialogs/ConfirmerDialog.tsx
// (modèle : state/confirmations.ts) : réouverture d'un dossier d'un cran, annulation d'un versement saisi par erreur,
// suppression d'un dossier saisi par erreur. Le motif reste sur le dossier, au service RH : jamais recopié au journal ni
// transmis à la lecture seule (server/src/dataset.ts).
import { fmtIso } from '../../../shared/format.ts';
import { eurosOpco, statutPrecedent, STATUTS_OPCO } from '../../../shared/rules/opco.ts';
import type { DossierOpco, VersementOpco } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

/** Où va le motif d'un retour en arrière sur un dossier OPCO. */
export const aideMotifOpco = () => t('The reason stays on the file, read by HR only: never copied into the log nor shown to read-only access.');

const motif = (label: string, placeholder: string) => ({ label, requis: true, aide: aideMotifOpco(), placeholder });

/** Retour d'un cran (`opco.rouvrir`) : l'état d'avant et les champs effacés. `nom` : action du plan du dossier. */
export function reouvertureOpco(d: DossierOpco, nom: string, versements: number): Confirmation | null {
  const r = statutPrecedent(d, versements);
  if (!('vers' in r)) return null;
  const effaces: Partial<Record<DossierOpco['statut'], string>> = {
    depose: t('The filing date is erased.'),
    accorde: t('The date, the amount and the reference of the agreement are erased.'),
    refuse: t('The date and the reason for the refusal are erased.'),
    facture: t('The date of sending the supporting documents and the amount invoiced are erased.'),
    solde: t('The difference frozen at settlement is erased.'),
    abandonne: t('The abandonment and its reason are erased.'),
  };
  return {
    titre: t('Reopen the OPCO file'),
    question: `${t('Take the OPCO file of ')}${nom}${t(' back from “')}${STATUTS_OPCO[d.statut].label}${t('” to “')}${STATUTS_OPCO[r.vers].label}${t('”?')}`,
    suites: [effaces[d.statut] ?? '', t('The return is dated and signed; the log keeps the old values.')].filter(Boolean),
    bouton: t('Reopen the file'),
    action: 'opco.rouvrir',
    payload: { id: d.id, de: d.statut },
    motif: motif(t('Reason for the reopening'), t('Agreement entered on the wrong file, refusal contested…')),
  };
}

/** Annulation d'un versement saisi par erreur (`opco.annulerVersement`). `dernier` : aucun autre versement ne reste. */
export function annulationVersementOpco(v: VersementOpco, nom: string, dernier: boolean, retour: string | null): Confirmation {
  return {
    titre: t('Cancel the payment'),
    question: `${t('Cancel the payment of ')}${fmtIso(v.le)} (${eurosOpco(v.montant)})${t(' of the OPCO file of ')}${nom}${t('?#question')}`,
    suites: [
      t('The payment stays in the database, dated and signed, but no longer counts in the sums received.'),
      dernier && retour ? `${t('Without any other payment, the file goes back to “')}${retour}${t('”.')}` : '',
    ].filter(Boolean),
    bouton: t('Cancel the payment'),
    action: 'opco.annulerVersement',
    payload: { id: v.id },
    motif: motif(t('Reason for the cancellation'), t('Amount entered wrongly, transfer from another file…')),
  };
}

/** Suppression d'un dossier saisi par erreur (`opco.supprimer`) : sans versement ni pièce en vigueur. */
export function suppressionDossierOpco(d: DossierOpco, nom: string): Confirmation {
  return {
    titre: t('Delete the OPCO file'),
    question: `${t('Delete the OPCO file of ')}${nom} (${STATUTS_OPCO[d.statut].label.toLowerCase()})${t('?#question')}`,
    suites: [t('The file stays in the database, dated and signed, but leaves the screen, the sums and the reminders.')],
    bouton: t('Delete the file'),
    action: 'opco.supprimer',
    payload: { id: d.id },
    motif: motif(t('Reason for the deletion'), t('Duplicate, file created on the wrong action…')),
    ensuite: { ui: { opcoSel: null } },
  };
}
