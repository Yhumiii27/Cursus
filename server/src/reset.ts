// npm run reset-demo -- --yes [--force] : recharge les données de démonstration.
// Efface toute la base : refusé hors mode démonstration (CURSUS_DEMO=1) et en production (sauf l'application de
// bureau), refusé si un serveur en service utilise la base (sauf --force), et confirmé par --yes ou, dans un terminal,
// par le mot EFFACER (server/src/reinitialisation.ts). La base existante est copiée avant d'être effacée. Une base de
// production (purgée par npm run purge-demo, ou exploitée : server/src/marqueurs.ts) est refusée.
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dbFile, openSqlite, type SqliteDb, urlPostgres } from './db.ts';
import { refusDemo } from './marqueurs.ts';
import { migrate } from './migrate.ts';
import { appliquerMigrations, controlerPourOutil } from './migrations/cadre.ts';
import {
  confirmationTapee, controlerMode, controlerServeur, lireOptions, MOT_CONFIRMATION, type OptionsReinitialisation, ReinitialisationRefusee,
} from './reinitialisation.ts';
import { SauvegardeError, sauvegarderBase, serveurActif } from './sauvegarde.ts';
import { seedDemo } from './seed.ts';

function refuser(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err instanceof SauvegardeError ? `Sauvegarde préalable impossible : réinitialisation annulée. ${message}` : `Réinitialisation refusée : ${message}`);
  process.exit(1);
}

let options: OptionsReinitialisation;
try {
  options = lireOptions(process.argv.slice(2));
  controlerMode(process.env);
  // Serveur commun : schéma partagé, jamais effacé par un outil (la démonstration s'y charge une fois, au premier
  // démarrage avec CURSUS_DEMO=1 sur un schéma vide).
  if (urlPostgres()) throw new ReinitialisationRefusee('la base est sur le serveur PostgreSQL commun (DATABASE_URL) : npm run reset-demo ne réinitialise que le fichier SQLite de repli (DATABASE_URL= npm run reset-demo -- --yes).');
} catch (err) {
  refuser(err);
}

const fichier = dbFile();
const existait = existsSync(fichier);
// Base mise à jour par une version plus récente de Cursus, ou pas encore par le serveur en service : refusée. Serveur en
// service sur une base à jour : refusé sans --force.
let aMettreAJour = true;
try {
  aMettreAJour = controlerPourOutil(fichier);
  controlerServeur(serveurActif(fichier), options);
} catch (err) {
  refuser(err);
}

// Confirmation : --yes, ou le mot tapé dans un terminal ; sans terminal (script, tâche planifiée) et sans --yes, refus.
if (!options.oui) {
  if (!process.stdin.isTTY) refuser(new ReinitialisationRefusee(`elle efface toute la base ${fichier} : ajoutez --yes pour confirmer (npm run reset-demo -- --yes).`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = await rl.question(`Toute la base ${fichier} va être effacée (une copie est faite avant). Tapez ${MOT_CONFIRMATION} pour confirmer : `);
  rl.close();
  if (!confirmationTapee(reponse)) refuser(new ReinitialisationRefusee('confirmation non donnée, rien n’a été effacé.'));
}
if (options.force && serveurActif(fichier)) console.error('Attention : le serveur Cursus en service utilise encore cette base. Redémarrez-le une fois la réinitialisation faite.');

let db: SqliteDb;
try {
  db = await openSqlite();
  // Service arrêté : base mise à jour comme au démarrage du serveur (reprises, migrations nommées) avant d'être
  // rechargée. Les données de démonstration sont écrites dans le schéma final : aucune migration ne passe ensuite
  // dessus (une colonne renommée serait sinon remplie depuis l'ancienne, vide pour elles).
  if (aMettreAJour) {
    await migrate(db);
    await appliquerMigrations(db);
  }
  // Base de production (données fictives purgées par npm run purge-demo, ou base exploitée) : jamais rechargée.
  const refus = await refusDemo(db);
  if (refus) throw new ReinitialisationRefusee(refus);
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
await seedDemo(db);
console.log(`Données de démonstration rechargées (${await db.count('employes')} collaborateurs).`);
