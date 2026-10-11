// Sessions de connexion, enregistrées en base (table `connexions`) : le cookie ne porte
// que l'identifiant signé (HMAC). Chaque requête vérifie l'existence de la session, sa
// révocation, son expiration (12 h après l'ouverture, sans prolongation) et le départ
// du salarié rattaché. En mode démonstration (CURSUS_DEMO=1), n'importe quel mot de
// passe est accepté et l'espace RH s'ouvre sans saisie.
// Pour la production, brancher ici l'authentification unique de l'entreprise
// (OIDC / SAML) : `login` doit alors vérifier l'identité auprès du fournisseur.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Role } from '../../shared/types.ts';
import { demoActive } from './config.ts';
import { todayIso } from './dataset.ts';
import type { Db } from './db.ts';

export interface SessionInfo {
  /** Identifiant de la session (table `connexions`), absent tant qu'elle n'est pas ouverte. */
  id?: string;
  /** Espace actif. */
  role: Role;
  rh: boolean;
  managerId: number | null;
  collabId: number | null;
  /** Fin de validité (ISO) : 12 h après l'ouverture. */
  expiration?: string;
}

interface ConnexionRow {
  id: string; role: Role; rh: boolean; managerId: number | null; collabId: number | null;
  creation: string; expiration: string; revocation: string | null; activite: string | null;
}

export const DEMO = demoActive();
const COOKIE = 'cursus_session';
/** Durée de vie d'une session, comptée depuis l'ouverture (l'activité ne la prolonge pas). */
export const SESSION_HEURES = 12;
/** Intervalle minimal entre deux mises à jour de la dernière activité. */
const ACTIVITE_MS = 60_000;

function secret(db: Db): string {
  if (process.env.CURSUS_SECRET) return process.env.CURSUS_SECRET;
  let s = db.getSetting<string | null>('secret', null);
  if (!s) { s = randomBytes(32).toString('hex'); db.setSetting('secret', s); }
  return s;
}

const sign = (db: Db, payload: string) => createHmac('sha256', secret(db)).update(payload).digest('base64url');

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* cookie mal encodé : ignoré */ }
    }
  });
  return out;
}

/** Identifiant de session lu dans le cookie, si sa signature est valide. */
function cookieId(db: Db, req: Request): string | null {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [id, mac] = raw.split('.');
  if (!id || !mac) return null;
  const expected = Buffer.from(sign(db, id)), given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** Le salarié a-t-il quitté l'entreprise (date de sortie passée) ? */
export function salarieSorti(db: Db, empId: number | null): boolean {
  if (!empId) return false;
  const fin = db.get<{ fin: string | null }>('employes', empId)?.fin;
  return !!fin && fin < todayIso();
}

/** Session valide portée par la requête, ou null (absente, falsifiée, expirée, révoquée). */
export function readSession(db: Db, req: Request): SessionInfo | null {
  const id = cookieId(db, req);
  if (!id) return null;
  const row = db.get<ConnexionRow>('connexions', id);
  const now = new Date().toISOString();
  if (!row || row.revocation || row.expiration <= now) return null;
  if (!['rh', 'manager', 'collaborateur'].includes(row.role)) return null;
  if (salarieSorti(db, row.managerId) || salarieSorti(db, row.collabId)) {
    db.update('connexions', id, { revocation: now });
    return null;
  }
  if (!row.activite || Date.parse(now) - Date.parse(row.activite) > ACTIVITE_MS) db.update('connexions', id, { activite: now });
  return { id, role: row.role, rh: row.rh, managerId: row.managerId, collabId: row.collabId, expiration: row.expiration };
}

function setCookie(res: Response, value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' && process.env.CURSUS_INSECURE_COOKIE !== '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function clearSessionCookie(res: Response) {
  setCookie(res, '', 0);
}

/**
 * Ouvre une nouvelle session (nouvel identifiant) et pose le cookie. `expiration` permet
 * de reprendre l'échéance d'une session remplacée sans la prolonger.
 */
export function openSession(db: Db, res: Response, s: SessionInfo, expiration?: string): SessionInfo {
  const now = new Date();
  const fin = expiration ?? new Date(now.getTime() + SESSION_HEURES * 3600_000).toISOString();
  const id = randomBytes(32).toString('base64url');
  db.insert('connexions', { id, role: s.role, rh: s.rh, managerId: s.managerId, collabId: s.collabId, creation: now.toISOString(), expiration: fin, activite: now.toISOString() });
  setCookie(res, `${id}.${sign(db, id)}`, Math.max(0, Math.floor((Date.parse(fin) - now.getTime()) / 1000)));
  return { ...s, id, expiration: fin };
}

/** Met à jour une session ouverte (changement d'espace) sans changer son identifiant ni son échéance. */
export function updateSession(db: Db, s: SessionInfo): SessionInfo {
  if (s.id) db.update('connexions', s.id, { role: s.role, rh: s.rh, managerId: s.managerId, collabId: s.collabId });
  return s;
}

export function revokeSession(db: Db, id: string) {
  db.sql.prepare('UPDATE connexions SET revocation = ? WHERE id = ? AND revocation IS NULL').run(new Date().toISOString(), id);
}

/** Révoque toutes les sessions ouvertes d'un salarié (sortie de l'entreprise, compte compromis). Renvoie leur nombre. */
export function revokeSessionsOf(db: Db, empId: number): number {
  const r = db.sql.prepare('UPDATE connexions SET revocation = ? WHERE (manager_id = ? OR collab_id = ?) AND revocation IS NULL')
    .run(new Date().toISOString(), empId, empId);
  return Number(r.changes);
}

/** Supprime les sessions expirées (révoquées ou non). Renvoie leur nombre. */
export function purgeSessions(db: Db): number {
  return Number(db.sql.prepare('DELETE FROM connexions WHERE expiration <= ?').run(new Date().toISOString()).changes);
}

/** L'espace actif est-il ouvert (identité connue pour ce rôle) ? */
export function isAuthenticated(s: SessionInfo | null): s is SessionInfo {
  if (!s) return false;
  return s.role === 'rh' ? s.rh : s.role === 'manager' ? !!s.managerId : !!s.collabId;
}
