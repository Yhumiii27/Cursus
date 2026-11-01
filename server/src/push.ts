// Notifications sur le téléphone (lot 11, chantier C2, t196) : clés VAPID, abonnements des appareils, mise en file.
// Réponses du propriétaire (31 octobre 2026) : notifications génériques (texte fixe, sans nom ni date :
// shared/notifications-push.ts), coupées par défaut (la personne choisit les types qu'elle reçoit), jamais de 20 h à 7 h
// ni le week-end (envoi différé). Le push s'ajoute à l'e-mail sans le remplacer.
// - Clés : CURSUS_VAPID_* en production (server/src/config.ts, `configVapid`) ; leur absence désactive le push. En
//   démonstration, une paire est créée en mémoire au démarrage (rien n'est rangé en base) : les abonnements d'une
//   démonstration ne survivent pas à un redémarrage.
// - Abonnements (table `abonnementsPush`, dans TABLES_SANS_REVISION) : un par compte et par appareil ; l'adresse du
//   service de push et les clés du navigateur sont chiffrées avec la clé des pièces (CURSUS_PIECES_KEY) quand elle est
//   posée. Chaque compte ne voit et ne gère que les siens (route dédiée, jamais l'instantané) ; l'administrateur RH peut
//   tous les révoquer.
// - Mise en file (`mettreEnFilePush`) : par notifier() (server/src/notifications.ts), dans la transaction de l'action ;
//   envoi par le processus de server/src/envois-push.ts.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { MAX_ABONNEMENTS_PUSH, NOTIFICATIONS_PUSH, prochainEnvoiAdmis, TTL_PUSH_S } from '../../shared/notifications-push.ts';
import { clePieces, configVapid, demoActive, type Env } from './config.ts';
import { type Db, jsonLu } from './db.ts';
import { type AbonnementNavigateur, type ClesVapid, nouvellesClesVapid } from './integrations/push.ts';

export const PUSH_DESACTIVE = 'Notifications sur le téléphone désactivées sur ce serveur : le service informatique pose les clés CURSUS_VAPID_* (docs/DEPLOIEMENT.md)';

let clesDemo: ClesVapid | null = null;
/**
 * Clés VAPID en vigueur : celles de l'environnement, sinon, en démonstration, une paire créée en mémoire (une seule par
 * processus) ; null : push désactivé.
 */
export function clesPush(env: Env = process.env): ClesVapid | null {
  const c = configVapid(env);
  if (c) return c;
  if (!demoActive(env)) return null;
  clesDemo ??= nouvellesClesVapid('mailto:notifications@cursus.invalid');
  return clesDemo;
}

// — Chiffrement des champs sensibles d'un abonnement (clé des pièces) —

/** Préfixe d'un champ chiffré (version 1) ; un champ sans préfixe est en clair (serveur sans CURSUS_PIECES_KEY). */
const PREFIXE = 'pc1:';

/** Champ chiffré en AES-256-GCM avec la clé des pièces, authentifié avec son nom de colonne ; en clair sans clé. */
export function chiffrerChamp(clair: string, colonne: string, cle: Buffer | null = clePieces()): string {
  if (!cle) return clair;
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', cle, iv);
  c.setAAD(Buffer.from(`abonnements_push.${colonne}`));
  const chiffre = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return PREFIXE + Buffer.concat([iv, c.getAuthTag(), chiffre]).toString('base64url');
}

/** Champ en clair ; null s'il est chiffré et illisible (clé absente ou changée) : l'abonnement est alors inutilisable. */
export function dechiffrerChamp(stocke: string, colonne: string, cle: Buffer | null = clePieces()): string | null {
  if (!stocke.startsWith(PREFIXE)) return stocke;
  if (!cle) return null;
  try {
    const b = Buffer.from(stocke.slice(PREFIXE.length), 'base64url');
    const d = createDecipheriv('aes-256-gcm', cle, b.subarray(0, 12));
    d.setAAD(Buffer.from(`abonnements_push.${colonne}`));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Empreinte de l'adresse d'abonnement : unique par appareil et par navigateur, montrée à l'application (« cet appareil »). */
export const cleEndpoint = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

// — Abonnements —

/** Ligne de la table `abonnementsPush`. */
export interface AbonnementPush {
  id: number; compteId: number; cleEndpoint: string; endpoint: string; p256dh: string; auth: string; appareil: string | null;
  types: string[] | null; creation: string; dernierSucces: string | null; dernierEchec: string | null; echecs: number;
}

/** Appareil abonné, tel que le voit son compte (Mes appareils) : jamais l'adresse ni les clés. */
export interface AppareilPush { id: number; appareil: string | null; empreinte: string; types: string[]; creation: string; dernierSucces: string | null; dernierEchec: string | null }

/** Appareils abonnés d'un compte, le plus récent d'abord. */
export async function appareilsDe(db: Db, compteId: number): Promise<AppareilPush[]> {
  const lignes = await db.where<AbonnementPush>('abonnementsPush', 'compteId', compteId);
  return lignes.sort((a, b) => b.id - a.id).map(a => ({
    id: a.id, appareil: a.appareil, empreinte: a.cleEndpoint, types: a.types ?? [], creation: a.creation, dernierSucces: a.dernierSucces, dernierEchec: a.dernierEchec,
  }));
}

/** Abonnement en clair pour l'envoi ; null si ses champs chiffrés sont illisibles. */
export function navigateurDe(a: Pick<AbonnementPush, 'endpoint' | 'p256dh' | 'auth'>): AbonnementNavigateur | null {
  const endpoint = dechiffrerChamp(a.endpoint, 'endpoint'), p256dh = dechiffrerChamp(a.p256dh, 'p256dh'), auth = dechiffrerChamp(a.auth, 'auth');
  return endpoint && p256dh && auth ? { endpoint, p256dh, auth } : null;
}

/**
 * Abonne l'appareil au compte (adresse déjà connue : abonnement repris par ce compte, préférences du compte). Les types
 * reçus sont ceux des autres appareils du compte (préférences par compte), aucun pour un premier appareil. Au-delà de
 * MAX_ABONNEMENTS_PUSH, le plus ancien est retiré. Renvoie l'abonnement et s'il est nouveau.
 */
export async function enregistrerAbonnement(db: Db, o: { compteId: number; navigateur: AbonnementNavigateur; appareil: string }): Promise<{ id: number; nouveau: boolean }> {
  const cle = cleEndpoint(o.navigateur.endpoint);
  const autres = await db.where<AbonnementPush>('abonnementsPush', 'compteId', o.compteId);
  const types = autres.find(a => a.cleEndpoint !== cle)?.types ?? [];
  const champs = {
    compteId: o.compteId, endpoint: chiffrerChamp(o.navigateur.endpoint, 'endpoint'), p256dh: chiffrerChamp(o.navigateur.p256dh, 'p256dh'),
    auth: chiffrerChamp(o.navigateur.auth, 'auth'), appareil: o.appareil,
  };
  const deja = (await db.where<AbonnementPush>('abonnementsPush', 'cleEndpoint', cle))[0];
  if (deja) {
    // Même navigateur, peut-être un autre compte (appareil partagé, changement de compte) : repris tel quel par celui-ci.
    await db.update('abonnementsPush', deja.id, { ...champs, ...(deja.compteId !== o.compteId ? { types } : {}), echecs: 0 });
    return { id: deja.id, nouveau: false };
  }
  const anciens = autres.sort((a, b) => a.id - b.id).slice(0, Math.max(0, autres.length - MAX_ABONNEMENTS_PUSH + 1));
  // Retirés avec leurs notifications encore en file (sans clé étrangère en SQLite, rien ne les emporterait).
  await supprimerAbonnements(db, anciens.map(a => a.id));
  const a = await db.insert<AbonnementPush>('abonnementsPush', { ...champs, cleEndpoint: cle, types, creation: new Date().toISOString(), dernierSucces: null, dernierEchec: null, echecs: 0 });
  return { id: a.id, nouveau: true };
}

/** Supprime les abonnements désignés (et leurs notifications encore en file). Renvoie leur nombre. */
export async function supprimerAbonnements(db: Db, ids: readonly number[]): Promise<number> {
  for (const id of ids) {
    await db.run('DELETE FROM envois_push WHERE abonnement_id = ?', [id]);
    await db.remove('abonnementsPush', id);
  }
  return ids.length;
}

// — Mise en file —

/**
 * Met en file la notification `type` pour chaque appareil abonné du salarié `empId` (comptes actifs rattachés) qui l'a
 * choisie, dans la transaction en cours. Sans effet si le push est désactivé, si le type n'a pas de notification push
 * (texte fixe du registre) ou si personne ne l'a choisi. Envoi au premier instant admis (plage de silence) ; validité
 * 24 h à partir de cet instant. `force` (essai demandé par la personne) : à tous ses appareils, préférences et plage de
 * silence ignorées. Renvoie le nombre de messages mis en file.
 */
export async function mettreEnFilePush(db: Db, cible: { empId?: number | null; compteId?: number }, type: string, o: { maintenant?: Date; force?: boolean } = {}): Promise<number> {
  if (!Object.hasOwn(NOTIFICATIONS_PUSH, type) || !clesPush()) return 0;
  const lignes = cible.compteId != null
    ? await db.query<{ id: number; types: unknown }>('SELECT a.id, a.types FROM abonnements_push a WHERE a.compte_id = ?', [cible.compteId])
    : cible.empId
      ? await db.query<{ id: number; types: unknown }>('SELECT a.id, a.types FROM abonnements_push a JOIN comptes c ON c.id = a.compte_id WHERE c.emp_id = ? AND c.actif = TRUE', [cible.empId])
      : [];
  const maintenant = o.maintenant ?? new Date();
  const envoi = o.force ? maintenant : prochainEnvoiAdmis(maintenant);
  let n = 0;
  for (const l of lignes) {
    const types = jsonLu(l.types);
    if (!o.force && !(Array.isArray(types) && types.includes(type))) continue;
    await db.insert('envoisPush', {
      abonnementId: Number(l.id), type, statut: 'a_envoyer', tentatives: 0, prochaine: envoi.toISOString(),
      expire: new Date(envoi.getTime() + TTL_PUSH_S * 1000).toISOString(), erreur: null, creation: maintenant.toISOString(), envoi: null,
    });
    n++;
  }
  return n;
}
