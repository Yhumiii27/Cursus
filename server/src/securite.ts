// En-têtes de sécurité HTTP, posés sur toutes les réponses (sans dépendance externe).
// L'interface compilée ne charge que ses propres fichiers : aucun script ni style en
// ligne (l'impression utilise une feuille de style servie, voir client/src/print.ts).
import type { NextFunction, Request, Response } from 'express';

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
