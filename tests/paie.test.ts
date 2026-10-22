// Paie (lot 4, chantier 4, étape 1) : plus aucune feuille marquée transmise sans envoi (SAGE_MODE, « api » inconnu,
// SAGE_URL refusée en production, textes du mode réel), heures supplémentaires payées ou remplacées par un repos
// (mode figé à la validation, reprise des feuilles validées), correspondance des rubriques avec le plan de paie Sage
// (table, confirmation, blocage des modes réels), période de paie déduite de la semaine (rattachement, clôture, rappel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull, loadSettings } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { problemesConfig } = await import('../server/src/config.ts');
const { pushToSage, SageIndisponible, sageMode } = await import('../server/src/integrations/sage.ts');
const { HEURES_SUP } = await import('../server/src/migrations/paie.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { Domain } = await import('../shared/domain.ts');
const { buildSagePayload, calcSheet, rubriquesParPeriode, sageRubriques } = await import('../shared/rules/temps.ts');
const { recupInfo } = await import('../shared/rules/conges.ts');
const {
  clotureDe, confirmationEnvoyee, feuillesParPeriode, partsSemaine, periodeOuverte, periodesSemaine, rubriquesPaie, traduireRubriques, verifieApresSaisie,
} = await import('../shared/rules/paie.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const C = await import('../client/src/state/confirmations.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Feuille = Dataset['feuilles'][number];

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const domain = async () => new Domain(await loadFull(db, await user(null, 'rh')));
  const transmises = async () => Number(((await db.one('SELECT COUNT(*) AS n FROM feuilles WHERE sage = 1')) as { n: number }).n);
  return { db, user, run, refus, domain, transmises, ADMIN: await user(null, 'rh'), PAIE: await user(7, 'rh'), GEST: await user(14, 'rh'), KARIM: await user(12, 'manager') };
}
/** Exécute `fn` avec des variables d'environnement, remises ensuite dans leur état d'origine. */
async function avecEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const avant = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  try { return await fn(); } finally {
    Object.entries(avant).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}
/** Dernier lot de paie enregistré, avec son contenu figé. */
const dernierLot = async (db: InstanceType<typeof Db>) => (await db.all<Dataset['lotsPaie'][number] & { contenu: Awaited<ReturnType<typeof buildSagePayload>> | null }>('lotsPaie')).at(-1)!;
const feuille = (empId: number, week: string, h: number[], extra: Partial<Feuille> = {}): Feuille =>
  ({ id: 9000, empId, week, statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-PROD', tache: '', ks: false, h }], contrat: null, ...extra });

// — t019 : garde-fou immédiat —

test('t019 SAGE_MODE : simulation hors production, fichier d’import en production, SAGE_URL ne bascule plus en API', () => {
  assert.equal(sageMode({}), 'simulation');
  assert.equal(sageMode({ SAGE_URL: 'https://sage.example' }), 'simulation', 'SAGE_URL seule ne fait plus croire à un envoi');
  assert.equal(sageMode({ NODE_ENV: 'production' }), 'fichier', 'mode de production par défaut');
  assert.equal(sageMode({ NODE_ENV: 'production', CURSUS_DEMO: '1' }), 'simulation', 'application de bureau en démonstration');
  // « api » n'est plus un mode (fichier, pas d'API) : valeur inconnue, mode par défaut (et refus au démarrage en production).
  assert.equal(sageMode({ SAGE_MODE: 'api' }), 'simulation');
  assert.equal(sageMode({ SAGE_MODE: 'api', NODE_ENV: 'production' }), 'fichier');
  assert.equal(sageMode({ SAGE_MODE: 'fichier' }), 'fichier');
  assert.equal(sageMode({ SAGE_MODE: 'n’importe quoi', NODE_ENV: 'production' }), 'fichier');
  // Plus aucun accusé fictif : le mode fichier (le fichier passe par la paie) refuse l'envoi direct.
  const p = { endpoint: '', dossier: 'X', envoye_le: '', periodes: ['2026-10'], lignes: [] };
  assert.throws(() => pushToSage(p, 'fichier'), (e: unknown) => e instanceof SageIndisponible && /Générez le lot de la période/.test(e.message));
  assert.match(pushToSage(p, 'simulation').reference, /^SIM-2026-10-0$/);
});

test('t019 configuration : SAGE_MODE=api (inconnu), SAGE_URL et simulation refusés en production, signalés ailleurs', () => {
  const base = { CURSUS_SECRET: 'x'.repeat(40), KEYSTONE_API_KEY: 'cle-de-production-assez-longue' };
  const sage = (env: Record<string, string>) => problemesConfig({ ...base, ...env }).filter(p => /SAGE/.test(p));
  assert.deepEqual(sage({ NODE_ENV: 'production' }), [], 'fichier d’import par défaut : rien à signaler');
  assert.deepEqual(sage({ NODE_ENV: 'production', SAGE_MODE: 'fichier', SAGE_DOSSIER: 'CHIMIE' }), []);
  assert.match(sage({ NODE_ENV: 'production', SAGE_URL: 'https://sage.example/api' }).join(), /SAGE_URL est définie alors qu’aucun envoi à Sage Paie par API n’est prévu/);
  assert.match(sage({ NODE_ENV: 'production', SAGE_MODE: 'api' }).join(), /SAGE_MODE vaut « api » : indiquez fichier[^]*Aucun envoi à Sage Paie par API n’est prévu/);
  assert.match(sage({ NODE_ENV: 'production', SAGE_MODE: 'simulation' }).join(), /marquées transmises à la paie sans que rien ne parte/);
  assert.match(sage({ SAGE_MODE: 'csv' }).join(), /SAGE_MODE vaut « csv »/);
  assert.deepEqual(sage({ SAGE_MODE: 'simulation' }), [], 'simulation hors production');
  assert.deepEqual(sage({ NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', SAGE_MODE: 'simulation' }), [], 'application de bureau');
});

test('t019 transmission : mode fichier refusé sans rien marquer ; simulation annoncée comme telle', async () => {
  const { db, run, refus, transmises, ADMIN, PAIE } = await fresh();
  const avant = await transmises(), lots = async () => await db.count('lotsPaie'), avantLots = await lots();
  // Toutes les rubriques confirmées : seul le mode bloque.
  for (const code of Object.keys(RUBRIQUES_PAIE)) await run(ADMIN, 'paie.rubrique', { code, confirmer: true });
  await avecEnv({ SAGE_MODE: 'fichier' }, async () => await refus(PAIE, 'temps.pushSage', {}, 503, /rien n’est envoyé directement à Sage Paie/));
  assert.equal(await transmises(), avant, 'aucune feuille marquée transmise');
  assert.equal(await lots(), avantLots, 'aucun lot enregistré');
  const msg = await avecEnv({ SAGE_MODE: undefined }, async () => await run(PAIE, 'temps.pushSage', {}));
  assert.match(String(msg), /^\d+ feuilles marquées transmises — simulation, rien n’est envoyé à Sage Paie · période octobre 2026 · 5 absences · 3 séjours \(déplacements\) · \d+ éléments à saisir dans Sage \(rubrique désactivée ou réglage décoché : voir le résumé du lot\)$/);
  assert.deepEqual([(await dernierLot(db)).mode, (await dernierLot(db)).statut, (await dernierLot(db)).reference], ['simulation', 'transmis', (await dernierLot(db)).reference!.startsWith('SIM-') ? (await dernierLot(db)).reference : 'SIM-…']);
  assert.ok((await transmises()) > avant);
});

// — t037 : heures supplémentaires payées ou remplacées par un repos —

test('t037 une semaine de 5 × 8 h (35 h) : payées par défaut, sans repos ; en repos, RCR_ACQUIS seul', async () => {
  const { domain } = await fresh();
  const d = await domain(), camille = d.emp(1)!;
  const h = [8, 8, 8, 8, 8];
  assert.deepEqual(sageRubriques(d, camille, feuille(1, '2026-10-05', h)), { HN: 35, HS25: 5 }, 'plus de double paiement');
  assert.equal(calcSheet(d, camille, feuille(1, '2026-10-05', h)).recup, 0);
  assert.deepEqual(sageRubriques(d, camille, feuille(1, '2026-10-05', h, { heuresSup: 'repos' })), { HN: 35, RCR_ACQUIS: 6.3 });
  assert.deepEqual(sageRubriques(d, camille, feuille(1, '2026-10-05', h, { heuresSup: 'historique' })), { HN: 35, HS25: 5, RCR_ACQUIS: 6.3 }, 'calcul d’origine gardé');
  // Forfait hebdomadaire (Antoine, 38,5 h) : les heures incluses restent payées, même en repos.
  const antoine = d.emp(14)!;
  assert.deepEqual(sageRubriques(d, antoine, feuille(14, '2026-10-05', [8, 8, 8, 8, 8], { heuresSup: 'repos' })), { HN: 35, HSF25: 3.5, RCR_ACQUIS: 1.9 });
});

test('t037 mode figé à la validation ; repos seulement avec la référence de l’accord', async () => {
  const { db, run, refus, domain, ADMIN, KARIM } = await fresh();
  await refus(ADMIN, 'parametres.maj', { heuresSupMode: 'repos' }, 400, /référence de l’accord collectif/);
  await refus(ADMIN, 'parametres.maj', { heuresSupMode: 'repos', heuresSupAccord: 'x'.repeat(121) }, 400, /120 caractères au plus/);
  assert.equal((await loadSettings(db)).heuresSupMode, 'paiement', 'rien n’est enregistré');
  await assert.rejects(async () => appliquerReglages({ ...await loadSettings(db), heuresSupMode: 'repos', heuresSupAccord: 'Accord 2024' }, { heuresSupAccord: '  ' }), ReglageInvalide, 'accord effacé en mode repos');
  await run(ADMIN, 'parametres.maj', { heuresSupMode: 'repos', heuresSupAccord: '  Accord   d’entreprise du 12/03/2024 ' });
  assert.equal((await loadSettings(db)).heuresSupAccord, 'Accord d’entreprise du 12/03/2024');
  // Journal : la référence, texte libre, n'est jamais recopiée ; seul le fait qu'elle soit renseignée ou changée l'est.
  await run(ADMIN, 'parametres.maj', { heuresSupAccord: 'Accord signé avec M. X, délégué CSE' });
  const traces = (await db.all<{ action: string; payload: Record<string, any> }>('journal')).filter(x => x.action === 'parametres.maj');
  assert.equal(traces.length, 2);
  assert.deepEqual([traces[0].payload.avant, traces[0].payload.apres],
    [{ heuresSupMode: 'paiement', heuresSupAccord: null }, { heuresSupMode: 'repos', heuresSupAccord: '[texte renseigné]' }]);
  assert.deepEqual([traces[1].payload.avant, traces[1].payload.apres], [{ heuresSupAccord: '[texte renseigné]' }, { heuresSupAccord: '[texte renseigné]' }]);
  assert.ok(!JSON.stringify(traces).includes('M. X') && !JSON.stringify(traces).includes('12/03/2024'));
  await run(ADMIN, 'parametres.maj', { heuresSupAccord: 'Accord d’entreprise du 12/03/2024' });
  // Feuille de Mehdi (39 h + RTT, équipe de Karim) à 45 h : validée en mode repos.
  await db.insert('feuilles', { empId: 2, week: '2026-10-05', statut: 'soumise', comment: null, sage: false, keystone: false, contrat: null, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance', ks: false, h: [9, 9, 9, 9, 9] }] });
  await run(KARIM, 'temps.validate', { empId: 2, week: '2026-10-05' });
  const sh = async () => (await domain()).ds.feuilles.find(f => f.empId === 2 && f.week === '2026-10-05')!;
  assert.equal((await sh()).heuresSup, 'repos');
  const enRepos = { HN: 39, RCR_ACQUIS: 8 };
  assert.deepEqual(sageRubriques(await domain(), (await domain()).emp(2)!, await sh()), enRepos);
  const acquisRepos = recupInfo(await domain(), (await domain()).emp(2)!)!.acq;
  // Retour au paiement : la semaine validée garde son mode, son repos reste acquis.
  await run(ADMIN, 'parametres.maj', { heuresSupMode: 'paiement' });
  assert.deepEqual(sageRubriques(await domain(), (await domain()).emp(2)!, await sh()), enRepos);
  assert.equal(recupInfo(await domain(), (await domain()).emp(2)!)!.acq, acquisRepos);
  assert.equal(acquisRepos, 3.5 + 8, 'reprise + repos de la semaine');
});

test('t037 reprise : feuilles transmises au calcul d’origine, les autres au mode réglé, soldes devenus négatifs au journal', async () => {
  const { db, domain } = await fresh();
  // Base d'avant le lot 4 : Camille (35 h, aucun repos repris) a deux semaines de 40 h validées, l'une transmise, et
  // a pris un jour de récupération (7 h) sur les 12,5 h que l'ancien calcul lui créditait.
  await db.exec(`UPDATE feuilles SET heures_sup = NULL`);
  await db.exec(`UPDATE soldes_reprise SET recup_acquis = 0, recup_pris = 0 WHERE emp_id = 1`);
  const ligne = [{ projet: 'INT-LOG', tache: 'Réception', ks: false, h: [8, 8, 8, 8, 8] }];
  const t1 = await db.insert<Feuille>('feuilles', { empId: 1, week: '2026-08-31', statut: 'validee', comment: null, sage: true, keystone: false, contrat: null, lignes: ligne });
  const t2 = await db.insert<Feuille>('feuilles', { empId: 1, week: '2026-09-07', statut: 'validee', comment: null, sage: false, keystone: false, contrat: null, lignes: ligne });
  await db.insert('absences', { empId: 1, type: 'RECUP', du: '2026-09-15', au: '2026-09-15', statut: 'validee', keystone: false });
  const aFiger = Number(((await db.one(`SELECT COUNT(*) AS n FROM feuilles WHERE statut = 'validee' AND heures_sup IS NULL`)) as { n: number }).n);
  assert.ok(await HEURES_SUP.necessaire!(db));
  const compteRendu = await db.tx(async () => await HEURES_SUP.executer(db));
  assert.match(String(compteRendu), /mode des heures supplémentaires figé, 1 solde de récupération négatif \(journal\)/);
  const mode = async (id: number) => (await db.get<Feuille>('feuilles', id))!.heuresSup;
  assert.equal(await mode(t1.id), 'historique', 'déjà transmise : ce qui est parti reste exact');
  assert.equal(await mode(t2.id), 'paiement', 'non transmise : payée, sans repos');
  // Repos de la semaine transmise : 5 h à 25 %, soit 6,25 h ; celui de la semaine non transmise disparaît.
  const rc = recupInfo(await domain(), (await domain()).emp(1)!)!;
  assert.deepEqual([rc.acq, rc.pris, rc.solde], [6.25, 7, -0.75]);
  const j = (await db.all<{ action: string; message: string; payload: Record<string, any>; salaries: number[]; paie: boolean }>('journal')).findLast(x => x.action === 'migration.heuresSup')!;
  assert.match(j.message, new RegExp(`figé sur ${aFiger} feuilles validées .*solde de récupération devenu négatif pour 1 salarié`));
  assert.deepEqual(j.salaries, [1]);
  assert.deepEqual(j.payload.soldesNegatifs, [{ empId: 1, avant: 5.5, apres: -0.75, matricule: 'EMP-0001' }]);
  assert.ok(j.paie, 'action liée à la paie : archive de 3 ans');
  // Rien à refaire (la base de ce test, en mémoire, reste « neuve » pour le cadre : la migration s'y exécute sans effet).
  assert.equal(await db.tx(async () => await HEURES_SUP.executer(db)), undefined);
  assert.equal((await db.all('journal')).filter(x => (x as { action: string }).action === 'migration.heuresSup').length, 1);
});

test('t037 reprise au démarrage : base d’avant le lot 4 reprise une fois, après sa copie ; base neuve sans effet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-paie-'));
  try {
    const file = join(dir, 'cursus.db');
    const neuve = new Db(file);
    assert.deepEqual((await appliquerMigrations(neuve)).filter(n => n === HEURES_SUP.nom), [HEURES_SUP.nom], 'base neuve : exécutée');
    assert.equal(await neuve.count('journal'), 0, 'sans effet ni trace');
    neuve.sql.close();
    rmSync(file);
    // Base d'avant le lot 4 : jeu de démonstration sans mode figé, aucune migration nommée enregistrée.
    const ancienne = new Db(file);
    await seedDemo(ancienne);
    await ancienne.exec(`UPDATE feuilles SET heures_sup = NULL`);
    const validees = Number(((await ancienne.one(`SELECT COUNT(*) AS n FROM feuilles WHERE statut = 'validee'`)) as { n: number }).n);
    ancienne.sql.close();
    const db = new Db(file);
    assert.ok((await appliquerMigrations(db)).includes(HEURES_SUP.nom));
    const modes = (await db.query(`SELECT sage, heures_sup AS mode, COUNT(*) AS n FROM feuilles WHERE statut = 'validee' GROUP BY sage, heures_sup ORDER BY sage`))
      .map(r => ({ ...r }));
    assert.deepEqual(modes.map(r => [r.sage, r.mode]), [[0, 'paiement'], [1, 'historique']]);
    assert.equal(modes.reduce((n, r) => n + Number(r.n), 0), validees);
    assert.deepEqual(await appliquerMigrations(db), [], 'une seule fois');
    db.sql.close();
    assert.ok(readdirSync(join(dir, 'backups')).some(f => f.endsWith('-avant-migration.db')), 'copie avant-migration');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// — t022 : rubriques de paie —

test('t022 rubriques : pré-remplies au code interne, à confirmer ; saisie, confirmation, désactivation tracées', async () => {
  const { db, run, refus, domain, ADMIN, PAIE, GEST } = await fresh();
  const table = rubriquesPaie((await domain()).ds.rubriquesPaie);
  assert.deepEqual(table.map(r => r.code), Object.keys(RUBRIQUES_PAIE), 'tous les codes émis, HSF25 et HSF50 compris');
  // Rubriques de sortie (t128) désactivées par défaut : le solde de tout compte reste saisi dans Sage.
  assert.ok(table.every(r => r.codeSage === r.code && r.active === !RUBRIQUES_PAIE[r.code].inactiveParDefaut && !r.confirmee));
  assert.deepEqual(table.filter(r => !r.active).map(r => r.code), ['HNUIT', 'MAJ_NUIT', 'CET', 'ICCP_J', 'RTT_SOLDE', 'RECUP_H', 'CET_LIQ', 'GD_JOUR', 'GD_NUIT', 'ETR_JOUR', 'TRAJET', 'JREN']);
  await refus(GEST, 'paie.rubrique', { code: 'HN', confirmer: true }, 403);
  await refus(PAIE, 'paie.rubrique', { code: 'XX', codeSage: '1' }, 404);
  await refus(PAIE, 'paie.rubrique', { code: 'HN', codeSage: 'code avec espaces' }, 400, /20 caractères au plus/);
  await refus(PAIE, 'paie.rubrique', { code: 'HN', codeSage: '' }, 400);
  assert.equal(await run(PAIE, 'paie.rubrique', { code: 'HS25', codeSage: '3010', confirmer: true }), 'Rubrique HS25 : code Sage 3010 (confirmé)');
  let hs25 = rubriquesPaie((await domain()).ds.rubriquesPaie).find(r => r.code === 'HS25')!;
  assert.deepEqual([hs25.codeSage, hs25.confirmeLe, hs25.confirmePar], ['3010', '2026-10-10', 'Aïcha Diallo']);
  // Code changé sans vérification : à confirmer de nouveau.
  await run(ADMIN, 'paie.rubrique', { code: 'HS25', codeSage: '3011' });
  hs25 = rubriquesPaie((await domain()).ds.rubriquesPaie).find(r => r.code === 'HS25')!;
  assert.deepEqual([hs25.codeSage, hs25.confirmee], ['3011', false]);
  // Dialogue : code confirmé changé sans nouvelle vérification (case décochée par la saisie), à confirmer de nouveau.
  await run(PAIE, 'paie.rubrique', { code: 'HS25', codeSage: '3010', confirmer: true });
  hs25 = rubriquesPaie((await domain()).ds.rubriquesPaie).find(r => r.code === 'HS25')!;
  assert.equal(verifieApresSaisie(hs25, '3100'), false, 'faute de frappe : case décochée');
  assert.equal(verifieApresSaisie(hs25, ' 3010 '), true, 'retour au code enregistré : case rétablie');
  assert.equal(confirmationEnvoyee(hs25, '3100', verifieApresSaisie(hs25, '3100')), undefined);
  assert.equal(confirmationEnvoyee(hs25, '3100', true), true, 'case cochée après la saisie : confirmé');
  assert.equal(confirmationEnvoyee(hs25, '3010', false), false, 'décochée sur un code inchangé : confirmation retirée');
  assert.equal(confirmationEnvoyee(hs25, '3010', true), undefined, 'inchangé : confirmation gardée');
  await run(PAIE, 'paie.rubrique', { code: 'HS25', codeSage: '3100', active: true });
  hs25 = rubriquesPaie((await domain()).ds.rubriquesPaie).find(r => r.code === 'HS25')!;
  assert.deepEqual([hs25.codeSage, hs25.confirmee], ['3100', false]);
  await run(ADMIN, 'paie.rubrique', { code: 'HS25', codeSage: '3011' });
  // Jours et heures ne partagent pas un code ; deux rubriques en heures peuvent le faire.
  await refus(PAIE, 'paie.rubrique', { code: 'JTRAV', codeSage: '3011' }, 400, /ne mélange pas les unités/);
  await run(PAIE, 'paie.rubrique', { code: 'HSF25', codeSage: '3011', confirmer: true });
  await run(PAIE, 'paie.rubrique', { code: 'HN', active: false });
  const t = rubriquesPaie((await domain()).ds.rubriquesPaie);
  assert.deepEqual(traduireRubriques({ HN: 35, HSF25: 3.5, HS25: 1.5, HS50: 0 }, t), { 3011: 5 }, 'HN non exportée, quantités additionnées, nulles omises');
  // Journal : codes et dates, action liée à la paie (archive de 3 ans), famille « Feuilles de temps et paie ».
  const j = (await db.all<{ action: string; payload: Record<string, any>; paie: boolean }>('journal')).filter(x => x.action === 'paie.rubrique');
  assert.equal(j.length, 7);
  assert.deepEqual(j[1].payload.avant, { codeSage: '3010', confirmeLe: '2026-10-10' });
  assert.deepEqual(j[1].payload.apres, { codeSage: '3011', confirmeLe: null });
  assert.ok(j.every(x => x.paie) && estActionPaie('paie.rubrique'));
  assert.equal(familleAction('paie.rubrique')?.id, 'temps');
  assert.ok(JOURNAL_LABEL['paie.rubrique'] && JOURNAL_LABEL['migration.heuresSup']);
});

test('t022 hors simulation, une rubrique utilisée sans code confirmé bloque la transmission, avec la liste', async () => {
  const { db, run, refus, transmises, ADMIN, PAIE } = await fresh();
  const avant = await transmises();
  await avecEnv({ SAGE_MODE: 'fichier' }, async () => {
    await refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 409, /^Transmission impossible : code Sage à confirmer pour les rubriques HN \(Heures normales\), HSF25 \(.*\), HS25 \(.*\), JTRAV \(Jours travaillés, forfait jours\), CP \(.*\), RTT \(.*\), ABS_IND_SANTE \(.*\) \(écran Temps, « Rubriques de paie »\)$/);
    // Rubriques non utilisées par les feuilles et absences en attente (HS50, RCR_ACQUIS…) : sans effet ; désactivée : plus
    // exigée. Les absences validées d'octobre (t028) exigent aussi leurs rubriques.
    for (const code of ['HN', 'HSF25', 'HS25', 'CP', 'RTT', 'ABS_IND_SANTE']) await run(ADMIN, 'paie.rubrique', { code, confirmer: true });
    await refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 409, /pour la rubrique JTRAV \(Jours travaillés, forfait jours\)/);
    await run(ADMIN, 'paie.rubrique', { code: 'JTRAV', active: false });
    // Rubriques confirmées : le lot du fichier d'import se génère ; l'envoi direct reste refusé.
    assert.match(String(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' })), /^Lot n° \d+ généré — .* · téléchargez le fichier d’import/);
    await refus(PAIE, 'temps.pushSage', {}, 400, /Aucune feuille validée en attente/);
  });
  assert.equal(await transmises(), avant, 'lot généré : rien n’est transmis avant la confirmation de l’import');
  await run(PAIE, 'paie.lotAnnuler', { id: (await dernierLot(db)).id });
  // Simulation : les codes à confirmer ne bloquent pas, mais les rubriques désactivées ne partent pas.
  await run(PAIE, 'temps.pushSage', {});
  const lignes = (await dernierLot(db)).contenu!.lignes;
  const emises = new Set(lignes.flatMap(l => Object.keys(l.rubriques)));
  assert.ok(!emises.has('JTRAV'), 'JTRAV désactivée : absente du lot');
  for (const code of ['HN', 'HSF25', 'HS25']) assert.ok(lignes.some(l => l.rubriques[code] > 0), `${code} émise`);
});

test('t022 données : correspondance transmise au service RH, à la paie et à la lecture seule, à personne d’autre', async () => {
  const { db, run, user, ADMIN, PAIE, KARIM } = await fresh();
  await run(PAIE, 'paie.rubrique', { code: 'HN', codeSage: '1000', confirmer: true });
  assert.equal((await buildSnapshot(db, ADMIN)).rubriquesPaie.length, 1);
  assert.equal((await buildSnapshot(db, PAIE)).rubriquesPaie.length, 1);
  assert.equal((await buildSnapshot(db, await user(11, 'rh'))).rubriquesPaie.length, 1, 'lecture seule');
  assert.deepEqual((await buildSnapshot(db, await user(23, 'rh'))).rubriquesPaie, [], 'référent HSE');
  assert.deepEqual((await buildSnapshot(db, KARIM)).rubriquesPaie, []);
  assert.deepEqual((await buildSnapshot(db, await user(2, 'collaborateur'))).rubriquesPaie, []);
});

// — t025 : période de paie —

test('t025 rattachement d’une semaine à cheval : mois du dimanche par défaut, du vendredi, ou jour par jour', () => {
  const tout = [0, 1, 2, 3, 4, 5, 6];
  // Semaine du 28 septembre 2026 : lundi à mercredi en septembre, jeudi à dimanche en octobre.
  assert.deepEqual(partsSemaine('2026-09-28'), [{ periode: '2026-10', jours: tout }]);
  assert.deepEqual(partsSemaine('2026-09-28', 'vendredi'), [{ periode: '2026-10', jours: tout }]);
  assert.deepEqual(partsSemaine('2026-09-28', 'jour'), [{ periode: '2026-09', jours: [0, 1, 2] }, { periode: '2026-10', jours: [3, 4, 5, 6] }]);
  // Le 31 octobre 2026 est un samedi : la semaine du 26 va en novembre (dimanche 1er), en octobre avec le vendredi ;
  // jour par jour, le dimanche 1er novembre part seul en novembre.
  assert.deepEqual(partsSemaine('2026-10-26'), [{ periode: '2026-11', jours: tout }]);
  assert.deepEqual(partsSemaine('2026-10-26', 'vendredi'), [{ periode: '2026-10', jours: tout }]);
  assert.deepEqual(partsSemaine('2026-10-26', 'jour'), [{ periode: '2026-10', jours: [0, 1, 2, 3, 4, 5] }, { periode: '2026-11', jours: [6] }]);
  // À cheval sur deux années.
  assert.deepEqual(partsSemaine('2026-12-28'), [{ periode: '2027-01', jours: tout }]);
  assert.deepEqual(partsSemaine('2026-12-28', 'vendredi'), [{ periode: '2027-01', jours: tout }]);
  assert.deepEqual(partsSemaine('2026-12-28', 'jour'), [{ periode: '2026-12', jours: [0, 1, 2, 3] }, { periode: '2027-01', jours: [4, 5, 6] }]);
  assert.deepEqual(partsSemaine('2025-12-29', 'jour'), [{ periode: '2025-12', jours: [0, 1, 2] }, { periode: '2026-01', jours: [3, 4, 5, 6] }]);
});

test('t025 clôture et rappel : une semaine d’une période close part sur la période ouverte', () => {
  assert.equal(clotureDe('2026-02'), '2026-02-28');
  assert.equal(clotureDe('2028-02'), '2028-02-29');
  assert.equal(clotureDe('2026-10', 25), '2026-10-25');
  assert.equal(periodeOuverte('2026-10-10'), '2026-10');
  assert.equal(periodeOuverte('2026-10-31'), '2026-10');
  assert.equal(periodeOuverte('2026-10-26', 25), '2026-11', 'clôture du 25 passée');
  assert.equal(periodeOuverte('2026-12-28', 20), '2027-01');
  const s = { periodeRattachement: 'dimanche' as const, clotureJour: 0 };
  // Semaine du 21 septembre transmise le 10 octobre : septembre est clos, rappel sur octobre.
  assert.deepEqual(periodesSemaine('2026-09-21', s, '2026-10-10'), [{ periode: '2026-10', origine: '2026-09', jours: [0, 1, 2, 3, 4, 5, 6] }]);
  assert.deepEqual(periodesSemaine('2026-09-28', s, '2026-10-10'), [{ periode: '2026-10', origine: null, jours: [0, 1, 2, 3, 4, 5, 6] }]);
  assert.deepEqual(periodesSemaine('2026-10-26', s, '2026-10-30'), [{ periode: '2026-11', origine: null, jours: [0, 1, 2, 3, 4, 5, 6] }], 'période à venir : ouverte');
  assert.deepEqual(periodesSemaine('2026-09-28', { ...s, periodeRattachement: 'jour' }, '2026-10-10').map(p => [p.periode, p.origine]), [['2026-10', '2026-09'], ['2026-10', null]]);
  assert.deepEqual(feuillesParPeriode([{ empId: 1, week: '2026-09-21' }, { empId: 2, week: '2026-09-21' }, { empId: 1, week: '2026-09-28' }], s, '2026-10-10'), [
    { periode: '2026-10', origine: null, feuilles: 1, salaries: 1, semaines: ['1|2026-09-28'] },
    { periode: '2026-10', origine: '2026-09', feuilles: 2, salaries: 2, semaines: ['1|2026-09-21', '2|2026-09-21'] },
  ]);
});

test('t025 transmission : une ligne par période, ventilation jour par jour exacte, rappel signalé', async () => {
  const { db, run, domain, ADMIN, PAIE } = await fresh();
  const d0 = await domain();
  // Camille (35 h), semaine du 28 septembre à 8 h par jour : 24 h en septembre, 16 h en octobre dont 5 h supplémentaires.
  const sh = feuille(1, '2026-09-28', [8, 8, 8, 8, 8], { heuresSup: 'paiement' });
  const jour = new Domain({ ...d0.ds, settings: { ...d0.ds.settings, periodeRattachement: 'jour' }, feuilles: [sh] });
  assert.deepEqual(rubriquesParPeriode(jour, jour.emp(1)!, sh), [
    { periode: '2026-10', origine: '2026-09', rubriques: { HN: 24 } },
    { periode: '2026-10', origine: null, rubriques: { HN: 11, HS25: 5 } },
  ]);
  const p = buildSagePayload(jour, [sh], 'TEST');
  assert.deepEqual(p.periodes, ['2026-10']);
  assert.deepEqual(p.lignes.map(l => [l.semaine, l.periode, l.periode_origine ?? null]), [['2026-S40', '2026-10', '2026-09'], ['2026-S40', '2026-10', null]]);
  // Semaine du 21 septembre validée, pas encore transmise : rappel annoncé dans le message et la confirmation.
  await db.exec(`UPDATE feuilles SET sage = 0, lot_id = NULL WHERE emp_id = 1 AND week = '2026-09-21'`);
  await run(ADMIN, 'parametres.maj', { clotureJour: 0, periodeRattachement: 'dimanche' });
  const groupes = feuillesParPeriode((await domain()).ds.feuilles.filter(f => f.statut === 'validee' && !f.sage && f.empId === 1), (await domain()).ds.settings, '2026-10-10');
  const c = C.transmissionSage(2, 1, groupes);
  assert.match(c.question, /Marquer transmises à Sage Paie 2 feuilles validées \(1 salarié\)/);
  assert.ok(c.suites!.some(x => x === 'Rappel : 1 feuille de septembre 2026, période close, part sur octobre 2026.'), c.suites!.join(' | '));
  assert.ok(c.suites!.some(x => x.startsWith('Simulation : rien n’est envoyé à Sage Paie')));
  assert.ok(c.suites!.some(x => /samedi et dimanche compris/.test(x)));
  assert.match(String(await run(PAIE, 'temps.pushSage', {})), /· période octobre 2026 · rappel de septembre 2026 · 5 absences · 3 séjours \(déplacements\) · \d+ éléments à saisir dans Sage \(rubrique désactivée ou réglage décoché : voir le résumé du lot\)$/);
  const push = (await dernierLot(db)).contenu!;
  // Camille (1) : matricule de paie 004101.
  assert.deepEqual(push.lignes.filter(l => l.matricule === '004101').map(l => [l.semaine, l.periode, l.periode_origine ?? null]),
    [['2026-S39', '2026-10', '2026-09'], ['2026-S40', '2026-10', null]]);
  // Ventilation jour par jour : la semaine du 28 septembre, rappel pour lundi à mercredi et part ordinaire pour jeudi et
  // vendredi, ne compte qu'une feuille dans la période d'octobre.
  const cj = C.transmissionSage(1, 1, feuillesParPeriode([sh], { periodeRattachement: 'jour', clotureJour: 0 }, '2026-10-10'));
  assert.match(cj.question, /Marquer transmises à Sage Paie 1 feuille validée \(1 salarié\)/);
  assert.ok(cj.suites!.includes('Période de paie : octobre 2026 (1 feuille).'), cj.suites!.join(' | '));
  assert.ok(cj.suites!.includes('Rappel : 1 feuille de septembre 2026, période close, part sur octobre 2026.'), cj.suites!.join(' | '));
  // Plusieurs feuilles, dont une ventilée : deux feuilles distinctes en octobre.
  const deux = feuillesParPeriode([sh, { empId: 2, week: '2026-10-05' }], { periodeRattachement: 'jour', clotureJour: 0 }, '2026-10-10');
  assert.ok(C.transmissionSage(2, 2, deux).suites!.includes('Période de paie : octobre 2026 (2 feuilles).'));
});
