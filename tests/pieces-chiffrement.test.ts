// Chiffrement au repos des pièces justificatives (lot 8, chantier D, étape 2) : format AES-256-GCM et nom authentifié,
// clé CURSUS_PIECES_KEY et règle de production (config.ts), dépôt local chiffré (empreinte et taille du clair), envoi et
// consultation par HTTP, anciennes pièces lisibles, commande de chiffrement des pièces existantes (aperçu, reprise d'une
// passe interrompue, fichiers altérés laissés tels quels, journal), copies de sauvegarde SQLite chiffrées telles quelles,
// migrations lot8-pieces-chiffrees (SQLite) et 0012_pieces_chiffrees (PostgreSQL), commande npm run pieces:chiffrer.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
delete process.env.CURSUS_PIECES_KEY;
delete process.env.CURSUS_BACKUP_DIR;

const { nouvelleBase, PG, SQLITE_SEUL, json, sqlite } = await import('./base.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { PIECES_CHIFFREES } = await import('../server/src/migrations/lot8-pieces.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { createApp } = await import('../server/src/app.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { restaurer, sauvegarder } = await import('../server/src/sauvegarde.ts');
const { clePieces, problemesConfig, refusPiecesLocales } = await import('../server/src/config.ts');
const pieces = await import('../server/src/pieces.ts');
const chiffrement = await import('../server/src/pieces-chiffrement.ts');
const { bilanChiffrementTexte, bilanVerificationTexte, chiffrerPiecesExistantes, verifierPieces } = await import('../server/src/pieces-chiffrer.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
// Journaux du serveur muets (avertissements des pièces illisibles, nettoyage en tâche de fond).
reglerJournaux({ sortie: () => {} });
type Db = Awaited<ReturnType<typeof nouvelleBase>>;

const PDF = Buffer.from('%PDF-1.4\n% arrêt de travail, avis médical\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
const CLE_HEX = randomBytes(32).toString('hex');
const CLE = Buffer.from(CLE_HEX, 'hex');
const AUTRE_CLE = randomBytes(32);
const NOM = 'a'.repeat(32);

/** Variables d'environnement posées le temps de `fn`, rétablies ensuite. */
async function avecEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const avant = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// — Format —

test('format : AES-256-GCM avec en-tête, nom stocké authentifié, clé exigée ; un fichier en clair passe tel quel', () => {
  const c = chiffrement.chiffrerPiece(PDF, CLE, NOM);
  assert.equal(c.length, PDF.length + chiffrement.SURCOUT_CHIFFREMENT);
  assert.ok(chiffrement.estChiffre(c) && !chiffrement.estChiffre(PDF) && !chiffrement.estChiffre(PNG));
  assert.ok(!c.includes(Buffer.from('arrêt de travail')), 'contenu illisible sur le disque');
  assert.notDeepEqual(chiffrement.chiffrerPiece(PDF, CLE, NOM), c, 'vecteur d’initialisation aléatoire');
  assert.deepEqual(chiffrement.contenuEnClair(c, CLE, NOM), PDF);
  assert.deepEqual(chiffrement.contenuEnClair(PDF, null, NOM), PDF, 'pièce d’avant le chiffrement');
  const illisible = (stocke: Buffer, cle: Buffer | null, nom = NOM) => assert.throws(() => chiffrement.contenuEnClair(stocke, cle, nom), chiffrement.PieceIndechiffrable);
  illisible(c, null);
  illisible(c, AUTRE_CLE);
  illisible(c, CLE, 'b'.repeat(32));
  const altere = Buffer.from(c);
  altere[altere.length - 1] ^= 1;
  illisible(altere, CLE);
  // Le message ne contient ni la clé ni le nom stocké.
  try { chiffrement.contenuEnClair(c, AUTRE_CLE, NOM); } catch (e) { assert.ok(!(e as Error).message.includes(NOM) && !(e as Error).message.includes(CLE_HEX)); }
});

// — Configuration —

test('configuration : CURSUS_PIECES_KEY en hexadécimal ou base64, refusée si illisible ; pièces locales sans clé refusées en production', () => {
  assert.deepEqual(clePieces({ CURSUS_PIECES_KEY: CLE_HEX }), CLE);
  assert.deepEqual(clePieces({ CURSUS_PIECES_KEY: ` ${CLE.toString('base64')} ` }), CLE);
  assert.equal(clePieces({}), null);
  assert.equal(clePieces({ CURSUS_PIECES_KEY: 'trop-courte' }), null);
  assert.equal(clePieces({ CURSUS_PIECES_KEY: CLE_HEX.slice(2) }), null);
  const pb = (env: Record<string, string>) => problemesConfig(env).filter(p => p.includes('CURSUS_PIECES_KEY'));
  assert.deepEqual(pb({ CURSUS_PIECES_KEY: CLE_HEX }), []);
  assert.deepEqual(pb({}), [], 'absente : seulement refusée quand les pièces sont actives');
  assert.match(pb({ CURSUS_PIECES_KEY: 'x' })[0], /n’est pas une clé de 32 octets/);
  // Règle de production.
  assert.equal(refusPiecesLocales({}), null, 'hors production');
  assert.match(refusPiecesLocales({ NODE_ENV: 'production' })!, /^Pièces justificatives refusées en production sans clé de chiffrement : .*CURSUS_PIECES_KEY/);
  assert.equal(refusPiecesLocales({ NODE_ENV: 'production', CURSUS_PIECES_KEY: CLE_HEX }), null);
  assert.ok(refusPiecesLocales({ NODE_ENV: 'production', CURSUS_PIECES_KEY: 'x' }), 'clé illisible : comme absente');
  assert.equal(refusPiecesLocales({ NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1' }), null, 'application de bureau');
  assert.ok(refusPiecesLocales({ NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1' }), 'démonstration publique : clé exigée aussi');
  assert.ok(refusPiecesLocales({ NODE_ENV: 'production', CURSUS_HOST: '127.0.0.1' }), 'installation derrière le reverse proxy');
});

// — Dépôt local (les deux moteurs) —

test('dépôt local : chiffré avec la clé, déchiffré à la lecture ; taille du clair au contrôle d’intégrité ; export des données', async () => {
  const db: Db = await nouvelleBase();
  const dossier = pieces.dossierPiecesDe(db);
  const chiffre = new pieces.DepotLocal(dossier, CLE), clair = new pieces.DepotLocal(dossier);
  assert.ok(chiffre.chiffre && !clair.chiffre);
  const f = await chiffre.ecrire(PDF);
  const stocke = readFileSync(join(dossier, f));
  assert.ok(chiffrement.estChiffre(stocke));
  assert.equal(statSync(join(dossier, f)).mode & 0o777, 0o600);
  assert.deepEqual(await chiffre.lire(f), PDF);
  await assert.rejects(clair.lire(f), chiffrement.PieceIndechiffrable, 'sans la clé');
  await assert.rejects(new pieces.DepotLocal(dossier, AUTRE_CLE).lire(f), chiffrement.PieceIndechiffrable);
  assert.equal(await chiffre.lire('f'.repeat(32)), null, 'fichier absent');
  // Ancienne pièce en clair : toujours lisible avec la clé.
  const ancien = await clair.ecrire(PNG);
  assert.deepEqual(await chiffre.lire(ancien), PNG);
  // depotLocal / contenuLocal : clé de l'environnement.
  await avecEnv({ CURSUS_PIECES_KEY: CLE_HEX }, async () => {
    assert.ok(pieces.depotLocal(db).chiffre);
    assert.deepEqual(pieces.contenuLocal(db, f), PDF);
  });
  assert.ok(!pieces.depotLocal(db).chiffre);
  assert.equal(pieces.contenuLocal(db, f), null, 'export sans le contenu quand la clé manque');
  // Contrôle d'intégrité : taille enregistrée = celle du clair.
  const ligne = (fichier: string, chiffree: boolean, taille: number) => ({ nom: 'x.pdf', type: 'application/pdf', taille, empreinte: pieces.empreinte(PDF), fichier, chiffree, deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
  const p = await db.insert<{ id: number }>('pieces', ligne(f, true, PDF.length));
  await db.insert('pieces', ligne(ancien, false, PNG.length));
  assert.deepEqual(await pieces.controlerPieces(db), {});
  await db.update('pieces', p.id, { chiffree: false });
  assert.deepEqual(await pieces.controlerPieces(db), { 'pieces.fichier → dossier des pièces (taille différente)': 1 });
  assert.equal((await db.get<{ chiffree: boolean }>('pieces', p.id))!.chiffree, false);
});

test('chiffrement des pièces existantes : aperçu, fichiers en clair chiffrés, passe interrompue reprise, fichiers altérés laissés tels quels', async () => {
  const db: Db = await nouvelleBase();
  const dossier = pieces.dossierPiecesDe(db);
  const clair = new pieces.DepotLocal(dossier);
  const ligne = (fichier: string | null, octets: Buffer, extra: Record<string, unknown> = {}) =>
    ({ nom: 'x.pdf', type: 'application/pdf', taille: octets.length, empreinte: pieces.empreinte(octets), fichier, deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x', ...extra });
  const fA = await clair.ecrire(PDF), fB = await clair.ecrire(PNG);
  const a = await db.insert<{ id: number }>('pieces', ligne(fA, PDF));
  const b = await db.insert<{ id: number }>('pieces', ligne(fB, PNG, { retireeLe: '2026-10-02T08:00:00.000Z' }));
  // Passe interrompue : fichier déjà chiffré, pièce pas encore notée.
  const fC = randomBytes(16).toString('hex');
  writeFileSync(join(dossier, fC), chiffrement.chiffrerPiece(PDF, CLE, fC), { mode: 0o600 });
  writeFileSync(join(dossier, `${fC}.partiel`), 'reste');
  const c = await db.insert<{ id: number }>('pieces', ligne(fC, PDF));
  // Fichier altéré depuis l'envoi, fichier chiffré avec une autre clé, fichier absent, GED, pièce effacée.
  const fD = await clair.ecrire(PDF);
  writeFileSync(join(dossier, fD), Buffer.concat([PDF, Buffer.from('ajout')]));
  await db.insert('pieces', ligne(fD, PDF));
  const fE = randomBytes(16).toString('hex');
  writeFileSync(join(dossier, fE), chiffrement.chiffrerPiece(PDF, AUTRE_CLE, fE));
  await db.insert('pieces', ligne(fE, PDF));
  await db.insert('pieces', ligne('9'.repeat(32), PDF));
  await db.insert('pieces', ligne('ged:12', PDF));
  await db.insert('pieces', ligne(null, PDF, { retireeLe: '2026-10-02T08:00:00.000Z' }));

  const instantane = () => [fA, fB, fC, fD, fE].map(f => readFileSync(join(dossier, f)).toString('hex'));
  const avant = instantane();
  // Contrôle complet avant : clairs conformes, fichiers chiffrés illisibles sans la clé.
  assert.deepEqual(await verifierPieces(db, null), { designees: 6, conformes: 2, enClair: 2, absentes: 1, alterees: 1, illisibles: 2 });
  assert.deepEqual(await verifierPieces(db, CLE), { designees: 6, conformes: 3, enClair: 2, absentes: 1, alterees: 1, illisibles: 1 });
  const apercu = await chiffrerPiecesExistantes(db, CLE, { apercu: true });
  assert.deepEqual(apercu, { aChiffrer: 6, chiffrees: 2, notees: 1, absentes: 1, alterees: 2 });
  assert.deepEqual(instantane(), avant, 'aperçu : aucun fichier touché');
  assert.equal((await db.all<{ chiffree: boolean }>('pieces')).filter(p => p.chiffree).length, 0);

  const bilan = await chiffrerPiecesExistantes(db, CLE, { auteur: 'Essai' });
  assert.deepEqual(bilan, apercu);
  assert.equal(bilanChiffrementTexte(bilan), '2 fichiers chiffrés · 1 fichier déjà chiffré noté · 1 fichier absent · 2 fichiers laissés tels quels (empreinte différente ou autre clé)');
  const depot = new pieces.DepotLocal(dossier, CLE);
  for (const [id, f, octets] of [[a.id, fA, PDF], [b.id, fB, PNG], [c.id, fC, PDF]] as const) {
    assert.equal((await db.get<{ chiffree: boolean }>('pieces', id))!.chiffree, true);
    assert.ok(chiffrement.estChiffre(readFileSync(join(dossier, f))));
    assert.equal(statSync(join(dossier, f)).mode & 0o777, 0o600);
    // Empreinte enregistrée = celle du clair, vérifiée après déchiffrement.
    assert.equal(pieces.empreinte((await depot.lire(f))!), pieces.empreinte(octets));
  }
  assert.ok(!existsSync(join(dossier, `${fC}.partiel`)) && !existsSync(join(dossier, `${fA}.partiel`)));
  assert.deepEqual(instantane().slice(3), avant.slice(3), 'altérés : preuve gardée telle quelle');
  assert.deepEqual(await pieces.controlerPieces(db), {
    'pieces.fichier → dossier des pièces (absent)': 1, 'pieces.fichier → dossier des pièces (taille différente)': 2,
  });
  const journal = await db.query<{ actor: string; message: string; payload: unknown; salaries: unknown }>(`SELECT actor, message, payload, salaries FROM journal WHERE action = 'piece.chiffrer'`);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].actor, 'Essai');
  assert.deepEqual(json(journal[0].payload), { chiffrees: 2, notees: 1, absentes: 1, alterees: 2 });
  assert.deepEqual(json(journal[0].salaries), []);
  assert.ok(JOURNAL_LABEL['piece.chiffrer'] && familleAction('piece.chiffrer')?.id === 'pieces');
  // Contrôle complet après : tout est chiffré, sauf les fichiers laissés tels quels ; rien n'est écrit.
  const verif = await verifierPieces(db, CLE);
  assert.deepEqual(verif, { designees: 6, conformes: 3, enClair: 0, absentes: 1, alterees: 1, illisibles: 1 });
  assert.equal(bilanVerificationTexte(verif), '3 fichiers conformes sur 6 · 1 fichier absent · 1 fichier altéré (empreinte différente) · 1 fichier chiffré illisible avec cette clé');
  assert.equal(bilanVerificationTexte({ designees: 2, conformes: 2, enClair: 1, absentes: 0, alterees: 0, illisibles: 0 }), '2 fichiers conformes sur 2 (dont 1 en clair)');
  assert.equal(bilanVerificationTexte({ designees: 0, conformes: 0, enClair: 0, absentes: 0, alterees: 0, illisibles: 0 }), 'aucune pièce dans le dossier local');
  // Deuxième passe : rien de neuf, rien au journal.
  assert.deepEqual(await chiffrerPiecesExistantes(db, CLE), { aChiffrer: 3, chiffrees: 0, notees: 0, absentes: 1, alterees: 2 });
  assert.equal((await db.query(`SELECT id FROM journal WHERE action = 'piece.chiffrer'`)).length, 1);
  assert.equal(bilanChiffrementTexte({ aChiffrer: 0, chiffrees: 0, notees: 0, absentes: 0, alterees: 0 }), 'aucune pièce à chiffrer');
});

// — Parcours HTTP et réglage (fichier SQLite de démonstration) —

const dir = mkdtempSync(join(tmpdir(), 'cursus-pieces-chiffrees-'));
const fichierBase = join(dir, 'cursus.db');
const demo = new SqliteDb(fichierBase);
await migrate(demo);
await appliquerMigrations(demo);
await seedDemo(demo);
const dossierDemo = join(dir, 'pieces');
let srv: Server, port: number;
before(async () => {
  await new Promise<void>(ok => { srv = createApp(demo, { production: false, journalRequetes: false, dist: join(dir, 'sans-interface') }).listen(0, '127.0.0.1', () => { port = (srv.address() as AddressInfo).port; ok(); }); });
});
after(() => {
  srv.close();
  demo.sql.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Reponse { status: number; headers: IncomingHttpHeaders; corps: Buffer; json: () => Record<string, any> }
function appel(chemin: string, o: { method?: string; headers?: Record<string, string>; corps?: string | Buffer } = {}): Promise<Reponse> {
  return new Promise((ok, ko) => {
    const req = request({ host: '127.0.0.1', port, path: chemin, method: o.method ?? 'GET', headers: o.headers }, r => {
      const morceaux: Buffer[] = [];
      r.on('data', (m: Buffer) => morceaux.push(m));
      r.on('end', () => { const corps = Buffer.concat(morceaux); ok({ status: r.statusCode!, headers: r.headers, corps, json: () => JSON.parse(corps.toString('utf8')) }); });
    }).on('error', ko);
    req.end(o.corps);
  });
}
const cookieDe = (r: Reponse) => String(r.headers['set-cookie']).match(/cursus_session=[^;]*/)![0];
const compteAdmin = async () => ((await demo.one('SELECT id FROM comptes WHERE emp_id IS NULL')) as { id: number }).id;
async function connexionRh() {
  const premiere = await appel('/api/session');
  const r = await appel('/api/login', { method: 'POST', corps: JSON.stringify({ role: 'rh', compteId: await compteAdmin(), password: 'x' }), headers: { 'content-type': 'application/json', cookie: cookieDe(premiere) } });
  assert.equal(r.status, 200, r.corps.toString());
  return { cookie: cookieDe(r), 'x-cursus-espace': 'rh' };
}
const envoyer = async (s: Record<string, string>, octets: Buffer) =>
  await appel('/api/pieces', { method: 'POST', corps: octets, headers: { ...s, 'content-type': 'application/pdf', 'x-nom-fichier': encodeURIComponent('arret.pdf') } });
const regler = async (stockage: string) => { await demo.setSetting('app', { ...await demo.getSetting<Record<string, unknown>>('app', {}), piecesStockage: stockage }); };
const ligneDemo = async (id: number) => (await demo.get<Record<string, any>>('pieces', id))!;

test('envoi et consultation : fichier chiffré sur disque, servi en clair ; ancienne pièce lisible ; clé manquante signalée', { skip: PG && SQLITE_SEUL }, async () => {
  await regler('local');
  const rh = await connexionRh();
  // Sans clé hors production : écrite en clair, comme avant le lot 8.
  const avantCle = await envoyer(rh, PDF);
  assert.equal(avantCle.status, 201, avantCle.corps.toString());
  const ancienne = await ligneDemo(avantCle.json().id);
  assert.equal(ancienne.chiffree, false);
  assert.deepEqual(readFileSync(join(dossierDemo, ancienne.fichier)), PDF);
  await avecEnv({ CURSUS_PIECES_KEY: CLE_HEX }, async () => {
    const r = await envoyer(rh, PDF);
    assert.equal(r.status, 201, r.corps.toString());
    const p = await ligneDemo(r.json().id);
    assert.equal(p.chiffree, true);
    assert.equal(p.taille, PDF.length);
    assert.equal(p.empreinte, pieces.empreinte(PDF), 'empreinte du clair');
    const stocke = readFileSync(join(dossierDemo, p.fichier));
    assert.ok(chiffrement.estChiffre(stocke) && !stocke.includes(Buffer.from('arrêt')));
    const lu = await appel(`/api/pieces/${p.id}`, { headers: rh });
    assert.equal(lu.status, 200);
    assert.deepEqual(lu.corps, PDF);
    // Ancienne pièce en clair : toujours servie.
    assert.deepEqual((await appel(`/api/pieces/${ancienne.id}`, { headers: rh })).corps, PDF);
    // Contrôle d'intégrité : rien à signaler.
    assert.deepEqual(await pieces.controlerPieces(demo), {});
  });
  // Serveur redémarré sans sa clé : la pièce chiffrée est refusée, avec un message pour l'administrateur.
  const chiffree = (await demo.query<{ id: number }>('SELECT id FROM pieces WHERE chiffree = 1')).at(-1)!;
  const sansCle = await appel(`/api/pieces/${chiffree.id}`, { headers: rh });
  assert.equal(sansCle.status, 409);
  assert.match(sansCle.json().error, /^Fichier chiffré illisible avec la clé du serveur/);
  assert.ok(!sansCle.corps.includes(Buffer.from('%PDF')));
  // Contenu chiffré altéré : refusé de même.
  const p = await ligneDemo(chiffree.id);
  await avecEnv({ CURSUS_PIECES_KEY: AUTRE_CLE.toString('hex') }, async () => {
    assert.equal((await appel(`/api/pieces/${p.id}`, { headers: rh })).status, 409);
  });
  await demo.run('DELETE FROM pieces WHERE objet IS NULL');
});

test('production sans clé : activation des pièces locales refusée, envoi refusé si elles l’étaient déjà ; avertissement au démarrage', { skip: PG && SQLITE_SEUL }, async () => {
  await regler('desactive');
  const user = (await currentUser(demo, { compteId: await compteAdmin(), role: 'rh', methode: 'demo' }))!;
  const ctx = async () => makeCtx(demo, user, await loadFull(demo, user));
  await avecEnv({ NODE_ENV: 'production' }, async () => {
    await assert.rejects(async () => await ACTIONS['parametres.maj'](await ctx(), { piecesStockage: 'local' }),
      (e: unknown) => e instanceof ActionError && e.status === 409 && /sans clé de chiffrement/.test(e.message));
    assert.equal((await demo.getSetting<{ piecesStockage?: string }>('app', {})).piecesStockage, 'desactive');
    // Autre réglage : jamais bloqué par la règle.
    await ACTIONS['parametres.maj'](await ctx(), { piecesStockage: 'desactive', silent: true });
  });
  await avecEnv({ NODE_ENV: 'production', CURSUS_PIECES_KEY: CLE_HEX }, async () => {
    await ACTIONS['parametres.maj'](await ctx(), { piecesStockage: 'local' });
  });
  assert.equal((await demo.getSetting<{ piecesStockage?: string }>('app', {})).piecesStockage, 'local');
  // Réglage posé avant la règle : chaque envoi est refusé, et le démarrage le signale.
  const rh = await connexionRh();
  const lignes: string[] = [];
  const retablir = reglerJournaux({ format: 'json', sortie: l => { lignes.push(l); } });
  try {
    await avecEnv({ NODE_ENV: 'production' }, async () => {
      const r = await envoyer(rh, PDF);
      assert.equal(r.status, 409);
      assert.match(r.json().error, /^Pièces justificatives refusées en production sans clé de chiffrement/);
      const arret = await pieces.demarrerPieces(demo);
      arret();
    });
  } finally {
    retablir();
  }
  assert.ok(lignes.some(l => l.includes('sans clé de chiffrement')));
  await regler('desactive');
});

test('sauvegarde SQLite : fichiers chiffrés copiés tels quels, restaurés tels quels et lisibles avec la clé', { skip: PG && SQLITE_SEUL }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'cursus-pieces-chiffrees-sauvegarde-'));
  const file = join(base, 'cursus.db');
  const autre = new SqliteDb(file);
  try {
    await seedDemo(autre);
    const depot = new pieces.DepotLocal(join(base, 'pieces'), CLE);
    const f = await depot.ecrire(PDF);
    await autre.insert('pieces', { empId: 1, objet: 'certification', objetId: 1, nom: 'x.pdf', type: 'application/pdf', taille: PDF.length, empreinte: pieces.empreinte(PDF), fichier: f, chiffree: true, deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
    const stocke = readFileSync(join(base, 'pieces', f));
    const s = sauvegarder(file, { date: new Date(Date.UTC(2026, 9, 2, 2, 15)), keep: 2 });
    assert.deepEqual(s.pieces, { designees: 1, copiees: 1, manquantes: 0, retirees: 0 });
    const copie = readFileSync(join(base, 'backups', 'pieces-cursus', f));
    assert.deepEqual(copie, stocke, 'copie identique au fichier chiffré');
    assert.ok(chiffrement.estChiffre(copie) && !copie.includes(Buffer.from('arrêt')));
    rmSync(join(base, 'pieces', f));
    autre.sql.close();
    const r = restaurer(s.fichier, file, { keep: 5 });
    assert.deepEqual(r.pieces, { designees: 1, restaurees: 1, manquantes: 0 });
    assert.deepEqual(readFileSync(join(base, 'pieces', f)), stocke);
    assert.deepEqual(await depot.lire(f), PDF);
  } finally {
    try { autre.sql.close(); } catch { /* déjà fermée */ }
    rmSync(base, { recursive: true, force: true });
  }
});

// — Migrations —

test('migration nommée lot8-pieces-chiffrees : anciennes pièces notées en clair, compte rendu ; sans effet sur une base neuve', { skip: PG && SQLITE_SEUL }, async () => {
  const db = sqlite(await nouvelleBase());
  assert.equal(await PIECES_CHIFFREES.necessaire!(db), true, 'base neuve : exécutée, sans effet');
  assert.equal(await PIECES_CHIFFREES.executer(db), undefined);
  // Base d'avant le lot 8 : colonne ajoutée vide à l'ouverture.
  await db.insert('pieces', { nom: 'x.pdf', type: 'application/pdf', taille: 1, fichier: 'c'.repeat(32), deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
  await db.insert('pieces', { nom: 'y.pdf', type: 'application/pdf', taille: 1, fichier: null, retireeLe: '2026-10-01', deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
  await db.run('UPDATE pieces SET chiffree = NULL');
  const ancienne = Object.assign(Object.create(Object.getPrototypeOf(db)), db, { neuve: false }) as typeof db;
  assert.equal(await PIECES_CHIFFREES.necessaire!(ancienne), true);
  assert.equal(await PIECES_CHIFFREES.executer(ancienne), '1 pièce justificative gardée en clair : npm run pieces:chiffrer, une fois CURSUS_PIECES_KEY posée');
  assert.deepEqual((await db.query<{ chiffree: number }>('SELECT chiffree FROM pieces ORDER BY id')).map(r => r.chiffree), [0, 0]);
  assert.equal(await PIECES_CHIFFREES.necessaire!(ancienne), false, 'notée faite ensuite');
  // Pièces sans fichier seulement : aucun compte rendu.
  await db.run('UPDATE pieces SET chiffree = NULL, fichier = NULL');
  assert.equal(await PIECES_CHIFFREES.executer(ancienne), undefined);
});

test('migration PostgreSQL 0012_pieces_chiffrees : colonne booléenne, false par défaut, commentée', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const db: Db = await nouvelleBase();
  const col = (await db.one<{ data_type: string; is_nullable: string; column_default: string }>(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'pieces' AND column_name = 'chiffree'`))!;
  assert.deepEqual([col.data_type, col.is_nullable, col.column_default], ['boolean', 'NO', 'false']);
  await db.exec(`INSERT INTO pieces (nom, type, taille, depose_le, depose_par) VALUES ('x.pdf', 'application/pdf', 1, '2026-10-01T08:00:00.000Z', 'x')`);
  assert.equal((await db.all<{ chiffree: boolean }>('pieces'))[0].chiffree, false);
  const commentaire = (await db.one<{ c: string }>(`SELECT col_description('pieces'::regclass, a.attnum) AS c FROM pg_attribute a WHERE a.attrelid = 'pieces'::regclass AND a.attname = 'chiffree'`))!.c;
  assert.match(commentaire, /chiffré au repos/);
  assert.doesNotMatch(commentaire, /Sensible/, 'colonne non sensible : lisible par Matrix');
});

// — Commande npm run pieces:chiffrer —

test('commande pieces:chiffrer : refusée sans clé, aperçu puis chiffrement d’une base SQLite', { skip: PG && SQLITE_SEUL }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'cursus-pieces-chiffrer-cli-'));
  const file = join(base, 'cursus.db');
  try {
    const db = new SqliteDb(file);
    await migrate(db);
    await appliquerMigrations(db);
    const f = await new pieces.DepotLocal(join(base, 'pieces')).ecrire(PDF);
    await db.insert('pieces', { nom: 'x.pdf', type: 'application/pdf', taille: PDF.length, empreinte: pieces.empreinte(PDF), fichier: f, deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
    db.sql.close();
    const env = (vars: Record<string, string>) => {
      const e: Record<string, string | undefined> = { ...process.env, CURSUS_DB: file, ...vars };
      for (const k of ['DATABASE_URL', 'CURSUS_PIECES_DIR', 'CURSUS_PIECES_KEY', 'NODE_ENV', 'CURSUS_DEMO', 'CURSUS_TODAY']) if (!(k in vars)) delete e[k];
      return e;
    };
    const cli = (vars: Record<string, string>, ...args: string[]) =>
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/pieces-chiffrer-cli.ts', ...args], { env: env(vars), encoding: 'utf8' });
    const sansCle = cli({});
    assert.equal(sansCle.status, 1);
    assert.match(sansCle.stderr, /^Chiffrement refusé : CURSUS_PIECES_KEY est absente ou invalide/);
    const inconnue = cli({ CURSUS_PIECES_KEY: CLE_HEX }, '--tout');
    assert.equal(inconnue.status, 1);
    assert.match(inconnue.stderr, /Option inconnue : --tout/);
    const apercu = cli({ CURSUS_PIECES_KEY: CLE_HEX }, '--apercu');
    assert.equal(apercu.status, 0, apercu.stderr);
    assert.match(apercu.stdout, /Aperçu, rien n’a été écrit : 1 fichier chiffré\./);
    assert.deepEqual(readFileSync(join(base, 'pieces', f)), PDF);
    const fait = cli({ CURSUS_PIECES_KEY: CLE_HEX });
    assert.equal(fait.status, 0, fait.stderr);
    assert.match(fait.stdout, /Chiffrement des pièces : 1 fichier chiffré\./);
    assert.ok(!fait.stdout.includes(CLE_HEX), 'clé jamais affichée');
    assert.deepEqual(await new pieces.DepotLocal(join(base, 'pieces'), CLE).lire(f), PDF);
    // Contrôle complet : conforme avec la clé ; sans elle, illisible (code 1).
    const verifie = (vars: Record<string, string>) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/pieces-chiffrer-cli.ts', '--verifier'], { env: env(vars), encoding: 'utf8' });
    const conforme = verifie({ CURSUS_PIECES_KEY: CLE_HEX });
    assert.equal(conforme.status, 0, conforme.stderr);
    assert.match(conforme.stdout, /Contrôle des pièces : 1 fichier conforme sur 1\./);
    const sansCleVerif = verifie({});
    assert.equal(sansCleVerif.status, 1);
    assert.match(sansCleVerif.stdout, /1 fichier chiffré illisible avec cette clé/);
    assert.match(sansCleVerif.stderr, /^Pièces non conformes/);
    // Fichier disparu : signalé, code de sortie 1.
    const db2 = new SqliteDb(file);
    await db2.insert('pieces', { nom: 'y.pdf', type: 'application/pdf', taille: 1, fichier: 'd'.repeat(32), deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
    db2.sql.close();
    const absent = cli({ CURSUS_PIECES_KEY: CLE_HEX });
    assert.equal(absent.status, 1);
    assert.match(absent.stdout, /1 fichier absent/);
    assert.match(absent.stderr, /^Fichiers absents : restaurez-les/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
