// Marqueurs d'usage de la base (lot 8, chantier A), contrat commun avec le chantier B (contrôle de la configuration de
// production) : deux lignes de la table settings, sans migration, et le code de journal de la purge.
// - `demo` : écrit par le chargement du jeu de démonstration (seedDemo, server/src/seed.ts), à chaque chargement : la
//   base contient des données fictives, que npm run purge-demo peut vider (server/src/purge-demo.ts).
// - `exploitation` : écrit une fois, au premier démarrage du serveur en production hors démonstration
//   (server/src/index.ts) : la base a servi en production, npm run purge-demo la refuse sans appel.
// - `purge.demo` : seule ligne du journal laissée par la purge (décompte par table, profil, copie préalable).
// Une base purgée ou exploitée n'accepte plus jamais le mode démonstration (`refusDemo`) : le serveur refuse d'y
// démarrer avec CURSUS_DEMO=1 (server/src/index.ts) et npm run reset-demo de la recharger (server/src/reset.ts).
import { demoActive, type Env, enProduction } from './config.ts';
import type { Db } from './db.ts';

/** Clé du réglage posé par le chargement de la démonstration. */
export const REGLAGE_DEMO = 'demo';
/** Clé du réglage posé au premier démarrage en production hors démonstration. */
export const REGLAGE_EXPLOITATION = 'exploitation';
/** Code de journal de la purge des données fictives (npm run purge-demo). */
export const ACTION_PURGE_DEMO = 'purge.demo';

/** Réglage `demo` : instant du dernier chargement du jeu et version de Cursus qui l'a chargé. */
export interface MarqueurDemo { chargeeLe: string; version: string }
/** Réglage `exploitation` : instant du premier démarrage hors démonstration en production et version de Cursus. */
export interface MarqueurExploitation { premierDemarrageHorsDemo: string; version: string }

export const marqueurDemo = (version: string, maintenant = new Date()): MarqueurDemo => ({ chargeeLe: maintenant.toISOString(), version });

/**
 * Le démarrage marque-t-il la base comme exploitée ? Seulement en production (NODE_ENV=production) hors démonstration :
 * ni en développement, ni pendant les tests, ni pour l'application de bureau ou la démonstration publiée, qui tournent
 * avec CURSUS_DEMO=1.
 */
export const exploitationAMarquer = (env: Env = process.env): boolean => enProduction(env) && !demoActive(env);

/**
 * Pose le réglage `exploitation` s'il manque et que le démarrage s'y prête (`exploitationAMarquer`), base vide comprise ;
 * la date du premier démarrage n'est jamais réécrite. Renvoie vrai quand le réglage vient d'être posé.
 */
export async function marquerExploitation(db: Db, version: string, env: Env = process.env, maintenant = new Date()): Promise<boolean> {
  if (!exploitationAMarquer(env)) return false;
  return await db.tx(async () => {
    if (await db.get('settings', REGLAGE_EXPLOITATION)) return false;
    const valeur: MarqueurExploitation = { premierDemarrageHorsDemo: maintenant.toISOString(), version };
    await db.insert('settings', { key: REGLAGE_EXPLOITATION, value: valeur });
    return true;
  });
}

/**
 * Raison de refuser le mode démonstration (CURSUS_DEMO=1) sur cette base, ou null : données fictives purgées (ligne
 * `purge.demo` du journal) ou base passée en exploitation (réglage `exploitation`). Le serveur y rechargerait sinon les
 * 24 salariés fictifs dès que la table des salariés est vide, serveur commun compris.
 */
export async function refusDemo(db: Db): Promise<string | null> {
  const purge = await db.one<{ at: string }>('SELECT at FROM journal WHERE action = ? ORDER BY id LIMIT 1', [ACTION_PURGE_DEMO]);
  const exploitation = await db.getSetting<MarqueurExploitation | null>(REGLAGE_EXPLOITATION, null);
  if (!purge && !exploitation) return null;
  const pourquoi = [
    ...(purge ? [`données de démonstration purgées le ${purge.at}`] : []),
    ...(exploitation ? [`en exploitation depuis le ${exploitation.premierDemarrageHorsDemo}`] : []),
  ];
  return `base de production (${pourquoi.join(', ')}) : le mode démonstration n’y est jamais admis. Retirez CURSUS_DEMO de l’environnement `
    + '(docs/DEPLOIEMENT.md, « Passage de la démonstration à la production »).';
}
