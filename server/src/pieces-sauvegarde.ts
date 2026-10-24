// Pièces justificatives dans les sauvegardes (t133) : chaque copie de la base (server/src/sauvegarde.ts) emporte les
// fichiers qu'elle désigne. Leur contenu ne change jamais une fois écrit (nom aléatoire, empreinte en base) : ils sont
// copiés une seule fois dans un dossier commun à toutes les copies de la base, `pieces-<base>/` du dossier des
// sauvegardes, que la copie externe (restic, docs/SAUVEGARDE.md) emporte avec elles. Seule exception, le chiffrement
// d'une pièce déposée en clair (npm run pieces:chiffrer, lot 8) réécrit son fichier sous le même nom : la copie en clair
// du dossier commun est alors remplacée par le fichier chiffré, par la commande elle-même (remplacerCopiesEnClair) et, à
// défaut, par la sauvegarde suivante (copierPieces compare les en-têtes). Aucune copie en clair n'y survit au chiffrement. Après la rotation, un fichier que plus aucune copie
// conservée ne désigne est retiré de ce dossier. La restauration remet dans le dossier des pièces ceux qui y manquent.
// Dépôt local seulement : les pièces confiées à la GED sont sauvegardées par la GED.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dossierPieces } from './chemins.ts';
import { NOM_LOCAL } from './pieces.ts';
import { fichierChiffre } from './pieces-chiffrement.ts';

/** Fichiers du dépôt local que désigne une base (lue en lecture seule) ; aucun pour une base sans pièces. */
export function fichiersDesignes(base: string): string[] {
  const sql = new DatabaseSync(base, { readOnly: true });
  try {
    if (!sql.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pieces'`).get()) return [];
    return (sql.prepare('SELECT fichier FROM pieces WHERE fichier IS NOT NULL').all() as { fichier: string }[]).map(r => r.fichier).filter(f => NOM_LOCAL.test(f));
  } finally {
    sql.close();
  }
}

/** Dossier des pièces d'une sauvegarde : `pieces-<nom de la base>` dans le dossier des copies. */
export const dossierMiroir = (dossierCopies: string, nomBase: string) => join(dossierCopies, `pieces-${nomBase}`);

export interface BilanPiecesSauvegarde {
  /** Pièces désignées par la copie. */
  designees: number;
  /** Fichiers copiés pour cette sauvegarde (les autres l'étaient déjà). */
  copiees: number;
  /** Fichiers désignés mais absents du dossier des pièces (signalés, la copie de la base reste valable). */
  manquantes: number;
  /** Fichiers retirés du dossier des sauvegardes après la rotation. */
  retirees: number;
}

/**
 * Copie dans le dossier commun les fichiers que désigne la copie `copie` de la base `source` (chemin réel), s'ils n'y sont
 * pas déjà ; null si la base ne désigne aucune pièce.
 */
export function copierPieces(copie: string, source: string, miroir: string): BilanPiecesSauvegarde | null {
  const noms = fichiersDesignes(copie);
  if (!noms.length) return null;
  const dossier = dossierPieces(source);
  mkdirSync(miroir, { recursive: true, mode: 0o700 });
  let copiees = 0, manquantes = 0;
  for (const nom of noms) {
    const cible = join(miroir, nom), origine = join(dossier, nom);
    if (!existsSync(origine)) { if (!existsSync(cible)) manquantes++; continue; }
    // Déjà copié : recopié seulement si le fichier a été chiffré depuis (copie en clair d'avant npm run pieces:chiffrer).
    if (existsSync(cible) && !(fichierChiffre(origine) && fichierChiffre(cible) === false)) continue;
    copierFichier(origine, cible);
    copiees++;
  }
  return { designees: noms.length, copiees, manquantes, retirees: 0 };
}

/** Copie sous un nom provisoire, puis renommée : le nom final n'apparaît que complet (et remplace l'ancien d'un coup). */
function copierFichier(origine: string, cible: string) {
  copyFileSync(origine, `${cible}.partiel`);
  chmodSync(`${cible}.partiel`, 0o600);
  renameSync(`${cible}.partiel`, cible);
}

/**
 * Après le chiffrement des fichiers `noms` du dossier des pièces `dossier` (npm run pieces:chiffrer) : remplace par le
 * fichier chiffré leur copie encore en clair dans chacun des dossiers communs `miroirs` (absents ignorés). Renvoie le
 * nombre de copies remplacées. Les instantanés déjà emportés par restic gardent la leur jusqu'à leur oubli.
 */
export function remplacerCopiesEnClair(dossier: string, noms: readonly string[], miroirs: readonly string[]): number {
  let n = 0;
  for (const miroir of miroirs) {
    for (const nom of noms) {
      const cible = join(miroir, nom), origine = join(dossier, nom);
      if (fichierChiffre(cible) !== false || !fichierChiffre(origine)) continue;
      copierFichier(origine, cible);
      n++;
    }
  }
  return n;
}

/** Retire du dossier commun les fichiers qu'aucune des copies conservées ne désigne plus ; renvoie leur nombre. */
export function elaguerPieces(miroir: string, copies: readonly string[]): number {
  if (!existsSync(miroir)) return 0;
  const gardes = new Set(copies.flatMap(c => { try { return fichiersDesignes(c); } catch { return []; } }));
  let n = 0;
  for (const nom of readdirSync(miroir)) {
    const f = nom.endsWith('.partiel') ? nom.slice(0, -'.partiel'.length) : nom;
    if (!NOM_LOCAL.test(f) || (gardes.has(f) && nom === f)) continue;
    rmSync(join(miroir, nom), { force: true });
    if (nom === f) n++;
  }
  return n;
}

export interface BilanRestaurationPieces { designees: number; restaurees: number; manquantes: number }

/**
 * Après la restauration de la base `base` (chemin réel) : remet dans son dossier des pièces les fichiers qu'elle désigne
 * et qui y manquent, pris dans le premier dossier commun qui les a (`miroirs`). Null si elle ne désigne aucune pièce.
 */
export function restaurerPieces(base: string, miroirs: readonly string[]): BilanRestaurationPieces | null {
  const noms = fichiersDesignes(base);
  if (!noms.length) return null;
  const dossier = dossierPieces(base);
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  let restaurees = 0, manquantes = 0;
  for (const nom of noms) {
    if (existsSync(join(dossier, nom))) continue;
    const source = miroirs.map(m => join(m, nom)).find(existsSync);
    if (!source) { manquantes++; continue; }
    copyFileSync(source, join(dossier, nom));
    chmodSync(join(dossier, nom), 0o600);
    restaurees++;
  }
  return { designees: noms.length, restaurees, manquantes };
}
