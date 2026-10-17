// Tests de l'API Keystone entrante : projets, chantiers, affectations, tâches planifiées, instantané,
// demandes de déplacement (contrôles 400 / 409, revalidation à l'acceptation), clé, journal des appels,
// Go / No Go d'un chantier créé par l'API, proposition des heures de la semaine et contrat OpenAPI.
// Les routes sont montées dans un serveur Express de test ; un dernier scénario lance le vrai serveur
// en production sur une base vide, alimentée par l'API seule.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.KEYSTONE_API_KEY = 'cle-keystone-de-test';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { keystoneRoutes, ROUTES_V1 } = await import('../server/src/integrations/keystone-routes.ts');
const { Domain } = await import('../shared/domain.ts');
const { ACTIVITES_INTERNES, CODES_MOTIF } = await import('../shared/constants.ts');
const { suggestLines, tachesDeLaSemaine } = await import('../shared/rules/temps.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Corps = Record<string, any>;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const CLE = 'cle-keystone-de-test';

const fermer: (() => void)[] = [];
after(() => fermer.forEach(f => f()));

/** Base de démonstration et routes Keystone servies par un Express de test. */
async function fresh(demo = true, options: Parameters<typeof keystoneRoutes>[1] = {}) {
  const db = new Db(':memory:');
  if (demo) seedDemo(db);
  const app = express();
  app.use('/api/integrations/keystone', keystoneRoutes(db, options));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(res => srv.once('listening', res));
  fermer.push(() => srv.close());
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/integrations/keystone`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-api-key': CLE }) => {
    const r = await fetch(base + path, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: r.status, headers: r.headers, body: await r.json() as Corps };
  };
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const domain = () => new Domain(loadFull(db, RH));
  const appels = () => db.all<{ action: string; message: string; payload: Corps }>('journal').filter(j => j.action === 'keystone.appel');
  return { db, call, run, domain, appels };
}

const CHANTIER = { nom: 'Arrêt technique ATEX', client: 'Pétrochimie du Rhône', lieu: 'Feyzin', pays: 'FR', debut: '2026-11-16', fin: '2026-11-20', chef: 'Sarah Cohen', habilitations: ['atex'], certifications: ['sst'] };

test('clé absente ou fausse : 401 sur chaque route, appels refusés résumés sans contenu', async () => {
  const { call, appels } = await fresh(true, { resumeRefus: 300 });
  const routes = [...ROUTES_V1.map(([m, p]) => [m, `/v1${p.replace(/\{\w+\}/g, 'K-2614')}`]), ['get', '/chantiers/K-2614/go-no-go'], ['post', '/demandes']];
  for (const [method, path] of routes) {
    for (const headers of [{}, { 'x-api-key': 'mauvaise-cle' }, { 'x-api-key': `${CLE}-plus-longue` }] as Record<string, string>[]) {
      const r = await call(method.toUpperCase(), path, method === 'get' || method === 'delete' ? undefined : { matricule: 'EMP-0018' }, headers);
      assert.equal(r.status, 401, `${method} ${path}`);
      assert.equal(r.body.code, 'CLE_INVALIDE');
    }
  }
  // N'importe qui peut appeler sans clé : pas une ligne par appel, mais un résumé par période (une minute en service).
  assert.equal(appels().length, 0, 'aucune ligne par appel refusé');
  const total = () => appels().reduce((n, x) => n + x.payload.refuses, 0);
  for (let i = 0; i < 40 && total() < routes.length * 3; i++) await new Promise(res => setTimeout(res, 50));
  const j = appels();
  assert.equal(total(), routes.length * 3, 'chaque appel refusé est compté');
  assert.ok(j.length < 10, `${j.length} lignes de résumé`);
  assert.match(j[0].message, /^\d+ appels? refusés? sans clé valide \(401 × \d+\) depuis \d{2}:\d{2}:\d{2}$/);
  assert.ok(!JSON.stringify(j).includes('EMP-0018'), 'jamais le contenu reçu');
  assert.ok(!JSON.stringify(j).includes('/v1/'), 'ni le chemin appelé');
  // Corps illisible ou sans Content-Type JSON, route inconnue : réponses JSON.
  assert.equal((await call('PUT', '/v1/projets/X', '{"nom":')).body.code, 'JSON_INVALIDE');
  assert.equal((await call('PUT', '/v1/projets/X', undefined)).status, 415);
  assert.equal((await call('GET', '/v1/inconnue')).body.code, 'ROUTE_INCONNUE');
});

test('projet : création, envoi identique, mise à jour, archivage, contrôles', async () => {
  const { call, db, appels } = await fresh(false);
  let r = await call('PUT', '/v1/projets/K-9001', { nom: 'Arrêt technique' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { resultat: 'cree', projet: { code: 'K-9001', nom: 'Arrêt technique', statut: 'actif' } });
  r = await call('PUT', '/v1/projets/K-9001', { code: 'K-9001', nom: 'Arrêt technique' });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultat, 'inchange');
  r = await call('PUT', '/v1/projets/K-9001', { nom: 'Arrêt technique 2026' });
  assert.equal(r.body.resultat, 'modifie');
  r = await call('PUT', '/v1/projets/K-9001', { nom: 'Arrêt technique 2026', statut: 'archive' });
  assert.equal(r.body.projet.statut, 'archive');
  assert.equal(db.count('projets'), 1);
  r = await call('PUT', '/v1/projets/K-9002', { code: 'K-9003', nom: '', statut: 'ferme' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'VALIDATION');
  assert.deepEqual(r.body.details.map((x: Corps) => x.champ), ['code', 'nom', 'statut']);
  assert.equal((await call('PUT', '/v1/projets/K%209002', { nom: 'x' })).body.details[0].champ, 'code');
  assert.equal(db.count('projets'), 1);
  assert.deepEqual(appels().map(j => j.payload.statut), [201, 200, 200, 200, 400, 400]);
  assert.match(appels()[0].message, /^PUT \/v1\/projets\/K-9001 → 201 · cree · réf\. K-9001$/);
  assert.match(appels()[4].message, /VALIDATION \(code, nom, statut\)/);
});

test('chantier créé par l’API : Go / No Go v1 normalisé, ancienne route inchangée, archivage', async () => {
  const { call, db } = await fresh();
  assert.equal((await call('GET', '/v1/chantiers/K-3001/go-no-go')).status, 404);
  let r = await call('PUT', '/v1/chantiers/K-3001', CHANTIER);
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.chantier.ressources, []);
  assert.equal((await call('PUT', '/v1/chantiers/K-3001', CHANTIER)).body.resultat, 'inchange');
  r = await call('GET', '/v1/chantiers/K-3001/go-no-go');
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.body, evalue_le: null }, { chantier: 'K-3001', evalue_le: null, statut: 'GO', ressources: [] });

  // Mehdi Benali (EMP-0002) : SST valide, pas d'habilitation ATEX.
  r = await call('PUT', '/v1/affectations/AF-3001-2', { matricule: 'EMP-0002', chantier: 'K-3001', du: '2026-11-16', au: '2026-11-20' });
  assert.equal(r.status, 201);
  assert.equal(r.body.affectation.ressource, true);
  r = await call('GET', '/v1/chantiers/K-3001/go-no-go');
  assert.equal(r.body.statut, 'NO_GO');
  assert.deepEqual(r.body.ressources, [{ matricule: 'EMP-0002', statut: 'NO_GO', motifs: [{ code: 'HABILITATION', niveau: 'NO_GO' }] }]);
  assert.ok(!Number.isNaN(Date.parse(r.body.evalue_le)));
  const ancienne = await call('GET', '/chantiers/K-3001/go-no-go');
  assert.deepEqual(ancienne.body.ressources[0].motifs, ['HABILITATION'], 'ancienne forme : codes simples');
  assert.equal(ancienne.headers.get('deprecation'), 'true');
  assert.match(ancienne.headers.get('link') ?? '', /\/v1\/chantiers\/\{id\}\/go-no-go>; rel="successor-version"/);
  // Partage détaillé : le libellé s'ajoute au code, la forme ne change pas.
  db.setSetting('app', { ...db.getSetting('app', {}), partageKeystone: 'detaille' });
  r = await call('GET', '/v1/chantiers/K-3001/go-no-go');
  assert.deepEqual(r.body.ressources[0].motifs, [{ code: 'HABILITATION', niveau: 'NO_GO', libelle: 'Habilitation ATEX — non détenue' }]);
  assert.ok(r.body.ressources[0].motifs.every((m: Corps) => CODES_MOTIF.includes(m.code)));

  // Exigences hors référentiel, dates incohérentes : 400 avec chaque champ.
  r = await call('PUT', '/v1/chantiers/K-3002', { ...CHANTIER, pays: 'France', debut: '2026-11-20', fin: '2026-11-16', habilitations: ['atex', 'plongee'], certifications: 'sst' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.details.map((x: Corps) => x.champ).sort(), ['certifications', 'fin', 'habilitations[1]', 'pays']);
  assert.equal(db.get('chantiers', 'K-3002'), undefined);

  // Archivé : plus de verdict, plus d'évaluation dans Cursus.
  r = await call('PUT', '/v1/chantiers/K-3001', { ...CHANTIER, statut: 'archive' });
  assert.equal(r.body.resultat, 'modifie');
  assert.equal((await call('GET', '/v1/chantiers/K-3001/go-no-go')).body.code, 'CHANTIER_ARCHIVE');
  assert.equal((await call('GET', '/v1/chantiers/K-3001/go-no-go')).status, 410);
  const d = new Domain(loadFull(db, RH));
  assert.ok(!d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).some(x => x.c.id === 'K-3001'));
  assert.equal((await call('PUT', '/v1/chantiers/K-3001', CHANTIER)).body.chantier.statut, 'actif', 'réactivé');
});

test('affectation : mission et ressource, hors des dates du chantier mission seule, suppression', async () => {
  const { call, db } = await fresh();
  await call('PUT', '/v1/chantiers/K-3001', CHANTIER);
  const ressources = () => db.get<{ ressources: number[] }>('chantiers', 'K-3001')!.ressources;
  const aff = { matricule: 'EMP-0002', chantier: 'K-3001', du: '2026-11-16', au: '2026-11-18' };
  assert.equal((await call('PUT', '/v1/affectations/AF-1', aff)).status, 201);
  assert.equal((await call('PUT', '/v1/affectations/AF-2', { ...aff, matricule: 'EMP-0003' })).status, 201);
  assert.deepEqual(ressources(), [2, 3]);
  const m = db.where<Corps>('missions', 'ref', 'AF-1')[0];
  assert.deepEqual([m.empId, m.projet, m.lieu, m.type, m.du, m.au], [2, 'K-3001', 'Feyzin', 'Mission', '2026-11-16', '2026-11-18']);
  assert.equal((await call('PUT', '/v1/affectations/AF-1', aff)).body.resultat, 'inchange');
  // Repérage avant le chantier : mission conservée, hors du Go / No Go.
  let r = await call('PUT', '/v1/affectations/AF-1', { ...aff, du: '2026-11-02', au: '2026-11-03' });
  assert.equal(r.body.resultat, 'modifie');
  assert.equal(r.body.affectation.ressource, false);
  assert.deepEqual(ressources(), [3]);
  // Les dates du chantier s'élargissent : la ressource revient ; son lieu change : les missions suivent.
  await call('PUT', '/v1/chantiers/K-3001', { ...CHANTIER, debut: '2026-11-02', lieu: 'Lavéra', pays: 'FR' });
  assert.deepEqual(ressources(), [2, 3]);
  assert.equal(db.where<Corps>('missions', 'ref', 'AF-2')[0].lieu, 'Lavéra');
  assert.equal((await call('DELETE', '/v1/affectations/AF-1')).body.resultat, 'supprime');
  assert.deepEqual(ressources(), [3]);
  r = await call('DELETE', '/v1/affectations/AF-1');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'AFFECTATION_INCONNUE');
  // Contrôles.
  r = await call('PUT', '/v1/affectations/AF-3', { matricule: 'EMP-9999', chantier: 'K-0000', du: '2026-02-31', au: '2026-01-01' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.details, [
    { champ: 'matricule', message: 'Matricule inconnu de Cursus' },
    { champ: 'chantier', message: 'Chantier inconnu : transmettez-le d’abord (PUT /chantiers/{id})' },
    { champ: 'du', message: 'Date invalide (AAAA-MM-JJ, date existante)' },
  ]);
  r = await call('PUT', '/v1/affectations/AF-3', { ...aff, au: '2026-11-15' });
  assert.deepEqual(r.body.details, [{ champ: 'au', message: 'Antérieure à du' }]);
  assert.equal(db.where('missions', 'ref', 'AF-3').length, 0);
});

test('tâches planifiées : heures par jour, contrôles, proposition limitée à la semaine affichée', async () => {
  const { call, db, run, domain } = await fresh();
  await call('PUT', '/v1/projets/K-9001', { nom: 'Arrêt technique' });
  const tache = { projet: 'K-9001', tache: 'Préparation arrêt', matricule: 'EMP-0002', debut: '2026-10-14', fin: '2026-10-23', heures: { '2026-10-14': 2, '2026-10-15': 2, '2026-10-16': 1.5, '2026-10-17': 4, '2026-10-21': 3 } };
  let r = await call('PUT', '/v1/taches/T-1', tache);
  assert.equal(r.status, 201);
  assert.equal(r.body.tache.matricule, 'EMP-0002');
  assert.equal((await call('PUT', '/v1/taches/T-1', tache)).body.resultat, 'inchange');
  r = await call('PUT', '/v1/taches/T-2', { ...tache, projet: 'K-0000', heures: { '2026-10-13': 2, '2026-10-30': 2, '2026-10-15': 25, '2026-02-30': 1 } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.details.map((x: Corps) => x.champ), ['projet', 'heures.2026-02-30', 'heures.2026-10-13', 'heures.2026-10-15', 'heures.2026-10-30']);

  // Semaine 42 de Mehdi : ses deux tâches du planning de démonstration, plus la nouvelle du mercredi au samedi
  // (semaine à 7 jours : le samedi est proposé comme les autres jours).
  const lignes = (empId: number, w: string) => suggestLines(domain(), domain().emp(empId)!, w).map(l => [l.projet, l.tache, l.h]);
  assert.deepEqual(lignes(2, '2026-10-12'), [
    ['INT-MAINT', 'Maintenance préventive', [8, 8, 8, 0, 0, 0, 0]],
    ['K-2620', 'Repérage site Feyzin', [0, 0, 0, 8, 7, 0, 0]],
    ['K-9001', 'Préparation arrêt', [0, 0, 2, 2, 1.5, 4, 0]],
  ]);
  assert.deepEqual(lignes(2, '2026-10-19').at(-1), ['K-9001', 'Préparation arrêt', [0, 0, 3, 0, 0, 0, 0]]);
  assert.ok(!lignes(2, '2026-10-05').some(l => l[0] === 'K-9001'), 'avant le début de la tâche : rien');
  assert.ok(!lignes(2, '2026-10-26').some(l => l[0] === 'K-9001'), 'après la fin : rien');
  // Le repérage s'arrête le 16 octobre ; la maintenance passe à la semaine complète.
  assert.deepEqual(lignes(2, '2026-10-26'), [['INT-MAINT', 'Maintenance préventive', [8, 8, 8, 8, 7, 0, 0]]]);
  // Pendant son affectation à Feyzin, Sophie Lemaire (3) n'est planifiée que sur le chantier.
  assert.deepEqual(lignes(3, '2026-10-19'), [['K-2620', 'Intervention sur site', [8, 8, 8, 8, 7, 0, 0]]]);
  assert.deepEqual(lignes(3, '2026-10-12'), [['INT-PROD', 'Encadrement ligne 2', [8, 8, 8, 8, 7, 0, 0]]]);
  // Le 11 novembre est férié : zéro proposé.
  assert.deepEqual(lignes(1, '2026-11-09'), [['INT-LOG', 'Réception / expédition', [7, 7, 0, 7, 7, 0, 0]]]);

  // Rien de planifié : la proposition est refusée, la feuille n'est pas vidée.
  assert.throws(() => run(RH, 'temps.suggest', { empId: 2, week: '2027-03-01' }), /Aucune tâche Keystone planifiée/);
  assert.equal(loadFull(db, RH).feuilles.some(f => f.empId === 2 && f.week === '2027-03-01'), false);
  run(RH, 'temps.suggest', { empId: 2, week: '2026-10-12' });
  assert.equal(loadFull(db, RH).feuilles.find(f => f.empId === 2 && f.week === '2026-10-12')!.lignes.length, 3);

  // Navigateur : seules les semaines proches d'aujourd'hui (8 avant, 8 après) ; le serveur garde tout le planning.
  await call('PUT', '/v1/taches/T-LOIN', { ...tache, debut: '2027-02-01', fin: '2027-02-05', heures: { '2027-02-01': 8, '2027-02-02': 8 } });
  await call('PUT', '/v1/taches/T-BORD', { ...tache, debut: '2026-11-30', fin: '2026-12-11', heures: { '2026-12-04': 4, '2026-12-07': 6 } });
  const envoyees = buildSnapshot(db, RH).taches;
  assert.ok(!envoyees.some(t => t.ref === 'T-LOIN'), 'tâche lointaine non envoyée');
  assert.deepEqual(envoyees.find(t => t.ref === 'T-BORD')!.heures, { '2026-12-04': 4 }, 'heures au-delà du 6 décembre retirées');
  assert.deepEqual(envoyees.find(t => t.ref === 'T-1')!.heures, tache.heures);
  assert.ok(loadFull(db, RH).taches.some(t => t.ref === 'T-LOIN'));
  assert.deepEqual(lignes(2, '2027-02-01').at(-1), ['K-9001', 'Préparation arrêt', [8, 8, 0, 0, 0, 0, 0]], 'temps.suggest lit tout le planning');
  await call('DELETE', '/v1/taches/T-LOIN');
  await call('DELETE', '/v1/taches/T-BORD');

  // Projet archivé : plus d'imputation manuelle, ni de proposition depuis ses tâches.
  await call('PUT', '/v1/projets/K-9001', { nom: 'Arrêt technique', statut: 'archive' });
  assert.throws(() => run(RH, 'temps.addLine', { empId: 2, week: '2026-10-19', projet: 'K-9001' }), /Projet clos dans Keystone/);
  assert.ok(!tachesDeLaSemaine(domain(), 2, '2026-10-19').some(t => t.projet === 'K-9001'));
  run(RH, 'temps.suggest', { empId: 2, week: '2026-10-19' });
  assert.ok(!loadFull(db, RH).feuilles.find(f => f.empId === 2 && f.week === '2026-10-19')!.lignes.some(l => l.projet === 'K-9001'));

  assert.equal((await call('DELETE', '/v1/taches/T-1')).body.resultat, 'supprime');
  assert.equal((await call('DELETE', '/v1/taches/T-1')).body.code, 'TACHE_INCONNUE');
});

test('instantané : création, archivage, suppression bornée par « depuis », tout ou rien', async () => {
  const { call, db } = await fresh();
  const missions = () => db.all<Corps>('missions').length;
  const avant = { missions: missions(), taches: db.count('taches') };
  const chantier = { id: 'K-2614', nom: 'Rétrofit presse hydraulique', client: 'Atlas Emboutissage', lieu: 'Tanger', pays: 'MA', debut: '2026-10-27', fin: '2026-11-06', chef: 'Karim Haddad', habilitations: ['he', 'hauteur'], certifications: ['sst'] };
  // Instantané invalide : rien n'est écrit, chaque faute est signalée par son chemin.
  let r = await call('PUT', '/v1/instantane', {
    chantiers: [chantier, { ...chantier, id: 'K-4000', fin: '2026-10-01' }, chantier],
    affectations: [{ id: 'AF-X', matricule: 'EMP-0018', chantier: 'K-9999', du: '2026-10-27', au: '2026-11-06' }],
  });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.details.map((x: Corps) => x.champ), ['chantiers[1].fin', 'chantiers[2].id', 'affectations[0].chantier']);
  assert.equal(db.all<Corps>('chantiers').filter(c => c.statut === 'archive').length, 1, 'aucun archivage');
  assert.equal(missions(), avant.missions);
  assert.equal((await call('PUT', '/v1/instantane', { depuis: '2026-13-01' })).body.details[0].champ, 'depuis');
  assert.equal((await call('PUT', '/v1/instantane', {})).status, 400);

  // Instantané valide : K-2614 et K-4000 restent actifs, les autres sont archivés ; seules les trois affectations
  // de K-2614 restent, avec celles terminées avant le 10 octobre ; les tâches, non transmises, ne changent pas.
  const affectations = [18, 6, 12].map(e => ({ id: `AF-K-2614-${e}`, matricule: `EMP-${String(e).padStart(4, '0')}`, chantier: 'K-2614', du: '2026-10-27', au: '2026-11-06' }));
  affectations[2].au = '2026-11-04';
  r = await call('PUT', '/v1/instantane', { depuis: '2026-10-10', chantiers: [chantier, { ...chantier, id: 'K-4000', nom: 'Nouveau chantier' }], affectations });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.bilan, {
    chantiers: { crees: 1, modifies: 0, inchanges: 1, archives: 4 },
    affectations: { crees: 0, modifies: 1, inchanges: 2, supprimes: 9 },
  });
  assert.deepEqual(db.all<Corps>('chantiers').filter(c => c.statut === 'actif').map(c => c.id).sort(), ['K-2614', 'K-4000']);
  // Les missions terminées avant le 10 octobre (Grenoble, repérage de Feyzin) sont conservées.
  assert.deepEqual(db.all<Corps>('missions').map(m => m.ref).sort(), ['AF-K-2614-12', 'AF-K-2614-18', 'AF-K-2614-6', 'AF-K-2620-2', 'AF-K-2633-6']);
  assert.equal(db.count('taches'), avant.taches);
  assert.deepEqual(db.get<Corps>('chantiers', 'K-2614')!.ressources, [18, 6, 12]);
  // Même instantané renvoyé : rien ne change.
  r = await call('PUT', '/v1/instantane', { depuis: '2026-10-10', chantiers: [chantier, { ...chantier, id: 'K-4000', nom: 'Nouveau chantier' }], affectations });
  assert.deepEqual(r.body.bilan.affectations, { crees: 0, modifies: 0, inchanges: 3, supprimes: 0 });
  // Sections projets et tâches : projets absents archivés (jamais supprimés), sauf les activités internes
  // (INT-*, ECOLE) ; tâches absentes supprimées.
  r = await call('PUT', '/v1/instantane', {
    projets: [{ code: 'K-2614', nom: 'Rétrofit presse hydraulique' }],
    taches: [{ id: 'KT-18-1', projet: 'K-2614', tache: 'Rétrofit — circuit hydraulique', matricule: 'EMP-0018', debut: '2026-10-26', fin: '2026-10-27', heures: { '2026-10-26': 8, '2026-10-27': 8 } }],
  });
  assert.equal(r.body.bilan.projets.archives, 5);
  const internes = db.all<Corps>('projets').filter(p => ACTIVITES_INTERNES.test(p.code));
  assert.deepEqual([internes.length, internes.every(p => p.statut === 'actif')], [9, true], 'activités internes toujours imputables');
  assert.equal(r.body.bilan.taches.modifies, 1);
  assert.equal(db.count('taches'), 1);
  assert.equal(db.count('projets'), 15);
});

test('demandes : contrôles 400, doublons 409, hors affectation, ancienne route, journal sans donnée personnelle', async () => {
  const { call, db, appels } = await fresh();
  const dm = { reference: 'DK-T-1', matricule: 'EMP-0018', chantier: 'K-2614', depart: '2026-10-26', retour: '2026-11-07' };
  let r = await call('POST', '/v1/demandes', dm);
  assert.equal(r.status, 201);
  assert.deepEqual({ ...r.body.demande, id: 0 }, { id: 0, reference: 'DK-T-1', matricule: 'EMP-0018', chantier: 'K-2614', destination: 'MA', depart: '2026-10-26', retour: '2026-11-07', statut: 'en_attente_rh', recue: '2026-10-10', decidee: null });
  // Réessai : 409 avec la demande enregistrée ; même demande sous une autre référence : 409 aussi.
  r = await call('POST', '/v1/demandes', dm);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'DEMANDE_EN_DOUBLE');
  assert.equal(r.body.demande.reference, 'DK-T-1');
  r = await call('POST', '/v1/demandes', { ...dm, reference: 'DK-T-2' });
  assert.equal(r.status, 409);
  assert.equal(r.body.demande.reference, 'DK-T-1');
  const n = db.count('demandesKeystone');

  const refus = async (corps: Corps, champs: string[], motif?: RegExp) => {
    const x = await call('POST', '/v1/demandes', { ...dm, reference: `DK-R-${champs.join('-')}`, ...corps });
    assert.equal(x.status, 400, JSON.stringify(corps));
    assert.deepEqual(x.body.details.map((d: Corps) => d.champ), champs, JSON.stringify(x.body));
    if (motif) assert.match(x.body.details.map((d: Corps) => d.message).join(' '), motif);
  };
  await refus({ depart: '2026-02-31' }, ['depart'], /date existante/);
  await refus({ depart: '2026-11-08' }, ['retour'], /Antérieure à depart/);
  await refus({ reference: undefined }, ['reference']);
  await refus({ reference: 'réf avec espaces' }, ['reference']);
  await refus({ matricule: 'EMP-0001' }, ['matricule'], /non affecté au chantier/);
  await refus({ depart: '2026-12-01', retour: '2026-12-04' }, ['matricule'], /non affecté au chantier sur ces dates/);
  await refus({ destination: 'IN' }, ['destination'], /pays du chantier/);
  await refus({ chantier: 'K-2633', matricule: 'EMP-0006', depart: '2026-10-06', retour: '2026-10-08' }, ['chantier', 'destination', 'retour'], /archivé/);
  await refus({ chantier: 'K-0000' }, ['chantier']);
  assert.equal(db.count('demandesKeystone'), n, 'aucune demande refusée n’est enregistrée');

  // Ancienne route : référence facultative, réponse inchangée, en-têtes d'obsolescence.
  r = await call('POST', '/demandes', { matricule: 'EMP-0012', chantier: 'K-2611', destination: 'CI', depart: '2026-11-09', retour: '2026-11-27' });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body), ['id', 'statut']);
  assert.equal(r.body.statut, 'en_attente_rh');
  assert.equal(r.headers.get('deprecation'), 'true');
  assert.equal((await call('POST', '/demandes', { matricule: 'EMP-0012', chantier: 'K-2611', depart: '2026-11-09', retour: '2026-11-27' })).status, 409);
  assert.equal((await call('GET', '/v1/demandes/DK-T-1')).body.demande.statut, 'en_attente_rh');
  assert.equal((await call('GET', '/v1/demandes/DK-INCONNUE')).body.code, 'DEMANDE_INCONNUE');

  // Journal : route, statut, référence ; ni matricule, ni dates, ni destination.
  const j = appels().filter(x => x.payload.chemin.endsWith('/demandes'));
  assert.equal(j.length, 14);
  assert.deepEqual(j.slice(0, 3).map(x => [x.payload.statut, x.payload.reference]), [[201, 'DK-T-1'], [409, 'DK-T-1'], [409, 'DK-T-2']]);
  assert.match(j[3].message, /^POST \/v1\/demandes → 400 · VALIDATION \(depart\) · réf\. DK-R-depart$/);
  assert.equal(j.at(-2)!.payload.version, 'obsolete');
  const texte = JSON.stringify(j);
  for (const perso of ['EMP-0018', 'EMP-0012', '2026-10-26', 'CI']) assert.ok(!texte.includes(perso), perso);
});

test('journal des appels : ni clé de l’objet heures, ni identifiant mal formé, longueur bornée', async () => {
  const { call, appels } = await fresh();
  await call('PUT', '/v1/projets/K-9001', { nom: 'Arrêt technique' });
  const heures = { [`EMP-0018 arrêt maladie ${'x'.repeat(5000)}`]: 8, '2026-10-20': 8, 'a.b.maladie': 1 };
  let r = await call('PUT', '/v1/taches/T-1', { projet: 'K-9001', tache: 'Préparation', matricule: 'EMP-0002', debut: '2026-10-14', fin: '2026-10-16', heures });
  assert.equal(r.status, 400);
  assert.equal(r.body.details.length, 3, 'le détail complet reste dans la réponse à Keystone');
  r = await call('GET', `/v1/chantiers/${'Z'.repeat(3000)}/go-no-go`);
  assert.equal(r.status, 404);
  r = await call('GET', `/v1/chantiers/${encodeURIComponent('EMP-0018 maladie')}/go-no-go`);
  assert.equal(r.status, 404);
  const j = appels().slice(-3);
  assert.deepEqual(j.map(x => x.message), [
    'PUT /v1/taches/T-1 → 400 · VALIDATION (heures.<date>, heures.<clé invalide>) · réf. T-1',
    'GET /v1/chantiers/…/go-no-go → 404 · CHANTIER_INCONNU',
    'GET /v1/chantiers/…/go-no-go → 404 · CHANTIER_INCONNU',
  ]);
  assert.deepEqual(j.map(x => x.payload.reference), ['T-1', null, null]);
  const texte = JSON.stringify(j);
  for (const perso of ['maladie', 'EMP-0018', 'ZZZZ', '2026-10-20']) assert.ok(!texte.includes(perso), perso);
});

test('décision du RH : demande conservée (statut, date, décideur), revalidée à l’acceptation', async () => {
  const { call, run, db, domain } = await fresh();
  const dem = (ref: string) => loadFull(db, RH).demandesKeystone.find(x => x.ref === ref)!;
  /** Motif « déplacement » d'une ressource dans le Go / No Go. */
  const motif = (chantier: string, empId: number) => {
    const d = domain();
    return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === chantier)!.res.find(r => r.e.id === empId)!
      .reasons.filter(x => x.code === 'DEPLACEMENT').map(x => x.minimal);
  };
  // Refus : la demande reste, avec sa décision ; le Go / No Go ne la compte plus en attente.
  assert.deepEqual(motif('K-2614', 6), ['Déplacement en attente de validation RH']);
  run(RH, 'keystone.refuser', { id: dem('DK-2026-0398').id });
  assert.deepEqual([dem('DK-2026-0398').statut, dem('DK-2026-0398').decidee, dem('DK-2026-0398').decideur], ['refusee', '2026-10-10', 'Sandrine Vidal']);
  assert.deepEqual(motif('K-2614', 6), ['Déplacement à créer']);
  assert.equal((await call('GET', '/v1/demandes/DK-2026-0398')).body.demande.statut, 'refusee');
  assert.throws(() => run(RH, 'keystone.accepter', { id: dem('DK-2026-0398').id }), (e: unknown) => e instanceof ActionError && e.status === 409 && /déjà refusée par Sandrine Vidal/.test(e.message));
  // Affectation retirée dans Keystone depuis la réception : acceptation refusée, demande intacte.
  await call('DELETE', '/v1/affectations/AF-K-2611-18');
  assert.throws(() => run(RH, 'keystone.accepter', { id: dem('DK-2026-0412').id }), /Acceptation impossible — Salarié non affecté au chantier sur ces dates/);
  assert.equal(dem('DK-2026-0412').statut, 'attente');
  assert.equal(db.all<Corps>('voyages').filter(v => v.chantier === 'K-2611' && v.empId === 18).length, 0);
  // Réaffecté : acceptée, déplacement rattaché au chantier avec la référence Keystone.
  await call('PUT', '/v1/affectations/AF-K-2611-18', { matricule: 'EMP-0018', chantier: 'K-2611', du: '2026-11-09', au: '2026-11-27' });
  const out = run(RH, 'keystone.accepter', { id: dem('DK-2026-0412').id }) as { result: { id: number } };
  const v = db.get<Corps>('voyages', out.result.id)!;
  assert.deepEqual([v.chantier, v.ref, v.origine], ['K-2611', 'DK-2026-0412', 'keystone']);
  assert.deepEqual([dem('DK-2026-0412').statut, dem('DK-2026-0412').voyageId], ['acceptee', v.id]);
  assert.ok(domain().chantier('K-2611')!.ressources.includes(18));
  const ev = db.all<Corps>('journal').filter(j => j.action === 'keystone.demande.decision').map(j => j.payload);
  assert.deepEqual(ev.map(e => [e.reference, e.decision]), [['DK-2026-0398', 'refusee'], ['DK-2026-0412', 'acceptee']]);
  // Karim Haddad a déjà son déplacement pour Abidjan : une nouvelle demande sur ces dates ne peut pas être acceptée.
  assert.equal((await call('POST', '/v1/demandes', { reference: 'DK-T-9', matricule: 'EMP-0012', chantier: 'K-2611', depart: '2026-11-09', retour: '2026-11-27' })).status, 201);
  assert.throws(() => run(RH, 'keystone.accepter', { id: dem('DK-T-9').id }), /Un déplacement existe déjà pour ce chantier/);
  // Les demandes décidées ne sont transmises qu'au RH, comme avant.
  assert.equal(buildSnapshot(db, { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' }).demandesKeystone.length, 0);
});

test('contrat OpenAPI : servi, conforme aux routes, aux codes de motif et aux codes d’erreur', async () => {
  const { call } = await fresh(false);
  const r = await call('GET', '/v1/openapi.json');
  assert.equal(r.status, 200);
  const spec = r.body;
  assert.equal(spec.openapi, '3.1.0');
  assert.deepEqual(spec, JSON.parse(readFileSync(join(ROOT, 'docs/keystone-openapi.json'), 'utf8')));
  const v1 = Object.entries(spec.paths as Record<string, Corps>).filter(([p]) => p.startsWith('/v1/'))
    .flatMap(([p, ops]) => Object.keys(ops).map(m => `${m} ${p.slice(3)}`));
  assert.deepEqual(v1.sort(), ROUTES_V1.map(([m, p]) => `${m} ${p}`).sort());
  const anciennes = Object.entries(spec.paths as Record<string, Corps>).filter(([p]) => !p.startsWith('/v1/'));
  assert.ok(anciennes.length === 2 && anciennes.every(([, ops]) => Object.values(ops).every((o: Corps) => o.deprecated === true)));
  assert.deepEqual(spec.components.schemas.CodeMotif.enum, [...CODES_MOTIF]);
  const sources = ['keystone-entrant.ts', 'keystone-routes.ts'].map(f => readFileSync(join(ROOT, 'server/src/integrations', f), 'utf8')).join('\n');
  const codes = [...new Set([...sources.matchAll(/new ErreurKeystone\([^,]+, '([A-Z_]+)'/g)].map(m => m[1]))];
  assert.deepEqual(codes.filter(c => !spec.components.schemas.CodeErreur.enum.includes(c)), []);
  assert.deepEqual(spec.components.schemas.CodeErreur.enum.filter((c: string) => !codes.includes(c)), []);
  // Référentiels : codes admis pour les exigences d'un chantier.
  const ref = (await (await fresh()).call('GET', '/v1/referentiels')).body;
  assert.ok(ref.habilitations.some((h: Corps) => h.code === 'atex') && ref.certifications.some((c: Corps) => c.code === 'sst'));
  assert.deepEqual(ref.destinations[0], { code: 'MA', pays: 'Maroc', archive: null });
});

test('base existante : statuts repris, tâches sans dates retirées, index d’unicité', async () => {
  const { migrerKeystone } = await import('../server/src/integrations/keystone-entrant.ts');
  const db = new Db(':memory:');
  db.insert('chantiers', { id: 'K-1', nom: 'x', client: '', lieu: 'Lyon', pays: 'FR', debut: '2026-10-01', fin: '2026-10-02', chef: '', habs: [], certs: [], ressources: [] });
  db.insert('projets', { code: 'K-1', nom: 'x' });
  db.insert('demandesKeystone', { empId: 1, chantier: 'K-1', dest: 'MA', depart: '2026-11-01', retour: '2026-11-02', recue: '2026-10-01' });
  db.sql.prepare('INSERT INTO taches (emp_id, projet, tache, heures) VALUES (1, ?, ?, ?)').run('K-1', 'Ancienne tâche', '[7,7,7,7,7]');
  let sauvegardes = 0;
  migrerKeystone(db, () => { sauvegardes++; });
  assert.equal(sauvegardes, 1);
  assert.equal(db.get<Corps>('chantiers', 'K-1')!.statut, 'actif');
  assert.equal(db.get<Corps>('projets', 'K-1')!.statut, 'actif');
  assert.equal(db.all<Corps>('demandesKeystone')[0].statut, 'attente');
  assert.equal(db.count('taches'), 0);
  migrerKeystone(db, () => { sauvegardes++; });
  assert.equal(sauvegardes, 1, 'rien à reprendre au démarrage suivant');
  // Index d'unicité des références : migration nommée, appliquée au démarrage après la reprise (server/src/migrations/).
  const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
  appliquerMigrations(db);
  db.insert('missions', { empId: 1, projet: 'K-1', lieu: 'Lyon', du: '2026-10-01', au: '2026-10-02', type: 'Mission', ref: 'AF-1' });
  assert.throws(() => db.insert('missions', { empId: 2, projet: 'K-1', lieu: 'Lyon', du: '2026-10-01', au: '2026-10-02', type: 'Mission', ref: 'AF-1' }), /UNIQUE/);
});

// — Production : base vide, alimentée par l'API seule —

test('production : base vide alimentée par l’API, Go / No Go servi, appels tracés', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-keystone-'));
  const fichier = join(dir, 'cursus.db');
  // Seuls le salarié et les référentiels existent (saisis dans Cursus) ; rien ne vient du jeu de démonstration.
  const base = new Db(fichier);
  base.insert('habilitations', { id: 'atex', nom: 'Intervention en zone ATEX', detail: '', prereqs: ['atex'], medical: true, validite: 36, signataire: 'x' });
  base.insert('formations', { id: 'atex', nom: 'Intervention en zone ATEX (niveau 1)', court: 'ATEX', type: 'Réglementaire', validite: 36, duree: '7 h', organisme: 'Apave', cout: 350 });
  base.insert('employes', { id: 1, nom: 'Salarié Un', equipe: null, poste: 'Technicien', statut: 'technicien', typeContrat: 'cdi', temps: '35h', jourOff: [], entree: '2020-01-06', naissance: 1985 });
  base.sql.close();
  const port = await new Promise<number>(res => { const s = express().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => res(p)); }); });
  const p: ChildProcess = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', CURSUS_SECRET: 'x'.repeat(32), KEYSTONE_API_KEY: CLE, CURSUS_API_PORT: String(port), CURSUS_DB: fichier },
  });
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  fermer.push(() => { p.kill(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise<void>((res, rej) => {
    const t = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(t); res(); } }, 20);
    p.on('exit', code => { clearInterval(t); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  const url = `http://127.0.0.1:${port}/api/integrations/keystone/v1`;
  const put = (path: string, body: unknown) => fetch(url + path, { method: 'PUT', headers: { 'x-api-key': CLE, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${url}/chantiers/K-1/go-no-go`, { headers: { 'x-api-key': CLE } })).status, 404, 'rien avant l’API');
  assert.equal((await put('/projets/K-1', { nom: 'Arrêt ATEX' })).status, 201);
  assert.equal((await put('/chantiers/K-1', { nom: 'Arrêt ATEX', lieu: 'Feyzin', pays: 'FR', debut: '2026-11-16', fin: '2026-11-20', habilitations: ['atex'] })).status, 201);
  assert.equal((await put('/affectations/AF-1', { matricule: 'EMP-0001', chantier: 'K-1', du: '2026-11-16', au: '2026-11-20' })).status, 201);
  const r = await fetch(`${url}/chantiers/K-1/go-no-go`, { headers: { 'x-api-key': CLE } });
  assert.equal(r.status, 200);
  const v = await r.json() as Corps;
  // Aucune visite médicale enregistrée : réserve (APTITUDE), sans autre détail.
  assert.deepEqual(v.ressources, [{ matricule: 'EMP-0001', statut: 'NO_GO', motifs: [{ code: 'APTITUDE', niveau: 'GO_RESERVE' }, { code: 'HABILITATION', niveau: 'NO_GO' }] }]);
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/, 'en-têtes de sécurité');
  const journal = new Db(fichier).all<{ action: string; message: string }>('journal').filter(j => j.action === 'keystone.appel').map(j => j.message);
  assert.deepEqual(journal.map(m => m.split(' · ')[0]), [
    'GET /v1/chantiers/K-1/go-no-go → 404', 'PUT /v1/projets/K-1 → 201', 'PUT /v1/chantiers/K-1 → 201', 'PUT /v1/affectations/AF-1 → 201', 'GET /v1/chantiers/K-1/go-no-go → 200',
  ]);
});
