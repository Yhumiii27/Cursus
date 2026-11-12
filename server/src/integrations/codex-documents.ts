// lot 16 — client des documents de Codex (demande docs/demandes/codex-lot16-documents.md, Codex#29) : dépôt d'une pièce
// (`POST /api/documents`, déjà livré par Codex, demande CX-03 d'Arche), relecture (`GET /api/documents/{id}/file`) et
// destruction (`POST /api/documents/{id}/destroy`), demandées à Codex le 10/11/2026. Authentification de Codex
// (docs/api.md de Codex, « Authentification ») : jeton `Authorization: Bearer` et/ou signature HMAC-SHA256 du corps brut
// (`X-Codex-Timestamp`, `X-Codex-Signature: v1=…`), chaque essai signé à nouveau (anti-rejeu de Codex). Un `GET` est
// signé sur un corps vide, en attendant que Codex fixe la forme de la lecture.
// Configuration dans l'environnement seulement, jamais dans la base : CODEX_URL, CODEX_DOCUMENTS_TOKEN et/ou
// CODEX_DOCUMENTS_SECRET, CODEX_DOCUMENTS_OWNER (compte de service propriétaire des pièces : identifiant Codex, ou
// matricule EMP-…). Sans elle, le stockage « GED » reste fermé (server/src/pieces-codex.ts).
import { createHmac, randomBytes } from 'node:crypto';
import type { MotifDestruction } from '../../../shared/rules/pieces-codex.ts';

type Env = Record<string, string | undefined>;

export interface ConfigCodex {
  url: string;
  jeton: string | null;
  secret: string | null;
  /** Propriétaire des documents déposés : jamais la personne connectée. */
  proprietaire: { ownerId: string } | { ownerMatricule: string };
}

/** Configuration lue dans l'environnement, ou null si le raccordement n'est pas configuré (ou mal). */
export function configCodex(env: Env = process.env): ConfigCodex | null {
  return problemesCodex(env).length || !env.CODEX_URL?.trim() ? null : {
    url: env.CODEX_URL!.trim().replace(/\/+$/, ''),
    jeton: env.CODEX_DOCUMENTS_TOKEN?.trim() || null,
    secret: env.CODEX_DOCUMENTS_SECRET?.trim() || null,
    proprietaire: proprietaire(env.CODEX_DOCUMENTS_OWNER!.trim()),
  };
}

const proprietaire = (v: string) => (/^EMP-\d+$/.test(v) ? { ownerMatricule: v } : { ownerId: v });

/** Problèmes de configuration du raccordement à Codex (config.ts, `problemesConfig`) ; rien si CODEX_URL est absente. */
export function problemesCodex(env: Env = process.env): string[] {
  const url = env.CODEX_URL?.trim();
  const autres = ['CODEX_DOCUMENTS_TOKEN', 'CODEX_DOCUMENTS_SECRET', 'CODEX_DOCUMENTS_OWNER'].filter(k => env[k]?.trim());
  if (!url) return autres.length ? [`${autres.join(', ')} ${autres.length > 1 ? 'sont définies' : 'est définie'} sans CODEX_URL : le raccordement à Codex reste fermé. Indiquez l’adresse de Codex, ou retirez-les.`] : [];
  const out: string[] = [];
  if (!/^https?:\/\/[^\s/]+/i.test(url) || !URL.canParse(url)) out.push('CODEX_URL n’est pas une adresse http(s) valide : indiquez l’adresse de base de Codex, par exemple http://codex.interne:3100.');
  else if (new URL(url).username || new URL(url).password) out.push('CODEX_URL contient un identifiant ou un mot de passe (utilisateur:motdepasse@) : indiquez l’adresse seule, l’authentification passe par CODEX_DOCUMENTS_TOKEN et CODEX_DOCUMENTS_SECRET.');
  if (!env.CODEX_DOCUMENTS_TOKEN?.trim() && !env.CODEX_DOCUMENTS_SECRET?.trim()) out.push('CODEX_URL est définie sans CODEX_DOCUMENTS_TOKEN ni CODEX_DOCUMENTS_SECRET : définissez le jeton et/ou le secret de signature convenus avec Codex.');
  for (const k of ['CODEX_DOCUMENTS_TOKEN', 'CODEX_DOCUMENTS_SECRET']) {
    const v = env[k]?.trim();
    // Même règle que Codex (docs/api.md de Codex : 32 caractères dont 10 différents au moins).
    if (v && (v.length < 32 || new Set(v).size < 10)) out.push(`${k} est trop faible : 32 caractères au moins, dont 10 différents (openssl rand -base64 32).`);
  }
  if (!env.CODEX_DOCUMENTS_OWNER?.trim()) out.push('CODEX_URL est définie sans CODEX_DOCUMENTS_OWNER : indiquez le compte de service de Cursus chez Codex (identifiant Codex ou matricule EMP-…), propriétaire des pièces déposées.');
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
  typeCode: string;
  subtype: string;
  department: string;
  conf: string;
  subjectMatricule: string | null;
  expiresAt: string | null;
  sha256: string;
}

export interface ReponseDepot { id: string; replayed: boolean }

const DELAI_MS = 30_000;
const court = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Client des documents de Codex ; `f` : fetch remplaçable (tests, Codex simulé). */
export class ClientCodex {
  readonly config: ConfigCodex;
  private readonly f: typeof fetch;
  constructor(config: ConfigCodex, f: typeof fetch = fetch) { this.config = config; this.f = f; }

  /** En-têtes d'authentification d'un corps brut (signé à chaque essai : Codex refuse une signature rejouée). */
  entetes(corps: Buffer): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.config.jeton) h.authorization = `Bearer ${this.config.jeton}`;
    if (this.config.secret) {
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', this.config.secret).update(`${ts}.`).update(corps).digest('hex');
      h['x-codex-timestamp'] = ts;
      h['x-codex-signature'] = `v1=${sig}`;
    }
    return h;
  }

  private async appel(chemin: string, init: { method: 'GET' | 'POST'; corps?: Buffer; type?: string }): Promise<Response> {
    const corps = init.corps ?? Buffer.alloc(0);
    try {
      return await this.f(`${this.config.url}${chemin}`, {
        method: init.method, redirect: 'manual', signal: AbortSignal.timeout(DELAI_MS),
        headers: { ...this.entetes(corps), ...(init.type ? { 'content-type': init.type } : {}), 'x-request-id': `cursus-${randomBytes(8).toString('hex')}` },
        ...(init.method === 'POST' ? { body: new Uint8Array(corps) } : {}),
      });
    } catch (err) {
      const c = (err as { cause?: { code?: string } })?.cause?.code;
      throw new CodexIndisponible(`Codex injoignable (${c ?? (err as Error)?.name ?? 'erreur réseau'})`);
    }
  }

  private static async echecCodex(r: Response, quoi: string): Promise<never> {
    let code: string | null = null;
    try { code = ((await r.json()) as { error?: unknown })?.error as string ?? null; } catch { /* corps non JSON */ }
    const message = `${quoi} : Codex a répondu ${r.status}${code ? ` (${court(String(code), 60)})` : ''}`;
    if (r.status >= 500 || r.status === 429 || r.status === 408) throw new CodexIndisponible(message);
    throw new CodexRefus(r.status, code, message);
  }

  /** Dépôt d'une pièce (multipart `meta` + `file`) ; rejouable par sa `sourceRef` (200 `replayed`). */
  async deposer(octets: Buffer, type: string, nom: string, meta: MetaDepot): Promise<ReponseDepot> {
    const frontiere = `cursus-${randomBytes(12).toString('hex')}`;
    const { subjectMatricule, expiresAt, ...reste } = meta;
    const champMeta = JSON.stringify({ ...reste, ...this.config.proprietaire, ...(subjectMatricule ? { subjectMatricule } : {}), ...(expiresAt ? { expiresAt } : {}) });
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

  /** Fichier tel que déposé ; null si Codex ne l'a plus (404, 410). */
  async lire(id: string): Promise<Buffer | null> {
    const r = await this.appel(`/api/documents/${encodeURIComponent(id)}/file`, { method: 'GET' });
    if (r.status === 404 || r.status === 410) return null;
    if (r.status !== 200) await ClientCodex.echecCodex(r, 'Lecture dans Codex');
    return Buffer.from(await r.arrayBuffer());
  }

  /** Destruction (fichier et versions) avec un motif codé ; un document déjà détruit (404, 410) ne l'est pas deux fois. */
  async detruire(id: string, motif: MotifDestruction, sourceRef?: string): Promise<void> {
    const corps = Buffer.from(JSON.stringify({ reason: motif, ...(sourceRef ? { sourceRef } : {}) }));
    const r = await this.appel(`/api/documents/${encodeURIComponent(id)}/destroy`, { method: 'POST', corps, type: 'application/json' });
    if (r.status === 404 || r.status === 410) return;
    if (r.status !== 200 && r.status !== 204) await ClientCodex.echecCodex(r, 'Destruction dans Codex');
  }
}

/** Client de l'environnement, ou null si le raccordement n'est pas configuré. */
export const clientCodex = (env: Env = process.env, f: typeof fetch = fetch): ClientCodex | null => {
  const c = configCodex(env);
  return c ? new ClientCodex(c, f) : null;
};
