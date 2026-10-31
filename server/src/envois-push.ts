// File d'envoi des notifications sur le téléphone (lot 11, chantier C2, t196) : table `envoisPush`, à part de la file
// `envois` (server/src/envois.ts, inchangée) et de son processus. Une notification est indépendante des autres : pas de
// blocage en tête, l'ordre ne compte pas (un abonnement mort ne retarde personne).
// - 2xx : envoyée ; succès noté sur l'abonnement.
// - 404 ou 410 : abonnement expiré ou retiré par le navigateur, supprimé avec ses notifications en file (définitif, sans
//   trace nominative : compteurs seulement, `compteursPush`).
// - 408, 429, 5xx, erreur réseau ou délai dépassé : nouvelle tentative (attente doublée à chaque échec, 1 h au plus, ou
//   celle demandée par Retry-After), jusqu'à 10 tentatives.
// - Autre statut (400, 403 : clé VAPID refusée, 413…) : échec définitif.
// - Au-delà de sa validité (24 h après l'heure d'envoi admise) : expirée sans envoi.
// Le titre et le corps sont recalculés à l'envoi depuis le type (texte fixe, shared/notifications-push.ts) : rien de
// nominatif n'est en base ni chez le service de push. Purge : notifications closes depuis 30 jours, abonnements sans
// succès depuis 90 jours (tâche du quart d'heure, server/src/notifications.ts).
import { NOTIFICATIONS_PUSH, TTL_PUSH_S } from '../../shared/notifications-push.ts';
import type { Db } from './db.ts';
import { attente, TENTATIVES_MAX } from './envois.ts';
import { requetePush, type RequetePush } from './integrations/push.ts';
import { type AbonnementPush, clesPush, navigateurDe, supprimerAbonnements } from './push.ts';

/** Ligne de la table `envoisPush`. */
export interface EnvoiPush {
  id: number; abonnementId: number; type: string; statut: 'a_envoyer' | 'envoye' | 'echec' | 'expire'; tentatives: number;
  prochaine: string | null; expire: string | null; erreur: string | null; creation: string; envoi: string | null;
}

/** Réponse du service de push : statut HTTP (0 : erreur réseau ou délai) et attente demandée (Retry-After, en ms). */
export interface ReponsePush { status: number; apres?: number; erreur?: string }
/** Envoi HTTP d'une requête (fetch par défaut ; remplacé dans les tests). */
export type TransportPush = (r: RequetePush) => Promise<ReponsePush>;

const DELAI_MS = 10_000;
const HEURE = 3600_000;
/** Notifications traitées au plus par passage (toutes les 5 s). */
const PAQUET = 50;

/** Envoi par fetch, sans redirection, délai de 10 s. */
export const transportFetch: TransportPush = async r => {
  try {
    const res = await fetch(r.url, { method: 'POST', headers: r.entetes, body: new Uint8Array(r.corps), redirect: 'manual', signal: AbortSignal.timeout(DELAI_MS) });
    await res.arrayBuffer().catch(() => null);
    const ra = res.headers.get('retry-after');
    const apres = ra && /^\d+$/.test(ra.trim()) ? Number(ra) * 1000 : undefined;
    return { status: res.status, apres };
  } catch (err) {
    const nom = (err as Error)?.name;
    return { status: 0, erreur: nom === 'TimeoutError' || nom === 'AbortError' ? 'Délai dépassé' : 'Erreur réseau' };
  }
};

/** Compteurs depuis le démarrage (supervision) : envoyées, échecs définitifs, abonnements supprimés (404, 410), expirées. */
const compteurs = { envoyees: 0, echecs: 0, supprimes: 0, expirees: 0 };
export const compteursPush = () => ({ ...compteurs });

/**
 * Charge utile du message : type, titre et corps fixes, adresse ouverte au toucher (`/<vue>`, l'accueil de l'espace à
 * défaut) ; jamais de donnée personnelle.
 */
export function chargePush(type: string): { type: string; titre: string; corps: string; url: string } | null {
  const n = Object.hasOwn(NOTIFICATIONS_PUSH, type) ? NOTIFICATIONS_PUSH[type] : null;
  return n ? { type, titre: n.titre, corps: n.corps, url: n.vue ? `/${n.vue}` : '/' } : null;
}

/** Envoie une notification et enregistre son issue. */
async function envoyerUne(db: Db, e: EnvoiPush, transport: TransportPush, maintenant: Date): Promise<void> {
  const at = maintenant.toISOString();
  if (e.expire && e.expire <= at) {
    compteurs.expirees++;
    await db.update('envoisPush', e.id, { statut: 'expire', prochaine: null });
    return;
  }
  const abo = await db.get<AbonnementPush>('abonnementsPush', e.abonnementId);
  const cles = clesPush(), charge = chargePush(e.type), navigateur = abo ? navigateurDe(abo) : null;
  if (!abo || !cles || !charge || !navigateur) {
    compteurs.echecs++;
    await db.update('envoisPush', e.id, { statut: 'echec', prochaine: null, erreur: !abo ? 'Abonnement retiré' : !cles ? 'Notifications désactivées' : !charge ? 'Type inconnu' : 'Abonnement illisible (clé des pièces absente ou changée)' });
    return;
  }
  const r = await transport(requetePush(navigateur, charge, cles, { ttl: TTL_PUSH_S, maintenant }));
  const tentatives = e.tentatives + 1;
  if (r.status >= 200 && r.status < 300) {
    compteurs.envoyees++;
    await db.update('envoisPush', e.id, { statut: 'envoye', tentatives, envoi: at, prochaine: null, erreur: null });
    await db.update('abonnementsPush', abo.id, { dernierSucces: at, echecs: 0 });
    return;
  }
  if (r.status === 404 || r.status === 410) {
    compteurs.supprimes++;
    await supprimerAbonnements(db, [abo.id]);
    return;
  }
  const erreur = r.status ? `HTTP ${r.status}` : r.erreur ?? 'Erreur réseau';
  await db.update('abonnementsPush', abo.id, { dernierEchec: at, echecs: (abo.echecs ?? 0) + 1 });
  const temporaire = r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500;
  if (!temporaire || tentatives >= TENTATIVES_MAX) {
    compteurs.echecs++;
    await db.update('envoisPush', e.id, { statut: 'echec', tentatives, prochaine: null, erreur });
    return;
  }
  const delai = Math.min(HEURE, Math.max(attente(tentatives), r.apres ?? 0));
  await db.update('envoisPush', e.id, { tentatives, prochaine: new Date(maintenant.getTime() + delai).toISOString(), erreur });
}

let enCours = false;
/** Vrai pendant un passage : l'arrêt du serveur attend son issue (server/src/service.ts). */
export const envoiPushEnCours = () => enCours;

/**
 * Un passage : notifications dues (prochaine tentative atteinte), au plus 50, chacune indépendamment ; l'issue de chacune
 * est écrite seule sur la base (`exclusif`), après la réponse du service de push. Renvoie le nombre traité.
 */
export async function traiterFilePush(db: Db, transport: TransportPush = transportFetch, horloge = () => new Date()): Promise<number> {
  if (enCours) return 0;
  enCours = true;
  try {
    const dues = await db.query<{ id: number }>(`SELECT id FROM envois_push WHERE statut = 'a_envoyer' AND prochaine <= ? ORDER BY prochaine, id LIMIT ${PAQUET}`, [horloge().toISOString()]);
    let n = 0;
    for (const { id } of dues) {
      const e = await db.get<EnvoiPush>('envoisPush', Number(id));
      if (!e || e.statut !== 'a_envoyer') continue;
      // La requête part hors de la base ; son issue est écrite d'un seul tenant.
      await db.exclusif(async () => await envoyerUne(db, e, transport, horloge()));
      n++;
    }
    return n;
  } finally {
    enCours = false;
  }
}

/**
 * Processus de fond (server/src/index.ts) : file relevée au démarrage puis toutes les `intervalle` ms, seulement si le
 * push est actif (clés VAPID). Renvoie la fonction d'arrêt.
 */
export async function demarrerEnvoisPush(db: Db, transport: TransportPush = transportFetch, intervalle = 5000): Promise<() => void> {
  if (!clesPush()) return () => {};
  const relever = () => { void traiterFilePush(db, transport).catch(err => console.error('Notifications push :', err)); };
  relever();
  const timer = setInterval(relever, intervalle);
  timer.unref();
  return () => clearInterval(timer);
}

/** Conservation : notifications closes (envoyées, en échec, expirées) depuis 30 jours ; abonnements morts (sans succès depuis 90 jours, compte désactivé). */
export async function purgerPush(db: Db, maintenant = new Date()): Promise<{ envois: number; abonnements: number }> {
  const j = (n: number) => new Date(maintenant.getTime() - n * 86_400_000).toISOString();
  const envois = Number((await db.run(`DELETE FROM envois_push WHERE statut <> 'a_envoyer' AND creation < ?`, [j(30)])).changes);
  // Abonnements morts : sans succès depuis 90 jours, ou d'un compte désactivé (départ du salarié, compte retiré).
  const morts = await db.query<{ id: number }>(`SELECT a.id FROM abonnements_push a JOIN comptes c ON c.id = a.compte_id
    WHERE (a.dernier_echec IS NOT NULL AND COALESCE(a.dernier_succes, a.creation) < ?) OR c.actif = FALSE`, [j(90)]);
  return { envois, abonnements: await supprimerAbonnements(db, morts.map(m => Number(m.id))) };
}
