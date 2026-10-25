// Vues par salarié et corps JSON en cache (lot 9, chantier 3, étape 1). Après le cache de l'instantané (lot 8,
// server/src/cache-instantane.ts), deux coûts restaient à chaque révision ou à chaque requête :
// - le calcul d'une vue collaborateur ou manager (`vueDe`, server/src/dataset.ts) filtrait une trentaine de tableaux
//   complets (28 000 feuilles, 7 700 absences sur 5 ans) pour n'en garder que les lignes de quelques salariés ;
// - la sérialisation JSON de la vue (23 Mo pour l'espace RH, 0,4 s avec la compression) était refaite à chaque requête.
// Désormais :
// - les lignes d'un tableau partagé sont regroupées par salarié une fois par tableau (`lignesDe` : index mémorisé par
//   identité du tableau, valable puisque les données partagées ne sont jamais modifiées sur place ; gel sous
//   node --test). Le résultat est exactement celui de `list.filter(x => ids.has(x.empId))` : mêmes lignes, même ordre
//   (fusion par position d'origine quand le périmètre compte plusieurs salariés), toujours dans un tableau neuf. Aucune
//   règle de filtrage ne change : seule la façon de trouver les lignes du périmètre ;
// - le corps JSON d'une vue partagée est calculé une fois par (entrée du cache, clé de vue) : la vue gardée par le cache
//   est propre à sa clé (`cleVue`), et son corps lui est attaché (`corpsAvecTete`). Les champs de tête propres à la
//   requête (`TETE` : utilisateur, révision, dossiers échus de la conservation, abonnement à l'agenda) sont recollés à
//   chaque envoi, à leur place : le corps est, octet pour octet, `JSON.stringify({ ...vue, ...tete })`. Un corps n'est
//   jamais servi sous une autre clé que la sienne (refus explicite).
// Hors du cache (CURSUS_CACHE_INSTANTANE=0, transaction), l'instantané est sérialisé à chaque requête, comme avant.
import type { Response } from 'express';

// ——— Index par salarié ———

/** Lignes d'un salarié dans un tableau partagé, avec leur position d'origine (fusion par position). */
interface Groupe<T> {
  lignes: T[];
  positions: number[];
}
interface Index<T> {
  /** Longueur du tableau à la construction : un tableau modifié malgré la règle (hors gel) est réindexé. */
  n: number;
  groupes: Map<unknown, Groupe<T>>;
}

const index = new WeakMap<readonly object[], Index<object>>();

/** Index par salarié de `list`, construit au premier appel et gardé tant que le tableau vit. */
function indexDe<T extends { empId: number }>(list: readonly T[]): Index<T> {
  const connu = index.get(list) as Index<T> | undefined;
  if (connu && connu.n === list.length) return connu;
  const groupes = new Map<unknown, Groupe<T>>();
  // forEach saute les trous d'un tableau creux, comme filter.
  list.forEach((x, i) => {
    let g = groupes.get(x.empId);
    if (!g) groupes.set(x.empId, g = { lignes: [], positions: [] });
    g.lignes.push(x);
    g.positions.push(i);
  });
  const idx: Index<T> = { n: list.length, groupes };
  index.set(list, idx as unknown as Index<object>);
  return idx;
}

/**
 * Lignes de `list` dont le salarié est dans `ids` : exactement `list.filter(x => ids.has(x.empId))` (mêmes lignes, même
 * ordre, tableau neuf que l'appelant peut trier), sans parcourir tout le tableau une fois l'index construit.
 */
export function lignesDe<T extends { empId: number }>(list: readonly T[], ids: ReadonlySet<number>): T[] {
  const { groupes } = indexDe(list);
  const pris: Groupe<T>[] = [];
  for (const id of ids) {
    const g = groupes.get(id);
    if (g) pris.push(g);
  }
  if (!pris.length) return [];
  if (pris.length === 1) return pris[0].lignes.slice();
  // Plusieurs salariés : positions d'origine réunies puis triées, pour rendre l'ordre du tableau.
  const positions = pris.flatMap(g => g.positions).sort((a, b) => a - b);
  return positions.map(i => list[i]);
}

/** Filtre des lignes d'un périmètre, tel que `vueDe` l'emploie (`mine`). */
export type FiltrePerimetre = (ids: ReadonlySet<number>) => <T extends { empId: number }>(list: readonly T[]) => T[];

/** Filtre indexé (par défaut) : `lignesDe`. */
export const filtreIndexe: FiltrePerimetre = ids => list => lignesDe(list, ids);
/** Filtre d'origine, parcours complet de chaque tableau : la référence des tests d'exactitude. */
export const filtreComplet: FiltrePerimetre = ids => list => list.filter(x => ids.has(x.empId));

// ——— Corps JSON ———

/**
 * Champs de tête de l'instantané, propres à chaque requête : jamais gardés dans un corps en cache, recollés à l'envoi
 * (server/src/dataset.ts, `buildSnapshot`).
 */
export const TETE: ReadonlySet<string> = new Set(['user', 'revision', 'conservation', 'agendaJeton']);

/** JSON déjà sérialisé, inséré tel quel dans un corps (`objetJson`) ou envoyé tel quel (`envoyerJson`). */
export class JsonBrut {
  readonly json: string;
  constructor(json: string) { this.json = json; }
}

/** Champ `"cle":valeur` d'un objet JSON, comme JSON.stringify l'écrit ; undefined pour une valeur qu'il omet. */
function membre(cle: string, valeur: unknown): string | undefined {
  const v = valeur instanceof JsonBrut ? valeur.json : JSON.stringify(valeur);
  return v === undefined ? undefined : `${JSON.stringify(cle)}:${v}`;
}

/** Objet JSON de `champs`, dans leur ordre : `JSON.stringify(champs)`, une valeur `JsonBrut` étant insérée telle quelle. */
export function objetJson(champs: Record<string, unknown>): JsonBrut {
  const parties: string[] = [];
  for (const [cle, valeur] of Object.entries(champs)) {
    const m = membre(cle, valeur);
    if (m !== undefined) parties.push(m);
  }
  return new JsonBrut(`{${parties.join(',')}}`);
}

/** Emplacement d'un champ de tête dans le corps : sa valeur de la vue, si la requête n'en donne pas. */
interface Emplacement {
  cle: string;
  membre: string | undefined;
}
/** Corps d'une vue partagée : champs hors tête déjà sérialisés (par suites contiguës), emplacements de la tête. */
interface Corps {
  /** Clé de vue du corps : jamais servi sous une autre. */
  cle: string;
  morceaux: (string | Emplacement)[];
  /** Champs de la vue, tête comprise : un champ de tête absent de la vue va à la fin, comme dans `{ ...vue, ...tete }`. */
  champs: ReadonlySet<string>;
}

/** Corps par vue partagée : la vue du cache est propre à son entrée et à sa clé, le corps vit et meurt avec elle. */
const corps = new WeakMap<object, Corps>();

function preparer(vue: object, cle: string): Corps {
  const morceaux: (string | Emplacement)[] = [];
  let suite: string[] = [];
  const clore = () => { if (suite.length) morceaux.push(suite.join(',')); suite = []; };
  for (const [k, v] of Object.entries(vue)) {
    if (TETE.has(k)) {
      clore();
      morceaux.push({ cle: k, membre: membre(k, v) });
      continue;
    }
    const m = membre(k, v);
    if (m !== undefined) suite.push(m);
  }
  clore();
  return { cle, morceaux, champs: new Set(Object.keys(vue)) };
}

/** Nombre de corps calculés (tests : un corps par vue partagée, réutilisé ensuite). */
export let corpsCalcules = 0;

/**
 * Corps JSON de la vue partagée `vue` (clé `cle`), la tête de la requête recollée : octet pour octet
 * `JSON.stringify({ ...vue, ...tete })`. Le corps de la vue est calculé au premier envoi puis gardé avec elle. `tete`
 * ne porte que des champs de `TETE`.
 */
export function corpsAvecTete(vue: object, cle: string, tete: Record<string, unknown>): JsonBrut {
  let c = corps.get(vue);
  if (!c) {
    c = preparer(vue, cle);
    corps.set(vue, c);
    corpsCalcules++;
  } else if (c.cle !== cle) {
    throw new Error(`Corps de la vue ${c.cle} demandé pour la clé ${cle}`);
  }
  for (const k of Object.keys(tete)) if (!TETE.has(k)) throw new Error(`Champ ${k} hors de la tête de l’instantané`);
  const parties: string[] = [];
  for (const m of c.morceaux) {
    const s = typeof m === 'string' ? m : Object.hasOwn(tete, m.cle) ? membre(m.cle, tete[m.cle]) : m.membre;
    if (s !== undefined) parties.push(s);
  }
  for (const [k, v] of Object.entries(tete)) {
    if (c.champs.has(k)) continue;
    const s = membre(k, v);
    if (s !== undefined) parties.push(s);
  }
  return new JsonBrut(`{${parties.join(',')}}`);
}

/** Envoie un corps déjà sérialisé, comme `res.json` (type application/json, jeu utf-8 ajouté par `res.send`). */
export function envoyerJson(res: Response, corps: JsonBrut): void {
  if (!res.get('Content-Type')) res.set('Content-Type', 'application/json');
  res.send(corps.json);
}
