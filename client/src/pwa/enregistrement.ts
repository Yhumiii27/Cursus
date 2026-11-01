// Application installable (lot 11, chantier C2, t196) : enregistrement du service worker (client/public/sw.js), mise à
// jour à la demande, installation et lancement depuis l'écran d'accueil. État partagé par les bandeaux (useEtatPwa).
// - Enregistrement seulement si le navigateur a un service worker et en contexte sécurisé (HTTPS, ou 127.0.0.1 et
//   localhost : tests de bout en bout) : rien dans l'application de bureau ni en HTTP simple, ni sous le serveur de
//   développement de Vite. Application installable coupée sur le serveur
//   (CURSUS_PWA=0 : /sw.js répond 404) : un service worker déjà installé est retiré, avec ses caches.
// - Mise à jour : une nouvelle version attend ; le bandeau « Nouvelle version » la demande (SKIP_WAITING), puis la page
//   se recharge quand elle prend la main. Jamais de changement de version sans geste de la personne (saisie en cours).
// - Installation : l'événement beforeinstallprompt (Chrome, Edge, Android) est gardé pour le bouton « Installer
//   l'application » ; iOS n'en a pas : encart d'explication (components/InstallerApplication.tsx).
// - Lancement installé : mode standalone (ou navigator.standalone d'iOS) ; la classe `standalone` posée sur <html> montre
//   la barre d'onglets (app.css).
// - Notification touchée (sw.js) : message NAVIGUER, changement d'écran sans recharger la page.
import { useSyncExternalStore } from 'react';

/** Événement beforeinstallprompt (non typé par lib.dom). */
interface InvitationInstallation extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export interface EtatPwa {
  /** Service worker actif sur cette page (coque gardée pour le hors ligne). */
  actif: boolean;
  /** Nouvelle version prête, en attente du geste « Recharger ». */
  miseAJour: boolean;
  /** Installation proposée par le navigateur (bouton « Installer l'application »). */
  installable: boolean;
  /** Lancée depuis l'écran d'accueil (application installée). */
  standalone: boolean;
}

let etat: EtatPwa = { actif: false, miseAJour: false, installable: false, standalone: false };
const abonnes = new Set<() => void>();
let invitation: InvitationInstallation | null = null;
let enAttente: ServiceWorker | null = null;

function changer(patch: Partial<EtatPwa>) {
  etat = { ...etat, ...patch };
  for (const f of abonnes) f();
}

/** État de l'application installable, suivi par les composants. */
export function useEtatPwa(): EtatPwa {
  return useSyncExternalStore(f => { abonnes.add(f); return () => abonnes.delete(f); }, () => etat, () => etat);
}

/** Application lancée depuis l'écran d'accueil (Android, ordinateur : display-mode ; iOS : navigator.standalone). */
export function estStandalone(w: Pick<Window, 'matchMedia' | 'navigator'> = window): boolean {
  return !!w.matchMedia?.('(display-mode: standalone)').matches || (w.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Safari sur iPhone ou iPad (encart « Sur l'écran d'accueil ») : iPadOS se présente comme un Mac tactile. */
export function estIos(agent = navigator.userAgent, points = navigator.maxTouchPoints ?? 0): boolean {
  return /iphone|ipad|ipod/i.test(agent) || (/macintosh/i.test(agent) && points > 1);
}

/** Le navigateur peut enregistrer un service worker ici. */
export const swPossible = (w: Window = window) => 'serviceWorker' in w.navigator && w.isSecureContext;

/**
 * Raccourci du manifeste « Demander une absence » (/absences?nouveau=1), relevé au démarrage avant que la synchronisation
 * de l'adresse (store.tsx) ne le retire ; rendu une seule fois à l'écran des absences.
 */
let nouvelleAbsence = false;
export function prendreNouvelleAbsence(): boolean {
  const v = nouvelleAbsence;
  nouvelleAbsence = false;
  return v;
}

// lot 11 — notes de frais : raccourci « Nouvelle dépense » (/frais?nouveau=1), relevé de même ; il ouvre la saisie d'une
// dépense à l'écran Mes frais.
let nouvelleDepense = false;
export function prendreNouvelleDepense(): boolean {
  const v = nouvelleDepense;
  nouvelleDepense = false;
  return v;
}

/** Demande l'installation (bouton « Installer l'application ») ; vrai si la personne l'accepte. */
export async function installer(): Promise<boolean> {
  const i = invitation;
  if (!i) return false;
  invitation = null;
  changer({ installable: false });
  await i.prompt();
  return (await i.userChoice).outcome === 'accepted';
}

/** Passe à la nouvelle version (bandeau « Recharger ») : la page se recharge quand elle prend la main. */
export function appliquerMiseAJour(): void {
  if (enAttente) enAttente.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
}

/** Suit une version en attente : bandeau dès qu'elle est installée, si une version contrôle déjà la page. */
function suivre(reg: ServiceWorkerRegistration) {
  const attendre = (sw: ServiceWorker | null) => {
    if (!sw) return;
    const pret = () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) { enAttente = sw; changer({ miseAJour: true }); } };
    pret();
    sw.addEventListener('statechange', pret);
  };
  attendre(reg.waiting);
  reg.addEventListener('updatefound', () => attendre(reg.installing));
}

/** Retire un service worker déjà installé et ses caches (application installable coupée sur le serveur). */
async function retirer(): Promise<void> {
  for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  if ('caches' in window) for (const nom of await caches.keys()) if (nom.startsWith('cursus-coque-')) await caches.delete(nom);
}

/**
 * Démarrage (client/src/main.tsx) : classe `standalone`, invitation à installer, messages du service worker, puis
 * enregistrement si possible. Ne lève jamais : sans service worker, l'application fonctionne en ligne comme avant.
 */
export function demarrerPwa(): void {
  const q = new URLSearchParams(location.search);
  nouvelleAbsence = location.pathname === '/absences' && q.get('nouveau') === '1';
  nouvelleDepense = location.pathname === '/frais' && q.get('nouveau') === '1';
  // `source=pwa` : adresse de lancement du manifeste (start_url, raccourcis), donc application installée.
  const standalone = estStandalone() || q.get('source') === 'pwa';
  document.documentElement.classList.toggle('standalone', standalone);
  changer({ standalone });
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    invitation = e as InvitationInstallation;
    changer({ installable: true });
  });
  addEventListener('appinstalled', () => { invitation = null; changer({ installable: false }); });
  // Serveur de développement (Vite) : pas de service worker, qui garderait des pages d'une autre version.
  if (import.meta.env.DEV || !swPossible()) return;
  const sw = navigator.serviceWorker;
  // Notification touchée : écran de la notification, sans recharger (store.tsx suit popstate).
  sw.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
    if (e.data?.type !== 'NAVIGUER' || typeof e.data.url !== 'string' || !e.data.url.startsWith('/')) return;
    history.pushState(null, '', e.data.url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  // Nouvelle version mise en place à la demande : rechargement unique.
  let recharge = false;
  sw.addEventListener('controllerchange', () => { if (enAttente && !recharge) { recharge = true; location.reload(); } });
  void (async () => {
    try {
      // /sw.js absent (CURSUS_PWA=0) : un service worker installé auparavant est retiré.
      const r = await fetch('/sw.js', { method: 'HEAD', cache: 'no-store' });
      if (r.status === 404) { await retirer(); return; }
      const reg = await sw.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      changer({ actif: !!sw.controller || !!reg.active });
      suivre(reg);
      // Une application installée reste ouverte des jours : nouvelle version cherchée au retour sur l'application.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => {}); });
    } catch {
      // Hors ligne au premier chargement, navigateur qui refuse : l'application fonctionne sans service worker.
    }
  })();
}
