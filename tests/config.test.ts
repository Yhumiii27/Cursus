// Règles de configuration du lot 8 (server/src/config.ts, chantier B) : image sans base désignée, adresse publique
// exigée en production (boucle locale explicite et démonstration exemptées), superutilisateur PostgreSQL, proxys crus
// sans restriction (S7), démonstration publique sans secrets de l'entreprise (S3) et liaisons sortantes coupées sauf
// CURSUS_DEMO_LIAISONS=1, e-mails toujours simulés en démonstration, démonstration branchée sur la base epc2i (simple
// avertissement dans le lot 8), MATRIX_URL avec identifiants (avertissement), commandes d'exploitation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = await import('../server/src/config.ts');
const { avertissementsConfig, boucleLocaleExplicite, cibleBase, configMail, demoSurBaseCommune, liaisonsCoupees, problemesConfig, verifierConfig } = config;
const { keystoneSortant } = await import('../server/src/integrations/keystone.ts');
const { declarerBase } = await import('../server/src/integrations/matrix.ts');
const { nouvelleBase } = await import('./base.ts');

const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
/** Production cible minimale : secrets et adresse publique. */
const PROD = { NODE_ENV: 'production', CURSUS_SECRET: 'x'.repeat(32), KEYSTONE_API_KEY: 'cle-keystone-de-test', CURSUS_PUBLIC_URL: 'https://cursus.example.fr' };
/** Variables posées par l'image Docker (Dockerfile). */
const IMAGE = { NODE_ENV: 'production', TZ: 'Europe/Paris', CURSUS_HOST: '0.0.0.0', CURSUS_TRUST_PROXY: 'loopback,uniquelocal', CURSUS_API_PORT: '3000', CURSUS_DB: '/data/cursus.db', CURSUS_CONTENEUR: '1' };
const DEMO_PUBLIQUE = { ...IMAGE, CURSUS_SECRET: 'd'.repeat(40), KEYSTONE_API_KEY: 'demo-keystone', CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1' };
const URL_PG = 'postgres://cursus_app:secret@epc2i-postgres:5432/epc2i';

/** Le seul problème signalé, qui doit correspondre à `re`. */
function seul(env: Record<string, string | undefined>, re: RegExp, label: string) {
  const pbs = problemesConfig(env);
  assert.equal(pbs.length, 1, `${label} : ${pbs.join(' / ')}`);
  assert.match(pbs[0], re, label);
}

test('image Docker en production : DATABASE_URL, ou CURSUS_BASE=sqlite choisie explicitement', () => {
  const img = { ...IMAGE, ...PROD };
  seul(img, /Image Docker sans DATABASE_URL : Cursus démarrerait sur un fichier SQLite vide du volume/, 'image sans base');
  assert.deepEqual(problemesConfig({ ...img, DATABASE_URL: URL_PG }), [], 'serveur commun');
  assert.deepEqual(problemesConfig({ ...img, CURSUS_BASE: 'sqlite' }), [], 'fichier choisi');
  assert.deepEqual(problemesConfig({ ...img, CURSUS_BASE: 'postgres', DATABASE_URL: URL_PG }), []);
  seul({ ...img, CURSUS_BASE: 'postgres' }, /CURSUS_BASE=postgres est définie sans DATABASE_URL/, 'postgres sans adresse');
  seul({ ...img, CURSUS_BASE: 'sqlite', DATABASE_URL: URL_PG }, /se contredisent/, 'contradiction');
  seul({ ...img, CURSUS_BASE: 'mysql' }, /CURSUS_BASE vaut « mysql »/, 'valeur inconnue');
  // Hors image (service systemd) : le fichier SQLite reste le choix par défaut.
  assert.deepEqual(problemesConfig(PROD), []);
  // Démonstration en ligne actuelle (image, SQLite) : jamais refusée par cette règle.
  assert.deepEqual(problemesConfig(DEMO_PUBLIQUE), []);
});

test('CURSUS_PUBLIC_URL exigée en production, hors démonstration et hors boucle locale explicite', () => {
  const sans = { ...PROD, CURSUS_PUBLIC_URL: undefined };
  seul(sans, /CURSUS_PUBLIC_URL est absente : indiquez l’adresse publique de Cursus, en https/, 'absente');
  seul({ ...PROD, CURSUS_PUBLIC_URL: 'http://cursus.example.fr' }, /CURSUS_PUBLIC_URL doit être en https/, 'en http');
  seul({ ...PROD, CURSUS_PUBLIC_URL: 'https://cursus.example.fr/rh' }, /sans chemin/, 'avec chemin');
  for (const host of ['127.0.0.1', 'localhost', '::1']) assert.deepEqual(problemesConfig({ ...sans, CURSUS_HOST: host }), [], `boucle locale ${host}`);
  assert.deepEqual(problemesConfig({ ...sans, HOST: '127.0.0.1' }), [], 'boucle locale posée par HOST');
  assert.equal(boucleLocaleExplicite({}), false, 'écoute par défaut : pas explicite');
  assert.deepEqual(problemesConfig({ ...sans, CURSUS_DEMO: '1', CURSUS_DEMO_PUBLIQUE: '1' }), [], 'démonstration');
  assert.deepEqual(problemesConfig({ ...sans, NODE_ENV: undefined }), [], 'hors production : rien à signaler');
  // Adresse publique seule : elle n'appelle plus les variables de la connexion Microsoft.
  assert.deepEqual(problemesConfig(PROD), []);
});

test('DATABASE_URL : rôle postgres refusé, rôle et base lus sans le mot de passe', () => {
  seul({ ...PROD, DATABASE_URL: 'postgres://postgres:secret@epc2i-postgres:5432/epc2i' }, /rôle postgres \(superutilisateur\)/, 'postgres');
  assert.ok(!problemesConfig({ ...PROD, DATABASE_URL: 'postgres://postgres:secret@h/epc2i' }).join().includes('secret'), 'mot de passe jamais affiché');
  assert.deepEqual(problemesConfig({ ...PROD, DATABASE_URL: URL_PG }), []);
  assert.deepEqual(cibleBase({ DATABASE_URL: 'postgresql://cursus%5Fapp:s%40cret@[::1]:5432/epc2i?sslmode=require' }), { role: 'cursus_app', base: 'epc2i', hote: '::1', sslmode: 'require', tls: 'sslmode=require' });
  // Rôle lu comme node-postgres : ?user= l'emporte, PGUSER en dernier recours ; « POSTGRES » est un autre rôle.
  seul({ ...PROD, DATABASE_URL: 'postgres://epc2i-postgres:5432/epc2i?user=postgres&password=x' }, /rôle postgres \(superutilisateur\)/, '?user=postgres');
  seul({ ...PROD, DATABASE_URL: 'postgres://cursus_app:x@epc2i-postgres:5432/epc2i?user=postgres' }, /rôle postgres/, '?user= l’emporte');
  seul({ ...PROD, DATABASE_URL: 'postgres://epc2i-postgres:5432/epc2i', PGUSER: 'postgres' }, /rôle postgres/, 'PGUSER=postgres');
  assert.deepEqual(problemesConfig({ ...PROD, DATABASE_URL: 'postgres://epc2i-postgres:5432/epc2i', PGUSER: 'cursus_app' }), [], 'PGUSER=cursus_app');
  assert.equal(cibleBase({ DATABASE_URL: 'postgres://POSTGRES:x@h/epc2i' })?.role, 'POSTGRES');
  // Aucun rôle : node-postgres prendrait le compte du système ; refusé en production seulement.
  seul({ ...PROD, DATABASE_URL: 'postgres://epc2i-postgres:5432/epc2i' }, /DATABASE_URL ne désigne aucun rôle/, 'sans rôle');
  assert.deepEqual(problemesConfig({ ...PROD, NODE_ENV: undefined, DATABASE_URL: 'postgres://h/epc2i' }), [], 'hors production');
  // Chiffrement lu comme node-postgres : sslmode, ssl=true, PGSSLMODE quand l'adresse n'en dit rien.
  const tls = (url: string, env: Record<string, string> = {}) => cibleBase({ DATABASE_URL: url, ...env })?.tls;
  assert.equal(tls('postgres://u@h/b?ssl=true'), 'ssl=true');
  assert.equal(tls('postgres://u@h/b?ssl=1'), 'ssl=1');
  assert.equal(tls('postgres://u@h/b?ssl=0'), null);
  assert.equal(tls('postgres://u@h/b', { PGSSLMODE: 'require' }), 'PGSSLMODE=require');
  assert.equal(tls('postgres://u@h/b', { PGSSLMODE: 'prefer' }), null);
  assert.equal(tls('postgres://u@h/b?sslmode=disable', { PGSSLMODE: 'require' }), null, 'l’adresse l’emporte');
  assert.equal(tls('postgres://u@h/b?sslmode=prefer'), null);
  assert.equal(cibleBase({ DATABASE_URL: 'pas une adresse' }), null);
  assert.equal(cibleBase({}), null);
});

test('CURSUS_TRUST_PROXY=true refusé (constat S7) ; liste de proxys admise', () => {
  seul({ ...PROD, CURSUS_TRUST_PROXY: 'true' }, /CURSUS_TRUST_PROXY=true fait croire les en-têtes X-Forwarded-\* de n’importe quel client/, 'true');
  for (const v of ['loopback', 'loopback,uniquelocal', '10.0.1.5', '172.18.0.0/16', '10.0.0.0/8', '1', 'false']) assert.deepEqual(problemesConfig({ ...PROD, CURSUS_TRUST_PROXY: v }), [], v);
  // Réseaux qui couvrent toutes les adresses : même effet que true.
  seul({ ...PROD, CURSUS_TRUST_PROXY: '0.0.0.0/0,::/0' }, /CURSUS_TRUST_PROXY couvre toutes les adresses \(0\.0\.0\.0\/0, ::\/0\) et fait croire/, '0.0.0.0/0,::/0');
  seul({ ...PROD, CURSUS_TRUST_PROXY: 'loopback, ::/0' }, /couvre toutes les adresses \(::\/0\)/, '::/0 dans une liste');
  seul({ ...PROD, CURSUS_TRUST_PROXY: '10.0.0.0/00' }, /couvre toutes les adresses/, 'préfixe /00');
});

test('démonstration publique (S3) : ni e-mails, ni connexion Microsoft, ni Sage hors simulation', () => {
  assert.deepEqual(problemesConfig(DEMO_PUBLIQUE), []);
  // Avec le problème de configuration des e-mails qui accompagne une boîte d'envoi sans application Entra.
  assert.match(problemesConfig({ ...DEMO_PUBLIQUE, CURSUS_MAIL_FROM: 'cursus@entreprise.fr' }).join(' / '), /Démonstration publique : CURSUS_MAIL_FROM est définie\. Retirez-les/);
  assert.match(problemesConfig({ ...DEMO_PUBLIQUE, CURSUS_MAIL_CLIENT_SECRET: 's', CURSUS_MAIL_SECRET_EXPIRE: '2027-01-01' }).join(' / '), /CURSUS_MAIL_CLIENT_SECRET, CURSUS_MAIL_SECRET_EXPIRE sont définies\. Retirez-les/);
  const oidc = { CURSUS_OIDC_TENANT: GUID, CURSUS_OIDC_CLIENT_ID: 'app', CURSUS_OIDC_CLIENT_SECRET: 'secret', CURSUS_PUBLIC_URL: 'https://demo.example.fr' };
  seul({ ...DEMO_PUBLIQUE, ...oidc }, /Démonstration publique : CURSUS_OIDC_TENANT, CURSUS_OIDC_CLIENT_ID, CURSUS_OIDC_CLIENT_SECRET sont définies/, 'connexion Microsoft');
  seul({ ...DEMO_PUBLIQUE, SAGE_MODE: 'fichier' }, /Démonstration publique : SAGE_MODE est définie/, 'Sage en fichier');
  seul({ ...DEMO_PUBLIQUE, SAGE_DOSSIER: 'CHIMIE' }, /SAGE_DOSSIER est définie/, 'dossier de paie');
  assert.deepEqual(problemesConfig({ ...DEMO_PUBLIQUE, SAGE_MODE: 'simulation' }), [], 'simulation admise');
  // Application de bureau (démonstration sur la boucle locale) : pas une démonstration publique.
  const bureau = { ...PROD, CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1' };
  assert.deepEqual(problemesConfig({ ...bureau, ...oidc }), []);
  // Option des commandes d'exploitation : règles de la démonstration écartées.
  assert.deepEqual(problemesConfig({ ...DEMO_PUBLIQUE, SAGE_DOSSIER: 'CHIMIE', CURSUS_TODAY: '2026-10-10' }, { reglesDemo: false }), []);
});

test('démonstration : e-mails toujours simulés, même configurés ; avertissement sur la boucle locale', () => {
  const mail = { CURSUS_MAIL_FROM: 'cursus@entreprise.fr', CURSUS_OIDC_TENANT: GUID, CURSUS_OIDC_CLIENT_ID: 'app', CURSUS_OIDC_CLIENT_SECRET: 'secret' };
  assert.ok(configMail(mail), 'hors démonstration : envoi réel');
  assert.equal(configMail({ ...mail, CURSUS_DEMO: '1' }), null, 'démonstration : simulation');
  assert.deepEqual(avertissementsConfig({ ...mail, CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1' }), ['Démonstration : CURSUS_MAIL_FROM est définie, mais les e-mails y restent simulés (rien ne part).']);
  assert.deepEqual(avertissementsConfig(mail), []);
});

test('démonstration publique : Keystone et Matrix coupés sauf CURSUS_DEMO_LIAISONS=1, avec un avertissement', async () => {
  const liaisons = { KEYSTONE_URL: 'http://keystone.interne:8080', KEYSTONE_TOKEN: 'k'.repeat(32), MATRIX_URL: 'http://matrix.interne:8080' };
  const demo = { ...DEMO_PUBLIQUE, ...liaisons };
  assert.equal(liaisonsCoupees(demo), true);
  assert.equal(keystoneSortant(demo), null, 'file sortante inactive (simulation)');
  assert.deepEqual(problemesConfig(demo), [], 'jamais bloquant');
  assert.deepEqual(avertissementsConfig(demo), [
    'Démonstration publique : KEYSTONE_URL, MATRIX_URL sont définies sans CURSUS_DEMO_LIAISONS=1 : envois à Keystone et déclaration à Matrix inactifs (simulation). '
      + 'Posez CURSUS_DEMO_LIAISONS=1 pour une liaison voulue entre démonstrations, sinon retirez-les.',
  ]);
  const voulue = { ...demo, CURSUS_DEMO_LIAISONS: '1' };
  assert.equal(liaisonsCoupees(voulue), false);
  assert.equal(keystoneSortant(voulue)?.url, 'http://keystone.interne:8080/api/cursus/v1/evenements');
  assert.deepEqual(avertissementsConfig(voulue), []);
  // Application de bureau, et production : jamais coupées.
  assert.equal(liaisonsCoupees({ ...liaisons, CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1' }), false);
  assert.ok(keystoneSortant({ ...PROD, ...liaisons }));
  assert.deepEqual(avertissementsConfig({ ...PROD, CURSUS_DEMO_LIAISONS: '1' }), ['CURSUS_DEMO_LIAISONS=1 est définie hors démonstration publique : elle n’a pas d’effet. Retirez-la.']);
  // Déclaration à Matrix : rien n'est écrit ni envoyé quand la liaison est coupée.
  const db = await nouvelleBase();
  const dir = mkdtempSync(join(tmpdir(), 'cursus-liaisons-'));
  try {
    assert.equal(await declarerBase(db, null, { ...DEMO_PUBLIQUE, MATRIX_DECLARATIONS_DIR: dir }), null);
    const doc = await declarerBase(db, null, { ...DEMO_PUBLIQUE, CURSUS_DEMO_LIAISONS: '1', MATRIX_DECLARATIONS_DIR: dir });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cursus.json'), 'utf8')), doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.fermer();
  }
});

test('démonstration sur la base epc2i du serveur commun : avertissement, jamais un refus (lot 8)', () => {
  const demo = { ...DEMO_PUBLIQUE, DATABASE_URL: URL_PG };
  assert.equal(demoSurBaseCommune(demo), true);
  assert.deepEqual(problemesConfig(demo), [], 'la démonstration en ligne n’est pas arrêtée');
  assert.match(avertissementsConfig(demo).join(), /Démonstration \(CURSUS_DEMO=1\) branchée sur la base epc2i du serveur commun : ses salariés fictifs sont publiés aux autres outils/);
  assert.equal(demoSurBaseCommune({ ...demo, DATABASE_URL: 'postgres://cursus_app:s@h:5432/demo_cursus' }), false, 'base de démonstration séparée');
  assert.equal(demoSurBaseCommune({ ...PROD, DATABASE_URL: URL_PG }), false, 'production');
  assert.deepEqual(avertissementsConfig(demo, { reglesDemo: false }), []);
});

test('MATRIX_URL avec identifiants : avertissement seulement, sans les afficher', () => {
  const env = { ...PROD, MATRIX_URL: 'https://svc:S3cret@matrix.example.fr', MATRIX_TOKEN: 'm'.repeat(32) };
  assert.deepEqual(problemesConfig(env), []);
  const av = avertissementsConfig(env);
  assert.equal(av.length, 1);
  assert.match(av[0], /MATRIX_URL contient un identifiant ou un mot de passe/);
  assert.ok(!av[0].includes('S3cret'));
  assert.deepEqual(avertissementsConfig({ ...PROD, MATRIX_URL: 'https://matrix.example.fr' }), []);
  assert.deepEqual(avertissementsConfig({ ...PROD, MATRIX_URL: 'pas une adresse' }), []);
});

test('verifierConfig : avertissements écrits sans arrêter ; refus nommant la commande d’exploitation', t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const exit = t.mock.method(process, 'exit', ((code?: number) => { throw new Error(`exit ${code}`); }) as never);
  verifierConfig({ ...DEMO_PUBLIQUE, DATABASE_URL: URL_PG });
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /^Configuration à revoir :\n {2}– Démonstration \(CURSUS_DEMO=1\) branchée sur la base epc2i/);
  assert.equal(exit.mock.callCount(), 0);
  assert.throws(() => verifierConfig({ ...PROD, CURSUS_TRUST_PROXY: 'true' }, { commande: 'npm run comptes' }), /exit 1/);
  assert.match(String(error.mock.calls[0].arguments[0]), /^npm run comptes refusée en production :\n {2}– CURSUS_TRUST_PROXY=true/);
  assert.throws(() => verifierConfig({ ...PROD, CURSUS_TRUST_PROXY: 'true' }), /exit 1/);
  assert.match(String(error.mock.calls[1].arguments[0]), /^Cursus ne peut pas démarrer en production/);
  verifierConfig(PROD);
  assert.equal(warn.mock.callCount(), 1, 'configuration conforme : rien d’écrit');
});

test('npm run comptes et npm run reprise-postgres : refus en production avant d’ouvrir la base', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'cursus-commandes-'));
  try {
    const env = { PATH: process.env.PATH ?? '', ...PROD, CURSUS_DB: join(dir, 'cursus.db'), DATABASE_URL: 'postgres://postgres:secret@127.0.0.1:1/epc2i' };
    const lancer = (fichier: string, ...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fichier, ...args], { cwd: ROOT, encoding: 'utf8', env });
    const comptes = lancer('server/src/comptes-cli.ts', 'admin', 'rachel.martin@entreprise.fr');
    assert.equal(comptes.status, 1);
    assert.match(comptes.stderr, /^npm run comptes refusée en production :\n {2}– DATABASE_URL se connecte avec le rôle postgres/);
    const reprise = lancer('server/src/reprise-postgres-cli.ts', '--a-blanc');
    assert.equal(reprise.status, 1);
    assert.match(reprise.stderr, /^npm run reprise-postgres refusée en production :/);
    assert.ok(!comptes.stderr.includes('secret') && !reprise.stderr.includes('secret'), 'mot de passe jamais affiché');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
