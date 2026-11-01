// Icônes de l'application installée (lot 11, chantier C2, t196) : PNG produits sans dépendance (encodeur PNG avec
// node:zlib), puis commités dans client/public/icons/. Même dessin que client/public/favicon.svg : carré arrondi de fond
// Nocturne cerclé de l'accent, coche de l'accent. Rejouer après un changement de dessin :
//   node scripts/icones.mjs              (écrit client/public/icons/)
//   node scripts/icones.mjs <dossier>    (écrit ailleurs : tests/pwa.test.ts compare au contenu commité)
// - icon-192.png, icon-512.png : « any », coins transparents ;
// - icon-512-maskable.png : « maskable », fond plein jusqu'aux bords, dessin dans la zone de sécurité (cercle de 80 %) ;
// - apple-touch-icon.png (180) : opaque (iOS remplit la transparence en noir et ignore le SVG pour l'écran d'accueil).
// Dessin anti-crénelé par suréchantillonnage (4 × 4 points par pixel) ; sortie identique d'une exécution à l'autre.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

/** Fond (--color-bg de Nocturne) et accent (trait de favicon.svg). */
const FOND = [0x16, 0x18, 0x26];
const ACCENT = [0x91, 0x84, 0xd9];

/** Coche de favicon.svg (repère 32 × 32) : trois points du trait, épaisseur 2,4. */
const COCHE = [[8, 16.6], [12.9, 21.1], [23.2, 11.2]];

/** Distance du point (x, y) au segment [a, b]. */
function distSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Point (x, y) dans le carré [x0, x1] de coins arrondis de rayon r. */
function dansCarreArrondi(x, y, x0, x1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, x0 + r), x1 - r);
  return x >= x0 && x <= x1 && y >= x0 && y <= x1 && Math.hypot(x - cx, y - cy) <= r;
}

/**
 * Couleur d'un point du dessin, en repère 32 × 32 (null : transparent). `plein` : fond jusqu'aux bords (maskable, Apple) ;
 * `echelle` : réduction du dessin autour du centre (zone de sécurité du maskable).
 */
function couleur(x, y, { plein, echelle }) {
  // Repère du dessin : centré, réduit.
  const u = 16 + (x - 16) / echelle, v = 16 + (y - 16) / echelle;
  if (distSegment(u, v, COCHE[0], COCHE[1]) <= 1.2 || distSegment(u, v, COCHE[1], COCHE[2]) <= 1.2) return ACCENT;
  // Cadre de favicon.svg : carré de 1 à 31, rayon 8, trait de 2 (de 0 à 2 de part et d'autre du bord, soit 0 à 32).
  const dehors = dansCarreArrondi(u, v, 0, 32, 9), dedans = dansCarreArrondi(u, v, 2, 30, 7);
  if (dehors && !dedans) return ACCENT;
  if (dedans || plein) return FOND;
  return null;
}

/** Pixels RGBA d'une icône de `taille` pixels, suréchantillonnée. */
function dessiner(taille, o) {
  const N = 4, px = new Uint8Array(taille * taille * 4);
  for (let j = 0; j < taille; j++) {
    for (let i = 0; i < taille; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < N; sj++) {
        for (let si = 0; si < N; si++) {
          const c = couleur(((i + (si + 0.5) / N) / taille) * 32, ((j + (sj + 0.5) / N) / taille) * 32, o);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const k = (j * taille + i) * 4;
      // Couleur moyenne des points couverts (non prémultipliée), opacité = part couverte.
      if (a) { px[k] = Math.round(r / a); px[k + 1] = Math.round(g / a); px[k + 2] = Math.round(b / a); }
      px[k + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return px;
}

/** Bloc PNG : longueur, type, données, CRC du type et des données. */
function bloc(type, donnees) {
  const t = Buffer.from(type, 'ascii'), longueur = Buffer.alloc(4), crc = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, donnees])));
  return Buffer.concat([longueur, t, donnees, crc]);
}

/** PNG RGBA 8 bits (ou RGB opaque quand `opaque`), lignes sans filtre, compressées par zlib. */
export function encoderPng(taille, rgba, opaque = false) {
  const canaux = opaque ? 3 : 4;
  const brut = Buffer.alloc(taille * (taille * canaux + 1));
  for (let j = 0; j < taille; j++) {
    const ligne = j * (taille * canaux + 1);
    brut[ligne] = 0; // filtre « aucun »
    for (let i = 0; i < taille; i++) {
      const k = (j * taille + i) * 4, o = ligne + 1 + i * canaux;
      for (let c = 0; c < canaux; c++) brut[o + c] = rgba[k + c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; // bits par canal
  ihdr[9] = opaque ? 2 : 6; // RGB ou RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0)),
  ]);
}

/** Icônes du manifeste et de l'écran d'accueil iOS : nom, taille, options du dessin. */
export const ICONES = [
  { nom: 'icon-192.png', taille: 192, plein: false, echelle: 1 },
  { nom: 'icon-512.png', taille: 512, plein: false, echelle: 1 },
  // Zone de sécurité du masque : cercle de 80 % du côté ; le cadre arrondi (diagonale ≈ 1,3 × le côté) y tient à 0,6.
  { nom: 'icon-512-maskable.png', taille: 512, plein: true, echelle: 0.6 },
  { nom: 'apple-touch-icon.png', taille: 180, plein: true, echelle: 0.82 },
];

/** Écrit les icônes dans `dossier`. */
export function ecrireIcones(dossier) {
  mkdirSync(dossier, { recursive: true });
  for (const i of ICONES) writeFileSync(join(dossier, i.nom), encoderPng(i.taille, dessiner(i.taille, i), i.plein));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dossier = process.argv[2] ?? fileURLToPath(new URL('../client/public/icons/', import.meta.url));
  ecrireIcones(dossier);
  console.log(`Icônes écrites dans ${dossier} : ${ICONES.map(i => i.nom).join(', ')}`);
}
