// Point de santé sans verrou et nouveaux états « degrade » (lot 8, chantier B, étape 2 ; server/src/supervision.ts),
// témoin de sauvegarde (server/src/sauvegarde-temoin.ts) et contrôle de la base au démarrage (controlerDemarrage,
// server/src/pre-vol.ts, appelé par server/src/index.ts). Sur les deux moteurs (tests/base.ts) :
// - /api/health répond pendant qu'une transaction garde le verrou d'écriture, et passe « indisponible » si la sonde de la
//   base ne répond pas dans son délai ;
// - alertes : données de démonstration, démonstration sur epc2i, aucun administrateur RH, e-mails en simulation,
//   sauvegarde ancienne ou témoin illisible, secret d'envoi qui expire ; détail réservé à la supervision ;
// - état relu par la tâche horaire (cache), gardé si la base ne répond plus ;
// - démarrage refusé en production sur une base de démonstration (vrai serveur, fichier SQLite), et pour une
//   démonstration sur epc2i dès que la base a servi en production ou a été purgée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
process.env.CURSUS_TODAY = '2026-10-10';

const { DELAI_SANTE_MS, demarrerSurveillance, etatSante, FRAICHEUR_DONNEES_MS, rafraichirSurveillance, routeSante } = await import('../server/src/supervision.ts');
const { lireTemoin, SAUVEGARDE_MAX_HEURES, TEMOIN_MAX_OCTETS } = await import('../server/src/sauvegarde-temoin.ts');
const { controlerDemarrage } = await import('../server/src/pre-vol.ts');
const { creerCompte } = await import('../server/src/comptes.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
const { PG, nouvelleBase } = await import('./base.ts');
type Db = import('../server/src/db.ts').Db;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-supervision-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const MAIL = { CURSUS_MAIL_FROM: 'cursus@entreprise.fr', CURSUS_MAIL_TENANT: GUID, CURSUS_MAIL_CLIENT_ID: 'app-envoi', CURSUS_MAIL_CLIENT_SECRET: 's'.repeat(40) };
const PROD = { NODE_ENV: 'production', ...MAIL };
const EPC2I = 'postgres://cursus_app:mdp@epc2i-postgres:5432/epc2i';
const admin = async (db: Db) => await creerCompte(db, { type: 'local', identifiant: 'admin', nom: 'Rachel Martin', adresse: 'rachel.martin@entreprise.fr', profilRh: 'rh_admin' }, 'Ligne de commande');
const sante = async (db: Db, env: Record<string, string>, detail = true) => await etatSante(db, detail, '2026-10-10T06:00:00.000Z', env);

test('/api/health répond pendant qu’une transaction garde le verrou d’écriture ; sonde sans réponse : indisponible', async () => {
  const db = await nouvelleBase();
  await admin(db);
  await demarrerSurveillance(db).then(arreter => arreter());
  const app = express().use(routeSante(db, 'x', PROD, { delai: 300 }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(ok => srv.once('listening', ok));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/health`;
  let liberer!: () => void;
  const verrou = new Promise<void>(ok => { liberer = ok; });
  let tenu!: () => void;
  const pris = new Promise<void>(ok => { tenu = ok; });
  const tx = db.tx(async () => { await db.run('UPDATE comptes SET nom = nom'); tenu(); await verrou; });
  try {
    await pris;
    const debut = Date.now();
    const r = await fetch(url, { headers: { 'x-forwarded-for': '203.0.113.7' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { statut: 'ok', base: 'ok' });
    assert.ok(Date.now() - debut < 1000, 'réponse sans attendre la fin de la transaction');
    // Détail : sur SQLite, le décompte des envois attend son tour derrière la transaction et est abandonné ; sur
    // PostgreSQL, il passe sur une autre connexion, sans le verrou.
    const d = await (await fetch(url)).json();
    assert.equal(d.statut, 'ok');
    assert.equal(d.envoisEnEchec, PG ? 0 : undefined);
  } finally {
    liberer();
    await tx;
    srv.close();
  }
  // Sonde qui ne répond pas (serveur saturé, disque bloqué) : indisponible au bout du délai, 503.
  const lente = Object.assign(Object.create(db) as Db, { sonde: () => new Promise<void>(() => {}) });
  const debut = Date.now();
  assert.deepEqual(await etatSante(lente, false, 'x', PROD, { delai: 100 }), { statut: 'indisponible', base: 'erreur' });
  assert.ok(Date.now() - debut < 1000);
  assert.equal(DELAI_SANTE_MS, 2000, 'sous les 5 s de la sonde Docker');
});

test('alertes de production : données de démonstration, aucun administrateur RH, e-mails en simulation ; jamais en démonstration', async () => {
  const vide = await nouvelleBase();
  assert.deepEqual((await sante(vide, PROD)).alertes, ['aucun-admin']);
  assert.deepEqual(await sante(vide, PROD, false), { statut: 'degrade', base: 'ok' }, 'public : état seul');
  const { CURSUS_MAIL_FROM: _f, ...sansMail } = PROD;
  void _f;
  assert.deepEqual((await sante(vide, sansMail)).alertes, ['aucun-admin', 'emails-simulation']);
  const demo = await nouvelleBase();
  await seedDemo(demo);
  assert.deepEqual((await sante(demo, PROD)).alertes, ['donnees-demo'], 'compte RH du jeu : un administrateur');
  // Démonstration (et développement) : rien de tout cela n'est une alerte.
  assert.deepEqual((await sante(demo, { NODE_ENV: 'production', CURSUS_DEMO: '1' })).alertes, []);
  assert.deepEqual((await sante(vide, {})).alertes, []);
  assert.equal((await sante(vide, {})).mode, 'developpement');
  // Démonstration branchée sur epc2i : signalée (lot 8), jamais arrêtée.
  const epc2i = await sante(demo, { NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1', DATABASE_URL: EPC2I });
  assert.deepEqual([epc2i.statut, epc2i.alertes], ['degrade', ['demo-base-commune']]);
  assert.deepEqual((await sante(demo, { CURSUS_DEMO: '1', DATABASE_URL: EPC2I.replace('/epc2i', '/cursus_demo') })).alertes, [], 'autre base : rien');
});

test('état des données : alerte levée relue à chaque appel, sinon cache d’une minute ; gardé si la base ne répond plus', async () => {
  const db = await nouvelleBase();
  const retablir = reglerJournaux({ format: 'json', sortie: (l, n) => { if (n === 'avertissement') avertissements.push(l); } });
  const avertissements: string[] = [];
  try {
    const arreter = await demarrerSurveillance(db, 3600_000);
    assert.deepEqual((await sante(db, PROD)).alertes, ['aucun-admin']);
    // Premier administrateur créé hors du serveur (npm run comptes, J0-2 de la bascule) : l'alerte tombe dès l'appel
    // suivant, sans attendre la tâche horaire (pré-vol --url de J0-5).
    await admin(db);
    assert.deepEqual((await sante(db, PROD)).alertes, [], 'alerte levée : relue à l’appel');
    const actif = async (v: boolean) => {
      const [c] = await db.where<{ id: number }>('comptes', 'identifiant', 'admin');
      await db.update('comptes', c.id, { actif: v });
    };
    // Sans alerte : cache gardé une minute (route publique), puis relu par l'appel suivant.
    await actif(false);
    assert.deepEqual((await sante(db, PROD)).alertes, [], 'moins d’une minute : cache');
    assert.equal(FRAICHEUR_DONNEES_MS, 60_000);
    const vieux = Date.now;
    Date.now = () => vieux() + FRAICHEUR_DONNEES_MS + 1;
    try {
      assert.deepEqual((await sante(db, PROD)).alertes, ['aucun-admin'], 'dernier administrateur désactivé : vu dans la minute');
    } finally {
      Date.now = vieux;
    }
    await actif(true);
    await rafraichirSurveillance(db, { integrite: false });
    assert.deepEqual((await sante(db, PROD)).alertes, [], 'relu par la tâche (intégrité déjà contrôlée : seulement les données)');
    // Appels simultanés pendant une alerte : une seule relecture à la fois.
    await actif(false);
    await rafraichirSurveillance(db, { integrite: false });
    let lectures = 0;
    const compte = Object.assign(Object.create(db) as Db, {
      // Relecture lente (300 ms) : les trois appels la trouvent en cours.
      where: async (...a: Parameters<Db['where']>) => { lectures++; await new Promise(ok => setTimeout(ok, 300)); return await db.where(...a); },
    });
    const etats = await Promise.all([1, 2, 3].map(async () => await sante(compte, PROD)));
    assert.deepEqual(etats.map(e => e.alertes), [['aucun-admin'], ['aucun-admin'], ['aucun-admin']]);
    assert.equal(lectures, 1, 'relecture partagée');
    arreter();
    // Base injoignable au passage : avertissement, dernier état gardé.
    const cassee = Object.assign(Object.create(db) as Db, { query: () => Promise.reject(new Error('connexion perdue')) });
    await rafraichirSurveillance(cassee);
    assert.match(avertissements.join('\n'), /état de la base non relu \(connexion perdue\)/);
  } finally {
    retablir();
  }
});

test('témoin de sauvegarde : date de la première ligne ou du fichier, plus de 26 h ou illisible : alerte', async () => {
  const db = await nouvelleBase();
  await admin(db);
  const temoin = join(dir, 'cursus.temoin');
  const maintenant = Date.parse('2026-10-24T08:00:00Z');
  assert.equal(lireTemoin({}), null, 'sans la variable : rien');
  assert.equal(SAUVEGARDE_MAX_HEURES, 26);
  writeFileSync(temoin, '2026-10-24T02:15:00Z\nsauvegarder.sh : 7 schémas\n');
  assert.deepEqual(lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: temoin }, maintenant), { chemin: temoin, le: '2026-10-24T02:15:00.000Z', heures: 5, enRetard: false });
  // Témoin posé par erreur sur un gros fichier (le dump lui-même) : seul son début est lu.
  assert.equal(TEMOIN_MAX_OCTETS, 1024);
  writeFileSync(temoin, `2026-10-24T02:15:00Z\n${'x'.repeat(8 * 1024 * 1024)}`);
  assert.deepEqual(lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: temoin }, maintenant), { chemin: temoin, le: '2026-10-24T02:15:00.000Z', heures: 5, enRetard: false });
  writeFileSync(temoin, '2026-10-23T05:59:00Z\n');
  assert.equal((lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: temoin }, maintenant) as { enRetard: boolean }).enRetard, true, '26 h et 1 min');
  // Sans date lisible dans le fichier : sa date de modification.
  writeFileSync(temoin, 'ok\n');
  const t = new Date('2026-10-22T02:00:00Z');
  utimesSync(temoin, t, t);
  assert.deepEqual(lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: temoin }, maintenant), { chemin: temoin, le: '2026-10-22T02:00:00.000Z', heures: 54, enRetard: true });
  writeFileSync(temoin, '2026-10-25T12:00:00Z\n');
  assert.match((lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: temoin }, maintenant) as { erreur: string }).erreur, /date du témoin dans le futur/);
  assert.deepEqual(lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: join(dir, 'absent') }), { chemin: join(dir, 'absent'), erreur: 'fichier absent' });
  mkdirSync(join(dir, 'dossier'), { recursive: true });
  assert.deepEqual(lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: join(dir, 'dossier') }), { chemin: join(dir, 'dossier'), erreur: 'ce n’est pas un fichier' });
  assert.deepEqual(lireTemoin({ CURSUS_SAUVEGARDE_TEMOIN: `${temoin}\0` }), { chemin: `${temoin}\0`, erreur: 'fichier illisible' });

  // Point de santé : sauvegarde récente (heure réelle) sans alerte, détail ; ancienne ou illisible : « degrade ».
  writeFileSync(temoin, `${new Date(Date.now() - 3 * 3600_000).toISOString()}\n`);
  const frais = await sante(db, { ...PROD, CURSUS_SAUVEGARDE_TEMOIN: temoin });
  assert.deepEqual([frais.statut, frais.alertes, (frais.sauvegarde as { heures: number }).heures], ['ok', [], 3]);
  writeFileSync(temoin, `${new Date(Date.now() - 30 * 3600_000).toISOString()}\n`);
  assert.deepEqual((await sante(db, { ...PROD, CURSUS_SAUVEGARDE_TEMOIN: temoin })).alertes, ['sauvegarde']);
  const absent = await sante(db, { ...PROD, CURSUS_SAUVEGARDE_TEMOIN: join(dir, 'absent') });
  assert.deepEqual([absent.alertes, absent.sauvegarde], [['sauvegarde'], { erreur: 'fichier absent' }]);
  assert.deepEqual(await sante(db, { ...PROD, CURSUS_SAUVEGARDE_TEMOIN: join(dir, 'absent') }, false), { statut: 'degrade', base: 'ok' }, 'public : ni chemin ni date');
});

test('secret d’envoi des e-mails : « degrade » 30 jours avant son expiration, échéance dans le détail', async () => {
  const db = await nouvelleBase();
  await admin(db);
  const env = (d: string) => ({ ...PROD, CURSUS_MAIL_SECRET_EXPIRE: d });
  const loin = await sante(db, env('2027-03-31'));
  assert.deepEqual([loin.statut, loin.secretEnvoi], ['ok', { expireLe: '2027-03-31', jours: 172 }]);
  const proche = await sante(db, env('2026-11-09'));
  assert.deepEqual([proche.statut, proche.alertes, proche.secretEnvoi], ['degrade', ['secret-envoi'], { expireLe: '2026-11-09', jours: 30 }]);
  // Sans secret d'envoi propre (envoi par le secret de la connexion) : rien à suivre ici.
  const { CURSUS_MAIL_CLIENT_SECRET: _s, ...sansSecret } = env('2026-11-09');
  void _s;
  assert.equal((await sante(db, sansSecret)).secretEnvoi, undefined);
});

test('démarrage : base de démonstration et superutilisateur refusés en production, démonstration sur epc2i exploitée ou purgée refusée', async () => {
  const vide = await nouvelleBase();
  // Base de test PostgreSQL : connectée en postgres (rôle d'administration des tests), donc refusée en production.
  const superutilisateur = PG ? ['connecté au serveur PostgreSQL en « postgres » (superutilisateur)'] : [];
  const refus = async (db: Db, env: Record<string, string>) => (await controlerDemarrage(db, env)).map(m => m.replace(/ : Cursus aurait.*$/, ''));
  assert.deepEqual(await refus(vide, { NODE_ENV: 'production' }), superutilisateur);
  assert.deepEqual(await controlerDemarrage(vide, {}), [], 'hors production : rien');
  const demo = await nouvelleBase();
  await seedDemo(demo);
  const motifs = await controlerDemarrage(demo, { NODE_ENV: 'production' });
  assert.equal(motifs.length, superutilisateur.length + 1);
  assert.match(motifs.at(-1)!, /^la base contient des données de démonstration \(réglage demo \(jeu chargé le \d{4}-\d{2}-\d{2}\), \d+ comptes du jeu de démonstration/);
  assert.match(motifs.at(-1)!, /npm run purge-demo/);
  assert.deepEqual(await refus(demo, { NODE_ENV: 'production', CURSUS_DEMO: '1' }), [], 'démonstration : son jeu est attendu');
  // Démonstration sur epc2i : signalée tant que la base n'a pas servi en production ; refusée ensuite.
  const env = { NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1', DATABASE_URL: EPC2I };
  assert.deepEqual(await controlerDemarrage(demo, env), []);
  await demo.setSetting('exploitation', { premierDemarrageHorsDemo: '2027-01-04T07:00:00.000Z', version: '1.0.0' });
  assert.match((await controlerDemarrage(demo, env))[0], /^démonstration \(CURSUS_DEMO=1\) sur la base epc2i, qui a servi en production \(depuis le 2027-01-04\)/);
  assert.deepEqual(await controlerDemarrage(demo, { ...env, DATABASE_URL: EPC2I.replace('/epc2i', '/demo') }), [], 'autre base');
  const purgee = await nouvelleBase();
  await purgee.insert('journal', { at: '2026-12-15T09:00:00.000Z', actor: 'Ligne de commande', role: null, action: 'purge.demo', message: 'Purge des données fictives' });
  assert.match((await controlerDemarrage(purgee, env))[0], /qui a été vidée de ses données fictives le 2026-12-15/);
});

test('démarrage du serveur en production sur une base de démonstration : refusé avant le marquage « exploitation »', { skip: PG && 'fichier SQLite' }, async () => {
  const fichier = join(dir, 'demo.db');
  const db = new SqliteDb(fichier);
  await seedDemo(db);
  await db.fermer();
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'server/src/index.ts')], {
    cwd: dir, encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', CURSUS_HOST: '127.0.0.1', CURSUS_API_PORT: '0', CURSUS_DB: fichier, CURSUS_SECRET: 'a'.repeat(64), KEYSTONE_API_KEY: 'b'.repeat(64), CURSUS_LOG_FORMAT: 'texte' },
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Démarrage impossible : la base contient des données de démonstration/);
  const apres = new SqliteDb(fichier);
  try {
    assert.equal(await apres.getSetting('exploitation', null), null, 'base jamais marquée exploitée');
  } finally {
    await apres.fermer();
  }
});
