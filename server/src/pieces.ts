// Pièces justificatives (t133) : stockage, rattachement aux objets du dossier, description transmise au navigateur,
// contrôle d'intégrité et nettoyage. Routes d'envoi et de téléchargement : server/src/pieces-routes.ts ; copie avec les
// sauvegardes : server/src/pieces-sauvegarde.ts ; actions `piece.joindre` et `piece.retirer` : actions/pieces.ts.
// - Stockage (`DepotPieces`) : « local », fichiers sous un nom aléatoire dans le dossier des données (dossierPieces de
//   chemins.ts : /data/pieces dans l'image Docker), en 600 dans un dossier en 700 ; « ged », l'espace documentaire de
//   l'entreprise, par l'adaptateur de server/src/integrations/ged.ts, à écrire quand son interface sera connue. Le nom
//   stocké (`fichier`) désigne son dépôt : 32 caractères hexadécimaux en local, `ged:<référence>` dans la GED.
// - Une pièce est d'abord envoyée seule (en attente, objet vide), puis jointe par l'action qui crée ou décide l'objet
//   (absence, certification, délivrance, déclaration) ou par `piece.joindre`, sur présentation de son jeton : seul le
//   compte qui l'a envoyée le connaît. Une pièce restée en attente plus de 24 h est effacée.
// - Un fichier n'est jamais effacé dans la transaction d'une action (elle peut être annulée) : la pièce est marquée
//   retirée, et `nettoyerPieces` efface ensuite les fichiers des pièces retirées, après la validation.
// - Chiffrement au repos (lot 8, chantier D) : avec CURSUS_PIECES_KEY, le dépôt local chiffre chaque nouveau fichier
//   (AES-256-GCM, server/src/pieces-chiffrement.ts) et le déchiffre à la lecture ; `pieces.chiffree` le note. L'empreinte
//   et la taille enregistrées restent celles du contenu en clair. Obligatoire en production (refusPiecesLocales de
//   config.ts) ; les pièces d'avant restent lisibles, et npm run pieces:chiffrer les chiffre (server/src/pieces-chiffrer.ts).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { droitsRh } from '../../shared/constants.ts';
import { plural } from '../../shared/format.ts';
import { DELAI_PIECE_EN_ATTENTE_MS, voitPiece } from '../../shared/rules/pieces.ts';
import type { CurrentUser, ObjetPiece, Piece, StockagePieces } from '../../shared/types.ts';
import { dossierPieces, fichierBase } from './chemins.ts';
import { clePieces, refusPiecesLocales } from './config.ts';
import type { Db, TableName } from './db.ts';
import { DepotGed, estFichierGed } from './integrations/ged.ts';
import { log } from './logs.ts';
import { chiffrerPiece, contenuEnClair, fichierChiffre, SURCOUT_CHIFFREMENT } from './pieces-chiffrement.ts';

/** Ligne de la table `pieces`, telle qu'en base (le nom stocké et le jeton ne quittent jamais le serveur). */
export interface PieceEnregistree extends Omit<Piece, 'empId' | 'objet' | 'objetId'> {
  jeton: string | null;
  empId: number | null;
  objet: ObjetPiece | null;
  objetId: number | null;
  fichier: string | null;
  deposeCompteId: number | null;
  retireeMotif: string | null;
  /** Fichier chiffré au repos (lot 8) ; faux pour les pièces écrites avant, ou sans clé hors production. */
  chiffree?: boolean | null;
}

/** Stockage des contenus : le même contrat pour le dossier local et pour la GED. */
export interface DepotPieces {
  readonly mode: Exclude<StockagePieces, 'desactive'>;
  /** Les fichiers écrits sont chiffrés par Cursus (dépôt local avec CURSUS_PIECES_KEY) : noté dans `pieces.chiffree`. */
  readonly chiffre?: boolean;
  /** Enregistre le contenu, renvoie le nom stocké. */
  ecrire(octets: Buffer): Promise<string>;
  /** Contenu en clair, ou null s'il a disparu (PieceIndechiffrable : fichier chiffré illisible). */
  lire(fichier: string): Promise<Buffer | null>;
  supprimer(fichier: string): Promise<void>;
}

/** Nom d'un fichier du dépôt local : aléatoire, sans extension (le type est en base), jamais un chemin. */
export const NOM_LOCAL = /^[0-9a-f]{32}$/;

/**
 * Dépôt local : un fichier par pièce, écrit sous un nom provisoire puis renommé (jamais de fichier à moitié écrit) ;
 * chiffré avec la clé `cle` (CURSUS_PIECES_KEY), en clair sans elle.
 */
export class DepotLocal implements DepotPieces {
  readonly mode = 'local' as const;
  readonly dossier: string;
  readonly cle: Buffer | null;
  constructor(dossier: string, cle: Buffer | null = null) { this.dossier = dossier; this.cle = cle; }
  get chiffre() { return !!this.cle; }
  private chemin(fichier: string) {
    if (!NOM_LOCAL.test(fichier)) throw new Error(`Nom de pièce invalide : ${fichier}`);
    return join(this.dossier, fichier);
  }
  async ecrire(octets: Buffer): Promise<string> {
    mkdirSync(this.dossier, { recursive: true, mode: 0o700 });
    const fichier = randomBytes(16).toString('hex');
    const partiel = `${this.chemin(fichier)}.partiel`;
    // Créé en 600 d'emblée : justificatifs d'absence, passeports, jamais lisibles par un autre compte de la machine.
    writeFileSync(partiel, this.cle ? chiffrerPiece(octets, this.cle, fichier) : octets, { mode: 0o600, flag: 'wx' });
    renameSync(partiel, this.chemin(fichier));
    return fichier;
  }
  async lire(fichier: string): Promise<Buffer | null> {
    const stocke = this.brut(fichier);
    return stocke && contenuEnClair(stocke, this.cle, fichier);
  }
  /** Contenu stocké tel quel (chiffré ou non), ou null s'il a disparu. */
  brut(fichier: string): Buffer | null {
    try { return readFileSync(this.chemin(fichier)); } catch { return null; }
  }
  async supprimer(fichier: string): Promise<void> {
    rmSync(this.chemin(fichier), { force: true });
  }
  /** Noms des fichiers présents (les fichiers provisoires et étrangers sont ignorés). */
  lister(): string[] {
    return existsSync(this.dossier) ? readdirSync(this.dossier).filter(n => NOM_LOCAL.test(n)) : [];
  }
}

/** Dossier d'une base en mémoire (tests) : un dossier temporaire par base, sauf CURSUS_PIECES_DIR. */
const temporaires = new WeakMap<Db, string>();

/**
 * Dossier des pièces de la base ouverte : à côté de son fichier réel, ou CURSUS_PIECES_DIR. Serveur PostgreSQL (aucun
 * fichier de base) : celui qu'aurait la base SQLite de cette installation (`pieces/` à côté de CURSUS_DB, /data/pieces
 * dans le conteneur), à partager entre les instances.
 */
export function dossierPiecesDe(db: Db): string {
  const f = db.emplacement;
  if (f) return dossierPieces(realpathSync(f));
  if (process.env.CURSUS_PIECES_DIR) return dossierPieces('', process.env);
  if (db.moteur === 'pg') return dossierPieces(fichierBase());
  if (!temporaires.has(db)) temporaires.set(db, mkdtempSync(join(tmpdir(), 'cursus-pieces-')));
  return temporaires.get(db)!;
}

/** Dépôt local de la base, avec la clé de chiffrement de l'environnement (CURSUS_PIECES_KEY). */
export const depotLocal = (db: Db) => new DepotLocal(dossierPiecesDe(db), clePieces());

/** Réglage en vigueur (clé `app` de la table settings, comme loadSettings de dataset.ts). */
export const stockagePieces = async (db: Db): Promise<StockagePieces> => (await db.getSetting<{ piecesStockage?: StockagePieces }>('app', {})).piecesStockage ?? 'desactive';

/** Dépôt où écrire une nouvelle pièce, selon le réglage ; null si la fonction est désactivée. */
export async function depotEcriture(db: Db): Promise<DepotPieces | null> {
  const s = await stockagePieces(db);
  return s === 'local' ? depotLocal(db) : s === 'ged' ? new DepotGed() : null;
}

/** Dépôt qui garde un fichier déjà stocké : celui que désigne son nom, quel que soit le réglage du jour. */
export const depotDe = (db: Db, fichier: string): DepotPieces => (estFichierGed(fichier) ? new DepotGed() : depotLocal(db));

/**
 * Contenu d'une pièce, lu sans attendre (export des données personnelles) : dépôt local seulement ; une pièce de la GED se
 * lit dans la GED (null).
 */
export function contenuLocal(db: Db, fichier: string): Buffer | null {
  if (estFichierGed(fichier) || !NOM_LOCAL.test(fichier)) return null;
  const depot = depotLocal(db);
  const stocke = depot.brut(fichier);
  try {
    return stocke && contenuEnClair(stocke, depot.cle, fichier);
  } catch (err) {
    // Fichier chiffré illisible : l'export part sans son contenu, le contrôle se fait au téléchargement de la pièce.
    log.avertissement(`Pièce justificative : ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export const empreinte = (octets: Buffer) => createHash('sha256').update(octets).digest('hex');

// — Objets du dossier —

/** Table de chaque objet : la pièce y désigne une ligne par son identifiant (contrôle d'intégrité, server/src/integrite.ts). */
export const TABLE_OBJET: Record<ObjetPiece, TableName> = {
  absence: 'absences', certification: 'certifications', habTitre: 'habTitres', declaration: 'demandesCollab', voyage: 'voyages',
  // lot 11 — notes de frais
  ligneFrais: 'lignesFrais', ligneFraisSante: 'lignesFrais', vehiculePerso: 'vehiculesPerso',
};

/** Description transmise au navigateur : ni nom stocké, ni jeton, ni motif du retrait. */
function description(p: PieceEnregistree): Piece {
  return {
    id: p.id, empId: p.empId!, objet: p.objet!, objetId: p.objetId!, nom: p.nom, type: p.type, taille: p.taille, empreinte: p.empreinte,
    deposeLe: p.deposeLe, deposePar: p.deposePar, conserverJusquau: p.conserverJusquau ?? null, retireeLe: p.retireeLe ?? null, retireePar: p.retireePar ?? null,
  };
}

/** Pièces jointes à un objet (les pièces en attente, sans objet, n'en font pas partie), pour l'instantané complet. */
export async function lirePieces(db: Db): Promise<Piece[]> {
  return piecesDe(await db.all<PieceEnregistree>('pieces'));
}

/** Description des pièces jointes à un objet, tirée des lignes de la table (lecture brute de l'instantané, server/src/lecture-brute.ts). */
export function piecesDe(lignes: readonly PieceEnregistree[]): Piece[] {
  return lignes.filter(p => p.objet && p.objetId && p.empId).map(description);
}

/**
 * Pièces de l'instantané d'une personne (shared/rules/pieces.ts, `voitPiece`) : le service RH reçoit tout, retirées
 * comprises (historique), avec l'empreinte ; les autres ne reçoivent que les pièces en vigueur qu'ils peuvent ouvrir.
 * `equipe` : salariés de l'équipe d'un manager.
 */
export function piecesVisibles(pieces: readonly Piece[] | undefined, user: CurrentUser, equipe: ReadonlySet<number> = new Set()): Piece[] {
  if (droitsRh(user).includes('rh')) return [...(pieces ?? [])];
  return (pieces ?? []).filter(p => !p.retireeLe && voitPiece(user, p, id => equipe.has(id))).map(p => ({ ...p, empreinte: null }));
}

// — Nettoyage (tâche horaire, et après une action qui retire des pièces) —

export interface BilanNettoyage { enAttente: number; retirees: number; orphelins: number }

/**
 * Efface : les pièces restées en attente plus de 24 h (ligne et fichier), les fichiers des pièces retirées (le nom stocké
 * est alors vidé) et, dans le dossier local, les fichiers que plus aucune pièce ne désigne depuis plus de 24 h (envoi
 * interrompu, réinitialisation de la démonstration). Les sauvegardes gardent leur propre copie (pieces-sauvegarde.ts).
 */
export async function nettoyerPieces(db: Db, maintenant = Date.now()): Promise<BilanNettoyage> {
  const limite = new Date(maintenant - DELAI_PIECE_EN_ATTENTE_MS).toISOString();
  const attente = (await db.query('SELECT id, fichier FROM pieces WHERE objet IS NULL AND depose_le < ?', [limite])) as { id: number; fichier: string | null }[];
  if (attente.length) await db.tx(async () => { for (const p of attente) await db.remove('pieces', p.id); });
  const retirees = (await db.query('SELECT id, fichier FROM pieces WHERE retiree_le IS NOT NULL AND fichier IS NOT NULL')) as { id: number; fichier: string }[];
  for (const p of attente) {
    if (p.fichier) await depotDe(db, p.fichier).supprimer(p.fichier).catch(() => { /* fichier sans pièce, repris plus bas */ });
  }
  for (const p of retirees) {
    try { await depotDe(db, p.fichier).supprimer(p.fichier); } catch { continue; /* GED injoignable : nouvel essai à l'heure suivante */ }
    // Pièce de nouveau en vigueur entre-temps (restauration) : son nom stocké reste.
    await db.tx(async () => { if ((await db.get<PieceEnregistree>('pieces', p.id))?.retireeLe) await db.update('pieces', p.id, { fichier: null }); });
  }
  const local = depotLocal(db);
  const designes = new Set(((await db.query('SELECT fichier FROM pieces WHERE fichier IS NOT NULL')) as { fichier: string }[]).map(r => r.fichier));
  let orphelins = 0;
  for (const f of local.lister()) {
    if (designes.has(f)) continue;
    try {
      if (maintenant - statSync(join(local.dossier, f)).mtimeMs < DELAI_PIECE_EN_ATTENTE_MS) continue; // envoi peut-être en cours
      await local.supprimer(f);
      orphelins++;
    } catch { /* disparu entre-temps */ }
  }
  return { enAttente: attente.length, retirees: retirees.length, orphelins };
}

/** Nettoyage en tâche de fond : bilan dans les journaux du serveur s'il a effacé quelque chose. */
async function passer(db: Db) {
  try {
    const b = await nettoyerPieces(db);
    if (bilanTexte(b)) log.info(`Pièces justificatives : ${bilanTexte(b)}`);
  } catch (err) {
    log.erreur(`Pièces justificatives : ${err instanceof Error ? err.message : err}`);
  }
}

/** Nettoyage après la validation d'une action qui retire des pièces : jamais dans sa transaction (annulable). */
export function nettoyerBientot(db: Db) {
  setImmediate(async () => await passer(db));
}

/** Au démarrage puis toutes les heures (server/src/index.ts) ; renvoie la fonction d'arrêt. */
export async function demarrerPieces(db: Db): Promise<() => void> {
  // Pièces activées avant la règle du lot 8, sans clé en production : signalé au démarrage (les envois sont refusés).
  const refus = (await stockagePieces(db)) === 'local' ? refusPiecesLocales() : null;
  if (refus) log.avertissement(refus);
  await passer(db);
  const t = setInterval(async () => await passer(db), 3600_000);
  t.unref();
  return () => clearInterval(t);
}

// — Intégrité (server/src/integrite.ts) —

/**
 * Pièces du dépôt local dont le fichier manque ou n'a pas la taille enregistrée (lecture seule, sans lire les contenus :
 * l'empreinte est vérifiée à chaque téléchargement). Nombres seulement, sous des clés lisibles du contrôle d'intégrité.
 */
export async function controlerPieces(db: Db): Promise<Record<string, number>> {
  const lignes = (await db.query('SELECT fichier, taille FROM pieces WHERE fichier IS NOT NULL')) as { fichier: string; taille: number }[];
  const locales = lignes.filter(l => !estFichierGed(l.fichier));
  if (!locales.length) return {};
  const dossier = dossierPiecesDe(db);
  let absents = 0, tailles = 0;
  for (const l of locales) {
    try {
      // Fichier chiffré (lot 8) : la taille enregistrée est celle du clair, plus l'en-tête du chiffrement. L'en-tête du
      // fichier fait foi, pas la colonne `chiffree` : une base restaurée d'avant le chiffrement (colonne à faux) sur un
      // volume déjà chiffré, ou l'inverse, n'est pas une altération (npm run pieces:chiffrer remet la colonne d'accord).
      const chemin = join(dossier, l.fichier);
      const taille = statSync(chemin).size;
      if (taille !== Number(l.taille) + (fichierChiffre(chemin) ? SURCOUT_CHIFFREMENT : 0)) tailles++;
    } catch { absents++; }
  }
  return { ...(absents ? { 'pieces.fichier → dossier des pièces (absent)': absents } : {}), ...(tailles ? { 'pieces.fichier → dossier des pièces (taille différente)': tailles } : {}) };
}

/** Message d'un bilan de nettoyage, pour les journaux du serveur. */
export const bilanTexte = (b: BilanNettoyage) => [
  b.enAttente && plural(b.enAttente, 'pièce en attente effacée', 'pièces en attente effacées'),
  b.retirees && plural(b.retirees, 'fichier de pièce retirée effacé', 'fichiers de pièces retirées effacés'),
  b.orphelins && plural(b.orphelins, 'fichier sans pièce effacé', 'fichiers sans pièce effacés'),
].filter(Boolean).join(' · ');
