// Application HTTP de Cursus : API JSON + application web compilée, construite sur une base déjà ouverte et migrée.
// Séparée du démarrage (server/src/index.ts : configuration, protection de la base, verrou, migrations, écoute, tâches
// de fond) pour que les tests la montent dans leur propre processus (tests/http.test.ts), sans lancer de serveur.
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { droitsRh } from '../../shared/constants.ts';
import { libelleAction } from '../../shared/journal.ts';
import { ACTIONS, changeVerdicts } from './actions/index.ts';
import { ActionError, makeCtx } from './actions/context.ts';
import { signerDelegation } from './actions/delegations-manager.ts';
import { DEMO } from './auth.ts';
import { dossierInterface } from './chemins.ts';
import { compression } from './compression.ts';
import { compressionActive, configMail, demoPublique, enProduction, trustProxy } from './config.ts';
import { espaceChange, identite, routesConnexion } from './connexion.ts';
import { routesConfidentialite } from './confidentialite.ts';
import { buildSnapshot, loadFull } from './dataset.ts';
import type { Db } from './db.ts';
import { limiterDebit } from './debit.ts';
import { routesDonnees } from './donnees.ts';
import { type Cible, CIBLES, etatEnvois, listerEnvois } from './envois.ts';
import { envoisPourLecteur } from './envois-lecteur.ts';
import { apiInconnue, ERREUR_INTERNE, gestionnaireErreurs, LIMITE_CORPS, signalerErreur } from './erreurs.ts';
import { routesFichierPaie } from './fichier-paie.ts';
import { routesVariablesPaie } from './variables-paie.ts';
import { routesPieces } from './pieces-routes.ts';
import { routesAgenda } from './agenda.ts';
import { journaliserAction, preparerTrace, routesJournal, tracerRefus } from './journal.ts';
import { emailMode } from './integrations/email.ts';
import { KEYSTONE_MODE } from './integrations/keystone.ts';
import { suivreVerdicts } from './integrations/keystone-verdicts.ts';
import { keystoneRoutes } from './integrations/keystone-routes.ts';
import { journalRequetes } from './logs.ts';
import { recapitulatifEnAttente } from './notifications.ts';
import { demoPosteLocal, protectionCsrf, securityHeaders } from './securite.ts';
import { routeSante } from './supervision.ts';

export interface OptionsApp {
  /** Interface compilée servie (dist/ du projet ou CURSUS_DIST par défaut) ; dossier absent : API seule. */
  dist?: string;
  /** Production (NODE_ENV=production par défaut) : HSTS, garde de la démonstration. */
  production?: boolean;
  /** Compression des réponses (CURSUS_COMPRESSION, active par défaut). */
  compression?: boolean;
  /** Une ligne de journal par requête (server/src/logs.ts) ; active par défaut. */
  journalRequetes?: boolean;
}

/** Cache des fichiers de /assets : noms hachés par Vite (index-XXXX.js), donc contenu immuable pour une adresse. */
export const CACHE_ASSETS = 'public, max-age=31536000, immutable';
/** index.html : revalidé à chaque ouverture (ETag), pour charger aussitôt les fichiers d'une nouvelle version. */
export const CACHE_PAGE = 'no-cache';

export function createApp(db: Db, options: OptionsApp = {}): Express {
  const production = options.production ?? enProduction();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  // Journal des requêtes en premier : il voit aussi les refus des protections qui suivent (403, 429).
  if (options.journalRequetes ?? true) app.use(journalRequetes());
  if (options.compression ?? compressionActive()) app.use(compression());
  app.use(securityHeaders(production));
  // Démonstration en production (application de bureau) : requêtes de ce poste uniquement, jamais via le proxy.
  // Démonstration en production : poste local seulement, sauf instance publiée explicitement (CURSUS_DEMO_PUBLIQUE=1).
  if (DEMO && production && !demoPublique()) app.use(demoPosteLocal());
  // Point de santé de la supervision (état de la base ; détail en local ou avec le jeton) : sans connexion, avant le
  // limiteur de débit et les autres routes /api (server/src/supervision.ts).
  app.use(routeSante(db));
  // API Keystone (clé X-Api-Key, journal de chaque appel) : avant l'analyse JSON, faite après la vérification de la clé.
  app.use('/api/integrations/keystone', keystoneRoutes(db));
  // Débit limité par adresse IP et par compte (429, Retry-After), puis refus des requêtes qui modifient sans venir de Cursus (CSRF).
  app.use('/api', limiterDebit(db));
  app.use(protectionCsrf());
  app.use(express.json({ limit: LIMITE_CORPS }));

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
        const o = signerDelegation(ctx, typeof r === 'object' && r !== null ? r : { message: r });
        // Journal signé du nom de la personne connectée et de son compte : champs de la liste blanche de l'action,
        // anciennes et nouvelles valeurs, salariés concernés (server/src/journal.ts) ; managers remplacés (t135).
        journaliserAction(db, trace, { user, compte, message: o.message ?? null, result: o.result, parDelegation: [...ctx.parDelegation] });
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
      signalerErreur(req, err);
      res.status(500).json({ error: ERREUR_INTERNE });
    }
  });

  // Journal des actions (consultation filtrée et paginée, export CSV, archive paie, exports de l'interface) et
  // données personnelles d'un salarié (export RH, téléchargement par l'intéressé) : server/src/journal.ts, donnees.ts.
  app.use(routesJournal(db));
  app.use(routesDonnees(db));
  // Fichier d'import d'un lot de paie pour Sage (paie et administrateur RH, téléchargement tracé) : server/src/fichier-paie.ts.
  app.use(routesFichierPaie(db));
  // Variables de paie d'une période, export CSV tracé (droit « paie ») : server/src/variables-paie.ts.
  app.use(routesVariablesPaie(db));
  // Pièces justificatives : envoi (corps brut, 10 Mo au plus) et consultation contrôlée par les droits, tracées :
  // server/src/pieces-routes.ts.
  app.use(routesPieces(db));
  // Agenda personnel par abonnement (t036) : GET /api/agenda/<jeton>.ics, sans session (client d'agenda), débit limité
  // par adresse et par jeton, 404 pour tout jeton inutilisable : server/src/agenda.ts.
  app.use(routesAgenda(db));

  // File d'envoi des messages sortants (Paramètres → Envois) : état de l'intégration et derniers messages.
  // Service RH et lecture seule (droit `consultation`) ; ni le référent HSE, ni la paie. La lecture seule ne lit pas le
  // contenu d'un e-mail qui désigne une donnée de santé (server/src/envois-lecteur.ts).
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
      envois: envoisPourLecteur(db, user, listerEnvois(db, { statut: req.query.statut, cible })),
    });
  });

  // — Application web —
  // dist/ du projet, quel que soit le dossier de lancement (CURSUS_DIST la remplace : server/src/chemins.ts).
  const dist = options.dist ?? dossierInterface();
  if (existsSync(dist)) {
    // Fichiers hachés par Vite : un an en cache, sans revalidation ; un fichier absent (ancienne version) reçoit 404,
    // jamais la page de l'interface à la place d'un script.
    app.use('/assets', express.static(join(dist, 'assets'), { index: false, maxAge: '1y', immutable: true }));
    app.use('/assets', (_req, res) => { res.status(404).type('text/plain').send('Fichier introuvable'); });
    app.use(express.static(dist, { index: false, setHeaders: (res, chemin) => { if (chemin.endsWith('index.html')) res.setHeader('Cache-Control', CACHE_PAGE); } }));
    // `root` : seul le chemin relatif est contrôlé (un dossier parent caché comme .xxx/ ne bloque pas l'envoi).
    app.get(/^(?!\/api(\/|$)).*/, (_req, res) => res.sendFile('index.html', { root: dist, cacheControl: false, headers: { 'Cache-Control': CACHE_PAGE } }));
  }
  // Adresse /api inconnue, puis toute erreur (corps illisible ou trop gros, erreur imprévue) : réponse JSON
  // (server/src/erreurs.ts). Rien ne doit être monté après.
  app.use('/api', apiInconnue());
  app.use(gestionnaireErreurs());
  return app;
}
