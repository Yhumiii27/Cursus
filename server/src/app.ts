// Application HTTP de Cursus : API JSON + application web compilée, construite sur une base déjà ouverte et migrée.
// Séparée du démarrage (server/src/index.ts : configuration, protection de la base, verrou, migrations, écoute, tâches
// de fond) pour que les tests la montent dans leur propre processus (tests/http.test.ts), sans lancer de serveur.
import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { droitsRh } from '../../shared/constants.ts';
import { libelleAction } from '../../shared/journal.ts';
import { ACTIONS, changeVerdicts } from './actions/index.ts';
import { ActionError, makeCtx } from './actions/context.ts';
import { signerDelegation } from './actions/delegations-manager.ts';
import { validerEnTranches } from './actions/suivi-feuilles.ts';
import { appliquerMajSession, DEMO } from './auth.ts';
import { dossierInterface } from './chemins.ts';
import { compression } from './compression.ts';
import { compressionActive, configMail, demoPublique, enProduction, pwaActive, trustProxy } from './config.ts';
import { ESPACE_CHANGE, espaceChange, examinerIdentite, identite, routesConnexion } from './connexion.ts';
import { routesConfidentialite } from './confidentialite.ts';
import { corpsDe, lireParties, loadFull, partiesInstantane, todayIso } from './dataset.ts';
import { corpsCompresse, encodageGarde, envoyerCompresse } from './corps-compresses.ts';
import { donneesAction } from './cache-instantane.ts';
import { type Db, enSerie } from './db.ts';
import { limiterDebit } from './debit.ts';
import { routesDonnees } from './donnees.ts';
import { type Cible, CIBLES, etatEnvois, listerEnvois } from './envois.ts';
import { envoisPourLecteur } from './envois-lecteur.ts';
import { apiInconnue, ERREUR_INTERNE, estOccupe, gestionnaireErreurs, LIMITE_CORPS, repondreOccupe, signalerErreur } from './erreurs.ts';
import { routesFichierPaie } from './fichier-paie.ts';
import { filtreKeystone } from './filtre-keystone.ts';
import { routesVariablesPaie } from './variables-paie.ts';
import { routesPasseportPrevention } from './passeport-prevention.ts';
// lot 11 — indicateurs
import { routesIndicateurs } from './indicateurs.ts';
// lot 11 — notes de frais, étape 2
import { routesFraisExports } from './frais-exports.ts';
// lot 12 — C1 (forfait annuel en heures)
// lot 12 — C2 (notes de frais : activation)
// lot 12 — C3 (entretiens suivis et 360°)
// lot 12 — C4 (organismes de formation et e-learning)
// lot 12 — C5 (planning d'équipe)
// lot 12 — C6 (badgeage virtuel)
import { routesPieces } from './pieces-routes.ts';
import { CLE_INVALIDE, CleReutilisee, empreinteCorps, garderReponse, lireCle, reponseGardee } from './idempotence.ts';
import { EN_TETE_HORS_LIGNE, refusHorsLigne } from '../../shared/hors-ligne.ts';
import { routesPush } from './push-routes.ts';
import { routesAgenda } from './agenda.ts';
import { journaliserAction, lireFiltre, preparerTrace, routesJournal, tracerRefus } from './journal.ts';
import { emailMode } from './integrations/email.ts';
import { KEYSTONE_MODE } from './integrations/keystone.ts';
import { suivreVerdicts } from './integrations/keystone-verdicts.ts';
import { keystoneRoutes } from './integrations/keystone-routes.ts';
import { cheminJournal, journalRequetes, log } from './logs.ts';
import { recapitulatifEnAttente } from './notifications.ts';
import { demoPosteLocal, exigerNavigationInterne, protectionCsrf, securityHeaders } from './securite.ts';
import { routeSante } from './supervision.ts';
import { corpsEnOctets, envoyerJson, envoyerOctets, grandCorps, objetJson } from './vues-cache.ts';

export interface OptionsApp {
  /** Interface compilée servie (dist/ du projet ou CURSUS_DIST par défaut) ; dossier absent : API seule. */
  dist?: string;
  /** Production (NODE_ENV=production par défaut) : HSTS, garde de la démonstration. */
  production?: boolean;
  /** Compression des réponses (CURSUS_COMPRESSION, active par défaut). */
  compression?: boolean;
  /** Une ligne de journal par requête (server/src/logs.ts) ; active par défaut. */
  journalRequetes?: boolean;
  /** Application installable (CURSUS_PWA, active par défaut) : service worker servi (lot 11, C2). */
  pwa?: boolean;
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
  const compresser = options.compression ?? compressionActive();
  if (compresser) app.use(compression());
  app.use(securityHeaders(production));
  // Démonstration en production (application de bureau) : requêtes de ce poste uniquement, jamais via le proxy.
  // Démonstration en production : poste local seulement, sauf instance publiée explicitement (CURSUS_DEMO_PUBLIQUE=1).
  if (DEMO && production && !demoPublique()) app.use(demoPosteLocal());
  // Point de santé de la supervision (état de la base ; détail en local ou avec le jeton) : sans connexion, avant le
  // limiteur de débit et les autres routes /api (server/src/supervision.ts).
  app.use(routeSante(db));
  // API Keystone (clé X-Api-Key, journal de chaque appel) : avant l'analyse JSON, faite après la vérification de la clé.
  // Filtre facultatif par adresse devant elle (CURSUS_KEYSTONE_ADRESSES, lot 8 : server/src/filtre-keystone.ts).
  app.use('/api/integrations/keystone', filtreKeystone(), keystoneRoutes(db));
  // lot 12 — route d'intégration réservée (socle) : montée avant le limiteur, le CSRF et l'analyse JSON, comme celle de
  // Keystone ; elle a donc son propre limiteur et son propre `express.json` (taille limitée), appelé après la vérification
  // de sa clé. Aucune au socle : la route de badgeuse de C6 est abandonnée (pas de badgeuse murale, réponse du
  // propriétaire du 1er novembre 2026) ; C4 n'en monte une que si une plateforme d'e-learning envoie le suivi.
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C6 (badgeage virtuel)
  // Débit limité par adresse IP et par compte (429, Retry-After), puis refus des requêtes qui modifient sans venir de Cursus (CSRF).
  app.use('/api', limiterDebit(db));
  app.use(protectionCsrf());
  app.use(express.json({ limit: LIMITE_CORPS }));

  // Session, connexion, changement d'espace, mot de passe et liste des comptes : server/src/connexion.ts.
  app.use(routesConnexion(db));
  // Page Confidentialité : coordonnées du responsable et du DPO, lisibles sans connexion (server/src/confidentialite.ts).
  app.use(routesConfidentialite(db));

  // Lecture hors du verrou d'écriture (lot 8, chantier E) : identité (écritures de la session à part, courtes), puis
  // instantané dans une lecture stable (`Db.lecture` : un seul état de la base, sans verrou sur PostgreSQL). Les lectures
  // restent parallèles et n'attendent plus les écritures.
  app.get('/api/data', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    if (espaceChange(req, res, id)) return;
    // Corps JSON de la vue gardé par le cache (lot 9, server/src/vues-cache.ts), tête de la requête recollée : sérialisé
    // après la lecture, qui ne tient ni la file des écritures (SQLite) ni sa transaction (PostgreSQL) pendant ce temps.
    // Lot 10 : la vue elle-même est calculée hors de la lecture, une fois par révision et par clé de vue, la dernière
    // révision atteinte servie pendant une suite d'écritures (`lireParties`) ; grand corps (vue RH) envoyé compressé tel
    // que gardé avec la vue (server/src/corps-compresses.ts).
    const parties = await lireParties(db, id.user);
    const { vue, cle, tete } = parties;
    if (cle !== null && grandCorps(vue, cle)) {
      const enc = encodageGarde(req, compresser);
      if (enc) return envoyerCompresse(res, await corpsCompresse(vue, tete, () => corpsEnOctets(vue, cle, tete), enc), enc);
      return envoyerOctets(res, corpsEnOctets(vue, cle, tete));
    }
    envoyerJson(res, corpsDe(parties));
  });

  // Action : identité lue hors du verrou, puis l'action dans sa transaction (verrou d'écriture tenu le temps de la
  // transaction seulement), puis l'instantané renvoyé dans une lecture stable, hors du verrou. La validation groupée des
  // feuilles passe par tranches de 25 feuilles au plus, une transaction chacune (`validerEnTranches`).
  app.post('/api/actions/:name', async (req: Request, res: Response) => {
    const id = await identite(db, req);
    if (!id) return res.status(401).json({ error: 'Connexion requise' });
    // Espace changé dans un autre onglet : l'action n'est pas faite avec les droits d'un autre espace.
    if (espaceChange(req, res, id)) return;
    const { compte } = id;
    const name = String(req.params.name);
    // Registre lu sur ses seules clés (lot 8, S5) : « constructor », « __proto__ »… ne désignent pas une fonction héritée.
    const handler = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
    if (!handler) return res.status(404).json({ error: `Action inconnue : ${name}` });
    const corps = (req.body ?? {}) as Record<string, any>;
    // Lot 11 (C2) : clé d'idempotence (server/src/idempotence.ts) et rejeu de la file hors ligne (shared/hors-ligne.ts),
    // contrôlé avant tout : saisie personnelle admise hors ligne seulement. La validation groupée des feuilles, faite en
    // plusieurs transactions, n'en a pas : une clé y est ignorée.
    const cle = lireCle(req);
    if (cle === false) return res.status(400).json({ error: CLE_INVALIDE });
    const horsLigne = req.get(EN_TETE_HORS_LIGNE) === '1';
    const refusHL = horsLigne ? refusHorsLigne(name, corps, id.user.empId) : null;
    if (refusHL) return res.status(422).json({ error: refusHL });
    const envoi = cle && name !== 'temps.validerLot' ? { compteId: compte.id, cle, operation: name, empreinte: empreinteCorps(name, corps) } : null;
    /** Une transaction : droits relus dans la transaction (un compte changé entre-temps agit avec ses droits du moment). */
    const passe = async (p: Record<string, any>) => await db.tx(async () => {
      const actuel = (await examinerIdentite(db, req)).id;
      if (!actuel) throw new ActionError('Connexion requise', 401);
      if (actuel.session.role !== id.session.role) throw new ActionError(ESPACE_CHANGE, 409);
      const user = actuel.user;
      // Même requête déjà faite (même clé, même corps) : sa réponse, sans refaire l'action ; autre requête : 422.
      const gardee = envoi ? await reponseGardee(db, envoi) : null;
      if (gardee) return { message: gardee.message, result: gardee.resultat, rejoue: true };
      // Lecture partagée de l'instantané en cache si elle décrit l'état de la base vu ici (server/src/cache-instantane.ts).
      const depart = await donneesAction(db, user, todayIso(), async u => await loadFull(db, u));
      const ctx = makeCtx(db, user, depart);
      const trace = await preparerTrace(db, name, p);
      const r = await handler(ctx, p);
      const o = signerDelegation(ctx, typeof r === 'object' && r !== null ? r : { message: r });
      // Journal signé du nom de la personne connectée et de son compte : champs de la liste blanche de l'action,
      // anciennes et nouvelles valeurs, salariés concernés (server/src/journal.ts) ; managers remplacés (t135).
      await journaliserAction(db, trace, { user, compte, message: o.message ?? null, result: o.result, parDelegation: [...ctx.parDelegation], horsLigne });
      // Verdicts transmis à Keystone : un changement est mis en file avec l'action, dans la même transaction ; jeu des
      // verdicts dérivé du jeu de l'action et du delta de ses écritures (lot 9), sans relire toute la base.
      if (changeVerdicts(name)) await suivreVerdicts(db, { depart });
      // Réponse gardée dans la même transaction (lot 11) : une action annulée ne garde rien.
      if (envoi) await garderReponse(db, envoi, { resultat: o.result });
      return o;
    });
    let out: { message?: string | null; result?: unknown; rejoue?: boolean };
    try {
      out = name === 'temps.validerLot' ? await validerEnTranches(corps, passe, err => signalerErreur(req, err)) : await passe(corps);
    } catch (err) {
      if (err instanceof CleReutilisee) return res.status(422).json({ error: err.message });
      // Refus d'accès : tracé hors de la transaction annulée (rien n'a été modifié), dans sa propre transaction.
      if (err instanceof ActionError && err.status === 403) await db.tx(async () => await tracerRefus(db, id, libelleAction(name), err.message, { action: name, p: req.body }));
      if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
      // Délai du serveur dépassé (verrou, requête) avant la validation : la transaction est annulée, rien n'est écrit.
      if (estOccupe(err)) return repondreOccupe(req, res, err);
      signalerErreur(req, err);
      return res.status(500).json({ error: ERREUR_INTERNE });
    }
    // Envoi déjà fait : réponse gardée, instantané à relire par le client (aucune lecture de plus ici).
    if (out.rejoue) return res.set('idempotent-replayed', 'true').json({ message: out.message ?? null, result: out.result, relire: true });
    // L'action est validée (journal et envois compris) : quoi qu'il arrive ensuite, la réponse rend son message et son
    // résultat, jamais un 503 « rien n'est écrit » qui ferait refaire l'action (doublon).
    try {
      // L'action a pu changer le compte (profil RH retiré, équipe confiée à un autre) : la session est relue,
      // et l'instantané est celui de l'espace où elle se trouve désormais ; aucun si elle ne vaut plus. Session et
      // instantané sont lus sur le même état de la base (`lecture` : aucune transaction ne s'intercale), sans verrou ;
      // les écritures de la session suivent.
      const { parties, maj } = await db.lecture(async () => {
        const apres = await examinerIdentite(db, req);
        return { parties: apres.id ? await partiesInstantane(db, apres.id.user) : undefined, maj: apres.maj };
      });
      await appliquerMajSession(db, maj);
      // Comme res.json({ message, result, data }), l'instantané inséré déjà sérialisé, hors de la lecture.
      envoyerJson(res, objetJson({ message: out.message ?? null, result: out.result, data: parties && corpsDe(parties) }));
    } catch (err) {
      // Relecture de l'instantané impossible (Cursus occupé, erreur) : action faite, instantané à relire par
      // GET /api/data (`relire`, client/src/state/run.ts).
      if (estOccupe(err)) log.avertissement(`Instantané non relu après l'action : ${req.method} ${cheminJournal(req.originalUrl)}`, { cause: err instanceof Error ? err.message : String(err) });
      else signalerErreur(req, err);
      res.json({ message: out.message ?? null, result: out.result, relire: true });
    }
  });

  // Lectures qui écrivent au journal, gardées contre une navigation provoquée depuis un autre site (lot 8, chantier C,
  // S8 ; server/src/securite.ts) : pièce ouverte par lien (Sec-Fetch-Site), téléchargements faits par fetch (Sec-Fetch-Site
  // et en-tête d'espace).
  app.get('/api/pieces/:id', exigerNavigationInterne('lien'));
  app.get('/api/paie/lots/:id/fichier', exigerNavigationInterne('appel'));
  app.get('/api/salaries/:id/donnees', exigerNavigationInterne('appel'));
  // Archive paie : reconnue comme la route la lit (`lireFiltre` : `vue`, ou l'ancien paramètre `filtre`). L'export CSV
  // est gardé quelle que soit la vue (il trace toujours « journal.export » ; le client passe par `telecharger`).
  app.get('/api/journal', exigerNavigationInterne('appel', req => lireFiltre(req.query as Record<string, unknown>).vue === 'archive'));
  app.get('/api/journal/csv', exigerNavigationInterne('appel'));
  // lot 11 — indicateurs : indicateurs sociaux et leur export, lus par fetch depuis l'écran (en-tête d'espace exigé).
  app.get('/api/indicateurs', exigerNavigationInterne('appel'));
  app.get('/api/indicateurs/csv', exigerNavigationInterne('appel'));
  app.get('/api/indicateurs/bdese/csv', exigerNavigationInterne('appel'));
  // lot 11 — notes de frais, étape 2 : exports comptables et leur fichier d'écritures, lus par fetch (en-tête d'espace exigé).
  app.get('/api/frais/exports', exigerNavigationInterne('appel'));
  app.get('/api/frais/exports/:id/fichier', exigerNavigationInterne('appel'));
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)
  // Journal des actions (consultation filtrée et paginée, export CSV, archive paie, exports de l'interface) et
  // données personnelles d'un salarié (export RH, téléchargement par l'intéressé) : server/src/journal.ts, donnees.ts.
  app.use(routesJournal(db));
  app.use(routesDonnees(db));
  // Fichier d'import d'un lot de paie pour Sage (paie et administrateur RH, téléchargement tracé) : server/src/fichier-paie.ts.
  app.use(routesFichierPaie(db));
  // Variables de paie d'une période, export CSV tracé (droit « paie ») : server/src/variables-paie.ts.
  app.use(routesVariablesPaie(db));
  // Passeport de prévention (lot 7, t066) : lignes à déclarer, export CSV tracé (droit « formations ») :
  // server/src/passeport-prevention.ts.
  app.use(routesPasseportPrevention(db));
  // lot 11 — indicateurs : indicateurs sociaux légaux (BDESE, préparation de l'index d'égalité), agrégats masqués calculés
  // hors de l'instantané, arrêtés figés, export CSV tracé (droit « consultation ») : server/src/indicateurs.ts.
  app.use(routesIndicateurs(db));
  // lot 11 — notes de frais, étape 2 : exports comptables (comptabilité et service RH, téléchargement tracé) :
  // server/src/frais-exports.ts.
  app.use(routesFraisExports(db));
  // Pièces justificatives : envoi (corps brut, 10 Mo au plus) et consultation contrôlée par les droits, tracées :
  // server/src/pieces-routes.ts.
  app.use(routesPieces(db));
  // Agenda personnel par abonnement (t036) : GET /api/agenda/<jeton>.ics, sans session (client d'agenda), débit limité
  // par adresse et par jeton, 404 pour tout jeton inutilisable : server/src/agenda.ts.
  app.use(routesAgenda(db));
  // Notifications sur le téléphone (lot 11, C2) : clé publique VAPID et appareils abonnés du compte (server/src/push-routes.ts).
  app.use(routesPush(db));
  // lot 12 — routes à la demande des chantiers (socle), après la session : chacune dans le fichier de son chantier,
  // identité, droits et traçage comme les routes ci-dessus (C2 : historique des frais ; C6 : GET /api/pointages/etat).
  // lot 12 — C1 (forfait annuel en heures)
  // lot 12 — C2 (notes de frais : activation)
  // lot 12 — C3 (entretiens suivis et 360°)
  // lot 12 — C4 (organismes de formation et e-learning)
  // lot 12 — C5 (planning d'équipe)
  // lot 12 — C6 (badgeage virtuel)

  // File d'envoi des messages sortants (Paramètres → Envois) : état de l'intégration et derniers messages.
  // Service RH et lecture seule (droit `consultation`) ; ni le référent HSE, ni la paie. La lecture seule ne lit pas le
  // contenu d'un e-mail qui désigne une donnée de santé (server/src/envois-lecteur.ts).
  app.get('/api/envois', enSerie(db, async (req: Request, res: Response) => {
    const id = await identite(db, req), user = id?.user;
    if (!user || !droitsRh(user).includes('consultation')) {
      if (id) await tracerRefus(db, id, 'Envois sortants', 'réservé au service RH');
      return res.status(403).json({ error: 'Réservé au service RH' });
    }
    const cible = CIBLES.includes(req.query.cible as Cible) ? req.query.cible as Cible : undefined;
    res.json({
      keystone: { mode: KEYSTONE_MODE, ...await etatEnvois(db, 'keystone') },
      // E-mails : boîte d'envoi, notifications en attente du récapitulatif quotidien.
      email: { mode: emailMode(), expediteur: configMail()?.from ?? null, recapitulatif: await recapitulatifEnAttente(db), ...await etatEnvois(db, 'email') },
      envois: await envoisPourLecteur(db, user, await listerEnvois(db, { statut: req.query.statut, cible })),
    });
  }));

  // — Application web —
  // dist/ du projet, quel que soit le dossier de lancement (CURSUS_DIST la remplace : server/src/chemins.ts).
  const dist = options.dist ?? dossierInterface();
  // Service worker (lot 11, C2 : client/public/sw.js, version injectée au build) : revalidé à chaque contrôle du navigateur
  // (no-cache, sinon l'ancien peut rester jusqu'à 24 h), démonstration comprise ; application installable coupée
  // (CURSUS_PWA=0, application de bureau) : 404, jamais la page de l'interface à la place d'un script.
  const pwa = options.pwa ?? pwaActive();
  app.get('/sw.js', (_req, res) => {
    if (!pwa || !existsSync(join(dist, 'sw.js'))) return res.status(404).type('text/plain').send('Fichier introuvable');
    res.sendFile('sw.js', { root: dist, cacheControl: false, headers: { 'Cache-Control': CACHE_PAGE } });
  });
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
