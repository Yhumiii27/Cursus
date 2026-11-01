// Notes de frais lues en base hors de l'instantané (lot 12, chantier C2, étape 1). L'instantané ne porte plus que les notes
// de la fenêtre de 13 mois après paiement (`FENETRES`, server/src/lecture-brute.ts ; shared/rules/frais-fenetre.ts) ; les
// règles qui ont besoin de l'historique le lisent ici, par des requêtes ciblées (index de la migration 0023) :
// - indemnités kilométriques : cumul ordonné de l'année du trajet (`lignesIkEnBase`) ; une note tardive de l'année N-1
//   (délai de soumission jusqu'à 24 mois) a besoin des trajets de janvier N-1, sortis de la fenêtre dès le mois de mars N ;
// - doublons d'une dépense : même salarié et même date (puis même montant et même commerçant), ou même justificatif ;
// - éléments de la famille « frais » d'un lot de paie : limites d'exonération des indemnités kilométriques, déductions
//   d'avance déjà transmises par des notes archivées ;
// - notes à exporter en comptabilité : toutes celles de la base, une note payée et jamais exportée ne disparaît pas.
// `avecHistorique` complète un instantané des lignes utiles à ces règles, sans jamais le modifier en place.
import type { Dataset, LigneFrais, NoteFrais } from '../../shared/types.ts';
import { STATUTS_EXPORTABLES } from '../../shared/rules/frais-export.ts';
import { lignesIkDeLAnnee } from '../../shared/rules/frais-km.ts';
import type { Db, SqlValeur } from './db.ts';
import { type PieceEnregistree, piecesDe } from './pieces.ts';

/** Identifiants passés au plus par requête `IN (…)`. */
const PAR_REQUETE = 500;

/** Identifiants rendus par `sql` (colonne `id`). */
async function ids(db: Db, sql: string, params: readonly SqlValeur[]): Promise<number[]> {
  return (await db.query<{ id: number }>(sql, params)).map(r => Number(r.id));
}

/** Identifiants de `sql … IN (…)`, la liste `liste` découpée en paquets de 500. */
async function idsParPaquets(db: Db, sql: (marques: string) => string, liste: readonly SqlValeur[], avant: readonly SqlValeur[] = []): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < liste.length; i += PAR_REQUETE) {
    const paquet = liste.slice(i, i + PAR_REQUETE);
    out.push(...await ids(db, sql(paquet.map(() => '?').join(', ')), [...avant, ...paquet]));
  }
  return out;
}

/** Lignes de `table` désignées par `cles`, décodées (`Db.lireLignes`) ; aucune pour une liste vide. */
const lire = async <T>(db: Db, table: 'notesFrais' | 'lignesFrais' | 'pieces', cles: Iterable<number>): Promise<T[]> => {
  const l = [...new Set(cles)];
  return l.length ? await db.lireLignes<T>(table, l.map(String)) : [];
};

/** Bornes AAAA-MM-JJ d'une année civile. */
const annee = (a: number): [string, string] => [`${a}-01-01`, `${a}-12-31`];

/**
 * Lignes kilométriques d'un salarié pour une année, toutes lues en base (archivées comprises), et leurs notes : de quoi
 * appliquer `lignesIkDeLAnnee`, `ikTransmises` et `indemnitesIkAnnee` sur le cumul exact de l'année.
 */
export async function lignesIkEnBase(db: Db, empId: number, a: number): Promise<{ lignes: LigneFrais[]; notes: NoteFrais[] }> {
  const lignes = await lire<LigneFrais>(db, 'lignesFrais', await ids(db, `SELECT id FROM lignes_frais WHERE emp_id = ? AND categorie = 'ik' AND date >= ? AND date <= ?`, [empId, ...annee(a)]));
  const notes = await lire<NoteFrais>(db, 'notesFrais', lignes.map(l => l.noteId));
  return { lignes, notes };
}

/** Lignes kilométriques en vigueur d'un salarié pour une année (`lignesIkDeLAnnee`), lues en base. */
export async function ikDeLAnneeEnBase(db: Db, empId: number, a: number): Promise<{ lignes: LigneFrais[]; notes: NoteFrais[] }> {
  const { lignes, notes } = await lignesIkEnBase(db, empId, a);
  return { lignes: lignesIkDeLAnnee(lignes, notes, empId, a), notes };
}

/** Salariés qui ont une indemnité kilométrique datée de l'année `a`, en base (publication d'un barème). */
export async function salariesIkDeLAnnee(db: Db, a: number): Promise<number[]> {
  const r = await db.query<{ emp_id: number }>(`SELECT DISTINCT emp_id FROM lignes_frais WHERE categorie = 'ik' AND date >= ? AND date <= ? ORDER BY emp_id`, annee(a));
  return r.map(x => Number(x.emp_id));
}

/** Dépense dont on cherche le contexte en base : salarié, date, catégorie (et identifiant, s'il existe). */
export type DepenseCherchee = Pick<LigneFrais, 'empId' | 'date' | 'categorie'> & { id?: number };

/**
 * Instantané `ds` complété des lignes de la base dont dépendent les règles des dépenses `lignes` (et de leurs notes et
 * justificatifs) : dépenses du même salarié à la même date (doublons), trajets kilométriques de la même année (cumul),
 * dépenses dont un justificatif porte la même empreinte qu'un justificatif de `lignes`. Rien à ajouter (cas courant :
 * tout est dans la fenêtre) : `ds` lui-même. Jamais modifié en place.
 */
export async function avecHistorique(db: Db, ds: Dataset, lignes: readonly DepenseCherchee[]): Promise<Dataset> {
  const deja = new Set((ds.lignesFrais ?? []).map(l => l.id));
  const cherchees = new Set<number>();
  const vus = new Set<string>();
  for (const l of lignes) {
    const cle = `${l.empId}|${l.date}`;
    if (!vus.has(cle)) {
      vus.add(cle);
      for (const id of await ids(db, 'SELECT id FROM lignes_frais WHERE emp_id = ? AND date = ?', [l.empId, l.date])) cherchees.add(id);
    }
    const ik = `${l.empId}|ik|${l.date.slice(0, 4)}`;
    if (l.categorie === 'ik' && !vus.has(ik)) {
      vus.add(ik);
      for (const id of await ids(db, `SELECT id FROM lignes_frais WHERE emp_id = ? AND categorie = 'ik' AND date >= ? AND date <= ?`, [l.empId, ...annee(Number(l.date.slice(0, 4)))])) cherchees.add(id);
    }
  }
  // Même justificatif (empreinte) : celui d'une dépense de `lignes`, porté par une dépense hors de la fenêtre.
  const lignesIds = new Set(lignes.flatMap(l => (l.id ? [l.id] : [])));
  const empreintes = [...new Set((ds.pieces ?? []).filter(p => (p.objet === 'ligneFrais' || p.objet === 'ligneFraisSante') && lignesIds.has(p.objetId) && !p.retireeLe && p.empreinte).map(p => p.empreinte!))];
  const piecesDeja = new Set((ds.pieces ?? []).map(p => p.id));
  const pieces = await lire<PieceEnregistree>(db, 'pieces', (await idsParPaquets(db, m => `SELECT id FROM pieces WHERE objet IN ('ligneFrais', 'ligneFraisSante') AND retiree_le IS NULL AND empreinte IN (${m})`, empreintes))
    .filter(id => !piecesDeja.has(id)));
  for (const p of pieces) if (p.objetId) cherchees.add(p.objetId);
  const extra = await lire<LigneFrais>(db, 'lignesFrais', [...cherchees].filter(id => !deja.has(id)));
  if (!extra.length && !pieces.length) return ds;
  const notesDeja = new Set((ds.notesFrais ?? []).map(n => n.id));
  const notes = await lire<NoteFrais>(db, 'notesFrais', extra.map(l => l.noteId).filter(id => !notesDeja.has(id)));
  return {
    ...ds,
    notesFrais: [...(ds.notesFrais ?? []), ...notes],
    lignesFrais: [...(ds.lignesFrais ?? []), ...extra],
    pieces: [...(ds.pieces ?? []), ...piecesDe(pieces)],
  };
}

/**
 * Instantané `ds` complété pour la famille « frais » d'un lot de paie (server/src/frais-paie.ts) : trajets kilométriques
 * de chaque année des notes contrôlées à rembourser (limites d'exonération sur le cumul exact), et notes déjà transmises
 * des salariés qui ont une avance (déductions d'avance des lots non annulés, imputées par séjour). `ds` lui-même si rien
 * ne manque.
 */
export async function avecHistoriquePaie(db: Db, ds: Dataset): Promise<Dataset> {
  const aRembourser = new Set((ds.notesFrais ?? []).filter(n => n.statut === 'controlee' && !n.lotId).map(n => n.id));
  const trajets = (ds.lignesFrais ?? []).filter(l => aRembourser.has(l.noteId) && l.categorie === 'ik');
  const complete = await avecHistorique(db, ds, trajets);
  const avances = [...new Set((ds.avancesFrais ?? []).map(a => a.empId))];
  const notesDeja = new Set((complete.notesFrais ?? []).map(n => n.id));
  const transmises = await lire<NoteFrais>(db, 'notesFrais', (await idsParPaquets(db, m => `SELECT id FROM notes_frais WHERE lot_id IS NOT NULL AND statut IN ('en_paiement', 'payee') AND emp_id IN (${m})`, avances))
    .filter(id => !notesDeja.has(id)));
  return transmises.length ? { ...complete, notesFrais: [...(complete.notesFrais ?? []), ...transmises] } : complete;
}

/**
 * Notes exportables lues en base (contrôlées, en paiement ou payées, archivées comprises) : l'export comptable
 * (server/src/actions/frais-exports.ts) n'en perd aucune, même payée depuis plus de 13 mois. Leurs dépenses se lisent
 * ensuite pour les seules notes à exporter (`lignesDesNotesEnBase`).
 */
export async function notesExportablesEnBase(db: Db): Promise<NoteFrais[]> {
  return await lire<NoteFrais>(db, 'notesFrais', await idsParPaquets(db, m => `SELECT id FROM notes_frais WHERE statut IN (${m})`, STATUTS_EXPORTABLES));
}

/** Dépenses des notes `notes`, lues en base. */
export async function lignesDesNotesEnBase(db: Db, notes: readonly number[]): Promise<LigneFrais[]> {
  return await lire<LigneFrais>(db, 'lignesFrais', await idsParPaquets(db, m => `SELECT id FROM lignes_frais WHERE note_id IN (${m})`, notes));
}

/** Justificatifs (en vigueur ou retirés) des dépenses `lignes`, lus en base. */
export async function piecesDesLignesEnBase(db: Db, lignes: readonly number[]): Promise<PieceEnregistree[]> {
  return await lire<PieceEnregistree>(db, 'pieces', await idsParPaquets(db, m => `SELECT id FROM pieces WHERE objet IN ('ligneFrais', 'ligneFraisSante') AND objet_id IN (${m})`, lignes));
}
