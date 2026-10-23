// Comptes nominatifs : création, espaces, profils RH, connexion par compte local (hors démonstration),
// échecs et blocage (y compris en rafale de requêtes simultanées), changement obligatoire du mot de passe,
// compte désactivé, salarié sorti, bascule d'espace (et espace changé dans un autre onglet), journal signé
// du nom de la personne connectée, actions réservées à l'administrateur RH, premier administrateur créé
// par npm run comptes. Les scénarios HTTP lancent un vrai serveur.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { LimiteParIp, openSession, readSession } = await import('../server/src/auth.ts');
const { compteBloque, compterTentative, espacesDuCompte, hacherMotDePasse, tentativeAdmise, verifierMotDePasse } = await import('../server/src/comptes.ts');
const { ECHEC_CONNEXION } = await import('../server/src/connexion.ts');
const { PROFIL_VIDE } = await import('../shared/rules/profil.ts');
type Db = import('../server/src/db.ts').Db;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = Parameters<typeof espacesDuCompte>[1];

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-comptes-'));
const procs: ChildProcess[] = [];
after(() => {
  procs.forEach(p => p.kill());
  rmSync(dir, { recursive: true, force: true });
});

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compte = async (empId: number | null) => (await db.one(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const get = async (id: number) => (await db.get<Compte>('comptes', id))!;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compte(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), payload));
  return { db, compte, get, user, run, ADMIN: await user(null, 'rh') };
}
const status = (n: number) => (e: unknown) => e instanceof ActionError && e.status === n;

test('mot de passe : empreinte scrypt salée, vérification en temps constant', async () => {
  const a = hacherMotDePasse('une phrase de passe'), b = hacherMotDePasse('une phrase de passe');
  assert.match(a, /^scrypt\$15\$8\$1\$/);
  assert.notEqual(a, b, 'sel aléatoire');
  assert.ok(!a.includes('une phrase'));
  assert.equal(await verifierMotDePasse('une phrase de passe', a), true);
  assert.equal(await verifierMotDePasse('une phrase de passe ', a), false);
  assert.equal(await verifierMotDePasse('', null), false, 'sans empreinte : refus');
});

test('espaces d’un compte : RH selon le profil, manager s’il encadre une équipe, collaborateur s’il est salarié', async () => {
  const { db, compte, get } = await fresh();
  const espaces = async (empId: number | null) => await espacesDuCompte(db, await get((await compte(empId)).id));
  assert.deepEqual(await espaces(null), ['rh'], 'RH de démonstration : compte externe, administratrice');
  assert.deepEqual(await espaces(14), ['rh', 'manager', 'collaborateur'], 'Antoine Leroy : gestionnaire RH, manager de l’Administration');
  assert.deepEqual(await espaces(12), ['manager', 'collaborateur']);
  assert.deepEqual(await espaces(2), ['collaborateur']);
  assert.equal((await get((await compte(1)).id)).type, 'local', 'cariste : compte Cursus');
  assert.equal((await get((await compte(12)).id)).type, 'microsoft');
});

test('création de compte : salarié ou externe, identifiant unique en minuscules, mot de passe provisoire', async () => {
  const { db, get, run, ADMIN } = await fresh();
  const emp = (await run(ADMIN, 'employe.creer', {
    nom: 'Léon Petitjean', poste: 'Opérateur', equipe: 'Production', statut: 'ouvrier', typeContrat: 'interim', temps: '35h',
    entree: '2026-10-01', naissance: 2001, agence: 'Proman Lyon',
  }) as { result: { id: number } }).result.id;
  const r = await run(ADMIN, 'compte.creer', { empId: emp, type: 'local', identifiant: '  Leon.Petitjean ', profilRh: 'aucun' }) as { message: string; result: { id: number; motDePasse: string } };
  const c = await get(r.result.id);
  assert.equal(c.identifiant, 'leon.petitjean');
  assert.ok(r.result.motDePasse.length >= 12);
  assert.doesNotMatch(r.message, new RegExp(r.result.motDePasse), 'le message (journalisé) ne contient pas le mot de passe');
  assert.ok(c.motDePasse && !c.motDePasse.includes(r.result.motDePasse), 'seule l’empreinte est conservée');
  assert.equal(await verifierMotDePasse(r.result.motDePasse, c.motDePasse), true);
  assert.equal(c.changerMotDePasse, true);
  assert.equal(c.creePar, 'Sandrine Vidal');
  assert.deepEqual(await espacesDuCompte(db, c), ['collaborateur']);

  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { empId: 4, type: 'local', identifiant: 'LEON.PETITJEAN' }), /Identifiant déjà utilisé/);
  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { empId: emp, type: 'local', identifiant: 'leon.p' }), /a déjà un compte/);
  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { empId: emp, type: 'microsoft', identifiant: 'leon.p' }), /adresse/);
  // Compte externe : nom et adresse, un profil RH (il n'ouvre que l'espace RH).
  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { type: 'microsoft', identifiant: 'consultante@cabinet.example', nom: 'Lina Morel' }), /choisissez un profil RH/);
  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { type: 'local', identifiant: 'lina.morel', nom: 'Lina Morel', profilRh: 'rh_gestionnaire' }), /Adresse e-mail/);
  const ext = await run(ADMIN, 'compte.creer', { type: 'microsoft', identifiant: 'Lina.Morel@Cabinet.example', nom: 'Lina Morel', profilRh: 'rh_gestionnaire' }) as { result: { id: number; motDePasse: string | null } };
  assert.equal(ext.result.motDePasse, null, 'compte Microsoft : aucun mot de passe');
  assert.equal((await get(ext.result.id)).adresse, 'lina.morel@cabinet.example');
  assert.deepEqual(await espacesDuCompte(db, await get(ext.result.id)), ['rh']);
  // Salarié sorti : pas de nouveau compte.
  await db.update('employes', emp, { fin: '2026-10-09' });
  (await db.run('DELETE FROM comptes WHERE emp_id = ?', [emp]));
  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { empId: emp, type: 'local', identifiant: 'leon.petitjean' }), /a quitté l’entreprise/);
});

test('profil RH et désactivation : Cursus garde toujours un administrateur RH', async () => {
  const { db, compte, get, user, run, ADMIN } = await fresh();
  const sandrine = (await compte(null)).id, antoine = (await compte(14)).id;
  await assert.rejects(async () => await run(ADMIN, 'compte.profil', { id: sandrine, profilRh: 'rh_gestionnaire' }), /au moins un administrateur RH/);
  await assert.rejects(async () => await run(ADMIN, 'compte.activer', { id: sandrine, actif: false }), status(403));
  await assert.rejects(async () => await run(ADMIN, 'compte.reinitialiser', { id: sandrine }), /Microsoft/);
  await run(ADMIN, 'compte.profil', { id: antoine, profilRh: 'rh_admin' });
  // Un autre administrateur existe : Sandrine peut se retirer le profil… et Antoine ne peut plus le perdre.
  await run(ADMIN, 'compte.profil', { id: sandrine, profilRh: 'rh_gestionnaire' });
  const antoineRh = await user(14, 'rh');
  assert.equal(antoineRh.profilRh, 'rh_admin');
  await assert.rejects(async () => await run(antoineRh, 'compte.profil', { id: antoine, profilRh: 'aucun' }), /au moins un administrateur RH/);
  await assert.rejects(async () => await run(antoineRh, 'compte.profil', { id: sandrine, profilRh: 'aucun' }), /compte externe/);

  // Désactivation : toutes les sessions du compte sont fermées aussitôt.
  const cookies: string[] = [];
  const res = { setHeader: (_: string, v: string) => cookies.push(v.match(/cursus_session=([^;]*)/)![1]) } as unknown as Response;
  const req = (c: string) => ({ headers: { cookie: `cursus_session=${c}` } }) as unknown as Request;
  const karim = (await compte(12)).id;
  await openSession(db, res, { compteId: karim, role: 'manager', methode: 'local' });
  await openSession(db, res, { compteId: karim, role: 'collaborateur', methode: 'local' });
  assert.ok(await readSession(db, req(cookies[0])));
  const msg = await run(antoineRh, 'compte.activer', { id: karim, actif: false });
  assert.match(String(msg), /désactivé — 2 sessions fermées/);
  assert.equal(await readSession(db, req(cookies[0])), null);
  assert.equal(await readSession(db, req(cookies[1])), null);
  assert.equal((await get(karim)).actif, false);
  await run(antoineRh, 'compte.activer', { id: karim, actif: true });
  assert.equal(await readSession(db, req(cookies[0])), null, 'la révocation est définitive');
  // Profil RH retiré : une session ouverte dans l'espace RH passe à un autre espace du compte.
  await openSession(db, res, { compteId: antoine, role: 'rh', methode: 'local' });
  await run(antoineRh, 'compte.profil', { id: sandrine, profilRh: 'rh_admin' });
  await run(await user(null, 'rh'), 'compte.profil', { id: antoine, profilRh: 'aucun' });
  assert.equal((await readSession(db, req(cookies[2])))?.role, 'manager');
});

test('actions réservées à l’administrateur RH : refusées au gestionnaire RH', async () => {
  const { db, compte, run, user } = await fresh();
  const GEST = await user(14, 'rh');
  assert.equal(GEST.profilRh, 'rh_gestionnaire');
  assert.equal(GEST.nom, 'Antoine Leroy');
  assert.equal(GEST.empId, null, 'espace RH : la personne agit pour le service');
  const reserve = /réservée à l’administrateur RH/;
  for (const [name, p] of [
    ['parametres.maj', { horizonAlerte: 60 }], ['temps.pushSage', {}], ['equipe.supprimer', { nom: 'Commercial' }], ['demo.reinitialiser', {}],
    ['plan.importer', { texte: 'SST;Production;T1;2;360', exercice: 2027, mode: 'replace' }],
    ['compte.creer', { type: 'local', identifiant: 'x.y', empId: 1 }], ['compte.profil', { id: (await compte(2)).id, profilRh: 'rh_admin' }],
    ['compte.activer', { id: (await compte(2)).id, actif: false }], ['compte.reinitialiser', { id: (await compte(1)).id }],
  ] as [string, Record<string, unknown>][]) {
    await assert.rejects(async () => await run(GEST, name, p), (e: unknown) => e instanceof ActionError && e.status === 403 && reserve.test(e.message), name);
  }
  // Les actions courantes du service RH restent ouvertes, signées de son nom.
  await run(GEST, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Contrôle' });
  await run(GEST, 'report.accorder', { empId: 2, jours: 1, motif: 'Arrêt maladie' });
  const ds = await loadFull(db, GEST);
  assert.equal(ds.employes.find(e => e.id === 2)!.habs.find(h => h.h === 'hauteur')!.mesurePar, 'Antoine Leroy');
  assert.ok(ds.reports.some(r => r.empId === 2 && r.par === 'Antoine Leroy'), 'report de CP signé du gestionnaire, non du « RH » unique');
});

test('limite des échecs de connexion par adresse IP', () => {
  let t = 0;
  const l = new LimiteParIp(3, 1000, () => t);
  l.echec('a'); l.echec('a');
  assert.equal(l.depasse('a'), false);
  l.echec('a');
  assert.equal(l.depasse('a'), true);
  assert.equal(l.depasse('b'), false, 'chaque adresse a son compteur');
  t = 1000;
  assert.equal(l.depasse('a'), false, 'fenêtre close : compteur remis à zéro');
  // Tentative comptée d'avance puis aboutie : rendue.
  l.echec('a'); l.echec('a'); l.echec('a');
  l.rendre('a');
  assert.equal(l.depasse('a'), false);
});

test('tentatives simultanées : comptées avant le calcul ; le blocage posé entre-temps l’emporte sur un mot de passe exact', async () => {
  const { db, compte, get } = await fresh();
  const id = (await compte(1)).id;
  // Cinq tentatives parties en même temps : chacune est comptée avant que la première n'ait son résultat.
  const c0 = await get(id);
  // Ordre d'arrivée : celui de la file en SQLite, celui du verrou d'écriture en PostgreSQL (pas forcément l'ordre
  // des appels) ; chaque tentative a son propre numéro.
  const t = (await Promise.all([1, 2, 3, 4, 5].map(() => compterTentative(db, c0)))).sort((a, b) => a.echecs - b.echecs);
  assert.deepEqual(t.map(x => [x.echecs, x.bloque]), [[1, false], [2, false], [3, false], [4, false], [5, true]]);
  const c = await get(id);
  assert.ok(compteBloque(c), 'bloqué dès la cinquième tentative, avant tout résultat');
  assert.equal(tentativeAdmise(c, t[2]), false, 'la troisième, exacte mais terminée après le blocage : refusée');
  assert.equal(tentativeAdmise(c, t[4]), true, 'la cinquième, qui a posé le blocage, reste admise');
});

// — Scénarios HTTP (hors démonstration) —

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    }).on('error', rej);
  });
}

/** `npm run comptes -- …` sur la base `db`. */
const cli = (db: string, ...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/comptes-cli.ts', ...args],
  { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', CURSUS_DB: db, CURSUS_TODAY: '2026-10-10' } });
const provisoire = (out: string) => out.match(/Mot de passe provisoire .* : (\S+)/)![1];

async function serveur(db: string, env: Record<string, string> = {}) {
  const port = await freePort();
  const p = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_API_PORT: String(port), CURSUS_DB: db, CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', ...env },
  });
  procs.push(p);
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  await new Promise<void>((res, rej) => {
    const timer = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(timer); res(); } }, 20);
    p.on('exit', code => { clearInterval(timer); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  /** `ip` : adresse du client relayée par le proxy local (X-Forwarded-For) ; `espace` : espace affiché par l'onglet. */
  const call = async (path: string, init: { method?: string; cookie?: string; body?: unknown; ip?: string; espace?: string } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.ip ? { 'x-forwarded-for': init.ip } : {}), ...(init.espace ? { 'x-cursus-espace': init.espace } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const cookie = r.headers.get('set-cookie')?.match(/cursus_session=[^;]*/)?.[0] ?? null;
    return { status: r.status, cookie, json: await r.json().catch(() => ({})) };
  };
  return { call, out: () => out };
}

test('npm run comptes : premier administrateur d’une installation vide, accès rétabli ensuite', async () => {
  const db = join(dir, 'vide.db');
  assert.equal(cli(db, 'admin').status, 1, 'usage');
  assert.match(cli(db, 'admin', 'rh.admin', '--local').stderr, /précisez son adresse/);
  const r = cli(db, 'admin', 'rh.admin', '--local', '--nom', 'Rachel Martin', '--adresse', 'rachel.martin@entreprise.example');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Administrateur RH créé : Rachel Martin \(rh\.admin, compte Cursus\)/);
  const mdp = provisoire(r.stdout);
  const d = new Db(db);
  const c = (await d.where<Compte>('comptes', 'identifiant', 'rh.admin'))[0];
  assert.equal(c.profilRh, 'rh_admin');
  assert.equal(c.empId, null);
  assert.ok(c.changerMotDePasse);
  assert.ok(!JSON.stringify(await d.all('journal')).includes(mdp), 'jamais de mot de passe dans le journal');
  // Second passage : accès rétabli, nouveau mot de passe provisoire.
  await d.update('comptes', c.id, { actif: false, profilRh: 'rh_gestionnaire', echecs: 3 });
  const r2 = cli(db, 'admin', 'RH.Admin', '--local');
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /Accès administrateur RH rétabli/);
  assert.notEqual(provisoire(r2.stdout), mdp);
  const c2 = (await d.get<Compte>('comptes', c.id))!;
  assert.deepEqual([c2.actif, c2.profilRh, c2.echecs], [true, 'rh_admin', 0]);
  // Sa fiche, saisie ensuite : --salarie rattache le compte externe existant (un membre du RH salarié ne décide pas
  // de ses propres absences, ce que Cursus ne vérifie que sur le compte rattaché à sa fiche).
  const rachel = (await currentUser(d, { compteId: c.id, role: 'rh', methode: 'local' }))!;
  const fiche = (await d.tx(async () => await ACTIONS['employe.creer'](makeCtx(d, rachel, await loadFull(d, rachel)), { ...PROFIL_VIDE(null, '2026-10-10'), nom: 'Rachel Martin', poste: 'Responsable RH' })) as
    { result: { id: number } }).result.id;
  const r3 = cli(db, 'admin', 'rh.admin', '--local', '--salarie', `EMP-${String(fiche).padStart(4, '0')}`);
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /Accès administrateur RH rétabli : Rachel Martin \(rh\.admin, rattaché à sa fiche salarié\)/);
  assert.equal((await d.get<Compte>('comptes', c.id))!.empId, fiche);
  assert.equal((await currentUser(d, { compteId: c.id, role: 'rh', methode: 'local' }))!.salarieId, fiche);
  assert.match(cli(db, 'admin', 'rh.admin', '--local', '--salarie', '2').stderr, /Accès non rétabli : Compte déjà rattaché à la fiche de Rachel Martin/);
  const ms = cli(db, 'admin', 'sandrine.vidal@entreprise.example', '--nom', 'Sandrine Vidal');
  assert.equal(ms.status, 0, ms.stderr);
  assert.match(ms.stdout, /Microsoft 365/);
  d.sql.close();
});

test('connexion par compte local (hors démonstration)', async t => {
  // Base peuplée (jeu de démonstration chargé directement), serveur lancé sans CURSUS_DEMO.
  const file = join(dir, 'production.db');
  const db = new Db(file);
  await seedDemo(db);
  // Karim Haddad passe en compte Cursus pour essayer la bascule d'espace (manager et collaborateur).
  (await db.run(`UPDATE comptes SET type = 'local', identifiant = 'karim.haddad' WHERE emp_id = 12`));
  const admin = provisoire(cli(file, 'admin', 'rh.admin', '--local', '--nom', 'Rachel Martin', '--adresse', 'rachel.martin@entreprise.example').stdout);
  const srv = await serveur(file);
  assert.doesNotMatch(srv.out(), /mode démonstration/);
  const NOUVEAU = 'trois mots du soir';
  const journal = async () => (await db.query('SELECT actor, role, action, message, identifiant, compte_id AS "compteId", payload FROM journal ORDER BY id')) as
    { actor: string; role: string | null; action: string; message: string | null; identifiant: string | null; compteId: number | null; payload: string }[];
  const login = async (identifiant: string, motDePasse: string) => await srv.call('/api/login', { body: { identifiant, motDePasse } });
  /** Première connexion : mot de passe provisoire remplacé ; renvoie le cookie de session. */
  async function premiere(identifiant: string, mdp: string): Promise<string> {
    const r = await login(identifiant, mdp);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ch = await srv.call('/api/motdepasse', { cookie: r.cookie!, body: { actuel: mdp, nouveau: NOUVEAU } });
    assert.equal(ch.status, 200, JSON.stringify(ch.json));
    return r.cookie!;
  }
  let adminCookie = '';
  const motsDePasse: string[] = [admin];

  await t.test('mauvais mot de passe, identifiant inconnu, compte Microsoft : même message générique', async () => {
    for (const [id, mdp] of [['rh.admin', 'mauvais mot de passe'], ['personne.inconnue', 'x'.repeat(12)], ['sandrine.vidal@entreprise.example', 'x'.repeat(12)]]) {
      const r = await login(id, mdp);
      assert.equal(r.status, 401, id);
      assert.equal(r.json.error, ECHEC_CONNEXION);
      assert.equal(r.cookie, null);
    }
    assert.equal((await srv.call('/api/login', { body: { identifiant: 'rh.admin' } })).status, 400);
  });

  await t.test('mot de passe provisoire : changement obligatoire avant tout accès (12 caractères)', async () => {
    const r = await login('RH.Admin ', admin);
    assert.equal(r.status, 200);
    assert.equal(r.json.user, null);
    assert.equal(r.json.compte.changerMotDePasse, true);
    assert.equal(r.json.methode, 'local');
    const c = r.cookie!;
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401);
    assert.equal((await srv.call('/api/actions/parametres.maj', { cookie: c, body: { horizonAlerte: 60 } })).status, 401);
    assert.equal((await srv.call('/api/mode', { cookie: c, body: { role: 'rh' } })).status, 401);
    assert.match((await srv.call('/api/motdepasse', { cookie: c, body: { actuel: admin, nouveau: 'court' } })).json.error, /12 caractères/);
    assert.match((await srv.call('/api/motdepasse', { cookie: c, body: { actuel: admin, nouveau: 'rh.admin et la suite' } })).json.error, /identifiant/);
    assert.match((await srv.call('/api/motdepasse', { cookie: c, body: { actuel: 'pas le bon du tout', nouveau: NOUVEAU } })).json.error, /actuel incorrect/);
    const ok = await srv.call('/api/motdepasse', { cookie: c, body: { actuel: admin, nouveau: NOUVEAU } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.nom, 'Rachel Martin');
    assert.equal(ok.json.user.profilRh, 'rh_admin');
    assert.equal(ok.json.compte.changerMotDePasse, false);
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    assert.equal((await login('rh.admin', admin)).status, 401, 'l’ancien mot de passe ne vaut plus');
    adminCookie = c;
  });

  await t.test('administrateur : comptes et accès, journal signé de son nom', async () => {
    const liste = await srv.call('/api/comptes', { cookie: adminCookie });
    assert.equal(liste.status, 200);
    assert.ok(liste.json.some((c: { identifiant: string; espaces: string[] }) => c.identifiant === 'karim.haddad' && c.espaces.join() === 'manager,collaborateur'));
    assert.ok(liste.json.every((c: Record<string, unknown>) => !('motDePasse' in c)), 'aucune empreinte transmise');
    for (const id of ['camille.roux', 'karim.haddad']) {
      const compteId = liste.json.find((c: { identifiant: string }) => c.identifiant === id).id;
      const r = await srv.call('/api/actions/compte.reinitialiser', { cookie: adminCookie, body: { id: compteId } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      motsDePasse.push(r.json.result.motDePasse);
    }
    const g = await srv.call('/api/actions/compte.creer', { cookie: adminCookie, body: { type: 'local', identifiant: 'lina.morel', nom: 'Lina Morel', adresse: 'lina.morel@cabinet.example', profilRh: 'rh_gestionnaire' } });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    motsDePasse.push(g.json.result.motDePasse);
    const rows = (await journal()).filter(j => j.action.startsWith('compte.'));
    assert.ok(rows.length >= 3);
    for (const j of rows.filter(x => x.action !== 'compte.admin')) {
      assert.deepEqual([j.actor, j.role, j.identifiant], ['Rachel Martin', 'rh', 'rh.admin']);
      assert.ok(j.compteId);
    }
  });

  await t.test('gestionnaire RH : actions courantes, actions de l’administrateur refusées', async () => {
    const c = await premiere('lina.morel', motsDePasse[3]);
    const s = await srv.call('/api/session', { cookie: c });
    assert.deepEqual([s.json.user.nom, s.json.user.role, s.json.user.profilRh], ['Lina Morel', 'rh', 'rh_gestionnaire']);
    assert.equal((await srv.call('/api/actions/employe.modifier', { cookie: c, body: { id: 2, poste: 'Technicien de maintenance confirmé' } })).status, 200);
    for (const [name, body] of [['parametres.maj', { horizonAlerte: 60 }], ['equipe.supprimer', { nom: 'Commercial' }], ['temps.pushSage', {}], ['compte.activer', { id: 1, actif: false }]] as const) {
      const r = await srv.call(`/api/actions/${name}`, { cookie: c, body });
      assert.equal(r.status, 403, name);
      assert.match(r.json.error, /administrateur RH/);
    }
    assert.equal((await srv.call('/api/comptes', { cookie: c })).status, 403);
    assert.equal((await srv.call('/api/journal', { cookie: c })).status, 200, 'journal consultable par le service RH');
    const j = (await journal()).findLast(x => x.action === 'employe.modifier')!;
    assert.deepEqual([j.actor, j.identifiant], ['Lina Morel', 'lina.morel'], 'le journal porte le nom de la personne connectée');
  });

  await t.test('bascule d’espace : seulement vers un espace du compte', async () => {
    const camille = await premiere('camille.roux', motsDePasse[1]);
    assert.equal((await srv.call('/api/session', { cookie: camille })).json.compte.espaces.join(), 'collaborateur');
    for (const role of ['rh', 'manager']) assert.equal((await srv.call('/api/mode', { cookie: camille, body: { role } })).status, 403, role);
    assert.equal((await srv.call('/api/mode', { cookie: camille, body: { role: 'collaborateur' } })).status, 200);
    const karim = await premiere('karim.haddad', motsDePasse[2]);
    const s = await srv.call('/api/session', { cookie: karim });
    assert.deepEqual([s.json.role, s.json.compte.espaces.join()], ['manager', 'manager,collaborateur']);
    const m = await srv.call('/api/mode', { cookie: karim, body: { role: 'collaborateur' } });
    assert.deepEqual([m.status, m.json.user.role, m.json.user.empId], [200, 'collaborateur', 12]);
    assert.equal(m.cookie, null, 'même session');
    assert.equal((await srv.call('/api/mode', { cookie: karim, body: { role: 'rh' } })).status, 403);
    // Autre onglet resté sur l'espace manager : ni lecture ni action avec les droits de l'espace collaborateur.
    const n = (await journal()).length;
    const autre = await srv.call('/api/actions/absence.demander', { cookie: karim, espace: 'manager', body: { empId: 12, kind: 'CP', du: '2026-12-08', au: '2026-12-08' } });
    assert.equal(autre.status, 409);
    assert.match(autre.json.error, /Espace changé dans un autre onglet/);
    assert.equal((await srv.call('/api/data', { cookie: karim, espace: 'manager' })).status, 409);
    assert.equal((await journal()).length, n, 'rien d’enregistré');
    assert.equal((await srv.call('/api/data', { cookie: karim, espace: 'collaborateur' })).status, 200);
    // Action signée du salarié dans son espace.
    assert.equal((await srv.call('/api/actions/absence.demander', { cookie: camille, body: { empId: 1, kind: 'CP', du: '2026-12-07', au: '2026-12-07' } })).status, 200);
    const j = (await journal()).findLast(x => x.action === 'absence.demander')!;
    assert.deepEqual([j.actor, j.role, j.identifiant], ['Camille Roux', 'collaborateur', 'camille.roux']);
  });

  await t.test('cinq échecs : compte bloqué quinze minutes, même avec le bon mot de passe', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login('camille.roux', `essai numéro ${i}`)).status, 401);
    const bloque = await login('camille.roux', NOUVEAU);
    assert.equal(bloque.status, 401);
    assert.equal(bloque.json.error, ECHEC_CONNEXION, 'message générique, même bloqué');
    const row = (await db.one(`SELECT blocage_fin AS fin, echecs FROM comptes WHERE identifiant = 'camille.roux'`)) as { fin: string; echecs: number };
    const minutes = (Date.parse(row.fin) - Date.now()) / 60_000;
    assert.ok(minutes > 14 && minutes <= 15, `blocage de ${minutes} min`);
    const refus = (await journal()).filter(j => j.action === 'connexion.refusee' && j.identifiant === 'camille.roux');
    assert.match(refus.at(-2)!.message!, /compte bloqué 15 minutes après 5 échecs/);
    assert.match(refus.at(-1)!.message!, /Compte bloqué jusqu’à/);
    // Fin du blocage : le bon mot de passe passe, le compteur repart de zéro.
    (await db.run(`UPDATE comptes SET blocage_fin = ? WHERE identifiant = 'camille.roux'`, [new Date(Date.now() - 1000).toISOString()]));
    assert.equal((await login('camille.roux', NOUVEAU)).status, 200);
    assert.equal(((await db.one(`SELECT echecs FROM comptes WHERE identifiant = 'camille.roux'`)) as { echecs: number }).echecs, 0);
  });

  await t.test('compte désactivé : sessions fermées, connexion refusée', async () => {
    const c = (await login('camille.roux', NOUVEAU)).cookie!;
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    const id = ((await db.one(`SELECT id FROM comptes WHERE identifiant = 'camille.roux'`)) as { id: number }).id;
    assert.equal((await srv.call('/api/actions/compte.activer', { cookie: adminCookie, body: { id, actif: false } })).status, 200);
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401);
    const r = await login('camille.roux', NOUVEAU);
    assert.equal(r.status, 403);
    assert.match(r.json.error, /Compte désactivé/);
    assert.equal((await srv.call('/api/actions/compte.activer', { cookie: adminCookie, body: { id, actif: true } })).status, 200);
    assert.equal((await login('camille.roux', NOUVEAU)).status, 200);
  });

  await t.test('salarié sorti : session révoquée, connexion refusée', async () => {
    const c = (await login('karim.haddad', NOUVEAU)).cookie!;
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 200);
    await db.update('employes', 12, { fin: '2026-10-09' });
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401);
    const r = await login('karim.haddad', NOUVEAU);
    assert.equal(r.status, 403);
    assert.match(r.json.error, /date de sortie/);
    await db.update('employes', 12, { fin: null });
    assert.equal((await srv.call('/api/data', { cookie: c })).status, 401, 'la révocation est définitive');
  });

  await t.test('journal des connexions : réussies et refusées, jamais de mot de passe', async () => {
    const rows = await journal();
    assert.ok(rows.some(j => j.action === 'connexion' && j.actor === 'Rachel Martin' && j.role === 'rh'));
    assert.ok(rows.some(j => j.action === 'connexion.refusee' && j.actor === 'Identifiant inconnu' && j.identifiant === null), 'identifiant inconnu non recopié');
    assert.ok(rows.some(j => j.action === 'motdepasse.change' && j.identifiant === 'lina.morel'));
    const tout = JSON.stringify(rows);
    for (const mdp of [...motsDePasse, NOUVEAU, 'mauvais mot de passe']) assert.ok(!tout.includes(mdp), `mot de passe absent du journal : ${mdp}`);
    // Filtre de Paramètres → Journal : les refus de connexion ne chassent pas les opérations RH de l'écran.
    const connexion = (j: { action: string }) => /^(connexion|deconnexion|motdepasse\.|espace\.|acces\.)/.test(j.action);
    const ops = (await srv.call('/api/journal?vue=operations&taille=200', { cookie: adminCookie })).json.lignes as { action: string }[];
    assert.ok(ops.length && !ops.some(connexion) && ops.some(j => j.action === 'compte.creer'));
    const cx = (await srv.call('/api/journal?vue=connexions', { cookie: adminCookie })).json.lignes as { action: string }[];
    assert.ok(cx.length && cx.every(connexion));
    const logout = await srv.call('/api/logout', { cookie: adminCookie, body: {} });
    assert.equal(logout.json.user, null);
    assert.equal((await srv.call('/api/data', { cookie: adminCookie })).status, 401);
  });
  db.sql.close();
});

test('rafale de tentatives simultanées : au plus 5 vérifications par compte, 30 échecs par adresse', async () => {
  const file = join(dir, 'rafale.db');
  const db = new Db(file);
  await seedDemo(db);
  const BON = 'le bon mot de passe';
  /** Compte Cursus d'un salarié, avec un mot de passe connu, déjà changé. */
  const preparer = async (empId: number, identifiant: string) => {
    const c = (await db.where<Compte>('comptes', 'empId', empId))[0];
    await db.update<Compte>('comptes', c.id, { type: 'local', identifiant, motDePasse: hacherMotDePasse(BON), changerMotDePasse: false });
  };
  await preparer(1, 'compte.a');
  await preparer(2, 'compte.b');
  const srv = await serveur(file);
  const journal = async (identifiant: string, action: string) =>
    ((await db.query('SELECT message FROM journal WHERE identifiant = ? AND action = ? ORDER BY id', [identifiant, action])) as { message: string }[]).map(j => j.message);
  const login = async (identifiant: string, motDePasse: string, ip: string) => await srv.call('/api/login', { body: { identifiant, motDePasse }, ip });
  const statuts = (l: { status: number }[]) => l.reduce<Record<number, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  const plusieurs = <T>(n: number, f: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));

  // Vingt mauvais mots de passe envoyés en même temps : cinq seulement sont vérifiés, le compte est bloqué.
  assert.deepEqual(statuts(await plusieurs(20, async i => await login('compte.a', `mauvais essai ${i}`, '198.51.100.1'))), { 401: 20 });
  const refus = await journal('compte.a', 'connexion.refusee');
  assert.equal(refus.filter(m => m.startsWith('Mot de passe incorrect')).length, 5, 'au plus 5 mots de passe vérifiés');
  assert.equal(refus.filter(m => m.startsWith('Compte bloqué jusqu’à')).length, 15);
  // Le bon mot de passe pendant le blocage, d'une autre adresse : même refus générique.
  const bon = await login('compte.a', BON, '198.51.100.2');
  assert.deepEqual([bon.status, bon.json.error, bon.cookie], [401, ECHEC_CONNEXION, null]);

  // Adresse : 30 tentatives sans succès par fenêtre, comptées dès leur arrivée.
  assert.deepEqual(statuts(await plusieurs(40, async i => await login(`inconnu.${i}`, 'x'.repeat(12), '198.51.100.3'))), { 401: 30, 429: 10 });
  // Une connexion réussie est rendue à l'adresse : elle ne compte pas parmi les échecs.
  await plusieurs(29, async i => await login(`inconnu.${i}`, 'x'.repeat(12), '198.51.100.4'));
  const ok = await login('compte.b', BON, '198.51.100.4');
  assert.equal(ok.status, 200);
  assert.equal((await login('inconnu', 'x'.repeat(12), '198.51.100.4')).status, 401, 'trentième échec');
  assert.equal((await login('compte.b', BON, '198.51.100.4')).status, 429, 'au-delà : refus, même avec le bon mot de passe');

  // Changement du mot de passe : même règle (cinq vérifications, puis compte bloqué).
  const changer = async (actuel: string) => await srv.call('/api/motdepasse', { cookie: ok.cookie!, body: { actuel, nouveau: 'un tout nouveau mot de passe' }, ip: '198.51.100.5' });
  assert.deepEqual(statuts(await plusieurs(12, async i => await changer(`mauvais actuel ${i}`))), { 400: 5, 403: 7 });
  assert.equal((await journal('compte.b', 'motdepasse.refuse')).length, 5);
  const juste = await changer(BON);
  assert.equal(juste.status, 403);
  assert.match(juste.json.error, /Compte bloqué/);
  db.sql.close();
});

test('démonstration : connexion libre, mais par les comptes (RH de démonstration, un compte par salarié)', async () => {
  const srv = await serveur(join(dir, 'demo.db'), { CURSUS_DEMO: '1' });
  const db = new Db(join(dir, 'demo.db'));
  // Première visite : l'espace RH s'ouvre d'office avec le compte de la RH de démonstration.
  const s = await srv.call('/api/session');
  const c = s.cookie!;
  assert.deepEqual([s.json.user.nom, s.json.user.profilRh, s.json.compte.identifiant], ['Sandrine Vidal', 'rh_admin', 'sandrine.vidal@entreprise.example']);
  const opts = s.json.loginOptions;
  assert.equal(opts.collaborateur.length, 24, 'un compte par salarié');
  assert.deepEqual(opts.rh.map((o: { nom: string }) => o.nom), [
    'Aïcha Diallo — Gestionnaire de paie', 'Antoine Leroy — Gestionnaire RH', 'Élodie Bernard — Lecture seule', 'Sandrine Vidal — Administrateur RH',
    'Sarah Cohen — Référent HSE / formation',
  ]);
  const compteRh = (nom: string) => opts.rh.find((o: { nom: string }) => o.nom.startsWith(nom)).id as number;
  const karim = opts.manager.find((o: { nom: string }) => o.nom.startsWith('Karim Haddad')).id;
  // Espace sans compte choisi : écran de connexion ; choix libre d'un compte de l'espace.
  const m = await srv.call('/api/mode', { cookie: c, body: { role: 'manager' } });
  assert.deepEqual([m.status, m.json.user, m.json.role], [200, null, 'manager']);
  assert.equal((await srv.call('/api/login', { cookie: c, body: { role: 'manager', compteId: opts.collaborateur[0].id, password: 'x' } })).status, 400, 'compte sans cet espace');
  const k = await srv.call('/api/login', { cookie: c, body: { role: 'manager', compteId: karim, password: 'x' } });
  assert.deepEqual([k.json.user.nom, k.json.user.role], ['Karim Haddad', 'manager']);
  const ck = k.cookie!;
  // Retour à l'espace RH sans saisie (dernier compte RH), puis au manager choisi.
  assert.equal((await srv.call('/api/mode', { cookie: ck, body: { role: 'rh' } })).json.user.nom, 'Sandrine Vidal');
  assert.equal((await srv.call('/api/mode', { cookie: ck, body: { role: 'manager' } })).json.user.nom, 'Karim Haddad');
  const collab = await srv.call('/api/mode', { cookie: ck, body: { role: 'collaborateur' } });
  assert.deepEqual([collab.json.user.nom, collab.json.user.empId], ['Karim Haddad', 12], 'son propre espace collaborateur');
  // Le journal porte le nom de la personne connectée.
  assert.equal((await srv.call('/api/actions/absence.demander', { cookie: ck, body: { empId: 12, kind: 'CP', du: '2026-12-07', au: '2026-12-07' } })).status, 200);
  const j = (await db.one(`SELECT actor, identifiant FROM journal WHERE action = 'absence.demander'`)) as { actor: string; identifiant: string };
  assert.deepEqual([j.actor, j.identifiant], ['Karim Haddad', 'karim.haddad@entreprise.example']);
  // Déconnexion : l'espace reste, sans compte, jusqu'au choix d'un autre.
  const out = await srv.call('/api/logout', { cookie: ck, body: {} });
  assert.deepEqual([out.json.user, out.json.role], [null, 'collaborateur']);
  // Gestionnaire RH de démonstration : paramètres refusés.
  const a = await srv.call('/api/login', { cookie: out.cookie!, body: { role: 'rh', compteId: compteRh('Antoine Leroy') } });
  assert.equal(a.json.user.profilRh, 'rh_gestionnaire');
  assert.equal((await srv.call('/api/actions/parametres.maj', { cookie: a.cookie!, body: { horizonAlerte: 60 } })).status, 403);
  // Antoine, nommé administrateur, se retire son profil RH : l'instantané renvoyé est celui de l'espace
  // où passe sa session (manager), jamais l'ancien espace RH avec le profil d'administrateur.
  const antoine = compteRh('Antoine Leroy');
  const sv = await srv.call('/api/login', { cookie: a.cookie!, body: { role: 'rh', compteId: compteRh('Sandrine Vidal') } });
  assert.equal((await srv.call('/api/actions/compte.profil', { cookie: sv.cookie!, body: { id: antoine, profilRh: 'rh_admin' } })).status, 200);
  const al = await srv.call('/api/login', { cookie: sv.cookie!, body: { role: 'rh', compteId: antoine } });
  const retrait = await srv.call('/api/actions/compte.profil', { cookie: al.cookie!, espace: 'rh', body: { id: antoine, profilRh: 'aucun' } });
  assert.equal(retrait.status, 200, JSON.stringify(retrait.json));
  assert.deepEqual([retrait.json.data.user.role, retrait.json.data.user.profilRh], ['manager', 'aucun']);
  const apres = await srv.call('/api/session', { cookie: al.cookie! });
  assert.deepEqual([apres.json.role, apres.json.compte.profilRh], ['manager', 'aucun']);
  db.sql.close();
});
