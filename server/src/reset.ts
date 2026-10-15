// npm run reset-demo : recharge les données de démonstration.
// Efface toute la base : refusé hors mode démonstration (CURSUS_DEMO=1 npm run reset-demo).
import { existsSync } from 'node:fs';
import { demoActive } from './config.ts';
import { dbFile, openDb } from './db.ts';
import { controlerMigrations } from './migrations/cadre.ts';
import { sauvegarderBase } from './sauvegarde.ts';
import { seedDemo } from './seed.ts';

if (!demoActive()) {
  console.error('Réinitialisation refusée : elle efface toute la base et n’est permise qu’en mode démonstration (CURSUS_DEMO=1 npm run reset-demo).');
  process.exit(1);
}

const existait = existsSync(dbFile());
// Base mise à jour par une version plus récente de Cursus : refusée, comme au démarrage du serveur.
try {
  controlerMigrations(dbFile());
} catch (err) {
  console.error(`Réinitialisation refusée : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
const db = openDb();
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
