// File d'envoi persistante des messages sortants (Keystone, e-mails par Microsoft Graph). Sage Paie n'y passe
// pas : la paie importe elle-même le fichier de chaque lot (server/src/fichier-paie.ts), suivi par la table
// `lotsPaie` (décision du 15 octobre 2026). Un message est mis en file dans la transaction de l'action qui le produit : si
// l'action échoue, rien ne part. Un processus de fond le transmet ensuite, hors de toute requête :
// un seul envoi à la fois par cible, dans l'ordre d'émission. Le message en tête qui attend une
// nouvelle tentative retient les suivants : un verdict ancien n'arrive pas après un plus récent
// (sauf relance d'un envoi en échec, qui repart avec sa date d'émission).
// La clé d'idempotence (en-tête Idempotency-Key) reste la même d'une tentative à l'autre :
// le destinataire écarte un message déjà reçu.
import { randomUUID } from 'node:crypto';
import type { CibleEnvoi as Cible, Envoi, EtatEnvois, StatutEnvoi } from '../../shared/types.ts';
import type { Db } from './db.ts';

export type { Cible, Envoi, StatutEnvoi };
export const STATUTS_ENVOI: StatutEnvoi[] = ['a_envoyer', 'envoye', 'echec', 'simule'];
export const CIBLES: Cible[] = ['keystone', 'email'];

/** Requête HTTP d'une cible : adresse, en-têtes (authentification) et corps de chaque message. */
export interface Transport {
  url: string;
  /** En-têtes d'authentification ; peut d'abord obtenir un jeton (e-mails : jeton applicatif Microsoft). */
  entetes: (e: Envoi) => Record<string, string> | Promise<Record<string, string>>;
  corps: (e: Envoi) => unknown;
  /** Délai maximal d'une tentative, en millisecondes. */
  delai?: number;
  /** Réponse non 2xx : vrai si une nouvelle tentative peut réussir malgré un statut 4xx (jeton expiré, à renouveler). */
  surRefus?: (status: number) => boolean;
}

/** Échec survenu avant l'envoi (jeton refusé…) : définitif (configuration à corriger) ou temporaire. */
export class ErreurEnvoi extends Error {
  definitif: boolean;
  constructor(message: string, definitif: boolean) {
    super(message);
    this.definitif = definitif;
  }
}

export const TENTATIVES_MAX = 10;
export const DELAI_MAX = 10_000;
const MINUTE = 60_000, HEURE = 60 * MINUTE;

/** Attente avant la tentative suivante : 1 min après la première, puis double à chaque échec, 1 h au plus. */
export function attente(tentatives: number): number {
  return Math.min(HEURE, MINUTE * 2 ** Math.max(0, tentatives - 1));
}

/** Met un message en file, dans la transaction en cours : annulée, elle n'envoie rien. */
export async function mettreEnFile(db: Db, cible: Cible, type: string, contenu: Record<string, unknown>, simule: boolean): Promise<Envoi> {
  const maintenant = new Date().toISOString();
  return await db.insert<Envoi>('envois', {
    cible, type, cle: randomUUID(), contenu, statut: simule ? 'simule' : 'a_envoyer', tentatives: 0,
    prochaine: simule ? null : maintenant, erreur: null, accuse: null, creation: maintenant, tentative: null, envoi: null, classe: null,
  });
}

/** Message le plus ancien encore à envoyer pour cette cible. */
function tete(db: Db, cible: Cible): Promise<Envoi | null> {
  return db.exclusif(async () => {
    const r = await db.one(`SELECT id FROM envois WHERE cible = ? AND statut = 'a_envoyer' ORDER BY id LIMIT 1`, [cible]) as { id: number } | undefined;
    return r ? await db.get<Envoi>('envois', r.id) ?? null : null;
  });
}

type Issue = { ok: true; accuse: string } | { ok: false; definitif: boolean; erreur: string; apres?: number };

const court = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Cause lisible d'une erreur réseau de fetch (connexion refusée, nom inconnu…). Une adresse citée par le
 * message est retirée : elle pourrait porter des identifiants (montrés au RH et écrits dans le journal).
 */
function causeReseau(err: unknown): string {
  const c = (err as { cause?: { code?: string; message?: string } })?.cause;
  const texte = c?.code || c?.message || (err as Error)?.message || String(err);
  return court(texte.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<adresse>'), 120);
}

/** Attente demandée par le destinataire (en-tête Retry-After, en secondes ou en date), en millisecondes. */
function retryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const ms = /^\d+$/.test(v.trim()) ? Number(v) * 1000 : Date.parse(v) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * Erreur renvoyée par le destinataire : statut HTTP, code et message JSON s'il y en a (y compris la forme
 * `{ error: { code, message } }` de Microsoft Graph), sinon le début du texte.
 */
export function erreurHttp(status: number, texte: string): string {
  let detail: string;
  try {
    const j = JSON.parse(texte) as { code?: unknown; error?: unknown; message?: unknown } | null;
    const g = j?.error && typeof j.error === 'object' ? j.error as { code?: unknown; message?: unknown } : null;
    detail = (g ? [g.code, g.message] : [j?.code, j?.error ?? j?.message]).filter(x => typeof x === 'string' && x).join(' — ');
  } catch {
    detail = court(texte.replace(/\s+/g, ' ').trim(), 200); // corps non JSON (page d'erreur d'un proxy…)
  }
  return court(`HTTP ${status}${detail ? ` · ${detail}` : ''}`);
}

/**
 * Une tentative : 2xx → reçu (accusé du corps JSON `accuse`, sinon le statut HTTP) ; 408, 429, 5xx,
 * erreur réseau ou délai dépassé → nouvelle tentative ; autre statut (4xx, redirection) → échec définitif.
 */
async function tenter(e: Envoi, t: Transport): Promise<Issue> {
  const delai = t.delai ?? DELAI_MAX;
  let status: number, texte: string, attendre: number | undefined;
  try {
    const auth = await t.entetes(e);
    const r = await fetch(t.url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(delai),
      headers: { 'content-type': 'application/json', accept: 'application/json', ...auth, 'idempotency-key': e.cle },
      body: JSON.stringify(t.corps(e)),
    });
    status = r.status;
    attendre = retryAfter(r.headers.get('retry-after'));
    texte = await r.text();
  } catch (err) {
    if (err instanceof ErreurEnvoi) return { ok: false, definitif: err.definitif, erreur: court(err.message) };
    const nom = (err as Error)?.name;
    if (nom === 'TimeoutError' || nom === 'AbortError') return { ok: false, definitif: false, erreur: `Délai dépassé : aucune réponse en ${delai / 1000} s` };
    return { ok: false, definitif: false, erreur: `Erreur réseau : ${causeReseau(err)}` };
  }
  if (status >= 200 && status < 300) {
    let accuse = `HTTP ${status}`;
    try {
      const a = (JSON.parse(texte) as { accuse?: unknown }).accuse;
      if (typeof a === 'string' && a.trim()) accuse = court(a.trim(), 200);
    } catch { /* accusé absent : le statut HTTP en tient lieu */ }
    return { ok: true, accuse };
  }
  const erreur = status >= 300 && status < 400 ? `HTTP ${status} · redirection non suivie : vérifiez l’adresse configurée` : erreurHttp(status, texte);
  const temporaire = status === 408 || status === 429 || status >= 500 || !!t.surRefus?.(status);
  return { ok: false, definitif: !temporaire, erreur, apres: attendre };
}

/** Envoie un message et enregistre l'issue : reçu, nouvelle tentative programmée ou échec. Null s'il a disparu entre-temps. */
export async function envoyer(db: Db, e: Envoi, t: Transport, horloge = () => new Date()): Promise<Envoi | null> {
  const issue = await tenter(e, t);
  // Issue enregistrée d'un seul tenant (relecture puis écritures), une fois la réponse reçue.
  return db.exclusif(async () => {
    if ((await db.get<Envoi>('envois', e.id))?.cle !== e.cle) return null; // base réinitialisée pendant l'envoi (démonstration)
    const now = horloge(), at = now.toISOString(), tentatives = e.tentatives + 1;
    if (issue.ok) return await db.update<Envoi>('envois', e.id, { statut: 'envoye', tentatives, tentative: at, envoi: at, prochaine: null, accuse: issue.accuse });
    if (issue.definitif || tentatives >= TENTATIVES_MAX) {
      const x = await db.update<Envoi>('envois', e.id, { statut: 'echec', tentatives, tentative: at, prochaine: null, erreur: issue.erreur });
      await db.insert('journal', {
        at, actor: 'Cursus', role: 'integration', action: `${e.cible}.echec`,
        message: `Envoi ${e.type} en échec après ${tentatives} tentative${tentatives > 1 ? 's' : ''} — ${issue.erreur}`,
        payload: { envoi: e.id, type: e.type, cle: e.cle },
      });
      return x;
    }
    // Le destinataire peut demander une attente plus longue (Retry-After), dans la limite d'une heure.
    const delai = Math.min(HEURE, Math.max(attente(tentatives), issue.apres ?? 0));
    return await db.update<Envoi>('envois', e.id, { tentatives, tentative: at, prochaine: new Date(now.getTime() + delai).toISOString(), erreur: issue.erreur });
  });
}

const enCours = new Set<Cible>();
/** Vrai pendant qu'un message est en cours d'envoi : l'arrêt du serveur attend son issue (server/src/service.ts). */
export const envoiEnCours = () => enCours.size > 0;

/**
 * Transmet les messages dus d'une cible, un à la fois et dans l'ordre d'émission ; s'arrête au premier
 * qui doit attendre une nouvelle tentative. Sans effet pendant un traitement de la même cible.
 * Renvoie le nombre de tentatives faites.
 */
export async function traiterFile(db: Db, cible: Cible, t: Transport, horloge = () => new Date()): Promise<number> {
  if (enCours.has(cible)) return 0;
  enCours.add(cible);
  let n = 0;
  try {
    for (let e = await tete(db, cible); e && (!e.prochaine || e.prochaine <= horloge().toISOString()); e = await tete(db, cible)) {
      const apres = await envoyer(db, e, t, horloge);
      n++;
      if (!apres || apres.statut === 'a_envoyer') break;
    }
  } finally {
    enCours.delete(cible);
  }
  return n;
}

/**
 * Processus de fond du serveur : chaque cible configurée (transport non nul) est relevée au démarrage
 * puis toutes les `intervalle` ms, sans bloquer les requêtes. Renvoie la fonction d'arrêt.
 */
export async function demarrerEnvois(db: Db, transports: Partial<Record<Cible, Transport | null>>, intervalle = 2000): Promise<() => void> {
  // Tête de file relue toutes les 2 s : index `envois_file`, créé par une migration nommée (server/src/migrations/exploitation.ts).
  const actives = (Object.entries(transports) as [Cible, Transport | null][]).filter((x): x is [Cible, Transport] => !!x[1]);
  const relever = () => { for (const [cible, t] of actives) void traiterFile(db, cible, t).catch(err => console.error(`Envois ${cible} :`, err)); };
  if (!actives.length) return () => {};
  await relever();
  const timer = setInterval(relever, intervalle);
  timer.unref();
  return () => clearInterval(timer);
}

/** Relance un envoi en échec : nouvelle série de tentatives, avec la même clé d'idempotence. */
export async function relancerEnvoi(db: Db, e: Envoi): Promise<Envoi> {
  return await db.update<Envoi>('envois', e.id, { statut: 'a_envoyer', tentatives: 0, prochaine: new Date().toISOString(), classe: null });
}

/** Classe un envoi en échec, examiné par le RH (refus définitif du destinataire…) : il ne compte plus parmi les échecs en cours. */
export async function classerEnvoi(db: Db, e: Envoi): Promise<Envoi> {
  return await db.update<Envoi>('envois', e.id, { classe: new Date().toISOString() });
}

/**
 * État d'une cible : messages par statut, échecs en cours (non classés), dernière réception confirmée,
 * message en tête qui attend une nouvelle tentative.
 */
export async function etatEnvois(db: Db, cible: Cible): Promise<EtatEnvois> {
  const n = Object.fromEntries(STATUTS_ENVOI.map(s => [s, 0])) as Record<StatutEnvoi, number>;
  for (const r of await db.query('SELECT statut, COUNT(*) AS n FROM envois WHERE cible = ? GROUP BY statut', [cible]) as { statut: StatutEnvoi; n: number }[]) n[r.statut] = Number(r.n);
  const ouverts = await db.one(`SELECT COUNT(*) AS n FROM envois WHERE cible = ? AND statut = 'echec' AND classe IS NULL`, [cible]) as { n: number };
  const dernier = await db.one(`SELECT MAX(envoi) AS envoi FROM envois WHERE cible = ? AND statut = 'envoye'`, [cible]) as { envoi: string | null };
  const t = await tete(db, cible);
  return {
    cible, nombres: n, echecsEnCours: Number(ouverts.n), dernierSucces: dernier.envoi ?? null,
    enReprise: t && t.tentatives > 0 ? { id: t.id, type: t.type, tentatives: t.tentatives, prochaine: t.prochaine, erreur: t.erreur } : null,
  };
}

/**
 * Conservation (appelée avec celle du journal, server/src/journal.ts) : les envois réussis ou simulés émis avant
 * `avant` (ISO) sont supprimés, comme les échecs classés par le RH avant cette date. Un échec non classé (pas encore
 * traité) et un message à envoyer restent en file. Renvoie le nombre d'envois supprimés.
 */
export async function purgerEnvois(db: Db, avant: string): Promise<number> {
  return Number((await db.run(`DELETE FROM envois WHERE (statut IN ('envoye', 'simule') AND COALESCE(envoi, creation) < ?) OR (statut = 'echec' AND classe IS NOT NULL AND classe < ?)`, [avant, avant])).changes);
}

/** Derniers messages (les plus récents d'abord), filtrés par statut et par cible. */
export async function listerEnvois(db: Db, filtre: { statut?: unknown; cible?: Cible } = {}, limite = 100): Promise<Envoi[]> {
  const statut = STATUTS_ENVOI.includes(filtre.statut as StatutEnvoi) ? filtre.statut as StatutEnvoi : null;
  const ids = await db.query(`SELECT id FROM envois WHERE (? IS NULL OR statut = ?) AND (? IS NULL OR cible = ?) ORDER BY id DESC LIMIT ?`, [statut, statut, filtre.cible ?? null, filtre.cible ?? null, limite]) as { id: number }[];
  return Promise.all(ids.map(async r => (await db.get<Envoi>('envois', r.id))!));
}
