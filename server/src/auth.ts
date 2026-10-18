// Sessions de connexion, enregistrées en base (table `connexions`) : le cookie ne porte
// que l'identifiant signé (HMAC). Une session porte un compte (server/src/comptes.ts) et
// l'espace actif, qui doit être l'un des espaces du compte. Chaque requête vérifie l'existence
// de la session, sa révocation, son expiration (12 h après l'ouverture, sans prolongation) et
// le compte : actif, salarié rattaché toujours présent. En mode démonstration (CURSUS_DEMO=1),
// la connexion est libre (choix d'un compte, mot de passe quelconque) et une session peut
// attendre, sans compte, le choix d'un compte pour l'espace demandé.
// Connexion : routes de server/src/connexion.ts (compte local) et server/src/microsoft.ts (Microsoft 365).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Role } from '../../shared/types.ts';
import { compteValide, espacesDuCompte } from './comptes.ts';
import { demoActive } from './config.ts';
import type { Db } from './db.ts';
import { noterCompte } from './logs.ts';

/** Mode d'ouverture : mot de passe d'un compte local, connexion libre de démonstration, Microsoft 365 (OpenID Connect). */
export type Methode = 'local' | 'demo' | 'microsoft';

export interface SessionInfo {
  /** Identifiant de la session (table `connexions`), absent tant qu'elle n'est pas ouverte. */
  id?: string;
  /** Compte connecté ; null seulement en démonstration, tant qu'aucun compte n'est choisi pour l'espace. */
  compteId: number | null;
  /** Espace actif. */
  role: Role;
  methode: Methode;
  /** Démonstration : dernier compte choisi dans chaque espace, pour y revenir sans nouvelle saisie. */
  demoComptes?: Partial<Record<Role, number>>;
  /** Fin de validité (ISO) : 12 h après l'ouverture. */
  expiration?: string;
}

interface ConnexionRow {
  id: string; compteId: number | null; role: Role; methode: Methode | null; demoComptes: Partial<Record<Role, number>> | null;
  creation: string; expiration: string; revocation: string | null; activite: string | null;
}

export const DEMO = demoActive();
export const ROLES: Role[] = ['rh', 'manager', 'collaborateur'];
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

/** Signature HMAC d'une valeur de cookie (session, et état de l'aller-retour Microsoft dans microsoft.ts). */
export const sign = (db: Db, payload: string) => createHmac('sha256', secret(db)).update(payload).digest('base64url');

export function parseCookies(req: Request): Record<string, string> {
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

/**
 * Session valide portée par la requête, ou null (absente, falsifiée, expirée, révoquée). Une session
 * dont le compte ne peut plus se connecter (désactivé, salarié sorti, plus aucun espace) est révoquée ;
 * si seul l'espace actif a disparu (profil RH retiré, équipe confiée à un autre), elle passe au premier
 * espace restant du compte.
 */
export function readSession(db: Db, req: Request): SessionInfo | null {
  const id = cookieId(db, req);
  if (!id) return null;
  const row = db.get<ConnexionRow>('connexions', id);
  const now = new Date().toISOString();
  if (!row || row.revocation || row.expiration <= now) return null;
  if (!ROLES.includes(row.role)) return null;
  let role = row.role;
  if (row.compteId == null) {
    // Sans compte : démonstration seulement (espace choisi, compte pas encore désigné).
    if (!DEMO) return null;
  } else {
    const c = compteValide(db, row.compteId);
    if (!c) {
      db.update('connexions', id, { revocation: now });
      return null;
    }
    const espaces = espacesDuCompte(db, c);
    if (!espaces.includes(role)) {
      role = espaces[0];
      db.update('connexions', id, { role });
    }
  }
  if (!row.activite || Date.parse(now) - Date.parse(row.activite) > ACTIVITE_MS) db.update('connexions', id, { activite: now });
  noterCompte(req, row.compteId); // compte inscrit sur la ligne de la requête (server/src/logs.ts)
  return { id, compteId: row.compteId, role, methode: row.methode ?? 'local', demoComptes: row.demoComptes ?? {}, expiration: row.expiration };
}

/**
 * Compte de la session portée par la requête (cookie signé, session ni révoquée ni expirée), sans autre contrôle ni
 * écriture : sert à limiter le débit par compte (server/src/debit.ts) avant que la route ne lise la session.
 */
export function compteDeLaRequete(db: Db, req: Request): number | null {
  const id = cookieId(db, req);
  const row = id ? db.get<ConnexionRow>('connexions', id) : null;
  return row && !row.revocation && row.expiration > new Date().toISOString() ? row.compteId : null;
}

/** Attribut Secure des cookies : en production, sauf application de bureau en http://127.0.0.1 (CURSUS_INSECURE_COOKIE=1). */
export const cookieSecure = () => process.env.NODE_ENV === 'production' && process.env.CURSUS_INSECURE_COOKIE !== '1' ? '; Secure' : '';

function setCookie(res: Response, value: string, maxAge: number) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecure()}`);
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
  db.insert('connexions', {
    id, compteId: s.compteId, role: s.role, methode: s.methode, demoComptes: s.demoComptes ?? {},
    creation: now.toISOString(), expiration: fin, activite: now.toISOString(),
  });
  setCookie(res, `${id}.${sign(db, id)}`, Math.max(0, Math.floor((Date.parse(fin) - now.getTime()) / 1000)));
  return { ...s, id, expiration: fin };
}

/** Met à jour une session ouverte (changement d'espace) sans changer son identifiant ni son échéance. */
export function updateSession(db: Db, s: SessionInfo): SessionInfo {
  if (s.id) db.update('connexions', s.id, { compteId: s.compteId, role: s.role, methode: s.methode, demoComptes: s.demoComptes ?? {} });
  return s;
}

export function revokeSession(db: Db, id: string) {
  db.sql.prepare('UPDATE connexions SET revocation = ? WHERE id = ? AND revocation IS NULL').run(new Date().toISOString(), id);
}

/** Révoque toutes les sessions ouvertes d'un compte, sauf éventuellement `sauf`. Renvoie leur nombre. */
export function revokeSessionsDuCompte(db: Db, compteId: number, sauf?: string): number {
  const r = db.sql.prepare('UPDATE connexions SET revocation = ? WHERE compte_id = ? AND id IS NOT ? AND revocation IS NULL')
    .run(new Date().toISOString(), compteId, sauf ?? null);
  return Number(r.changes);
}

/** Révoque toutes les sessions ouvertes d'un salarié (sortie de l'entreprise, compte compromis). Renvoie leur nombre. */
export function revokeSessionsOf(db: Db, empId: number): number {
  const r = db.sql.prepare('UPDATE connexions SET revocation = ? WHERE compte_id IN (SELECT id FROM comptes WHERE emp_id = ?) AND revocation IS NULL')
    .run(new Date().toISOString(), empId);
  return Number(r.changes);
}

/** Supprime les sessions expirées (révoquées ou non). Renvoie leur nombre. */
export function purgeSessions(db: Db): number {
  return Number(db.sql.prepare('DELETE FROM connexions WHERE expiration <= ?').run(new Date().toISOString()).changes);
}

/**
 * Échecs de connexion par adresse IP (fenêtre fixe, en mémoire) : au-delà de `max` échecs dans la
 * fenêtre, les tentatives venant de cette adresse sont refusées jusqu'à la fin de la fenêtre. Le
 * blocage du compte (5 échecs) protège chaque compte ; cette limite freine l'essai de nombreux comptes.
 * Seuil volontairement large : un atelier entier peut sortir par une seule adresse.
 * Une tentative de mot de passe est comptée dès son arrivée (`echec`), avant le calcul, puis rendue
 * si la connexion réussit (`rendre`) : des requêtes simultanées ne dépassent pas le seuil.
 * Mémoire bornée : au-delà de `maxIp` adresses suivies, les fenêtres closes puis les plus anciennes sont oubliées.
 */
export class LimiteParIp {
  private echecs = new Map<string, { n: number; debut: number }>();
  readonly max: number;
  readonly fenetreMs: number;
  readonly maxIp: number;
  private maintenant: () => number;
  constructor(max = 30, fenetreMs = 15 * 60_000, maintenant = () => Date.now(), maxIp = 10_000) {
    this.max = max; this.fenetreMs = fenetreMs; this.maintenant = maintenant; this.maxIp = maxIp;
  }

  private courant(ip: string) {
    const e = this.echecs.get(ip);
    if (e && this.maintenant() - e.debut >= this.fenetreMs) { this.echecs.delete(ip); return undefined; }
    return e;
  }
  depasse(ip: string): boolean { return (this.courant(ip)?.n ?? 0) >= this.max; }
  /** Secondes avant la fin de la fenêtre de cette adresse (en-tête Retry-After d'un refus 429). */
  attente(ip: string): number {
    const e = this.courant(ip);
    return e ? Math.max(1, Math.ceil((e.debut + this.fenetreMs - this.maintenant()) / 1000)) : 0;
  }
  /** Adresses suivies (contrôle de la mémoire). */
  get taille() { return this.echecs.size; }
  echec(ip: string) {
    const e = this.courant(ip);
    if (e) e.n++;
    else {
      // Les adresses dont la fenêtre est close sont oubliées, puis les plus anciennes si la limite est atteinte.
      if (this.echecs.size >= this.maxIp) {
        for (const k of [...this.echecs.keys()]) this.courant(k);
        for (const k of this.echecs.keys()) { if (this.echecs.size < this.maxIp * 0.9) break; this.echecs.delete(k); }
      }
      this.echecs.set(ip, { n: 1, debut: this.maintenant() });
    }
  }
  /** Tentative comptée d'avance qui a abouti : elle ne compte plus parmi les échecs. */
  rendre(ip: string) {
    const e = this.courant(ip);
    if (e && e.n > 0) e.n--;
  }
}
