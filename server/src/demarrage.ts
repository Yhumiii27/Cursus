// Mise à jour de la base à l'ouverture, commune au serveur (server/src/index.ts) et aux outils qui y écrivent (npm run
// comptes, npm run reset-demo), selon le moteur :
// - SQLite : reprises historiques rejouées à chaque démarrage (server/src/migrate.ts), puis migrations nommées
//   (server/src/migrations/), qui écrivent du SQL propre à SQLite (json_each, json_array, sqlite_sequence) ;
// - PostgreSQL : le schéma part directement de l'état final (server/migrations-pg/, appliquées par openDb) ; restent les
//   amorçages de données qu'une base neuve reçoit des migrations nommées (activités internes, dont INT-AST des
//   interventions d'astreinte, horaires de poste d'exemple) et le rattachement des
//   fiches au référentiel des postes, rejoué à chaque démarrage comme en SQLite.
import { type Db, SqliteDb } from './db.ts';
import { migrate } from './migrate.ts';
import { appliquerMigrations } from './migrations/cadre.ts';
import { amorcerActiviteFormation } from './migrations/formations.ts';
import { amorcerHoraires } from './migrations/lot6-horaires.ts';
import { rattacherFiches } from './migrations/referentiels.ts';
import { amorcerActivites } from './migrations/temps.ts';
import { amorcerActiviteAstreinte } from './migrations/lot7-astreintes.ts';

/**
 * Reprises et migrations de la base ouverte. SQLite : une MigrationError d'une migration nommée interrompue est rendue
 * telle quelle (le serveur refuse de démarrer). PostgreSQL : amorçages d'une base neuve, rattachement des fiches.
 */
export async function mettreAJourBase(db: Db): Promise<void> {
  if (db instanceof SqliteDb) {
    await migrate(db);
    await appliquerMigrations(db);
    // Déclencheurs de révision reposés : une migration nommée a pu reconstruire une table (lot 8, chantier E).
    db.poserRevision();
    return;
  }
  if (db.neuve) {
    await db.tx(async () => {
      await amorcerActivites(db);
      await amorcerActiviteFormation(db);
      await amorcerHoraires(db);
      await amorcerActiviteAstreinte(db);
    });
  }
  await rattacherFiches(db);
}

/**
 * Préchauffage du cache de l'instantané (lot 9, chantier 2, étape 2), après les migrations et le chargement de la base,
 * au démarrage du serveur seulement (jamais pour les outils, qui n'appellent que `mettreAJourBase`, ni sous node --test) :
 * l'entrée de la révision courante est lue avant les premières requêtes, qui la trouvent prête ou attendent cette même
 * lecture, au lieu d'une rafale froide qui relirait toute la base. Non bloquant : un échec n'écrit qu'un avertissement
 * (la première requête relira). Rend vrai si l'entrée a été lue.
 */
export async function prechaufferCache(db: Db, avertir: (message: string) => void = console.warn): Promise<boolean> {
  if (process.env.NODE_TEST_CONTEXT) return false;
  // Chargés ici seulement : les outils qui importent ce fichier n'en ont pas besoin.
  const { prechauffer } = await import('./cache-instantane.ts');
  const { loadFull, todayIso } = await import('./dataset.ts');
  try {
    return await prechauffer(db, todayIso(), async lecteur => await loadFull(db, lecteur));
  } catch (err) {
    avertir(`Préchauffage du cache de l’instantané impossible : ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
