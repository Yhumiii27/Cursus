// npm run reset-demo : recharge les données de démonstration.
import { existsSync } from 'node:fs';
import { dbFile, openDb } from './db.ts';
import { sauvegarderBase } from './sauvegarde.ts';
import { seedDemo } from './seed.ts';

const existait = existsSync(dbFile());
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
