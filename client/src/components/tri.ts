// Tri par colonne et pagination des grandes listes (t145). Une liste garde son ordre de départ (celui d'avant le tri par
// colonne : gravité, échéance, nom…) tant qu'on ne clique pas sur un en-tête ; un clic trie la colonne, un deuxième
// inverse le sens, un troisième revient à l'ordre de départ. Les valeurs vides vont en dernier dans les deux sens, et deux
// lignes égales gardent leur ordre de départ (tri stable). Le tri choisi est gardé dans `ui.tris` (state/store.tsx) d'un
// écran à l'autre, jamais dans l'adresse de la page.
// Pagination : 50 lignes, puis « Afficher plus » ; elle ne s'active qu'au-delà de 50 lignes et revient aux 50 premières
// quand un filtre change. Les exports CSV prennent toutes les lignes filtrées et triées, pas seulement celles affichées.
// En-têtes cliquables et pied de liste : components/TriListe.tsx.
import { useState } from 'react';
import { useStore } from '../state/store.tsx';

export type Sens = 'asc' | 'desc';
/** Tri choisi par un clic sur un en-tête : colonne (clé de la table des colonnes de la liste) et sens. */
export interface Tri { col: string; sens: Sens }

/** Valeur triée d'une ligne ; null, undefined, '' ou NaN : valeur vide, toujours en dernier. */
type Cle = string | number | null | undefined;
/** Colonne triable : valeur de la ligne, comparaison de deux valeurs non vides, sens du premier clic. */
export interface Colonne<T> { cle: (x: T) => Cle; cmp: (a: string | number, b: string | number) => number; premier: Sens }

/** Ordre alphabétique français : accents et casse ignorés au premier niveau, chiffres lus comme des nombres (EMP-0002 < EMP-0010). */
const FR = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export const comparerTexte = (a: string, b: string) => FR.compare(a, b);

/** Texte : nom, poste, équipe, intitulé. */
export const parTexte = <T>(cle: (x: T) => string | null | undefined): Colonne<T> =>
  ({ cle, cmp: (a, b) => FR.compare(String(a), String(b)), premier: 'asc' });
/** Nombre : solde, jours, nombre de jours avant l'échéance. `premier` : 'desc' pour voir d'abord les plus grands. */
export const parNombre = <T>(cle: (x: T) => number | null | undefined, premier: Sens = 'asc'): Colonne<T> =>
  ({ cle, cmp: (a, b) => Number(a) - Number(b), premier });
/** Date ISO (AAAA-MM-JJ, horodatage ISO) ou objet Date : la plus ancienne d'abord. */
export const parDate = <T>(cle: (x: T) => string | Date | null | undefined, premier: Sens = 'asc'): Colonne<T> =>
  ({ cle: x => { const v = cle(x); return v instanceof Date ? v.getTime() : v; }, cmp: (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0, premier });
/** Rang d'un statut dans `ordre` (le premier : le plus grave ou le plus urgent) ; un statut absent de l'ordre est vide. */
export const parRang = <T, K extends string>(cle: (x: T) => K | null | undefined, ordre: readonly K[]): Colonne<T> =>
  parNombre(x => { const k = cle(x); const i = k == null ? -1 : ordre.indexOf(k); return i < 0 ? null : i; });

const vide = (v: Cle): v is null | undefined => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/**
 * Lignes triées selon `tri` (colonne de `colonnes`). Sans tri, ou pour une colonne inconnue, la liste est rendue telle
 * quelle : l'ordre de départ de l'écran.
 */
export function trier<T>(rows: readonly T[], colonnes: Record<string, Colonne<T>>, tri: Tri | null | undefined): T[] {
  const c = tri ? colonnes[tri.col] : undefined;
  if (!tri || !c) return [...rows];
  const sens = tri.sens === 'desc' ? -1 : 1;
  return rows.map((x, i) => ({ x, i, v: c.cle(x) }))
    .sort((a, b) => {
      const va = vide(a.v), vb = vide(b.v);
      if (va || vb) return va && vb ? a.i - b.i : va ? 1 : -1;
      return sens * c.cmp(a.v as string | number, b.v as string | number) || a.i - b.i;
    })
    .map(r => r.x);
}

/** Tri après un clic sur la colonne `col` : premier sens, puis l'autre, puis l'ordre de départ (null). */
export function triSuivant(tri: Tri | null | undefined, col: string, premier: Sens = 'asc'): Tri | null {
  if (!tri || tri.col !== col) return { col, sens: premier };
  return tri.sens === premier ? { col, sens: premier === 'asc' ? 'desc' : 'asc' } : null;
}

/** Attribut aria-sort de l'en-tête : posé sur la seule colonne triée. */
export const ariaSort = (tri: Tri | null | undefined, col: string): 'ascending' | 'descending' | undefined =>
  tri?.col === col ? (tri.sens === 'asc' ? 'ascending' : 'descending') : undefined;

/**
 * Infobulle de l'en-tête : le sens actuel et l'effet du prochain clic (`triSuivant`), qui dépend du sens du premier clic
 * de la colonne (`premier`) : il inverse le tri, ou revient à l'ordre par défaut de l'écran.
 */
export function titreTri(tri: Tri | null | undefined, col: string, premier: Sens = 'asc'): string {
  const s = ariaSort(tri, col);
  if (!s) return 'Trier par cette colonne';
  const actuel = s === 'ascending' ? 'Trié par ordre croissant' : 'Trié par ordre décroissant';
  return `${actuel} : ${triSuivant(tri, col, premier) ? 'cliquer pour inverser' : 'cliquer pour revenir à l’ordre par défaut'}`;
}

/** Tri d'une liste et son changement par un clic : ce que reçoivent les en-têtes (`<ThTri t={…}>`). */
export interface EtatTri { tri: Tri | null; cliquer: (col: string, premier?: Sens) => void }

/**
 * Tri de la liste `liste` (nom stable, propre à l'écran : 'absences.soldes', 'collaborateurs'…), gardé dans `ui.tris`
 * pendant la session de l'onglet : on retrouve le tri en revenant sur l'écran.
 */
export function useTri(liste: string): EtatTri {
  const { ui, setUi } = useStore();
  const tri = ui.tris?.[liste] ?? null;
  return { tri, cliquer: (col, premier) => setUi({ tris: { ...ui.tris, [liste]: triSuivant(tri, col, premier) } }) };
}

/** Lignes par page des grandes listes : constante, sans réglage. */
export const TAILLE_PAGE = 50;

/**
 * Lignes affichées sur `total`, pour une limite courante : toutes jusqu'à 50, sinon la limite. `reste` : lignes encore
 * masquées ; `active` : la liste dépasse 50 lignes (le pied « Afficher plus » s'affiche).
 */
export function pagination(total: number, limite: number) {
  const affichees = total <= TAILLE_PAGE ? total : Math.max(TAILLE_PAGE, Math.min(total, limite));
  return { total, affichees, reste: total - affichees, active: total > TAILLE_PAGE };
}

export interface Pagination<T> extends ReturnType<typeof pagination> {
  lignes: T[];
  /** 50 lignes de plus. */
  plus: () => void;
  /** Toutes les lignes. */
  tout: () => void;
}

/**
 * Pagination des lignes `rows`. `filtre` résume les filtres de la liste (recherche, équipe, statut…) : quand il change,
 * l'affichage revient aux 50 premières lignes. Le tri ne la remet pas à zéro.
 */
export function usePagination<T>(rows: readonly T[], filtre: string): Pagination<T> {
  const [etat, setEtat] = useState({ filtre, limite: TAILLE_PAGE });
  const limite = etat.filtre === filtre ? etat.limite : TAILLE_PAGE;
  const p = pagination(rows.length, limite);
  return {
    ...p,
    lignes: p.reste ? rows.slice(0, p.affichees) : [...rows],
    plus: () => setEtat({ filtre, limite: limite + TAILLE_PAGE }),
    tout: () => setEtat({ filtre, limite: Number.MAX_SAFE_INTEGER }),
  };
}
