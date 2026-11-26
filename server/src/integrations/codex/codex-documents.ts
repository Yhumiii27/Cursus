// lot 16 — client des enregistrements du dossier du personnel chez Codex (CU-037 ; demande
// docs/demandes/codex-lot16-documents.md, livrée par Codex le 26/11/2026, Codex#38 ; contrat : docs/api.md de Codex,
// « Enregistrements du dossier du personnel (Cursus) ») : dépôt (`POST /api/documents`), lecture du fichier
// (`GET /api/documents/{id}/file`, empreinte `X-Codex-SHA256` contrôlée) et destruction (`POST /api/documents/{id}/destroy`,
// motif `retrait` | `conservation` | `effacement`).
// Authentification propre à Cursus : jeton `Authorization: Bearer <CODEX_CURSUS_TOKEN>` (obligatoire : il désigne Cursus)
// et, avec CODEX_CURSUS_SECRET, signature HMAC-SHA256 (`X-Codex-Timestamp`, `X-Codex-Signature: v1=…`) du corps brut pour
// le dépôt, de `<MÉTHODE> <chemin>\n` suivi du corps pour la lecture et la destruction ; chaque essai est signé à nouveau
// (anti-rejeu de Codex).
// Configuration dans l'environnement seulement, jamais dans la base : CODEX_URL (adresse de base de Codex, sans chemin),
// CODEX_CURSUS_TOKEN, CODEX_CURSUS_SECRET (facultatif) ; ou CODEX_SIMULATION=1 hors production (Codex simulé,
// server/src/integrations/codex/codex-simule.ts). Sans elle, le stockage « Codex » reste fermé.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { CategorieDossier, MotifDestruction } from '../../../../shared/rules/pieces-codex.ts';
import { clientSimule } from './codex-simule.ts';

type Env = Record<string, string | undefined>;

export interface ConfigCodex {
  url: string;
  jeton: string;
  secret: string | null;
}

/** Variables d'avant le contrat de Codex (demande du lot 16) : remplacées par CODEX_CURSUS_TOKEN et CODEX_CURSUS_SECRET. */
const ANCIENNES = ['CODEX_DOCUMENTS_TOKEN', 'CODEX_DOCUMENTS_SECRET', 'CODEX_DOCUMENTS_OWNER'];

/** Codex simulé demandé (CODEX_SIMULATION=1) : démonstration, développement et essais, jamais en production. */
export const simulationCodex = (env: Env = process.env) => env.CODEX_SIMULATION?.trim() === '1';

/** Configuration lue dans l'environnement, ou null si le raccordement réel n'est pas configuré (ou mal). */
export function configCodex(env: Env = process.env): ConfigCodex | null {
  return problemesCodex(env).length || !env.CODEX_URL?.trim() ? null : {
    url: env.CODEX_URL!.trim().replace(/\/+$/, ''),
    jeton: env.CODEX_CURSUS_TOKEN!.trim(),
    secret: env.CODEX_CURSUS_SECRET?.trim() || null,
  };
}

/** Problèmes de configuration du raccordement à Codex (config.ts, `problemesConfig`) ; rien si rien n'est posé. */
export function problemesCodex(env: Env = process.env): string[] {
  const out: string[] = [];
  const anciennes = ANCIENNES.filter(k => env[k]?.trim());
  if (anciennes.length) out.push(`${anciennes.join(', ')} : variables remplacées par CODEX_CURSUS_TOKEN et CODEX_CURSUS_SECRET (contrat de Codex du 26/11/2026, le propriétaire des pièces est fixé par Codex). Renommez-les ou retirez-les.`);
  const sim = env.CODEX_SIMULATION?.trim();
  if (sim && sim !== '0' && sim !== '1') out.push(`CODEX_SIMULATION vaut « ${sim} » : indiquez 1 (Codex simulé, hors production) ou 0.`);
  if (sim === '1' && env.NODE_ENV === 'production') out.push('CODEX_SIMULATION=1 est réservée à la démonstration et au développement : retirez-la en production, raccordez Codex par CODEX_URL et CODEX_CURSUS_TOKEN.');
  if (sim === '1' && env.CODEX_URL?.trim()) out.push('CODEX_SIMULATION=1 et CODEX_URL sont définies ensemble : choisissez le Codex simulé ou le vrai.');
  const url = env.CODEX_URL?.trim();
  const autres = ['CODEX_CURSUS_TOKEN', 'CODEX_CURSUS_SECRET'].filter(k => env[k]?.trim());
  if (!url) {
    if (autres.length) out.push(`${autres.join(', ')} ${autres.length > 1 ? 'sont définies' : 'est définie'} sans CODEX_URL : le raccordement à Codex reste fermé. Indiquez l’adresse de Codex, ou retirez-les.`);
    return out;
  }
  if (!/^https?:\/\/[^\s/]+/i.test(url) || !URL.canParse(url)) out.push('CODEX_URL n’est pas une adresse http(s) valide : indiquez l’adresse de base de Codex, par exemple http://codex.interne:3100.');
  else {
    const u = new URL(url);
    if (u.username || u.password) out.push('CODEX_URL contient un identifiant ou un mot de passe (utilisateur:motdepasse@) : indiquez l’adresse seule, l’authentification passe par CODEX_CURSUS_TOKEN et CODEX_CURSUS_SECRET.');
    // La signature de la lecture et de la destruction porte le chemin vu par Codex : /api/documents/…, à la racine.
    if (u.pathname.replace(/\/+$/, '') || u.search || u.hash) out.push('CODEX_URL contient un chemin ou des paramètres : indiquez l’adresse de base de Codex seule (Codex servi à la racine, par exemple http://codex.interne:3100).');
  }
  if (!env.CODEX_CURSUS_TOKEN?.trim()) out.push('CODEX_URL est définie sans CODEX_CURSUS_TOKEN : posez le jeton de Cursus convenu avec Codex (la même valeur chez Codex).');
  for (const k of ['CODEX_CURSUS_TOKEN', 'CODEX_CURSUS_SECRET']) {
    const v = env[k]?.trim();
    // Même règle que Codex (docs/api.md de Codex : 32 caractères dont 10 différents au moins).
    if (v && (v.length < 32 || new Set(v).size < 10)) out.push(`${k} est trop faible : 32 caractères au moins, dont 10 différents (openssl rand -base64 32).`);
  }
  return out;
}

/** Codex injoignable ou en erreur passagère (5xx, 429, réseau) : nouvel essai au passage suivant. */
export class CodexIndisponible extends Error {}
/** Refus définitif de Codex (4xx) : la pièce reste en local, le service informatique est prévenu par les journaux. */
export class CodexRefus extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) { super(message); this.status = status; this.code = code; }
}

export interface MetaDepot {
  sourceRef: string;
  title: string;
  category: CategorieDossier;
  subjectMatricule: string;
  expiresAt: string | null;
  sha256: string;
}

export interface ReponseDepot { id: string; replayed: boolean }

const DELAI_MS = 30_000;
const court = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Client des enregistrements de Codex ; `f` : fetch remplaçable (tests, Codex simulé). */
export class ClientCodex {
  readonly config: ConfigCodex;
  private readonly f: typeof fetch;
  constructor(config: ConfigCodex, f: typeof fetch = fetch) { this.config = config; this.f = f; }

  /**
   * En-têtes d'authentification ; `signe` : octets couverts par la signature (corps brut du dépôt, ou
   * `<MÉTHODE> <chemin>\n` + corps pour la lecture et la destruction). Signé à chaque essai : Codex refuse un rejeu.
   */
  entetes(signe: Buffer): Record<string, string> {
    const h: Record<string, string> = { authorization: `Bearer ${this.config.jeton}` };
    if (this.config.secret) {
      const ts = String(Math.floor(Date.now() / 1000));
      h['x-codex-timestamp'] = ts;
      h['x-codex-signature'] = `v1=${createHmac('sha256', this.config.secret).update(`${ts}.`).update(signe).digest('hex')}`;
    }
    return h;
  }

  private async appel(chemin: string, init: { method: 'GET' | 'POST'; corps?: Buffer; type?: string; route?: boolean }): Promise<Response> {
    const corps = init.corps ?? Buffer.alloc(0);
    const signe = init.route ? Buffer.concat([Buffer.from(`${init.method} ${chemin}\n`), corps]) : corps;
    try {
      return await this.f(`${this.config.url}${chemin}`, {
        method: init.method, redirect: 'manual', signal: AbortSignal.timeout(DELAI_MS),
        headers: { ...this.entetes(signe), ...(init.type ? { 'content-type': init.type } : {}), 'x-request-id': `cursus-${randomBytes(8).toString('hex')}` },
        ...(init.method === 'POST' ? { body: new Uint8Array(corps) } : {}),
      });
    } catch (err) {
      throw new CodexIndisponible(`Codex injoignable (${injoignable(err)})`);
    }
  }

  private static async echecCodex(r: Response, quoi: string): Promise<never> {
    let code: string | null = null;
    try { code = ((await r.json()) as { error?: unknown })?.error as string ?? null; } catch { /* corps non JSON */ }
    const message = `${quoi} : Codex a répondu ${r.status}${code ? ` (${court(String(code), 60)})` : ''}`;
    if (r.status >= 500 || r.status === 429 || r.status === 408) throw new CodexIndisponible(message);
    throw new CodexRefus(r.status, code, message);
  }

  /**
   * Dépôt d'un enregistrement (multipart `meta` + `file`) ; rejouable par sa `sourceRef` (200 `replayed`). Une
   * `sourceRef` dont l'enregistrement a été détruit ne se redépose pas : 410, refus `destroyed`.
   */
  async deposer(octets: Buffer, type: string, nom: string, meta: MetaDepot): Promise<ReponseDepot> {
    const frontiere = `cursus-${randomBytes(12).toString('hex')}`;
    const { expiresAt, ...reste } = meta;
    const champMeta = JSON.stringify({ ...reste, typeCode: 'DPE', ...(expiresAt ? { expiresAt } : {}) });
    const nomSur = nom.replace(/["\r\n\\]/g, '_');
    const corps = Buffer.concat([
      Buffer.from(`--${frontiere}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json\r\n\r\n${champMeta}\r\n`),
      Buffer.from(`--${frontiere}\r\nContent-Disposition: form-data; name="file"; filename="${nomSur}"\r\nContent-Type: ${type}\r\n\r\n`),
      octets,
      Buffer.from(`\r\n--${frontiere}--\r\n`),
    ]);
    const r = await this.appel('/api/documents', { method: 'POST', corps, type: `multipart/form-data; boundary=${frontiere}` });
    if (r.status !== 200 && r.status !== 201) await ClientCodex.echecCodex(r, 'Dépôt dans Codex');
    const j = (await r.json().catch(() => null)) as { id?: unknown; replayed?: unknown; dryRun?: unknown } | null;
    if (!j || typeof j.id !== 'string' || !j.id || j.dryRun) throw new CodexIndisponible('Dépôt dans Codex : réponse sans identifiant de document');
    return { id: j.id, replayed: j.replayed === true };
  }

  /**
   * Fichier tel que déposé, contrôlé contre l'empreinte que Codex a enregistrée (`X-Codex-SHA256`) ; null si Codex ne
   * l'a pas (404 : détruit, ou jamais déposé par Cursus). Un envoi coupé (fichier altéré chez Codex) : indisponible.
   */
  async lire(id: string): Promise<Buffer | null> {
    const r = await this.appel(`/api/documents/${encodeURIComponent(id)}/file`, { method: 'GET', route: true });
    if (r.status === 404 || r.status === 410) return null;
    if (r.status !== 200) await ClientCodex.echecCodex(r, 'Lecture dans Codex');
    let octets: Buffer;
    try { octets = Buffer.from(await r.arrayBuffer()); } catch (err) { throw new CodexIndisponible(`Lecture dans Codex interrompue (${injoignable(err)})`); }
    const attendue = r.headers.get('x-codex-sha256')?.trim().toLowerCase();
    if (attendue !== createHash('sha256').update(octets).digest('hex')) {
      throw new CodexRefus(r.status, 'sha256_mismatch', `Lecture dans Codex : ${attendue ? 'empreinte du fichier reçu différente de X-Codex-SHA256' : 'réponse sans empreinte X-Codex-SHA256'}`);
    }
    return octets;
  }

  /**
   * Destruction (document, versions et fichiers ; trace sans contenu chez Codex) avec un motif codé. Rejouable : un
   * enregistrement déjà détruit (200 `alreadyDestroyed`) ou que Codex n'a pas (404) n'est pas une erreur. Gel juridique
   * ou document visé par un circuit : refus 409 (`legal_hold`, `in_use`), rien n'est fait chez Codex.
   */
  async detruire(id: string, motif: MotifDestruction): Promise<{ dejaDetruit: boolean }> {
    const corps = Buffer.from(JSON.stringify({ reason: motif }));
    const r = await this.appel(`/api/documents/${encodeURIComponent(id)}/destroy`, { method: 'POST', corps, type: 'application/json', route: true });
    if (r.status === 404) return { dejaDetruit: true };
    if (r.status !== 200) await ClientCodex.echecCodex(r, 'Destruction dans Codex');
    const j = (await r.json().catch(() => null)) as { alreadyDestroyed?: unknown } | null;
    return { dejaDetruit: j?.alreadyDestroyed === true };
  }
}

const injoignable = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.name ?? 'erreur réseau';

/** Client de l'environnement (Codex réel, ou simulé avec CODEX_SIMULATION=1), ou null si le raccordement n'est pas configuré. */
export function clientCodex(env: Env = process.env, f: typeof fetch = fetch): ClientCodex | null {
  if (problemesCodex(env).length) return null;
  if (simulationCodex(env)) return clientSimule(env);
  const c = configCodex(env);
  return c ? new ClientCodex(c, f) : null;
}
