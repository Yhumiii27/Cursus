// Photo d'un justificatif prise avec le téléphone (lot 11, chantier C2, t196 ; branchée par les notes de frais, C5) :
// <input type="file" accept="image/*" capture="environment"> ouvre l'appareil photo natif sans getUserMedia, donc sans
// lever `camera=()` de la Permissions-Policy (server/src/securite.ts) ; à vérifier sur iOS et Android avant la mise en
// service. Les pièces n'acceptent que PDF, JPEG et PNG de 10 Mo au plus (shared/rules/pieces.ts) :
// - un JPEG ou un PNG de 10 Mo au plus garde son image telle quelle, mais perd ses métadonnées (`sansMetadonnees`) :
//   l'appareil photo d'Android y écrit la position GPS quand la localisation est activée, alors que Cursus n'en demande
//   jamais (Permissions-Policy geolocation=(), en attendant l'accord du CSE). JPEG : segments APP1 (EXIF, XMP), APP13
//   (IPTC) et commentaires retirés, seule l'orientation est réécrite dans un EXIF minimal (sinon un reçu photographié
//   en portrait s'afficherait couché) ; PNG : blocs eXIf, tEXt, zTXt et iTXt retirés. Les pixels ne changent pas ;
//   l'empreinte probante de la pièce est celle du fichier nettoyé, le seul envoyé ;
// - tout autre format (HEIC des iPhone, WebP), un fichier plus lourd ou un JPEG / PNG dont la structure ne se lit pas
//   est redessiné par un canvas en JPEG (sans aucune métadonnée), réduit à 1 600 px au plus de côté (qualité 0,85),
//   bien en dessous des 10 Mo.
// La conversion est injectée (`convertir`) : tests/client-pwa.test.ts essaie la règle sans navigateur.
import { TAILLE_MAX_PIECE } from '../../../shared/rules/pieces.ts';

/** Côté le plus long d'une photo convertie, en pixels, et qualité JPEG. */
export const COTE_MAX_PHOTO = 1600;
export const QUALITE_PHOTO = 0.85;

/** Attributs du champ de prise de vue (appareil photo arrière). */
export const CHAMP_PHOTO = { type: 'file', accept: 'image/*', capture: 'environment' } as const;

/** La photo peut partir telle quelle (JPEG ou PNG de 10 Mo au plus). */
export const photoTelleQuelle = (f: Pick<File, 'type' | 'size'>) => (f.type === 'image/jpeg' || f.type === 'image/png') && f.size <= TAILLE_MAX_PIECE;

/** Dimensions réduites pour que le côté le plus long tienne dans `max`. */
export function dimensionsReduites(l: number, h: number, max = COTE_MAX_PHOTO): { l: number; h: number } {
  const k = Math.min(1, max / Math.max(l, h, 1));
  return { l: Math.max(1, Math.round(l * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Conversion par canvas (navigateur) : image décodée, redessinée réduite, ré-encodée en JPEG. */
async function convertirCanvas(f: File): Promise<Blob> {
  const image = await createImageBitmap(f);
  const { l, h } = dimensionsReduites(image.width, image.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: l, height: h });
  canvas.getContext('2d')!.drawImage(image, 0, 0, l, h);
  image.close();
  return await new Promise<Blob>((ok, ko) => canvas.toBlob(b => b ? ok(b) : ko(new Error('Photo illisible : reprenez-la, ou choisissez un PDF.')), 'image/jpeg', QUALITE_PHOTO));
}

/** Orientation EXIF (1 à 8) lue dans les données d'un segment APP1 « Exif\0\0 », ou null. */
function orientationExif(d: Uint8Array): number | null {
  if (d.length < 14 || String.fromCharCode(...d.subarray(0, 4)) !== 'Exif' || d[4] !== 0 || d[5] !== 0) return null;
  const t = d.subarray(6);
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (i: number) => le ? t[i] | t[i + 1] << 8 : t[i] << 8 | t[i + 1];
  const u32 = (i: number) => (le ? t[i] | t[i + 1] << 8 | t[i + 2] << 16 | t[i + 3] << 24 : t[i] << 24 | t[i + 1] << 16 | t[i + 2] << 8 | t[i + 3]) >>> 0;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  for (let k = 0, n = u16(ifd); k < n; k++) {
    const e = ifd + 2 + 12 * k;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

/** Segment APP1 EXIF minimal (gros-boutiste) qui ne porte que l'orientation. */
function exifOrientation(v: number): Uint8Array {
  return Uint8Array.from([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
    0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0]);
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

/** JPEG sans APP1 (EXIF, XMP), APP13 ni commentaire, orientation gardée ; null si la structure ne se lit pas. */
function jpegSansMetadonnees(o: Uint8Array): { octets: Uint8Array; change: boolean } | null {
  if (o[0] !== 0xff || o[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [o.subarray(0, 2)];
  let change = false, orientation: number | null = null, i = 2, fin = false;
  while (i + 1 < o.length) {
    if (o[i] !== 0xff) return null;
    const m = o[i + 1];
    if (m === 0xff) { i++; continue; }
    // Début des données de l'image (SOS) ou fin : le reste est recopié tel quel.
    if (m === 0xda || m === 0xd9) { parts.push(o.subarray(i)); fin = true; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parts.push(o.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > o.length) return null;
    const l = o[i + 2] << 8 | o[i + 3];
    if (l < 2 || i + 2 + l > o.length) return null;
    const seg = o.subarray(i, i + 2 + l);
    if (m === 0xe1 || m === 0xed || m === 0xfe) {
      if (m === 0xe1) orientation ??= orientationExif(seg.subarray(4));
      change = true;
    } else {
      parts.push(seg);
    }
    i += 2 + l;
  }
  if (!fin) return null;
  if (!change) return { octets: o, change: false };
  // EXIF minimal après l'en-tête JFIF (APP0) s'il y en a un, sinon juste après le début du fichier.
  if (orientation && orientation !== 1) parts.splice(parts[1]?.[1] === 0xe0 ? 2 : 1, 0, exifOrientation(orientation));
  return { octets: concat(parts), change: true };
}

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Blocs PNG de métadonnées retirés (EXIF, textes). */
const BLOCS_RETIRES = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

/** PNG sans blocs eXIf ni textes ; null si la structure ne se lit pas. */
function pngSansMetadonnees(o: Uint8Array): { octets: Uint8Array; change: boolean } | null {
  if (o.length < 8 || SIGNATURE_PNG.some((b, k) => o[k] !== b)) return null;
  const parts: Uint8Array[] = [o.subarray(0, 8)];
  let change = false, i = 8;
  while (i + 12 <= o.length) {
    const l = (o[i] << 24 | o[i + 1] << 16 | o[i + 2] << 8 | o[i + 3]) >>> 0;
    const type = String.fromCharCode(...o.subarray(i + 4, i + 8));
    if (i + 12 + l > o.length) return null;
    if (BLOCS_RETIRES.has(type)) change = true;
    else parts.push(o.subarray(i, i + 12 + l));
    i += 12 + l;
    if (type === 'IEND') return change ? { octets: concat(parts), change } : { octets: o, change };
  }
  return null;
}

/**
 * Image JPEG ou PNG sans ses métadonnées (position GPS, appareil, date de prise de vue), pixels inchangés ; `change` :
 * quelque chose a été retiré. null si la structure ne se lit pas (la photo passe alors par le canvas).
 */
export function sansMetadonnees(o: Uint8Array, type: string): { octets: Uint8Array; change: boolean } | null {
  return type === 'image/jpeg' ? jpegSansMetadonnees(o) : type === 'image/png' ? pngSansMetadonnees(o) : null;
}

/** Photo prête à envoyer comme pièce justificative (même nom, extension .jpg après conversion). */
export async function preparerPhoto(f: File, convertir: (f: File) => Promise<Blob> = convertirCanvas): Promise<File> {
  if (photoTelleQuelle(f)) {
    const net = sansMetadonnees(new Uint8Array(await f.arrayBuffer()), f.type);
    if (net && !net.change) return f;
    if (net) return new File([net.octets as Uint8Array<ArrayBuffer>], f.name, { type: f.type, lastModified: f.lastModified });
  }
  const jpeg = await convertir(f);
  if (jpeg.size > TAILLE_MAX_PIECE) throw new Error('Photo trop lourde même réduite : reprenez-la de plus loin.');
  return new File([jpeg], `${f.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
}
