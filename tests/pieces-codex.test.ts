// lot 16 — pièces justificatives stockées dans Codex (décision du 10 novembre 2026 ; demandes Codex#29 et Matrix#87) :
// règles (catégories, titre neutre, motif codé), configuration, client HTTP (jeton, signature HMAC du corps brut,
// multipart, erreurs passagères ou définitives), versement et reprise du dossier local face à un Codex simulé, relecture,
// destruction avec le motif du retrait, réglage refusé tant que Codex n'est pas raccordé ou que ses catégories manquent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
for (const k of ['CODEX_URL', 'CODEX_DOCUMENTS_TOKEN', 'CODEX_DOCUMENTS_SECRET', 'CODEX_DOCUMENTS_OWNER']) delete process.env[k];

const { SqliteDb } = await import('../server/src/db.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const pieces = await import('../server/src/pieces.ts');
const C = await import('../server/src/integrations/codex-documents.ts');
const { DepotGed, GED_NON_RACCORDEE } = await import('../server/src/integrations/ged.ts');
const V = await import('../server/src/pieces-codex.ts');
const R = await import('../shared/rules/pieces-codex.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
reglerJournaux({ sortie: () => {} });

const JETON = 'jeton-de-cursus-chez-codex-0123456789abcdef';
const SECRET = 'secret-de-signature-cursus-codex-ABCDEFGHIJ';
const ENV = { CODEX_URL: 'http://codex.interne:3100/', CODEX_DOCUMENTS_TOKEN: JETON, CODEX_DOCUMENTS_SECRET: SECRET, CODEX_DOCUMENTS_OWNER: 'svc-cursus' };
const PDF = Buffer.from('%PDF-1.4\n% attestation de formation SST\n%%EOF\n');

/** Registre de Codex tel que Cursus l'a demandé : type RHF avec les sous-types du lot 16. */
const REGISTRE = [{ code: 'RHF', subtypes: [...new Set(Object.values(R.CATEGORIES_CODEX).map(c => c.sousType))].map(fr => ({ fr: fr.toUpperCase() })) }];

/** Codex simulé : contrôle le jeton et la signature, garde les documents déposés, sert et détruit les fichiers. */
function codexSimule(o: { panne?: boolean; refus?: number } = {}) {
  const docs = new Map<string, { meta: Record<string, any>; fichier: Buffer; detruit?: string }>();
  const parRef = new Map<string, string>();
  const appels: { methode: string; chemin: string }[] = [];
  let n = 0;
  const f = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const methode = init.method ?? 'GET';
    appels.push({ methode, chemin: u.pathname });
    if (o.panne) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const h = init.headers as Record<string, string>;
    const corps = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (h.authorization !== `Bearer ${JETON}`) return json(401, { error: 'unauthorized' });
    const attendue = createHmac('sha256', SECRET).update(`${h['x-codex-timestamp']}.`).update(corps).digest('hex');
    if (h['x-codex-signature'] !== `v1=${attendue}`) return json(401, { error: 'unauthorized', reason: 'signature_invalid' });
    if (o.refus) return json(o.refus, { error: 'validation' });
    if (methode === 'POST' && u.pathname === '/api/documents') {
      const frontiere = /boundary=(.+)$/.exec(h['content-type'])![1];
      const parties = corps.toString('latin1').split(`--${frontiere}`).slice(1, -1).map(p => {
        const [entete, ...reste] = p.replace(/^\r\n/, '').split('\r\n\r\n');
        return { entete, contenu: Buffer.from(reste.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1') };
      });
      const meta = JSON.parse(parties.find(p => /name="meta"/.test(p.entete))!.contenu.toString('utf8'));
      const fichier = parties.find(p => /name="file"/.test(p.entete))!.contenu;
      if (parRef.has(meta.sourceRef)) return json(200, { id: parRef.get(meta.sourceRef), replayed: true });
      const id = `RHF-RHU-${String(++n).padStart(4, '0')}`;
      docs.set(id, { meta, fichier });
      parRef.set(meta.sourceRef, id);
      return json(201, { id, revision: 'A', status: 'recorded' });
    }
    const m = /^\/api\/documents\/([^/]+)\/(file|destroy)$/.exec(u.pathname);
    const d = m && docs.get(decodeURIComponent(m[1]));
    if (!d || d.detruit) return json(404, { error: 'not_found' });
    if (m![2] === 'file') return new Response(new Uint8Array(d.fichier), { status: 200, headers: { 'content-type': 'application/pdf' } });
    d.detruit = JSON.parse(corps.toString()).reason;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { f, docs, appels, client: new C.ClientCodex(C.configCodex(ENV)!, f) };
}

async function base() {
  const db = new SqliteDb(':memory:');
  await migrate(db);
  await appliquerMigrations(db);
  await seedDemo(db);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: 'ged' });
  /** Pièce jointe gardée dans le dossier local (envoi d'avant le lot 16, ou en attente de versement). */
  const piece = async (o: { empId?: number | null; objet?: string; octets?: Buffer; conserverJusquau?: string | null } = {}) => {
    const octets = o.octets ?? PDF;
    const fichier = await pieces.depotLocal(db).ecrire(octets);
    return (await db.insert<{ id: number; fichier: string }>('pieces', {
      jeton: null, empId: o.empId === undefined ? 2 : o.empId, objet: o.objet ?? 'certification', objetId: 1, nom: 'attestation SST Benali.pdf', type: 'application/pdf',
      taille: octets.length, empreinte: pieces.empreinte(octets), fichier, chiffree: false, deposeLe: '2026-09-14T08:00:00.000Z', deposePar: 'Ana Martin',
      conserverJusquau: o.conserverJusquau ?? null,
    }));
  };
  return { db, piece, ligne: async (id: number) => (await db.get<Record<string, any>>('pieces', id))! };
}

test('lot 16 règles : catégorie de chaque objet, titre neutre, motif codé, catégories manquantes', () => {
  assert.equal(R.CATEGORIES_CODEX.absence.conf, 'tres_confidentiel');
  assert.equal(R.CATEGORIES_CODEX.ligneFraisSante.titre, R.CATEGORIES_CODEX.ligneFrais.titre, 'rien ne désigne la santé');
  assert.equal(R.titrePiece('absence', { matricule: 'EMP-0042', objetId: 7, deposeLe: '2026-11-03T10:00:00Z' }), 'Justificatif d’absence — EMP-0042 — 2026-11');
  assert.equal(R.titrePiece('dossierOpco', { matricule: null, objetId: 7, deposeLe: '2026-11-03T10:00:00Z' }), 'Pièce de dossier OPCO — dossier 7 — 2026-11');
  assert.equal(R.sourceRefPiece(12), 'cursus:piece/12');
  assert.equal(R.motifDestruction(R.MOTIF_CONSERVATION), 'conservation');
  assert.equal(R.motifDestruction(R.MOTIF_EFFACEMENT), 'effacement');
  assert.equal(R.motifDestruction('Pièce jointe par erreur'), 'retrait');
  assert.equal(R.motifDestruction(null), 'retrait');
  assert.deepEqual(R.categoriesManquantes(REGISTRE), [], 'casse, accents et espaces ignorés');
  assert.deepEqual(R.categoriesManquantes([]), ['type RHF']);
  const m = R.categoriesManquantes([{ code: 'RHF', subtypes: [{ fr: 'Fiche de poste' }] }]);
  assert.ok(m.includes('RHF › Justificatif d’absence') && m.length === 8, m.join(' ; '));
});

test('lot 16 configuration : adresse, jeton ou secret, compte de service ; rien sans CODEX_URL', () => {
  assert.deepEqual(C.problemesCodex({}), []);
  assert.equal(C.configCodex({}), null);
  assert.match(C.problemesCodex({ CODEX_DOCUMENTS_TOKEN: JETON })[0], /sans CODEX_URL/);
  const p = C.problemesCodex({ CODEX_URL: 'ftp://x', CODEX_DOCUMENTS_TOKEN: 'court' });
  assert.ok(p.some(x => /http\(s\) valide/.test(x)) && p.some(x => /CODEX_DOCUMENTS_TOKEN est trop faible/.test(x)) && p.some(x => /CODEX_DOCUMENTS_OWNER/.test(x)));
  assert.match(C.problemesCodex({ ...ENV, CODEX_URL: 'http://u:p@codex' })[0], /identifiant ou un mot de passe/);
  assert.deepEqual(C.problemesCodex(ENV), []);
  const c = C.configCodex(ENV)!;
  assert.equal(c.url, 'http://codex.interne:3100');
  assert.deepEqual(c.proprietaire, { ownerId: 'svc-cursus' });
  assert.deepEqual(C.configCodex({ ...ENV, CODEX_DOCUMENTS_OWNER: 'EMP-0007' })!.proprietaire, { ownerMatricule: 'EMP-0007' });
  assert.equal(C.configCodex({ ...ENV, CODEX_DOCUMENTS_SECRET: undefined })!.secret, null, 'jeton seul admis');
});

test('lot 16 client : dépôt signé et rejouable, relecture, destruction, erreurs passagères ou définitives', async () => {
  const { client, docs } = codexSimule();
  const meta = { sourceRef: 'cursus:piece/1', title: 't', typeCode: 'RHF', subtype: 's', department: 'RHU', conf: 'confidentiel', subjectMatricule: 'EMP-0002', expiresAt: null, sha256: pieces.empreinte(PDF) };
  const r = await client.deposer(PDF, 'application/pdf', 'a"b.pdf', meta);
  assert.deepEqual(r, { id: 'RHF-RHU-0001', replayed: false });
  const d = docs.get(r.id)!;
  assert.ok(d.fichier.equals(PDF), 'fichier intact dans le multipart');
  assert.equal(d.meta.ownerId, 'svc-cursus');
  assert.equal('expiresAt' in d.meta, false, 'champ vide omis');
  assert.deepEqual(await client.deposer(PDF, 'application/pdf', 'a.pdf', meta), { id: 'RHF-RHU-0001', replayed: true }, 'nouvelle signature, même sourceRef');
  assert.ok((await client.lire(r.id))!.equals(PDF));
  assert.equal(await client.lire('INCONNU'), null);
  await client.detruire(r.id, 'effacement');
  assert.equal(d.detruit, 'effacement');
  await client.detruire(r.id, 'effacement');
  assert.equal(await client.lire(r.id), null);
  await assert.rejects(codexSimule({ panne: true }).client.lire('x'), (e: unknown) => e instanceof C.CodexIndisponible && /ECONNREFUSED/.test((e as Error).message));
  await assert.rejects(codexSimule({ refus: 503 }).client.deposer(PDF, 'application/pdf', 'a.pdf', meta), C.CodexIndisponible);
  await assert.rejects(codexSimule({ refus: 400 }).client.deposer(PDF, 'application/pdf', 'a.pdf', meta), (e: unknown) => e instanceof C.CodexRefus && e.status === 400 && e.code === 'validation');
  const mauvais = new C.ClientCodex({ ...C.configCodex(ENV)!, secret: 'autre-secret-de-signature-0123456789' }, codexSimule().f);
  await assert.rejects(mauvais.lire('x'), (e: unknown) => e instanceof C.CodexRefus && e.status === 401);
});

test('lot 16 versement : pièce jointe versée avec sa catégorie, son matricule et son empreinte, fichier local effacé', async () => {
  const { db, piece, ligne } = await base();
  const { client, docs } = codexSimule();
  const a = await piece({ conserverJusquau: '2036-12-31' });
  const b = await piece({ empId: null, objet: 'dossierOpco' });
  const c = await piece({ objet: 'absence', empId: 15 });
  const enAttente = await db.insert<{ id: number }>('pieces', { jeton: 'j', empId: null, objet: null, objetId: null, nom: 'x.pdf', type: 'application/pdf', taille: 1, fichier: await pieces.depotLocal(db).ecrire(PDF), deposeLe: '2026-10-10T08:00:00Z', deposePar: 'x' });
  const dossier = pieces.dossierPiecesDe(db);
  assert.deepEqual(await V.verserPieces(db, client), { versees: 3, enEchec: 0, restantes: 0 });
  const [la, lb, lc] = [await ligne(a.id), await ligne(b.id), await ligne(c.id)];
  assert.match(la.fichier, /^ged:RHF-RHU-\d{4}$/);
  assert.equal(existsSync(join(dossier, a.fichier)), false, 'copie locale effacée');
  assert.equal((await ligne(enAttente.id)).fichier.startsWith('ged:'), false, 'une pièce en attente n’est jamais versée');
  const ma = docs.get(la.fichier.slice(4))!.meta;
  assert.deepEqual([ma.sourceRef, ma.typeCode, ma.subtype, ma.department, ma.conf, ma.subjectMatricule, ma.expiresAt, ma.sha256],
    [`cursus:piece/${a.id}`, 'RHF', 'Attestation de formation', 'RHU', 'confidentiel', 'EMP-0002', '2036-12-31', pieces.empreinte(PDF)]);
  assert.equal(ma.title, 'Attestation de formation — EMP-0002 — 2026-09', 'titre neutre, sans nom');
  assert.equal(docs.get(lb.fichier.slice(4))!.meta.subjectMatricule, undefined, 'dossier OPCO : aucune personne');
  assert.equal(docs.get(lc.fichier.slice(4))!.meta.conf, 'tres_confidentiel');
  // Relecture par l'adaptateur ; un second passage ne verse rien.
  assert.ok((await new DepotGed(client).lire(la.fichier))!.equals(PDF));
  assert.deepEqual(await V.verserPieces(db, client), { versees: 0, enEchec: 0, restantes: 0 });
  assert.match(V.bilanVersement({ versees: 2, enEchec: 1, restantes: 4 }), /^2 pièces versées dans Codex · 1 pièce non versée · 4 pièces restent à verser$/);
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

test('lot 16 destruction : le nettoyage détruit dans Codex avec le motif codé du retrait, puis vide le nom stocké', async () => {
  const { db, piece, ligne } = await base();
  const simule = codexSimule();
  const ids = [(await piece()).id, (await piece()).id, (await piece()).id];
  await V.verserPieces(db, simule.client);
  const motifs = ['Pièce jointe par erreur', R.MOTIF_CONSERVATION, R.MOTIF_EFFACEMENT];
  for (const [i, id] of ids.entries()) await db.update('pieces', id, { retireeLe: '2026-10-10T09:00:00Z', retireePar: 'Ana Martin', retireeMotif: motifs[i] });
  const docIds = await Promise.all(ids.map(async id => (await ligne(id)).fichier.slice(4) as string));
  const avant = { ...process.env };
  const fetchAvant = globalThis.fetch;
  Object.assign(process.env, ENV);
  globalThis.fetch = simule.f;
  try {
    const b = await pieces.nettoyerPieces(db);
    assert.equal(b.retirees, 3);
  } finally {
    globalThis.fetch = fetchAvant;
    for (const k of Object.keys(ENV)) if (!(k in avant)) delete process.env[k];
  }
  assert.deepEqual(docIds.map(id => simule.docs.get(id)!.detruit), ['retrait', 'conservation', 'effacement']);
  for (const id of ids) assert.equal((await ligne(id)).fichier, null);
});

test('lot 16 réglage « Codex » : refusé sans raccordement, sans registre lisible ou sans catégories ; accepté sinon', async () => {
  const { db } = await base();
  const { client } = codexSimule();
  assert.equal(await V.refusCodex(db, { client: null }), GED_NON_RACCORDEE);
  assert.match((await V.refusCodex(db, { client }))!, /Registre des types de Codex illisible \(codex\.pub_types_document\).*Matrix/, 'SQLite : pas de vue de Codex');
  assert.match((await V.refusCodex(db, { client, types: [{ code: 'RHF', subtypes: [] }] }))!, /Catégories absentes du registre de Codex : RHF › Justificatif d’absence/);
  assert.equal(await V.refusCodex(db, { client, types: REGISTRE }), null);
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
    CREATE OR REPLACE VIEW codex.pub_types_document AS SELECT 'RHF'::text AS code, '[{"fr":"Attestation de formation","en":"x"}]'::jsonb AS subtypes`);
  try {
    const types = await V.lireTypesCodex(db);
    assert.deepEqual(types, [{ code: 'RHF', subtypes: [{ fr: 'Attestation de formation', en: 'x' }] }]);
    assert.match((await V.refusCodex(db, { client: codexSimule().client }))!, /Catégories absentes du registre de Codex : RHF › Justificatif d’absence/);
  } finally {
    await db.exec('DROP VIEW IF EXISTS codex.pub_types_document');
  }
});
