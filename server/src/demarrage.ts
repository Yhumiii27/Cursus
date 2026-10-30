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

/**
 * Préchauffage complet au démarrage du serveur (lot 10, chantier A) : l'entrée (`prechaufferCache`), puis les vues des
 * comptes actifs en tâche de fond (server/src/prechauffage-vues.ts, CURSUS_PRECHAUFFAGE_VUES=0 pour le couper). Jamais
 * sous node --test ni pour les outils. Non bloquant : un échec n'écrit qu'un avertissement. Rend le bilan des vues, ou
 * null si rien n'a été préchauffé.
 */
export async function prechaufferDemarrage(
  db: Db, o: { compression: boolean; arrete?: () => boolean; avertir?: (message: string) => void; info?: (message: string) => void },
): Promise<import('./prechauffage-vues.ts').BilanPrechauffage | null> {
  if (process.env.NODE_TEST_CONTEXT) return null;
  const avertir = o.avertir ?? console.warn;
  if (!await prechaufferCache(db, avertir)) return null;
  const { prechaufferVues, prechauffageVuesActif } = await import('./prechauffage-vues.ts');
  if (!prechauffageVuesActif()) return null;
  const bilan = await prechaufferVues(db, { compression: o.compression, arrete: o.arrete, avertir });
  o.info?.(`Vues préchauffées : ${bilan.vues} (${bilan.corps} corps compressés) en ${(bilan.ms / 1000).toFixed(1)} s${bilan.interrompu ? ', interrompu' : ''}.`);
  return bilan;
}

/** Intervalle du contrôle du changement de jour (millisecondes). */
export const CONTROLE_JOUR_MS = 60_000;

/**
 * Préchauffage au changement de jour (lot 10, chantier A) : l'entrée du cache est propre à la date du jour, et la
 * première lecture d'un jour nouveau relisait toute la base puis calculait sa vue ; chaque minute, si la date du jour a
 * changé, l'entrée et les vues du nouveau jour sont préchauffées en tâche de fond (`prechaufferDemarrage`). Rend la
 * fonction d'arrêt du minuteur. Jamais sous node --test.
 */
export function prechaufferChaqueJour(
  db: Db, o: Parameters<typeof prechaufferDemarrage>[1] & { jour: () => string },
): () => void {
  if (process.env.NODE_TEST_CONTEXT) return () => {};
  let dernier = o.jour();
  let enCours = false;
  const minuteur = setInterval(() => {
    const jour = o.jour();
    if (jour === dernier || enCours) return;
    dernier = jour;
    enCours = true;
    void prechaufferDemarrage(db, o).catch(() => null).finally(() => { enCours = false; });
  }, CONTROLE_JOUR_MS);
  minuteur.unref();
  return () => clearInterval(minuteur);
}
