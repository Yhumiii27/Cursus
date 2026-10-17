// Confirmations des corrections d'une saisie erronée (t119, shared/rules/corrections.ts), affichées par
// dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts) : suppression d'une certification ou d'une ligne du plan
// (administrateur RH), retrait d'une demande par son auteur, réouverture d'une demande par le service RH.
import { fmtEur, fmtIso } from '../../../shared/format.ts';
import type { PlanAction } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/** Motif obligatoire d'une correction du service RH : gardé dans Cursus, jamais montré hors du service RH. */
const motifCorrection = (label: string, placeholder: string) => ({
  label, requis: true, placeholder,
  aide: 'Le motif reste dans Cursus, au service RH : jamais montré au manager ni au salarié, jamais recopié au journal (le salarié le retrouve dans la copie de ses données). N’y indiquez aucune information médicale.',
});

/**
 * Suppression d'une certification saisie par erreur. `quoi` : « SST du 3 mai 2025 » ; `precedente` : date de la
 * certification de la même formation qui redevient en vigueur ; `session` : session où elle est inscrite.
 */
export function suppressionCertification(c: { id: number }, nom: string, quoi: string, o: { precedente?: string | null; session?: string | null } = {}): Confirmation {
  return {
    titre: 'Supprimer la certification',
    question: `Supprimer la certification ${quoi} du dossier de ${nom} ?`,
    suites: [
      'Elle reste en base, datée et signée, mais ne compte plus : statut, échéances, prérequis des habilitations, Go / No Go.',
      o.precedente ? `La certification du ${fmtIso(o.precedente)} redevient en vigueur.` : '',
      o.session ? `Sa place à la session ${o.session} est libérée ; une convocation reçue est annulée par e-mail.` : '',
      'Une habilitation délivrée qui s’appuie sur elle sans autre certification valide est à suspendre d’abord.',
    ].filter(Boolean),
    bouton: 'Supprimer la certification',
    action: 'cert.annuler',
    payload: { id: c.id },
    motif: motifCorrection('Motif de la suppression', 'Saisie sur la mauvaise fiche, attestation inexistante…'),
  };
}

/** Suppression d'une ligne du plan de formation saisie par erreur. `nom` : formation ou intitulé. */
export function suppressionLignePlan(l: Pick<PlanAction, 'id' | 'equipe' | 'periode' | 'exercice' | 'cout'>, nom: string): Confirmation {
  return {
    titre: 'Supprimer l’action du plan',
    question: `Supprimer ${nom} — ${l.equipe}, ${l.periode} ${l.exercice} (${fmtEur(l.cout)} prévus) ?`,
    suites: ['La ligne reste en base, datée et signée, mais sort du plan et des sommes des enveloppes.'],
    bouton: 'Supprimer l’action',
    action: 'plan.supprimer',
    payload: { id: l.id },
    motif: motifCorrection('Motif de la suppression', 'Doublon de l’import, action abandonnée…'),
  };
}

/** Retrait d'une demande encore en attente par son auteur. `pour` : nom du salarié quand un manager l'a faite pour lui. */
export function retraitDemande(r: { id: number }, objet: string, pour?: string | null): Confirmation {
  return {
    titre: 'Retirer la demande',
    question: `Retirer ${pour ? `la demande faite pour ${pour}` : 'votre demande'} : ${objet} ?`,
    suites: ['Le service RH ne la traitera pas ; elle reste listée, « Retirée ». Une nouvelle demande reste possible.'],
    bouton: 'Retirer la demande',
    action: 'demande.annuler',
    payload: { id: r.id },
  };
}

/** Réouverture d'une demande acceptée ou refusée par erreur. `effets` : ce que l'acceptation avait créé et qui est défait. */
export function reouvertureDemande(r: { id: number; statut: string }, nom: string, objet: string, effets: string[]): Confirmation {
  return {
    titre: 'Rouvrir la demande',
    question: `Rouvrir la demande de ${nom} : ${objet} (${r.statut === 'acceptee' ? 'acceptée' : 'refusée'}) ?`,
    suites: [...effets, 'La demande revient « En attente », à accepter ou refuser de nouveau ; la réponse précédente est effacée.'],
    bouton: 'Rouvrir la demande',
    action: 'demande.reouvrir',
    payload: { id: r.id },
    motif: motifCorrection('Motif de la réouverture', 'Acceptée par erreur, session choisie inadaptée…'),
  };
}
