// Démonstration commune : branchements de CURSUS_DEMO_COMMUN=1 (server/src/seed-commun.ts). « Réinitialiser la
// démonstration » (server/src/actions/parametres.ts : seedDemo, amorcerEntites puis ajouterReferentielCommun dans la
// transaction de l'action) donne 81 salariés et une ligne demo.commun par réinitialisation, 24 sans la variable ; le premier amorçage
// d'une base vide (server/src/index.ts, transaction englobante de seedDemo) charge aussi le référentiel commun.
// Réinitialisation sur SQLite en mémoire et sur PostgreSQL (npm run test:pg) ; premier amorçage : vrai serveur sur un
// fichier SQLite temporaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
// Lu à l'import de server/src/auth.ts (DEMO) : la réinitialisation n'est admise qu'en démonstration.
process.env.CURSUS_DEMO = '1';
delete process.env.CURSUS_DEMO_COMMUN;
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { nouvelleBase, PG, SQLITE_SEUL } = await import('./base.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { seedDemo, SALARIES_DEMO } = await import('../server/src/seed.ts');
const { amorcerEntites } = await import('../server/src/demarrage.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { ACTION_DEMO_COMMUN, DERNIER_ID_COMMUN, REGLAGE_DEMO_COMMUN } = await import('../server/src/seed-commun.ts');

type User = Parameters<typeof loadFull>[1];
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const RACINE = fileURLToPath(new URL('..', import.meta.url));

test('« Réinitialiser la démonstration » avec CURSUS_DEMO_COMMUN=1 : 81 salariés, une seule ligne demo.commun ; sans la variable : 24', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  await amorcerEntites(db);
  const reinitialiser = async () => await db.tx(async () => await ACTIONS['demo.reinitialiser'](makeCtx(db, RH, await loadFull(db, RH)), {}));
  const lignesCommun = async () => Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM journal WHERE action = ?', [ACTION_DEMO_COMMUN]))!.n);
  process.env.CURSUS_DEMO_COMMUN = '1';
  try {
    assert.match(String(await reinitialiser()), /Données de démonstration réinitialisées/);
    assert.equal(await db.count('employes'), DERNIER_ID_COMMUN);
    assert.equal(await lignesCommun(), 1);
    assert.ok(await db.getSetting(REGLAGE_DEMO_COMMUN, null));
    // Seconde réinitialisation : la base repart du jeu, le référentiel commun est reposé une fois (le journal, gardé par
    // la réinitialisation, en reçoit une ligne de plus).
    await reinitialiser();
    assert.equal(await db.count('employes'), DERNIER_ID_COMMUN);
    assert.equal(await lignesCommun(), 2);
  } finally {
    delete process.env.CURSUS_DEMO_COMMUN;
  }
  await reinitialiser();
  assert.equal(await db.count('employes'), SALARIES_DEMO.length);
  assert.equal(await lignesCommun(), 2, 'aucun ajout sans la variable');
  assert.equal(await db.getSetting(REGLAGE_DEMO_COMMUN, null), null);
});

/** Port libre de la machine (le serveur de test l'occupe aussitôt). */
async function portLibre(): Promise<number> {
  return await new Promise((ok, ko) => {
    const s = createServer().once('error', ko).listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

test('premier amorçage d’une base vide avec CURSUS_DEMO_COMMUN=1 : jeu et référentiel commun chargés', { skip: PG && SQLITE_SEUL }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-demo-commun-amorcage-'));
  const fichier = join(dossier, 'cursus.db');
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(RACINE, 'server/src/index.ts')], {
    cwd: dossier, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '', CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', CURSUS_DEMO: '1', CURSUS_DEMO_COMMUN: '1',
      CURSUS_DB: fichier, CURSUS_BACKUP_DIR: join(dossier, 'backups'), CURSUS_API_PORT: String(await portLibre()),
    },
  });
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  const fin = new Promise<void>(ok => p.on('exit', () => ok()));
  try {
    await new Promise<void>((ok, ko) => {
      const t = setInterval(() => { if (out.includes('données de démonstration chargées')) { clearInterval(t); ok(); } }, 20);
      void fin.then(() => { clearInterval(t); ko(new Error(`Serveur arrêté sans charger la démonstration :\n${out}`)); });
    });
  } finally {
    p.kill('SIGTERM');
    await fin;
  }
  const db = new SqliteDb(fichier);
  try {
    assert.equal(await db.count('employes'), DERNIER_ID_COMMUN, out);
    assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM journal WHERE action = ?', [ACTION_DEMO_COMMUN]))!.n), 1);
  } finally {
    await db.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});
