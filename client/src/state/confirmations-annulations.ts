// Confirmations des annulations d'un déplacement (`voyage.annuler`) et d'un entretien planifié (`entretien.annuler`),
// affichées par dialogs/ConfirmerDialog.tsx (modèle : state/confirmations.ts).
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import type { Entretien, Voyage } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/**
 * Annulation d'un déplacement par le service RH. `quoi` : « Maroc du 2 nov. au 6 nov. 2026 ». Venu de Keystone : motif
 * obligatoire, Keystone prévenu sans le motif ; sinon motif facultatif. Le motif reste dans Cursus (service RH ; le
 * salarié le retrouve dans la copie de ses données, au titre du droit d'accès).
 */
export function annulationVoyage(t: Pick<Voyage, 'id' | 'origine' | 'chantier'>, nom: string, quoi: string): Confirmation {
  const keystone = t.origine === 'keystone';
  return {
    titre: 'Annuler le déplacement',
    question: `Annuler le déplacement de ${nom} : ${quoi} ?`,
    suites: [
      'Le déplacement reste dans l’historique (écran Voyages), mais ne compte plus : dossier à préparer, Go / No Go, conflits de dates et échéances.',
      keystone ? `Keystone est prévenu de l’annulation (chantier ${t.chantier}), sans le motif.` : '',
      'L’annulation est définitive : un nouveau déplacement se crée s’il y a lieu.',
    ].filter(Boolean),
    bouton: 'Annuler le déplacement',
    action: 'voyage.annuler',
    payload: { id: t.id },
    motif: {
      label: 'Motif de l’annulation', requis: keystone,
      aide: 'Le motif reste dans Cursus : jamais transmis à Keystone ni montré au manager ; le salarié peut le lire dans la copie de ses données (droit d’accès). N’y indiquez aucune information médicale.',
      placeholder: 'Chantier reporté, mission confiée à un autre technicien…',
    },
    ensuite: { ui: { tripSel: null } },
  };
}

/**
 * Annulation d'un entretien planifié par l'évaluateur ou le service RH : l'obligation redevient à planifier, le salarié
 * reçoit l'annulation de l'événement d'agenda (date à venir). Un compte rendu commencé est supprimé avec l'entretien (`confirmer`).
 */
export function annulationEntretien(x: Pick<Entretien, 'id' | 'type' | 'date'>, nom: string, o: { crCommence: boolean; passe: boolean }): Confirmation {
  const type = ENT_TYPES[x.type].nom;
  return {
    titre: 'Annuler l’entretien',
    question: `Annuler l’${type.charAt(0).toLowerCase()}${type.slice(1)} de ${nom} prévu le ${fmtIso(x.date)} ?`,
    suites: [
      o.crCommence ? 'Le compte rendu déjà commencé est supprimé avec l’entretien. S’il a eu lieu, fermez plutôt ce dialogue et clôturez-le.' : '',
      o.passe ? '' : `${nom} reçoit l’annulation de sa convocation (événement retiré de son agenda).`,
      'L’échéance qu’il couvrait redevient à planifier.',
    ].filter(Boolean),
    bouton: 'Annuler l’entretien',
    action: 'entretien.annuler',
    // `confirmer` seulement si la confirmation a annoncé la suppression d'un compte rendu commencé : sinon, un compte rendu
    // écrit depuis la dernière relecture (le salarié rédige au fil) fait refuser l'annulation (409), affichée dans le dialogue.
    payload: { id: x.id, ...(o.crCommence ? { confirmer: true } : {}) },
  };
}
