// lot 14 — pré-déclarations de présence sur site : confirmations du service RH (refus, annulation d'une déclaration,
// révocation d'un lien), affichées par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts). La validation, qui
// demande la fiche à rattacher, a son dialogue (dialogs/ValiderDeclarationDialog.tsx).
import { fmtIso } from '../../../shared/format.ts';
import { refDeclaration } from '../../../shared/rules/declarations-presence.ts';
import type { DeclarationPresence, LienDeclaration } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

const qui = (d: DeclarationPresence) => `${d.prenom} ${d.nom} (${d.entreprise})`;
const venue = (d: DeclarationPresence) => (d.du === d.au ? `le ${fmtIso(d.du)}` : `du ${fmtIso(d.du)} au ${fmtIso(d.au)}`);

/** Refus d'une déclaration à valider : motif obligatoire, gardé au dossier du service RH (jamais publié). */
export function refusDeclaration(d: DeclarationPresence, conservationMois: number): Confirmation {
  return {
    titre: 'Refuser la déclaration',
    question: `Refuser la déclaration ${refDeclaration(d.id)} de ${qui(d)}, venue ${venue(d)} ?`,
    suites: [
      'La personne n’est pas attendue sur site : rien n’est publié au poste de garde.',
      `La déclaration est effacée ${conservationMois} mois après le refus.`,
    ],
    bouton: 'Refuser',
    action: 'presence.refuser',
    payload: { id: d.id },
    motif: { label: 'Motif du refus', requis: true, aide: 'Le motif reste au service RH ; il n’est ni publié, ni écrit au journal.', placeholder: 'Personne inconnue de l’entreprise, venue non prévue…' },
  };
}

/** Annulation : venue validée qui n'aura pas lieu (publiée comme annulée), ou déclaration à valider classée sans suite. */
export function annulationDeclaration(d: DeclarationPresence, conservationMois: number): Confirmation {
  return {
    titre: d.statut === 'validee' ? 'Annuler la venue' : 'Classer sans suite',
    question: d.statut === 'validee'
      ? `Annuler la venue de ${qui(d)} ${venue(d)} (${refDeclaration(d.id)}) ?`
      : `Classer sans suite la déclaration ${refDeclaration(d.id)} de ${qui(d)}, venue ${venue(d)} ?`,
    suites: d.statut === 'validee'
      ? ['La présence prévue reste publiée, marquée annulée, pour que le poste de garde ne l’attende plus.', 'La fiche de la personne est gardée.']
      : [`La déclaration est classée sans suite, puis effacée ${conservationMois} mois après.`],
    bouton: d.statut === 'validee' ? 'Annuler la venue' : 'Classer sans suite',
    action: 'presence.annuler',
    payload: { id: d.id },
    motif: { label: d.statut === 'validee' ? 'Motif de l’annulation' : 'Motif', requis: true, aide: 'Le motif reste au service RH ; il n’est ni publié, ni écrit au journal.', placeholder: 'Chantier reporté, personne remplacée…' },
  };
}

/** Révocation d'un lien : il ne reçoit plus rien ; les déclarations déjà faites restent. */
export function revocationLien(l: LienDeclaration): Confirmation {
  return {
    titre: 'Révoquer le lien',
    question: `Révoquer le lien de déclaration de ${l.entreprise} ?`,
    suites: [
      'Le lien ne reçoit plus de déclaration ; celles déjà faites restent à traiter.',
      'Créez ensuite un nouveau lien si l’entreprise doit encore déclarer des venues (lien transmis par erreur, perdu…).',
    ],
    bouton: 'Révoquer',
    action: 'presence.lien.revoquer',
    payload: { id: l.id },
  };
}
