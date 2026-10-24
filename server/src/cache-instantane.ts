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
import { configurerFeries } from '../../shared/dates.ts';
import { droitsRh } from '../../shared/constants.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import { resumeAbsencesPaie } from './absences-paie.ts';
import { type Db } from './db.ts';
import { resumeDeplacementsPaie } from './deplacements-paie.ts';

/**
 * Lecteurs internes de la lecture partagée : la lecture complète se fait sans les résumés de la paie (référent HSE :
 * ni absences ni déplacements en attente), calculés ensuite pour le service RH (tous les droits) à la demande.
 */
const LECTEUR: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Instantané partagé', profilRh: 'referent_hse' };
const LECTEUR_PAIE: CurrentUser = { ...LECTEUR, profilRh: 'rh_admin' };

/** Absences et déplacements en attente du fichier de paie, pour les profils qui voient les lots. */
type ResumesPaie = Pick<Dataset, 'absencesPaie' | 'deplacementsPaie'>;

interface Entree {
  /** Révision de la base et jour de la lecture. */
  n: number;
  today: string;
  /** Lecture complète de la base pour `LECTEUR`. */
  base: Promise<Dataset>;
  /** Résumés de la paie de cet état de la base, calculés à la première demande. */
  paie?: Promise<ResumesPaie>;
  /** Vues calculées sur `base`, par clé de vue. */
  vues: Map<string, Promise<unknown>>;
}

const entrees = new WeakMap<Db, Entree>();

/** Cache actif : CURSUS_CACHE_INSTANTANE vaut autre chose que « 0 ». */
export const cacheActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_CACHE_INSTANTANE?.trim() !== '0';

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
  if (!e.paie) {
    const p = (async () => ({ absencesPaie: await resumeAbsencesPaie(db, LECTEUR_PAIE, base), deplacementsPaie: await resumeDeplacementsPaie(db, LECTEUR_PAIE, base) }))()
      .then(x => (gelEnTest() ? geler(x) : x));
    e.paie = p;
    p.catch(() => { if (e.paie === p) e.paie = undefined; });
  }
  return await e.paie;
}

/**
 * Entrée du cache pour la lecture stable en cours : celle de la révision et du jour courants, créée au besoin (lecture
 * complète par `lire`, partagée avec les lectures simultanées). Lecture commencée avant la dernière écriture (révision
 * plus ancienne que celle du cache, fréquent pendant une saisie intense) : l'entrée plus récente, déjà lue, la sert
 * (`memeEtat` faux : un état validé plus récent, comme si la requête était arrivée un instant plus tard ; rien n'y est
 * lu en base). Null hors d'une lecture stable ou cache désactivé : l'appelant lit directement.
 */
async function entree(db: Db, today: string, lire: (lecteur: CurrentUser) => Promise<Dataset>): Promise<{ e: Entree; memeEtat: boolean } | null> {
  if (!cacheActif() || !db.lectureStable) return null;
  const n = await db.revisionBase();
  const e = entrees.get(db);
  if (e?.n === n && e.today === today) return { e, memeEtat: true };
  if (e && e.today === today && n < e.n) return { e, memeEtat: false };
  const nouvelle: Entree = { n, today, base: lire(LECTEUR).then(ds => (gelEnTest() ? geler(ds) : ds)), vues: new Map() };
  entrees.set(db, nouvelle);
  // Lecture échouée (Cursus occupé, délai dépassé) : l'entrée est retirée, la suivante relira.
  nouvelle.base.catch(() => { if (entrees.get(db) === nouvelle) entrees.delete(db); });
  return { e: nouvelle, memeEtat: true };
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
  const x = await entree(db, today, lire);
  if (!x) return null;
  const { e, memeEtat } = x;
  // Entrée plus récente que la lecture en cours, résumés de la paie pas encore calculés : ils se lisent en base sur l'état
  // de l'entrée, que cette lecture ne voit pas ; lecture directe.
  if (!memeEtat && voitPaie(user) && !e.paie) return null;
  const base = await e.base;
  // Jours fériés réglés de l'établissement : état de module que la lecture pose (shared/dates.ts), reposé pour les calculs.
  configurerFeries(base.calendrierFeries);
  const cle = cleVue(user);
  let vue = e.vues.get(cle) as Promise<Dataset> | undefined;
  if (!vue) {
    vue = paieDe(db, e, base, user).then(paie => calculer(donneesDe(base, user, revision, paie))).then(v => (gelEnTest() ? geler(v) : v));
    e.vues.set(cle, vue);
    vue.catch(() => { if (e.vues.get(cle) === vue) e.vues.delete(cle); });
  }
  return { ...await vue, user, revision };
}

/**
 * Données d'une action, dans sa transaction et avant toute écriture (POST /api/actions, server/src/app.ts) : la lecture
 * partagée du cache quand elle est celle de l'état que voit la transaction, sinon `lire(user)` (lecture directe). La
 * révision est lue sous le verrou d'écriture, avant que l'action n'écrive : aucune autre écriture ne s'intercale, et
 * l'entrée de cette révision décrit exactement l'état lu. Une lecture partagée en cours (instantané d'une autre
 * requête) est attendue plutôt que refaite. L'action ne modifie jamais les données reçues : elle remplace `ctx.ds` par
 * une copie (validation groupée), ce que le gel des tests contrôle. Rien n'est mis en cache depuis une transaction.
 */
export async function donneesAction(db: Db, user: CurrentUser, today: string, lire: (u: CurrentUser) => Promise<Dataset>): Promise<Dataset> {
  if (cacheActif()) {
    const e = entrees.get(db);
    if (e?.today === today && e.n === await db.revisionBase()) {
      try {
        const base = await e.base;
        configurerFeries(base.calendrierFeries);
        return donneesDe(base, user, db.revision, await paieDe(db, e, base, user));
      } catch { /* lecture partagée en échec : lecture directe */ }
    }
  }
  return await lire(user);
}

/** Vide le cache d'une base (tests). */
export function viderCache(db: Db): void {
  entrees.delete(db);
}
