// Adaptateur Sage Paie : mode de transmission des variables de paie (SAGE_MODE).
// - simulation (démonstration, développement) : rien ne part ; les feuilles sont seulement marquées transmises ;
// - fichier (mode de production par défaut) : la paie génère un lot par période de paie, télécharge son fichier
//   d'import (server/src/fichier-paie.ts), l'importe dans Sage, puis confirme l'import, qui seul marque les feuilles
//   transmises (server/src/actions/paie.ts) ; rien ne part automatiquement.
// Pas d'envoi par API (décision du 15 octobre 2026 : la paie importe le fichier dans Sage) : SAGE_MODE=api est une valeur
// inconnue, refusée au démarrage en production (server/src/config.ts), et rien n'est jamais marqué transmis sans
// confirmation de l'import. La correspondance des rubriques avec le plan de paie se règle dans l'écran Temps
// (shared/rules/paie.ts), le format du fichier aussi (shared/rules/lots-paie.ts).
import type { SageMode, SagePush } from '../../../shared/types.ts';
import { demoActive, enProduction, type Env } from '../config.ts';

export const SAGE_MODES: readonly SageMode[] = ['simulation', 'fichier'];

/**
 * Mode en vigueur : SAGE_MODE s'il est valide ; sinon le fichier d'import en production (hors application de bureau en
 * démonstration), la simulation ailleurs. SAGE_URL ne fait rien basculer.
 */
export function sageMode(env: Env = process.env): SageMode {
  const v = (env.SAGE_MODE ?? '').trim();
  if ((SAGE_MODES as readonly string[]).includes(v)) return v as SageMode;
  return enProduction(env) && !demoActive(env) ? 'fichier' : 'simulation';
}

export const SAGE_DOSSIER = process.env.SAGE_DOSSIER || 'CURSUS-CHIMIE';

/** Transmission impossible dans ce mode : rien n'est marqué transmis (503). */
export class SageIndisponible extends Error {}

/**
 * Transmission en un clic. Simulation : renvoie une référence « SIM-… », sans rien envoyer. Mode fichier (le fichier
 * passe par la paie, qui confirme l'import) : SageIndisponible, sans jamais d'accusé fictif.
 */
export function pushToSage(payload: Pick<SagePush, 'periodes' | 'lignes'>, mode: SageMode = sageMode()): { reference: string } {
  if (mode !== 'simulation') {
    throw new SageIndisponible('Mode fichier d’import : rien n’est envoyé directement à Sage Paie. Générez le lot de la période (écran Temps), téléchargez son fichier et importez-le dans Sage, puis confirmez l’import : lui seul marque les feuilles transmises.');
  }
  return { reference: `SIM-${(payload.periodes ?? []).join('+') || 'vide'}-${payload.lignes.length}` };
}
