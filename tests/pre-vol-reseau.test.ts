// Contrôles réseau du pré-vol (lot 8, chantier B, étape 2 ; server/src/pre-vol-reseau.ts, npm run verifier-production
// -- --url) : instance réelle (createApp) appelée comme à travers le proxy (en-têtes X-Forwarded-*), qui passe tous les
// contrôles ; faux serveurs pour chaque défaut (démonstration active, en-têtes retirés, http en clair, API Keystone
// ouverte, santé en panne, instance injoignable ou muette) ; adresse refusée ; la commande avec --url.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.KEYSTONE_API_KEY = 'cle-keystone-de-test';
delete process.env.CURSUS_DEMO;

const { controlesReseau, origineVerifiee } = await import('../server/src/pre-vol-reseau.ts');
const { createApp } = await import('../server/src/app.ts');
const { creerCompte } = await import('../server/src/comptes.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
const { nouvelleBase } = await import('./base.ts');
type Controle = import('../server/src/pre-vol.ts').Controle;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JETON = 'j'.repeat(40);
const niveaux = (cs: Controle[]) => Object.fromEntries(cs.map(c => [c.code, c.niveau]));

function ecouter(srv: Server): Promise<string> {
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)));
}

/**
 * `fetch` qui joue le proxy : https://cursus.test vers `https`, http://cursus.test vers `http` (en http local), avec
 * X-Forwarded-Proto et X-Forwarded-For comme Traefik.
 */
const proxy = (https: string, http: string | null): typeof fetch => async (entree, init) => {
  const u = new URL(String(entree));
  const vers = u.protocol === 'https:' ? https : http;
  if (!vers) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  const headers = new Headers(init?.headers);
  headers.set('x-forwarded-proto', u.protocol.slice(0, -1));
  headers.set('x-forwarded-for', '203.0.113.7');
  return await fetch(`${vers}${u.pathname}${u.search}`, { ...init, headers });
};

/** Exécute `f` avec des variables posées dans l'environnement du processus (lues par l'application à l'appel). */
async function avecEnv<T>(env: Record<string, string>, f: () => Promise<T>): Promise<T> {
  const avant = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await f(); } finally { for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('instance de production derrière le proxy : tous les contrôles réseau OK', async () => {
  const db = await nouvelleBase();
  await creerCompte(db, { type: 'local', identifiant: 'admin', nom: 'Rachel Martin', adresse: 'rachel.martin@entreprise.fr', profilRh: 'rh_admin' }, 'Ligne de commande');
  const retablir = reglerJournaux({ format: 'json', sortie: () => {} });
  const app = createServer(createApp(db, { dist: join(mkdtempSync(join(tmpdir(), 'cursus-reseau-')), 'absent'), production: true }));
  const redirection = createServer((req, res) => { res.writeHead(308, { location: `https://cursus.test${req.url}` }).end(); });
  try {
    const [https, http] = [await ecouter(app), await ecouter(redirection)];
    const env = { NODE_ENV: 'production', CURSUS_SUPERVISION_TOKEN: JETON, CURSUS_MAIL_FROM: 'cursus@entreprise.fr', CURSUS_MAIL_TENANT: '0f8fad5b-d9cb-469f-a165-70867728950e', CURSUS_MAIL_CLIENT_ID: 'app', CURSUS_MAIL_CLIENT_SECRET: 's'.repeat(40) };
    const cs = await avecEnv(env, async () => await controlesReseau('https://cursus.test/', { jeton: JETON, fetch: proxy(https, http), http: 'http://cursus.test' }));
    assert.deepEqual(cs.filter(c => c.niveau !== 'ok'), [], JSON.stringify(cs, null, 2));
    assert.deepEqual(cs.map(c => c.code), ['reseau.sante', 'reseau.mode', 'reseau.en-tetes', 'reseau.session', 'reseau.http', 'reseau.keystone']);
    assert.ok(cs.every(c => c.domaine === 'reseau'));
    assert.match(cs.find(c => c.code === 'reseau.keystone')!.message, /401 sans clé/);
    // Sans jeton : état seul, mode non vérifié (avertissement).
    const sansJeton = await avecEnv(env, async () => await controlesReseau('https://cursus.test', { fetch: proxy(https, http), http: 'http://cursus.test' }));
    assert.equal(niveaux(sansJeton)['reseau.mode'], 'attention');
    // Proxy qui ne dit pas « https » (CURSUS_TRUST_PROXY ne le croit pas) : pas de HSTS, remède dédié.
    const sansProto: typeof fetch = async (e, i) => {
      const u = new URL(String(e));
      return await fetch(`${u.protocol === 'https:' ? https : http}${u.pathname}`, i);
    };
    const hsts = (await avecEnv(env, async () => await controlesReseau('https://cursus.test', { jeton: JETON, fetch: sansProto, http: 'http://cursus.test' }))).find(c => c.code === 'reseau.en-tetes')!;
    assert.deepEqual([hsts.niveau, hsts.message], ['bloquant', 'En-têtes de sécurité absents de la réponse : HSTS.']);
    assert.match(hsts.remede!, /CURSUS_TRUST_PROXY/);
  } finally {
    app.close();
    redirection.close();
    retablir();
  }
});

test('défauts relevés : démonstration, en-têtes retirés, http en clair, API Keystone ouverte, santé en panne', async () => {
  // Instance mal publiée : démonstration active, proxy qui retire les en-têtes, Keystone servi sans clé.
  let scenario: 'demo' | 'panne' = 'demo';
  const faux = createServer((req, res) => {
    const json = (statut: number, corps: unknown, en?: Record<string, string>) => res.writeHead(statut, { 'content-type': 'application/json', ...en }).end(JSON.stringify(corps));
    if (scenario === 'demo') {
      if (req.url === '/api/health') return json(200, { statut: 'degrade', base: 'ok', mode: 'demo', alertes: ['donnees-demo', 'demo-base-commune'] });
      if (req.url === '/api/session') return json(200, { demo: true });
      return json(200, { openapi: '3.1.0' });
    }
    if (req.url === '/api/health') return json(503, { statut: 'indisponible', base: 'erreur' }, { 'strict-transport-security': 'max-age=1', 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' });
    if (req.url === '/api/session') return res.writeHead(502).end('Bad Gateway');
    return json(403, { error: 'Interdit' });
  });
  const clair = createServer((req, res) => { if (scenario === 'demo') res.writeHead(200).end('Cursus'); else res.writeHead(302, { location: 'https://cursus.test/' }).end(); });
  try {
    const [https, http] = [await ecouter(faux), await ecouter(clair)];
    const opts = { jeton: JETON, fetch: proxy(https, http), http: 'http://cursus.test' };
    const demo = await controlesReseau('https://cursus.test', opts);
    assert.deepEqual(niveaux(demo), {
      'reseau.sante': 'attention', 'reseau.mode': 'bloquant', 'reseau.en-tetes': 'bloquant', 'reseau.session': 'bloquant', 'reseau.http': 'bloquant', 'reseau.keystone': 'bloquant',
    });
    assert.match(demo[0].message, /« degrade » \(donnees-demo, demo-base-commune\)/);
    assert.match(demo.find(c => c.code === 'reseau.en-tetes')!.message, /HSTS, CSP, X-Frame-Options/);
    assert.match(demo.find(c => c.code === 'reseau.http')!.message, /répond 200 sans redirection vers https/);
    scenario = 'panne';
    const panne = await controlesReseau('https://cursus.test', opts);
    assert.deepEqual(niveaux(panne), {
      'reseau.sante': 'bloquant', 'reseau.mode': 'attention', 'reseau.en-tetes': 'ok', 'reseau.session': 'bloquant', 'reseau.http': 'attention', 'reseau.keystone': 'ok',
    });
    assert.match(panne[0].message, /\/api\/health répond 503 \(indisponible\)/);
    assert.match(panne.find(c => c.code === 'reseau.keystone')!.message, /403 sans clé/);
    // Santé sans détail ni en-têtes (« degrade » public) ; API Keystone non configurée (503).
    const muet = createServer((req, res) => res.writeHead(req.url === '/api/health' ? 200 : 503, { 'content-type': 'application/json' }).end(req.url === '/api/health' ? '{"statut":"degrade","base":"ok"}' : '{}'));
    const url = await ecouter(muet);
    try {
      const cs = await controlesReseau('https://cursus.test', { fetch: proxy(url, null) });
      assert.match(cs[0].message, /détail : relancez avec CURSUS_SUPERVISION_TOKEN/);
      assert.deepEqual([niveaux(cs)['reseau.http'], niveaux(cs)['reseau.keystone']], ['ok', 'attention'], 'port 80 fermé : rien en clair');
      assert.match(cs.find(c => c.code === 'reseau.http')!.message, /http:\/\/cursus\.test fermé/);
    } finally {
      muet.close();
    }
  } finally {
    faux.close();
    clair.close();
  }
});

test('instance injoignable ou muette, adresse refusée', async () => {
  // Port libéré aussitôt : connexion refusée.
  const ferme = createServer();
  const personne = await ecouter(ferme);
  await new Promise(ok => ferme.close(ok));
  const injoignable = await controlesReseau('https://cursus.test', { fetch: proxy(personne, null), http: 'http://cursus.test' });
  assert.deepEqual(niveaux(injoignable), { 'reseau.sante': 'bloquant', 'reseau.session': 'bloquant', 'reseau.http': 'ok', 'reseau.keystone': 'attention' });
  assert.match(injoignable[0].message, /injoignable : ECONNREFUSED/);
  // Serveur qui accepte la connexion sans jamais répondre : abandon au bout du délai.
  const muet = createServer(() => {});
  const url = await ecouter(muet);
  try {
    const cs = await controlesReseau('https://cursus.test', { fetch: proxy(url, null), delai: 200 });
    assert.match(cs[0].message, /pas de réponse dans le délai/);
  } finally {
    muet.closeAllConnections();
    muet.close();
  }
  // Adresse : https sans chemin attendue.
  for (const [url, motif] of [
    ['cursus.entreprise.fr', /n’est pas une adresse/], ['https://cursus.entreprise.fr/rh', /sans chemin/], ['https://moi:mdp@cursus.entreprise.fr', /ni identifiant/], ['ftp://cursus.entreprise.fr', /http\(s\) attendue/],
  ] as const) {
    const cs = await controlesReseau(url);
    assert.equal(cs.length, 1, url);
    assert.deepEqual([cs[0].code, cs[0].niveau], ['reseau.url', 'bloquant']);
    assert.match(cs[0].message, motif);
  }
  assert.deepEqual(origineVerifiee('https://cursus.entreprise.fr'), { origine: 'https://cursus.entreprise.fr' });
  // En http : signalé, les autres contrôles passent quand même (sans celui de la redirection).
  const enClair = await controlesReseau('http://cursus.test', { fetch: proxy(personne, null) });
  assert.deepEqual(enClair.map(c => c.code), ['reseau.url', 'reseau.sante', 'reseau.session', 'reseau.keystone']);
  assert.match(enClair[0].message, /n’est pas en https/);
});

test('commande : --url ajoute les contrôles réseau au rapport (JSON et texte)', async () => {
  const db = await nouvelleBase();
  const retablir = reglerJournaux({ format: 'json', sortie: () => {} });
  const srv = createServer(createApp(db, { dist: join(mkdtempSync(join(tmpdir(), 'cursus-reseau-')), 'absent'), production: false }));
  const lancer = (...args: string[]) => new Promise<{ code: number | null; out: string }>(ok => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/verifier-production.ts', '--config-seule', ...args], { cwd: ROOT, env: { PATH: process.env.PATH ?? '' } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('exit', code => ok({ code, out }));
  });
  try {
    const url = await ecouter(srv);
    const r = await lancer('--json', `--url=${url}`);
    assert.equal(r.code, 1, r.out);
    const sortie = JSON.parse(r.out);
    assert.equal(sortie.url, url);
    const reseau = (sortie.controles as Controle[]).filter(c => c.domaine === 'reseau');
    assert.deepEqual(reseau.map(c => c.code), ['reseau.url', 'reseau.sante', 'reseau.mode', 'reseau.en-tetes', 'reseau.session', 'reseau.keystone']);
    assert.equal(niveaux(reseau)['reseau.session'], 'ok', 'démonstration inactive');
    const texte = await lancer('--url', url);
    assert.match(texte.out, new RegExp(`· instance : ${url.replace(/\./g, '\\.')}\\n`));
    assert.match(texte.out, /\nRéseau\n {2}BLOQUANT {3}http:\/\/127\.0\.0\.1:\d+ n’est pas en https/);
  } finally {
    srv.close();
    retablir();
  }
});
