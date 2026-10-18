// Connexion Microsoft 365 (OpenID Connect) contre un faux fournisseur local : serveur node:http qui publie
// la découverte, les clés (JWKS) et le point de jeton, avec une clé RSA générée ici. Parcours complet,
// premier rattachement de l'oid, espace initial, refus de chaque jeton ou retour invalide (signature,
// audience, émetteur, dates, nonce, locataire, state, cookie d'état rejoué), comptes refusés, rotation
// des clés, déconnexion Microsoft, refus anonymes en nombre (journal protégé). Le serveur Cursus est lancé
// pour de vrai, hors démonstration.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as serveurHttp, type Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';

const { problemesConfig } = await import('../server/src/config.ts');
const { SqliteDb: Db } = await import('../server/src/db.ts');
const { json } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { ERREURS_MICROSOFT } = await import('../shared/constants.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-microsoft-'));
const procs: ChildProcess[] = [];
const serveurs: Server[] = [];
after(() => {
  procs.forEach(p => p.kill());
  serveurs.forEach(s => s.close());
  rmSync(dir, { recursive: true, force: true });
});

const TENANT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CLIENT = '6f1e2d3c-0000-4b5a-9c8d-7e6f5a4b3c2d';
const SECRET = 'secret-client-de-test';
/** Clé de signature des cookies de Cursus, connue du test pour fabriquer un cookie d'état périmé. */
const CLE_COOKIES = 'cle-de-signature-des-cookies-de-test-0123456789';

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    }).on('error', rej);
  });
}

// — Faux fournisseur OpenID (Entra ID) —

interface Cle { kid: string; privee: KeyObject; jwk: Record<string, unknown> }
const nouvelleCle = (kid: string): Cle => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privee: privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', x5t: kid } };
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Jeton signé RS256 par `cle` (en-tête kid). */
function jwt(claims: Record<string, unknown>, cle: Cle): string {
  const tete = `${b64({ typ: 'JWT', alg: 'RS256', kid: cle.kid })}.${b64(claims)}`;
  return `${tete}.${sign('RSA-SHA256', Buffer.from(tete), cle.privee).toString('base64url')}`;
}

async function fauxFournisseur() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const f = {
    base, emetteur: `${base}/${TENANT}/v2.0`, redirection: '',
    /** Clés publiées ; la première signe par défaut. */
    cles: [nouvelleCle('cle-1')],
    /** Codes émis : jeton à rendre et défi PKCE à contrôler (usage unique, comme chez Microsoft). */
    codes: new Map<string, { idToken: string; challenge: string }>(),
    lecturesJwks: 0,
    echanges: 0,
  };
  const srv = serveurHttp(async (req, res) => {
    const u = new URL(req.url!, base);
    const envoyer = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
      return envoyer(200, {
        issuer: f.emetteur, authorization_endpoint: `${base}/${TENANT}/oauth2/v2.0/authorize`, token_endpoint: `${base}/${TENANT}/oauth2/v2.0/token`,
        jwks_uri: `${base}/${TENANT}/discovery/v2.0/keys`, end_session_endpoint: `${base}/${TENANT}/oauth2/v2.0/logout`,
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (u.pathname === `/${TENANT}/discovery/v2.0/keys`) { f.lecturesJwks++; return envoyer(200, { keys: f.cles.map(k => k.jwk) }); }
    if (u.pathname === `/${TENANT}/oauth2/v2.0/token` && req.method === 'POST') {
      f.echanges++;
      let body = '';
      for await (const ch of req) body += ch;
      const p = new URLSearchParams(body);
      const c = f.codes.get(p.get('code') ?? '');
      f.codes.delete(p.get('code') ?? '');
      if (!c || p.get('grant_type') !== 'authorization_code' || p.get('redirect_uri') !== f.redirection) return envoyer(400, { error: 'invalid_grant', error_description: 'AADSTS70008: code invalide ou déjà utilisé.\r\nTrace ID: x' });
      if (p.get('client_id') !== CLIENT || p.get('client_secret') !== SECRET) return envoyer(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
      if (createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') !== c.challenge) {
        return envoyer(400, { error: 'invalid_grant', error_description: 'AADSTS501481: The Code_Verifier does not match the code_challenge.' });
      }
      return envoyer(200, { token_type: 'Bearer', scope: 'openid profile email', id_token: c.idToken, access_token: 'jeton-d-acces' });
    }
    envoyer(404, {});
  });
  serveurs.push(srv);
  await new Promise<void>(res => srv.listen(port, '127.0.0.1', res));
  return f;
}

// — Serveur Cursus —

const cookieDe = (r: globalThis.Response, nom: string) => r.headers.getSetCookie().find(c => c.startsWith(`${nom}=`)) ?? null;
const valeur = (c: string | null) => c?.split(';')[0] ?? null;

async function cursus(dbFile: string, env: Record<string, string>, port?: number) {
  port ??= await freePort();
  const p = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_API_PORT: String(port), CURSUS_DB: dbFile, CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', ...env },
  });
  procs.push(p);
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  await new Promise<void>((res, rej) => {
    const timer = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(timer); res(); } }, 20);
    p.on('exit', code => { clearInterval(timer); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, init: { cookie?: string | null; body?: unknown } = {}) => {
    const r = await fetch(base + path, {
      method: init.body !== undefined ? 'POST' : 'GET', redirect: 'manual',
      headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { r, status: r.status, location: r.headers.get('location'), session: valeur(cookieDe(r, 'cursus_session')), json: await r.json().catch(() => ({})) };
  };
  return { base, call, out: () => out };
}

test('configuration Microsoft 365 : tout ou rien, locataire désigné par son GUID, adresse publique en https', () => {
  const PROD = { NODE_ENV: 'production', CURSUS_SECRET: 'x'.repeat(32), KEYSTONE_API_KEY: 'cle-keystone-de-test' };
  const OIDC = { CURSUS_OIDC_TENANT: TENANT, CURSUS_OIDC_CLIENT_ID: CLIENT, CURSUS_OIDC_CLIENT_SECRET: SECRET, CURSUS_PUBLIC_URL: 'https://cursus.example.fr' };
  assert.deepEqual(problemesConfig({ ...PROD, ...OIDC }), []);
  assert.deepEqual(problemesConfig({ ...PROD, ...OIDC, CURSUS_PUBLIC_URL: 'https://cursus.example.fr/' }), [], 'barre finale admise');
  const cas: [string, Record<string, string | undefined>, RegExp][] = [
    ['secret client absent', { ...OIDC, CURSUS_OIDC_CLIENT_SECRET: undefined }, /incomplète : définissez aussi CURSUS_OIDC_CLIENT_SECRET/],
    ['adresse publique seule', { CURSUS_PUBLIC_URL: 'https://cursus.example.fr' }, /CURSUS_OIDC_TENANT, CURSUS_OIDC_CLIENT_ID, CURSUS_OIDC_CLIENT_SECRET/],
    ['locataire « common »', { ...OIDC, CURSUS_OIDC_TENANT: 'common' }, /format GUID/],
    ['locataire nom de domaine', { ...OIDC, CURSUS_OIDC_TENANT: 'entreprise.onmicrosoft.com' }, /format GUID/],
    ['adresse publique en http', { ...OIDC, CURSUS_PUBLIC_URL: 'http://cursus.example.fr' }, /doit être en https/],
    ['adresse publique avec chemin', { ...OIDC, CURSUS_PUBLIC_URL: 'https://cursus.example.fr/rh' }, /sans chemin/],
    ['autorité remplacée', { ...OIDC, CURSUS_OIDC_AUTORITE: 'https://faux.example' }, /réservée aux tests/],
  ];
  for (const [label, env, re] of cas) {
    const pbs = problemesConfig({ ...PROD, ...env });
    assert.equal(pbs.length, 1, `${label} : ${pbs.join(' / ')}`);
    assert.match(pbs[0], re, label);
  }
});

test('connexion Microsoft 365 (OpenID Connect, faux fournisseur local)', async t => {
  const f = await fauxFournisseur();
  const file = join(dir, 'microsoft.db');
  const db = new Db(file);
  await seedDemo(db);
  const port = await freePort();
  // L'adresse publique est celle de ce serveur de test (http admis hors production, avec un avertissement).
  const publicUrl = `http://127.0.0.1:${port}`;
  f.redirection = `${publicUrl}/api/auth/microsoft/retour`;
  const OIDC = { CURSUS_OIDC_TENANT: TENANT.toUpperCase(), CURSUS_OIDC_CLIENT_ID: CLIENT, CURSUS_OIDC_CLIENT_SECRET: SECRET, CURSUS_PUBLIC_URL: publicUrl, CURSUS_OIDC_AUTORITE: f.base };
  const srv = await cursus(file, { ...OIDC, CURSUS_SECRET: CLE_COOKIES }, port);

  const compte = async (where: string) => (await db.one(`SELECT id, identifiant, type, oid, emp_id AS "empId" FROM comptes WHERE ${where}`)) as { id: number; identifiant: string; type: string; oid: string | null; empId: number | null };
  const journal = async () => (await db.query('SELECT actor, role, action, message, identifiant, payload FROM journal ORDER BY id')) as
    { actor: string; role: string | null; action: string; message: string; identifiant: string | null; payload: string }[];
  const karim = (await compte('emp_id = 12'));
  const antoine = (await compte('emp_id = 14'));
  const sandrine = (await compte('emp_id IS NULL'));
  // Un collaborateur sans équipe à encadrer ni profil RH, doté d'un compte Microsoft 365.
  const collab = (await db.one(`SELECT c.id, c.identifiant FROM comptes c WHERE c.type = 'microsoft' AND c.emp_id IS NOT NULL AND c.profil_rh = 'aucun'
    AND c.emp_id NOT IN (SELECT manager_id FROM equipes WHERE manager_id IS NOT NULL) ORDER BY c.id`)) as { id: number; identifiant: string };
  assert.equal(karim.type, 'microsoft');

  interface Option {
    claims?: Record<string, unknown>; cle?: Cle; retour?: string; alterer?: (jeton: string) => string;
    state?: (s: string) => string; cookie?: (c: string) => string | null; session?: string | null;
  }
  const maintenant = () => Math.floor(Date.now() / 1000);
  /** Aller-retour complet : Cursus → « Microsoft » (simulé ici) → Cursus. */
  async function allerRetour(identite: { oid: string; upn: string; name?: string }, o: Option = {}) {
    const aller = await srv.call(`/api/auth/microsoft${o.retour !== undefined ? `?retour=${encodeURIComponent(o.retour)}` : ''}`);
    assert.equal(aller.status, 302);
    const auth = new URL(aller.location!);
    const etat = valeur(cookieDe(aller.r, 'cursus_oidc'))!;
    const p = auth.searchParams;
    const code = randomBytes(16).toString('base64url');
    const n = maintenant();
    const claims = {
      ver: '2.0', iss: f.emetteur, aud: CLIENT, tid: TENANT, oid: identite.oid, preferred_username: identite.upn, name: identite.name ?? identite.upn,
      nonce: p.get('nonce'), iat: n, nbf: n, exp: n + 3600, ...o.claims,
    };
    const jeton = jwt(claims, o.cle ?? f.cles[0]);
    f.codes.set(code, { idToken: o.alterer ? o.alterer(jeton) : jeton, challenge: p.get('code_challenge')! });
    const state = o.state ? o.state(p.get('state')!) : p.get('state')!;
    const cookie = o.cookie ? o.cookie(etat) : etat;
    const url = `/api/auth/microsoft/retour?code=${code}&state=${encodeURIComponent(state)}&session_state=abc`;
    const retour = await srv.call(url, { cookie: [cookie, o.session].filter(Boolean).join('; ') });
    return { ...retour, auth, etat, url, code };
  }
  const refuse = (r: { status: number; location: string | null; session: string | null }, code: string, label: string) => {
    assert.equal(r.status, 302, label);
    assert.equal(r.location, `/?connexion=${code}`, label);
    assert.equal(r.session, null, `${label} : aucune session ouverte`);
  };
  const derniere = async (action: string) => (await journal()).findLast(j => j.action === action)!;

  await t.test('aller : code d’autorisation avec PKCE (S256), state et nonce ; cookie d’état court, HttpOnly, SameSite=Lax', async () => {
    const s = await srv.call('/api/session');
    assert.deepEqual([s.json.microsoft, s.json.user, s.json.demo], [true, null, false]);
    const aller = await srv.call('/api/auth/microsoft?retour=%2Ftemps&identifiant=Karim.Haddad%40entreprise.example');
    assert.equal(aller.status, 302);
    const u = new URL(aller.location!);
    assert.equal(`${u.origin}${u.pathname}`, `${f.base}/${TENANT}/oauth2/v2.0/authorize`);
    const p = u.searchParams;
    assert.deepEqual(
      [p.get('client_id'), p.get('response_type'), p.get('redirect_uri'), p.get('response_mode'), p.get('code_challenge_method'), p.get('login_hint')],
      [CLIENT, 'code', f.redirection, 'query', 'S256', 'karim.haddad@entreprise.example'],
    );
    assert.match(p.get('scope')!, /\bopenid\b/);
    assert.match(p.get('code_challenge')!, /^[\w-]{43}$/);
    assert.ok(p.get('state')!.length >= 32 && p.get('nonce')!.length >= 32 && p.get('state') !== p.get('nonce'));
    const c = cookieDe(aller.r, 'cursus_oidc')!;
    for (const attr of ['HttpOnly', 'SameSite=Lax', 'Max-Age=600', 'Path=/api/auth/microsoft']) assert.ok(c.includes(attr), `${attr} : ${c}`);
    assert.ok(!c.includes(p.get('code_challenge')!), 'le défi seul part chez Microsoft ; le vérificateur reste dans le cookie signé');
    assert.equal((await srv.call('/api/auth/microsoft?choix=1')).location!.includes('prompt=select_account'), true);
  });

  await t.test('parcours complet : premier rattachement de l’oid, espace manager, retour à la page demandée', async () => {
    assert.equal(karim.oid, null);
    const r = await allerRetour({ oid: 'oid-karim', upn: 'Karim.Haddad@entreprise.example', name: 'Karim Haddad' }, { retour: '/temps' });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/temps');
    assert.ok(r.session, 'session ouverte');
    assert.ok(cookieDe(r.r, 'cursus_oidc')!.includes('Max-Age=0'), 'cookie d’état effacé');
    assert.equal((await compte('emp_id = 12')).oid, 'oid-karim', 'oid enregistré à la première connexion');
    const s = await srv.call('/api/session', { cookie: r.session });
    assert.deepEqual([s.json.user.nom, s.json.user.role, s.json.methode, s.json.compte.identifiant], ['Karim Haddad', 'manager', 'microsoft', karim.identifiant]);
    assert.equal((await srv.call('/api/data', { cookie: r.session })).status, 200);
    const j = (await derniere('connexion'));
    assert.deepEqual([j.actor, j.role, j.identifiant], ['Karim Haddad', 'manager', karim.identifiant]);
    assert.match(j.message, /première connexion, compte rattaché/);
    // Connexions suivantes : retrouvé par son oid, même si l'adresse de connexion a changé chez Microsoft.
    const r2 = await allerRetour({ oid: 'oid-karim', upn: 'k.haddad@entreprise.example' });
    assert.equal(r2.location, '/');
    assert.equal((await srv.call('/api/session', { cookie: r2.session })).json.user.nom, 'Karim Haddad');
    assert.equal((await derniere('connexion')).message, 'Connexion Microsoft 365');
  });

  await t.test('espace initial : RH pour un profil RH, sinon collaborateur', async () => {
    const a = await allerRetour({ oid: 'oid-antoine', upn: antoine.identifiant });
    const sa = await srv.call('/api/session', { cookie: a.session });
    assert.deepEqual([sa.json.user.nom, sa.json.role, sa.json.compte.espaces.join()], ['Antoine Leroy', 'rh', 'rh,manager,collaborateur']);
    const c = await allerRetour({ oid: 'oid-collab', upn: collab.identifiant });
    assert.equal((await srv.call('/api/session', { cookie: c.session })).json.role, 'collaborateur');
  });

  await t.test('page de retour : seulement un chemin de Cursus', async () => {
    for (const retour of ['//evil.example/x', 'https://evil.example', '/api/data', '/\\evil.example']) {
      assert.equal((await allerRetour({ oid: 'oid-collab', upn: collab.identifiant }, { retour })).location, '/', retour);
    }
  });

  await t.test('jeton refusé : signature altérée, audience, émetteur, expiré, pas encore valable, nonce, locataire, algorithme', async () => {
    const id = { oid: 'oid-collab', upn: collab.identifiant };
    const n = maintenant();
    const autre = nouvelleCle('cle-1'); // même kid, autre clé : signature invalide
    const cas: [string, Option, RegExp][] = [
      ['signature altérée', { alterer: j => { const [h, p, s] = j.split('.'); return `${h}.${p}.${s.slice(0, -6)}${s.slice(-6) === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'}`; } }, /Signature du jeton d’identité invalide/],
      ['charge modifiée', { alterer: j => { const [h, , s] = j.split('.'); return `${h}.${b64({ oid: 'oid-karim', aud: CLIENT })}.${s}`; } }, /Signature/],
      ['signé par une autre clé', { cle: autre }, /Signature/],
      ['mauvaise audience', { claims: { aud: 'autre-application' } }, /audience/],
      ['mauvais émetteur', { claims: { iss: `https://login.microsoftonline.com/${TENANT}/v2.0` } }, /Émetteur du jeton inattendu/],
      ['jeton expiré', { claims: { exp: n - 6 * 60 } }, /expiré/],
      ['pas encore valable', { claims: { nbf: n + 6 * 60, iat: n + 6 * 60 } }, /pas encore valable/],
      ['nonce incorrect', { claims: { nonce: 'un-autre-nonce' } }, /Nonce/],
      ['autre annuaire', { claims: { tid: '99999999-2222-3333-4444-555555555555' } }, /autre annuaire/],
      ['sans oid', { claims: { oid: '' } }, /oid/],
      ['algorithme « none »', { alterer: j => { const [, p] = j.split('.'); return `${b64({ alg: 'none', kid: 'cle-1' })}.${p}.`; } }, /Algorithme de signature refusé/],
    ];
    for (const [label, o, re] of cas) {
      const r = await allerRetour(id, o);
      refuse(r, 'jeton', label);
      const j = (await derniere('connexion.refusee'));
      assert.match(j.message, re, label);
      assert.equal(j.actor, 'Microsoft 365', label);
    }
    // Tolérance de 5 minutes sur les dates (horloges décalées).
    const tolere = await allerRetour(id, { claims: { exp: n - 4 * 60 } });
    assert.ok(tolere.session, 'expiré depuis 4 min : toléré');
  });

  await t.test('state incorrect, cookie d’état absent, falsifié ou rejoué : refus', async () => {
    const id = { oid: 'oid-collab', upn: collab.identifiant };
    const avant = f.echanges;
    refuse(await allerRetour(id, { state: s => `${s}x` }), 'etat', 'state différent');
    refuse(await allerRetour(id, { cookie: () => null }), 'etat', 'sans cookie d’état');
    refuse(await allerRetour(id, {
      cookie: c => { const [v, mac] = c.split('=')[1].split('.'); const e = JSON.parse(Buffer.from(v, 'base64url').toString()); e.retour = '/parametres';
        return `cursus_oidc=${Buffer.from(JSON.stringify(e)).toString('base64url')}.${mac}`; },
    }), 'etat', 'cookie modifié');
    assert.equal(f.echanges, avant, 'aucun code échangé sans état valable');
    // Rejeu : le même retour (même cookie, même state), une seconde fois.
    const ok = await allerRetour(id);
    assert.ok(ok.session);
    const auth = new URL(ok.auth);
    const code = randomBytes(16).toString('base64url');
    f.codes.set(code, { idToken: 'inutile', challenge: auth.searchParams.get('code_challenge')! });
    const rejeu = await srv.call(`/api/auth/microsoft/retour?code=${code}&state=${auth.searchParams.get('state')}`, { cookie: ok.etat });
    refuse(rejeu, 'etat', 'cookie d’état rejoué');
    // Cookie d'état signé par Cursus : modifiable seulement avec sa clé. Re-signé, il passe ; périmé, il est refusé.
    const resigner = (c: string, patch: Record<string, unknown>) => {
      const e = { ...JSON.parse(Buffer.from(c.split('=')[1].split('.')[0], 'base64url').toString()), ...patch };
      const v = b64(e);
      return `cursus_oidc=${v}.${createHmac('sha256', CLE_COOKIES).update(v).digest('base64url')}`;
    };
    assert.equal((await allerRetour(id, { cookie: c => resigner(c, { retour: '/absences' }) })).location, '/absences');
    refuse(await allerRetour(id, { cookie: c => resigner(c, { fin: Date.now() - 1000 }) }), 'etat', 'cookie d’état de plus de 10 minutes');
    // Code déjà utilisé : Microsoft refuse l'échange, Cursus n'ouvre rien.
    const aller = await srv.call('/api/auth/microsoft');
    const p = new URL(aller.location!).searchParams;
    const r = await srv.call(`/api/auth/microsoft/retour?code=${ok.code}&state=${p.get('state')}`, { cookie: valeur(cookieDe(aller.r, 'cursus_oidc')) });
    refuse(r, 'jeton', 'code déjà utilisé');
    assert.match((await derniere('connexion.refusee')).message, /Échange du code refusé par Microsoft \(HTTP 400, invalid_grant\) — AADSTS70008/);
  });

  await t.test('Microsoft refuse la connexion (error=access_denied) : message, journal', async () => {
    const aller = await srv.call('/api/auth/microsoft');
    const p = new URL(aller.location!).searchParams;
    const r = await srv.call(`/api/auth/microsoft/retour?error=access_denied&error_description=AADSTS50105&state=${p.get('state')}`, { cookie: valeur(cookieDe(aller.r, 'cursus_oidc')) });
    refuse(r, 'refus', 'access_denied');
    assert.match((await derniere('connexion.refusee')).message, /refusée par Microsoft \(access_denied, AADSTS50105\)/);
  });

  await t.test('compte inconnu, désactivé, salarié sorti : accès non autorisé, journalisé', async () => {
    const inconnu = await allerRetour({ oid: 'oid-inconnu', upn: 'Paul.Durand@entreprise.example', name: 'Paul Durand' });
    refuse(inconnu, 'acces', 'compte inconnu');
    let j = (await derniere('connexion.refusee'));
    assert.deepEqual([j.actor, j.identifiant], ['Paul Durand', null]);
    assert.match(j.message, /aucun compte Cursus pour paul\.durand@entreprise\.example/);
    assert.equal(json(j.payload).oid, 'oid-inconnu');
    const e = ERREURS_MICROSOFT.acces;
    assert.equal(`${e.titre} : ${e.texte}`, 'Accès non autorisé : demandez l’ouverture d’un compte au service RH.', 'message affiché par l’écran de connexion');
    // Un compte Cursus (local) ne s'ouvre jamais par Microsoft, même avec la même adresse.
    const local = (await compte(`type = 'local' AND emp_id IS NOT NULL`));
    refuse(await allerRetour({ oid: 'oid-local', upn: local.identifiant }), 'acces', 'compte local');

    // Compte désactivé : refus, journalisé à son nom ; l'oid n'est pas rattaché.
    const s = await allerRetour({ oid: 'oid-collab', upn: collab.identifiant });
    await db.update('comptes', collab.id, { actif: false });
    refuse(await allerRetour({ oid: 'oid-collab', upn: collab.identifiant }), 'ferme', 'compte désactivé');
    j = (await derniere('connexion.refusee'));
    assert.match(j.message, /Compte désactivé/);
    assert.equal(j.identifiant, collab.identifiant);
    assert.equal((await srv.call('/api/data', { cookie: s.session })).status, 401, 'sessions fermées');
    await db.update('comptes', collab.id, { actif: true });
    // Salarié sorti.
    const empId = ((await db.one('SELECT emp_id AS e FROM comptes WHERE id = ?', [collab.id])) as { e: number }).e;
    await db.update('employes', empId, { fin: '2026-10-09' });
    refuse(await allerRetour({ oid: 'oid-collab', upn: collab.identifiant }), 'ferme', 'salarié sorti');
    assert.match((await derniere('connexion.refusee')).message, /date de sortie/);
    await db.update('employes', empId, { fin: null });
    // Premier rattachement refusé (compte désactivé) : l'oid n'est pas enregistré.
    await db.update('comptes', sandrine.id, { actif: false });
    refuse(await allerRetour({ oid: 'oid-sandrine', upn: sandrine.identifiant }), 'ferme', 'désactivé, jamais connecté');
    assert.equal((await compte('emp_id IS NULL')).oid, null);
    await db.update('comptes', sandrine.id, { actif: true });
  });

  await t.test('rotation des clés : un kid inconnu fait relire les clés publiées', async () => {
    const avant = f.lecturesJwks;
    const nouvelle = nouvelleCle('cle-2');
    f.cles.push(nouvelle);
    const r = await allerRetour({ oid: 'oid-collab', upn: collab.identifiant }, { cle: nouvelle });
    assert.ok(r.session, 'jeton signé par la nouvelle clé accepté');
    assert.equal(f.lecturesJwks, avant + 1, 'clés relues une fois');
    await allerRetour({ oid: 'oid-collab', upn: collab.identifiant }, { cle: nouvelle });
    assert.equal(f.lecturesJwks, avant + 1, 'puis gardées en cache');
    refuse(await allerRetour({ oid: 'oid-collab', upn: collab.identifiant }, { cle: nouvelleCle('cle-3') }), 'jeton', 'kid inconnu même après relecture');
    assert.match((await derniere('connexion.refusee')).message, /Clé de signature inconnue : cle-3/);
  });

  await t.test('identité Microsoft recréée : refus, puis rattachement retiré par l’administrateur RH', async () => {
    refuse(await allerRetour({ oid: 'oid-karim-bis', upn: karim.identifiant }), 'acces', 'même adresse, autre oid');
    assert.match((await derniere('connexion.refusee')).message, /déjà rattaché à une autre identité Microsoft/);
    const admin = await allerRetour({ oid: 'oid-sandrine', upn: sandrine.identifiant });
    assert.equal((await srv.call('/api/session', { cookie: admin.session })).json.user.profilRh, 'rh_admin');
    const delier = await srv.call('/api/actions/compte.reinitialiser', { cookie: admin.session, body: { id: karim.id } });
    assert.equal(delier.status, 200, JSON.stringify(delier.json));
    assert.match(delier.json.message, /Rattachement Microsoft retiré pour Karim Haddad/);
    assert.equal((await compte('emp_id = 12')).oid, null);
    const vue = (await srv.call('/api/comptes', { cookie: admin.session })).json as { id: number; rattache: boolean }[];
    assert.deepEqual([vue.find(c => c.id === karim.id)!.rattache, vue.find(c => c.id === sandrine.id)!.rattache], [false, true]);
    const r = await allerRetour({ oid: 'oid-karim-bis', upn: karim.identifiant });
    assert.ok(r.session);
    assert.equal((await compte('emp_id = 12')).oid, 'oid-karim-bis');
    const moi = await srv.call('/api/actions/compte.reinitialiser', { cookie: admin.session, body: { id: sandrine.id } });
    assert.equal(moi.status, 403);
  });

  await t.test('une connexion Microsoft remplace la session du navigateur ; pas de mot de passe pour un compte Microsoft', async () => {
    const a = await allerRetour({ oid: 'oid-collab', upn: collab.identifiant });
    const b = await allerRetour({ oid: 'oid-antoine', upn: antoine.identifiant }, { session: a.session });
    assert.ok(b.session);
    assert.equal((await srv.call('/api/data', { cookie: a.session })).status, 401, 'ancienne session révoquée');
    assert.equal((await srv.call('/api/login', { body: { identifiant: antoine.identifiant, motDePasse: 'x'.repeat(12) } })).status, 401);
    assert.equal((await srv.call('/api/motdepasse', { cookie: b.session, body: { actuel: 'x', nouveau: 'y'.repeat(12) } })).status, 400);
  });

  await t.test('déconnexion : session révoquée, puis déconnexion Microsoft avec retour sur Cursus', async () => {
    const r = await allerRetour({ oid: 'oid-karim-bis', upn: karim.identifiant });
    const out = await srv.call('/api/logout', { cookie: r.session, body: {} });
    assert.equal(out.status, 200);
    assert.equal(out.json.user, null);
    const u = new URL(out.json.deconnexion);
    assert.equal(`${u.origin}${u.pathname}`, `${f.base}/${TENANT}/oauth2/v2.0/logout`);
    assert.equal(u.searchParams.get('post_logout_redirect_uri'), f.redirection);
    assert.equal((await srv.call('/api/data', { cookie: r.session })).status, 401);
    // Retour de Microsoft après la déconnexion (sans code ni state) : écran de connexion, rien de journalisé.
    const n = (await journal()).length;
    const retour = await srv.call('/api/auth/microsoft/retour');
    assert.deepEqual([retour.status, retour.location, retour.session], [302, '/', null]);
    assert.equal((await journal()).length, n);
  });

  await t.test('recours du service informatique (npm run comptes) : rattachement Microsoft de l’administrateur retiré', async () => {
    const s = await allerRetour({ oid: 'oid-sandrine', upn: sandrine.identifiant });
    assert.ok(s.session);
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/comptes-cli.ts', 'admin', sandrine.identifiant],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', CURSUS_DB: file, CURSUS_TODAY: '2026-10-10' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Accès administrateur RH rétabli/);
    assert.equal((await compte('emp_id IS NULL')).oid, null);
    assert.equal((await srv.call('/api/data', { cookie: s.session })).status, 401, 'sessions fermées');
    const nouvelle = await allerRetour({ oid: 'oid-sandrine-bis', upn: sandrine.identifiant });
    assert.ok(nouvelle.session, 'nouvelle identité rattachée');
  });

  await t.test('journal : jamais de secret, de code ni de jeton', async () => {
    const tout = JSON.stringify((await journal()));
    assert.ok(!tout.includes(SECRET));
    assert.ok(!/eyJ[\w-]+\.eyJ/.test(tout), 'aucun jeton');
  });
  db.sql.close();
});

test('sans configuration Microsoft 365 : pas de bouton, routes renvoyées à l’écran de connexion', async () => {
  const s = await cursus(join(dir, 'sans.db'), {});
  assert.equal((await s.call('/api/session')).json.microsoft, false);
  const r = await s.call('/api/auth/microsoft');
  assert.deepEqual([r.status, r.location, cookieDe(r.r, 'cursus_oidc')], [302, '/?connexion=indisponible', null]);
});

test('retour avec une erreur, par un visiteur anonyme : motif reconnu seulement, refus journalisés dans une limite par adresse', async () => {
  const f = await fauxFournisseur();
  const file = join(dir, 'refus.db');
  const db = new Db(file);
  await seedDemo(db);
  const port = await freePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  f.redirection = `${publicUrl}/api/auth/microsoft/retour`;
  const srv = await cursus(file, { CURSUS_OIDC_TENANT: TENANT, CURSUS_OIDC_CLIENT_ID: CLIENT, CURSUS_OIDC_CLIENT_SECRET: SECRET, CURSUS_PUBLIC_URL: publicUrl, CURSUS_OIDC_AUTORITE: f.base }, port);
  const refus = async () => ((await db.query(`SELECT message FROM journal WHERE action = 'connexion.refusee' ORDER BY id`)) as { message: string }[]).map(j => j.message);
  /** N'importe qui obtient un état valable, puis revient avec l'erreur de son choix. */
  async function retour(error: string, description?: string) {
    const aller = await srv.call('/api/auth/microsoft');
    const state = new URL(aller.location!).searchParams.get('state')!;
    const q = new URLSearchParams({ state, error, ...(description ? { error_description: description } : {}) });
    return await srv.call(`/api/auth/microsoft/retour?${q}`, { cookie: valeur(cookieDe(aller.r, 'cursus_oidc')) });
  }
  const r = await retour('Faux motif : appelez le 06 00 00 00 00', 'AADSTS50105: texte libre');
  assert.equal(r.location, '/?connexion=refus');
  assert.equal((await refus()).at(-1), 'Microsoft 365 : connexion refusée par Microsoft (motif inconnu, AADSTS50105)', 'texte reçu jamais recopié');
  await retour('consent_required');
  assert.equal((await refus()).at(-1), 'Microsoft 365 : connexion refusée par Microsoft (consent_required)');
  for (let i = 0; i < 40; i++) assert.equal((await retour(`Faux motif ${i}`)).location, '/?connexion=refus');
  const lignes = (await refus());
  assert.equal(lignes.length, 31, '30 refus journalisés, puis une ligne qui signale la suite');
  assert.match(lignes.at(-1)!, /30 refus en moins de 15 minutes depuis cette adresse — les suivants ne sont plus journalisés/);
  assert.ok(!lignes.some(m => m.includes('Faux motif') || m.includes('06 00')));
  db.sql.close();
});
