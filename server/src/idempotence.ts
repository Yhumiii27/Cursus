// Idempotence des envois (lot 11, chantier C2, t196) : une action (POST /api/actions/:nom) ou un envoi de pièce
// (POST /api/pieces) qui porte l'en-tête Idempotency-Key n'est fait qu'une fois. La file hors ligne de l'application
// (client/src/state/hors-ligne.ts) rejoue ainsi sans doublon une saisie dont la réponse s'est perdue (délai dépassé,
// réseau coupé après l'envoi).
// - La réponse est gardée dans la table `idempotence` dans la transaction de l'action : une action refusée ou annulée ne
//   laisse rien, et le rejeu la refait (et la refuse de nouveau, le cas échéant).
// - Même clé, même corps : la réponse gardée est rendue sans refaire l'action (`relire: true` : le client relit
//   l'instantané). Même clé, autre corps ou autre action : refus 422, jamais l'une à la place de l'autre.
// - La clé est propre au compte : `cle` est l'empreinte SHA-256 du compte et de la clé reçue (une clé devinée ne rend
//   jamais la réponse d'un autre compte). Le résultat gardé est réduit aux identifiants et compteurs (jamais de texte :
//   un jeton d'abonnement, un nom) ; le message est celui de l'action, déjà rendu à la personne.
// - Conservation : 30 jours, purge par la tâche du quart d'heure (server/src/notifications.ts, `tachesEmails`).
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { EN_TETE_IDEMPOTENCE, FORME_CLE_IDEMPOTENCE } from '../../shared/hors-ligne.ts';
import type { Db } from './db.ts';

/** Durée de conservation des réponses gardées. */
export const CONSERVATION_IDEMPOTENCE_JOURS = 30;
export const CLE_INVALIDE = 'Clé d’idempotence invalide : 16 à 100 lettres, chiffres, tirets ou soulignés';
export const CLE_REUTILISEE = 'Clé d’idempotence déjà utilisée pour un autre envoi : cette saisie n’est pas rejouée';

/** Réponse gardée, rendue à un nouvel envoi de la même requête. */
export interface ReponseGardee { statut: number; message: string | null; resultat: unknown }

/** Ligne de la table `idempotence`. */
interface LigneIdempotence { cle: string; compteId: number; action: string; empreinteCorps: string; statut: number; message: string | null; resultat: unknown; creation: string }

/** Clé reçue dans l'en-tête : absente (null), invalide (false), ou la clé. */
export function lireCle(req: Pick<Request, 'get'>): string | null | false {
  const v = req.get(EN_TETE_IDEMPOTENCE);
  if (v === undefined || v === '') return null;
  return FORME_CLE_IDEMPOTENCE.test(v) ? v : false;
}

const sha256 = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');

/** JSON aux clés triées : deux corps égaux donnent la même empreinte, quel que soit l'ordre des champs. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

/** Empreinte d'un corps reçu : objet JSON (action) ou octets (pièce), précédé du nom de l'opération. */
export function empreinteCorps(operation: string, corps: unknown): string {
  return sha256(Buffer.concat([Buffer.from(`${operation}\n`), Buffer.isBuffer(corps) ? corps : Buffer.from(JSON.stringify(stable(corps ?? {})))]));
}

/** Clé stockée : empreinte du compte et de la clé reçue. */
export const cleStockee = (compteId: number, cle: string) => sha256(`${compteId}:${cle}`);

/**
 * Résultat réduit à garder : seuls les nombres, booléens et listes de nombres d'un objet (identifiants créés, compteurs).
 * Jamais une chaîne (jeton, nom, texte) : le client relit l'instantané après un rejeu.
 */
export function resultatReduit(r: unknown): Record<string, unknown> | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v) && v.every(x => typeof x === 'number')) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Envoi désigné par sa clé : compte, clé reçue, opération (nom de l'action, « piece.deposer ») et corps. */
export interface Envoi { compteId: number; cle: string; operation: string; empreinte: string }

/** Erreur de la vérification : clé déjà utilisée pour une autre requête (422). */
export class CleReutilisee extends Error {
  constructor() { super(CLE_REUTILISEE); }
}

/**
 * Réponse gardée pour cet envoi, ou null s'il n'a jamais abouti. CleReutilisee si la clé a servi à une autre requête
 * (autre opération ou autre corps). À appeler dans la transaction de l'action, avant elle : les écritures étant
 * sérialisées, deux envois simultanés de la même requête ne la font pas deux fois.
 */
export async function reponseGardee(db: Db, e: Envoi): Promise<ReponseGardee | null> {
  const l = await db.get<LigneIdempotence>('idempotence', cleStockee(e.compteId, e.cle));
  if (!l) return null;
  if (l.action !== e.operation || l.empreinteCorps !== e.empreinte) throw new CleReutilisee();
  return { statut: Number(l.statut), message: l.message, resultat: l.resultat ?? null };
}

/** Garde la réponse d'un envoi abouti, dans la transaction de l'action (annulée, elle ne garde rien). */
export async function garderReponse(db: Db, e: Envoi, r: { statut?: number; message: string | null; resultat?: unknown }): Promise<void> {
  await db.insert('idempotence', {
    cle: cleStockee(e.compteId, e.cle), compteId: e.compteId, action: e.operation, empreinteCorps: e.empreinte,
    statut: r.statut ?? 200, message: r.message, resultat: resultatReduit(r.resultat), creation: new Date().toISOString(),
  });
}

/** Purge des réponses gardées depuis plus de 30 jours (`maintenant` : horloge). Renvoie le nombre supprimé. */
export async function purgerIdempotence(db: Db, maintenant = new Date()): Promise<number> {
  const avant = new Date(maintenant.getTime() - CONSERVATION_IDEMPOTENCE_JOURS * 86_400_000).toISOString();
  return Number((await db.run('DELETE FROM idempotence WHERE creation < ?', [avant])).changes);
}
