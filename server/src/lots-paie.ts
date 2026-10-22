// Lots de paie (table `lotsPaie`) : lecture pour l'instantané (sans le contenu figé, que seul le téléchargement du
// fichier lit), format du fichier d'import (clé `formatFichierPaie` de la table settings, réglée par la paie depuis
// l'écran Temps : action `paie.formatFichier`). Règles du lot et du fichier : shared/rules/lots-paie.ts.
import { FORMAT_FICHIER_DEFAUT } from '../../shared/rules/lots-paie.ts';
import type { FormatFichierPaie, LotPaie, SagePush } from '../../shared/types.ts';
import type { Db } from './db.ts';

/** Lot tel qu'il est enregistré : avec le contenu figé (lignes de variables de paie), null pour un lot historique. */
export type LotEnregistre = LotPaie & { contenu: SagePush | null };

/** Lots de paie, du plus récent au plus ancien, sans leur contenu. */
export async function lireLots(db: Db): Promise<LotPaie[]> {
  return (await db.all<LotEnregistre>('lotsPaie')).reverse().map(({ contenu: _contenu, ...l }) => l);
}

/** Format du fichier d'import en vigueur : le réglage enregistré, complété par le format par défaut. */
export async function lireFormatFichier(db: Db): Promise<FormatFichierPaie> {
  return { ...FORMAT_FICHIER_DEFAUT, ...await db.getSetting<Partial<FormatFichierPaie>>('formatFichierPaie', {}) };
}
