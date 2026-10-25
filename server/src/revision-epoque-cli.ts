// npm run revision:epoque : change l'époque de la base (lot 9, chantier 1, server/src/purge-changements.ts). Les
// instances en service relisent alors tout l'instantané à leur prochaine lecture, au lieu de le mettre à jour par le
// journal des changements. À lancer après un rechargement des données seules sur le serveur PostgreSQL
// (pg_restore --data-only, ou toute copie de données qui remet une ancienne table `revision`), si les instances n'ont pas
// été redémarrées (docs/SAUVEGARDE.md). Un pg_restore qui recrée les tables change de lui-même l'époque (OID de la
// table `revision`). Sans risque service démarré : une seule écriture, dans une transaction.
// Code de sortie 0 : époque changée ; 1 : base impossible à ouvrir ou écriture refusée.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { enProduction, verifierConfig } from './config.ts';
import { dbFile, openDb, urlPostgres } from './db.ts';
import { mettreAJourBase } from './demarrage.ts';
import { controlerPourOutil } from './migrations/cadre.ts';
import { changerEpoque } from './purge-changements.ts';

function arreter(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.argv.length > 2) arreter('Usage : npm run revision:epoque (aucune option)');
// Configuration contrôlée comme au démarrage du serveur (en production, refus d'une configuration dangereuse).
if (enProduction()) verifierConfig(process.env, { commande: 'npm run revision:epoque' });

// Fichier SQLite : refusé s'il a été mis à jour par une version plus récente, ou pas encore par le serveur en service ;
// serveur PostgreSQL : openDb applique les migrations et contrôle le schéma, sous verrou.
let aMettreAJour = true;
try {
  if (!urlPostgres()) aMettreAJour = controlerPourOutil(dbFile());
} catch (err) {
  arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
}
let db: Awaited<ReturnType<typeof openDb>>;
try {
  db = await openDb();
} catch (err) {
  arreter(`Commande impossible : ${err instanceof Error ? err.message : err}`);
}
try {
  if (aMettreAJour) await mettreAJourBase(db);
  const { avant, apres } = await changerEpoque(db);
  console.log(`Époque de la base changée (${avant} → ${apres}) : les instances de Cursus relisent tout à leur prochaine lecture.`);
} catch (err) {
  console.error(`Commande impossible : ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await db.fermer();
}
