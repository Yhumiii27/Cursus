// Sceaux des justificatifs de frais (lot 11, chantier C5) : à la soumission d'une note, chaque justificatif joint à ses
// lignes est scellé dans une chaîne d'empreintes interne (table `sceauxPieces`, hors de la révision et de l'instantané) :
// sceau = SHA-256(sceau précédent | identifiant de la pièce | empreinte SHA-256 de son contenu | heure). La pièce devient
// immuable : elle ne se retire plus (server/src/frais-pieces.ts). Toute altération d'un maillon (empreinte réécrite, ligne
// retirée ou insérée) casse la chaîne à partir de lui (`verifierSceaux`). Ce n'est ni un horodatage qualifié ni un cachet
// électronique (service externe) : sans eux, le papier reste conservé (choix par défaut du lot 11, à trancher avec
// l'expert-comptable) ; l'archivage probant peut ensuite passer par Codex (demande).
import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import type { PieceEnregistree } from './pieces.ts';

/** Sceau de départ de la chaîne (aucun maillon avant le premier). */
export const SCEAU_ORIGINE = '0'.repeat(64);

export interface SceauPiece { id: number; pieceId: number; empreinte: string; precedent: string; sceau: string; le: string }

/** Sceau d'un maillon : empreinte du sceau précédent, de la pièce, de son contenu et de l'heure. */
export const calculerSceau = (precedent: string, pieceId: number, empreinte: string, le: string) =>
  createHash('sha256').update(`${precedent}|${pieceId}|${empreinte}|${le}`).digest('hex');

/** Dernier sceau de la chaîne (origine si elle est vide). */
async function dernierSceau(db: Db): Promise<string> {
  return (await db.one<{ sceau: string }>('SELECT sceau FROM sceaux_pieces ORDER BY id DESC LIMIT 1'))?.sceau ?? SCEAU_ORIGINE;
}

/**
 * Scelle les pièces données (dans la transaction de la soumission ; sous le verrou d'écriture, la chaîne n'a qu'un
 * dernier maillon). Une pièce déjà scellée ne l'est pas deux fois ; une pièce sans empreinte (retirée) est ignorée.
 * Renvoie le nombre de pièces scellées.
 */
export async function scellerPieces(db: Db, pieceIds: readonly number[], le = new Date().toISOString()): Promise<number> {
  let precedent = await dernierSceau(db), n = 0;
  for (const id of [...new Set(pieceIds)].sort((a, b) => a - b)) {
    if (await db.one('SELECT id FROM sceaux_pieces WHERE piece_id = ?', [id])) continue;
    const p = await db.get<PieceEnregistree>('pieces', id);
    if (!p?.empreinte || p.retireeLe) continue;
    const sceau = calculerSceau(precedent, id, p.empreinte, le);
    await db.insert('sceauxPieces', { pieceId: id, empreinte: p.empreinte, precedent, sceau, le });
    precedent = sceau;
    n++;
  }
  return n;
}

/** Pièce scellée ? (Immuable : ni retrait, ni remplacement.) */
export async function pieceScellee(db: Db, pieceId: number): Promise<boolean> {
  return !!(await db.one('SELECT id FROM sceaux_pieces WHERE piece_id = ?', [pieceId]));
}

/**
 * Vérifie la chaîne : chaque maillon part du sceau du précédent, son sceau se recalcule, et l'empreinte scellée est encore
 * celle de la pièce en base. Renvoie les maillons rompus (identifiants), vide si la chaîne est intacte.
 */
export async function verifierSceaux(db: Db): Promise<number[]> {
  const rompus: number[] = [];
  let precedent = SCEAU_ORIGINE;
  for (const s of await db.all<SceauPiece>('sceauxPieces')) {
    const p = await db.get<PieceEnregistree>('pieces', s.pieceId);
    if (s.precedent !== precedent || calculerSceau(s.precedent, s.pieceId, s.empreinte, s.le) !== s.sceau || p?.empreinte !== s.empreinte) rompus.push(s.id);
    precedent = s.sceau;
  }
  return rompus;
}
