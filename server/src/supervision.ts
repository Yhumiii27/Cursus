// Point de santé pour la supervision du service informatique et le HEALTHCHECK du conteneur : GET /api/health, sans
// connexion ni limite de débit (monté avant les autres routes /api). Il interroge la base (SELECT 1, lecture de l'en-tête
// du fichier par PRAGMA user_version) et répond 503 si elle ne répond pas ; « degrade » (200) si elle contient des
// références orphelines (server/src/integrite.ts). Réponse publique réduite à l'état : n'importe qui sur Internet peut
// l'appeler. Version, mode, envois en échec et orphelins ne sont donnés qu'à un appel local (sur la machine, sans passer
// par le reverse proxy) ou porteur du jeton de supervision (CURSUS_SUPERVISION_TOKEN). Jamais de donnée personnelle. Guide : docs/DEPLOIEMENT.md, « Exploitation courante ».
import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { VERSION } from './chemins.ts';
import { BOUCLE_LOCALE, demoActive, type Env, enProduction } from './config.ts';
import { type Db, enSerie } from './db.ts';
import { etatIntegrite } from './integrite.ts';
import { EN_TETES_PROXY } from './securite.ts';

export interface Sante {
  /** `degrade` : la base répond mais contient des références orphelines (détail : `orphelins`). */
  statut: 'ok' | 'degrade' | 'indisponible';
  base: 'ok' | 'erreur';
  /** Détail (appel local ou jeton de supervision). */
  version?: string;
  mode?: 'production' | 'demo' | 'developpement';
  /** Envois en échec que le service RH n'a pas encore classés (Paramètres → Envois), toutes cibles. */
  envoisEnEchec?: number;
  /** Démarrage du serveur (ISO). */
  depuis?: string;
  /** Références orphelines au dernier contrôle (au plus une heure), et leur nombre par référence (server/src/integrite.ts). */
  orphelins?: number;
  references?: Record<string, number>;
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

/** État de la base et, pour la supervision, du service. Base injoignable : `indisponible` ; références orphelines : `degrade`. */
export async function etatSante(db: Db, detail: boolean, depuis: string, env: Env = process.env): Promise<Sante> {
  let base: Sante['base'] = 'ok', envoisEnEchec: number | undefined, integrite: Awaited<ReturnType<typeof etatIntegrite>> | undefined;
  try {
    await db.one('SELECT 1');
    // SQLite : lit l'en-tête du fichier (la base est là et lisible) ; PostgreSQL : le schéma de Cursus est lisible.
    await db.one(db.moteur === 'pg' ? 'SELECT 1 FROM schema_migrations LIMIT 1' : 'PRAGMA user_version');
    if (detail) envoisEnEchec = Number((await db.one(`SELECT COUNT(*) AS n FROM envois WHERE statut = 'echec' AND classe IS NULL`) as { n: number }).n);
    // Contrôle impossible (requête refusée) : l'état de la base suffit, le démarrage l'a déjà signalé s'il le faut.
    try { integrite = await etatIntegrite(db); } catch { /* sans détail d'intégrité */ }
  } catch {
    base = 'erreur';
  }
  const etat: Sante = { statut: base === 'erreur' ? 'indisponible' : integrite?.orphelins ? 'degrade' : 'ok', base };
  if (!detail) return etat;
  return {
    ...etat, version: VERSION, mode: demoActive(env) ? 'demo' : enProduction(env) ? 'production' : 'developpement', envoisEnEchec, depuis,
    orphelins: integrite?.orphelins, references: integrite?.parReference,
  };
}

/** Route GET /api/health (HEAD compris) : 200 si la base répond (orphelins compris : le service fonctionne), 503 sinon ; jamais mise en cache. */
export function routeSante(db: Db, depuis = new Date().toISOString(), env: Env = process.env): Router {
  const r = Router();
  r.get('/api/health', enSerie(db, async (req: Request, res: Response) => {
    const etat = await etatSante(db, appelSupervision(req, env), depuis, env);
    res.setHeader('Cache-Control', 'no-store');
    res.status(etat.statut === 'indisponible' ? 503 : 200).json(etat);
  }));
  return r;
}
