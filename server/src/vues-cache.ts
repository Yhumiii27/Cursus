// Vues par salarié et corps JSON en cache (lot 9, chantier 3, étapes 1 et 2). Après le cache de l'instantané (lot 8,
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
// Report des vues (étape 2) : une entrée dérivée de la précédente par un delta (server/src/cache-instantane.ts) reprend
// telles quelles les vues collaborateur et manager de la précédente que le delta ne touche pas (`reporterVues`) : tous
// les champs changés sont des lignes par salarié (`CHAMPS_PAR_SALARIE`) ou des champs que ces vues ne lisent pas
// (`CHAMPS_HORS_VUES`), et aucun des salariés touchés n'est dans l'ensemble des salariés que la vue lit (`perimetreDe`,
// posé par `vueDe`, jamais envoyé au navigateur). Une vue reportée garde son corps JSON. Les vues RH ne sont jamais
// reportées. CURSUS_VUES_REPORT=0 coupe le report (chaque vue est recalculée à chaque révision).
// Lot 10, chantier A : un grand corps (vues RH, grandes vues manager) est gardé en octets UTF-8 (`SEUIL_CORPS_OCTETS`) et
// servi en octets (`corpsEnOctets`), compressé au besoin une fois par tête de requête (server/src/corps-compresses.ts) ;
// les lignes d'un grand tableau (`LIGNES_MEMO`) sont sérialisées une par une, et le JSON de chaque ligne partagée gardé
// tant qu'elle vit : d'une révision à la suivante, seules les lignes changées sont resérialisées. CURSUS_CORPS_OCTETS=0
// revient à la sérialisation du lot 9 (`corpsOctetsActif`).
import type { Response } from 'express';
import type { Dataset } from '../../shared/types.ts';

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
  /**
   * Suites de champs sérialisées : en texte, ou en octets UTF-8 pour un grand corps (`SEUIL_CORPS_OCTETS`, lot 10 : la
   * moitié de la mémoire d'une chaîne JavaScript à deux octets par caractère, et rien à convertir à l'envoi).
   */
  morceaux: (string | Octets | Emplacement)[];
  /** Champs de la vue, tête comprise : un champ de tête absent de la vue va à la fin, comme dans `{ ...vue, ...tete }`. */
  champs: ReadonlySet<string>;
  /** Longueur du corps sans la tête, en caractères (texte) ou en octets. */
  taille: number;
}

/**
 * Taille (caractères JSON) à partir de laquelle le corps d'une vue est gardé en octets UTF-8 plutôt qu'en texte (lot 10,
 * chantier A) : les vues RH sur 5 ans (23 Mo, des caractères hors Latin-1 dans les données : 47 Mo par chaîne en mémoire)
 * et les grandes vues manager ; servi en octets par GET /api/data (`corpsEnOctets`), décodé pour la réponse d'une action.
 */
export const SEUIL_CORPS_OCTETS = 256 * 1024;

/** Corps par vue partagée : la vue du cache est propre à son entrée et à sa clé, le corps vit et meurt avec elle. */
const corps = new WeakMap<object, Corps>();

/**
 * Suite d'octets UTF-8 d'un grand corps, en morceaux jamais recopiés : JSON des lignes partagées (gardé par ligne,
 * `ligneOctets`), virgules et noms de champs. Le corps d'une vue RH tient ainsi en une liste de références vers le JSON
 * de ses lignes, que les vues de la même entrée et des entrées suivantes partagent, au lieu d'une copie de 23 Mo par vue.
 */
class Octets {
  readonly morceaux: Buffer[];
  readonly length: number;
  constructor(morceaux: Buffer[]) {
    this.morceaux = morceaux;
    let n = 0;
    for (const b of morceaux) n += b.length;
    this.length = n;
  }
}

/**
 * Corps en octets actif (lot 10) : CURSUS_CORPS_OCTETS vaut autre chose que « 0 ». À « 0 », chaque corps est sérialisé
 * en texte d'un bloc, comme au lot 9 : ni JSON gardé par ligne (`membreLignes`), ni corps en octets (`grandCorps` faux,
 * donc ni corps compressés gardés ni préchauffage de leur compression ; le module de compression compresse la réponse).
 * Réglage de repli et de comparaison : le corps servi est le même octet pour octet.
 */
export const corpsOctetsActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_CORPS_OCTETS?.trim() !== '0';

function preparer(vue: object, cle: string): Corps {
  if (!corpsOctetsActif()) return preparerTexte(vue, cle);
  const morceaux: (string | Octets | Emplacement)[] = [];
  let suite: (string | Octets)[] = [];
  let enOctets = false, taille = 0;
  const clore = () => { if (suite.length) morceaux.push(joindre(suite)); suite = []; };
  for (const [k, v] of Object.entries(vue)) {
    if (TETE.has(k)) {
      clore();
      morceaux.push({ cle: k, membre: membre(k, v) });
      continue;
    }
    // Grand tableau (feuilles, absences) : sérialisé ligne par ligne, chaque ligne partagée gardée en octets (lot 10).
    const m = Array.isArray(v) && v.length >= LIGNES_MEMO ? membreLignes(k, v) : membre(k, v);
    if (m === undefined) continue;
    if (m instanceof Octets) enOctets = true;
    taille += m.length;
    suite.push(m);
  }
  clore();
  // Grand corps : suites gardées en octets UTF-8 (les chaînes, temporaires, sont libérées).
  if (enOctets || taille >= SEUIL_CORPS_OCTETS) {
    const octets = morceaux.map(m => (typeof m === 'string' ? new Octets([Buffer.from(m, 'utf8')]) : m));
    return { cle, morceaux: octets, champs: new Set(Object.keys(vue)), taille: octets.reduce((n, m) => n + (m instanceof Octets ? m.length : 0), 0) };
  }
  return { cle, morceaux, champs: new Set(Object.keys(vue)), taille };
}

/** Corps en texte, champ par champ (`membre`) : la préparation du lot 9 (CURSUS_CORPS_OCTETS=0). */
function preparerTexte(vue: object, cle: string): Corps {
  const morceaux: (string | Emplacement)[] = [];
  let suite: string[] = [], taille = 0;
  const clore = () => { if (suite.length) morceaux.push(suite.join(',')); suite = []; };
  for (const [k, v] of Object.entries(vue)) {
    if (TETE.has(k)) {
      clore();
      morceaux.push({ cle: k, membre: membre(k, v) });
      continue;
    }
    const m = membre(k, v);
    if (m === undefined) continue;
    taille += m.length;
    suite.push(m);
  }
  clore();
  return { cle, morceaux, champs: new Set(Object.keys(vue)), taille };
}

/** Membres d'une suite réunis par des virgules : en texte, ou en octets dès que l'un d'eux en est. */
function joindre(suite: (string | Octets)[]): string | Octets {
  if (suite.every(m => typeof m === 'string')) return suite.join(',');
  const octets: Buffer[] = [];
  suite.forEach((m, i) => {
    if (i) octets.push(VIRGULE);
    if (typeof m === 'string') octets.push(Buffer.from(m, 'utf8'));
    else for (const b of m.morceaux) octets.push(b);
  });
  return new Octets(octets);
}

// ——— Lignes sérialisées une fois (lot 10, chantier A) ———
// Le corps d'une vue RH sur 5 ans (23 Mo, dont 19 Mo de feuilles) était resérialisé en entier à chaque révision, alors
// qu'une tranche de validation ne change que quelques dizaines de feuilles. Les lignes d'un grand tableau sont désormais
// sérialisées une par une, et le JSON (en octets UTF-8) de chaque ligne partagée gardé tant qu'elle vit (WeakMap) : la
// vue suivante, ou celle d'un autre profil, qui reprend la même ligne (même objet : le delta ne remplace que les lignes
// changées, server/src/delta.ts) reprend son JSON. Les données partagées ne sont jamais modifiées (gel sous node --test) ;
// seules les lignes faites d'un objet ordinaire (ou d'un tableau) sont gardées, les autres valeurs sont sérialisées à
// chaque fois. Le résultat est, octet pour octet, celui de JSON.stringify sur le tableau entier.

/** Longueur à partir de laquelle un tableau d'une vue est sérialisé ligne par ligne. */
export const LIGNES_MEMO = 256;

const lignesJson = new WeakMap<object, Buffer>();

/** Lignes sérialisées réutilisées (tests, mesures). */
export const LIGNES = { reprises: 0, serialisees: 0 };

/** JSON d'un élément de tableau, comme JSON.stringify l'écrit dans le tableau (null pour ce qu'il omet). */
function ligneOctets(x: unknown): Buffer {
  const ordinaire = x !== null && typeof x === 'object' && (Array.isArray(x) || Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
  if (ordinaire) {
    const connu = lignesJson.get(x);
    if (connu) { LIGNES.reprises++; return connu; }
  }
  LIGNES.serialisees++;
  const b = Buffer.from(JSON.stringify(x) ?? 'null', 'utf8');
  if (ordinaire) lignesJson.set(x as object, b);
  return b;
}

/**
 * Membre `"cle":[…]` d'un grand tableau, en octets : JSON.stringify(v), ligne par ligne (trous et undefined : null),
 * sans recopier le JSON des lignes.
 */
function membreLignes(cle: string, v: readonly unknown[]): Octets {
  const octets: Buffer[] = [Buffer.from(`${JSON.stringify(cle)}:[`, 'utf8')];
  for (let i = 0; i < v.length; i++) {
    if (i) octets.push(VIRGULE);
    octets.push(ligneOctets(v[i]));
  }
  octets.push(CROCHET);
  return new Octets(octets);
}
const CROCHET = Buffer.from(']');

/** Nombre de corps calculés (tests : un corps par vue partagée, réutilisé ensuite). */
export let corpsCalcules = 0;

/**
 * Corps JSON de la vue partagée `vue` (clé `cle`), la tête de la requête recollée : octet pour octet
 * `JSON.stringify({ ...vue, ...tete })`. Le corps de la vue est calculé au premier envoi puis gardé avec elle. `tete`
 * ne porte que des champs de `TETE`.
 */
export function corpsAvecTete(vue: object, cle: string, tete: Record<string, unknown>): JsonBrut {
  const parties = partiesDuCorps(vue, cle, tete).map(m => (typeof m === 'string' ? m : Buffer.concat(m.morceaux, m.length).toString('utf8')));
  return new JsonBrut(`{${parties.join(',')}}`);
}

/** Corps de la vue partagée `vue` (clé `cle`) préparé une fois, puis retrouvé ; refus sous une autre clé. */
function corpsDe(vue: object, cle: string): Corps {
  let c = corps.get(vue);
  if (!c) {
    c = preparer(vue, cle);
    corps.set(vue, c);
    corpsCalcules++;
  } else if (c.cle !== cle) {
    throw new Error(`Corps de la vue ${c.cle} demandé pour la clé ${cle}`);
  }
  return c;
}

/** Membres du corps, tête de la requête recollée, dans l'ordre de `{ ...vue, ...tete }` (texte ou octets). */
function partiesDuCorps(vue: object, cle: string, tete: Record<string, unknown>): (string | Octets)[] {
  const c = corpsDe(vue, cle);
  for (const k of Object.keys(tete)) if (!TETE.has(k)) throw new Error(`Champ ${k} hors de la tête de l’instantané`);
  const parties: (string | Octets)[] = [];
  for (const m of c.morceaux) {
    const s = typeof m === 'string' || m instanceof Octets ? m : Object.hasOwn(tete, m.cle) ? membre(m.cle, tete[m.cle]) : m.membre;
    if (s !== undefined) parties.push(s);
  }
  for (const [k, v] of Object.entries(tete)) {
    if (c.champs.has(k)) continue;
    const s = membre(k, v);
    if (s !== undefined) parties.push(s);
  }
  return parties;
}

/**
 * Vrai si le corps de la vue partagée `vue` (clé `cle`) est gardé en octets (`SEUIL_CORPS_OCTETS`) : GET /api/data
 * l'envoie alors en octets (`corpsEnOctets`), compressé tel que gardé avec la vue s'il y a lieu. Prépare le corps.
 */
export function grandCorps(vue: object, cle: string): boolean {
  return corpsDe(vue, cle).morceaux.some(m => m instanceof Octets);
}

/**
 * Corps en octets UTF-8 de la vue partagée `vue`, tête de la requête recollée : octet pour octet
 * `Buffer.from(JSON.stringify({ ...vue, ...tete }))`, sans passer par une chaîne de la taille du corps (lot 10).
 */
export function corpsEnOctets(vue: object, cle: string, tete: Record<string, unknown>): Buffer {
  const parties = partiesDuCorps(vue, cle, tete);
  const octets: Buffer[] = [ACCOLADE_OUVRANTE];
  parties.forEach((m, i) => {
    if (i) octets.push(VIRGULE);
    if (typeof m === 'string') octets.push(Buffer.from(m, 'utf8'));
    else for (const b of m.morceaux) octets.push(b);
  });
  octets.push(ACCOLADE_FERMANTE);
  return Buffer.concat(octets);
}
const VIRGULE = Buffer.from(','), ACCOLADE_OUVRANTE = Buffer.from('{'), ACCOLADE_FERMANTE = Buffer.from('}');

/** Envoie un corps JSON déjà en octets UTF-8 (type application/json, jeu utf-8 déclaré). */
export function envoyerOctets(res: Response, octets: Buffer): void {
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.send(octets);
}

/** Envoie un corps déjà sérialisé, comme `res.json` (type application/json, jeu utf-8 ajouté par `res.send`). */
export function envoyerJson(res: Response, corps: JsonBrut): void {
  if (!res.get('Content-Type')) res.set('Content-Type', 'application/json');
  res.send(corps.json);
}

// ——— Report des vues d'une entrée à la suivante (étape 2) ———

/** Report actif : CURSUS_VUES_REPORT vaut autre chose que « 0 ». */
export const reportActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_VUES_REPORT?.trim() !== '0';

/**
 * Champs de l'instantané faits de lignes par salarié (colonne `empId`, une ligne de la table par ligne du champ, sans
 * calcul qui mêle plusieurs salariés), que `vueDe` ne lit, pour une vue collaborateur ou manager, qu'à travers les lignes
 * des salariés de son périmètre (`mine`, filtre sur `user.empId`, membres des équipes encadrées pour la couverture). Une
 * ligne changée d'un autre salarié ne change pas la vue. Ni `attentesSession` (place dans la file, qui dépend des autres
 * inscrits), ni `mandats` et `pieces` (effectif et visibilité communs) : ils invalident toutes les vues, comme les
 * fiches, les équipes, les délégations, les sessions, les réglages et les référentiels.
 * lot 11 — organigramme : entités et sites (`referentiels`) et présents de l'organigramme (`presentsOrganigramme`, tiré
 * de toutes les fiches) sont des champs communs : leur écriture, rare, recalcule toutes les vues.
 */
export const CHAMPS_PAR_SALARIE: ReadonlySet<keyof Dataset> = new Set<keyof Dataset>([
  'feuilles', 'absences', 'cet', 'reports', 'soldesReprise', 'clotures', 'informationsCp', 'fractionnements', 'missions', 'taches', 'voyages',
  'contratsHistorique', 'avenantsForfait', 'entretiens', 'demandesCollab', 'demandesVisite', 'inscriptions', 'participations', 'formationsSuivies',
  'habDelivrances', 'evaluationsFormation', 'astreintes', 'interventionsAstreinte',
  // lot 11 — notes de frais : lignes par salarié, lues par la vue à travers le filtre propre aux frais (server/src/dataset.ts :
  // équipe directe et délégations « frais », sous-ensemble du périmètre retenu de la vue).
  'notesFrais', 'lignesFrais', 'vehiculesPerso', 'avancesFrais',
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
]);

/**
 * Champs qu'une vue collaborateur ou manager ne lit pas : remplacés par une constante dans `vueDe`, et lus par aucune des
 * règles qu'elle appelle (`Domain`, couverture, visites dues, délégations…). Les résumés de la paie (`absencesPaie`,
 * `deplacementsPaie`) ne sont d'ailleurs jamais remis à ces vues (`donneesDe` sans paie : profils qui ne la voient pas).
 */
export const CHAMPS_HORS_VUES: ReadonlySet<keyof Dataset> = new Set<keyof Dataset>([
  'absencesPaie', 'deplacementsPaie', 'plan', 'budgets', 'exercicesClos', 'demandesKeystone', 'soldesSortie', 'lotsPaie', 'rubriquesPaie', 'releves',
  'reprises', 'declarationsPasseport',
  // lot 11 — indicateurs : arrêtés annuels, vides hors de l'espace RH.
  'indicateursArretes',
  // lot 11 — dossiers OPCO : service RH et lecture seule seulement.
  'dossiersOpco', 'versementsOpco',
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
]);

/** Salariés lus par chaque vue collaborateur ou manager calculée par `vueDe` (jamais une propriété de la vue : rien n'en part au navigateur). */
const perimetres = new WeakMap<object, ReadonlySet<number>>();

/** Retient l'ensemble `ids` des salariés que lit la vue `vue` (`vueDe`), et rend la vue. */
export function retenirPerimetre<T extends object>(vue: T, ids: ReadonlySet<number>): T {
  perimetres.set(vue, ids);
  return vue;
}

/** Salariés lus par la vue `vue`, si `vueDe` les a retenus (vue collaborateur ou manager) ; sinon undefined (jamais reportée). */
export const perimetreDe = (vue: object): ReadonlySet<number> | undefined => perimetres.get(vue);

/** Ce qu'un delta a changé d'une entrée à la suivante (server/src/delta.ts, `Fusion`). */
export interface SuiteDelta {
  champsChanges: ReadonlySet<keyof Dataset>;
  touches: ReadonlySet<number>;
}

/**
 * Vrai si aucun champ commun aux vues n'a changé entre l'instantané `avant` et `apres` (dérivé de `avant` par le delta
 * `suite`) : chaque champ changé est fait de lignes par salarié, hors des vues, ou garde la même valeur (date de début de
 * la saisie, effectif : recalculés par l'assemblage, souvent identiques).
 */
export function communsInchanges(suite: SuiteDelta, avant: Dataset, apres: Dataset): boolean {
  if (avant.today !== apres.today) return false;
  for (const champ of suite.champsChanges) {
    if (CHAMPS_PAR_SALARIE.has(champ) || CHAMPS_HORS_VUES.has(champ)) continue;
    if (!Object.is(avant[champ], apres[champ])) return false;
  }
  return true;
}

/**
 * Vrai si la vue de clé `cle`, qui lit les salariés `ids`, vaut pour l'instantané suivant : vue collaborateur ou manager
 * (jamais RH), champs communs inchangés (`communs`, `communsInchanges`), aucun salarié touché dans `ids`.
 */
export function vueReportable(cle: string, ids: ReadonlySet<number> | undefined, communs: boolean, touches: ReadonlySet<number>): boolean {
  if (!communs || !ids || !(cle.startsWith('collaborateur|') || cle.startsWith('manager|'))) return false;
  for (const t of touches) if (ids.has(t)) return false;
  return true;
}

/** Vues calculées et résolues, par promesse du cache : seules celles-là se reportent (leur périmètre est connu). */
const resolues = new WeakMap<Promise<unknown>, object>();

/** Retient la valeur résolue `vue` de la promesse de vue `p` du cache (`vuePartagee`), et rend la vue. */
export function retenirResolue<T extends object>(p: Promise<unknown>, vue: T): T {
  resolues.set(p, vue);
  return vue;
}

/** Nombre de vues reportées d'une entrée à la suivante (tests, mesures). */
export let vuesReportees = 0;

/**
 * Report des vues de l'entrée précédente (`avant` : ses vues et son instantané) à l'entrée suivante (`apres`), dérivée
 * de la précédente par le delta `suite` : chaque vue reportable (`vueReportable`) est reprise telle quelle (même objet,
 * même promesse, même corps JSON) sous sa clé, si la nouvelle entrée ne l'a pas déjà. Les autres seront recalculées à la
 * première demande. Rien n'est modifié dans l'entrée précédente.
 */
export function reporterVues(
  avant: { ds: Dataset; vues: ReadonlyMap<string, Promise<unknown>> }, apres: { ds: Dataset; vues: Map<string, Promise<unknown>> }, suite: SuiteDelta,
): number {
  if (!reportActif() || !avant.vues.size) return 0;
  const communs = communsInchanges(suite, avant.ds, apres.ds);
  if (!communs) return 0;
  let n = 0;
  for (const [cle, p] of avant.vues) {
    if (apres.vues.has(cle)) continue;
    const vue = resolues.get(p);
    if (!vue || !vueReportable(cle, perimetreDe(vue), communs, suite.touches)) continue;
    apres.vues.set(cle, p);
    n++;
  }
  vuesReportees += n;
  return n;
}
