// lot 16 — Codex simulé (CU-037) : démonstration, développement et essais, tant que Codex n'est pas raccordé
// (CODEX_SIMULATION=1, refusée en production, server/src/integrations/codex/codex-documents.ts). Il tient le contrat de
// Codex (docs/api.md de Codex, « Enregistrements du dossier du personnel (Cursus) ») : dépôt rejouable par sa
// `sourceRef`, empreinte vérifiée (422), `sourceRef` réemployée pour un autre fichier (409), redépôt d'un enregistrement
// détruit (410), fichier servi avec `X-Codex-SHA256`, destruction motivée, rejouable, refusée sous gel juridique (409).
// Les fichiers restent sur ce poste, dans CODEX_SIMULATION_DIR (sinon `codex-simule/` à côté de la base) : rien ne sort.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CATEGORIES_CODEX, estMatriculeCodex } from '../../../../shared/rules/pieces-codex.ts';
import { fichierBase } from '../../chemins.ts';
import { ClientCodex } from './codex-documents.ts';

type Env = Record<string, string | undefined>;

/** Adresse fictive du Codex simulé : jamais appelée sur le réseau. */
export const URL_SIMULEE = 'http://codex.simule';

/** Dossier du Codex simulé. */
export const dossierSimule = (env: Env = process.env) =>
  env.CODEX_SIMULATION_DIR?.trim() ? resolve(env.CODEX_SIMULATION_DIR.trim()) : join(dirname(fichierBase(env)), 'codex-simule');

interface DocSimule {
  sourceRef: string; category: string; subjectMatricule: string; title: string; expiresAt: string | null;
  type: string; sha256: string; legalHold: boolean; detruit: { reason: string; at: string } | null;
}
interface Index { n: number; refs: Record<string, string>; docs: Record<string, DocSimule> }

const CATEGORIES = new Set([...Object.keys(CATEGORIES_CODEX), 'interview_report']);
const MOTIFS = new Set(['retrait', 'conservation', 'effacement']);
/** Champs que Codex fixe lui-même et refuse s'ils sont envoyés (`record_owner`, `record_field`). */
const REFUSES = ['ownerId', 'ownerMatricule', 'subtype', 'attachment', 'origin', 'readers', 'projectCode', 'programCode', 'capexCode'];

const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Parties d'un corps `multipart/form-data` : en-tête et contenu. */
function parties(corps: Buffer, frontiere: string) {
  return corps.toString('latin1').split(`--${frontiere}`).slice(1, -1).map(p => {
    const [entete, ...reste] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    return { entete, contenu: Buffer.from(reste.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1') };
  });
}

/** `fetch` du Codex simulé, sur le dossier `dossier`. */
export function fetchSimule(dossier: string): typeof fetch {
  const fIndex = join(dossier, 'index.json');
  const lire = (): Index => (existsSync(fIndex) ? JSON.parse(readFileSync(fIndex, 'utf8')) : { n: 0, refs: {}, docs: {} });
  const ecrire = (i: Index) => { mkdirSync(dossier, { recursive: true }); writeFileSync(fIndex, JSON.stringify(i)); };
  return (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const h = (init.headers ?? {}) as Record<string, string>;
    const corps = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    const index = lire();
    if (init.method === 'POST' && u.pathname === '/api/documents') {
      const frontiere = /boundary=(.+)$/.exec(h['content-type'] ?? '')?.[1];
      const p = frontiere ? parties(corps, frontiere) : [];
      const meta = p.find(x => /name="meta"/.test(x.entete));
      const fichier = p.find(x => /name="file"/.test(x.entete));
      if (!meta || !fichier) return json(400, { error: 'validation', issues: [{ code: 'file_required' }] });
      const m = JSON.parse(meta.contenu.toString('utf8')) as Record<string, unknown>;
      const issues = [
        ...REFUSES.filter(k => m[k] != null).map(k => ({ field: k, code: k.startsWith('owner') ? 'record_owner' : 'record_field' })),
        ...(typeof m.sourceRef === 'string' && m.sourceRef.startsWith('cursus:') ? [] : [{ field: 'sourceRef', code: 'source_ref_app' }]),
        ...(CATEGORIES.has(String(m.category)) ? [] : [{ field: 'category', code: 'category_required' }]),
        ...(estMatriculeCodex(m.subjectMatricule as string) ? [] : [{ field: 'subjectMatricule', code: 'invalid_matricule' }]),
        ...(m.typeCode == null || m.typeCode === 'DPE' ? [] : [{ field: 'typeCode', code: 'record_type_required' }]),
      ];
      if (issues.length) return json(400, { error: 'validation', issues });
      if (m.sha256 !== sha(fichier.contenu)) return json(422, { error: 'sha256_mismatch' });
      const ref = m.sourceRef as string;
      const deja = index.refs[ref];
      if (deja) {
        const d = index.docs[deja];
        if (d.detruit) return json(410, { error: 'destroyed', id: deja });
        return d.sha256 === m.sha256 ? json(200, { id: deja, href: `/documents/${deja}`, replayed: true }) : json(409, { error: 'source_ref_reused' });
      }
      const id = `DPE-RHU-${String(++index.n).padStart(4, '0')}`;
      const type = /Content-Type: (.+)/.exec(fichier.entete)?.[1]?.trim() ?? 'application/octet-stream';
      mkdirSync(dossier, { recursive: true });
      writeFileSync(join(dossier, id), fichier.contenu);
      index.refs[ref] = id;
      index.docs[id] = {
        sourceRef: ref, category: String(m.category), subjectMatricule: String(m.subjectMatricule), title: String(m.title ?? ''),
        expiresAt: typeof m.expiresAt === 'string' ? m.expiresAt : null, type, sha256: sha(fichier.contenu), legalHold: m.legalHold === true, detruit: null,
      };
      ecrire(index);
      return json(201, { id, revision: 'A', version: 'A.1', status: 'in_force', file: true, href: `/documents/${id}`, warnings: [] });
    }
    const route = /^\/api\/documents\/([^/]+)\/(file|destroy)$/.exec(u.pathname);
    const id = route ? decodeURIComponent(route[1]) : '';
    const d = index.docs[id];
    if (!route || !d) return json(404, { error: 'not_found' });
    if (route[2] === 'file') {
      if (d.detruit) return json(404, { error: 'not_found' });
      const octets = readFileSync(join(dossier, id));
      return new Response(new Uint8Array(octets), { status: 200, headers: { 'content-type': d.type, 'x-codex-sha256': d.sha256, 'cache-control': 'no-store' } });
    }
    const { reason } = JSON.parse(corps.toString('utf8') || '{}') as { reason?: string };
    if (!reason || !MOTIFS.has(reason)) return json(400, { error: 'validation', issues: [{ field: 'reason', code: 'invalid_value' }] });
    if (d.detruit) return json(200, { id, destroyed: true, alreadyDestroyed: true, reason: d.detruit.reason, destroyedAt: d.detruit.at });
    if (d.legalHold) return json(409, { error: 'legal_hold' });
    rmSync(join(dossier, id), { force: true });
    d.detruit = { reason, at: new Date().toISOString() };
    ecrire(index);
    return json(200, { id, destroyed: true, reason, destroyedAt: d.detruit.at });
  }) as typeof fetch;
}

/** Client du Codex simulé (aucune authentification : rien ne quitte le poste). */
export const clientSimule = (env: Env = process.env) =>
  new ClientCodex({ url: URL_SIMULEE, jeton: 'simulation', secret: null }, fetchSimule(dossierSimule(env)));
