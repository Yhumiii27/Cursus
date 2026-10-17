// Compression des réponses par Cursus (brotli, sinon gzip), sans dépendance : l'interface compilée (près d'1 Mo de
// JavaScript) et l'instantané JSON (/api/data, /api/actions) partent compressés vers les salariés qui ouvrent Cursus
// depuis Internet, smartphone compris, quel que soit le proxy de l'hébergeur (Coolify : Traefik ne compresse pas
// sans réglage). Active par défaut ; CURSUS_COMPRESSION=0 la retire quand le proxy compresse déjà (Caddy :
// « encode zstd gzip », docs/DEPLOIEMENT.md).
// Seuls le texte, le JSON, le JavaScript et le SVG sont compressés (les polices woff2 et les images le sont déjà), au-delà
// de 1 Ko, et jamais une réponse partielle (206), vide (204, 304), à une requête HEAD ou marquée `no-transform`.
import type { NextFunction, Request, Response } from 'express';
import { constants, createBrotliCompress, createGzip, type BrotliCompress, type Gzip } from 'node:zlib';

/** En deçà, la compression ne gagne presque rien et coûte un aller-retour de calcul. */
export const SEUIL_COMPRESSION = 1024;
/** Brotli au niveau 5 : à peine moins compact que le niveau 11, mais des dizaines de fois plus rapide sur 1 Mo. */
const QUALITE_BROTLI = 5;
const COMPRESSIBLES = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;

export type Encodage = 'br' | 'gzip';

/** Encodage retenu d'après Accept-Encoding : brotli s'il est admis, sinon gzip, sinon aucun (q=0 exclut ; « * » vaut pour les deux). */
export function encodageAccepte(entete: string | undefined): Encodage | null {
  const poids = new Map<string, number>();
  for (const partie of (entete ?? '').split(',')) {
    const [nom, ...params] = partie.trim().toLowerCase().split(';');
    if (!nom) continue;
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    const v = q ? Number(q.slice(2)) : 1;
    poids.set(nom, Number.isFinite(v) ? v : 0);
  }
  const admis = (nom: string) => (poids.get(nom) ?? poids.get('*') ?? 0) > 0;
  return admis('br') ? 'br' : admis('gzip') ? 'gzip' : null;
}

type Morceau = string | Buffer | Uint8Array;
const octets = (m: Morceau, enc?: BufferEncoding) => typeof m === 'string' ? Buffer.from(m, enc) : m;

/**
 * Intercale le compresseur entre Express et la connexion : la décision est prise au premier envoi (en-têtes définitifs,
 * taille connue par Content-Length ou par le corps entier de res.send) ; Content-Length est alors retiré, l'ETag rendu
 * faible (la version compressée n'est pas identique octet pour octet) et Vary: Accept-Encoding posé.
 */
export function compression() {
  return (req: Request, res: Response, next: NextFunction) => {
    const encodage = encodageAccepte(req.headers['accept-encoding']);
    const write = res.write.bind(res) as (m: Morceau, cb?: (e?: Error | null) => void) => boolean;
    const end = res.end.bind(res) as (m?: Morceau, cb?: () => void) => Response;
    let flux: BrotliCompress | Gzip | null = null;
    let decide = false;

    const decider = (taille: number) => {
      decide = true;
      if (res.headersSent) return;
      if (!COMPRESSIBLES.test(String(res.getHeader('Content-Type') ?? ''))) return;
      res.vary('Accept-Encoding');
      const statut = res.statusCode;
      if (!encodage || req.method === 'HEAD' || statut < 200 || statut === 204 || statut === 206 || statut === 304) return;
      if (res.getHeader('Content-Encoding') || /\bno-transform\b/i.test(String(res.getHeader('Cache-Control') ?? ''))) return;
      const longueur = res.getHeader('Content-Length');
      if ((longueur !== undefined ? Number(longueur) : taille) < SEUIL_COMPRESSION) return;
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', encodage);
      const etag = res.getHeader('ETag');
      if (typeof etag === 'string' && !etag.startsWith('W/')) res.setHeader('ETag', `W/${etag}`);
      const f = flux = encodage === 'br'
        ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: QUALITE_BROTLI, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } })
        : createGzip({ level: 6 });
      // Contre-pression : la connexion saturée met le compresseur en pause ; le compresseur saturé le signale à
      // l'émetteur (fichier lu par express.static) par l'événement « drain » de la réponse.
      f.on('data', (m: Buffer) => { if (!write(m)) f.pause(); });
      res.on('drain', () => f.resume());
      f.on('drain', () => res.emit('drain'));
      f.on('end', () => end());
      f.on('error', err => res.destroy(err));
      res.once('close', () => { if (!res.writableFinished) f.destroy(); });
    };

    res.write = ((m: Morceau, enc?: BufferEncoding | ((e?: Error | null) => void), cb?: (e?: Error | null) => void) => {
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (!decide) decider(Infinity); // envoi en plusieurs morceaux : taille connue seulement par Content-Length
      if (!flux) return write(typeof m === 'string' ? Buffer.from(m, enc) : m, cb);
      return flux.write(octets(m, enc), cb);
    }) as Response['write'];

    res.end = ((m?: Morceau | (() => void), enc?: BufferEncoding | (() => void), cb?: () => void) => {
      if (typeof m === 'function') { cb = m; m = undefined; }
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (!decide) decider(m === undefined ? 0 : octets(m, enc).length);
      if (!flux) return end(m === undefined ? undefined : octets(m, enc), cb);
      if (cb) res.once('finish', cb);
      if (m === undefined) flux.end(); else flux.end(octets(m, enc));
      return res;
    }) as Response['end'];

    next();
  };
}
