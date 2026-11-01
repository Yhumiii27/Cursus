// Indicateurs sociaux légaux (lot 11, chantier C3, t197) : BDESE d'une entreprise de moins de 300 salariés (art. R2312-9,
// rubriques 1° et 2°) et préparation de l'index d'égalité professionnelle (art. L1142-8, D1142-2). Règles pures, calculées
// par le serveur seulement (server/src/indicateurs.ts) sur toutes les données : la lecture seule ne reçoit ni les natures
// d'absence médicales, ni le sexe, ni la date de naissance, et les calculer dans le navigateur contournerait le masquage.
// - Chaque tableau porte sa définition (effectif de fin de période, moyen au sens de la Sécurité sociale, au sens du Code
//   du travail ; ETP ; absentéisme…) et son taux de complétude : un chiffre faux faute de donnée se signale, il ne se
//   cache pas.
// - Seuil d'anonymat (réglage `indicateursSeuil`, 5 par défaut, de 3 à 10) et masquage secondaire (`masquer`) : une case
//   qui porte sur moins de k personnes (effectif, ou personnes absentes, formées, sorties) est masquée « < k », et une
//   autre case du même groupe additif l'est aussi quand le total permettrait de la retrouver par différence : ligne ou
//   colonne avec son total, mais aussi les motifs d'absence d'une ligne avec leur taux, et les cases qui se déduisent
//   l'une de l'autre (taux de rotation et mouvements, jours et taux d'absence…). La réponse ne contient que des agrégats
//   déjà masqués, jamais un identifiant ni une liste nominative.
// - Une seule granularité, l'année civile : des sous-périodes masquées chacune à part se recouperaient (l'année moins
//   les onze autres mois redonnerait un mois masqué), et une date libre plus encore.
// Rien de ce qui est calculé ici n'est stocké, sauf l'arrêté annuel (table `indicateurs_arretes`), figé déjà masqué.
import { NATURES_ABSENCE, STATUTS, TYPES_CONTRAT } from '../constants.ts';
import { avecCalendrier, isFerie, weekday } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { Absence, CategorieEmploi, Employe, ISODate, NatureAbsence, Sexe, Statut } from '../types.ts';
import { absenceBloque } from './absences.ts';
import { MOTIFS_SORTIE } from './contrats.ts';
import { realisationsDe } from './heures-formation.ts';
import { employeAu } from './historique-contrat.ts';

/** Version des règles, gardée avec chaque arrêté : un chiffre figé se relit avec la définition de son calcul. */
export const REGLES_INDICATEURS = 'indicateurs-2026.1';

// — Sexe et catégorie d'emploi (données de la fiche) —

export const SEXES: Record<Sexe, { label: string; pluriel: string }> = {
  F: { label: 'Féminin', pluriel: 'Femmes' },
  M: { label: 'Masculin', pluriel: 'Hommes' },
};
export const CATEGORIES_EMPLOI: Record<CategorieEmploi, { label: string; pluriel: string }> = {
  ouvrier: { label: 'Ouvrier', pluriel: 'Ouvriers' },
  employe: { label: 'Employé', pluriel: 'Employés' },
  tam: { label: 'Technicien ou agent de maîtrise', pluriel: 'Techniciens et agents de maîtrise' },
  cadre: { label: 'Ingénieur ou cadre', pluriel: 'Ingénieurs et cadres' },
};
export const estSexe = (v: unknown): v is Sexe => typeof v === 'string' && Object.hasOwn(SEXES, v);
export const estCategorieEmploi = (v: unknown): v is CategorieEmploi => typeof v === 'string' && Object.hasOwn(CATEGORIES_EMPLOI, v);
/**
 * Catégorie proposée d'après le statut, corrigée par le service RH : technicien → technicien ou agent de maîtrise, cadre →
 * cadre ; ouvrier / employé : aucune proposition (le statut ne les sépare pas).
 */
export const categorieProposee = (s: Statut): CategorieEmploi | null => (s === 'technicien' ? 'tam' : s === 'cadre' ? 'cadre' : null);
/** Modalité d'une donnée absente de la fiche. */
export const NON_RENSEIGNE = 'Non renseigné';

// — Réglages —

export const SEUIL_INDICATEURS_DEFAUT = 5;
export const SEUIL_INDICATEURS_MIN = 3;
export const SEUIL_INDICATEURS_MAX = 10;
export const NATURES_ABSENTEISME_POSSIBLES = Object.keys(NATURES_ABSENCE) as NatureAbsence[];
/** Santé (arrêts, accidents, maladie professionnelle), enfant malade, sans solde, injustifiée ; hors congés et parentalité. */
export const NATURES_ABSENTEISME_DEFAUT: NatureAbsence[] = ['MALADIE', 'ALD', 'AT', 'TRAJET', 'MP', 'ENFANT_MALADE', 'SANS_SOLDE', 'INJUSTIFIEE'];

// — Périodes et groupements —

/**
 * Période calendaire imposée : l'année civile seulement. Trimestres et mois, calculés et masqués chacun à part, se
 * recouperaient avec l'année (une case masquée d'un mois = l'année moins les autres mois, visibles) ; un masquage
 * cohérent entre périodes emboîtées reste à faire avant de les rouvrir. Le paramètre est gardé pour ce jour-là.
 */
export const PERIODES_INDICATEURS = ['annee'] as const;
export type PeriodeIndicateurs = typeof PERIODES_INDICATEURS[number];
export const estPeriodeIndicateurs = (v: unknown): v is PeriodeIndicateurs => (PERIODES_INDICATEURS as readonly unknown[]).includes(v);
/** Années admises : de 2000 à 2100 (une faute de frappe ne lance pas un calcul de plusieurs siècles). */
export const anneeIndicateursValide = (a: number) => Number.isInteger(a) && a >= 2000 && a <= 2100;

const pad = (n: number) => String(n).padStart(2, '0');
const finDuMois = (annee: number, mois: number): ISODate => `${annee}-${pad(mois)}-${pad(new Date(Date.UTC(annee, mois, 0)).getUTCDate())}`;

/** Bornes et libellé d'une période calendaire ; null : année ou période refusée. */
export function bornesPeriode(annee: number, periode: PeriodeIndicateurs): { du: ISODate; au: ISODate; libelle: string } | null {
  if (!anneeIndicateursValide(annee) || !estPeriodeIndicateurs(periode)) return null;
  return { du: `${annee}-01-01`, au: `${annee}-12-31`, libelle: `Année ${annee}` };
}

/** Derniers jours des mois de la période (effectifs moyens). */
export function finsDeMois(du: ISODate, au: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let a = Number(du.slice(0, 4)), m = Number(du.slice(5, 7)); ; m === 12 ? (a++, m = 1) : m++) {
    const f = finDuMois(a, m);
    if (f > au) break;
    if (f >= du) out.push(f);
  }
  return out;
}

/** Groupement des lignes des tableaux. Le site et l'unité viendront avec l'organigramme (t195). */
export const GROUPES_INDICATEURS = {
  aucun: 'Ensemble', sexe: 'Sexe', categorie: 'Catégorie d’emploi', statut: 'Statut', contrat: 'Nature du contrat', equipe: 'Équipe',
} as const;
export type GroupeIndicateurs = keyof typeof GROUPES_INDICATEURS;
export const estGroupeIndicateurs = (v: unknown): v is GroupeIndicateurs => typeof v === 'string' && Object.hasOwn(GROUPES_INDICATEURS, v);
/** Groupements lus par la BDESE (écran, impression, export) : tous figés par un arrêté annuel (jamais l'équipe). */
export const GROUPES_BDESE: readonly GroupeIndicateurs[] = ['aucun', 'sexe', 'categorie', 'contrat'];

/** Modalité d'une fiche pour un groupement. L'équipe est celle de la fiche aujourd'hui (Cursus ne garde pas les mutations). */
export function modaliteDe(e: Employe, g: GroupeIndicateurs): string {
  switch (g) {
    case 'aucun': return GROUPES_INDICATEURS.aucun;
    case 'sexe': return e.sexe ? SEXES[e.sexe].pluriel : NON_RENSEIGNE;
    case 'categorie': return e.categorie ? CATEGORIES_EMPLOI[e.categorie].pluriel : NON_RENSEIGNE;
    case 'statut': return STATUTS[e.statut]?.label ?? e.statut;
    case 'contrat': return TYPES_CONTRAT[e.typeContrat]?.label ?? e.typeContrat;
    case 'equipe': return e.equipe ?? 'À affecter';
  }
}
/** Modalités d'un groupement, dans l'ordre des listes (équipes : par nom), « Non renseigné » en dernier. */
function modalites(g: GroupeIndicateurs, employes: readonly Employe[]): string[] {
  switch (g) {
    case 'aucun': return [GROUPES_INDICATEURS.aucun];
    case 'sexe': return [...Object.values(SEXES).map(s => s.pluriel), NON_RENSEIGNE];
    case 'categorie': return [...Object.values(CATEGORIES_EMPLOI).map(c => c.pluriel), NON_RENSEIGNE];
    case 'statut': return Object.values(STATUTS).map(s => s.label);
    case 'contrat': return Object.values(TYPES_CONTRAT).map(t => t.label);
    case 'equipe': return [...new Set(employes.map(e => modaliteDe(e, 'equipe')))].sort((a, b) => a.localeCompare(b, 'fr'));
  }
}

// — Seuil d'anonymat et masquage —

/**
 * Case calculée, avant masquage : valeur, personnes sur lesquelles elle porte (`n` : effectif de la case), et, pour une
 * mesure sur une partie d'entre elles, les personnes concernées (`n2` : absentes, formées, sorties…).
 */
export interface CaseBrute { valeur: number; n: number; n2?: number }
/** Case envoyée : valeur, ou null quand elle est masquée (« < k ») ; jamais l'effectif sous-jacent. */
export interface Case { valeur: number | null; masque: boolean }
/** Case d'un tableau : [ligne, colonne]. */
export type Position = readonly [number, number];
/**
 * Relations entre cases d'un tableau, que le masquage secondaire doit respecter :
 * - `totalLigne`, `totalColonne` : dernière ligne (total de chaque colonne), dernière colonne (total de chaque ligne) ;
 * - `groupes` : groupes additifs explicites, total en dernier (les taux par motif d'une ligne et le taux d'absentéisme) ;
 * - `lies` : cases qui se déduisent l'une de l'autre (jours et taux d'absence, stagiaires et taux d'accès), masquées ensemble ;
 * - `derives` : case calculée d'après ses sources (taux de rotation d'après les entrées et les sorties), masquée dès
 *   qu'une source l'est.
 */
export interface OptionsMasque {
  totalLigne?: boolean; totalColonne?: boolean;
  groupes?: readonly (readonly Position[])[];
  lies?: readonly (readonly Position[])[];
  derives?: readonly { cible: Position; sources: readonly Position[] }[];
}

/** Case sous le seuil : effectif ou personnes concernées de 1 à k - 1 (zéro n'est pas masqué : aucune personne). */
export const sousSeuil = (c: CaseBrute, k: number) => (c.n > 0 && c.n < k) || (c.n2 !== undefined && c.n2 > 0 && c.n2 < k);

/**
 * Masquage d'un tableau `cases[ligne][colonne]` au seuil `k` : masque primaire de chaque case sous le seuil, puis masque
 * secondaire. Chaque ligne (avec `totalColonne`), chaque colonne (avec `totalLigne`) et chaque groupe explicite forment,
 * avec leur total, un groupe additif : un groupe qui n'a qu'une case masquée la laisserait retrouver par différence, une
 * seconde y est masquée — la case visible de plus petit effectif (non nulle de préférence), sinon le total. Les cases
 * liées sont masquées ensemble, une case dérivée avec ses sources. Répété jusqu'à ce que plus rien ne change. Les taux
 * sont traités comme les comptes : par prudence, un taux masqué ne se recalcule pas non plus d'après le taux d'ensemble.
 */
export function masquer(cases: readonly (readonly CaseBrute[])[], k: number, o: OptionsMasque = {}): Case[][] {
  const masque = cases.map(l => l.map(c => sousSeuil(c, k)));
  const groupes: Position[][] = (o.groupes ?? []).map(g => [...g]);
  const nl = cases.length, nc = cases[0]?.length ?? 0;
  if (o.totalLigne && nl > 1) for (let j = 0; j < nc; j++) groupes.push(Array.from({ length: nl }, (_, i) => [i, j]));
  if (o.totalColonne && nc > 1) for (let i = 0; i < nl; i++) groupes.push(Array.from({ length: nc }, (_, j) => [i, j]));
  // Effectif d'une case pour le choix du masque secondaire : personnes concernées, sinon effectif.
  const effectif = (c: CaseBrute) => c.n2 ?? c.n;
  const masquerCase = ([i, j]: Position) => { if (!masque[i][j]) { masque[i][j] = true; return true; } return false; };
  for (let change = true; change;) {
    change = false;
    for (const l of o.lies ?? []) if (l.some(([i, j]) => masque[i][j])) for (const p of l) change = masquerCase(p) || change;
    for (const x of o.derives ?? []) if (x.sources.some(([i, j]) => masque[i][j])) change = masquerCase(x.cible) || change;
    for (const g of groupes) {
      if (g.filter(([i, j]) => masque[i][j]).length !== 1) continue;
      // Parties (le total est la dernière case du groupe) encore visibles, la plus petite d'abord, non nulle de préférence.
      const parties = g.slice(0, -1).filter(([i, j]) => !masque[i][j])
        .sort(([a, b], [c, d]) => Number(cases[a][b].valeur === 0) - Number(cases[c][d].valeur === 0) || effectif(cases[a][b]) - effectif(cases[c][d]) || a - c || b - d);
      masquerCase(parties[0] ?? g[g.length - 1]);
      change = true;
    }
  }
  return cases.map((l, i) => l.map((c, j) => (masque[i][j] ? { valeur: null, masque: true } : { valeur: c.valeur, masque: false })));
}

// — Tableaux —

/** Tableau d'un indicateur, déjà masqué : lignes (modalités, puis le total), colonnes (mesures ou modalités), définition. */
export interface TableauIndicateur {
  id: string;
  titre: string;
  /** Définition retenue, affichée avec chaque chiffre (CSE : effectif au sens du Code du travail ou de la Sécurité sociale…). */
  definition: string;
  /** Ce que désignent les lignes (groupement, tranche d'âge…). */
  dimension: string;
  lignes: string[];
  colonnes: string[];
  cases: Case[][];
  /** Part des données connues (%), null : sans objet ; et ce qui manque, en clair. */
  completude: number | null;
  completudeTexte: string | null;
}

/** État d'un indicateur de l'index d'égalité : calculé hors de Cursus (rémunérations dans Sage), ou préparé en partie. */
export interface IndicateurIndex { numero: 1 | 2 | 3 | 4; libelle: string; points: number; etat: 'hors_cursus' | 'partiel'; source: string }
export const INDICATEURS_INDEX: readonly IndicateurIndex[] = [
  { numero: 1, libelle: 'Écart de rémunération entre les femmes et les hommes', points: 40, etat: 'hors_cursus', source: 'Sage (rémunérations) et Egapro' },
  { numero: 2, libelle: 'Écart de taux d’augmentations individuelles', points: 35, etat: 'hors_cursus', source: 'Sage (augmentations) et Egapro' },
  { numero: 3, libelle: 'Salariées augmentées à leur retour de congé de maternité', points: 15, etat: 'partiel', source: 'Cursus (retours de congé) et Sage (augmentations)' },
  { numero: 4, libelle: 'Sexe sous-représenté parmi les dix plus hautes rémunérations', points: 10, etat: 'hors_cursus', source: 'Sage (rémunérations) et Egapro' },
];

/** Préparation de l'index d'égalité : ce que Cursus connaît ; les rémunérations restent dans Sage (aucune dans Cursus). */
export interface PreparationIndex {
  annee: number;
  /** Effectifs pris en compte par catégorie et par sexe (tableau masqué). */
  effectifs: TableauIndicateur;
  /** Groupes catégorie × tranche d'âge où chaque sexe compte au moins 3 personnes (règle d'Egapro), sur 16. */
  groupesValides: number;
  groupes: number;
  /** Part de l'effectif pris en compte dans ces groupes (%) ; null : aucun effectif. Sous 40 %, l'indicateur 1 n'est pas calculable. */
  partGroupesValides: number | null;
  /** Retours de congé de maternité ou d'adoption dans l'année (masqué sous le seuil). */
  retoursMaternite: Case;
  indicateurs: readonly IndicateurIndex[];
}

/** Résultat d'un calcul : période, groupement, seuil, tableaux masqués, index, avertissements. Aucune donnée individuelle. */
export interface IndicateursLegaux {
  regles: string;
  annee: number; periode: PeriodeIndicateurs; du: ISODate; au: ISODate; libelle: string;
  groupe: GroupeIndicateurs; seuil: number;
  /** Date du calcul (date du jour du serveur). */
  calculeLe: ISODate;
  tableaux: TableauIndicateur[];
  index: PreparationIndex;
  avertissements: string[];
}

const arrondi = (x: number) => Math.round(x * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? arrondi(a / b * 100) : 0);

/** Présent le `date` : entré au plus tard ce jour, et contrat pas encore terminé (`present` de contrats.ts ne lit pas l'entrée). */
export const presentA = (e: Pick<Employe, 'entree' | 'fin'>, date: ISODate) => e.entree <= date && (!e.fin || e.fin >= date);
/** Présent un jour au moins de la période. */
const presentDurant = (e: Pick<Employe, 'entree' | 'fin'>, du: ISODate, au: ISODate) => e.entree <= au && (!e.fin || e.fin >= du);
/** Intérimaire : salarié de l'entreprise de travail temporaire, hors des effectifs de l'entreprise utilisatrice (sauf L1111-2). */
const interim = (e: Employe) => e.typeContrat === 'interim';

/**
 * Fiche à compléter pour les indicateurs (étape 2) : salarié présent à `date`, hors intérimaires (absents des tableaux par
 * sexe et par catégorie), sans sexe ou sans catégorie d'emploi. Une seule échéance agrégée pour le service RH (« N fiches
 * sans sexe ou catégorie », écran Échéances) et le filtre « À compléter » de l'annuaire, jamais une échéance par fiche.
 */
export const aCompleterIndicateurs = (e: Employe, date: ISODate) => presentA(e, date) && !interim(e) && (!e.sexe || !e.categorie);
/** CDD ou mission de remplacement d'un salarié absent : exclu de l'effectif L1111-2. */
const remplacement = (e: Employe) => e.motifRecours === 'remplacement' || e.motifRecours === 'remplacement_suppression';

/**
 * Équivalent temps plein au `date`, d'après le régime en vigueur (historique des contrats) : temps partiel au prorata des
 * heures sur 35 h, forfait jours sur 218 jours, forfait annuel sur 1 607 h ; plein temps et forfait hebdomadaire : 1.
 */
export function etpA(d: Domain, e: Employe, date: ISODate): number {
  const c = d.contratOf(employeAu(d, e, date));
  if (c.partiel) return Math.min(1, c.base / 35);
  if (c.forfait) return Math.min(1, c.joursForfait / 218);
  if (c.annuel) return Math.min(1, c.heuresAnnuelles / 1607);
  return 1;
}

/** Groupement de cases par modalité : une ligne par modalité, puis la ligne Total (toutes les fiches). */
function parModalite(lignes: readonly string[], employes: readonly Employe[], g: GroupeIndicateurs, mesure: (es: readonly Employe[]) => CaseBrute[]): CaseBrute[][] {
  const out = lignes.map(m => mesure(employes.filter(e => modaliteDe(e, g) === m)));
  return g === 'aucun' ? out : [...out, mesure(employes)];
}

interface Contexte { d: Domain; du: ISODate; au: ISODate; g: GroupeIndicateurs; k: number; employes: readonly Employe[]; lignes: string[] }

/**
 * Tableau masqué, lignes du groupement plus le Total (sauf « Ensemble ») ; `relations` : relations entre les cases d'une
 * même ligne (colonnes), posées sur chaque ligne, Total compris.
 */
function tableauGroupe(x: Contexte, id: string, titre: string, definition: string, colonnes: string[], brutes: CaseBrute[][], completude: number | null = null, completudeTexte: string | null = null, relations: RelationsLigne = {}): TableauIndicateur {
  const total = x.g !== 'aucun';
  return {
    id, titre, definition, dimension: GROUPES_INDICATEURS[x.g], lignes: total ? [...x.lignes, 'Total'] : x.lignes, colonnes,
    cases: masquer(brutes, x.k, { totalLigne: total, ...surChaqueLigne(brutes.length, relations) }), completude, completudeTexte,
  };
}
/** Relations entre colonnes d'une ligne : groupes additifs (total en dernier), colonnes liées, colonne dérivée de ses sources. */
interface RelationsLigne { groupes?: number[][]; lies?: number[][]; derives?: { cible: number; sources: number[] }[] }
/** Relations entre colonnes posées sur chacune des `nl` lignes. */
function surChaqueLigne(nl: number, r: RelationsLigne): Pick<OptionsMasque, 'groupes' | 'lies' | 'derives'> {
  const lignes = Array.from({ length: nl }, (_, i) => i);
  return {
    groupes: lignes.flatMap(i => (r.groupes ?? []).map(g => g.map(j => [i, j] as const))),
    lies: lignes.flatMap(i => (r.lies ?? []).map(l => l.map(j => [i, j] as const))),
    derives: lignes.flatMap(i => (r.derives ?? []).map(x => ({ cible: [i, x.cible] as const, sources: x.sources.map(j => [i, j] as const) }))),
  };
}

/** Complétude d'un champ de la fiche sur des personnes : part renseignée et texte de ce qui manque. */
function completudeChamp(es: readonly Employe[], champ: 'sexe' | 'categorie', libelle: string): [number | null, string | null] {
  if (!es.length) return [null, null];
  const manque = es.filter(e => !e[champ]).length;
  return [pct(es.length - manque, es.length), manque ? `${manque} fiche${manque > 1 ? 's' : ''} sans ${libelle}` : null];
}
/** Complétude du groupement retenu (sexe, catégorie : données de la fiche à compléter ; autres : toujours connues). */
const completudeGroupe = (es: readonly Employe[], g: GroupeIndicateurs): [number | null, string | null] =>
  g === 'sexe' ? completudeChamp(es, 'sexe', 'sexe') : g === 'categorie' ? completudeChamp(es, 'categorie', 'catégorie') : [es.length ? 100 : null, null];

// — 1. Effectifs —

function effectifs(x: Contexte): TableauIndicateur {
  const mois = finsDeMois(x.du, x.au);
  const mesure = (es: readonly Employe[]): CaseBrute[] => {
    const salaries = es.filter(e => !interim(e));
    const fin = salaries.filter(e => presentA(e, x.au));
    // Effectif moyen (Sécurité sociale) : présents au dernier jour de chaque mois, moyenne des mois.
    const moyen = mois.reduce((n, m) => n + salaries.filter(e => presentA(e, m)).length, 0) / Math.max(1, mois.length);
    const vusMois = new Set(mois.flatMap(m => salaries.filter(e => presentA(e, m)).map(e => e.id)));
    // L1111-2 : CDI à temps plein 1 ; temps partiel au prorata ; CDD et intérim au prorata de leur présence (mois par
    // mois), sauf remplacement d'un absent ; apprentis et contrats de professionnalisation exclus (L1111-3).
    const l1111 = es.filter(e => e.typeContrat !== 'alternance' && !((e.typeContrat === 'cdd' || interim(e)) && remplacement(e)));
    const sommeL = mois.reduce((n, m) => n + l1111.filter(e => presentA(e, m)).reduce((s, e) => s + etpA(x.d, e, m), 0), 0) / Math.max(1, mois.length);
    const vusL = new Set(mois.flatMap(m => l1111.filter(e => presentA(e, m)).map(e => e.id)));
    const interims = es.filter(interim);
    const moyenInterim = mois.reduce((n, m) => n + interims.filter(e => presentA(e, m)).length, 0) / Math.max(1, mois.length);
    const vusI = new Set(mois.flatMap(m => interims.filter(e => presentA(e, m)).map(e => e.id)));
    return [
      { valeur: fin.length, n: fin.length },
      { valeur: arrondi(moyen), n: vusMois.size },
      { valeur: arrondi(fin.reduce((s, e) => s + etpA(x.d, e, x.au), 0)), n: fin.length },
      { valeur: arrondi(sommeL), n: vusL.size },
      { valeur: arrondi(moyenInterim), n: vusI.size },
    ];
  };
  const [c, t] = completudeGroupe(x.employes.filter(e => presentDurant(e, x.du, x.au)), x.g);
  return tableauGroupe(x, 'effectifs', 'Effectifs',
    'Fin de période : salariés présents au dernier jour (entrée au plus tard ce jour, contrat non terminé), hors intérimaires. '
    + 'Moyen (Sécurité sociale, art. L130-1 du CSS) : moyenne des effectifs au dernier jour de chaque mois, hors intérimaires. '
    + 'ETP : temps partiel au prorata de 35 h, forfait jours sur 218 jours, forfait annuel sur 1 607 h, régime en vigueur à la date. '
    + 'Code du travail (art. L1111-2 et L1111-3) : moyenne mensuelle en ETP, CDD et intérimaires compris au prorata de leur présence sauf '
    + 'remplacement d’un absent, apprentis et contrats de professionnalisation exclus. Intérimaires : fiches de Cursus seulement.',
    ['Effectif fin de période', 'Effectif moyen (Sécurité sociale)', 'ETP fin de période', 'Effectif Code du travail (L1111-2)', 'Intérimaires (moyenne)'],
    // Fin de période, moyen, ETP et Code du travail se confondent souvent (effectif stable à temps plein) : masqués ensemble.
    parModalite(x.lignes, x.employes, x.g, mesure), c, t, { lies: [[0, 1, 2, 3]] });
}

// — 2. Mouvements —

const entreDans = (e: Employe, du: ISODate, au: ISODate) => e.entree >= du && e.entree <= au;
const sortDans = (e: Employe, du: ISODate, au: ISODate) => !!e.motifSortie && !!e.fin && e.fin >= du && e.fin <= au;
const finPrevueDans = (e: Employe, du: ISODate, au: ISODate) => !e.motifSortie && !!e.fin && e.fin >= du && e.fin <= au;

function mouvements(x: Contexte): TableauIndicateur[] {
  const mois = finsDeMois(x.du, x.au);
  const mesure = (es: readonly Employe[]): CaseBrute[] => {
    const salaries = es.filter(e => !interim(e));
    const entrees = salaries.filter(e => entreDans(e, x.du, x.au)).length;
    const sorties = salaries.filter(e => sortDans(e, x.du, x.au)).length;
    const fins = salaries.filter(e => finPrevueDans(e, x.du, x.au)).length;
    const moyen = mois.reduce((n, m) => n + salaries.filter(e => presentA(e, m)).length, 0) / Math.max(1, mois.length);
    const pop = salaries.filter(e => presentDurant(e, x.du, x.au)).length;
    return [
      { valeur: entrees, n: entrees },
      { valeur: sorties, n: sorties },
      { valeur: fins, n: fins },
      // Taux de rotation : moyenne des entrées et des sorties, rapportée à l'effectif moyen (publié dans les effectifs) ; il
      // dirait le nombre de mouvements, d'où son masquage avec eux, et dès que les entrées ou les sorties le sont.
      { valeur: moyen > 0 ? arrondi((entrees + sorties) / 2 / moyen * 100) : 0, n: pop, n2: entrees + sorties },
    ];
  };
  const [c, t] = completudeGroupe(x.employes.filter(e => presentDurant(e, x.du, x.au)), x.g);
  const salaries = x.employes.filter(e => !interim(e));
  const motifs = Object.entries(MOTIFS_SORTIE) as [keyof typeof MOTIFS_SORTIE, string][];
  const parMotif = motifs.map(([m]) => salaries.filter(e => sortDans(e, x.du, x.au) && e.motifSortie === m).length);
  const totalSorties = salaries.filter(e => sortDans(e, x.du, x.au)).length;
  const contrats = (Object.keys(TYPES_CONTRAT) as Employe['typeContrat'][]).filter(t => t !== 'interim');
  const parContrat = contrats.map(tc => salaries.filter(e => entreDans(e, x.du, x.au) && e.typeContrat === tc).length);
  const totalEntrees = salaries.filter(e => entreDans(e, x.du, x.au)).length;
  return [
    tableauGroupe(x, 'mouvements', 'Entrées et sorties',
      'Entrées : salariés entrés pendant la période, hors intérimaires (une réembauche est une nouvelle entrée). Sorties : départs '
      + 'enregistrés (motif de sortie) dont le dernier jour tombe dans la période. Fins de contrat prévues : terme d’un CDD, d’une '
      + 'mission ou d’une alternance dans la période, sans sortie enregistrée (ni comptées comme sorties). Taux de rotation : '
      + '(entrées + sorties) / 2, rapporté à l’effectif moyen de la Sécurité sociale.',
      ['Entrées', 'Sorties', 'Fins de contrat prévues', 'Taux de rotation (%)'], parModalite(x.lignes, x.employes, x.g, mesure), c, t,
      { derives: [{ cible: 3, sources: [0, 1] }] }),
    {
      id: 'sortiesMotifs', titre: 'Sorties par motif', dimension: 'Motif de sortie',
      definition: 'Départs enregistrés pendant la période, hors intérimaires, par motif de sortie (liste fermée de la fiche).',
      lignes: [...motifs.map(([, l]) => l), 'Total'], colonnes: ['Sorties'],
      cases: masquer([...parMotif.map(v => [{ valeur: v, n: v }]), [{ valeur: totalSorties, n: totalSorties }]], x.k, { totalLigne: true }),
      completude: null, completudeTexte: null,
    },
    {
      id: 'entreesContrats', titre: 'Entrées par nature du contrat', dimension: 'Nature du contrat',
      definition: 'Salariés entrés pendant la période, par nature du contrat, hors intérimaires (intérim : voir les effectifs).',
      lignes: [...contrats.map(tc => TYPES_CONTRAT[tc].label), 'Total'], colonnes: ['Entrées'],
      cases: masquer([...parContrat.map(v => [{ valeur: v, n: v }]), [{ valeur: totalEntrees, n: totalEntrees }]], x.k, { totalLigne: true }),
      completude: null, completudeTexte: null,
    },
  ];
}

// — 3. Absentéisme —

/** Catégories de motif des colonnes de l'absentéisme. */
const MOTIFS_ABSENTEISME = [
  { id: 'sante', label: 'Maladie (%)', natures: ['MALADIE', 'ALD'] },
  { id: 'atmp', label: 'Accidents du travail, de trajet, maladies professionnelles (%)', natures: ['AT', 'TRAJET', 'MP'] },
] as const;
const motifAbsence = (n: NatureAbsence): 'sante' | 'atmp' | 'famille' | 'autres' => {
  for (const m of MOTIFS_ABSENTEISME) if ((m.natures as readonly string[]).includes(n)) return m.id;
  const c = NATURES_ABSENCE[n].categorie;
  return c === 'famille' || c === 'parentalite' ? 'famille' : 'autres';
};

/**
 * Jours ouvrés théoriques d'un salarié dans la période, bornés par son contrat : du lundi au vendredi, hors fériés chômés
 * et hors jours non travaillés du temps partiel en vigueur ce jour-là (historique des contrats).
 */
export function joursTheoriques(d: Domain, e: Employe, du: ISODate, au: ISODate): ISODate[] {
  const a = e.entree > du ? e.entree : du, b = e.fin && e.fin < au ? e.fin : au;
  const out: ISODate[] = [];
  for (let s = a; s <= b; s = suivant(s)) {
    const wd = weekday(s);
    if (wd > 4 || isFerie(s)) continue;
    if (d.contratOf(employeAu(d, e, s)).jourOff.includes(wd)) continue;
    out.push(s);
  }
  return out;
}
/** Jour suivant, sans passer par un objet Date à chaque jour d'une longue période (lecture de 500 salariés sur 3 ans). */
function suivant(s: ISODate): ISODate {
  const a = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), j = Number(s.slice(8, 10));
  if (j < Number(finDuMois(a, m).slice(8, 10))) return `${s.slice(0, 8)}${pad(j + 1)}`;
  return m < 12 ? `${a}-${pad(m + 1)}-01` : `${a + 1}-01-01`;
}

/**
 * Jours d'absence d'un salarié par nature comptée : intersection de chaque absence validée ou signalée avec ses jours
 * ouvrés théoriques, quelle que soit la nature du décompte (un arrêt en jours calendaires ne compte pas ses week-ends) ;
 * un jour couvert par deux absences ne compte qu'une fois.
 */
export function joursAbsence(theoriques: readonly ISODate[], absences: readonly Absence[], natures: ReadonlySet<string>): Map<NatureAbsence, number> {
  const jours = new Set(theoriques), vus = new Set<ISODate>(), out = new Map<NatureAbsence, number>();
  for (const a of [...absences].sort((x, y) => x.du.localeCompare(y.du) || x.id - y.id)) {
    if (!absenceBloque(a) || !natures.has(a.type)) continue;
    for (const j of theoriques) {
      if (j < a.du || j > a.au || vus.has(j) || !jours.has(j)) continue;
      vus.add(j);
      out.set(a.type as NatureAbsence, (out.get(a.type as NatureAbsence) ?? 0) + 1);
    }
  }
  return out;
}

function absenteisme(x: Contexte, natures: readonly NatureAbsence[]): TableauIndicateur[] {
  const comptees = new Set<string>(natures);
  // Par salarié présent (hors intérimaires) : jours théoriques et jours d'absence par nature.
  const parSalarie = new Map<number, { theoriques: number; absences: Map<NatureAbsence, number> }>();
  const absencesDe = new Map<number, Absence[]>();
  for (const a of x.d.ds.absences) {
    if (a.au < x.du || a.du > x.au) continue;
    const l = absencesDe.get(a.empId);
    if (l) l.push(a); else absencesDe.set(a.empId, [a]);
  }
  const population = x.employes.filter(e => !interim(e) && presentDurant(e, x.du, x.au));
  for (const e of population) {
    const th = joursTheoriques(x.d, e, x.du, x.au);
    parSalarie.set(e.id, { theoriques: th.length, absences: joursAbsence(th, absencesDe.get(e.id) ?? [], comptees) });
  }
  const somme = (es: readonly Employe[], f: (n: NatureAbsence) => boolean) => {
    let jours = 0;
    const qui = new Set<number>();
    for (const e of es) for (const [n, j] of parSalarie.get(e.id)?.absences ?? []) if (f(n) && j > 0) { jours += j; qui.add(e.id); }
    return { jours, personnes: qui.size };
  };
  const mesure = (es: readonly Employe[]): CaseBrute[] => {
    const pop = es.filter(e => parSalarie.has(e.id) && parSalarie.get(e.id)!.theoriques > 0);
    const th = pop.reduce((n, e) => n + parSalarie.get(e.id)!.theoriques, 0);
    const tout = somme(pop, () => true);
    const part = (f: (n: NatureAbsence) => boolean): CaseBrute => { const s = somme(pop, f); return { valeur: pct(s.jours, th), n: pop.length, n2: s.personnes }; };
    return [
      { valeur: th, n: pop.length },
      { valeur: tout.jours, n: pop.length, n2: tout.personnes },
      { valeur: pct(tout.jours, th), n: pop.length, n2: tout.personnes },
      part(n => motifAbsence(n) === 'sante'),
      part(n => motifAbsence(n) === 'atmp'),
      part(n => motifAbsence(n) === 'famille'),
      part(n => motifAbsence(n) === 'autres'),
    ];
  };
  // Complétude : absences hors congés de la période dont la nature est précisée (une absence signalée à qualifier n'est
  // pas comptée, faute de nature).
  const horsConges = x.d.ds.absences.filter(a => a.au >= x.du && a.du <= x.au && absenceBloque(a) && !['CP', 'RTT', 'RECUP', 'CET'].includes(a.type));
  const aQualifier = horsConges.filter(a => a.type === 'ABSENCE').length;
  const libelles = natures.map(n => NATURES_ABSENCE[n].abrege);
  const principal = tableauGroupe(x, 'absenteisme', 'Absentéisme',
    `Jours d’absence comptés dans les jours ouvrés théoriques du régime de chaque salarié (du lundi au vendredi, hors fériés chômés `
    + `et jours non travaillés du temps partiel), quelle que soit la nature du décompte, rapportés à ces jours ; hors intérimaires. `
    + `Absences validées ou signalées. Natures comptées (Paramètres) : ${[...new Set(libelles)].join(', ')}. Aucune formule légale : `
    + `définition à arrêter avec le CSE. Période calendaire imposée : l’année civile.`,
    ['Jours théoriques', 'Jours d’absence', 'Taux d’absentéisme (%)', MOTIFS_ABSENTEISME[0].label, MOTIFS_ABSENTEISME[1].label, 'Famille (%)', 'Autres motifs (%)'],
    parModalite(x.lignes, x.employes, x.g, mesure),
    horsConges.length ? pct(horsConges.length - aQualifier, horsConges.length) : null,
    aQualifier ? `${aQualifier} absence${aQualifier > 1 ? 's' : ''} à qualifier par le service RH, non comptée${aQualifier > 1 ? 's' : ''}` : null,
    // Chaque jour d'absence est rangé dans un seul motif : les quatre taux par motif s'additionnent en taux d'absentéisme
    // (groupe additif de la ligne), et les jours d'absence disent le taux (jours théoriques visibles) : liés.
    { groupes: [[3, 4, 5, 6, 2]], lies: [[1, 2]] });
  // Détail de la santé par nature, sur l'ensemble : donné seulement si chaque nature atteint le seuil, et si les taux
  // Maladie et AT/MP de l'ensemble (dernière ligne du tableau principal) sont visibles : son total en est la somme, il
  // redonnerait sinon un motif masqué. Sinon tout est masqué, total compris.
  const sante = natures.filter(n => motifAbsence(n) === 'sante' || motifAbsence(n) === 'atmp');
  const pop = population.filter(e => parSalarie.get(e.id)!.theoriques > 0);
  const th = pop.reduce((n, e) => n + parSalarie.get(e.id)!.theoriques, 0);
  const brutes = [...sante.map(n => { const s = somme(pop, m => m === n); return [{ valeur: pct(s.jours, th), n: pop.length, n2: s.personnes }]; }),
    (() => { const s = somme(pop, m => sante.includes(m)); return [{ valeur: pct(s.jours, th), n: pop.length, n2: s.personnes }]; })()];
  const ensemble = principal.cases[principal.cases.length - 1];
  let cases = masquer(brutes, x.k, { totalLigne: true });
  if (ensemble[3].masque || ensemble[4].masque || cases.some(l => l[0].masque)) cases = cases.map(() => [{ valeur: null, masque: true }]);
  return [principal, {
    id: 'absenteismeSante', titre: 'Absentéisme pour raison de santé, par nature', dimension: 'Nature de l’absence',
    definition: 'Détail des arrêts de santé sur l’ensemble des salariés (même calcul que l’absentéisme) ; donné seulement si chaque nature '
      + 'concerne au moins autant de personnes que le seuil et si les taux Maladie et AT/MP de l’ensemble sont visibles, sinon entièrement masqué.',
    lignes: [...sante.map(n => NATURES_ABSENCE[n].label), 'Total'], colonnes: ['Taux (%)'], cases, completude: null, completudeTexte: null,
  }];
}

// — 4. Formation —

function formation(x: Contexte): TableauIndicateur[] {
  const annees: number[] = [];
  for (let a = Number(x.du.slice(0, 4)); a <= Number(x.au.slice(0, 4)); a++) annees.push(a);
  const realisations = annees.flatMap(a => realisationsDe(x.d, a)).filter(r => r.date >= x.du && r.date <= x.au);
  const fiche = new Map(x.employes.map(e => [e.id, e]));
  const retenues = realisations.filter(r => { const e = fiche.get(r.empId); return !!e && !interim(e); });
  const mois = finsDeMois(x.du, x.au);
  const mesure = (es: readonly Employe[]): CaseBrute[] => {
    const salaries = es.filter(e => !interim(e));
    const ids = new Set(salaries.map(e => e.id));
    const rs = retenues.filter(r => ids.has(r.empId));
    const stagiaires = new Set(rs.map(r => r.empId)).size;
    const heures = arrondi(rs.reduce((n, r) => n + (r.heures ?? 0), 0));
    const moyen = mois.reduce((n, m) => n + salaries.filter(e => presentA(e, m)).length, 0) / Math.max(1, mois.length);
    const pop = salaries.filter(e => presentDurant(e, x.du, x.au)).length;
    const c = (valeur: number): CaseBrute => ({ valeur, n: pop, n2: stagiaires });
    return [c(stagiaires), c(heures), c(stagiaires ? arrondi(heures / stagiaires) : 0), c(moyen > 0 ? arrondi(stagiaires / moyen * 100) : 0), c(rs.filter(r => r.heures == null).length)];
  };
  const inconnues = retenues.filter(r => r.heures == null).length;
  const principal = tableauGroupe(x, 'formation', 'Formation',
    'Formations réalisées pendant la période (participations présentes aux sessions clôturées, certifications enregistrées sans session, '
    + 'formations suivies), hors intérimaires. Heures : horaires de la session, sinon durée du catalogue ; une durée inconnue est comptée '
    + 'à part. Taux d’accès : stagiaires rapportés à l’effectif moyen de la Sécurité sociale.',
    ['Stagiaires', 'Heures de formation', 'Heures par stagiaire', 'Taux d’accès (%)', 'Formations de durée inconnue'],
    parModalite(x.lignes, x.employes, x.g, mesure),
    retenues.length ? pct(retenues.length - inconnues, retenues.length) : null,
    inconnues ? `${inconnues} formation${inconnues > 1 ? 's' : ''} de durée inconnue (heures non comptées)` : null,
    // Heures par stagiaire (heures visibles) et taux d'accès (effectif moyen publié) redonnent le nombre de stagiaires.
    { lies: [[0, 2, 3]] });
  // Croisement catégorie × sexe : stagiaires, puis heures, masquées d'après le nombre de stagiaires de chaque case.
  const cats = [...Object.keys(CATEGORIES_EMPLOI) as CategorieEmploi[], null];
  const sexes = [...Object.keys(SEXES) as Sexe[], null];
  const croise = (heures: boolean) => {
    const cellule = (c: CategorieEmploi | null | undefined, s: Sexe | null | undefined): CaseBrute => {
      const rs = retenues.filter(r => { const e = fiche.get(r.empId)!; return (c === undefined || (e.categorie ?? null) === c) && (s === undefined || (e.sexe ?? null) === s); });
      const n = new Set(rs.map(r => r.empId)).size;
      return { valeur: heures ? arrondi(rs.reduce((t, r) => t + (r.heures ?? 0), 0)) : n, n };
    };
    return [...cats.map(c => [...sexes.map(s => cellule(c, s)), cellule(c, undefined)]), [...sexes.map(s => cellule(undefined, s)), cellule(undefined, undefined)]];
  };
  const formes = retenues.map(r => fiche.get(r.empId)!);
  const sansSexe = new Set(formes.filter(e => !e.sexe).map(e => e.id)).size, sansCat = new Set(formes.filter(e => !e.categorie).map(e => e.id)).size;
  const nb = new Set(formes.map(e => e.id)).size;
  const completude = nb ? pct(nb - new Set(formes.filter(e => !e.sexe || !e.categorie).map(e => e.id)).size, nb) : null;
  const texte = [sansSexe ? `${sansSexe} stagiaire${sansSexe > 1 ? 's' : ''} sans sexe` : '', sansCat ? `${sansCat} sans catégorie` : ''].filter(Boolean).join(', ') || null;
  const lignes = [...cats.map(c => (c ? CATEGORIES_EMPLOI[c].pluriel : NON_RENSEIGNE)), 'Total'];
  const colonnes = [...sexes.map(s => (s ? SEXES[s].pluriel : NON_RENSEIGNE)), 'Total'];
  return [principal,
    { id: 'formationStagiaires', titre: 'Stagiaires par catégorie et par sexe', dimension: 'Catégorie d’emploi', lignes, colonnes,
      definition: 'Salariés formés au moins une fois pendant la période (hors intérimaires), par catégorie d’emploi et par sexe de la fiche.',
      cases: masquer(croise(false), x.k, { totalLigne: true, totalColonne: true }), completude, completudeTexte: texte },
    { id: 'formationHeures', titre: 'Heures de formation par catégorie et par sexe', dimension: 'Catégorie d’emploi', lignes, colonnes,
      definition: 'Heures de formation connues de la période (hors intérimaires) ; case masquée quand elle porte sur moins de stagiaires que le seuil.',
      cases: masquer(croise(true), x.k, { totalLigne: true, totalColonne: true }), completude, completudeTexte: texte },
  ];
}

// — 5. Âges et ancienneté —

const TRANCHES_AGE: readonly [string, number, number][] = [
  ['Moins de 25 ans', 0, 24], ['25 à 29 ans', 25, 29], ['30 à 34 ans', 30, 34], ['35 à 39 ans', 35, 39], ['40 à 44 ans', 40, 44],
  ['45 à 49 ans', 45, 49], ['50 à 54 ans', 50, 54], ['55 à 59 ans', 55, 59], ['60 ans et plus', 60, 200],
];
const TRANCHES_ANCIENNETE: readonly [string, number, number][] = [
  ['Moins d’un an', 0, 0], ['1 à 3 ans', 1, 2], ['3 à 5 ans', 3, 4], ['5 à 10 ans', 5, 9], ['10 à 20 ans', 10, 19], ['20 ans et plus', 20, 200],
];
/** Années révolues entre deux dates. */
const anneesEntre = (de: ISODate, a: ISODate) => Number(a.slice(0, 4)) - Number(de.slice(0, 4)) - (a.slice(5) < de.slice(5) ? 1 : 0);

function parSexe(x: Contexte, id: string, titre: string, definition: string, dimension: string, tranches: readonly [string, number, number][], valeur: (e: Employe) => number): TableauIndicateur {
  const presents = x.employes.filter(e => !interim(e) && presentA(e, x.au));
  const sexes = [...Object.keys(SEXES) as Sexe[], null];
  const compte = (t: readonly [string, number, number] | undefined, s: Sexe | null | undefined): CaseBrute => {
    const n = presents.filter(e => (!t || (valeur(e) >= t[1] && valeur(e) <= t[2])) && (s === undefined || (e.sexe ?? null) === s)).length;
    return { valeur: n, n };
  };
  const brutes = [...tranches.map(t => [...sexes.map(s => compte(t, s)), compte(t, undefined)]), [...sexes.map(s => compte(undefined, s)), compte(undefined, undefined)]];
  const [c, texte] = completudeChamp(presents, 'sexe', 'sexe');
  return {
    id, titre, definition, dimension, lignes: [...tranches.map(t => t[0]), 'Total'], colonnes: [...sexes.map(s => (s ? SEXES[s].pluriel : NON_RENSEIGNE)), 'Total'],
    cases: masquer(brutes, x.k, { totalLigne: true, totalColonne: true }), completude: c, completudeTexte: texte,
  };
}

// — 6. Préparation de l'index d'égalité —

const TRANCHES_EGAPRO: readonly [number, number][] = [[0, 29], [30, 39], [40, 49], [50, 200]];

function preparationIndex(x: Contexte, annee: number): PreparationIndex {
  const du = `${annee}-01-01`, au = `${annee}-12-31`;
  // Effectifs pris en compte : salariés présents au moins 6 mois de l'année, hors apprentis, contrats de
  // professionnalisation et intérimaires (règles d'Egapro ; absences longues et expatriés à vérifier par le service RH).
  const jours = (e: Employe) => {
    const a = e.entree > du ? e.entree : du, b = e.fin && e.fin < au ? e.fin : au;
    return a > b ? 0 : Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 864e5) + 1;
  };
  const pris = x.employes.filter(e => !interim(e) && e.typeContrat !== 'alternance' && jours(e) >= 183);
  const cats = [...Object.keys(CATEGORIES_EMPLOI) as CategorieEmploi[], null];
  const sexes: (Sexe | null | undefined)[] = ['F', 'M', null, undefined];
  const compte = (c: CategorieEmploi | null | undefined, s: Sexe | null | undefined): CaseBrute => {
    const n = pris.filter(e => (c === undefined || (e.categorie ?? null) === c) && (s === undefined || (e.sexe ?? null) === s)).length;
    return { valeur: n, n };
  };
  const brutes = [...cats.map(c => sexes.map(s => compte(c, s))), sexes.map(s => compte(undefined, s))];
  // Groupes catégorie × tranche d'âge (au 31 décembre) valides : au moins 3 femmes et 3 hommes.
  let valides = 0, effectifValide = 0;
  for (const c of Object.keys(CATEGORIES_EMPLOI) as CategorieEmploi[]) for (const [min, max] of TRANCHES_EGAPRO) {
    const g = pris.filter(e => e.categorie === c && Number(au.slice(0, 4)) - e.naissance >= min && Number(au.slice(0, 4)) - e.naissance <= max);
    const f = g.filter(e => e.sexe === 'F').length, h = g.filter(e => e.sexe === 'M').length;
    if (f >= 3 && h >= 3) { valides++; effectifValide += f + h; }
  }
  const [comp, texte] = completudeChamp(pris, 'sexe', 'sexe');
  const [comp2, texte2] = completudeChamp(pris, 'categorie', 'catégorie');
  // Retours de congé de maternité ou d'adoption dans l'année : congé terminé dans l'année (avant la date du jour).
  const retours = new Set(x.d.ds.absences.filter(a => (a.type === 'MATERNITE' || a.type === 'ADOPTION') && absenceBloque(a) && a.au >= du && a.au <= au && a.au < x.d.ti)
    .map(a => a.empId)).size;
  return {
    annee,
    effectifs: {
      id: 'indexEffectifs', titre: 'Effectifs pris en compte pour l’index', dimension: 'Catégorie d’emploi',
      definition: 'Salariés présents au moins six mois de l’année, hors apprentis, contrats de professionnalisation et intérimaires, par '
        + 'catégorie d’emploi et par sexe (règles d’Egapro, à vérifier pour les absences longues). Les rémunérations restent dans Sage.',
      lignes: [...cats.map(c => (c ? CATEGORIES_EMPLOI[c].pluriel : NON_RENSEIGNE)), 'Total'], colonnes: ['Femmes', 'Hommes', NON_RENSEIGNE, 'Total'],
      cases: masquer(brutes, x.k, { totalLigne: true, totalColonne: true }),
      completude: comp == null || comp2 == null ? null : Math.min(comp, comp2), completudeTexte: [texte, texte2].filter(Boolean).join(', ') || null,
    },
    groupesValides: valides, groupes: Object.keys(CATEGORIES_EMPLOI).length * TRANCHES_EGAPRO.length,
    partGroupesValides: pris.length ? pct(effectifValide, pris.length) : null,
    retoursMaternite: masquer([[{ valeur: retours, n: retours }]], x.k)[0][0],
    indicateurs: INDICATEURS_INDEX,
  };
}

// — Calcul complet —

export interface ParametresIndicateurs {
  annee: number; periode: PeriodeIndicateurs; groupe: GroupeIndicateurs;
  /** Seuil d'anonymat (réglage `indicateursSeuil`, borné de 3 à 10). */
  seuil: number;
  /** Natures comptées dans l'absentéisme (réglage `absenteismeNatures`). */
  natures: readonly NatureAbsence[];
}

/**
 * Indicateurs de la période sur toutes les données de `d` (instantané complet du serveur), déjà masqués. Null : année ou
 * période refusée. Les jours fériés sont ceux du calendrier réglé de l'instantané.
 */
export function indicateursLegaux(d: Domain, p: ParametresIndicateurs): IndicateursLegaux | null {
  const b = bornesPeriode(p.annee, p.periode);
  if (!b || !estGroupeIndicateurs(p.groupe)) return null;
  const k = Math.max(SEUIL_INDICATEURS_MIN, Math.min(SEUIL_INDICATEURS_MAX, Math.round(p.seuil) || SEUIL_INDICATEURS_DEFAUT));
  const natures = p.natures.filter(n => Object.hasOwn(NATURES_ABSENCE, n));
  return avecCalendrier(d.ds.calendrierFeries ?? {}, () => {
    const employes = d.ds.employes;
    const presents = employes.filter(e => presentDurant(e, b.du, b.au));
    const x: Contexte = { d, du: b.du, au: b.au, g: p.groupe, k, employes, lignes: modalites(p.groupe, presents) };
    const tableaux = [
      effectifs(x), ...mouvements(x), ...absenteisme(x, natures), ...formation(x),
      parSexe(x, 'ages', 'Pyramide des âges', 'Salariés présents au dernier jour de la période, hors intérimaires, par tranche d’âge (année de naissance) '
        + 'et par sexe ; tranches extrêmes regroupées.', 'Tranche d’âge', TRANCHES_AGE, e => Number(b.au.slice(0, 4)) - e.naissance),
      parSexe(x, 'anciennete', 'Ancienneté', 'Salariés présents au dernier jour de la période, hors intérimaires, par ancienneté depuis la date '
        + 'd’entrée de la fiche (une réembauche repart de sa nouvelle entrée) et par sexe.', 'Ancienneté', TRANCHES_ANCIENNETE, e => anneesEntre(e.entree, b.au)),
    ];
    const salaries = presents.filter(e => !interim(e));
    const sansSexe = salaries.filter(e => !e.sexe).length, sansCat = salaries.filter(e => !e.categorie).length;
    const avertissements = [
      sansSexe ? `${sansSexe} fiche${sansSexe > 1 ? 's' : ''} sans sexe : comptée${sansSexe > 1 ? 's' : ''} « ${NON_RENSEIGNE} »` : '',
      sansCat ? `${sansCat} fiche${sansCat > 1 ? 's' : ''} sans catégorie d’emploi : comptée${sansCat > 1 ? 's' : ''} « ${NON_RENSEIGNE} »` : '',
      'Intérimaires sans fiche dans Cursus non comptés',
      b.au > d.ti ? 'Période pas encore terminée : chiffres provisoires' : '',
    ].filter(Boolean);
    return {
      regles: REGLES_INDICATEURS, annee: p.annee, periode: p.periode, du: b.du, au: b.au, libelle: b.libelle, groupe: p.groupe, seuil: k, calculeLe: d.ti,
      tableaux, index: preparationIndex(x, p.annee), avertissements,
    };
  });
}

// — Export CSV (format long) —

export const ENTETE_CSV_INDICATEURS = ['Indicateur', 'Période', 'Dimension', 'Modalité', 'Mesure', 'Valeur', 'Masquée'];
/** Export de la BDESE (trois années, groupements de GROUPES_BDESE) : la source de chaque ligne en plus (arrêté ou calcul, seuil). */
export const ENTETE_CSV_BDESE = [...ENTETE_CSV_INDICATEURS, 'Source'];
const nombreFr = (v: number) => String(v).replace('.', ',');

/**
 * Lignes de l'export CSV : une par case, valeur à la française, « < k » pour une case masquée ; index compris, sauf
 * `index: false` (export de la BDESE : l'index ne dépend pas du groupement, il n'est écrit qu'avec l'ensemble).
 */
export function lignesCsvIndicateurs(r: IndicateursLegaux, { index = true }: { index?: boolean } = {}): string[][] {
  const out: string[][] = [];
  const tableau = (t: TableauIndicateur) => t.lignes.forEach((l, i) => t.colonnes.forEach((c, j) => {
    const v = t.cases[i][j];
    out.push([t.titre, r.libelle, t.dimension, l, c, v.masque ? '' : nombreFr(v.valeur ?? 0), v.masque ? `< ${r.seuil}` : '']);
  }));
  r.tableaux.forEach(tableau);
  if (!index) return out;
  tableau(r.index.effectifs);
  const rm = r.index.retoursMaternite;
  out.push(['Retours de congé de maternité ou d’adoption', `Année ${r.index.annee}`, 'Ensemble', 'Ensemble', 'Retours', rm.masque ? '' : nombreFr(rm.valeur ?? 0), rm.masque ? `< ${r.seuil}` : '']);
  return out;
}
