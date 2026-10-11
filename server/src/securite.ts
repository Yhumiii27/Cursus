// En-têtes de sécurité HTTP, posés sur toutes les réponses (sans dépendance externe), et
// garde de la démonstration en production (requêtes de ce poste uniquement).
// L'interface compilée ne charge que ses propres fichiers : aucun script ni style en
// ligne (l'impression utilise une feuille de style et un script servis, voir client/src/print.ts).
import type { NextFunction, Request, Response } from 'express';
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
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/** En-têtes posés par un reverse proxy (Caddy, nginx…) : leur présence trahit une requête relayée. */
const EN_TETES_PROXY = ['forwarded', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip'];

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
