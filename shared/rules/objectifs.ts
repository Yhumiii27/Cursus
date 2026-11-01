// Objectifs suivis d'un entretien annuel à l'autre (lot 12, chantier C3, t194) : règles pures, partagées par les actions
// (server/src/actions/objectifs.ts), la clôture d'un entretien (server/src/actions/entretiens.ts) et les écrans.
// Choix par défaut du chantier : objectifs fixés et évalués à l'entretien annuel, ajustés (avec un motif) en cours
// d'année ; le salarié propose, le manager valide ; « objectifs facultatifs » la première année (réglage), la clôture
// n'exige alors pas l'évaluation des objectifs repris. Jamais d'objectif dans un entretien de parcours professionnel :
// il ne porte pas sur l'évaluation du travail (art. L6315-1) ; contrôle côté serveur, pas seulement à l'écran.
import { isValidDate } from '../dates.ts';
import type { CategorieObjectif, CompteurObjectifs, Employe, Entretien, EntretienType, ISODate, Objectif, Settings, StatutObjectif } from '../types.ts';
import { SEUIL_ANONYMAT } from './evaluation-formation.ts';

export const STATUTS_OBJECTIF = ['propose', 'ouvert', 'atteint', 'partiel', 'non_atteint', 'sans_objet', 'reconduit'] as const satisfies readonly StatutObjectif[];
export const STATUT_OBJECTIF_LABEL: Record<StatutObjectif, string> = {
  propose: 'Proposé par le salarié', ouvert: 'En cours', atteint: 'Atteint', partiel: 'Partiellement atteint', non_atteint: 'Non atteint',
  sans_objet: 'Devenu sans objet', reconduit: 'Reconduit',
};
export const CATEGORIES_OBJECTIF = ['individuel', 'collectif', 'developpement'] as const satisfies readonly CategorieObjectif[];
export const CATEGORIE_OBJECTIF_LABEL: Record<CategorieObjectif, string> = { individuel: 'Individuel', collectif: 'Collectif', developpement: 'Développement' };
/** Résultats d'une évaluation, à l'entretien annuel suivant. */
export const STATUTS_EVALUATION = ['atteint', 'partiel', 'non_atteint', 'sans_objet', 'reconduit'] as const satisfies readonly StatutObjectif[];
export type StatutEvaluation = typeof STATUTS_EVALUATION[number];

/** Types d'entretien qui portent des objectifs (suivi, ajustement) : annuel, point de mi-année, point de suivi. */
export const TYPES_AVEC_OBJECTIFS: readonly EntretienType[] = ['annuel', 'mi_annee', 'point'];
/** Types où les objectifs se fixent et s'évaluent : l'entretien annuel seul (choix par défaut du chantier). */
export const TYPES_FIXATION: readonly EntretienType[] = ['annuel'];

export const LIBELLE_OBJECTIF_MAX = 200;
export const MESURE_MAX = 500;
export const EVALUATION_MAX = 1000;
export const COMMENTAIRE_SAL_MAX = 500;
export const MOTIF_AJUSTEMENT_MAX = 500;

export const estStatutEvaluation = (v: unknown): v is StatutEvaluation => (STATUTS_EVALUATION as readonly unknown[]).includes(v);
export const estCategorieObjectif = (v: unknown): v is CategorieObjectif => (CATEGORIES_OBJECTIF as readonly unknown[]).includes(v);
/** Objectif évalué (résultat posé), à l'entretien annuel suivant celui qui l'a fixé. */
export const estEvalue = (o: Pick<Objectif, 'statut'>) => estStatutEvaluation(o.statut);

/**
 * Refus d'objectifs dans un entretien de ce type, ou null : jamais dans un entretien de parcours professionnel ni dans
 * l'état des lieux (art. L6315-1), ni dans l'entretien du forfait jours (art. L3121-64, charge de travail) ; `fixation` :
 * fixation ou évaluation, réservées à l'entretien annuel (le point de mi-année et le point de suivi n'en font que le suivi).
 */
export function refusTypeObjectifs(type: EntretienType, fixation = false): string | null {
  if (['epp', 'reprise', 'bilan'].includes(type)) {
    return 'Aucun objectif dans un entretien de parcours professionnel : il ne porte pas sur l’évaluation du travail (art. L6315-1) ; fixez-les à l’entretien annuel';
  }
  if (type === 'forfait') return 'Aucun objectif dans l’entretien du forfait jours (charge de travail, art. L3121-64) ; fixez-les à l’entretien annuel';
  if (fixation && !TYPES_FIXATION.includes(type)) {
    return 'Les objectifs se fixent et s’évaluent à l’entretien annuel ; en cours d’année, ajustez-les (avec un motif) ou mettez à jour leur avancement';
  }
  return null;
}

/** Champs saisis d'un objectif, contrôlés. */
export interface SaisieObjectif { libelle: string; mesure: string | null; categorie: CategorieObjectif; poids: number | null; echeance: ISODate | null }

const texte = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/**
 * Saisie d'un objectif lue et contrôlée ; `actuel` : valeurs en vigueur (modification), un champ absent de `p` les garde.
 * Message d'erreur en texte si la saisie est invalide.
 */
export function lireObjectif(p: Record<string, unknown>, actuel?: SaisieObjectif): SaisieObjectif | string {
  const a = actuel ?? { libelle: '', mesure: null, categorie: 'individuel' as CategorieObjectif, poids: null, echeance: null };
  const libelle = p.libelle !== undefined ? texte(p.libelle) : a.libelle;
  if (!libelle) return 'Libellé de l’objectif requis';
  if (libelle.length > LIBELLE_OBJECTIF_MAX) return `Libellé de l’objectif trop long (${LIBELLE_OBJECTIF_MAX} caractères au plus)`;
  const mesure = p.mesure !== undefined ? (texte(p.mesure) || null) : a.mesure;
  if (mesure && mesure.length > MESURE_MAX) return `Indicateur ou critère de mesure trop long (${MESURE_MAX} caractères au plus)`;
  const categorie = p.categorie !== undefined ? p.categorie : a.categorie;
  if (!estCategorieObjectif(categorie)) return 'Catégorie d’objectif inconnue';
  let poids = a.poids;
  if (p.poids !== undefined) {
    if (p.poids === null || p.poids === '') poids = null;
    else if (!Number.isInteger(Number(p.poids)) || Number(p.poids) < 0 || Number(p.poids) > 100) return 'Poids : un nombre entier de 0 à 100 %';
    else poids = Number(p.poids);
  }
  let echeance = a.echeance;
  if (p.echeance !== undefined) {
    if (p.echeance === null || p.echeance === '') echeance = null;
    else if (typeof p.echeance !== 'string' || !isValidDate(p.echeance)) return 'Échéance de l’objectif invalide';
    else echeance = p.echeance;
  }
  return { libelle, mesure, categorie, poids, echeance };
}

/** Avancement saisi (0 à 100 %, entier), ou message d'erreur. */
export function lireAvancement(v: unknown): number | string {
  const n = Number(v);
  return v !== null && v !== '' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : 'Avancement : un nombre entier de 0 à 100 %';
}

/** Objectifs fixés (ou proposés) à l'entretien `entretienId`. */
export const objectifsFixesA = (objectifs: readonly Objectif[], entretienId: number) => objectifs.filter(o => o.entretienId === entretienId);

/**
 * Poids total des objectifs fixés à un entretien, avec la saisie `poids` à la place de l'objectif `sauf` : au plus 100 %.
 * Message d'erreur, ou null.
 */
export function refusPoids(objectifs: readonly Objectif[], entretienId: number, poids: number | null, sauf?: number): string | null {
  const total = objectifsFixesA(objectifs, entretienId).filter(o => o.id !== sauf).reduce((t, o) => t + (o.poids ?? 0), 0) + (poids ?? 0);
  return total > 100 ? `Poids des objectifs de l’entretien : ${total} %, 100 % au plus` : null;
}

/**
 * Objectifs à revoir à l'entretien annuel `x` (reprise des objectifs ouverts) : ceux du salarié encore en cours, fixés à un
 * entretien déjà clos, et ceux déjà évalués à `x` (évaluation modifiable tant que `x` n'est pas clos). Les objectifs
 * reconduits à `x` (nouvelles lignes) n'y sont pas : ils sont fixés à `x`.
 */
export function objectifsARevoir(objectifs: readonly Objectif[], entretiens: readonly Pick<Entretien, 'id' | 'statut'>[], x: Pick<Entretien, 'id' | 'empId' | 'type'>): Objectif[] {
  if (!TYPES_FIXATION.includes(x.type)) return [];
  const clos = new Set(entretiens.filter(e => e.statut === 'realise').map(e => e.id));
  return objectifs.filter(o => o.empId === x.empId && o.entretienId !== x.id
    && ((o.statut === 'ouvert' && clos.has(o.entretienId)) || o.evalueEntretienId === x.id));
}

/**
 * Ce qui empêche de clore l'entretien `x`, ou null : propositions du salarié encore à valider ou à retirer (toujours) ;
 * objectifs repris non évalués, sauf en mode « objectifs facultatifs » (réglage, activé la première année).
 */
export function blocageClotureObjectifs(objectifs: readonly Objectif[], entretiens: readonly Pick<Entretien, 'id' | 'statut'>[], x: Pick<Entretien, 'id' | 'empId' | 'type'>,
  s: Pick<Settings, 'objectifsActifs' | 'objectifsFacultatifs'>): string | null {
  if (!s.objectifsActifs || !TYPES_FIXATION.includes(x.type)) return null;
  const proposes = objectifsFixesA(objectifs, x.id).filter(o => o.statut === 'propose').length;
  if (proposes) return `${proposes > 1 ? `${proposes} objectifs proposés` : 'Un objectif proposé'} par le salarié : validez-le${proposes > 1 ? 's' : ''} ou retirez-le${proposes > 1 ? 's' : ''} avant de clore l’entretien`;
  if (s.objectifsFacultatifs) return null;
  const nonEvalues = objectifsARevoir(objectifs, entretiens, x).filter(o => o.statut === 'ouvert').length;
  return nonEvalues
    ? `${nonEvalues > 1 ? `${nonEvalues} objectifs de la période précédente` : 'Un objectif de la période précédente'} à évaluer avant de clore l’entretien (atteint, partiellement, non atteint, sans objet ou reconduit)`
    : null;
}

/**
 * Compteurs des objectifs par équipe (profil en lecture seule, consultation N+2) : salariés qui en ont, objectifs fixés,
 * en cours et évalués, jamais un libellé ni un résultat. Une équipe de moins de 3 salariés concernés est masquée
 * (seuil d'anonymat des indicateurs agrégés, `SEUIL_ANONYMAT`).
 */
export function compteursObjectifs(objectifs: readonly Objectif[], employes: readonly Pick<Employe, 'id' | 'equipe'>[], seuil = SEUIL_ANONYMAT): CompteurObjectifs[] {
  const equipeDe = new Map(employes.map(e => [e.id, e.equipe || '']));
  const parEquipe = new Map<string, { salaries: Set<number>; objectifs: number; ouverts: number; evalues: number }>();
  for (const o of objectifs) {
    if (o.statut === 'propose') continue;
    const eq = equipeDe.get(o.empId) ?? '';
    const c = parEquipe.get(eq) ?? { salaries: new Set<number>(), objectifs: 0, ouverts: 0, evalues: 0 };
    c.salaries.add(o.empId);
    c.objectifs++;
    if (o.statut === 'ouvert') c.ouverts++;
    else c.evalues++;
    parEquipe.set(eq, c);
  }
  return [...parEquipe].sort(([a], [b]) => a.localeCompare(b)).map(([equipe, c]) => (c.salaries.size < seuil
    ? { equipe, salaries: 0, objectifs: 0, ouverts: 0, evalues: 0, masque: true }
    : { equipe, salaries: c.salaries.size, objectifs: c.objectifs, ouverts: c.ouverts, evalues: c.evalues }));
}
