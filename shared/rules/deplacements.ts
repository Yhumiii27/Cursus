// Déplacements modifiés ou annulés par le service RH (`voyage.modifier`, `voyage.annuler`). Un déplacement annulé reste
// dans l'historique (écran Voyages, « Déplacements annulés ») mais sort de tous les calculs : préparation du dossier
// (`Domain.tripsAll`), Go / No Go, conflits de dates, avertissements d'une sortie, échéances et relances. Un déplacement
// venu de Keystone (acceptation d'une demande) garde la destination et le motif de son chantier ; son annulation exige
// un motif, et Keystone est prévenu des deux (`deplacement.modifie`, `deplacement.annule`).
import { isValidDate } from '../dates.ts';
import type { ISODate, Voyage } from '../types.ts';

/** Déplacement en vigueur (non annulé). */
export const voyageActif = (v: Pick<Voyage, 'annuleLe'>): boolean => !v.annuleLe;

/** Déplacements annulés, du plus récemment annulé au plus ancien (historique de l'écran Voyages). */
export const voyagesAnnules = <T extends Voyage>(list: T[]): T[] =>
  list.filter(v => !voyageActif(v)).sort((a, b) => String(b.annuleLe).localeCompare(String(a.annuleLe)) || b.id - a.id);

/** Longueur maximale du motif d'une annulation (comme celle d'un refus). */
export const MOTIF_ANNULATION_MAX = 500;

/**
 * Ce qu'une modification ou une annulation refuse d'emblée, avant les contrôles de saisie : déplacement déjà annulé, ou
 * terminé (son retour est passé : il n'y a plus rien à déplacer ni à annuler). Null : modifiable.
 */
export function refusChangement(v: Pick<Voyage, 'annuleLe' | 'retour'>, ti: ISODate): string | null {
  if (!voyageActif(v)) return 'Déplacement déjà annulé';
  if (v.retour < ti) return 'Déplacement terminé : il reste dans l’historique tel qu’il a eu lieu';
  return null;
}

/**
 * Contrôle de la saisie d'une modification : dates valides dans l'ordre, motif renseigné. Un déplacement venu de Keystone
 * ne change ni de destination ni de motif (ceux du chantier). Renvoie le premier refus, ou null.
 */
export function refusModification(avant: Pick<Voyage, 'origine' | 'dest' | 'motif'>, p: { dest: string; depart: string; retour: string; motif: string }): string | null {
  if (!isValidDate(p.depart) || !isValidDate(p.retour) || p.retour < p.depart || !p.motif) return 'Dates et motif requis';
  if (avant.origine === 'keystone' && (p.dest !== avant.dest || p.motif !== avant.motif)) return 'Déplacement venu de Keystone : seules ses dates se modifient (destination et motif sont ceux du chantier)';
  return null;
}

/** Annulation : motif obligatoire pour un déplacement venu de Keystone, facultatif sinon ; 500 caractères au plus. */
export function refusAnnulation(v: Pick<Voyage, 'origine'>, motif: string): string | null {
  if (motif.length > MOTIF_ANNULATION_MAX) return `Motif trop long (${MOTIF_ANNULATION_MAX} caractères au plus)`;
  if (v.origine === 'keystone' && !motif) return 'Motif de l’annulation requis pour un déplacement venu de Keystone';
  return null;
}
