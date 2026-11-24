// Filtre facultatif de l'API Keystone par adresse (lot 8, chantier B) : CURSUS_KEYSTONE_ADRESSES, liste d'adresses IP
// ou de réseaux (10.0.1.5, 10.0.1.0/24, fd00::/8), séparés par des virgules ou des espaces. Monté devant les routes
// /api/integrations/keystone (server/src/app.ts) : un appel venu d'une autre adresse reçoit 403 `ADRESSE_REFUSEE` avant
// même que sa clé soit lue. Vide (par défaut), il ne filtre rien : sous Coolify, la procédure recommande plutôt l'appel
// de Keystone par le réseau interne et la fermeture de la route publique dans Traefik (docs/BASCULE-PRODUCTION.md).
// L'adresse jugée est celle d'Express (`req.ip`) : derrière le proxy, elle n'est sûre que si CURSUS_TRUST_PROXY désigne
// le seul proxy (constat S7), sinon l'en-tête X-Forwarded-For d'un autre conteneur la ferait passer pour Keystone.
// Ce module ne dépend pas de la configuration (server/src/config.ts l'importe pour contrôler la variable au démarrage).
import { BlockList, isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

export interface AdressesKeystone {
  /** Adresses et réseaux admis ; null : aucun filtre (variable vide). */
  liste: BlockList | null;
  /** Entrées lues, dans l'ordre de la variable. */
  entrees: string[];
  /** Entrées qui ne sont ni une adresse ni un réseau (refusées au démarrage en production, server/src/config.ts). */
  invalides: string[];
}

/** Adresse IPv4 notée en IPv6 (::ffff:10.0.1.5), telle que la donne une écoute sur toutes les interfaces : rendue en IPv4. */
const enIpv4 = (ip: string) => (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip) ? ip.slice(7) : ip);

/** Lit CURSUS_KEYSTONE_ADRESSES : adresses et réseaux (préfixe /n) valables, entrées illisibles à part. */
export function lireAdressesKeystone(valeur: string | undefined): AdressesKeystone {
  const entrees = (valeur ?? '').split(/[\s,]+/).map(e => e.trim()).filter(Boolean);
  if (!entrees.length) return { liste: null, entrees, invalides: [] };
  const liste = new BlockList();
  const invalides: string[] = [];
  for (const e of entrees) {
    const [adresse, prefixe, ...reste] = e.split('/');
    const ip = enIpv4(adresse), type = isIP(ip);
    const max = type === 4 ? 32 : 128;
    if (!type || reste.length || (prefixe !== undefined && !(/^\d{1,3}$/.test(prefixe) && Number(prefixe) <= max))) { invalides.push(e); continue; }
    const famille = type === 4 ? 'ipv4' : 'ipv6';
    if (prefixe === undefined) liste.addAddress(ip, famille);
    else liste.addSubnet(ip, Number(prefixe), famille);
  }
  return { liste, entrees, invalides };
}

/** Adresse admise par la liste (aucune liste : tout est admis ; adresse inconnue : refusée). */
export function adresseAdmise(a: AdressesKeystone, ip: string | undefined): boolean {
  if (!a.liste) return true;
  const v = enIpv4(ip ?? '');
  const type = isIP(v);
  return !!type && a.liste.check(v, type === 4 ? 'ipv4' : 'ipv6');
}

/** Réponse au refus, dans le format des erreurs de l'API Keystone (docs/API-KEYSTONE.md). */
export const REFUS_ADRESSE = { error: 'Adresse non autorisée pour l’API Keystone', code: 'ADRESSE_REFUSEE' } as const;

/**
 * Middleware du filtre, lu une fois à la construction de l'application. Une liste dont aucune entrée n'est lisible
 * refuse tout (mieux vaut couper Keystone que l'ouvrir à tous) ; le démarrage en production l'aurait déjà refusée.
 */
export function filtreKeystone(env: Record<string, string | undefined> = process.env) {
  const adresses = lireAdressesKeystone(env.CURSUS_KEYSTONE_ADRESSES);
  return (req: Request, res: Response, next: NextFunction) => {
    if (adresseAdmise(adresses, req.ip ?? req.socket.remoteAddress)) return next();
    res.status(403).json(REFUS_ADRESSE);
  };
}
