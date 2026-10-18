// Échéance du secret client Entra (t184) : CURSUS_OIDC_SECRET_EXPIRE facultative et contrôlée au démarrage ; 30 jours
// avant l'expiration, point de santé « degrade » (échéance dans le détail réservé à la supervision) et ligne
// « Exploitation » du récapitulatif des échéances, pour la seule boîte du service RH, une fois par palier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET', 'CURSUS_OIDC_SECRET_EXPIRE']) delete process.env[k];

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { expirationSecretOidc, problemesConfig } = await import('../server/src/config.ts');
const { ALERTE_SECRET_JOURS, echeanceSecret, envoiParSecretOidc, relanceSecret } = await import('../server/src/secret-microsoft.ts');
const { etatSante } = await import('../server/src/supervision.ts');
const { recapitulatifEcheances } = await import('../server/src/relances.ts');
type Ligne = Record<string, any>;

const RH_MAIL = 'rh@entreprise.example';
const OIDC = { CURSUS_OIDC_TENANT: '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', CURSUS_OIDC_CLIENT_ID: 'app', CURSUS_OIDC_CLIENT_SECRET: 'secret', CURSUS_PUBLIC_URL: 'https://cursus.example.fr' };

/** Exécute `f` avec la date d'expiration `date` posée (ou retirée). */
function avecExpiration<T>(date: string | null, f: () => T): T {
  const avant = process.env.CURSUS_OIDC_SECRET_EXPIRE;
  if (date) process.env.CURSUS_OIDC_SECRET_EXPIRE = date; else delete process.env.CURSUS_OIDC_SECRET_EXPIRE;
  try { return f(); } finally { if (avant === undefined) delete process.env.CURSUS_OIDC_SECRET_EXPIRE; else process.env.CURSUS_OIDC_SECRET_EXPIRE = avant; }
}
/** Exécute `f` à une autre date du jour. */
function le<T>(jour: string, f: () => T): T {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = jour;
  try { return f(); } finally { process.env.CURSUS_TODAY = avant; }
}

test('CURSUS_OIDC_SECRET_EXPIRE : facultative, date AAAA-MM-JJ réelle, refusée sans secret client', () => {
  assert.equal(expirationSecretOidc({}), null);
  assert.equal(expirationSecretOidc({ CURSUS_OIDC_SECRET_EXPIRE: ' 2027-03-31 ' }), '2027-03-31');
  for (const v of ['31/03/2027', '2027-02-30', '2027-3-31', 'demain']) assert.equal(expirationSecretOidc({ CURSUS_OIDC_SECRET_EXPIRE: v }), null, v);
  const pbs = (env: Record<string, string>) => problemesConfig(env).filter(p => /SECRET_EXPIRE/.test(p));
  assert.deepEqual(pbs(OIDC), [], 'absente : rien à dire');
  assert.deepEqual(pbs({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '2027-03-31' }), []);
  assert.match(pbs({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '31/03/2027' })[0], /format AAAA-MM-JJ \(« 31\/03\/2027 » reçu\)/);
  assert.match(pbs({ CURSUS_OIDC_SECRET_EXPIRE: '2027-03-31' })[0], /sans CURSUS_OIDC_CLIENT_SECRET/);
});

test('échéance : alerte à 30 jours, paliers 30, 7 et expiré, une clé par date d’expiration', () => {
  const env = (d: string) => ({ CURSUS_OIDC_SECRET_EXPIRE: d });
  assert.equal(ALERTE_SECRET_JOURS, 30);
  assert.equal(echeanceSecret('2026-10-10', {}), null);
  assert.deepEqual(echeanceSecret('2026-10-10', env('2026-11-10')), { expireLe: '2026-11-10', jours: 31, alerte: false });
  assert.deepEqual(echeanceSecret('2026-10-10', env('2026-11-09')), { expireLe: '2026-11-09', jours: 30, alerte: true });
  assert.equal(relanceSecret('2026-10-10', env('2026-11-10')), null, 'au-delà de 30 jours : rien');
  const r30 = relanceSecret('2026-10-10', env('2026-11-09'))!;
  assert.deepEqual([r30.cle, r30.palier], ['exploitation:secret-oidc:2026-11-09', '30']);
  assert.match(r30.texte, /expire le 9 nov\. 2026/);
  assert.match(r30.texte, /Coolify .*CURSUS_OIDC_SECRET_EXPIRE/);
  assert.equal(relanceSecret('2026-10-10', env('2026-10-17'))!.palier, '7');
  assert.equal(relanceSecret('2026-10-10', env('2026-10-10'))!.palier, '7', 'le jour même : pas encore expiré');
  const echu = relanceSecret('2026-10-10', env('2026-10-09'))!;
  assert.equal(echu.palier, 'echu');
  assert.match(echu.texte, /a expiré le 9 oct\. 2026/);
});

test('/api/health : « degrade » 30 jours avant l’expiration, échéance dans le détail seulement', () => {
  const db = new Db(':memory:');
  const sante = (env: Record<string, string>, detail = false) => etatSante(db, detail, '2026-10-10T06:00:00.000Z', env);
  assert.equal(sante(OIDC).statut, 'ok');
  assert.equal(sante({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '2026-11-10' }).statut, 'ok', '31 jours : rien');
  assert.deepEqual(sante({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '2026-11-09' }), { statut: 'degrade', base: 'ok' }, 'public : état seul');
  const d = sante({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '2026-11-09' }, true);
  assert.equal(d.statut, 'degrade');
  assert.deepEqual(d.secretMicrosoft, { expireLe: '2026-11-09', jours: 30 });
  assert.deepEqual(sante({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '2027-03-31' }, true).secretMicrosoft, { expireLe: '2027-03-31', jours: 172 }, 'détail même hors alerte');
  assert.equal(sante(OIDC, true).secretMicrosoft, undefined, 'sans date : rien à suivre');
  assert.equal(sante({ ...OIDC, CURSUS_OIDC_SECRET_EXPIRE: '2026-10-01' }).statut, 'degrade', 'expiré : toujours dégradé');
});

test('récapitulatif : ligne « Exploitation » à la seule boîte du service RH, une fois par palier, seule s’il n’y a rien d’autre', () => {
  const db = new Db(':memory:');
  seedDemo(db);
  const compte = (db.sql.prepare('SELECT id FROM comptes WHERE emp_id IS NULL').get() as { id: number }).id;
  const RH = currentUser(db, { compteId: compte, role: 'rh', methode: 'demo' })!;
  db.tx(() => ACTIONS['messagerie.regler'](makeCtx(db, RH, loadFull(db, RH)), { rh: RH_MAIL }));
  const recaps = () => db.all<Ligne>('envois').filter(x => x.type === 'echeances.recapitulatif').map(e => ({ a: e.contenu.a[0] as string, objet: e.contenu.objet as string, texte: e.contenu.texte as string }));
  const passer = () => db.tx(() => recapitulatifEcheances(db));

  // Premier passage : échéances des salariés et ligne du secret, dans l'e-mail du service RH seulement.
  const p1 = avecExpiration('2026-11-01', passer);
  const r1 = recaps();
  const rh1 = r1.filter(e => e.a === RH_MAIL);
  assert.equal(rh1.length, 1);
  assert.match(rh1[0].texte, /\n\nExploitation :\n• Secret client de l’application Cursus dans Entra ID .*expire le 1 nov\. 2026/);
  assert.ok(r1.filter(e => e.a !== RH_MAIL).length > 0, 'managers et référent HSE servis');
  assert.ok(r1.filter(e => e.a !== RH_MAIL).every(e => !/Exploitation|Entra/.test(e.texte)), 'ni manager ni référent HSE');
  assert.equal(p1.relances, (db.sql.prepare('SELECT COUNT(*) AS n FROM relances').get() as { n: number }).n);

  // Même palier : rien ne repart. Les échéances des salariés du 26 octobre parties, le palier de 7 jours du secret part
  // seul, dans un e-mail au seul service RH.
  assert.deepEqual(avecExpiration('2026-11-01', passer), { emails: 0, relances: 0 });
  le('2026-10-26', () => avecExpiration(null, passer));
  const avant = recaps().length;
  assert.deepEqual(le('2026-10-26', () => avecExpiration('2026-11-01', passer)), { emails: 1, relances: 1 });
  const [seul] = recaps().slice(avant);
  assert.equal(seul.a, RH_MAIL);
  assert.equal(seul.objet, 'Cursus — échéances à traiter : 1 nouvelle relance');
  assert.deepEqual(seul.texte.split('\n').filter(l => l.startsWith('•')).length, 1, 'la ligne du secret seule');
  assert.match(seul.texte, /Exploitation :\n• Secret client/);
  assert.match(seul.texte, /La marche à suivre est dans le guide docs\/CONNEXION-MICROSOFT\.md, section 3\.\n/, 'seule : renvoi au guide');
  assert.doesNotMatch(seul.texte, /Échéances, Entretiens, Voyages/);
  assert.match(rh1[0].texte, /dans Cursus \(Échéances, Entretiens, Voyages\)\.\n/, 'avec les échéances : écrans de Cursus');

  // Nouveau secret posé (autre date) : rien tant qu'il est loin ; sans la variable, plus aucune ligne.
  const n = recaps().length;
  le('2026-10-26', () => avecExpiration('2027-10-26', passer));
  le('2026-10-26', () => avecExpiration(null, passer));
  assert.ok(recaps().slice(n).every(e => !/Exploitation/.test(e.texte)));
});

test('ligne du secret : l’envoi des e-mails n’est cité que s’il passe par ce secret ; expiré, elle le dit', () => {
  const date = { CURSUS_OIDC_SECRET_EXPIRE: '2026-11-01' };
  const MAIL = { CURSUS_MAIL_FROM: 'cursus@entreprise.example' };
  const DISTINCTE = { CURSUS_MAIL_TENANT: OIDC.CURSUS_OIDC_TENANT, CURSUS_MAIL_CLIENT_ID: 'envoi', CURSUS_MAIL_CLIENT_SECRET: 'autre' };
  assert.equal(envoiParSecretOidc(OIDC), false, 'e-mails simulés');
  assert.equal(envoiParSecretOidc({ ...OIDC, ...MAIL }), true, 'variables CURSUS_OIDC_* reprises');
  assert.equal(envoiParSecretOidc({ ...OIDC, ...MAIL, CURSUS_MAIL_CLIENT_SECRET: 'secret' }), true, 'même secret');
  assert.equal(envoiParSecretOidc({ ...OIDC, ...MAIL, ...DISTINCTE }), false, 'application d’envoi distincte');
  const texte = (env: Record<string, string>, jour = '2026-10-10') => relanceSecret(jour, { ...env, ...date })!.texte;
  assert.match(texte({ ...OIDC, ...MAIL }), /\(connexion Microsoft 365, envoi des e-mails\) : il expire/);
  for (const env of [OIDC, { ...OIDC, ...MAIL, ...DISTINCTE }]) {
    assert.match(texte(env), /\(connexion Microsoft 365\) : il expire/);
    assert.doesNotMatch(texte(env), /envoi des e-mails/);
  }
  // Expiré et servant à l'envoi : l'e-mail ne parvient que si un nouveau secret est en place sans sa date.
  assert.match(texte({ ...OIDC, ...MAIL }, '2026-11-02'), /a expiré le 1 nov\. 2026\. Si ce message vous parvient, un nouveau secret est en place/);
  assert.match(texte(OIDC, '2026-11-02'), /a expiré le 1 nov\. 2026\. Le service informatique en crée un nouveau/);
});
