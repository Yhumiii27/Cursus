// Chiffrement des pièces justificatives déjà déposées (lot 8, chantier D, étape 2) : npm run pieces:chiffrer
// (server/src/pieces-chiffrer-cli.ts), une fois CURSUS_PIECES_KEY posée et Cursus redémarré avec elle. Chaque fichier du
// dépôt local encore en clair est vérifié (empreinte SHA-256 enregistrée à l'envoi), chiffré sous son nom
// (server/src/pieces-chiffrement.ts), écrit à côté puis renommé à sa place (jamais de fichier à moitié écrit), puis la
// pièce est notée chiffrée (`pieces.chiffree`). Une commande interrompue se relance sans dommage : un fichier déjà
// chiffré dont la pièce n'est pas encore notée l'est simplement (après contrôle de la clé). Le service peut rester en
// marche : la lecture se fie à l'en-tête du fichier, pas à la colonne.
// Jamais chiffré : un fichier dont l'empreinte ne correspond plus (altéré : la preuve est gardée telle quelle, signalée
// au contrôle d'intégrité), ni un fichier chiffré avec une autre clé. Les pièces de la GED n'ont pas de fichier local.
// Les copies de sauvegarde déjà faites gardent leur copie en clair jusqu'à leur rotation (docs/SAUVEGARDE.md).
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plural } from '../../shared/format.ts';
import { journaliser } from './comptes.ts';
import type { Db } from './db.ts';
import { DepotLocal, dossierPiecesDe, empreinte, NOM_LOCAL, type PieceEnregistree } from './pieces.ts';
import { chiffrerPiece, contenuEnClair, estChiffre, PieceIndechiffrable } from './pieces-chiffrement.ts';

export interface BilanChiffrement {
  /** Pièces du dépôt local dont le fichier est encore à chiffrer (ou à noter chiffré). */
  aChiffrer: number;
  /** Fichiers chiffrés par cette passe. */
  chiffrees: number;
  /** Fichiers déjà chiffrés (passe interrompue) : pièce seulement notée chiffrée. */
  notees: number;
  /** Fichiers absents du dossier des pièces (restauration à faire, contrôle d'intégrité). */
  absentes: number;
  /** Fichiers laissés tels quels : empreinte différente de celle de l'envoi, ou chiffrés avec une autre clé. */
  alterees: number;
}

/**
 * Chiffre avec `cle` les fichiers en clair des pièces de la base. `apercu` : rien n'est écrit, le bilan dit ce qui serait
 * fait. Tracé au journal (`piece.chiffrer`, nombres seulement) quand un fichier a été chiffré ou noté.
 */
export async function chiffrerPiecesExistantes(db: Db, cle: Buffer, o: { apercu?: boolean; auteur?: string } = {}): Promise<BilanChiffrement> {
  const depot = new DepotLocal(dossierPiecesDe(db), cle);
  const lignes = (await db.all<PieceEnregistree>('pieces')).filter(p => !p.chiffree && typeof p.fichier === 'string' && NOM_LOCAL.test(p.fichier));
  const b: BilanChiffrement = { aChiffrer: lignes.length, chiffrees: 0, notees: 0, absentes: 0, alterees: 0 };
  for (const p of lignes) {
    const fichier = p.fichier!;
    const stocke = depot.brut(fichier);
    if (!stocke) { b.absentes++; continue; }
    let clair: Buffer;
    try {
      clair = contenuEnClair(stocke, cle, fichier);
    } catch (err) {
      if (!(err instanceof PieceIndechiffrable)) throw err;
      b.alterees++;
      continue;
    }
    if (p.empreinte && empreinte(clair) !== p.empreinte) { b.alterees++; continue; }
    const deja = estChiffre(stocke);
    if (o.apercu) { if (deja) b.notees++; else b.chiffrees++; continue; }
    const chemin = join(depot.dossier, fichier);
    // Copie provisoire d'une passe interrompue : effacée (remplacée si le fichier reste à chiffrer).
    rmSync(`${chemin}.partiel`, { force: true });
    if (!deja) {
      writeFileSync(`${chemin}.partiel`, chiffrerPiece(clair, cle, fichier), { mode: 0o600, flag: 'wx' });
      renameSync(`${chemin}.partiel`, chemin);
    }
    await db.tx(async () => await db.update('pieces', p.id, { chiffree: true }));
    if (deja) b.notees++; else b.chiffrees++;
  }
  if (!o.apercu && b.chiffrees + b.notees) {
    await db.tx(async () => await journaliser(db, {
      actor: o.auteur ?? 'Cursus', role: null, action: 'piece.chiffrer',
      message: `Pièces justificatives chiffrées sur disque : ${bilanChiffrementTexte(b)}`,
      payload: { chiffrees: b.chiffrees, notees: b.notees, absentes: b.absentes, alterees: b.alterees },
    }));
  }
  return b;
}

/** Bilan lisible, pour la commande et le journal. */
export function bilanChiffrementTexte(b: BilanChiffrement): string {
  const parts = [
    b.chiffrees && plural(b.chiffrees, 'fichier chiffré', 'fichiers chiffrés'),
    b.notees && plural(b.notees, 'fichier déjà chiffré noté', 'fichiers déjà chiffrés notés'),
    b.absentes && plural(b.absentes, 'fichier absent', 'fichiers absents'),
    b.alterees && plural(b.alterees, 'fichier laissé tel quel (empreinte différente ou autre clé)', 'fichiers laissés tels quels (empreinte différente ou autre clé)'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'aucune pièce à chiffrer';
}

// — Contrôle complet des fichiers (npm run pieces:verifier) : après une restauration, ou avant d'activer le chiffrement —

export interface BilanVerification {
  /** Pièces du dépôt local qui désignent un fichier. */
  designees: number;
  /** Fichiers lus, déchiffrés au besoin, et dont l'empreinte est celle de l'envoi. */
  conformes: number;
  /** Parmi eux, fichiers encore en clair (à chiffrer par npm run pieces:chiffrer). */
  enClair: number;
  absentes: number;
  /** Empreinte différente de celle de l'envoi. */
  alterees: number;
  /** Fichiers chiffrés illisibles : clé absente ou différente, ou contenu chiffré altéré. */
  illisibles: number;
}

/**
 * Lit chaque fichier du dépôt local que désigne la base, le déchiffre avec `cle` s'il est chiffré et compare son empreinte
 * à celle de l'envoi ; rien n'est écrit. Le contrôle d'intégrité du serveur (server/src/integrite.ts) ne compare que les
 * tailles : celui-ci lit tous les contenus.
 */
export async function verifierPieces(db: Db, cle: Buffer | null): Promise<BilanVerification> {
  const depot = new DepotLocal(dossierPiecesDe(db), cle);
  const lignes = (await db.all<PieceEnregistree>('pieces')).filter(p => typeof p.fichier === 'string' && NOM_LOCAL.test(p.fichier));
  const b: BilanVerification = { designees: lignes.length, conformes: 0, enClair: 0, absentes: 0, alterees: 0, illisibles: 0 };
  for (const p of lignes) {
    const stocke = depot.brut(p.fichier!);
    if (!stocke) { b.absentes++; continue; }
    let clair: Buffer;
    try {
      clair = contenuEnClair(stocke, cle, p.fichier!);
    } catch (err) {
      if (!(err instanceof PieceIndechiffrable)) throw err;
      b.illisibles++;
      continue;
    }
    if (p.empreinte && empreinte(clair) !== p.empreinte) { b.alterees++; continue; }
    b.conformes++;
    if (!estChiffre(stocke)) b.enClair++;
  }
  return b;
}

/** Bilan lisible du contrôle complet. */
export function bilanVerificationTexte(b: BilanVerification): string {
  if (!b.designees) return 'aucune pièce dans le dossier local';
  return [
    `${plural(b.conformes, 'fichier conforme', 'fichiers conformes')} sur ${b.designees}${b.enClair ? ` (dont ${b.enClair} en clair)` : ''}`,
    b.absentes && plural(b.absentes, 'fichier absent', 'fichiers absents'),
    b.alterees && plural(b.alterees, 'fichier altéré (empreinte différente)', 'fichiers altérés (empreinte différente)'),
    b.illisibles && plural(b.illisibles, 'fichier chiffré illisible avec cette clé', 'fichiers chiffrés illisibles avec cette clé'),
  ].filter(Boolean).join(' · ');
}
