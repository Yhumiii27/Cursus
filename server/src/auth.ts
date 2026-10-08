// Sessions signées (cookie HMAC). En mode démonstration (CURSUS_DEMO ≠ 0),
// n'importe quel mot de passe est accepté et l'espace RH s'ouvre sans saisie.
// Pour la production, brancher ici l'authentification unique de l'entreprise
// (OIDC / SAML) : `login` doit alors vérifier l'identité auprès du fournisseur.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Role } from '../../shared/types.ts';
import type { Db } from './db.ts';

export interface SessionInfo {
  /** Espace actif. */
  role: Role;
  rh: boolean;
  managerId: number | null;
  collabId: number | null;
}

export const DEMO = process.env.CURSUS_DEMO !== '0';
const COOKIE = 'cursus_session';

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
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function readSession(db: Db, req: Request): SessionInfo | null {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(db, payload)), given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionInfo;
    return ['rh', 'manager', 'collaborateur'].includes(s.role) ? s : null;
  } catch {
    return null;
  }
}

export function writeSession(db: Db, res: Response, s: SessionInfo | null) {
  if (!s) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return;
  }
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  const secure = process.env.NODE_ENV === 'production' && process.env.CURSUS_INSECURE_COOKIE !== '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(db, payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}${secure}`);
}

/** L'espace actif est-il ouvert (identité connue pour ce rôle) ? */
export function isAuthenticated(s: SessionInfo | null): s is SessionInfo {
  if (!s) return false;
  return s.role === 'rh' ? s.rh : s.role === 'manager' ? !!s.managerId : !!s.collabId;
}
