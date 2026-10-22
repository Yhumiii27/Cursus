// Couche d'accès asynchrone (server/src/db.ts, sous-étape 8.a de la bascule vers PostgreSQL) : transactions
// sérialisées malgré les attentes, imbrication, annulation, exclusivité des lectures et des suites d'accès.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db, enSerie, openDb } = await import('../server/src/db.ts');
type Db = InstanceType<typeof Db>;

const pause = (ms = 0) => new Promise(ok => setTimeout(ok, ms));
const lire = async (db: Db, cle = 'compteur') => db.getSetting<number>(cle, 0);

test('transactions simultanées : exécutées l’une après l’autre, aucune écriture perdue, aucun BEGIN imbriqué', async () => {
  const db = new Db(':memory:');
  const rev = db.revision;
  // Lecture, attente (une autre requête aurait la main), puis écriture : sans file, les vingt liraient la même valeur.
  const incrementer = async () => await db.tx(async () => {
    const n = await lire(db);
    await pause();
    await db.setSetting('compteur', n + 1);
    return n;
  });
  const lus = await Promise.all(Array.from({ length: 20 }, incrementer));
  assert.equal(await lire(db), 20);
  assert.deepEqual(lus, Array.from({ length: 20 }, (_, i) => i), 'dans l’ordre d’arrivée');
  assert.ok(db.revision >= rev + 20, 'révision augmentée à chaque transaction validée');
});

test('transaction imbriquée : rejoint la transaction englobante ; une erreur annule tout et libère la file', async () => {
  const db = new Db(':memory:');
  await assert.rejects(db.tx(async () => {
    await db.setSetting('a', 1);
    await db.tx(async () => { await db.setSetting('b', 2); });
    assert.equal(db.sql.isTransaction, true);
    throw new Error('annulée');
  }), /annulée/);
  assert.equal(await lire(db, 'a'), 0);
  assert.equal(await lire(db, 'b'), 0);
  assert.equal(db.sql.isTransaction, false);
  // La file n'est pas bloquée par l'échec : la transaction suivante passe.
  assert.equal(await db.tx(async () => { await db.setSetting('a', 3); return 'ok'; }), 'ok');
  assert.equal(await lire(db, 'a'), 3);
  // Erreur levée sans attente : rejet, rien d'écrit, transaction fermée.
  await assert.rejects(db.tx(() => { throw new Error('immédiate'); }), /immédiate/);
  assert.equal(db.sql.isTransaction, false);
});

test('requêtes hors transaction : jamais exécutées au milieu d’une transaction d’une autre requête', async () => {
  const db = new Db(':memory:');
  let ecrit = false;
  const t = db.tx(async () => {
    await db.setSetting('x', 1);
    await pause(5);
    ecrit = true;
    throw new Error('annulée');
  });
  // Arrivée pendant la transaction : attend sa fin (et ne voit pas sa valeur, annulée), puis s'exécute hors transaction.
  const lu = lire(db, 'x').then(v => ({ v, ecrit, tx: db.sql.isTransaction }));
  const ecriture = db.setSetting('y', 2);
  await assert.rejects(t, /annulée/);
  assert.deepEqual(await lu, { v: 0, ecrit: true, tx: false });
  await ecriture;
  assert.equal(await lire(db, 'y'), 2, 'écriture hors transaction conservée malgré l’annulation de l’autre');
});

test('lecture et exclusif : aucune transaction ne s’intercale ; transaction possible à l’intérieur', async () => {
  const db = new Db(':memory:');
  await db.setSetting('compteur', 0);
  const vu: number[] = [];
  const lecture = db.lecture(async () => {
    vu.push(await lire(db));
    await pause(5);
    vu.push(await lire(db));
  });
  const ecriture = db.tx(async () => { await db.setSetting('compteur', 1); });
  await Promise.all([lecture, ecriture]);
  assert.deepEqual(vu, [0, 0], 'même état d’une lecture à l’autre');
  // Suite exclusive avec une transaction à l'intérieur : le BEGIN est pris dans la portée déjà détenue.
  const r = await db.exclusif(async () => {
    await db.tx(async () => { await db.setSetting('compteur', 5); });
    return lire(db);
  });
  assert.equal(r, 5);
  const route = enSerie(db, async (n: number) => { const v = await lire(db); await pause(); await db.setSetting('compteur', v + n); });
  await Promise.all([route(1), route(2), route(3)]);
  assert.equal(await lire(db), 11, 'trois suites lecture-écriture, aucune perdue');
});

test('portée close : une tâche lancée depuis une transaction et poursuivie après repasse par la file', async () => {
  const db = new Db(':memory:');
  let tache: Promise<number> | null = null;
  await db.tx(async () => {
    await db.setSetting('compteur', 1);
    // Tâche non attendue : elle hérite de la portée, mais s'exécute une fois la transaction validée.
    tache = pause(5).then(() => lire(db));
  });
  const autre = db.tx(async () => { await pause(10); await db.setSetting('compteur', 2); });
  assert.equal(await tache!, 2, 'attend la fin de la transaction en cours, jamais exécutée en son milieu');
  await autre;
  assert.equal(await lire(db), 2);
});

test('SQL brut : query, one, run, exec ; colonnes, remise à zéro, ouverture et fermeture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-db-async-'));
  try {
    const db = await openDb(join(dir, 'cursus.db'));
    assert.equal(db.neuve, true);
    assert.ok(db.emplacement?.endsWith('cursus.db'));
    await db.exec(`INSERT INTO projets (code, nom, statut) VALUES ('P1', 'Projet', 'actif')`);
    const r = await db.run(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif')`, ['P2', 'Autre']);
    assert.equal(r.changes, 1);
    assert.deepEqual((await db.query<{ code: string }>('SELECT code FROM projets ORDER BY code')).map(x => x.code), ['P1', 'P2']);
    assert.equal((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM projets'))!.n, 2);
    assert.equal(await db.one('SELECT 1 FROM projets WHERE code = ?', ['P3']), undefined);
    assert.ok((await db.columns('projets')).includes('code'));
    assert.equal(await db.count('projets'), 2);
    await db.clearAll();
    assert.equal(await db.count('projets'), 0);
    await db.fermer();
    await db.fermer(); // déjà fermée : sans effet
    assert.equal((db as InstanceType<typeof Db>).sql.isOpen, false);
    const encore = new Db(join(dir, 'cursus.db'));
    assert.equal(encore.neuve, false);
    await encore.fermer();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
