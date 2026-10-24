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
