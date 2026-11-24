// Connexion par Clavis et droits lus dans la base (décision du propriétaire, 23-24 novembre 2026 : une seule base pour
// tous les outils). Configuration (CURSUS_OIDC_EMETTEUR, CURSUS_ACCES_CLAVIS), jeton de Clavis vérifié sans locataire
// Microsoft, profil RH lu dans clavis.pub_acces (seulement quand l'accès s'ouvre), reporté sur le compte et journalisé,
// lecture impossible = refus. La lecture de la vue n'existe que sur le serveur PostgreSQL commun (CURSUS_TEST_ENGINE=pg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer as serveurHttp } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_ACCES_CLAVIS_SECONDES = '0';

const { PG, nouvelleBase, schemaNeuf, surServeur } = await import('./base.ts');
const { configOidc, problemesConfig } = await import('../server/src/config.ts');
const { FournisseurOidc } = await import('../server/src/microsoft.ts');
const { appliquerProfilClavis, droitClavis, oublierDroitsClavis, profilDepuisAcces } = await import('../server/src/acces-clavis.ts');
const { creerCompte } = await import('../server/src/comptes.ts');
const { ouvrirPostgres } = await import('../server/src/db-pg.ts');

const CLAVIS = { CURSUS_OIDC_EMETTEUR: 'https://clavis.example', CURSUS_OIDC_CLIENT_ID: 'cursus', CURSUS_OIDC_CLIENT_SECRET: 's', CURSUS_PUBLIC_URL: 'https://cursus.example' };

test('profil RH de clavis.pub_acces : seulement quand l’accès s’ouvre, et seulement un profil de Cursus', () => {
  assert.equal(profilDepuisAcces({ role: 'rh_admin', ouvert: true }), 'rh_admin');
  assert.equal(profilDepuisAcces({ role: 'aucun', ouvert: true }), 'aucun');
  assert.equal(profilDepuisAcces({ role: 'rh_admin', ouvert: false }), null);
  assert.equal(profilDepuisAcces({ role: 'director', ouvert: true }), null);
  assert.equal(profilDepuisAcces(null), null);
});

test('configuration : Clavis pour émetteur, sans locataire Microsoft ; CURSUS_ACCES_CLAVIS contrôlée', () => {
  assert.deepEqual(configOidc(CLAVIS), {
    tenant: '', clientId: 'cursus', clientSecret: 's', publicUrl: 'https://cursus.example', redirection: 'https://cursus.example/api/auth/microsoft/retour',
    autorite: 'https://login.microsoftonline.com', emetteur: 'https://clavis.example',
  });
  assert.equal(configOidc({ ...CLAVIS, CURSUS_OIDC_EMETTEUR: 'http://clavis.example' }), null);
  assert.ok(!problemesConfig(CLAVIS).some(p => /OIDC|Microsoft 365 incomplète/.test(p)));
  assert.ok(problemesConfig({ ...CLAVIS, CURSUS_OIDC_EMETTEUR: 'ftp://x' }).some(p => /CURSUS_OIDC_EMETTEUR/.test(p)));
  assert.ok(problemesConfig({ CURSUS_ACCES_CLAVIS: 'on' }).some(p => /CURSUS_OIDC_EMETTEUR/.test(p)));
  assert.ok(problemesConfig({ ...CLAVIS, CURSUS_ACCES_CLAVIS: 'on' }).some(p => /PostgreSQL/.test(p)));
});

test('jeton de Clavis : émetteur et audience contrôlés, pas de locataire Microsoft exigé', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const srv = serveurHttp((req, res) => {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/.well-known/openid-configuration') return res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, jwks_uri: `${base}/oauth/jwks` }));
    res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' }] }));
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const cfg = configOidc({ ...CLAVIS, CURSUS_OIDC_EMETTEUR: base })!;
    const f = new FournisseurOidc(cfg);
    const jeton = (c: Record<string, unknown>) => {
      const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const t = `${b({ alg: 'RS256', kid: 'k1' })}.${b(c)}`;
      return `${t}.${sign('RSA-SHA256', Buffer.from(t), privateKey).toString('base64url')}`;
    };
    const now = Math.floor(Date.now() / 1000);
    const ok = { iss: base, aud: 'cursus', exp: now + 600, iat: now, nonce: 'n', tid: 'tenant-de-clavis', oid: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', preferred_username: 'a.b@epc-groupe.com' };
    assert.equal((await f.verifierJeton(jeton(ok), 'n')).oid, ok.oid);
    await assert.rejects(f.verifierJeton(jeton({ ...ok, iss: 'https://autre.example' }), 'n'), /Émetteur/);
    await assert.rejects(f.verifierJeton(jeton({ ...ok, aud: 'keystone' }), 'n'), /audience/);
  } finally {
    srv.close();
  }
});

test('hors du serveur PostgreSQL commun : la vue ne se lit pas, l’accès est refusé', { skip: PG && 'SQLite seulement' }, async () => {
  const db = await nouvelleBase();
  oublierDroitsClavis();
  assert.equal(await droitClavis(db, '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', { frais: true }), null);
});

test('profil RH lu dans clavis.pub_acces, reporté sur le compte et journalisé ; accès fermé ou vue absente : refus', { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' }, async () => {
  const { url, schema } = await schemaNeuf();
  const db = await ouvrirPostgres(url, { schema, env: { CURSUS_PG_POOL: '2' } });
  const OID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  try {
    // Remplaçante de la vue que Matrix publie sur le serveur commun (mêmes colonnes que celles que lit Cursus).
    await surServeur(url, 'DROP SCHEMA IF EXISTS clavis CASCADE');
    await surServeur(url, 'CREATE SCHEMA clavis');
    await surServeur(url, 'CREATE TABLE clavis.pub_acces (personne_id uuid, application text, autorise boolean, niveau text, domaine text, role text, ouvert boolean, maj_le timestamptz)');
    await surServeur(url, `INSERT INTO clavis.pub_acces VALUES ('${OID}', 'cursus', true, 'referent', 'hr', 'rh_gestionnaire', true, now()), ('${OID}', 'keystone', true, 'admin', null, 'director', true, now())`);
    oublierDroitsClavis();
    assert.equal(await droitClavis(db, OID, { frais: true }), 'rh_gestionnaire');
    const { compte } = await creerCompte(db, { type: 'microsoft', identifiant: 'a.b@epc-groupe.com', nom: 'A B', adresse: 'a.b@epc-groupe.com', profilRh: 'rh_gestionnaire' }, 'Clavis');
    await surServeur(url, `UPDATE clavis.pub_acces SET role = 'lecture_seule' WHERE application = 'cursus'`);
    const profil = await droitClavis(db, OID);
    assert.equal(profil, 'lecture_seule');
    const apres = await appliquerProfilClavis(db, compte, profil!);
    assert.equal(apres.profilRh, 'lecture_seule');
    assert.equal((await db.get<{ profilRh: string }>('comptes', compte.id))?.profilRh, 'lecture_seule');
    const j = await db.query<{ action: string; actor: string; message: string }>("SELECT action, actor, message FROM journal WHERE action = 'compte.profil'");
    assert.equal(j.length, 1);
    assert.equal(j[0].actor, 'Clavis');
    assert.match(j[0].message, /Lecture seule/);
    assert.equal(await appliquerProfilClavis(db, apres, 'lecture_seule'), apres); // rien à reporter : aucune écriture
    await surServeur(url, `UPDATE clavis.pub_acces SET ouvert = false WHERE application = 'cursus'`);
    assert.equal(await droitClavis(db, OID), null);
    await surServeur(url, 'DROP SCHEMA clavis CASCADE');
    assert.equal(await droitClavis(db, OID), null);
  } finally {
    await db.fermer();
    await surServeur(url, 'DROP SCHEMA IF EXISTS clavis CASCADE');
  }
});
