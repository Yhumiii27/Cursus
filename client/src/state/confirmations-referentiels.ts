// Confirmations de l'écran Référentiels (dialogue « confirmer », comme celles de state/confirmations.ts) : archivage
// d'une formation, d'une habilitation ou d'une destination, chargement du référentiel type. Données seulement.
// L'archivage se défait (« Rétablir », sans confirmation) ; la confirmation annonce ce qu'il change.
import { plural } from '../../../shared/format.ts';
import type { ReferentielId } from '../../../shared/rules/referentiels.ts';
import type { Destination, Formation, HabType } from '../../../shared/types.ts';
import type { Confirmation } from './confirmations.ts';

/** Archivage d'une formation du catalogue ; `titulaires` : salariés qui en détiennent une certification. */
export function archivageFormation(f: Pick<Formation, 'id' | 'court'>, titulaires: number): Confirmation {
  return {
    titre: 'Archiver la formation',
    question: `Archiver la formation « ${f.court} » ?`,
    suites: [
      'Elle n’est plus proposée : catalogue, sessions, certifications, demandes des collaborateurs.',
      titulaires
        ? `Les certifications de ${plural(titulaires, 'salarié', 'salariés')} restent au dossier (historique, prérequis, Go / No Go), sans compter dans les statuts ni les échéances.`
        : 'Aucun salarié n’en détient de certification.',
      'Elle reste reconnue dans les échanges avec Keystone, et se rétablit à tout moment.',
    ],
    bouton: 'Archiver',
    action: 'referentiel.formation.archiver',
    payload: { id: f.id },
  };
}

/** Archivage d'une habilitation ; `titres` : titres délivrés à des salariés. */
export function archivageHabilitation(h: Pick<HabType, 'id' | 'nom'>, titres: number): Confirmation {
  return {
    titre: 'Archiver l’habilitation',
    question: `Archiver l’habilitation « ${h.nom} » ?`,
    suites: [
      'Elle n’est plus proposée : délivrance, demandes des collaborateurs.',
      titres
        ? `${plural(titres, 'titre délivré reste', 'titres délivrés restent')} au dossier et dans le Go / No Go, sans compter dans les statuts ni les échéances.`
        : 'Aucun titre n’a été délivré.',
      'Elle reste reconnue dans les échanges avec Keystone, et se rétablit à tout moment.',
    ],
    bouton: 'Archiver',
    action: 'referentiel.habilitation.archiver',
    payload: { id: h.id },
  };
}

/** Archivage d'une destination ; `prevus` : déplacements non terminés vers ce pays. */
export function archivageDestination(dest: Pick<Destination, 'code' | 'pays'>, prevus: number): Confirmation {
  return {
    titre: 'Archiver la destination',
    question: `Archiver la destination « ${dest.pays} » ?`,
    suites: [
      'Elle n’est plus proposée pour un nouveau déplacement (saisie, import), ni pour un visa.',
      prevus ? `${plural(prevus, 'déplacement prévu garde', 'déplacements prévus gardent')} son dossier voyage.` : 'Aucun déplacement prévu vers ce pays.',
      'Une demande de Keystone vers ce pays reste reçue ; la destination se rétablit à tout moment.',
    ],
    bouton: 'Archiver',
    action: 'referentiel.destination.archiver',
    payload: { id: dest.code },
  };
}

/** Référentiel type (celui de la démonstration, server/src/seed.ts) : ce qu'il ajoute, en quelques mots. */
const TYPE_LIBELLE: Record<ReferentielId, [string, string]> = {
  formations: ['le catalogue type des formations', 'Les 11 formations courantes d’un site industriel (SST, habilitation électrique, ATEX, CACES, incendie…) sont ajoutées au catalogue.'],
  habilitations: ['le référentiel type des habilitations', 'Les 6 habilitations courantes (électrique, conduite de chariots et de nacelles, ATEX, travaux en hauteur, AIPR) sont ajoutées, avec leurs formations prérequises.'],
  destinations: ['le référentiel type des destinations', 'Les 8 destinations de la démonstration (Maroc, Inde, États-Unis, Côte d’Ivoire…) sont ajoutées, avec leurs formalités d’entrée.'],
};

/** Chargement du référentiel type dans un référentiel vide, à vérifier ensuite par le service RH. */
export function chargementType(ref: ReferentielId): Confirmation {
  const [quoi, ajout] = TYPE_LIBELLE[ref];
  return {
    titre: 'Charger le référentiel type',
    question: `Charger ${quoi} ?`,
    suites: [ajout, 'À vérifier et compléter ensuite : validités, coûts, organismes, signataires, formalités. Les éléments inutiles s’archivent.'],
    bouton: 'Charger',
    action: 'referentiel.charger',
    payload: { referentiel: ref },
  };
}
