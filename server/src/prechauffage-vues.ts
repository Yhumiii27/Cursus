// Préchauffage des vues (lot 10, chantier A). Le préchauffage du lot 9 (server/src/demarrage.ts, `prechaufferCache`)
// lisait l'entrée du cache avant les premières requêtes, mais pas les vues : à la troisième mesure (S1, 30 lecteurs
// arrivés en 3 s), chaque première lecture calculait sa vue dans le même processus (2 RH, 6 managers, 22
// collaborateurs), d'où un p95 de 1,3 s (collaborateur) à 4,9 s (RH). Désormais, une fois l'entrée lue, les vues des
// comptes actifs sont calculées en tâche de fond, par le chemin même de GET /api/data (`lireParties`, server/src/dataset.ts :
// une seule évaluation par révision et par clé de vue, partagée avec les requêtes qui arrivent pendant ce temps), une vue
// à la fois, un tour de la boucle d'événements rendu entre deux (`setImmediate`) : les requêtes déjà arrivées, santé
// comprise, passent entre deux vues. Ordre : comptes de l'espace RH (un par profil d'abord, puis les autres), managers,
// puis collaborateurs, chacun par dernière connexion (les plus récents d'abord). Pour une vue au corps assez grand (vues
// RH), son corps JSON et sa version brotli, propres à la tête du compte, sont préparés aussi (server/src/corps-compresses.ts).
// Lancé au démarrage du serveur et au changement de jour (l'entrée d'un jour nouveau est relue en entier et toutes les
// vues sont à refaire : le premier lecteur du matin ne la paie plus), jamais sous node --test ni par les outils
// (server/src/demarrage.ts). CURSUS_PRECHAUFFAGE_VUES=0 le coupe (l'entrée seule est préchauffée, comme au lot 9).
// Rien n'est envoyé ni écrit : la tête des vues préparées (abonnement à l'agenda, dossiers échus) est lue en base comme
// pour une requête, et ne sert qu'au corps gardé avec la vue.
import { performance } from 'node:perf_hooks';
import type { CurrentUser } from '../../shared/types.ts';
import type { SessionInfo } from './auth.ts';
import { type Compte, compteValide, espacesDuCompte } from './comptes.ts';
import { corpsCompresse, corpsCompressesActifs } from './corps-compresses.ts';
import { currentUser, lireParties } from './dataset.ts';
import type { Db } from './db.ts';
import { corpsEnOctets, grandCorps } from './vues-cache.ts';

/** Préchauffage des vues actif : CURSUS_PRECHAUFFAGE_VUES vaut autre chose que « 0 ». */
export const prechauffageVuesActif = (env: Record<string, string | undefined> = process.env) => env.CURSUS_PRECHAUFFAGE_VUES?.trim() !== '0';

/** Rend la main à la boucle d'événements : les requêtes et minuteurs en attente passent avant la vue suivante. */
const tour = () => new Promise<void>(ok => setImmediate(ok));

/**
 * Lecteurs dont les vues sont préparées, dans l'ordre du préchauffage : chaque compte actif (`compteValide`) dans chacun
 * de ses espaces, comme `currentUser` le donnerait à sa session. Espace RH : un compte par profil d'abord (chaque vue de
 * profil), puis les autres comptes RH (corps propre à leur tête) ; puis managers ; puis collaborateurs ; dans chaque
 * groupe, les comptes connectés le plus récemment d'abord (jamais connectés à la fin, par identifiant).
 */
export async function lecteursAPrechauffer(db: Db): Promise<CurrentUser[]> {
  const groupes: Record<CurrentUser['role'], { u: CurrentUser; c: Compte }[]> = { rh: [], manager: [], collaborateur: [] };
  for (const c of await db.all<Compte>('comptes')) {
    if (!(await compteValide(db, c.id))) continue;
    for (const role of await espacesDuCompte(db, c)) {
      const u = await currentUser(db, { compteId: c.id, role } as SessionInfo);
      if (u) groupes[u.role].push({ u, c });
    }
  }
  const recents = (a: { c: Compte }, b: { c: Compte }) => (b.c.derniereConnexion ?? '').localeCompare(a.c.derniereConnexion ?? '') || a.c.id - b.c.id;
  for (const g of Object.values(groupes)) g.sort(recents);
  // Espace RH : le premier compte de chaque profil, puis les autres.
  const profils = new Set<string>(), premiers: typeof groupes.rh = [], suivants: typeof groupes.rh = [];
  for (const x of groupes.rh) {
    const profil = x.u.profilRh ?? '';
    if (profils.has(profil)) suivants.push(x);
    else { profils.add(profil); premiers.push(x); }
  }
  const rh = [...premiers, ...suivants];
  return [...rh, ...groupes.manager, ...groupes.collaborateur].map(x => x.u);
}

export interface BilanPrechauffage {
  /** Lecteurs préparés (vue servie par le cache, calculée ou partagée), corps compressés préparés. */
  vues: number;
  corps: number;
  /** Durée totale, tours de boucle compris (millisecondes). */
  ms: number;
  /** Arrêté avant la fin (arrêt du serveur, cache désactivé, erreur). */
  interrompu: boolean;
}

export interface OptionsPrechauffage {
  /** Compression des réponses active (CURSUS_COMPRESSION) : sans elle, aucun corps compressé n'est préparé. */
  compression: boolean;
  /** Vrai dès que le serveur s'arrête : le préchauffage s'interrompt avant la vue suivante. */
  arrete?: () => boolean;
  /** Avertissement (échec d'une vue : le préchauffage s'arrête, les requêtes calculeront leurs vues). */
  avertir?: (message: string) => void;
}

/**
 * Vues des comptes actifs (`lecteursAPrechauffer`) calculées une à une par le chemin de GET /api/data, un tour de boucle
 * rendu entre deux ; corps JSON et corps brotli des grandes vues préparés avec elles. Arrêt au premier échec (avertissement)
 * ou si le cache est désactivé (vue lue directement : rien à garder).
 */
export async function prechaufferVues(db: Db, o: OptionsPrechauffage): Promise<BilanPrechauffage> {
  const t0 = performance.now();
  const bilan: BilanPrechauffage = { vues: 0, corps: 0, ms: 0, interrompu: false };
  const fin = () => ({ ...bilan, ms: Math.round(performance.now() - t0) });
  if (!prechauffageVuesActif()) return fin();
  let lecteurs: CurrentUser[];
  try {
    lecteurs = await lecteursAPrechauffer(db);
  } catch (err) {
    o.avertir?.(`Préchauffage des vues impossible : ${err instanceof Error ? err.message : String(err)}`);
    return { ...fin(), interrompu: true };
  }
  for (const u of lecteurs) {
    await tour();
    if (o.arrete?.()) return { ...fin(), interrompu: true };
    try {
      const parties = await lireParties(db, u);
      // Cache désactivé (ou vue lue directement) : rien n'est gardé, inutile de continuer.
      if (parties.cle === null) return { ...fin(), interrompu: true };
      bilan.vues++;
      // Corps de la vue préparé (gardé avec elle) ; grand corps : sa version brotli pour la tête de ce compte.
      const { vue, cle, tete } = parties;
      if (grandCorps(vue, cle) && o.compression && corpsCompressesActifs()) {
        await corpsCompresse(vue, tete, () => corpsEnOctets(vue, cle, tete), 'br');
        bilan.corps++;
      }
    } catch (err) {
      o.avertir?.(`Préchauffage des vues interrompu : ${err instanceof Error ? err.message : String(err)}`);
      return { ...fin(), interrompu: true };
    }
  }
  return fin();
}
