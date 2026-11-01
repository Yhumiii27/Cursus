// Service worker de Cursus (lot 11, chantier C2, t196), écrit à la main, sans dépendance (ni Workbox ni plugin) : il ne
// garde que la coque de l'application (page, scripts, styles, polices, icônes), jamais une réponse de l'API. Portée « / ».
// - Version et fichiers à précharger injectés au build par le plugin `swCursus` de vite.config.ts (VERSION, PRECHARGE) ;
//   servi tel quel par le serveur de développement (version « dev », rien de préchargé hors de la coque).
// - install : préchargement de la coque dans le cache `cursus-coque-<version>` ; la nouvelle version attend (« waiting »)
//   jusqu'à ce que la page la demande (message SKIP_WAITING, bandeau « Nouvelle version »), pour ne jamais changer de
//   version au milieu d'une saisie.
// - activate : caches des versions précédentes effacés, puis prise en charge des pages ouvertes.
// - fetch : rien n'est intercepté hors de cette origine, hors GET, ni sous /api (instantané, pièces justificatives, connexion,
//   agenda, fichiers de paie : réponses no-store du serveur, seconde barrière) ; /assets en cache d'abord (noms hachés,
//   immuables) ; navigations en réseau d'abord avec un délai de 4 s, puis la page de l'application gardée en cache (le
//   serveur renvoie la même pour toute adresse hors /api), à défaut la page « Hors ligne » ; une réponse 502, 503 ou 504
//   (reverse proxy pendant un redémarrage ou une mise à jour de Cursus) vaut une coupure ; fichiers de la coque (icônes,
//   manifeste) en cache d'abord ; tout le reste passe au réseau sans réponse du service worker.
// - push : notification générique (titre et texte fixes, sans nom ni date : shared/notifications-push.ts), toujours
//   affichée (exigence des navigateurs) ; notificationclick : l'onglet de Cursus ouvert passe à l'écran de la notification
//   et au premier plan, sinon un nouvel onglet s'ouvre (adresses de Cursus seulement).
// Contrôlé sans navigateur par tests/pwa.test.ts (aucune réponse /api servie ni gardée, skipWaiting sur demande seulement).

const VERSION = 'dev'; // __CURSUS_VERSION__
const PRECHARGE = []; // __CURSUS_PRECHARGE__

const PREFIXE = 'cursus-coque-';
const CACHE = PREFIXE + VERSION;
/** Page de l'application (repli des navigations) et page « Hors ligne » (si la première manque au cache). */
const PAGE = '/index.html';
const HORS_LIGNE = '/hors-ligne.html';
/** Coque gardée quelle que soit la version : page, page « Hors ligne », manifeste et icônes. */
const COQUE = [PAGE, HORS_LIGNE, '/hors-ligne.css', '/manifest.webmanifest', '/favicon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png', '/icons/apple-touch-icon.png'];
/** Délai de la navigation par le réseau avant le repli sur la page gardée. */
const DELAI_NAVIGATION_MS = 4000;
/** Statuts du reverse proxy quand Cursus ne répond pas (redémarrage, mise à jour) : repli comme sans réseau. */
const INDISPONIBLE = [502, 503, 504];

/** Adresse de l'API : jamais servie ni gardée par le service worker. */
const estApi = chemin => chemin === '/api' || chemin.startsWith('/api/');

self.addEventListener('install', evenement => {
  // `cache: 'reload'` : la coque vient du serveur, pas du cache HTTP du navigateur.
  evenement.waitUntil(caches.open(CACHE).then(c => c.addAll([...COQUE, ...PRECHARGE].map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', evenement => {
  evenement.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom.startsWith(PREFIXE) && nom !== CACHE) await caches.delete(nom);
    await self.clients.claim();
  })());
});

// Mise à jour : seulement à la demande de la page (« Recharger » du bandeau de mise à jour).
self.addEventListener('message', evenement => {
  if (evenement.data && evenement.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Réponse gardée, sinon le réseau ; une réponse correcte de cette origine est gardée (fichier haché ou de la coque). */
async function cacheDabord(requete) {
  const gardee = await caches.match(requete);
  if (gardee) return gardee;
  const reponse = await fetch(requete);
  if (reponse.ok && reponse.type === 'basic') {
    const copie = reponse.clone();
    caches.open(CACHE).then(c => c.put(requete, copie)).catch(() => {});
  }
  return reponse;
}

/** Page gardée pour une navigation sans serveur : celle de l'application, puis la page « Hors ligne ». */
async function pageGardee() {
  return (await caches.match(PAGE)) || (await caches.match(HORS_LIGNE));
}

/**
 * Navigation : réseau d'abord (4 s), puis la page de l'application gardée, puis la page « Hors ligne ». Une réponse
 * 502, 503 ou 504 est rendue telle quelle seulement si rien n'est gardé.
 */
async function navigation(requete) {
  let reponse;
  try {
    const controle = new AbortController();
    const minuterie = setTimeout(() => controle.abort(), DELAI_NAVIGATION_MS);
    try {
      reponse = await fetch(requete, { signal: controle.signal });
    } finally {
      clearTimeout(minuterie);
    }
  } catch {
    return (await pageGardee()) || Response.error();
  }
  if (INDISPONIBLE.includes(reponse.status)) return (await pageGardee()) || reponse;
  return reponse;
}

self.addEventListener('fetch', evenement => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);
  // Autre origine, ou API : le navigateur s'en charge seul, rien n'est servi ni gardé ici.
  if (url.origin !== self.location.origin || estApi(url.pathname)) return;
  if (url.pathname.startsWith('/assets/')) { evenement.respondWith(cacheDabord(requete)); return; }
  if (requete.mode === 'navigate') { evenement.respondWith(navigation(requete)); return; }
  if (COQUE.includes(url.pathname)) evenement.respondWith(cacheDabord(requete));
});

// — Notifications (Web Push, server/src/envois-push.ts : { type, titre, corps, url }) —

self.addEventListener('push', evenement => {
  let charge = {};
  try { charge = evenement.data ? evenement.data.json() : {}; } catch { /* charge illisible : notification générique */ }
  const titre = typeof charge.titre === 'string' && charge.titre ? charge.titre : 'Cursus';
  const corps = typeof charge.corps === 'string' ? charge.corps : 'Une information vous attend dans Cursus.';
  evenement.waitUntil(self.registration.showNotification(titre, {
    body: corps, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'fr',
    tag: typeof charge.type === 'string' ? charge.type : 'cursus', data: { url: typeof charge.url === 'string' ? charge.url : '/' },
  }));
});

self.addEventListener('notificationclick', evenement => {
  evenement.notification.close();
  // Adresse de Cursus seulement (chemin relatif de la charge) ; toute autre origine ouvre l'accueil.
  let cible = new URL('/', self.location.origin);
  try {
    const u = new URL((evenement.notification.data && evenement.notification.data.url) || '/', self.location.origin);
    if (u.origin === self.location.origin && !estApi(u.pathname)) cible = u;
  } catch { /* adresse illisible : accueil */ }
  evenement.waitUntil((async () => {
    const ouverts = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = ouverts.find(c => new URL(c.url).origin === self.location.origin);
    if (client) {
      // La page change d'écran sans se recharger (client/src/pwa/enregistrement.ts) : une saisie en cours n'est pas perdue.
      client.postMessage({ type: 'NAVIGUER', url: cible.pathname + cible.search });
      await client.focus();
      return;
    }
    await self.clients.openWindow(cible.href);
  })());
});
