// Point de santé pour la supervision du service informatique et le HEALTHCHECK du conteneur : GET /api/health, sans
// connexion ni limite de débit (monté avant les autres routes /api). Il sonde la base (server/src/db.ts, `sonde` : une
// lecture minimale, sans le verrou d'écriture ni la file de SQLite, abandonnée au bout de 2 s) et répond 503 si elle ne
// répond pas. Il ne prend plus le verrou global (lot 8, chantier B) : une transaction longue (validation groupée,
// génération d'un lot) ne le fait plus attendre ni passer pour une panne. Ce qui demande de lire la base (références
// orphelines, administrateurs RH, données de démonstration) est lu dans un état mis en cache par la tâche horaire
// (`demarrerSurveillance`, lancée par server/src/index.ts). Administrateurs RH et données de démonstration sont en plus
// relus par le point de santé lui-même : à chaque appel tant qu'une de leurs alertes est levée (premier administrateur
// créé par `npm run comptes`, dans un autre processus : alerte levée dès l'appel suivant), sinon au plus une fois par
// minute (dernier administrateur suspendu) ; une seule relecture à la fois, gardée sous le délai de la sonde.
// « degrade » (200 : le service fonctionne, à examiner) quand l'une des alertes suivantes est levée :
// - `orphelins` : références orphelines (server/src/integrite.ts) ;
// - `secret-microsoft` : secret client Entra qui expire dans 30 jours ou moins (CURSUS_OIDC_SECRET_EXPIRE) ;
// - `secret-envoi` : secret propre à l'envoi des e-mails qui expire dans 30 jours ou moins (CURSUS_MAIL_SECRET_EXPIRE) ;
// - `demo-base-commune` : démonstration branchée sur la base epc2i du serveur commun (signalée, jamais arrêtée, lot 8) ;
// - `sauvegarde` : dernière sauvegarde du serveur commun de plus de 26 h, ou témoin illisible (CURSUS_SAUVEGARDE_TEMOIN,
//   server/src/sauvegarde-temoin.ts) ;
// - en production hors démonstration seulement : `donnees-demo` (données du jeu fictif dans la base), `aucun-admin`
//   (aucun administrateur RH actif), `emails-simulation` (CURSUS_MAIL_FROM absente : aucun e-mail ne part).
// Réponse publique réduite à l'état : n'importe qui sur Internet peut l'appeler. Version, mode, alertes, envois en échec,
// orphelins, échéances et sauvegarde ne sont donnés qu'à un appel local (sur la machine, sans passer par le reverse
// proxy) ou porteur du jeton de supervision (CURSUS_SUPERVISION_TOKEN). Jamais de donnée personnelle. Guide :
// docs/DEPLOIEMENT.md, « Exploitation courante ».
import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { VERSION } from './chemins.ts';
import { adminsActifs } from './comptes.ts';
import { BOUCLE_LOCALE, configMail, demoActive, demoSurBaseCommune, type Env, enProduction } from './config.ts';
import type { Db } from './db.ts';
import { todayIso } from './dataset.ts';
import { dernierControle, etatIntegrite, refaireControle } from './integrite.ts';
import { log } from './logs.ts';
import { indicesDemo } from './pre-vol.ts';
import { lireTemoin } from './sauvegarde-temoin.ts';
import { echeanceSecret, echeanceSecretEnvoi } from './secret-microsoft.ts';
import { EN_TETES_PROXY } from './securite.ts';

/** Délai de la sonde de la base : au-delà, la base est déclarée indisponible (la sonde Docker abandonne à 5 s). */
export const DELAI_SANTE_MS = 2_000;
/** Intervalle de la tâche qui relit l'état de la base pour le point de santé. */
export const INTERVALLE_SURVEILLANCE_MS = 3600_000;
/** Âge au-delà duquel le point de santé relit lui-même administrateurs RH et données de démonstration (sans alerte levée). */
export const FRAICHEUR_DONNEES_MS = 60_000;

/** Alertes qui font passer l'état à « degrade » (détail réservé à la supervision). */
export type AlerteSante = 'orphelins' | 'secret-microsoft' | 'secret-envoi' | 'demo-base-commune' | 'sauvegarde' | 'donnees-demo' | 'aucun-admin' | 'emails-simulation';

export interface Sante {
  /** `degrade` : la base répond, mais au moins une alerte est levée (détail : `alertes`). */
  statut: 'ok' | 'degrade' | 'indisponible';
  base: 'ok' | 'erreur';
  /** Détail (appel local ou jeton de supervision). */
  version?: string;
  mode?: 'production' | 'demo' | 'developpement';
  /** Alertes levées, dans l'ordre de la liste ci-dessus ; vide quand l'état est « ok ». */
  alertes?: AlerteSante[];
  /** Envois en échec que le service RH n'a pas encore classés (Paramètres → Envois), toutes cibles ; absent si la base n'a pas répondu à temps. */
  envoisEnEchec?: number;
  /** Démarrage du serveur (ISO). */
  depuis?: string;
  /** Références orphelines au dernier contrôle (au plus une heure), et leur nombre par référence (server/src/integrite.ts). */
  orphelins?: number;
  references?: Record<string, number>;
  /** Expiration du secret client Entra (CURSUS_OIDC_SECRET_EXPIRE) et jours restants, si la date est posée. */
  secretMicrosoft?: { expireLe: string; jours: number };
  /** Expiration du secret propre à l'envoi des e-mails (CURSUS_MAIL_SECRET_EXPIRE) et jours restants, si la date est posée. */
  secretEnvoi?: { expireLe: string; jours: number };
  /** Dernière sauvegarde du serveur commun d'après le témoin (CURSUS_SAUVEGARDE_TEMOIN), ou ce qui empêche de la lire. */
  sauvegarde?: { le: string; heures: number } | { erreur: string };
}

/** Adresse de la connexion sur la boucle locale (IPv4, IPv6, IPv4 notée en IPv6). */
const bouclee = (ip: string | undefined) => !!ip && (BOUCLE_LOCALE.includes(ip) || ip.startsWith('127.') || ip.startsWith('::ffff:127.'));

/** Jeton `Authorization: Bearer …` égal à CURSUS_SUPERVISION_TOKEN (comparaison en temps constant). */
function jetonValide(req: Request, attendu: string | undefined): boolean {
  if (!attendu) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Appel autorisé à voir le détail : connexion venue de la machine elle-même et non relayée par le reverse proxy (qui est
 * aussi sur la boucle locale, mais ajoute ses en-têtes X-Forwarded-*), ou jeton de supervision.
 */
export function appelSupervision(req: Request, env: Env = process.env): boolean {
  if (jetonValide(req, env.CURSUS_SUPERVISION_TOKEN?.trim())) return true;
  return bouclee(req.socket.remoteAddress) && !EN_TETES_PROXY.some(h => req.headers[h] !== undefined);
}

/** `fn` abandonnée (rejetée) au bout de `ms` ; la requête elle-même finit plus tard, son résultat est ignoré. */
async function avecDelai<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let minuterie: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([fn(), new Promise<never>((_ok, ko) => { minuterie = setTimeout(() => ko(new Error('délai dépassé')), ms); })]);
  } finally {
    clearTimeout(minuterie);
  }
}

// — État mis en cache par la tâche horaire —

/** Données de la base lues pour le point de santé : administrateurs RH actifs, indices du jeu de démonstration. */
export interface EtatDonnees { admins: number; demo: string[]; le: string }
const donnees = new WeakMap<Db, EtatDonnees>();
/** Relecture en cours, partagée par les appels simultanés (route publique : jamais plusieurs relectures à la fois). */
const enCours = new WeakMap<Db, Promise<EtatDonnees>>();

/** Relit les données de la base pour le point de santé (sans les références orphelines, contrôlées à part). */
function lireDonnees(db: Db): Promise<EtatDonnees> {
  const deja = enCours.get(db);
  if (deja) return deja;
  const p = (async () => {
    try {
      const e = { admins: await adminsActifs(db), demo: await indicesDemo(db), le: new Date().toISOString() };
      donnees.set(db, e);
      return e;
    } finally {
      enCours.delete(db);
    }
  })();
  enCours.set(db, p);
  return p;
}

/**
 * État des données pour le point de santé : le cache s'il est récent et sans alerte, sinon relu (dans `delai` ; base
 * lente ou en erreur : le cache, même ancien). Une alerte levée (aucun administrateur, données de démonstration) est
 * relue à chaque appel, pour tomber dès que l'exploitant a corrigé (docs/BASCULE-PRODUCTION.md, J0).
 */
async function donneesSante(db: Db, delai: number, maintenant = Date.now()): Promise<EtatDonnees | undefined> {
  const d = donnees.get(db);
  if (d && d.admins && !d.demo.length && maintenant - Date.parse(d.le) < FRAICHEUR_DONNEES_MS) return d;
  return await avecDelai(async () => await lireDonnees(db), delai).catch(() => d);
}

/**
 * Tâche horaire : contrôle d'intégrité refait et données relues ; une erreur (base injoignable) garde l'état précédent.
 * `integrite: false` : contrôle d'intégrité déjà fait à l'instant (démarrage, server/src/integrite.ts).
 */
export async function rafraichirSurveillance(db: Db, { integrite = true } = {}): Promise<void> {
  try {
    if (integrite) await refaireControle(db);
    await lireDonnees(db);
  } catch (err) {
    log.avertissement(`Point de santé : état de la base non relu (${err instanceof Error ? err.message : String(err)}) ; dernier état gardé.`);
  }
}

/**
 * Tâche de la supervision (server/src/index.ts) : état relu tout de suite, puis toutes les heures. Rend la fonction qui
 * l'arrête (arrêt du serveur).
 */
export async function demarrerSurveillance(db: Db, intervalle = INTERVALLE_SURVEILLANCE_MS): Promise<() => void> {
  await rafraichirSurveillance(db, { integrite: !dernierControle(db) });
  const minuterie = setInterval(async () => await rafraichirSurveillance(db), intervalle);
  minuterie.unref();
  return () => clearInterval(minuterie);
}

/**
 * État de la base et, pour la supervision, du service. Base sans réponse dans le délai : `indisponible` ; au moins une
 * alerte : `degrade`. Sans tâche horaire (tests, application montée seule), le premier appel lit lui-même ce qui manque.
 */
export async function etatSante(db: Db, detail: boolean, depuis: string, env: Env = process.env, { delai = DELAI_SANTE_MS } = {}): Promise<Sante> {
  let base: Sante['base'] = 'ok';
  try {
    await avecDelai(async () => await db.sonde(), delai);
  } catch {
    base = 'erreur';
  }
  const alertes: AlerteSante[] = [];
  let integrite = dernierControle(db), envoisEnEchec: number | undefined;
  if (base === 'ok') {
    // Contrôle impossible (requête refusée, délai) : l'état de la base suffit, le démarrage l'a déjà signalé s'il le faut.
    if (!integrite) integrite = await avecDelai(async () => await etatIntegrite(db), delai).catch(() => undefined);
    if (detail) {
      envoisEnEchec = await avecDelai(async () => Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM envois WHERE statut = 'echec' AND classe IS NULL`))!.n), delai)
        .catch(() => undefined);
    }
  }
  const today = todayIso();
  const secret = echeanceSecret(today, env), envoi = echeanceSecretEnvoi(today, env), temoin = lireTemoin(env);
  if (integrite?.orphelins) alertes.push('orphelins');
  if (secret?.alerte) alertes.push('secret-microsoft');
  if (envoi?.alerte) alertes.push('secret-envoi');
  if (demoSurBaseCommune(env)) alertes.push('demo-base-commune');
  if (temoin && ('erreur' in temoin || temoin.enRetard)) alertes.push('sauvegarde');
  if (base === 'ok' && enProduction(env) && !demoActive(env)) {
    const d = await donneesSante(db, delai);
    if (d?.demo.length) alertes.push('donnees-demo');
    if (d && !d.admins) alertes.push('aucun-admin');
    if (!configMail(env)) alertes.push('emails-simulation');
  }
  const etat: Sante = { statut: base === 'erreur' ? 'indisponible' : alertes.length ? 'degrade' : 'ok', base };
  if (!detail) return etat;
  return {
    ...etat, version: VERSION, mode: demoActive(env) ? 'demo' : enProduction(env) ? 'production' : 'developpement', alertes, envoisEnEchec, depuis,
    orphelins: integrite?.orphelins, references: integrite?.parReference,
    ...(secret ? { secretMicrosoft: { expireLe: secret.expireLe, jours: secret.jours } } : {}),
    ...(envoi ? { secretEnvoi: { expireLe: envoi.expireLe, jours: envoi.jours } } : {}),
    ...(temoin ? { sauvegarde: 'erreur' in temoin ? { erreur: temoin.erreur } : { le: temoin.le, heures: temoin.heures } } : {}),
  };
}

/**
 * Route GET /api/health (HEAD compris) : 200 si la base répond (alertes comprises : le service fonctionne), 503 sinon ;
 * jamais mise en cache. Hors du verrou d'écriture (lot 8) : elle répond pendant une transaction en cours.
 */
export function routeSante(db: Db, depuis = new Date().toISOString(), env: Env = process.env, options: { delai?: number } = {}): Router {
  const r = Router();
  r.get('/api/health', async (req: Request, res: Response) => {
    const etat = await etatSante(db, appelSupervision(req, env), depuis, env, options);
    res.setHeader('Cache-Control', 'no-store');
    res.status(etat.statut === 'indisponible' ? 503 : 200).json(etat);
  });
  return r;
}
