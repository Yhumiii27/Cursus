// Connexion Microsoft 365 (Entra ID) : flux OpenID Connect « code d'autorisation » avec PKCE (S256),
// state et nonce, sans dépendance. Cursus redirige vers Microsoft (GET /api/auth/microsoft), Microsoft
// renvoie un code à l'URI de redirection (GET /api/auth/microsoft/retour), Cursus l'échange contre un
// jeton d'identité (id_token) avec son secret client, vérifie ce jeton (signature RS256 par les clés
// publiées par Microsoft, émetteur, audience, dates, nonce, locataire) puis ouvre une session.
// L'état de l'aller-retour (state, nonce, code_verifier, page de retour) voyage dans un cookie signé
// de 10 minutes, à usage unique. Configuration : config.ts (configOidc) ; guide : docs/CONNEXION-MICROSOFT.md.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import { type ErreurMicrosoft } from '../../shared/constants.ts';
import { normaliserIdentifiant } from '../../shared/rules/comptes.ts';
import { cookieSecure, LimiteParIp, openSession, parseCookies, readSession, revokeSession, revokeSessionsDuCompte, sign } from './auth.ts';
import { compteParIdentifiant, enregistrerConnexion, espacesDuCompte, journaliser, nomDuCompte, refusDuCompte, type Compte } from './comptes.ts';
import { configOidc, type ConfigOidc } from './config.ts';
import type { Db } from './db.ts';

/** Document de découverte OpenID (champs utilisés). */
interface Decouverte { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; end_session_endpoint?: string }

/** Revendications du jeton d'identité lues par Cursus. */
export interface Revendications {
  iss: string; aud: string | string[]; exp: number; nbf?: number; iat?: number; nonce?: string;
  /** Locataire (annuaire) et identifiant immuable de la personne dans cet annuaire. */
  tid: string; oid: string;
  /** Adresse de connexion (UPN), le plus souvent l'adresse e-mail. */
  preferred_username?: string; name?: string;
}

/** Échec de la connexion : `code` choisit le message de l'écran, `detail` va au journal et à la console. */
export class ErreurOidc extends Error {
  readonly code: ErreurMicrosoft;
  constructor(code: ErreurMicrosoft, detail: string) { super(detail); this.code = code; }
}

/** Tolérance sur les dates du jeton (horloges décalées). */
const TOLERANCE_S = 5 * 60;
/** Document de découverte gardé un jour ; les clés, jusqu'à ce qu'un jeton en cite une inconnue (rotation). */
const DECOUVERTE_MS = 24 * 3600_000;
const DELAI_RESEAU_MS = 10_000;

const egal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const json64 = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Fournisseur OpenID Connect : découverte et clés en cache, échange du code, vérification du jeton d'identité. */
export class FournisseurOidc {
  readonly cfg: ConfigOidc;
  /** Émetteur attendu des jetons : ${autorite}/${tenant}/v2.0 (locataire désigné par son GUID). */
  readonly emetteur: string;
  private maintenant: () => number;
  private decouverte: { doc: Decouverte; lu: number } | null = null;
  private cles = new Map<string, KeyObject>();
  private clesLues = 0;
  private lectureCles: Promise<void> | null = null;

  constructor(cfg: ConfigOidc, maintenant = () => Date.now()) {
    this.cfg = cfg;
    this.emetteur = `${cfg.autorite}/${cfg.tenant}/v2.0`;
    this.maintenant = maintenant;
  }

  private async lire(url: string, init?: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> {
    let r: globalThis.Response;
    try {
      r = await fetch(url, { ...init, signal: AbortSignal.timeout(DELAI_RESEAU_MS) });
    } catch (err) {
      throw new ErreurOidc('indisponible', `Microsoft injoignable (${new URL(url).host}) : ${err instanceof Error ? err.message : err}`);
    }
    return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
  }

  /** Document de découverte du locataire, mis en cache ; son émetteur doit être celui du locataire configuré. */
  async document(): Promise<Decouverte> {
    if (this.decouverte && this.maintenant() - this.decouverte.lu < DECOUVERTE_MS) return this.decouverte.doc;
    const { status, json } = await this.lire(`${this.emetteur}/.well-known/openid-configuration`);
    const doc = json as unknown as Decouverte;
    if (status !== 200 || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new ErreurOidc('indisponible', `Document de découverte illisible (HTTP ${status}) : vérifiez CURSUS_OIDC_TENANT`);
    }
    if (doc.issuer !== this.emetteur) throw new ErreurOidc('indisponible', `Émetteur inattendu dans le document de découverte : ${doc.issuer}`);
    this.decouverte = { doc, lu: this.maintenant() };
    return doc;
  }

  /** Recharge les clés publiques (JWKS) ; une seule lecture à la fois. */
  private rechargerCles(): Promise<void> {
    this.lectureCles ??= (async () => {
      try {
        const { status, json } = await this.lire((await this.document()).jwks_uri);
        const keys = Array.isArray(json.keys) ? json.keys as Record<string, string>[] : [];
        if (status !== 200 || !keys.length) throw new ErreurOidc('indisponible', `Clés de signature illisibles (HTTP ${status})`);
        const cles = new Map<string, KeyObject>();
        for (const k of keys) {
          if (k.kty !== 'RSA' || !k.kid || !k.n || !k.e || (k.use && k.use !== 'sig')) continue;
          try { cles.set(k.kid, createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' })); } catch { /* clé malformée : ignorée */ }
        }
        this.cles = cles;
        this.clesLues = this.maintenant();
      } finally {
        this.lectureCles = null;
      }
    })();
    return this.lectureCles;
  }

  /** Clé publique `kid` ; un identifiant inconnu (rotation des clés chez Microsoft) ou un cache d'un jour provoque une relecture. */
  async cle(kid: string): Promise<KeyObject | undefined> {
    if (!this.cles.has(kid) || this.maintenant() - this.clesLues > DECOUVERTE_MS) await this.rechargerCles();
    return this.cles.get(kid);
  }

  /** Adresse de connexion chez Microsoft. `indice` : identifiant proposé ; `choix` : choisir un autre compte. */
  async urlAutorisation(e: EtatAllerRetour, indice?: string, choix?: boolean): Promise<string> {
    const u = new URL((await this.document()).authorization_endpoint);
    const p = u.searchParams;
    p.set('client_id', this.cfg.clientId);
    p.set('response_type', 'code');
    p.set('redirect_uri', this.cfg.redirection);
    p.set('response_mode', 'query');
    p.set('scope', 'openid profile email');
    p.set('state', e.state);
    p.set('nonce', e.nonce);
    p.set('code_challenge', createHash('sha256').update(e.verifier).digest('base64url'));
    p.set('code_challenge_method', 'S256');
    if (indice) p.set('login_hint', indice);
    if (choix) p.set('prompt', 'select_account');
    return u.toString();
  }

  /** Échange le code contre le jeton d'identité (secret client, code_verifier du PKCE). */
  async echangerCode(code: string, verifier: string): Promise<string> {
    const { status, json } = await this.lire((await this.document()).token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: 'authorization_code',
        code, redirect_uri: this.cfg.redirection, code_verifier: verifier, scope: 'openid profile email',
      }),
    });
    if (status !== 200 || typeof json.id_token !== 'string') {
      // Description de Microsoft (AADSTS…) : première ligne seulement, pour le journal et le service informatique.
      const desc = typeof json.error_description === 'string' ? ` — ${json.error_description.split(/\r?\n/)[0].slice(0, 200)}` : '';
      throw new ErreurOidc('jeton', `Échange du code refusé par Microsoft (HTTP ${status}${json.error ? `, ${json.error}` : ''})${desc}`);
    }
    return json.id_token;
  }

  /** Vérifie le jeton d'identité : signature RS256, émetteur, audience, dates (± 5 min), nonce, locataire, oid. */
  async verifierJeton(jeton: string, nonce: string): Promise<Revendications> {
    const parts = jeton.split('.');
    if (parts.length !== 3) throw new ErreurOidc('jeton', 'Jeton d’identité malformé');
    const [h, p, s] = parts;
    let entete: { alg?: string; kid?: string }, c: Revendications;
    try { entete = json64(h); c = json64(p); } catch { throw new ErreurOidc('jeton', 'Jeton d’identité illisible'); }
    if (entete.alg !== 'RS256' || !entete.kid) throw new ErreurOidc('jeton', `Algorithme de signature refusé : ${entete.alg ?? 'aucun'}`);
    const cle = await this.cle(entete.kid);
    if (!cle) throw new ErreurOidc('jeton', `Clé de signature inconnue : ${entete.kid}`);
    if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), cle, Buffer.from(s, 'base64url'))) throw new ErreurOidc('jeton', 'Signature du jeton d’identité invalide');
    const now = Math.floor(this.maintenant() / 1000);
    if (c.iss !== this.emetteur) throw new ErreurOidc('jeton', `Émetteur du jeton inattendu : ${c.iss}`);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(this.cfg.clientId) || (aud.length > 1 && (c as { azp?: string }).azp !== this.cfg.clientId)) throw new ErreurOidc('jeton', 'Jeton destiné à une autre application (audience)');
    if (typeof c.exp !== 'number' || c.exp + TOLERANCE_S < now) throw new ErreurOidc('jeton', 'Jeton d’identité expiré');
    if ((typeof c.nbf === 'number' && c.nbf - TOLERANCE_S > now) || (typeof c.iat === 'number' && c.iat - TOLERANCE_S > now)) throw new ErreurOidc('jeton', 'Jeton d’identité pas encore valable');
    if (typeof c.nonce !== 'string' || !egal(c.nonce, nonce)) throw new ErreurOidc('jeton', 'Nonce du jeton incorrect (réponse rejouée ?)');
    if (c.tid !== this.cfg.tenant) throw new ErreurOidc('jeton', `Jeton d’un autre annuaire Microsoft : ${c.tid}`);
    if (typeof c.oid !== 'string' || !c.oid) throw new ErreurOidc('jeton', 'Jeton sans identifiant de personne (oid)');
    return c;
  }

  /** Déconnexion chez Microsoft, avec retour sur Cursus (l'URI de redirection, qui renvoie à l'écran de connexion). */
  async urlDeconnexion(): Promise<string> {
    let fin = `${this.emetteur.replace(/\/v2\.0$/, '')}/oauth2/v2.0/logout`;
    try { fin = (await this.document()).end_session_endpoint ?? fin; } catch { /* adresse habituelle de Microsoft */ }
    const u = new URL(fin);
    u.searchParams.set('post_logout_redirect_uri', this.cfg.redirection);
    u.searchParams.set('client_id', this.cfg.clientId);
    return u.toString();
  }
}

const config = configOidc();
/** Fournisseur Microsoft 365 configuré (les quatre variables CURSUS_OIDC_* et CURSUS_PUBLIC_URL), sinon null. */
export const OIDC = config ? new FournisseurOidc(config) : null;

// — État de l'aller-retour —

/** Ce que Cursus doit retrouver au retour de Microsoft. */
export interface EtatAllerRetour { state: string; nonce: string; verifier: string; retour: string; fin: number }

const COOKIE_ETAT = 'cursus_oidc';
const ETAT_MS = 10 * 60_000;
const CHEMIN_ETAT = '/api/auth/microsoft';

/** Page de retour : un chemin de Cursus (jamais une autre origine, jamais l'API), sinon l'accueil. */
export function pageDeRetour(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return s.length <= 200 && /^\/(?!\/)[^\\\s]*$/.test(s) && !s.startsWith('/api/') ? s : '/';
}

function poserEtat(db: Db, res: Response, e: EtatAllerRetour) {
  const v = Buffer.from(JSON.stringify(e)).toString('base64url');
  res.append('Set-Cookie', `${COOKIE_ETAT}=${v}.${sign(db, v)}; Path=${CHEMIN_ETAT}; HttpOnly; SameSite=Lax; Max-Age=${ETAT_MS / 1000}${cookieSecure()}`);
}

function effacerEtat(res: Response) {
  res.append('Set-Cookie', `${COOKIE_ETAT}=; Path=${CHEMIN_ETAT}; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure()}`);
}

/** État lu dans le cookie : signature valable et moins de 10 minutes, sinon null. */
function lireEtat(db: Db, req: Request): EtatAllerRetour | null {
  const [v, mac] = (parseCookies(req)[COOKIE_ETAT] ?? '').split('.');
  if (!v || !mac || !egal(sign(db, v), mac)) return null;
  try {
    const e = json64(v) as EtatAllerRetour;
    return typeof e.state === 'string' && typeof e.nonce === 'string' && typeof e.verifier === 'string' && e.fin > Date.now() ? e : null;
  } catch {
    return null;
  }
}

/**
 * Codes d'erreur qu'une réponse d'autorisation OAuth 2.0 / OpenID Connect peut porter : seuls ceux-là
 * sont recopiés au journal (le paramètre `error` vient de l'adresse, donc de n'importe qui).
 */
const ERREURS_OAUTH = new Set([
  'access_denied', 'consent_required', 'interaction_required', 'login_required', 'account_selection_required', 'invalid_request',
  'unauthorized_client', 'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable', 'invalid_resource',
  'invalid_request_uri', 'invalid_request_object', 'request_not_supported', 'request_uri_not_supported', 'registration_not_supported',
]);

/** Motif d'un refus de Microsoft pour le journal : code connu et, s'il y en a un, numéro AADSTS ; jamais le texte reçu. */
export function motifRefus(error: unknown, description: unknown): string {
  if (error === undefined) return 'code absent';
  const code = typeof error === 'string' && ERREURS_OAUTH.has(error) ? error : 'motif inconnu';
  const aadsts = typeof description === 'string' ? description.match(/\bAADSTS\d{4,7}\b/)?.[0] : undefined;
  return aadsts ? `${code}, ${aadsts}` : code;
}

/**
 * Routes de la connexion Microsoft 365. Sans configuration, elles renvoient à l'écran de connexion
 * (« connexion indisponible ») : l'écran ne propose de toute façon pas le bouton.
 * `refus` : refus journalisés par adresse IP. N'importe qui obtient un état valable (GET /api/auth/microsoft)
 * et peut revenir avec une erreur : au-delà du seuil, les refus de cette adresse ne sont plus écrits au
 * journal jusqu'à la fin de la fenêtre (une ligne le signale), pour que le journal RH ne soit pas noyé.
 */
export function routesMicrosoft(db: Db, oidc: FournisseurOidc | null = OIDC, refus = new LimiteParIp()): Router {
  const r = express.Router();
  /** États déjà présentés au retour, jusqu'à leur échéance : un cookie d'état ne sert qu'une fois. */
  const consommes = new Map<string, number>();
  const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? '';
  const versConnexion = (res: Response, code: ErreurMicrosoft) => res.redirect(`/?connexion=${code}`);
  if (oidc) console.log(`Connexion Microsoft 365 active : locataire ${oidc.cfg.tenant}, URI de redirection ${oidc.cfg.redirection}`);

  r.get('/api/auth/microsoft', async (req, res) => {
    if (!oidc) return versConnexion(res, 'indisponible');
    const e: EtatAllerRetour = {
      state: randomBytes(24).toString('base64url'), nonce: randomBytes(24).toString('base64url'), verifier: randomBytes(32).toString('base64url'),
      retour: pageDeRetour(req.query.retour), fin: Date.now() + ETAT_MS,
    };
    const indice = normaliserIdentifiant(typeof req.query.identifiant === 'string' ? req.query.identifiant : '').slice(0, 254);
    try {
      const url = await oidc.urlAutorisation(e, indice || undefined, req.query.choix === '1');
      poserEtat(db, res, e);
      res.redirect(url);
    } catch (err) {
      console.error(`Connexion Microsoft 365 : ${err instanceof Error ? err.message : err}`);
      versConnexion(res, 'indisponible');
    }
  });

  r.get('/api/auth/microsoft/retour', async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const e = lireEtat(db, req);
    effacerEtat(res);
    // Retour de la déconnexion Microsoft (ni code, ni erreur, ni state) : écran de connexion.
    if (q.code === undefined && q.error === undefined && q.state === undefined) return res.redirect('/');
    if (!oidc) return versConnexion(res, 'indisponible');
    const maintenant = Date.now();
    for (const [s, fin] of consommes) if (fin <= maintenant) consommes.delete(s);
    if (!e || typeof q.state !== 'string' || !egal(q.state, e.state) || consommes.has(e.state)) {
      // Lien périmé, rejoué ou forgé : rien n'est journalisé (n'importe qui peut appeler cette adresse).
      console.warn('Connexion Microsoft 365 : retour refusé (état absent, expiré, différent ou déjà utilisé).');
      return versConnexion(res, 'etat');
    }
    consommes.set(e.state, e.fin);

    const adresse = ip(req);
    const trace = (action: string, message: string, actor: string, compte: Compte | null, extra: Record<string, unknown> = {}, role: string | null = null) =>
      journaliser(db, { actor, role, action, message, payload: { ip: adresse, methode: 'microsoft', ...extra }, compte });
    /** Refus journalisé, dans la limite de `refus` pour cette adresse. */
    const refuser = (message: string, actor: string, compte: Compte | null, extra: Record<string, unknown> = {}) => {
      if (refus.depasse(adresse)) return;
      refus.echec(adresse);
      trace('connexion.refusee', message, actor, compte, extra);
      if (refus.depasse(adresse)) {
        trace('connexion.refusee', `Microsoft 365 : ${refus.max} refus en moins de ${refus.fenetreMs / 60_000} minutes depuis cette adresse — les suivants ne sont plus journalisés jusqu’à la fin de cette période`, 'Microsoft 365', null);
      }
    };
    if (q.error !== undefined || typeof q.code !== 'string') {
      refuser(`Microsoft 365 : connexion refusée par Microsoft (${motifRefus(q.error, q.error_description)})`, 'Microsoft 365', null);
      return versConnexion(res, 'refus');
    }

    let c: Revendications;
    try {
      c = await oidc.verifierJeton(await oidc.echangerCode(q.code, e.verifier), e.nonce);
    } catch (err) {
      const code = err instanceof ErreurOidc ? err.code : 'jeton';
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`Connexion Microsoft 365 refusée : ${detail}`);
      refuser(`Microsoft 365 : ${detail}`, 'Microsoft 365', null);
      return versConnexion(res, code);
    }

    // Rattachement : le compte dont l'oid correspond ; sinon, à la première connexion, le compte Microsoft
    // dont l'identifiant est l'adresse de connexion (UPN) et qui n'est encore rattaché à personne.
    const upn = normaliserIdentifiant(c.preferred_username ?? '');
    const qui = c.name?.trim() || upn || 'Microsoft 365';
    const extra = { identifiant: upn, oid: c.oid };
    let compte = db.where<Compte>('comptes', 'oid', c.oid).find(x => x.type === 'microsoft') ?? null;
    let rattacher = false;
    if (!compte && upn) {
      const x = compteParIdentifiant(db, upn);
      if (x?.type === 'microsoft' && !x.oid) { compte = x; rattacher = true; }
      else if (x?.type === 'microsoft') {
        refuser(`Microsoft 365 : le compte ${upn} est déjà rattaché à une autre identité Microsoft (le délier dans Comptes et accès si elle a été recréée)`, qui, x, extra);
        return versConnexion(res, 'acces');
      }
    }
    if (!compte) {
      refuser(`Microsoft 365 : aucun compte Cursus pour ${upn || `l’identité ${c.oid}`}`, qui, null, extra);
      return versConnexion(res, 'acces');
    }
    const refusCompte = refusDuCompte(db, compte);
    if (refusCompte) {
      revokeSessionsDuCompte(db, compte.id);
      refuser(`Microsoft 365 : ${refusCompte}`, nomDuCompte(db, compte), compte, extra);
      return versConnexion(res, 'ferme');
    }
    if (rattacher) db.update<Compte>('comptes', compte.id, { oid: c.oid });
    // Chaque connexion ouvre une nouvelle session (12 h) et révoque celle que portait le navigateur.
    const cur = readSession(db, req);
    if (cur?.id) revokeSession(db, cur.id);
    enregistrerConnexion(db, compte);
    // Espace initial : RH si profil RH, sinon manager s'il encadre une équipe, sinon collaborateur.
    const role = espacesDuCompte(db, compte)[0];
    trace('connexion', rattacher ? 'Connexion Microsoft 365 — première connexion, compte rattaché à son identité Microsoft' : 'Connexion Microsoft 365',
      nomDuCompte(db, compte), compte, extra, role);
    openSession(db, res, { compteId: compte.id, role, methode: 'microsoft', demoComptes: {} });
    // openSession remplace l'en-tête Set-Cookie : l'effacement de l'état est reposé à la suite.
    effacerEtat(res);
    res.redirect(e.retour);
  });

  return r;
}
