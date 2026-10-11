// Tests de la sauvegarde : copie à chaud, rotation, restauration, verrou du serveur,
// sauvegardes automatiques avant migration et avant réinitialisation de la démo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-07';
process.env.CURSUS_DEMO = '1';
delete process.env.CURSUS_BACKUP_DIR; // copies à côté de chaque base de test
delete process.env.CURSUS_BACKUP_KEEP;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { dossierSauvegardes, fichierVerrou, listerSauvegardes, restaurer, sauvegarder, sauvegarderBase, serveurActif } = await import('../server/src/sauvegarde.ts');
type Db = InstanceType<typeof Db>;
type User = Parameters<typeof loadFull>[1];
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Responsable RH' };
const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Dossier temporaire avec une base de démonstration ; supprimé après `fn`. */
async function avecBase(fn: (ctx: { dir: string; file: string; backups: string; db: Db }) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-sauvegarde-'));
  const file = join(dir, 'cursus.db');
  const db = new Db(file);
  seedDemo(db);
  try {
    await fn({ dir, file, backups: join(dir, 'backups'), db });
  } finally {
    try { db.sql.close(); } catch { /* déjà fermée */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Lecture directe d'une base (copie ou base restaurée). */
function lire<T>(file: string, sql: string): T {
  const d = new DatabaseSync(file, { readOnly: true });
  try { return d.prepare(sql).get() as T; } finally { d.close(); }
}
const nomEmp1 = (file: string) => lire<{ nom: string }>(file, 'SELECT nom FROM employes WHERE id = 1').nom;
const jour = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 2, 15));

test('sauvegarde : copie vérifiée qui contient les données, y compris celles encore dans le journal WAL', () => avecBase(({ file, backups, db }) => {
  db.update('employes', 1, { nom: 'Nom modifié' }); // base ouverte : la modification est dans le -wal
  assert.ok(statSync(file + '-wal').size > 0);
  const s = sauvegarder(file);
  assert.ok(s.fichier.startsWith(backups), 'dossier par défaut : backups/ à côté de la base');
  assert.match(s.fichier, /cursus-\d{4}-\d{2}-\d{2}T\d{6}Z\.db$/);
  assert.equal(s.employes, 24);
  assert.equal(nomEmp1(s.fichier), 'Nom modifié');
  assert.equal(lire<{ integrity_check: string }>(s.fichier, 'PRAGMA integrity_check').integrity_check, 'ok');
  assert.ok(!existsSync(s.fichier + '-wal'), 'copie autonome, sans journal');
  if (process.platform !== 'win32') assert.equal(statSync(s.fichier).mode & 0o777, 0o600, 'lecture réservée au compte du service');
  assert.throws(() => sauvegarder(join(backups, 'absente.db')), /Base introuvable/);
  assert.ok(!existsSync(join(backups, 'absente.db')), 'aucune base vide créée');
}));

test('rotation : seules les N copies les plus récentes de chaque type sont conservées', () => avecBase(({ file, backups }) => {
  const reinit = sauvegarder(file, { motif: 'avant-reinitialisation', date: jour(0), keep: 3 });
  writeFileSync(join(backups, 'notes.txt'), 'fichier de l’exploitant');
  writeFileSync(join(backups, 'autre-2026-09-01T021500Z.db'), 'copie d’une autre base');
  const faites = [1, 2, 3, 4, 5].map(n => sauvegarder(file, { date: jour(n), keep: 3 }));
  assert.equal(faites[4].supprimees.length, 1);
  assert.equal(faites[4].conservees, 3);
  const restantes = listerSauvegardes(backups).filter(c => c.base === 'cursus' && !c.motif).map(c => c.fichier);
  assert.deepEqual(restantes, [faites[4].fichier, faites[3].fichier, faites[2].fichier], 'les plus récentes, de la plus récente à la plus ancienne');
  assert.ok(existsSync(reinit.fichier), 'les copies d’un autre motif ont leur propre rotation');
  assert.ok(existsSync(join(backups, 'notes.txt')) && existsSync(join(backups, 'autre-2026-09-01T021500Z.db')), 'les autres fichiers ne sont pas touchés');
  // Horloge revenue en arrière : la copie qui vient d'être faite n'est jamais supprimée.
  const recul = sauvegarder(file, { date: jour(-10), keep: 3 });
  assert.ok(existsSync(recul.fichier));
  assert.equal(listerSauvegardes(backups).filter(c => c.base === 'cursus' && !c.motif).length, 3);
  // Deux copies dans la même seconde : noms distincts.
  const a = sauvegarder(file, { date: jour(9), keep: 0 }), b = sauvegarder(file, { date: jour(9), keep: 0 });
  assert.notEqual(a.fichier, b.fichier);
}));

test('restauration : la base retrouve l’état sauvegardé, l’état remplacé est conservé', () => avecBase(({ file, backups, db }) => {
  const copie = sauvegarder(file);
  db.update('employes', 1, { nom: 'Après la sauvegarde' });
  db.remove('employes', 24);
  db.sql.close();
  // Journaux d'une ancienne session : ils ne doivent pas être rejoués sur la base restaurée.
  writeFileSync(file + '-wal', 'ancien journal');
  writeFileSync(file + '-shm', 'ancien index');
  const r = restaurer(copie.fichier, file);
  assert.equal(r.verification.employes, 24);
  assert.ok(!existsSync(file + '-wal') && !existsSync(file + '-shm'), 'fichiers -wal et -shm supprimés');
  assert.ok(r.avant && r.avant.startsWith(backups) && r.avant.endsWith('-avant-restauration.db'));
  assert.equal(nomEmp1(r.avant), 'Après la sauvegarde', 'la base remplacée est sauvegardée d’abord');
  const db2 = new Db(file);
  try {
    assert.equal(db2.get<{ nom: string }>('employes', 1)!.nom, nomEmp1(copie.fichier));
    assert.equal(db2.count('employes'), 24);
    assert.equal(db2.count('journal'), lire<{ n: number }>(copie.fichier, 'SELECT COUNT(*) AS n FROM journal').n);
  } finally {
    db2.sql.close();
  }
  assert.ok(!listerSauvegardes(backups).some(c => c.motif === 'avant-migration'), 'base restaurée à jour : pas de migration');
}));

test('restauration refusée si le fichier n’est pas une base Cursus valide', () => avecBase(({ dir, file, backups, db }) => {
  db.update('employes', 1, { nom: 'Base en place' });
  const texte = join(dir, 'texte.db'), vide = join(dir, 'vide.db'), autre = join(dir, 'autre.db');
  writeFileSync(texte, 'ceci n’est pas une base de données');
  writeFileSync(vide, '');
  const o = new DatabaseSync(autre);
  o.exec('CREATE TABLE clients (id INTEGER PRIMARY KEY, nom TEXT)');
  o.close();
  assert.throws(() => restaurer(texte, file), /n’est pas une base SQLite valide/);
  assert.throws(() => restaurer(vide, file), /n’est pas une base Cursus/);
  assert.throws(() => restaurer(autre, file), /n’est pas une base Cursus/);
  assert.throws(() => restaurer(join(dir, 'absente.db'), file), /introuvable/);
  assert.throws(() => restaurer(file, file), /la base elle-même/);
  assert.equal(nomEmp1(file), 'Base en place', 'base actuelle intacte');
  assert.equal(listerSauvegardes(backups).length, 0, 'aucune copie « avant-restauration » inutile');
}));

test('restauration sur une base actuelle illisible : refusée, puis avec --force après copie brute de ses fichiers', () => avecBase(({ dir, file, backups, db }) => {
  const copie = sauvegarder(file);
  db.sql.close();
  // Vrai journal -wal, pris sur une autre base ouverte : rejoué, il écraserait des pages de la base restaurée.
  const autre = new DatabaseSync(join(dir, 'autre.db'));
  autre.exec(`PRAGMA journal_mode = WAL; CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('a'), ('b');
    PRAGMA wal_checkpoint(TRUNCATE); UPDATE t SET x = 'journal à ne pas rejouer'`);
  const wal = join(dir, 'ancien-wal'), shm = join(dir, 'ancien-shm');
  copyFileSync(join(dir, 'autre.db-wal'), wal);
  copyFileSync(join(dir, 'autre.db-shm'), shm);
  autre.close();
  writeFileSync(file, 'base endommagée');
  copyFileSync(wal, file + '-wal');
  copyFileSync(shm, file + '-shm');
  assert.throws(() => restaurer(copie.fichier, file), /n’a pas pu être sauvegardée/);
  assert.equal(readFileSync(file, 'utf8'), 'base endommagée', 'rien n’est remplacé sans --force');
  assert.deepEqual(readFileSync(file + '-wal'), readFileSync(wal), 'journal non reporté dans la base endommagée');
  assert.ok(!existsSync(file + '.restauration'), 'fichier provisoire retiré');
  const r = restaurer(copie.fichier, file, { force: true });
  assert.equal(r.avant, null);
  assert.ok(r.brut && r.brut.startsWith(backups));
  assert.equal(readFileSync(join(r.brut, 'cursus.db'), 'utf8'), 'base endommagée', 'fichiers d’origine conservés tels quels');
  assert.deepEqual(readFileSync(join(r.brut, 'cursus.db-wal')), readFileSync(wal));
  assert.ok(!existsSync(file + '-wal') && !existsSync(file + '-shm'), 'journaux de l’ancienne base supprimés');
  assert.equal(nomEmp1(file), nomEmp1(copie.fichier), 'ancien journal non rejoué');
  assert.equal(lire<{ integrity_check: string }>(file, 'PRAGMA integrity_check').integrity_check, 'ok');
}));

test('restauration refusée tant que le serveur utilise la base, sauf --force ; verrou périmé ignoré', () => avecBase(({ file, db }) => {
  const copie = sauvegarder(file);
  db.sql.close();
  const verrou = fichierVerrou(file);
  writeFileSync(verrou, JSON.stringify({ pid: process.pid, depuis: new Date().toISOString() }));
  assert.equal(serveurActif(file)?.pid, process.pid);
  assert.throws(() => restaurer(copie.fichier, file), /serveur Cursus semble démarré/);
  assert.equal(restaurer(copie.fichier, file, { force: true }).serveur?.pid, process.pid);
  // Processus terminé (arrêt brutal) ou verrou antérieur au démarrage de la machine : périmé.
  const fini = spawnSync(process.execPath, ['-e', '']).pid!;
  writeFileSync(verrou, JSON.stringify({ pid: fini, depuis: new Date().toISOString() }));
  assert.equal(serveurActif(file), null);
  writeFileSync(verrou, JSON.stringify({ pid: process.pid, depuis: '2000-01-01T00:00:00.000Z' }));
  assert.equal(serveurActif(file), null);
  assert.ok(restaurer(copie.fichier, file).avant);
}));

test('verrou sous Linux : identifiant de démarrage et instant de lancement, indépendants de l’horloge', { skip: !existsSync('/proc/sys/kernel/random/boot_id') }, () => avecBase(({ file }) => {
  const verrou = fichierVerrou(file);
  const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const poser = (v: object) => writeFileSync(verrou, JSON.stringify({ pid: process.pid, ...v }));
  // Horloge corrigée après le démarrage du serveur (NTP) : le verrou reste valable.
  poser({ depuis: '2000-01-01T00:00:00.000Z', boot });
  assert.equal(serveurActif(file)?.pid, process.pid);
  poser({ depuis: new Date().toISOString(), boot: '00000000-0000-0000-0000-000000000000' });
  assert.equal(serveurActif(file), null, 'machine redémarrée depuis');
  poser({ depuis: new Date().toISOString(), boot, lancement: '1' });
  assert.equal(serveurActif(file), null, 'numéro de processus réattribué');
}));

test('sauvegarde automatique avant la réinitialisation de la démo', () => avecBase(({ file, backups, db }) => {
  db.update('employes', 1, { nom: 'Saisie avant réinitialisation' });
  const msg = db.tx(() => ACTIONS['demo.reinitialiser'](makeCtx(db, RH, loadFull(db, RH)), {}));
  assert.match(String(msg), /sauvegarde cursus-.*-avant-reinitialisation\.db/);
  const copies = listerSauvegardes(backups).filter(c => c.motif === 'avant-reinitialisation');
  assert.equal(copies.length, 1);
  assert.equal(nomEmp1(copies[0].fichier), 'Saisie avant réinitialisation', 'état d’avant la réinitialisation');
  assert.notEqual(db.get<{ nom: string }>('employes', 1)!.nom, 'Saisie avant réinitialisation', 'données de démo rechargées');
  assert.equal(nomEmp1(file), db.get<{ nom: string }>('employes', 1)!.nom);
}));

test('réinitialisation de la démo annulée si la sauvegarde préalable échoue', t => avecBase(({ dir, file, backups, db }) => {
  t.mock.method(console, 'error', () => {}); // l'action journalise l'erreur d'origine
  db.update('employes', 1, { nom: 'Saisie à conserver' });
  writeFileSync(join(dir, 'fichier'), '');
  process.env.CURSUS_BACKUP_DIR = join(dir, 'fichier', 'backups'); // sous un fichier : dossier impossible à créer
  try {
    assert.throws(() => db.tx(() => ACTIONS['demo.reinitialiser'](makeCtx(db, RH, loadFull(db, RH)), {})),
      (e: unknown) => e instanceof ActionError && e.status === 500 && /réinitialisation annulée/.test(e.message));
  } finally {
    delete process.env.CURSUS_BACKUP_DIR;
  }
  assert.equal(nomEmp1(file), 'Saisie à conserver', 'rien n’est effacé sans copie');
  assert.equal(db.count('employes'), 24);
  assert.ok(!existsSync(backups));
}));

test('npm run reset-demo : copie d’une base existante, aucune pour une base neuve, rien d’effacé si la copie échoue', () => avecBase(({ dir, file, backups, db }) => {
  db.update('employes', 1, { nom: 'Saisie avant reset' });
  db.sql.close();
  const reset = (env: Record<string, string>) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/reset.ts'],
    { cwd: RACINE, encoding: 'utf8', env: { ...process.env, ...env } });
  writeFileSync(join(dir, 'fichier'), '');
  const echec = reset({ CURSUS_DB: file, CURSUS_BACKUP_DIR: join(dir, 'fichier', 'backups') });
  assert.equal(echec.status, 1);
  assert.match(echec.stderr, /Sauvegarde préalable impossible : réinitialisation annulée/);
  assert.equal(nomEmp1(file), 'Saisie avant reset', 'base intacte');

  const ok = reset({ CURSUS_DB: file });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Base actuelle sauvegardée : .*-avant-reinitialisation\.db/);
  const copies = listerSauvegardes(backups).filter(c => c.motif === 'avant-reinitialisation');
  assert.equal(copies.length, 1);
  assert.equal(nomEmp1(copies[0].fichier), 'Saisie avant reset');
  assert.notEqual(nomEmp1(file), 'Saisie avant reset', 'données de démo rechargées');

  const neuve = join(dir, 'neuve', 'cursus.db');
  const n = reset({ CURSUS_DB: neuve });
  assert.equal(n.status, 0, n.stderr);
  assert.doesNotMatch(n.stdout, /sauvegardée/);
  assert.equal(listerSauvegardes(join(dir, 'neuve', 'backups')).length, 0, 'base neuve : rien à sauvegarder');
  assert.equal(lire<{ n: number }>(neuve, 'SELECT COUNT(*) AS n FROM employes').n, 24);
}));

test('base derrière un lien symbolique : la cible est restaurée, le lien conservé, toutes les copies au même endroit', { skip: process.platform === 'win32' }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cursus-lien-')));
  const reelle = join(dir, 'vol', 'cursus.db'), lien = join(dir, 'lib', 'cursus.db');
  mkdirSync(join(dir, 'lib'));
  const db = new Db(reelle);
  try {
    seedDemo(db);
    symlinkSync(reelle, lien);
    const manuelle = sauvegarder(lien); // npm run backup avec CURSUS_DB=lib/cursus.db
    const auto = sauvegarderBase(db, 'avant-reinitialisation')!; // copie automatique : chemin résolu par SQLite
    assert.equal(dirname(manuelle.fichier), join(dir, 'vol', 'backups'));
    assert.equal(dirname(auto.fichier), dirname(manuelle.fichier));
    assert.equal(dossierSauvegardes(lien), dirname(manuelle.fichier), 'copies listées par npm run restore');
    assert.equal(listerSauvegardes(dirname(manuelle.fichier)).filter(c => c.base === 'cursus').length, 2);
    db.update('employes', 1, { nom: 'Après la copie' });
    db.sql.close();
    const r = restaurer(manuelle.fichier, lien);
    assert.ok(lstatSync(lien).isSymbolicLink(), 'lien conservé');
    assert.equal(nomEmp1(reelle), nomEmp1(manuelle.fichier), 'cible du lien restaurée');
    assert.equal(nomEmp1(r.avant!), 'Après la copie');
    assert.equal(dirname(r.avant!), dirname(manuelle.fichier));
  } finally {
    try { db.sql.close(); } catch { /* déjà fermée */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copie provisoire d’une sauvegarde interrompue : supprimée après une heure', () => avecBase(({ file, backups }) => {
  const premiere = sauvegarder(file);
  const nom = (n: string) => join(backups, n);
  for (const n of ['cursus-2026-10-01T021500Z.db.partiel', 'cursus-2026-10-02T021500Z.db.partiel', 'autre-2026-10-01T021500Z.db.partiel']) writeFileSync(nom(n), 'copie interrompue');
  const vieux = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(nom('cursus-2026-10-01T021500Z.db.partiel'), vieux, vieux);
  utimesSync(nom('autre-2026-10-01T021500Z.db.partiel'), vieux, vieux);
  const s = sauvegarder(file);
  assert.deepEqual(s.supprimees, [nom('cursus-2026-10-01T021500Z.db.partiel')]);
  assert.ok(existsSync(nom('cursus-2026-10-02T021500Z.db.partiel')), 'copie peut-être en cours : conservée');
  assert.ok(existsSync(nom('autre-2026-10-01T021500Z.db.partiel')), 'autre base : non touchée');
  assert.ok(existsSync(premiere.fichier));
}));

test('sauvegarde automatique avant une migration qui modifie la base, et seulement dans ce cas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-migration-'));
  const backups = join(dir, 'backups');
  const avantMigration = () => listerSauvegardes(backups).filter(c => c.motif === 'avant-migration');
  try {
    // Base neuve : rien à sauvegarder.
    const neuve = new Db(join(dir, 'neuve.db'));
    migrate(neuve);
    neuve.sql.close();
    assert.equal(avantMigration().length, 0);

    // Ancien schéma (colonne « contrat ») : une seule copie pour le schéma et la conversion des données.
    const file = join(dir, 'ancienne.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE employes (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT, equipe TEXT, poste TEXT, contrat TEXT, jour_off TEXT, entree TEXT, naissance INTEGER)`);
    old.exec(`CREATE TABLE journal (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, role TEXT, action TEXT, message TEXT, payload TEXT)`);
    old.exec(`INSERT INTO employes (nom, equipe, poste, contrat, jour_off, entree, naissance) VALUES ('A', 'Production', 'Opérateur', '39h', '[]', '2020-01-01', 1990)`);
    old.close();
    const db = new Db(file);
    migrate(db);
    db.sql.close();
    const copies = avantMigration();
    assert.equal(copies.length, 1);
    const copieDb = new DatabaseSync(copies[0].fichier, { readOnly: true });
    const cols = (copieDb.prepare('PRAGMA table_info(employes)').all() as { name: string }[]).map(c => c.name);
    copieDb.close();
    assert.ok(cols.includes('contrat') && !cols.includes('temps'), 'copie de la base telle qu’avant la migration');

    // Base à jour : aucune nouvelle copie.
    const db2 = new Db(file);
    migrate(db2);
    db2.sql.close();
    assert.equal(avantMigration().length, 1);

    // Migration des données seule (feuilles à figer) : copie aussi.
    const db3 = new Db(join(dir, 'feuilles.db'));
    seedDemo(db3);
    db3.sql.exec(`UPDATE feuilles SET contrat = NULL WHERE statut = 'validee'`);
    db3.sql.close();
    const db4 = new Db(join(dir, 'feuilles.db'));
    assert.equal(listerSauvegardes(backups).filter(c => c.base === 'feuilles').length, 0, 'schéma à jour');
    migrate(db4);
    db4.sql.close();
    assert.equal(listerSauvegardes(backups).filter(c => c.base === 'feuilles' && c.motif === 'avant-migration').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npm run backup / restore : compte rendu et code de sortie pour la supervision', () => avecBase(({ dir, file, backups, db }) => {
  db.sql.close();
  const cli = (script: string, args: string[], env: Record<string, string>) => spawnSync(process.execPath,
    ['--disable-warning=ExperimentalWarning', `server/src/${script}`, ...args], { cwd: RACINE, encoding: 'utf8', env: { ...process.env, ...env } });
  const ok = cli('backup.ts', [], { CURSUS_DB: file, CURSUS_BACKUP_KEEP: '2' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Copie : .*cursus-.*Z\.db/);
  assert.match(ok.stdout, /24 collaborateurs/);
  assert.match(ok.stdout, /Rotation : 1 copie conservée \(2 au plus\)/);
  const echec = cli('backup.ts', [], { CURSUS_DB: join(dir, 'absente.db') });
  assert.equal(echec.status, 1);
  assert.match(echec.stderr, /Échec de la sauvegarde : Base introuvable/);
  assert.equal(cli('backup.ts', [], { CURSUS_DB: file, CURSUS_BACKUP_KEEP: 'beaucoup' }).status, 1);

  const faux = join(dir, 'faux.db');
  writeFileSync(faux, 'pas une base');
  const refus = cli('restore.ts', [faux], { CURSUS_DB: file });
  assert.equal(refus.status, 1);
  assert.match(refus.stderr, /n’est pas une base SQLite valide[\s\S]*n’a pas été modifiée/);
  const liste = cli('restore.ts', [], { CURSUS_DB: file });
  assert.equal(liste.status, 1);
  assert.match(liste.stderr, /Sauvegardes disponibles[\s\S]*cursus-.*Z\.db/);
  const copie = listerSauvegardes(backups)[0].fichier;
  const restau = cli('restore.ts', [copie], { CURSUS_DB: file });
  assert.equal(restau.status, 0, restau.stderr);
  assert.match(restau.stdout, /Base actuelle sauvegardée : .*avant-restauration\.db/);
}));

test('serveur : verrou posé au démarrage, seconde instance refusée, verrou retiré à l’arrêt (SIGTERM)', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-verrou-'));
  const file = join(dir, 'cursus.db');
  const env = { ...process.env, CURSUS_DB: file, CURSUS_API_PORT: '0', CURSUS_HOST: '127.0.0.1' };
  const args = ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'];
  // Verrou laissé par un arrêt brutal : remplacé au démarrage.
  writeFileSync(fichierVerrou(file), JSON.stringify({ pid: spawnSync(process.execPath, ['-e', '']).pid, depuis: new Date().toISOString() }));
  const srv = spawn(process.execPath, args, { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((ok, ko) => {
      let out = '';
      srv.stdout.on('data', b => { out += b; if (out.includes('Cursus — API')) ok(); });
      srv.stderr.on('data', b => { out += b; });
      srv.on('exit', code => ko(new Error(`serveur arrêté (${code}) : ${out}`)));
    });
    const verrou = fichierVerrou(file);
    assert.equal(JSON.parse(readFileSync(verrou, 'utf8')).pid, srv.pid);
    assert.equal(serveurActif(file)?.pid, srv.pid);

    // Seconde instance sur la même base (autre port) : refusée avant d'ouvrir la base, verrou du premier intact.
    const second = spawnSync(process.execPath, args, { cwd: RACINE, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(second.status, 1, second.stdout + second.stderr);
    assert.match(second.stderr, new RegExp(`Démarrage impossible : Un autre serveur Cursus utilise déjà cette base \\(processus ${srv.pid},`));
    assert.equal(serveurActif(file)?.pid, srv.pid, 'le verrou désigne toujours le premier serveur');
    const copie = sauvegarder(file); // copie à chaud, serveur démarré
    assert.throws(() => restaurer(copie.fichier, file), /serveur Cursus semble démarré/);

    const fin = new Promise<NodeJS.Signals | null>(ok => srv.on('exit', (_code, signal) => ok(signal)));
    srv.kill('SIGTERM');
    assert.equal(await fin, 'SIGTERM', 'le signal garde son effet par défaut');
    assert.ok(!existsSync(verrou), 'verrou retiré');
  } finally {
    srv.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
