// Application installable (lot 11, chantier C2, étape 2) : service worker écrit à la main (client/public/sw.js), contrôlé
// sans navigateur, en lisant le fichier et en le faisant tourner dans un bac à sable (vm) avec un faux navigateur ;
// version injectée par le plugin de vite.config.ts ; manifeste, icônes et balises de la page ; /sw.js servi en no-cache,
// démonstration comprise, et 404 quand CURSUS_PWA=0 ; application de bureau qui la coupe.
// - Aucune réponse /api n'est servie ni gardée par le service worker (instantané, pièces justificatives, connexion,
//   agenda, fichiers de paie), quelle que soit la méthode ; rien hors de l'origine ; skipWaiting seulement sur demande.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';

const { createApp } = await import('../server/src/app.ts');
const { nouvelleBase } = await import('./base.ts');
const { problemesPwa, pwaActive } = await import('../server/src/config.ts');
const { swCursus } = await import('../vite.config.ts');
const { ALLOWED_VIEWS } = await import('../shared/constants.ts');

const lire = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SW = lire('client/public/sw.js');

// — Service worker : faux navigateur —

interface Appel { quoi: string; url?: string }
/** Exécute sw.js avec un faux `self`, `caches` et `fetch` ; rend ses écouteurs et le journal des appels. */
function bacASable(source = SW) {
  const ecouteurs: Record<string, (e: unknown) => void> = {};
  const journal: Appel[] = [];
  const caches = {
    open: async () => ({
      addAll: async (l: { url: string }[]) => { for (const r of l) journal.push({ quoi: 'garder', url: new URL(r.url).pathname }); },
      put: async (r: { url: string } | string) => { journal.push({ quoi: 'garder', url: new URL(typeof r === 'string' ? r : r.url, 'https://cursus.test').pathname }); },
    }),
    match: async (r: { url: string } | string) => { journal.push({ quoi: 'lireCache', url: typeof r === 'string' ? r : new URL(r.url).pathname }); return undefined; },
    keys: async () => ['cursus-coque-ancienne', 'cursus-coque-dev', 'autre-cache'],
    delete: async (n: string) => { journal.push({ quoi: 'effacerCache', url: n }); return true; },
  };
  const self = {
    location: { origin: 'https://cursus.test' },
    addEventListener: (t: string, f: (e: unknown) => void) => { ecouteurs[t] = f; },
    skipWaiting: () => { journal.push({ quoi: 'skipWaiting' }); },
    clients: { claim: async () => { journal.push({ quoi: 'claim' }); } },
  };
  class Requete { url: string; cache?: string; constructor(u: string, o: { cache?: string } = {}) { this.url = new URL(u, 'https://cursus.test').href; this.cache = o.cache; } }
  const fetch = async (r: { url: string }) => { journal.push({ quoi: 'reseau', url: new URL(r.url).pathname }); return { ok: true, type: 'basic', clone() { return this; } }; };
  runInNewContext(source, { self, caches, fetch, Request: Requete, URL, Response: { error: () => ({ erreur: true }) }, setTimeout, clearTimeout, AbortController, console });
  /** Requête vue par le gestionnaire fetch : vrai si le service worker y répond. */
  const requete = (url: string, o: { method?: string; mode?: string } = {}) => {
    let repond = false;
    ecouteurs.fetch({ request: { url: new URL(url, 'https://cursus.test').href, method: o.method ?? 'GET', mode: o.mode ?? 'cors' }, respondWith: (p: Promise<unknown>) => { repond = true; void p; } });
    return repond;
  };
  return { ecouteurs, journal, requete };
}

test('service worker : aucune adresse /api servie ni gardée, quelle que soit la méthode ou le mode', async () => {
  const b = bacASable();
  for (const url of ['/api/data', '/api/pieces/12', '/api/pieces/12?telecharger=1', '/api/auth/microsoft', '/api/agenda/jeton.ics', '/api/paie/lots/3/fichier', '/api', '/api/push/cle']) {
    assert.equal(b.requete(url), false, url);
    assert.equal(b.requete(url, { mode: 'navigate' }), false, `${url} (navigation)`);
  }
  assert.equal(b.requete('/api/actions/temps.saisir', { method: 'POST' }), false);
  assert.equal(b.requete('/assets/index-ABCD.js', { method: 'POST' }), false, 'hors GET : rien');
  assert.equal(b.requete('https://autre.example/assets/x.js'), false, 'autre origine : rien');
  // Coque : fichiers hachés en cache d'abord, navigations en réseau d'abord, icônes et manifeste ; le reste passe.
  assert.equal(b.requete('/assets/index-ABCD.js'), true);
  assert.equal(b.requete('/temps', { mode: 'navigate' }), true);
  assert.equal(b.requete('/manifest.webmanifest'), true);
  assert.equal(b.requete('/imprimer.js'), false);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(b.journal.filter(a => a.url?.startsWith('/api')), [], 'aucune lecture ni écriture de cache pour /api');
});

test('service worker : coque préchargée, anciennes versions effacées, skipWaiting seulement à la demande de la page', async () => {
  const b = bacASable(SW.replace("const PRECHARGE = []; // __CURSUS_PRECHARGE__", "const PRECHARGE = ['/assets/index-ABCD.js'];"));
  let attente: Promise<unknown> | undefined;
  b.ecouteurs.install({ waitUntil: (p: Promise<unknown>) => { attente = p; } });
  await attente;
  const gardes = b.journal.filter(a => a.quoi === 'garder').map(a => a.url);
  assert.ok(gardes.includes('/index.html') && gardes.includes('/hors-ligne.html') && gardes.includes('/assets/index-ABCD.js') && gardes.includes('/icons/icon-192.png'));
  assert.ok(!gardes.some(u => u?.startsWith('/api')));
  assert.ok(!b.journal.some(a => a.quoi === 'skipWaiting'), 'jamais à l’installation');
  b.ecouteurs.activate({ waitUntil: (p: Promise<unknown>) => { attente = p; } });
  await attente;
  assert.deepEqual(b.journal.filter(a => a.quoi === 'effacerCache').map(a => a.url), ['cursus-coque-ancienne'], 'seuls les caches de Cursus d’une autre version');
  assert.ok(b.journal.some(a => a.quoi === 'claim'));
  b.ecouteurs.message({ data: { type: 'AUTRE' } });
  assert.ok(!b.journal.some(a => a.quoi === 'skipWaiting'));
  b.ecouteurs.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(b.journal.filter(a => a.quoi === 'skipWaiting').length, 1);
  // Lecture du fichier : skipWaiting n'apparaît qu'une fois, dans le gestionnaire des messages.
  assert.equal(SW.match(/skipWaiting\(\)/g)?.length, 1);
  assert.match(SW, /addEventListener\('message'[\s\S]*SKIP_WAITING[\s\S]*skipWaiting\(\)/);
  // Le gestionnaire fetch écarte /api avant toute réponse.
  const fetchSrc = SW.slice(SW.indexOf("addEventListener('fetch'"));
  assert.ok(fetchSrc.indexOf('estApi(url.pathname)') < fetchSrc.indexOf('respondWith'));
});

test('service worker : notification générique toujours affichée, clic limité aux adresses de Cursus', async () => {
  const affichees: { titre: string; o: { body: string; data: { url: string } } }[] = [];
  const ouvertes: string[] = [];
  const ecouteurs: Record<string, (e: unknown) => void> = {};
  runInNewContext(SW, {
    self: {
      location: { origin: 'https://cursus.test' }, addEventListener: (t: string, f: (e: unknown) => void) => { ecouteurs[t] = f; },
      registration: { showNotification: async (titre: string, o: { body: string; data: { url: string } }) => { affichees.push({ titre, o }); } },
      clients: { matchAll: async () => [], openWindow: async (u: string) => { ouvertes.push(u); } },
    },
    caches: {}, URL, Request: class {}, Response: {}, setTimeout, clearTimeout, AbortController,
  });
  let attente: Promise<unknown> | undefined;
  const attendre = (p: Promise<unknown>) => { attente = p; };
  // Charge illisible : notification générique quand même (un push sans notification fait révoquer l'abonnement).
  ecouteurs.push({ data: { json: () => { throw new Error('illisible'); } }, waitUntil: attendre });
  await attente;
  ecouteurs.push({ data: { json: () => ({ type: 'temps.renvoyee', titre: 'Feuille de temps renvoyée', corps: 'Une feuille de temps est à corriger.', url: '/temps' }) }, waitUntil: attendre });
  await attente;
  assert.deepEqual(affichees.map(a => [a.titre, a.o.data.url]), [['Cursus', '/'], ['Feuille de temps renvoyée', '/temps']]);
  // Clic : une adresse d'une autre origine, ou de l'API, ouvre l'accueil de Cursus.
  for (const url of ['https://hameconnage.example/x', '/absences', '/api/data']) {
    ecouteurs.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: attendre });
    await attente;
  }
  assert.deepEqual(ouvertes, ['https://cursus.test/', 'https://cursus.test/absences', 'https://cursus.test/']);
});

test('plugin du build : version et fichiers /assets injectés (sans les polices WOFF), marques exigées', () => {
  const emis: { fileName: string; source: string }[] = [];
  const erreurs: string[] = [];
  const contexte = { emitFile: (f: { fileName: string; source: string }) => { emis.push(f); return 'x'; }, error: (m: string) => { erreurs.push(m); throw new Error(m); } };
  const plugin = swCursus();
  const bundle = { 'assets/index-AAAA.js': {}, 'assets/inter-latin-400.woff2': {}, 'assets/inter-latin-400.woff': {}, 'index.html': {} };
  (plugin.generateBundle as unknown as (this: typeof contexte, o: unknown, b: unknown) => void).call(contexte, {}, bundle);
  assert.equal(emis.length, 1);
  assert.equal(emis[0].fileName, 'sw.js');
  assert.match(emis[0].source, /const VERSION = '[0-9a-f]{12}';/);
  assert.match(emis[0].source, /const PRECHARGE = \["\/assets\/index-AAAA\.js","\/assets\/inter-latin-400\.woff2"\];/);
  assert.doesNotMatch(emis[0].source, /__CURSUS_/);
  // Une autre liste de fichiers : une autre version (mise à jour proposée).
  (plugin.generateBundle as unknown as (this: typeof contexte, o: unknown, b: unknown) => void).call(contexte, {}, { 'assets/index-BBBB.js': {} });
  assert.notEqual(/VERSION = '(\w+)'/.exec(emis[1].source)![1], /VERSION = '(\w+)'/.exec(emis[0].source)![1]);
  // Fichier sans les marques : le build échoue au lieu de livrer un service worker sans version.
  const dir = mkdtempSync(join(tmpdir(), 'cursus-sw-'));
  writeFileSync(join(dir, 'sw.js'), 'const VERSION = "x";');
  const mauvais = swCursus(new URL(`file://${join(dir, 'sw.js')}`));
  assert.throws(() => (mauvais.generateBundle as unknown as (this: typeof contexte, o: unknown, b: unknown) => void).call(contexte, {}, bundle), /marques/);
  rmSync(dir, { recursive: true, force: true });
});

// — Manifeste, icônes, page —

/** Icônes attendues : nom, côté, fond plein (opaque : maskable et écran d'accueil iOS). */
const ICONES = [
  { nom: 'icon-192.png', taille: 192, plein: false }, { nom: 'icon-512.png', taille: 512, plein: false },
  { nom: 'icon-512-maskable.png', taille: 512, plein: true }, { nom: 'apple-touch-icon.png', taille: 180, plein: true },
];

/** Largeur, hauteur et type de couleur d'un PNG ; vérifie la signature et la décompression des données. */
function enTetePng(b: Buffer) {
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(b.subarray(12, 16).toString('ascii'), 'IHDR');
  const idat = b.indexOf('IDAT');
  const brut = inflateSync(b.subarray(idat + 4, idat + 4 + b.readUInt32BE(idat - 4)));
  const l = b.readUInt32BE(16), h = b.readUInt32BE(20), couleur = b[25];
  assert.equal(brut.length, h * (l * (couleur === 6 ? 4 : 3) + 1));
  return { l, h, couleur };
}

test('icônes : PNG 192, 512, 512 maskable et apple-touch-icon 180 opaque, identiques à ce que produit scripts/icones.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-icones-'));
  try {
    // Le script tel que le rejoue un développeur (node scripts/icones.mjs <dossier>), sans dépendance.
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/icones.mjs', import.meta.url)), dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const i of ICONES) {
      const commit = readFileSync(new URL(`../client/public/icons/${i.nom}`, import.meta.url));
      assert.ok(commit.equals(readFileSync(join(dir, i.nom))), `${i.nom} : relancer node scripts/icones.mjs`);
      const { l, h, couleur } = enTetePng(commit);
      assert.deepEqual([l, h], [i.taille, i.taille], i.nom);
      // Maskable et Apple : opaques (RGB) ; « any » : transparence (RGBA).
      assert.equal(couleur, i.plein ? 2 : 6, i.nom);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manifeste : lancement /?source=pwa, plein écran, couleurs Nocturne, icônes et raccourcis vers des écrans existants', () => {
  const m = JSON.parse(lire('client/public/manifest.webmanifest'));
  assert.equal(m.start_url, '/?source=pwa');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'fr');
  const fond = /--color-bg: (#[0-9a-f]{6});/.exec(lire('client/src/styles/nocturne.css'))![1];
  assert.equal(m.background_color, fond);
  assert.equal(m.theme_color, fond);
  assert.deepEqual(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`), ['192x192 any', '512x512 any', '512x512 maskable']);
  for (const i of m.icons) readFileSync(new URL(`../client/public${i.src}`, import.meta.url));
  assert.deepEqual(m.shortcuts.map((s: { name: string }) => s.name), ['Saisir mes heures', 'Demander une absence']);
  for (const s of m.shortcuts) assert.ok((ALLOWED_VIEWS.collaborateur as readonly string[]).includes(new URL(s.url, 'https://x').pathname.slice(1)), s.url);
  const page = lire('client/index.html');
  for (const balise of ['<link rel="manifest" href="/manifest.webmanifest" />', `<meta name="theme-color" content="${fond}" />`, '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    '<meta name="apple-mobile-web-app-title" content="Cursus" />', 'viewport-fit=cover']) assert.ok(page.includes(balise), balise);
  // CSP stricte : ni script ni style en ligne dans la page, ni dans la page « Hors ligne » du service worker.
  for (const f of ['client/index.html', 'client/public/hors-ligne.html']) {
    assert.doesNotMatch(lire(f), /<style|<script(?![^>]*\bsrc=)| style="/, f);
  }
});

// — Serveur : /sw.js et CURSUS_PWA —

async function servir(pwa: boolean, avecSw = true) {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-pwa-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Cursus</title>');
  if (avecSw) writeFileSync(join(dir, 'sw.js'), "const VERSION = 'abc';");
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  const app = createApp(await nouvelleBase(), { dist: dir, production: false, journalRequetes: false, pwa });
  const srv = await new Promise<import('node:http').Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const port = (srv.address() as AddressInfo).port;
  return { get: async (p: string) => await fetch(`http://127.0.0.1:${port}${p}`), fin: () => { srv.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('/sw.js : no-cache quand l’application installable est active, 404 coupée ou absente (jamais la page à la place)', async () => {
  const actif = await servir(true);
  try {
    const r = await actif.get('/sw.js');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(r.headers.get('content-type') ?? '', /javascript/);
    assert.equal(await r.text(), "const VERSION = 'abc';");
    assert.match((await actif.get('/manifest.webmanifest')).headers.get('content-type') ?? '', /application\/manifest\+json/);
  } finally { actif.fin(); }
  for (const s of [await servir(false), await servir(true, false)]) {
    try {
      const r = await s.get('/sw.js');
      assert.equal(r.status, 404);
      assert.doesNotMatch(await r.text(), /<title>/);
    } finally { s.fin(); }
  }
});

test('CURSUS_PWA : active par défaut, 0 la coupe, valeur inconnue signalée ; l’application de bureau la coupe', () => {
  assert.equal(pwaActive({}), true);
  assert.equal(pwaActive({ CURSUS_PWA: '1' }), true);
  assert.equal(pwaActive({ CURSUS_PWA: ' 0 ' }), false);
  assert.deepEqual(problemesPwa({}), []);
  assert.deepEqual(problemesPwa({ CURSUS_PWA: '0' }), []);
  assert.match(problemesPwa({ CURSUS_PWA: 'non' })[0], /CURSUS_PWA vaut « non »/);
  assert.match(lire('desktop/CursusApp.swift'), /env\["CURSUS_PWA"\] = "0"/);
  assert.match(lire('.env.example'), /^#CURSUS_PWA=1$/m);
});
