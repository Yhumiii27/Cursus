// Passage de la démonstration à la production (lot 8, chantier A, étape 1) : marqueurs `demo` et `exploitation`
// (server/src/marqueurs.ts), règles de npm run purge-demo (server/src/purge-demo.ts) — options, preuve de
// démonstration, refus sans appel, ajouts des visiteurs, plan de suppression par profil, séquence des salariés — et
// aperçu à blanc, sans effet sur la base. Sur SQLite en mémoire, et sur PostgreSQL par npm run test:pg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(param.tables.rubriquesPaie.nulles, ['confirmeLe', 'confirmePar']);
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

test('séquence des salariés : max(1001, plus grand identifiant attribué + 1000), jamais remise à zéro', async () => {
  assert.equal(prochainIdEmploye(0), 1001);
  assert.equal(prochainIdEmploye(1), 1001);
  assert.equal(prochainIdEmploye(-5), 1001);
  assert.equal(prochainIdEmploye(24), 1024);
  assert.equal(prochainIdEmploye(5000), 6000);
  assert.equal(await plusGrandIdEmploye(await nouvelleBase()), 0);
  const db = await demo();
  assert.equal(await plusGrandIdEmploye(db), 24);
  // Identifiant déjà attribué puis supprimé : la séquence s'en souvient.
  await db.insert('employes', { id: 60, nom: 'Passager', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  await db.resyncIds();
  await db.remove('employes', 60);
  assert.equal(await plusGrandIdEmploye(db), 60);
  const a = await apercuPurge(db, OPTIONS);
  assert.deepEqual(a.sequence, { plusGrand: 60, prochain: 1060, matricule: 'EMP-1060' });
  assert.deepEqual(a.avertissements.filter(m => /dépasse/.test(m)), []);
  await db.insert('employes', { id: 9500, nom: 'Lointain', equipe: 'Logistique', poste: 'Cariste', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01' });
  assert.match((await apercuPurge(db, OPTIONS)).avertissements.join(' '), /le prochain identifiant \(10500\) dépasse 9999 : matricule sur 5 chiffres/);
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
    assert.ok(texte.includes('Salariés supprimés : 24. Prochain salarié : identifiant 1024 (EMP-1024), plus grand identifiant attribué 24.'));
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
