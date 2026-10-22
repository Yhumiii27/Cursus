// Tests de la déclaration du schéma à Matrix (server/src/integrations/matrix.ts) : lecture du schéma réel (toutes les
// tables du schéma déclaratif, tables techniques écartées, clés, unicités, liens), document matrix.schema/1 et son
// empreinte, envoi avec le jeton et l'authentification HTTP portée par l'adresse, écriture dans un dossier, rien
// d'envoyé sans MATRIX_URL, échecs réduits à un avertissement. Matrix est simulé par un serveur node:http local.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { SqliteDb: Db, TABLES, snake } = await import('../server/src/db.ts');
const { nouvelleBase, PG } = await import('./base.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { declarerBase, declarerSchema, documentSchema, introspecterPostgres, introspecterSqlite } = await import('../server/src/integrations/matrix.ts');

const dossier = mkdtempSync(join(tmpdir(), 'cursus-matrix-'));
after(() => rmSync(dossier, { recursive: true, force: true }));

/** Base migrée comme au démarrage : fichier SQLite, ou schéma PostgreSQL (CURSUS_TEST_ENGINE=pg). */
async function base() {
  const db = PG ? await nouvelleBase() : new Db(join(dossier, `base-${Math.random().toString(36).slice(2)}.db`));
  await mettreAJourBase(db);
  return db;
}

interface Recu { headers: IncomingHttpHeaders; url: string; corps: Record<string, unknown> }
/** Faux Matrix : enregistre chaque déclaration reçue et répond `statut`. */
async function fauxMatrix(statut = 200, reponse: unknown = { nouvellesTables: ['employes'] }) {
  const recus: Recu[] = [];
  const srv = createServer((req, res) => {
    let s = '';
    req.on('data', c => { s += c; });
    req.on('end', () => {
      recus.push({ headers: req.headers, url: req.url ?? '', corps: JSON.parse(s) });
      res.writeHead(statut, { 'content-type': 'application/json' }).end(JSON.stringify(reponse));
    });
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as AddressInfo).port;
  return { recus, port, fermer: () => new Promise<void>(r => srv.close(() => r())) };
}

function journal() {
  const info: string[] = [], warn: string[] = [];
  return { info, warn, log: { info: (m: string) => info.push(m), warn: (m: string) => warn.push(m) } };
}

test('le schéma lu reprend toutes les tables du schéma déclaratif, sans les tables techniques', async () => {
  const db = await base();
  const tables = db instanceof Db ? introspecterSqlite(db.sql) : await introspecterPostgres(async q => await db.query(q));
  const noms = tables.map(t => t.name);
  assert.deepEqual(noms, Object.keys(TABLES).map(snake).sort());
  assert.ok(!noms.includes('migrations') && !noms.some(n => n.startsWith('sqlite_')));
  const employes = tables.find(t => t.name === 'employes')!;
  assert.deepEqual(employes.pk, ['id']);
  assert.equal(employes.columns.find(c => c.name === 'id')!.pk, true);
  assert.equal(employes.columns.find(c => c.name === 'id')!.nullable, false);
  const inscriptions = tables.find(t => t.name === 'inscriptions')!;
  assert.deepEqual(inscriptions.uniques, [['emp_id', 'session_id']]);
  if (PG) {
    // Serveur commun : clés étrangères déclarées (server/migrations-pg/0001_init.sql), matricule partagé (D01).
    assert.ok(!noms.includes('schema_migrations'));
    assert.deepEqual(inscriptions.fks.map(f => [f.columns, f.table, f.onDelete]), [[['emp_id'], 'employes', 'restrict'], [['session_id'], 'sessions', 'cascade']]);
    assert.ok(employes.columns.some(c => c.name === 'matricule'));
    assert.deepEqual(employes.uniques, [['matricule']]);
  }
  await db.fermer();
});

test('clés composées, liens déclarés et colonnes sans type', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE parent (a TEXT, b INT, PRIMARY KEY (a, b));
    CREATE TABLE enfant (id INTEGER PRIMARY KEY, a TEXT, b INT, libre DEFAULT 'x', FOREIGN KEY (a, b) REFERENCES parent (a, b) ON DELETE CASCADE);
    CREATE TABLE migrations (nom TEXT PRIMARY KEY)`);
  const tables = introspecterSqlite(sql);
  assert.deepEqual(tables.map(t => t.name), ['enfant', 'parent']);
  const [enfant, parent] = tables;
  assert.deepEqual(parent.pk, ['a', 'b']);
  assert.ok(parent.columns.every(c => !c.pk && !c.nullable));
  assert.deepEqual(enfant.fks, [{ columns: ['a', 'b'], table: 'parent', refColumns: ['a', 'b'], onDelete: 'cascade', declared: true }]);
  assert.deepEqual(enfant.columns.find(c => c.name === 'libre'), { name: 'libre', type: 'ANY', nullable: true, pk: false, default: "'x'" });
  sql.close();
});

test('document matrix.schema/1 : tables triées, empreinte stable', () => {
  const t = (name: string) => ({ name, pk: [], fks: [], uniques: [], columns: [] });
  const a = documentSchema({ app: 'cursus', tables: [t('b'), t('a')] });
  const b = documentSchema({ app: 'cursus', version: '1.0', tables: [t('a'), t('b')] });
  assert.equal(a.schema, 'matrix.schema/1');
  assert.equal(a.version, null);
  assert.deepEqual(a.tables.map(x => x.name), ['a', 'b']);
  assert.equal(a.empreinte, b.empreinte);
  assert.match(a.empreinte, /^[0-9a-f]{16}$/);
  assert.notEqual(documentSchema({ app: 'cursus', tables: [t('c')] }).empreinte, a.empreinte);
});

test('envoi à Matrix : jeton, identifiants de l\'adresse en Basic, nouvelles tables signalées', async () => {
  const m = await fauxMatrix();
  const db = await base();
  const j = journal();
  const doc = await declarerBase(db, '9.9.9', { MATRIX_URL: `http://lecteur:mot%20de%20passe@127.0.0.1:${m.port}`, MATRIX_TOKEN: 'essai' }, j.log);
  await m.fermer();
  assert.equal(m.recus.length, 1);
  const [r] = m.recus;
  assert.equal(r.url, '/api/declarations');
  assert.equal(r.headers['x-matrix-token'], 'essai');
  assert.equal(r.headers.authorization, 'Basic ' + Buffer.from('lecteur:mot de passe').toString('base64'));
  assert.equal(r.corps.app, 'cursus');
  assert.equal(r.corps.version, '9.9.9');
  assert.equal((r.corps.tables as unknown[]).length, Object.keys(TABLES).length);
  assert.equal(r.corps.empreinte, doc!.empreinte);
  assert.deepEqual(j.info, ['[matrix] nouvelles tables déclarées : employes']);
  assert.deepEqual(j.warn, []);
  await db.fermer();
});

test('sans identifiants ni jeton : ni Authorization ni X-Matrix-Token', async () => {
  const m = await fauxMatrix(200, {});
  const j = journal();
  await declarerSchema({ app: 'cursus', tables: [], env: { MATRIX_URL: `http://127.0.0.1:${m.port}/chemin-ignore` }, log: j.log });
  await m.fermer();
  assert.equal(m.recus[0].url, '/api/declarations');
  assert.equal(m.recus[0].headers.authorization, undefined);
  assert.equal(m.recus[0].headers['x-matrix-token'], undefined);
  assert.deepEqual(j.info, []);
});

test('sans MATRIX_URL rien n\'est envoyé ; MATRIX_DECLARATIONS_DIR écrit la déclaration', async () => {
  const db = await base();
  const j = journal();
  assert.equal(await declarerBase(db, null, {}, j.log), null);
  const sortie = join(dossier, 'declarations');
  const doc = await declarerBase(db, null, { MATRIX_DECLARATIONS_DIR: sortie }, j.log);
  assert.deepEqual(JSON.parse(readFileSync(join(sortie, 'cursus.json'), 'utf8')), doc);
  assert.deepEqual([...j.info, ...j.warn], []);
  await db.fermer();
});

test('échecs réduits à un avertissement : refus de Matrix, Matrix injoignable, base illisible', async () => {
  const m = await fauxMatrix(401, { error: 'jeton' });
  const j = journal();
  const doc = await declarerSchema({ app: 'cursus', tables: [], env: { MATRIX_URL: `http://127.0.0.1:${m.port}` }, log: j.log });
  await m.fermer();
  assert.equal(doc.app, 'cursus');
  assert.match(j.warn[0], /^\[matrix\] déclaration du schéma de cursus non transmise : Matrix a répondu 401/);
  await declarerSchema({ app: 'cursus', tables: [], env: { MATRIX_URL: `http://127.0.0.1:${m.port}` }, log: j.log });
  assert.match(j.warn[1], /non transmise/);
  const fermee = new Db(':memory:');
  await fermee.fermer();
  assert.equal(await declarerBase(fermee, null, { MATRIX_URL: 'http://127.0.0.1:9' }, j.log), null);
  assert.match(j.warn[2], /^\[matrix\] schéma de cursus illisible/);
  // Journal par défaut (console) : l'appel ne lève pas non plus.
  await declarerSchema({ app: 'cursus', tables: [], env: { MATRIX_URL: 'pas une adresse' } });
});
