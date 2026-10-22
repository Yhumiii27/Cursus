// Documents déclarés par le collaborateur (passeport, visa, vaccination) : appliqués au dossier
// seulement après validation RH, contenu jamais transmis au manager.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { estAuDossier, retireeAuRefus, valeurActuelle } = await import('../shared/rules/formalites.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Db = InstanceType<typeof Db>;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const mgr = (empId: number): User => ({ role: 'manager', empId, nom: `#${empId}`, intitule: '' });
const collab = (empId: number): User => ({ role: 'collaborateur', empId, nom: `#${empId}`, intitule: '' });
// Mehdi Benali (2), équipe Maintenance de Karim Haddad (12) : passeport 20AB···91 jusqu'au 2 déc. 2026.
const MEHDI = 2, KARIM = 12;

function outils(db: Db) {
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
  const domain = async () => new Domain(await loadFull(db, RH));
  const emp = async (id: number) => (await domain()).emp(id)!;
  const docs = async (id = MEHDI) => (await domain()).ds.demandesCollab.filter(r => r.empId === id && r.type === 'document');
  const enAttente = async (id = MEHDI) => (await docs(id)).filter(r => r.statut === 'attente');
  return { db, run, domain, emp, docs, enAttente };
}
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  return outils(db);
}
const FAUX = { empId: MEHDI, kind: 'passeport', numero: 'FAUX123', expire: '2036-01-15' };
// Séjour en Inde : 6 mois de validité exigés après l'entrée, le passeport actuel ne suffit pas.
const INDE = { dest: 'IN', depart: '2026-11-16', retour: '2026-11-20' };
const passeportOk = async (d: InstanceType<typeof Domain>) => d.readiness((await d.emp(MEHDI))!, INDE).items.find(i => i.k === 'passeport')!.ok;

test('déclaration du collaborateur : dossier inchangé, demande en attente avec le détail', async () => {
  const { db, run, emp, enAttente, domain } = await fresh();
  const avant = await emp(MEHDI);
  const msg = await run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  assert.match(String(msg), /après validation/);
  assert.doesNotMatch(String(msg), /FAUX123/);
  const apres = await emp(MEHDI);
  assert.deepEqual(apres.passeport, { numero: '20AB···91', expire: '2026-12-02' });
  assert.ok(!await passeportOk(await domain()), 'la déclaration ne compte pas dans la préparation du voyage');
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'typhoide', date: '2026-10-01' });
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', obtenu: '2026-10-08', expire: '2027-10-07' });
  assert.deepEqual((await emp(MEHDI)).vaccins, avant.vaccins);
  assert.deepEqual((await emp(MEHDI)).visas, avant.visas);
  const dem = await enAttente();
  assert.equal(dem.length, 3);
  assert.deepEqual(dem.map(r => r.label), ['Passeport mis à jour', 'Vaccination Typhoïde déclarée', 'Visa Inde déclaré']);
  assert.deepEqual(dem[0].declaration, { kind: 'passeport', numero: 'FAUX123', expire: '2036-01-15' });
  assert.deepEqual(dem[2].declaration, { kind: 'visa', dest: 'IN', type: 'e-Visa d’affaires', obtenu: '2026-10-08', expire: '2027-10-07' });
  // Le collaborateur retrouve ses déclarations, avec leur contenu, dans son portail.
  const s = await buildSnapshot(db, collab(MEHDI));
  assert.deepEqual(s.demandesCollab.filter(r => r.type === 'document').map(r => r.declaration?.kind), ['passeport', 'vaccin', 'visa']);
  assert.deepEqual(s.employes[0].passeport, avant.passeport);
});

test('validation RH : la déclaration est revalidée puis appliquée', async () => {
  const { run, emp, enAttente, domain } = await fresh();
  await run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'typhoide', date: '2026-10-01' });
  const [pass, vac] = await enAttente();
  const msg = await run(RH, 'demande.accepter', { id: pass.id });
  assert.match(String(msg), /Passeport de Mehdi Benali enregistré/);
  assert.deepEqual((await emp(MEHDI)).passeport, { numero: 'FAUX123', expire: '2036-01-15' });
  assert.ok(await passeportOk(await domain()));
  await run(RH, 'demande.accepter', { id: vac.id });
  assert.ok((await emp(MEHDI)).vaccins.some(v => v.v === 'typhoide' && v.date === '2026-10-01'));
  const r = (await domain()).ds.demandesCollab.find(x => x.id === pass.id)!;
  assert.equal(r.statut, 'acceptee');
  assert.match(r.reponse!, /enregistrée dans votre dossier/);
  await assert.rejects(async () => await run(RH, 'demande.accepter', { id: pass.id }), /déjà traitée/);
});

test('refus RH : rien n’est appliqué, l’ancienne valeur reste intacte', async () => {
  const { run, emp, enAttente, domain } = await fresh();
  await run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'dtp', date: '2026-10-01' });
  for (const r of await enAttente()) await run(RH, 'demande.refuser', { id: r.id });
  const e = await emp(MEHDI);
  assert.deepEqual(e.passeport, { numero: '20AB···91', expire: '2026-12-02' });
  assert.deepEqual(e.vaccins.find(v => v.v === 'dtp')!.date, '2016-09-10');
  assert.ok(!await passeportOk(await domain()));
  const refusees = (await domain()).ds.demandesCollab.filter(r => r.empId === MEHDI && r.type === 'document' && r.statut === 'refusee');
  assert.equal(refusees.length, 2);
  assert.match(refusees[0].reponse!, /dossier n’a pas été modifié/);
  assert.ok(!JSON.stringify((await domain()).ds.employes).includes('FAUX123'), 'le passeport refusé n’est nulle part dans les dossiers');
});

test('saisie directe du RH : appliquée immédiatement, sans demande', async () => {
  const { run, emp, docs } = await fresh();
  const msg = await run(RH, 'formalite.enregistrer', { ...FAUX, numero: '26AB00001' });
  assert.match(String(msg), /enregistré — valide jusqu’au/);
  assert.deepEqual((await emp(MEHDI)).passeport, { numero: '26AB00001', expire: '2036-01-15' });
  await run(RH, 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', expire: '2027-10-07' });
  assert.equal((await emp(MEHDI)).visas.find(v => v.dest === 'IN')!.type, 'e-Visa d’affaires');
  assert.equal((await docs()).length, 0);
});

test('manager : ni la déclaration ni son contenu dans les données reçues', async () => {
  const { db, run } = await fresh();
  await run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'fj', date: '2026-09-03' });
  const s = await buildSnapshot(db, mgr(KARIM));
  assert.ok(s.employes.some(e => e.id === MEHDI), 'Mehdi fait partie de l’équipe');
  assert.ok(!s.demandesCollab.some(r => r.type === 'document' && r.empId !== KARIM));
  assert.ok(s.demandesCollab.every(r => r.empId === KARIM || r.declaration === null));
  const json = JSON.stringify(s);
  assert.ok(!json.includes('FAUX123') && !json.includes('2026-09-03'));
  // L'intéressé et le RH voient le détail.
  const mine = (await buildSnapshot(db, collab(MEHDI))).demandesCollab.filter(r => r.type === 'document');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].declaration?.kind === 'passeport' && mine[0].declaration.numero, 'FAUX123');
  assert.ok(JSON.stringify(await buildSnapshot(db, RH)).includes('FAUX123'));
  // Un collègue de la même équipe ne voit rien.
  assert.ok(!JSON.stringify(await buildSnapshot(db, collab(6))).includes('FAUX123'));
});

test('nouvelle déclaration du même document : remplace celle en attente', async () => {
  const { run, enAttente, emp } = await fresh();
  await run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  const premiere = (await enAttente())[0];
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', expire: '2027-10-07' });
  const msg = await run(collab(MEHDI), 'formalite.enregistrer', { ...FAUX, numero: '26XY45678' });
  assert.match(String(msg), /remplace la précédente/);
  const dem = await enAttente();
  assert.equal(dem.length, 2, 'un passeport et un visa en attente');
  const pass = dem.find(r => r.declaration?.kind === 'passeport')!;
  assert.equal(pass.declaration?.kind === 'passeport' && pass.declaration.numero, '26XY45678');
  // Le RH ne peut plus valider la déclaration remplacée, qu'il n'a peut-être pas revue.
  await assert.rejects(async () => await run(RH, 'demande.accepter', { id: premiere.id }), /introuvable/);
  await run(RH, 'demande.accepter', { id: pass.id });
  assert.equal((await emp(MEHDI)).passeport?.numero, '26XY45678');
});

test('déclaration devenue invalide : validation refusée, dossier intact', async () => {
  const { db, run, enAttente, emp } = await fresh();
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', expire: '2027-10-07' });
  const r = (await enAttente())[0];
  await db.update('demandesCollab', r.id, { declaration: { ...r.declaration, dest: 'ZZ' } }); // destination retirée du référentiel
  await assert.rejects(async () => await run(RH, 'demande.accepter', { id: r.id }), (e: unknown) => e instanceof ActionError && /Déclaration invalide/.test(e.message));
  assert.ok(!(await emp(MEHDI)).visas.some(v => v.dest === 'IN' || v.dest === 'ZZ'));
  assert.equal((await enAttente())[0].statut, 'attente');
});

test('saisies incomplètes et droits inchangés', async () => {
  const { run } = await fresh();
  await assert.rejects(async () => await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'passeport', numero: ' ', expire: '2030-01-01' }), /Numéro/);
  await assert.rejects(async () => await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: '__proto__', date: '2026-01-01' }), /Vaccin/);
  await assert.rejects(async () => await run(collab(MEHDI), 'formalite.enregistrer', { ...FAUX, empId: 6 }), (e: unknown) => e instanceof ActionError && e.status === 403);
  await assert.rejects(async () => await run(mgr(KARIM), 'formalite.enregistrer', FAUX), (e: unknown) => e instanceof ActionError && e.status === 403);
  await assert.rejects(async () => await run(collab(MEHDI), 'demande.accepter', { id: 1 }), (e: unknown) => e instanceof ActionError && e.status === 403);
});

// Ancienne base : pas de colonne `declaration`, formalités déjà écrites dans le dossier.
type Ancienne = [empId: number, label: string, statut?: string, date?: string, reponse?: string];
async function ancienneBase(dir: string, nom: string, demandes: Ancienne[]) {
  const file = join(dir, `${nom}.db`);
  const old = new Db(file);
  await seedDemo(old);
  await old.exec('DELETE FROM demandes_collab WHERE type = \'document\'');
  await old.exec('ALTER TABLE demandes_collab DROP COLUMN declaration');
  const ins = old.sql.prepare('INSERT INTO demandes_collab (emp_id, type, label, date, statut, reponse) VALUES (?, \'document\', ?, ?, ?, ?)');
  for (const [empId, label, statut = 'attente', date = '2026-10-01', reponse = null] of demandes) ins.run(empId, label, date, statut, reponse);
  old.sql.close();
  const db = new Db(file); // démarrage : la colonne est ajoutée
  await migrate(db);
  const o = outils(db);
  // Demandes « document » portant ce libellé, de la plus ancienne à la plus récente.
  const par = async (label: string, id = MEHDI) => (await o.docs(id)).filter(r => r.label === label);
  return { ...o, par };
}
async function dansDossierTemporaire(fn: (dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-documents-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('migration : demandes en attente d’une ancienne base reprises du dossier', async () => await dansDossierTemporaire(async dir => {
  const { db, run, emp, par } = await ancienneBase(dir, 'ancienne', [
    [MEHDI, 'Passeport mis à jour'],
    [MEHDI, 'Vaccination Hépatite A déclarée'],
    [9, 'Visa États-Unis déclaré'],
    [MEHDI, 'Vaccination DTP déclarée', 'acceptee', '2026-10-01', 'Document contrôlé par le service RH'],
    [MEHDI, 'Visa Inde déclaré', 'refusee', '2026-10-01', 'Refusée par le service RH'],
    [MEHDI, 'Document inconnu'],
  ]);
  await migrate(db); // sans effet la seconde fois
  const un = async (label: string, id = MEHDI) => (await par(label, id))[0];
  assert.deepEqual((await un('Passeport mis à jour')).declaration, { kind: 'passeport', numero: '20AB···91', expire: '2026-12-02', dejaAuDossier: true });
  assert.deepEqual((await un('Vaccination Hépatite A déclarée')).declaration, { kind: 'vaccin', v: 'hepA', date: '2022-03-11', dejaAuDossier: true });
  assert.deepEqual((await un('Visa États-Unis déclaré', 9)).declaration, { kind: 'visa', dest: 'US', type: 'ESTA', obtenu: '2024-11-03', expire: '2026-11-02', dejaAuDossier: true });
  // Les demandes déjà traitées et les libellés inconnus restent tels quels.
  assert.equal((await un('Vaccination DTP déclarée')).declaration, null);
  assert.equal((await un('Visa Inde déclaré')).statut, 'refusee');
  assert.equal((await un('Visa Inde déclaré')).declaration, null);
  assert.equal((await un('Document inconnu')).declaration, null);

  // Une nouvelle déclaration ne remplace pas une ancienne demande déjà au dossier.
  await run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  assert.ok((await un('Passeport mis à jour')).declaration?.dejaAuDossier);
  // Refus d'une ancienne déclaration : elle est retirée du dossier.
  await run(RH, 'demande.refuser', { id: (await un('Passeport mis à jour')).id });
  assert.equal((await emp(MEHDI)).passeport, null);
  // Validation d'une ancienne déclaration : le dossier n'est pas réécrit.
  await run(RH, 'demande.accepter', { id: (await un('Vaccination Hépatite A déclarée')).id });
  assert.ok((await emp(MEHDI)).vaccins.some(v => v.v === 'hepA' && v.date === '2022-03-11'));
  // Libellé inconnu : contrôle dans le dossier, comme avant.
  await run(RH, 'demande.accepter', { id: (await un('Document inconnu')).id });
  assert.equal((await un('Document inconnu')).statut, 'acceptee');
  db.sql.close();
}));

test('migration : deux demandes pour le même document, seule la plus récente reprend le contenu', async () => await dansDossierTemporaire(async dir => {
  // Faute de frappe corrigée : deux « Passeport mis à jour » en attente, le dossier ne garde que la dernière saisie.
  const doublon: Ancienne[] = [[MEHDI, 'Passeport mis à jour', 'attente', '2026-10-01'], [MEHDI, 'Passeport mis à jour', 'attente', '2026-10-02']];
  const a = await ancienneBase(dir, 'doublon-a', doublon);
  const [ancienne, recente] = await a.par('Passeport mis à jour');
  assert.equal(ancienne.declaration, null, 'la plus ancienne reste à contrôler dans le dossier');
  assert.deepEqual(recente.declaration, { kind: 'passeport', numero: '20AB···91', expire: '2026-12-02', dejaAuDossier: true });
  // Refuser la plus ancienne ne retire rien ; valider la plus récente confirme le passeport.
  assert.doesNotMatch(String(await a.run(RH, 'demande.refuser', { id: ancienne.id })), /retiré/);
  assert.deepEqual((await a.emp(MEHDI)).passeport, { numero: '20AB···91', expire: '2026-12-02' });
  assert.match((await a.par('Passeport mis à jour'))[0].reponse!, /dossier n’a pas été modifié/);
  await a.run(RH, 'demande.accepter', { id: recente.id });
  assert.deepEqual((await a.emp(MEHDI)).passeport, { numero: '20AB···91', expire: '2026-12-02' });
  assert.deepEqual((await a.par('Passeport mis à jour')).map(r => r.statut), ['refusee', 'acceptee']);
  a.db.sql.close();

  // Démarrage suivant : une fois la plus récente traitée, la plus ancienne ne reprend rien.
  const b = await ancienneBase(dir, 'doublon-b', doublon);
  await b.run(RH, 'demande.accepter', { id: (await b.par('Passeport mis à jour'))[1].id });
  await migrate(b.db);
  assert.equal((await b.par('Passeport mis à jour'))[0].declaration, null);
  await b.run(RH, 'demande.refuser', { id: (await b.par('Passeport mis à jour'))[0].id });
  assert.deepEqual((await b.emp(MEHDI)).passeport, { numero: '20AB···91', expire: '2026-12-02' });
  b.db.sql.close();
}));

test('migration : pièce validée par une autre demande, le refus de l’ancienne ne la retire pas', async () => await dansDossierTemporaire(async dir => {
  const { db, run, emp, par, domain } = await ancienneBase(dir, 'validee', [[MEHDI, 'Vaccination Hépatite A déclarée']]);
  const [ancienne] = await par('Vaccination Hépatite A déclarée');
  assert.ok(retireeAuRefus(await domain(), await emp(MEHDI), ancienne));
  // Le collaborateur redéclare la même injection : nouvelle demande, que le RH valide.
  await run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'hepA', date: '2022-03-11' });
  const nouvelle = (await par('Vaccination Hépatite A déclarée'))[1];
  assert.ok(nouvelle && !nouvelle.declaration?.dejaAuDossier);
  assert.match(String(await run(RH, 'demande.accepter', { id: nouvelle.id })), /déclaration validée/);
  // Le tableau de bord n'annonce plus de retrait, et le refus de l'ancienne laisse la pièce validée.
  assert.ok(!retireeAuRefus(await domain(), await emp(MEHDI), ancienne));
  assert.doesNotMatch(String(await run(RH, 'demande.refuser', { id: ancienne.id })), /retiré/);
  assert.ok((await emp(MEHDI)).vaccins.some(v => v.v === 'hepA' && v.date === '2022-03-11'));
  assert.match((await par('Vaccination Hépatite A déclarée'))[0].reponse!, /dossier n’a pas été modifié/);
  db.sql.close();
}));

test('migration : pièce reprise qui a changé depuis, traitée comme une déclaration ordinaire', async () => await dansDossierTemporaire(async dir => {
  const { db, run, emp, par, domain } = await ancienneBase(dir, 'changee', [[MEHDI, 'Passeport mis à jour'], [MEHDI, 'Vaccination Hépatite A déclarée']]);
  const [pass] = await par('Passeport mis à jour'), [hepA] = await par('Vaccination Hépatite A déclarée');
  // Nouveau passeport déclaré puis validé ; vaccination ressaisie par le RH.
  await run(collab(MEHDI), 'formalite.enregistrer', { ...FAUX, numero: '26XY45678' });
  await run(RH, 'demande.accepter', { id: (await par('Passeport mis à jour'))[1].id });
  await run(RH, 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'hepA', date: '2026-09-01' });
  const e = await emp(MEHDI);
  assert.ok(!estAuDossier(e, pass.declaration!) && !estAuDossier(e, hepA.declaration!));
  // Le tableau de bord montre la valeur actuelle au lieu d'annoncer un retrait.
  assert.ok(!retireeAuRefus(await domain(), e, pass) && !retireeAuRefus(await domain(), e, hepA));
  assert.match(valeurActuelle(await domain(), e, pass.declaration!), /^n° 26XY45678 · expire le /);
  // Refus : le passeport validé depuis reste en place.
  assert.doesNotMatch(String(await run(RH, 'demande.refuser', { id: pass.id })), /retiré/);
  assert.equal((await emp(MEHDI)).passeport?.numero, '26XY45678');
  // Validation : la pièce déclarée est réécrite, comme pour une déclaration ordinaire.
  await run(RH, 'demande.accepter', { id: hepA.id });
  assert.deepEqual((await emp(MEHDI)).vaccins.filter(v => v.v === 'hepA').map(v => v.date), ['2022-03-11']);
  assert.match((await par('Vaccination Hépatite A déclarée'))[0].reponse!, /enregistrée dans votre dossier/);
  db.sql.close();
}));
