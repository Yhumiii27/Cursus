// Notifications sur le téléphone, côté navigateur (lot 11, chantier C2, t196) : permission, abonnement et désabonnement
// de cet appareil (Web Push du service worker, client/public/sw.js), enregistrés par les actions push.* du serveur
// (server/src/actions/push.ts). Notifications génériques, coupées par défaut : l'abonnement ne reçoit rien tant que la
// personne n'a pas choisi de types (Mes appareils).
// - Permission demandée seulement sur un geste (bouton « Recevoir les notifications ») : obligatoire sur iOS, et jamais
//   au chargement de la page.
// - iOS et iPadOS : seulement dans l'application installée (16.4 et suivants), pas dans Safari.
// - Libellé de l'appareil déduit de l'agent du navigateur (codesAppareil), jamais saisi ; l'adresse du service de push et
//   les clés partent au serveur, qui les garde chiffrées et ne les renvoie jamais.
import { codesAppareil } from '../../../shared/notifications-push.ts';
import { api, type ActionResponse, type NomAction } from '../api.ts';

type Lancer = (name: NomAction, payload: Record<string, unknown>) => Promise<ActionResponse>;

/** Le navigateur sait recevoir des notifications ici (contexte sécurisé, service worker, Push API). */
export function pushPossible(w: Window = window): boolean {
  return w.isSecureContext && 'serviceWorker' in w.navigator && 'PushManager' in w && 'Notification' in w;
}

/** Clé publique VAPID (base64url) en octets, pour `applicationServerKey`. */
export function octetsB64u(b64u: string): Uint8Array<ArrayBuffer> {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64u.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Enregistrement du service worker de Cursus, s'il y en a un (sans attendre : `ready` ne rend rien sans lui). */
async function enregistrement(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

/** Abonnement de cet appareil, s'il existe. */
export async function abonnementActuel(): Promise<PushSubscription | null> {
  if (!pushPossible()) return null;
  return (await (await enregistrement())?.pushManager.getSubscription()) ?? null;
}

/**
 * Active les notifications sur cet appareil (geste de la personne) : permission, abonnement du navigateur, puis
 * push.abonner. Lève une erreur au message lisible si quelque chose manque.
 */
export async function activerNotifications(lancer: Lancer): Promise<ActionResponse> {
  if (!pushPossible()) throw new Error('Ce navigateur ne reçoit pas de notifications ici : sur iPhone, installez d’abord l’application (écran d’accueil).');
  const reg = await enregistrement();
  if (!reg) throw new Error('Application pas encore prête sur cet appareil : rechargez la page, puis réessayez.');
  const { active, cle } = await api.pushCle();
  if (!active || !cle) throw new Error('Notifications sur le téléphone désactivées sur ce serveur : voyez avec le service informatique.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées pour Cursus : autorisez-les dans les réglages du navigateur ou du téléphone, puis réessayez.');
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octetsB64u(cle) });
  const j = sub.toJSON();
  return await lancer('push.abonner', { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, ...codesAppareil(navigator.userAgent) });
}

/**
 * Désactive les notifications de cet appareil : push.desabonner (motif `utilisateur` ou `deconnexion`), puis abonnement
 * du navigateur retiré. Sans abonnement : rien.
 */
export async function desactiverNotifications(lancer: Lancer, motif: 'utilisateur' | 'deconnexion'): Promise<ActionResponse | null> {
  const sub = await abonnementActuel().catch(() => null);
  if (!sub) return null;
  const r = await lancer('push.desabonner', { endpoint: sub.endpoint, motif });
  await sub.unsubscribe().catch(() => false);
  return r;
}
