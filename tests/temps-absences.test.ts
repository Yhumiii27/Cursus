// Heures et absences validées : aucune heure un jour de CP, RTT ou récupération validé (double paiement),
// correction toujours possible, contrôles à la soumission, à la validation et à la pose d'une absence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
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

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
  const domain = async () => new Domain(await loadFull(db, RH));
  const sheet = async (w = week) => (await domain()).ds.feuilles.find(f => f.empId === 2 && f.week === w)!;
  /** Absence validée enregistrée telle quelle, sans contrôle : données antérieures à la règle. */
  const absenceValidee = async (du: string, au = du, type = 'CP') => await db.insert('absences', { empId: 2, type, du, au, statut: 'validee', keystone: true });
  return { run, domain, sheet, absenceValidee };
}

test('saisie refusée un jour de CP validé, cellule vidée acceptée', async () => {
  const { run, sheet, absenceValidee } = await fresh();
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  await absenceValidee('2026-10-13');
  const refus = /Absence validée ce jour-là \(CP\) : aucune heure ne peut être saisie/;
  await assert.rejects(async () => await run(MEHDI, 'temps.setCell', cell(0, 1, '4')), refus);
  await assert.rejects(async () => await run(KARIM, 'temps.setCell', cell(1, 1, '2')), refus, 'cellule vide : verrouillée');
  await assert.rejects(async () => await run(RH, 'temps.setCell', cell(0, 1, '8')), refus);
  assert.equal((await sheet()).lignes[0].h[1], 8, 'valeur inchangée');
  await run(MEHDI, 'temps.setCell', cell(0, 1, ''));
  await run(MEHDI, 'temps.setCell', cell(1, 1, '0'));
  await run(MEHDI, 'temps.setCell', cell(0, 0, '7,5'));
  assert.deepEqual((await sheet()).lignes[0].h, [7.5, 0, 8, 0, 0, 0, 0]);
});

test('proposition Keystone : aucune heure un jour d’absence validée', async () => {
  const { run, domain } = await fresh();
  // Nicolas Perrin (22) : RTT validé le vendredi 9 octobre.
  assert.deepEqual(joursAbsence(await domain(), 22, '2026-10-05').map(a => a?.type ?? null), [null, null, null, null, 'RTT', null, null]);
  await run(RH, 'temps.suggest', { empId: 22, week: '2026-10-05' });
  const sh = (await domain()).ds.feuilles.find(f => f.empId === 22 && f.week === '2026-10-05')!;
  assert.deepEqual(sh.lignes.map(l => l.h), [[8, 8, 8, 8, 0, 0, 0]]);
  await run(RH, 'temps.submit', { empId: 22, week: '2026-10-05' });
});

test('soumission refusée tant qu’il reste des heures sur un jour d’absence', async () => {
  const { run, sheet, absenceValidee } = await fresh();
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  await absenceValidee('2026-10-13', '2026-10-14');
  await assert.rejects(async () => await run(MEHDI, 'temps.submit', { empId: 2, week }),
    /Absence validée les mar\. 13 oct\. et mer\. 14 oct\. \(CP\) : retirez les heures saisies ces jours-là avant de soumettre la feuille/);
  assert.equal((await sheet()).statut, 'brouillon');
  await run(MEHDI, 'temps.setCell', cell(0, 1, ''));
  await assert.rejects(async () => await run(MEHDI, 'temps.submit', { empId: 2, week }), /Absence validée le mer\. 14 oct\. \(CP\) : retirez les heures saisies ce jour-là/);
  await run(MEHDI, 'temps.setCell', cell(0, 2, ''));
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  assert.equal((await sheet()).statut, 'soumise');
});

test('validation refusée tant qu’il reste des heures sur un jour d’absence', async () => {
  const { run, sheet, absenceValidee } = await fresh();
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  await absenceValidee('2026-10-16', '2026-10-16', 'RTT');
  await assert.rejects(async () => await run(KARIM, 'temps.validate', { empId: 2, week }),
    /Absence validée le ven\. 16 oct\. \(RTT\) : retirez les heures saisies ce jour-là ou renvoyez la feuille avant de la valider/);
  assert.equal((await sheet()).statut, 'soumise');
  // Le valideur corrige la feuille soumise : la cellule remplie peut être vidée, pas modifiée.
  await assert.rejects(async () => await run(KARIM, 'temps.setCell', cell(1, 4, '3')), /Absence validée ce jour-là \(RTT\)/);
  await run(KARIM, 'temps.setCell', cell(1, 4, ''));
  await run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal((await sheet()).statut, 'validee');
});

test('validation d’une absence refusée quand des heures sont saisies ces jours-là', async () => {
  const { run, domain, sheet } = await fresh();
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  // Simple demande : les heures sont signalées sans bloquer ; posée validée par le manager, elles la bloquent.
  const d = await domain(), e = d.emp(2)!;
  const demande = checkAbsence(d, e, 'CP', '2026-10-13', '2026-10-14');
  assert.ok(!demande.cant);
  assert.ok(demande.msgs.some(m => !m.bad && /les retirer de la feuille de temps \(semaine 42\) avant la validation de l’absence/.test(m.text)));
  assert.ok(checkAbsence(d, e, 'CP', '2026-10-13', '2026-10-14', true).cant);
  await assert.rejects(async () => await run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-13', au: '2026-10-13' }),
    /Heures déjà saisies le mar\. 13 oct\. : les retirer de la feuille de temps \(semaine 42\) avant de poser l’absence/);

  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-13', au: '2026-10-14' });
  const a = (await domain()).ds.absences.find(x => x.empId === 2 && x.du === '2026-10-13')!;
  assert.equal(a.statut, 'demandee');
  await assert.rejects(async () => await run(KARIM, 'absence.decider', { id: a.id, ok: true }),
    /Heures déjà saisies les mar\. 13 oct\. et mer\. 14 oct\. : les retirer de la feuille de temps \(semaine 42\) avant de valider l’absence/);
  assert.equal((await domain()).ds.absences.find(x => x.id === a.id)!.statut, 'demandee');
  await run(KARIM, 'temps.setCell', cell(0, 1, ''));
  await run(KARIM, 'temps.setCell', cell(0, 2, ''));
  await run(KARIM, 'absence.decider', { id: a.id, ok: true });
  assert.equal((await domain()).ds.absences.find(x => x.id === a.id)!.statut, 'validee');
  assert.deepEqual((await sheet()).lignes[0].h, [8, 0, 0, 0, 0, 0, 0]);
});

test('absence sur une feuille soumise ou validée : marche à suivre, feuille validée jamais modifiée', async () => {
  const { run, domain, sheet } = await fresh();
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  await assert.rejects(async () => await run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-16', au: '2026-10-16' }),
    /Heures déjà saisies le ven\. 16 oct\. sur la feuille soumise de la semaine 42 : la renvoyer pour correction \(ou la corriger\) puis retirer ces heures avant de poser l’absence/);
  // Une demande reste possible, et son refus aussi.
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-16', au: '2026-10-16' });
  const a = (await domain()).ds.absences.find(x => x.empId === 2 && x.du === '2026-10-16')!;
  await assert.rejects(async () => await run(KARIM, 'absence.decider', { id: a.id, ok: true }), /feuille soumise de la semaine 42/);
  await run(KARIM, 'absence.decider', { id: a.id, ok: false });
  assert.equal((await domain()).ds.absences.find(x => x.id === a.id)!.statut, 'refusee');

  // Semaine 39 validée (et transmise à la paie) : l'absence ne peut pas couvrir ces jours, même en simple demande.
  const avant = await sheet('2026-09-21');
  assert.equal(avant.statut, 'validee');
  const refus = /Heures déjà validées les lun\. 21 sept\. et mar\. 22 sept\. \(semaine 39\) : la feuille n’est pas modifiée rétroactivement, l’absence ne peut pas couvrir ces jours/;
  await assert.rejects(async () => await run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-09-21', au: '2026-09-22' }), refus);
  await assert.rejects(async () => await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-09-21', au: '2026-09-22' }), refus);
  assert.deepEqual(await sheet('2026-09-21'), avant);
});

test('demande d’absence en attente sur des heures : décidée avant la validation de la feuille', async () => {
  const { run, domain, sheet } = await fresh();
  // Mehdi demande un CP le vendredi, reprend la proposition Keystone (7 h ce jour-là) et soumet : rien ne l'en empêche.
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-16', au: '2026-10-16' });
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  const a = (await domain()).ds.absences.find(x => x.empId === 2 && x.du === '2026-10-16')!;
  // Validée, la feuille ne serait plus modifiable et l'absence ne pourrait plus être validée.
  await assert.rejects(async () => await run(KARIM, 'temps.validate', { empId: 2, week }),
    /Demande d’absence en attente le ven\. 16 oct\. \(CP\) : décidez-la avant de valider la feuille — pour l’accepter, retirez d’abord les heures saisies ce jour-là/);
  assert.equal((await sheet()).statut, 'soumise');
  // Le valideur retire les heures, accepte l'absence, puis valide la feuille.
  await run(KARIM, 'temps.setCell', cell(1, 4, ''));
  await run(KARIM, 'absence.decider', { id: a.id, ok: true });
  await run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal((await domain()).ds.absences.find(x => x.id === a.id)!.statut, 'validee');
  assert.equal((await sheet()).statut, 'validee');
  assert.deepEqual((await sheet()).lignes[1].h, [0, 0, 0, 8, 0, 0, 0]);
});

test('demande d’absence en attente : refusée, ou sans heure ces jours-là, la feuille se valide', async () => {
  const refusee = await fresh();
  await refusee.run(MEHDI, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-10-15', au: '2026-10-16' });
  await refusee.run(MEHDI, 'temps.suggest', { empId: 2, week });
  await refusee.run(MEHDI, 'temps.submit', { empId: 2, week });
  await assert.rejects(async () => await refusee.run(RH, 'temps.validate', { empId: 2, week }),
    /Demande d’absence en attente les jeu\. 15 oct\. et ven\. 16 oct\. \(RTT\) : décidez-la avant de valider la feuille — pour l’accepter, retirez d’abord les heures saisies ces jours-là/);
  const a = (await refusee.domain()).ds.absences.find(x => x.empId === 2 && x.du === '2026-10-15')!;
  await refusee.run(KARIM, 'absence.decider', { id: a.id, ok: false });
  await refusee.run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal((await refusee.sheet()).statut, 'validee');

  // Heures déjà retirées du jour demandé : la feuille se valide, l'absence reste validable ensuite.
  const { run, domain, sheet } = await fresh();
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-16', au: '2026-10-16' });
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  await run(MEHDI, 'temps.setCell', cell(1, 4, ''));
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  await run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal((await sheet()).statut, 'validee');
  const b = (await domain()).ds.absences.find(x => x.empId === 2 && x.du === '2026-10-16')!;
  await run(KARIM, 'absence.decider', { id: b.id, ok: true });
  assert.equal((await domain()).ds.absences.find(x => x.id === b.id)!.statut, 'validee');
});
