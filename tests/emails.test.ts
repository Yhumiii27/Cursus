// Tests des e-mails : configuration et envoi par Microsoft Graph (jeton applicatif, sendMail, erreurs), mode
// simulation tracé, adresse professionnelle de la fiche (t032), notifications des étapes de validation, aussitôt ou
// en récapitulatif quotidien (t033), convocations datées avec fichier .ics et désinscription (t113), relevé
// hebdomadaire des heures des intérimaires envoyé à leur agence (t030). Microsoft (service de jetons et Graph)
// est simulé par un serveur node:http local ; un dernier scénario lance le vrai serveur.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_PUBLIC_URL = 'https://cursus.example.fr';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET']) delete process.env[k];

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { traiterFile, demarrerEnvois } = await import('../server/src/envois.ts');
const { calendrier, envoyerEmail, transportEmail } = await import('../server/src/integrations/email.ts');
const { configMail, problemesConfig } = await import('../server/src/config.ts');
const { envoyerRecapitulatifs, recapitulatifEnAttente, tachesEmails } = await import('../server/src/notifications.ts');
const { reprendreAdressesDesComptes } = await import('../server/src/messagerie.ts');
const { relevesAutomatiques } = await import('../server/src/releves.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { Domain } = await import('../shared/domain.ts');
const { inscritsDe } = await import('../shared/rules/sessions.ts');
const { csvTexte, releveAgence, releveCsv, semainesAutomatiques } = await import('../shared/rules/releves.ts');
const { validerProfil, profilOf } = await import('../shared/rules/profil.ts');
const { EMAIL_LABEL } = await import('../shared/constants.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Envoi = import('../shared/types.ts').Envoi;
type Courriel = import('../shared/types.ts').Courriel;
type Corps = Record<string, any>;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const GEST: User = { role: 'rh', empId: null, nom: 'Antoine Leroy', intitule: 'Gestionnaire RH', profilRh: 'rh_gestionnaire' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const KARIM_COLLAB: User = { role: 'collaborateur', empId: 12, nom: 'Karim Haddad', intitule: 'Responsable maintenance' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: 'Manager · Logistique' };
const SOPHIE: User = { role: 'manager', empId: 3, nom: 'Sophie Lemaire', intitule: 'Manager · Production' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien de maintenance' };
const MEHDI_MAIL = 'mehdi.benali@entreprise.example', KARIM_MAIL = 'karim.haddad@entreprise.example';
const TENANT = '11111111-2222-3333-4444-555555555555';

const fermer: (() => void)[] = [];
after(() => fermer.forEach(f => f()));

/** Base de démonstration ; les actions passent par le même enchaînement que POST /api/actions/:nom. */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown> = {}) => db.tx(() => {
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    if (changeVerdicts(name)) suivreVerdicts(db);
    return r;
  });
  const forbidden = (user: User, name: string, payload: Record<string, unknown>) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === 403, `${name} devait être refusé`);
  /** E-mails mis en file (cible `email`), du plus ancien au plus récent ; `type` filtre. */
  const mails = (type?: string) => db.all<Envoi>('envois').filter(e => e.cible === 'email' && (!type || e.type === type)).map(e => ({ ...e, m: e.contenu as unknown as Courriel }));
  const domain = () => new Domain(loadFull(db, RH));
  const enAttente = () => db.all<Corps>('notifications').filter(n => !n.envoiId);
  return { db, run, forbidden, mails, domain, enAttente };
}

const texteDe = (base64: string) => Buffer.from(base64, 'base64').toString('utf8');

// — Configuration —

test('configuration : envoi par Microsoft Graph avec CURSUS_MAIL_FROM, application de la connexion Microsoft par défaut', () => {
  assert.equal(configMail({}), null, 'sans configuration : simulation');
  const oidc = { CURSUS_OIDC_TENANT: TENANT, CURSUS_OIDC_CLIENT_ID: 'app-connexion', CURSUS_OIDC_CLIENT_SECRET: 'secret-connexion' };
  assert.equal(configMail(oidc), null, 'sans boîte d’envoi : simulation');
  const cfg = configMail({ ...oidc, CURSUS_MAIL_FROM: ' Cursus@Entreprise.fr ' })!;
  assert.deepEqual([cfg.tenant, cfg.clientId, cfg.clientSecret, cfg.from, cfg.graph], [TENANT, 'app-connexion', 'secret-connexion', 'cursus@entreprise.fr', 'https://graph.microsoft.com']);
  assert.equal(cfg.autorite, 'https://login.microsoftonline.com');
  // Application propre aux e-mails : ses variables priment.
  const propre = configMail({ ...oidc, CURSUS_MAIL_FROM: 'cursus@entreprise.fr', CURSUS_MAIL_CLIENT_ID: 'app-mail', CURSUS_MAIL_CLIENT_SECRET: 'secret-mail' })!;
  assert.deepEqual([propre.clientId, propre.clientSecret], ['app-mail', 'secret-mail']);
  const transport = transportEmail(cfg)!;
  assert.equal(transport.url, 'https://graph.microsoft.com/v1.0/users/cursus%40entreprise.fr/sendMail');

  // Contrôle au démarrage (bloquant en production).
  const pb = (env: Record<string, string>) => problemesConfig({ CURSUS_SECRET: 'x'.repeat(40), KEYSTONE_API_KEY: 'cle', ...env });
  assert.deepEqual(pb({}), []);
  assert.deepEqual(pb({ ...oidc, CURSUS_PUBLIC_URL: 'https://cursus.example.fr', CURSUS_MAIL_FROM: 'cursus@entreprise.fr' }), []);
  assert.ok(pb({ CURSUS_MAIL_FROM: 'cursus@entreprise.fr' }).some(p => /application Entra .* CURSUS_MAIL_TENANT, CURSUS_MAIL_CLIENT_ID, CURSUS_MAIL_CLIENT_SECRET/.test(p)));
  assert.ok(pb({ CURSUS_MAIL_FROM: 'cursus', CURSUS_MAIL_TENANT: TENANT, CURSUS_MAIL_CLIENT_ID: 'a', CURSUS_MAIL_CLIENT_SECRET: 'b' }).some(p => /CURSUS_MAIL_FROM doit être l’adresse/.test(p)));
  assert.ok(pb({ CURSUS_MAIL_CLIENT_ID: 'a' }).some(p => /sans CURSUS_MAIL_FROM : les e-mails restent simulés/.test(p)));
  assert.ok(pb({ CURSUS_MAIL_FROM: 'cursus@entreprise.fr', CURSUS_MAIL_TENANT: 'entreprise.fr', CURSUS_MAIL_CLIENT_ID: 'a', CURSUS_MAIL_CLIENT_SECRET: 'b' }).some(p => /CURSUS_MAIL_TENANT doit être l’ID de l’annuaire/.test(p)));
});

test('simulation : l’e-mail est tracé dans le journal et marqué « simulé », rien ne part', async () => {
  const { db, mails } = fresh();
  assert.equal(transportEmail(), null);
  const e = db.tx(() => envoyerEmail(db, 'essai', { a: ['a@entreprise.example', 'a@entreprise.example'], objet: 'Essai', texte: 'Bonjour' }))!;
  assert.deepEqual([e.statut, e.cible, e.prochaine], ['simule', 'email', null]);
  assert.deepEqual((e.contenu as Corps).a, ['a@entreprise.example'], 'destinataires sans doublon');
  const j = db.all<Corps>('journal').filter(x => x.action === 'email.essai');
  assert.deepEqual(j.map(x => [x.actor, x.role, x.message]), [['Cursus', 'integration', 'E-mail « Essai » pour a@entreprise.example (simulation)']]);
  assert.equal(envoyerEmail(db, 'essai', { a: [], objet: 'Sans destinataire', texte: '' }), null);
  // Le processus de fond ne relève pas une cible sans transport.
  const arreter = demarrerEnvois(db, { email: transportEmail() }, 10);
  await new Promise(res => setTimeout(res, 30));
  arreter();
  assert.deepEqual(mails().map(x => x.statut), ['simule']);
  // Annulée avec l'action, la mise en file disparaît.
  assert.throws(() => db.tx(() => { envoyerEmail(db, 'essai', { a: ['b@entreprise.example'], objet: 'Annulé', texte: '' }); throw new Error('refus'); }), /refus/);
  assert.equal(mails().length, 1);
});

// — Microsoft Graph —

interface Recu { url: string; method: string; headers: IncomingHttpHeaders; body: string }
type Reponse = (res: ServerResponse) => void;
const repondre = (status: number, body?: unknown): Reponse => res => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

/** Faux Microsoft : service de jetons et API Graph sur le même serveur local. Réponses par défaut : jeton, puis 202. */
async function fauxMicrosoft() {
  const jetons: Recu[] = [], envois: Recu[] = [], repJetons: Reponse[] = [], repEnvois: Reponse[] = [];
  let n = 0;
  const srv = createServer((req, res) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      const r = { url: req.url!, method: req.method!, headers: req.headers, body: data };
      if (req.url!.endsWith('/oauth2/v2.0/token')) {
        jetons.push(r);
        (repJetons.shift() ?? repondre(200, { token_type: 'Bearer', expires_in: 3599, access_token: `jeton-${++n}` }))(res);
      } else {
        envois.push(r);
        (repEnvois.shift() ?? repondre(202))(res);
      }
    });
  });
  srv.listen(0, '127.0.0.1');
  await new Promise(res => srv.once('listening', res));
  fermer.push(() => { srv.closeAllConnections(); srv.close(); });
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const cfg = { tenant: TENANT, clientId: 'app-mail', clientSecret: 'secret-mail', from: 'cursus@entreprise.example', autorite: url, graph: url };
  return { url, cfg, jetons, envois, repJetons, repEnvois };
}

test('Microsoft Graph : jeton applicatif gardé, sendMail avec pièce jointe, 401 renouvelle le jeton, 403 et jeton refusé définitifs', async () => {
  const ms = await fauxMicrosoft();
  const t = transportEmail(ms.cfg)!;
  const { db, mails } = fresh();
  process.env.CURSUS_MAIL_FROM = 'cursus@entreprise.example';
  process.env.CURSUS_MAIL_TENANT = TENANT;
  process.env.CURSUS_MAIL_CLIENT_ID = 'app-mail';
  process.env.CURSUS_MAIL_CLIENT_SECRET = 'secret-mail';
  try {
    const a = db.tx(() => envoyerEmail(db, 'essai', { a: ['a@entreprise.example'], objet: 'Premier', texte: 'Texte', repondreA: 'rh@entreprise.example', pj: [{ nom: 'r.csv', type: 'text/csv', base64: Buffer.from('x;y').toString('base64') }] }))!;
    db.tx(() => envoyerEmail(db, 'essai', { a: ['b@entreprise.example'], objet: 'Second', texte: 'Texte' }));
    assert.equal(a.statut, 'a_envoyer', 'configuré : mis en file, rien dans le journal');
    assert.equal(db.all<Corps>('journal').filter(x => x.action.startsWith('email.')).length, 0);
    assert.equal(await traiterFile(db, 'email', t), 2);
    assert.equal(ms.jetons.length, 1, 'un jeton pour les deux envois');
    const form = new URLSearchParams(ms.jetons[0].body);
    assert.equal(ms.jetons[0].url, `/${TENANT}/oauth2/v2.0/token`);
    assert.deepEqual([form.get('grant_type'), form.get('client_id'), form.get('client_secret'), form.get('scope')], ['client_credentials', 'app-mail', 'secret-mail', `${ms.url}/.default`]);
    assert.equal(ms.envois[0].url, '/v1.0/users/cursus%40entreprise.example/sendMail');
    assert.equal(ms.envois[0].headers.authorization, 'Bearer jeton-1');
    const corps = JSON.parse(ms.envois[0].body);
    assert.deepEqual(corps, {
      message: {
        subject: 'Premier', body: { contentType: 'Text', content: 'Texte' }, toRecipients: [{ emailAddress: { address: 'a@entreprise.example' } }],
        replyTo: [{ emailAddress: { address: 'rh@entreprise.example' } }],
        attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'r.csv', contentType: 'text/csv', contentBytes: Buffer.from('x;y').toString('base64') }],
      },
      saveToSentItems: true,
    });
    assert.deepEqual(mails().map(x => [x.statut, x.accuse]), [['envoye', 'HTTP 202'], ['envoye', 'HTTP 202']]);

    // Jeton expiré ou révoqué (401) : nouveau jeton, nouvelle tentative.
    const c = db.tx(() => envoyerEmail(db, 'essai', { a: ['c@entreprise.example'], objet: 'Troisième', texte: '' }))!;
    ms.repEnvois.push(repondre(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' } }));
    await traiterFile(db, 'email', t);
    let x = db.get<Envoi>('envois', c.id)!;
    assert.deepEqual([x.statut, x.tentatives, x.erreur], ['a_envoyer', 1, 'HTTP 401 · InvalidAuthenticationToken — Access token has expired.']);
    await traiterFile(db, 'email', t, () => new Date(Date.now() + 61_000));
    x = db.get<Envoi>('envois', c.id)!;
    assert.equal(x.statut, 'envoye');
    assert.equal(ms.jetons.length, 2, 'jeton renouvelé');
    assert.equal(ms.envois.at(-1)!.headers.authorization, 'Bearer jeton-2');

    // Boîte hors de la stratégie d'accès, ou Mail.Send absent (403) : échec définitif, message de Graph conservé.
    const d = db.tx(() => envoyerEmail(db, 'essai', { a: ['d@entreprise.example'], objet: 'Quatrième', texte: '' }))!;
    ms.repEnvois.push(repondre(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } }));
    await traiterFile(db, 'email', t);
    x = db.get<Envoi>('envois', d.id)!;
    assert.deepEqual([x.statut, x.erreur], ['echec', 'HTTP 403 · ErrorAccessDenied — Access is denied. Check credentials and try again.']);
    assert.equal(db.all<Corps>('journal').filter(j => j.action === 'email.echec').length, 1);

    // Secret expiré : le service de jetons refuse, échec définitif sans appel à Graph ; 503 : nouvelle tentative.
    const t2 = transportEmail(ms.cfg)!;
    const e = db.tx(() => envoyerEmail(db, 'essai', { a: ['e@entreprise.example'], objet: 'Cinquième', texte: '' }))!;
    ms.repJetons.push(repondre(401, { error: 'invalid_client', error_description: 'AADSTS7000222: The provided client secret keys for app are expired. Trace ID: 0000' }));
    const avant = ms.envois.length;
    await traiterFile(db, 'email', t2);
    x = db.get<Envoi>('envois', e.id)!;
    assert.equal(x.statut, 'echec');
    assert.equal(x.erreur, 'Jeton Microsoft refusé : HTTP 401 · invalid_client — AADSTS7000222: The provided client secret keys for app are expired (voir docs/EMAILS.md)');
    assert.equal(ms.envois.length, avant);
    const f = db.tx(() => envoyerEmail(db, 'essai', { a: ['f@entreprise.example'], objet: 'Sixième', texte: '' }))!;
    ms.repJetons.push(repondre(503, { error: 'temporarily_unavailable' }));
    await traiterFile(db, 'email', t2);
    x = db.get<Envoi>('envois', f.id)!;
    assert.deepEqual([x.statut, x.tentatives], ['a_envoyer', 1]);
    assert.match(x.erreur!, /^Jeton Microsoft refusé : HTTP 503 · temporarily_unavailable$/);
    // Relance d'un échec : possible une fois l'envoi configuré.
    const r = fresh();
    r.db.insert('envois', { ...db.get<Envoi>('envois', d.id)!, id: undefined, cle: 'relance-email' });
    const id = r.db.all<Envoi>('envois').at(-1)!.id;
    assert.match(String(r.run(RH, 'envoi.relancer', { id })), /relancé vers la messagerie Microsoft 365/);
  } finally {
    for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET']) delete process.env[k];
  }
  const r = fresh();
  r.db.insert('envois', { cible: 'email', type: 'essai', cle: 'simule-echec', contenu: {}, statut: 'echec', tentatives: 1, prochaine: null, erreur: 'HTTP 403', accuse: null, creation: '2026-10-10T08:00:00.000Z', tentative: null, envoi: null, classe: null });
  assert.throws(() => r.run(RH, 'envoi.relancer', { id: r.db.all<Envoi>('envois').at(-1)!.id }), /non configuré : relance impossible/);
});

test('ICS : événement d’une journée, texte échappé, lignes repliées, annulation', () => {
  const ics = calendrier({ uid: 'formation-2-2@cursus.example.fr', date: '2026-11-18', titre: 'Formation : Sauveteur, secouriste; du travail', lieu: 'Site de Lyon — salle B', description: 'é'.repeat(80) }, new Date('2026-10-10T08:00:00Z'));
  const lignes = ics.split('\r\n');
  assert.equal(lignes[0], 'BEGIN:VCALENDAR');
  assert.ok(lignes.includes('METHOD:PUBLISH'));
  assert.ok(lignes.includes('DTSTART;VALUE=DATE:20261118') && lignes.includes('DTEND;VALUE=DATE:20261119'));
  assert.ok(lignes.includes('SUMMARY:Formation : Sauveteur\\, secouriste\\; du travail'));
  assert.ok(lignes.includes('DTSTAMP:20261010T080000Z'));
  assert.ok(lignes.every(l => Buffer.byteLength(l) <= 75), 'lignes de 75 octets au plus');
  assert.ok(lignes.some(l => l.startsWith(' é')), 'description repliée');
  assert.ok(lignes.includes('STATUS:CONFIRMED') && !lignes.some(l => l.startsWith('ORGANIZER')));
  const organisateur = { nom: 'Cursus', adresse: 'cursus@entreprise.fr' };
  assert.match(calendrier({ uid: 'u@x', date: '2026-11-18', titre: 'Formation', provisoire: true, organisateur }), /ORGANIZER;CN=Cursus:mailto:cursus@entreprise\.fr\r\n[\s\S]*STATUS:TENTATIVE\r\n/);
  const annule = calendrier({ uid: 'formation-2-2@cursus.example.fr', date: '2026-11-18', titre: 'Formation', annule: true, organisateur }, new Date('2026-10-11T08:00:00Z'));
  assert.match(annule, /METHOD:CANCEL\r\n/);
  assert.match(annule, /ORGANIZER;CN=Cursus:mailto:cursus@entreprise\.fr\r\n/, 'RFC 5546 : organisateur exigé pour une annulation');
  assert.match(annule, /STATUS:CANCELLED\r\n/);
  const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)![1]);
  assert.ok(seq(annule) > seq(ics), 'version postérieure : l’agenda retient l’annulation');
});

// — t032 : adresse professionnelle —

test('t032 : adresse professionnelle sur la fiche — saisie par le RH, unique, validée, en minuscules ; reprise du compte Microsoft 365', () => {
  const { db, run, forbidden, domain } = fresh();
  assert.equal(domain().emp(2)!.email, MEHDI_MAIL, 'démonstration : chacun a une adresse');
  run(RH, 'employe.modifier', { id: 2, email: '  Mehdi.Benali@Entreprise.example ' });
  assert.equal(domain().emp(2)!.email, MEHDI_MAIL);
  assert.throws(() => run(RH, 'employe.modifier', { id: 2, email: 'mehdi.benali' }), /Adresse e-mail professionnelle invalide/);
  assert.throws(() => run(RH, 'employe.modifier', { id: 2, email: KARIM_MAIL }), /déjà attribuée à Karim Haddad/);
  forbidden(KARIM, 'employe.modifier', { id: 2, email: 'autre@entreprise.example' });
  // Sans adresse : simple avertissement (ni notification ni convocation).
  const v = validerProfil({ ...profilOf(domain().emp(2)!), email: null }, { equipes: domain().equipes, year: 2026 });
  assert.ok(v.ok && v.warnings.some(w => /Adresse e-mail professionnelle manquante/.test(w)));
  const id = (run(RH, 'employe.creer', {
    nom: 'Léon Petitjean', poste: 'Technicien', equipe: 'Maintenance', statut: 'technicien', typeContrat: 'cdi', temps: '35h', entree: '2026-10-01', naissance: 1990,
  }) as { result: { id: number } }).result.id;
  assert.equal(domain().emp(id)!.email, null);
  // Compte Microsoft 365 créé : son identifiant (adresse de connexion) devient l'adresse de la fiche.
  const r = run(RH, 'compte.creer', { empId: id, type: 'microsoft', identifiant: 'Leon.Petitjean@Entreprise.example', profilRh: 'aucun' }) as { message: string };
  assert.match(r.message, /adresse e-mail reprise sur la fiche/);
  assert.equal(domain().emp(id)!.email, 'leon.petitjean@entreprise.example');
  // Base antérieure : reprise une seule fois des adresses des comptes Microsoft.
  db.sql.exec(`UPDATE employes SET email = NULL WHERE id IN (2, 12, 1)`);
  db.sql.exec(`DELETE FROM settings WHERE key = 'adressesComptesReprises'`);
  let copies = 0;
  reprendreAdressesDesComptes(db, () => { copies++; });
  assert.equal(copies, 1, 'copie de sécurité avant la reprise');
  assert.deepEqual([domain().emp(2)!.email, domain().emp(12)!.email], [MEHDI_MAIL, KARIM_MAIL]);
  assert.equal(domain().emp(1)!.email, null, 'compte Cursus (cariste) : pas d’adresse à reprendre');
  db.sql.exec(`UPDATE employes SET email = NULL WHERE id = 2`);
  reprendreAdressesDesComptes(db, () => { copies++; });
  assert.equal(domain().emp(2)!.email, null, 'une seule fois : une adresse effacée depuis n’est pas remise');
});

test('t032 : npm run comptes rattaché à une fiche (--salarie) reprend l’adresse du compte Microsoft 365', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-cli-'));
  const fichier = join(dir, 'cursus.db');
  try {
    const db = new Db(fichier);
    seedDemo(db);
    db.sql.exec(`DELETE FROM comptes WHERE emp_id = 2; UPDATE employes SET email = NULL WHERE id = 2`);
    db.sql.close();
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/comptes-cli.ts', 'admin', 'Mehdi.Benali@entreprise.example', '--salarie', '2'],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', CURSUS_DB: fichier, CURSUS_TODAY: '2026-10-10' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Administrateur RH créé : Mehdi Benali \(mehdi\.benali@entreprise\.example, Microsoft 365\) · adresse e-mail mehdi\.benali@entreprise\.example reprise sur la fiche/);
    const apres = new Db(fichier);
    assert.equal(apres.get<{ email: string | null }>('employes', 2)!.email, MEHDI_MAIL);
    apres.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// — t033 : notifications des étapes —

test('t033 : chaque étape notifie son destinataire, aussitôt ou dans le récapitulatif quotidien', () => {
  const { db, run, mails, enAttente } = fresh();
  // Demande de congés de Mehdi : Karim, son manager, reçoit un récapitulatif quotidien (réglage de démonstration).
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  assert.equal(mails().length, 0);
  assert.deepEqual(enAttente().map(n => [n.empId, n.adresse, n.type, n.objet]), [[12, KARIM_MAIL, 'absence.demande', 'Demande de congés payés à valider — Mehdi Benali']]);
  assert.match(enAttente()[0].texte, /^Mehdi Benali demande des congés payés du lundi 7 décembre au mardi 8 décembre 2026\./);
  // Feuille de la semaine 41 saisie par Mehdi, puis soumise.
  db.insert('feuilles', { empId: 2, week: '2026-10-05', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: 'Maintenance interne', ks: false, h: [7, 7, 7, 7, 7] }] });
  run(MEHDI, 'temps.submit', { empId: 2, week: '2026-10-05' });
  assert.equal(recapitulatifEnAttente(db), 2);
  // Récapitulatif : un e-mail par destinataire, notifications dans l'ordre, puis marquées envoyées.
  assert.equal(db.tx(() => envoyerRecapitulatifs(db)), 1);
  const [recap] = mails('recapitulatif');
  assert.deepEqual(recap.m.a, [KARIM_MAIL]);
  assert.equal(recap.m.objet, 'Cursus — récapitulatif du 10 oct. 2026 : 2 notifications');
  assert.match(recap.m.texte, /^Bonjour Karim Haddad,\n\nVoici les notifications de Cursus/);
  assert.ok(recap.m.texte.indexOf('Demande de congés payés à valider') < recap.m.texte.indexOf('Feuille de temps à valider — Mehdi Benali, semaine 41'));
  assert.match(recap.m.texte, /Cursus : https:\/\/cursus\.example\.fr\n/);
  assert.equal(recap.m.repondreA, 'rh@entreprise.example');
  assert.equal(recapitulatifEnAttente(db), 0);
  assert.equal(db.tx(() => envoyerRecapitulatifs(db)), 0);

  // Karim passe aux notifications immédiates (espace collaborateur ou manager : son propre réglage).
  assert.match(String(run(KARIM_COLLAB, 'notification.regler', { mode: 'immediat' })), /Vos notifications par e-mail : aussitôt/);
  const decision = db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-07'`).get() as { id: number };
  run(KARIM, 'absence.decider', { id: decision.id, ok: true });
  const [d] = mails('absence.decision');
  assert.deepEqual(d.m.a, [MEHDI_MAIL]);
  assert.equal(d.m.objet, 'Demande de congés payés validée');
  assert.match(d.m.texte, /^Bonjour Mehdi Benali,\n\nVotre demande de congés payés du lundi 7 décembre au mardi 8 décembre 2026 a été validée par Karim Haddad\./);
  // Feuille renvoyée : au salarié, sans le commentaire (texte libre resté dans Cursus).
  run(KARIM, 'temps.reject', { empId: 2, week: '2026-10-05', comment: 'Heures du lundi à revoir' });
  const [renvoi] = mails('temps.renvoyee');
  assert.equal(renvoi.m.objet, 'Feuille de temps de la semaine 41 à corriger');
  assert.match(renvoi.m.texte, /vous est renvoyée pour correction par Karim Haddad\. Le commentaire est à lire dans Cursus/);
  assert.doesNotMatch(renvoi.m.texte, /lundi à revoir/);
  // Feuille soumise de nouveau : Karim, désormais en notifications immédiates, reçoit l'e-mail aussitôt.
  run(MEHDI, 'temps.submit', { empId: 2, week: '2026-10-05' });
  const [soumise] = mails('temps.soumise');
  assert.deepEqual([soumise.m.a, soumise.m.objet], [[KARIM_MAIL], 'Feuille de temps à valider — Mehdi Benali, semaine 41']);
  assert.match(soumise.m.texte, /Mehdi Benali a soumis sa feuille de temps pour la semaine 41 \(du lundi 5 octobre au vendredi 9 octobre 2026\)/);
  // Le valideur qui soumet lui-même la feuille d'un membre ne se notifie pas.
  run(KARIM, 'temps.reject', { empId: 2, week: '2026-10-05' });
  run(KARIM, 'temps.submit', { empId: 2, week: '2026-10-05' });
  assert.equal(mails('temps.soumise').length, 1);
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-12-10', au: '2026-12-10' });
  assert.equal(mails('absence.demande').at(-1)!.m.objet, 'Demande de RTT / repos à valider — Mehdi Benali');
  // Congés posés par le manager : le salarié en est informé.
  run(KARIM, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-12-11', au: '2026-12-11' });
  assert.equal(mails('absence.decision').at(-1)!.m.objet, 'Congés posés pour vous : RTT / repos');

  // Salarié sans manager (à affecter) : le service RH est notifié à l'adresse des paramètres ; pas le RH qui agit.
  run(RH, 'equipe.affecter', { empId: 6, equipe: null });
  run({ role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: '' }, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-14', au: '2026-12-14' });
  assert.deepEqual(mails('absence.demande').at(-1)!.m.a, ['rh@entreprise.example']);
  const n = mails().length;
  run(RH, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-15', au: '2026-12-15' });
  assert.equal(mails().length, n, 'le service RH n’est pas notifié de sa propre action');

  // Entretien : convocation (aussitôt, avec .ics) puis compte rendu clos à signer.
  assert.match(String(run(KARIM, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-11-16' })), /convocation envoyée à Mehdi Benali$/);
  const [conv] = mails('entretien.convocation');
  assert.equal(conv.m.objet, 'Convocation : entretien annuel d’évaluation — 16 nov. 2026');
  assert.match(conv.m.texte, /Karim Haddad vous convoque à un entretien annuel d’évaluation le lundi 16 novembre 2026\./);
  const ics = texteDe(conv.m.pj![0].base64);
  assert.match(ics, /DTSTART;VALUE=DATE:20261116/);
  assert.match(ics, /UID:entretien-\d+@cursus\.example\.fr/);
  const ent = db.sql.prepare(`SELECT id FROM entretiens WHERE emp_id = 2 AND date = '2026-11-16'`).get() as { id: number };
  // Prévu le 16 novembre, tenu dès aujourd'hui : la clôture porte la date à laquelle il a eu lieu.
  run(KARIM, 'entretien.clore', { id: ent.id, date: '2026-10-10' });
  assert.equal(mails('entretien.clos').at(-1)!.m.objet, 'Compte rendu d’entretien à signer');

  // Demande au service RH : décision au salarié et au manager qui l'a émise.
  run(RH, 'demande.refuser', { id: 1, reponse: 'Budget épuisé' }); // Marion Petit, demandée par Sophie Lemaire
  const rep = mails('demande.reponse');
  assert.deepEqual(rep.map(x => [x.m.a[0], x.m.objet]), [
    ['marion.petit@entreprise.example', 'Demande de formation « CACES R489 — Chariots élévateurs (cat. 3) » refusée'],
    ['sophie.lemaire@entreprise.example', 'Demande de formation « CACES R489 — Chariots élévateurs (cat. 3) » refusée — Marion Petit'],
  ]);
  assert.ok(rep.every(x => !x.m.texte.includes('Budget épuisé')), 'la réponse saisie reste dans Cursus');
  // Salarié sorti : plus de notification.
  db.update('employes', 2, { fin: '2026-10-09' });
  const m = mails().length;
  run(KARIM, 'temps.reject', { empId: 2, week: '2026-10-05' });
  assert.equal(mails().length, m);
  assert.deepEqual(Object.keys(EMAIL_LABEL).filter(k => !mails().some(x => x.type === k)).sort(),
    ['convocation', 'convocation.annulee', 'entretien.remise', 'essai', 'releve.interim', 'temps.relance', 'visite.demande'],
    'les autres types sont couverts par les tests suivants (visite.demande : tests/sante.test.ts ; entretien.remise : tests/entretiens-plan.test.ts ; temps.relance : tests/suivi-feuilles.test.ts)');
});

test('t033 : récapitulatif quotidien à partir de 7 h, une fois par jour même après un redémarrage, à l’adresse en vigueur', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-recap-'));
  const fichier = join(dir, 'cursus.db');
  let db = new Db(fichier);
  try {
    seedDemo(db);
    const run = (user: User, name: string, payload: Record<string, unknown> = {}) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
    const recaps = () => db.all<Envoi>('envois').filter(e => e.type === 'recapitulatif').map(e => (e.contenu as unknown as Courriel).a[0]);
    // Demande de Mehdi : Karim (récapitulatif quotidien) l'a pour karim.haddad@… ; le RH corrige son adresse avant 7 h.
    run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
    run(RH, 'employe.modifier', { id: 12, email: 'k.haddad@entreprise.example' });
    // La semaine 40 de Léa Girard est validée : son relevé part avec le premier passage des tâches de fond.
    db.sql.exec(`UPDATE feuilles SET statut = 'validee' WHERE emp_id = 15 AND week = '2026-09-28'`);
    assert.deepEqual(tachesEmails(db, 6), { releves: 1, recapitulatifs: null }, 'avant 7 h : pas de récapitulatif');
    assert.equal(recapitulatifEnAttente(db), 1);
    assert.deepEqual(tachesEmails(db, 7), { releves: 0, recapitulatifs: 1 });
    assert.deepEqual(recaps(), ['k.haddad@entreprise.example'], 'adresse en vigueur, pas celle notée à la notification');
    // Une nouvelle notification dans la journée attend le lendemain, même après un redémarrage.
    run(MEHDI, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-12-10', au: '2026-12-10' });
    assert.deepEqual(tachesEmails(db, 18), { releves: 0, recapitulatifs: null });
    db.sql.close();
    db = new Db(fichier);
    assert.deepEqual(tachesEmails(db, 9), { releves: 0, recapitulatifs: null }, 'redémarrage : déjà envoyé aujourd’hui');
    process.env.CURSUS_TODAY = '2026-10-11';
    try {
      assert.deepEqual(tachesEmails(db, 7), { releves: 0, recapitulatifs: 1 }, 'le lendemain à 7 h');
      // Karim sorti de l'entreprise : sa notification en attente est close sans envoi.
      run(MEHDI, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-12-11', au: '2026-12-11' });
      db.update('employes', 12, { fin: '2026-10-10' });
      assert.equal(db.tx(() => envoyerRecapitulatifs(db)), 0);
      assert.equal(recapitulatifEnAttente(db), 0);
      assert.deepEqual(recaps(), ['k.haddad@entreprise.example', 'k.haddad@entreprise.example']);
      // Boîte du service RH changée entre la notification et le récapitulatif : la nouvelle la reçoit.
      run(RH, 'messagerie.regler', { rhMode: 'quotidien' });
      run(RH, 'equipe.affecter', { empId: 6, equipe: null });
      run({ role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: '' }, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-14', au: '2026-12-14' });
      run(RH, 'messagerie.regler', { rh: 'drh@entreprise.example' });
      assert.equal(run(GEST, 'messagerie.recapituler'), '1 récapitulatif envoyé — notifications en attente transmises');
      assert.equal(recaps().at(-1), 'drh@entreprise.example');
    } finally {
      process.env.CURSUS_TODAY = '2026-10-10';
    }
  } finally {
    db.sql.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('t033 : ni donnée de santé, ni motif d’absence, ni numéro de passeport, ni texte libre dans les e-mails', () => {
  const { db, run, mails, enAttente } = fresh();
  // Absence signalée puis qualifiée en arrêt maladie : aucune notification.
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-12-15', au: '2026-12-16' });
  const signalee = db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-15'`).get() as { id: number };
  run(RH, 'absence.qualifier', { id: signalee.id, nature: 'MALADIE' });
  assert.equal(mails().length + enAttente().length, 0);
  // Arrêt annulé : la feuille soumise sans heure est renvoyée à Marion Petit, sans nommer l'absence.
  db.insert('feuilles', { empId: 13, week: '2026-10-05', statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [] });
  const arret = db.sql.prepare(`SELECT id FROM absences WHERE emp_id = 13 AND type = 'MALADIE'`).get() as { id: number };
  assert.match(String(run(RH, 'absence.annuler', { id: arret.id })), /renvoyée pour saisie/);
  const [renvoi] = mails('temps.renvoyee');
  assert.deepEqual([renvoi.m.a, renvoi.m.objet], [['marion.petit@entreprise.example'], 'Feuille de temps de la semaine 41 à corriger']);
  assert.match(renvoi.m.texte, /l’absence qui couvrait la semaine a été annulée ou raccourcie/);
  // Document de voyage déclaré : la décision ne cite ni le document ni son numéro.
  run(RH, 'demande.accepter', { id: 3 }); // passeport de Nadia Kaci
  const [doc] = mails('demande.reponse');
  assert.equal(doc.m.objet, 'Déclaration de document de voyage validée');
  assert.doesNotMatch(doc.m.texte, /26FD|passeport/i);
  // Feuille renvoyée automatiquement après l'annulation d'un arrêt : motif générique.
  for (const x of mails()) assert.doesNotMatch(`${x.m.objet} ${x.m.texte}`, /maladie|arrêt|médical/i);
});

// — t113 : convocations et désinscription —

test('t113 : envoyer la convocation (unitaire, groupée, datée, avec .ics) et désinscrire (place libérée, annulation)', () => {
  const { db, run, forbidden, mails, domain } = fresh();
  const cert = (empId: number, f: string) => domain().emp(empId)!.certs.filter(c => c.f === f).sort((x, y) => y.obtenue.localeCompare(x.obtenue))[0];
  // « Envoyer plus tard » : rien ne part, la convocation reste à envoyer. Camille Roux quitte la session du 14 octobre,
  // où elle était convoquée : cette convocation-là est annulée.
  assert.match(String(run(RH, 'plan.inscrire', { empId: 1, certId: cert(1, 'sst').id, sessionId: 2, conv: 'later' })),
    /convocation à envoyer · convocation à la session du 14 oct\. 2026 annulée par e-mail$/);
  run(KARIM, 'plan.inscrire', { empId: 2, certId: cert(2, 'sst').id, sessionId: 2, conv: 'later' });
  assert.deepEqual(mails().map(x => x.type), ['convocation.annulee'], 'aucune convocation ne part');
  assert.deepEqual([cert(1, 'sst').convoc, cert(1, 'sst').convocLe], ['later', null]);
  // Envoi unitaire par le manager pour un membre de son équipe ; jamais pour un autre.
  forbidden(KARIM, 'convocation.envoyer', { sessionId: 2, empIds: [1] });
  forbidden(HUGO, 'convocation.envoyer', { sessionId: 2, empIds: [2] });
  forbidden(MEHDI, 'convocation.envoyer', { sessionId: 2, empIds: [2] });
  assert.equal(run(KARIM, 'convocation.envoyer', { sessionId: 2, empIds: [2] }), 'Convocation envoyée par e-mail à Mehdi Benali — session SST du 18 nov. 2026');
  assert.deepEqual([cert(2, 'sst').convoc, cert(2, 'sst').convocLe], ['now', '2026-10-10']);
  const [c] = mails('convocation');
  assert.deepEqual(c.m.a, [MEHDI_MAIL]);
  assert.equal(c.m.objet, 'Convocation : Sauveteur secouriste du travail (SST) — 18 nov. 2026');
  assert.match(c.m.texte, /Votre inscription à la formation « Sauveteur secouriste du travail \(SST\) » \(recyclage\) est confirmée :\n\nDate : mercredi 18 novembre 2026 \(date à confirmer par l’organisme\)\nLieu : Site de Lyon — salle B/);
  assert.equal(c.m.pj![0].nom, 'convocation-2026-11-18.ics');
  const ics = texteDe(c.m.pj![0].base64);
  assert.match(ics, /UID:formation-2-2@cursus\.example\.fr\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261118\r\n/);
  assert.match(ics, /LOCATION:Site de Lyon — salle B\r\n/);
  assert.match(ics, /STATUS:TENTATIVE\r\n/, 'session « à confirmer » : événement provisoire');
  assert.match(ics, /ORGANIZER;CN=Service RH:mailto:rh@entreprise\.example\r\n/, 'simulation : la boîte du service RH organise');
  // Envoi groupé (RH) : les convocations encore à envoyer de la session.
  const s2 = () => domain().session(2)!;
  const aEnvoyer = () => inscritsDe(domain(), s2()).filter(i => i.convoc !== 'now').map(i => i.nom);
  assert.deepEqual(aEnvoyer(), ['Camille Roux']);
  db.update('employes', 1, { email: null });
  assert.equal(run(RH, 'convocation.envoyer', { sessionId: 2 }), 'Convocation enregistrée pour Camille Roux — session SST du 18 nov. 2026 · sans adresse e-mail, à remettre en main propre : Camille Roux');
  assert.deepEqual(aEnvoyer(), []);
  assert.throws(() => run(RH, 'convocation.envoyer', { sessionId: 2 }), /Aucune convocation à envoyer/);
  db.update('employes', 1, { email: 'camille.roux@entreprise.example' });
  // Session redatée : convocations à renvoyer, puis renvoi groupé.
  run(RH, 'session.modifier', { id: 2, date: '2026-11-19' });
  assert.equal(aEnvoyer().length, 3);
  assert.match(String(run(RH, 'convocation.envoyer', { sessionId: 2 })), /^Session SST du 19 nov\. 2026 — 3 convocations envoyées par e-mail$/);
  assert.equal(mails('convocation').length, 4);
  // Session passée, clôturée ou annulée : plus de convocation.
  assert.throws(() => run(RH, 'convocation.envoyer', { sessionId: 6 }), /Session du 9 oct\. 2026 passée : clôturez-la/);

  // Désinscription : la place est libérée, la convocation envoyée est annulée (événement retiré de l'agenda).
  const avant = s2().inscrits;
  forbidden(HUGO, 'plan.desinscrire', { empId: 2, sessionId: 2 });
  forbidden(MEHDI, 'plan.desinscrire', { empId: 2, sessionId: 2 });
  assert.equal(run(KARIM, 'plan.desinscrire', { empId: 2, sessionId: 2 }), 'Mehdi Benali désinscrit de la session SST du 19 nov. 2026 — place libérée · recyclage de nouveau à planifier · annulation envoyée par e-mail');
  assert.equal(s2().inscrits, avant - 1);
  assert.deepEqual([cert(2, 'sst').sessionId, cert(2, 'sst').convoc, cert(2, 'sst').convocLe], [null, null, null]);
  const annul = mails('convocation.annulee').at(-1)!;
  assert.equal(annul.m.objet, 'Annulation : Sauveteur secouriste du travail (SST) — 19 nov. 2026');
  assert.match(texteDe(annul.m.pj![0].base64), /METHOD:CANCEL\r\n[\s\S]*UID:formation-2-2@cursus\.example\.fr\r\n/);
  assert.throws(() => run(RH, 'plan.desinscrire', { empId: 2, sessionId: 2 }), /n’est pas inscrit à cette session/);
  // Formation initiale : l'inscription est retirée (Nadia Kaci, session 2).
  assert.match(String(run(RH, 'plan.desinscrire', { empId: 9, sessionId: 2 })), /inscription en formation initiale retirée · annulation envoyée par e-mail$/);
  assert.ok(!domain().ds.inscriptions.some(i => i.empId === 9 && i.sessionId === 2));
  // Session passée, à clôturer : la clôture d'abord.
  assert.throws(() => run(RH, 'plan.desinscrire', { empId: 14, sessionId: 6 }), /passée : clôturez-la/);

  // Annulation de la session : les convoqués sont prévenus.
  const n = mails('convocation.annulee').length;
  assert.match(String(run(RH, 'session.annuler', { id: 2, motif: 'Formateur indisponible' })), /· 1 annulation envoyée par e-mail$/);
  assert.equal(mails('convocation.annulee').length, n + 1);
  assert.doesNotMatch(mails('convocation.annulee').at(-1)!.m.texte, /Formateur indisponible/);

  // Inscription avec « Envoyer maintenant » : convocation envoyée et datée.
  const r = run(RH, 'plan.inscrire', { empId: 1, certId: cert(1, 'sst').id, sessionId: 1, conv: 'now' });
  assert.match(String(r), /convocation envoyée$/);
  assert.equal(cert(1, 'sst').convocLe, '2026-10-10');
  // Demande de formation acceptée avec une session : la convocation tient lieu de réponse au salarié, le manager est prévenu.
  const m = mails().length;
  run(RH, 'demande.accepter', { id: 1 }); // Marion Petit, CACES session 4, demandée par Sophie Lemaire
  assert.deepEqual(mails().slice(m).map(x => [x.type, x.m.a[0]]), [['convocation', 'marion.petit@entreprise.example'], ['demande.reponse', 'sophie.lemaire@entreprise.example']]);
});

test('t113 : une convocation reçue est annulée dès que la personne quitte la session, même redatée entre-temps', () => {
  const cert = (d: InstanceType<typeof Domain>, empId: number, f: string) => d.emp(empId)!.certs.filter(c => c.f === f).sort((x, y) => y.obtenue.localeCompare(x.obtenue))[0];
  /** UID des événements annulés, dans l'ordre. */
  const annulations = (mails: ReturnType<typeof fresh>['mails']) => mails('convocation.annulee').map(x => /UID:(\S+)\r\n/.exec(texteDe(x.m.pj![0].base64))![1]);

  // Session redatée (convocations « à renvoyer »), puis désinscription et annulation : les convoqués sont prévenus.
  {
    const { run, mails, domain } = fresh();
    run(RH, 'plan.inscrire', { empId: 2, certId: cert(domain(), 2, 'sst').id, sessionId: 2, conv: 'now' });
    assert.match(String(run(RH, 'session.modifier', { id: 2, date: '2026-11-25' })), /· 2 convocations à renvoyer/);
    const nadia = inscritsDe(domain(), domain().session(2)!).find(i => i.empId === 9)!;
    assert.deepEqual([nadia.convoc, nadia.convocLe], ['later', '2026-09-28']);
    assert.match(String(run(RH, 'plan.desinscrire', { empId: 9, sessionId: 2 })), /· annulation envoyée par e-mail$/);
    assert.match(String(run(RH, 'session.annuler', { id: 2 })), /· 1 annulation envoyée par e-mail$/);
    assert.deepEqual(annulations(mails), ['formation-2-9@cursus.example.fr', 'formation-2-2@cursus.example.fr']);
    const ics = texteDe(mails('convocation.annulee')[1].m.pj![0].base64);
    assert.match(ics, /METHOD:CANCEL\r\n[\s\S]*ORGANIZER;CN=Service RH:mailto:rh@entreprise\.example\r\n[\s\S]*STATUS:CANCELLED\r\n/);
    assert.equal(cert(domain(), 2, 'sst').convocLe, null, 'session annulée : plus de date de convocation');
  }
  // Changement de session (plan.inscrire) : l'ancienne convocation est annulée, puis la nouvelle part.
  {
    const { run, mails, domain } = fresh();
    const insc = domain().ds.inscriptions.find(i => i.empId === 9 && i.sessionId === 2)!;
    assert.match(String(run(RH, 'plan.inscrire', { empId: 9, inscriptionId: insc.id, sessionId: 1, conv: 'now' })),
      /convocation envoyée · convocation à la session du 18 nov\. 2026 annulée par e-mail$/);
    assert.deepEqual(mails().map(x => x.type), ['convocation.annulee', 'convocation']);
    assert.deepEqual(annulations(mails), ['formation-2-9@cursus.example.fr']);
    // Inscription remise à replanifier par une session annulée : rien à annuler une seconde fois.
    run(RH, 'session.annuler', { id: 1 });
    const n = mails('convocation.annulee').length;
    run(RH, 'plan.inscrire', { empId: 9, inscriptionId: insc.id, sessionId: 2, conv: 'later' });
    assert.equal(mails('convocation.annulee').length, n);
  }
  // Demande acceptée qui déplace une certification ou une inscription : l'ancienne convocation est annulée.
  {
    const { db, run, mails, domain } = fresh();
    run(RH, 'plan.inscrire', { empId: 2, certId: cert(domain(), 2, 'sst').id, sessionId: 2, conv: 'now' });
    for (const empId of [2, 9]) db.insert('demandesCollab', { empId, type: 'formation', f: 'sst', sessionId: 1, motif: 'Session plus proche', date: '2026-10-08', statut: 'attente', parId: null });
    const ids = domain().ds.demandesCollab.filter(r => r.statut === 'attente' && r.f === 'sst').map(r => r.id);
    const m = mails().length;
    ids.forEach(id => run(RH, 'demande.accepter', { id }));
    assert.deepEqual(mails().slice(m).map(x => [x.type, x.m.a[0]]), [
      ['convocation.annulee', MEHDI_MAIL], ['convocation', MEHDI_MAIL], ['convocation.annulee', 'nadia.kaci@entreprise.example'], ['convocation', 'nadia.kaci@entreprise.example'],
    ]);
    assert.deepEqual(annulations(mails), ['formation-2-2@cursus.example.fr', 'formation-2-9@cursus.example.fr']);
  }
  // Recyclage enregistré avant la session (cert.ajouter), ou session redatée après un recyclage (place libérée).
  {
    const { run, mails, domain } = fresh();
    run(RH, 'plan.inscrire', { empId: 2, certId: cert(domain(), 2, 'sst').id, sessionId: 2, conv: 'now' });
    assert.match(String(run(RH, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-10-05' })), /inscription à la session du 18 nov\. 2026 annulée · annulation envoyée par e-mail$/);
    run(RH, 'plan.inscrire', { empId: 1, certId: cert(domain(), 1, 'sst').id, sessionId: 2, conv: 'now' }); // quitte la session du 14 octobre
    run(RH, 'cert.ajouter', { empId: 1, f: 'sst', date: '2026-11-20' }); // postérieur à la session : l'inscrite reste
    assert.deepEqual(annulations(mails), ['formation-2-2@cursus.example.fr', 'formation-1-1@cursus.example.fr']);
    assert.match(String(run(RH, 'session.modifier', { id: 2, date: '2026-11-25' })), /place libérée : Camille Roux · 1 annulation envoyée par e-mail/);
    assert.deepEqual(annulations(mails).slice(2), ['formation-2-1@cursus.example.fr']);
    assert.equal(mails('convocation.annulee')[2].m.objet, 'Annulation : Sauveteur secouriste du travail (SST) — 18 nov. 2026', 'la date que la personne a dans son agenda');
  }
});

// — t030 : relevé des intérimaires —

test('t030 : relevé hebdomadaire des heures des intérimaires, par agence, automatique, consultable et renvoyable', () => {
  const { db, run, forbidden, mails, domain } = fresh();
  // Léa Girard, intérimaire (Proman Lyon) : semaine 39 validée, semaine 40 soumise, semaine 41 non saisie.
  const r39 = releveAgence(domain(), 'proman LYON', '2026-09-21');
  assert.deepEqual(r39.lignes.map(l => [l.nom, l.total, l.jours.length, l.absences]), [['Léa Girard', r39.heures, 5, 0]]);
  assert.ok(r39.heures > 0);
  assert.deepEqual(releveAgence(domain(), 'Proman Lyon', '2026-09-28').enAttente.map(x => x.nom), ['Léa Girard']);
  const csv = releveCsv(r39);
  assert.equal(csv.fichier, 'releve-heures-proman-lyon-2026-09-21.csv');
  assert.deepEqual(csv.rows[0].slice(0, 6), ['proman LYON', '2026-S39', '2026-09-21', '2026-09-25', 'Léa Girard', 'Opératrice']);
  assert.ok(csvTexte(csv.head, csv.rows).startsWith('﻿Agence;Semaine;Du;Au;Intérimaire;Poste;Lundi'));

  // Aucun envoi automatique tant qu'une feuille de la semaine attend sa validation ; la semaine 39 précède
  // l'enregistrement de l'adresse de l'agence (5 octobre) : ses relevés lui parvenaient autrement.
  assert.deepEqual(db.tx(() => relevesAutomatiques(db)), []);
  // La validation de la dernière feuille fait partir le relevé de l'agence, dans la même transaction.
  const msg = run(SOPHIE, 'temps.validate', { empId: 15, week: '2026-09-28' });
  assert.match(String(msg), /· relevé d’heures envoyé à l’agence Proman Lyon$/);
  const [e] = mails('releve.interim');
  assert.deepEqual(e.m.a, ['releves.lyon@agence-interim.example']);
  assert.equal(e.m.objet, 'Relevé d’heures des intérimaires — Proman Lyon — semaine 40');
  assert.match(e.m.texte, /^Bonjour,\n\nVeuillez trouver ci-joint le relevé des heures validées de vos intérimaires pour la semaine 40 \(du lundi 28 septembre au vendredi 2 octobre 2026\) :\n\n• Léa Girard \(Opératrice\) : \d+(,\d+)? h, dont/);
  assert.equal(e.m.pj![0].nom, 'releve-heures-proman-lyon-2026-09-28.csv');
  assert.match(texteDe(e.m.pj![0].base64), /^﻿Agence;Semaine;.*\r\nProman Lyon;2026-S40;2026-09-28;2026-10-02;Léa Girard;Opératrice;/);
  const transmis = () => loadFull(db, RH).releves;
  assert.deepEqual(transmis().map(x => [x.agence, x.semaine, x.par, x.interimaires, x.envoi]), [['Proman Lyon', '2026-09-28', 'Cursus', 1, 'simule']]);
  assert.deepEqual(db.tx(() => relevesAutomatiques(db)), [], 'déjà transmis : pas de second envoi automatique');

  // Le RH consulte et renvoie ; il peut envoyer un relevé incomplet (feuilles en attente nommées).
  forbidden(KARIM, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-09-28' });
  assert.match(String(run(GEST, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-09-28' })), /^Relevé de la semaine 40 renvoyé à Proman Lyon \(releves\.lyon@agence-interim\.example\) — 1 intérimaire, \d/);
  assert.deepEqual(transmis().map(x => x.par), ['Cursus', 'Antoine Leroy']);
  assert.throws(() => run(RH, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-10-05' }), /Aucune feuille de temps validée la semaine 41/);
  assert.throws(() => run(RH, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-10-19' }), /Semaine à venir/);
  assert.throws(() => run(RH, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-10-07' }), /Semaine invalide/);
  assert.match(String(run(RH, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-09-21' })), /^Relevé de la semaine 39 envoyé/);
  // Agence sans adresse : rien ne part, le RH est invité à la renseigner.
  run(RH, 'messagerie.regler', { agences: [] });
  assert.throws(() => run(RH, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-09-28' }), /Adresse de l’agence Proman Lyon à renseigner \(Paramètres → Messagerie\)/);
  // Intérimaires seulement : les relevés ne citent pas les autres salariés.
  assert.ok(mails('releve.interim').every(x => !x.m.texte.includes('Mehdi')));
});

test('t030 : heures au quart d’heure, validation tardive, relevé incomplet complété automatiquement', () => {
  // Fenêtre de l'envoi automatique : cinq semaines révolues (et la semaine en cours après son vendredi), pas avant
  // la semaine qui précède l'enregistrement de l'adresse de l'agence.
  assert.deepEqual(semainesAutomatiques('2026-10-08'), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  assert.deepEqual(semainesAutomatiques('2026-10-10', '2026-10-05'), ['2026-09-28', '2026-10-05']);
  const aujourdhui = process.env.CURSUS_TODAY;
  const le = (jour: string, f: () => void) => { process.env.CURSUS_TODAY = jour; try { f(); } finally { process.env.CURSUS_TODAY = aujourdhui; } };
  /** Feuille de la semaine 40 de Léa Girard (soumise) : `h` heures chaque jour. */
  const quarts = (db: ReturnType<typeof fresh>['db'], h: number) => {
    const f = db.all<Corps>('feuilles').find(x => x.empId === 15 && x.week === '2026-09-28')!;
    db.update('feuilles', f.id, { lignes: [{ ...f.lignes[0], h: [h, h, h, h, h] }] });
  };

  // Heures saisies au quart d'heure : relevé au centième, total égal à la somme des jours. Validée le 20 octobre,
  // deux semaines après : le relevé part quand même.
  {
    const { db, run, mails } = fresh();
    quarts(db, 7.75);
    le('2026-10-20', () => assert.match(String(run(SOPHIE, 'temps.validate', { empId: 15, week: '2026-09-28' })), /· relevé d’heures envoyé à l’agence Proman Lyon$/));
    const [e] = mails('releve.interim');
    assert.match(e.m.texte, /• Léa Girard \(Opératrice\) : 38,75 h, dont 35 h normales, 3,75 h majorées\n\nTotal : 38,75 h · 1 intérimaire\./);
    const ligne = texteDe(e.m.pj![0].base64).split('\r\n')[1].split(';');
    assert.deepEqual(ligne.slice(6, 12), ['7,75', '7,75', '7,75', '7,75', '7,75', '38,75']);
    assert.equal(ligne[13], '0', 'pas de majoration à 10 % (temps plein)');
    assert.equal(ligne[14], '3,75');
  }
  // Au-delà de cinq semaines, le service RH envoie le relevé lui-même.
  {
    const { run, mails } = fresh();
    le('2026-11-09', () => assert.match(String(run(SOPHIE, 'temps.validate', { empId: 15, week: '2026-09-28' })), /^Semaine 40 validée$/));
    assert.equal(mails('releve.interim').length, 0);
  }
  // Relevé envoyé par le RH avec une feuille en attente : le relevé complet part seul à sa validation, puis plus rien.
  {
    const { db, run, mails, domain } = fresh();
    const lea = db.get<Corps>('employes', 15)!;
    const id = db.insert<Corps>('employes', { ...lea, id: undefined, nom: 'Paul Martel', email: 'paul.martel@entreprise.example' }).id;
    const f39 = db.all<Corps>('feuilles').find(x => x.empId === 15 && x.week === '2026-09-21')!;
    db.insert('feuilles', { ...f39, id: undefined, empId: id, week: '2026-09-28' });
    assert.match(String(run(RH, 'releve.envoyer', { agence: 'Proman Lyon', semaine: '2026-09-28' })), /· feuille non validée : Léa Girard$/);
    assert.match(mails('releve.interim')[0].m.texte, /Feuille pas encore validée : Léa Girard — le relevé complet vous sera envoyé dès sa validation\./);
    assert.deepEqual(loadFull(db, RH).releves.map(x => [x.interimaires, x.enAttente]), [[1, 1]]);
    assert.deepEqual(db.tx(() => relevesAutomatiques(db)), [], 'feuille toujours en attente');
    assert.match(String(run(SOPHIE, 'temps.validate', { empId: 15, week: '2026-09-28' })), /· relevé d’heures envoyé à l’agence Proman Lyon$/);
    const complet = mails('releve.interim')[1];
    assert.match(complet.m.texte, /• Léa Girard[\s\S]*• Paul Martel[\s\S]*Ce relevé complet remplace celui du \d+ \S+ 2026, envoyé avant la validation de toutes les feuilles\./);
    assert.deepEqual(loadFull(db, RH).releves.map(x => [x.par, x.interimaires, x.enAttente]), [['Sandrine Vidal', 1, 1], ['Cursus', 2, 0]]);
    assert.deepEqual(db.tx(() => relevesAutomatiques(db)), [], 'relevé complet transmis : plus d’envoi automatique');
    assert.equal(domain().ds.releves.length, 2);
  }
  // L'adresse d'une agence garde sa date d'enregistrement quand elle change ; une agence ajoutée prend celle du jour.
  {
    const { db, run } = fresh();
    run(RH, 'messagerie.regler', { agences: [{ nom: 'Proman Lyon', adresse: 'paie@proman.example' }, { nom: 'Adecco Vienne', adresse: 'releves@adecco.example' }] });
    assert.deepEqual(loadFull(db, RH).messagerie!.agences.map(a => [a.nom, a.depuis]), [['Proman Lyon', '2026-10-05'], ['Adecco Vienne', '2026-10-10']]);
  }
});

// — Messagerie : réglages, essai, récapitulatif —

test('messagerie : adresses réglées par l’administrateur RH, e-mail d’essai, récapitulatif sans attendre, réglage des notifications', () => {
  const { db, run, forbidden, mails, enAttente } = fresh();
  forbidden(GEST, 'messagerie.regler', { rh: 'drh@entreprise.example' });
  forbidden(KARIM, 'messagerie.regler', { rh: 'drh@entreprise.example' });
  assert.throws(() => run(RH, 'messagerie.regler', { santeTravail: 'sante' }), /Adresse du service de santé au travail invalide/);
  assert.throws(() => run(RH, 'messagerie.regler', { agences: [{ nom: 'A', adresse: 'a@x.example' }, { nom: 'a', adresse: 'b@x.example' }] }), /Agence en double : a/);
  assert.throws(() => run(RH, 'messagerie.regler', { rhMode: 'hebdo' }), /Réglage inconnu/);
  run(RH, 'messagerie.regler', { rh: ' DRH@Entreprise.example ', rhMode: 'quotidien', santeTravail: '', agences: [{ nom: 'Proman Lyon', adresse: 'releves@proman.example' }, { nom: 'Vide', adresse: '' }] });
  assert.deepEqual(loadFull(db, RH).messagerie, {
    rh: 'drh@entreprise.example', rhMode: 'quotidien', santeTravail: null, agences: [{ nom: 'Proman Lyon', adresse: 'releves@proman.example', depuis: '2026-10-05' }],
  });

  // E-mail d'essai (administrateur RH) : simulé faute de configuration.
  forbidden(GEST, 'messagerie.essai', { adresse: 'it@entreprise.example' });
  assert.throws(() => run(RH, 'messagerie.essai', { adresse: '' }), /Adresse du destinataire requise/);
  assert.match(String(run(RH, 'messagerie.essai', { adresse: 'IT@entreprise.example' })), /^E-mail d’essai simulé pour it@entreprise\.example \(envoi non configuré : CURSUS_MAIL_FROM\)/);
  const [essai] = mails('essai');
  assert.equal(essai.m.objet, 'Cursus — e-mail d’essai');
  assert.match(essai.m.texte, /demandé par Sandrine Vidal/);

  // Service RH en récapitulatif : la demande d'un salarié sans manager attend ; le RH envoie sans attendre.
  run(RH, 'equipe.affecter', { empId: 6, equipe: null });
  run({ role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: '' }, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-14', au: '2026-12-14' });
  assert.deepEqual(enAttente().map(n => [n.empId, n.adresse]), [[null, 'drh@entreprise.example']]);
  forbidden(KARIM, 'messagerie.recapituler', {});
  assert.equal(run(GEST, 'messagerie.recapituler'), '1 récapitulatif envoyé — notifications en attente transmises');
  assert.match(mails('recapitulatif')[0].m.texte, /^Bonjour,\n\nVoici/);
  assert.throws(() => run(GEST, 'messagerie.recapituler'), /Aucune notification en attente/);

  // Réglage des notifications : la personne elle-même, ou le service RH ; jamais un autre.
  assert.match(String(run(MEHDI, 'notification.regler', { mode: 'quotidien' })), /^Vos notifications par e-mail : récapitulatif quotidien$/);
  assert.equal(loadFull(db, RH).employes.find(e => e.id === 2)!.notifications, 'quotidien');
  forbidden(KARIM, 'notification.regler', { empId: 2, mode: 'immediat' });
  forbidden({ role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: '' }, 'notification.regler', { empId: 2, mode: 'immediat' });
  assert.match(String(run(RH, 'notification.regler', { empId: 2, mode: 'immediat' })), /^Notifications par e-mail de Mehdi Benali : aussitôt$/);
  assert.throws(() => run(MEHDI, 'notification.regler', { mode: 'jamais' }), /Réglage inconnu/);
});

test('instantané : adresses de la messagerie et relevés réservés au service RH ; l’adresse d’un membre visible de son manager', () => {
  const { db } = fresh();
  const rh = buildSnapshot(db, RH), mgr = buildSnapshot(db, KARIM), collab = buildSnapshot(db, MEHDI);
  assert.equal(rh.messagerie?.rh, 'rh@entreprise.example');
  assert.deepEqual([mgr.messagerie, collab.messagerie, mgr.releves, collab.releves], [null, null, [], []]);
  assert.equal(mgr.employes.find(e => e.id === 2)!.email, MEHDI_MAIL);
  assert.deepEqual(collab.employes.map(e => [e.id, e.email, e.notifications]), [[2, MEHDI_MAIL, 'immediat']]);
});

// — Serveur réel : vue Envois des e-mails —

test('serveur : l’action met l’e-mail en file, la vue Envois le montre (cible e-mail), l’état de la messagerie est donné', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-emails-'));
  const port = await new Promise<number>(res => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => res(p)); }); });
  const p: ChildProcess = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', CURSUS_API_PORT: String(port), CURSUS_DB: join(dir, 'cursus.db') },
  });
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  fermer.push(() => { p.kill(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise<void>((res, rej) => {
    const t = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(t); res(); } }, 20);
    p.on('exit', code => { clearInterval(t); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const s = await fetch(`${base}/api/session`);
  const cookie = s.headers.get('set-cookie')!.match(/cursus_session=[^;]*/)![0];
  assert.equal((await s.json()).integrations.email, 'simulation');
  const ok = async (r: Response) => { assert.equal(r.status, 200, await r.clone().text()); return r.json() as Promise<Corps>; };
  const r = await ok(await fetch(`${base}/api/actions/messagerie.essai`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ adresse: 'it@entreprise.example' }) }));
  assert.match(r.message, /E-mail d’essai simulé/);
  assert.equal(r.data.messagerie.rh, 'rh@entreprise.example');
  const v = await ok(await fetch(`${base}/api/envois?cible=email`, { headers: { cookie } }));
  assert.deepEqual([v.email.mode, v.email.expediteur, v.email.nombres.simule, v.email.recapitulatif], ['simulation', null, 1, 0]);
  assert.deepEqual(v.envois.map((x: Corps) => [x.cible, x.type, x.contenu.a]), [['email', 'essai', ['it@entreprise.example']]]);
  assert.deepEqual((await ok(await fetch(`${base}/api/envois?cible=keystone`, { headers: { cookie } }))).envois.filter((x: Corps) => x.cible !== 'keystone'), []);
  // Réponse paginée du journal (server/src/journal.ts) : { lignes, total, page, taille }.
  const journal = (await ok(await fetch(`${base}/api/journal`, { headers: { cookie } })) as unknown as { lignes: Corps[] }).lignes;
  assert.ok(journal.some(x => x.action === 'email.essai' && /simulation/.test(x.message)));
});
