// lot 14 — pré-déclarations de présence sur site : confirmations du service RH (refus, annulation d'une déclaration,
// révocation d'un lien), affichées par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts). La validation, qui
// demande la fiche à rattacher, a son dialogue (dialogs/ValiderDeclarationDialog.tsx).
import { fmtIso } from '../../../shared/format.ts';
import { refDeclaration } from '../../../shared/rules/declarations-presence.ts';
import type { DeclarationPresence, LienDeclaration } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';
import { t } from '../i18n/langue.ts';

const qui = (d: DeclarationPresence) => `${d.prenom} ${d.nom} (${d.entreprise})`;
const venue = (d: DeclarationPresence) => (d.du === d.au ? `${t('on ')}${fmtIso(d.du)}` : `${t('from #du-min')}${fmtIso(d.du)}${t(' to #au')}${fmtIso(d.au)}`);

/** Refus d'une déclaration à valider : motif obligatoire, gardé au dossier du service RH (jamais publié). */
export function refusDeclaration(d: DeclarationPresence, conservationMois: number): Confirmation {
  return {
    titre: t('Refuse the declaration'),
    question: `${t('Refuse the declaration #ref')}${refDeclaration(d.id)}${t(' of #de-name')}${qui(d)}${t(', visit ')}${venue(d)}${t('?#question')}`,
    suites: [
      t('The person is not expected on site: nothing is published at the gatehouse.'),
      `${t('The declaration is erased ')}${conservationMois}${t(' months after the refusal.')}`,
    ],
    bouton: t('Refuse'),
    action: 'presence.refuser',
    payload: { id: d.id },
    motif: { label: t('Reason for the refusal'), requis: true, aide: t('The reason stays with HR; it is neither published nor written in the log.'), placeholder: t('Person unknown to the company, visit not planned…') },
  };
}

/** Annulation : venue validée qui n'aura pas lieu (publiée comme annulée), ou déclaration à valider classée sans suite. */
export function annulationDeclaration(d: DeclarationPresence, conservationMois: number): Confirmation {
  return {
    titre: t(d.statut === 'validee' ? 'Cancel the visit' : 'Close without action'),
    question: d.statut === 'validee'
      ? `${t('Cancel the visit of ')}${qui(d)} ${venue(d)} (${refDeclaration(d.id)})${t('?#question')}`
      : `${t('Close without action the declaration ')}${refDeclaration(d.id)}${t(' of #de-name')}${qui(d)}${t(', visit ')}${venue(d)}${t('?#question')}`,
    suites: d.statut === 'validee'
      ? [t('The planned presence stays published, marked cancelled, so that the gatehouse no longer expects it.'), t('The person’s sheet is kept.')]
      : [`${t('The declaration is closed without action, then erased ')}${conservationMois}${t(' months later.')}`],
    bouton: t(d.statut === 'validee' ? 'Cancel the visit' : 'Close without action'),
    action: 'presence.annuler',
    payload: { id: d.id },
    motif: { label: t(d.statut === 'validee' ? 'Reason for the cancellation' : 'Reason'), requis: true, aide: t('The reason stays with HR; it is neither published nor written in the log.'), placeholder: t('Worksite postponed, person replaced…') },
  };
}

/** Révocation d'un lien : il ne reçoit plus rien ; les déclarations déjà faites restent. */
export function revocationLien(l: LienDeclaration): Confirmation {
  return {
    titre: t('Revoke the link'),
    question: `${t('Revoke the declaration link of ')}${l.entreprise}${t('?#question')}`,
    suites: [
      t('The link no longer receives declarations; those already made remain to be processed.'),
      t('Then create a new link if the company must still declare visits (link sent by mistake, lost…).'),
    ],
    bouton: t('Revoke'),
    action: 'presence.lien.revoquer',
    payload: { id: l.id },
  };
}
