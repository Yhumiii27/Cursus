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
  // Colonne `contenu` jamais lue ici (lot 8, chantier E) : 70 à 90 lots de 50 à 300 Ko chacun après 5 ans.
  return (await db.allSans<LotPaie>('lotsPaie', ['contenu'])).reverse();
}

/** Format du fichier d'import en vigueur : le réglage enregistré, complété par le format par défaut. */
export async function lireFormatFichier(db: Db): Promise<FormatFichierPaie> {
  return formatFichierDe(await db.getSetting<Partial<FormatFichierPaie>>('formatFichierPaie', {}));
}

/** Format du fichier d'import tiré du réglage enregistré (lecture brute de l'instantané, server/src/lecture-brute.ts). */
export function formatFichierDe(reglage: Partial<FormatFichierPaie>): FormatFichierPaie {
  return { ...FORMAT_FICHIER_DEFAUT, ...reglage };
}
