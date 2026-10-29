// Oracle d'exactitude (lot 9, chantier 4) : tout ce que Cursus sert depuis sa lecture partagée (entrée du cache de
// l'instantané, jeu d'une action, vue de chaque compte, espace et profil) doit être exactement ce que donne la relecture
// complète de la base (`loadFull`, ce que sert CURSUS_CACHE_INSTANTANE=0). Le chemin complet reste l'oracle et le repli : toute mise
// à jour incrémentale du cache (journal des changements, delta fusionné, vues reportées) se juge ici, ligne pour ligne et
// dans le même ordre (`isDeepStrictEqual`).
// Employé par le banc d'oracle des tests (tests/support/oracle.ts : suite d'écritures aléatoire, comparaison après chaque
// pas) et par l'essai de charge (`npm run charge -- --verifier-exactitude [k]`, scripts/charge/executer.ts : comparaison
// toutes les k écritures, écritures de l'essai suspendues le temps de la comparaison par `Porte`).
// Une comparaison ne vaut que sur un état stable : aucune écriture ne doit s'intercaler entre la lecture par le cache et la
// relecture complète. Le banc écrit lui-même, pas à pas ; l'essai de charge ferme sa porte, et toute comparaison faite
// pendant qu'une révision change (écriture hors de la porte : tâche, autre instance) est refaite (`essais`).
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { PROFILS_RH } from '../../shared/constants.ts';
import type { CurrentUser, Dataset } from '../../shared/types.ts';
import { cacheActif, donneesAction } from '../../server/src/cache-instantane.ts';
import { espacesDuCompte, type Compte } from '../../server/src/comptes.ts';
import { buildSnapshot, currentUser, lireParties, loadFull, todayIso } from '../../server/src/dataset.ts';
import type { Db } from '../../server/src/db.ts';

/** Ce qui est comparé : entrée du cache, jeu d'une action, vue servie à un compte, instantané renvoyé après une action. */
export type Objet = 'entrée' | 'action' | 'vue' | 'réponse';

/** Écart constaté entre la lecture partagée et la relecture complète. */
export interface Divergence { objet: Objet; cle: string; revision: number; ecart: string }

/** Lecteur de la lecture partagée sans droit de paie (comme l'entrée du cache : server/src/cache-instantane.ts). */
export const LECTEUR_ENTREE: CurrentUser = { role: 'rh', empId: null, nom: 'Oracle', intitule: 'Entrée du cache', profilRh: 'referent_hse' };

/** Clé lisible d'un lecteur : espace, puis profil RH ou salarié. */
export const cleLecteur = (u: CurrentUser) => (u.role === 'rh' ? `rh|${u.profilRh ?? 'rh_gestionnaire'}` : `${u.role}|${u.empId}`);

const court = (v: unknown) => {
  const t = v === undefined ? 'undefined' : JSON.stringify(v) ?? String(v);
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
};

/**
 * Premier écart entre `attendu` (relecture complète) et `obtenu` (lecture partagée), en profondeur et à l'identique
 * (types, ordre des tableaux, propriétés absentes ou indéfinies) ; null s'ils sont égaux (`isDeepStrictEqual`).
 */
export function ecart(attendu: unknown, obtenu: unknown, chemin = '$'): string | null {
  if (isDeepStrictEqual(attendu, obtenu)) return null;
  if (typeof attendu !== typeof obtenu || attendu === null || obtenu === null || typeof attendu !== 'object') {
    return `${chemin} : attendu ${court(attendu)}, obtenu ${court(obtenu)}`;
  }
  if (Array.isArray(attendu) !== Array.isArray(obtenu)) return `${chemin} : tableau d'un côté seulement`;
  if (Array.isArray(attendu)) {
    const b = obtenu as unknown[];
    for (let i = 0; i < Math.min(attendu.length, b.length); i++) {
      const e = ecart(attendu[i], b[i], `${chemin}[${i}]`);
      if (e) return e;
    }
    return `${chemin} : ${attendu.length} éléments attendus, ${b.length} obtenus`;
  }
  const a = attendu as Record<string, unknown>, b = obtenu as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in b)) return `${chemin}.${k} : absent de la lecture partagée (attendu ${court(a[k])})`;
    if (!(k in a)) return `${chemin}.${k} : en trop dans la lecture partagée (${court(b[k])})`;
    const e = ecart(a[k], b[k], `${chemin}.${k}`);
    if (e) return e;
  }
  return `${chemin} : prototypes différents`;
}

/**
 * Instantané de `u` lu directement, l'oracle : `loadFull` puis la vue, dans une lecture stable, sans passer par le cache
 * (`buildSnapshot(…, { cache: false })`). Rien n'est coupé pour le reste du processus : pendant l'essai de charge, les
 * GET /api/data des utilisateurs simulés continuent d'être servis par le cache pendant une comparaison (relecture du lot
 * 9 : couper le cache par CURSUS_CACHE_INSTANTANE, lu à chaque requête, faussait leurs durées et la mémoire relevées).
 */
export async function instantaneDirect(db: Db, u: CurrentUser): Promise<Dataset> {
  return await db.lecture(async () => await buildSnapshot(db, u, { cache: false }));
}

/**
 * Lecteurs de la base : chaque compte actif dans chacun de ses espaces (comme `currentUser` le donnerait à sa session),
 * puis chaque profil de l'espace RH (PROFILS_RH), même absent des comptes. `garder` restreint les comptes (essai de
 * charge : 30 collaborateurs, 8 managers).
 */
export async function lecteursDe(db: Db, garder: (c: Compte, espace: CurrentUser['role']) => boolean = () => true): Promise<CurrentUser[]> {
  const out: CurrentUser[] = [];
  for (const c of await db.all<Compte>('comptes')) {
    for (const role of await espacesDuCompte(db, c)) {
      if (!garder(c, role)) continue;
      const u = await currentUser(db, { id: 'oracle', compteId: c.id, role, methode: 'local' } as never);
      if (u) out.push(u);
    }
  }
  for (const profilRh of Object.keys(PROFILS_RH) as NonNullable<CurrentUser['profilRh']>[]) {
    out.push({ role: 'rh', empId: null, nom: 'Oracle', intitule: `Profil ${profilRh}`, profilRh });
  }
  return out;
}

/**
 * Vue de `u` servie par le cache contre la vue lue directement (`instantaneDirect`, calculée sans mémo : lot 10) : celle
 * que sert la réponse d'une action (calculée dans la lecture stable, `buildSnapshot`), puis celle de GET /api/data
 * (calculée hors de la lecture, `lireParties`, lot 10).
 */
export async function comparerVue(db: Db, u: CurrentUser): Promise<string | null> {
  const servie = await db.lecture(async () => await buildSnapshot(db, u));
  const directe = await instantaneDirect(db, u);
  const e = ecart(directe, servie);
  if (e) return e;
  const { vue, tete } = await lireParties(db, u);
  return ecart(directe, { ...vue, ...tete });
}

/** Issue de la comparaison d'un jeu d'action : écart, et `directe` vrai si la lecture directe a servi l'action. */
export interface ComparaisonJeu { ecart: string | null; directe: boolean }

/**
 * Jeu de données remis à une action de `u` (`donneesAction`, dans sa transaction, avant toute écriture) contre
 * `loadFull(u)` lu dans la même transaction. `directe` : la lecture partagée n'a pas servi (cache coupé, ou entrée d'une
 * autre révision) ; l'action a reçu `loadFull`, comparé alors à lui-même, et la comparaison ne prouve rien du cache.
 * `exigerCache` : une telle lecture directe est un écart.
 */
export async function comparerJeuAction(db: Db, u: CurrentUser, exigerCache: boolean): Promise<ComparaisonJeu> {
  return await db.tx(async () => {
    let directes = 0;
    const ds = await donneesAction(db, u, todayIso(), async x => { directes++; return await loadFull(db, x); });
    const ref = await loadFull(db, u);
    if (exigerCache && cacheActif() && directes) return { ecart: 'lecture partagée absente : le jeu a été relu en entier', directe: true };
    return { ecart: ecart(ref, ds), directe: directes > 0 };
  });
}

/** Instantané renvoyé après une action (`data` de la réponse) contre l'instantané lu directement pour le même compte. */
export async function comparerReponse(db: Db, u: CurrentUser, data: Dataset): Promise<string | null> {
  return ecart(JSON.parse(JSON.stringify(await instantaneDirect(db, u))), data);
}

export interface BilanExactitude {
  /** Comparaisons faites (entrée, jeux d'action, vues), divergences constatées. */
  comparaisons: number;
  /**
   * Jeux d'action servis par la lecture directe (cache coupé, entrée d'une autre révision) : comparés à eux-mêmes, ils ne
   * prouvent rien du cache et ne comptent pas dans `comparaisons`.
   */
  triviales: number;
  divergences: Divergence[];
  /** Comparaisons refaites parce qu'une révision a changé pendant la comparaison. */
  refaites: number;
  dureeMs: number;
}

/**
 * Comparaison complète d'un état : vue de chaque lecteur (avec et sans cache), puis entrée du cache (exigée présente
 * après le calcul des vues), puis jeu d'action de chaque lecteur (`jeux`). Une comparaison pendant laquelle la révision
 * de la base a changé est refaite (au plus `essais` fois), sinon comptée comme divergence « état instable ». `apres` :
 * appelée après chaque comparaison, avant la relecture de la révision (essai d'une écriture concurrente).
 */
export async function verifierExactitude(
  db: Db, lecteurs: readonly CurrentUser[], { jeux = true, essais = 3, apres }: { jeux?: boolean; essais?: number; apres?: () => Promise<void> } = {},
): Promise<BilanExactitude> {
  const t0 = performance.now();
  const bilan: BilanExactitude = { comparaisons: 0, triviales: 0, divergences: [], refaites: 0, dureeMs: 0 };
  const stable = async (objet: Objet, cle: string, fn: () => Promise<string | ComparaisonJeu | null>) => {
    for (let i = 0; ; i++) {
      const avant = await db.revisionBase();
      const x = await fn();
      await apres?.();
      const n = await db.revisionBase();
      if (avant === n) {
        const { ecart: e, directe } = typeof x === 'object' && x ? x : { ecart: x, directe: false };
        if (directe && !e) bilan.triviales++; else bilan.comparaisons++;
        if (e) bilan.divergences.push({ objet, cle, revision: n, ecart: e });
        return;
      }
      bilan.refaites++;
      if (i + 1 >= essais) {
        bilan.divergences.push({ objet, cle, revision: n, ecart: `état instable : révision ${avant} → ${n} pendant la comparaison` });
        return;
      }
    }
  };
  for (const u of lecteurs) await stable('vue', cleLecteur(u), async () => await comparerVue(db, u));
  // L'entrée vient d'être lue par les vues de la révision courante : elle doit servir le jeu d'action.
  await stable('entrée', cleLecteur(LECTEUR_ENTREE), async () => {
    await db.lecture(async () => await buildSnapshot(db, LECTEUR_ENTREE));
    return await comparerJeuAction(db, LECTEUR_ENTREE, true);
  });
  if (jeux) for (const u of lecteurs) await stable('action', cleLecteur(u), async () => await comparerJeuAction(db, u, false));
  bilan.dureeMs = performance.now() - t0;
  return bilan;
}

/**
 * Porte des écritures de l'essai de charge : `passer` laisse passer une écriture (attendue tant que la porte est fermée),
 * `fermer` attend la fin des écritures en cours et retient les suivantes, `ouvrir` les relâche. La comparaison se fait
 * porte fermée, sur un état que l'essai ne change pas.
 */
export class Porte {
  private enCours = 0;
  private fermee: Promise<void> | null = null;
  private relacher: (() => void) | null = null;
  private vide: (() => void) | null = null;
  /** Écritures passées depuis la création. */
  passees = 0;

  async passer<T>(fn: () => Promise<T>): Promise<T> {
    while (this.fermee) await this.fermee;
    this.enCours++;
    try {
      return await fn();
    } finally {
      this.enCours--;
      this.passees++;
      if (!this.enCours && this.vide) { this.vide(); this.vide = null; }
    }
  }

  async fermer(): Promise<void> {
    while (this.fermee) await this.fermee;
    this.fermee = new Promise(ok => { this.relacher = ok; });
    if (this.enCours) await new Promise<void>(ok => { this.vide = ok; });
  }

  ouvrir(): void {
    const r = this.relacher;
    this.fermee = null;
    this.relacher = null;
    r?.();
  }
}
