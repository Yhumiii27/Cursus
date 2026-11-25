// Journal des actions en ajout seul (Norma § 4 ; décision du propriétaire du 25 novembre 2026 : « ok pour la purge par
// rôle dédié sur Cursus ») : déclencheurs qui refusent toute modification au rôle de l'application, purge des seules lignes
// échues (12 mois, 36 pour la paie) par la voie dédiée (SQLite : garde de la transaction ; PostgreSQL : rôle cursus_purge
// et fonction purger_journal), registre des purges en ajout seul, purge désactivée ou refusée sans rien supprimer,
// regroupement des actions répétées réuni à la lecture (mêmes résultats qu'avant), configuration contrôlée au démarrage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, envPurge, PG, surServeur, urlDe } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { appliquerConservation, journaliserAction, lireJournal, preparerTrace } = await import('../server/src/journal.ts');
const {
  avertissementsPurge, droitsPurgeSql, inscrireActionsPaie, limitesConservation, messageEchecPg, problemesPurge, purgerJournal, REGLE_PURGE, ROLE_PURGE,
} = await import('../server/src/journal-purge.ts');
const { problemesConfig, avertissementsConfig } = await import('../server/src/config.ts');
const { ACTIONS_PAIE } = await import('../shared/journal.ts');
type Db = import('../server/src/db.ts').Db;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const ilYa = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
const ligne = async (db: Db, at: string, action = 'connexion', paie = false) =>
  (await db.insert<{ id: number }>('journal', { at, actor: 'Cursus', role: null, action, message: null, payload: {}, salaries: [], paie })).id;
const ids = async (db: Db) => (await db.query<{ id: number }>('SELECT id FROM journal ORDER BY id')).map(r => Number(r.id));
const REFUS = /ajout seul/;

test('déclencheurs : UPDATE, DELETE (et TRUNCATE sur PostgreSQL) refusés au rôle de l’application, même d’une ligne échue', async () => {
  const db = await nouvelleBase();
  const jeune = await ligne(db, ilYa(1)), vieille = await ligne(db, ilYa(2000));
  await assert.rejects(db.run('UPDATE journal SET message = ? WHERE id = ?', ['modifié', jeune]), REFUS);
  await assert.rejects(db.update('journal', jeune, { message: 'modifié' }), REFUS);
  await assert.rejects(db.run('DELETE FROM journal WHERE id = ?', [vieille]), REFUS, 'ligne échue : seule la purge la supprime');
  await assert.rejects(db.run('DELETE FROM journal'), REFUS);
  if (PG) await assert.rejects(db.exec('TRUNCATE journal'), REFUS);
  // Registre des purges et codes de la paie : en ajout seul eux aussi.
  await inscrireActionsPaie(db);
  await assert.rejects(db.run('DELETE FROM journal_actions_paie WHERE action = ?', ['temps.validate']), REFUS);
  await assert.rejects(db.run('UPDATE journal_actions_paie SET depuis = depuis'), REFUS);
  const r = await purgerJournal(db, await envPurge(db));
  assert.equal(r.statut, 'faite');
  await assert.rejects(db.run('UPDATE journal_purges SET supprimees_un_an = 0'), REFUS);
  await assert.rejects(db.run('DELETE FROM journal_purges'), REFUS);
  if (PG) await assert.rejects(db.exec('TRUNCATE journal_purges'), REFUS);
  assert.deepEqual(await ids(db), [jeune], 'seule la purge a supprimé la ligne échue');
});

test('purge : lignes échues seules (12 mois ; 36 pour la paie, codes inscrits compris), registre sans contenu', async () => {
  const db = await nouvelleBase();
  await inscrireActionsPaie(db);
  const garde = [
    await ligne(db, ilYa(5)),
    await ligne(db, ilYa(330)),
    await ligne(db, ilYa(400), 'temps.validate', true),
    // Action devenue « liée à la paie » après l'écriture de la ligne (paie faux) : gardée 3 ans par son code inscrit.
    await ligne(db, ilYa(500), 'conges.cloturer', false),
    await ligne(db, ilYa(700), 'sage.fichier', false),
  ];
  const parties = [await ligne(db, ilYa(380)), await ligne(db, ilYa(800), 'employe.modifier'), await ligne(db, ilYa(1150), 'temps.validate', true), await ligne(db, ilYa(1500), 'sage.fichier')];
  const r = await purgerJournal(db, await envPurge(db));
  assert.deepEqual([r.statut, r.supprimees, r.supprimeesArchive], ['faite', 2, 2]);
  assert.deepEqual(await ids(db), garde);
  const reg = (await db.query<Record<string, unknown>>('SELECT * FROM journal_purges ORDER BY id'));
  assert.equal(reg.length, 1);
  const lim = limitesConservation();
  const iso = (v: unknown) => new Date(v instanceof Date ? v : String(v)).toISOString();
  assert.deepEqual([Number(reg[0].id), reg[0].regle, iso(reg[0].limite_journal), iso(reg[0].limite_paie), Number(reg[0].supprimees_un_an), Number(reg[0].supprimees_trois_ans)],
    [r.registre, REGLE_PURGE, lim.journal, lim.paie, 2, 2]);
  assert.equal(reg[0].par, PG ? ROLE_PURGE : 'cursus (SQLite)');
  assert.ok(iso(reg[0].plus_ancienne) < iso(reg[0].plus_recente) && iso(reg[0].plus_recente) < lim.journal);
  assert.deepEqual(Object.keys(reg[0]).sort(), ['id', 'le', 'limite_journal', 'limite_paie', 'par', 'plus_ancienne', 'plus_recente', 'regle', 'supprimees_trois_ans', 'supprimees_un_an'],
    'ni action, ni auteur, ni contenu');
  void parties;
  // Second passage : rien à supprimer, passage inscrit quand même.
  const r2 = await purgerJournal(db, await envPurge(db));
  assert.deepEqual([r2.statut, r2.supprimees, r2.supprimeesArchive, Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM journal_purges'))!.n)], ['faite', 0, 0, 2]);
});

test('SQLite : la garde de la purge ne permet de supprimer que les lignes échues', { skip: PG && 'propre au fichier SQLite' }, async () => {
  const db = await nouvelleBase();
  const jeune = await ligne(db, ilYa(30)), vieille = await ligne(db, ilYa(400));
  await assert.rejects(db.tx(async () => {
    await db.run('INSERT INTO journal_purge_en_cours (cle) VALUES (1)');
    await db.run('DELETE FROM journal WHERE id = ?', [jeune]);
  }), REFUS, 'même sous la garde, une ligne à conserver reste');
  await db.tx(async () => {
    await db.run('INSERT INTO journal_purge_en_cours (cle) VALUES (1)');
    await db.run('DELETE FROM journal WHERE id = ?', [vieille]);
    await db.run('DELETE FROM journal_purge_en_cours');
  });
  assert.deepEqual(await ids(db), [jeune]);
});

test('PostgreSQL : seul cursus_purge, pendant purger_journal(), supprime ; rôle de l’application refusé ; droits absents : échec sans rien supprimer', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const db = await nouvelleBase();
  const schema = (db as unknown as { schema: string }).schema;
  const jeune = await ligne(db, ilYa(30)), vieille = await ligne(db, ilYa(400));
  // Le rôle de l'application (ici le superutilisateur du serveur de test) n'appelle pas la fonction.
  await assert.rejects(db.query('SELECT * FROM purger_journal()'), /réservée au rôle cursus_purge/);
  // Sans les droits du socle de Matrix sur ce schéma : refus motivé, rien supprimé.
  const env = await envPurge(await nouvelleBase());
  const autre = (await nouvelleBase()) as unknown as Db & { schema: string };
  await ligne(autre, ilYa(400));
  const sansDroits = await purgerJournal(autre, env);
  assert.equal(sansDroits.statut, 'echec');
  assert.match(sansDroits.message!, /droits du rôle cursus_purge incomplets|purger_journal/);
  assert.equal((await ids(autre)).length, 1);
  // Connexion de cursus_purge, hors de la fonction : la règle du déclencheur tient (garde et échéance).
  const envDb = await envPurge(db);
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: envDb.CURSUS_PURGE_DATABASE_URL, options: `-c search_path=${schema}` });
  await c.connect();
  try {
    await assert.rejects(c.query('DELETE FROM journal WHERE id = $1', [vieille]), REFUS, 'hors de purger_journal()');
    await c.query('BEGIN');
    await c.query(`SELECT set_config('cursus.purge_journal', 'on', true)`);
    await assert.rejects(c.query('DELETE FROM journal WHERE id = $1', [jeune]), REFUS, 'ligne à conserver');
    await c.query('ROLLBACK');
    await assert.rejects(c.query('UPDATE journal SET action = action WHERE id = $1', [jeune]), /permission denied|ajout seul/);
    await assert.rejects(c.query('SELECT payload FROM journal'), /permission denied/, 'jamais le contenu');
  } finally {
    await c.end();
  }
  assert.deepEqual(await ids(db), [jeune, vieille]);
  const r = await purgerJournal(db, envDb);
  assert.deepEqual([r.statut, r.supprimees, await ids(db)], ['faite', 1, [jeune]]);
  // Démarrage refusé si un déclencheur est désactivé (le propriétaire des tables le pourrait).
  await db.exec('ALTER TABLE journal DISABLE TRIGGER journal_ajout_seul');
  const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
  const url = envDb.DATABASE_URL;
  await assert.rejects(ouvrirPostgres(url, { schema }), /journal_ajout_seul \(journal en ajout seul\)/);
  await db.exec('ALTER TABLE journal ENABLE TRIGGER journal_ajout_seul');
  void surServeur; void urlDe;
});

test('PostgreSQL sans CURSUS_PURGE_DATABASE_URL : purge désactivée, rien supprimé, lignes échues masquées', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const db = await nouvelleBase();
  const vieille = await ligne(db, ilYa(400)), jeune = await ligne(db, ilYa(3));
  const b = await appliquerConservation(db, new Date(), { env: {} });
  assert.equal(b.purge, 'desactivee');
  assert.match(b.message!, /CURSUS_PURGE_DATABASE_URL est absente/);
  assert.deepEqual(await ids(db), [vieille, jeune]);
  assert.deepEqual((await lireJournal(db, { vue: 'tout', du: null, au: null, auteur: null, action: null, salarie: null })).lignes.map(l => l.id), [jeune]);
});

test('messages d’échec de la purge : rôle, migration, droits', () => {
  assert.match(messageEchecPg({ code: '28P01' }), /connexion refusée au rôle cursus_purge/);
  assert.match(messageEchecPg({ code: '42883' }), /migration 0035_journal_ajout_seul/);
  assert.match(messageEchecPg({ code: '42501', message: 'permission denied for table journal' }), /droits du rôle cursus_purge incomplets.*permission denied/);
  assert.match(messageEchecPg({ code: 'P0C02', message: 'réservée' }), /réservée/);
  assert.equal(messageEchecPg(new Error('autre')), 'autre');
});

test('configuration : CURSUS_PURGE_DATABASE_URL contrôlée, absence signalée sur le serveur PostgreSQL', () => {
  const pgUrl = 'postgres://cursus_app:x@hote:5432/epc2i';
  assert.deepEqual(problemesPurge({}), []);
  assert.deepEqual(problemesPurge({ DATABASE_URL: pgUrl, CURSUS_PURGE_DATABASE_URL: 'postgres://cursus_purge:y@hote:5432/epc2i' }), []);
  assert.match(problemesPurge({ DATABASE_URL: pgUrl, CURSUS_PURGE_DATABASE_URL: 'pas une adresse' })[0], /n’est pas une adresse PostgreSQL/);
  assert.match(problemesPurge({ CURSUS_PURGE_DATABASE_URL: 'postgres://cursus_purge:y@hote/epc2i' })[0], /sans DATABASE_URL/);
  assert.match(problemesPurge({ DATABASE_URL: pgUrl, CURSUS_PURGE_DATABASE_URL: pgUrl })[0], /rôle « cursus_app »/);
  assert.match(problemesPurge({ DATABASE_URL: pgUrl, CURSUS_PURGE_DATABASE_URL: 'postgres://h:5432/epc2i?user=cursus_purge' }).join(''), /^$/);
  assert.deepEqual(avertissementsPurge({}), []);
  assert.match(avertissementsPurge({ DATABASE_URL: pgUrl })[0], /purge du journal des actions .* est désactivée/);
  assert.ok(problemesConfig({ DATABASE_URL: pgUrl, CURSUS_PURGE_DATABASE_URL: pgUrl }).some(p => /cursus_purge/.test(p)), 'contrôlé au démarrage');
  assert.ok(avertissementsConfig({ DATABASE_URL: pgUrl }).some(p => /CURSUS_PURGE_DATABASE_URL est absente/.test(p)));
});

test('droits du rôle de purge : ceux que le socle de Matrix accorde, rien d’autre', async () => {
  const sql = droitsPurgeSql('cursus', 'epc2i');
  assert.deepEqual(sql.split(';\n').map(l => l.replace(/;$/, '')), [
    'GRANT CONNECT ON DATABASE "epc2i" TO cursus_purge',
    'GRANT USAGE ON SCHEMA "cursus" TO cursus_purge',
    'GRANT SELECT (id, at, action, paie), DELETE ON "cursus".journal TO cursus_purge',
    'GRANT SELECT ON "cursus".journal_actions_paie TO cursus_purge',
    'GRANT INSERT, SELECT (id) ON "cursus".journal_purges TO cursus_purge',
    'GRANT EXECUTE ON FUNCTION "cursus".purger_journal() TO cursus_purge',
  ]);
  // La demande à Matrix (rejouée par l'intégration continue sur le socle d'essai) porte exactement ces droits.
  const { readFileSync } = await import('node:fs');
  const demande = readFileSync(new URL('../docs/demandes/matrix-lot16-purge-journal.sql', import.meta.url), 'utf8');
  for (const l of sql.split(';\n')) assert.ok(demande.includes(l.replace(/;$/, '').replace(/"cursus"/g, 'cursus').replace('"epc2i"', 'epc2i')), l);
});

test('codes des actions de paie : tous inscrits, jamais retirés', async () => {
  const db = await nouvelleBase();
  assert.equal(await inscrireActionsPaie(db), ACTIONS_PAIE.length);
  assert.deepEqual((await db.query<{ action: string }>('SELECT action FROM journal_actions_paie ORDER BY action')).map(r => r.action), [...ACTIONS_PAIE].sort());
});

test('regroupement réuni à la lecture : avancement d’un objectif, mêmes lignes qu’avant le journal en ajout seul', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compte = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id;
  const u = (await currentUser(db, { compteId: compte, role: 'collaborateur', methode: 'demo' })) as User;
  const run = async (name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', compte))!, message: (o as { message?: string }).message ?? null, result: (o as { result?: unknown }).result });
  });
  const entretien = (await db.one<{ id: number }>('SELECT id FROM entretiens WHERE emp_id = 2 ORDER BY id LIMIT 1'))!.id;
  const obj = await db.insert<{ id: number }>('objectifs', { empId: 2, entretienId: entretien, libelle: 'Réduire les arrêts de la presse 3', categorie: 'individuel', poids: 30, avancement: 0, statut: 'ouvert' });
  await run('objectif.avancer', { id: obj.id, avancement: 20 });
  await run('objectif.avancer', { id: obj.id, avancement: 35, commentaire: 'Point fait avec mon manager' });
  await run('objectif.avancer', { id: obj.id, avancement: 50 });
  const vus = (await lireJournal(db, { vue: 'tout', du: null, au: null, auteur: null, action: 'objectif.avancer', salarie: null })).lignes;
  // Ce que donnait la ligne fusionnée : une seule ligne, dernières valeurs, commentaire seulement « renseigné ».
  assert.equal(vus.length, 1);
  assert.equal(vus[0].details.id, obj.id);
  assert.equal((vus[0].details.apres as { avancement: number }).avancement, 50);
  assert.equal(vus[0].details.commentaire, '[texte renseigné]');
  assert.equal((await db.query('SELECT id FROM journal WHERE action = ?', ['objectif.avancer'])).length, 3, 'trois lignes ajoutées');
});
