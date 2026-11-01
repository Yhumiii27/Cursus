// Lecture incrémentale (lot 9, chantier 2, étape 2 ; server/src/delta.ts, server/src/cache-instantane.ts), sur le moteur
// de la suite (SQLite par défaut, PostgreSQL avec npm run test:pg) :
// - après chaque écriture d'un scénario scripté (méthodes génériques, SQL direct, plusieurs lignes, upsert, réglages,
//   tables à clé texte ou triées par une autre colonne, marqueur « toute la table », envois des relevés, remise à zéro) :
//   `appliquerDelta(brutN, lireDelta(…))` est la lecture brute relue en entier, et `assembler` en tire le même
//   instantané ; rien de `brutN` n'est modifié (gelé), les tables inchangées sont reprises par identité ;
// - l'entrée du cache d'une révision nouvelle est dérivée de la précédente par le delta, sans relecture complète, et
//   relue en entier quand l'écart est inconnu (purge, époque), quand l'entrée précédente est en échec, quand la révision
//   est plus ancienne d'une autre époque, ou avec CURSUS_CACHE_INCREMENTAL=0 ; résumés de la paie repris tant qu'aucune
//   de leurs tables n'a changé ;
// - le jeu d'une action (`donneesAction`) est l'entrée plus le delta, égal à `loadFull` dans la même transaction ;
// - dans la transaction de chaque action d'absence et de certification, le jeu du suivi des verdicts (`jeuDeSuivi`)
//   est `loadFull(SUIVI)` ;
// - une même séquence d'actions jouée avec CURSUS_CACHE_INCREMENTAL=1 et avec CURSUS_CACHE_INSTANTANE=0 donne les mêmes
//   réponses (messages, alertes de validation), les mêmes verdicts en file et les mêmes tables finales ;
// - `remplacerFeuille` trouve la feuille par dichotomie ; préchauffage de l'entrée au démarrage ;
// - fenêtres de lecture (lot 12, socle : `FENETRES`) : lecture brute, delta par clé (ligne sortie de la fenêtre relue par
//   clé) et relecture complète limités à la fenêtre du jour, banc d'oracle exact avec une fenêtre ; un autre jour relit
//   l'entrée en entier, puis la dérive de nouveau ;
// - fenêtre des notes de frais (lot 12 — C2) : note, dépense et justificatif archivés relus par clé ou en entier, banc
//   d'oracle exact avec des notes archivées et les actions de frais en renfort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;
delete process.env.CURSUS_CACHE_INCREMENTAL;

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull, todayIso } = await import('../server/src/dataset.ts');
const { TABLES, TABLES_SANS_REVISION } = await import('../server/src/db.ts');
const { assembler, brutDe, FENETRES, lireBrut } = await import('../server/src/lecture-brute.ts');
const { appliquerDelta, lireDelta, positionCle, relectureComplete, SEUIL_RELECTURE } = await import('../server/src/delta.ts');
const { donneesAction, geler, incrementalActif, jeuApres, prechauffer, suiteEntree, viderCache } = await import('../server/src/cache-instantane.ts');
const { jeuDeSuivi, SUIVI } = await import('../server/src/integrations/keystone-verdicts.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { remplacerFeuille } = await import('../server/src/actions/temps.ts');
const { prechaufferCache } = await import('../server/src/demarrage.ts');
const { ouvrirBanc, rejouer } = await import('./support/oracle.ts');
const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Parameters<typeof loadFull>[1];
type Brut = Awaited<ReturnType<typeof lireBrut>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type TableName = keyof typeof TABLES;
type Pg = import('../server/src/db-pg.ts').PgDb;
type Changements = NonNullable<Awaited<ReturnType<Db['lireChangements']>>>;

const SEUL_PG = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };
const T = '2026-10-10';
const HSE: User = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Référent HSE', profilRh: 'referent_hse' };
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const PAIE: User = { role: 'rh', empId: null, nom: 'Paie', intitule: 'Gestionnaire de paie', profilRh: 'paie' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien de maintenance' };
const json = (x: unknown) => JSON.parse(JSON.stringify(x));

/** Base de démonstration, comptes compris, plus un relevé d'intérim dont l'e-mail est en file et un lot de paie. */
async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.tx(async () => await comptesDemo(db));
  await db.tx(async () => {
    const e = await db.insert<{ id: number }>('envois', { cible: 'email', type: 'releve', cle: 'essai-delta', contenu: {}, statut: 'a_envoyer', tentatives: 0, creation: '2026-10-09T08:00:00.000Z' });
    await db.insert('releves', { agence: 'Agence essai', semaine: '2026-10-05', adresse: 'agence@exemple.fr', creation: '2026-10-09T08:00:00.000Z', par: 'RH', envoiId: e.id, interimaires: 1, heures: 35, enAttente: 0 });
    await db.insert('lotsPaie', {
      cle: 'essai-delta', mode: 'fichier', statut: 'transmis', periode: '2026-09', periodes: ['2026-09'], creation: '2026-10-01T08:00:00.000Z', auteur: 'Essai',
      feuilles: [], resume: {}, contenu: { lignes: [] }, historique: false,
    });
  });
  return db;
}

/** Lectures complètes de la table des feuilles faites par `db` (espion sur `db.query`), remises à zéro par `zero`. */
function compterRelectures(db: Db): { n: () => number; zero: () => void; retirer: () => void } {
  let n = 0;
  const query = db.query.bind(db);
  db.query = (async (sql: string, params?: readonly never[]) => {
    if (/^\s*SELECT \* FROM feuilles\s+ORDER BY/i.test(sql)) n++;
    return await query(sql, params);
  }) as typeof db.query;
  return { n: () => n, zero: () => { n = 0; }, retirer: () => { delete (db as { query?: unknown }).query; } };
}

/**
 * Écriture `fn`, puis delta de `etat` (lecture brute et révision d'avant) à la révision suivante, appliqué et comparé à
 * la lecture brute relue en entier (même lecture stable) : lectures brutes égales, instantanés assemblés égaux. Rend le
 * nouvel état (lecture brute gelée) et la fusion.
 */
async function apres(db: Db, etat: { brut: Brut; n: number }, quoi: string, fn: () => Promise<unknown>) {
  await fn();
  return await db.lecture(async () => {
    const { n } = await db.etatRevision();
    const ch = await db.lireChangements(etat.n, n);
    assert.ok(ch, `${quoi} : écart connu`);
    const f = appliquerDelta(etat.brut, await lireDelta(db, etat.brut, ch));
    const ref = await lireBrut(db, T);
    assert.deepStrictEqual(f.brut, ref, `${quoi} : lecture brute`);
    assert.deepStrictEqual(assembler(f.brut, T, 1, HSE), assembler(ref, T, 1, HSE), `${quoi} : instantané assemblé`);
    return { etat: { brut: geler(f.brut), n }, f };
  });
}

/** Lecture brute gelée et révision de la base, lues ensemble. */
const depart = async (db: Db) => await db.lecture(async () => ({ n: (await db.etatRevision()).n, brut: geler(await lireBrut(db, T)) }));

test('delta fusionné : après chaque écriture d’un scénario scripté, la lecture brute relue en entier', async () => {
  const db = await demo();
  let etat = await depart(db);
  const brut0 = etat.brut;
  const ds = await loadFull(db, RH);
  const f0 = ds.feuilles[Math.floor(ds.feuilles.length / 2)];

  // Une feuille modifiée : nouveau tableau de feuilles, ligne remplacée ; le reste repris par identité.
  let x = await apres(db, etat, 'feuille modifiée', async () => await db.update('feuilles', f0.id, { comment: 'Delta' }));
  assert.notEqual(x.f.brut.feuilles, etat.brut.feuilles);
  assert.equal(x.f.brut.absences, etat.brut.absences, 'table inchangée reprise par identité');
  assert.equal(x.f.brut.feuilles[0], etat.brut.feuilles[0], 'ligne inchangée reprise par identité');
  assert.deepEqual([...x.f.tablesChangees], ['feuilles']);
  assert.ok(x.f.champsChanges.has('feuilles') && x.f.champsChanges.has('debutSaisieFeuilles') && !x.f.champsChanges.has('employes'));
  assert.deepEqual([...x.f.touches], [f0.empId]);
  assert.equal(x.f.paieReportee, false, 'feuilles : dépendance des résumés de la paie');
  etat = x.etat;

  // Feuille insérée (upsert en SQL direct), puis absence retirée et réinsérée à sa place (identifiant fixé, au milieu).
  x = await apres(db, etat, 'upsert feuilles', async () => await db.run(`INSERT INTO feuilles (emp_id, week, statut, comment, sage, keystone, lignes, contrat, heures_sup)
    VALUES (?, '2026-12-28', 'brouillon', 'Upsert', FALSE, FALSE, '[]', '{}', 'paiement') ON CONFLICT (emp_id, week) DO UPDATE SET comment = excluded.comment`, [ds.employes[0].id]));
  etat = x.etat;
  const a = ds.absences[Math.floor(ds.absences.length / 2)];
  x = await apres(db, etat, 'absence retirée', async () => await db.remove('absences', a.id));
  assert.equal(x.f.brut.absences.length, etat.brut.absences.length - 1);
  etat = x.etat;
  x = await apres(db, etat, 'absence réinsérée au milieu', async () => await db.insert('absences', { ...a, du: a.du, au: a.au }));
  assert.deepEqual(x.f.brut.absences.map(y => y.id), x.f.brut.absences.map(y => y.id).sort((p, q) => p - q), 'ordre de la clé');
  etat = x.etat;
  // Écriture qui ne change rien (même valeur) : lecture brute reprise telle quelle.
  x = await apres(db, etat, 'mise à jour sans effet', async () => await db.run('UPDATE absences SET statut = statut WHERE id = ?', [a.id]));
  assert.equal(x.f.brut, etat.brut);
  assert.deepEqual([...x.f.champsChanges], ['absencesPaie', 'deplacementsPaie'], 'seuls les résumés de la paie, qui lisent les absences en base');
  etat = x.etat;

  // Fiche et titres : jointure des employés refaite, salarié touché.
  x = await apres(db, etat, 'fiche', async () => await db.update('employes', 2, { nom: 'Mehdi Delta' }));
  assert.ok(x.f.champsChanges.has('employes') && x.f.champsChanges.has('annuaire'));
  assert.deepEqual([...x.f.touches], [2]);
  etat = x.etat;
  x = await apres(db, etat, 'certification', async () => await db.insert('certifications', { empId: 3, f: ds.referentiels.formations[0].id, obtenue: '2026-09-01' }));
  assert.deepEqual([...x.f.touches], [3]);
  etat = x.etat;
  // Table fermée à Matrix (marqueur « toute la table ») : relue en entier, salarié touché retrouvé par comparaison.
  x = await apres(db, etat, 'visa', async () => await db.insert('visas', { empId: 4, dest: 'MA', type: 'Affaires', obtenu: '2026-09-01', expire: '2027-09-01' }));
  assert.deepEqual([...x.f.touches], [4]);
  assert.equal(x.f.brut.employes, etat.brut.employes, 'fiches reprises (seule la table des visas a changé)');
  etat = x.etat;

  // Réglages : un réglage de l'instantané, puis un réglage qu'il ne lit pas (lecture brute inchangée).
  x = await apres(db, etat, 'réglage app', async () => await db.setSetting('app', { ...(await db.getSetting<object>('app', {})), horizonAlerte: 45 }));
  assert.ok(x.f.tablesChangees.has('settings') && x.f.champsChanges.has('settings') && !x.f.champsChanges.has('employes'));
  assert.equal(x.f.brut.reglages.calendrierFeries, etat.brut.reglages.calendrierFeries, 'réglage inchangé repris');
  etat = x.etat;
  x = await apres(db, etat, 'réglage hors instantané', async () => await db.setSetting('essaiDelta', 1));
  assert.equal(x.f.brut, etat.brut);
  assert.equal(x.f.paieReportee, false, 'les résumés de la paie lisent les réglages en base');
  etat = x.etat;
  x = await apres(db, etat, 'calendrier des fériés', async () => await db.setSetting('calendrierFeries', { 2026: { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: ['11_novembre'], le: '2026-01-05T08:00:00.000Z', par: 'Essai' } }));
  assert.ok(x.f.champsChanges.has('sessions') && x.f.champsChanges.has('calendrierFeries'));
  etat = x.etat;

  // Référentiels à clé texte ou triés par une autre colonne : relus en entier.
  x = await apres(db, etat, 'équipe (clé texte, ordre)', async () => await db.run('INSERT INTO equipes (nom, manager_id, ordre) VALUES (?, NULL, ?) ON CONFLICT (nom) DO UPDATE SET ordre = excluded.ordre', ['Équipe delta', -1]));
  assert.equal(x.f.brut.equipes[0].nom, 'Équipe delta', 'ordre de la colonne de tri');
  assert.equal(x.f.brut.formations, etat.brut.formations);
  etat = x.etat;
  x = await apres(db, etat, 'formation (clé texte)', async () => await db.update('formations', ds.referentiels.formations[0].id, { nom: 'Formation delta' }));
  etat = x.etat;
  x = await apres(db, etat, 'poste (trié par nom)', async () => await db.update('postes', ds.referentiels.postes[0].id, { nom: 'AAA poste delta' }));
  etat = x.etat;

  // Envois : statut de l'e-mail d'un relevé (relevé changé), envoi qu'aucun relevé ne désigne (rien ne change), relevé
  // ajouté avec son envoi ; table hors de l'instantané (notifications) : rien ne change, paie reportée.
  const envoiReleve = etat.brut.releves.find(r => r.envoiId)!.envoiId!;
  x = await apres(db, etat, 'statut d’un envoi de relevé', async () => await db.update('envois', envoiReleve, { statut: 'envoye' }));
  assert.ok(x.f.tablesChangees.has('envois') && x.f.champsChanges.has('releves') && !x.f.paieReportee);
  etat = x.etat;
  x = await apres(db, etat, 'envoi sans relevé', async () => await db.insert('envois', { cible: 'email', type: 'essai', cle: 'essai-delta-2', contenu: {}, statut: 'a_envoyer', tentatives: 0, creation: '2026-10-09T08:00:00.000Z' }));
  assert.equal(x.f.brut, etat.brut);
  assert.equal(x.f.paieReportee, true);
  etat = x.etat;
  x = await apres(db, etat, 'relevé et son envoi', async () => await db.tx(async () => {
    const e = await db.insert<{ id: number }>('envois', { cible: 'email', type: 'releve', cle: 'essai-delta-3', contenu: {}, statut: 'echec', tentatives: 1, creation: '2026-10-09T08:00:00.000Z' });
    await db.insert('releves', { agence: 'Agence delta', semaine: '2026-10-05', adresse: 'delta@exemple.fr', creation: '2026-10-09T08:00:00.000Z', par: 'RH', envoiId: e.id, interimaires: 1, heures: 7, enAttente: 0 });
  }));
  assert.equal(x.f.brut.releves.length, etat.brut.releves.length + 1);
  etat = x.etat;
  x = await apres(db, etat, 'notification', async () => await db.insert('notifications', { empId: 2, adresse: 'm@exemple.fr', type: 'essai', objet: 'Essai', texte: 'Essai', creation: '2026-10-09T08:00:00.000Z' }));
  assert.equal(x.f.brut, etat.brut);
  assert.equal(x.f.paieReportee, true);
  etat = x.etat;
  // Lot de paie : seul le contenu (jamais lu par l'instantané) change ; les résumés de la paie, qui le lisent, non reportés.
  const lot = etat.brut.lotsPaie.at(-1)!;
  x = await apres(db, etat, 'contenu d’un lot', async () => await db.update('lotsPaie', lot.id, { contenu: { lignes: [{ x: 1 }] } }));
  assert.equal(x.f.brut, etat.brut);
  assert.ok(!('contenu' in x.f.brut.lotsPaie.at(-1)!), 'contenu jamais dans la lecture brute');
  assert.equal(x.f.paieReportee, false);
  etat = x.etat;
  x = await apres(db, etat, 'lot de paie', async () => await db.update('lotsPaie', lot.id, { reference: 'REF-DELTA', contenu: { lignes: [{ x: 2 }] } }));
  assert.ok(!('contenu' in x.f.brut.lotsPaie.at(-1)!));
  etat = x.etat;

  // Plusieurs lignes d'une instruction, toute la table, plusieurs révisions d'un coup, remise à zéro.
  x = await apres(db, etat, 'plusieurs feuilles', async () => await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', ['Reprise delta', 2]));
  etat = x.etat;
  x = await apres(db, etat, 'toutes les feuilles', async () => await db.run('UPDATE feuilles SET comment = ?', ['Toutes']));
  etat = x.etat;
  x = await apres(db, etat, 'plusieurs révisions', async () => {
    await db.update('employes', 3, { nom: 'Révision 1' });
    await db.update('employes', 3, { nom: 'Révision 2' });
    await db.remove('feuilles', etat.brut.feuilles.at(-1)!.id);
  });
  etat = x.etat;
  x = await apres(db, etat, 'remise à zéro', async () => await db.clearAll());
  assert.equal(x.f.brut.feuilles.length, 0);
  // Rien de la lecture brute de départ n'a été modifié (gelée) : relue, elle est celle d'avant le scénario.
  assert.ok(Object.isFrozen(brut0.feuilles) && brut0.feuilles.length === ds.feuilles.length);
});

test('relecture complète : clé texte, colonne de tri, marqueur, plus de 2 000 clés ; dichotomie sur la clé entière', () => {
  const cles = (n: number) => new Set(Array.from({ length: n }, (_, i) => String(i + 1)));
  assert.equal(relectureComplete('feuilles', cles(3)), false);
  assert.equal(relectureComplete('feuilles', 'tout'), true);
  assert.equal(relectureComplete('feuilles', cles(SEUIL_RELECTURE + 1)), true);
  assert.equal(relectureComplete('feuilles', cles(SEUIL_RELECTURE)), false);
  for (const t of ['formations', 'habilitations', 'destinations', 'equipes', 'horaires', 'projets', 'chantiers', 'rubriquesPaie'] as TableName[]) assert.equal(relectureComplete(t, cles(1)), true, t);
  assert.equal(relectureComplete('postes', cles(1)), true, 'clé entière, mais triés par nom');
  const lignes = [1, 3, 5, 9].map(id => ({ id }));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 10].map(k => positionCle(lignes, 'id', k)), [0, 0, 1, 1, 2, 2, 3, 4]);
  assert.equal(positionCle([], 'id', 4), 0);
});

test('entrée du cache dérivée par le delta, sans relecture ; repli complet sur un écart inconnu ; paie reportée', async () => {
  const db = await demo();
  const espion = compterRelectures(db);
  try {
    const enCache = async (u: User) => await db.lecture(async () => await buildSnapshot(db, u));
    const verifier = async (quoi: string) => {
      for (const u of [RH, PAIE, MEHDI]) assert.deepStrictEqual(json(await enCache(u)), json(await buildSnapshot(db, u, { cache: false })), `${quoi} ${u.profilRh ?? u.role}`);
    };
    await enCache(RH);
    espion.zero();
    // Écritures successives : chaque entrée dérivée de la précédente, aucune relecture complète.
    await db.update('employes', 2, { nom: 'Mehdi Cache' });
    await verifier('fiche');
    let suite = await suiteEntree(db);
    assert.ok(suite && suite.champsChanges.has('employes') && suite.touches.has(2));
    const feuille = (await loadFull(db, HSE)).feuilles.find(f => f.empId === 2)!;
    await db.update('feuilles', feuille.id, { comment: 'Cache' });
    await verifier('feuille');
    // Les lectures directes de la vérification (cache: false) relisent ; l'entrée, jamais.
    espion.zero();
    await db.update('feuilles', feuille.id, { comment: 'Cache 2' });
    await enCache(MEHDI);
    await enCache(RH);
    assert.equal(espion.n(), 0, 'entrée dérivée, sans relecture complète');
    suite = await suiteEntree(db);
    assert.deepEqual([...suite!.touches], [2]);

    // Paie : résumés repris par l'entrée suivante si aucune de leurs tables n'a changé (requêtes sur deplacements_paie).
    let paie = 0;
    const query = db.query;
    db.query = (async (sql: string, params?: readonly never[]) => {
      if (/deplacements_paie/i.test(sql)) paie++;
      return await query(sql, params);
    }) as typeof db.query;
    await enCache(PAIE);
    paie = 0;
    await db.insert('notifications', { empId: 2, adresse: 'm@exemple.fr', type: 'essai', objet: 'Essai', texte: 'Essai', creation: '2026-10-09T08:00:00.000Z' });
    await enCache(PAIE);
    assert.equal(paie, 0, 'résumés de la paie repris');
    await db.update('absences', (await loadFull(db, HSE)).absences[0].id, { justificatif: true });
    await enCache(PAIE);
    assert.ok(paie > 0, 'absence changée : résumés recalculés');
    db.query = query;
    await verifier('paie');

    // Écarts inconnus : purge du journal, autre époque ; entrée précédente en échec ; révision plus ancienne d'une autre
    // époque : relecture complète.
    const relu = async (quoi: string, fn: () => Promise<unknown>, attendu = 1) => {
      await fn();
      espion.zero();
      await enCache(RH);
      assert.equal(espion.n(), attendu, quoi);
    };
    await relu('purge', async () => {
      await db.update('employes', 2, { nom: 'Purge' });
      await db.run('UPDATE revision SET purge = n');
    });
    await relu('époque', async () => {
      await db.update('employes', 2, { nom: 'Époque' });
      await db.run('UPDATE revision SET epoque = epoque + 1');
    });
    await relu('même révision, autre époque', async () => await db.run('UPDATE revision SET epoque = epoque + 1'));
    await relu('révision plus ancienne, autre époque', async () => await db.run('UPDATE revision SET n = n - 1, epoque = epoque + 1'));
    await relu('révision plus ancienne, même époque : entrée récente servie', async () => await db.run('UPDATE revision SET n = n - 1'), 0);
    await db.run('UPDATE revision SET n = n + 1');
    // Entrée précédente en échec : la suivante relit tout.
    viderCache(db);
    await assert.rejects(db.lecture(async () => await (await import('../server/src/cache-instantane.ts')).vueEnCache(db, RH, T, 1, async () => { throw new Error('occupé'); }, f => f)), /occupé/);
    await relu('entrée en échec', async () => await db.update('employes', 2, { nom: 'Échec' }));
    // Lecture sans lecture brute retenue (lecteur fourni par l'appelant) : la suivante relit tout.
    viderCache(db);
    await db.lecture(async () => await (await import('../server/src/cache-instantane.ts')).vueEnCache(db, RH, T, 1, async u => ({ ...await loadFull(db, u) }), f => f));
    await relu('sans lecture brute', async () => await db.update('employes', 2, { nom: 'Sans brute' }));
    // CURSUS_CACHE_INCREMENTAL=0 : relecture complète à chaque révision.
    assert.equal(incrementalActif({}), true);
    assert.equal(incrementalActif({ CURSUS_CACHE_INCREMENTAL: '0' }), false);
    process.env.CURSUS_CACHE_INCREMENTAL = '0';
    try {
      await relu('cache incrémental coupé', async () => await db.update('employes', 2, { nom: 'Coupé' }));
      await relu('cache incrémental coupé, encore', async () => await db.update('employes', 2, { nom: 'Coupé 2' }));
    } finally {
      delete process.env.CURSUS_CACHE_INCREMENTAL;
    }
    // Repris ensuite par le delta (l'entrée lue sans le cache incrémental n'a pas de lecture brute : une relecture d'abord).
    await relu('reprise du cache incrémental', async () => await db.update('employes', 2, { nom: 'Repris' }));
    await relu('delta à nouveau', async () => await db.update('employes', 2, { nom: 'Delta' }), 0);
    await verifier('fin');
    viderCache(db);
    assert.equal(await suiteEntree(db), null);
  } finally {
    espion.retirer();
  }
});

test('jeu d’une action : entrée + delta lus dans la transaction, égal à loadFull ; jamais mis en cache', async () => {
  const db = await demo();
  let directes = 0;
  const lire = async (u: User) => { directes++; return await loadFull(db, u); };
  await db.lecture(async () => await buildSnapshot(db, RH));
  // Écritures d'autres requêtes depuis l'entrée : fiche, absence (paie), notification (paie reportée).
  await db.update('employes', 2, { nom: 'Écrit avant l’action' });
  for (const u of [RH, PAIE, MEHDI, HSE]) {
    await db.tx(async () => {
      const ds = await donneesAction(db, u, T, lire);
      assert.deepStrictEqual(json({ ...ds, revision: 0 }), json({ ...await loadFull(db, u), revision: 0 }), u.profilRh ?? u.role);
    });
  }
  await db.update('absences', (await loadFull(db, HSE)).absences[0].id, { justificatif: true });
  await db.lecture(async () => await buildSnapshot(db, PAIE));
  await db.insert('notifications', { empId: 2, adresse: 'm@exemple.fr', type: 'essai', objet: 'Essai', texte: 'Essai', creation: '2026-10-09T08:00:00.000Z' });
  await db.tx(async () => {
    const ds = await donneesAction(db, PAIE, T, lire);
    assert.deepStrictEqual(json({ ...ds, revision: 0 }), json({ ...await loadFull(db, PAIE), revision: 0 }), 'résumés de la paie reportés');
  });
  assert.equal(directes, 0, 'aucune lecture directe');
  // Jeu d'une action, dérivé : jeuApres en dérive l'état après l'écriture de l'action ; jeu inconnu : null.
  await db.tx(async () => {
    const ds = await donneesAction(db, RH, T, lire);
    await db.update('employes', 3, { nom: 'Écrit par l’action' });
    assert.deepStrictEqual(json({ ...await jeuApres(db, ds, RH), revision: 0 }), json({ ...await loadFull(db, RH), revision: 0 }));
    assert.equal(await jeuApres(db, { ...ds }, RH), null, 'copie du jeu : départ inconnu');
  });
  // Lecture directe (aucune entrée) : son départ est retenu aussi.
  viderCache(db);
  await db.tx(async () => {
    const ds = await donneesAction(db, RH, T, lire);
    await db.update('employes', 3, { nom: 'Écrit après une lecture directe' });
    assert.equal((await jeuApres(db, ds, HSE))!.employes.find(e => e.id === 3)!.nom, 'Écrit après une lecture directe');
  });
  assert.equal(directes, 1);
  // Cache coupé : ni entrée, ni départ.
  process.env.CURSUS_CACHE_INSTANTANE = '0';
  try {
    await db.tx(async () => assert.equal(await jeuApres(db, await donneesAction(db, RH, T, lire), RH), null));
  } finally {
    delete process.env.CURSUS_CACHE_INSTANTANE;
  }
  // Entrée en échec : lecture directe.
  viderCache(db);
  await assert.rejects(db.lecture(async () => await (await import('../server/src/cache-instantane.ts')).vueEnCache(db, RH, T, 1, async () => { throw new Error('occupé'); }, f => f)), /occupé/);
  directes = 0;
  await db.tx(async () => await donneesAction(db, RH, T, lire));
  assert.equal(directes, 1);
});

/** Paramètres des actions d'absence et de certification, tirés de l'état `ds` (salarié 2 et son équipe). */
function actionsAbsence(ds: Dataset): [string, Record<string, unknown>][] {
  const absence = (statut: string) => ds.absences.find(a => a.statut === statut && a.empId !== null);
  return [
    ['absence.demander', { empId: 2, kind: 'CP', du: '2026-11-16', au: '2026-11-17' }],
    ['absence.saisir', { empId: 3, nature: 'MALADIE', du: '2026-10-12', au: '2026-10-13' }],
    ['absence.signaler', { empId: 4, du: '2026-10-09', au: '2026-10-09' }],
    ['absence.decider', { id: absence('demandee')?.id ?? 0, ok: true }],
    ['absence.qualifier', { id: absence('signalee')?.id ?? 0, nature: 'MALADIE' }],
    ['absence.prolonger', { id: ds.absences.find(a => a.statut === 'validee' && !['CP', 'RTT', 'RECUP'].includes(a.type))?.id ?? 0, au: '2026-12-31' }],
    ['absence.annuler', { id: absence('validee')?.id ?? 0 }],
    ['cert.ajouter', { empId: 2, f: ds.referentiels.formations[0].id, date: '2026-09-15' }],
  ];
}

test('suivi des verdicts : dans la transaction de chaque action d’absence, son jeu est loadFull(SUIVI)', async () => {
  const db = await demo();
  await db.lecture(async () => await buildSnapshot(db, RH));
  let faites = 0, derivees = 0;
  for (const [nom] of actionsAbsence(await loadFull(db, RH))) {
    // Paramètres tirés de l'état du moment (une absence décidée n'est plus à décider).
    const p = actionsAbsence(await loadFull(db, RH)).find(([n]) => n === nom)![1];
    try {
      await db.tx(async () => {
        const jeu = await donneesAction(db, RH, todayIso(), async u => await loadFull(db, u));
        await ACTIONS[nom](makeCtx(db, RH, jeu), p);
        if (await jeuApres(db, jeu, SUIVI)) derivees++;
        assert.deepStrictEqual(await jeuDeSuivi(db, jeu), await loadFull(db, SUIVI), nom);
        assert.deepStrictEqual(await jeuDeSuivi(db), await loadFull(db, SUIVI), `${nom} : sans départ`);
      });
      faites++;
    } catch (err) {
      if (!(err instanceof ActionError)) throw err;
    }
    // Instantané relu après l'action (comme la réponse) : l'entrée suit la base.
    await db.lecture(async () => await buildSnapshot(db, RH));
  }
  assert.ok(faites >= 6, `${faites} actions faites`);
  assert.equal(derivees, faites, 'jeu des verdicts dérivé, sans relecture');
});

/** Contenu de toutes les tables suivies, horodatages, identifiants tirés au hasard et pièces d'agenda remplacés (sessions, journal et comptes exclus). */
async function tables(db: Db): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of Object.keys(TABLES) as TableName[]) {
    if (TABLES_SANS_REVISION.has(t)) continue;
    out[t] = JSON.parse(JSON.stringify(await db.all(t)).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'horodatage')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'uuid')
      // Pièce jointe d'agenda (ICS) d'un e-mail : DTSTAMP et SEQUENCE tirés de l'heure de l'envoi.
      .replace(/"base64":"[^"]*"/g, '"base64":"pièce"'));
  }
  return out;
}

/**
 * Séquence d'actions scriptée, jouée par l'application (POST /api/actions) : saisie et soumission du salarié 2, validation
 * par son manager (alertes de validation), absences et certification par le service RH. Rend les réponses (statut,
 * message, résultat, erreur), les lectures complètes des feuilles faites par l'application pendant les actions et les
 * instantanés qui les suivent (après un premier instantané lu avant la séquence), et le nombre d'entrées du cache
 * dérivées par le delta : le chemin incrémental est bien celui qu'emprunte l'application.
 */
async function sequence(db: Db): Promise<{ reponses: unknown[]; actions: number; relectures: number; derivees: number }> {
  // Contingent annuel abaissé : la validation dépasse le contingent (alerte, contrepartie obligatoire en repos).
  await db.setSetting('app', { ...await db.getSetting<object>('app', {}), contingentHeuresSup: 5 });
  const banc = await ouvrirBanc(db);
  try {
    const acteur = async (garder: (u: User) => boolean) => {
      for (const a of banc.acteurs) {
        const u = await currentUser(db, { id: 'essai', compteId: a.compteId, role: a.role, methode: 'local' } as never);
        if (u && garder(u)) return a;
      }
      throw new Error('aucun acteur');
    };
    const ds = await loadFull(db, RH);
    const equipe = ds.employes.find(e => e.id === 2)!.equipe;
    const manager = ds.referentiels.equipes.find(q => q.nom === equipe)!.managerId;
    const mehdi = await acteur(u => u.role === 'collaborateur' && u.empId === 2);
    const chef = await acteur(u => u.role === 'manager' && u.empId === manager);
    const rh = await acteur(u => u.role === 'rh' && u.profilRh === 'rh_admin');
    const semaine = '2026-10-05';
    const reponses: unknown[] = [];
    // Premier instantané (entrée du cache de départ), puis espion : seules les lectures de l'application sont comptées,
    // pas les `loadFull` du test qui tirent les paramètres.
    await fetch(`${banc.base}/api/data`, { headers: { cookie: rh.cookie, 'x-cursus-espace': rh.role } });
    const espion = compterRelectures(db);
    let compte = 0, actions = 0, derivees = 0;
    const agir = async (a: typeof rh, nom: string, p: Record<string, unknown>) => {
      const avant = espion.n();
      actions++;
      const res = await fetch(`${banc.base}/api/actions/${nom}`, {
        method: 'POST', headers: { cookie: a.cookie, 'x-cursus-espace': a.role, 'content-type': 'application/json' }, body: JSON.stringify(p),
      });
      const corps = await res.json() as { message?: string; result?: unknown; error?: string; data?: Dataset };
      reponses.push({ nom, statut: res.status, message: corps.message ?? null, result: corps.result ?? null, error: corps.error ?? null, feuilles: corps.data?.feuilles.length ?? null });
      // Instantané lu après l'action, comme le client.
      await fetch(`${banc.base}/api/data`, { headers: { cookie: a.cookie, 'x-cursus-espace': a.role } });
      compte += espion.n() - avant;
      if (await suiteEntree(db)) derivees++;
    };
    await agir(mehdi, 'temps.addLine', { empId: 2, week: semaine, projet: ds.referentiels.projets.find(x => x.statut !== 'archive' && !x.code.startsWith('INT'))!.code });
    for (let di = 0; di < 5; di++) await agir(mehdi, 'temps.setCell', { empId: 2, week: semaine, li: 0, di, value: '11' });
    // Plus de 10 h par jour et de 48 h dans la semaine : motif exigé, alertes de validation (durées, contingent).
    await agir(mehdi, 'temps.submit', { empId: 2, week: semaine, motif: 'Arrêt technique' });
    await agir(chef, 'temps.validate', { empId: 2, week: semaine, motif: 'Arrêt technique' });
    for (const [nom, p] of actionsAbsence(await loadFull(db, RH))) await agir(rh, nom, p);
    await agir(chef, 'temps.validerLot', { feuilles: (await loadFull(db, RH)).feuilles.filter(f => f.statut === 'soumise').slice(0, 3).map(f => ({ empId: f.empId, week: f.week })) });
    espion.retirer();
    return { reponses, actions, relectures: compte, derivees };
  } finally {
    banc.fermer();
  }
}

test('même séquence, cache incrémental et sans cache : mêmes réponses, alertes, verdicts en file et tables finales', async () => {
  const jouer = async (env: Record<string, string>) => {
    Object.assign(process.env, env);
    try {
      const db = await demo();
      return { ...await sequence(db), tables: await tables(db) };
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  };
  const inc = await jouer({ CURSUS_CACHE_INCREMENTAL: '1' });
  const sans = await jouer({ CURSUS_CACHE_INSTANTANE: '0' });
  assert.deepStrictEqual(inc.reponses, sans.reponses);
  // Chemin incrémental réellement emprunté par l'application : aucune relecture complète des feuilles (entrée, jeu de
  // l'action, suivi des verdicts), chaque instantané d'après action dérivé par le delta ; sans cache, au moins une
  // relecture par action.
  assert.equal(inc.relectures, 0, 'cache incrémental : aucune relecture complète');
  assert.equal(inc.derivees, inc.actions, 'cache incrémental : entrées dérivées par le delta');
  assert.ok(sans.relectures >= sans.actions, `sans cache : ${sans.relectures} relectures pour ${sans.actions} actions`);
  assert.equal(sans.derivees, 0);
  const valide = (inc.reponses as { nom: string; statut: number; message: string }[]).find(r => r.nom === 'temps.validate')!;
  assert.equal(valide.statut, 200, 'feuille validée');
  assert.match(valide.message, /contingent/i, 'alertes de validation (contingent dépassé)');
  assert.ok((inc.reponses as { statut: number }[]).filter(r => r.statut === 200).length >= 10, 'actions validées');
  assert.deepStrictEqual(inc.tables.verdictsKeystone, sans.tables.verdictsKeystone, 'verdicts');
  assert.deepStrictEqual(inc.tables.envois, sans.tables.envois, 'verdicts et e-mails en file');
  assert.deepStrictEqual(inc.tables, sans.tables);
});

test('même suite aléatoire (banc d’oracle, graine fixe) dans les deux modes : mêmes issues et mêmes tables finales', async () => {
  const jouer = async (env: Record<string, string>) => {
    Object.assign(process.env, env);
    try {
      const db = await demo();
      const rapport = await rejouer(db, { graine: 20261025, pas: 30, verifier: false });
      return { actions: rapport.actions, motifs: rapport.motifs, erreurs: rapport.erreurs, tables: await tables(db) };
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  };
  const inc = await jouer({ CURSUS_CACHE_INCREMENTAL: '1' });
  const sans = await jouer({ CURSUS_CACHE_INSTANTANE: '0' });
  assert.deepStrictEqual(inc.erreurs, []);
  assert.deepStrictEqual({ ...inc, tables: null }, { ...sans, tables: null });
  assert.deepStrictEqual(inc.tables, sans.tables);
});

test('remplacerFeuille : feuille trouvée par dichotomie sur l’identifiant, nouveau Domain ; autre ordre : parcours', async () => {
  const db = await demo();
  const ds = await loadFull(db, RH);
  const ctx = makeCtx(db, RH, ds);
  const f = ds.feuilles[7], ligne = { ...f, comment: 'Remplacée' };
  const d = ctx.d;
  remplacerFeuille(ctx, ligne);
  assert.equal(ctx.ds.feuilles[7], ligne);
  assert.equal(ctx.ds.feuilles.length, ds.feuilles.length);
  assert.equal(ctx.ds.feuilles[6], ds.feuilles[6]);
  assert.notEqual(ctx.d, d);
  assert.equal(ds.feuilles[7], f, 'jeu reçu jamais modifié');
  // Jeu dans un autre ordre (copie triée par semaine) : trouvée par le parcours complet.
  const autre = makeCtx(db, RH, { ...ds, feuilles: [...ds.feuilles].reverse() });
  remplacerFeuille(autre, ligne);
  assert.equal(autre.ds.feuilles.find(x => x.id === f.id), ligne);
  assert.equal(autre.ds.feuilles.length, ds.feuilles.length);
});

test('préchauffage : entrée lue avant les premières requêtes, sans relecture ensuite ; jamais sous node --test', async () => {
  const db = await demo();
  assert.equal(await prechaufferCache(db), false, 'sous node --test : rien');
  const contexte = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const espion = compterRelectures(db);
    try {
      assert.equal(await prechaufferCache(db), true);
      espion.zero();
      await db.lecture(async () => await buildSnapshot(db, MEHDI));
      assert.equal(espion.n(), 0, 'entrée préchauffée');
    } finally {
      espion.retirer();
    }
    // Échec (lecture impossible) : un avertissement, rien d'autre.
    const avertissements: string[] = [];
    viderCache(db);
    const lecture = db.lecture;
    db.lecture = (async () => { throw new Error('base occupée'); }) as typeof db.lecture;
    try {
      assert.equal(await prechaufferCache(db, m => avertissements.push(m)), false);
    } finally {
      db.lecture = lecture;
    }
    assert.match(avertissements[0], /Préchauffage du cache de l’instantané impossible : base occupée/);
    // Cache désactivé : rien n'est lu.
    process.env.CURSUS_CACHE_INSTANTANE = '0';
    try {
      assert.equal(await prechauffer(db, T, async u => await loadFull(db, u)), false);
    } finally {
      delete process.env.CURSUS_CACHE_INSTANTANE;
    }
  } finally {
    if (contexte !== undefined) process.env.NODE_TEST_CONTEXT = contexte;
  }
});

test('fenêtres de lecture (lot 12) : lecture brute, delta par clé et relecture complète dans la fenêtre du jour', async () => {
  const db = await demo();
  // Fenêtre d'essai : absences commençant au plus tôt le jour même (démonstration : 3 absences avant le 10 octobre 2026).
  FENETRES.absences = today => ({ where: 'du >= ?', params: [today] });
  try {
    let etat = await depart(db);
    const toutes = await db.all<{ id: number; du: string }>('absences');
    const dans = toutes.filter(a => a.du >= T);
    assert.ok(dans.length > 0 && dans.length < toutes.length, 'jeu de démonstration de part et d’autre de la fenêtre');
    assert.equal(etat.brut.jour, T);
    assert.deepEqual(etat.brut.absences.map(a => a.id), dans.map(a => a.id), 'lecture brute limitée à la fenêtre, dans l’ordre de la clé');
    assert.ok((await loadFull(db, HSE)).absences.every(a => a.du >= T), 'loadFull lit la fenêtre du jour');

    // Ligne hors de la fenêtre modifiée : relue par clé, elle ne rend rien ; la lecture brute est reprise telle quelle.
    const avant = toutes.find(a => a.du < T)!;
    let x = await apres(db, etat, 'ligne hors fenêtre', async () => await db.update('absences', avant.id, { justificatif: true }));
    assert.equal(x.f.brut, etat.brut);
    // Ligne qui sort de la fenêtre (date de début reculée) : retirée comme une ligne supprimée, relue par clé.
    const sortie = dans[0];
    x = await apres(db, x.etat, 'ligne sortie de la fenêtre', async () => await db.run('UPDATE absences SET du = ? WHERE id = ?', ['2026-09-01', sortie.id]));
    assert.equal(x.f.brut.absences.length, dans.length - 1);
    assert.ok(x.f.tablesChangees.has('absences') && x.f.touches.size > 0);
    // Puis qui y revient : insérée à sa place.
    x = await apres(db, x.etat, 'ligne revenue dans la fenêtre', async () => await db.run('UPDATE absences SET du = ? WHERE id = ?', [sortie.du, sortie.id]));
    assert.deepEqual(x.f.brut.absences.map(a => a.id), dans.map(a => a.id));
    etat = x.etat;

    // Relecture complète (marqueur « toute la table ») : dans la même fenêtre.
    await db.lecture(async () => {
      const f = appliquerDelta(etat.brut, await lireDelta(db, etat.brut, new Map([['absences', 'tout']]) as Changements));
      assert.deepStrictEqual(f.brut, await lireBrut(db, T));
    });

    // Banc d'oracle avec la fenêtre : lecture partagée, jeux d'action et réponses égaux à la relecture complète.
    const rapport = await rejouer(db, { graine: 20261101, pas: 12, verifierTous: 4, jeux: 0, sql: 0.3 });
    assert.deepEqual(rapport.divergences, []);
    assert.deepEqual(rapport.erreurs, []);
    assert.ok(rapport.ecritures > 0 && rapport.comparaisons > 0, 'le banc a écrit et comparé');
  } finally {
    delete FENETRES.absences;
  }
});

test('fenêtres de lecture (lot 12) : un changement de jour relit l’entrée en entier, puis la dérive de nouveau', async () => {
  const db = await demo();
  FENETRES.absences = today => ({ where: 'du >= ?', params: [today] });
  const espion = compterRelectures(db);
  const J2 = '2026-10-20';
  try {
    const enCache = async (u: User) => await db.lecture(async () => await buildSnapshot(db, u));
    const verifier = async (quoi: string) => {
      for (const u of [RH, MEHDI]) assert.deepStrictEqual(json(await enCache(u)), json(await buildSnapshot(db, u, { cache: false })), `${quoi} ${u.profilRh ?? u.role}`);
    };
    await enCache(RH);
    espion.zero();
    await db.update('employes', 2, { nom: 'Mehdi Jour' });
    await enCache(RH);
    assert.equal(espion.n(), 0, 'même jour : entrée dérivée');
    // Jour suivant, même révision : les absences sorties de la fenêtre par le seul passage du temps ne sont pas au journal
    // des changements ; l'entrée du nouveau jour est relue en entier.
    process.env.CURSUS_TODAY = J2;
    espion.zero();
    const ds = await enCache(RH);
    assert.equal(espion.n(), 1, 'autre jour : relecture complète');
    assert.equal(ds.today, J2);
    assert.ok(ds.absences.length > 0 && ds.absences.every(a => a.du >= J2), 'fenêtre du nouveau jour');
    assert.equal(brutDe(await loadFull(db, HSE))?.jour, J2);
    await verifier('nouveau jour');
    // Écriture suivante, le même jour : de nouveau dérivée par le delta, dans la fenêtre du nouveau jour.
    espion.zero();
    await db.update('employes', 2, { nom: 'Mehdi Jour 2' });
    await enCache(MEHDI);
    await enCache(RH);
    assert.equal(espion.n(), 0, 'puis dérivée');
    await verifier('dérivée le nouveau jour');
    // Jeu d'une action : départ du jour de son entrée ; une lecture brute d'un autre jour n'est jamais dérivée.
    await db.tx(async () => assert.ok((await donneesAction(db, RH, J2, async u => await loadFull(db, u))).absences.every(a => a.du >= J2)));
  } finally {
    process.env.CURSUS_TODAY = T;
    delete FENETRES.absences;
    espion.retirer();
    viderCache(db);
  }
});

// lot 12 — C2 (notes de frais : activation) : fenêtre de 13 mois après paiement, appliquée par la lecture complète, la
// relecture complète du delta (dépenses : marqueur « toute la table ») et la relecture par clé (notes, justificatifs).
test('fenêtre des notes de frais : delta par clé et relecture complète dans la fenêtre, banc d’oracle exact avec des notes archivées', async () => {
  const { notesArchivees } = await import('./support/frais-archives.ts');
  const db = await demo();
  const a = await notesArchivees(db);
  let etat = await depart(db);
  assert.ok(!etat.brut.notesFrais.some(n => n.id === a.archivee) && etat.brut.notesFrais.some(n => n.id === a.bord));
  // Note archivée modifiée hors de Cursus : relue par clé, elle ne rend rien ; la lecture brute est reprise telle quelle.
  let x = await apres(db, etat, 'note archivée modifiée', async () => await db.run('UPDATE notes_frais SET cree_par = ? WHERE id = ?', ['Reprise', a.archivee]));
  assert.equal(x.f.brut, etat.brut);
  // Justificatif d'une dépense archivée modifié : de même.
  x = await apres(db, x.etat, 'justificatif archivé modifié', async () => await db.run('UPDATE pieces SET nom = ? WHERE id = ?', ['reprise.pdf', a.pieceRepas]));
  assert.equal(x.f.brut, x.etat.brut);
  // Dépense archivée modifiée : table relue en entier (marqueur « toute la table »), dans la fenêtre.
  x = await apres(db, x.etat, 'dépense archivée modifiée', async () => await db.run('UPDATE lignes_frais SET commercant = ? WHERE id = ?', ['Reprise', a.repas]));
  assert.ok(!x.f.brut.lignesFrais.some(l => l.id === a.repas));
  // Justificatif détaché de sa dépense (comme l'effacement de la conservation, objet_id vidé) : il revient dans la fenêtre.
  const avant = x.etat.brut.pieces.length;
  x = await apres(db, x.etat, 'justificatif détaché', async () => await db.run('UPDATE pieces SET objet_id = NULL WHERE id = ?', [a.pieceRepas]));
  assert.equal(x.f.brut.pieces.length, avant + 1);
  etat = x.etat;
  // Note de la fenêtre payée (paiement du jour) : elle reste dans la fenêtre, ses dépenses aussi.
  x = await apres(db, etat, 'note payée ce jour', async () => await db.run(`UPDATE notes_frais SET statut = 'payee', payee_le = ? WHERE id = ?`, [T, 3]));
  assert.ok(x.f.brut.notesFrais.some(n => n.id === 3) && x.f.brut.lignesFrais.some(l => l.noteId === 3));

  // Banc d'oracle, actions de frais en renfort (dont celles qui visent une note archivée, refusées) : lecture partagée,
  // jeux d'action et réponses égaux à la relecture complète.
  const frais = Object.keys(ACTIONS).filter(n => n.startsWith('frais.') && n !== 'frais.export.generer');
  const rapport = await rejouer(db, { graine: 20261102, pas: 40, verifierTous: 4, jeux: 0, sql: 0.2, renfort: [...frais, ...frais] });
  assert.deepEqual(rapport.divergences, []);
  assert.deepEqual(rapport.erreurs, []);
  assert.ok(rapport.ecritures > 0 && rapport.comparaisons > 0, 'le banc a écrit et comparé');
  assert.ok(Object.keys(rapport.actions).some(n => n.startsWith('frais.') && rapport.actions[n].ok > 0), 'des actions de frais validées');
});

test('lecture brute retenue avec l’instantané complet : loadFull, entrée, jeu dérivé', async () => {
  const db = await demo();
  const ds = await loadFull(db, RH);
  assert.ok(brutDe(ds));
  assert.equal(brutDe({ ...ds }), undefined);
  assert.ok(Object.isFrozen(brutDe(ds)!.employes), 'lecture brute gelée sous node --test');
});

test('PostgreSQL : deux instances sur le même schéma, B lit par delta ce qu’écrit A, son entrée égale loadFull', SEUL_PG, async () => {
  const a = await demo() as unknown as Pg;
  const url = (a.pool as unknown as { options: { connectionString: string } }).options.connectionString;
  const b = await ouvrirPostgres(url, { schema: a.schema, env: process.env });
  try {
    const bDb = b as unknown as Db;
    await bDb.lecture(async () => await buildSnapshot(bDb, RH));
    const espion = compterRelectures(bDb);
    try {
      await a.update('employes', 2, { nom: 'Écrit par A' });
      await a.tx(async () => await a.update('feuilles', (await loadFull(a as unknown as Db, HSE)).feuilles[0].id, { comment: 'Écrit par A' }));
      const vue = await bDb.lecture(async () => await buildSnapshot(bDb, RH));
      assert.equal(espion.n(), 0, 'B : entrée dérivée par le delta');
      assert.equal(vue.employes.find(e => e.id === 2)!.nom, 'Écrit par A');
      assert.deepStrictEqual(json(vue), json(await buildSnapshot(bDb, RH, { cache: false })));
    } finally {
      espion.retirer();
    }
  } finally {
    await b.fermer();
  }
});
