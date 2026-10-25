// Serveur HTTP de Cursus : démarrage (configuration, protection de la base, verrou, migrations, écoute, tâches de fond).
// L'application elle-même (routes, protections, interface compilée) est construite par createApp : server/src/app.ts.
// Image Docker : volume rendu au compte du service, droits root abandonnés (avant tout autre import).
import './conteneur.ts';
import { existsSync } from 'node:fs';
import { createApp } from './app.ts';
import { DEMO, purgeSessions } from './auth.ts';
import { dossierInterface, VERSION } from './chemins.ts';
import { adminsActifs } from './comptes.ts';
import { demoPublique, enProduction, hoteEcoute, portEcoute, verifierConfig } from './config.ts';
import { todayIso } from './dataset.ts';
import { dbFile, openDb, urlPostgres } from './db.ts';
import { mettreAJourBase, prechaufferCache } from './demarrage.ts';
import { demarrerEnvois, envoiEnCours } from './envois.ts';
import { controlerIntegrite } from './integrite.ts';
import { demarrerJournal } from './journal.ts';
import { appliquerAvenants } from './avenants.ts';
import { log, redirigerConsole } from './logs.ts';
import { marquerExploitation, refusDemo } from './marqueurs.ts';
import { demarrerConservation } from './conservation.ts';
import { demarrerPieces } from './pieces.ts';
import { controlerMigrations } from './migrations/cadre.ts';
import { transportEmail } from './integrations/email.ts';
import { transportKeystone } from './integrations/keystone.ts';
import { suivreVerdictsChaqueJour } from './integrations/keystone-verdicts.ts';
import { declarerBase } from './integrations/matrix.ts';
import { planifierEmails } from './notifications.ts';
import { controlerDemarrage } from './pre-vol.ts';
import { protegerBase, retirerSecretStocke } from './protection.ts';
import { dossierSauvegardes, poserVerrou } from './sauvegarde.ts';
import { Arret, hoteAffiche } from './service.ts';
import { demarrerSurveillance } from './supervision.ts';
import type { Db } from './db.ts';
import { comptesDemo, seedDemo } from './seed.ts';

/** Hôte, port et base de DATABASE_URL, pour le journal du démarrage : jamais l'identifiant ni le mot de passe. */
function cibleAffichee(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(adresse illisible)';
  }
}

// Journaux en JSON (CURSUS_LOG_FORMAT, par défaut en production) : les messages console.* du reste du serveur passent
// aussi par une ligne JSON, avec leur niveau (server/src/logs.ts).
redirigerConsole();
// En production, une configuration dangereuse arrête le serveur avant toute ouverture de la base.
verifierConfig();

// Base : serveur PostgreSQL commun si DATABASE_URL est renseignée (schéma cursus, migrations de server/migrations-pg/),
// sinon fichier SQLite de repli calculé depuis le code (data/cursus.db du projet) ou CURSUS_DB : server/src/db.ts.
const serveurPg = urlPostgres();
const fichier = dbFile();
let retirerVerrou: () => void = () => {};
if (!serveurPg) {
  try {
    // Base réservée au compte du service (600, dossier en 700) ; en production, refus si elle reste accessible à d'autres.
    const protection = protegerBase(fichier, { production: enProduction() });
    if (protection.restreints.length) log.info(`Droits restreints au seul compte du service : ${protection.restreints.join(', ')}.`);
    protection.avertissements.forEach(a => log.avertissement(`Attention : ${a}`));
    // Verrou posé avant d'ouvrir la base : il signale à npm run restore qu'elle est en service,
    // et un second serveur sur la même base s'arrête ici, avant toute migration.
    retirerVerrou = poserVerrou(fichier);
    // Base mise à jour par une version plus récente (migration nommée inconnue de ce code) : refus avant toute écriture.
    controlerMigrations(fichier);
  } catch (err) {
    log.erreur(`Démarrage impossible : ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
// Arrêt ordonné sur SIGTERM / SIGINT (requêtes finies, base fermée, verrou retiré), et refus clair d'un port déjà pris :
// server/src/service.ts. Installé avant l'ouverture de la base, pour qu'un signal reçu pendant les migrations la ferme.
const arret = new Arret(retirerVerrou);
// Étapes de démarrage asynchrones (base, migrations, démonstration) : un signal reçu pendant ce temps attend leur fin.
const demarrageTermine = arret.demarrer();
log.info(serveurPg
  ? `Cursus ${VERSION} — base PostgreSQL ${cibleAffichee(serveurPg)}, schéma cursus (plusieurs instances admises : verrous du serveur)`
  : `Cursus ${VERSION} — base ${fichier} · sauvegardes ${dossierSauvegardes(fichier)}`);
let db: Db;
try {
  // PostgreSQL : migrations de server/migrations-pg/ (journal schema_migrations) et contrôle du schéma, sinon refus.
  db = await openDb(fichier);
} catch (err) {
  log.erreur(`Démarrage impossible : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
arret.base(db);
// SQLite : reprises historiques puis migrations nommées (server/src/migrations/), chacune une seule fois par base ; une
// migration interrompue est annulée et le serveur ne démarre pas (elle sera retentée au démarrage suivant).
// PostgreSQL : amorçages d'une base neuve et rattachement des fiches aux postes (server/src/demarrage.ts).
try {
  await mettreAJourBase(db);
} catch (err) {
  arret.echec(err instanceof Error ? err.message : String(err));
}
// Base de production (lot 8, chantier A) : données fictives purgées (npm run purge-demo) ou base exploitée. Démarrée avec
// CURSUS_DEMO=1, elle rechargerait la démonstration dans une base vide : refus avant toute écriture (server/src/marqueurs.ts).
if (DEMO) {
  const refus = await refusDemo(db);
  if (refus) arret.echec(refus);
}
// Contrôle de la base au démarrage (lot 8, chantier B ; règles : server/src/pre-vol.ts, controlerDemarrage) : en
// production hors démonstration, refus d'une base qui porte des données de démonstration ou d'une connexion en
// superutilisateur ; démonstration sur la base epc2i refusée dès que la base a servi en production ou a été purgée.
// Fait avant tout chargement et avant le marquage `exploitation`, qui ne doit jamais être posé sur une démonstration.
const refusBase = await controlerDemarrage(db);
if (refusBase.length) arret.echec(refusBase.join(' ; '));
// Schéma de la base déclaré à Matrix (catalogue des bases), une fois les migrations faites : sans MATRIX_URL rien ne
// part ; appel non attendu, un échec n'écrit qu'un avertissement (server/src/integrations/matrix.ts).
void declarerBase(db, VERSION);
// Ancienne clé de session écrite en base (installation lancée sans CURSUS_SECRET) : retirée dès que la variable la remplace.
if (await retirerSecretStocke(db)) log.info('Ancienne clé de session retirée de la base : CURSUS_SECRET la remplace (les sauvegardes antérieures la contiennent encore).');
// Base vide (contrôlée et remplie dans la même transaction, sous le verrou d'écriture : deux instances qui démarrent
// ensemble sur le serveur commun ne la chargent qu'une fois).
const vide = await db.tx(async () => {
  if (await db.count('employes') !== 0) return null;
  // Les salariés fictifs ne sont chargés qu'en démonstration (CURSUS_DEMO=1), jamais dans une base de production.
  if (DEMO) await seedDemo(db);
  return DEMO;
});
if (vide !== null) log.info(vide ? 'Base vide : données de démonstration chargées.' : 'Base vide : aucune donnée de démonstration chargée (mode démonstration inactif).');
// Base passée en exploitation (lot 8, chantier A) : premier démarrage en production hors démonstration, base vide comprise,
// noté une fois dans le réglage `exploitation` (server/src/marqueurs.ts). npm run purge-demo refuse ensuite cette base.
if (await marquerExploitation(db, VERSION)) log.info('Premier démarrage en production hors démonstration : base marquée « exploitation » (npm run purge-demo la refusera).');
// Instance de démonstration publiée derrière le proxy (CURSUS_DEMO_PUBLIQUE=1) : rappel à chaque démarrage.
if (demoPublique()) log.avertissement('Démonstration publiée (CURSUS_DEMO_PUBLIQUE=1) : l’espace RH s’ouvre sans mot de passe à qui atteint cette adresse. Données fictives seulement ; restreignez l’accès en amont (authentification du proxy).');
// Base de démonstration antérieure aux comptes : un compte par salarié et la RH de démonstration.
if (DEMO) await db.tx(async () => { if (await db.count('employes') > 0) await comptesDemo(db); });
// Références orphelines (salarié, session, formation… absents) : signalées dans les journaux, le journal des actions
// et le point de santé, sans bloquer le démarrage (server/src/integrite.ts).
await controlerIntegrite(db);
// Point de santé (lot 8) : administrateurs RH, données de démonstration et références orphelines relus au démarrage
// puis toutes les heures, pour que /api/health ne lise que la sonde de la base (server/src/supervision.ts).
arret.tache(await demarrerSurveillance(db));
if (!DEMO && !await adminsActifs(db)) log.info('Aucun administrateur RH : créez-le avec npm run comptes -- admin <identifiant> (docs/DEPLOIEMENT.md).');
// Sessions expirées : purgées au démarrage puis toutes les heures.
await purgeSessions(db);
const purge = setInterval(async () => await purgeSessions(db), 3600_000);
purge.unref();
arret.tache(() => clearInterval(purge));
// Journal : anciennes lignes expurgées une fois, durées de conservation appliquées au démarrage puis toutes les heures.
await demarrerJournal(db);
// Pièces justificatives : pièces en attente de plus de 24 h et fichiers des pièces retirées effacés, au démarrage puis
// toutes les heures (server/src/pieces.ts).
arret.tache(await demarrerPieces(db));
// Conservation des dossiers (t016) : dossiers des salariés sortis dont une durée est échue signalés au service RH, une
// fois par jour ; rien n'est effacé sans la confirmation de l'administrateur RH (server/src/conservation.ts).
arret.tache(await demarrerConservation(db));
// Avenants programmés (historique des contrats) appliqués à la fiche à leur date d'effet : au démarrage puis toutes les heures.
await appliquerAvenants(db, todayIso());
const avenants = setInterval(async () => await appliquerAvenants(db, todayIso()), 3600_000);
avenants.unref();
arret.tache(() => clearInterval(avenants));

// Cache de l'instantané préchauffé (lot 9) : entrée de la révision courante lue en tâche de fond, avant les premières
// requêtes, qui la trouvent prête ou attendent cette lecture (server/src/demarrage.ts).
void prechaufferCache(db, m => log.avertissement(m));

// Routes, protections, compression, cache des fichiers et interface compilée : server/src/app.ts.
// dist/ du projet, quel que soit le dossier de lancement (CURSUS_DIST la remplace : server/src/chemins.ts).
const dist = dossierInterface();
const app = createApp(db, { dist });
if (!existsSync(dist)) {
  log.avertissement(`Interface non compilée (${dist} introuvable) : seule l’API est servie. Lancez npm run build`
    + `${enProduction() ? '' : ' (en développement, npm run dev la sert par Vite)'}.`);
}

const PORT = portEcoute();
// Production : boucle locale par défaut, derrière le reverse proxy HTTPS (docs/DEPLOIEMENT.md).
const HOST = hoteEcoute();
// Port pris, réservé ou adresse inconnue : message en français, base fermée, verrou retiré, code de sortie 1.
demarrageTermine();
arret.ecouter(app, PORT, HOST, async () => {
  // Tâches de fond lancées une fois le port obtenu : un serveur qui ne démarre pas n'envoie rien.
  // Messages sortants : file d'envoi traitée en tâche de fond (envoi en cours attendu à l'arrêt), verdicts Go / No Go
  // recalculés chaque jour.
  await suivreVerdictsChaqueJour(db);
  arret.tache(await demarrerEnvois(db, { keystone: transportKeystone(), email: transportEmail() }));
  arret.attendre(envoiEnCours);
  // E-mails planifiés : récapitulatif quotidien des notifications, relevés d'heures des intérimaires (server/src/notifications.ts).
  arret.tache(await planifierEmails(db));
  log.info(`Cursus — API sur http://${hoteAffiche(HOST)}:${PORT}${existsSync(dist) ? ' (application servie)' : ''}${DEMO ? ' · mode démonstration' : ''}`);
});
