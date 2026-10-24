// Couche HTTP montée dans le processus du test (createApp, server/src/app.ts), sans lancer de serveur : réponses
// d'erreur en JSON (action ou adresse /api inconnue, JSON illisible, corps de plus de 2 Mo, erreur imprévue sans pile
// d'appels), protections (CSRF, espace changé, cookie altéré), périmètre du manager, compression (brotli, gzip) et cache
// (fichiers hachés d'un an, index.html revalidé, API jamais en cache), journal des requêtes (une ligne JSON, sans corps
// ni paramètres). Les scénarios de démarrage et d'arrêt restent dans tests/exploitation.test.ts (vrais serveurs).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import express from 'express';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { CACHE_ASSETS, CACHE_PAGE, createApp } = await import('../server/src/app.ts');
const { encodageAccepte, SEUIL_COMPRESSION } = await import('../server/src/compression.ts');
const { ADRESSE_INCONNUE, CORPS_TROP_VOLUMINEUX, ERREUR_INTERNE, JSON_ILLISIBLE, gestionnaireErreurs } = await import('../server/src/erreurs.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
const { regleDe } = await import('../server/src/journal.ts');
const { refusNavigation } = await import('../server/src/securite.ts');

const dir = mkdtempSync(join(tmpdir(), 'cursus-http-'));
// Interface factice : index.html, un script haché assez gros pour être compressé, une police déjà compressée.
const dist = join(dir, 'dist');
mkdirSync(join(dist, 'assets'), { recursive: true });
const PAGE = '<!doctype html><html lang="fr"><title>Cursus</title><div id="root"></div></html>';
const SCRIPT = `console.log(${JSON.stringify('Cursus '.repeat(4000))});\n`;
writeFileSync(join(dist, 'index.html'), PAGE);
writeFileSync(join(dist, 'assets', 'index-ABCD1234.js'), SCRIPT);
writeFileSync(join(dist, 'assets', 'inter-latin-400.woff2'), Buffer.alloc(4096, 7));

const db = new Db(join(dir, 'cursus.db'));
await migrate(db);
await appliquerMigrations(db);
await seedDemo(db);
// Panne imprévue d'une action (erreur qui n'est pas un refus) : visible du seul journal du serveur.
ACTIONS['essai.panne'] = () => { throw new Error('panne simulée : base 42 introuvable'); };

/** Lignes écrites dans les journaux du serveur pendant le test (format JSON). */
const lignes: { ligne: string; niveau: string }[] = [];
const retablir = reglerJournaux({ format: 'json', sortie: (ligne, niveau) => { lignes.push({ ligne, niveau }); } });

function ecouter(app: express.Express): Promise<{ serveur: Server; port: number }> {
  return new Promise(ok => { const serveur = app.listen(0, '127.0.0.1', () => ok({ serveur, port: (serveur.address() as AddressInfo).port })); });
}
let srv: Server, port: number, sansCompression: Server, portSans: number;
before(async () => {
  ({ serveur: srv, port } = await ecouter(createApp(db, { dist, production: false })));
  ({ serveur: sansCompression, port: portSans } = await ecouter(createApp(db, { dist, production: false, compression: false, journalRequetes: false })));
});
after(() => {
  retablir();
  delete ACTIONS['essai.panne'];
  srv.close();
  sansCompression.close();
  db.sql.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Reponse { status: number; headers: IncomingHttpHeaders; corps: Buffer; json: () => { error?: string } & Record<string, unknown> }
/** Requête brute (aucune décompression automatique, en-têtes envoyés tels quels). */
function appel(chemin: string, o: { method?: string; headers?: Record<string, string>; corps?: string | Buffer; port?: number } = {}): Promise<Reponse> {
  return new Promise((ok, ko) => {
    const req = request({ host: '127.0.0.1', port: o.port ?? port, path: chemin, method: o.method ?? 'GET', headers: o.headers }, r => {
      const morceaux: Buffer[] = [];
      r.on('data', (m: Buffer) => morceaux.push(m));
      r.on('error', ko); // connexion coupée en cours de réponse
      r.on('end', () => {
        const corps = Buffer.concat(morceaux);
        ok({ status: r.statusCode!, headers: r.headers, corps, json: () => JSON.parse(corps.toString('utf8')) });
      });
    }).on('error', ko);
    req.end(o.corps);
  });
}
const json = (corps: unknown, en: Record<string, string> = {}) => ({ method: 'POST', corps: JSON.stringify(corps), headers: { 'content-type': 'application/json', ...en } });

/** Session de démonstration (espace RH ouvert à la première visite). */
async function session(): Promise<string> {
  const r = await appel('/api/session');
  return String(r.headers['set-cookie']).match(/cursus_session=[^;]*/)![0];
}

// — Erreurs : toujours du JSON —

test('erreurs : action inconnue, adresse /api inconnue, JSON illisible, corps de plus de 2 Mo → JSON, jamais de page HTML', async () => {
  const cookie = await session();
  const inconnue = await appel('/api/actions/rien.du.tout', json({}, { cookie }));
  assert.equal(inconnue.status, 404);
  assert.deepEqual(inconnue.json(), { error: 'Action inconnue : rien.du.tout' });

  for (const [method, chemin] of [['GET', '/api'], ['GET', '/api/inconnu'], ['POST', '/api/inconnu'], ['GET', '/api/actions'], ['DELETE', '/api/data']] as const) {
    const r = await appel(chemin, { method, headers: { cookie, 'content-type': 'application/json' } });
    assert.equal(r.status, 404, `${method} ${chemin}`);
    assert.match(String(r.headers['content-type']), /^application\/json/);
    assert.deepEqual(r.json(), { error: ADRESSE_INCONNUE });
    assert.equal(r.headers['cache-control'], 'no-store');
  }

  const illisible = await appel('/api/login', { method: 'POST', corps: '{mauvais', headers: { 'content-type': 'application/json' } });
  assert.equal(illisible.status, 400);
  assert.match(String(illisible.headers['content-type']), /^application\/json/);
  assert.deepEqual(illisible.json(), { error: JSON_ILLISIBLE });
  assert.doesNotMatch(illisible.corps.toString(), /SyntaxError|at JSON\.parse|node_modules/);

  const gros = await appel('/api/actions/parametres.maj', json({ texte: 'x'.repeat(2 * 1024 * 1024 + 10) }, { cookie }));
  assert.equal(gros.status, 413);
  assert.deepEqual(gros.json(), { error: CORPS_TROP_VOLUMINEUX });
  // Juste sous la limite : le corps est lu et l'action exécutée.
  assert.equal((await appel('/api/actions/parametres.maj', json({ silent: true, x: 'x'.repeat(1024 * 1024) }, { cookie }))).status, 200);
});

test('erreur imprévue : 500 « Erreur interne » sans pile ni message, la pile va au journal du serveur', async () => {
  const cookie = await session();
  lignes.length = 0;
  const r = await appel('/api/actions/essai.panne', json({}, { cookie }));
  assert.equal(r.status, 500);
  assert.deepEqual(r.json(), { error: ERREUR_INTERNE });
  assert.doesNotMatch(r.corps.toString(), /panne simulée|at |\.ts/);
  await new Promise(ok => setImmediate(ok));
  const erreur = lignes.map(l => JSON.parse(l.ligne)).find(l => l.message.startsWith('Erreur interne'));
  assert.ok(erreur, lignes.map(l => l.ligne).join('\n'));
  assert.equal(erreur.niveau, 'erreur');
  assert.equal(erreur.message, 'Erreur interne : POST /api/actions/essai.panne');
  assert.match(erreur.pile, /panne simulée : base 42 introuvable\n\s+at /);

  // Gestionnaire final : erreur jetée par une route quelconque, ou refus 4xx d'un module (encodage inconnu…).
  const app = express();
  app.set('env', 'test'); // réponse commencée : Express coupe la connexion sans écrire la pile sur la console du test
  app.get('/api/jette', () => { throw new Error('secret interne'); });
  app.get('/api/refus', () => { throw Object.assign(new Error('encodage'), { status: 415, type: 'encoding.unsupported' }); });
  app.get('/api/absent', () => { throw Object.assign(new Error('absent'), { statusCode: 404 }); });
  app.get('/api/commencee', (_req, res) => { res.write('{"debut":'); throw new Error('réponse commencée'); });
  app.use(gestionnaireErreurs());
  const { serveur, port: p } = await ecouter(app);
  try {
    const jette = await appel('/api/jette', { port: p });
    assert.equal(jette.status, 500);
    assert.deepEqual(jette.json(), { error: ERREUR_INTERNE });
    assert.doesNotMatch(jette.corps.toString(), /secret interne/);
    assert.equal((await appel('/api/refus', { port: p })).status, 415);
    assert.deepEqual((await appel('/api/refus', { port: p })).json(), { error: 'Requête refusée' });
    assert.deepEqual((await appel('/api/absent', { port: p })).json(), { error: 'Introuvable' });
    // Réponse commencée : Express coupe la connexion (le client voit une réponse tronquée ou une erreur réseau).
    await appel('/api/commencee', { port: p }).then(r => assert.doesNotMatch(r.corps.toString(), /Erreur interne/), () => {});
  } finally {
    serveur.close();
  }
});

// — Protections et périmètre —

test('protections : sans session 401, cookie altéré 401, Origin étrangère 403 (CSRF), espace changé 409, données du manager limitées', async () => {
  assert.equal((await appel('/api/data')).status, 401);
  assert.equal((await appel('/api/actions/parametres.maj', json({}))).status, 401);
  const cookie = await session();
  const altere = cookie.replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
  assert.equal((await appel('/api/data', { headers: { cookie: altere } })).status, 401, 'signature altérée');

  // Requête qui modifie, émise par une page d'un autre site : refusée avant toute exécution.
  for (const en of [{ origin: 'https://ailleurs.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }] as Record<string, string>[]) {
    const r = await appel('/api/actions/parametres.maj', json({ silent: true }, { cookie, ...en }));
    assert.equal(r.status, 403, JSON.stringify(en));
    assert.match(r.json().error!, /^Requête refusée : /);
  }
  const texte = await appel('/api/actions/parametres.maj', { method: 'POST', corps: 'silent=1', headers: { cookie, 'content-type': 'text/plain' } });
  assert.equal(texte.status, 403, 'corps non JSON (formulaire d’un autre site)');
  // Même origine (adresse de la requête) : admise.
  assert.equal((await appel('/api/actions/parametres.maj', json({ silent: true }, { cookie, origin: `http://127.0.0.1:${port}` }))).status, 200);

  // L'onglet affiche l'espace manager alors que la session est passée à l'espace RH : refus 409, rien d'exécuté.
  const change = await appel('/api/actions/parametres.maj', json({ silent: true }, { cookie, 'x-cursus-espace': 'manager' }));
  assert.equal(change.status, 409);
  assert.match(change.json().error!, /Espace changé dans un autre onglet/);
  assert.equal((await appel('/api/data', { headers: { cookie, 'x-cursus-espace': 'collaborateur' } })).status, 409);

  // Karim Haddad, manager de la Maintenance : seuls les salariés de son équipe ; action réservée au service RH : 403.
  const rh = (await appel('/api/data', { headers: { cookie } })).json() as { employes: unknown[] };
  const karim = (await db.one('SELECT id FROM comptes WHERE emp_id = 12')) as { id: number };
  const connexion = await appel('/api/login', json({ role: 'manager', compteId: karim.id, password: 'x' }, { cookie }));
  assert.equal(connexion.status, 200);
  const mgrCookie = String(connexion.headers['set-cookie']).match(/cursus_session=[^;]*/)![0];
  const mgr = (await appel('/api/data', { headers: { cookie: mgrCookie, 'x-cursus-espace': 'manager' } })).json() as { employes: { equipe: string | null }[] };
  assert.ok(mgr.employes.length > 0 && mgr.employes.length < rh.employes.length, `${mgr.employes.length} sur ${rh.employes.length}`);
  const refus = await appel('/api/actions/parametres.maj', json({ silent: true }, { cookie: mgrCookie, 'x-cursus-espace': 'manager' }));
  assert.equal(refus.status, 403);
  assert.ok(refus.json().error);
  assert.equal((await appel('/api/data', { headers: { cookie } })).status, 401, 'session précédente révoquée par la nouvelle connexion');
});

// — Noms d'action et navigations provoquées (lot 8, chantier C) —

const lignesJournal = async (action?: string) => Number(((await db.one(action ? 'SELECT COUNT(*) AS n FROM journal WHERE action = ?' : 'SELECT COUNT(*) AS n FROM journal', action ? [action] : [])) as { n: number }).n);

test('registre des actions : un nom hérité (constructor, __proto__, toString…) est une action inconnue, rien n’est écrit au journal', async () => {
  const cookie = await session();
  const avant = await lignesJournal();
  for (const nom of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__']) {
    const r = await appel(`/api/actions/${nom}`, json({}, { cookie }));
    assert.equal(r.status, 404, nom);
    assert.deepEqual(r.json(), { error: `Action inconnue : ${nom}` });
  }
  assert.equal(await lignesJournal(), avant, 'aucune ligne « constructor » au journal signé');
  // Règle du journal lue de même sur ses seules clés.
  for (const nom of ['constructor', '__proto__', 'toString']) assert.equal(regleDe(nom), undefined, nom);
  assert.ok(regleDe('employe.modifier'));
});

test('navigation provoquée depuis un autre site : fichier de paie, données d’un salarié et archive paie exigent l’en-tête d’espace', async () => {
  const cookie = await session();
  const lot = (await db.one('SELECT MAX(id) AS id FROM lots_paie') as { id: number | null }).id ?? 1;
  const espace = { cookie, 'x-cursus-espace': 'rh' };
  for (const chemin of [`/api/paie/lots/${lot}/fichier`, '/api/salaries/2/donnees', '/api/journal?vue=archive']) {
    const avant = await lignesJournal();
    // Lien ou redirection depuis un autre site (cookie SameSite=Lax envoyé), ou navigation sans l'en-tête de l'interface.
    for (const en of [{ cookie, 'sec-fetch-site': 'cross-site' }, { cookie, 'sec-fetch-site': 'same-site' }, { cookie, 'sec-fetch-site': 'none' }, { cookie }, { cookie, 'x-cursus-espace': 'admin' }, { ...espace, 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
      const r = await appel(chemin, { headers: en });
      assert.equal(r.status, 403, `${chemin} ${JSON.stringify(en)}`);
      assert.match(r.json().error!, /^Requête refusée : /);
    }
    assert.equal(await lignesJournal(), avant, `${chemin} : refus sans trace`);
    // Appel de l'interface (fetch de même origine, en-tête d'espace) : la route répond et trace.
    const r = await appel(chemin, { headers: { ...espace, 'sec-fetch-site': 'same-origin' } });
    assert.notEqual(r.status, 403, chemin);
  }
  assert.equal(await lignesJournal('salarie.export'), 1);
  assert.equal(await lignesJournal('journal.archive'), 1);
  // Le reste du journal (vue Tout) n'est pas concerné : il ne trace rien.
  assert.equal((await appel('/api/journal', { headers: { cookie } })).status, 200);
});

test('refusNavigation : deux niveaux (lien : Sec-Fetch-Site ; appel : Sec-Fetch-Site et en-tête d’espace)', () => {
  const req = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] }) as never;
  assert.equal(refusNavigation(req({}), 'lien'), null, 'navigateur sans Sec-Fetch-Site');
  assert.equal(refusNavigation(req({ 'sec-fetch-site': 'same-origin' }), 'lien'), null);
  assert.equal(refusNavigation(req({ 'sec-fetch-site': 'none' }), 'lien'), null, 'adresse tapée, favori');
  assert.match(refusNavigation(req({ 'sec-fetch-site': 'cross-site' }), 'lien')!, /autre site/);
  assert.match(refusNavigation(req({ 'sec-fetch-site': 'same-site' }), 'lien')!, /autre site/);
  assert.match(refusNavigation(req({}), 'appel')!, /interface de Cursus/);
  assert.match(refusNavigation(req({ 'x-cursus-espace': 'constructor' }), 'appel')!, /interface de Cursus/);
  assert.equal(refusNavigation(req({ 'x-cursus-espace': 'collaborateur' }), 'appel'), null);
});

// — Compression et cache —

test('compression : brotli de préférence, sinon gzip, contenu identique ; ni petite réponse, ni police, ni HEAD, ni 206', async () => {
  assert.equal(encodageAccepte('gzip, deflate, br, zstd'), 'br');
  assert.equal(encodageAccepte('br;q=0, gzip;q=0.8'), 'gzip');
  assert.equal(encodageAccepte('*'), 'br');
  assert.equal(encodageAccepte('gzip;q=0, *;q=0.5'), 'br');
  assert.equal(encodageAccepte('identity'), null);
  assert.equal(encodageAccepte(undefined), null);
  assert.equal(encodageAccepte('br;q=abc'), null, 'poids illisible : refusé');

  const chemin = '/assets/index-ABCD1234.js';
  const br = await appel(chemin, { headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers['content-length'], undefined);
  assert.match(String(br.headers.vary), /Accept-Encoding/);
  assert.match(String(br.headers.etag), /^W\//, 'ETag faible : la version compressée diffère octet pour octet');
  assert.equal(brotliDecompressSync(br.corps).toString(), SCRIPT);
  assert.ok(br.corps.length < SCRIPT.length / 10, `${br.corps.length} octets`);

  const gz = await appel(chemin, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.corps).toString(), SCRIPT);

  const brut = await appel(chemin);
  assert.equal(brut.headers['content-encoding'], undefined, 'client sans Accept-Encoding');
  assert.equal(brut.corps.toString(), SCRIPT);
  assert.match(String(brut.headers.vary), /Accept-Encoding/, 'les caches distinguent les versions');

  const tete = await appel(chemin, { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
  assert.equal(tete.headers['content-encoding'], undefined);
  assert.equal(tete.headers['content-length'], String(Buffer.byteLength(SCRIPT)));
  const partie = await appel(chemin, { headers: { 'accept-encoding': 'br', range: 'bytes=0-99' } });
  assert.equal(partie.status, 206);
  assert.equal(partie.headers['content-encoding'], undefined);
  assert.equal(partie.corps.length, 100);
  const police = await appel('/assets/inter-latin-400.woff2', { headers: { 'accept-encoding': 'br' } });
  assert.equal(police.headers['content-encoding'], undefined, 'woff2 déjà compressé');

  // Instantané JSON : compressé ; petite réponse (session) : non, en deçà du seuil.
  const cookie = await session();
  const data = await appel('/api/data', { headers: { cookie, 'accept-encoding': 'br' } });
  assert.equal(data.headers['content-encoding'], 'br');
  assert.equal(data.headers['cache-control'], 'no-store');
  assert.ok(Array.isArray(JSON.parse(brotliDecompressSync(data.corps).toString()).employes));
  const action = await appel('/api/actions/parametres.maj', json({ silent: true }, { cookie, 'accept-encoding': 'gzip' }));
  assert.equal(action.headers['content-encoding'], 'gzip', 'réponse d’action avec l’instantané');
  assert.ok('data' in JSON.parse(gunzipSync(action.corps).toString()));
  const petite = await appel('/api/health', { headers: { 'accept-encoding': 'br' } });
  assert.ok(petite.corps.length < SEUIL_COMPRESSION);
  assert.equal(petite.headers['content-encoding'], undefined);

  // CURSUS_COMPRESSION=0 (proxy qui compresse déjà) : rien n'est compressé par Cursus.
  const sans = await appel(chemin, { port: portSans, headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(sans.headers['content-encoding'], undefined);
  assert.equal(sans.corps.toString(), SCRIPT);
});

test('cache : /assets un an et immuable, index.html revalidé, fichier absent 404 (jamais la page), API jamais en cache', async () => {
  const script = await appel('/assets/index-ABCD1234.js');
  assert.equal(script.headers['cache-control'], CACHE_ASSETS);
  assert.equal(CACHE_ASSETS, 'public, max-age=31536000, immutable');
  assert.match(String(script.headers['content-type']), /javascript/);
  const absent = await appel('/assets/index-ANCIEN.js');
  assert.equal(absent.status, 404, 'script d’une version précédente : 404, pas index.html');
  assert.match(String(absent.headers['content-type']), /^text\/plain/);

  for (const chemin of ['/', '/collaborateurs', '/index.html']) {
    const page = await appel(chemin);
    assert.equal(page.status, 200, chemin);
    assert.equal(page.headers['cache-control'], CACHE_PAGE, chemin);
    assert.equal(page.corps.toString(), PAGE);
    // Revalidation : 304 sans corps tant que la page n'a pas changé.
    const encore = await appel(chemin, { headers: { 'if-none-match': String(page.headers.etag) } });
    assert.equal(encore.status, 304, chemin);
  }
  for (const chemin of ['/api', '/api/session', '/api/health', '/api/inconnu']) assert.equal((await appel(chemin)).headers['cache-control'], 'no-store', chemin);
});

// — Journal des requêtes —

test('journal des requêtes : une ligne JSON (heure, méthode, chemin sans paramètres, statut, durée, compte), jamais le corps', async () => {
  const cookie = await session();
  lignes.length = 0;
  await appel('/api/data?nom=Dupont&naissance=1985', { headers: { cookie } });
  await appel('/api/actions/parametres.maj', json({ silent: true, motif: 'Arrêt maladie de Jeanne Martin' }, { cookie }));
  await appel('/api/inconnu');
  await appel('/api/health');
  await appel('/api/actions/essai.panne', json({}, { cookie }));
  await new Promise(ok => setTimeout(ok, 20));
  const requetes = lignes.map(l => ({ ...JSON.parse(l.ligne), flux: l.niveau })).filter(l => l.type === 'requete');
  assert.deepEqual(requetes.map(r => `${r.methode} ${r.chemin} ${r.statut}`), [
    'GET /api/data 200', 'POST /api/actions/parametres.maj 200', 'GET /api/inconnu 404', 'POST /api/actions/essai.panne 500',
  ], 'sonde de santé réussie non écrite');
  const [data, action, inconnue, panne] = requetes;
  assert.match(data.heure, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(typeof data.duree_ms, 'number');
  assert.equal(typeof data.compte, 'number', 'compte connecté');
  assert.equal(data.compte, action.compte);
  assert.equal(inconnue.compte, null, 'sans session');
  assert.equal(data.niveau, 'info');
  assert.equal(panne.niveau, 'erreur');
  assert.equal(panne.flux, 'erreur', 'erreur 500 : sortie d’erreur');
  assert.match(data.message, /^GET \/api\/data → 200 · \d+ ms · compte \d+$/);
  const tout = lignes.map(l => l.ligne).join('\n');
  for (const secret of ['Dupont', '1985', 'Jeanne Martin', 'silent', 'cursus_session']) assert.ok(!tout.includes(secret), `« ${secret} » absent des journaux`);
});
