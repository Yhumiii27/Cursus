// Notifications sur le téléphone (lot 11, chantier C2, étape 1) :
// - chiffrement maison : vecteurs de l'annexe A de la RFC 8291 (aes128gcm, RFC 8188), message relu avec la clé privée du
//   navigateur ; jeton VAPID (RFC 8292) vérifié par crypto.verify ; services de push admis ;
// - clés VAPID : variables de production, clé en mémoire en démonstration, push coupé sinon ;
// - plage de silence (20 h – 7 h, week-end, heure de Paris), libellé d'appareil, préférences ;
// - actions push.* (abonnement chiffré au repos, préférences par compte, appareil d'un autre compte introuvable, essai),
//   journal sans adresse ni clé ; notifier() met en file pour les seuls appareils qui ont choisi le type ;
// - file d'envoi à part : pas de blocage en tête, 404/410 → abonnement supprimé, 429/5xx → nouvelle tentative, 4xx →
//   échec, validité de 24 h ; purge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, verify } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
delete process.env.CURSUS_PIECES_KEY;
delete process.env.CURSUS_VAPID_PUBLIC;

const { json, nouvelleBase } = await import('./base.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const wp = await import('../server/src/integrations/push.ts');
const push = await import('../server/src/push.ts');
const file = await import('../server/src/envois-push.ts');
const { configVapid, problemesConfig } = await import('../server/src/config.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const np = await import('../shared/notifications-push.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type TransportPush = import('../server/src/envois-push.ts').TransportPush;
const d = (s: string) => Buffer.from(s, 'base64url');

// — RFC 8291, annexe A —
const RFC = {
  clair: 'When I grow up, I want to be a watermelon',
  asPrivee: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublique: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivee: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublique: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  sel: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  entete: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  chiffre: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

/** Déchiffrement côté navigateur (RFC 8291 et 8188), pour relire un message chiffré par Cursus. */
function dechiffrer(corps: Buffer, uaPrivee: Buffer, auth: Buffer): string {
  const sel = corps.subarray(0, 16), idlen = corps[20], serveur = corps.subarray(21, 21 + idlen), contenu = corps.subarray(21 + idlen);
  assert.equal(corps.readUInt32BE(16), 4096);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivee);
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(serveur), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), serveur]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dc = createDecipheriv('aes-128-gcm', cek, nonce);
  dc.setAuthTag(contenu.subarray(contenu.length - 16));
  const clair = Buffer.concat([dc.update(contenu.subarray(0, contenu.length - 16)), dc.final()]);
  assert.equal(clair[clair.length - 1], 2, 'délimiteur du dernier enregistrement');
  return clair.subarray(0, clair.length - 1).toString('utf8');
}

test('RFC 8291 annexe A : clés dérivées, en-tête et message chiffré identiques aux vecteurs', () => {
  const as = createECDH('prime256v1');
  as.setPrivateKey(d(RFC.asPrivee));
  assert.equal(as.getPublicKey().toString('base64url'), RFC.asPublique);
  const secret = as.computeSecret(d(RFC.uaPublique));
  assert.equal(secret.toString('base64url'), RFC.ecdh);
  const k = wp.derivations({ secretEcdh: secret, auth: d(RFC.auth), clientPublique: d(RFC.uaPublique), serveurPublique: as.getPublicKey(), sel: d(RFC.sel) });
  assert.equal(k.ikm.toString('base64url'), RFC.ikm);
  assert.equal(k.cek.toString('base64url'), RFC.cek);
  assert.equal(k.nonce.toString('base64url'), RFC.nonce);
  const corps = wp.chiffrerMessage(Buffer.from(RFC.clair), { p256dh: RFC.uaPublique, auth: RFC.auth }, { serveur: d(RFC.asPrivee), sel: d(RFC.sel) });
  assert.equal(corps.subarray(0, 86).toString('base64url'), RFC.entete);
  assert.equal(corps.subarray(86).toString('base64url'), RFC.chiffre);
  assert.equal(dechiffrer(corps, d(RFC.uaPrivee), d(RFC.auth)), RFC.clair);
});

test('chiffrement : clé éphémère et sel tirés à chaque message, relu par le navigateur ; clés invalides refusées', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const abo = { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') };
  const a = wp.chiffrerMessage(Buffer.from('{"type":"essai"}'), abo), b = wp.chiffrerMessage(Buffer.from('{"type":"essai"}'), abo);
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16), 'sel différent');
  assert.notDeepEqual(a.subarray(21, 86), b.subarray(21, 86), 'clé éphémère différente');
  assert.equal(dechiffrer(a, ua.getPrivateKey(), Buffer.alloc(16, 9)), '{"type":"essai"}');
  assert.throws(() => wp.chiffrerMessage(Buffer.from('x'), { ...abo, p256dh: 'AAAA' }), /p256dh invalide/);
  assert.throws(() => wp.chiffrerMessage(Buffer.from('x'), { ...abo, auth: 'AAAA' }), /auth invalide/);
  assert.throws(() => wp.chiffrerMessage(Buffer.alloc(wp.CHARGE_MAX + 1), abo), /trop long/);
});

test('VAPID (RFC 8292) : jeton ES256 vérifié par la clé publique, audience, expiration à 12 h, sujet ; en-têtes de la requête', () => {
  const c = wp.nouvellesClesVapid('mailto:rh@exemple.fr');
  assert.ok(wp.clesVapidValides(c));
  const maintenant = new Date('2026-10-12T08:00:00Z');
  const jwt = wp.jetonVapid('https://fcm.googleapis.com/fcm/send/abc', c, maintenant);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(d(h).toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(d(p).toString()), { aud: 'https://fcm.googleapis.com', exp: maintenant.getTime() / 1000 + 12 * 3600, sub: 'mailto:rh@exemple.fr' });
  assert.equal(d(s).length, 64, 'signature JOSE r ‖ s');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: wp.clePubliqueVapid(c.publique), dsaEncoding: 'ieee-p1363' }, d(s)));
  assert.ok(!verify('sha256', Buffer.from(`${h}.${p}x`), { key: wp.clePubliqueVapid(c.publique), dsaEncoding: 'ieee-p1363' }, d(s)));
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const r = wp.requetePush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: 'AAAAAAAAAAAAAAAAAAAAAA' }, { type: 'x' }, c, { ttl: np.TTL_PUSH_S, maintenant });
  assert.match(r.entetes.authorization, new RegExp(`^vapid t=[^,]+, k=${c.publique}$`));
  assert.equal(r.entetes['content-encoding'], 'aes128gcm');
  assert.equal(r.entetes.ttl, '86400');
  assert.equal(r.entetes.urgency, 'normal');
  // Clés incohérentes : publique d'une autre paire, longueurs fausses.
  assert.ok(!wp.clesVapidValides({ publique: wp.nouvellesClesVapid('x').publique, privee: c.privee }));
  assert.ok(!wp.clesVapidValides({ publique: 'AAAA', privee: c.privee }));
});

test('services de push admis : https, hôtes connus seulement (jamais une adresse interne)', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(wp.endpointAdmis(ok), ok);
  for (const ko of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.fr/x', 'https://127.0.0.1/x', 'https://intranet.local/x', 'https://u:p@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', `https://fcm.googleapis.com/${'x'.repeat(1000)}`, 42, null]) assert.ok(!wp.endpointAdmis(ko), String(ko));
});

test('clés VAPID : variables de production, clé en mémoire en démonstration, push coupé sinon ; configuration incomplète signalée', () => {
  const c = wp.nouvellesClesVapid('mailto:rh@exemple.fr');
  const env = { CURSUS_VAPID_PUBLIC: c.publique, CURSUS_VAPID_PRIVATE: c.privee, CURSUS_VAPID_SUJET: 'mailto:rh@exemple.fr' };
  assert.deepEqual(configVapid(env), { publique: c.publique, privee: c.privee, sujet: 'mailto:rh@exemple.fr' });
  assert.deepEqual(push.clesPush({ ...env, NODE_ENV: 'production' }), configVapid(env));
  assert.equal(push.clesPush({ NODE_ENV: 'production' }), null, 'production sans clés : push désactivé');
  const demo = push.clesPush({ CURSUS_DEMO: '1' });
  assert.ok(demo && wp.clesVapidValides(demo));
  assert.equal(push.clesPush({ CURSUS_DEMO: '1' }), demo, 'une seule paire par processus');
  assert.equal(configVapid({ ...env, CURSUS_VAPID_SUJET: 'rh@exemple.fr' }), null);
  assert.equal(configVapid({ ...env, CURSUS_VAPID_PRIVATE: wp.nouvellesClesVapid('x').privee }), null);
  const pb = (e: Record<string, string>) => problemesConfig({ CURSUS_SECRET: 'x'.repeat(40), KEYSTONE_API_KEY: 'k'.repeat(40), ...e }).filter(p => p.includes('VAPID'));
  assert.deepEqual(pb(env), []);
  assert.deepEqual(pb({}), []);
  assert.equal(pb({ CURSUS_VAPID_PUBLIC: c.publique }).length, 1);
});

test('plage de silence : du lundi au vendredi de 7 h à 20 h (Paris), sinon le jour ouvré suivant à 7 h ; changement d’heure', () => {
  const p = (s: string) => np.prochainEnvoiAdmis(new Date(s)).toISOString();
  assert.equal(p('2026-10-09T17:59:00Z'), '2026-10-09T17:59:00.000Z', 'vendredi 19 h 59');
  assert.equal(p('2026-10-09T18:00:00Z'), '2026-10-12T05:00:00.000Z', 'vendredi 20 h → lundi 7 h');
  assert.equal(p('2026-10-10T10:00:00Z'), '2026-10-12T05:00:00.000Z', 'samedi');
  assert.equal(p('2026-10-12T04:59:00Z'), '2026-10-12T05:00:00.000Z', 'lundi 6 h 59 → 7 h');
  assert.equal(p('2026-10-13T19:30:00Z'), '2026-10-14T05:00:00.000Z', 'mardi 21 h 30 → mercredi 7 h');
  assert.equal(p('2026-10-23T19:00:00Z'), '2026-10-26T06:00:00.000Z', 'passage à l’heure d’hiver le dimanche');
  assert.equal(p('2026-12-14T05:30:00Z'), '2026-12-14T06:00:00.000Z', 'hiver : 6 h 30 → 7 h');
  assert.equal(p('2026-12-14T06:00:00Z'), '2026-12-14T06:00:00.000Z');
});

test('appareil, préférences, registre : libellé fixe, types connus, essai hors des préférences', () => {
  assert.deepEqual(np.codesAppareil('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'), { systeme: 'ios', navigateur: 'safari' });
  assert.deepEqual(np.codesAppareil('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), { systeme: 'android', navigateur: 'chrome' });
  assert.deepEqual(np.codesAppareil('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36 Edg/126.0'), { systeme: 'windows', navigateur: 'edge' });
  assert.deepEqual(np.codesAppareil('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0'), { systeme: 'macos', navigateur: 'firefox' });
  assert.deepEqual(np.codesAppareil('Mozilla/5.0 (Linux; Android 14; SM-S918B) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36'), { systeme: 'android', navigateur: 'samsung' });
  assert.deepEqual(np.codesAppareil('curl/8'), { systeme: 'autre', navigateur: 'autre' });
  assert.equal(np.libelleAppareil('android', 'chrome'), 'Android, Chrome');
  assert.equal(np.libelleAppareil('<script>', 'toString'), 'Appareil, navigateur');
  assert.deepEqual(np.typesValides(['temps.soumise', 'inconnu', 'absence.demande', 'push.essai', 'temps.soumise']), ['absence.demande', 'temps.soumise']);
  assert.deepEqual(np.typesValides('absence.demande'), []);
  assert.ok(!np.TYPES_PUSH.includes('push.essai'));
  assert.ok(!('conges.information' in np.NOTIFICATIONS_PUSH), 'information au retour d’un arrêt (santé) : pas de push');
  for (const a of ['push.abonner', 'push.desabonner', 'push.preferences', 'push.desabonnerAppareil', 'push.tester']) {
    assert.ok(JOURNAL_LABEL[a], a);
    assert.equal(familleAction(a)?.id, 'mobile');
  }
  assert.deepEqual(file.chargePush('temps.soumise'), { type: 'temps.soumise', titre: 'Feuille de temps à valider', corps: 'Une feuille de temps attend votre validation.', url: '/temps' });
  assert.equal(file.chargePush('demande.reponse')!.url, '/');
  assert.equal(file.chargePush('inconnu'), null);
});

test('champs sensibles d’un abonnement : chiffrés avec la clé des pièces, authentifiés par colonne ; en clair sans clé', () => {
  const cle = Buffer.alloc(32, 5);
  const c = push.chiffrerChamp('https://fcm.googleapis.com/fcm/send/abc', 'endpoint', cle);
  assert.match(c, /^pc1:/);
  assert.doesNotMatch(c, /fcm/);
  assert.equal(push.dechiffrerChamp(c, 'endpoint', cle), 'https://fcm.googleapis.com/fcm/send/abc');
  assert.equal(push.dechiffrerChamp(c, 'auth', cle), null, 'autre colonne');
  assert.equal(push.dechiffrerChamp(c, 'endpoint', Buffer.alloc(32, 6)), null, 'autre clé');
  assert.equal(push.dechiffrerChamp(c, 'endpoint', null), null, 'clé absente');
  assert.equal(push.chiffrerChamp('clair', 'auth', null), 'clair');
  assert.equal(push.dechiffrerChamp('clair', 'auth', cle), 'clair');
});

// — Actions, notifier, file d'envoi : base de démonstration —

const db = await nouvelleBase();
await mettreAJourBase(db);
await seedDemo(db);
const compteDe = async (empId: number) => (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = ?', [empId]))!.id;
const personne = async (empId: number, role: 'rh' | 'manager' | 'collaborateur') => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
async function agir(u: User, nom: string, p: Record<string, unknown>) {
  return await db.tx(async () => {
    const trace = await preparerTrace(db, nom, p);
    const r = await ACTIONS[nom](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, trace, { user: u, compte: { id: u.compteId!, identifiant: 'essai' } as never, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
}
const refus = async (u: User, nom: string, p: Record<string, unknown>) => {
  try { await agir(u, nom, p); } catch (e) { if (e instanceof ActionError) return e; throw e; }
  assert.fail(`${nom} aurait dû être refusée`);
};
const navigateur = () => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { e, p256dh: e.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') };
};
const essai = (n: string, nav = navigateur()) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, p256dh: nav.p256dh, auth: nav.auth, systeme: 'android', navigateur: 'chrome' });

test('push.abonner : adresse et clés contrôlées, chiffrées au repos, libellé d’appareil ; journal sans adresse ni clé', async () => {
  process.env.CURSUS_PIECES_KEY = 'ab'.repeat(32);
  try {
    const karim = await personne(12, 'manager');
    assert.match((await refus(karim, 'push.abonner', { ...essai('a'), endpoint: 'https://intranet.local/x' })).message, /service de push inconnu/);
    assert.match((await refus(karim, 'push.abonner', { ...essai('a'), p256dh: 'AAAA' })).message, /Clé de chiffrement invalide/);
    assert.match((await refus(karim, 'push.abonner', { ...essai('a'), auth: 'A'.repeat(30) })).message, /Secret d’authentification invalide/);
    const r = await agir(karim, 'push.abonner', essai('karim-1'));
    assert.match(r.message, /Notifications activées sur cet appareil \(Android, Chrome\)/);
    const l = (await db.get<Record<string, any>>('abonnementsPush', r.result.id))!;
    assert.match(l.endpoint, /^pc1:/);
    assert.match(l.p256dh, /^pc1:/);
    assert.match(l.auth, /^pc1:/);
    assert.equal(l.cleEndpoint, push.cleEndpoint('https://fcm.googleapis.com/fcm/send/karim-1'));
    assert.deepEqual(l.types, []);
    assert.equal(push.navigateurDe(l as never)!.endpoint, 'https://fcm.googleapis.com/fcm/send/karim-1');
    // Même appareil : déjà abonné, une seule ligne.
    assert.match((await agir(karim, 'push.abonner', essai('karim-1'))).message, /déjà activées/);
    assert.equal((await db.where('abonnementsPush', 'compteId', karim.compteId)).length, 1);
    const j = await db.one<{ payload: unknown; message: string }>(`SELECT payload, message FROM journal WHERE action = 'push.abonner' ORDER BY id DESC LIMIT 1`);
    assert.deepEqual(json(j!.payload), { appareil: 'Android, Chrome' });
    assert.doesNotMatch(JSON.stringify(j) + j!.message, /fcm|karim-1|pc1/);
  } finally {
    delete process.env.CURSUS_PIECES_KEY;
  }
});

test('préférences par compte (coupées par défaut), appareils d’un autre compte introuvables, essai, révocation par l’administrateur RH', async () => {
  const karim = await personne(12, 'manager'), mehdi = await personne(2, 'collaborateur');
  const admin = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL'))!.id, role: 'rh', methode: 'demo' }))!;
  assert.match((await refus(mehdi, 'push.preferences', { types: ['absence.decision'] })).message, /Aucun appareil abonné/);
  assert.match((await refus(mehdi, 'push.tester', {})).message, /Aucun appareil abonné/);
  await agir(karim, 'push.abonner', essai('karim-2'));
  const r = await agir(karim, 'push.preferences', { types: ['absence.demande', 'inconnu', 'temps.soumise'] });
  assert.deepEqual(r.result.types, ['absence.demande', 'temps.soumise']);
  for (const a of await db.where<{ types: string[] }>('abonnementsPush', 'compteId', karim.compteId)) assert.deepEqual(a.types, ['absence.demande', 'temps.soumise']);
  // Nouvel appareil : préférences du compte reprises.
  const nouveau = await agir(karim, 'push.abonner', essai('karim-3'));
  assert.deepEqual((await db.get<{ types: string[] }>('abonnementsPush', nouveau.result.id))!.types, ['absence.demande', 'temps.soumise']);
  assert.match((await refus(karim, 'push.preferences', { types: 'absence.demande' })).message, /Préférences invalides/);
  // Mehdi ne voit ni ne retire les appareils de son manager.
  const e = await refus(mehdi, 'push.desabonnerAppareil', { id: nouveau.result.id });
  assert.equal(e.status, 404);
  assert.match((await agir(mehdi, 'push.desabonner', { endpoint: 'https://fcm.googleapis.com/fcm/send/karim-3', motif: 'utilisateur' })).message, /Aucune notification active/);
  assert.ok(await db.get('abonnementsPush', nouveau.result.id));
  assert.match((await refus(mehdi, 'push.desabonner', { endpoint: 'x', motif: 'autre' })).message, /Motif invalide/);
  // Essai : tous les appareils du compte, aussitôt, préférences ignorées.
  const avant = Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM envois_push'))!.n);
  const t = await agir(karim, 'push.tester', {});
  assert.equal(t.result.appareils, 3);
  const essais = await db.query<{ type: string; prochaine: string }>(`SELECT type, prochaine FROM envois_push WHERE type = 'push.essai'`);
  assert.equal(essais.length - avant, 3);
  // Retrait d'un appareil par son compte, puis désabonnement de cet appareil.
  assert.match((await agir(karim, 'push.desabonnerAppareil', { id: nouveau.result.id })).message, /Appareil retiré \(Android, Chrome\)/);
  assert.equal(await db.get('abonnementsPush', nouveau.result.id), undefined);
  const d2 = await agir(karim, 'push.desabonner', { endpoint: 'https://fcm.googleapis.com/fcm/send/karim-2', motif: 'deconnexion' });
  assert.equal(d2.result.retires, 1);
  const j = await db.one<{ payload: unknown }>(`SELECT payload FROM journal WHERE action = 'push.desabonner' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual(json(j!.payload), { motif: 'deconnexion', appareil: 'Android, Chrome', retires: 1 });
  // Révocation de tous les abonnements : administrateur RH seulement.
  assert.equal((await refus(karim, 'push.desabonnerAppareil', { tout: true })).status, 403);
  const tout = await agir(admin, 'push.desabonnerAppareil', { tout: true });
  assert.ok(tout.result.retires >= 1);
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM abonnements_push'))!.n), 0);
  assert.equal(Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM envois_push WHERE type = 'push.essai'`))!.n), 0, 'notifications en file emportées');
});

test('notifier() : notification en file pour les seuls appareils qui ont choisi le type, à l’heure admise, sans texte en base', async () => {
  const karim = await personne(12, 'manager'), mehdi = await personne(2, 'collaborateur');
  const ab = await agir(karim, 'push.abonner', essai('karim-4'));
  // Préférences coupées : rien en file.
  await agir(mehdi, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-21', au: '2026-12-22' });
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM envois_push WHERE abonnement_id = ?', [ab.result.id]))!.n), 0);
  await agir(karim, 'push.preferences', { types: ['absence.demande'] });
  await agir(mehdi, 'absence.demander', { empId: 2, kind: 'RTT', du: '2027-01-04', au: '2027-01-04' });
  const e = (await db.query<Record<string, unknown>>('SELECT * FROM envois_push WHERE abonnement_id = ?', [ab.result.id]))[0];
  assert.equal(e.type, 'absence.demande');
  assert.equal(e.statut, 'a_envoyer');
  // Heure du test inconnue : l'envoi est au premier instant admis, et valable 24 h ensuite.
  const prochaine = new Date(String(e.prochaine));
  assert.equal(np.prochainEnvoiAdmis(prochaine).getTime(), prochaine.getTime());
  assert.equal(new Date(String(e.expire)).getTime() - prochaine.getTime(), 24 * 3600_000);
  assert.doesNotMatch(JSON.stringify(e), /Benali|Mehdi|2027|RTT/);
  // Décision de Karim : rien pour lui-même (auteur), rien pour Mehdi (pas abonné).
  const n = Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM envois_push'))!.n);
  const id = (await db.one<{ id: number }>(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2027-01-04'`))!.id;
  await agir(karim, 'absence.decider', { id, ok: true });
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM envois_push'))!.n), n);
  // Compte désactivé : plus rien en file.
  await db.tx(async () => { await db.update('comptes', karim.compteId, { actif: false }); });
  assert.equal(await db.tx(async () => await push.mettreEnFilePush(db, { empId: 12 }, 'absence.demande')), 0);
  await db.tx(async () => { await db.update('comptes', karim.compteId, { actif: true }); });
  assert.equal(await db.tx(async () => await push.mettreEnFilePush(db, { empId: 12 }, 'inconnu')), 0, 'type sans notification push');
  assert.equal(await db.tx(async () => await push.mettreEnFilePush(db, { empId: null }, 'absence.demande')), 0);
});

test('file d’envoi : pas de blocage en tête, 404/410 → abonnement supprimé, 429/5xx → nouvelle tentative, 400 → échec, expiration ; message relu par le navigateur', async () => {
  const karim = await personne(12, 'manager');
  await agir(karim, 'push.desabonnerAppareil', { id: (await db.one<{ id: number }>('SELECT id FROM abonnements_push WHERE compte_id = ? ORDER BY id DESC', [karim.compteId!]))!.id });
  const navs = [navigateur(), navigateur(), navigateur(), navigateur(), navigateur()];
  const ids: number[] = [];
  for (const [i, nav] of navs.entries()) ids.push((await agir(karim, 'push.abonner', essai(`file-${i}`, nav))).result.id);
  const t0 = new Date('2026-10-12T08:00:00Z');
  await db.tx(async () => { await push.mettreEnFilePush(db, { compteId: karim.compteId }, 'temps.soumise', { force: true, maintenant: t0 }); });
  // Notification périmée en plus (créée il y a deux jours).
  await db.tx(async () => {
    await db.insert('envoisPush', { abonnementId: ids[0], type: 'temps.soumise', statut: 'a_envoyer', tentatives: 0, prochaine: '2026-10-10T08:00:00.000Z', expire: '2026-10-11T08:00:00.000Z', erreur: null, creation: '2026-10-10T08:00:00.000Z', envoi: null });
  });
  // Réponses par appareil : 503 (temporaire) en premier, puis 201, 410, 400, 429 avec Retry-After.
  const statuts = new Map([[0, 503], [1, 201], [2, 410], [3, 400], [4, 429]]);
  const recus: { i: number; clair: string; ttl: string }[] = [];
  const transport: TransportPush = async r => {
    const i = Number(/file-(\d)/.exec(r.url)![1]);
    recus.push({ i, clair: dechiffrer(r.corps, navs[i].e.getPrivateKey(), d(navs[i].auth)), ttl: r.entetes.ttl });
    return { status: statuts.get(i)!, apres: i === 4 ? 120_000 : undefined };
  };
  const n = await file.traiterFilePush(db, transport, () => t0);
  assert.equal(n, 6);
  assert.deepEqual(recus.map(r => r.i).sort(), [0, 1, 2, 3, 4], 'l’échec temporaire du premier ne retient pas les suivants ; la périmée ne part pas');
  assert.deepEqual(JSON.parse(recus.find(r => r.i === 1)!.clair), { type: 'temps.soumise', titre: 'Feuille de temps à valider', corps: 'Une feuille de temps attend votre validation.', url: '/temps' });
  assert.equal(recus[0].ttl, '86400');
  const etat = async (i: number) => await db.query<Record<string, any>>('SELECT * FROM envois_push WHERE abonnement_id = ? ORDER BY id', [ids[i]]);
  const [e0, perimee] = await etat(0);
  assert.equal(perimee.statut, 'expire');
  assert.equal(e0.statut, 'a_envoyer');
  assert.equal(e0.tentatives, 1);
  assert.equal(new Date(e0.prochaine).getTime() - t0.getTime(), 60_000, 'nouvelle tentative dans 1 min');
  assert.equal((await etat(1))[0].statut, 'envoye');
  assert.equal((await db.get<{ dernierSucces: string }>('abonnementsPush', ids[1]))!.dernierSucces, t0.toISOString());
  assert.equal(await db.get('abonnementsPush', ids[2]), undefined, '410 : abonnement supprimé');
  assert.deepEqual(await etat(2), [], 'avec sa notification');
  assert.equal((await etat(3))[0].statut, 'echec');
  assert.equal((await etat(3))[0].erreur, 'HTTP 400');
  assert.equal(new Date((await etat(4))[0].prochaine).getTime() - t0.getTime(), 120_000, 'Retry-After respecté');
  assert.equal((await db.get<{ echecs: number }>('abonnementsPush', ids[4]))!.echecs, 1);
  assert.ok(file.compteursPush().supprimes >= 1);
  // Rien de dû avant la prochaine tentative ; ensuite, le premier passe.
  assert.equal(await file.traiterFilePush(db, transport, () => new Date(t0.getTime() + 30_000)), 0);
  statuts.set(0, 201);
  assert.equal(await file.traiterFilePush(db, transport, () => new Date(t0.getTime() + 61_000)), 1);
  assert.equal((await etat(0))[0].statut, 'envoye');
  // Purge : notifications closes de plus de 30 jours, abonnements sans succès depuis 90 jours ou d'un compte désactivé.
  const p = await db.tx(async () => await file.purgerPush(db, new Date('2027-02-01T08:00:00Z')));
  assert.ok(p.envois >= 3);
  assert.equal(p.abonnements, 3, 'abonnements en échec sans succès depuis 90 jours (le premier : dernier succès le 12 octobre)');
  await db.tx(async () => { await db.update('comptes', karim.compteId, { actif: false }); });
  assert.ok((await db.tx(async () => await file.purgerPush(db, t0))).abonnements >= 1, 'compte désactivé');
  assert.equal(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM abonnements_push WHERE compte_id = ?', [karim.compteId!]))!.n), 0);
  await db.tx(async () => { await db.update('comptes', karim.compteId, { actif: true }); });
});

/** Notification posée directement dans la file (type, heure prévue, validité de 24 h). */
async function enFile(abonnementId: number, type: string, prochaine: string): Promise<number> {
  return await db.tx(async () => (await db.insert<{ id: number }>('envoisPush', {
    abonnementId, type, statut: 'a_envoyer', tentatives: 0, prochaine, expire: new Date(Date.parse(prochaine) + 24 * 3600_000).toISOString(),
    erreur: null, creation: prochaine, envoi: null,
  })).id);
}
const ligne = async (id: number) => (await db.get<Record<string, any>>('envoisPush', id))!;

test('file d’envoi : la base n’est jamais tenue pendant l’appel au service de push (service lent ou injoignable)', async () => {
  const u = await personne(5, 'collaborateur');
  const ab = (await agir(u, 'push.abonner', essai('lent-1'))).result.id;
  const t0 = '2026-10-12T08:00:00.000Z'; // lundi, 10 h à Paris
  const id = await enFile(ab, 'temps.soumise', t0);
  let appele!: () => void, liberer!: () => void;
  const enAppel = new Promise<void>(ok => { appele = ok; });
  const transport: TransportPush = async () => {
    appele();
    await new Promise<void>(ok => { liberer = ok; });
    return { status: 201 };
  };
  const passage = file.traiterFilePush(db, transport, () => new Date(t0));
  await enAppel;
  // Pendant l'appel : une transaction et une écriture passent aussitôt (elles attendaient tout le délai auparavant).
  const debut = Date.now();
  await db.tx(async () => { await db.update('abonnementsPush', ab, { appareil: 'Android, Chrome' }); });
  assert.ok(Date.now() - debut < 500, `transaction attendue ${Date.now() - debut} ms`);
  assert.equal((await ligne(id)).statut, 'a_envoyer', 'issue pas encore écrite');
  liberer();
  assert.equal(await passage, 1);
  assert.equal((await ligne(id)).statut, 'envoye');
  // Abonnement retiré pendant l'appel : rien n'est écrit sur la notification emportée, ni sur l'abonnement.
  const id2 = await enFile(ab, 'temps.soumise', t0);
  const enAppel2 = new Promise<void>(ok => { appele = ok; });
  const passage2 = file.traiterFilePush(db, transport, () => new Date(t0));
  await enAppel2;
  await db.tx(async () => { await push.supprimerAbonnements(db, [ab]); });
  liberer();
  assert.equal(await passage2, 1);
  assert.equal(await db.get('envoisPush', id2), undefined);
  assert.equal(await db.get('abonnementsPush', ab), undefined);
});

test('plage de silence tenue à l’envoi : nouvelle tentative, redémarrage tardif ; l’essai part aussitôt', async () => {
  const u = await personne(6, 'collaborateur');
  const ab = (await agir(u, 'push.abonner', essai('silence-1'))).result.id;
  let statut = 503, appels = 0;
  const transport: TransportPush = async () => { appels++; return { status: statut }; };
  // Mardi 13 octobre 2026, 19 h 59 à Paris (17 h 59 UTC) : 503 ; la tentative suivante tomberait à 20 h → mercredi 7 h.
  const mardi = await enFile(ab, 'temps.soumise', '2026-10-13T17:59:00.000Z');
  assert.equal(await file.traiterFilePush(db, transport, () => new Date('2026-10-13T17:59:00Z')), 1);
  let e = await ligne(mardi);
  assert.deepEqual([e.statut, e.tentatives, e.prochaine], ['a_envoyer', 1, '2026-10-14T05:00:00.000Z']);
  statut = 201;
  assert.equal(await file.traiterFilePush(db, transport, () => new Date('2026-10-14T05:00:00Z')), 1);
  assert.equal((await ligne(mardi)).statut, 'envoye');
  // Vendredi 16 octobre, 19 h 59 : le jour ouvré suivant (lundi 7 h) dépasse la validité de 24 h → expirée sans envoi.
  statut = 503;
  const vendredi = await enFile(ab, 'temps.soumise', '2026-10-16T17:59:00.000Z');
  await file.traiterFilePush(db, transport, () => new Date('2026-10-16T17:59:00Z'));
  e = await ligne(vendredi);
  assert.deepEqual([e.statut, e.prochaine], ['expire', null]);
  // Serveur arrêté de 19 h à 23 h (mardi 20 octobre) : la notification due à 19 h ne part pas à 23 h ; reportée à
  // mercredi 7 h sans compter de tentative.
  statut = 201;
  appels = 0;
  const tard = await enFile(ab, 'temps.soumise', '2026-10-20T17:00:00.000Z');
  assert.equal(await file.traiterFilePush(db, transport, () => new Date('2026-10-20T21:00:00Z')), 1);
  e = await ligne(tard);
  assert.deepEqual([e.statut, e.tentatives, e.prochaine], ['a_envoyer', 0, '2026-10-21T05:00:00.000Z']);
  assert.equal(appels, 0, 'rien n’est parti pendant la plage de silence');
  assert.equal(await file.traiterFilePush(db, transport, () => new Date('2026-10-21T05:00:00Z')), 1);
  assert.equal((await ligne(tard)).statut, 'envoye');
  // Samedi : jamais d'envoi ; le lundi 7 h dépasse la validité.
  appels = 0;
  const samedi = await enFile(ab, 'absence.decision', '2026-10-24T08:00:00.000Z');
  await file.traiterFilePush(db, transport, () => new Date('2026-10-24T08:00:00Z'));
  assert.equal((await ligne(samedi)).statut, 'expire');
  assert.equal(appels, 0);
  // Essai demandé à 23 h : il part aussitôt (la personne l'a demandé), et ses nouvelles tentatives aussi.
  const essaiTard = await enFile(ab, 'push.essai', '2026-10-21T21:00:00.000Z');
  statut = 503;
  await file.traiterFilePush(db, transport, () => new Date('2026-10-21T21:00:00Z'));
  e = await ligne(essaiTard);
  assert.deepEqual([e.statut, e.tentatives, e.prochaine], ['a_envoyer', 1, '2026-10-21T21:01:00.000Z']);
  await db.tx(async () => { await push.supprimerAbonnements(db, [ab]); });
});

test('11e appareil : le plus ancien est retiré avec ses notifications en file, sans référence orpheline', async () => {
  const u = await personne(7, 'collaborateur');
  const premier = (await agir(u, 'push.abonner', essai('onze-0'))).result.id;
  const n = await enFile(premier, 'temps.soumise', '2026-10-21T05:00:00.000Z');
  for (let i = 1; i <= 10; i++) await agir(u, 'push.abonner', essai(`onze-${i}`));
  assert.equal(await db.get('abonnementsPush', premier), undefined);
  assert.equal(await db.get('envoisPush', n), undefined, 'notification emportée');
  assert.equal((await db.where('abonnementsPush', 'compteId', u.compteId)).length, 10);
  const integrite = await controlerOrphelins(db);
  assert.equal(integrite.parReference['envois_push.abonnement_id → abonnements_push'], undefined);
  const ids = (await db.where<{ id: number }>('abonnementsPush', 'compteId', u.compteId)).map(a => a.id);
  await db.tx(async () => { await push.supprimerAbonnements(db, ids); });
});

test('transport fetch : statut et Retry-After lus, erreur réseau → 0 ; processus de fond démarré seulement avec des clés', async () => {
  const { createServer } = await import('node:http');
  const recus: { url?: string; entetes: Record<string, unknown>; taille: number }[] = [];
  const srv = createServer((req, res) => {
    const m: Buffer[] = [];
    req.on('data', (b: Buffer) => m.push(b));
    req.on('end', () => {
      recus.push({ url: req.url, entetes: req.headers, taille: Buffer.concat(m).length });
      if (req.url === '/occupe') res.writeHead(429, { 'retry-after': '30' }).end();
      else res.writeHead(201).end();
    });
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', () => ok()));
  const port = (srv.address() as { port: number }).port;
  try {
    const r = { url: `http://127.0.0.1:${port}/envoi`, entetes: { ttl: '86400', 'content-encoding': 'aes128gcm' }, corps: Buffer.alloc(40, 1) };
    assert.deepEqual(await file.transportFetch(r), { status: 201, apres: undefined });
    assert.equal(recus[0].entetes.ttl, '86400');
    assert.equal(recus[0].taille, 40);
    assert.deepEqual(await file.transportFetch({ ...r, url: `http://127.0.0.1:${port}/occupe` }), { status: 429, apres: 30_000 });
  } finally {
    srv.close();
  }
  const reseau = await file.transportFetch({ url: `http://127.0.0.1:${port}/ferme`, entetes: {}, corps: Buffer.alloc(1) });
  assert.equal(reseau.status, 0);
  assert.equal(reseau.erreur, 'Erreur réseau');
  // Démonstration (clé en mémoire) : passages réguliers, arrêtés par la fonction rendue ; sans clés : rien.
  const arreter = await file.demarrerEnvoisPush(db, async () => ({ status: 201 }), 20);
  await new Promise(ok => setTimeout(ok, 60));
  arreter();
  assert.equal(file.envoiPushEnCours(), false);
  const demo = process.env.CURSUS_DEMO;
  delete process.env.CURSUS_DEMO;
  try {
    const rien = await file.demarrerEnvoisPush(db);
    rien();
  } finally {
    process.env.CURSUS_DEMO = demo;
  }
});
