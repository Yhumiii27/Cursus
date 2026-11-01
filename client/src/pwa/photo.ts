// Photo d'un justificatif prise avec le téléphone (lot 11, chantier C2, t196 ; branchée par les notes de frais, C5) :
// <input type="file" accept="image/*" capture="environment"> ouvre l'appareil photo natif sans getUserMedia, donc sans
// lever `camera=()` de la Permissions-Policy (server/src/securite.ts) ; à vérifier sur iOS et Android avant la mise en
// service. Les pièces n'acceptent que PDF, JPEG et PNG de 10 Mo au plus (shared/rules/pieces.ts) :
// - un JPEG ou un PNG de 10 Mo au plus est gardé tel quel (empreinte de la pièce inchangée) ;
// - tout autre format (HEIC des iPhone, WebP) ou un fichier plus lourd est redessiné par un canvas en JPEG, réduit à
//   1 600 px au plus de côté (qualité 0,85), bien en dessous des 10 Mo.
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

/** Photo prête à envoyer comme pièce justificative (même nom, extension .jpg après conversion). */
export async function preparerPhoto(f: File, convertir: (f: File) => Promise<Blob> = convertirCanvas): Promise<File> {
  if (photoTelleQuelle(f)) return f;
  const jpeg = await convertir(f);
  if (jpeg.size > TAILLE_MAX_PIECE) throw new Error('Photo trop lourde même réduite : reprenez-la de plus loin.');
  return new File([jpeg], `${f.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
}
