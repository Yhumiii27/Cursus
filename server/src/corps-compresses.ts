// Corps compressés gardés avec la vue (lot 10, chantier A). Le corps JSON d'une vue partagée est déjà calculé une fois par
// entrée du cache et par clé de vue (lot 9, server/src/vues-cache.ts), mais la compression (server/src/compression.ts) le
// recompressait à chaque requête : 23 Mo de JSON pour l'espace RH sur 5 ans, 0,2 à 0,5 s de brotli par lecture, dans le
// flux de la réponse. Désormais, pour un grand corps (gardé en octets : `SEUIL_CORPS_OCTETS` de server/src/vues-cache.ts) :
// - le corps compressé est calculé une fois par vue, par tête de requête (utilisateur, révision, dossiers échus,
//   abonnement à l'agenda : `TETE`) et par encodage (brotli, ou gzip pour un client qui n'accepte pas brotli), hors de la
//   boucle d'événements (zlib asynchrone, réserve de fils de libuv), puis gardé avec la vue (WeakMap : il disparaît avec
//   elle, quand l'entrée du cache est remplacée) ; le corps en octets n'est assemblé que pour le compresser ;
// - deux requêtes simultanées pour le même corps attendent la même compression ;
// - GET /api/data l'envoie tel quel, avec Content-Encoding et Vary: Accept-Encoding ; le module de compression, qui voit
//   l'en-tête Content-Encoding déjà posé, ne compresse pas une seconde fois.
// Le corps compressé décompressé est, octet pour octet, le corps JSON de la vue et de cette tête (`corpsEnOctets`) : la
// clé du corps gardé est la tête sérialisée, propre à la requête, sous la vue (donc sous sa clé), jamais une autre vue
// ni un autre utilisateur. Hors de ce chemin (petit corps, compression coupée par CURSUS_COMPRESSION=0, client sans
// brotli ni gzip, vue hors cache), rien ne change. CURSUS_CORPS_COMPRESSES=0 coupe ce cache : le grand corps part en
// octets et le module de compression le compresse à chaque requête, comme au lot 9.
import type { Request, Response } from 'express';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { type Encodage, encodageAccepte } from './compression.ts';

/** Corps compressés gardés au plus par vue (une tête par compte RH et par encodage) : les plus anciens cèdent la place. */
export const CORPS_PAR_VUE = 8;
/**
 * Brotli niveau 5 (mode texte), comme le module de compression (server/src/compression.ts) ; niveau 4 au-delà de
 * `GRAND_CORPS` octets : sur la vue RH de 5 ans (23 Mo), 0,12 s au lieu de 0,22 s pour 0,88 Mo au lieu de 0,76 Mo, le
 * corps étant recompressé à chaque révision pendant une validation groupée. Gzip niveau 6.
 */
const QUALITE_BROTLI = 5;
const QUALITE_BROTLI_GRAND = 4;
export const GRAND_CORPS = 8 * 1024 * 1024;

const compresserBr = promisify(brotliCompress);
const compresserGz = promisify(gzip);

/** Cache actif : CURSUS_CORPS_COMPRESSES vaut autre chose que « 0 ». */
export const corpsCompressesActifs = (env: Record<string, string | undefined> = process.env) => env.CURSUS_CORPS_COMPRESSES?.trim() !== '0';

/** Corps compressés par vue partagée : clé « encodage + tête » → compression (en cours ou faite). */
const parVue = new WeakMap<object, Map<string, Promise<Buffer>>>();

/** Compressions faites (tests, mesures) : une par vue, tête et encodage, réutilisée ensuite. */
export let compressionsFaites = 0;

/**
 * Morceaux de sortie de zlib : 1 Mo. Avec la taille par défaut (16 Ko), chaque morceau produit est rendu par un tour de
 * la boucle d'événements ; quand la boucle est chargée (validation groupée), les 55 morceaux de la vue RH compressée
 * attendaient chacun leur tour (1,1 s pour une compression de 0,12 s). En un ou deux morceaux, la compression ne rend la
 * main qu'à la fin.
 */
const MORCEAU_SORTIE = 1024 * 1024;

/** Compression des octets `octets` dans l'encodage `enc`, hors de la boucle d'événements. */
export async function compresser(octets: Buffer, enc: Encodage): Promise<Buffer> {
  compressionsFaites++;
  return enc === 'br'
    ? await compresserBr(octets, {
      chunkSize: MORCEAU_SORTIE,
      params: { [constants.BROTLI_PARAM_QUALITY]: octets.length >= GRAND_CORPS ? QUALITE_BROTLI_GRAND : QUALITE_BROTLI, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_SIZE_HINT]: octets.length },
    })
    : await compresserGz(octets, { level: 6, chunkSize: MORCEAU_SORTIE });
}

/**
 * Corps de la vue partagée `vue` pour la tête `tete` (assemblé par `corps` : `corpsEnOctets`, seulement s'il faut le
 * compresser) compressé dans l'encodage `enc`, calculé une fois par vue, tête et encodage. Une compression en échec
 * n'est pas gardée.
 */
export async function corpsCompresse(vue: object, tete: Record<string, unknown>, corps: () => Buffer, enc: Encodage): Promise<Buffer> {
  let m = parVue.get(vue);
  if (!m) parVue.set(vue, m = new Map());
  const cle = `${enc}|${JSON.stringify(tete)}`;
  let p = m.get(cle);
  if (!p) {
    p = compresser(corps(), enc);
    m.set(cle, p);
    const garde = m, promesse = p;
    promesse.catch(() => { if (garde.get(cle) === promesse) garde.delete(cle); });
    // Place limitée : la plus ancienne compression cède la sienne (Map : ordre d'insertion).
    while (m.size > CORPS_PAR_VUE) m.delete(m.keys().next().value!);
  }
  return await p;
}

/**
 * Encodage avec lequel GET /api/data envoie un grand corps compressé gardé, ou null (le corps part en octets, et le
 * module de compression décide comme pour toute réponse) : cache actif, compression active, requête GET, client qui
 * accepte brotli ou gzip.
 */
export function encodageGarde(req: Request, compression: boolean): Encodage | null {
  if (!compression || !corpsCompressesActifs() || req.method !== 'GET') return null;
  return encodageAccepte(req.headers['accept-encoding']);
}

/** Envoie un corps JSON déjà compressé dans l'encodage `enc` (Content-Type JSON, Content-Encoding, Vary). */
export function envoyerCompresse(res: Response, octets: Buffer, enc: Encodage): void {
  res.vary('Accept-Encoding');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Encoding', enc);
  res.send(octets);
}
