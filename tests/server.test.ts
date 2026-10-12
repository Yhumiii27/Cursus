// Tests serveur : périmètre des données par rôle et contrôles d'accès des actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
type User = Parameters<typeof buildSnapshot>[1];

const db = new Db(':memory:');
seedDemo(db);
const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const MGR: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const COLLAB: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien de maintenance' };

function run(user: User, name: string, payload: Record<string, unknown>) {
  return db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
}
function expectForbidden(user: User, name: string, payload: Record<string, unknown>) {
  assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === 403);
}

test('manager : son équipe uniquement, sans données de santé', () => {
  const s = buildSnapshot(db, MGR);
  assert.deepEqual(s.employes.map(e => e.id).sort((a, b) => a - b), [2, 6, 12, 18, 24]);
  const mehdi = s.employes.find(e => e.id === 2)!;
  assert.equal(mehdi.visite, null);
  assert.equal(typeof mehdi.aptitude?.ok, 'boolean');
  assert.deepEqual(mehdi.vaccins, []);
  assert.ok(s.employes.find(e => e.id === 12)!.visite, 'ses propres données restent complètes');
  assert.equal(s.plan.length, 0);
  assert.equal(s.demandesKeystone.length, 0);
  assert.ok(s.voyages.filter(v => v.empId !== 12).every(v => v.dossierStatut));
});

test('collaborateur : ses propres données uniquement', () => {
  const s = buildSnapshot(db, COLLAB);
  assert.deepEqual(s.employes.map(e => e.id), [2]);
  assert.ok(s.absences.every(a => a.empId === 2));
  assert.ok(s.feuilles.every(f => f.empId === 2));
  assert.equal(s.annuaire.length, 24, 'annuaire (noms, équipes) visible');
});

test('droits des actions', () => {
  expectForbidden(COLLAB, 'hab.delivrer', { empId: 2, h: 'he', date: '2026-10-07', par: 'X' });
  expectForbidden(MGR, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-10-01' });
  expectForbidden(COLLAB, 'absence.demander', { empId: 6, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  expectForbidden(MGR, 'temps.validate', { empId: 3, week: '2026-09-28' }); // hors équipe
});

test('habilitation refusée si les prérequis manquent', () => {
  assert.throws(() => run(RH, 'hab.delivrer', { empId: 2, h: 'he', date: '2026-10-07', par: 'Karim Haddad', mode: 'renew' }), /Délivrance impossible/);
});

test('circuit d’une absence : demande, décision du manager, transmission', () => {
  const msg = run(COLLAB, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  assert.match(String(msg), /Karim Haddad/);
  const a = loadFull(db, RH).absences.find(x => x.empId === 2 && x.du === '2026-12-07')!;
  assert.equal(a.statut, 'demandee');
  run(MGR, 'absence.decider', { id: a.id, ok: true });
  assert.equal(loadFull(db, RH).absences.find(x => x.id === a.id)!.statut, 'validee');
});

test('feuille de temps : saisie, soumission, validation, paie', () => {
  const week = '2026-10-05';
  run(COLLAB, 'temps.suggest', { empId: 2, week });
  run(COLLAB, 'temps.setCell', { empId: 2, week, li: 0, di: 0, value: '9,5' });
  let sh = loadFull(db, RH).feuilles.find(f => f.empId === 2 && f.week === week)!;
  assert.equal(sh.lignes[0].h[0], 9.5);
  run(COLLAB, 'temps.submit', { empId: 2, week });
  assert.throws(() => run(COLLAB, 'temps.setCell', { empId: 2, week, li: 0, di: 1, value: '1' }), /déjà soumise/);
  run(MGR, 'temps.validate', { empId: 2, week });
  sh = loadFull(db, RH).feuilles.find(f => f.id === sh.id)!;
  assert.equal(sh.statut, 'validee');
  run(RH, 'temps.pushSage', {});
  assert.ok(loadFull(db, RH).feuilles.find(f => f.id === sh.id)!.sage);
  assert.ok(loadFull(db, RH).lastSagePush!.lignes.some(l => l.matricule === 'EMP-0002'));
});
