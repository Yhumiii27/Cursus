// Intégrité de la base et performances (lot 5, chantier exploitation, étape 2) :
// - t179, étape 1 : références orphelines comptées au démarrage, inscrites au journal des actions et dans les journaux
//   du serveur ; point de santé « degrade » sans détail en public, nombre et références pour la supervision ;
// - t171, version courte : index sur le salarié des tables qui grossissent (migration nommée), sans effet sur une base
//   qui les a déjà.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { INDEX_SALARIES } = await import('../server/src/migrations/exploitation.ts');
const { indexExiste } = await import('../server/src/migrations/outils.ts');
const { controlerIntegrite, controlerOrphelins, etatIntegrite, REFERENCES, VALIDITE_CONTROLE } = await import('../server/src/integrite.ts');
const { etatSante } = await import('../server/src/supervision.ts');
const { createApp } = await import('../server/src/app.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { TABLES, snake } = await import('../server/src/db.ts');

async function base() {
  const db = new Db(':memory:');
  await appliquerMigrations(db);
  await seedDemo(db);
  return db;
}

test('références contrôlées : tables et colonnes du schéma', () => {
  const colonnes = (t: string) => {
    const nom = Object.keys(TABLES).find(n => snake(n) === t);
    assert.ok(nom, `table ${t}`);
    return Object.keys(TABLES[nom as keyof typeof TABLES].cols).map(snake);
  };
  for (const r of REFERENCES) {
    assert.ok(colonnes(r.table).includes(r.colonne), `${r.table}.${r.colonne}`);
    assert.ok(colonnes(r.cible).includes(r.cle), `${r.cible}.${r.cle}`);
  }
  // Toute colonne emp_id du schéma est contrôlée.
  for (const nom of Object.keys(TABLES)) {
    if (colonnes(snake(nom)).includes('emp_id')) assert.ok(REFERENCES.some(r => r.table === snake(nom) && r.colonne === 'emp_id'), `${nom}.empId contrôlé`);
  }
});

test('orphelins : aucun dans la démonstration ; comptés par référence, journal et journaux du serveur', async () => {
  const db = await base();
  assert.deepEqual((await controlerOrphelins(db)).parReference, {});
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  const lignes: string[] = [];
  const retablir = reglerJournaux({ format: 'json', sortie: ligne => { lignes.push(ligne); } });
  try {
    // Base saine : rien d'écrit.
    assert.equal((await controlerIntegrite(db)).orphelins, 0);
    assert.equal(lignes.length, 0);
    assert.equal(await db.count('journal'), 0);
    // Reprise faite hors de Cursus : feuilles d'un salarié absent, titre d'une formation inconnue, équipe disparue.
    await db.exec(`INSERT INTO feuilles (emp_id, week, statut, lignes) VALUES (999, '2026-09-07', 'validee', '[]'), (999, '2026-09-14', 'validee', '[]')`);
    await db.exec(`INSERT INTO certifications (emp_id, f, obtenue) VALUES (1, 'FORMATION-INCONNUE', '2026-01-01')`);
    await db.exec(`UPDATE employes SET equipe = 'Équipe disparue' WHERE id = 2`);
    // Valeurs « aucun » : jamais des orphelins.
    await db.exec(`UPDATE employes SET poste_id = 0 WHERE id = 3`);
    const r = await controlerIntegrite(db);
    assert.equal(r.orphelins, 4);
    assert.deepEqual(r.parReference, {
      'feuilles.emp_id → employes': 2, 'certifications.f → formations': 1, 'employes.equipe → equipes': 1,
    });
    assert.equal(lignes.length, 1);
    const l = JSON.parse(lignes[0]);
    assert.equal(l.niveau, 'avertissement');
    assert.equal(l.orphelins, 4);
    assert.match(l.message, /Intégrité de la base : 4 références orphelines \(feuilles\.emp_id → employes : 2, /);
    const j = (await db.all<{ action: string; actor: string; message: string; payload: Record<string, unknown>; salaries: number[] }>('journal')).at(-1)!;
    assert.equal(j.action, 'integrite.orphelins');
    assert.equal(j.actor, 'Cursus');
    assert.equal(j.message, 'Contrôle d’intégrité au démarrage : 4 références orphelines');
    assert.deepEqual(j.payload, { orphelins: 4, references: r.parReference });
    assert.deepEqual(j.salaries, [], 'aucun salarié désigné');
    assert.ok(JOURNAL_LABEL['integrite.orphelins']);
    assert.equal(familleAction('integrite.orphelins')?.id, 'administration');
  } finally {
    retablir();
  }
});

test('point de santé : « degrade » en public sans aucun nombre, détail pour la supervision, contrôle refait au plus une fois par heure', async () => {
  const db = await base();
  assert.deepEqual(await etatSante(db, false, 'x'), { statut: 'ok', base: 'ok' });
  assert.equal((await etatSante(db, true, 'x')).orphelins, 0);
  await db.exec(`INSERT INTO absences (emp_id, type, du, au, statut) VALUES (777, 'CP', '2026-08-03', '2026-08-07', 'validee')`);
  // Dernier contrôle encore valable : l'orphelin n'apparaît qu'au contrôle suivant.
  assert.equal((await etatSante(db, false, 'x')).statut, 'ok');
  const plusTard = Date.now() + VALIDITE_CONTROLE + 1000;
  assert.equal((await etatIntegrite(db, plusTard)).orphelins, 1);
  assert.deepEqual(await etatSante(db, false, 'x'), { statut: 'degrade', base: 'ok' });
  const detail = await etatSante(db, true, 'x');
  assert.equal(detail.statut, 'degrade');
  assert.equal(detail.orphelins, 1);
  assert.deepEqual(detail.references, { 'absences.emp_id → employes': 1 });

  // Par HTTP : 200 (le service fonctionne) ; appel relayé par le proxy, réponse publique ; appel local, détail.
  const dir = mkdtempSync(join(tmpdir(), 'cursus-integrite-'));
  const retablir = reglerJournaux({ format: 'json', sortie: () => {} });
  const serveur = createApp(db, { dist: join(dir, 'absent'), production: false }).listen(0, '127.0.0.1');
  try {
    await new Promise(ok => serveur.once('listening', ok));
    const port = (serveur.address() as AddressInfo).port;
    const appel = (headers: Record<string, string>) => new Promise<{ status: number; corps: string }>((ok, ko) => {
      request({ host: '127.0.0.1', port, path: '/api/health', headers }, res => {
        let corps = '';
        res.on('data', c => { corps += c; });
        res.on('end', () => ok({ status: res.statusCode!, corps }));
      }).on('error', ko).end();
    });
    const publique = await appel({ 'x-forwarded-for': '203.0.113.7' });
    assert.equal(publique.status, 200, publique.corps);
    assert.deepEqual(JSON.parse(publique.corps), { statut: 'degrade', base: 'ok' });
    assert.doesNotMatch(publique.corps, /orphelin|absences|777/);
    const locale = await appel({});
    assert.equal(locale.status, 200);
    assert.equal(JSON.parse(locale.corps).orphelins, 1);
  } finally {
    serveur.close();
    retablir();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('index sur le salarié : créés par la migration nommée, sans effet sur une base qui les a déjà', async () => {
  const db = new Db(':memory:');
  const avant = MIGRATIONS.slice(0, MIGRATIONS.indexOf(INDEX_SALARIES));
  await appliquerMigrations(db, avant);
  assert.ok(!indexExiste(db, 'absences_emp'));
  // Les migrations nommées plus récentes passent aussi sur cette base neuve.
  assert.ok((await appliquerMigrations(db)).includes(INDEX_SALARIES.nom));
  for (const t of ['absences', 'certifications', 'hab_titres', 'taches', 'missions', 'voyages', 'entretiens', 'notifications']) assert.ok(indexExiste(db, `${t}_emp`), t);
  assert.deepEqual(await appliquerMigrations(db), [], 'une seule fois');
  // Requête par salarié servie par l'index.
  const plan = (await db.query('EXPLAIN QUERY PLAN SELECT * FROM absences WHERE emp_id = ?', [1])) as { detail: string }[];
  assert.ok(plan.some(p => /USING INDEX absences_emp/.test(p.detail)), JSON.stringify(plan));
  // Base qui a déjà les index (créés à la main par le service informatique) : seulement notée faite.
  const deja = new Db(':memory:');
  await appliquerMigrations(deja, avant);
  await INDEX_SALARIES.executer(deja);
  assert.equal(await INDEX_SALARIES.necessaire!(deja), false);
});
