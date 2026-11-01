// lot 11 — indicateurs (t197) : mise en forme, sans React, des indicateurs sociaux reçus du serveur (déjà masqués) pour
// l'écran Indicateurs sociaux (pages/Indicateurs.tsx), son impression et la BDESE. Rien n'est recalculé ici : chaque
// chiffre est une case de la réponse du serveur, masquée « < k » comme elle y est. Une case masquée d'une année reste
// masquée dans la BDESE ; aucune somme ni différence n'est faite dans le navigateur.
import { CATEGORIES_EMPLOI, type Case, type GroupeIndicateurs, GROUPES_BDESE, GROUPES_INDICATEURS, type IndicateursLegaux, INDICATEURS_INDEX, NON_RENSEIGNE, SEXES, type TableauIndicateur } from '../../../shared/rules/indicateurs-legaux.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import type { ArreteIndicateurs } from '../../../shared/types.ts';
import { texteCase } from '../components/graphiques/commun.ts';
import type { PrintSection } from '../print.ts';
import type { Confirmation } from '../state/confirmations.ts';

/** Tableau de la réponse par son identifiant (shared/rules/indicateurs-legaux.ts). */
export const tableauDe = (r: IndicateursLegaux | null | undefined, id: string) => r?.tableaux.find(t => t.id === id) ?? (id === 'indexEffectifs' ? r?.index.effectifs : undefined);

/** Case d'un tableau : ligne par libellé (« Total » ou « Ensemble » : la dernière ligne), colonne par position. */
export function caseDe(t: TableauIndicateur | undefined, ligne: string | null, colonne: number): Case | undefined {
  if (!t) return undefined;
  const i = ligne == null || ligne === 'Total' || ligne === GROUPES_INDICATEURS.aucun ? t.lignes.length - 1 : t.lignes.indexOf(ligne);
  return i < 0 ? undefined : t.cases[i]?.[colonne];
}

/** Libellé de l'aide d'une case masquée. */
export const aideMasque = (seuil: number) => `Masqué : moins de ${seuil} personnes, ou case qu’un total permettrait de retrouver (seuil d’anonymat)`;

/** Lignes d'un tableau en texte (impression), « < k » pour une case masquée. */
export function lignesTexte(t: TableauIndicateur, seuil: number): string[][] {
  return t.lignes.map((l, i) => [l, ...t.colonnes.map((_, j) => texteCase(t.cases[i]?.[j], seuil))]);
}

/** Définition et complétude d'un tableau, en une phrase. */
export const noteTableau = (t: TableauIndicateur) =>
  [t.definition, t.completude != null ? `Complétude : ${t.completude} %${t.completudeTexte ? ` (${t.completudeTexte})` : ''}.` : ''].filter(Boolean).join(' ');

/** Sections d'impression de tableaux (impression de l'onglet). */
export function sectionsTableaux(tableaux: readonly TableauIndicateur[], seuil: number): PrintSection[] {
  return tableaux.map(t => ({ title: t.titre, table: { head: [t.dimension, ...t.colonnes], rows: lignesTexte(t, seuil) }, text: noteTableau(t) }));
}

/** Sous-titre d'un document ou de l'écran : année, groupement, seuil, règles, calcul ou arrêté. */
export function origine(r: IndicateursLegaux & { arrete?: { id: number; annule: boolean } | null }): string {
  return [
    r.libelle, `groupement : ${GROUPES_INDICATEURS[r.groupe].toLowerCase()}`, `seuil d’anonymat ${r.seuil}`, `règles ${r.regles}`,
    r.arrete ? `arrêté n° ${r.arrete.id}${r.arrete.annule ? ' (annulé)' : ''}` : `calculé le ${fmtIso(r.calculeLe)}`,
  ].join(' · ');
}

// — BDESE (art. R2312-9, entreprise de moins de 300 salariés, sans accord) —

/**
 * Réponses d'une année de la BDESE, par groupement (null : indisponible), avec le seuil d'anonymat de l'année : celui de
 * son arrêté quand elle est arrêtée (figé avec les agrégats), sinon celui du calcul du jour. Chaque colonne de la BDESE
 * s'affiche « < k » avec son propre seuil (un réglage changé après un arrêté ne change pas les cases de l'arrêté).
 */
export type AnneeBdese = { annee: number; arrete: number | null; seuil: number; r: Partial<Record<GroupeIndicateurs, IndicateursLegaux | null>> };

/** Seuil d'une année : celui de sa réponse d'ensemble (arrêté ou calcul), à défaut le réglage actuel. */
export const seuilAnnee = (r: AnneeBdese['r'], defaut: number) => r.aucun?.seuil ?? Object.values(r).find(x => x)?.seuil ?? defaut;

/** Seuils des années de la BDESE en clair : un seul quand ils sont égaux, sinon celui de chaque année. */
export function texteSeuils(annees: readonly AnneeBdese[]): string {
  const k = new Set(annees.map(a => a.seuil));
  return k.size <= 1 ? `seuil d’anonymat ${annees[0]?.seuil ?? ''}`.trim() : `seuils d’anonymat : ${annees.map(a => `${a.annee} : ${a.seuil}`).join(', ')}`;
}

/** Colonne d'une année (en-tête d'impression) : année, arrêté, seuil. */
export const colonneAnnee = (a: AnneeBdese) => `${a.annee} (${a.arrete ? `arrêté n° ${a.arrete}, ` : 'calcul du jour, '}seuil ${a.seuil})`;
/** Groupements lus pour la BDESE : tous figés par un arrêté (server/src/indicateurs.ts, GROUPES_ARRETE). */
export { GROUPES_BDESE };

export interface LigneBdese { libelle: string; cases: (Case | undefined)[]; suffixe?: string }
export interface BlocBdese { titre: string; lignes: LigneBdese[] }

/** Ligne : même case lue dans la réponse de chaque année. */
const ligne = (annees: readonly AnneeBdese[], libelle: string, g: GroupeIndicateurs, id: string, l: string | null, col: number, suffixe?: string): LigneBdese =>
  ({ libelle, cases: annees.map(a => caseDe(tableauDe(a.r[g], id), l, col)), suffixe });

/** Modalités d'un groupement lues dans la réponse la plus récente (hors total). */
const modalites = (annees: readonly AnneeBdese[], g: GroupeIndicateurs, id: string) => {
  const t = [...annees].reverse().map(a => tableauDe(a.r[g], id)).find(Boolean);
  return t ? t.lignes.filter(l => l !== 'Total') : [];
};

/** Rubrique 1° (investissement social) : effectifs, contrats, catégories, âges, ancienneté, mouvements, formation, absentéisme. */
export function rubrique1(annees: readonly AnneeBdese[]): BlocBdese[] {
  const parTranche = (id: string) => modalites(annees, 'aucun', id).map(l => ligne(annees, l, 'aucun', id, l, 3));
  return [
    { titre: 'Effectifs', lignes: [
      ligne(annees, 'Effectif au 31 décembre', 'aucun', 'effectifs', null, 0),
      ligne(annees, 'Effectif moyen (Sécurité sociale)', 'aucun', 'effectifs', null, 1),
      ligne(annees, 'Équivalents temps plein au 31 décembre', 'aucun', 'effectifs', null, 2),
      ligne(annees, 'Effectif du Code du travail (L1111-2)', 'aucun', 'effectifs', null, 3),
      ligne(annees, 'Intérimaires (moyenne)', 'aucun', 'effectifs', null, 4),
    ] },
    { titre: 'Effectif au 31 décembre par nature du contrat', lignes: modalites(annees, 'contrat', 'effectifs').map(l => ligne(annees, l, 'contrat', 'effectifs', l, 0)) },
    { titre: 'Emplois par catégorie (effectif au 31 décembre)', lignes: modalites(annees, 'categorie', 'effectifs').map(l => ligne(annees, l, 'categorie', 'effectifs', l, 0)) },
    { titre: 'Âge au 31 décembre', lignes: parTranche('ages') },
    { titre: 'Ancienneté au 31 décembre', lignes: parTranche('anciennete') },
    { titre: 'Entrées et sorties', lignes: [
      ligne(annees, 'Entrées', 'aucun', 'mouvements', null, 0),
      ligne(annees, 'Sorties', 'aucun', 'mouvements', null, 1),
      ligne(annees, 'Fins de contrat prévues', 'aucun', 'mouvements', null, 2),
      ligne(annees, 'Taux de rotation', 'aucun', 'mouvements', null, 3, ' %'),
    ] },
    { titre: 'Formation', lignes: [
      ligne(annees, 'Stagiaires', 'aucun', 'formation', null, 0),
      ligne(annees, 'Heures de formation', 'aucun', 'formation', null, 1),
      ligne(annees, 'Heures par stagiaire', 'aucun', 'formation', null, 2),
      ligne(annees, 'Taux d’accès', 'aucun', 'formation', null, 3, ' %'),
    ] },
    { titre: 'Conditions de travail : absentéisme', lignes: [
      ligne(annees, 'Taux d’absentéisme', 'aucun', 'absenteisme', null, 2, ' %'),
      ligne(annees, 'dont maladie', 'aucun', 'absenteisme', null, 3, ' %'),
      ligne(annees, 'dont accidents du travail, de trajet, maladies professionnelles', 'aucun', 'absenteisme', null, 4, ' %'),
    ] },
  ];
}

/** Rubrique 2° (égalité professionnelle) : par sexe, embauches, sorties, formation, absentéisme, effectifs par catégorie. */
export function rubrique2(annees: readonly AnneeBdese[]): BlocBdese[] {
  const sexes = [...Object.values(SEXES).map(s => s.pluriel), NON_RENSEIGNE];
  const parSexe = (titre: string, id: string, col: number, suffixe?: string): BlocBdese =>
    ({ titre, lignes: sexes.map(s => ligne(annees, s, 'sexe', id, s, col, suffixe)) });
  return [
    parSexe('Effectif au 31 décembre', 'effectifs', 0),
    parSexe('Embauches (entrées)', 'mouvements', 0),
    parSexe('Sorties', 'mouvements', 1),
    parSexe('Stagiaires de la formation', 'formation', 0),
    parSexe('Heures de formation', 'formation', 1),
    parSexe('Taux d’accès à la formation', 'formation', 3, ' %'),
    parSexe('Taux d’absentéisme (conditions de travail)', 'absenteisme', 2, ' %'),
    { titre: 'Effectifs pris en compte pour l’index, par catégorie (femmes / hommes)', lignes: Object.values(CATEGORIES_EMPLOI).flatMap(c => [
      ligne(annees, `${c.pluriel} — femmes`, 'aucun', 'indexEffectifs', c.pluriel, 0),
      ligne(annees, `${c.pluriel} — hommes`, 'aucun', 'indexEffectifs', c.pluriel, 1),
    ]) },
  ];
}

/** Ce que la rubrique 1° ou 2° demande et que Cursus ne fournit pas (encore), avec sa source attendue. */
export const MANQUES_BDESE: readonly { rubrique: string; quoi: string; source: string }[] = [
  { rubrique: '1°', quoi: 'Emploi des travailleurs handicapés', source: 'déclaration annuelle (DOETH) de la DSN, dans Sage : donnée de santé, jamais saisie dans Cursus' },
  { rubrique: '1°', quoi: 'Stagiaires (conventions de stage)', source: 'service RH : les conventions de stage n’ont pas de fiche dans Cursus' },
  { rubrique: '1°', quoi: 'Durée du travail et temps partiel', source: 'régime de chaque fiche connu de Cursus ; décompte par régime à ajouter (non calculé à ce jour)' },
  { rubrique: '1°', quoi: 'Accidents du travail déclarés, taux de fréquence et de gravité', source: 'Vigie (déclarations d’accident) ; Cursus n’a que les jours d’arrêt' },
  { rubrique: '1° et 2°', quoi: 'Perspectives (années N+1 à N+3)', source: 'direction : projections, sans saisie dans Cursus' },
  { rubrique: '2°', quoi: 'Promotions, qualification et classification par sexe', source: 'service RH et Sage (coefficients de la CCN) : pas d’historique de classification dans Cursus' },
  { rubrique: '2°', quoi: 'Rémunération effective par sexe et catégorie', source: 'Sage (aucune rémunération dans Cursus)' },
];

/** Rubriques 3° à 10° de l'article R2312-9 : hors de Cursus, avec leur source attendue. */
export const RUBRIQUES_HORS_CURSUS: readonly { numero: string; titre: string; source: string }[] = [
  { numero: '3°', titre: 'Fonds propres, endettement et impôts', source: 'comptabilité' },
  { numero: '4°', titre: 'Rémunération des salariés et dirigeants', source: 'Sage (paie) : aucune rémunération dans Cursus' },
  { numero: '5°', titre: 'Représentation du personnel et activités sociales et culturelles', source: 'CSE et comptabilité' },
  { numero: '6°', titre: 'Rémunération des financeurs', source: 'comptabilité' },
  { numero: '7°', titre: 'Flux financiers à destination de l’entreprise', source: 'comptabilité' },
  { numero: '8°', titre: 'Partenariats', source: 'direction' },
  { numero: '9°', titre: 'Transferts commerciaux et financiers entre les entités du groupe', source: 'comptabilité du groupe' },
  { numero: '10°', titre: 'Environnement (conséquences environnementales de l’activité)', source: 'Vigie et service QHSE' },
];

/** Sections d'impression de la BDESE : rubriques 1° et 2° remplies, manques et rubriques 3° à 10° listés. */
export function sectionsBdese(annees: readonly AnneeBdese[]): PrintSection[] {
  const head = ['Indicateur', ...annees.map(colonneAnnee)];
  const bloc = (rub: string) => (b: BlocBdese): PrintSection => ({
    title: `${rub} — ${b.titre}`, table: { head, rows: b.lignes.map(l => [l.libelle, ...l.cases.map((c, i) => texteCase(c, annees[i].seuil, l.suffixe))]) },
  });
  const seuils = new Set(annees.map(a => a.seuil));
  const k = seuils.size === 1 ? String(annees[0].seuil) : 'k';
  return [
    ...rubrique1(annees).map(bloc('1° Investissement social')),
    ...rubrique2(annees).map(bloc('2° Égalité professionnelle')),
    { title: 'À compléter hors de Cursus (rubriques 1° et 2°)', table: { head: ['Rubrique', 'Indicateur', 'Source'], rows: MANQUES_BDESE.map(m => [m.rubrique, m.quoi, m.source]) } },
    { title: 'Rubriques 3° à 10° (hors de Cursus)', table: { head: ['Rubrique', 'Thème', 'Source'], rows: RUBRIQUES_HORS_CURSUS.map(r => [r.numero, r.titre, r.source]) } },
    { title: 'Lecture', text: `Chiffres de Cursus calculés sur l’année civile, ou figés par l’arrêté de l’année quand il existe. « < ${k} » : case masquée sous le seuil d’anonymat (moins de ${k} personnes) ou qui permettrait de retrouver une case masquée par différence.${seuils.size === 1 ? '' : ` Chaque année garde le seuil de son arrêté ou du calcul (${texteSeuils(annees).replace('seuils d’anonymat : ', '')}).`}` },
  ];
}

// — Égalité professionnelle : préparation de l'index —

/** Sections d'impression de l'onglet Égalité. */
export function sectionsEgalite(r: IndicateursLegaux): PrintSection[] {
  const x = r.index;
  return [
    ...sectionsTableaux([x.effectifs], r.seuil),
    { title: 'Groupes de l’indicateur 1', rows: [
      ['Groupes valides (au moins 3 femmes et 3 hommes)', `${x.groupesValides} sur ${x.groupes}`],
      ['Part de l’effectif dans ces groupes', x.partGroupesValides == null ? '—' : `${x.partGroupesValides} %`],
      ['Retours de congé de maternité ou d’adoption', texteCase(x.retoursMaternite, r.seuil)],
    ] },
    { title: 'Indicateurs de l’index', table: { head: ['N°', 'Indicateur', 'Points', 'État', 'Source'], rows: x.indicateurs.map(i => [String(i.numero), i.libelle, String(i.points), i.etat === 'hors_cursus' ? 'Hors Cursus' : 'Préparé en partie', i.source]) } },
  ];
}

/** Libellé de l'état d'un indicateur de l'index. */
export const etatIndex = (etat: (typeof INDICATEURS_INDEX)[number]['etat']) => (etat === 'hors_cursus' ? 'Hors Cursus' : 'Préparé en partie');

// — Arrêtés —

/** Arrêté en vigueur (non annulé) de l'année. */
export const arreteEnVigueur = (arretes: readonly ArreteIndicateurs[] | undefined, annee: number) => (arretes ?? []).find(a => a.annee === annee && !a.annuleLe) ?? null;

/** Confirmation de l'arrêté de l'année (administrateur RH). */
export function confirmationArreter(annee: number, seuil: number): Confirmation {
  return {
    titre: `Arrêter les indicateurs ${annee}`,
    question: `Figer les indicateurs sociaux de ${annee} pour la BDESE ?`,
    suites: [
      `Les agrégats de l’année, déjà masqués au seuil d’anonymat actuel (${seuil}), sont figés par groupement (ensemble, sexe, catégorie, statut, contrat) avec la version des règles.`,
      'Les purges de conservation et les corrections faites ensuite ne changent plus ces chiffres.',
      'L’arrêté n’est jamais supprimé : il s’annule avec un motif, puis un nouvel arrêté peut être pris.',
    ],
    bouton: `Arrêter ${annee}`,
    action: 'indicateurs.arreter',
    payload: { annee },
  };
}

/** Confirmation de l'annulation d'un arrêté (administrateur RH), motif obligatoire. */
export function confirmationAnnuler(a: Pick<ArreteIndicateurs, 'id' | 'annee' | 'cseLe'>): Confirmation {
  return {
    titre: `Annuler l’arrêté n° ${a.id}`,
    question: `Annuler l’arrêté des indicateurs ${a.annee} ?`,
    suites: [
      'L’arrêté reste consultable, marqué annulé ; un nouvel arrêté de l’année peut ensuite être pris.',
      a.cseLe ? `Il a été mis à disposition du CSE le ${fmtIso(a.cseLe)} : prévenez les élus de la nouvelle version.` : '',
    ].filter(Boolean),
    bouton: 'Annuler l’arrêté',
    action: 'indicateurs.annulerArrete',
    payload: { id: a.id },
    motif: {
      label: 'Motif de l’annulation', requis: true, placeholder: 'Correction des sorties de décembre, catégories reprises de Sage…',
      aide: 'Le motif reste avec l’arrêté, lu par le service RH seulement ; il n’est jamais écrit au journal ni montré à la lecture seule.',
    },
  };
}

/** Résumé d'un arrêté : date, auteur (service RH seulement), CSE, annulation. */
export function resumeArrete(a: ArreteIndicateurs): string {
  return [
    `Arrêté le ${fmtIso(a.arreteLe.slice(0, 10))}${a.arretePar ? ` par ${a.arretePar}` : ''}`,
    `seuil ${a.seuil}`, `règles ${a.reglesVersion}`,
    a.cseLe ? `mis à disposition du CSE le ${fmtIso(a.cseLe)}` : 'pas encore mis à disposition du CSE',
    a.annuleLe ? `annulé le ${fmtIso(a.annuleLe.slice(0, 10))}${a.annulePar ? ` par ${a.annulePar}` : ''}` : '',
  ].filter(Boolean).join(' · ');
}

/** Nombre de cases masquées d'une réponse (tableaux et index), pour le résumé de l'écran. */
export function casesMasquees(r: IndicateursLegaux): number {
  const n = (t: TableauIndicateur) => t.cases.flat().filter(c => c.masque).length;
  return r.tableaux.reduce((s, t) => s + n(t), n(r.index.effectifs) + (r.index.retoursMaternite.masque ? 1 : 0));
}
export const texteMasquees = (n: number) => plural(n, 'case masquée', 'cases masquées');
