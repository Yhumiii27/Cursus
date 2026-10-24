// Passage de la démonstration à la production (lot 8, chantier A) : marqueurs `demo` et `exploitation`
// (server/src/marqueurs.ts), règles de npm run purge-demo (server/src/purge-demo.ts) — options, preuve de
// démonstration, refus sans appel, ajouts des visiteurs, plan de suppression par profil, séquence des salariés —,
// aperçu à blanc sans effet sur la base (étape 1), puis exécution (étape 2, server/src/purge-demo-execution.ts) :
// service arrêté, sauvegarde préalable, transaction, pièces, copies, garde-fous du démarrage et de reset-demo.
// Sur SQLite en mémoire, et sur PostgreSQL par npm run test:pg.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { nouvelleBase, PG, schemaNeuf, SQLITE_SEUL, surServeur } = await import('./base.ts');
const { SqliteDb, TABLES } = await import('../server/src/db.ts');
type TableName = import('../server/src/db.ts').TableName;
type Db = import('../server/src/db.ts').Db;
const { seedDemo, SALARIES_DEMO } = await import('../server/src/seed.ts');
const { VERSION } = await import('../server/src/chemins.ts');
const { journaliser } = await import('../server/src/comptes.ts');
const { REFERENCES } = await import('../server/src/integrite.ts');
const { dossierPiecesDe } = await import('../server/src/pieces.ts');
const { sauvegarderBase } = await import('../server/src/sauvegarde.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { CLE_DEPUIS, CLE_JUSQUA } = await import('../server/src/absences-paie.ts');
const { CLE_DEPUIS_DEPLACEMENTS } = await import('../server/src/deplacements-paie.ts');
const { ouvrirPourApercu } = await import('../server/src/purge-demo-ouverture.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { HORAIRES_EXEMPLES } = await import('../shared/rules/horaires.ts');
const { refusDemo } = await import('../server/src/marqueurs.ts');
const {
  autresConnexionsCursus, derniereActivite, executerPurge, sauvegardePrealable, SauvegardePurgeImpossible, simulerPurge, texteBilan, texteSimulation, verifierPgDump,
} = await import('../server/src/purge-demo-execution.ts');
const { ACTION_PURGE_DEMO, exploitationAMarquer, marquerExploitation, REGLAGE_DEMO, REGLAGE_EXPLOITATION } = await import('../server/src/marqueurs.ts');
const {
  apercuPurge, confirmationPurgeTapee, controlerEnvironnementPurge, deciderPurge, lireOptionsPurge, motConfirmationPurge, orphelinesApres, planPurge,
  plusGrandIdEmploye, preuveDemo, prochainIdEmploye, PROFILS_PURGE, PurgeRefusee, REGLAGES_SUPPRIMES_PARAMETRAGE, releverBase, texteApercu,
} = await import('../server/src/purge-demo.ts');

const refus = (re: RegExp) => (e: unknown) => e instanceof PurgeRefusee && re.test(e.message);
const OPTIONS = { garder: 'parametrage' as const, comptes: [] as string[], inclureAjouts: false };

async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  return db;
}

/** Nombre de lignes de chaque table et réglages : ce que l'aperçu à blanc ne doit pas changer. */
async function etat(db: Db) {
  const out: Record<string, unknown> = {};
  for (const t of Object.keys(TABLES) as TableName[]) out[t] = await db.count(t);
  out.reglages = await db.query('SELECT key FROM settings ORDER BY key');
  out.sequence = await plusGrandIdEmploye(db);
  return out;
}

const ajouterFiche = async (db: Db, id: number, at: string) => {
  await db.insert('employes', { id, nom: 'Visiteur Ajouté', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  await journaliser(db, { actor: 'Sandrine Vidal', role: 'rh', action: 'employe.creer', message: 'Création', salaries: [id], at });
};

test('marqueur demo : le chargement du jeu pose le réglage demo (instant, version), à chaque chargement', async () => {
  const db = await nouvelleBase();
  const avant = Date.now();
  await seedDemo(db);
  const m = await db.getSetting<{ chargeeLe: string; version: string } | null>(REGLAGE_DEMO, null);
  assert.ok(m && m.version === VERSION && Date.parse(m.chargeeLe) >= avant - 1000, JSON.stringify(m));
  assert.equal(SALARIES_DEMO.length, 24);
  assert.deepEqual(SALARIES_DEMO[0], { id: 1, nom: 'Camille Roux' });
});

test('marqueur exploitation : posé une fois au premier démarrage en production hors démonstration, jamais réécrit', async () => {
  assert.equal(exploitationAMarquer({ NODE_ENV: 'production' }), true);
  assert.equal(exploitationAMarquer({ NODE_ENV: 'production', CURSUS_DEMO: '1' }), false, 'démonstration publiée');
  assert.equal(exploitationAMarquer({ NODE_ENV: 'production', CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1' }), false, 'application de bureau');
  assert.equal(exploitationAMarquer({}), false, 'développement');
  assert.equal(exploitationAMarquer({ NODE_ENV: 'test' }), false);
  const db = await nouvelleBase();
  assert.equal(await marquerExploitation(db, '9.9.9', { NODE_ENV: 'development' }), false);
  assert.equal(await db.get('settings', REGLAGE_EXPLOITATION), undefined);
  // Base vide comprise.
  assert.equal(await marquerExploitation(db, '9.9.9', { NODE_ENV: 'production' }, new Date('2027-01-02T07:00:00Z')), true);
  assert.equal(await marquerExploitation(db, '9.9.10', { NODE_ENV: 'production' }, new Date('2027-01-03T07:00:00Z')), false);
  assert.deepEqual(await db.getSetting(REGLAGE_EXPLOITATION, null), { premierDemarrageHorsDemo: '2027-01-02T07:00:00.000Z', version: '9.9.9' });
});

test('options : défauts, valeurs, répétition de --garder-compte, options inconnues et valeurs manquantes refusées', () => {
  assert.deepEqual(lireOptionsPurge([]), {
    aBlanc: false, garder: 'parametrage', comptes: [], inclureAjouts: false, oui: false, force: false, sauvegarde: null, supprimerCopies: false,
  });
  assert.deepEqual(lireOptionsPurge(['--a-blanc', '--garder', 'catalogue', '--garder-compte', 'rh@x.fr', '--garder-compte', '12', '--inclure-ajouts', '--yes', '--force',
    '--sauvegarde', '/srv/cursus.dump', '--supprimer-copies-demo']), {
    aBlanc: true, garder: 'catalogue', comptes: ['rh@x.fr', '12'], inclureAjouts: true, oui: true, force: true, sauvegarde: '/srv/cursus.dump', supprimerCopies: true,
  });
  assert.equal(lireOptionsPurge(['--garder', 'rien']).garder, 'rien');
  assert.throws(() => lireOptionsPurge(['--oui']), refus(/option inconnue --oui\. Usage : npm run purge-demo/));
  assert.throws(() => lireOptionsPurge(['--a-blanc', 'fichier.db']), refus(/option inconnue fichier\.db/));
  assert.throws(() => lireOptionsPurge(['--garder', 'tout']), refus(/profil inconnu « tout » : parametrage, catalogue ou rien/));
  assert.throws(() => lireOptionsPurge(['--garder']), refus(/--garder attend une valeur/));
  assert.throws(() => lireOptionsPurge(['--garder-compte', '--yes']), refus(/--garder-compte attend une valeur/));
  assert.throws(() => lireOptionsPurge(['--sauvegarde']), refus(/--sauvegarde attend une valeur/));
});

test('environnement et confirmation : CURSUS_DEMO_PUBLIQUE refusée, CURSUS_DEMO sans effet, mot PRODUCTION <nombre>', () => {
  assert.throws(() => controlerEnvironnementPurge({ CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1' }), refus(/CURSUS_DEMO_PUBLIQUE est posée/));
  assert.throws(() => controlerEnvironnementPurge({ CURSUS_DEMO_PUBLIQUE: '0' }), refus(/CURSUS_DEMO_PUBLIQUE/));
  assert.doesNotThrow(() => controlerEnvironnementPurge({ CURSUS_DEMO: '1', NODE_ENV: 'production' }));
  assert.doesNotThrow(() => controlerEnvironnementPurge({ CURSUS_DEMO_PUBLIQUE: ' ' }));
  assert.equal(motConfirmationPurge(24), 'PRODUCTION 24');
  assert.equal(confirmationPurgeTapee('  PRODUCTION 24 ', 24), true);
  for (const r of ['PRODUCTION', 'production 24', 'PRODUCTION 25', '', null, undefined]) assert.equal(confirmationPurgeTapee(r, 24), false, String(r));
});

test('preuve de démonstration : marqueur, sinon faisceau d’indices complet (bases chargées avant le lot), sinon refus', async () => {
  const db = await demo();
  let c = await releverBase(db);
  assert.equal(c.moteur, PG ? 'pg' : 'sqlite');
  assert.deepEqual(c.indices, { salariesDuJeu: 24, comptesDuJeu: 25, domaineDemo: true, lotDemo: true });
  assert.equal(preuveDemo(c), 'marqueur');
  assert.deepEqual(deciderPurge(c, OPTIONS), { statut: 'possible', preuve: 'marqueur', aLever: [] });
  // Base chargée avant le marqueur : le faisceau suffit, même avec quelques fiches renommées ou anonymisées.
  await db.remove('settings', REGLAGE_DEMO);
  for (const id of [1, 2, 3, 4]) await db.update('employes', id, { nom: `Anonyme ${id}` });
  c = await releverBase(db);
  assert.equal(c.indices.salariesDuJeu, 20);
  assert.equal(preuveDemo(c), 'faisceau');
  assert.equal(deciderPurge(c, OPTIONS).statut, 'possible');
  // Un indice manquant : plus de preuve.
  await db.update('employes', 5, { nom: 'Anonyme 5' });
  const d = deciderPurge(await releverBase(db), OPTIONS);
  assert.equal(d.statut, 'refusee');
  assert.match(d.statut === 'refusee' ? d.motifs.join(' ') : '', /rien ne prouve que la base est une démonstration.*salariés du jeu 19\/24, au moins 20 attendus/);
  for (const indices of [{ comptesDuJeu: 0 }, { domaineDemo: false }, { lotDemo: false }]) {
    assert.equal(preuveDemo({ demo: null, indices: { salariesDuJeu: 24, comptesDuJeu: 25, domaineDemo: true, lotDemo: true, ...indices } }), null, JSON.stringify(indices));
  }
  // Base vide (production neuve) : refus.
  const vide = await releverBase(await nouvelleBase());
  assert.equal(deciderPurge(vide, OPTIONS).statut, 'refusee');
});

test('refus sans appel : base exploitée, reprise sur le serveur commun, compte Microsoft réel ; purge déjà faite : idempotente', async () => {
  const db = await demo();
  await marquerExploitation(db, '0.1.0', { NODE_ENV: 'production' }, new Date('2026-10-20T08:00:00Z'));
  let d = deciderPurge(await releverBase(db), { inclureAjouts: true });
  assert.equal(d.statut, 'refusee');
  assert.match(d.statut === 'refusee' ? d.motifs[0] : '', /la base a servi en production \(premier démarrage hors démonstration le 2026-10-20T08:00:00\.000Z, version 0\.1\.0\) : elle ne se purge jamais/);
  await db.remove('settings', REGLAGE_EXPLOITATION);

  await journaliser(db, { actor: 'Cursus', role: null, action: 'migration.postgres', message: 'Reprise', at: '2026-10-21T08:00:00.000Z' });
  d = deciderPurge(await releverBase(db), OPTIONS);
  assert.match(d.statut === 'refusee' ? d.motifs.join(' ') : '', /reprise sur le serveur PostgreSQL commun le 2026-10-21T08:00:00\.000Z/);
  await db.run('DELETE FROM journal');

  // Compte Microsoft connecté avec une adresse réelle : refus ; avec une adresse du domaine de démonstration : admis.
  const rh = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL'))!;
  await db.update('comptes', rh.id, { oid: '00000000-0000-0000-0000-000000000001' });
  assert.equal(deciderPurge(await releverBase(db), OPTIONS).statut, 'possible');
  await db.update('comptes', rh.id, { identifiant: 'rh@epc2i.fr' });
  d = deciderPurge(await releverBase(db), OPTIONS);
  assert.match(d.statut === 'refusee' ? d.motifs.join(' ') : '', /1 compte Microsoft s’est connecté avec une adresse hors de entreprise\.example/);
  await db.update('comptes', rh.id, { oid: null });

  await journaliser(db, { actor: 'Ligne de commande (npm run purge-demo)', role: null, action: ACTION_PURGE_DEMO, message: 'Purge faite', at: '2026-12-15T08:00:00.000Z' });
  await marquerExploitation(db, '0.1.0', { NODE_ENV: 'production' });
  assert.deepEqual(deciderPurge(await releverBase(db), OPTIONS), { statut: 'deja-faite', le: '2026-12-15T08:00:00.000Z', message: 'Purge faite' });
});

test('ajouts des visiteurs : listés avec nombre et dates ; fiches ajoutées purgées seulement avec --inclure-ajouts ; reprise en démonstration admise', async () => {
  const db = await demo();
  let c = await releverBase(db);
  for (const a of Object.values(c.ajouts)) assert.equal(a.nombre, 0);
  await ajouterFiche(db, 25, '2026-10-12T09:00:00.000Z');
  await ajouterFiche(db, 26, '2026-10-14T09:00:00.000Z');
  await db.insert('employes', { id: 27, nom: 'Sans trace', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  await db.insert('reprises', { type: 'salaries', le: '2026-10-13T10:00:00.000Z', par: 'Sandrine Vidal', fichier: 'lucca.csv', colonnes: [], options: {}, lignes: 2, crees: 2, majs: 0, ignorees: 0, refusees: 0, rapport: [] });
  await db.insert('lotsPaie', {
    cle: 'lot-visiteur', mode: 'fichier', statut: 'genere', periode: '2026-10', periodes: ['2026-10'], rappels: [], creation: '2026-10-15T10:00:00.000Z', auteur: 'Sandrine Vidal',
    feuilles: [], resume: {}, sansMatricule: [], contenu: null, telechargeLe: '2026-10-15T10:05:00.000Z', telechargePar: 'Sandrine Vidal', telechargements: 1, historique: false,
  });
  await db.insert('comptes', { nom: 'Visiteur', identifiant: 'visiteur', type: 'local', profilRh: 'aucun', actif: true, creation: '2026-10-16T10:00:00.000Z', creePar: 'Sandrine Vidal' });
  c = await releverBase(db);
  assert.deepEqual(c.ajouts.fiches, { nombre: 3, premier: '2026-10-12T09:00:00.000Z', dernier: '2026-10-14T09:00:00.000Z', ids: [25, 26, 27] });
  assert.deepEqual(c.ajouts.reprises, { nombre: 1, premier: '2026-10-13T10:00:00.000Z', dernier: '2026-10-13T10:00:00.000Z' });
  assert.deepEqual(c.ajouts.lots, { nombre: 1, premier: '2026-10-15T10:00:00.000Z', dernier: '2026-10-15T10:00:00.000Z' });
  assert.deepEqual(c.ajouts.fichiersSage, { nombre: 1, premier: '2026-10-15T10:05:00.000Z', dernier: '2026-10-15T10:05:00.000Z' });
  assert.equal(c.ajouts.comptes.nombre, 1);
  // Aucun de ces ajouts n'empêche la purge d'une démonstration ; les fiches ajoutées demandent --inclure-ajouts.
  const sans = deciderPurge(c, OPTIONS);
  assert.equal(sans.statut, 'possible');
  assert.match(sans.statut === 'possible' ? sans.aLever.join(' ') : '', /3 fiches ajoutées par des visiteurs \(identifiants 25, 26, 27\) : relisez l’aperçu, puis relancez avec --inclure-ajouts/);
  assert.deepEqual(deciderPurge(c, { inclureAjouts: true }), { statut: 'possible', preuve: 'marqueur', aLever: [] });
  const a = await apercuPurge(db, { ...OPTIONS, inclureAjouts: true });
  assert.equal(a.salaries, 27, 'les fiches ajoutées partent avec les fictives');
  assert.ok(texteApercu(a).includes('  - fiches hors du jeu : 3 (du 2026-10-12T09:00:00.000Z au 2026-10-14T09:00:00.000Z)'));
  assert.ok(texteApercu(a).includes('  - fichiers Sage téléchargés : 1 (le 2026-10-15T10:05:00.000Z)'));
  const sansDate = await releverBase(await nouvelleBase());
  assert.deepEqual(sansDate.ajouts.reprises, { nombre: 0, premier: null, dernier: null });
});

test('plan par profil : chaque table a un sort ; données de personnes toujours vidées ; paramétrage gardé selon le profil', () => {
  const tables = Object.keys(TABLES) as TableName[];
  // Toute table qui désigne un salarié est vidée quel que soit le profil (une nouvelle table de ce type doit y entrer).
  const personnelles = new Set(REFERENCES.filter(r => r.cible === 'employes' && r.colonne === 'emp_id').map(r => r.table));
  for (const profil of PROFILS_PURGE) {
    for (const garde of [false, true]) {
      const p = planPurge(profil, garde);
      assert.deepEqual(Object.keys(p.tables).sort(), [...tables].sort(), profil);
      for (const t of tables) {
        const r = p.tables[t];
        if (r.nulles) for (const c of r.nulles) assert.ok(c in TABLES[t].cols, `${t}.${c}`);
        if (personnelles.has(t.replace(/[A-Z]/g, m => '_' + m.toLowerCase())) && t !== 'comptes') assert.equal(r.sort, 'supprimer', `${profil} ${t}`);
      }
      assert.equal(p.tables.journal.sort, 'supprimer');
      assert.equal(p.tables.connexions.sort, 'supprimer');
      assert.equal(p.tables.employes.sort, 'supprimer');
      assert.equal(p.tables.verdictsKeystone.sort, 'supprimer');
      assert.deepEqual(p.tables.comptes, garde
        ? { sort: 'ajuster', nulles: ['empId', 'oid', 'motDePasse', 'blocageFin', 'derniereConnexion'], pourquoi: 'comptes gardés (--garder-compte), rendus externes' }
        : { sort: 'supprimer', pourquoi: 'comptes de connexion' });
    }
  }
  const sorts = (profil: typeof PROFILS_PURGE[number]) => Object.fromEntries(Object.entries(planPurge(profil).tables).map(([t, r]) => [t, r.sort]));
  const param = planPurge('parametrage');
  for (const t of ['formations', 'habilitations', 'destinations', 'postes', 'horaires'] as const) assert.equal(param.tables[t].sort, 'garder', t);
  for (const t of ['projets', 'chantiers', 'budgets', 'planActions', 'exercicesClos'] as const) assert.equal(param.tables[t].sort, 'supprimer', t);
  assert.deepEqual(param.tables.equipes.nulles, ['managerId']);
  assert.deepEqual(param.tables.rubriquesPaie.nulles, ['confirmeLe', 'confirmePar', 'modifieLe', 'modifiePar'], 'confirmation et auteur fictifs effacés');
  assert.equal(param.tables.projets.amorcee, true);
  assert.deepEqual(param.reglagesSupprimes, REGLAGES_SUPPRIMES_PARAMETRAGE);
  assert.deepEqual([...REGLAGES_SUPPRIMES_PARAMETRAGE], ['secret', 'lastSagePush', 'journalExpurge', 'messagerie', 'demo', 'verdictsKeystoneMode',
    'conservationSignales', 'conservationVerifieeLe', 'relancesEcheancesLe', 'recapitulatifLe', 'evaluationsDemandeesLe',
    'absencesPaieDepuis', 'absencesPaieJusqua', 'deplacementsPaieDepuis']);
  const cat = planPurge('catalogue');
  assert.equal(cat.tables.postes.sort, 'supprimer');
  assert.deepEqual([cat.tables.horaires.sort, cat.tables.horaires.amorcee], ['supprimer', true]);
  assert.deepEqual(cat.tables.equipes.nulles, ['managerId', 'horaire']);
  assert.equal(cat.tables.formations.sort, 'garder');
  assert.equal(cat.reglagesSupprimes, '*');
  const rien = sorts('rien');
  assert.deepEqual(Object.entries(rien).filter(([, s]) => s !== 'supprimer'), []);
  assert.equal(planPurge('rien').reglagesSupprimes, '*');
});

test('séquence des salariés : max(1001, plus grand identifiant attribué + 1), jamais remise à zéro', async () => {
  // Décision du propriétaire (étape 2) : les vrais salariés commencent à EMP-1001 ; au-delà de fiches créées après 1000.
  assert.equal(prochainIdEmploye(0), 1001);
  assert.equal(prochainIdEmploye(1), 1001);
  assert.equal(prochainIdEmploye(-5), 1001);
  assert.equal(prochainIdEmploye(24), 1001);
  assert.equal(prochainIdEmploye(1000), 1001);
  assert.equal(prochainIdEmploye(1001), 1002);
  assert.equal(prochainIdEmploye(5000), 5001);
  assert.equal(await plusGrandIdEmploye(await nouvelleBase()), 0);
  const db = await demo();
  assert.equal(await plusGrandIdEmploye(db), 24);
  // Identifiant déjà attribué puis supprimé : la séquence s'en souvient.
  await db.insert('employes', { id: 60, nom: 'Passager', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  await db.resyncIds();
  await db.remove('employes', 60);
  assert.equal(await plusGrandIdEmploye(db), 60);
  const a = await apercuPurge(db, OPTIONS);
  assert.deepEqual(a.sequence, { plusGrand: 60, prochain: 1001, matricule: 'EMP-1001' });
  assert.deepEqual(a.avertissements.filter(m => /dépasse/.test(m)), []);
  await db.insert('employes', { id: 1500, nom: 'Visiteur lointain', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  assert.deepEqual((await apercuPurge(db, OPTIONS)).sequence, { plusGrand: 1500, prochain: 1501, matricule: 'EMP-1501' });
  await db.insert('employes', { id: 9999, nom: 'Lointain', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  assert.match((await apercuPurge(db, OPTIONS)).avertissements.join(' '), /le prochain identifiant \(10000\) dépasse 9999 : matricule sur 5 chiffres/);
});

test('aperçu à blanc : sans effet, décompte par table, aucune référence orpheline, réglages et comptes gardés', async () => {
  const db = await demo();
  await journaliser(db, { actor: 'Sandrine Vidal', role: 'rh', action: 'parametres.modifier', message: 'Réglage', at: '2026-10-11T08:00:00.000Z' });
  const avant = await etat(db);
  for (const garder of PROFILS_PURGE) {
    const a = await apercuPurge(db, { garder, comptes: ['SANDRINE.VIDAL@entreprise.example', '3', 'inconnu'], inclureAjouts: false });
    assert.equal(a.profil, garder);
    assert.equal(a.decision.statut, 'possible');
    assert.match(a.decision.statut === 'possible' ? a.decision.aLever.join(' ') : '', /compte « inconnu » introuvable \(--garder-compte\)/);
    assert.deepEqual(a.orphelines, {}, garder);
    assert.equal(a.salaries, 24);
    for (const t of a.tables) {
      assert.equal(t.lignes, await db.count(t.table), t.table);
      if (t.table !== 'journal') assert.equal(t.partent + t.restent, t.lignes, `${garder} ${t.table}`);
    }
    const ligne = (t: TableName) => a.tables.find(x => x.table === t)!;
    assert.deepEqual([ligne('employes').partent, ligne('employes').restent], [24, 0]);
    assert.deepEqual([ligne('journal').partent, ligne('journal').restent], [1, 1], 'journal vidé puis la seule ligne purge.demo');
    assert.equal(ligne('comptes').restent, 2);
    assert.deepEqual(a.comptesGardes.map(c => c.identifiant).sort(), ['sandrine.vidal@entreprise.example', (await db.one<{ identifiant: string }>('SELECT identifiant FROM comptes WHERE id = 3'))!.identifiant].sort());
    assert.equal(ligne('formations').restent, garder === 'rien' ? 0 : 11);
    assert.equal(ligne('equipes').restent, garder === 'rien' ? 0 : 6);
    assert.equal(ligne('postes').restent, garder === 'parametrage' ? (await db.count('postes')) : 0);
    assert.equal(ligne('projets').restent, 0);
    if (garder === 'parametrage') {
      assert.deepEqual(a.reglages, { supprimes: ['demo', 'messagerie', 'verdictsKeystoneMode'], gardes: ['app'] });
    } else {
      assert.deepEqual(a.reglages.gardes, []);
    }
    const texte = texteApercu(a);
    assert.equal(texte[0], `Aperçu de la purge (profil ${garder}, base ${PG ? 'PostgreSQL' : 'SQLite'}) : rien n’a été modifié.`);
    assert.ok(texte.includes('  - employes : 24 / 0 — vidée, salariés et dossier individuel'), texte.join('\n'));
    assert.ok(texte.includes('Références orphelines après la purge : aucune.'));
    assert.ok(texte.includes('Salariés supprimés : 24. Prochain salarié : identifiant 1001 (EMP-1001), plus grand identifiant attribué 24.'));
  }
  assert.deepEqual(await etat(db), avant, 'l’aperçu n’a rien modifié');
  // Sans l'ajustement des équipes, leur responsable fictif deviendrait une référence orpheline.
  const plan = planPurge('parametrage');
  plan.tables.equipes = { sort: 'garder', pourquoi: 'essai' };
  assert.deepEqual(await orphelinesApres(db, plan), { 'equipes.manager_id → employes': 6 });
});

test('aperçu : refus affiché, pièces à effacer, avertissement PostgreSQL', async () => {
  const db = await demo();
  const base = await apercuPurge(db, OPTIONS);
  // Une pièce désignée (fichier présent) et un fichier qu'aucune pièce ne désigne.
  const dossier = dossierPiecesDe(db);
  const nom = (n: number) => `${process.pid.toString(16).padStart(8, '0')}${String(n).padStart(24, '0')}`;
  writeFileSync(join(dossier, nom(1)), 'pdf');
  writeFileSync(join(dossier, nom(2)), 'png!');
  await db.insert('pieces', { jeton: nom(1), empId: 1, objet: 'absence', objetId: null, nom: 'arret.pdf', type: 'application/pdf', taille: 3, empreinte: 'x', fichier: nom(1), deposeLe: '2026-10-10T08:00:00.000Z' });
  const a = await apercuPurge(db, OPTIONS);
  assert.equal(a.pieces.dossier, dossier);
  assert.equal(a.pieces.fichiers, base.pieces.fichiers + 1);
  assert.equal(a.pieces.orphelins, base.pieces.orphelins + 1);
  assert.equal(a.pieces.octets, base.pieces.octets + 7);
  assert.equal(a.avertissements.some(m => /pg_dump de Matrix/.test(m)), PG);
  await marquerExploitation(db, '0.1.0', { NODE_ENV: 'production' });
  const r = texteApercu(await apercuPurge(db, OPTIONS));
  assert.equal(r[1], 'Purge refusée :');
  assert.match(r[2], /elle ne se purge jamais/);
  // Base sans marqueur reconnue par le faisceau : la preuve est nommée.
  await db.remove('settings', REGLAGE_EXPLOITATION);
  await db.remove('settings', REGLAGE_DEMO);
  assert.equal(texteApercu(await apercuPurge(db, OPTIONS))[1], 'Base de démonstration reconnue (faisceau d’indices).');
});

test('aperçu : copies locales antérieures qui contiennent encore les données fictives (fichier SQLite)', { skip: PG && SQLITE_SEUL }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-purge-'));
  const db = new SqliteDb(join(dossier, 'cursus.db'));
  try {
    await seedDemo(db);
    assert.deepEqual((await apercuPurge(db, OPTIONS)).copies, { dossier: join(dossier, 'backups'), fichiers: [], miroir: null });
    const copie = basename(sauvegarderBase(db, 'avant-reinitialisation')!.fichier);
    const a = await apercuPurge(db, OPTIONS);
    assert.deepEqual(a.copies.fichiers, [copie]);
    assert.ok(texteApercu(a).some(l => l.startsWith(`Copies antérieures qui contiennent encore les données fictives (${join(dossier, 'backups')}) : ${copie}`)));
  } finally {
    await db.fermer();
  }
});

test('réglages de la paie posés pendant la démonstration : remis à défaut par le profil parametrage', async () => {
  // Gardés, ils empêcheraient le premier vrai lot de poser sa date de départ (departAuPremierLot), et le plus grand
  // identifiant d'absence fictif ferait partir en rappel les absences reprises de Lucca (double paiement).
  const db = await demo();
  await db.setSetting(CLE_DEPUIS, '2026-10-01');
  await db.setSetting(CLE_JUSQUA, 80);
  await db.setSetting(CLE_DEPUIS_DEPLACEMENTS, '2026-10-01');
  for (const cle of [CLE_DEPUIS, CLE_JUSQUA, CLE_DEPUIS_DEPLACEMENTS]) assert.ok(REGLAGES_SUPPRIMES_PARAMETRAGE.includes(cle), cle);
  const a = await apercuPurge(db, OPTIONS);
  for (const cle of ['absencesPaieDepuis', 'absencesPaieJusqua', 'deplacementsPaieDepuis']) {
    assert.ok(a.reglages.supprimes.includes(cle), cle);
    assert.ok(!a.reglages.gardes.includes(cle), cle);
  }
  assert.deepEqual(a.reglages.gardes, ['app']);
});

test('marqueur exploitation : gardé par un rechargement de la démonstration, la base reste refusée', async () => {
  const db = await demo();
  await marquerExploitation(db, '0.1.0', { NODE_ENV: 'production' }, new Date('2027-01-02T07:00:00Z'));
  // Base exploitée redémarrée par erreur avec CURSUS_DEMO=1, puis « Réinitialiser la démonstration ».
  await seedDemo(db);
  assert.deepEqual(await db.getSetting(REGLAGE_EXPLOITATION, null), { premierDemarrageHorsDemo: '2027-01-02T07:00:00.000Z', version: '0.1.0' });
  const d = (await apercuPurge(db, OPTIONS)).decision;
  assert.equal(d.statut, 'refusee');
  assert.match(d.statut === 'refusee' ? d.motifs.join(' ') : '', /a servi en production .* elle ne se purge jamais/);
});

/**
 * Empreinte d'un fichier, ou null s'il n'existe pas ou est vide (une lecture seule d'une base en WAL laisse un journal
 * -wal vide, qu'elle ne peut pas retirer : aucune écriture).
 */
const empreinte = (f: string) => {
  const contenu = existsSync(f) ? readFileSync(f) : null;
  return contenu?.length ? createHash('sha256').update(contenu).digest('hex') : null;
};

test('commande à blanc : aucune écriture dans le fichier, refus d’une base pas à jour sans la migrer', { skip: PG && SQLITE_SEUL }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-purge-cli-'));
  const fichier = join(dossier, 'cursus.db');
  const backups = join(dossier, 'backups');
  const commande = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/purge-demo-cli.ts', ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CURSUS_DB: fichier, CURSUS_BACKUP_DIR: backups, DATABASE_URL: '', CURSUS_DEMO_PUBLIQUE: '', CURSUS_TODAY: '2026-10-10' },
  });
  const releve = () => ({ base: empreinte(fichier), wal: empreinte(`${fichier}-wal`), copies: existsSync(backups) ? readdirSync(backups).sort() : [] });
  try {
    // Base de démonstration laissée par le service de cette version, arrêté.
    const db = new SqliteDb(fichier);
    await mettreAJourBase(db);
    await seedDemo(db);
    await db.fermer();
    const avant = releve();
    const r = commande('--a-blanc');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Aperçu de la purge \(profil parametrage, base SQLite\) : rien n’a été modifié\./);
    assert.doesNotMatch(r.stdout + r.stderr, /Migration|avant-migration/);
    assert.deepEqual(releve(), avant, 'fichier, journal WAL et copies inchangés');
    // Base restée à la version précédente (une migration nommée en attente) : refusée, jamais mise à jour ni copiée.
    const sql = new (await import('node:sqlite')).DatabaseSync(fichier);
    sql.exec('DELETE FROM migrations WHERE rowid = (SELECT MAX(rowid) FROM migrations)');
    const lignes = (sql.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number }).n;
    const journal = (sql.prepare('SELECT COUNT(*) AS n FROM journal').get() as { n: number }).n;
    sql.close();
    const ancienne = releve();
    const r2 = commande('--a-blanc');
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /Purge refusée : la base n’est pas à jour pour cette version \(1 migration en attente : .*\) : démarrez une fois le service/);
    assert.equal(r2.stdout, '');
    assert.deepEqual(releve(), ancienne, 'base refusée, rien écrit');
    const apres = new (await import('node:sqlite')).DatabaseSync(fichier, { readOnly: true });
    assert.equal((apres.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number }).n, lignes);
    assert.equal((apres.prepare('SELECT COUNT(*) AS n FROM journal').get() as { n: number }).n, journal);
    apres.close();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('aperçu sur le serveur PostgreSQL : ouvert sans migrer, refus d’un schéma vide ou pas à jour', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const { url, schema } = await schemaNeuf();
  const env = { DATABASE_URL: url, CURSUS_PG_POOL: '2' };
  await assert.rejects(ouvrirPourApercu(env, '', schema), refus(/n’a jamais été initialisé par Cursus/));
  assert.deepEqual(await surServeur(url, `SELECT to_regclass('${schema}.schema_migrations') AS t`), [{ t: null }], 'aucune table créée');
  const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
  const db = await ouvrirPostgres(url, { schema, env });
  try {
    await seedDemo(db);
  } finally {
    await db.fermer();
  }
  const ouverte = await ouvrirPourApercu(env, '', schema);
  try {
    assert.equal((await apercuPurge(ouverte, OPTIONS)).decision.statut, 'possible');
  } finally {
    await ouverte.fermer();
  }
  await surServeur(url, `DELETE FROM ${schema}.schema_migrations WHERE nom = (SELECT MAX(nom) FROM ${schema}.schema_migrations)`);
  const n = (await surServeur<{ n: string }>(url, `SELECT COUNT(*) AS n FROM ${schema}.schema_migrations`))[0].n;
  await assert.rejects(ouvrirPourApercu(env, '', schema), refus(/1 migration en attente : .* démarrez une fois le service/));
  assert.equal((await surServeur<{ n: string }>(url, `SELECT COUNT(*) AS n FROM ${schema}.schema_migrations`))[0].n, n, 'aucune migration appliquée');
});

test('journal : libellé et famille du code purge.demo', () => {
  assert.equal(ACTION_PURGE_DEMO, 'purge.demo');
  assert.ok(JOURNAL_LABEL['purge.demo']);
  assert.equal(familleAction('purge.demo')?.id, 'administration');
});

// — Étape 2 : exécution —

/** Bases à une seule connexion ouvertes pour la purge sur PostgreSQL, fermées à la fin du fichier. */
const aFermer: Db[] = [];
after(async () => { for (const db of aFermer) await db.fermer(); });

/** Attend que les connexions des bases des tests précédents (pools au repos) se soient fermées. */
async function attendreSeule(db: Db) {
  for (let i = 0; i < 100 && (await autresConnexionsCursus(db)).length; i++) await new Promise(ok => setTimeout(ok, 100));
  assert.deepEqual(await autresConnexionsCursus(db), [], 'aucune autre connexion Cursus');
}

/**
 * Base de démonstration prête à purger : SQLite en mémoire, ou, sur PostgreSQL, schéma neuf chargé par une première
 * connexion puis rouvert comme le fait la commande (une seule connexion, aucune autre instance connectée).
 */
async function demoPurge(): Promise<Db> {
  if (!PG) return await demo();
  const { url, schema } = await schemaNeuf();
  const env = { DATABASE_URL: url, CURSUS_PG_POOL: '1', CURSUS_PG_INACTIF_MS: '200' };
  const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
  const amorce = await ouvrirPostgres(url, { schema, env });
  try {
    await seedDemo(amorce);
  } finally {
    await amorce.fermer();
  }
  const db = await ouvrirPourApercu(env, '', schema);
  aFermer.push(db);
  await attendreSeule(db);
  return db;
}

const COPIE = '/sauvegardes/cursus-avant-purge.db';
const SANS_COPIE = { sauvegarder: () => COPIE };
const OUI = { ...lireOptionsPurge([]), oui: true };
const lignesJournal = async (db: Db) => await db.query<{ action: string; payload: unknown; message: string | null }>('SELECT action, payload, message FROM journal ORDER BY id');
const jsonDe = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, any>;

test('purge : décompte par table, journal réduit à purge.demo, intégrité vide, paramétrage gardé, EMP-1001, deuxième purge déjà faite', async () => {
  const db = await demoPurge();
  const apercu = await apercuPurge(db, OUI);
  const b = await executerPurge(db, OUI, { ...SANS_COPIE, maintenant: new Date('2026-12-15T08:00:00Z') });
  assert.equal(b.statut, 'faite');
  if (b.statut !== 'faite') return;
  // Décompte : ce qu'annonçait l'aperçu, table par table.
  for (const t of apercu.tables) {
    if (t.table === 'settings' || !t.partent) continue;
    assert.equal(b.supprimees[snakeDe(t.table)], t.partent, t.table);
  }
  assert.equal(b.supprimees.employes, 24);
  assert.equal(b.salaries, 24);
  for (const t of ['employes', 'feuilles', 'absences', 'connexions', 'comptes', 'verdicts_keystone', 'budgets', 'plan_actions', 'chantiers', 'lots_paie', 'envois']) {
    assert.equal(await db.count(camel(t)), 0, t);
  }
  assert.equal(await db.count('formations'), 11);
  assert.equal(await db.count('equipes'), 6);
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM equipes WHERE manager_id IS NOT NULL'))!.n), 0, 'responsables fictifs retirés');
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM rubriques_paie WHERE confirme_le IS NOT NULL OR confirme_par IS NOT NULL'))!.n), 0);
  assert.ok(await db.count('postes') > 0, 'postes gardés');
  assert.deepEqual((await db.query<{ key: string }>('SELECT key FROM settings ORDER BY key')).map(r => r.key), ['app']);
  // Projets du Keystone simulé partis, activités internes reposées.
  assert.deepEqual([...b.amorcages].sort(), (await db.query<{ code: string }>('SELECT code FROM projets')).map(p => p.code).sort());
  assert.ok(b.amorcages.length >= 3);
  // Journal : une seule ligne, sans donnée de personne.
  const journal = await lignesJournal(db);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].action, ACTION_PURGE_DEMO);
  const payload = jsonDe(journal[0].payload);
  assert.equal(payload.profil, 'parametrage');
  assert.equal(payload.supprimees.employes, 24);
  assert.equal(payload.copie, COPIE);
  assert.equal(payload.prochainId, 1001);
  assert.equal(payload.preuve, 'marqueur');
  assert.match(journal[0].message!, /^Purge des données de démonstration \(profil parametrage\) : 24 salariés, \d+ lignes supprimées dans \d+ tables$/);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  // Le premier vrai salarié reçoit EMP-1001.
  const e = await db.insert<{ id: number }>('employes', { nom: 'Premier Réel', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2027-01-04' });
  assert.equal(e.id, 1001);
  if (PG) assert.equal((await db.one<{ m: string }>('SELECT matricule AS m FROM employes WHERE id = 1001'))!.m, 'EMP-1001');
  await db.remove('employes', 1001);
  // Bilan : étapes suivantes affichées.
  const texte = texteBilan(b, db.moteur).join('\n');
  assert.match(texte, /Purge faite \(profil parametrage\) : 24 salariés supprimés ;/);
  assert.match(texte, /retirer CURSUS_DEMO, CURSUS_DEMO_PUBLIQUE, CURSUS_TODAY et CURSUS_INSECURE_COOKIE/);
  assert.match(texte, /poser un CURSUS_SECRET neuf/);
  assert.match(texte, /npm run comptes -- admin/);
  assert.match(texte, /prévenir Keystone, Vigie, Crucible, Codex et Matrix \(journal unifié\) : vider leurs copies des matricules EMP-0001 à EMP-0024/);
  assert.match(texte, /reprise Lucca/);
  // Deuxième purge : déjà faite, rien n'est écrit ; la démonstration n'est plus admise sur cette base.
  assert.deepEqual(await executerPurge(db, OUI, SANS_COPIE), { statut: 'deja-faite', le: '2026-12-15T08:00:00.000Z', message: journal[0].message });
  assert.equal((await lignesJournal(db)).length, 1);
  assert.match((await refusDemo(db))!, /^base de production \(données de démonstration purgées le 2026-12-15T08:00:00\.000Z\) : le mode démonstration n’y est jamais admis/);
});

/** Nom SQL d'une table de TABLES, et l'inverse. */
function snakeDe(t: string) { return t.replace(/[A-Z]/g, m => '_' + m.toLowerCase()); }
function camel(t: string) { return t.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as TableName; }

test('purge : profils catalogue et rien, intégrité vide, amorçages reposés', async () => {
  for (const garder of ['catalogue', 'rien'] as const) {
    const db = await demoPurge();
    const b = await executerPurge(db, { ...OUI, garder }, SANS_COPIE);
    assert.equal(b.statut, 'faite', garder);
    assert.equal(await db.count('postes'), 0, garder);
    assert.equal(await db.count('settings'), 0, garder);
    assert.deepEqual((await db.query<{ code: string }>('SELECT code FROM horaires ORDER BY code')).map(h => h.code), HORAIRES_EXEMPLES.map(h => h.code).sort(), garder);
    assert.equal(await db.count('formations'), garder === 'rien' ? 0 : 11);
    assert.equal(await db.count('equipes'), garder === 'rien' ? 0 : 6);
    assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM equipes WHERE horaire IS NOT NULL OR manager_id IS NOT NULL'))!.n), 0);
    assert.ok(await db.count('projets') >= 3, 'activités internes');
    assert.equal((await controlerOrphelins(db)).orphelins, 0, garder);
    assert.equal((await lignesJournal(db)).length, 1);
  }
});

test('purge : comptes gardés rendus externes, sessions toutes fermées', async () => {
  const db = await demoPurge();
  const rh = (await db.one<{ id: number; identifiant: string }>('SELECT id, identifiant FROM comptes WHERE emp_id IS NULL ORDER BY id LIMIT 1'))!;
  const salarie = (await db.one<{ id: number; identifiant: string }>('SELECT id, identifiant FROM comptes WHERE emp_id IS NOT NULL ORDER BY id LIMIT 1'))!;
  await db.update('comptes', rh.id, { oid: 'oid-demo', motDePasse: 'empreinte', derniereConnexion: '2026-10-10T08:00:00Z' });
  await db.insert('connexions', { id: 'session-demo', compteId: rh.id, role: 'rh', methode: 'demo', demoComptes: {}, creation: '2026-10-10T08:00:00Z', expiration: '2026-10-11T08:00:00Z', activite: '2026-10-10T08:00:00Z' });
  const b = await executerPurge(db, { ...OUI, comptes: [rh.identifiant.toUpperCase(), String(salarie.id)] }, SANS_COPIE);
  assert.equal(b.statut, 'faite');
  const restes = await db.query<{ id: number; emp_id: number | null; oid: string | null; mot_de_passe: string | null; derniere_connexion: string | null }>('SELECT id, emp_id, oid, mot_de_passe, derniere_connexion FROM comptes ORDER BY id');
  assert.deepEqual(restes.map(c => Number(c.id)), [rh.id, salarie.id].sort((x, y) => x - y));
  for (const c of restes) assert.deepEqual([c.emp_id, c.oid, c.mot_de_passe, c.derniere_connexion], [null, null, null, null]);
  assert.equal(await db.count('connexions'), 0);
  assert.deepEqual(jsonDe((await lignesJournal(db))[0].payload).comptesGardes, [rh.id, salarie.id]);
  assert.ok(b.statut === 'faite' && texteBilan(b, db.moteur).some(l => l.includes('comptes gardés')));
});

test('purge : comptes gardés et pièce déposée par un compte supprimé (clé non différable pieces.depose_compte_id)', async () => {
  const db = await demoPurge();
  const [garde, depose] = await db.query<{ id: number; identifiant: string }>('SELECT id, identifiant FROM comptes ORDER BY id LIMIT 2');
  await db.insert('pieces', { jeton: 'f'.repeat(32), empId: 1, objet: 'absence', objetId: null, nom: 'arret.pdf', type: 'application/pdf', taille: 3, empreinte: 'x',
    fichier: 'ged:document-7', deposeLe: '2026-10-10T08:00:00.000Z', deposePar: 'Visiteur', deposeCompteId: depose.id });
  const b = await executerPurge(db, { ...OUI, comptes: [garde.identifiant] }, SANS_COPIE);
  assert.equal(b.statut, 'faite');
  assert.deepEqual((await db.query<{ id: number }>('SELECT id FROM comptes')).map(c => Number(c.id)), [garde.id]);
  assert.equal(await db.count('pieces'), 0);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('purge : signataires fictifs du référentiel des habilitations vidés, auteur fictif des rubriques de paie effacé', async () => {
  const db = await demoPurge();
  await db.run(`UPDATE rubriques_paie SET modifie_le = ?, modifie_par = 'Sandrine Vidal'`, ['2026-10-09T08:00:00.000Z']);
  await db.run(`UPDATE habilitations SET signataire = 'Responsable maintenance' WHERE id = 'aipr'`);
  const a = await apercuPurge(db, OPTIONS);
  assert.deepEqual(a.signataires, [
    { id: 'ac486', signataire: 'Karim Haddad' }, { id: 'ac489', signataire: 'Olivier Marchal' }, { id: 'atex', signataire: 'Sarah Cohen' },
    { id: 'hauteur', signataire: 'Sarah Cohen' }, { id: 'he', signataire: 'Karim Haddad' },
  ], 'salariés du jeu et signataires du référentiel du jeu ; un signataire saisi par le service RH est gardé');
  assert.match(texteApercu(a).join('\n'), /Signataires fictifs au référentiel des habilitations, vidés par la purge .* : ac486 \(Karim Haddad\), ac489 \(Olivier Marchal\)/);
  const b = await executerPurge(db, OUI, SANS_COPIE);
  assert.ok(b.statut === 'faite');
  if (b.statut !== 'faite') return;
  assert.deepEqual(b.signataires, ['ac486', 'ac489', 'atex', 'hauteur', 'he']);
  assert.equal(b.ajustees.habilitations, 5);
  const habs = await db.query<{ id: string; signataire: string }>('SELECT id, signataire FROM habilitations ORDER BY id');
  assert.deepEqual(habs.map(h => [h.id, h.signataire]), [['ac486', ''], ['ac489', ''], ['aipr', 'Responsable maintenance'], ['atex', ''], ['hauteur', ''], ['he', '']]);
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM rubriques_paie WHERE modifie_le IS NOT NULL OR modifie_par IS NOT NULL'))!.n), 0);
  assert.deepEqual(jsonDe((await lignesJournal(db))[0].payload).signataires, ['ac486', 'ac489', 'atex', 'hauteur', 'he']);
  const texte = texteBilan(b, db.moteur).join('\n');
  assert.match(texte, /signataires fictifs vidés au référentiel des habilitations : ac486, ac489, atex, hauteur, he/);
  assert.match(texte, /compléter à l’écran Référentiels le signataire par défaut des habilitations ac486, ac489, atex, hauteur, he .* avant la reprise Lucca/);
  // Profil rien : le référentiel part avec ses signataires, rien à signaler.
  assert.deepEqual((await apercuPurge(await demo(), { ...OPTIONS, garder: 'rien' })).signataires, []);
});

test('purge : un échec après la validation (compactage) est noté dans le bilan, sans être pris pour un refus', { skip: PG && 'compactage propre au fichier SQLite' }, async () => {
  const db = await demoPurge();
  const exec = db.exec.bind(db);
  db.exec = async (sql: string) => {
    if (sql === 'VACUUM') throw new Error('database or disk is full');
    return await exec(sql);
  };
  const b = await executerPurge(db, OUI, SANS_COPIE);
  assert.equal(b.statut, 'faite');
  if (b.statut !== 'faite') return;
  assert.equal(b.apres.length, 1);
  assert.match(b.apres[0], /^compactage du fichier \(VACUUM.*\) : database or disk is full$/);
  assert.equal(await db.count('employes'), 0, 'purge validée');
  const texte = texteBilan(b, db.moteur);
  assert.match(texte[0], /^Purge faite et validée, mais 1 opération suivante a échoué \(à reprendre à la main, ne relancez pas la purge\) :$/);
  assert.ok(texte.some(l => /^Étapes suivantes :$/.test(l)), 'étapes suivantes affichées');
});

test('purge : fiches ajoutées par des visiteurs purgées seulement avec --inclure-ajouts ; reprise faite en démonstration admise', async () => {
  const db = await demoPurge();
  await ajouterFiche(db, 1500, '2026-10-12T09:00:00.000Z');
  await db.insert('reprises', { type: 'salaries', le: '2026-10-13T10:00:00.000Z', par: 'Sandrine Vidal', fichier: 'lucca.csv', colonnes: [], options: {}, lignes: 1, crees: 1, majs: 0, ignorees: 0, refusees: 0, rapport: [] });
  const avant = await etat(db);
  await assert.rejects(executerPurge(db, OUI, SANS_COPIE), refus(/1 fiche ajoutée par des visiteurs \(identifiants 1500\) : relisez l’aperçu, puis relancez avec --inclure-ajouts/));
  assert.deepEqual(await etat(db), avant, 'rien n’a été écrit');
  // La confirmation tapée reprend le nombre, fiches ajoutées comprises.
  let vu: number | null = null;
  const b = await executerPurge(db, { ...OUI, oui: false, inclureAjouts: true }, { ...SANS_COPIE, confirmer: a => { vu = a.ajouts.fiches.nombre; return confirmationPurgeTapee('PRODUCTION 25', a.salaries); } });
  assert.equal(vu, 1);
  assert.equal(b.statut === 'faite' && b.ajoutsPurges, 1);
  assert.equal(b.statut === 'faite' && b.supprimees.reprises, 1);
  assert.equal(await db.count('employes'), 0);
  assert.equal(b.statut === 'faite' && b.sequence.matricule, 'EMP-1501', 'après la fiche du visiteur');
  assert.equal(jsonDe((await lignesJournal(db))[0].payload).ajoutsPurges, 1);
});

test('purge refusée : base exploitée, sans marqueur, compte gardé inconnu, confirmation absente ou fausse ; rien n’est écrit', async () => {
  const db = await demoPurge();
  const avant = await etat(db);
  await assert.rejects(executerPurge(db, { ...OUI, comptes: ['personne'] }, SANS_COPIE), refus(/compte « personne » introuvable/));
  await assert.rejects(executerPurge(db, { ...OUI, oui: false }, SANS_COPIE), refus(/confirmation requise : ajoutez --yes, ou tapez PRODUCTION 24 dans un terminal/));
  await assert.rejects(executerPurge(db, { ...OUI, oui: false }, { ...SANS_COPIE, confirmer: () => false }), refus(/confirmation non donnée, rien n’a été modifié/));
  await assert.rejects(executerPurge(db, { ...OUI, oui: false }, { ...SANS_COPIE, confirmer: a => confirmationPurgeTapee('PRODUCTION 23', a.salaries) }), refus(/confirmation non donnée/));
  assert.deepEqual(await etat(db), avant);
  await marquerExploitation(db, '0.1.0', { NODE_ENV: 'production' }, new Date('2026-10-20T08:00:00Z'));
  await assert.rejects(executerPurge(db, OUI, SANS_COPIE), refus(/la base a servi en production .* elle ne se purge jamais/));
  assert.match((await refusDemo(db))!, /en exploitation depuis le 2026-10-20T08:00:00\.000Z/);
  await db.remove('settings', REGLAGE_EXPLOITATION);
  assert.equal(await refusDemo(db), null);
  await db.remove('settings', REGLAGE_DEMO);
  await db.run("UPDATE lots_paie SET auteur = 'Sandrine Vidal'");
  await assert.rejects(executerPurge(db, OUI, SANS_COPIE), refus(/rien ne prouve que la base est une démonstration/));
  assert.equal(await db.count('employes'), 24);
});

test('purge : sauvegarde préalable qui échoue, purge annulée sans rien écrire', async () => {
  const db = await demoPurge();
  const avant = await etat(db);
  await assert.rejects(executerPurge(db, OUI, { sauvegarder: () => { throw new SauvegardePurgeImpossible('disque plein'); } }), (e: unknown) => e instanceof SauvegardePurgeImpossible);
  assert.deepEqual(await etat(db), avant);
  // Base en mémoire : aucune copie possible, la purge n'a pas lieu.
  if (!PG) await assert.rejects(sauvegardePrealable(db, OUI), (e: unknown) => e instanceof SauvegardePurgeImpossible && /aucune copie possible/.test(e.message));
});

test('aperçu par simulation : toute la purge rejouée puis annulée, sans effet', async () => {
  const db = await demoPurge();
  const avant = await etat(db);
  const b = await simulerPurge(db, OUI);
  assert.equal(b.statut, 'simulee');
  assert.equal(b.supprimees.employes, 24);
  assert.equal(b.copie, null);
  assert.deepEqual(await etat(db), avant, 'transaction annulée, séquence comprise');
  assert.match(texteSimulation(b)[0], /^Simulation complète sur le serveur \(transaction annulée, rien n’a été gardé\) : \d+ lignes supprimées dans \d+ tables, contrôle d’intégrité sans référence orpheline, prochain salarié EMP-1001\.$/);
  // Purge refusée : la simulation l'est aussi.
  await marquerExploitation(db, '0.1.0', { NODE_ENV: 'production' });
  await assert.rejects(simulerPurge(db, OUI), refus(/elle ne se purge jamais/));
});

test('pièces : fichiers désignés et orphelins effacés après la validation ; échec noté au journal sans annuler la purge', async () => {
  const db = await demoPurge();
  const dossier = dossierPiecesDe(db);
  mkdirSync(dossier, { recursive: true });
  const nom = (n: number) => `${(process.pid + 7).toString(16).padStart(8, '0')}${String(n).padStart(24, '0')}`;
  writeFileSync(join(dossier, nom(1)), 'pdf');
  writeFileSync(join(dossier, nom(2)), 'orphelin');
  writeFileSync(join(dossier, 'LISEZMOI'), 'hors des pièces');
  await db.insert('pieces', { jeton: nom(1), empId: 1, objet: 'absence', objetId: null, nom: 'arret.pdf', type: 'application/pdf', taille: 3, empreinte: 'x', fichier: nom(1), deposeLe: '2026-10-10T08:00:00.000Z' });
  await db.insert('pieces', { jeton: nom(3), empId: 2, objet: 'absence', objetId: null, nom: 'ged.pdf', type: 'application/pdf', taille: 3, empreinte: 'y', fichier: 'ged:document-42', deposeLe: '2026-10-10T08:00:00.000Z' });
  const b = await executerPurge(db, OUI, SANS_COPIE);
  assert.equal(b.statut, 'faite');
  if (b.statut !== 'faite') return;
  assert.equal(existsSync(join(dossier, nom(1))), false);
  assert.equal(existsSync(join(dossier, nom(2))), false);
  assert.equal(existsSync(join(dossier, 'LISEZMOI')), true, 'seuls les fichiers de pièces sont effacés');
  assert.ok(b.pieces.effaces >= 2);
  assert.deepEqual(b.pieces.echecs, ['ged:document-42'], 'GED pas encore raccordée');
  assert.equal(await db.count('pieces'), 0);
  assert.equal(jsonDe((await lignesJournal(db))[0].payload).piecesNonEffacees, 1);
  assert.match(texteBilan(b, db.moteur).join('\n'), /1 fichier n’a pas pu être effacé \(ged:document-42\), à effacer à la main \(noté au journal\)/);
  rmSync(join(dossier, 'LISEZMOI'));
});

test('pg_dump désigné par --sauvegarde : présent, en-tête PGDMP, postérieur à la dernière activité de la base', async () => {
  const db = await demo();
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-dump-'));
  try {
    await journaliser(db, { actor: 'Sandrine Vidal', role: 'rh', action: 'parametres.modifier', message: 'Réglage', at: '2026-10-20T08:00:00.000Z' });
    await db.insert('connexions', { id: 's1', compteId: 1, role: 'rh', methode: 'demo', demoComptes: {}, creation: '2026-10-20T08:00:00Z', expiration: '2026-10-21T08:00:00Z', activite: '2026-10-20T09:30:00.000Z' });
    assert.equal(await derniereActivite(db), '2026-10-20T09:30:00.000Z');
    const dump = join(dossier, 'cursus.dump');
    const ko = (re: RegExp) => (e: unknown) => e instanceof SauvegardePurgeImpossible && re.test(e.message);
    await assert.rejects(verifierPgDump(db, null), ko(/désignez le pg_dump du schéma cursus fait après l’arrêt du service \(--sauvegarde <fichier>/));
    await assert.rejects(verifierPgDump(db, dump), ko(/copie introuvable/));
    writeFileSync(dump, '--\n-- PostgreSQL database dump\n');
    await assert.rejects(verifierPgDump(db, dump), ko(/n’est pas une copie de pg_dump au format personnalisé/));
    writeFileSync(dump, 'PGDMP\x01\x0f\x00');
    utimesSync(dump, new Date('2026-10-20T09:00:00Z'), new Date('2026-10-20T09:00:00Z'));
    await assert.rejects(verifierPgDump(db, dump), ko(/avant la dernière activité de la base \(2026-10-20T09:30:00\.000Z\) : arrêtez le service, refaites le pg_dump/));
    utimesSync(dump, new Date('2026-10-20T10:00:00Z'), new Date('2026-10-20T10:00:00Z'));
    assert.equal(await verifierPgDump(db, dump), dump);
    // Format répertoire (pg_dump -Fd) : en-tête de toc.dat.
    const rep = join(dossier, 'cursus.d');
    mkdirSync(rep);
    writeFileSync(join(rep, 'toc.dat'), 'PGDMP');
    assert.equal(await verifierPgDump(db, rep), rep);
    if (PG) assert.equal(await sauvegardePrealable(db, { sauvegarde: dump }), dump);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('serveur PostgreSQL : purge refusée tant qu’une autre connexion Cursus est ouverte sur la base', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const db = await demoPurge();
  const url = (await import('./base.ts')).urlDe(process.env.CURSUS_TEST_DATABASE_URL!, (await db.one<{ d: string }>('SELECT current_database() AS d'))!.d);
  const pg = (await import('pg')).default;
  const instance = new pg.Client({ connectionString: url, application_name: 'cursus' });
  await instance.connect();
  try {
    assert.equal((await autresConnexionsCursus(db)).length, 1);
    await assert.rejects(executerPurge(db, { ...OUI, force: true }, SANS_COPIE), refus(/1 autre connexion Cursus est ouverte sur la base \(processus \d+.*\) : arrêtez toutes les instances du service .* --force ne lève pas ce contrôle/));
    assert.equal(await db.count('employes'), 24);
  } finally {
    await instance.end();
  }
  await attendreSeule(db);
  assert.equal((await executerPurge(db, OUI, SANS_COPIE)).statut, 'faite');
});

test('serveur PostgreSQL : après la purge, pub_salaries vide et pub_titres gardé', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const db = await demoPurge();
  const titres = Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM pub_titres'))!.n);
  assert.ok(titres > 0);
  assert.equal((await executerPurge(db, OUI, SANS_COPIE)).statut, 'faite');
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM pub_salaries'))!.n), 0);
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM pub_titres'))!.n), titres);
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM pub_journal'))!.n), 1);
});

test('purge puis reprise Lucca (reprise.importer) : les vrais salariés commencent à EMP-1001', async () => {
  const db = await demoPurge();
  assert.equal((await executerPurge(db, OUI, SANS_COPIE)).statut, 'faite');
  const { ACTIONS } = await import('../server/src/actions/index.ts');
  const { makeCtx } = await import('../server/src/actions/context.ts');
  const { loadFull } = await import('../server/src/dataset.ts');
  const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
  const R = await import('../shared/rules/reprise.ts');
  const { lireCsv } = await import('../shared/rules/imports.ts');
  // Premier administrateur créé après la purge (npm run comptes -- admin).
  const compte = await db.insert<{ id: number; identifiant: string }>('comptes', { nom: 'Responsable RH', adresse: 'rh@epc2i.fr', identifiant: 'rh@epc2i.fr', type: 'microsoft', profilRh: 'rh_admin', actif: true, creation: '2027-01-02T08:00:00Z', creePar: 'Ligne de commande (npm run comptes)' });
  const user = { role: 'rh', empId: null, nom: 'Responsable RH', intitule: '', profilRh: 'rh_admin', compteId: compte.id } as any;
  const texte = [
    'Matricule;Prénom;Nom;Intitulé du poste;Département;Catégorie;Type de contrat;Temps de travail;Date d\'entrée;Date de fin;Date de naissance;Adresse e-mail',
    'A0123;Julie;Martin;Technicienne de maintenance;Maintenance;ETAM;CDI;39 h avec RTT;01/09/2015;;12/04/1988;julie.martin@exemple.fr',
    'A0456;Marc;Petit;Opérateur de production;Production;Ouvrier;CDD;35 h;05/01/2026;30/06/2027;1997;marc.petit@exemple.fr',
  ].join('\r\n');
  const p = { type: 'salaries', texte, colonnes: R.reconnaitreColonnes('salaries', lireCsv(texte).lignes[0]) };
  await db.tx(async () => {
    const t = await preparerTrace(db, 'reprise.importer', p);
    const r = await ACTIONS['reprise.importer'](makeCtx(db, user, await loadFull(db, user)), p);
    await journaliserAction(db, t, { user, compte: (await db.get('comptes', compte.id))!, message: typeof r === 'string' ? r : null });
  });
  const ids = (await db.query<{ id: number }>('SELECT id FROM employes ORDER BY id')).map(e => Number(e.id));
  assert.deepEqual(ids, [1001, 1002]);
  const actions = (await lignesJournal(db)).map(l => l.action);
  assert.equal(actions[0], ACTION_PURGE_DEMO);
  assert.ok(actions.includes('reprise.salaries'), actions.join(', '));
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

/** Lance une commande de Cursus sur le fichier SQLite `fichier` (environnement minimal, sans terminal). */
function lancerSur(fichier: string, script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...args], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_DB: fichier, CURSUS_BACKUP_DIR: join(fichier, '..', 'backups'), CURSUS_TODAY: '2026-10-10', CURSUS_HOST: '127.0.0.1', ...env },
  });
}

test('commande sur un fichier SQLite : copie avant-purge, pièces et copies antérieures, puis démarrage en démonstration et reset-demo refusés', { skip: PG && SQLITE_SEUL }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-purge-exec-'));
  const fichier = join(dossier, 'cursus.db');
  const backups = join(dossier, 'backups');
  try {
    const db = new SqliteDb(fichier);
    await mettreAJourBase(db);
    await seedDemo(db);
    const pieces = dossierPiecesDe(db);
    mkdirSync(pieces, { recursive: true });
    const jeton = `${'ab'.repeat(4)}${'0'.repeat(24)}`;
    writeFileSync(join(pieces, jeton), 'pdf');
    await db.insert('pieces', { jeton, empId: 1, objet: 'absence', objetId: null, nom: 'arret.pdf', type: 'application/pdf', taille: 3, empreinte: createHash('sha256').update('pdf').digest('hex'), fichier: jeton, deposeLe: '2026-10-10T08:00:00.000Z' });
    const ancienne = basename(sauvegarderBase(db, 'avant-reinitialisation')!.fichier);
    await db.fermer();
    // Sans terminal ni --yes : refus ; --sauvegarde est propre au serveur PostgreSQL.
    let r = lancerSur(fichier, 'server/src/purge-demo-cli.ts', []);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Purge refusée : sans terminal, ajoutez --yes pour confirmer/);
    r = lancerSur(fichier, 'server/src/purge-demo-cli.ts', ['--yes', '--sauvegarde', '/tmp/x.dump']);
    assert.match(r.stderr, /Purge refusée : --sauvegarde désigne un pg_dump du serveur PostgreSQL/);
    // Copie impossible (dossier des copies sur un fichier) : purge annulée.
    writeFileSync(join(dossier, 'pas-un-dossier'), '');
    r = lancerSur(fichier, 'server/src/purge-demo-cli.ts', ['--yes'], { CURSUS_BACKUP_DIR: join(dossier, 'pas-un-dossier', 'copies') });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Sauvegarde préalable impossible : purge annulée\. copie avant-purge impossible/);
    let lecture = new (await import('node:sqlite')).DatabaseSync(fichier, { readOnly: true });
    assert.equal((lecture.prepare('SELECT COUNT(*) AS n FROM employes').get() as { n: number }).n, 24, 'rien n’a été écrit');
    lecture.close();
    // Purge confirmée, copies antérieures supprimées.
    r = lancerSur(fichier, 'server/src/purge-demo-cli.ts', ['--yes', '--supprimer-copies-demo']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Purge faite \(profil parametrage\) : 24 salariés supprimés ;/);
    assert.match(r.stdout, /Étapes suivantes :\n  1\. retirer CURSUS_DEMO/);
    assert.match(r.stdout, new RegExp(`Copies antérieures supprimées : ${ancienne}`));
    const copies = readdirSync(backups).filter(f => f.endsWith('.db'));
    assert.equal(copies.length, 1);
    assert.match(copies[0], /^cursus-.*-avant-purge\.db$/);
    lecture = new (await import('node:sqlite')).DatabaseSync(join(backups, copies[0]), { readOnly: true });
    assert.equal((lecture.prepare('SELECT COUNT(*) AS n FROM employes').get() as { n: number }).n, 24, 'la copie garde la démonstration');
    lecture.close();
    assert.deepEqual(readdirSync(join(backups, 'pieces-cursus')), [jeton], 'pièce de la copie avant-purge gardée dans le miroir');
    assert.equal(existsSync(join(pieces, jeton)), false, 'fichier de la pièce effacé');
    lecture = new (await import('node:sqlite')).DatabaseSync(fichier, { readOnly: true });
    assert.equal((lecture.prepare('SELECT COUNT(*) AS n FROM employes').get() as { n: number }).n, 0);
    assert.equal((lecture.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'employes'`).get() as { seq: number }).seq, 1000);
    assert.deepEqual((lecture.prepare('SELECT action FROM journal').all() as { action: string }[]).map(l => l.action), [ACTION_PURGE_DEMO]);
    lecture.close();
    // Commande rejouée : déjà faite.
    r = lancerSur(fichier, 'server/src/purge-demo-cli.ts', ['--yes']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Purge déjà faite le /);
    // Le serveur refuse de démarrer en démonstration sur la base purgée, et reset-demo de la recharger.
    r = lancerSur(fichier, 'server/src/index.ts', [], { CURSUS_DEMO: '1', CURSUS_API_PORT: '4399' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Démarrage impossible : base de production \(données de démonstration purgées le .*\) : le mode démonstration n’y est jamais admis/);
    r = lancerSur(fichier, 'server/src/reset.ts', ['--yes'], { CURSUS_DEMO: '1' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Réinitialisation refusée : base de production \(données de démonstration purgées le /);
    lecture = new (await import('node:sqlite')).DatabaseSync(fichier, { readOnly: true });
    assert.equal((lecture.prepare('SELECT COUNT(*) AS n FROM employes').get() as { n: number }).n, 0, 'démonstration jamais rechargée');
    lecture.close();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('démonstration en SQLite : purge du fichier puis reprise sur un schéma PostgreSQL neuf, premier salarié EMP-1001', { skip: !PG && 'propre au serveur PostgreSQL' }, async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cursus-purge-reprise-'));
  try {
    const fichier = join(dossier, 'cursus.db');
    const source = new SqliteDb(fichier);
    await mettreAJourBase(source);
    await seedDemo(source);
    assert.equal((await executerPurge(source, OUI, SANS_COPIE)).statut, 'faite');
    await source.fermer();
    const { reprendreSurPostgres } = await import('../server/src/reprise-postgres.ts');
    const { ouvrirPostgres } = await import('../server/src/db-pg.ts');
    const { url, schema } = await schemaNeuf();
    const cible = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '2', CURSUS_PG_INACTIF_MS: '200' } });
    aFermer.push(cible);
    await mettreAJourBase(cible);
    // À blanc : séquence intacte (ALTER SEQUENCE annulé avec la transaction).
    await reprendreSurPostgres(fichier, cible, { aBlanc: true });
    assert.equal(await plusGrandIdEmploye(cible), 0);
    await reprendreSurPostgres(fichier, cible);
    assert.equal(await plusGrandIdEmploye(cible), 1000);
    const e = await cible.insert<{ id: number }>('employes', { nom: 'Premier Réel', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2027-01-04' });
    assert.equal(e.id, 1001);
    assert.match((await refusDemo(cible))!, /données de démonstration purgées/, 'la purge suit la base sur le serveur');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('ordre de suppression : une table avant celles qu’elle désigne, références à soi-même ignorées, cycle refusé', async () => {
  const { ordonnerSuppression } = await import('../server/src/purge-demo-execution.ts');
  const ordre = ordonnerSuppression(['employes', 'feuilles', 'lotsPaie', 'equipes'], [
    { table: 'feuilles', cible: 'employes' }, { table: 'feuilles', cible: 'lots_paie' }, { table: 'employes', cible: 'equipes' },
    { table: 'equipes', cible: 'equipes' }, { table: 'feuilles', cible: 'projets' },
  ]);
  const avant = (a: string, b: string) => ordre.indexOf(a as TableName) < ordre.indexOf(b as TableName);
  assert.ok(avant('feuilles', 'employes') && avant('feuilles', 'lotsPaie') && avant('employes', 'equipes'), ordre.join(', '));
  assert.equal(ordre.length, 4);
  assert.throws(() => ordonnerSuppression(['employes', 'equipes'], [{ table: 'employes', cible: 'equipes' }, { table: 'equipes', cible: 'employes' }]),
    refus(/clés étrangères en cycle : employes → equipes → employes/));
});

test('purge annulée : base modifiée pendant la confirmation, référence orpheline au contrôle final', async () => {
  const db = await demoPurge();
  // Un service encore en marche écrit entre l'aperçu confirmé et la transaction : refus, rien n'est écrit.
  await assert.rejects(executerPurge(db, { ...OUI, oui: false, inclureAjouts: true }, { ...SANS_COPIE, confirmer: async () => { await ajouterFiche(db, 1600, '2026-12-15T08:00:00.000Z'); return true; } }),
    refus(/la base a changé depuis l’aperçu \(25 salariés à supprimer au lieu de 24\)/));
  assert.equal(await db.count('employes'), 25);
  await db.remove('employes', 1600);
  // Référence orpheline entre deux tables gardées : le contrôle d'intégrité final annule toute la purge.
  const { horsContraintes } = await import('./base.ts');
  await horsContraintes(db, async () => { await db.run(`UPDATE equipes SET parente = 'Équipe disparue' WHERE rowid IN (SELECT rowid FROM equipes LIMIT 1)`.replace(/rowid/g, PG ? 'ctid' : 'rowid')); });
  const avant = await etat(db);
  await assert.rejects(executerPurge(db, OUI, SANS_COPIE), refus(/le contrôle d’intégrité trouverait 1 référence orpheline après la purge \(equipes\.parente → equipes : 1\) : rien n’a été modifié/));
  assert.deepEqual(await etat(db), avant);
});
