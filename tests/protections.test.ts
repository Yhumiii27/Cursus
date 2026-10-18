// Protections de l'API : falsification de requête (CSRF), limitation du débit (par adresse IP, par compte, connexion
// Microsoft, clés Keystone invalides ; 429 avec Retry-After, mémoire bornée) et neutralisation des formules dans les
// exports CSV. Les scénarios HTTP lancent un vrai serveur de démonstration (node server/src/index.ts) sur une base
// temporaire, depuis un dossier temporaire muni d'une interface minimale (CURSUS_DIST).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response } from 'express';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { LimiteParIp, openSession } = await import('../server/src/auth.ts');
const { DEBIT, LimiteurDebit, limiterDebit } = await import('../server/src/debit.ts');
const { celluleCsv, texteCsv } = await import('../shared/csv.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-protections-'));
mkdirSync(join(dir, 'dist'));
writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><html lang="fr"><title>Cursus</title><div id="root"></div></html>');
const procs: ChildProcess[] = [];
const fermer: (() => void)[] = [];
after(() => {
  procs.forEach(p => p.kill());
  fermer.forEach(f => f());
  rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => res(port));
    }).on('error', rej);
  });
}

/** Serveur de démonstration (session RH d'office), environnement minimal. */
async function serveur(name: string, env: Record<string, string> = {}) {
  const port = await freePort();
  const p = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_API_PORT: String(port), CURSUS_DB: join(dir, `${name}.db`), CURSUS_DIST: join(dir, 'dist'), CURSUS_DEMO: '1', CURSUS_TODAY: '2026-10-10', ...env },
  });
  procs.push(p);
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  await new Promise<void>((res, rej) => {
    const timer = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(timer); res(); } }, 20);
    p.on('exit', code => { clearInterval(timer); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const cookieOf = (r: globalThis.Response) => r.headers.get('set-cookie')?.match(/cursus_session=[^;]*/)?.[0] ?? null;
  const session = async () => cookieOf(await fetch(`${base}/api/session`))!;
  return { base, session, cookieOf };
}

// — CSRF —

test('CSRF : une requête qui modifie doit venir de l’interface de Cursus, en JSON ; rien n’est exécuté sinon', async () => {
  const srv = await serveur('csrf', { CURSUS_PUBLIC_URL: 'https://cursus.example.fr' });
  const cookie = await srv.session();
  const etatPaie = async () => {
    const ds = await (await fetch(`${srv.base}/api/data`, { headers: { cookie } })).json();
    // Feuilles transmises et lots de paie : une requête refusée ne crée aucun lot, même sans marquer de feuille.
    return { transmises: ds.feuilles.filter((f: { sage: boolean }) => f.sage).length, lots: ds.lotsPaie.map((l: { id: number }) => l.id) };
  };
  const avant = await etatPaie();
  const action = (nom: string, headers: Record<string, string>, body: string | undefined = '{}') =>
    fetch(`${srv.base}/api/actions/${nom}`, { method: 'POST', headers: { cookie, ...headers }, body });
  const refusee = async (headers: Record<string, string>, motif: RegExp, label: string) => {
    const r = await action('temps.pushSage', headers);
    assert.equal(r.status, 403, label);
    assert.match((await r.json()).error, motif, label);
  };
  // Preuve de l'audit : POST en texte brut depuis une autre origine, cookie de session joint par le navigateur.
  await refusee({ 'content-type': 'text/plain', origin: 'https://evil.example' }, /^Requête refusée : origine étrangère à Cursus/, 'texte brut, autre origine');
  await refusee({ 'content-type': 'text/plain' }, /corps JSON attendu/, 'texte brut sans origine');
  await refusee({ 'content-type': 'application/x-www-form-urlencoded', origin: srv.base }, /corps JSON attendu/, 'formulaire');
  await refusee({ 'content-type': 'application/json', origin: 'https://evil.example' }, /origine étrangère/, 'JSON, autre origine');
  await refusee({ 'content-type': 'application/json', origin: 'null' }, /origine étrangère/, 'origine « null »');
  await refusee({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, /autre site/, 'Sec-Fetch-Site cross-site');
  await refusee({ 'content-type': 'application/json', 'sec-fetch-site': 'same-site', origin: 'https://intranet.example.fr' }, /autre site/, 'sous-domaine voisin');
  assert.deepEqual(await etatPaie(), avant, 'aucune transmission à la paie');
  // L'interface de Cursus : même origine, JSON.
  const ok = await action('temps.pushSage', { 'content-type': 'application/json', origin: srv.base, 'sec-fetch-site': 'same-origin' });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).message, /feuilles marquées transmises — simulation/);
  assert.equal((await etatPaie()).lots.length, avant.lots.length + 1, 'la requête acceptée, elle, crée son lot');
  // Adresse publique (CURSUS_PUBLIC_URL) et nom transmis par le reverse proxy de confiance (X-Forwarded-Host).
  const silencieux = (headers: Record<string, string>) => action('parametres.maj', { 'content-type': 'application/json', ...headers }, JSON.stringify({ silent: true }));
  assert.equal((await silencieux({ origin: 'https://cursus.example.fr' })).status, 200, 'adresse publique');
  assert.equal((await silencieux({ origin: 'https://rh.entreprise.example', 'x-forwarded-host': 'rh.entreprise.example', 'x-forwarded-proto': 'https' })).status, 200, 'derrière le proxy');
  assert.equal((await silencieux({})).status, 200, 'client sans navigateur (ni Origin ni Sec-Fetch-Site), JSON');
  // Les lectures ne sont pas concernées ; la déconnexion, sans corps, passe.
  assert.equal((await fetch(`${srv.base}/api/data`, { headers: { cookie, origin: 'https://evil.example' } })).status, 200);
  assert.equal((await fetch(`${srv.base}/api/logout`, { method: 'POST', headers: { cookie, origin: srv.base } })).status, 200, 'déconnexion sans corps');
  // API Keystone : clé X-Api-Key, sans cookie ; contrôlée par ses propres règles, pas par la protection CSRF.
  const k = await fetch(`${srv.base}/api/integrations/keystone/v1/demandes`, {
    method: 'POST', headers: { 'x-api-key': 'demo-keystone', 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}',
  });
  assert.equal(k.status, 400);
  assert.equal((await k.json()).code, 'VALIDATION');
});

// — Limitation du débit —

test('limiteur à seau de jetons : rafale, recharge, Retry-After, clés indépendantes', () => {
  let t = 0;
  const l = new LimiteurDebit({ capacite: 3, parMinute: 60 }, () => t);
  assert.deepEqual([l.prendre('a'), l.prendre('a'), l.prendre('a')], [0, 0, 0], 'rafale de 3');
  assert.equal(l.prendre('a'), 1, 'seau vide : une requête par seconde');
  assert.equal(l.prendre('b'), 0, 'chaque clé a son seau');
  t = 500;
  assert.equal(l.prendre('a'), 1, 'demi-jeton : attendre encore');
  t = 1000;
  assert.equal(l.prendre('a'), 0, 'un jeton rechargé');
  t = 60_000;
  assert.deepEqual([l.prendre('a'), l.prendre('a'), l.prendre('a'), l.prendre('a')], [0, 0, 0, 1], 'jamais plus que la capacité');
  const lent = new LimiteurDebit({ capacite: 1, parMinute: 2 }, () => t);
  lent.prendre('x');
  assert.equal(lent.prendre('x'), 30, 'Retry-After en secondes');
});

test('limiteurs : mémoire bornée face à une multitude d’adresses, les clés actives sont gardées', () => {
  const t = 0;
  const l = new LimiteurDebit({ capacite: 2, parMinute: 60, maxCles: 100 }, () => t);
  l.prendre('actif'); l.prendre('actif');
  for (let i = 0; i < 99; i++) l.prendre(`ip-${i}`);
  l.prendre('actif'); // refusée, mais la clé redevient la plus récente
  // Une multitude de nouvelles adresses : la clé active, qui continue d'appeler (refusée), reste suivie.
  for (let i = 99; i < 5000; i++) {
    if (i % 50 === 0) assert.ok(l.prendre('actif') > 0, `appel ${i} : seau toujours vide`);
    l.prendre(`ip-${i}`);
  }
  assert.ok(l.taille <= 100, `${l.taille} clés suivies`);
  // Échecs de connexion par adresse : même borne ; Retry-After jusqu'à la fin de la fenêtre.
  let u = 0;
  const e = new LimiteParIp(3, 60_000, () => u, 100);
  for (let i = 0; i < 5000; i++) e.echec(`ip-${i}`);
  assert.ok(e.taille <= 100, `${e.taille} adresses suivies`);
  e.echec('a'); e.echec('a'); e.echec('a');
  u = 20_000;
  assert.equal(e.depasse('a'), true);
  assert.equal(e.attente('a'), 40);
  assert.equal(e.attente('inconnue'), 0);
});

test('débit de l’API : par adresse IP, par compte, connexion Microsoft ; 429 avec Retry-After et message en français', async () => {
  const db = new Db(':memory:');
  await seedDemo(db);
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use('/api', limiterDebit(db, {
    ip: new LimiteurDebit({ capacite: 6, parMinute: 1 }), compte: new LimiteurDebit({ capacite: 3, parMinute: 1 }), microsoft: new LimiteurDebit({ capacite: 2, parMinute: 1 }),
  }));
  app.use((_req, res) => { res.json({ ok: true }); });
  const http = app.listen(0, '127.0.0.1');
  await new Promise(res => http.once('listening', res));
  fermer.push(() => http.close());
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  // Cookie d'une session ouverte (compte de la RH de démonstration).
  let cookie = '';
  const res = { setHeader: (_: string, v: string) => { cookie = v.split(';')[0]; } } as unknown as Response;
  await openSession(db, res, { compteId: 1, role: 'rh', methode: 'demo' });
  const get = (path: string, ip: string, headers: Record<string, string> = {}) => fetch(base + path, { headers: { 'x-forwarded-for': ip, ...headers } });

  // Par compte : 3 requêtes, quelle que soit l'adresse (téléphone, poste, domicile).
  const parCompte = await Promise.all(['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4'].map(ip => get('/api/data', ip, { cookie })));
  assert.deepEqual(parCompte.map(r => r.status).sort(), [200, 200, 200, 429]);
  const refus = parCompte.find(r => r.status === 429)!;
  assert.match(refus.headers.get('retry-after') ?? '', /^\d+$/);
  assert.equal(Number(refus.headers.get('retry-after')), 60, 'un jeton par minute');
  assert.equal((await refus.json()).error, 'Trop de requêtes depuis ce poste : réessayez dans 60 secondes.');
  // Par adresse : 6 requêtes ; une autre adresse n'est pas touchée.
  const statuts = [];
  for (let i = 0; i < 7; i++) statuts.push((await get('/api/session', '198.51.100.9')).status);
  assert.deepEqual(statuts, [200, 200, 200, 200, 200, 200, 429]);
  assert.equal((await get('/api/session', '198.51.100.10')).status, 200);
  // Connexion Microsoft : limite propre ; une page ouverte par le navigateur reçoit un texte, pas du JSON.
  const ms = [];
  for (let i = 0; i < 3; i++) ms.push(await get('/api/auth/microsoft/retour?code=x&state=y', '198.51.100.20', { accept: 'text/html,application/xhtml+xml' }));
  assert.deepEqual(ms.map(r => r.status), [200, 200, 429]);
  assert.match(ms[2].headers.get('content-type') ?? '', /^text\/plain/);
  assert.match(await ms[2].text(), /^Trop de requêtes depuis ce poste : réessayez dans \d+ secondes?\.$/);
  assert.ok(Number(ms[2].headers.get('retry-after')) > 0);
});

test('serveur : limite par compte, refus de clés Keystone invalides, Retry-After sur la connexion', async () => {
  const srv = await serveur('debit');
  const rh = await srv.session();
  // Un autre compte (collaborateur de démonstration) : son seau est distinct.
  const opts = (await (await fetch(`${srv.base}/api/session`, { headers: { cookie: rh } })).json()).loginOptions;
  const login = await fetch(`${srv.base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'collaborateur', compteId: opts.collaborateur[0].id, password: 'x' }),
  });
  const collab = srv.cookieOf(login)!;
  // Rafale au-delà de la réserve du compte (quelques jetons se rechargent pendant l'envoi : deux par seconde).
  const n = DEBIT.compte.capacite + 60;
  const r = await Promise.all(Array.from({ length: n }, () => fetch(`${srv.base}/api/session`, { headers: { cookie: rh } })));
  const trop = r.filter(x => x.status === 429);
  assert.ok(trop.length >= 40 && trop.length <= 61, `${trop.length} refus sur ${n}`);
  assert.ok(Number(trop[0].headers.get('retry-after')) >= 1);
  assert.match((await trop[0].json()).error, /^Trop de requêtes depuis ce poste : réessayez dans/);
  assert.equal((await fetch(`${srv.base}/api/session`, { headers: { cookie: collab } })).status, 200, 'autre compte, même adresse');

  // Keystone : 60 appels sans clé valide en 5 minutes depuis une adresse, puis 429 sans lire la clé.
  const go = (ip: string, cle: string) => fetch(`${srv.base}/api/integrations/keystone/v1/chantiers/K-2614/go-no-go`, { headers: { 'x-api-key': cle, 'x-forwarded-for': ip } });
  const essais = [];
  for (let i = 0; i < 61; i++) essais.push((await go('203.0.113.50', `cle-${i}`)).status);
  assert.deepEqual([essais.filter(s => s === 401).length, essais.at(-1)], [60, 429]);
  const bloque = await go('203.0.113.50', 'demo-keystone');
  assert.equal(bloque.status, 429, 'même avec la bonne clé : rien n’est lu jusqu’à la fin de la période');
  assert.equal((await bloque.json()).code, 'TROP_DE_CLES_INVALIDES');
  const attente = Number(bloque.headers.get('retry-after'));
  assert.ok(attente > 250 && attente <= 300, `Retry-After ${attente}`);
  assert.equal((await go('203.0.113.51', 'demo-keystone')).status, 200, 'Keystone, depuis son adresse, n’est pas touché');

  // Connexion par mot de passe : le refus 429 des échecs répétés porte Retry-After (fin de la fenêtre de 15 minutes).
  const tenter = () => fetch(`${srv.base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.77' }, body: JSON.stringify({ identifiant: 'inconnu', motDePasse: 'x'.repeat(12) }),
  });
  for (let i = 0; i < 30; i++) assert.equal((await tenter()).status, 401);
  const refus = await tenter();
  assert.equal(refus.status, 429);
  const ra = Number(refus.headers.get('retry-after'));
  assert.ok(ra > 800 && ra <= 900, `Retry-After ${ra}`);
});

// — Exports CSV —

test('exports CSV : une cellule qui commence comme une formule est neutralisée', () => {
  assert.equal(celluleCsv('=1+2'), '\'=1+2');
  assert.equal(celluleCsv('+33 6 12 34 56 78'), '\'+33 6 12 34 56 78');
  assert.equal(celluleCsv('-2+3'), '\'-2+3');
  assert.equal(celluleCsv('@SOMME(A1:A9)'), '\'@SOMME(A1:A9)');
  assert.equal(celluleCsv('\t=cmd'), '\'\t=cmd');
  assert.equal(celluleCsv('\r=cmd'), '"\'\r=cmd"', 'retour chariot : neutralisé et entre guillemets');
  // Type de visa déclaré par un collaborateur, exporté ensuite par le RH.
  assert.equal(celluleCsv('=HYPERLINK("https://evil.example";"Visa")'), '"\'=HYPERLINK(""https://evil.example"";""Visa"")"');
  assert.equal(celluleCsv('=1;2'), '"\'=1;2"');
  // Le reste est inchangé : texte ordinaire, nombres (même négatifs), cellules vides.
  assert.equal(celluleCsv('Visa d’affaires'), 'Visa d’affaires');
  assert.equal(celluleCsv('Leroy; Antoine'), '"Leroy; Antoine"');
  assert.equal(celluleCsv(-3), '-3');
  assert.equal(celluleCsv(''), '');
  assert.equal(celluleCsv(null), '');
  assert.equal(texteCsv(['Nom', 'Type'], [['Mehdi Benali', '=1+1'], ['Karim Haddad', 12]]), '﻿Nom;Type\r\nMehdi Benali;\'=1+1\r\nKarim Haddad;12');
  // Tous les exports passent par downloadCsv (client/src/print.ts), qui écrit avec texteCsv.
  const fichiers = (d: string): string[] => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? fichiers(join(d, f)) : [join(d, f)]);
  const csv = fichiers(join(ROOT, 'client/src')).filter(f => /\.tsx?$/.test(f) && readFileSync(f, 'utf8').includes('text/csv;'));
  assert.deepEqual(csv.map(f => f.slice(ROOT.length)), ['client/src/print.ts']);
  assert.match(readFileSync(join(ROOT, 'client/src/print.ts'), 'utf8'), /const csv = texteCsv\(head, rows\);/);
});
