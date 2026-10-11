// Documents déclarés par le collaborateur (passeport, visa, vaccination) : appliqués au dossier
// seulement après validation RH, contenu jamais transmis au manager.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Db = InstanceType<typeof Db>;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const mgr = (empId: number): User => ({ role: 'manager', empId, nom: `#${empId}`, intitule: '' });
const collab = (empId: number): User => ({ role: 'collaborateur', empId, nom: `#${empId}`, intitule: '' });
// Mehdi Benali (2), équipe Maintenance de Karim Haddad (12) : passeport 20AB···91 jusqu'au 2 déc. 2026.
const MEHDI = 2, KARIM = 12;

function outils(db: Db) {
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const domain = () => new Domain(loadFull(db, RH));
  const emp = (id: number) => domain().emp(id)!;
  const docs = (id = MEHDI) => domain().ds.demandesCollab.filter(r => r.empId === id && r.type === 'document');
  const enAttente = (id = MEHDI) => docs(id).filter(r => r.statut === 'attente');
  return { db, run, domain, emp, docs, enAttente };
}
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  return outils(db);
}
const FAUX = { empId: MEHDI, kind: 'passeport', numero: 'FAUX123', expire: '2036-01-15' };
// Séjour en Inde : 6 mois de validité exigés après l'entrée, le passeport actuel ne suffit pas.
const INDE = { dest: 'IN', depart: '2026-11-16', retour: '2026-11-20' };
const passeportOk = (d: InstanceType<typeof Domain>) => d.readiness(d.emp(MEHDI)!, INDE).items.find(i => i.k === 'passeport')!.ok;

test('déclaration du collaborateur : dossier inchangé, demande en attente avec le détail', () => {
  const { db, run, emp, enAttente, domain } = fresh();
  const avant = emp(MEHDI);
  const msg = run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  assert.match(String(msg), /après validation/);
  assert.doesNotMatch(String(msg), /FAUX123/);
  const apres = emp(MEHDI);
  assert.deepEqual(apres.passeport, { numero: '20AB···91', expire: '2026-12-02' });
  assert.ok(!passeportOk(domain()), 'la déclaration ne compte pas dans la préparation du voyage');
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'typhoide', date: '2026-10-01' });
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', obtenu: '2026-10-08', expire: '2027-10-07' });
  assert.deepEqual(emp(MEHDI).vaccins, avant.vaccins);
  assert.deepEqual(emp(MEHDI).visas, avant.visas);
  const dem = enAttente();
  assert.equal(dem.length, 3);
  assert.deepEqual(dem.map(r => r.label), ['Passeport mis à jour', 'Vaccination Typhoïde déclarée', 'Visa Inde déclaré']);
  assert.deepEqual(dem[0].declaration, { kind: 'passeport', numero: 'FAUX123', expire: '2036-01-15' });
  assert.deepEqual(dem[2].declaration, { kind: 'visa', dest: 'IN', type: 'e-Visa d’affaires', obtenu: '2026-10-08', expire: '2027-10-07' });
  // Le collaborateur retrouve ses déclarations, avec leur contenu, dans son portail.
  const s = buildSnapshot(db, collab(MEHDI));
  assert.deepEqual(s.demandesCollab.filter(r => r.type === 'document').map(r => r.declaration?.kind), ['passeport', 'vaccin', 'visa']);
  assert.deepEqual(s.employes[0].passeport, avant.passeport);
});

test('validation RH : la déclaration est revalidée puis appliquée', () => {
  const { run, emp, enAttente, domain } = fresh();
  run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'typhoide', date: '2026-10-01' });
  const [pass, vac] = enAttente();
  const msg = run(RH, 'demande.accepter', { id: pass.id });
  assert.match(String(msg), /Passeport de Mehdi Benali enregistré/);
  assert.deepEqual(emp(MEHDI).passeport, { numero: 'FAUX123', expire: '2036-01-15' });
  assert.ok(passeportOk(domain()));
  run(RH, 'demande.accepter', { id: vac.id });
  assert.ok(emp(MEHDI).vaccins.some(v => v.v === 'typhoide' && v.date === '2026-10-01'));
  const r = domain().ds.demandesCollab.find(x => x.id === pass.id)!;
  assert.equal(r.statut, 'acceptee');
  assert.match(r.reponse!, /enregistrée dans votre dossier/);
  assert.throws(() => run(RH, 'demande.accepter', { id: pass.id }), /déjà traitée/);
});

test('refus RH : rien n’est appliqué, l’ancienne valeur reste intacte', () => {
  const { run, emp, enAttente, domain } = fresh();
  run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'dtp', date: '2026-10-01' });
  for (const r of enAttente()) run(RH, 'demande.refuser', { id: r.id });
  const e = emp(MEHDI);
  assert.deepEqual(e.passeport, { numero: '20AB···91', expire: '2026-12-02' });
  assert.deepEqual(e.vaccins.find(v => v.v === 'dtp')!.date, '2016-09-10');
  assert.ok(!passeportOk(domain()));
  const refusees = domain().ds.demandesCollab.filter(r => r.empId === MEHDI && r.type === 'document' && r.statut === 'refusee');
  assert.equal(refusees.length, 2);
  assert.match(refusees[0].reponse!, /dossier n’a pas été modifié/);
  assert.ok(!JSON.stringify(domain().ds.employes).includes('FAUX123'), 'le passeport refusé n’est nulle part dans les dossiers');
});

test('saisie directe du RH : appliquée immédiatement, sans demande', () => {
  const { run, emp, docs } = fresh();
  const msg = run(RH, 'formalite.enregistrer', { ...FAUX, numero: '26AB00001' });
  assert.match(String(msg), /enregistré — valide jusqu’au/);
  assert.deepEqual(emp(MEHDI).passeport, { numero: '26AB00001', expire: '2036-01-15' });
  run(RH, 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', expire: '2027-10-07' });
  assert.equal(emp(MEHDI).visas.find(v => v.dest === 'IN')!.type, 'e-Visa d’affaires');
  assert.equal(docs().length, 0);
});

test('manager : ni la déclaration ni son contenu dans les données reçues', () => {
  const { db, run } = fresh();
  run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: 'fj', date: '2026-09-03' });
  const s = buildSnapshot(db, mgr(KARIM));
  assert.ok(s.employes.some(e => e.id === MEHDI), 'Mehdi fait partie de l’équipe');
  assert.ok(!s.demandesCollab.some(r => r.type === 'document' && r.empId !== KARIM));
  assert.ok(s.demandesCollab.every(r => r.empId === KARIM || r.declaration === null));
  const json = JSON.stringify(s);
  assert.ok(!json.includes('FAUX123') && !json.includes('2026-09-03'));
  // L'intéressé et le RH voient le détail.
  const mine = buildSnapshot(db, collab(MEHDI)).demandesCollab.filter(r => r.type === 'document');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].declaration?.kind === 'passeport' && mine[0].declaration.numero, 'FAUX123');
  assert.ok(JSON.stringify(buildSnapshot(db, RH)).includes('FAUX123'));
  // Un collègue de la même équipe ne voit rien.
  assert.ok(!JSON.stringify(buildSnapshot(db, collab(6))).includes('FAUX123'));
});

test('nouvelle déclaration du même document : remplace celle en attente', () => {
  const { run, enAttente, emp } = fresh();
  run(collab(MEHDI), 'formalite.enregistrer', FAUX);
  const premiere = enAttente()[0];
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', expire: '2027-10-07' });
  const msg = run(collab(MEHDI), 'formalite.enregistrer', { ...FAUX, numero: '26XY45678' });
  assert.match(String(msg), /remplace la précédente/);
  const dem = enAttente();
  assert.equal(dem.length, 2, 'un passeport et un visa en attente');
  const pass = dem.find(r => r.declaration?.kind === 'passeport')!;
  assert.equal(pass.declaration?.kind === 'passeport' && pass.declaration.numero, '26XY45678');
  // Le RH ne peut plus valider la déclaration remplacée, qu'il n'a peut-être pas revue.
  assert.throws(() => run(RH, 'demande.accepter', { id: premiere.id }), /introuvable/);
  run(RH, 'demande.accepter', { id: pass.id });
  assert.equal(emp(MEHDI).passeport?.numero, '26XY45678');
});

test('déclaration devenue invalide : validation refusée, dossier intact', () => {
  const { db, run, enAttente, emp } = fresh();
  run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'visa', dest: 'IN', expire: '2027-10-07' });
  const r = enAttente()[0];
  db.update('demandesCollab', r.id, { declaration: { ...r.declaration, dest: 'ZZ' } }); // destination retirée du référentiel
  assert.throws(() => run(RH, 'demande.accepter', { id: r.id }), (e: unknown) => e instanceof ActionError && /Déclaration invalide/.test(e.message));
  assert.ok(!emp(MEHDI).visas.some(v => v.dest === 'IN' || v.dest === 'ZZ'));
  assert.equal(enAttente()[0].statut, 'attente');
});

test('saisies incomplètes et droits inchangés', () => {
  const { run } = fresh();
  assert.throws(() => run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'passeport', numero: ' ', expire: '2030-01-01' }), /Numéro/);
  assert.throws(() => run(collab(MEHDI), 'formalite.enregistrer', { empId: MEHDI, kind: 'vaccin', v: '__proto__', date: '2026-01-01' }), /Vaccin/);
  assert.throws(() => run(collab(MEHDI), 'formalite.enregistrer', { ...FAUX, empId: 6 }), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.throws(() => run(mgr(KARIM), 'formalite.enregistrer', FAUX), (e: unknown) => e instanceof ActionError && e.status === 403);
  assert.throws(() => run(collab(MEHDI), 'demande.accepter', { id: 1 }), (e: unknown) => e instanceof ActionError && e.status === 403);
});

test('migration : demandes en attente d’une ancienne base reprises du dossier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-documents-'));
  try {
    const file = join(dir, 'ancienne.db');
    // Ancienne base : pas de colonne `declaration`, formalités déjà écrites dans le dossier.
    const old = new Db(file);
    seedDemo(old);
    old.sql.exec('DELETE FROM demandes_collab WHERE type = \'document\'');
    old.sql.exec('ALTER TABLE demandes_collab DROP COLUMN declaration');
    const ins = old.sql.prepare('INSERT INTO demandes_collab (emp_id, type, label, date, statut, reponse) VALUES (?, \'document\', ?, \'2026-10-01\', ?, ?)');
    ins.run(MEHDI, 'Passeport mis à jour', 'attente', null);
    ins.run(MEHDI, 'Vaccination Hépatite A déclarée', 'attente', null);
    ins.run(9, 'Visa États-Unis déclaré', 'attente', null);
    ins.run(MEHDI, 'Vaccination DTP déclarée', 'acceptee', 'Document contrôlé par le service RH');
    ins.run(MEHDI, 'Visa Inde déclaré', 'refusee', 'Refusée par le service RH');
    ins.run(MEHDI, 'Document inconnu', 'attente', null);
    old.sql.close();

    const db = new Db(file); // démarrage : la colonne est ajoutée
    migrate(db);
    migrate(db); // sans effet la seconde fois
    const { run, docs, emp } = outils(db);
    const par = (label: string, id = MEHDI) => docs(id).find(r => r.label === label)!;
    assert.deepEqual(par('Passeport mis à jour').declaration, { kind: 'passeport', numero: '20AB···91', expire: '2026-12-02', dejaAuDossier: true });
    assert.deepEqual(par('Vaccination Hépatite A déclarée').declaration, { kind: 'vaccin', v: 'hepA', date: '2022-03-11', dejaAuDossier: true });
    assert.deepEqual(par('Visa États-Unis déclaré', 9).declaration, { kind: 'visa', dest: 'US', type: 'ESTA', obtenu: '2024-11-03', expire: '2026-11-02', dejaAuDossier: true });
    // Les demandes déjà traitées et les libellés inconnus restent tels quels.
    assert.equal(par('Vaccination DTP déclarée').declaration, null);
    assert.equal(par('Visa Inde déclaré').statut, 'refusee');
    assert.equal(par('Visa Inde déclaré').declaration, null);
    assert.equal(par('Document inconnu').declaration, null);

    // Une nouvelle déclaration ne remplace pas une ancienne demande déjà au dossier.
    run(collab(MEHDI), 'formalite.enregistrer', FAUX);
    assert.ok(par('Passeport mis à jour').declaration?.dejaAuDossier);
    // Refus d'une ancienne déclaration : elle est retirée du dossier.
    run(RH, 'demande.refuser', { id: par('Passeport mis à jour').id });
    assert.equal(emp(MEHDI).passeport, null);
    // Validation d'une ancienne déclaration : le dossier n'est pas réécrit.
    run(RH, 'demande.accepter', { id: par('Vaccination Hépatite A déclarée').id });
    assert.ok(emp(MEHDI).vaccins.some(v => v.v === 'hepA' && v.date === '2022-03-11'));
    // Libellé inconnu : contrôle dans le dossier, comme avant.
    run(RH, 'demande.accepter', { id: par('Document inconnu').id });
    assert.equal(par('Document inconnu').statut, 'acceptee');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
