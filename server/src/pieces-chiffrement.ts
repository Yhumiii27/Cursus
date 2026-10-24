// Chiffrement au repos des pièces justificatives du dépôt local (lot 8, chantier D, constat D6) : AES-256-GCM, clé
// CURSUS_PIECES_KEY lue dans l'environnement (clePieces de server/src/config.ts), jamais en base ni dans les sauvegardes
// de la base. Les justificatifs d'absence, carnets de vaccination et copies de passeport ne sont ainsi plus lisibles sur
// le volume des données (disque de l'hôte, copie du volume, outil de sauvegarde qui ne chiffre pas).
// - Format d'un fichier chiffré : en-tête « CURSUSP1 » (8 octets), vecteur d'initialisation aléatoire (12 octets),
//   étiquette d'authentification (16 octets), puis le contenu chiffré. Le nom stocké du fichier (aléatoire, en base) est
//   authentifié avec lui : un fichier déplacé sous le nom d'une autre pièce est refusé comme un fichier altéré.
// - L'empreinte SHA-256 enregistrée en base reste celle du contenu en clair : elle est vérifiée après le déchiffrement
//   (téléchargement), et la taille enregistrée reste celle du clair (le fichier chiffré a SURCOUT_CHIFFREMENT octets de
//   plus, contrôle d'intégrité de server/src/pieces.ts).
// - Une pièce écrite avant le chiffrement reste lisible (aucun en-tête : contenu servi tel quel) ; la colonne
//   `pieces.chiffree` dit si son fichier est chiffré, la commande npm run pieces:chiffrer chiffre les anciennes
//   (server/src/pieces-chiffrer.ts). La lecture se fie à l'en-tête plutôt qu'à la colonne : une commande interrompue
//   entre le remplacement du fichier et l'écriture de la colonne ne rend aucune pièce illisible. Un PDF, un JPEG ou un
//   PNG (types reconnus sur leur signature à l'envoi) ne commence jamais par cet en-tête.
// - Les copies de sauvegarde (server/src/pieces-sauvegarde.ts, restic du volume) emportent les fichiers chiffrés tels
//   quels : la clé est à conserver à part, comme le mot de passe de restic (docs/SAUVEGARDE.md). Clé perdue : pièces
//   chiffrées perdues.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';

/** En-tête d'un fichier chiffré (version 1 du format). */
export const ENTETE_CHIFFRE = Buffer.from('CURSUSP1', 'latin1');
const IV = 12;
const ETIQUETTE = 16;
/** Octets ajoutés par le chiffrement : en-tête, vecteur d'initialisation, étiquette. */
export const SURCOUT_CHIFFREMENT = ENTETE_CHIFFRE.length + IV + ETIQUETTE;

/** Fichier chiffré illisible : clé absente, autre clé, contenu ou nom altéré. Message sans le nom stocké ni la clé. */
export class PieceIndechiffrable extends Error {}

/** Le contenu stocké est-il un fichier chiffré (en-tête du format) ? */
export const estChiffre = (contenu: Buffer) => contenu.length >= SURCOUT_CHIFFREMENT && contenu.subarray(0, ENTETE_CHIFFRE.length).equals(ENTETE_CHIFFRE);

/**
 * Le fichier `chemin` est-il chiffré ? Seul l'en-tête est lu (contrôle d'intégrité horaire, copies de sauvegarde) ;
 * null s'il est absent ou illisible.
 */
export function fichierChiffre(chemin: string): boolean | null {
  let fd: number;
  try { fd = openSync(chemin, 'r'); } catch { return null; }
  try {
    const debut = Buffer.alloc(SURCOUT_CHIFFREMENT);
    return estChiffre(debut.subarray(0, readSync(fd, debut, 0, SURCOUT_CHIFFREMENT, 0)));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** Données authentifiées avec le contenu : l'en-tête et le nom stocké du fichier. */
const authentifie = (fichier: string) => Buffer.concat([ENTETE_CHIFFRE, Buffer.from(fichier, 'utf8')]);

/** Contenu chiffré d'une pièce, à écrire sous le nom stocké `fichier`. */
export function chiffrerPiece(clair: Buffer, cle: Buffer, fichier: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', cle, iv);
  c.setAAD(authentifie(fichier));
  const chiffre = Buffer.concat([c.update(clair), c.final()]);
  return Buffer.concat([ENTETE_CHIFFRE, iv, c.getAuthTag(), chiffre]);
}

/**
 * Contenu en clair d'un fichier stocké sous le nom `fichier` : déchiffré s'il porte l'en-tête, tel quel sinon (pièce
 * écrite avant le chiffrement). PieceIndechiffrable si le fichier est chiffré et que la clé manque ou ne convient pas.
 */
export function contenuEnClair(stocke: Buffer, cle: Buffer | null, fichier: string): Buffer {
  if (!estChiffre(stocke)) return stocke;
  if (!cle) throw new PieceIndechiffrable('fichier chiffré, mais CURSUS_PIECES_KEY est absente de l’environnement du serveur');
  const debut = ENTETE_CHIFFRE.length;
  try {
    const d = createDecipheriv('aes-256-gcm', cle, stocke.subarray(debut, debut + IV));
    d.setAAD(authentifie(fichier));
    d.setAuthTag(stocke.subarray(debut + IV, SURCOUT_CHIFFREMENT));
    return Buffer.concat([d.update(stocke.subarray(SURCOUT_CHIFFREMENT)), d.final()]);
  } catch {
    throw new PieceIndechiffrable('fichier chiffré illisible avec la clé CURSUS_PIECES_KEY actuelle (autre clé, ou fichier altéré)');
  }
}
