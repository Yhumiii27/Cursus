// Point de santé pour la supervision du service informatique et le HEALTHCHECK du conteneur : GET /api/health, sans
// connexion ni limite de débit (monté avant les autres routes /api). Il interroge la base (SELECT 1, lecture de l'en-tête
// du fichier par PRAGMA user_version) et répond 503 si elle ne répond pas. Réponse publique réduite à l'état : n'importe
// qui sur Internet peut l'appeler. Version, mode et envois en échec ne sont donnés qu'à un appel local (sur la machine,
// sans passer par le reverse proxy) ou porteur du jeton de supervision (CURSUS_SUPERVISION_TOKEN). Jamais de donnée
// personnelle. Guide : docs/DEPLOIEMENT.md, « Exploitation courante ».
import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { VERSION } from './chemins.ts';
import { BOUCLE_LOCALE, demoActive, type Env, enProduction } from './config.ts';
import type { Db } from './db.ts';
import { EN_TETES_PROXY } from './securite.ts';

export interface Sante {
  statut: 'ok' | 'indisponible';
  base: 'ok' | 'erreur';
  /** Détail (appel local ou jeton de supervision). */
  version?: string;
  mode?: 'production' | 'demo' | 'developpement';
  /** Envois en échec que le service RH n'a pas encore classés (Paramètres → Envois), toutes cibles. */
  envoisEnEchec?: number;
  /** Démarrage du serveur (ISO). */
  depuis?: string;
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

/** État de la base et, pour la supervision, du service. Base injoignable : `indisponible`. */
export function etatSante(db: Db, detail: boolean, depuis: string, env: Env = process.env): Sante {
  let base: Sante['base'] = 'ok', envoisEnEchec: number | undefined;
  try {
    db.sql.prepare('SELECT 1').get();
    db.sql.prepare('PRAGMA user_version').get(); // lit l'en-tête du fichier : la base est là et lisible
    if (detail) envoisEnEchec = Number((db.sql.prepare(`SELECT COUNT(*) AS n FROM envois WHERE statut = 'echec' AND classe IS NULL`).get() as { n: number }).n);
  } catch {
    base = 'erreur';
  }
  const etat: Sante = { statut: base === 'ok' ? 'ok' : 'indisponible', base };
  if (!detail) return etat;
  return { ...etat, version: VERSION, mode: demoActive(env) ? 'demo' : enProduction(env) ? 'production' : 'developpement', envoisEnEchec, depuis };
}

/** Route GET /api/health (HEAD compris) : 200 si la base répond, 503 sinon ; jamais mise en cache. */
export function routeSante(db: Db, depuis = new Date().toISOString(), env: Env = process.env): Router {
  const r = Router();
  r.get('/api/health', (req, res) => {
    const etat = etatSante(db, appelSupervision(req, env), depuis, env);
    res.setHeader('Cache-Control', 'no-store');
    res.status(etat.statut === 'ok' ? 200 : 503).json(etat);
  });
  return r;
}
