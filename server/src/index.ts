// Serveur HTTP de Cursus : API JSON + application web compilée.
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Domain } from '../../shared/domain.ts';
import { matricule } from '../../shared/format.ts';
import type { CurrentUser, Role } from '../../shared/types.ts';
import { ACTIONS, QUIET_ACTIONS } from './actions/index.ts';
import { ActionError, makeCtx } from './actions/context.ts';
import { DEMO, isAuthenticated, readSession, writeSession, type SessionInfo } from './auth.ts';
import { buildSnapshot, currentUser, loadFull, loadSettings } from './dataset.ts';
import { dbFile, openDb } from './db.ts';
import { migrate } from './migrate.ts';
import { KEYSTONE_API_KEY, KEYSTONE_MODE } from './integrations/keystone.ts';
import { SAGE_MODE } from './integrations/sage.ts';
import { poserVerrou } from './sauvegarde.ts';
import { seedDemo } from './seed.ts';

const db = openDb();
poserVerrou(dbFile()); // signale à npm run restore que la base est en service
migrate(db);
if (db.count('employes') === 0) {
  seedDemo(db);
  console.log('Base vide : données de démonstration chargées.');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

function session(req: Request): SessionInfo | null { return readSession(db, req); }
function authedUser(req: Request): CurrentUser | null {
  const s = session(req);
  return isAuthenticated(s) ? currentUser(db, s) : null;
}

/** Comptes proposés sur l'écran de connexion de démonstration. */
function loginOptions() {
  const full = loadFull(db, { role: 'rh', empId: null, nom: '', intitule: '' });
  const d = new Domain(full);
  const settings = loadSettings(db);
  return {
    rh: [{ id: 0, nom: `${settings.rhNom} — ${settings.rhIntitule}` }],
    manager: [...new Set(d.managers().map(m => m.id))].map(id => ({ id, nom: `${d.personName(id)} — ${d.teamsOf(id).join(', ')}` })),
    collaborateur: [...full.annuaire].sort((a, b) => a.nom.localeCompare(b.nom)).map(p => ({ id: p.id, nom: p.nom })),
  };
}

function sessionPayload(req: Request, s: SessionInfo | null) {
  const user = isAuthenticated(s) ? currentUser(db, s) : null;
  // La liste des comptes (annuaire, organigramme) n'est exposée qu'en démonstration.
  return { demo: DEMO, role: s?.role ?? 'rh', user, loginOptions: DEMO ? loginOptions() : null, integrations: { keystone: KEYSTONE_MODE, sage: SAGE_MODE } };
}

app.get('/api/session', (req, res) => {
  let s = session(req);
  // En démonstration, l'espace RH s'ouvre directement à la première visite.
  if (!s && DEMO) { s = { role: 'rh', rh: true, managerId: null, collabId: null }; writeSession(db, res, s); }
  res.json(sessionPayload(req, s));
});

app.post('/api/mode', (req, res) => {
  const role = req.body?.role as Role;
  if (!['rh', 'manager', 'collaborateur'].includes(role)) return res.status(400).json({ error: 'Espace inconnu' });
  const s: SessionInfo = { ...(session(req) ?? { rh: false, managerId: null, collabId: null }), role };
  if (role === 'rh' && DEMO) s.rh = true;
  writeSession(db, res, s);
  res.json(sessionPayload(req, s));
});

app.post('/api/login', (req, res) => {
  const { role, empId, password } = req.body ?? {};
  if (!['rh', 'manager', 'collaborateur'].includes(role)) return res.status(400).json({ error: 'Espace inconnu' });
  if (!DEMO) return res.status(501).json({ error: 'Authentification unique non configurée (voir server/src/auth.ts)' });
  if (role !== 'rh' && !String(password ?? '').trim()) return res.status(400).json({ error: 'Mot de passe requis' });
  const s: SessionInfo = { ...(session(req) ?? { rh: false, managerId: null, collabId: null }), role };
  if (role === 'rh') s.rh = true;
  else {
    const opts = loginOptions()[role as 'manager' | 'collaborateur'];  // DEMO uniquement (vérifié plus haut)
    if (!opts.some(o => o.id === Number(empId))) return res.status(400).json({ error: 'Identifiant inconnu' });
    if (role === 'manager') s.managerId = Number(empId); else s.collabId = Number(empId);
  }
  writeSession(db, res, s);
  res.json(sessionPayload(req, s));
});

app.post('/api/logout', (req, res) => {
  const s = session(req);
  if (!s) return res.json(sessionPayload(req, null));
  const next: SessionInfo = { ...s, ...(s.role === 'rh' ? { rh: false } : s.role === 'manager' ? { managerId: null } : { collabId: null }) };
  writeSession(db, res, next);
  res.json(sessionPayload(req, next));
});

app.get('/api/data', (req, res) => {
  const user = authedUser(req);
  if (!user) return res.status(401).json({ error: 'Connexion requise' });
  res.json(buildSnapshot(db, user));
});

app.post('/api/actions/:name', (req, res) => {
  const user = authedUser(req);
  if (!user) return res.status(401).json({ error: 'Connexion requise' });
  const name = String(req.params.name);
  const handler = ACTIONS[name];
  if (!handler) return res.status(404).json({ error: `Action inconnue : ${name}` });
  try {
    const out = db.tx(() => {
      const ctx = makeCtx(db, user, loadFull(db, user));
      const r = handler(ctx, req.body ?? {});
      const o = typeof r === 'object' && r !== null ? r : { message: r };
      if (!QUIET_ACTIONS.has(name)) {
        db.insert('journal', { at: new Date().toISOString(), actor: user.nom, role: user.role, action: name, message: o.message ?? null, payload: req.body ?? {} });
      }
      return o;
    });
    res.json({ message: out.message ?? null, result: out.result, data: buildSnapshot(db, user) });
  } catch (err) {
    if (err instanceof ActionError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

app.get('/api/journal', (req, res) => {
  const user = authedUser(req);
  if (!user || user.role !== 'rh') return res.status(403).json({ error: 'Réservé au service RH' });
  const rows = db.sql.prepare('SELECT at, actor, role, action, message FROM journal ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

// — Intégration Keystone : appels entrants —
function keystoneAuth(req: Request, res: Response, next: NextFunction) {
  if (req.get('x-api-key') !== KEYSTONE_API_KEY) return res.status(401).json({ error: 'Clé API invalide' });
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
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const PORT = Number(process.env.CURSUS_API_PORT || process.env.PORT || 3210);
// CURSUS_HOST=127.0.0.1 limite l'accès au poste local (application de bureau).
const HOST = process.env.CURSUS_HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Cursus — API sur http://localhost:${PORT}${existsSync(dist) ? ' (application servie)' : ''}${DEMO ? ' · mode démonstration' : ''}`);
});
