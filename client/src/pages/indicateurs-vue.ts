// lot 11 — indicateurs (t197) : mise en forme, sans React, des indicateurs sociaux reçus du serveur (déjà masqués) pour
// l'écran Indicateurs sociaux (pages/Indicateurs.tsx), son impression et la BDESE. Rien n'est recalculé ici : chaque
// chiffre est une case de la réponse du serveur, masquée « < k » comme elle y est. Une case masquée d'une année reste
// masquée dans la BDESE ; aucune somme ni différence n'est faite dans le navigateur.
import { CATEGORIES_EMPLOI, type Case, type GroupeIndicateurs, GROUPES_BDESE, GROUPES_INDICATEURS, type IndicateursLegaux, INDICATEURS_INDEX, NON_RENSEIGNE, SEXES, type TableauIndicateur } from '../../../shared/rules/indicateurs-legaux.ts';
import { fmtIso } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
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
export const aideMasque = (seuil: number) => `${t('Masked: fewer than ')}${seuil}${t(' people, or cell that a total would allow to find (anonymity threshold)')}`;

/** Lignes d'un tableau en texte (impression), « < k » pour une case masquée. */
export function lignesTexte(tb: TableauIndicateur, seuil: number): string[][] {
  return tb.lignes.map((l, i) => [l, ...tb.colonnes.map((_, j) => texteCase(tb.cases[i]?.[j], seuil))]);
}

/** Définition et complétude d'un tableau, en une phrase. */
export const noteTableau = (tb: TableauIndicateur) =>
  [tb.definition, tb.completude != null ? `${t('Completeness: ')}${tb.completude} %${tb.completudeTexte ? ` (${tb.completudeTexte})` : ''}.` : ''].filter(Boolean).join(' ');

/** Sections d'impression de tableaux (impression de l'onglet). */
export function sectionsTableaux(tableaux: readonly TableauIndicateur[], seuil: number): PrintSection[] {
  return tableaux.map(tb => ({ title: tb.titre, table: { head: [tb.dimension, ...tb.colonnes], rows: lignesTexte(tb, seuil) }, text: noteTableau(tb) }));
}

/** Sous-titre d'un document ou de l'écran : année, groupement, seuil, règles, calcul ou arrêté. */
export function origine(r: IndicateursLegaux & { arrete?: { id: number; annule: boolean } | null }): string {
  return [
    r.libelle, `${t('grouping: ')}${GROUPES_INDICATEURS[r.groupe].toLowerCase()}`, `${t('anonymity threshold ')}${r.seuil}`, `${t('rules ')}${r.regles}`,
    r.arrete ? `${t('freeze no. ')}${r.arrete.id}${r.arrete.annule ? t(' (cancelled)#masc') : ''}` : `${t('calculated on ')}${fmtIso(r.calculeLe)}`,
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
  return k.size <= 1 ? `${t('anonymity threshold ')}${annees[0]?.seuil ?? ''}`.trim() : `${t('anonymity thresholds: ')}${annees.map(a => `${a.annee}${t(': ')}${a.seuil}`).join(', ')}`;
}

/** Colonne d'une année (en-tête d'impression) : année, arrêté, seuil. */
export const colonneAnnee = (a: AnneeBdese) => `${a.annee} (${a.arrete ? `${t('freeze no. ')}${a.arrete}, ` : `${t('calculation of the day')}, `}${t('threshold ')}${a.seuil})`;
/** Groupements lus pour la BDESE : tous figés par un arrêté (server/src/indicateurs.ts, GROUPES_ARRETE). */
export { GROUPES_BDESE };

export interface LigneBdese { libelle: string; cases: (Case | undefined)[]; suffixe?: string }
export interface BlocBdese { titre: string; lignes: LigneBdese[] }

/** Ligne : même case lue dans la réponse de chaque année. */
const ligne = (annees: readonly AnneeBdese[], libelle: string, g: GroupeIndicateurs, id: string, l: string | null, col: number, suffixe?: string): LigneBdese =>
  ({ libelle, cases: annees.map(a => caseDe(tableauDe(a.r[g], id), l, col)), suffixe });

/** Modalités d'un groupement lues dans la réponse la plus récente (hors total). */
const modalites = (annees: readonly AnneeBdese[], g: GroupeIndicateurs, id: string) => {
  const tb = [...annees].reverse().map(a => tableauDe(a.r[g], id)).find(Boolean);
  return tb ? tb.lignes.filter(l => l !== 'Total') : [];
};

/** Rubrique 1° (investissement social) : effectifs, contrats, catégories, âges, ancienneté, mouvements, formation, absentéisme. */
export function rubrique1(annees: readonly AnneeBdese[]): BlocBdese[] {
  const parTranche = (id: string) => modalites(annees, 'aucun', id).map(l => ligne(annees, l, 'aucun', id, l, 3));
  return [
    { titre: t('Headcounts'), lignes: [
      ligne(annees, t('Headcount at 31 December'), 'aucun', 'effectifs', null, 0),
      ligne(annees, t('Average headcount (Social security)'), 'aucun', 'effectifs', null, 1),
      ligne(annees, t('Full-time equivalents at 31 December'), 'aucun', 'effectifs', null, 2),
      ligne(annees, t('Headcount under the Labour Code (L1111-2)'), 'aucun', 'effectifs', null, 3),
      ligne(annees, t('Temporary workers (average)'), 'aucun', 'effectifs', null, 4),
    ] },
    { titre: t('Headcount at 31 December by nature of the contract'), lignes: modalites(annees, 'contrat', 'effectifs').map(l => ligne(annees, l, 'contrat', 'effectifs', l, 0)) },
    { titre: t('Jobs by category (headcount at 31 December)'), lignes: modalites(annees, 'categorie', 'effectifs').map(l => ligne(annees, l, 'categorie', 'effectifs', l, 0)) },
    { titre: t('Age at 31 December'), lignes: parTranche('ages') },
    { titre: t('Seniority at 31 December'), lignes: parTranche('anciennete') },
    { titre: t('Arrivals and departures'), lignes: [
      ligne(annees, t('Arrivals'), 'aucun', 'mouvements', null, 0),
      ligne(annees, t('Departures'), 'aucun', 'mouvements', null, 1),
      ligne(annees, t('Planned ends of contract'), 'aucun', 'mouvements', null, 2),
      ligne(annees, t('Turnover rate'), 'aucun', 'mouvements', null, 3, ' %'),
    ] },
    { titre: t('Training#course'), lignes: [
      ligne(annees, t('Trainees'), 'aucun', 'formation', null, 0),
      ligne(annees, t('Training hours'), 'aucun', 'formation', null, 1),
      ligne(annees, t('Hours per trainee'), 'aucun', 'formation', null, 2),
      ligne(annees, t('Access rate'), 'aucun', 'formation', null, 3, ' %'),
    ] },
    { titre: t('Working conditions: absenteeism'), lignes: [
      ligne(annees, t('Absenteeism rate'), 'aucun', 'absenteisme', null, 2, ' %'),
      ligne(annees, t('of which illness'), 'aucun', 'absenteisme', null, 3, ' %'),
      ligne(annees, t('of which accidents at work, commuting accidents, occupational diseases'), 'aucun', 'absenteisme', null, 4, ' %'),
    ] },
  ];
}

/** Rubrique 2° (égalité professionnelle) : par sexe, embauches, sorties, formation, absentéisme, effectifs par catégorie. */
export function rubrique2(annees: readonly AnneeBdese[]): BlocBdese[] {
  const sexes = [...Object.values(SEXES).map(s => s.pluriel), NON_RENSEIGNE];
  const parSexe = (titre: string, id: string, col: number, suffixe?: string): BlocBdese =>
    ({ titre: t(titre), lignes: sexes.map(s => ligne(annees, s, 'sexe', id, s, col, suffixe)) });
  return [
    parSexe('Headcount at 31 December', 'effectifs', 0),
    parSexe('Hirings (arrivals)', 'mouvements', 0),
    parSexe('Departures', 'mouvements', 1),
    parSexe('Trainees of the training', 'formation', 0),
    parSexe('Training hours', 'formation', 1),
    parSexe('Access rate to training', 'formation', 3, ' %'),
    parSexe('Absenteeism rate (working conditions)', 'absenteisme', 2, ' %'),
    { titre: t('Headcounts taken into account for the index, by category (women / men)'), lignes: Object.values(CATEGORIES_EMPLOI).flatMap(c => [
      ligne(annees, `${c.pluriel}${t(' — women')}`, 'aucun', 'indexEffectifs', c.pluriel, 0),
      ligne(annees, `${c.pluriel}${t(' — men')}`, 'aucun', 'indexEffectifs', c.pluriel, 1),
    ]) },
  ];
}

/** Ce que la rubrique 1° ou 2° demande et que Cursus ne fournit pas (encore), avec sa source attendue (chaînes sources anglaises, traduites au rendu). */
export const MANQUES_BDESE: readonly { rubrique: string; quoi: string; source: string }[] = [
  { rubrique: '1°', quoi: 'Employment of disabled workers', source: 'annual declaration (DOETH) of the DSN, in Sage: health data, never entered in Cursus' },
  { rubrique: '1°', quoi: 'Interns (internship agreements)', source: 'HR: internship agreements have no sheet in Cursus' },
  { rubrique: '1°', quoi: 'Working time and part time', source: 'regime of each sheet known to Cursus; count by regime to add (not calculated to date)' },
  { rubrique: '1°', quoi: 'Declared accidents at work, frequency and severity rates', source: 'Vigie (accident declarations); Cursus only has the days off work' },
  { rubrique: '1° and 2°', quoi: 'Outlook (years N+1 to N+3)', source: 'management: projections, without entry in Cursus' },
  { rubrique: '2°', quoi: 'Promotions, qualification and classification by sex', source: 'HR and Sage (coefficients of the collective agreement): no classification history in Cursus' },
  { rubrique: '2°', quoi: 'Actual pay by sex and category', source: 'Sage (no pay in Cursus)' },
];

/** Rubriques 3° à 10° de l'article R2312-9 : hors de Cursus, avec leur source attendue. */
export const RUBRIQUES_HORS_CURSUS: readonly { numero: string; titre: string; source: string }[] = [
  { numero: '3°', titre: 'Equity, debt and taxes', source: 'accounting' },
  { numero: '4°', titre: 'Pay of the employees and executives', source: 'Sage (payroll): no pay in Cursus' },
  { numero: '5°', titre: 'Staff representation and social and cultural activities', source: 'CSE and accounts' },
  { numero: '6°', titre: 'Pay of the funders', source: 'accounting' },
  { numero: '7°', titre: 'Financial flows towards the company', source: 'accounting' },
  { numero: '8°', titre: 'Partnerships', source: 'management' },
  { numero: '9°', titre: 'Commercial and financial transfers between the entities of the group', source: 'accounts of the group' },
  { numero: '10°', titre: 'Environment (environmental consequences of the activity)', source: 'Vigie and QHSE department' },
];

/** Sections d'impression de la BDESE : rubriques 1° et 2° remplies, manques et rubriques 3° à 10° listés. */
export function sectionsBdese(annees: readonly AnneeBdese[]): PrintSection[] {
  const head = [t('Indicator'), ...annees.map(colonneAnnee)];
  const bloc = (rub: string) => (b: BlocBdese): PrintSection => ({
    title: `${rub} — ${b.titre}`, table: { head, rows: b.lignes.map(l => [l.libelle, ...l.cases.map((c, i) => texteCase(c, annees[i].seuil, l.suffixe))]) },
  });
  const seuils = new Set(annees.map(a => a.seuil));
  const k = seuils.size === 1 ? String(annees[0].seuil) : 'k';
  return [
    ...rubrique1(annees).map(bloc(t('1° Social investment'))),
    ...rubrique2(annees).map(bloc(t('2° Gender equality at work'))),
    { title: t('To complete outside Cursus (headings 1° and 2°)'), table: { head: [t('Heading'), t('Indicator'), t('Source')], rows: MANQUES_BDESE.map(m => [t(m.rubrique), t(m.quoi), t(m.source)]) } },
    { title: t('Headings 3° to 10° (outside Cursus)'), table: { head: [t('Heading'), t('Theme'), t('Source')], rows: RUBRIQUES_HORS_CURSUS.map(r => [r.numero, t(r.titre), t(r.source)]) } },
    { title: t('Reading'), text: `${t('Figures of Cursus calculated over the calendar year, or frozen by the freeze of the year when there is one. “< #open')}${k}${t('”: cell masked under the anonymity threshold (fewer than ')}${k}${t(' people) or that would allow to find a masked cell by difference.')}${seuils.size === 1 ? '' : `${t(' Each year keeps the threshold of its freeze or of the calculation (')}${texteSeuils(annees).replace(t('anonymity thresholds: '), '')}).`}` },
  ];
}

// — Égalité professionnelle : préparation de l'index —

/** Sections d'impression de l'onglet Égalité. */
export function sectionsEgalite(r: IndicateursLegaux): PrintSection[] {
  const x = r.index;
  return [
    ...sectionsTableaux([x.effectifs], r.seuil),
    { title: t('Groups of indicator 1'), rows: [
      [t('Valid groups (at least 3 women and 3 men)'), `${x.groupesValides}${t(' out of ')}${x.groupes}`],
      [t('Share of the headcount in these groups'), x.partGroupesValides == null ? '—' : `${x.partGroupesValides} %`],
      [t('Returns from maternity or adoption leave'), texteCase(x.retoursMaternite, r.seuil)],
    ] },
    { title: t('Indicators of the index'), table: { head: [t('No.'), t('Indicator'), t('Points'), t('State'), t('Source')], rows: x.indicateurs.map(i => [String(i.numero), i.libelle, String(i.points), etatIndex(i.etat), i.source]) } },
  ];
}

/** Libellé de l'état d'un indicateur de l'index. */
export const etatIndex = (etat: (typeof INDICATEURS_INDEX)[number]['etat']) => (etat === 'hors_cursus' ? t('Outside Cursus') : t('Partly prepared'));

// — Arrêtés —

/** Arrêté en vigueur (non annulé) de l'année. */
export const arreteEnVigueur = (arretes: readonly ArreteIndicateurs[] | undefined, annee: number) => (arretes ?? []).find(a => a.annee === annee && !a.annuleLe) ?? null;

/** Confirmation de l'arrêté de l'année (administrateur RH). */
export function confirmationArreter(annee: number, seuil: number): Confirmation {
  return {
    titre: `${t('Freeze the indicators ')}${annee}`,
    question: `${t('Freeze the social indicators of ')}${annee}${t(' for the BDESE?')}`,
    suites: [
      `${t('The aggregates of the year, already masked at the current anonymity threshold (')}${seuil}${t('), are frozen by grouping (overall, sex, category, status, contract) with the version of the rules.')}`,
      t('The retention purges and the corrections made afterwards no longer change these figures.'),
      t('The freeze is never deleted: it is cancelled with a reason, then a new freeze can be taken.'),
    ],
    bouton: `${t('Freeze ')}${annee}`,
    action: 'indicateurs.arreter',
    payload: { annee },
  };
}

/** Confirmation de l'annulation d'un arrêté (administrateur RH), motif obligatoire. */
export function confirmationAnnuler(a: Pick<ArreteIndicateurs, 'id' | 'annee' | 'cseLe'>): Confirmation {
  return {
    titre: `${t('Cancel the freeze no. ')}${a.id}`,
    question: `${t('Cancel the freeze of the indicators ')}${a.annee}${t('?#question')}`,
    suites: [
      t('The freeze stays readable, marked cancelled; a new freeze of the year can then be taken.'),
      a.cseLe ? `${t('It was made available to the CSE on ')}${fmtIso(a.cseLe)}${t(': tell the elected members about the new version.')}` : '',
    ].filter(Boolean),
    bouton: t('Cancel the freeze'),
    action: 'indicateurs.annulerArrete',
    payload: { id: a.id },
    motif: {
      label: t('Reason for the cancellation'), requis: true, placeholder: t('Correction of the departures of December, categories taken from Sage…'),
      aide: t('The reason stays with the freeze, read by HR only; it is never written in the log nor shown in read only.'),
    },
  };
}

/** Résumé d'un arrêté : date, auteur (service RH seulement), CSE, annulation. */
export function resumeArrete(a: ArreteIndicateurs): string {
  return [
    `${t('Frozen on ')}${fmtIso(a.arreteLe.slice(0, 10))}${a.arretePar ? `${t(' by ')}${a.arretePar}` : ''}`,
    `${t('threshold ')}${a.seuil}`, `${t('rules ')}${a.reglesVersion}`,
    a.cseLe ? `${t('made available to the CSE on ')}${fmtIso(a.cseLe)}` : t('not yet made available to the CSE'),
    a.annuleLe ? `${t('cancelled on ')}${fmtIso(a.annuleLe.slice(0, 10))}${a.annulePar ? `${t(' by ')}${a.annulePar}` : ''}` : '',
  ].filter(Boolean).join(' · ');
}

/** Nombre de cases masquées d'une réponse (tableaux et index), pour le résumé de l'écran. */
export function casesMasquees(r: IndicateursLegaux): number {
  const n = (tb: TableauIndicateur) => tb.cases.flat().filter(c => c.masque).length;
  return r.tableaux.reduce((s, tb) => s + n(tb), n(r.index.effectifs) + (r.index.retoursMaternite.masque ? 1 : 0));
}
export const texteMasquees = (n: number) => tn(n, 'cell masked', 'cells masked');
