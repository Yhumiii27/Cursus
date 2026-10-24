// Fraîcheur de la sauvegarde du serveur PostgreSQL commun (lot 8, chantier B) : Cursus ne sauvegarde pas lui-même le
// schéma cursus du serveur commun, c'est la tâche planifiée de Matrix (sauvegarder.sh, pg_dump par schéma) qui le fait.
// Pour que Cursus sache si elle a tourné, cette tâche écrit après chaque sauvegarde réussie un fichier témoin, que
// Cursus lit par CURSUS_SAUVEGARDE_TEMOIN (chemin absolu, volume monté en lecture seule dans le conteneur) :
// - date de la sauvegarde : la première ligne du fichier si c'est une date ISO 8601 (2026-10-24T02:15:00Z), sinon la
//   date de modification du fichier ;
// - plus de 26 heures (une sauvegarde par nuit et une marge de 2 heures) : sauvegarde en retard.
// Lu par le point de santé (état « degrade », server/src/supervision.ts) et par le pré-vol (npm run verifier-production).
// Sans la variable, rien n'est lu : le pré-vol rappelle seulement l'étape manuelle de la procédure
// (docs/BASCULE-PRODUCTION.md). Demande à Matrix pour l'écriture du témoin : même document, « Demandes aux autres outils ».
import { readFileSync, statSync } from 'node:fs';

/** Âge maximal de la dernière sauvegarde, en heures. */
export const SAUVEGARDE_MAX_HEURES = 26;
/** Avance tolérée d'une date de témoin sur l'horloge de Cursus (horloges des deux machines légèrement décalées). */
const AVANCE_TOLEREE_MS = 3600_000;

export type Temoin =
  | { chemin: string; le: string; heures: number; enRetard: boolean }
  | { chemin: string; erreur: string };

/** Date de la première ligne si elle est une date ISO 8601 complète (jour et heure), sinon null. */
function dateLue(texte: string): number | null {
  const ligne = texte.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ligne)) return null;
  const t = Date.parse(ligne);
  return Number.isNaN(t) ? null : t;
}

/** Témoin de la dernière sauvegarde, null sans CURSUS_SAUVEGARDE_TEMOIN. Ne lève jamais : un fichier illisible est un constat. */
export function lireTemoin(env: Record<string, string | undefined> = process.env, maintenant = Date.now()): Temoin | null {
  const chemin = (env.CURSUS_SAUVEGARDE_TEMOIN ?? '').trim();
  if (!chemin) return null;
  let t: number;
  try {
    const st = statSync(chemin);
    if (!st.isFile()) return { chemin, erreur: 'ce n’est pas un fichier' };
    // 1 Ko lus au plus : le témoin ne porte qu'une date.
    t = dateLue(readFileSync(chemin, 'utf8').slice(0, 1024)) ?? st.mtimeMs;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { chemin, erreur: code === 'ENOENT' ? 'fichier absent' : code === 'EACCES' ? 'lecture refusée' : 'fichier illisible' };
  }
  if (t - maintenant > AVANCE_TOLEREE_MS) return { chemin, erreur: `date du témoin dans le futur (${new Date(t).toISOString()})` };
  const heures = Math.max(0, Math.floor((maintenant - t) / 3600_000));
  return { chemin, le: new Date(t).toISOString(), heures, enRetard: maintenant - t > SAUVEGARDE_MAX_HEURES * 3600_000 };
}
