// Chemins de Cursus calculés depuis l'emplacement du code, et non depuis le dossier de lancement : lancé depuis un autre
// dossier (unité systemd sans WorkingDirectory, conteneur, application de bureau), le serveur sert la même interface et
// ouvre la même base, au lieu de servir l'API seule et de créer en silence une base vide.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Env } from './config.ts';

/** Racine du projet : server/src/ → ../.. */
export const RACINE = resolve(import.meta.dirname, '..', '..');

/**
 * Interface compilée par npm run build : dist/ du projet. CURSUS_DIST la remplace (tests automatiques, qui servent une
 * interface minimale sans compiler ; installation qui place l'interface ailleurs).
 */
export function dossierInterface(env: Env = process.env): string {
  return env.CURSUS_DIST ? resolve(env.CURSUS_DIST) : join(RACINE, 'dist');
}

/**
 * Fichier de la base, en chemin absolu : CURSUS_DB, sinon data/cursus.db du projet. Un CURSUS_DB relatif reste compté
 * depuis le dossier de lancement, comme avant : une installation qui en dépend n'est pas déplacée.
 */
export function fichierBase(env: Env = process.env): string {
  return env.CURSUS_DB ? resolve(env.CURSUS_DB) : join(RACINE, 'data', 'cursus.db');
}

/** Version de Cursus (package.json), donnée par le point de santé et au démarrage. */
export const VERSION: string = (() => {
  try {
    return String(JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version ?? 'inconnue');
  } catch {
    return 'inconnue';
  }
})();
