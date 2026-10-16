// Serveur HTTP de Cursus : API JSON + application web compilée.
import express from 'express';
import { existsSync } from 'node:fs';
import { droitsRh } from '../../shared/constants.ts';
import { libelleAction } from '../../shared/journal.ts';
import { ACTIONS, changeVerdicts } from './actions/index.ts';
import { ActionError, makeCtx } from './actions/context.ts';
import { DEMO, purgeSessions } from './auth.ts';
import { dossierInterface, VERSION } from './chemins.ts';
import { adminsActifs } from './comptes.ts';
import { configMail, enProduction, hoteEcoute, portEcoute, trustProxy, verifierConfig } from './config.ts';
import { espaceChange, identite, routesConnexion } from './connexion.ts';
import { routesConfidentialite } from './confidentialite.ts';
import { buildSnapshot, loadFull } from './dataset.ts';
import { dbFile, openDb } from './db.ts';
import { limiterDebit } from './debit.ts';
import { routesDonnees } from './donnees.ts';
import { type Cible, CIBLES, demarrerEnvois, envoiEnCours, etatEnvois, listerEnvois } from './envois.ts';
import { routesFichierPaie } from './fichier-paie.ts';
import { demarrerJournal, journaliserAction, preparerTrace, routesJournal, tracerRefus } from './journal.ts';
import { migrate } from './migrate.ts';
import { appliquerMigrations, controlerMigrations } from './migrations/cadre.ts';
import { emailMode, transportEmail } from './integrations/email.ts';
import { KEYSTONE_MODE, transportKeystone } from './integrations/keystone.ts';
import { suivreVerdicts, suivreVerdictsChaqueJour } from './integrations/keystone-verdicts.ts';
import { keystoneRoutes } from './integrations/keystone-routes.ts';
import { planifierEmails, recapitulatifEnAttente } from './notifications.ts';
import { protegerBase, retirerSecretStocke } from './protection.ts';
import { demoPosteLocal, protectionCsrf, securityHeaders } from './securite.ts';
import { dossierSauvegardes, poserVerrou } from './sauvegarde.ts';
import { Arret, hoteAffiche } from './service.ts';
import { comptesDemo, seedDemo } from './seed.ts';
import { routeSante } from './supervision.ts';

// En production, une configuration dangereuse arrête le serveur avant toute ouverture de la base.
verifierConfig();

// Base calculée depuis le code (data/cursus.db du projet) ou CURSUS_DB, en chemin absolu : server/src/chemins.ts.
const fichier = dbFile();
let retirerVerrou: () => void;
try {
  // Base réservée au compte du service (600, dossier en 700) ; en production, refus si elle reste accessible à d'autres.
  const protection = protegerBase(fichier, { production: enProduction() });
  if (protection.restreints.length) console.log(`Droits restreints au seul compte du service : ${protection.restreints.join(', ')}.`);
  protection.avertissements.forEach(a => console.warn(`Attention : ${a}`));
  // Verrou posé avant d'ouvrir la base : il signale à npm run restore qu'elle est en service,
  // et un second serveur sur la même base s'arrête ici, avant toute migration.
  retirerVerrou = poserVerrou(fichier);
  // Base mise à jour par une version plus récente (migration nommée inconnue de ce code) : refus avant toute écriture.
  controlerMigrations(fichier);
} catch (err) {
  console.error(`Démarrage impossible : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
// Arrêt ordonné sur SIGTERM / SIGINT (requêtes finies, base fermée, verrou retiré), et refus clair d'un port déjà pris :
// server/src/service.ts. Installé avant l'ouverture de la base, pour qu'un signal reçu pendant les migrations la ferme.
const arret = new Arret(retirerVerrou);
console.log(`Cursus ${VERSION} — base ${fichier} · sauvegardes ${dossierSauvegardes(fichier)}`);
const db = openDb(fichier);
arret.base(db);
migrate(db);
// Migrations nommées (server/src/migrations/) : chacune une seule fois par base, après les reprises ci-dessus ;
// une migration interrompue est annulée et le serveur ne démarre pas (elle sera retentée au démarrage suivant).
try {
  appliquerMigrations(db);
} catch (err) {
  arret.echec(err instanceof Error ? err.message : String(err));
}
// Ancienne clé de session écrite en base (installation lancée sans CURSUS_SECRET) : retirée dès que la variable la remplace.
if (retirerSecretStocke(db)) console.log('Ancienne clé de session retirée de la base : CURSUS_SECRET la remplace (les sauvegardes antérieures la contiennent encore).');
if (db.count('employes') === 0) {
  // Les salariés fictifs ne sont chargés qu'en démonstration, jamais dans une base de production.
  if (DEMO) { seedDemo(db); console.log('Base vide : données de démonstration chargées.'); }
  else console.log('Base vide : aucune donnée de démonstration chargée (mode démonstration inactif).');
}
// Base de démonstration antérieure aux comptes : un compte par salarié et la RH de démonstration.
if (DEMO && db.count('employes') > 0) comptesDemo(db);
if (!DEMO && !adminsActifs(db)) console.log('Aucun administrateur RH : créez-le avec npm run comptes -- admin <identifiant> (docs/DEPLOIEMENT.md).');
// Sessions expirées : purgées au démarrage puis toutes les heures.
purgeSessions(db);
const purge = setInterval(() => purgeSessions(db), 3600_000);
purge.unref();
arret.tache(() => clearInterval(purge));
// Journal : anciennes lignes expurgées une fois, durées de conservation appliquées au démarrage puis toutes les heures.
demarrerJournal(db);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', trustProxy());
app.use(securityHeaders(enProduction()));
// Démonstration en production (application de bureau) : requêtes de ce poste uniquement, jamais via le proxy.
if (DEMO && enProduction()) app.use(demoPosteLocal());
// Point de santé de la supervision (état de la base ; détail en local ou avec le jeton) : sans connexion, avant le
// limiteur de débit et les autres routes /api (server/src/supervision.ts).
app.use(routeSante(db));
// API Keystone (clé X-Api-Key, journal de chaque appel) : avant l'analyse JSON, faite après la vérification de la clé.
app.use('/api/integrations/keystone', keystoneRoutes(db));
// Débit limité par adresse IP et par compte (429, Retry-After), puis refus des requêtes qui modifient sans venir de Cursus (CSRF).
app.use('/api', limiterDebit(db));
app.use(protectionCsrf());
app.use(express.json({ limit: '2mb' }));

// Session, connexion, changement d'espace, mot de passe et liste des comptes : server/src/connexion.ts.
app.use(routesConnexion(db));
// Page Confidentialité : coordonnées du responsable et du DPO, lisibles sans connexion (server/src/confidentialite.ts).
app.use(routesConfidentialite(db));

app.get('/api/data', (req, res) => {
  const id = identite(db, req);
  if (!id) return res.status(401).json({ error: 'Connexion requise' });
  if (espaceChange(req, res, id)) return;
  res.json(buildSnapshot(db, id.user));
});

app.post('/api/actions/:name', (req, res) => {
  const id = identite(db, req);
  if (!id) return res.status(401).json({ error: 'Connexion requise' });
  // Espace changé dans un autre onglet : l'action n'est pas faite avec les droits d'un autre espace.
  if (espaceChange(req, res, id)) return;
  const { user, compte } = id;
  const name = String(req.params.name);
  const handler = ACTIONS[name];
  if (!handler) return res.status(404).json({ error: `Action inconnue : ${name}` });
  try {
    const out = db.tx(() => {
      const ctx = makeCtx(db, user, loadFull(db, user));
      const trace = preparerTrace(db, name, req.body ?? {});
      const r = handler(ctx, req.body ?? {});
      const o = typeof r === 'object' && r !== null ? r : { message: r };
      // Journal signé du nom de la personne connectée et de son compte : champs de la liste blanche de l'action,
      // anciennes et nouvelles valeurs, salariés concernés (server/src/journal.ts).
      journaliserAction(db, trace, { user, compte, message: o.message ?? null, result: o.result });
      // Verdicts transmis à Keystone : un changement est mis en file avec l'action, dans la même transaction.
      if (changeVerdicts(name)) suivreVerdicts(db);
      return o;
    });
    // L'action a pu changer le compte (profil RH retiré, équipe confiée à un autre) : la session est relue,
    // et l'instantané est celui de l'espace où elle se trouve désormais ; aucun si elle ne vaut plus.
    const apres = identite(db, req)?.user;
    res.json({ message: out.message ?? null, result: out.result, data: apres ? buildSnapshot(db, apres) : undefined });
  } catch (err) {
    // Refus d'accès : tracé hors de la transaction annulée (rien n'a été modifié).
    if (err instanceof ActionError && err.status === 403) tracerRefus(db, id, libelleAction(name), err.message, { action: name, p: req.body });
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Journal des actions (consultation filtrée et paginée, export CSV, archive paie, exports de l'interface) et
// données personnelles d'un salarié (export RH, téléchargement par l'intéressé) : server/src/journal.ts, donnees.ts.
app.use(routesJournal(db));
app.use(routesDonnees(db));
// Fichier d'import d'un lot de paie pour Sage (paie et administrateur RH, téléchargement tracé) : server/src/fichier-paie.ts.
app.use(routesFichierPaie(db));

// File d'envoi des messages sortants (Paramètres → Envois) : état de l'intégration et derniers messages.
// Service RH et lecture seule (droit `consultation`) ; ni le référent HSE, ni la paie.
app.get('/api/envois', (req, res) => {
  const id = identite(db, req), user = id?.user;
  if (!user || !droitsRh(user).includes('consultation')) {
    if (id) tracerRefus(db, id, 'Envois sortants', 'réservé au service RH');
    return res.status(403).json({ error: 'Réservé au service RH' });
  }
  const cible = CIBLES.includes(req.query.cible as Cible) ? req.query.cible as Cible : undefined;
  res.json({
    keystone: { mode: KEYSTONE_MODE, ...etatEnvois(db, 'keystone') },
    // E-mails : boîte d'envoi, notifications en attente du récapitulatif quotidien.
    email: { mode: emailMode(), expediteur: configMail()?.from ?? null, recapitulatif: recapitulatifEnAttente(db), ...etatEnvois(db, 'email') },
    envois: listerEnvois(db, { statut: req.query.statut, cible }),
  });
});

// — Application web —
// dist/ du projet, quel que soit le dossier de lancement (CURSUS_DIST la remplace : server/src/chemins.ts).
const dist = dossierInterface();
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  // `root` : seul le chemin relatif est contrôlé (un dossier parent caché comme .xxx/ ne bloque pas l'envoi).
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
} else {
  console.warn(`Interface non compilée (${dist} introuvable) : seule l’API est servie. Lancez npm run build`
    + `${enProduction() ? '' : ' (en développement, npm run dev la sert par Vite)'}.`);
}

const PORT = portEcoute();
// Production : boucle locale par défaut, derrière le reverse proxy HTTPS (docs/DEPLOIEMENT.md).
const HOST = hoteEcoute();
// Port pris, réservé ou adresse inconnue : message en français, base fermée, verrou retiré, code de sortie 1.
arret.ecouter(app, PORT, HOST, () => {
  // Tâches de fond lancées une fois le port obtenu : un serveur qui ne démarre pas n'envoie rien.
  // Messages sortants : file d'envoi traitée en tâche de fond (envoi en cours attendu à l'arrêt), verdicts Go / No Go
  // recalculés chaque jour.
  suivreVerdictsChaqueJour(db);
  arret.tache(demarrerEnvois(db, { keystone: transportKeystone(), email: transportEmail() }));
  arret.attendre(envoiEnCours);
  // E-mails planifiés : récapitulatif quotidien des notifications, relevés d'heures des intérimaires (server/src/notifications.ts).
  arret.tache(planifierEmails(db));
  console.log(`Cursus — API sur http://${hoteAffiche(HOST)}:${PORT}${existsSync(dist) ? ' (application servie)' : ''}${DEMO ? ' · mode démonstration' : ''}`);
});
