// npm run demo-commun -- [--a-blanc] : ajoute à la base de démonstration le référentiel commun des outils (personnes
// fictives de Keystone, Codex, Vigie et Crucible, sites et unités de Matrix, projets de Keystone ; server/src/seed-commun.ts,
// docs/DEMO-COMMUNE.md). Sur le fichier SQLite (CURSUS_DB) ou sur le serveur PostgreSQL (DATABASE_URL), typiquement après
// la reprise de la démonstration (npm run reprise-postgres, docs/DEPLOIEMENT.md). Idempotente : relancée, elle n'ajoute
// que ce qui manque. Refusée sur une base sans marqueur de démonstration, purgée ou exploitée.
// --a-blanc : aperçu de ce qui serait ajouté, rien n'est écrit.
// Le serveur peut rester en service : le cache de l'instantané suit les écritures par les révisions de la base.
// Code de sortie 0 : ajout fait, déjà fait ou aperçu affiché ; 1 : refus ou échec, rien n'a été écrit.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { enProduction, verifierConfig } from './config.ts';
import { type Db, dbFile, openDb, urlPostgres } from './db.ts';
import { mettreAJourBase } from './demarrage.ts';
import { controlerPourOutil } from './migrations/cadre.ts';
import { ajouterReferentielCommun, planReferentielCommun, refusReferentielCommun, textePlan } from './seed-commun.ts';

const USAGE = 'Usage : npm run demo-commun -- [--a-blanc]';
const args = process.argv.slice(2);
const inconnues = args.filter(a => a !== '--a-blanc');
if (inconnues.length) {
  console.error(`Option inconnue : ${inconnues.join(' ')}\n${USAGE}`);
  process.exit(1);
}
const aBlanc = args.includes('--a-blanc');

// Configuration contrôlée comme au démarrage du serveur (en production, refus d'une configuration dangereuse).
if (enProduction()) verifierConfig(process.env, { commande: 'npm run demo-commun' });

let db: Db | null = null;
try {
  // Fichier SQLite : base mise au niveau de cette version, refusée si un serveur plus récent l'a déjà migrée.
  if (!urlPostgres()) controlerPourOutil(dbFile());
  db = await openDb();
  await mettreAJourBase(db);
  if (aBlanc) {
    const refus = await refusReferentielCommun(db);
    if (refus) throw new Error(refus);
    for (const l of textePlan(await planReferentielCommun(db), false)) console.log(l);
  } else {
    for (const l of textePlan(await ajouterReferentielCommun(db), true)) console.log(l);
    console.log(`Base : ${db.moteur === 'pg' ? 'serveur PostgreSQL (DATABASE_URL)' : dbFile()} ; ${await db.count('employes')} salariés en tout.`);
  }
} catch (err) {
  console.error(`Référentiel commun refusé : ${err instanceof Error ? err.message : err}`);
  console.error('Rien n’a été écrit.');
  process.exitCode = 1;
} finally {
  await db?.fermer();
}
