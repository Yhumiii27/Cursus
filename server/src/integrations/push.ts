// Web Push sans dépendance (lot 11, chantier C2, t196 ; choix par défaut : implémentation maison, aucune bibliothèque
// web-push) : chiffrement du message et signature VAPID avec node:crypto, puis requête au service de push du navigateur
// (Google FCM, Apple, Mozilla, Microsoft). Le service de push ne lit jamais le contenu : il est chiffré de bout en bout
// pour le navigateur, qui seul a la clé privée.
// - RFC 8291 (Message Encryption for Web Push) : échange ECDH P-256 entre une clé éphémère du serveur et la clé publique
//   du navigateur (`p256dh`), secret d'authentification (`auth`) mêlé par HKDF-SHA-256.
// - RFC 8188 (Encrypted Content-Encoding, aes128gcm) : un seul enregistrement (taille 4096), délimiteur 0x02, en-tête
//   sel (16 octets) · taille d'enregistrement · longueur et clé publique du serveur.
// - RFC 8292 (VAPID) : jeton JWT ES256 (audience : origine du service de push, expiration 12 h, sujet mailto: ou https:)
//   signé par la clé privée de Cursus, et clé publique dans l'en-tête Authorization (« vapid t=…, k=… »).
// Testé sur les vecteurs de l'annexe A de la RFC 8291 et par la vérification du jeton (tests/push.test.ts).
import { createCipheriv, createECDH, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** Clés VAPID de Cursus : clé publique non compressée (65 octets) et clé privée (32 octets), en base64url ; sujet. */
export interface ClesVapid { publique: string; privee: string; sujet: string }

/** Abonnement du navigateur (PushSubscription) : adresse du service de push et clés, en base64url. */
export interface AbonnementNavigateur { endpoint: string; p256dh: string; auth: string }

/** Taille d'enregistrement annoncée (un seul enregistrement : le message tient en moins de 4 Ko). */
const TAILLE_ENREGISTREMENT = 4096;
/** Charge utile la plus longue admise (les services de push en acceptent environ 4 Ko chiffrés). */
export const CHARGE_MAX = 3000;

const b64u = (b: Buffer) => b.toString('base64url');
export const deB64u = (s: string) => Buffer.from(s, 'base64url');

/** HKDF-SHA-256 (extraction puis expansion) : `longueur` octets. */
const hkdf = (sel: Buffer, ikm: Buffer, info: Buffer, longueur: number) => Buffer.from(hkdfSync('sha256', ikm, sel, info, longueur));

/** Clés dérivées d'un message (RFC 8291 § 3.4 et RFC 8188 § 2.2), exposées pour les vecteurs de test. */
export function derivations(o: { secretEcdh: Buffer; auth: Buffer; clientPublique: Buffer; serveurPublique: Buffer; sel: Buffer }) {
  const infoCle = Buffer.concat([Buffer.from('WebPush: info\0'), o.clientPublique, o.serveurPublique]);
  const ikm = hkdf(o.auth, o.secretEcdh, infoCle, 32);
  const cek = hkdf(o.sel, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(o.sel, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  return { ikm, cek, nonce };
}

/**
 * Corps chiffré d'un message pour un navigateur (aes128gcm). `serveur` (clé privée éphémère, 32 octets) et `sel` ne se
 * donnent que pour les vecteurs de test : à défaut, tirés au hasard à chaque message, comme l'exige la RFC.
 */
export function chiffrerMessage(clair: Buffer, abo: Pick<AbonnementNavigateur, 'p256dh' | 'auth'>, essai: { serveur?: Buffer; sel?: Buffer } = {}): Buffer {
  const clientPublique = deB64u(abo.p256dh), auth = deB64u(abo.auth);
  if (clientPublique.length !== 65 || clientPublique[0] !== 4) throw new Error('Clé p256dh invalide : 65 octets, point non compressé attendu');
  if (auth.length !== 16) throw new Error('Secret auth invalide : 16 octets attendus');
  if (clair.length > CHARGE_MAX) throw new Error(`Message trop long (${clair.length} octets) pour une notification`);
  const ecdh = createECDH('prime256v1');
  if (essai.serveur) ecdh.setPrivateKey(essai.serveur);
  else ecdh.generateKeys();
  const serveurPublique = ecdh.getPublicKey();
  const sel = essai.sel ?? randomBytes(16);
  const { cek, nonce } = derivations({ secretEcdh: ecdh.computeSecret(clientPublique), auth, clientPublique, serveurPublique, sel });
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  // Un seul enregistrement, le dernier : délimiteur 0x02, sans remplissage.
  const chiffre = Buffer.concat([c.update(Buffer.concat([clair, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const entete = Buffer.alloc(21);
  sel.copy(entete, 0);
  entete.writeUInt32BE(TAILLE_ENREGISTREMENT, 16);
  entete.writeUInt8(serveurPublique.length, 20);
  return Buffer.concat([entete, serveurPublique, chiffre]);
}

/** Nouvelle paire de clés VAPID (démonstration : clé en mémoire, renouvelée à chaque démarrage). */
export function nouvellesClesVapid(sujet: string): ClesVapid {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publique: b64u(ecdh.getPublicKey()), privee: b64u(ecdh.getPrivateKey()), sujet };
}

/** Clé privée VAPID en objet de clé (JWK à partir des coordonnées de la clé publique et du scalaire privé). */
export function clePriveeVapid(c: ClesVapid): KeyObject {
  const pub = deB64u(c.publique);
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: c.privee }, format: 'jwk' });
}

/** Clé publique VAPID en objet de clé (vérification du jeton dans les tests). */
export function clePubliqueVapid(publique: string): KeyObject {
  const pub = deB64u(publique);
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}

/** Clés VAPID cohérentes : publique de 65 octets (point non compressé), privée de 32 octets, la publique dérivée de la privée. */
export function clesVapidValides(c: Pick<ClesVapid, 'publique' | 'privee'>): boolean {
  try {
    const pub = deB64u(c.publique), priv = deB64u(c.privee);
    if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return false;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    return ecdh.getPublicKey().equals(pub);
  } catch {
    return false;
  }
}

/**
 * Jeton VAPID (RFC 8292 § 2) pour le service de push de `endpoint` : en-tête { typ: JWT, alg: ES256 }, revendications
 * aud (origine du service), exp (12 h après `maintenant`, 24 h au plus selon la RFC) et sub ; signature ES256 au format
 * JOSE (r ‖ s, 64 octets).
 */
export function jetonVapid(endpoint: string, c: ClesVapid, maintenant = new Date()): string {
  const enTete = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corps = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(maintenant.getTime() / 1000) + 12 * 3600, sub: c.sujet })));
  const signature = sign('sha256', Buffer.from(`${enTete}.${corps}`), { key: clePriveeVapid(c), dsaEncoding: 'ieee-p1363' });
  return `${enTete}.${corps}.${b64u(signature)}`;
}

/** Requête prête à envoyer au service de push : adresse, en-têtes, corps chiffré. */
export interface RequetePush { url: string; entetes: Record<string, string>; corps: Buffer }

/** Requête d'un message (charge utile JSON) : chiffrement, jeton VAPID, durée de validité et urgence normale. */
export function requetePush(abo: AbonnementNavigateur, charge: unknown, c: ClesVapid, o: { ttl: number; maintenant?: Date }): RequetePush {
  const corps = chiffrerMessage(Buffer.from(JSON.stringify(charge)), abo);
  return {
    url: abo.endpoint,
    entetes: {
      authorization: `vapid t=${jetonVapid(abo.endpoint, c, o.maintenant)}, k=${c.publique}`,
      'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(o.ttl), urgency: 'normal',
    },
    corps,
  };
}

/**
 * Services de push admis (adresse de l'abonnement) : le serveur envoie une requête à cette adresse, donnée par le
 * navigateur ; la limiter aux services connus évite d'en faire un relais vers le réseau interne. Pare-feu du serveur à
 * ouvrir vers ces hôtes (docs/DEPLOIEMENT.md).
 */
export const HOTES_PUSH: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/, /^(?:[a-z0-9-]+\.)*push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

/** Adresse d'abonnement admise : https, hôte d'un service de push connu, 1 000 caractères au plus. */
export function endpointAdmis(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !URL.canParse(endpoint)) return false;
  const u = new URL(endpoint);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOTES_PUSH.some(h => h.test(u.hostname));
}
