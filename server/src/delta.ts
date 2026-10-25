// Delta fusionné de la lecture brute (lot 9, chantier 2, étape 2). Entre deux révisions de la base, le journal des
// changements (table `changements`, `Db.lireChangements` : chantier 1) dit quelles lignes de quelles tables ont changé.
// La lecture brute de la révision suivante en est tirée sans tout relire :
// - `lireDelta(db, brut, changements)`, à faire dans la même lecture stable (ou sous le verrou d'écriture, dans la
//   transaction) que la lecture des changements : relit les seules lignes changées (`Db.lireLignes`, par clé), ou la
//   table entière quand une fusion par clé ne rendrait pas l'ordre de la lecture brute ou coûterait plus qu'elle (clé
//   texte, table triée par une autre colonne que sa clé : `ORDRE_LECTURE`, marqueur « toute la table », plus de
//   `SEUIL_RELECTURE` clés) ; les réglages lus par l'instantané si la table `settings` a changé ; le statut des envois
//   des seuls relevés concernés (relevé changé, ou envoi changé qu'un relevé désigne) ;
// - `appliquerDelta(brut, delta)`, pur : une nouvelle lecture brute, en partage structurel. Seules les tables dont une
//   ligne a vraiment changé reçoivent un nouveau tableau (insertion par dichotomie sur la clé entière, donc le même ordre
//   que `ORDER BY` clé) ; les autres tableaux, et les lignes inchangées d'une table relue, sont repris par identité, ce
//   qui garde les dérivés mémoïsés de `assembler` (server/src/lecture-brute.ts). Rien de `brut` n'est modifié (gel des
//   tests). Rend aussi les champs de l'instantané qui ont changé (`champsChanges`, d'après `LECTURES`), les salariés
//   touchés (`touches`, avant et après la modification) et si les résumés de la paie peuvent être repris.
// `assembler(appliquerDelta(brutN, lireDelta(…)).brut)` est l'instantané de `assembler(lireBrut())` à la révision
// suivante : tests/lecture-incrementale.test.ts le vérifie après chaque écriture d'une suite scriptée et aléatoire.
import { isDeepStrictEqual } from 'node:util';
import type { Dataset, Envoi } from '../../shared/types.ts';
import { type Changements, type Db, TABLES, type TableName } from './db.ts';
import {
  type Brut, COLONNES_OMISES, DEP_PAIE, LECTURES, lireReglages, lireTable, ORDRE_LECTURE, type ReglagesBruts, statutsDesEnvois,
} from './lecture-brute.ts';

/** Au-delà de ce nombre de clés changées dans une table, elle est relue en entière plutôt que par paquets de clés. */
export const SEUIL_RELECTURE = 2000;

/** Tables de la lecture brute : chaque propriété de `Brut` sauf les réglages et le statut des envois porte le nom de sa table. */
type TableBrute = Exclude<keyof Brut, 'reglages' | 'statutsEnvoi'>;
type Ligne = Record<string, unknown>;

/** Lignes relues d'une table : toute la table (`tout`), ou les lignes encore présentes parmi les clés changées `cles`. */
export type LectureTable = { tout: true; lignes: readonly Ligne[] } | { tout: false; cles: ReadonlySet<string>; lignes: readonly Ligne[] };

/** Delta lu en base entre deux révisions : de quoi tirer la lecture brute suivante de la précédente (`appliquerDelta`). */
export interface Delta {
  /** Changements du journal, tels que rendus par `Db.lireChangements` (toutes les tables, lues ou non par l'instantané). */
  changements: Changements;
  /** Lignes relues, par table de la lecture brute changée. */
  tables: ReadonlyMap<TableBrute, LectureTable>;
  /** Réglages de l'instantané relus (table `settings` changée), sinon null. */
  reglages: ReglagesBruts | null;
  /**
   * Statut des envois relus : identifiants des envois concernés (`ids`) et leur statut (absent : envoi disparu), pour
   * tous les relevés (`tous`) ou les seuls concernés. Null si ni les relevés ni les envois n'ont changé.
   */
  statuts: { tous: boolean; ids: ReadonlySet<number>; valeurs: ReadonlyMap<number, Envoi['statut']> } | null;
}

/** Issue de la fusion d'un delta : la lecture brute suivante et ce qui a changé. */
export interface Fusion {
  brut: Brut;
  /** Tables dont une ligne lue par l'instantané a vraiment changé (`settings` : un réglage de l'instantané ; `envois` : un statut d'envoi d'un relevé). */
  tablesChangees: ReadonlySet<TableName>;
  /** Champs de l'instantané complet dont une table a changé (`LECTURES`), résumés de la paie compris. */
  champsChanges: ReadonlySet<keyof Dataset>;
  /** Salariés des lignes changées, avant et après la modification (fiche : son identifiant). */
  touches: ReadonlySet<number>;
  /**
   * Vrai si aucune table dont dépendent les résumés de la paie (`DEP_PAIE`) n'a changé : ceux de la lecture précédente
   * valent pour la suivante. Les tables lues en base par les résumés comptent dès qu'une de leurs lignes est au journal
   * (contenu des lots, réglages hors de l'instantané) ; les envois, seulement si le statut d'un relevé a changé (ils ne
   * sont lus qu'à travers lui).
   */
  paieReportee: boolean;
}

/** Clé primaire de la table `t` (nom dans le code) et vrai si elle est entière (ordre numérique, fusion par dichotomie). */
function cleDe(t: TableName): { pk: string; entiere: boolean } {
  const def = TABLES[t] as { pk: string; cols: Record<string, string> };
  const type = def.cols[def.pk];
  return { pk: def.pk, entiere: type === 'int' || type === 'real' };
}

/** Vrai si la table `t`, dont les changements sont `ch`, est à relire en entier plutôt que par ses clés changées. */
export function relectureComplete(t: TableName, ch: ReadonlySet<string> | 'tout'): boolean {
  return ch === 'tout' || ch.size > SEUIL_RELECTURE || !cleDe(t).entiere || ORDRE_LECTURE[t] !== undefined;
}

/** Lignes des clés `cles` de `t`, décodées comme par la lecture brute (sans `COLONNES_OMISES`). */
async function lireLignesBrutes(db: Db, t: TableName, cles: Iterable<string>): Promise<Ligne[]> {
  const lignes = await db.lireLignes<Ligne>(t, cles);
  const sans = COLONNES_OMISES[t];
  if (sans) for (const l of lignes) for (const c of sans) delete l[c];
  return lignes;
}

/**
 * Position de la clé `k` dans `lignes`, triées par la clé entière `pk` : indice de la ligne de cette clé, ou de la
 * place où l'insérer (première ligne de clé supérieure).
 */
export function positionCle(lignes: readonly object[], pk: string, k: number): number {
  let bas = 0, haut = lignes.length;
  while (bas < haut) {
    const m = (bas + haut) >> 1;
    if (Number((lignes[m] as Ligne)[pk]) < k) bas = m + 1; else haut = m;
  }
  return bas;
}

/** Salarié d'une ligne : la fiche elle-même (`employes`), sinon sa colonne `empId` si elle en a une. */
function salarieDe(t: TableName, l: Ligne | undefined): number | null {
  if (!l) return null;
  const v = t === 'employes' ? l.id : l.empId;
  return typeof v === 'number' ? v : null;
}

/**
 * Fusion des lignes relues par clé dans `avant` (trié par la clé entière `pk`) : ligne remplacée, insérée à sa place ou
 * retirée (clé changée sans ligne relue). Une ligne relue identique à l'ancienne garde l'ancienne ; aucun changement
 * réel : `avant` lui-même.
 */
function fusionner(t: TableName, avant: readonly Ligne[], pk: string, cles: ReadonlySet<string>, lignes: readonly Ligne[], touches: Set<number>): readonly Ligne[] {
  const relues = new Map(lignes.map(l => [Number(l[pk]), l]));
  let out: Ligne[] | null = null;
  const toucher = (l: Ligne | undefined) => { const e = salarieDe(t, l); if (e !== null) touches.add(e); };
  for (const k of [...cles].map(Number).sort((a, b) => a - b)) {
    const courant = out ?? avant;
    const i = positionCle(courant, pk, k);
    const present = i < courant.length && Number(courant[i][pk]) === k ? courant[i] : undefined;
    const l = relues.get(k);
    if (l && present && isDeepStrictEqual(present, l)) continue;
    if (!l && !present) continue;
    out ??= avant.slice();
    toucher(present);
    toucher(l);
    if (l && present) out[i] = l;
    else if (l) out.splice(i, 0, l);
    else out.splice(i, 1);
  }
  return out ?? avant;
}

/**
 * Table relue en entier : les lignes relues, dans leur ordre, chaque ligne identique à l'ancienne de même clé reprise
 * telle quelle ; aucun changement réel (mêmes lignes dans le même ordre) : `avant` lui-même.
 */
function remplacer(t: TableName, avant: readonly Ligne[], pk: string, lignes: readonly Ligne[], touches: Set<number>): readonly Ligne[] {
  const anciennes = new Map(avant.map(l => [l[pk], l]));
  let identique = avant.length === lignes.length;
  const toucher = (l: Ligne | undefined) => { const e = salarieDe(t, l); if (e !== null) touches.add(e); };
  const out = lignes.map((l, i) => {
    const a = anciennes.get(l[pk]);
    anciennes.delete(l[pk]);
    if (a && isDeepStrictEqual(a, l)) {
      if (avant[i] !== a) identique = false;
      return a;
    }
    identique = false;
    toucher(a);
    toucher(l);
    return l;
  });
  // Lignes disparues.
  for (const a of anciennes.values()) toucher(a);
  return identique ? avant : out;
}

/** Réglages relus, chaque réglage inchangé repris tel quel ; aucun changement : `avant` lui-même. */
function reglagesFusionnes(avant: ReglagesBruts, relus: ReglagesBruts): ReglagesBruts {
  let change = false;
  const out = { ...avant } as Record<keyof ReglagesBruts, unknown>;
  for (const k of Object.keys(relus) as (keyof ReglagesBruts)[]) {
    if (isDeepStrictEqual(avant[k], relus[k])) continue;
    out[k] = relus[k];
    change = true;
  }
  return change ? out as unknown as ReglagesBruts : avant;
}

/** Envois désignés par des relevés (`releves.envoiId`). */
const envoisDes = (releves: readonly { envoiId?: number | null }[]) => new Set(releves.map(r => r.envoiId).filter((id): id is number => !!id));

/**
 * Delta de `brut` (lecture brute de la révision où commencent les `changements`) : lignes, réglages et statuts d'envoi
 * relus en base, à faire dans la lecture stable ou la transaction où les changements ont été lus.
 */
export async function lireDelta(db: Db, brut: Brut, changements: Changements): Promise<Delta> {
  const tables = new Map<TableBrute, LectureTable>();
  for (const [t, ch] of changements) {
    if (!(t in brut)) continue;
    const tb = t as TableBrute;
    tables.set(tb, relectureComplete(t, ch) ? { tout: true, lignes: await lireTable<Ligne>(db, t) } : { tout: false, cles: ch as ReadonlySet<string>, lignes: await lireLignesBrutes(db, t, ch as ReadonlySet<string>) });
  }
  const reglages = changements.has('settings') ? await lireReglages(db) : null;
  // Statuts d'envoi : ceux des relevés changés, et des envois changés que désigne un relevé (avant ou après).
  const relevesLus = tables.get('releves'), envois = changements.get('envois');
  let statuts: Delta['statuts'] = null;
  if (relevesLus || envois) {
    const releves = relevesLus ? (relevesLus.tout ? relevesLus.lignes : fusionner('releves', brut.releves as unknown as Ligne[], 'id', relevesLus.cles, relevesLus.lignes, new Set())) : brut.releves as unknown as Ligne[];
    const designes = envoisDes(releves as { envoiId?: number | null }[]);
    const tous = relevesLus?.tout === true || envois === 'tout';
    const ids = tous ? designes : new Set<number>();
    if (!tous) {
      if (relevesLus) for (const id of envoisDes(relevesLus.lignes as { envoiId?: number | null }[])) ids.add(id);
      if (envois) for (const k of envois as ReadonlySet<string>) if (designes.has(Number(k))) ids.add(Number(k));
    }
    statuts = { tous, ids, valeurs: ids.size ? await statutsDesEnvois(db, [...ids].map(envoiId => ({ envoiId }))) : new Map() };
  }
  return { changements, tables, reglages, statuts };
}

/**
 * Lecture brute suivante, tirée de `brut` et de `delta` sans rien modifier (partage structurel : voir l'en-tête), avec ce
 * qui a changé (`Fusion`).
 */
export function appliquerDelta(brut: Brut, delta: Delta): Fusion {
  const out: Brut = { ...brut };
  const changees = new Set<TableName>(), touches = new Set<number>();
  for (const [t, lu] of delta.tables) {
    const avant = brut[t] as unknown as readonly Ligne[];
    const { pk } = cleDe(t);
    const apres = lu.tout ? remplacer(t, avant, pk, lu.lignes, touches) : fusionner(t, avant, pk, lu.cles, lu.lignes, touches);
    if (apres === avant) continue;
    (out as unknown as Record<string, unknown>)[t] = apres;
    changees.add(t);
  }
  if (delta.reglages) {
    const r = reglagesFusionnes(brut.reglages, delta.reglages);
    if (r !== brut.reglages) { out.reglages = r; changees.add('settings'); }
  }
  if (delta.statuts) {
    // Statut de chaque envoi désigné par un relevé : relu s'il est concerné, repris sinon.
    const { tous, ids, valeurs } = delta.statuts;
    const statuts = new Map<number, Envoi['statut']>();
    for (const id of envoisDes(out.releves)) {
      const s = tous || ids.has(id) ? valeurs.get(id) : brut.statutsEnvoi.get(id);
      if (s !== undefined) statuts.set(id, s);
    }
    if (!isDeepStrictEqual(statuts, brut.statutsEnvoi)) { out.statutsEnvoi = statuts; changees.add('envois'); }
  }
  const champsChanges = new Set<keyof Dataset>();
  for (const [champ, tables] of Object.entries(LECTURES) as [keyof Dataset, readonly TableName[]][]) {
    if (tables.some(t => changees.has(t))) champsChanges.add(champ);
  }
  // Résumés de la paie : toute table de `DEP_PAIE` au journal (lue en base par les résumés, ou par l'instantané), sauf
  // les envois, comptés seulement si un statut de relevé a changé.
  const paieReportee = !changees.has('envois') && ![...delta.changements.keys()].some(t => t !== 'envois' && DEP_PAIE.includes(t));
  if (!paieReportee) { champsChanges.add('absencesPaie'); champsChanges.add('deplacementsPaie'); }
  return { brut: changees.size ? out : brut, tablesChangees: changees, champsChanges, touches, paieReportee };
}
