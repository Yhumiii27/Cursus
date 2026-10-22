// Éléments d'un lot de paie à saisir à la main dans Sage (lot 6, chantier 2 : règle commune à tous les chantiers) : un
// élément calculé par Cursus dont la rubrique est désactivée (ou dont la famille est laissée à Sage par un réglage) ne
// part pas dans le fichier d'import ; il ne doit pas pour autant disparaître sans bruit. Le résumé du lot (écran Temps)
// et l'export des variables de la période le listent, nominativement, « à saisir dans Sage ». Sources : absences sans
// code Sage (rubrique d'absence désactivée, régularisation d'un élément saisi à la main), déplacements sans code Sage
// (rubriques désactivées, réglage `deplacementsFichierPaie` décoché), jours rachetés d'un forfait jours sans code Sage
// (rubrique JREN désactivée, t043), et la liste `aSaisir` du contenu, remplie à la
// génération par les familles du registre qui ne gardent pas leurs éléments inactifs dans le lot (soldes de sortie :
// server/src/elements-lot.ts). Une nouvelle famille (heures de nuit, congé pris sur le CET…) y ajoute ses éléments.
import type { ElementASaisir, SagePush } from '../types.ts';
import { detailElement } from './absences-paie.ts';
import { detailDeplacement } from './deplacements-paie.ts';
import { detailRachat } from './forfait-jours.ts';
import { periodeLabel } from './paie.ts';

/** Contenu lu : absences, déplacements et jours rachetés du lot, liste des autres éléments laissés à Sage. */
type ContenuASaisir = Partial<Pick<SagePush, 'absences' | 'deplacements' | 'rachats' | 'aSaisir'>>;

/** Libellé de la colonne « Rubrique Sage » d'un élément sans code Sage, absent du fichier. */
export const A_SAISIR_SAGE = 'À saisir dans Sage';

/** Familles d'éléments, au pluriel, pour les messages (« 2 éléments à saisir dans Sage : 1 absence, 1 déplacement »). */
export const FAMILLES_A_SAISIR: Record<string, [string, string]> = {
  absences: ['absence', 'absences'], sorties: ['solde de sortie', 'soldes de sortie'], deplacements: ['déplacement', 'déplacements'],
  rachats: ['jours rachetés (forfait jours)', 'jours rachetés (forfait jours)'],
};

/**
 * Éléments à saisir dans Sage d'un contenu figé : absences, déplacements et jours rachetés sans code Sage, puis la liste
 * du contenu.
 * `paysLabel` : nom d'un pays (référentiel des destinations), pour le détail d'un déplacement.
 */
export function elementsASaisir(contenu: ContenuASaisir, paysLabel: (code: string) => string = c => c): ElementASaisir[] {
  return [
    ...(contenu.absences ?? []).filter(x => !x.codeSage)
      .map(x => ({ famille: 'absences', empId: x.empId, periode: x.periode, rubrique: x.rubrique, quantite: x.quantite, detail: detailElement(x, periodeLabel) })),
    ...(contenu.deplacements ?? []).filter(x => !x.codeSage)
      .map(x => ({ famille: 'deplacements', empId: x.empId, periode: x.periode, rubrique: x.rubrique, quantite: x.quantite, detail: detailDeplacement(x, paysLabel, periodeLabel) })),
    ...(contenu.rachats ?? []).filter(x => !x.codeSage)
      .map(x => ({ famille: 'rachats', empId: x.empId, periode: x.periode, rubrique: x.rubrique, quantite: x.quantite, detail: detailRachat(x) })),
    ...(contenu.aSaisir ?? []),
  ];
}

/** « Cécile Roux : ETR_JOUR 5 (Maroc · du …) » : une ligne par élément, pour l'écran. */
export const ligneASaisir = (x: ElementASaisir, nom: (empId: number) => string) =>
  `${nom(x.empId)} : ${x.rubrique ? `${x.rubrique} ` : ''}${x.quantite.toLocaleString('fr-FR')} (${x.detail})`;
