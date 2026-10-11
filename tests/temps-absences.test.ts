// Heures et absences validées : aucune heure un jour de CP, RTT ou récupération validé (double paiement),
// correction toujours possible, contrôles à la soumission, à la validation et à la pose d'une absence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { checkAbsence } = await import('../shared/rules/conges.ts');
const { joursAbsence } = await import('../shared/rules/temps.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };
// Semaine 42 de Mehdi : rien de saisi ; la proposition Keystone donne 8, 8, 8, 0, 0 (ligne 0) et 0, 0, 0, 8, 7 (ligne 1).
const week = '2026-10-12';
const cell = (li: number, di: number, value: string) => ({ empId: 2, week, li, di, value });

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const domain = () => new Domain(loadFull(db, RH));
  const sheet = (w = week) => domain().ds.feuilles.find(f => f.empId === 2 && f.week === w)!;
  /** Absence validée enregistrée telle quelle, sans contrôle : données antérieures à la règle. */
  const absenceValidee = (du: string, au = du, type = 'CP') => db.insert('absences', { empId: 2, type, du, au, statut: 'validee', keystone: true });
  return { run, domain, sheet, absenceValidee };
}

test('saisie refusée un jour de CP validé, cellule vidée acceptée', () => {
  const { run, sheet, absenceValidee } = fresh();
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  absenceValidee('2026-10-13');
  const refus = /Absence validée ce jour-là \(CP\) : aucune heure ne peut être saisie/;
  assert.throws(() => run(MEHDI, 'temps.setCell', cell(0, 1, '4')), refus);
  assert.throws(() => run(KARIM, 'temps.setCell', cell(1, 1, '2')), refus, 'cellule vide : verrouillée');
  assert.throws(() => run(RH, 'temps.setCell', cell(0, 1, '8')), refus);
  assert.equal(sheet().lignes[0].h[1], 8, 'valeur inchangée');
  run(MEHDI, 'temps.setCell', cell(0, 1, ''));
  run(MEHDI, 'temps.setCell', cell(1, 1, '0'));
  run(MEHDI, 'temps.setCell', cell(0, 0, '7,5'));
  assert.deepEqual(sheet().lignes[0].h, [7.5, 0, 8, 0, 0]);
});

test('proposition Keystone : aucune heure un jour d’absence validée', () => {
  const { run, domain } = fresh();
  // Nicolas Perrin (22) : RTT validé le vendredi 9 octobre.
  assert.deepEqual(joursAbsence(domain(), 22, '2026-10-05').map(a => a?.type ?? null), [null, null, null, null, 'RTT']);
  run(RH, 'temps.suggest', { empId: 22, week: '2026-10-05' });
  const sh = domain().ds.feuilles.find(f => f.empId === 22 && f.week === '2026-10-05')!;
  assert.deepEqual(sh.lignes.map(l => l.h), [[8, 8, 8, 8, 0]]);
  run(RH, 'temps.submit', { empId: 22, week: '2026-10-05' });
});

test('soumission refusée tant qu’il reste des heures sur un jour d’absence', () => {
  const { run, sheet, absenceValidee } = fresh();
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  absenceValidee('2026-10-13', '2026-10-14');
  assert.throws(() => run(MEHDI, 'temps.submit', { empId: 2, week }),
    /Absence validée les mar\. 13 oct\. et mer\. 14 oct\. \(CP\) : retirez les heures saisies ces jours-là avant de soumettre la feuille/);
  assert.equal(sheet().statut, 'brouillon');
  run(MEHDI, 'temps.setCell', cell(0, 1, ''));
  assert.throws(() => run(MEHDI, 'temps.submit', { empId: 2, week }), /Absence validée le mer\. 14 oct\. \(CP\) : retirez les heures saisies ce jour-là/);
  run(MEHDI, 'temps.setCell', cell(0, 2, ''));
  run(MEHDI, 'temps.submit', { empId: 2, week });
  assert.equal(sheet().statut, 'soumise');
});

test('validation refusée tant qu’il reste des heures sur un jour d’absence', () => {
  const { run, sheet, absenceValidee } = fresh();
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  run(MEHDI, 'temps.submit', { empId: 2, week });
  absenceValidee('2026-10-16', '2026-10-16', 'RTT');
  assert.throws(() => run(KARIM, 'temps.validate', { empId: 2, week }),
    /Absence validée le ven\. 16 oct\. \(RTT\) : retirez les heures saisies ce jour-là ou renvoyez la feuille avant de la valider/);
  assert.equal(sheet().statut, 'soumise');
  // Le valideur corrige la feuille soumise : la cellule remplie peut être vidée, pas modifiée.
  assert.throws(() => run(KARIM, 'temps.setCell', cell(1, 4, '3')), /Absence validée ce jour-là \(RTT\)/);
  run(KARIM, 'temps.setCell', cell(1, 4, ''));
  run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal(sheet().statut, 'validee');
});

test('validation d’une absence refusée quand des heures sont saisies ces jours-là', () => {
  const { run, domain, sheet } = fresh();
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  // Simple demande : les heures sont signalées sans bloquer ; posée validée par le manager, elles la bloquent.
  const d = domain(), e = d.emp(2)!;
  const demande = checkAbsence(d, e, 'CP', '2026-10-13', '2026-10-14');
  assert.ok(!demande.cant);
  assert.ok(demande.msgs.some(m => !m.bad && /les retirer de la feuille de temps \(semaine 42\) avant la validation de l’absence/.test(m.text)));
  assert.ok(checkAbsence(d, e, 'CP', '2026-10-13', '2026-10-14', true).cant);
  assert.throws(() => run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-13', au: '2026-10-13' }),
    /Heures déjà saisies le mar\. 13 oct\. : les retirer de la feuille de temps \(semaine 42\) avant de poser l’absence/);

  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-13', au: '2026-10-14' });
  const a = domain().ds.absences.find(x => x.empId === 2 && x.du === '2026-10-13')!;
  assert.equal(a.statut, 'demandee');
  assert.throws(() => run(KARIM, 'absence.decider', { id: a.id, ok: true }),
    /Heures déjà saisies les mar\. 13 oct\. et mer\. 14 oct\. : les retirer de la feuille de temps \(semaine 42\) avant de valider l’absence/);
  assert.equal(domain().ds.absences.find(x => x.id === a.id)!.statut, 'demandee');
  run(KARIM, 'temps.setCell', cell(0, 1, ''));
  run(KARIM, 'temps.setCell', cell(0, 2, ''));
  run(KARIM, 'absence.decider', { id: a.id, ok: true });
  assert.equal(domain().ds.absences.find(x => x.id === a.id)!.statut, 'validee');
  assert.deepEqual(sheet().lignes[0].h, [8, 0, 0, 0, 0]);
});

test('absence sur une feuille soumise ou validée : marche à suivre, feuille validée jamais modifiée', () => {
  const { run, domain, sheet } = fresh();
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  run(MEHDI, 'temps.submit', { empId: 2, week });
  assert.throws(() => run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-16', au: '2026-10-16' }),
    /Heures déjà saisies le ven\. 16 oct\. sur la feuille soumise de la semaine 42 : la renvoyer pour correction \(ou la corriger\) puis retirer ces heures avant de poser l’absence/);
  // Une demande reste possible, et son refus aussi.
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-16', au: '2026-10-16' });
  const a = domain().ds.absences.find(x => x.empId === 2 && x.du === '2026-10-16')!;
  assert.throws(() => run(KARIM, 'absence.decider', { id: a.id, ok: true }), /feuille soumise de la semaine 42/);
  run(KARIM, 'absence.decider', { id: a.id, ok: false });
  assert.equal(domain().ds.absences.find(x => x.id === a.id)!.statut, 'refusee');

  // Semaine 39 validée (et transmise à la paie) : l'absence ne peut pas couvrir ces jours, même en simple demande.
  const avant = sheet('2026-09-21');
  assert.equal(avant.statut, 'validee');
  const refus = /Heures déjà validées les lun\. 21 sept\. et mar\. 22 sept\. \(semaine 39\) : la feuille n’est pas modifiée rétroactivement, l’absence ne peut pas couvrir ces jours/;
  assert.throws(() => run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-09-21', au: '2026-09-22' }), refus);
  assert.throws(() => run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-09-21', au: '2026-09-22' }), refus);
  assert.deepEqual(sheet('2026-09-21'), avant);
});
