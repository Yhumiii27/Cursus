// Démonstration commune (server/src/seed-commun.ts, npm run demo-commun) : ajout du référentiel commun des outils à la
// démonstration — idempotence, refus hors démonstration (marqueur absent, base purgée, identifiant pris), matricules
// attendus (EMP-0025 Marie Lefebvre, EMP-0061 Antoine Leroy de Crucible, EMP-0014 inchangé), sites et unités de Matrix,
// entité complétée, projets et affectations de Keystone, séquence au-delà des identifiants fixés ; cache de l'instantané
// (delta et relecture complète identiques, vues de lecteurs choisis) ; purge complète (npm run purge-demo : rien de ce
// que l'ajout a posé ne reste, le paramétrage du service RH d'avant ou d'après l'ajout reste) ; réglage
// CURSUS_DEMO_COMMUN (branchements : tests/seed-commun-branchements.test.ts). seedDemo par défaut garde ses 24 salariés
// (oracle intact).
// Sur SQLite en mémoire, et sur PostgreSQL par npm run test:pg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_CACHE_INCREMENTAL;
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { nouvelleBase, PG, schemaNeuf, SQLITE_SEUL } = await import('./base.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
const { seedDemo, SALARIES_DEMO } = await import('../server/src/seed.ts');
const { amorcerEntites, CODE_ENTITE_AMORCEE } = await import('../server/src/demarrage.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { lireBrut, assembler } = await import('../server/src/lecture-brute.ts');
const { appliquerDelta, lireDelta } = await import('../server/src/delta.ts');
const { geler } = await import('../server/src/cache-instantane.ts');
const { lecteursDe, verifierExactitude } = await import('../scripts/charge/verifier.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { REGLAGE_DEMO } = await import('../server/src/marqueurs.ts');
const { journaliser } = await import('../server/src/comptes.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const { demoCommunActive, problemesConfig } = await import('../server/src/config.ts');
const { apercuPurge, lireOptionsPurge, plusGrandIdEmploye, releverBase, texteApercu } = await import('../server/src/purge-demo.ts');
const { executerPurge } = await import('../server/src/purge-demo-execution.ts');
const { ouvrirPourApercu } = await import('../server/src/purge-demo-ouverture.ts');
const {
  ACTION_DEMO_COMMUN, ajouterReferentielCommun, EQUIPES_COMMUNES, PERSONNES_COMMUNES, planReferentielCommun, planVide, PROJETS_KEYSTONE, REGLAGE_DEMO_COMMUN,
  ReferentielCommunRefuse, SITES_COMMUNS, textePlan, UNITES_EQUIPES_DEMO,
} = await import('../server/src/seed-commun.ts');

const T = '2026-10-10';
type User = Parameters<typeof loadFull>[1];
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const n = async (db: Db, sql: string, p: (string | number)[] = []) => Number((await db.one<{ n: number }>(sql, p))!.n);

/** Base de démonstration comme au premier démarrage : jeu, comptes, entité amorcée. */
async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await amorcerEntites(db);
  return db;
}

/** Base de démonstration ouverte comme par npm run purge-demo (PostgreSQL : une seule connexion, aucune autre ouverte). */
async function demoPourPurge(): Promise<Db> {
  if (!PG) return await demo();
  const { url, schema } = await schemaNeuf();
  const env = { DATABASE_URL: url, CURSUS_PG_POOL: '1', CURSUS_PG_INACTIF_MS: '200' };
  const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
  const amorce = await ouvrirPostgres(url, { schema, env });
  try {
    await seedDemo(amorce);
    await amorcerEntites(amorce);
  } finally {
    await amorce.fermer();
  }
  // Fermée par le test lui-même, avant la suppression de la base du fichier (tests/base.ts).
  return await ouvrirPourApercu(env, '', schema);
}

test('seedDemo par défaut : 24 salariés, aucun élément du référentiel commun', async () => {
  const db = await demo();
  assert.equal(await db.count('employes'), SALARIES_DEMO.length);
  assert.equal(await db.count('sites'), 0);
  assert.equal(await db.getSetting(REGLAGE_DEMO_COMMUN, null), null);
  const plan = await planReferentielCommun(db);
  assert.equal(plan.fiches.length, 57);
  assert.deepEqual(plan.sites, SITES_COMMUNS.map(s => s.code));
  assert.match(textePlan(plan, false).join('\n'), /fiches à ajouter : 57 \(EMP-0025 à EMP-0081\)/);
});

test('ajout : matricules, équipes, sites, unités, entité, comptes, projets, affectations ; rejoué sans doublon', async () => {
  const db = await demo();
  const avant14 = (await loadFull(db, RH)).employes.find(e => e.id === 14)!;
  const plan = await ajouterReferentielCommun(db, new Date('2026-11-02T09:00:00Z'));
  assert.equal(plan.fiches.length, 57);
  assert.equal(await db.count('employes'), 81);
  const ds = await loadFull(db, RH);
  const fiche = (id: number) => ds.employes.find(e => e.id === id)!;
  assert.equal(fiche(25).nom, 'Marie Lefebvre');
  assert.equal(fiche(25).email, 'marie.lefebvre@epc2i.fr', 'adresse de Keystone');
  assert.equal(fiche(61).nom, 'Antoine Leroy');
  assert.equal(fiche(61).email, 'a.leroy@epc2i.example', 'adresse de Crucible');
  assert.equal(fiche(79).email, 'c.lefevre@epc2i.example', 'adresse de Vigie');
  assert.equal(fiche(47).email, 'claire.bardet@epc2i.example', 'adresse construite');
  // EMP-0014 (Antoine Leroy de Cursus) inchangé, sauf son site et son unité, tirés de son équipe.
  const apres14 = fiche(14);
  assert.deepEqual({ ...apres14, siteCode: null, uniteCode: null }, { ...avant14, siteCode: null, uniteCode: null });
  assert.equal(apres14.siteCode, 'lyon');
  assert.equal(apres14.uniteCode, 'RHU-ADM');
  if (PG) {
    const m = await db.query<{ id: number; m: string }>('SELECT id, matricule AS m FROM employes WHERE id IN (14, 25, 61, 81) ORDER BY id');
    assert.deepEqual(m.map(r => r.m), ['EMP-0014', 'EMP-0025', 'EMP-0061', 'EMP-0081']);
  }
  // Toutes les fiches ont un site et une unité au format de Matrix.
  for (const e of ds.employes) {
    assert.match(e.siteCode ?? '', /^[a-z][a-z0-9_]{1,31}$/, e.nom);
    assert.match(e.uniteCode ?? '', /^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$/, e.nom);
  }
  assert.equal(fiche(26).siteCode, 'le_havre');
  assert.equal(fiche(72).siteCode, 'lyon_essais', 'zone d’essais de Vigie (ville-b)');
  assert.equal(fiche(60).siteCode, 'site_rd', 'site d’essais de Crucible (RD-SITE)');
  assert.equal(fiche(46).siteCode, 'marseille');
  // Yves Lambert : sorti (fin de CDD).
  assert.equal(fiche(81).fin, '2026-10-01');
  assert.equal(fiche(81).motifSortie, 'fin_cdd');
  // Équipes : six existantes rattachées, nouvelles avec leur responsable ; entité complétée.
  const eq = new Map(ds.referentiels.equipes.map(q => [q.nom, q]));
  for (const [nom, r] of Object.entries(UNITES_EQUIPES_DEMO)) assert.deepEqual([eq.get(nom)!.siteCode, eq.get(nom)!.uniteCode], [r.siteCode, r.uniteCode], nom);
  for (const q of EQUIPES_COMMUNES) assert.equal(eq.get(q.nom)?.managerId, q.managerId, q.nom);
  assert.equal(eq.get('Projets')!.entite, CODE_ENTITE_AMORCEE);
  assert.equal(eq.get('Essais R&D')!.parente, 'R&D');
  const ent = ds.referentiels.entites!.find(x => x.code === CODE_ENTITE_AMORCEE)!;
  assert.deepEqual([ent.nom, ent.siteCode], ['EPC2I', 'lyon']);
  assert.deepEqual(ds.referentiels.sites!.map(s => s.code), SITES_COMMUNS.map(s => s.code));
  // Comptes, projets, affectations ; EMP-0018 sur HLT-026 ; séquence au-delà de 81.
  assert.equal(await n(db, 'SELECT COUNT(*) AS n FROM comptes WHERE emp_id >= 25'), 57);
  for (const [code] of PROJETS_KEYSTONE) assert.ok(await db.get('projets', code), code);
  assert.equal(await n(db, `SELECT COUNT(*) AS n FROM missions WHERE projet = 'HLT-026'`), 7);
  assert.equal(await n(db, `SELECT COUNT(*) AS n FROM missions WHERE projet = 'HLT-026' AND emp_id = 18`), 1);
  assert.equal(await n(db, `SELECT COUNT(*) AS n FROM taches WHERE projet = 'HLT-026' AND emp_id = 18`), 1);
  const nouveau = await db.insert<{ id: number }>('employes', { nom: 'Après le référentiel', equipe: 'Projets', poste: 'Chef de projet', statut: 'cadre', typeContrat: 'cdi', temps: '35h', entree: '2026-11-02' });
  assert.equal(nouveau.id, 82);
  await db.remove('employes', 82);
  // Aucune donnée de santé posée sur les fiches ajoutées.
  assert.equal(await n(db, 'SELECT COUNT(*) AS n FROM employes WHERE id >= 25 AND (avis IS NOT NULL OR visite IS NOT NULL)'), 0);
  // Journal : décomptes seulement, libellé connu.
  const j = await db.query<{ message: string; payload: unknown }>('SELECT message, payload FROM journal WHERE action = ?', [ACTION_DEMO_COMMUN]);
  assert.equal(j.length, 1);
  assert.ok(JOURNAL_LABEL[ACTION_DEMO_COMMUN] && familleAction(ACTION_DEMO_COMMUN)?.id === 'administration');
  assert.doesNotMatch(JSON.stringify(j[0].payload), /Lefebvre|Leroy|@/);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);

  // Rejoué : rien n'est ajouté.
  const lignes = async () => Object.fromEntries(await Promise.all(['employes', 'equipes', 'sites', 'comptes', 'certifications', 'projets', 'missions', 'taches', 'postes', 'contratsHistorique']
    .map(async t => [t, await db.count(t as never)] as const)));
  const compte = await lignes();
  const second = await ajouterReferentielCommun(db);
  assert.ok(planVide(second));
  assert.deepEqual(await lignes(), compte);
  assert.equal(await n(db, 'SELECT COUNT(*) AS n FROM journal WHERE action = ?', [ACTION_DEMO_COMMUN]), 1);
  assert.deepEqual(textePlan(second, true), ['Référentiel commun déjà présent : rien à ajouter.']);
});

test('refus : base sans marqueur de démonstration, purgée, identifiant pris par une autre fiche', async () => {
  const db = await demo();
  await db.run('DELETE FROM settings WHERE key = ?', [REGLAGE_DEMO]);
  await assert.rejects(ajouterReferentielCommun(db), (e: unknown) => e instanceof ReferentielCommunRefuse && /marqueur de démonstration/.test(e.message));
  assert.equal(await db.count('employes'), 24, 'rien n’a été écrit');
  assert.equal(await db.count('sites'), 0);

  const purgee = await demo();
  await journaliser(purgee, { actor: 'Cursus', role: null, action: 'purge.demo', message: 'Purge' });
  await assert.rejects(ajouterReferentielCommun(purgee), (e: unknown) => e instanceof ReferentielCommunRefuse && /base de production/.test(e.message));

  const prise = await demo();
  await prise.insert('employes', { id: 25, nom: 'Visiteur', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  await assert.rejects(ajouterReferentielCommun(prise), (e: unknown) => e instanceof ReferentielCommunRefuse && /EMP-0025/.test(e.message));
  assert.equal(await prise.count('employes'), 25);
});

test('cache : delta identique à la relecture complète après l’ajout, vues des lecteurs exactes', async () => {
  const db = await demo();
  const garder = new Set([12, 25, 40, 61, 69, 77]);
  const lecteurs = async () => await lecteursDe(db, c => c.empId == null || garder.has(Number(c.empId)));
  // Entrée du cache lue avant l'ajout : l'état suivant en est dérivé par le delta.
  assert.deepEqual((await verifierExactitude(db, await lecteurs(), { jeux: false })).divergences, []);
  const depart = await db.lecture(async () => ({ n: (await db.etatRevision()).n, brut: geler(await lireBrut(db, T)) }));
  await ajouterReferentielCommun(db);
  await db.lecture(async () => {
    const { n: rev } = await db.etatRevision();
    const ch = await db.lireChangements(depart.n, rev);
    assert.ok(ch, 'écart connu');
    const f = appliquerDelta(depart.brut, await lireDelta(db, depart.brut, ch));
    const ref = await lireBrut(db, T);
    assert.deepStrictEqual(f.brut, ref, 'lecture brute');
    assert.deepStrictEqual(assembler(f.brut, T, 1, RH), assembler(ref, T, 1, RH), 'instantané assemblé');
    for (const c of ['employes', 'referentiels']) assert.ok(f.champsChanges.has(c as never), c);
  });
  const b = await verifierExactitude(db, await lecteurs(), { jeux: true });
  assert.deepEqual(b.divergences, []);
  assert.ok(b.comparaisons > 0);
});

test('purge : fiches, équipes, sites, postes, projets et rattachements du référentiel commun retirés', async () => {
  const db = await demoPourPurge();
  const postesAvant = await db.count('postes');
  await ajouterReferentielCommun(db);
  assert.ok(await db.count('postes') > postesAvant);
  // Les fiches 25 à 81 sont du jeu (réglage posé), pas des ajouts de visiteurs.
  const constat = await releverBase(db);
  assert.equal(constat.ajouts.fiches.nombre, 0);
  const options = { ...lireOptionsPurge([]), oui: true };
  const apercu = await apercuPurge(db, options);
  assert.equal(apercu.decision.statut, 'possible');
  assert.equal(apercu.salaries, 81);
  assert.deepEqual(apercu.referentielCommun?.sites, SITES_COMMUNS.map(s => s.code));
  assert.match(texteApercu(apercu).join('\n'), /Démonstration commune \(npm run demo-commun\) : retirées après les fiches, équipes Direction, Projets/);
  const b = await executerPurge(db, options, { sauvegarder: () => '/sauvegardes/avant-purge.db' });
  assert.equal(b.statut, 'faite');
  assert.equal(await db.count('employes'), 0);
  assert.equal(await db.count('sites'), 0);
  assert.deepEqual((await db.query<{ nom: string }>('SELECT nom FROM equipes ORDER BY nom')).map(q => q.nom), Object.keys(UNITES_EQUIPES_DEMO).sort());
  assert.equal(await n(db, 'SELECT COUNT(*) AS n FROM equipes WHERE site_code IS NOT NULL OR unite_code IS NOT NULL'), 0);
  assert.equal(await n(db, 'SELECT COUNT(*) AS n FROM entites WHERE site_code IS NOT NULL'), 0);
  assert.equal(await db.count('postes'), postesAvant, 'postes du référentiel commun retirés, ceux du jeu gardés');
  for (const code of ['HLT-026', 'NDC-031', 'SCP-033']) assert.equal(await db.get('projets', code), undefined, code);
  assert.equal(await db.count('missions'), 0);
  assert.equal(await db.getSetting(REGLAGE_DEMO_COMMUN, null), null);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  assert.ok(await plusGrandIdEmploye(db) >= 1000, 'le premier vrai salarié reçoit EMP-1001');
  if (PG) await db.fermer();
});

test('purge : seul ce que l’ajout a créé ou posé part ; site, équipes, postes et rattachements du service RH gardés, avant comme après l’ajout', async () => {
  const db = await demoPourPurge();
  const postesAvant = await db.count('postes');
  // Avant l'ajout, le service RH prépare la production : site lyon (code de Matrix) posé sur l'entité, Production rattachée
  // à lyon sous une autre unité, postes « Magasinier » et « Juriste » (intitulés du référentiel commun) avec leurs
  // exigences, équipe « Direction » (homonyme d'une équipe du référentiel commun).
  await db.insert('sites', { code: 'lyon', libelle: 'Lyon (service RH)', actif: true, ordre: 1 });
  await db.run('UPDATE entites SET site_code = ? WHERE code = ?', ['lyon', CODE_ENTITE_AMORCEE]);
  await db.run('UPDATE equipes SET site_code = ?, unite_code = ? WHERE nom = ?', ['lyon', 'CHA-ATELIER', 'Production']);
  await db.insert('postes', { nom: 'Magasinier', formations: ['caces489'], habilitations: [], archive: null });
  await db.insert('postes', { nom: 'Juriste', formations: ['sst'], habilitations: [], archive: null });
  const ordre = await n(db, 'SELECT MAX(ordre) AS n FROM equipes');
  await db.insert('equipes', { nom: 'Direction', managerId: null, ordre: ordre + 1, parente: null, siteCode: null, uniteCode: null });
  const plan = await ajouterReferentielCommun(db);
  assert.ok(!plan.sites.includes('lyon') && !plan.equipes.includes('Direction') && !plan.rattachements.includes('Production'));
  // Second passage sans effet : le relevé de l'ajout reste celui du premier.
  assert.ok(planVide(await ajouterReferentielCommun(db)));
  // Après l'ajout : équipe du service RH au site lyon, une autre au site d'essais R&D créé par l'ajout ; Maintenance
  // rattachée par l'ajout, puis son unité refaite par le service RH.
  await db.insert('equipes', { nom: 'Laboratoire', managerId: null, ordre: ordre + 50, parente: null, siteCode: 'lyon', uniteCode: 'QUA-LABO' });
  await db.insert('equipes', { nom: 'Bancs', managerId: null, ordre: ordre + 51, parente: null, siteCode: 'site_rd', uniteCode: 'RDI-BANCS' });
  await db.run('UPDATE equipes SET unite_code = ? WHERE nom = ?', ['CHA-ENTRETIEN', 'Maintenance']);
  const apercu = await apercuPurge(db, lireOptionsPurge([]));
  assert.ok(!apercu.referentielCommun?.sites.includes('lyon') && !apercu.referentielCommun?.equipes.includes('Direction'));
  const b = await executerPurge(db, { ...lireOptionsPurge([]), oui: true }, { sauvegarder: () => '/sauvegardes/avant-purge.db' });
  assert.equal(b.statut, 'faite');
  assert.deepEqual((await db.query<{ code: string }>('SELECT code FROM sites')).map(x => x.code), ['lyon'], 'site du service RH gardé, sites ajoutés retirés');
  assert.equal(await n(db, 'SELECT COUNT(*) AS n FROM entites WHERE site_code = ?', ['lyon']), 1, 'site de l’entité posé par le service RH gardé');
  const equipe = async (nom: string) => await db.one<{ site_code: string | null; unite_code: string | null }>('SELECT site_code, unite_code FROM equipes WHERE nom = ?', [nom]);
  assert.deepEqual({ ...await equipe('Production') }, { site_code: 'lyon', unite_code: 'CHA-ATELIER' });
  assert.deepEqual({ ...await equipe('Laboratoire') }, { site_code: 'lyon', unite_code: 'QUA-LABO' });
  assert.deepEqual({ ...await equipe('Bancs') }, { site_code: null, unite_code: 'RDI-BANCS' }, 'site retiré avec le site ajouté');
  assert.deepEqual({ ...await equipe('Maintenance') }, { site_code: null, unite_code: 'CHA-ENTRETIEN' }, 'site posé par l’ajout retiré, unité refaite gardée');
  assert.deepEqual({ ...await equipe('Logistique') }, { site_code: null, unite_code: null });
  assert.ok(await equipe('Direction'), 'équipe homonyme du service RH gardée');
  assert.equal(await equipe('Projets'), undefined);
  const postes = await db.query<{ nom: string; formations: unknown }>('SELECT nom, formations FROM postes WHERE nom IN (?, ?) ORDER BY nom', ['Juriste', 'Magasinier']);
  assert.deepEqual(postes.map(x => [x.nom, typeof x.formations === 'string' ? JSON.parse(x.formations) : x.formations]), [['Juriste', ['sst']], ['Magasinier', ['caces489']]]);
  assert.equal(await db.count('postes'), postesAvant + 2, 'postes créés par l’ajout retirés, ceux du jeu et du service RH gardés');
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  if (PG) await db.fermer();
});

test('CURSUS_DEMO_COMMUN : active en démonstration seulement, valeur contrôlée', () => {
  assert.equal(demoCommunActive({ CURSUS_DEMO: '1', CURSUS_DEMO_COMMUN: '1' }), true);
  assert.equal(demoCommunActive({ CURSUS_DEMO: '1' }), false);
  assert.equal(demoCommunActive({ CURSUS_DEMO_COMMUN: '1' }), false);
  const base = { CURSUS_SECRET: 'x'.repeat(40), KEYSTONE_API_KEY: 'cle-de-test-suffisamment-longue' };
  assert.ok(problemesConfig({ ...base, CURSUS_DEMO_COMMUN: '1' }).some(p => /CURSUS_DEMO_COMMUN=1 est définie sans CURSUS_DEMO=1/.test(p)));
  assert.ok(problemesConfig({ ...base, CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_DEMO_COMMUN: 'oui' }).some(p => /CURSUS_DEMO_COMMUN vaut « oui »/.test(p)));
  assert.ok(!problemesConfig({ ...base, CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_DEMO_COMMUN: '1' }).some(p => /CURSUS_DEMO_COMMUN/.test(p)));
});

test('liste unifiée : identifiants 25 à 81 sans trou, noms uniques par identifiant, homonyme d’EMP-0014 gardé', () => {
  assert.deepEqual(PERSONNES_COMMUNES.map(p => p[0]), Array.from({ length: 57 }, (_, i) => 25 + i));
  assert.ok(PERSONNES_COMMUNES.some(p => p[0] === 61 && p[1] === 'Antoine Leroy'));
  assert.ok(SALARIES_DEMO.some(s => s.id === 14 && s.nom === 'Antoine Leroy'));
  for (const p of PERSONNES_COMMUNES) assert.ok(EQUIPES_COMMUNES.some(q => q.nom === p[3]), `${p[1]} : équipe ${p[3]}`);
});

test('npm run demo-commun sur un fichier SQLite : aperçu sans écriture, ajout, puis « rien à ajouter » ; option inconnue et base sans démonstration refusées', { skip: PG && SQLITE_SEUL }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-demo-commun-'));
  const fichier = join(dossier, 'cursus.db');
  const commande = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/demo-commun-cli.ts', ...args], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_DB: fichier, CURSUS_BACKUP_DIR: join(dossier, 'backups'), CURSUS_TODAY: '2026-10-10', CURSUS_HOST: '127.0.0.1' },
  });
  const salaries = async () => {
    const db = new SqliteDb(fichier);
    try { return await db.count('employes'); } finally { await db.fermer(); }
  };
  try {
    let db = new SqliteDb(fichier);
    await mettreAJourBase(db);
    await seedDemo(db);
    await db.fermer();
    let r = commande('--a-blanc');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Référentiel commun de démonstration à ajouter \(rien n’a été écrit\)/);
    assert.equal(await salaries(), 24);
    r = commande();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fiches ajoutées : 57 \(EMP-0025 à EMP-0081\)/);
    assert.match(r.stdout, /81 salariés en tout/);
    r = commande();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /rien à ajouter/);
    r = commande('--oups');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Option inconnue : --oups/);
    // Base sans marqueur de démonstration : refus, rien n'est écrit.
    db = new SqliteDb(fichier);
    await db.run('DELETE FROM settings WHERE key = ?', [REGLAGE_DEMO]);
    await db.run('DELETE FROM employes WHERE id > 24');
    await db.fermer();
    r = commande();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Référentiel commun refusé : la base ne porte pas le marqueur de démonstration/);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
