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
import { api, type ActionResponse, type AppareilPush, type NomAction } from '../api.ts';

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

/** Empreinte de l'adresse du service de push (SHA-256 en hexadécimal) : celle que le serveur renvoie (`cleEndpoint`). */
export async function empreinteEndpoint(endpoint: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return Array.from(h, o => o.toString(16).padStart(2, '0')).join('');
}

/**
 * L'abonnement du navigateur est-il un appareil du compte connecté ? Non quand il appartient au compte précédent
 * (session expirée, autre personne connectée sans déconnexion) ou qu'il a été retiré côté serveur (« Retirer » depuis
 * cet appareil, révocation par le service RH, 404 ou 410 du service de push, 90 jours sans envoi).
 */
export async function abonnementDuCompte(endpoint: string, appareils: readonly Pick<AppareilPush, 'empreinte'>[]): Promise<boolean> {
  const e = await empreinteEndpoint(endpoint);
  return appareils.some(a => a.empreinte === e);
}

/**
 * Session lue : un abonnement du navigateur qui n'est pas au compte connecté est retiré du navigateur. Rien n'est demandé
 * au serveur (push.desabonner ne vaut que pour son propre compte) : l'abonnement mort y est supprimé au prochain envoi
 * (404 ou 410). Rien n'est fait si les notifications sont coupées sur le serveur ou que la liste ne se lit pas.
 * Renvoie vrai si un abonnement a été retiré.
 */
export async function retirerAbonnementEtranger(lireAppareils: () => Promise<{ active: boolean; appareils: AppareilPush[] }> = api.pushAppareils): Promise<boolean> {
  const sub = await abonnementActuel().catch(() => null);
  if (!sub) return false;
  const r = await lireAppareils();
  if (!r.active || await abonnementDuCompte(sub.endpoint, r.appareils)) return false;
  return await sub.unsubscribe();
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
