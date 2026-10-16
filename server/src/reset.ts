// npm run reset-demo : recharge les données de démonstration.
// Efface toute la base : refusé hors mode démonstration (CURSUS_DEMO=1 npm run reset-demo).
import { existsSync } from 'node:fs';
import { demoActive } from './config.ts';
import { type Db, dbFile, openDb } from './db.ts';
import { migrate } from './migrate.ts';
import { appliquerMigrations, controlerPourOutil } from './migrations/cadre.ts';
import { SauvegardeError, sauvegarderBase } from './sauvegarde.ts';
import { seedDemo } from './seed.ts';

function refuser(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err instanceof SauvegardeError ? `Sauvegarde préalable impossible : réinitialisation annulée. ${message}` : `Réinitialisation refusée : ${message}`);
  process.exit(1);
}

if (!demoActive()) refuser('elle efface toute la base et n’est permise qu’en mode démonstration (CURSUS_DEMO=1 npm run reset-demo).');

const existait = existsSync(dbFile());
// Base mise à jour par une version plus récente de Cursus, ou pas encore par le serveur en service : refusée.
let aMettreAJour = true;
try {
  aMettreAJour = controlerPourOutil(dbFile());
} catch (err) {
  refuser(err);
}
let db: Db;
try {
  db = openDb();
  // Service arrêté : base mise à jour comme au démarrage du serveur (reprises, migrations nommées) avant d'être
  // rechargée. Les données de démonstration sont écrites dans le schéma final : aucune migration ne passe ensuite
  // dessus (une colonne renommée serait sinon remplie depuis l'ancienne, vide pour elles).
  if (aMettreAJour) {
    migrate(db);
    appliquerMigrations(db);
  }
} catch (err) {
  refuser(err);
}
// Une base existante est d'abord copiée ; sans copie, rien n'est effacé.
if (existait) {
  try {
    const copie = sauvegarderBase(db, 'avant-reinitialisation');
    if (copie) console.log(`Base actuelle sauvegardée : ${copie.fichier}`);
  } catch (err) {
    console.error(`Sauvegarde préalable impossible : réinitialisation annulée. ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
seedDemo(db);
console.log(`Données de démonstration rechargées (${db.count('employes')} collaborateurs).`);
