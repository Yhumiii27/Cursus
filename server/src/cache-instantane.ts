// Cache de l'instantané (lot 8, chantier E, étape 2). Chaque GET /api/data relisait toute la base et recalculait les vues
// (une seconde sur 5 ans de données) : sous trente utilisateurs, un seul processus Node servait les instantanés en 17 à
// 29 s. Désormais :
// - la lecture complète de la base (`loadFull`, pour un lecteur interne sans droit de paie) est gardée en mémoire, indexée par la révision tenue en base (`Db.revisionBase`, augmentée par un déclencheur à chaque écriture
//   validée, quelle que soit l'instance ou l'outil qui écrit : server/migrations-pg/0013_index_journal.sql,
//   `SqliteDb.poserRevision`) et par la date du jour ; les absences et déplacements en attente du fichier de paie (un
//   tiers du temps de la lecture) ne sont calculés qu'à la première demande d'un profil qui voit la paie, sur le même
//   état de la base ;
// - les vues (espace, profil, périmètre : server/src/dataset.ts) sont calculées une fois par révision et par clé de
//   vue : profil RH (`rh|<profil>`), ou espace et salarié (`manager|<id>`, `collaborateur|<id>`). Une vue ne dépend que
//   de sa clé (droits du profil, périmètre du salarié) : jamais les données d'un autre profil ni d'une autre personne ;
// - seules une entrée et ses vues sont gardées : la première lecture d'une nouvelle révision la remplace. Des lectures
//   simultanées d'une même révision attendent la même lecture de la base.
// Le cache ne se lit et ne se remplit que dans une lecture stable ouverte pour elle-même (`Db.lectureStable`) : la
// révision et les données y sont lues sur le même état de la base. Dans une transaction (action), la lecture reste
// directe : la révision y compterait des écritures que l'annulation peut défaire, et l'action modifie sa copie.
// CURSUS_CACHE_INSTANTANE=0 le désactive (comparaison, dépannage). Sous `node --test`, chaque entrée est gelée en
// profondeur : une modification d'un instantané partagé échoue au lieu de fausser les réponses suivantes.
// Cache incrémental (lot 9, chantier 2, étape 2) : l'entrée d'une révision nouvelle n'est plus relue en entier. Elle est
// dérivée de l'entrée précédente par le delta des lignes changées entre les deux révisions (journal `changements`,
// server/src/delta.ts), lu dans la même lecture stable ; de même, le jeu remis à une action (`donneesAction`, sous le
// verrou, avant toute écriture) et celui du suivi des verdicts (`jeuApres`, après les écritures de l'action, dans sa
// transaction). Repli sur la relecture complète quand l'écart est inconnu (`lireChangements` rend null : purge, époque
// différente), quand l'entrée précédente est en échec ou n'a pas de lecture brute, ou quand la révision lue est plus
// ancienne que l'entrée alors que l'époque a changé. Les résumés de la paie sont repris tant qu'aucune table dont ils
// dépendent (`DEP_PAIE`) n'a changé. CURSUS_CACHE_INCREMENTAL=0 revient à la relecture complète à chaque révision.
// Report des vues (lot 9, chantier 3, étape 2) : une entrée dérivée par un delta reprend les vues collaborateur et manager
// de la précédente dont le périmètre n'est pas touché et qu'aucun champ commun changé n'atteint (`avecReport`,
// server/src/vues-cache.ts). Les vues RH sont toujours recalculées. CURSUS_VUES_REPORT=0 coupe le report.
// Compteurs (lot 9, chantier 4, étape 2) : `statistiquesCache` relève, pour l'essai de charge et le banc d'oracle, les
// entrées lues en entier ou dérivées, les replis, les jeux d'action, la durée des deltas et les vues recalculées ou reportées.
// Lot 10, chantier A : GET /api/data calcule sa vue hors de la lecture stable (`preparerVue`, `vueHorsLecture`), une
// seule évaluation par entrée et par clé de vue, la dernière révision atteinte servie pendant une suite d'écritures ;
// verdict de l'API Keystone par l'entrée de la lecture en cours (`jeuEnLecture`).
import { performance } from 'node:perf_hooks';
import { configurerFeries } from '../../shared/dates.ts';
import { droitsRh } from '../../shared/constants.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import { resumeAbsencesPaie } from './absences-paie.ts';
import { type Db, type EtatRevision } from './db.ts';
import { appliquerDelta, type Fusion, lireDelta } from './delta.ts';
import { resumeDeplacementsPaie } from './deplacements-paie.ts';
import { assembler, type Brut, brutDe, retenirBrut } from './lecture-brute.ts';
import { reporterVues, retenirResolue, vuesReportees } from './vues-cache.ts';

/**
 * Lecteurs internes de la lecture partagée : la lecture complète se fait sans les résumés de la paie (référent HSE :
 * ni absences ni déplacements en attente), calculés ensuite pour le service RH (tous les droits) à la demande.
 */
const LECTEUR: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Instantané partagé', profilRh: 'referent_hse' };
const LECTEUR_PAIE: CurrentUser = { ...LECTEUR, profilRh: 'rh_admin' };

/** Absences et déplacements en attente du fichier de paie, pour les profils qui voient les lots. */
type ResumesPaie = Pick<Dataset, 'absencesPaie' | 'deplacementsPaie'>;

/** Lecture partagée d'une entrée : l'instantané complet, sa lecture brute (absente si `lire` n'en a pas retenu) et, pour une entrée dérivée, ce qui a changé. */
interface Lu {
  ds: Dataset;
  brut: Brut | undefined;
  /** Entrée dérivée de la révision `de` par un delta : champs changés et salariés touchés (vues par salarié, chantier 3). */
  suite?: { de: number } & Pick<Fusion, 'champsChanges' | 'touches'>;
}

interface Entree {
  /** Révision et époque de la base, jour de la lecture. */
  n: number;
  epoque: number;
  today: string;
  /** Lecture de l'entrée : complète, ou dérivée de l'entrée précédente par un delta. */
  lu: Promise<Lu>;
  /** Instantané complet de la base pour `LECTEUR` (`lu`). */
  base: Promise<Dataset>;
  /** Résumés de la paie de cet état de la base, calculés à la première demande (ou repris de l'entrée précédente). */
  paie?: Promise<ResumesPaie>;
  /** Vues calculées sur `base`, par clé de vue. */
  vues: Map<string, Promise<unknown>>;
  /** Révision de l'instance (`Db.revision`) à la création de l'entrée (lot 10 : révision portée par la réponse qui la sert). */
  rev: number;
}

const entrees = new WeakMap<Db, Entree>();

/**
 * Compteurs du cache pour les mesures (lot 9, chantier 4 : essai de charge, banc d'oracle), propres au processus et
 * cumulés depuis son démarrage ou `remettreStatistiques` : entrées lues en entier ou dérivées par un delta, replis
 * complets et leur cause, jeux d'action (lecture partagée, dérivés, lus directement), jeux du suivi des verdicts, durée
 * de chaque delta (lecture des changements et des lignes, fusion, assemblage) et nombre de clés changées, vues calculées
 * par espace et vues reportées (server/src/vues-cache.ts). Aucune donnée, seulement des nombres.
 */
const STATS = {
  entreesCompletes: 0, entreesDerivees: 0,
  replis: { ecartInconnu: 0, precedenteIndisponible: 0 },
  jeuxAction: { partages: 0, derives: 0, directs: 0 }, jeuxSuivi: { derives: 0, replis: 0 },
  deltas: [] as number[], clesDelta: 0, clesDeltaMax: 0,
  vuesCalculees: { rh: 0, manager: 0, collaborateur: 0 }, reporteesAuDepart: 0,
};
/** Durées de delta gardées au plus (les dernières), pour les quantiles. */
const DELTAS_GARDES = 100_000;

/** Remet les compteurs du cache à zéro (début d'un scénario d'essai, tests). */
export function remettreStatistiques(): void {
  Object.assign(STATS, {
    entreesCompletes: 0, entreesDerivees: 0, replis: { ecartInconnu: 0, precedenteIndisponible: 0 }, jeuxAction: { partages: 0, derives: 0, directs: 0 },
    jeuxSuivi: { derives: 0, replis: 0 }, deltas: [], clesDelta: 0, clesDeltaMax: 0, vuesCalculees: { rh: 0, manager: 0, collaborateur: 0 }, reporteesAuDepart: vuesReportees,
  });
}

/** Quantile `q` (0 à 1) de `l`, en millisecondes arrondies au dixième. */
const quantileMs = (l: readonly number[], q: number) => {
  if (!l.length) return 0;
  const tri = [...l].sort((a, b) => a - b);
  return Math.round(tri[Math.min(tri.length - 1, Math.max(0, Math.ceil(q * tri.length) - 1))] * 10) / 10;
};

/** Relevé des compteurs du cache (`STATS`), copie que l'appelant peut garder ; le paramètre est accepté pour l'essai de charge. */
export function statistiquesCache(_db?: Db) {
  const d = STATS.deltas;
  return {
    entreesCompletes: STATS.entreesCompletes, entreesDerivees: STATS.entreesDerivees, replis: { ...STATS.replis },
    jeuxAction: { ...STATS.jeuxAction }, jeuxSuivi: { ...STATS.jeuxSuivi },
    delta: { n: d.length, p50Ms: quantileMs(d, 0.5), p95Ms: quantileMs(d, 0.95), maxMs: quantileMs(d, 1), cles: STATS.clesDelta, clesMax: STATS.clesDeltaMax },
    vuesCalculees: { ...STATS.vuesCalculees }, vuesReportees: vuesReportees - STATS.reporteesAuDepart,
  };
}

/** Cache actif : CURSUS_CACHE_INSTANTANE vaut autre chose que « 0 ». */
export const cacheActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_CACHE_INSTANTANE?.trim() !== '0';
/** Cache incrémental actif : CURSUS_CACHE_INCREMENTAL vaut autre chose que « 0 » (sinon relecture complète à chaque révision). */
export const incrementalActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_CACHE_INCREMENTAL?.trim() !== '0';

/** Gel en profondeur (tests) : objets et tableaux, une fois chacun. */
export function geler<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) geler(v);
  }
  return x;
}
/**
 * Gel des données partagées : sous `node --test` (NODE_TEST_CONTEXT), ou CURSUS_CACHE_GEL=1 (essai, développement). En
 * production, pas de gel (170 ms par lecture complète sur 5 ans) : la suite de tests, qui gèle aussi chaque `loadFull`
 * (server/src/dataset.ts), garantit qu'aucune action ni aucune vue ne modifie les données qu'elle reçoit.
 */
export const gelEnTest = () => !!process.env.NODE_TEST_CONTEXT || process.env.CURSUS_CACHE_GEL === '1';

/** Clé de la vue de `user` : profil pour l'espace RH, espace et salarié sinon. */
export function cleVue(user: CurrentUser): string {
  return user.role === 'rh' ? `rh|${user.profilRh ?? 'rh_gestionnaire'}` : `${user.role}|${user.empId}`;
}

/**
 * Profil qui reçoit les absences et déplacements en attente du fichier de paie (comme `resumeAbsencesPaie` et
 * `resumeDeplacementsPaie`, server/src/absences-paie.ts et deplacements-paie.ts) : service RH, paie, lecture seule.
 */
export function voitPaie(user: CurrentUser): boolean {
  const droits = droitsRh(user);
  return droits.includes('rh') || droits.includes('paie') || droits.includes('consultation');
}

/**
 * Données de l'instantané de `user` tirées de la lecture partagée, comme `loadFull(db, user)` les aurait lues : `paie`,
 * les résumés de la paie de ce même état (profils qui voient la paie).
 */
export function donneesDe(base: Dataset, user: CurrentUser, revision: number, paie: ResumesPaie | null): Dataset {
  return { ...base, user, revision, absencesPaie: paie?.absencesPaie ?? [], deplacementsPaie: paie?.deplacementsPaie ?? null };
}

/** Résumés de la paie de l'entrée `e` (lus à la première demande, sur l'état de la base de la lecture en cours), si `user` les voit. */
async function paieDe(db: Db, e: Entree, base: Dataset, user: CurrentUser): Promise<ResumesPaie | null> {
  if (!voitPaie(user)) return null;
  if (!e.paie) poserPaie(e, (async () => await calculerPaie(db, base))());
  return await e.paie!;
}

/** Résumés de la paie de l'instantané `base`, lus sur l'état de la base de la lecture ou de la transaction en cours. */
async function calculerPaie(db: Db, base: Dataset): Promise<ResumesPaie> {
  const x = { absencesPaie: await resumeAbsencesPaie(db, LECTEUR_PAIE, base), deplacementsPaie: await resumeDeplacementsPaie(db, LECTEUR_PAIE, base) };
  return gelEnTest() ? geler(x) : x;
}

/** Résumés de la paie `p` posés sur l'entrée `e` ; retirés s'ils échouent (la demande suivante les recalcule). */
function poserPaie(e: Entree, p: Promise<ResumesPaie>): void {
  e.paie = p;
  p.catch(() => { if (e.paie === p) e.paie = undefined; });
}

/**
 * Lecture complète d'une entrée par `lire` (gelée sous node --test), avec la lecture brute qu'elle a retenue
 * (`loadFull` : `retenirBrut`) pour les deltas suivants.
 */
async function lireEntree(lire: (lecteur: CurrentUser) => Promise<Dataset>): Promise<Lu> {
  STATS.entreesCompletes++;
  const ds = await lire(LECTEUR);
  return { ds: gelEnTest() ? geler(ds) : ds, brut: incrementalActif() ? brutDe(ds) : undefined };
}

/**
 * État de la révision `a` dérivé de la lecture brute `brut` de la révision `de` (époque `epoque`) : delta des lignes
 * changées lu dans la lecture stable ou la transaction en cours, fusionné (server/src/delta.ts), puis instantané
 * complet de `lecteur` assemblé, comme `loadFull(db, lecteur)` le lirait à cet état. Null si l'écart est inconnu
 * (`lireChangements`) : l'appelant relit tout.
 */
async function deriver(db: Db, brut: Brut, de: number, epoque: number, a: number, today: string, lecteur: CurrentUser): Promise<(Lu & { paieReportee: boolean }) | null> {
  const t0 = performance.now();
  const changements = await db.lireChangements(de, a, epoque);
  if (!changements) { STATS.replis.ecartInconnu++; return null; }
  let cles = 0;
  for (const ch of changements.values()) cles += ch === 'tout' ? 1 : ch.size;
  const f = appliquerDelta(brut, await lireDelta(db, brut, changements));
  if (gelEnTest()) geler(f.brut);
  const ds0 = assembler(f.brut, today, db.revision, lecteur);
  const ds = retenirBrut({ ...ds0, absencesPaie: await resumeAbsencesPaie(db, lecteur, ds0), deplacementsPaie: await resumeDeplacementsPaie(db, lecteur, ds0) }, f.brut);
  if (STATS.deltas.length >= DELTAS_GARDES) STATS.deltas.shift();
  STATS.deltas.push(performance.now() - t0);
  STATS.clesDelta += cles;
  STATS.clesDeltaMax = Math.max(STATS.clesDeltaMax, cles);
  return { ds: gelEnTest() ? geler(ds) : ds, brut: f.brut, suite: { de, champsChanges: f.champsChanges, touches: f.touches }, paieReportee: f.paieReportee };
}

/**
 * Lecture de l'entrée `nouvelle` dérivée de l'entrée précédente `prec` (même jour, même époque, révision plus ancienne),
 * dans la lecture stable en cours ; résumés de la paie de `prec` repris si aucune de leurs tables n'a changé. Repli sur
 * la lecture complète (`lire`) si `prec` est en échec, sans lecture brute, ou si l'écart est inconnu.
 */
async function deriverEntree(db: Db, prec: Entree, nouvelle: Entree, lire: (lecteur: CurrentUser) => Promise<Dataset>): Promise<Lu> {
  const avant = await prec.lu.catch(() => null);
  if (!avant?.brut) STATS.replis.precedenteIndisponible++;
  const x = avant?.brut ? await deriver(db, avant.brut, prec.n, prec.epoque, nouvelle.n, nouvelle.today, LECTEUR) : null;
  if (!x) return await lireEntree(lire);
  STATS.entreesDerivees++;
  if (x.paieReportee && prec.paie && !nouvelle.paie) poserPaie(nouvelle, prec.paie);
  return { ds: x.ds, brut: x.brut, suite: x.suite };
}

/**
 * Entrée du cache pour la lecture stable en cours : celle de la révision, de l'époque et du jour courants, créée au
 * besoin et partagée avec les lectures simultanées : dérivée de l'entrée précédente par le delta (même jour, même
 * époque, révision plus récente), sinon lecture complète par `lire`. Lecture commencée avant la dernière écriture
 * (révision plus ancienne que celle du cache, même époque, fréquent pendant une saisie intense) : l'entrée plus récente,
 * déjà lue, la sert (`memeEtat` faux : un état validé plus récent, comme si la requête était arrivée un instant plus tard ;
 * rien n'y est lu en base). Null hors d'une lecture stable ou cache désactivé : l'appelant lit directement.
 */
async function entree(db: Db, today: string, lire: (lecteur: CurrentUser) => Promise<Dataset>): Promise<{ e: Entree; memeEtat: boolean; cree?: boolean } | null> {
  if (!cacheActif() || !db.lectureStable) return null;
  const { n, epoque } = await db.etatRevision();
  const e = entrees.get(db);
  if (e && e.today === today && e.epoque === epoque) {
    if (e.n === n) return { e, memeEtat: true };
    if (n < e.n) return { e, memeEtat: false };
  }
  const nouvelle = { n, epoque, today, vues: new Map(), rev: db.revision } as unknown as Entree;
  // Révision plus récente de la même époque et du même jour : dérivée de l'entrée précédente par le delta des lignes
  // changées ; sinon (première lecture, autre jour, autre époque, cache incrémental coupé) lecture complète.
  nouvelle.lu = e && e.today === today && e.epoque === epoque && incrementalActif() ? deriverEntree(db, e, nouvelle, lire) : lireEntree(lire);
  // Vues de l'entrée précédente que le delta ne touche pas : reportées avant que la nouvelle ne serve (lot 9, chantier 3).
  nouvelle.base = nouvelle.lu.then(async x => (e ? await avecReport(e, nouvelle, x) : x.ds));
  entrees.set(db, nouvelle);
  // Lecture échouée (Cursus occupé, délai dépassé) : l'entrée est retirée, la suivante relira.
  nouvelle.base.catch(() => { if (entrees.get(db) === nouvelle) entrees.delete(db); });
  return { e: nouvelle, memeEtat: true, cree: true };
}

/**
 * Instantané de `user` par le cache : `calculer(full)` calcule la vue de la clé de `user` sur ses données (sans lecture
 * de la base), une fois par révision ; la vue rendue porte l'utilisateur et la révision de cette requête. Null hors
 * d'une lecture stable ou cache désactivé.
 */
export async function vueEnCache(
  db: Db, user: CurrentUser, today: string, revision: number,
  lire: (lecteur: CurrentUser) => Promise<Dataset>, calculer: (full: Dataset) => Dataset,
): Promise<Dataset | null> {
  const x = await vuePartagee(db, user, today, revision, lire, calculer);
  return x && { ...x.vue, user, revision };
}

/**
 * Vue partagée de la clé de `user`, telle que le cache la garde (sans la tête de cette requête : utilisateur et
 * révision restent ceux du premier calcul), avec sa clé : le corps JSON lui est attaché par clé de vue (lot 9,
 * server/src/vues-cache.ts). Jamais modifiée par l'appelant. Null hors d'une lecture stable ou cache désactivé. Calculée
 * dans la lecture stable de l'appelant (réponse d'une action, banc d'oracle) ; GET /api/data calcule la sienne hors de
 * la lecture (`preparerVue`, puis `vueHorsLecture` : lot 10).
 */
export async function vuePartagee(
  db: Db, user: CurrentUser, today: string, revision: number,
  lire: (lecteur: CurrentUser) => Promise<Dataset>, calculer: (full: Dataset) => Dataset,
): Promise<{ vue: Dataset; cle: string } | null> {
  const p = await preparerVue(db, user, today, revision, lire);
  // Entrée plus récente que la lecture en cours, résumés de la paie pas encore calculés : ils se lisent en base sur l'état
  // de l'entrée, que cette lecture ne voit pas ; lecture directe.
  if (!p || p.paieManquante) return null;
  const cle = cleVue(user);
  return { vue: await vueSurEntree(db, p, cle, calculer), cle };
}

// ——— Vues calculées hors de la lecture stable, coalescence (lot 10, chantier A) ———
// Au lot 9, la vue d'une requête se calculait dans sa lecture stable : sur PostgreSQL, une connexion du pool et une place
// de lecture restaient prises pendant tout le calcul (jusqu'à plusieurs secondes pour une vue RH sous charge), et les
// autres lectures, santé comprise, attendaient le pool. GET /api/data sépare désormais :
// - dans la lecture stable (`preparerVue`) : l'entrée de la révision lue, les résumés de la paie si le profil les voit
//   (lus en base sur ce même état) et la tête de la requête (server/src/dataset.ts, `lireParties`) ;
// - hors de la lecture (`vueHorsLecture`) : la vue elle-même, calcul pur sur l'entrée.
// Une seule évaluation par (entrée, clé de vue) : la promesse est rangée dans l'entrée dès le début du calcul et partagée
// par toutes les requêtes de cette révision. Pendant une suite d'écritures (tranches d'une validation groupée), une
// requête qui trouve en cours le calcul de sa clé sur une autre révision l'attend (une fois), puis relit l'état de la base
// : elle sert alors la dernière révision atteinte, calculée une fois pour toutes les requêtes qui attendaient, au lieu de
// calculer chaque révision intermédiaire. La réponse reflète toujours une révision réellement atteinte, la sienne ou une
// plus récente, avec la tête lue sur ce même état.

/**
 * Vue préparée dans une lecture stable : entrée de la révision lue, son instantané et les résumés de la paie si `user` les
 * voit, en promesses : celle qui a créé l'entrée, ou qui calcule les résumés de la paie, les attend dans sa lecture (ses
 * lectures en base se font sur sa connexion) ; les autres sortent de la lecture aussitôt, sans tenir de connexion pendant
 * que la première dérive l'entrée (rafale de lectures après une écriture), et les attendent ensuite.
 */
export interface VuePreparee {
  e: Entree;
  base: Promise<Dataset>;
  paie: Promise<ResumesPaie | null>;
  user: CurrentUser;
  revision: number;
  /**
   * Vrai si l'entrée trouvée est plus récente que la révision lue par la lecture en cours (`entree`, `memeEtat` faux) :
   * la tête de la requête, lue sur l'état de la lecture, ne serait pas celle de l'entrée.
   */
  relire: boolean;
  /**
   * Entrée plus récente que la lecture, sans les résumés de la paie que `user` voit : ils se lisent en base sur l'état de
   * l'entrée, que la lecture ne voit pas (`relire` est vrai ; rien n'est à attendre).
   */
  paieManquante: boolean;
}

/**
 * Préparation de la vue de `user` dans la lecture stable en cours : entrée du cache, instantané, résumés de la paie (lus
 * en base sur l'état de l'entrée, que la lecture voit quand `relire` est faux). `attendre` : instantané et résumés
 * attendus dans la lecture quoi qu'il arrive (calcul de la vue dans la lecture, `vuePartagee`) ; sinon, seulement par la
 * lecture qui crée l'entrée ou calcule les résumés. Null hors d'une lecture stable ou cache désactivé : l'appelant lit
 * directement.
 */
export async function preparerVue(
  db: Db, user: CurrentUser, today: string, revision: number, lire: (lecteur: CurrentUser) => Promise<Dataset>, attendre = true,
): Promise<VuePreparee | null> {
  const x = await entree(db, today, lire);
  if (!x) return null;
  const { e, memeEtat } = x;
  if (!memeEtat && voitPaie(user) && !e.paie) {
    const rien = Promise.resolve(null);
    return { e, base: e.base, paie: rien, user, revision, relire: true, paieManquante: true };
  }
  const base = e.base;
  let paie: Promise<ResumesPaie | null>;
  if (voitPaie(user) && !e.paie) {
    // Résumés de la paie à lire sur cet état, dans cette lecture.
    const b = await base;
    paie = paieDe(db, e, b, user);
    await paie;
  } else {
    paie = voitPaie(user) ? e.paie! : Promise.resolve(null);
  }
  if (attendre || x.cree) { await base; await paie; }
  return { e, base, paie, user, revision, relire: !memeEtat, paieManquante: false };
}

/** Calculs de vue en cours, par base et par clé de vue : entrée calculée et promesse (coalescence, lot 10). */
const calculsEnCours = new WeakMap<Db, Map<string, { e: Entree; p: Promise<Dataset> }>>();

/** Attentes d'un calcul de la même clé sur une autre révision, suivies d'une relecture (tests, mesures). */
export const COALESCENCE = { attentes: 0 };

/**
 * Vue de clé `cle` sur l'entrée préparée `p` : celle de l'entrée si elle est calculée ou en cours (partagée), sinon
 * calculée maintenant et rangée dans l'entrée avant le calcul. Le calendrier des jours fériés de l'entrée est reposé
 * juste avant le calcul, dans le même tour de la boucle d'événements.
 */
function vueSurEntree(db: Db, p: VuePreparee, cle: string, calculer: (full: Dataset) => Dataset): Promise<Dataset> {
  const { e, user, revision } = p;
  const deja = e.vues.get(cle) as Promise<Dataset> | undefined;
  if (deja) return deja;
  STATS.vuesCalculees[user.role]++;
  const vue: Promise<Dataset> = (async () => {
    const base = await p.base, paie = await p.paie;
    // Jours fériés réglés de l'établissement : état de module que la lecture pose (shared/dates.ts), reposé pour les
    // calculs, juste avant le calcul (aucune autre vue ne s'intercale entre les deux).
    configurerFeries(base.calendrierFeries);
    const v = calculer(donneesDe(base, user, revision, paie));
    return gelEnTest() ? geler(v) : v;
  })();
  // Vue résolue retenue pour le report à l'entrée suivante (server/src/vues-cache.ts, `reporterVues`).
  vue.then(v => retenirResolue(vue, v), () => {});
  e.vues.set(cle, vue);
  let calculs = calculsEnCours.get(db);
  if (!calculs) calculsEnCours.set(db, calculs = new Map());
  const enCours = calculs;
  enCours.set(cle, { e, p: vue });
  const fin = () => { if (enCours.get(cle)?.p === vue) enCours.delete(cle); };
  vue.then(fin, () => { fin(); if (e.vues.get(cle) === vue) e.vues.delete(cle); });
  return vue;
}

/**
 * Vue de la préparation `p`, calculée hors de la lecture stable (GET /api/data, lot 10). `attendre` vrai : si un calcul
 * de la même clé est en cours sur une autre entrée (révision plus ancienne, ou plus récente que celle de cette lecture),
 * il est attendu, puis l'appelant relit l'état de la base (`'relire'`) pour servir la dernière révision atteinte ; faux
 * (seconde lecture) : la vue de l'entrée préparée est servie, calculée au besoin. `'relire'` aussi pour une préparation
 * marquée `relire` quand `attendre` est vrai. Rend la vue, sa clé et la révision de l'instance que porte la réponse.
 */
export async function vueHorsLecture(
  db: Db, p: VuePreparee, calculer: (full: Dataset) => Dataset, attendre: boolean,
): Promise<{ vue: Dataset; cle: string; revision: number } | 'relire'> {
  if (p.relire && attendre) return 'relire';
  const cle = cleVue(p.user);
  const servir = async (x: Promise<Dataset>) => ({ vue: await x, cle, revision: Math.max(p.revision, p.e.rev) });
  const deja = p.e.vues.get(cle) as Promise<Dataset> | undefined;
  if (deja) return await servir(deja);
  const autre = calculsEnCours.get(db)?.get(cle);
  if (attendre && autre && autre.e !== p.e) {
    COALESCENCE.attentes++;
    await autre.p.catch(() => {});
    return 'relire';
  }
  // Un tour de la boucle d'événements avant un calcul : santé, actions et lectures déjà arrivées passent devant.
  await new Promise<void>(ok => setImmediate(ok));
  const calcul = vueSurEntree(db, p, cle, calculer);
  return await servir(calcul);
}

/**
 * Instantané de l'entrée `nouvelle`, lue (`x`) : si elle est dérivée de l'entrée précédente `prec` par un delta, les vues
 * collaborateur et manager de `prec` que ce delta ne touche pas y sont reportées (lot 9, chantier 3, étape 2 ;
 * `reporterVues`, server/src/vues-cache.ts). Fait avant que `nouvelle.base` ne soit tenue : aucune vue de la nouvelle
 * entrée n'est encore demandée ni calculée.
 */
async function avecReport(prec: Entree, nouvelle: Entree, x: Lu): Promise<Dataset> {
  if (x.suite && x.suite.de === prec.n) {
    const avant = await prec.lu.catch(() => null);
    if (avant) reporterVues({ ds: avant.ds, vues: prec.vues }, { ds: x.ds, vues: nouvelle.vues }, x.suite);
  }
  return x.ds;
}

/**
 * Données d'une action, dans sa transaction et avant toute écriture (POST /api/actions, server/src/app.ts) : la lecture
 * partagée du cache quand elle est celle de l'état que voit la transaction ; l'entrée d'une révision plus ancienne de la
 * même époque plus le delta des lignes changées depuis (lot 9, lu dans la transaction) ; sinon `lire(user)` (lecture
 * directe). La révision et l'époque sont lues sous le verrou d'écriture, avant que l'action n'écrive : aucune autre
 * écriture ne s'intercale, et l'entrée (plus le delta) décrit exactement l'état lu. Une lecture partagée en cours
 * (instantané d'une autre requête) est attendue plutôt que refaite. L'action ne modifie jamais les données reçues : elle
 * remplace `ctx.ds` par une copie (validation groupée), ce que le gel des tests contrôle. Rien n'est mis en cache depuis
 * une transaction ; le point de départ du jeu rendu est retenu pour le suivi des verdicts (`jeuApres`).
 */
export async function donneesAction(db: Db, user: CurrentUser, today: string, lire: (u: CurrentUser) => Promise<Dataset>): Promise<Dataset> {
  if (!cacheActif()) return await lire(user);
  // Révision et époque lues sous le verrou, avant toute écriture de l'action.
  const etat = await db.etatRevision();
  const e = entrees.get(db);
  if (e?.today === today && e.epoque === etat.epoque && e.n <= etat.n) {
    let avant: Lu | null = null;
    try { avant = await e.lu; } catch { /* lecture partagée en échec : lecture directe */ }
    if (avant && e.n === etat.n) {
      STATS.jeuxAction.partages++;
      configurerFeries(avant.ds.calendrierFeries);
      return depart(donneesDe(avant.ds, user, db.revision, await paieDe(db, e, avant.ds, user)), avant.brut, etat, today);
    }
    // Entrée d'une révision plus ancienne : entrée + delta, lus dans la transaction ; jamais mis en cache.
    const x = avant?.brut && incrementalActif() ? await deriver(db, avant.brut, e.n, e.epoque, etat.n, today, LECTEUR) : null;
    if (x) {
      STATS.jeuxAction.derives++;
      const reprise = x.paieReportee && e.paie ? await e.paie.catch(() => null) : null;
      const paie = voitPaie(user) ? reprise ?? await calculerPaie(db, x.ds) : null;
      return depart(donneesDe(x.ds, user, db.revision, paie), x.brut, etat, today);
    }
  }
  STATS.jeuxAction.directs++;
  const ds = await lire(user);
  return depart(ds, brutDe(ds), etat, today);
}

/**
 * Jeu complet de `user` lu dans la lecture stable en cours, comme `loadFull(db, user)` (lot 10, chantier A : verdict d'un
 * chantier pour l'API Keystone, qui relisait toute la base à chaque appel, une connexion tenue plusieurs secondes pendant
 * une fin de mois) : l'entrée du cache de la révision lue, avec les résumés de la paie si `user` les voit, lus sur ce
 * même état. Entrée plus récente que la lecture, hors d'une lecture stable ou cache désactivé : `lire(user)`. Les données
 * rendues sont partagées : jamais modifiées par l'appelant (gel sous node --test).
 */
export async function jeuEnLecture(db: Db, user: CurrentUser, today: string, lire: (u: CurrentUser) => Promise<Dataset>): Promise<Dataset> {
  const x = await entree(db, today, lire);
  if (!x?.memeEtat) return await lire(user);
  const base = await x.e.base;
  configurerFeries(base.calendrierFeries);
  return donneesDe(base, user, db.revision, await paieDe(db, x.e, base, user));
}

/**
 * Point de départ d'une action (lot 9, chantier 2, étape 2) : lecture brute, révision et époque de l'état que décrit le
 * jeu remis à l'action, avant ses écritures. Le suivi des verdicts (`jeuApres`) en dérive l'état d'après l'action.
 */
interface Depart { brut: Brut; n: number; epoque: number; today: string }
const DEPARTS = new WeakMap<Dataset, Depart>();

/** Retient le point de départ du jeu `ds` d'une action (cache incrémental actif, lecture brute connue), et rend `ds`. */
function depart(ds: Dataset, brut: Brut | undefined, etat: EtatRevision, today: string): Dataset {
  if (brut && incrementalActif()) DEPARTS.set(ds, { brut, n: etat.n, epoque: etat.epoque, today });
  return ds;
}

/**
 * Instantané complet de `lecteur` après les écritures faites depuis le jeu `jeu` d'une action (rendu par
 * `donneesAction`), lu dans la transaction de l'action : lecture brute de départ, plus le delta de ses propres écritures
 * (journal des changements de la transaction). Comme `loadFull(db, lecteur)` à cet instant. Null si le départ du jeu est
 * inconnu (cache coupé, jeu remplacé par une copie, lecture sans lecture brute) ou l'écart inconnu : l'appelant relit
 * tout. Jamais mis en cache.
 */
export async function jeuApres(db: Db, jeu: Dataset, lecteur: CurrentUser): Promise<Dataset | null> {
  const d = DEPARTS.get(jeu);
  if (!cacheActif() || !incrementalActif()) return null;
  if (!d) { STATS.jeuxSuivi.replis++; return null; }
  const { n } = await db.etatRevision();
  const x = await deriver(db, d.brut, d.n, d.epoque, n, d.today, lecteur);
  if (x) STATS.jeuxSuivi.derives++; else STATS.jeuxSuivi.replis++;
  return x?.ds ?? null;
}

/**
 * Préchauffage (lot 9 : démarrage du serveur, server/src/demarrage.ts) : entrée du cache de la révision courante lue
 * dans une lecture stable, avant les premières requêtes, qui la trouvent ou attendent la même lecture.
 */
export async function prechauffer(db: Db, today: string, lire: (lecteur: CurrentUser) => Promise<Dataset>): Promise<boolean> {
  return await db.lecture(async () => {
    const x = await entree(db, today, lire);
    if (!x) return false;
    await x.e.base;
    return true;
  });
}

/** Champs changés et salariés touchés de l'entrée en cache de `db`, si elle a été dérivée d'une autre par un delta (chantier 3, tests). */
export async function suiteEntree(db: Db): Promise<Lu['suite'] | null> {
  const e = entrees.get(db);
  return e ? (await e.lu).suite ?? null : null;
}

/** Vide le cache d'une base (tests). */
export function viderCache(db: Db): void {
  entrees.delete(db);
}
