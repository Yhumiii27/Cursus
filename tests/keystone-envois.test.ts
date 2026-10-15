// Tests des envois sortants vers Keystone : file d'envoi persistante (succès et accusé, reprise après
// 5xx, échec définitif sur 4xx, délai dépassé, clé d'idempotence stable, ordre et envoi un par un,
// relance), rien en file si l'action échoue, heures des seuls projets Keystone, verdicts Go / No Go
// signalés une seule fois, mode simulation et configuration. Keystone est simulé par un serveur
// node:http local ; un dernier scénario lance le vrai serveur avec KEYSTONE_URL.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.KEYSTONE_API_KEY = 'cle-keystone-de-test';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { attente, demarrerEnvois, etatEnvois, listerEnvois, traiterFile, TENTATIVES_MAX } = await import('../server/src/envois.ts');
const { heuresKeystone, sendToKeystone, transportKeystone } = await import('../server/src/integrations/keystone.ts');
const { MODE_VERDICTS, suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { contexte, enregistrerAffectation, enregistrerChantier } = await import('../server/src/integrations/keystone-entrant.ts');
const { keystoneRoutes } = await import('../server/src/integrations/keystone-routes.ts');
const { problemesConfig } = await import('../server/src/config.ts');
const { EVENEMENT_LABEL } = await import('../shared/constants.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Envoi = import('../shared/types.ts').Envoi;
type Corps = Record<string, any>;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const JETON = 'jeton-keystone-de-test';
const MINUTE = 60_000;

const fermer: (() => void)[] = [];
after(() => fermer.forEach(f => f()));

interface Recu { url: string; method: string; headers: IncomingHttpHeaders; body: Corps }
type Reponse = (r: Recu, res: ServerResponse) => void;
const repondre = (status: number, body?: unknown, headers: Record<string, string> = {}): Reponse => (_r, res) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

/** Faux Keystone : enregistre chaque requête, répond selon la file `reponses` (202 avec accusé par défaut). */
async function fauxKeystone() {
  const recus: Recu[] = [], reponses: Reponse[] = [];
  let simultanes = 0, maxSimultanes = 0, delai = 0;
  const srv = createServer((req, res) => {
    simultanes++;
    maxSimultanes = Math.max(maxSimultanes, simultanes);
    res.on('close', () => { simultanes--; });
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      const r = { url: req.url!, method: req.method!, headers: req.headers, body: JSON.parse(data || 'null') };
      recus.push(r);
      const h = reponses.shift() ?? repondre(202, { accuse: `KS-ACK-${recus.length}` });
      setTimeout(() => h(r, res), delai);
    });
  });
  srv.listen(0, '127.0.0.1');
  await new Promise(res => srv.once('listening', res));
  fermer.push(() => { srv.closeAllConnections(); srv.close(); });
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    recus, reponses,
    get maxSimultanes() { return maxSimultanes; },
    set delai(ms: number) { delai = ms; },
  };
}

/** Base de démonstration ; les actions passent par le même enchaînement que POST /api/actions/:nom. */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => {
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    if (changeVerdicts(name)) suivreVerdicts(db);
    return r;
  });
  const envois = (type?: string) => db.all<Envoi>('envois').filter(e => !type || e.type === type);
  const demande = (ref: string) => loadFull(db, RH).demandesKeystone.find(x => x.ref === ref)!;
  return { db, run, envois, demande };
}

/** Mode API vers le faux Keystone ; le délai maximal d'une tentative est réduit pour les tests. */
function modeApi(url: string, delai?: number) {
  process.env.KEYSTONE_URL = `${url}/`;
  process.env.KEYSTONE_TOKEN = JETON;
  const t = transportKeystone()!;
  return delai ? { ...t, delai } : t;
}
function modeSimulation() {
  delete process.env.KEYSTONE_URL;
  delete process.env.KEYSTONE_TOKEN;
}
const dans = (ms: number) => () => new Date(Date.now() + ms);

test('succès : message reçu avec le jeton et la clé d’idempotence, accusé enregistré', async () => {
  const ks = await fauxKeystone();
  const t = modeApi(ks.url);
  const { db, run, envois, demande } = fresh();
  run(RH, 'keystone.refuser', { id: demande('DK-2026-0398').id });
  const [e] = envois('demande.decision');
  assert.deepEqual([e.statut, e.tentatives, e.cible], ['a_envoyer', 0, 'keystone']);
  assert.match(e.cle, /^[0-9a-f-]{36}$/);
  assert.equal(db.all<Corps>('journal').filter(j => j.action === 'keystone.demande.decision').length, 0, 'rien dans le journal en mode API');

  assert.equal(await traiterFile(db, 'keystone', t), 1);
  assert.equal(ks.recus.length, 1);
  const [r] = ks.recus;
  assert.deepEqual([r.method, r.url], ['POST', '/api/cursus/v1/evenements']);
  assert.equal(r.headers.authorization, `Bearer ${JETON}`);
  assert.equal(r.headers['idempotency-key'], e.cle);
  assert.match(String(r.headers['content-type']), /^application\/json/);
  assert.deepEqual(r.body, {
    id: e.cle, type: 'demande.decision', emis_le: e.creation,
    donnees: { demande: demande('DK-2026-0398').id, reference: 'DK-2026-0398', matricule: 'EMP-0006', chantier: 'K-2614', decision: 'refusee', date: '2026-10-10' },
  });
  const apres = db.get<Envoi>('envois', e.id)!;
  assert.deepEqual([apres.statut, apres.tentatives, apres.accuse, apres.prochaine], ['envoye', 1, 'KS-ACK-1', null]);
  assert.ok(apres.envoi && apres.tentative);
  const etat = etatEnvois(db, 'keystone');
  assert.equal(etat.dernierSucces, apres.envoi);
  assert.deepEqual([etat.nombres.envoye, etat.nombres.a_envoyer, etat.enReprise], [1, 0, null]);
  assert.equal(await traiterFile(db, 'keystone', t), 0, 'rien de plus à envoyer');
  // Accusé absent : le statut HTTP en tient lieu.
  ks.reponses.push(repondre(200));
  sendToKeystone(db, { type: 'absence.validee', absence: 1, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  await traiterFile(db, 'keystone', t);
  assert.equal(envois('absence.validee')[0].accuse, 'HTTP 200');
});

test('erreur 500 puis 503 puis succès : nouvelles tentatives avec la même clé, attente croissante', async () => {
  const ks = await fauxKeystone();
  const t = modeApi(ks.url);
  const { db, envois } = fresh();
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => attente(n) / MINUTE), [1, 2, 4, 8, 16, 32, 60, 60, 60], '1 min à 1 h');
  const e = sendToKeystone(db, { type: 'heures.validees', matricule: 'EMP-0018', semaine: '2026-10-05', projets: { 'K-2614': 39 } });
  ks.reponses.push(repondre(500, { error: 'Base indisponible', code: 'ERREUR_INTERNE' }), repondre(503, {}));

  const t0 = Date.now();
  await traiterFile(db, 'keystone', t);
  let x = db.get<Envoi>('envois', e.id)!;
  assert.deepEqual([x.statut, x.tentatives, x.erreur], ['a_envoyer', 1, 'HTTP 500 · ERREUR_INTERNE — Base indisponible']);
  const attendu1 = Date.parse(x.prochaine!) - t0;
  assert.ok(attendu1 >= MINUTE && attendu1 < MINUTE + 5000, `1 min (${attendu1} ms)`);
  assert.deepEqual(etatEnvois(db, 'keystone').enReprise, { id: e.id, type: 'heures.validees', tentatives: 1, prochaine: x.prochaine, erreur: x.erreur });
  assert.equal(await traiterFile(db, 'keystone', t), 0, 'pas avant la date prévue');

  await traiterFile(db, 'keystone', t, dans(MINUTE + 1000));
  x = db.get<Envoi>('envois', e.id)!;
  assert.deepEqual([x.statut, x.tentatives, x.erreur], ['a_envoyer', 2, 'HTTP 503']);
  const attendu2 = Date.parse(x.prochaine!) - (Date.now() + MINUTE + 1000);
  assert.ok(attendu2 > 2 * MINUTE - 5000 && attendu2 <= 2 * MINUTE, `2 min (${attendu2} ms)`);

  await traiterFile(db, 'keystone', t, dans(4 * MINUTE));
  x = db.get<Envoi>('envois', e.id)!;
  assert.deepEqual([x.statut, x.tentatives, x.accuse], ['envoye', 3, 'KS-ACK-3']);
  assert.equal(x.erreur, 'HTTP 503', 'dernière erreur conservée après la réussite');
  assert.equal(ks.recus.length, 3);
  assert.deepEqual(new Set(ks.recus.map(r => r.headers['idempotency-key'])), new Set([e.cle]), 'clé stable entre les tentatives');
  assert.deepEqual(new Set(ks.recus.map(r => JSON.stringify(r.body))).size, 1, 'contenu identique à chaque tentative');
  assert.equal(envois().length, 1);
});

test('erreur 400 : échec définitif, les messages suivants partent, relance par le RH', async () => {
  const ks = await fauxKeystone();
  const t = modeApi(ks.url);
  const { db, run, envois } = fresh();
  const a = sendToKeystone(db, { type: 'absence.validee', absence: 7, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  const b = sendToKeystone(db, { type: 'absence.annulee', absence: 7, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  ks.reponses.push(repondre(400, { error: 'Matricule inconnu', code: 'VALIDATION' }));
  assert.equal(await traiterFile(db, 'keystone', t), 2);
  const ea = db.get<Envoi>('envois', a.id)!;
  assert.deepEqual([ea.statut, ea.tentatives, ea.erreur, ea.prochaine], ['echec', 1, 'HTTP 400 · VALIDATION — Matricule inconnu', null]);
  assert.equal(db.get<Envoi>('envois', b.id)!.statut, 'envoye', 'un échec définitif ne retient pas la file');
  const j = db.all<Corps>('journal').filter(x => x.action === 'keystone.echec');
  assert.equal(j.length, 1);
  assert.match(j[0].message, /^Envoi absence\.validee en échec après 1 tentative — HTTP 400 · VALIDATION/);
  assert.deepEqual(listerEnvois(db, { statut: 'echec' }).map(x => x.id), [a.id]);
  assert.deepEqual(listerEnvois(db).map(x => x.id), [b.id, a.id], 'les plus récents d’abord');

  // Classement : l'échec examiné par le RH reste dans la liste mais ne compte plus dans l'état de l'intégration.
  assert.deepEqual([etatEnvois(db, 'keystone').nombres.echec, etatEnvois(db, 'keystone').echecsEnCours], [1, 1]);
  assert.throws(() => run(KARIM, 'envoi.classer', { id: a.id }), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.throws(() => run(RH, 'envoi.classer', { id: b.id }), /Seul un envoi en échec peut être classé/);
  assert.match(String(run(RH, 'envoi.classer', { id: a.id })), /classé — il ne compte plus parmi les échecs en cours/);
  assert.throws(() => run(RH, 'envoi.classer', { id: a.id }), /Envoi déjà classé/);
  assert.ok(db.get<Envoi>('envois', a.id)!.classe);
  assert.deepEqual([etatEnvois(db, 'keystone').nombres.echec, etatEnvois(db, 'keystone').echecsEnCours], [1, 0]);
  assert.deepEqual(listerEnvois(db, { statut: 'echec' }).map(x => x.id), [a.id], 'toujours listé');

  // Relance : réservée au RH, pour un envoi en échec ; même clé, nouvelle série de tentatives.
  assert.throws(() => run(KARIM, 'envoi.relancer', { id: a.id }), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.throws(() => run(RH, 'envoi.relancer', { id: b.id }), /Seul un envoi en échec peut être relancé/);
  assert.throws(() => run(RH, 'envoi.relancer', { id: 999 }), /Envoi introuvable/);
  assert.match(String(run(RH, 'envoi.relancer', { id: a.id })), /Envoi absence\.validee relancé vers Keystone/);
  assert.deepEqual([db.get<Envoi>('envois', a.id)!.statut, db.get<Envoi>('envois', a.id)!.tentatives, db.get<Envoi>('envois', a.id)!.classe], ['a_envoyer', 0, null], 'relancé : plus classé');
  await traiterFile(db, 'keystone', t);
  assert.equal(db.get<Envoi>('envois', a.id)!.statut, 'envoye');
  assert.deepEqual(ks.recus.filter(r => r.body.donnees.absence === 7 && r.body.type === 'absence.validee').map(r => r.headers['idempotency-key']), [a.cle, a.cle]);
  // En simulation, aucune relance possible.
  db.update('envois', a.id, { statut: 'echec' });
  modeSimulation();
  assert.throws(() => run(RH, 'envoi.relancer', { id: a.id }), /non configuré : relance impossible/);
  assert.equal(envois().length, 2);

  // 408 et 429 sont temporaires ; Retry-After allonge l'attente, dans la limite d'une heure. Une redirection est définitive.
  const t2 = modeApi(ks.url);
  const c = sendToKeystone(db, { type: 'absence.validee', absence: 8, matricule: 'EMP-0002', du: '2026-12-09', au: '2026-12-09' });
  ks.reponses.push(repondre(429, { error: 'Trop de requêtes' }, { 'retry-after': '600' }));
  const t0 = Date.now();
  await traiterFile(db, 'keystone', t2);
  const ec = db.get<Envoi>('envois', c.id)!;
  assert.equal(ec.statut, 'a_envoyer');
  assert.ok(Math.abs(Date.parse(ec.prochaine!) - t0 - 10 * MINUTE) < 5000, '10 min demandées par Keystone');
  ks.reponses.push(repondre(408), repondre(301, undefined, { location: 'https://ailleurs.example/' }));
  await traiterFile(db, 'keystone', t2, dans(11 * MINUTE));
  assert.deepEqual([db.get<Envoi>('envois', c.id)!.statut, db.get<Envoi>('envois', c.id)!.tentatives], ['a_envoyer', 2]);
  await traiterFile(db, 'keystone', t2, dans(20 * MINUTE));
  assert.equal(db.get<Envoi>('envois', c.id)!.statut, 'echec');
  assert.match(db.get<Envoi>('envois', c.id)!.erreur!, /HTTP 301 · redirection non suivie/);
});

test('délai dépassé ou Keystone injoignable : nouvelle tentative, puis échec après 10 tentatives', async () => {
  const ks = await fauxKeystone();
  const t = modeApi(ks.url, 150);
  const { db } = fresh();
  const e = sendToKeystone(db, { type: 'absence.validee', absence: 1, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  ks.reponses.push(() => { /* aucune réponse */ });
  await traiterFile(db, 'keystone', t);
  let x = db.get<Envoi>('envois', e.id)!;
  assert.deepEqual([x.statut, x.tentatives, x.erreur], ['a_envoyer', 1, 'Délai dépassé : aucune réponse en 0.15 s']);

  // Adresse sans serveur : erreur réseau, même traitement ; la dixième tentative met le message en échec.
  const libre = await new Promise<number>(res => { const s = express().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => res(p)); }); });
  const ferme = { ...t, url: `http://127.0.0.1:${libre}/api/cursus/v1/evenements` };
  for (let n = 2; n <= TENTATIVES_MAX; n++) {
    await traiterFile(db, 'keystone', ferme, dans(n * 2 * 3600_000));
    x = db.get<Envoi>('envois', e.id)!;
    assert.equal(x.tentatives, n);
    assert.match(x.erreur!, /^Erreur réseau : ECONNREFUSED/);
    assert.equal(x.statut, n < TENTATIVES_MAX ? 'a_envoyer' : 'echec', `tentative ${n}`);
  }
  assert.equal(x.prochaine, null);
  assert.match(db.all<Corps>('journal').find(j => j.action === 'keystone.echec')!.message, /après 10 tentatives — Erreur réseau/);

  // Adresse avec identifiants (refusée en production) : fetch la recopie dans son erreur, Cursus jamais.
  const e2 = sendToKeystone(db, { type: 'absence.validee', absence: 2, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  await traiterFile(db, 'keystone', { ...t, url: `http://svc:S3cret@127.0.0.1:${libre}/api/cursus/v1/evenements` });
  const x2 = db.get<Envoi>('envois', e2.id)!;
  assert.match(x2.erreur!, /^Erreur réseau : .*<adresse>/);
  assert.ok(!x2.erreur!.includes('S3cret'));
});

test('un seul envoi à la fois par cible, dans l’ordre d’émission ; un message en attente retient les suivants', async () => {
  const ks = await fauxKeystone();
  const t = modeApi(ks.url);
  const { db } = fresh();
  const ids = [1, 2, 3].map(n => sendToKeystone(db, { type: 'absence.validee', absence: n, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' }).id);
  ks.delai = 40;
  const [n1, n2] = await Promise.all([traiterFile(db, 'keystone', t), traiterFile(db, 'keystone', t)]);
  assert.deepEqual([n1, n2], [3, 0], 'le second traitement ne fait rien pendant le premier');
  assert.equal(ks.maxSimultanes, 1);
  assert.deepEqual(ks.recus.map(r => r.body.donnees.absence), [1, 2, 3]);
  assert.ok(ids.every(id => db.get<Envoi>('envois', id)!.statut === 'envoye'));

  // Le message en tête attend sa nouvelle tentative : les suivants ne passent pas devant.
  ks.delai = 0;
  const a = sendToKeystone(db, { type: 'absence.validee', absence: 4, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  const b = sendToKeystone(db, { type: 'absence.annulee', absence: 4, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
  ks.reponses.push(repondre(502));
  assert.equal(await traiterFile(db, 'keystone', t), 1);
  assert.equal(db.get<Envoi>('envois', b.id)!.statut, 'a_envoyer');
  assert.equal(ks.recus.length, 4);
  await traiterFile(db, 'keystone', t, dans(2 * MINUTE));
  assert.deepEqual(ks.recus.slice(4).map(r => r.body.type), ['absence.validee', 'absence.annulee']);
  assert.ok([a.id, b.id].every(id => db.get<Envoi>('envois', id)!.statut === 'envoye'));
});

test('rien en file si l’action échoue', () => {
  modeSimulation();
  const { db, run, envois, demande } = fresh();
  assert.throws(() => db.tx(() => {
    sendToKeystone(db, { type: 'absence.validee', absence: 1, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });
    throw new Error('écriture refusée');
  }), /écriture refusée/);
  assert.equal(envois().length, 0, 'message annulé avec la transaction');
  assert.equal(db.all<Corps>('journal').length, 0);
  // Actions refusées : ni message, ni verdict mémorisé.
  run(RH, 'keystone.refuser', { id: demande('DK-2026-0398').id });
  assert.equal(envois('demande.decision').length, 1);
  assert.throws(() => run(RH, 'keystone.refuser', { id: demande('DK-2026-0398').id }), /déjà refusée/);
  assert.throws(() => run(KARIM, 'temps.validate', { empId: 3, week: '2026-09-28' }), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.equal(envois().length, 1);
});

test('heures validées : seules les heures des projets Keystone partent, sans activité interne ni ECOLE', () => {
  modeSimulation();
  assert.deepEqual(heuresKeystone([
    { projet: 'K-2614', tache: 'a', ks: true, h: [3, 3, 3, 3, 3.5] }, { projet: 'INT-MAINT', tache: 'b', ks: true, h: [2, 2, 2, 2, 2] },
    { projet: 'ECOLE', tache: 'c', ks: true, h: [0, 0, 0, 7, 7] }, { projet: 'K-2611', tache: 'd', ks: false, h: [0, 0, 0, 0, 0] },
    { projet: 'K-2614', tache: 'e', ks: false, h: [0.1, 0.2, 0, 0, 0] },
  ]), { 'K-2614': 15.8 });
  const { db, run, envois } = fresh();
  // Karim Haddad : deux chantiers et de la maintenance interne.
  assert.match(String(run(RH, 'temps.validate', { empId: 12, week: '2026-09-28' })), /validée — heures des projets Keystone renvoyées à Keystone/);
  const [e] = envois('heures.validees');
  assert.deepEqual(e.contenu, { matricule: 'EMP-0012', semaine: '2026-09-28', projets: { 'K-2614': 15, 'K-2611': 15 } });
  assert.equal(e.statut, 'simule');
  // Alternance : maintenance interne et cours au CFA, rien pour Keystone.
  const msg = run(RH, 'temps.validate', { empId: 24, week: '2026-09-28' });
  assert.doesNotMatch(String(msg), /Keystone/);
  assert.equal(envois('heures.validees').length, 1);
  const f = loadFull(db, RH).feuilles.find(x => x.empId === 24 && x.week === '2026-09-28')!;
  assert.deepEqual([f.statut, f.keystone], ['validee', false]);
  const j = db.all<Corps>('journal').filter(x => x.action === 'keystone.heures.validees');
  assert.equal(j.length, 1);
  assert.ok(!JSON.stringify(j).includes('INT-'));
});

test('verdict Go / No Go : un changement est mis en file une seule fois, codes de motif seulement', async () => {
  modeSimulation();
  const { db, run, envois, demande } = fresh();
  const verdicts = () => envois('verdict.modifie').map(e => e.contenu as Corps);
  assert.equal(db.count('verdictsKeystone'), 12, 'verdicts de départ mémorisés par le jeu de démonstration');
  assert.deepEqual(suivreVerdicts(db), [], 'rien n’a changé');
  run(RH, 'parametres.maj', { partageKeystone: 'detaille' });
  assert.equal(verdicts().length, 0);

  // Action : le déplacement créé à l'acceptation lève la réserve « déplacement » de Romain Chevalier à Abidjan.
  run(RH, 'keystone.accepter', { id: demande('DK-2026-0412').id });
  assert.equal(verdicts().length, 1);
  const [v] = verdicts();
  assert.equal(v.chantier, 'K-2611');
  assert.deepEqual([v.ressource.matricule, v.ressource.precedent], ['EMP-0018', 'GO_RESERVE']);
  assert.ok(v.ressource.motifs.every((m: Corps) => Object.keys(m).join() === 'code,niveau'), 'jamais de libellé, même en partage détaillé');
  assert.ok(!v.ressource.motifs.some((m: Corps) => m.code === 'DEPLACEMENT'));
  assert.deepEqual(suivreVerdicts(db), [], 'signalé une seule fois');
  run(RH, 'parametres.maj', { horizonAlerte: 120 });
  assert.equal(verdicts().length, 1);
});

test('verdict Go / No Go : recalcul quotidien, une expiration signalée une fois, chantiers terminés plus suivis', () => {
  modeSimulation();
  const { db, envois } = fresh();
  const verdicts = () => envois('verdict.modifie').map(e => e.contenu as Corps);
  // Un mois plus tard, les formalités de Tema sont hors délai ; Rétrofit et Feyzin sont terminés.
  process.env.CURSUS_TODAY = '2026-11-10';
  try {
    const signales = suivreVerdicts(db);
    assert.deepEqual(signales, [{ chantier: 'K-2625', empId: 23 }]);
    const tema = verdicts().at(-1)!;
    assert.deepEqual([tema.statut, tema.ressource.statut, tema.ressource.precedent, tema.ressource.motifs], ['NO_GO', 'NO_GO', 'GO_RESERVE', [{ code: 'FORMALITES_VOYAGE', niveau: 'NO_GO' }]]);
    assert.deepEqual(suivreVerdicts(db), []);
    assert.ok(!db.all<Corps>('verdictsKeystone').some(x => ['K-2614', 'K-2620'].includes(x.chantier)), 'chantiers terminés retirés du suivi');
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
});

test('verdicts : mémorisés en simulation, tous renvoyés comme premiers verdicts au passage en mode API', async () => {
  const ks = await fauxKeystone();
  modeSimulation();
  const { db, envois } = fresh();
  const verdicts = () => envois('verdict.modifie');
  assert.equal(db.getSetting(MODE_VERDICTS, null), 'simulation');
  // En production sans KEYSTONE_URL : Keystone crée un chantier qui exige l'ATEX et y affecte Romain Chevalier (No Go).
  db.tx(() => {
    enregistrerChantier(contexte(db), 'K-NEW', { nom: 'Arrêt ATEX', lieu: 'Feyzin', pays: 'FR', debut: '2026-11-16', fin: '2026-11-20', habilitations: ['atex'] });
    enregistrerAffectation(contexte(db), 'AF-NEW', { matricule: 'EMP-0018', chantier: 'K-NEW', du: '2026-11-16', au: '2026-11-20' });
    suivreVerdicts(db);
  });
  assert.deepEqual(verdicts().map(e => [e.statut, (e.contenu as Corps).chantier]), [['simule', 'K-NEW']]);
  const suivis = db.count('verdictsKeystone');
  assert.equal(suivis, 13);

  // KEYSTONE_URL définie (redémarrage) : rien n'a été transmis, chaque ressource suivie part avec un premier verdict.
  const t = modeApi(ks.url);
  try {
    const signales = db.tx(() => suivreVerdicts(db));
    assert.equal(signales.length, suivis);
    const partis = verdicts().filter(e => e.statut === 'a_envoyer').map(e => e.contenu as Corps);
    assert.equal(partis.length, suivis);
    assert.ok(partis.every(v => v.ressource.precedent === null), 'premiers verdicts');
    const neuf = partis.find(v => v.chantier === 'K-NEW')!;
    assert.deepEqual([neuf.ressource.matricule, neuf.ressource.statut, neuf.ressource.motifs], ['EMP-0018', 'NO_GO', [{ code: 'HABILITATION', niveau: 'NO_GO' }]]);
    assert.equal(db.getSetting(MODE_VERDICTS, null), 'api');
    assert.deepEqual(suivreVerdicts(db), [], 'une seule fois');
    assert.equal(await traiterFile(db, 'keystone', t), suivis);
    assert.equal(ks.recus.length, suivis);
    // Retour en simulation puis en mode API : les changements simulés entre-temps n'ont pas été reçus, tout repart.
    modeSimulation();
    assert.deepEqual(suivreVerdicts(db), []);
    modeApi(ks.url);
    assert.equal(suivreVerdicts(db).length, suivis);
  } finally {
    modeSimulation();
  }
});

test('écriture de Keystone : nouvelle ressource signalée (premier verdict), retirée sans message', async () => {
  modeSimulation();
  const { db, envois } = fresh();
  const app = express();
  app.use('/api/integrations/keystone', keystoneRoutes(db));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(res => srv.once('listening', res));
  fermer.push(() => srv.close());
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/integrations/keystone/v1`;
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, {
    method, headers: { 'x-api-key': 'cle-keystone-de-test', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const verdicts = () => envois('verdict.modifie').map(e => e.contenu as Corps);
  // Mehdi Benali (EMP-0002), venu en repérage avant le chantier de Feyzin, y est affecté : premier verdict.
  assert.equal(verdicts().length, 0);
  assert.equal((await call('PUT', '/affectations/AF-T-2', { matricule: 'EMP-0002', chantier: 'K-2620', du: '2026-10-19', au: '2026-10-23' })).status, 201);
  assert.equal(verdicts().length, 1);
  const [v] = verdicts();
  assert.deepEqual([v.chantier, v.ressource.matricule, v.ressource.precedent], ['K-2620', 'EMP-0002', null]);
  // Envoi identique : rien de nouveau ; retrait : plus suivi, sans message.
  await call('PUT', '/affectations/AF-T-2', { matricule: 'EMP-0002', chantier: 'K-2620', du: '2026-10-19', au: '2026-10-23' });
  assert.equal(verdicts().length, 1);
  assert.equal((await call('DELETE', '/affectations/AF-T-2')).status, 200);
  assert.equal(verdicts().length, 1);
  assert.ok(!db.all<Corps>('verdictsKeystone').some(x => x.empId === 2 && x.chantier === 'K-2620'));
  const n = verdicts().length;
  // Exigence ajoutée par Keystone : les ressources concernées sont signalées dans la même transaction.
  const r = await call('PUT', '/chantiers/K-2625', { nom: 'Audit HSE usine', client: 'Tema Packaging', lieu: 'Tema', pays: 'GH', debut: '2026-12-01', fin: '2026-12-05', chef: 'Sarah Cohen', habilitations: ['atex'], certifications: ['sst'] });
  assert.equal(r.status, 200);
  assert.ok(verdicts().slice(n).some(x => x.chantier === 'K-2625'));
  // Écriture refusée : rien n'est mis en file.
  const avant = envois().length;
  assert.equal((await call('PUT', '/chantiers/K-2625', { nom: 'x' })).status, 400);
  assert.equal(envois().length, avant);
});

test('simulation : statut « simulé » immédiat, message tracé dans le journal, rien n’est envoyé', async () => {
  const ks = await fauxKeystone();
  modeSimulation();
  assert.equal(transportKeystone(), null);
  const { db, run, envois, demande } = fresh();
  run(KARIM, 'absence.demander', { empId: 18, kind: 'CP', du: '2026-12-14', au: '2026-12-15' });
  const [e] = envois('absence.validee');
  assert.deepEqual([e.statut, e.tentatives, e.prochaine], ['simule', 0, null]);
  const a = loadFull(db, RH).absences.find(x => x.empId === 18 && x.du === '2026-12-14')!;
  assert.deepEqual(e.contenu, { absence: a.id, matricule: 'EMP-0018', du: '2026-12-14', au: '2026-12-15' }, 'jamais la nature de l’absence');
  const j = db.all<Corps>('journal').filter(x => x.action === 'keystone.absence.validee');
  assert.deepEqual(j.map(x => [x.actor, x.role, x.message]), [['Cursus', 'integration', 'Message Keystone (simulation)']]);
  assert.equal(j[0].payload.type, 'absence.validee');
  run(RH, 'keystone.refuser', { id: demande('DK-2026-0398').id });
  const arreter = demarrerEnvois(db, { keystone: transportKeystone() }, 10);
  await new Promise(res => setTimeout(res, 50));
  arreter();
  assert.equal(ks.recus.length, 0);
  assert.ok(envois().every(x => x.statut === 'simule'));
  assert.deepEqual(etatEnvois(db, 'keystone').nombres, { a_envoyer: 0, envoye: 0, echec: 0, simule: 2 });
});

test('configuration : en production, KEYSTONE_URL exige KEYSTONE_TOKEN et une adresse http(s)', () => {
  const PROD = { NODE_ENV: 'production', CURSUS_SECRET: 'x'.repeat(32), KEYSTONE_API_KEY: 'cle-keystone-de-test' };
  assert.deepEqual(problemesConfig({ ...PROD, KEYSTONE_URL: 'http://keystone.interne:8080', KEYSTONE_TOKEN: JETON }), []);
  const sansJeton = problemesConfig({ ...PROD, KEYSTONE_URL: 'http://keystone.interne:8080' });
  assert.equal(sansJeton.length, 1);
  assert.match(sansJeton[0], /KEYSTONE_URL est définie sans KEYSTONE_TOKEN/);
  const invalide = problemesConfig({ ...PROD, KEYSTONE_URL: 'keystone.interne', KEYSTONE_TOKEN: JETON });
  assert.equal(invalide.length, 1);
  assert.match(invalide[0], /KEYSTONE_URL n’est pas une adresse http\(s\) valide/);
  // Identifiants dans l'adresse : refusés, sans être recopiés dans le message.
  const identifiants = problemesConfig({ ...PROD, KEYSTONE_URL: 'http://svc:S3cret@keystone.interne:8080', KEYSTONE_TOKEN: JETON });
  assert.equal(identifiants.length, 1);
  assert.match(identifiants[0], /KEYSTONE_URL contient un identifiant ou un mot de passe/);
  assert.ok(!identifiants.join().includes('S3cret'));
  assert.ok(!problemesConfig({ ...PROD, KEYSTONE_URL: 'http//svc:S3cret@keystone', KEYSTONE_TOKEN: JETON }).join().includes('S3cret'), 'adresse invalide masquée');
  assert.equal(transportKeystone({ KEYSTONE_URL: 'http://ks:8080///' })!.url, 'http://ks:8080/api/cursus/v1/evenements');
  assert.deepEqual(transportKeystone({ KEYSTONE_URL: 'http://ks:8080' })!.entetes({} as Envoi), {}, 'sans jeton (hors production) : pas d’en-tête Authorization');
});

test('contrat OpenAPI : chaque événement émis a la forme décrite par le webhook « evenement »', () => {
  modeSimulation();
  const spec = JSON.parse(readFileSync(join(ROOT, 'docs/keystone-openapi.json'), 'utf8'));
  const sch = spec.components.schemas;
  assert.equal(spec.webhooks.evenement.post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/Evenement');
  const mapping: Record<string, string> = sch.Evenement.discriminator.mapping;
  assert.deepEqual(Object.keys(mapping).sort(), Object.keys(EVENEMENT_LABEL).sort(), 'types déclarés = types affichés');
  const { db, run, envois, demande } = fresh();
  run(RH, 'keystone.accepter', { id: demande('DK-2026-0412').id }); // décision et verdict modifié
  run(RH, 'temps.validate', { empId: 12, week: '2026-09-28' });
  run(KARIM, 'absence.demander', { empId: 18, kind: 'RTT', du: '2026-12-14', au: '2026-12-14' });
  const a = loadFull(db, RH).absences.find(x => x.empId === 18 && x.du === '2026-12-14')!;
  sendToKeystone(db, { type: 'absence.annulee', absence: a.id, matricule: 'EMP-0018', du: a.du, au: a.au });
  const emis = envois();
  assert.deepEqual([...new Set(emis.map(e => e.type))].sort(), Object.keys(EVENEMENT_LABEL).sort(), 'un événement de chaque type');
  for (const e of emis) {
    const donnees = sch[mapping[e.type].split('/').at(-1)!].allOf[1].properties.donnees;
    assert.deepEqual(Object.keys(e.contenu).sort(), [...donnees.required].sort(), e.type);
    if (e.type === 'verdict.modifie') {
      const r = (e.contenu as Corps).ressource;
      assert.deepEqual(Object.keys(r).sort(), [...donnees.properties.ressource.required].sort());
      assert.ok(r.motifs.every((m: Corps) => Object.keys(m).sort().join() === sch.MotifCode.required.sort().join()));
    }
    const corps = transportKeystone({ KEYSTONE_URL: 'http://keystone.interne' })!.corps(e) as Corps;
    assert.deepEqual(Object.keys(corps).sort(), [...sch.EnveloppeEvenement.required].sort());
    assert.equal(corps.id, e.cle);
  }
});

// — Serveur réel : action, file d'envoi en tâche de fond, vue « Envois » —

test('serveur : l’action met en file, le processus de fond envoie, la vue Envois le montre au RH', async () => {
  const ks = await fauxKeystone();
  const dir = mkdtempSync(join(tmpdir(), 'cursus-envois-'));
  const port = await new Promise<number>(res => { const s = express().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => res(p)); }); });
  const p: ChildProcess = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '', CURSUS_DEMO: '1', CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', CURSUS_API_PORT: String(port),
      CURSUS_DB: join(dir, 'cursus.db'), KEYSTONE_URL: ks.url, KEYSTONE_TOKEN: JETON,
    },
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
  const assert200 = async (r: Response) => { assert.equal(r.status, 200, await r.clone().text()); return r.json() as Promise<Corps>; };
  const data = await assert200(await fetch(`${base}/api/data`, { headers: { cookie } }));
  assert.equal((await s.json()).integrations.keystone, 'api');
  const id = data.demandesKeystone.find((x: Corps) => x.ref === 'DK-2026-0398').id;
  const r = await assert200(await fetch(`${base}/api/actions/keystone.refuser`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id }) }));
  assert.match(r.message, /Demande refusée/);

  // Le processus de fond relève la file toutes les 2 s.
  const lire = () => fetch(`${base}/api/envois`, { headers: { cookie } }).then(assert200);
  let v = await lire();
  for (let i = 0; i < 50 && v.envois[0]?.statut !== 'envoye'; i++) {
    await new Promise(res => setTimeout(res, 100));
    v = await lire();
  }
  assert.equal(ks.recus.length, 1, 'aucun verdict au démarrage : les verdicts de départ sont connus');
  assert.equal(ks.recus[0].body.type, 'demande.decision');
  assert.equal(ks.recus[0].headers.authorization, `Bearer ${JETON}`);
  assert.deepEqual([v.envois.length, v.envois[0].statut, v.envois[0].accuse, v.envois[0].cle], [1, 'envoye', 'KS-ACK-1', ks.recus[0].headers['idempotency-key']]);
  assert.equal(v.keystone.mode, 'api');
  assert.equal(v.keystone.dernierSucces, v.envois[0].envoi);
  assert.deepEqual((await lire().then(() => fetch(`${base}/api/envois?statut=echec`, { headers: { cookie } })).then(assert200)).envois, []);
  // Journal : les appels entrants de Keystone ont leur vue, sans masquer les actions.
  assert.equal((await fetch(`${base}/api/integrations/keystone/v1/chantiers/K-2614/go-no-go`, { headers: { 'x-api-key': 'demo-keystone' } })).status, 200);
  const actions = (await fetch(`${base}/api/journal`, { headers: { cookie } }).then(assert200)).lignes as Corps[];
  assert.ok(actions.some(x => x.action === 'keystone.refuser'));
  assert.ok(!actions.some(x => x.action === 'keystone.appel'));
  const appels = (await fetch(`${base}/api/journal?vue=keystone`, { headers: { cookie } }).then(assert200)).lignes as Corps[];
  assert.deepEqual(appels.map(x => [x.action, x.message]), [['keystone.appel', 'GET /v1/chantiers/K-2614/go-no-go → 200 · réf. K-2614']]);
  // Réservée au service RH.
  await fetch(`${base}/api/mode`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'manager' }) });
  assert.equal((await fetch(`${base}/api/envois`, { headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/envois`)).status, 403);
});
