// npm run purge-demo -- [--a-blanc] [--garder parametrage|catalogue|rien] [--garder-compte <identifiant>]… [--inclure-ajouts]
// [--yes] [--force] [--sauvegarde <pg_dump>] [--supprimer-copies-demo] : passage de la démonstration à la production
// (lot 8, chantier A), service arrêté. Vide une base de démonstration de ses données fictives en ne gardant que le
// paramétrage choisi ; règles et aperçu dans server/src/purge-demo.ts, exécution dans server/src/purge-demo-execution.ts.
// - --a-blanc : aperçu sans effet ; sur le serveur PostgreSQL, toute la purge est en plus simulée dans une transaction
//   annulée (vrais décomptes, violations de clés).
// - Sans --a-blanc : contrôle du service arrêté (verrou du fichier SQLite, sauf --force ; aucune autre connexion Cursus
//   sur le serveur PostgreSQL), confirmation (--yes, ou le mot « PRODUCTION <nombre> » tapé dans un terminal), sauvegarde
//   préalable (copie avant-purge, ou pg_dump vérifié désigné par --sauvegarde), purge en une transaction, puis pièces et
//   copies ; les étapes suivantes de la mise en production sont affichées à la fin.
// Code de sortie 0 : aperçu affiché, purge faite ou déjà faite ; 1 : refus ou échec (rien n'a été modifié) ; 2 : purge
// faite et validée, mais une opération suivante (pièces, compactage, copies) a échoué : bilan et étapes affichés quand même.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { createInterface } from 'node:readline/promises';
import { plural } from '../../shared/format.ts';
import { enProduction, verifierConfig } from './config.ts';
import { dbFile, urlPostgres } from './db.ts';
import { controlerPourOutil } from './migrations/cadre.ts';
import { apercuPurge, controlerEnvironnementPurge, confirmationPurgeTapee, lireOptionsPurge, motConfirmationPurge, type OptionsPurge, PurgeRefusee, texteApercu } from './purge-demo.ts';
import { executerPurge, SauvegardePurgeImpossible, simulerPurge, texteBilan, texteSimulation } from './purge-demo-execution.ts';
import { controlerServeurPurge, controlerSqliteAJour, ouvrirPourApercu } from './purge-demo-ouverture.ts';
import { serveurActif } from './sauvegarde.ts';

function refuser(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err instanceof SauvegardePurgeImpossible ? `Sauvegarde préalable impossible : purge annulée. ${message}` : `Purge refusée : ${message}`);
  process.exit(1);
}

let options: OptionsPurge;
const serveurPg = !!urlPostgres();
try {
  options = lireOptionsPurge(process.argv.slice(2));
  controlerEnvironnementPurge(process.env);
  if (!serveurPg && options.sauvegarde) throw new PurgeRefusee('--sauvegarde désigne un pg_dump du serveur PostgreSQL ; pour le fichier SQLite, la copie avant-purge est faite par la commande.');
} catch (err) {
  refuser(err);
}
if (serveurPg && options.force) console.error('Attention : --force est sans effet sur le serveur PostgreSQL (le contrôle des connexions Cursus ouvertes ne se lève jamais).');

// Configuration contrôlée comme au démarrage du serveur (lot 8, chantier B), règles propres à la démonstration écartées :
// la commande tourne dans l'environnement de la démonstration qu'elle prépare à la production. En production, refus
// d'une configuration dangereuse (DATABASE_URL en rôle postgres…) avant d'ouvrir la base.
if (enProduction()) verifierConfig(process.env, { reglesDemo: false, commande: 'npm run purge-demo' });

// Fichier SQLite : base à jour pour cette version, contrôlée sans écriture (server/src/purge-demo-ouverture.ts), puis
// serveur en service : signalé pour l'aperçu, refusé pour la purge (sauf --force).
try {
  if (!serveurPg) {
    controlerSqliteAJour(dbFile());
    controlerPourOutil(dbFile());
    const serveur = serveurActif(dbFile());
    if (options.aBlanc) {
      if (serveur) console.error(`Attention : le serveur Cursus (processus ${serveur.pid}) utilise cette base ; la purge elle-même exigera qu’il soit arrêté.`);
    } else {
      controlerServeurPurge(serveur, options);
      if (serveur) console.error(`Attention : --force, le serveur Cursus (processus ${serveur.pid}) utilise encore cette base. Arrêtez-le avant de le redémarrer sans CURSUS_DEMO.`);
    }
  }
} catch (err) {
  refuser(err);
}

/** Confirmation tapée dans un terminal : le nombre de salariés supprimés, fiches ajoutées comprises. */
async function confirmer(salaries: number, ajouts: number): Promise<boolean> {
  if (!process.stdin.isTTY) throw new PurgeRefusee(`sans terminal, ajoutez --yes pour confirmer (npm run purge-demo -- --yes).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const dont = ajouts ? `, dont ${plural(ajouts, 'fiche ajoutée', 'fiches ajoutées')} par des visiteurs` : '';
    const reponse = await rl.question(`${plural(salaries, 'salarié va être supprimé', 'salariés vont être supprimés')}${dont}, avec toutes les données fictives `
      + `(une copie est faite avant). Tapez ${motConfirmationPurge(salaries)} pour confirmer : `);
    return confirmationPurgeTapee(reponse, salaries);
  } finally {
    rl.close();
  }
}

let db: Awaited<ReturnType<typeof ouvrirPourApercu>> | null = null;
try {
  // Une seule connexion sur le serveur PostgreSQL : toute autre connexion `cursus` est celle d'une instance en service.
  db = await ouvrirPourApercu({ ...process.env, ...(serveurPg ? { CURSUS_PG_POOL: '1' } : {}) });
  if (options.aBlanc) {
    const apercu = await apercuPurge(db, options);
    if (apercu.decision.statut === 'deja-faite') {
      console.log(`Purge déjà faite le ${apercu.decision.le}${apercu.decision.message ? ` : ${apercu.decision.message}` : ''}. Rien n’a été modifié.`);
    } else {
      for (const l of texteApercu(apercu)) console.log(l);
      if (apercu.decision.statut === 'refusee') process.exitCode = 1;
      else if (db.moteur === 'pg' && !apercu.decision.aLever.length) {
        try {
          for (const l of texteSimulation(await simulerPurge(db, options))) console.log(l);
        } catch (err) {
          console.error(`La purge échouerait : ${err instanceof Error ? err.message : err}`);
          process.exitCode = 1;
        }
      }
    }
  } else {
    const issue = await executerPurge(db, options, { confirmer: async a => await confirmer(a.salaries, a.ajouts.fiches.nombre) });
    if (issue.statut === 'deja-faite') console.log(`Purge déjà faite le ${issue.le}${issue.message ? ` : ${issue.message}` : ''}. Rien n’a été modifié.`);
    else {
      for (const l of texteBilan(issue, db.moteur)) console.log(l);
      if (issue.apres.length) process.exitCode = 2;
    }
  }
} catch (err) {
  await db?.fermer();
  refuser(err);
}
await db?.fermer();
