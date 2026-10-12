// Serveur HTTP de Cursus : API JSON + application web compilée.
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Domain } from '../../shared/domain.ts';
import { matricule } from '../../shared/format.ts';
import { ACTIONS, QUIET_ACTIONS } from './actions/index.ts';
import { ActionError, makeCtx } from './actions/context.ts';
import { DEMO, purgeSessions } from './auth.ts';
import { adminsActifs, journaliser } from './comptes.ts';
import { enProduction, hoteEcoute, portEcoute, trustProxy, verifierConfig } from './config.ts';
import { espaceChange, identite, routesConnexion } from './connexion.ts';
import { buildSnapshot, loadFull } from './dataset.ts';
import { dbFile, openDb } from './db.ts';
import { migrate } from './migrate.ts';
import { KEYSTONE_API_KEY, keystoneKeyOk } from './integrations/keystone.ts';
import { demoPosteLocal, securityHeaders } from './securite.ts';
import { poserVerrou } from './sauvegarde.ts';
import { comptesDemo, seedDemo } from './seed.ts';

// En production, une configuration dangereuse arrête le serveur avant toute ouverture de la base.
verifierConfig();

// Verrou posé avant d'ouvrir la base : il signale à npm run restore qu'elle est en service,
// et un second serveur sur la même base s'arrête ici, avant toute migration.
try {
  poserVerrou(dbFile());
} catch (err) {
  console.error(`Démarrage impossible : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
const db = openDb();
migrate(db);
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
setInterval(() => purgeSessions(db), 3600_000).unref();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', trustProxy());
app.use(securityHeaders(enProduction()));
// Démonstration en production (application de bureau) : requêtes de ce poste uniquement, jamais via le proxy.
if (DEMO && enProduction()) app.use(demoPosteLocal());
app.use(express.json({ limit: '2mb' }));

// Session, connexion, changement d'espace, mot de passe et liste des comptes : server/src/connexion.ts.
app.use(routesConnexion(db));

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
      const r = handler(ctx, req.body ?? {});
      const o = typeof r === 'object' && r !== null ? r : { message: r };
      // Journal signé du nom de la personne connectée et de son compte.
      if (!QUIET_ACTIONS.has(name)) journaliser(db, { actor: user.nom, role: user.role, action: name, message: o.message ?? null, payload: req.body ?? {}, compte });
      return o;
    });
    // L'action a pu changer le compte (profil RH retiré, équipe confiée à un autre) : la session est relue,
    // et l'instantané est celui de l'espace où elle se trouve désormais ; aucun si elle ne vaut plus.
    const apres = identite(db, req)?.user;
    res.json({ message: out.message ?? null, result: out.result, data: apres ? buildSnapshot(db, apres) : undefined });
  } catch (err) {
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.get('/api/journal', (req, res) => {
  const user = identite(db, req)?.user;
  if (!user || user.role !== 'rh') return res.status(403).json({ error: 'Réservé au service RH' });
  // Filtre : connexions (et mots de passe) ou opérations (tout le reste), pour que des refus de connexion
  // en nombre ne chassent pas les opérations RH des 100 lignes affichées.
  const connexions = `(action LIKE 'connexion%' OR action LIKE 'motdepasse.%')`;
  const filtre = req.query.filtre === 'connexions' ? `WHERE ${connexions}` : req.query.filtre === 'operations' ? `WHERE NOT ${connexions}` : '';
  const rows = db.sql.prepare(`SELECT at, actor, role, action, message, identifiant FROM journal ${filtre} ORDER BY id DESC LIMIT 100`).all();
  res.json(rows);
});

// — Intégration Keystone : appels entrants —
function keystoneAuth(req: Request, res: Response, next: NextFunction) {
  if (!KEYSTONE_API_KEY) return res.status(503).json({ error: 'Intégration Keystone non configurée' });
  if (!keystoneKeyOk(req.get('x-api-key'))) return res.status(401).json({ error: 'Clé API invalide' });
  next();
}

/** Keystone interroge Cursus : verdict Go / No Go d'un chantier (matricules et codes de motif uniquement). */
app.get('/api/integrations/keystone/chantiers/:id/go-no-go', keystoneAuth, (req, res) => {
  const full = loadFull(db, { role: 'rh', empId: null, nom: 'Keystone', intitule: '' });
  const d = new Domain(full);
  const emps = d.enrich(full.settings.horizonAlerte, false);
  const ch = d.evaluateChantiers(emps, d.tripsAll()).find(x => x.c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Chantier inconnu' });
  res.json(d.keystonePayload(ch, full.settings.partageKeystone === 'detaille', new Date().toISOString()));
});

/** Keystone transmet une demande de déplacement pour une ressource affectée à un chantier. */
app.post('/api/integrations/keystone/demandes', keystoneAuth, (req, res) => {
  const { matricule: mat, chantier, destination, depart, retour } = req.body ?? {};
  const full = loadFull(db, { role: 'rh', empId: null, nom: 'Keystone', intitule: '' });
  const emp = full.employes.find(e => matricule(e.id) === mat);
  const d = new Domain(full);
  if (!emp || !d.chantier(chantier) || !d.destOf(destination) || !/^\d{4}-\d{2}-\d{2}$/.test(depart) || !/^\d{4}-\d{2}-\d{2}$/.test(retour)) {
    return res.status(400).json({ error: 'Demande invalide : matricule, chantier, destination, depart, retour' });
  }
  const row = db.insert<{ id: number }>('demandesKeystone', { empId: emp.id, chantier, dest: destination, depart, retour, recue: full.today });
  res.status(201).json({ id: row.id, statut: 'en_attente_rh' });
});

// — Application web —
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  // `root` : seul le chemin relatif est contrôlé (un dossier parent caché comme .xxx/ ne bloque pas l'envoi).
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
}

const PORT = portEcoute();
// Production : boucle locale par défaut, derrière le reverse proxy HTTPS (docs/DEPLOIEMENT.md).
const HOST = hoteEcoute();
const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST.includes(':') ? `[${HOST}]` : HOST;
app.listen(PORT, HOST, () => {
  console.log(`Cursus — API sur http://${shownHost}:${PORT}${existsSync(dist) ? ' (application servie)' : ''}${DEMO ? ' · mode démonstration' : ''}`);
});
