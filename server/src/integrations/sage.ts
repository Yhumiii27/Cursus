// Adaptateur Sage Paie : mode de transmission des variables de paie (SAGE_MODE).
// - simulation (démonstration, développement) : rien ne part ; les feuilles sont seulement marquées transmises ;
// - fichier (mode de production par défaut) : fichier d'import téléchargé par la paie, puis import confirmé dans Sage,
//   qui seul marque les feuilles transmises — génération du fichier livrée avec la prochaine étape, d'ici là refusée ;
// - api : aucun contrat d'API n'a été fourni par Sage. Refusé au démarrage en production (server/src/config.ts) et
//   refusé à la transmission : plus jamais d'accusé de réception fictif ni de feuille marquée transmise sans envoi.
// La correspondance des rubriques avec le plan de paie se règle dans l'écran Temps (shared/rules/paie.ts).
import type { SageMode, SagePush } from '../../../shared/types.ts';
import { demoActive, enProduction, type Env } from '../config.ts';

export const SAGE_MODES: readonly SageMode[] = ['simulation', 'fichier', 'api'];

/**
 * Mode en vigueur : SAGE_MODE s'il est valide ; sinon le fichier d'import en production (hors application de bureau en
 * démonstration), la simulation ailleurs. SAGE_URL ne fait plus basculer en mode API.
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
 * Remise des variables à Sage. Simulation : renvoie une référence « SIM-… », sans rien envoyer. Mode fichier (à venir)
 * et mode API (aucun connecteur) : SageIndisponible, sans jamais d'accusé fictif.
 */
export function pushToSage(payload: SagePush, mode: SageMode = sageMode()): { reference: string } {
  if (mode === 'api') {
    throw new SageIndisponible('Envoi à Sage Paie par API impossible : aucun contrat d’API n’a été fourni par Sage, rien n’est envoyé ni marqué transmis. Utilisez le mode fichier d’import (SAGE_MODE=fichier).');
  }
  if (mode === 'fichier') {
    throw new SageIndisponible('Mode fichier d’import : la génération du fichier pour Sage arrive avec la prochaine version de Cursus. Aucune feuille n’est marquée transmise ; d’ici là, les variables restent saisies dans Sage.');
  }
  return { reference: `SIM-${(payload.periodes ?? []).join('+') || 'vide'}-${payload.lignes.length}` };
}
