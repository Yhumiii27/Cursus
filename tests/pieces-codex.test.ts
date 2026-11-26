// lot 16 — pièces justificatives stockées dans Codex (décision du 10 novembre 2026 ; contrat livré par Codex le
// 26/11/2026, Codex#38 ; CU-037) : règles (catégories, titre neutre, motif codé), configuration, client HTTP (jeton de
// Cursus, signature HMAC du corps brut pour le dépôt et de la route pour la lecture et la destruction, multipart,
// empreinte X-Codex-SHA256, erreurs passagères ou définitives), versement et reprise du dossier local, relecture,
// destruction avec le motif du retrait (gel juridique, rejouable), Codex simulé (CODEX_SIMULATION), réglage refusé tant
// que Codex n'est pas raccordé ou que ses catégories manquent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
for (const k of ['CODEX_URL', 'CODEX_CURSUS_TOKEN', 'CODEX_CURSUS_SECRET', 'CODEX_SIMULATION', 'CODEX_SIMULATION_DIR']) delete process.env[k];

const { SqliteDb } = await import('../server/src/db.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const pieces = await import('../server/src/pieces.ts');
const C = await import('../server/src/integrations/codex/codex-documents.ts');
const { DepotGed, GED_NON_RACCORDEE } = await import('../server/src/integrations/codex/ged.ts');
const V = await import('../server/src/integrations/codex/pieces-codex.ts');
const S = await import('../server/src/integrations/codex/codex-simule.ts');
const R = await import('../shared/rules/pieces-codex.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
const journaux: string[] = [];
reglerJournaux({ sortie: (l: string) => journaux.push(l) });

const JETON = 'jeton-de-cursus-chez-codex-0123456789abcdef';
const SECRET = 'secret-de-signature-cursus-codex-ABCDEFGHIJ';
const ENV = { CODEX_URL: 'http://codex.interne:3100/', CODEX_CURSUS_TOKEN: JETON, CODEX_CURSUS_SECRET: SECRET };
const PDF = Buffer.from('%PDF-1.4\n% attestation de formation SST\n%%EOF\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Codex réel tel que son contrat le décrit, servi par le Codex simulé derrière un contrôle du jeton et de la signature. */
function codexSimule(o: { panne?: boolean; refus?: number; entete?: (id: string) => Record<string, string>; corpsCoupe?: boolean } = {}) {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-codex-'));
  const interne = S.fetchSimule(dossier);
  const appels: { methode: string; chemin: string; meta?: Record<string, any> }[] = [];
  const f = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const methode = init.method ?? 'GET';
    appels.push({ methode, chemin: u.pathname });
    if (o.panne) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const h = init.headers as Record<string, string>;
    const corps = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (h.authorization !== `Bearer ${JETON}`) return json(401, { error: 'unauthorized' });
    const signe = u.pathname === '/api/documents' ? corps : Buffer.concat([Buffer.from(`${methode} ${u.pathname}\n`), corps]);
    const attendue = createHmac('sha256', SECRET).update(`${h['x-codex-timestamp']}.`).update(signe).digest('hex');
    if (h['x-codex-signature'] !== `v1=${attendue}`) return json(401, { error: 'unauthorized', reason: 'signature_invalid' });
    if (o.refus) return json(o.refus, { error: 'validation' });
    const r = await interne(url, init);
    if (u.pathname.endsWith('/file') && r.status === 200 && (o.entete || o.corpsCoupe)) {
      const octets = Buffer.from(await r.arrayBuffer());
      const id = decodeURIComponent(u.pathname.split('/')[3]);
      if (o.corpsCoupe) {
        const flux = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(octets.subarray(0, 3))); c.error(Object.assign(new Error('coupé'), { name: 'AbortError' })); } });
        return new Response(flux, { status: 200, headers: { 'x-codex-sha256': sha(octets) } });
      }
      return new Response(new Uint8Array(octets), { status: 200, headers: o.entete!(id) });
    }
    return r;
  }) as typeof fetch;
  const index = () => JSON.parse(readFileSync(join(dossier, 'index.json'), 'utf8')) as { docs: Record<string, any> };
  return { f, dossier, appels, index, client: new C.ClientCodex(C.configCodex(ENV)!, f) };
}

async function base() {
  const db = new SqliteDb(':memory:');
  await migrate(db);
  await appliquerMigrations(db);
  await seedDemo(db);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'ged' });
  /** Pièce jointe gardée dans le dossier local (envoi d'avant le lot 16, ou en attente de versement). */
  const piece = async (o: { empId?: number | null; objet?: string; objetId?: number; octets?: Buffer; conserverJusquau?: string | null } = {}) => {
    const octets = o.octets ?? PDF;
    const fichier = await pieces.depotLocal(db).ecrire(octets);
    return (await db.insert<{ id: number; fichier: string }>('pieces', {
      jeton: null, empId: o.empId === undefined ? 2 : o.empId, objet: o.objet ?? 'certification', objetId: o.objetId ?? 1, nom: 'attestation SST Benali.pdf', type: 'application/pdf',
      taille: octets.length, empreinte: pieces.empreinte(octets), fichier, chiffree: false, deposeLe: '2026-09-14T08:00:00.000Z', deposePar: 'Ana Martin',
      conserverJusquau: o.conserverJusquau ?? null,
    }));
  };
  return { db, piece, ligne: async (id: number) => (await db.get<Record<string, any>>('pieces', id))! };
}

/** Exécute `fn` avec des variables d'environnement posées, puis les rétablit. */
async function avecEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const avant = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('lot 16 règles : catégorie de chaque objet, titre neutre, motif codé, catégories manquantes', () => {
  assert.equal(R.categorieDePiece('absence'), 'absence');
  assert.equal(R.categorieDePiece('certification'), 'training_certificate');
  assert.equal(R.categorieDePiece('habTitre'), 'authorisation');
  assert.equal(R.categorieDePiece('ligneFraisSante'), 'expense_health');
  assert.equal(R.categorieDePiece('declaration', { kind: 'passeport' }), 'identity');
  assert.equal(R.categorieDePiece('declaration', { kind: 'visa' }), 'identity');
  assert.equal(R.categorieDePiece('declaration', { kind: 'vaccin' }), 'vaccination');
  assert.equal(R.categorieDePiece('declaration', {}), null, 'document déclaré inconnu');
  assert.equal(R.categorieDePiece('dossierOpco'), null, 'Codex exige un matricule : un dossier OPCO collectif reste local');
  assert.equal(R.CATEGORIES_CODEX.vaccination.titre, R.CATEGORIES_CODEX.identity.titre, 'rien ne dit qu’une pièce est une vaccination');
  assert.equal(R.CATEGORIES_CODEX.expense_health.titre, R.CATEGORIES_CODEX.expense.titre, 'rien ne désigne la santé');
  assert.equal(R.titrePiece('absence', { matricule: 'EMP-0042', deposeLe: '2026-11-03T10:00:00Z' }), 'Justificatif d’absence — EMP-0042 — 2026-11');
  assert.ok(R.estMatriculeCodex('EMP-0042') && R.estMatriculeCodex('I12') && R.estMatriculeCodex('E7'));
  assert.ok(!R.estMatriculeCodex('EMP-42') && !R.estMatriculeCodex('X1') && !R.estMatriculeCodex(null));
  assert.equal(R.sourceRefPiece(12), 'cursus:piece/12');
  assert.equal(R.motifDestruction(R.MOTIF_CONSERVATION), 'conservation');
  assert.equal(R.motifDestruction(R.MOTIF_EFFACEMENT), 'effacement');
  assert.equal(R.motifDestruction('Pièce jointe par erreur'), 'retrait');
  assert.equal(R.motifDestruction(null), 'retrait');
  const maj = [{ code: 'DPE', subtypes: R.REGISTRE_CODEX_ATTENDU[0].subtypes!.map(s => ({ fr: s.fr!.toUpperCase() })) }];
  assert.deepEqual(R.categoriesManquantes(maj), [], 'casse, accents et espaces ignorés');
  assert.deepEqual(R.categoriesManquantes([]), ['type DPE']);
  const m = R.categoriesManquantes([{ code: 'DPE', subtypes: [{ fr: 'Fiche de poste' }, { fr: null }] }]);
  assert.ok(m.includes('DPE › Justificatif d’absence') && m.length === 10, m.join(' ; '));
  assert.equal(R.categoriesManquantes([{ code: 'DPE', subtypes: null }]).length, 10);
});

test('lot 16 configuration : adresse, jeton de Cursus, secret facultatif, simulation ; anciennes variables refusées', () => {
  assert.deepEqual(C.problemesCodex({}), []);
  assert.equal(C.configCodex({}), null);
  assert.equal(C.clientCodex({}), null);
  assert.match(C.problemesCodex({ CODEX_CURSUS_TOKEN: JETON })[0], /est définie sans CODEX_URL/);
  assert.match(C.problemesCodex({ CODEX_CURSUS_TOKEN: JETON, CODEX_CURSUS_SECRET: SECRET })[0], /sont définies sans CODEX_URL/);
  const p = C.problemesCodex({ CODEX_URL: 'ftp://x', CODEX_CURSUS_SECRET: 'court' });
  assert.ok(p.some(x => /http\(s\) valide/.test(x)) && p.some(x => /CODEX_CURSUS_SECRET est trop faible/.test(x)) && p.some(x => /sans CODEX_CURSUS_TOKEN/.test(x)), p.join(' ; '));
  assert.match(C.problemesCodex({ ...ENV, CODEX_URL: 'http://u:p@codex' })[0], /identifiant ou un mot de passe/);
  assert.match(C.problemesCodex({ ...ENV, CODEX_URL: 'http://codex/ged' })[0], /chemin ou des paramètres/);
  assert.match(C.problemesCodex({ ...ENV, CODEX_URL: 'http://codex?x=1' })[0], /chemin ou des paramètres/);
  assert.match(C.problemesCodex({ ...ENV, CODEX_DOCUMENTS_OWNER: 'svc' })[0], /CODEX_DOCUMENTS_OWNER : variables remplacées par CODEX_CURSUS_TOKEN/);
  assert.match(C.problemesCodex({ CODEX_SIMULATION: 'oui' })[0], /CODEX_SIMULATION vaut « oui »/);
  assert.match(C.problemesCodex({ CODEX_SIMULATION: '1', NODE_ENV: 'production' })[0], /réservée à la démonstration/);
  assert.match(C.problemesCodex({ ...ENV, CODEX_SIMULATION: '1' })[0], /ensemble/);
  assert.deepEqual(C.problemesCodex({ CODEX_SIMULATION: '0' }), []);
  assert.deepEqual(C.problemesCodex(ENV), []);
  assert.equal(C.clientCodex({ ...ENV, CODEX_DOCUMENTS_TOKEN: JETON }), null, 'configuration refusée : aucun client');
  const c = C.configCodex(ENV)!;
  assert.deepEqual(c, { url: 'http://codex.interne:3100', jeton: JETON, secret: SECRET });
  assert.equal(C.configCodex({ ...ENV, CODEX_CURSUS_SECRET: undefined })!.secret, null, 'jeton seul admis');
  assert.ok(C.clientCodex(ENV) instanceof C.ClientCodex);
  const sim = C.clientCodex({ CODEX_SIMULATION: '1', CODEX_SIMULATION_DIR: '/tmp/x' })!;
  assert.equal(sim.config.url, S.URL_SIMULEE);
  assert.equal(S.dossierSimule({ CODEX_SIMULATION_DIR: ' /tmp/x ' }), '/tmp/x');
  assert.equal(S.dossierSimule({ CURSUS_DB: '/srv/cursus/base.db' }), '/srv/cursus/codex-simule');
  assert.ok(S.clientSimule() instanceof C.ClientCodex);
});

test('lot 16 client : dépôt signé et rejouable, lecture contrôlée par son empreinte, destruction rejouable', async () => {
  const { client, index, appels } = codexSimule();
  const meta = { sourceRef: 'cursus:piece/1', title: 't', category: 'training_certificate' as const, subjectMatricule: 'EMP-0002', expiresAt: null, sha256: sha(PDF) };
  const r = await client.deposer(PDF, 'application/pdf', 'a"b.pdf', meta);
  assert.deepEqual(r, { id: 'DPE-RHU-0001', replayed: false });
  const d = index().docs[r.id];
  assert.deepEqual([d.category, d.subjectMatricule, d.expiresAt, d.sha256, d.type], ['training_certificate', 'EMP-0002', null, sha(PDF), 'application/pdf']);
  assert.deepEqual(await client.deposer(PDF, 'application/pdf', 'a.pdf', meta), { id: 'DPE-RHU-0001', replayed: true }, 'nouvelle signature, même sourceRef');
  assert.ok((await client.lire(r.id))!.equals(PDF));
  assert.equal(await client.lire('INCONNU'), null);
  assert.deepEqual(await client.detruire(r.id, 'effacement'), { dejaDetruit: false });
  assert.equal(index().docs[r.id].detruit.reason, 'effacement');
  assert.deepEqual(await client.detruire(r.id, 'conservation'), { dejaDetruit: true }, 'rejouable, motif d’origine gardé');
  assert.deepEqual(await client.detruire('INCONNU', 'retrait'), { dejaDetruit: true }, '404 : rien à détruire');
  assert.equal(await client.lire(r.id), null);
  await assert.rejects(client.deposer(PDF, 'application/pdf', 'a.pdf', meta), (e: unknown) => e instanceof C.CodexRefus && e.status === 410 && e.code === 'destroyed');
  assert.ok(appels.some(a => a.chemin === '/api/documents/DPE-RHU-0001/destroy'));
  await assert.rejects(codexSimule({ panne: true }).client.lire('x'), (e: unknown) => e instanceof C.CodexIndisponible && /ECONNREFUSED/.test((e as Error).message));
  await assert.rejects(new C.ClientCodex(C.configCodex(ENV)!, (async () => { throw new Error('x'); }) as typeof fetch).lire('x'), (e: unknown) => e instanceof C.CodexIndisponible && /\(Error\)/.test((e as Error).message));
  await assert.rejects(new C.ClientCodex(C.configCodex(ENV)!, (async () => { throw null; }) as unknown as typeof fetch).lire('x'), /erreur réseau/);
  await assert.rejects(codexSimule({ refus: 503 }).client.deposer(PDF, 'application/pdf', 'a.pdf', meta), C.CodexIndisponible);
  await assert.rejects(codexSimule({ refus: 503 }).client.lire('x'), C.CodexIndisponible);
  await assert.rejects(codexSimule({ refus: 429 }).client.detruire('x', 'retrait'), C.CodexIndisponible);
  await assert.rejects(codexSimule({ refus: 400 }).client.deposer(PDF, 'application/pdf', 'a.pdf', meta), (e: unknown) => e instanceof C.CodexRefus && e.status === 400 && e.code === 'validation');
  const mauvais = new C.ClientCodex({ ...C.configCodex(ENV)!, secret: 'autre-secret-de-signature-0123456789' }, codexSimule().f);
  await assert.rejects(mauvais.lire('x'), (e: unknown) => e instanceof C.CodexRefus && e.status === 401);
  // Réponses inattendues : sans identifiant (indisponible), corps d'erreur illisible (refus sans code).
  const brut = (status: number, corps: string, h: Record<string, string> = {}) => new C.ClientCodex(C.configCodex(ENV)!, (async () => new Response(corps, { status, headers: h })) as typeof fetch);
  await assert.rejects(brut(201, '{}').deposer(PDF, 'application/pdf', 'a.pdf', meta), /réponse sans identifiant/);
  await assert.rejects(brut(201, 'pas du json').deposer(PDF, 'application/pdf', 'a.pdf', meta), /réponse sans identifiant/);
  await assert.rejects(brut(418, 'pas du json').lire('x'), (e: unknown) => e instanceof C.CodexRefus && e.code === null && (e as Error).message.endsWith('418'));
  assert.deepEqual(await brut(200, 'pas du json').detruire('x', 'retrait'), { dejaDetruit: false });
  assert.equal(await brut(410, '').lire('x'), null);
});

test('lot 16 client : empreinte X-Codex-SHA256 absente ou différente, envoi coupé : jamais un fichier servi tel quel', async () => {
  const meta = { sourceRef: 'cursus:piece/1', title: 't', category: 'absence' as const, subjectMatricule: 'EMP-0002', expiresAt: '2031-01-01', sha256: sha(PDF) };
  const sans = codexSimule({ entete: () => ({}) });
  const { id } = await sans.client.deposer(PDF, 'application/pdf', 'a.pdf', meta);
  assert.equal(sans.index().docs[id].expiresAt, '2031-01-01');
  await assert.rejects(sans.client.lire(id), (e: unknown) => e instanceof C.CodexRefus && e.code === 'sha256_mismatch' && /sans empreinte/.test((e as Error).message));
  const autre = codexSimule({ entete: () => ({ 'x-codex-sha256': 'a'.repeat(64) }) });
  await autre.client.deposer(PDF, 'application/pdf', 'a.pdf', meta);
  await assert.rejects(autre.client.lire(id), /empreinte du fichier reçu différente/);
  const coupe = codexSimule({ corpsCoupe: true });
  await coupe.client.deposer(PDF, 'application/pdf', 'a.pdf', meta);
  await assert.rejects(coupe.client.lire(id), (e: unknown) => e instanceof C.CodexIndisponible && /interrompue \(AbortError\)/.test((e as Error).message));
});

test('lot 16 Codex simulé : contrat de Codex (validation, empreinte, sourceRef réemployée, gel juridique, motif)', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-codex-'));
  const f = S.fetchSimule(dossier);
  const c = new C.ClientCodex({ url: S.URL_SIMULEE, jeton: 'simulation', secret: null }, f);
  const meta = { sourceRef: 'cursus:piece/7', title: 't', category: 'identity' as const, subjectMatricule: 'I12', expiresAt: null, sha256: sha(PDF) };
  await assert.rejects(c.deposer(PDF, 'application/pdf', 'a.pdf', { ...meta, sha256: 'b'.repeat(64) }), (e: unknown) => e instanceof C.CodexRefus && e.status === 422 && e.code === 'sha256_mismatch');
  await assert.rejects(c.deposer(PDF, 'application/pdf', 'a.pdf', { ...meta, sourceRef: 'keystone:x', subjectMatricule: 'X', category: 'autre' as never }), (e: unknown) => e instanceof C.CodexRefus && e.status === 400);
  const { id } = await c.deposer(PDF, 'application/pdf', 'a.pdf', meta);
  await assert.rejects(c.deposer(Buffer.from('autre'), 'application/pdf', 'a.pdf', { ...meta, sha256: sha(Buffer.from('autre')) }), (e: unknown) => e instanceof C.CodexRefus && e.status === 409 && e.code === 'source_ref_reused');
  // Persistant : un autre client sur le même dossier relit le fichier (redémarrage de Cursus).
  assert.ok((await S.clientSimule({ CODEX_SIMULATION_DIR: dossier }).lire(id))!.equals(PDF));
  // Requêtes que Cursus n'envoie pas : champs fixés par Codex, multipart incomplet, motif inconnu, route inconnue.
  const poste = async (corps: string, type: string) => (await f(`${S.URL_SIMULEE}/api/documents`, { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(Buffer.from(corps)) })).json();
  assert.equal((await poste('x', 'application/json')).issues[0].code, 'file_required');
  const fr = 'fr';
  const multipart = (m: object) => `--${fr}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(m)}\r\n--${fr}\r\nContent-Disposition: form-data; name="file"; filename="a"\r\n\r\nxy\r\n--${fr}--\r\n`;
  const refuse = await poste(multipart({ ...meta, ownerId: 'u', subtype: 's', typeCode: 'RHF' }), `multipart/form-data; boundary=${fr}`);
  assert.deepEqual(refuse.issues.map((i: { code: string }) => i.code), ['record_owner', 'record_field', 'record_type_required']);
  const sansType = await f(`${S.URL_SIMULEE}/api/documents`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${fr}` }, body: new Uint8Array(Buffer.from(multipart({ ...meta, sourceRef: 'cursus:piece/8', sha256: sha(Buffer.from('xy')), legalHold: true }))) });
  const gele = (await sansType.json()).id;
  assert.equal(sansType.status, 201);
  assert.equal(JSON.parse(readFileSync(join(dossier, 'index.json'), 'utf8')).docs[gele].type, 'application/octet-stream');
  await assert.rejects(c.detruire(gele, 'conservation'), (e: unknown) => e instanceof C.CodexRefus && e.status === 409 && e.code === 'legal_hold');
  const detruire = (corps: string) => f(`${S.URL_SIMULEE}/api/documents/${id}/destroy`, { method: 'POST', body: new Uint8Array(Buffer.from(corps)) });
  assert.equal((await detruire('{"reason":"oubli"}')).status, 400);
  assert.equal((await detruire('')).status, 400);
  assert.equal((await f(`${S.URL_SIMULEE}/api/autre`)).status, 404);
  assert.equal((await f(`${S.URL_SIMULEE}/api/documents/INCONNU/file`)).status, 404);
  // Dossier encore vide : le premier dépôt le crée.
  const neuf = join(mkdtempSync(join(tmpdir(), 'cursus-codex-')), 'sous-dossier');
  assert.deepEqual(await S.clientSimule({ CODEX_SIMULATION_DIR: neuf }).deposer(PDF, 'application/pdf', 'a.pdf', meta), { id: 'DPE-RHU-0001', replayed: false });
});

test('lot 16 versement : pièce jointe versée avec sa catégorie, son matricule et son empreinte, fichier local effacé', async () => {
  const { db, piece, ligne } = await base();
  const { client, index } = codexSimule();
  const a = await piece({ conserverJusquau: '2036-12-31' });
  const opco = await piece({ empId: null, objet: 'dossierOpco' });
  const c = await piece({ objet: 'absence', empId: 15 });
  const passeport = await db.insert<{ id: number }>('demandesCollab', { empId: 2, type: 'document', label: 'Passeport', date: '2026-01-01', statut: 'attente', declaration: { kind: 'passeport', numero: '21XY12345', expire: '2032-01-01' } });
  const d = await piece({ objet: 'declaration', objetId: passeport.id });
  const enAttente = await db.insert<{ id: number }>('pieces', { jeton: 'j', empId: null, objet: null, objetId: null, nom: 'x.pdf', type: 'application/pdf', taille: 1, fichier: await pieces.depotLocal(db).ecrire(PDF), deposeLe: '2026-10-10T08:00:00Z', deposePar: 'x' });
  const dossier = pieces.dossierPiecesDe(db);
  assert.deepEqual(await V.verserPieces(db, client), { versees: 3, enEchec: 0, restantes: 0 }, 'dossier OPCO collectif : ni versé ni compté');
  const [la, lc, ld] = [await ligne(a.id), await ligne(c.id), await ligne(d.id)];
  assert.match(la.fichier, /^ged:DPE-RHU-\d{4}$/);
  assert.equal(existsSync(join(dossier, a.fichier)), false, 'copie locale effacée');
  assert.equal((await ligne(opco.id)).fichier, opco.fichier, 'pièce OPCO gardée dans le dossier local');
  assert.equal((await ligne(enAttente.id)).fichier.startsWith('ged:'), false, 'une pièce en attente n’est jamais versée');
  const ma = index().docs[la.fichier.slice(4)];
  assert.deepEqual([ma.sourceRef, ma.category, ma.subjectMatricule, ma.expiresAt, ma.sha256],
    [`cursus:piece/${a.id}`, 'training_certificate', 'EMP-0002', '2036-12-31', pieces.empreinte(PDF)]);
  assert.equal(ma.title, 'Attestation de formation — EMP-0002 — 2026-09', 'titre neutre, sans nom');
  assert.equal(index().docs[lc.fichier.slice(4)].category, 'absence');
  assert.deepEqual([index().docs[ld.fichier.slice(4)].category, index().docs[ld.fichier.slice(4)].title], ['identity', 'Document déclaré — EMP-0002 — 2026-09']);
  // Relecture par l'adaptateur ; un second passage ne verse rien.
  assert.ok((await new DepotGed(client).lire(la.fichier))!.equals(PDF));
  assert.deepEqual(await V.verserPieces(db, client), { versees: 0, enEchec: 0, restantes: 0 });
  assert.match(V.bilanVersement({ versees: 2, enEchec: 1, restantes: 4 }), /^2 pièces versées dans Codex · 1 pièce non versée · 4 pièces restent à verser$/);
});

test('lot 16 versement : personne sur site (I…), matricule refusé, document déclaré inconnu : gardé en local', async () => {
  const { db, piece, ligne } = await base();
  const { client, index } = codexSimule();
  await db.update('employes', 3, { exterieur: true, matriculeSite: 'I42' });
  await db.update('employes', 4, { exterieur: true, matriculeSite: 'Z9' });
  const site = await piece({ empId: 3 });
  const refuse = await piece({ empId: 4 });
  const inconnu = await db.insert<{ id: number }>('demandesCollab', { empId: 2, type: 'document', label: '?', date: '2026-01-01', statut: 'attente', declaration: null });
  const decl = await piece({ objet: 'declaration', objetId: inconnu.id });
  journaux.length = 0;
  assert.deepEqual(await V.verserPieces(db, client), { versees: 1, enEchec: 2, restantes: 2 });
  assert.equal(index().docs[(await ligne(site.id)).fichier.slice(4)].subjectMatricule, 'I42');
  assert.equal((await ligne(refuse.id)).fichier.startsWith('ged:'), false);
  assert.equal((await ligne(decl.id)).fichier.startsWith('ged:'), false);
  assert.ok(journaux.some(l => /matricule de la personne absent ou refusé/.test(l)) && journaux.some(l => /catégorie de Codex inconnue/.test(l)), journaux.join('\n'));
});

test('lot 16 versement : fichier altéré gardé, refus définitif gardé en local, Codex injoignable : arrêt, reprise par lots', async () => {
  const { db, piece, ligne } = await base();
  const alteree = await piece();
  await db.update('pieces', alteree.id, { empreinte: 'f'.repeat(64) });
  const refusee = await piece();
  assert.deepEqual(await V.verserPieces(db, codexSimule({ refus: 422 }).client), { versees: 0, enEchec: 2, restantes: 2 });
  assert.equal((await ligne(refusee.id)).fichier, refusee.fichier);
  const panne = codexSimule({ panne: true });
  await piece();
  assert.deepEqual(await V.verserPieces(db, panne.client), { versees: 0, enEchec: 1, restantes: 3 });
  assert.equal(panne.appels.length, 1, 'arrêt au premier échec réseau');
  const { client } = codexSimule();
  assert.deepEqual(await V.verserPieces(db, client, { limite: 2 }), { versees: 1, enEchec: 1, restantes: 2 });
  assert.deepEqual(await V.verserPieces(db, client), { versees: 1, enEchec: 1, restantes: 1 });
});

test('lot 16 destruction : le nettoyage détruit dans Codex avec le motif codé ; gel juridique signalé, repris ensuite', async () => {
  const { db, piece, ligne } = await base();
  const simule = codexSimule();
  const ids = [(await piece()).id, (await piece()).id, (await piece()).id, (await piece()).id];
  await V.verserPieces(db, simule.client);
  const motifs = ['Pièce jointe par erreur', R.MOTIF_CONSERVATION, R.MOTIF_EFFACEMENT, R.MOTIF_CONSERVATION];
  for (const [i, id] of ids.entries()) await db.update('pieces', id, { retireeLe: '2026-10-10T09:00:00Z', retireePar: 'Ana Martin', retireeMotif: motifs[i] });
  const docIds = await Promise.all(ids.map(async id => (await ligne(id)).fichier.slice(4) as string));
  // La dernière est sous gel juridique chez Codex.
  const idx = JSON.parse(readFileSync(join(simule.dossier, 'index.json'), 'utf8'));
  idx.docs[docIds[3]].legalHold = true;
  writeFileSync(join(simule.dossier, 'index.json'), JSON.stringify(idx));
  const fetchAvant = globalThis.fetch;
  globalThis.fetch = simule.f;
  journaux.length = 0;
  try {
    const b = await avecEnv(ENV, () => pieces.nettoyerPieces(db));
    assert.equal(b.retirees, 4);
  } finally {
    globalThis.fetch = fetchAvant;
  }
  assert.deepEqual(docIds.slice(0, 3).map(id => simule.index().docs[id].detruit.reason), ['retrait', 'conservation', 'effacement']);
  for (const id of ids.slice(0, 3)) assert.equal((await ligne(id)).fichier, null);
  assert.equal((await ligne(ids[3])).fichier, `ged:${docIds[3]}`, 'gel juridique : nom stocké gardé, nouvel essai au passage suivant');
  assert.ok(journaux.some(l => /legal_hold.*destruction à reprendre/.test(l)), journaux.join('\n'));
});

test('lot 16 réglage « Codex » : refusé sans raccordement, sans registre lisible ou sans catégories ; accepté sinon', async () => {
  const { db } = await base();
  const { client } = codexSimule();
  assert.equal(await V.refusCodex(db, { client: null }), GED_NON_RACCORDEE);
  assert.match((await V.refusCodex(db, { client }))!, /Registre des types de Codex illisible \(codex\.pub_types_document\).*Matrix/, 'SQLite : pas de vue de Codex');
  assert.match((await V.refusCodex(db, { client, types: [{ code: 'DPE', subtypes: [] }] }))!, /Catégories absentes du registre de Codex : DPE › Justificatif d’absence/);
  assert.equal(await V.refusCodex(db, { client, types: R.REGISTRE_CODEX_ATTENDU }), null);
  // Codex simulé : raccordé, registre attendu ; le versement passe par lui.
  const dir = mkdtempSync(join(tmpdir(), 'cursus-codex-'));
  await avecEnv({ CODEX_SIMULATION: '1', CODEX_SIMULATION_DIR: dir }, async () => {
    assert.equal(await V.refusCodex(db), null);
    await db.insert('pieces', { jeton: null, empId: 2, objet: 'certification', objetId: 1, nom: 'a.pdf', type: 'application/pdf', taille: PDF.length, empreinte: pieces.empreinte(PDF), fichier: await pieces.depotLocal(db).ecrire(PDF), chiffree: false, deposeLe: '2026-09-14T08:00:00.000Z', deposePar: 'x' });
    assert.deepEqual(await V.verserSiCodex(db), { versees: 1, enEchec: 0, restantes: 0 });
  });
  // Écran Paramètres : sans raccordement (environnement des tests), le choix est refusé et rien n'est enregistré.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'local' });
  const compte = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL'))!.id;
  const rh = (await currentUser(db, { compteId: compte, role: 'rh', methode: 'demo' }))!;
  await assert.rejects(async () => await db.tx(async () => await ACTIONS['parametres.maj'](makeCtx(db, rh, await loadFull(db, rh)), { piecesStockage: 'ged' })),
    (e: unknown) => e instanceof ActionError && e.status === 409 && e.message === GED_NON_RACCORDEE);
  assert.equal(await pieces.stockagePieces(db), 'local');
  // Stockage « Codex » choisi sans raccordement (base restaurée ailleurs) : aucun versement, rien d'effacé.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'ged' });
  assert.equal(await V.verserSiCodex(db, null), null);
});

test('lot 16 registre de Codex (PostgreSQL) : vue absente ou non accordée = illisible ; lue, catégories contrôlées', async () => {
  const { PG, nouvelleBase } = await import('./base.ts');
  if (!PG) return;
  const db = await nouvelleBase();
  await db.exec('DROP VIEW IF EXISTS codex.pub_types_document');
  assert.equal(await V.lireTypesCodex(db), null, 'vue absente : jamais une erreur');
  await db.exec(`CREATE SCHEMA IF NOT EXISTS codex;
    CREATE OR REPLACE VIEW codex.pub_types_document AS SELECT 'DPE'::text AS code, '[{"fr":"Attestation de formation","en":"x"}]'::jsonb AS subtypes`);
  try {
    const types = await V.lireTypesCodex(db);
    assert.deepEqual(types, [{ code: 'DPE', subtypes: [{ fr: 'Attestation de formation', en: 'x' }] }]);
    assert.match((await V.refusCodex(db, { client: codexSimule().client }))!, /Catégories absentes du registre de Codex : DPE › Justificatif d’absence/);
  } finally {
    await db.exec('DROP VIEW IF EXISTS codex.pub_types_document');
  }
});
