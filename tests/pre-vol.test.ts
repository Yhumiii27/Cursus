// Pré-vol de la mise en production (server/src/pre-vol.ts, npm run verifier-production ; lot 8, chantier B) :
// - la démonstration Coolify actuelle donne les avertissements attendus et aucun refus de démarrage, la production cible
//   aucun bloquant ;
// - chaque contrôle de configuration (NODE_ENV=production forcé) et de base (démonstration, administrateur RH,
//   confidentialité, intégrité, pièces ; rôle, schéma, droits, migrations, vues pub_, horloge d'après les faits du serveur) ;
// - contrat des vues lu dans la dernière définition des migrations ;
// - la commande elle-même (fichier SQLite, copie instantanée : la base n'est jamais modifiée), codes de sortie 0, 1 et 2.
// Les contrôles sur un vrai serveur PostgreSQL (lecture seule, faits relevés) sont dans tests/db-pg.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { avertissementsConfig, problemesConfig } = await import('../server/src/config.ts');
const { codeSortie, colonnesSelect, controlerBase, controlesConfig, hoteInterne, indicesDemo, rapportTexte, secretsEgaux, vuesAttendues } = await import('../server/src/pre-vol.ts');
const { migrationsPg } = await import('../server/src/db-pg.ts');
const { creerCompte } = await import('../server/src/comptes.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { nouvelleBase, horsContraintes } = await import('./base.ts');
type Controle = import('../server/src/pre-vol.ts').Controle;
type FaitsServeur = import('../server/src/pre-vol.ts').FaitsServeur;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JOUR = '2026-10-24';
const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const IMAGE = { NODE_ENV: 'production', TZ: 'Europe/Paris', CURSUS_HOST: '0.0.0.0', CURSUS_TRUST_PROXY: 'loopback,uniquelocal', CURSUS_API_PORT: '3000', CURSUS_DB: '/data/cursus.db', CURSUS_CONTENEUR: '1' };
/** Démonstration en ligne actuelle (application Coolify) : image, démonstration publique, secrets propres. */
const DEMO_COOLIFY = { ...IMAGE, CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1', CURSUS_SECRET: 'd'.repeat(40), KEYSTONE_API_KEY: 'demo-keystone' };
/** Production cible : application cursus-prod (docs/BASCULE-PRODUCTION.md), toutes les variables posées. */
const PRODUCTION = {
  ...IMAGE, CURSUS_TRUST_PROXY: '10.0.1.0/24',
  DATABASE_URL: 'postgres://cursus_app:mdp-cursus-app@epc2i-postgres:5432/epc2i',
  CURSUS_SECRET: 'a'.repeat(64), KEYSTONE_API_KEY: 'b'.repeat(64), KEYSTONE_URL: 'http://keystone:3000', KEYSTONE_TOKEN: 'c'.repeat(64),
  CURSUS_SUPERVISION_TOKEN: 'e'.repeat(64), MATRIX_URL: 'http://matrix:3000', MATRIX_TOKEN: 'f'.repeat(64),
  CURSUS_PUBLIC_URL: 'https://cursus.entreprise.fr',
  CURSUS_OIDC_TENANT: GUID, CURSUS_OIDC_CLIENT_ID: 'app-cursus', CURSUS_OIDC_CLIENT_SECRET: 'g'.repeat(40), CURSUS_OIDC_SECRET_EXPIRE: '2027-10-01',
  CURSUS_MAIL_FROM: 'cursus@entreprise.fr',
};
const niveaux = (cs: Controle[], niveau: Controle['niveau']) => cs.filter(c => c.niveau === niveau);
const code = (cs: Controle[], c: string) => cs.filter(x => x.code === c);

test('démonstration Coolify actuelle : aucun refus de démarrage, avertissements attendus ; le pré-vol la déclare pas prête', () => {
  // SQLite dans le volume (choix du lot 8) : rien à signaler au démarrage.
  assert.deepEqual(problemesConfig(DEMO_COOLIFY), []);
  assert.deepEqual(avertissementsConfig(DEMO_COOLIFY), []);
  // Si elle tourne sur le serveur commun, avec les liaisons : signalée, jamais arrêtée.
  const surEpc2i = { ...DEMO_COOLIFY, DATABASE_URL: 'postgres://cursus_app:mdp@epc2i-postgres:5432/epc2i', KEYSTONE_URL: 'http://keystone:3000', KEYSTONE_TOKEN: 'k'.repeat(40) };
  assert.deepEqual(problemesConfig(surEpc2i), []);
  const av = avertissementsConfig(surEpc2i);
  assert.equal(av.length, 2);
  assert.match(av[0], /branchée sur la base epc2i du serveur commun/);
  assert.match(av[1], /KEYSTONE_URL est définie sans CURSUS_DEMO_LIAISONS=1/);
  // Base provisionnée par Coolify, en rôle postgres (base inconnue, réponse du 24 octobre) : signalée, jamais arrêtée.
  for (const url of ['postgres://postgres:x@coolify-pg:5432/postgres', 'postgres://postgres:x@epc2i-postgres:5432/epc2i']) {
    const pg = { ...DEMO_COOLIFY, DATABASE_URL: url };
    assert.deepEqual(problemesConfig(pg), [], url);
    assert.ok(avertissementsConfig(pg).some(a => /connectée au serveur PostgreSQL avec le rôle postgres \(superutilisateur\)/.test(a)), url);
    // Le pré-vol, lui, le bloque.
    assert.equal(code(controlesConfig(pg, JOUR), 'config.base.role')[0].niveau, 'bloquant', url);
  }
  // Pré-vol : la démonstration n'est pas une production.
  const cs = controlesConfig(surEpc2i, JOUR);
  assert.match(code(cs, 'config.demo')[0].message, /CURSUS_DEMO, CURSUS_DEMO_PUBLIQUE/);
  assert.equal(code(cs, 'config.demo')[0].niveau, 'bloquant');
  assert.equal(codeSortie(cs), 1);
});

test('production cible : aucun bloquant ni avertissement de configuration', () => {
  const cs = controlesConfig(PRODUCTION, JOUR);
  assert.deepEqual(niveaux(cs, 'bloquant'), []);
  assert.deepEqual(niveaux(cs, 'attention'), []);
  assert.equal(codeSortie(cs), 0);
  assert.deepEqual(cs.map(c => c.code), ['config.demarrage', 'config.demo', 'config.base.role', 'config.base.nom', 'config.base.tls', 'config.public-url', 'config.oidc', 'config.mail',
    'config.secret-oidc', 'config.supervision', 'config.fuseau', 'config.secrets', 'config.proxy']);
  // NODE_ENV forcé : la commande lancée hors production juge comme en production.
  const horsProd = controlesConfig({ ...PRODUCTION, NODE_ENV: undefined, CURSUS_PUBLIC_URL: undefined }, JOUR);
  assert.ok(niveaux(horsProd, 'bloquant').some(c => /CURSUS_PUBLIC_URL est absente/.test(c.message)));
  // Aucun secret dans le rapport.
  const texte = JSON.stringify(controlesConfig({ ...PRODUCTION, KEYSTONE_TOKEN: PRODUCTION.CURSUS_SECRET, DATABASE_URL: 'postgres://postgres:mdp-cursus-app@db.example.fr/autre' }, JOUR));
  for (const v of [PRODUCTION.CURSUS_SECRET, 'mdp-cursus-app']) assert.ok(!texte.includes(v), 'valeur secrète affichée');
});

test('configuration : chaque contrôle propre au pré-vol', () => {
  const ligne = (env: Record<string, string | undefined>, c: string) => {
    const l = code(controlesConfig({ ...PRODUCTION, ...env }, JOUR), c);
    assert.equal(l.length, 1, c);
    return l[0];
  };
  // Serveur commun : rôle, base, TLS hors du réseau Docker.
  assert.equal(ligne({ DATABASE_URL: 'postgres://autre_app:mdp@epc2i-postgres/epc2i' }, 'config.base.role').niveau, 'bloquant');
  assert.equal(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@epc2i-postgres/keystone' }, 'config.base.nom').niveau, 'bloquant');
  assert.equal(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@db.example.fr/epc2i' }, 'config.base.tls').niveau, 'bloquant');
  assert.equal(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@db.example.fr/epc2i?sslmode=prefer' }, 'config.base.tls').niveau, 'bloquant');
  assert.match(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@db.example.fr/epc2i?sslmode=verify-full' }, 'config.base.tls').message, /chiffrée \(sslmode=verify-full\)/);
  // Chiffrement par ssl=true ou PGSSLMODE (node-postgres) : reconnu.
  assert.match(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@db.example.fr/epc2i?ssl=true' }, 'config.base.tls').message, /chiffrée \(ssl=true\)/);
  assert.match(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@db.example.fr/epc2i', PGSSLMODE: 'require' }, 'config.base.tls').message, /chiffrée \(PGSSLMODE=require\)/);
  assert.equal(ligne({ DATABASE_URL: 'postgres://cursus_app:mdp@db.example.fr/epc2i', PGSSLMODE: 'disable' }, 'config.base.tls').niveau, 'bloquant');
  // Rôle donné par ?user= : celui que prendrait node-postgres.
  assert.equal(ligne({ DATABASE_URL: 'postgres://epc2i-postgres/epc2i?user=postgres&password=x' }, 'config.base.role').niveau, 'bloquant');
  assert.equal(ligne({ DATABASE_URL: undefined, CURSUS_BASE: 'sqlite' }, 'config.base').niveau, 'attention');
  assert.equal(code(controlesConfig({ ...PRODUCTION, DATABASE_URL: 'pas une adresse' }, JOUR), 'config.base.role').length, 0, 'adresse illisible : refusée par les règles de démarrage');
  // Connexion Microsoft, e-mails, échéance du secret.
  const sansOidc = { CURSUS_OIDC_TENANT: undefined, CURSUS_OIDC_CLIENT_ID: undefined, CURSUS_OIDC_CLIENT_SECRET: undefined, CURSUS_OIDC_SECRET_EXPIRE: undefined };
  assert.equal(ligne(sansOidc, 'config.oidc').niveau, 'attention');
  // Adresse publique exigée même sur la boucle locale (production derrière Caddy, deploy/Caddyfile) : exemptée au
  // démarrage pour l'application de bureau, pas pour une instance de production.
  const caddy = { ...sansOidc, CURSUS_MAIL_FROM: undefined, CURSUS_HOST: '127.0.0.1', CURSUS_PUBLIC_URL: undefined };
  assert.deepEqual(problemesConfig({ ...PRODUCTION, ...caddy }), [], 'démarrage : boucle locale exemptée');
  assert.equal(ligne(caddy, 'config.public-url').niveau, 'bloquant');
  assert.match(ligne(caddy, 'config.public-url').message, /CURSUS_PUBLIC_URL est absente/);
  assert.equal(ligne({ ...caddy, CURSUS_PUBLIC_URL: 'http://cursus.entreprise.fr' }, 'config.public-url').niveau, 'bloquant');
  assert.match(ligne({}, 'config.public-url').message, /Adresse publique : https:\/\/cursus\.entreprise\.fr\./);
  assert.equal(code(controlesConfig({ ...PRODUCTION, ...sansOidc }, JOUR), 'config.secret-oidc').length, 0, 'sans connexion Microsoft : sans objet');
  assert.match(ligne({ ...sansOidc, CURSUS_MAIL_FROM: undefined }, 'config.mail').message, /E-mails en simulation/);
  assert.equal(ligne({ CURSUS_OIDC_SECRET_EXPIRE: undefined }, 'config.secret-oidc').niveau, 'attention');
  assert.equal(ligne({ CURSUS_OIDC_SECRET_EXPIRE: '2026-10-23' }, 'config.secret-oidc').niveau, 'bloquant');
  assert.match(ligne({ CURSUS_OIDC_SECRET_EXPIRE: '2026-11-10' }, 'config.secret-oidc').message, /expire le 2026-11-10 \(dans 17 jours\)/);
  assert.match(ligne({ CURSUS_OIDC_SECRET_EXPIRE: '2026-10-25' }, 'config.secret-oidc').message, /dans 1 jour\)/);
  assert.equal(ligne({ CURSUS_OIDC_SECRET_EXPIRE: '2026-11-24' }, 'config.secret-oidc').niveau, 'ok', 'plus de 30 jours');
  // Supervision, fuseau, proxy, Matrix.
  assert.equal(ligne({ CURSUS_SUPERVISION_TOKEN: undefined }, 'config.supervision').niveau, 'attention');
  assert.match(ligne({ TZ: 'UTC' }, 'config.fuseau').message, /Fuseau « UTC »/);
  assert.match(ligne({ TZ: undefined }, 'config.fuseau').message, /Fuseau non posé/);
  assert.equal(ligne({ CURSUS_TRUST_PROXY: 'loopback,uniquelocal' }, 'config.proxy').niveau, 'attention');
  assert.equal(ligne({ MATRIX_TOKEN: undefined }, 'config.matrix').niveau, 'attention');
  // Variables de démonstration et de test, une par une.
  for (const v of ['CURSUS_TODAY', 'CURSUS_INSECURE_COOKIE', 'CURSUS_OIDC_AUTORITE', 'CURSUS_DEMO_LIAISONS']) {
    assert.equal(ligne({ [v]: v === 'CURSUS_TODAY' ? '2026-10-10' : '1' }, 'config.demo').niveau, 'bloquant', v);
  }
  // Avertissement des règles de démarrage repris tel quel.
  assert.match(ligne({ MATRIX_URL: 'https://svc:mdp@matrix.example.fr' }, 'config.avertissement').message, /MATRIX_URL contient un identifiant/);
});

test('secrets tous différents : noms seuls, paire connexion / envoi admise', () => {
  assert.deepEqual(secretsEgaux({ CURSUS_SECRET: 'a', KEYSTONE_API_KEY: 'a', KEYSTONE_TOKEN: ' a ', MATRIX_TOKEN: 'b' }),
    [['CURSUS_SECRET', 'KEYSTONE_API_KEY'], ['CURSUS_SECRET', 'KEYSTONE_TOKEN'], ['KEYSTONE_API_KEY', 'KEYSTONE_TOKEN']]);
  assert.deepEqual(secretsEgaux({ CURSUS_OIDC_CLIENT_SECRET: 's', CURSUS_MAIL_CLIENT_SECRET: 's' }), [], 'même application Entra pour la connexion et l’envoi');
  assert.deepEqual(secretsEgaux({ CURSUS_SECRET: '', KEYSTONE_API_KEY: '' }), [], 'vides : non comparés');
  const c = code(controlesConfig({ ...PRODUCTION, CURSUS_SUPERVISION_TOKEN: PRODUCTION.CURSUS_SECRET }, JOUR), 'config.secrets')[0];
  assert.equal(c.niveau, 'bloquant');
  assert.equal(c.message, 'Secrets identiques : CURSUS_SECRET = CURSUS_SUPERVISION_TOKEN.');
});

test('hôte interne du serveur PostgreSQL : nom de service, boucle locale, adresses privées', () => {
  for (const h of ['epc2i-postgres', 'localhost', '127.0.0.1', '::1', '10.0.0.4', '172.16.0.2', '172.31.255.1', '192.168.1.10', 'fd12:3456::1']) assert.equal(hoteInterne(h), true, h);
  for (const h of ['db.example.fr', '172.32.0.1', '8.8.8.8', '2001:db8::1', '11.0.0.1']) assert.equal(hoteInterne(h), false, h);
});

test('contrat des vues pub_ : colonnes de la dernière définition dans les migrations', () => {
  const vues = vuesAttendues(migrationsPg());
  assert.deepEqual(Object.keys(vues).sort(), ['pub_absences', 'pub_journal', 'pub_parametres', 'pub_salaries', 'pub_titres', 'pub_titres_detenus']);
  assert.deepEqual(vues.pub_salaries, ['matricule', 'nom', 'poste', 'unite_code', 'site_code', 'entree', 'sortie', 'actif']);
  assert.deepEqual(vues.pub_parametres, ['horizon_alerte_jours']);
  // Requête commune (WITH) et réunion (UNION ALL) : colonnes de la première branche.
  assert.deepEqual(vues.pub_titres_detenus, ['cursus_ref', 'matricule', 'titre_id', 'nature', 'code', 'obtenu_le', 'expire_le', 'utilisable_jusqu_au',
    'prerequis_manquant', 'organisme', 'delivre_par', 'session_prevue_le']);
  assert.deepEqual(vues.pub_journal.slice(0, 3), ['ref_source', 'nature', 'quand']);
  // Avenant (remplacement), suppression, schéma qualifié, commentaires et chaînes.
  const m = [
    { nom: '0001_a', sql: `CREATE VIEW "pub_x" AS SELECT a.id, 'x,(' AS b -- commentaire, avec virgule\nFROM t a;\nCREATE VIEW pub_y AS SELECT 1 AS un FROM t;` },
    { nom: '0002_b', sql: 'CREATE OR REPLACE VIEW cursus.pub_x AS SELECT a.id, b, coalesce(c, (SELECT max(d) FROM u)) AS c FROM t a;\nDROP VIEW IF EXISTS "pub_y";' },
  ];
  assert.deepEqual(vuesAttendues(m), { pub_x: ['id', 'b', 'c'] });
  assert.deepEqual(vuesAttendues(m.slice(0, 1)), { pub_x: ['id', 'b'], pub_y: ['un'] });
  assert.deepEqual(colonnesSelect('CREATE VIEW v AS VALUES (1)'), [], 'sans SELECT');
  assert.deepEqual(colonnesSelect('CREATE VIEW v AS SELECT x'), ['x'], 'sans FROM');
});

/** Faits d'un serveur conforme, pour les contrôles de base sans serveur (le vrai relevé : tests/db-pg.test.ts). */
const faits = (x: Partial<FaitsServeur> = {}): FaitsServeur => ({
  utilisateur: 'cursus_app', superutilisateur: false, schemaCourant: 'cursus', creerDansBase: false, droitsGlobaux: [],
  migrations: migrationsPg().map(m => m.nom), schemaIncomplet: null, vues: vuesAttendues(migrationsPg()), ecartHorlogeMs: 120, dureeConnexionMs: 12, ...x,
});
const dossierPieces = mkdtempSync(join(tmpdir(), 'cursus-pre-vol-pieces-'));
const options = (serveur: FaitsServeur | null = faits()) => ({ serveur, migrations: migrationsPg(), dossierPieces, espaceLibre: () => 5 * 1024 ** 3 });

async function avecAdmin() {
  const db = await nouvelleBase();
  await creerCompte(db, { type: 'local', identifiant: 'admin', nom: 'Rachel Martin', adresse: 'rachel.martin@entreprise.fr', profilRh: 'rh_admin' }, 'Ligne de commande');
  return db;
}

test('base vide avec un administrateur : aucun bloquant ; base vide sans administrateur : bloquant', async () => {
  const db = await avecAdmin();
  await db.setSetting('confidentialite', { responsable: 'EPC France, 1 rue de la Chimie', dpo: 'dpo@entreprise.fr' });
  const cs = await controlerBase(db, options());
  assert.deepEqual(niveaux(cs, 'bloquant'), []);
  assert.deepEqual(niveaux(cs, 'attention'), []);
  assert.deepEqual(cs.map(c => c.code), ['base.connexion', 'base.role', 'base.schema', 'base.droits', 'base.migrations', 'base.schema-conforme', 'base.vues', 'base.horloge',
    'base.demo', 'base.admin', 'base.confidentialite', 'base.integrite', 'base.pieces']);
  assert.equal(code(cs, 'base.admin')[0].message, '1 administrateur RH actif.');
  // Fichier SQLite : contrôles du serveur sans objet, signalés.
  const fichier = await controlerBase(db, options(null));
  assert.deepEqual(niveaux(fichier, 'attention').map(c => c.code), ['base.moteur']);
  await db.fermer();
  const vide = await nouvelleBase();
  const sans = await controlerBase(vide, options());
  assert.deepEqual(niveaux(sans, 'bloquant').map(c => c.code), ['base.admin']);
  assert.match(code(sans, 'base.confidentialite')[0].message, /responsable du traitement et DPO non renseignés/);
  await vide.setSetting('confidentialite', { responsable: 'EPC France', dpo: '' });
  assert.match(code(await controlerBase(vide, options()), 'base.confidentialite')[0].message, /DPO non renseigné\./);
  await vide.fermer();
});

test('base de démonstration chargée : bloquante, indices du jeu fictif ; réglage demo seul suffit', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const cs = await controlerBase(db, options());
  const demo = code(cs, 'base.demo')[0];
  assert.equal(demo.niveau, 'bloquant');
  assert.match(demo.message, /^Données de démonstration présentes : 25 comptes du jeu de démonstration, 24 fiches à une adresse @entreprise\.example, lot de paie historique « Démonstration »\.$/);
  assert.equal(codeSortie(cs), 1);
  await db.fermer();
  // Marqueur du chantier A (réglage `demo`) ; comptes du domaine fictif créés à la main.
  const autre = await avecAdmin();
  assert.deepEqual(await indicesDemo(autre), []);
  await autre.setSetting('demo', { chargeeLe: '2026-10-01T08:00:00.000Z', version: '0.1.0' });
  await creerCompte(autre, { type: 'local', identifiant: 'essai@entreprise.example', nom: 'Essai', adresse: 'essai@entreprise.example', profilRh: 'lecture_seule' }, null);
  assert.deepEqual(await indicesDemo(autre), ['réglage demo (jeu chargé le 2026-10-01)', `1 compte à une adresse @entreprise.example`]);
  await autre.setSetting('demo', {});
  assert.deepEqual((await indicesDemo(autre))[0], 'réglage demo (jeu chargé)');
  await autre.fermer();
});

test('base : intégrité, dossier des pièces, données illisibles', async () => {
  const db = await avecAdmin();
  await horsContraintes(db, async () => { await db.insert('feuilles', { empId: 404, week: '2026-10-05', statut: 'brouillon', lignes: [] }); });
  const cs = await controlerBase(db, { ...options(), espaceLibre: () => 300 * 1024 ** 2 });
  assert.match(code(cs, 'base.integrite')[0].message, /^1 référence orpheline : feuilles\.emp_id → employes : 1\.$/);
  assert.equal(code(cs, 'base.integrite')[0].niveau, 'bloquant');
  assert.match(code(cs, 'base.pieces')[0].message, /0,3 Go libres, moins de 1 Go/);
  // Dossier des pièces pas encore créé : jugé sur le dossier existant le plus proche ; espace réel (statfs).
  const ok = code(await controlerBase(db, { ...options(), dossierPieces: join(dossierPieces, 'a', 'b'), espaceLibre: undefined }), 'base.pieces')[0];
  assert.match(ok.message, /accessible en écriture, [\d,]+ Go libres/);
  // Dossier fermé en écriture (sans objet sous root, qui écrit partout).
  if (process.getuid?.() !== 0) {
    const ferme = join(dossierPieces, 'ferme');
    mkdirSync(ferme);
    chmodSync(ferme, 0o500);
    assert.equal(code(await controlerBase(db, { ...options(), dossierPieces: ferme }), 'base.pieces')[0].niveau, 'bloquant');
    chmodSync(ferme, 0o700);
  }
  await db.fermer();
  // Base fermée (lecture impossible) : bloquant, ou avertissement quand des migrations attendent cette version.
  assert.equal(code(await controlerBase(db, options(null)), 'base.donnees')[0].niveau, 'bloquant');
  const attente = await controlerBase(db, options(faits({ migrations: ['0001_init'] })));
  assert.equal(code(attente, 'base.donnees')[0].niveau, 'attention');
});

test('base : faits du serveur (rôle, schéma, droits, migrations, schéma conforme, vues, horloge)', async () => {
  const db = await avecAdmin();
  const un = async (x: Partial<FaitsServeur>, c: string) => code(await controlerBase(db, options(faits(x))), c);
  assert.match((await un({ utilisateur: 'postgres', superutilisateur: true }, 'base.role'))[0].message, /« postgres » \(superutilisateur\) au lieu de cursus_app/);
  assert.match((await un({ superutilisateur: true }, 'base.droits'))[0].message, /superutilisateur/);
  assert.match((await un({ schemaCourant: null }, 'base.schema'))[0].message, /aucun au lieu de cursus/);
  assert.match((await un({ creerDansBase: true, droitsGlobaux: ['pg_read_all_data'] }, 'base.droits'))[0].message, /CREATE sur la base, pg_read_all_data/);
  const plusRecente = await un({ migrations: [...migrationsPg().map(m => m.nom), '0099_futur'] }, 'base.migrations');
  assert.deepEqual([plusRecente[0].niveau, plusRecente[0].message], ['bloquant', 'Migrations inconnues de cette version : 0099_futur (base mise à jour par une version plus récente).']);
  const enAttente = await controlerBase(db, options(faits({ migrations: migrationsPg().slice(0, -1).map(m => m.nom) })));
  assert.match(code(enAttente, 'base.migrations')[0].message, /^1 migration en attente \(0010_evaluations_formation\) : appliquée au prochain démarrage\./);
  assert.deepEqual([code(enAttente, 'base.vues').length, code(enAttente, 'base.schema-conforme').length], [0, 0], 'contrôlés après les migrations');
  assert.match((await un({ schemaIncomplet: 'table pieces manquante' }, 'base.schema-conforme'))[0].message, /table pieces manquante/);
  const vues = { ...vuesAttendues(migrationsPg()), pub_salaries: ['matricule', 'nom'], pub_parametres: undefined!, pub_absences: ['du', 'matricule', 'au', 'statut', 'annulee', 'maj_le'] };
  delete (vues as Record<string, unknown>).pub_parametres;
  assert.equal((await un({ vues }, 'base.vues'))[0].message,
    'Vues publiées non conformes au contrat : pub_absences : colonnes dans un autre ordre ; pub_parametres absente ; pub_salaries sans poste, unite_code, site_code, entree, sortie, actif.');
  assert.match((await un({ ecartHorlogeMs: -95_000 }, 'base.horloge'))[0].message, /décalée de 95 s/);
  // Schéma jamais migré : données non lues, avertissement.
  const neuf = await controlerBase(db, options(faits({ migrations: null })));
  assert.deepEqual(neuf.at(-1)!.code, 'base.donnees');
  assert.equal(code(neuf, 'base.admin').length, 0);
  await db.fermer();
});

test('bilan : codes de sortie et rapport texte', () => {
  const c = (niveau: Controle['niveau'], remede?: string): Controle => ({ code: 'x', domaine: niveau === 'ok' ? 'configuration' : 'base', niveau, message: `m ${niveau}`, ...(remede ? { remede } : {}) });
  assert.equal(codeSortie([c('ok')]), 0);
  assert.equal(codeSortie([c('ok'), c('attention')]), 2);
  assert.equal(codeSortie([c('ok'), c('attention')], true), 1);
  assert.equal(codeSortie([c('attention'), c('bloquant')]), 1);
  const t = rapportTexte([c('ok'), c('attention', 'faire ceci'), c('bloquant')], 'Titre');
  assert.equal(t, ['Titre', '', 'Configuration', '  OK         m ok', '', 'Base', '  ATTENTION  m attention', '             → faire ceci', '  BLOQUANT   m bloquant', '',
    'Bilan : 1 bloquant, 1 avertissement, 1 OK — pas prête pour la production (code 1). Procédure : docs/BASCULE-PRODUCTION.md.'].join('\n'));
  assert.match(rapportTexte([c('ok'), c('ok')], 'T'), /0 bloquant, 0 avertissement, 2 OK — prête pour la production \(code 0\)/);
  assert.match(rapportTexte([c('attention'), c('attention')], 'T'), /2 avertissements, 0 OK — à revoir avant la production \(code 2\)/);
  assert.match(rapportTexte([c('bloquant'), c('bloquant')], 'T', true), /2 bloquants/);
});

// — La commande (fichier SQLite) —

const dossier = mkdtempSync(join(tmpdir(), 'cursus-verifier-production-'));
process.on('exit', () => { rmSync(dossier, { recursive: true, force: true }); rmSync(dossierPieces, { recursive: true, force: true }); });
const commande = (env: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/verifier-production.ts', ...args],
  { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
const { DATABASE_URL: _url, ...PROD_SQLITE } = { ...PRODUCTION, CURSUS_BASE: 'sqlite', CURSUS_CONTENEUR: '0' };
void _url;

test('commande : options, configuration seule, base de démonstration refusée sans être modifiée, JSON', async () => {
  assert.equal(commande({}, '--aide').status, 0);
  const inconnue = commande({}, '--url', 'https://cursus.example.fr');
  assert.equal(inconnue.status, 1);
  assert.match(inconnue.stderr, /Option inconnue : --url https:\/\/cursus\.example\.fr/);
  // Configuration seule : production cible en fichier SQLite choisi, seul avertissement attendu (DATABASE_URL absente).
  const fichier = join(dossier, 'cursus.db');
  const conf = commande({ ...PROD_SQLITE, CURSUS_DB: fichier }, '--config-seule');
  assert.equal(conf.status, 2, conf.stdout + conf.stderr);
  assert.match(conf.stdout, /base : non ouverte \(--config-seule\)/);
  assert.match(conf.stdout, /ATTENTION {2}DATABASE_URL absente/);
  assert.equal(commande({ ...PROD_SQLITE, CURSUS_DB: fichier }, '--config-seule', '--strict').status, 1, '--strict : avertissement bloquant');
  assert.equal(commande({ ...PROD_SQLITE, DATABASE_URL: PRODUCTION.DATABASE_URL, CURSUS_BASE: 'postgres', CURSUS_DB: fichier }, '--config-seule').status, 0, 'production cible : conforme');
  // Base absente.
  const absente = JSON.parse(commande({ ...PROD_SQLITE, CURSUS_DB: fichier }, '--json').stdout);
  assert.deepEqual(absente.controles.at(-1), { code: 'base.fichier', domaine: 'base', niveau: 'bloquant', message: `Base SQLite ${fichier} introuvable.`, remede: 'Vérifiez CURSUS_DB (ou DATABASE_URL pour le serveur commun).' });
  // Base de démonstration : bloquant, fichier intact (copie instantanée).
  const db = new SqliteDb(fichier);
  await seedDemo(db);
  await db.fermer();
  const avant = readFileSync(fichier), mtime = statSync(fichier).mtimeMs;
  const r = commande({ ...PROD_SQLITE, CURSUS_DB: fichier }, '--json');
  assert.equal(r.status, 1, r.stderr);
  const sortie = JSON.parse(r.stdout);
  assert.equal(sortie.code, 1);
  assert.equal(sortie.base, `fichier ${fichier}`);
  assert.equal(sortie.controles.find((c: Controle) => c.code === 'base.demo').niveau, 'bloquant');
  assert.equal(sortie.controles.find((c: Controle) => c.code === 'base.admin').niveau, 'ok', 'compte RH de démonstration');
  assert.ok(readFileSync(fichier).equals(avant) && statSync(fichier).mtimeMs === mtime, 'base jamais modifiée');
  // Texte : une ligne par contrôle, le bilan.
  const texte = commande({ ...PROD_SQLITE, CURSUS_DB: fichier });
  assert.match(texte.stdout, /^Cursus .* — vérification de production du .* · base : fichier /);
  assert.match(texte.stdout, /BLOQUANT {3}Données de démonstration présentes/);
  assert.match(texte.stdout, /Bilan : 1 bloquant, \d+ avertissements?, \d+ OK — pas prête pour la production \(code 1\)/);
  // Fichier illisible.
  const illisible = join(dossier, 'illisible.db');
  rmSync(illisible, { force: true });
  mkdirSync(illisible);
  const ko = JSON.parse(commande({ ...PROD_SQLITE, CURSUS_DB: illisible }, '--json').stdout);
  assert.match(ko.controles.at(-1).message, /^Base SQLite .* illisible : /);
});

test('commande interrompue : la copie instantanée de la base SQLite ne reste pas dans le dossier temporaire', async () => {
  const fichier = join(dossier, 'interrompue.db');
  const db = new SqliteDb(fichier);
  await seedDemo(db);
  await db.fermer();
  const temp = mkdtempSync(join(tmpdir(), 'cursus-pre-vol-tmp-'));
  try {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      const enfant = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/verifier-production.ts', '--json'],
        { cwd: ROOT, stdio: 'ignore', env: { PATH: process.env.PATH ?? '', ...PROD_SQLITE, CURSUS_DB: fichier, TMPDIR: temp } });
      const fin = new Promise<number | null>(res => enfant.on('exit', c => res(c)));
      // Signal envoyé dès que la copie existe (la commande seule en dispose).
      let vue = false;
      while (enfant.exitCode === null && !vue) {
        vue = readdirSync(temp).some(n => n.startsWith('cursus-pre-vol-'));
        if (!vue) await new Promise(r => setTimeout(r, 2));
      }
      if (vue) enfant.kill(signal);
      const c = await fin;
      // Sans gestionnaire, le signal tuerait le processus sur-le-champ (code null), copie laissée en place. Avec lui :
      // arrêt par le gestionnaire, ou contrôles menés à leur terme avant qu'il soit traité (base de démonstration : 1).
      if (vue) assert.ok([{ SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }[signal], 1].includes(c!), `${signal} : code ${c}`);
      assert.deepEqual(readdirSync(temp), [], `${signal} : copie supprimée`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
