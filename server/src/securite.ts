// En-têtes de sécurité HTTP, posés sur toutes les réponses (sans dépendance externe), et
// garde de la démonstration en production (requêtes de ce poste uniquement).
// L'interface compilée ne charge que ses propres fichiers : aucun script ni style en
// ligne (l'impression utilise une feuille de style et un script servis, voir client/src/print.ts).
import type { NextFunction, Request, Response } from 'express';
import { LISTE_TYPES_PIECES } from '../../shared/rules/pieces.ts';
import { BOUCLE_LOCALE } from './config.ts';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** Fonctions du navigateur refusées à la page : Cursus n'en utilise aucune. */
const PERMISSIONS = ['accelerometer', 'camera', 'display-capture', 'geolocation', 'gyroscope', 'magnetometer', 'microphone', 'payment', 'usb']
  .map(f => `${f}=()`).join(', ');

/** HSTS : un an, posé seulement en production et sur une requête arrivée en HTTPS (via le reverse proxy). */
export const HSTS = 'max-age=31536000; includeSubDomains';

export function securityHeaders(production: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', PERMISSIONS);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // req.secure lit X-Forwarded-Proto si le proxy est de confiance (CURSUS_TRUST_PROXY).
    if (production && req.secure) res.setHeader('Strict-Transport-Security', HSTS);
    // Données personnelles : jamais conservées dans le cache du navigateur ou d'un proxy.
    if (req.path === '/api' || req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/** Méthodes sans effet : seules les autres (POST…) sont contrôlées contre la falsification de requête (CSRF). */
const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origine publique de Cursus (CURSUS_PUBLIC_URL), admise en plus de l'hôte de la requête. */
function originePublique(): string | null {
  try { return process.env.CURSUS_PUBLIC_URL ? new URL(process.env.CURSUS_PUBLIC_URL).origin : null; } catch { return null; }
}

/**
 * Motif de refus d'une requête qui modifie (POST…) mais ne vient pas de l'interface de Cursus, sinon null :
 * - `Sec-Fetch-Site` (navigateurs récents) : émise par une page d'un autre site, ou d'un sous-domaine voisin ;
 * - `Origin` : celle d'une autre adresse que Cursus (nom et port de la requête, `req.host`, qui suit le reverse proxy
 *   de confiance, ou CURSUS_PUBLIC_URL), ou « null » (page locale, cadre isolé) ;
 * - corps autre que JSON : un formulaire ou un `fetch` d'une autre origine ne peut envoyer sans autorisation préalable
 *   (CORS, que Cursus n'accorde jamais) que du texte ou un formulaire. Une requête sans corps (déconnexion) passe.
 * Un client sans navigateur (script, test) n'envoie ni Origin ni Sec-Fetch-Site : il n'a pas de cookie d'un autre site.
 */
export function refusCsrf(req: Request): string | null {
  if (METHODES_SURES.has(req.method)) return null;
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return 'requête émise depuis un autre site';
  const origine = req.get('origin');
  if (origine !== undefined) {
    let hote: string | null = null;
    try { hote = new URL(origine).host; } catch { /* « null » ou valeur illisible */ }
    if (!hote || (hote !== (req.host ?? '').toLowerCase() && origine !== originePublique())) return 'origine étrangère à Cursus';
  }
  const type = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const corps = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding') !== undefined;
  // Envoi d'une pièce justificative (server/src/pieces-routes.ts) : PDF, JPEG ou PNG bruts, types qu'une autre origine ne
  // peut pas non plus envoyer sans autorisation préalable (ils ne sont pas parmi les types « simples » de CORS).
  if (req.path === '/api/pieces' && (LISTE_TYPES_PIECES as readonly string[]).includes(type)) return null;
  if ((corps || type) && type !== 'application/json') return 'corps JSON attendu';
  return null;
}

/**
 * Protection contre la falsification de requête (CSRF) : le cookie de session (SameSite=Lax) ne suffit pas, une
 * page d'un sous-domaine voisin ou un formulaire en texte brut le transmettraient. Refus 403 sans rien exécuter.
 * L'API Keystone (clé X-Api-Key, sans cookie) est montée avant ; la connexion Microsoft ne fait que des GET.
 */
export function protectionCsrf() {
  return (req: Request, res: Response, next: NextFunction) => {
    const motif = refusCsrf(req);
    if (!motif) return next();
    res.status(403).json({ error: `Requête refusée : ${motif}. Ouvrez Cursus à son adresse habituelle et recommencez.` });
  };
}

/** En-têtes posés par un reverse proxy (Caddy, nginx…) : leur présence trahit une requête relayée. */
export const EN_TETES_PROXY = ['forwarded', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip'];

/** Nom d'hôte de l'en-tête Host, sans le port (« [::1]:3217 » → « ::1 »). */
function nomHote(host: string | undefined): string {
  const h = (host ?? '').trim().toLowerCase();
  return h.startsWith('[') ? h.slice(1, h.indexOf(']')) : h.replace(/:\d*$/, '');
}

/**
 * Démonstration en production (application de bureau) : seules les requêtes émises sur ce
 * poste sont servies. Une requête relayée par un reverse proxy (Forwarded, X-Forwarded-*) ou
 * adressée à un autre nom que la boucle locale (proxy, DNS rebinding) reçoit 403 : la
 * démonstration ouvre l'espace RH sans mot de passe et ne doit jamais être publiée.
 */
export function demoPosteLocal() {
  let signale = false;
  return (req: Request, res: Response, next: NextFunction) => {
    const relayee = EN_TETES_PROXY.some(h => req.headers[h] !== undefined);
    if (!relayee && BOUCLE_LOCALE.includes(nomHote(req.headers.host))) return next();
    if (!signale) {
      signale = true;
      console.warn('Mode démonstration : requête relayée ou adressée à un autre hôte que la boucle locale, refusée (403). La démonstration n’est pas admise derrière un reverse proxy.');
    }
    res.status(403).json({ error: 'Mode démonstration : accès réservé à ce poste' });
  };
}
