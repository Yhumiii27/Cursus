// Tests de sécurité : configuration de production, démonstration opt-in, clé Keystone,
// sessions (déconnexion, expiration, falsification, départ du salarié) et en-têtes HTTP.
// Les scénarios HTTP lancent de vrais serveurs (node server/src/index.ts) sur une base temporaire,
// depuis un dossier temporaire muni d'une interface minimale (dist/index.html, CURSUS_DIST) : aucun build requis.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

const { problemesConfig } = await import('../server/src/config.ts');
const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { openSession, purgeSessions, readSession, revokeSessionsOf } = await import('../server/src/auth.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-securite-'));
// Le serveur sert l'interface de CURSUS_DIST (dist/ du projet par défaut) : interface factice dans le dossier temporaire.
mkdirSync(join(dir, 'dist'));
writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><html lang="fr"><title>Cursus</title><div id="root"></div></html>');
const procs: ChildProcess[] = [];
after(() => {
  procs.forEach(p => p.kill());
  rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    }).on('error', rej);
  });
}

/** Lance le serveur avec un environnement minimal (rien n'est hérité : NODE_ENV, CURSUS_*…). */
function launch(name: string, env: Record<string, string>, port = 0) {
  const db = join(dir, `${name}.db`);
  const p = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_API_PORT: String(port), CURSUS_DB: db, CURSUS_DIST: join(dir, 'dist'), ...env },
  });
  procs.push(p);
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  return { p, db, out: () => out };
}

async function startServer(name: string, env: Record<string, string>) {
  const port = await freePort();
  const s = launch(name, env, port);
  await new Promise<void>((res, rej) => {
    const timer = setInterval(() => { if (s.out().includes('Cursus — API sur')) { clearInterval(timer); res(); } }, 20);
    s.p.on('exit', code => { clearInterval(timer); rej(new Error(`Serveur arrêté (code ${code}) :\n${s.out()}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = (path: string, init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) => fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  // fetch impose l'en-tête Host : `raw` l'envoie tel quel (requête adressée à un autre nom).
  const raw = (path: string, headers: Record<string, string>) => new Promise<{ status: number; cookie: string | null }>((res, rej) => {
    request({ host: '127.0.0.1', port, path, headers }, r => {
      r.resume();
      r.on('end', () => res({ status: r.statusCode!, cookie: String(r.headers['set-cookie'] ?? '').match(/cursus_session=[^;]*/)?.[0] ?? null }));
    }).on('error', rej).end();
  });
  return { ...s, base, call, raw };
}

/** Valeur du cookie de session posé par la réponse (`cursus_session=…`), sinon null. */
const cookieOf = (r: globalThis.Response) => r.headers.get('set-cookie')?.match(/cursus_session=[^;]*/)?.[0] ?? null;
const idOf = (cookie: string) => cookie.split('=')[1].split('.')[0];

const PROD_OK = { NODE_ENV: 'production', CURSUS_SECRET: 'x'.repeat(32), KEYSTONE_API_KEY: 'cle-keystone-de-test' };

test('configuration de production : chaque cas dangereux est refusé', () => {
  assert.deepEqual(problemesConfig(PROD_OK), []);
  const cas: [string, Record<string, string | undefined>, RegExp][] = [
    ['secret absent', { ...PROD_OK, CURSUS_SECRET: undefined }, /CURSUS_SECRET est absente/],
    ['secret trop court', { ...PROD_OK, CURSUS_SECRET: 'x'.repeat(31) }, /CURSUS_SECRET est trop courte \(31 caractères\)/],
    ['clé Keystone absente', { ...PROD_OK, KEYSTONE_API_KEY: undefined }, /KEYSTONE_API_KEY est absente/],
    ['clé Keystone de démonstration', { ...PROD_OK, KEYSTONE_API_KEY: 'demo-keystone' }, /clé de démonstration/],
    ['date du jour figée', { ...PROD_OK, CURSUS_TODAY: '2026-10-10' }, /CURSUS_TODAY est définie/],
    ['démonstration exposée au réseau', { ...PROD_OK, CURSUS_DEMO: '1', CURSUS_HOST: '0.0.0.0' }, /boucle locale.*0\.0\.0\.0/],
    ['démonstration exposée (HOST)', { ...PROD_OK, CURSUS_DEMO: '1', HOST: '192.168.1.20' }, /boucle locale.*192\.168\.1\.20/],
    // Écoute par défaut sur 127.0.0.1 : c'est aussi Cursus derrière le reverse proxy, donc publié.
    ['démonstration derrière le reverse proxy', { ...PROD_OK, CURSUS_DEMO: '1' }, /jamais derrière le reverse proxy.*127\.0\.0\.1 par défaut/],
    ['cookie sans Secure', { ...PROD_OK, CURSUS_INSECURE_COOKIE: '1' }, /CURSUS_INSECURE_COOKIE/],
  ];
  for (const [label, env, re] of cas) {
    const pbs = problemesConfig(env);
    assert.equal(pbs.length, 1, `${label} : ${pbs.join(' / ')}`);
    assert.match(pbs[0], re, label);
  }
  // Application de bureau (desktop/CursusApp.swift) : démonstration sur la boucle locale, en http://127.0.0.1.
  for (const host of ['127.0.0.1', 'localhost', '::1']) {
    assert.deepEqual(problemesConfig({ ...PROD_OK, CURSUS_DEMO: '1', CURSUS_HOST: host, CURSUS_INSECURE_COOKIE: '1', KEYSTONE_API_KEY: 'demo-keystone' }), [], host);
  }
  assert.deepEqual(problemesConfig({ ...PROD_OK, CURSUS_DEMO: '1', HOST: '127.0.0.1' }), [], 'boucle locale posée par HOST');
  assert.equal(problemesConfig({ ...PROD_OK, CURSUS_DEMO: '1', CURSUS_INSECURE_COOKIE: '1' }).length, 2, 'démonstration et cookie sans Secure, faute d’adresse explicite');
  assert.equal(problemesConfig({ CURSUS_DEMO: '0' }).length, 2, 'secret et clé Keystone signalés hors production');
});

test('production : refus de démarrer, chaque problème listé, code de sortie 1', async () => {
  const s = launch('refus', { NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_HOST: '0.0.0.0', CURSUS_TODAY: '2026-10-10', CURSUS_SECRET: 'court' });
  const code = await new Promise(res => s.p.on('exit', res));
  assert.equal(code, 1);
  for (const re of [/ne peut pas démarrer en production/, /CURSUS_SECRET est trop courte/, /KEYSTONE_API_KEY est absente/, /CURSUS_TODAY/, /mode démonstration/]) assert.match(s.out(), re);
  assert.equal(existsSync(s.db), false, 'aucune base ouverte');
});

test('démonstration désactivée par défaut : pas de session RH d’office, base vide non remplie, Keystone non configuré', async () => {
  const srv = await startServer('sans-demo', { CURSUS_HOST: '127.0.0.1' });
  const r = await srv.call('/api/session');
  const s = await r.json();
  assert.equal(s.demo, false);
  assert.equal(s.user, null);
  assert.equal(s.loginOptions, null);
  assert.equal(cookieOf(r), null, 'aucune session ouverte');
  assert.equal((await srv.call('/api/data')).status, 401);
  // Hors démonstration, pas de connexion libre : identifiant et mot de passe d'un compte (tests/comptes.test.ts).
  assert.equal((await srv.call('/api/login', { method: 'POST', body: { role: 'rh' } })).status, 400);
  assert.equal((await srv.call('/api/login', { method: 'POST', body: { role: 'rh', compteId: 1 } })).status, 400);
  const m = await srv.call('/api/mode', { method: 'POST', body: { role: 'rh' } });
  assert.equal(m.status, 401);
  assert.equal(cookieOf(m), null, 'pas de session anonyme hors démonstration');
  assert.equal((await srv.call('/api/actions/demo.reinitialiser', { method: 'POST', body: {} })).status, 401);
  assert.match(srv.out(), /Base vide : aucune donnée de démonstration chargée/);
  assert.equal(await new Db(srv.db).count('employes'), 0);
  // Sans KEYSTONE_API_KEY hors démonstration, l'intégration est fermée, même avec l'ancienne clé publiée.
  for (const key of [undefined, 'demo-keystone']) {
    const k = await srv.call('/api/integrations/keystone/chantiers/K-2614/go-no-go', { headers: key ? { 'x-api-key': key } : {} });
    assert.equal(k.status, 503);
    assert.equal((await k.json()).error, 'Intégration Keystone non configurée');
  }
  assert.equal((await srv.call('/api/integrations/keystone/demandes', { method: 'POST', body: {}, headers: { 'x-api-key': 'demo-keystone' } })).status, 503);
});

test('démonstration (CURSUS_DEMO=1) : clé Keystone, sessions et en-têtes', async t => {
  const srv = await startServer('demo', { CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', KEYSTONE_API_KEY: 'cle-keystone-de-test' });
  const db = new Db(srv.db);
  const go = '/api/integrations/keystone/chantiers/K-2614/go-no-go';

  await t.test('clé Keystone : absente ou mauvaise → 401, bonne → 200', async () => {
    assert.equal((await srv.call(go)).status, 401);
    assert.equal((await srv.call(go, { headers: { 'x-api-key': 'mauvaise-cle' } })).status, 401);
    assert.equal((await srv.call(go, { headers: { 'x-api-key': 'cle-keystone-de-test-mais-plus-longue' } })).status, 401);
    assert.equal((await srv.call(go, { headers: { 'x-api-key': 'demo-keystone' } })).status, 401, 'clé de démonstration écartée quand une clé est configurée');
    const ok = await srv.call(go, { headers: { 'x-api-key': 'cle-keystone-de-test' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).chantier, 'K-2614');
  });

  await t.test('session RH ouverte d’office en démonstration, puis changement d’espace sur la même session', async () => {
    const r = await srv.call('/api/session');
    const c = cookieOf(r)!;
    assert.ok(c, 'cookie posé');
    assert.match(r.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Max-Age=43200/);
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    const avant = await db.count('connexions');
    const m = await srv.call('/api/mode', { method: 'POST', cookie: c, body: { role: 'manager' } });
    assert.equal(cookieOf(m), null, 'même cookie');
    assert.equal(await db.count('connexions'), avant, 'aucune nouvelle session');
    assert.equal((await db.get<{ role: string }>('connexions', idOf(c)))!.role, 'manager');
  });

  await t.test('cookie rejoué après déconnexion → 401', async () => {
    const c = cookieOf(await srv.call('/api/session'))!;
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    const out = await srv.call('/api/logout', { method: 'POST', cookie: c });
    assert.equal((await out.json()).user, null);
    assert.notEqual(cookieOf(out), c, 'nouveau cookie sans l’espace fermé');
    assert.ok((await db.get<{ revocation: string | null }>('connexions', idOf(c)))!.revocation, 'session révoquée en base');
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401);
    assert.equal((await srv.call('/api/actions/parametres.maj', { method: 'POST', cookie: c, body: { silent: true } })).status, 401);
  });

  await t.test('session expirée → 401', async () => {
    const c = cookieOf(await srv.call('/api/session'))!;
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    db.sql.prepare('UPDATE connexions SET expiration = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), idOf(c));
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401);
  });

  await t.test('cookie falsifié → 401', async () => {
    const c = cookieOf(await srv.call('/api/session'))!;
    const [id, mac] = c.split('=')[1].split('.');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const forged = [
      `cursus_session=${id}.${flip(mac)}`,          // signature modifiée
      `cursus_session=${flip(id)}.${mac}`,          // identifiant modifié
      `cursus_session=${id}`,                        // sans signature
      // Ancien format (rôle en clair dans le cookie) : n'ouvre plus rien.
      `cursus_session=${Buffer.from(JSON.stringify({ role: 'rh', rh: true, managerId: null, collabId: null })).toString('base64url')}.${mac}`,
      'cursus_session=%E0%A4%A',                     // encodage invalide
    ];
    for (const f of forged) assert.equal((await srv.call('/api/data', { cookie: f })).status, 401, f);
  });

  await t.test('salarié sorti (date de fin passée) → 401 et session révoquée', async () => {
    const compteId = (await db.where<{ id: number }>('comptes', 'empId', 2))[0].id;
    const r = await srv.call('/api/login', { method: 'POST', body: { role: 'collaborateur', compteId, password: 'x' } });
    const c = cookieOf(r)!;
    assert.equal((await r.json()).user.empId, 2);
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    db.sql.prepare('UPDATE employes SET fin = ? WHERE id = ?').run('2026-10-09', 2);
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401);
    assert.ok((await db.get<{ revocation: string | null }>('connexions', idOf(c)))!.revocation);
    assert.equal((await srv.call('/api/login', { method: 'POST', body: { role: 'collaborateur', compteId, password: 'x' } })).status, 403, 'nouvelle connexion refusée');
    db.sql.prepare('UPDATE employes SET fin = NULL WHERE id = ?').run(2);
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401, 'la révocation est définitive');
  });

  await t.test('en-têtes de sécurité présents', async () => {
    for (const path of ['/api/session', '/collaborateurs']) {
      const r = await srv.call(path);
      assert.equal(r.status, 200, path);
      const h = r.headers;
      const csp = h.get('content-security-policy') ?? '';
      for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'"]) {
        assert.ok(csp.includes(d), `${path} : ${d}`);
      }
      assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
      assert.equal(h.get('x-content-type-options'), 'nosniff');
      assert.equal(h.get('referrer-policy'), 'same-origin');
      assert.equal(h.get('x-frame-options'), 'DENY');
      assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
      assert.match(h.get('permissions-policy') ?? '', /camera=\(\).*geolocation=\(\).*microphone=\(\)/);
      assert.equal(h.get('x-powered-by'), null);
      assert.equal(h.get('strict-transport-security'), null, 'pas de HSTS hors production');
    }
    assert.equal((await srv.call('/api/session')).headers.get('cache-control'), 'no-store');
    assert.match((await srv.call('/collaborateurs')).headers.get('content-type') ?? '', /text\/html/, 'interface servie');
  });
});

test('démonstration sans KEYSTONE_API_KEY : seule la clé de démonstration est acceptée', async () => {
  const srv = await startServer('demo-sans-cle', { CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10' });
  const go = '/api/integrations/keystone/chantiers/K-2614/go-no-go';
  assert.equal((await srv.call(go)).status, 401);
  assert.equal((await srv.call(go, { headers: { 'x-api-key': 'autre-cle' } })).status, 401);
  assert.equal((await srv.call(go, { headers: { 'x-api-key': 'demo-keystone-' } })).status, 401);
  const ok = await srv.call(go, { headers: { 'x-api-key': 'demo-keystone' } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).chantier, 'K-2614');
});

test('démonstration en production (application de bureau) : requêtes de ce poste seulement, jamais via le proxy', async () => {
  const srv = await startServer('demo-production', { ...PROD_OK, CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_INSECURE_COOKIE: '1' });
  assert.match(srv.out(), /mode démonstration/);
  const db = new Db(srv.db);
  const salaries = await db.count('employes');
  assert.ok(salaries > 0, 'données de démonstration chargées');

  // L'application de bureau s'adresse directement à 127.0.0.1 : servie normalement.
  const r = await srv.call('/api/session');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).demo, true);
  const c = cookieOf(r)!;
  assert.ok(c, 'session RH ouverte');
  assert.doesNotMatch(r.headers.get('set-cookie')!, /Secure/, 'http://127.0.0.1 : cookie sans Secure');
  for (const host of ['localhost', '[::1]']) assert.equal((await srv.raw('/api/session', { host: `${host}:3217` })).status, 200, host);

  // Requête relayée par Caddy ou nginx, ou adressée à un autre nom (DNS rebinding) : 403, aucune session.
  const relayees: Record<string, string>[] = [
    { 'x-forwarded-for': '203.0.113.9' },
    { 'x-forwarded-proto': 'https' },
    { forwarded: 'for=203.0.113.9;proto=https' },
    { 'x-forwarded-host': 'cursus.example.fr' },
    { 'x-real-ip': '203.0.113.9' },
  ];
  for (const headers of relayees) {
    const k = await srv.call('/api/session', { headers });
    assert.equal(k.status, 403, JSON.stringify(headers));
    assert.equal(cookieOf(k), null);
    assert.equal(k.headers.get('content-security-policy')?.startsWith("default-src 'self'"), true, 'en-têtes de sécurité conservés');
  }
  for (const host of ['cursus.example.fr', 'cursus.example.fr:443', '127.0.0.1.nip.io', 'evil.example:3217']) {
    const k = await srv.raw('/api/session', { host });
    assert.equal(k.status, 403, host);
    assert.equal(k.cookie, null);
  }
  assert.equal((await srv.call('/collaborateurs', { headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 403, 'interface refusée aussi');
  // Même muni d'un cookie valide, un visiteur relayé ne lit ni n'efface rien.
  const fwd = { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' };
  assert.equal((await srv.call('/api/data', { cookie: c, headers: fwd })).status, 403);
  assert.equal((await srv.call('/api/actions/demo.reinitialiser', { method: 'POST', cookie: c, body: {}, headers: fwd })).status, 403);
  assert.equal(await db.count('employes'), salaries);
  assert.equal((await srv.call('/api/data', { cookie: c })).status, 200, 'le poste lui-même reste servi');
  assert.match(srv.out(), /n’est pas admise derrière un reverse proxy/);
});

test('production : écoute sur la boucle locale, HSTS derrière le proxy HTTPS', async () => {
  const srv = await startServer('production', PROD_OK);
  assert.match(srv.out(), /API sur http:\/\/127\.0\.0\.1:/);
  assert.equal((await srv.call('/api/session')).headers.get('strict-transport-security'), null, 'requête en HTTP');
  const https = await srv.call('/api/session', { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(https.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal((await https.json()).demo, false);
});

test('sessions : révocation de toutes les sessions d’un salarié et purge des sessions expirées', async () => {
  const db = new Db(':memory:');
  await seedDemo(db);
  const res = { setHeader() {} } as unknown as Response;
  const req = (id: string) => ({ headers: { cookie: `cursus_session=${id}` } }) as unknown as Request;
  const cookies: string[] = [];
  const capture = { setHeader: (_: string, v: string) => cookies.push(v.match(/cursus_session=([^;]*)/)![1]) } as unknown as Response;
  const compte = async (empId: number) => (await db.where<{ id: number }>('comptes', 'empId', empId))[0].id;
  // Karim Haddad (12) encadre la Maintenance : espaces manager et collaborateur.
  await openSession(db, capture, { compteId: await compte(12), role: 'collaborateur', methode: 'local' });
  await openSession(db, capture, { compteId: await compte(12), role: 'manager', methode: 'local' });
  await openSession(db, capture, { compteId: await compte(2), role: 'collaborateur', methode: 'local' });
  assert.ok(await readSession(db, req(cookies[0])));
  assert.equal(await revokeSessionsOf(db, 12), 2);
  assert.equal(await readSession(db, req(cookies[0])), null);
  assert.equal(await readSession(db, req(cookies[1])), null);
  assert.ok(await readSession(db, req(cookies[2])), 'les autres salariés restent connectés');
  await openSession(db, res, { compteId: await compte(2), role: 'collaborateur', methode: 'local' }, new Date(Date.now() - 1000).toISOString());
  assert.equal(await purgeSessions(db), 1);
  assert.equal(await db.count('connexions'), 3);
});
