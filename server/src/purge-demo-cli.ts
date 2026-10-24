// npm run purge-demo -- --a-blanc [--garder parametrage|catalogue|rien] [--garder-compte <identifiant>]… [--inclure-ajouts] :
// passage de la démonstration à la production (lot 8, chantier A), service arrêté. Vide une base de démonstration de ses
// données fictives en ne gardant que le paramétrage choisi ; règles et aperçu dans server/src/purge-demo.ts.
// Étape 1 du chantier : aperçu à blanc seulement (rien n'est écrit) ; l'exécution (contrôle du service arrêté,
// sauvegarde préalable, transaction, pièces, copies) arrive à l'étape 2 et la commande la refuse d'ici là.
// Code de sortie 0 : aperçu affiché ou purge déjà faite ; 1 : refus.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { enProduction, verifierConfig } from './config.ts';
import { dbFile, urlPostgres } from './db.ts';
import { apercuPurge, controlerEnvironnementPurge, lireOptionsPurge, type OptionsPurge, PurgeRefusee, texteApercu } from './purge-demo.ts';
import { controlerSqliteAJour, ouvrirPourApercu } from './purge-demo-ouverture.ts';
import { serveurActif } from './sauvegarde.ts';

function refuser(err: unknown): never {
  console.error(`Purge refusée : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

let options: OptionsPurge;
try {
  options = lireOptionsPurge(process.argv.slice(2));
  controlerEnvironnementPurge(process.env);
  if (!options.aBlanc) throw new PurgeRefusee('cette version ne fait que l’aperçu : relancez avec --a-blanc (l’exécution de la purge arrive avec l’étape suivante du lot 8).');
} catch (err) {
  refuser(err);
}

// Configuration contrôlée comme au démarrage du serveur (lot 8, chantier B), règles propres à la démonstration écartées :
// la commande tourne dans l'environnement de la démonstration qu'elle prépare à la production. En production, refus
// d'une configuration dangereuse (DATABASE_URL en rôle postgres…) avant d'ouvrir la base.
if (enProduction()) verifierConfig(process.env, { reglesDemo: false, commande: 'npm run purge-demo' });

// L'aperçu n'écrit rien, pas même la mise à jour de la base (server/src/purge-demo-ouverture.ts) : base introuvable,
// mise à jour par une version plus récente ou pas encore par cette version, refusée avant d'être ouverte.
try {
  if (!urlPostgres()) {
    controlerSqliteAJour(dbFile());
    const serveur = serveurActif(dbFile());
    if (serveur) console.error(`Attention : le serveur Cursus (processus ${serveur.pid}) utilise cette base ; la purge elle-même exigera qu’il soit arrêté.`);
  }
} catch (err) {
  refuser(err);
}

let db: Awaited<ReturnType<typeof ouvrirPourApercu>> | null = null;
try {
  db = await ouvrirPourApercu();
  const apercu = await apercuPurge(db, options);
  if (apercu.decision.statut === 'deja-faite') {
    console.log(`Purge déjà faite le ${apercu.decision.le}${apercu.decision.message ? ` : ${apercu.decision.message}` : ''}. Rien n’a été modifié.`);
  } else {
    for (const l of texteApercu(apercu)) console.log(l);
    if (apercu.decision.statut === 'refusee') process.exitCode = 1;
  }
} catch (err) {
  console.error(`Aperçu impossible : ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await db?.fermer();
}
