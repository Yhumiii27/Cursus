// Confirmations des refus et des actions irréversibles, affichées par dialogs/ConfirmerDialog.tsx à la place des
// window.confirm et des boutons qui agissaient en un clic : ce qui va se passer, le bouton qui l'exécute et, pour
// un refus, le motif (obligatoire), dont l'aide nomme ceux qui le liront (instantanés de server/src/dataset.ts).
// Une confirmation n'est faite que de données : comme tout dialogue, elle se garde dans le brouillon d'une
// reconnexion Microsoft (state/brouillon.ts).
// Les actions confirmées gardent leurs contrôles serveur : un écran en retard (demande déjà traitée, feuille
// modifiée ailleurs) est refusé par le serveur et le dialogue reste ouvert avec le message.
import { fH, plural } from '../../../shared/format.ts';
import type { DialogState, UiState } from './store.tsx';

/** Longueur maximale d'un motif (contrôlée aussi par le serveur). */
export const MOTIF_MAX = 500;

export interface Confirmation {
  titre: string;
  /** Question posée : elle décrit le dialogue pour un lecteur d'écran. */
  question: string;
  /** Conséquences, une phrase chacune. */
  suites?: string[];
  /** Libellé du bouton qui exécute l'action. */
  bouton: string;
  action: string;
  payload: Record<string, unknown>;
  /** Motif saisi, envoyé dans `payload.motif` ; `aide` dit qui le lira. */
  motif?: { label: string; requis: boolean; aide: string; placeholder?: string };
  /**
   * Après le succès : filtres d'écran à appliquer, mot de passe provisoire renvoyé à afficher (réinitialisation d'un
   * compte), dialogue d'origine à rouvrir (aussi à l'annulation : détail d'une session).
   */
  ensuite?: { ui?: Partial<UiState>; motDePasse?: { nom: string; identifiant: string }; retour?: DialogState };
}

/** Motif obligatoire d'un refus, lu par `lecteurs`. */
const motifRefus = (lecteurs: string, placeholder: string) => ({
  label: 'Motif du refus', requis: true, aide: `Le motif est visible de ${lecteurs} : n’y indiquez aucune information médicale.`, placeholder,
});

/**
 * Refus d'une demande adressée au service RH (formation, habilitation, document déclaré). `objet` : intitulé
 * de la demande ; `manager` : nom du manager qui l'a faite pour son équipe ; `retire` : déclaration déjà au
 * dossier, que le refus en retire. Le refus et son motif ne sont montrés qu'au collaborateur (server/src/dataset.ts) :
 * le manager qui a fait la demande n'en voit rien dans son espace.
 */
export function refusDemande(r: { id: number; type: string }, nom: string, objet: string, opts: { manager?: string | null; retire?: boolean } = {}): Confirmation {
  const document = r.type === 'document';
  return {
    titre: document ? 'Refuser la déclaration' : 'Refuser la demande',
    question: `Refuser ${document ? 'la déclaration' : 'la demande'} de ${nom} : ${objet} ?`,
    suites: [
      document ? (opts.retire ? 'Le document, déjà enregistré dans le dossier avant la validation RH, en est retiré.' : 'Le dossier n’est pas modifié.') : '',
      `${nom} voit le refus et son motif dans son espace.`,
      opts.manager ? `Le refus n’apparaît pas dans l’espace de ${opts.manager}, qui a fait la demande : à prévenir si besoin.` : '',
    ].filter(Boolean),
    bouton: document ? 'Refuser la déclaration' : 'Refuser la demande',
    action: 'demande.refuser',
    payload: { id: r.id },
    motif: motifRefus(nom, document ? 'Document illisible, date d’expiration erronée…' : 'Budget de l’exercice engagé, formation interne prévue…'),
  };
}

/**
 * Refus d'une demande de congé (CP, RTT, récupération) par le manager ou le service RH. `quoi` : « CP du … au … » ;
 * `manager` : nom du manager du salarié quand ce n'est pas lui qui refuse (il voit le motif dans ses absences).
 */
export function refusAbsence(a: { id: number }, nom: string, quoi: string, manager?: string | null): Confirmation {
  return {
    titre: 'Refuser la demande d’absence',
    question: `Refuser la demande de ${nom} : ${quoi} ?`,
    suites: ['Le solde n’est pas débité et Keystone n’est pas prévenu.', `${nom} voit le refus et son motif dans ses absences${manager ? `, comme son manager, ${manager}` : ''}.`],
    bouton: 'Refuser la demande',
    action: 'absence.decider',
    payload: { id: a.id, ok: false },
    motif: motifRefus(manager ? `${nom} et de son manager, ${manager}` : nom, 'Période de forte activité, effectif minimum non atteint…'),
  };
}

/** Refus d'une demande de déplacement reçue de Keystone. `chantier` : « K-2041 · Usine de Kenitra ». */
export function refusKeystone(dm: { id: number }, nom: string, chantier: string): Confirmation {
  return {
    titre: 'Refuser la demande Keystone',
    question: `Refuser le déplacement de ${nom} pour le chantier ${chantier} ?`,
    suites: ['Keystone reçoit la décision et le chef de projet en est notifié, sans le motif.', 'Le refus est inscrit au journal de Cursus (Paramètres) avec son motif, sa date et votre nom.'],
    bouton: 'Refuser la demande',
    action: 'keystone.refuser',
    payload: { id: dm.id },
    motif: { label: 'Motif du refus', requis: true, aide: 'Le motif reste dans Cursus, lisible du service RH dans le journal : il n’est jamais transmis à Keystone.', placeholder: 'Visa impossible à obtenir à temps, habilitation manquante…' },
  };
}

/** Suppression d'une ligne de feuille de temps qui porte des heures (`payload` : ligne visée, voir temps.removeLine). */
export function suppressionLigne(payload: Record<string, unknown>, ligne: string, heures: number): Confirmation {
  return {
    titre: 'Supprimer la ligne',
    question: `Supprimer la ligne ${ligne} et ses ${fH(heures)} ?`,
    suites: ['Les heures de cette ligne sont effacées de la feuille de la semaine.'],
    bouton: 'Supprimer la ligne',
    action: 'temps.removeLine',
    payload,
  };
}

/** Transmission à Sage Paie des feuilles validées en attente. */
export function transmissionSage(feuilles: number, salaries: number): Confirmation {
  return {
    titre: 'Transmettre à Sage Paie',
    question: `Transmettre à Sage Paie ${plural(feuilles, 'feuille validée', 'feuilles validées')} (${plural(salaries, 'salarié', 'salariés')}) ?`,
    suites: [
      'Les variables de paie sont envoyées en une fois ; une feuille transmise ne l’est plus une seconde fois.',
      'Une correction après la transmission se fait dans Sage Paie.',
    ],
    bouton: 'Transmettre',
    action: 'temps.pushSage',
    payload: {},
  };
}

/** Suppression d'une équipe vide (administrateur RH). */
export function suppressionEquipe(nom: string): Confirmation {
  return {
    titre: 'Supprimer l’équipe',
    question: `Supprimer l’équipe ${nom} ?`,
    suites: ['Ses enveloppes budgétaires de formation sont supprimées.'],
    bouton: 'Supprimer l’équipe',
    action: 'equipe.supprimer',
    payload: { nom },
  };
}

/** Retrait d'un membre de son équipe : il passe « à affecter ». `ui` : filtres appliqués ensuite (fiche fermée). */
export function retraitEquipe(empId: number, nom: string, equipe: string, ui?: Partial<UiState>): Confirmation {
  return {
    titre: 'Retirer de l’équipe',
    question: `Retirer ${nom} de l’équipe ${equipe} ?`,
    suites: [`${nom} passe « à affecter » : le service RH valide ses heures, ses absences et ses entretiens jusqu’à sa nouvelle affectation.`],
    bouton: 'Retirer de l’équipe',
    action: 'equipe.affecter',
    payload: { empId, equipe: null },
    ...(ui ? { ensuite: { ui } } : {}),
  };
}

/** Changement du manager d'une équipe (null : aucun, validations par le service RH). */
export function changementManager(equipe: string, ancien: string | null, nouveau: { id: number; nom: string } | null): Confirmation {
  return {
    titre: 'Changer le manager',
    question: nouveau ? `Désigner ${nouveau.nom} manager de l’équipe ${equipe} ?` : `Retirer le manager de l’équipe ${equipe} ?`,
    suites: [
      nouveau
        ? `${nouveau.nom} valide désormais les heures, les absences et les entretiens de l’équipe${ancien ? `, à la place de ${ancien}` : ''}.`
        : `Les heures, les absences et les entretiens de l’équipe sont validés par le service RH${ancien ? `, à la place de ${ancien}` : ''}.`,
      'Les demandes en attente passent au nouveau valideur.',
    ],
    bouton: nouveau ? 'Désigner le manager' : 'Retirer le manager',
    action: 'equipe.manager',
    payload: { nom: equipe, managerId: nouveau?.id ?? null },
  };
}

/**
 * Désinscription d'une session à venir. `quoi` : « SST du 18 nov. 2026 » ; `convoque` : convocation déjà reçue (même
 * remise « à renvoyer »), annulée par e-mail ; `retour` : dialogue à rouvrir ensuite (détail de la session).
 */
export function desinscription(p: { empId: number; sessionId: number }, nom: string, quoi: string,
  opts: { recyclage: boolean; convoque: boolean; retour?: DialogState }): Confirmation {
  return {
    titre: 'Désinscrire de la session',
    question: `Désinscrire ${nom} de la session ${quoi} ?`,
    suites: [
      `La place est libérée${opts.recyclage ? ' et le recyclage redevient à planifier' : ' et l’inscription en formation initiale est retirée'}.`,
      opts.convoque ? `${nom} reçoit l’annulation de sa convocation par e-mail, avec le fichier d’agenda qui retire la session.` : '',
    ].filter(Boolean),
    bouton: 'Désinscrire',
    action: 'plan.desinscrire',
    payload: p,
    ...(opts.retour ? { ensuite: { retour: opts.retour } } : {}),
  };
}

/** Relevé d'heures des intérimaires envoyé à leur agence : renvoi, ou envoi sans les feuilles pas encore validées. */
export function envoiReleve(agence: string, adresse: string, semaine: string, numero: number, opts: { renvoi: boolean; enAttente: string[] }): Confirmation {
  return {
    titre: opts.renvoi ? 'Renvoyer le relevé' : 'Envoyer le relevé',
    question: `${opts.renvoi ? 'Renvoyer' : 'Envoyer'} le relevé de la semaine ${numero} à ${agence} (${adresse}) ?`,
    suites: [
      opts.enAttente.length ? `Feuille non validée, absente du relevé : ${opts.enAttente.join(', ')}. Le relevé complet part à sa validation.` : '',
      opts.renvoi ? 'L’agence reçoit un nouvel e-mail avec le relevé à jour.' : '',
    ].filter(Boolean),
    bouton: opts.renvoi ? 'Renvoyer le relevé' : 'Envoyer le relevé',
    action: 'releve.envoyer',
    payload: { agence, semaine },
  };
}

/** Annulation d'une demande de visite médicale en cours (faite par erreur, salarié sorti…). */
export function annulationVisite(x: { id: number; le: string }, nom: string, le: string): Confirmation {
  return {
    titre: 'Annuler la demande de visite',
    question: `Annuler la demande de visite du ${le} pour ${nom} ?`,
    suites: ['La demande est close sans visite ; une nouvelle demande reste possible. Le service de santé au travail n’est pas prévenu : à informer si la demande lui a été transmise.'],
    bouton: 'Annuler la demande',
    action: 'medical.annuler',
    payload: { id: x.id },
  };
}

/** Comptes et accès (administrateur RH). */
/** Rattachement d'un compte (externe) à la fiche de la personne. */
export function rattachementCompte(c: { id: number; nom: string; identifiant: string }, e: { id: number; nom: string }): Confirmation {
  return {
    titre: 'Rattacher le compte à une fiche',
    question: `Rattacher le compte de ${c.nom} (${c.identifiant}) à la fiche de ${e.nom} ?`,
    suites: ['Le compte ouvre aussi ses espaces de salarié.', 'Il ne peut plus décider de ses propres absences, feuilles de temps ou entretiens.'],
    bouton: 'Rattacher le compte',
    action: 'compte.rattacher',
    payload: { id: c.id, empId: e.id },
  };
}

export function desactivationCompte(c: { id: number; nom: string }): Confirmation {
  return {
    titre: 'Désactiver le compte',
    question: `Désactiver le compte de ${c.nom} ?`,
    suites: ['Ses sessions ouvertes sont fermées aussitôt ; le compte pourra être réactivé.'],
    bouton: 'Désactiver le compte',
    action: 'compte.activer',
    payload: { id: c.id, actif: false },
  };
}

export function delierCompte(c: { id: number; nom: string; identifiant: string }): Confirmation {
  return {
    titre: 'Délier le compte Microsoft',
    question: `Retirer le rattachement Microsoft de ${c.nom} ?`,
    suites: [`Ses sessions sont fermées ; sa prochaine connexion Microsoft avec ${c.identifiant} rattachera le compte à son identité Microsoft actuelle.`],
    bouton: 'Délier le compte',
    action: 'compte.reinitialiser',
    payload: { id: c.id },
  };
}

export function nouveauMotDePasse(c: { id: number; nom: string; identifiant: string }): Confirmation {
  return {
    titre: 'Nouveau mot de passe provisoire',
    question: `Attribuer un nouveau mot de passe provisoire à ${c.nom} ?`,
    suites: ['L’ancien mot de passe ne fonctionnera plus et ses sessions sont fermées.', 'Le nouveau mot de passe s’affiche une seule fois, à remettre à la personne.'],
    bouton: 'Attribuer un mot de passe',
    action: 'compte.reinitialiser',
    payload: { id: c.id },
    ensuite: { motDePasse: { nom: c.nom, identifiant: c.identifiant } },
  };
}

/** Réinitialisation des données de démonstration (administrateur RH, mode démonstration). */
export function reinitialisationDemo(): Confirmation {
  return {
    titre: 'Réinitialiser la démonstration',
    question: 'Réinitialiser toutes les données de démonstration ?',
    suites: ['Les modifications effectuées depuis le dernier chargement sont effacées. Une sauvegarde de la base est conservée sur le serveur.'],
    bouton: 'Réinitialiser',
    action: 'demo.reinitialiser',
    payload: {},
  };
}

/** Erreur du motif saisi, ou null. */
export function erreurMotif(c: Confirmation, motif: string): string | null {
  if (!c.motif) return null;
  const m = motif.trim();
  if (c.motif.requis && !m) return 'Indiquez le motif du refus.';
  if (m.length > MOTIF_MAX) return `Motif trop long (${MOTIF_MAX} caractères au plus).`;
  return null;
}

/** Paramètres envoyés : ceux de la confirmation, et le motif s'il y en a un. */
export const parametres = (c: Confirmation, motif: string): Record<string, unknown> =>
  c.motif ? { ...c.payload, motif: motif.trim() } : c.payload;
