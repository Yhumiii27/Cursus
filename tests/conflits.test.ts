// Doublons et conflits de dates d'un salarié (lot 3) : demandes de formation, entretiens planifiés, déplacements,
// inscriptions et absences. Contrôle commun (`shared/rules/conflits.ts`) : blocage quand le salarié est absent
// ou que l'engagement existe déjà, avertissement sinon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { checkAbsence, checkNature } = await import('../shared/rules/conges.ts');
const { conflitsDates } = await import('../shared/rules/conflits.ts');
const { parseTrips } = await import('../shared/rules/imports.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const mgr = (empId: number): User => ({ role: 'manager', empId, nom: `#${empId}`, intitule: '' });
const collab = (empId: number): User => ({ role: 'collaborateur', empId, nom: `#${empId}`, intitule: '' });

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
  const refused = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp) =>
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message), `${name} devait être refusé (${motif})`);
  const domain = async () => new Domain(await loadFull(db, RH));
  return { db, run, refused, domain };
}

test('t088 deux demandes de formation identiques en attente : la seconde est refusée', async () => {
  const { run, refused, domain } = await fresh();
  await run(collab(2), 'demande.formation', { f: 'atex', motif: 'Interventions en zone ATEX' });
  await refused(collab(2), 'demande.formation', { f: 'atex', motif: 'Encore' }, /déjà en cours/);
  // Par le manager pour le même salarié : même refus.
  await refused(mgr(12), 'demande.formation', { empId: 2, f: 'atex', motif: 'Chantier Feyzin' }, /déjà en cours/);
  // Hors catalogue : même intitulé, à la casse et aux accents près.
  await run(collab(2), 'demande.formation', { f: 'autre', libelle: 'Anglais technique', motif: 'Clients export' });
  await refused(collab(2), 'demande.formation', { f: 'autre', libelle: ' anglais  TECHNIQUE ', motif: 'x' }, /déjà en cours/);
  await run(collab(2), 'demande.formation', { f: 'autre', libelle: 'Allemand', motif: 'Clients export' });
  assert.equal((await domain()).ds.demandesCollab.filter(r => r.empId === 2 && r.type === 'formation' && r.statut === 'attente').length, 3);
  // Déjà inscrit à une session à venir de cette formation (Camille, SST le 14 octobre).
  await refused(collab(1), 'demande.formation', { f: 'sst', motif: 'Recyclage' }, /déjà inscrit/);
});

test('t088 un seul entretien planifié par type : une nouvelle date le reprogramme ; pas d’entretien un jour d’absence', async () => {
  const { run, refused, domain } = await fresh();
  const planifies = async (empId: number, type: string) => (await domain()).ds.entretiens.filter(x => x.empId === empId && x.type === type && x.statut === 'planifie');
  // Camille (1) a déjà un entretien annuel planifié le 14 octobre : il est déplacé, pas doublé.
  const id = (await planifies(1, 'annuel'))[0].id;
  assert.match(String(await run(RH, 'entretien.planifier', { empId: 1, kind: 'annuel', date: '2026-11-05' })), /reprogrammé le 5 nov\. 2026 \(prévu le 14 oct\. 2026\)/);
  assert.deepEqual((await planifies(1, 'annuel')).map(x => [x.id, x.date, x.planifieLe]), [[id, '2026-11-05', '2026-10-10']]);
  await refused(RH, 'entretien.planifier', { empId: 1, kind: 'annuel', date: '2026-11-05' }, /déjà planifié à cette date/);
  await run(RH, 'entretien.planifier', { empId: 1, kind: 'epp', date: '2026-11-05' });
  await run(RH, 'entretien.planifier', { empId: 1, kind: 'epp', date: '2026-11-12' });
  assert.deepEqual((await planifies(1, 'epp')).map(x => x.date), ['2026-11-12']);
  // Antoine (14) est en congé validé du 19 au 23 octobre.
  await refused(RH, 'entretien.planifier', { empId: 14, kind: 'epp', date: '2026-10-21' }, /Absence validée/);
  await run(RH, 'entretien.planifier', { empId: 14, kind: 'epp', date: '2026-10-26' });
});

test('t088 congé accordé le jour d’un entretien : l’entretien se reprogramme', async () => {
  const { run, refused, domain } = await fresh();
  // Mehdi (2) a son entretien annuel le 20 octobre ; Karim (12) lui pose et valide un congé du 19 au 23.
  const chk = checkAbsence(await domain(), (await domain()).emp(2)!, 'CP', '2026-10-19', '2026-10-23', true);
  assert.ok(chk.msgs.some(m => !m.bad && /Entretien annuel d’évaluation planifié le 20 oct\. 2026/.test(m.text)), chk.msgs.map(m => m.text).join(' | '));
  await run(mgr(12), 'absence.demander', { empId: 2, kind: 'CP', du: '2026-10-19', au: '2026-10-23' });
  // Pas sur un jour du congé ; à une autre date, par le manager comme par le RH.
  await refused(mgr(12), 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-10-22' }, /Absence validée/);
  assert.match(String(await run(mgr(12), 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-11-05' })), /reprogrammé le 5 nov\. 2026 \(prévu le 20 oct\. 2026\)/);
  await run(RH, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-11-09' });
  assert.deepEqual((await domain()).ds.entretiens.filter(x => x.empId === 2 && x.type === 'annuel' && x.statut === 'planifie').map(x => x.date), ['2026-11-09']);
});

test('t088 entretien passé au compte rendu commencé : reprogrammé seulement s’il n’a pas été tenu', async () => {
  const { run, refused, domain } = await fresh();
  const entretien = async (empId: number) => (await domain()).ds.entretiens.find(x => x.empId === empId && x.type === 'annuel' && x.statut === 'planifie')!;
  // Compte rendu de l'entretien annuel de Camille (14 octobre) rédigé le 10 ; Julien (8, 21 octobre) sans compte rendu.
  const cam = (await entretien(1)).id;
  await run(RH, 'entretien.modifier', { id: cam, section: 'bilan', value: 'Objectifs atteints.' });
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = '2026-11-20';
  try {
    await refused(RH, 'entretien.planifier', { empId: 1, kind: 'annuel', date: '2027-10-12' }, /au compte rendu commencé : s’il a eu lieu, clôturez-le/);
    assert.equal((await entretien(1)).date, '2026-10-14');
    assert.match(String(await run(RH, 'entretien.planifier', { empId: 1, kind: 'annuel', date: '2026-11-30', nonTenu: true })), /prévu le 14 oct\. 2026, non tenu/);
    assert.deepEqual([(await entretien(1)).id, (await entretien(1)).date, (await entretien(1)).cr.bilan], [cam, '2026-11-30', 'Objectifs atteints.']);
    assert.match(String(await run(RH, 'entretien.planifier', { empId: 8, kind: 'annuel', date: '2026-12-01' })), /prévu le 21 oct\. 2026, non tenu/);
  } finally { process.env.CURSUS_TODAY = avant; }
});

test('t088 déplacements qui se chevauchent ou pendant une absence : refusés', async () => {
  const { run, refused, domain } = await fresh();
  // Clara (19) part aux États-Unis du 12 au 16 octobre.
  await refused(RH, 'voyage.creer', { empId: 19, dest: 'MA', depart: '2026-10-15', retour: '2026-10-20', motif: 'Salon' }, /Déplacement déjà prévu/);
  await run(RH, 'voyage.creer', { empId: 19, dest: 'MA', depart: '2026-10-17', retour: '2026-10-20', motif: 'Salon' });
  await refused(RH, 'voyage.creer', { empId: 14, dest: 'MA', depart: '2026-10-20', retour: '2026-10-22', motif: 'Audit' }, /Absence validée/);
  // Import CSV : chevauchement avec un déplacement existant, ou entre deux lignes du fichier.
  const csv = 'reference;collaborateur;destination;depart;retour;motif\n'
    + 'DD-1;Clara Roussel;Maroc;14/10/2026;15/10/2026;Visite\n'
    + 'DD-2;Mehdi Benali;Maroc;09/11/2026;13/11/2026;Visite\n'
    + 'DD-3;Mehdi Benali;Inde;12/11/2026;16/11/2026;Salon\n';
  const rows = parseTrips(await domain(), csv);
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].errs.some(x => /Déplacement déjà prévu/.test(x)), rows[0].errs.join(' | '));
  assert.equal(rows[1].ok, true, rows[1].errs.join(' | '));
  assert.equal(rows[2].ok, false);
  assert.ok(rows[2].errs.some(x => /ligne 2/.test(x)), rows[2].errs.join(' | '));
});

test('t088 demande Keystone acceptée : refusée si le salarié est déjà en déplacement ou absent', async () => {
  const { db, run, refused, domain } = await fresh();
  const dem = async (ref: string) => (await domain()).ds.demandesKeystone.find(x => x.ref === ref)!;
  const voyages = async () => (await db.all<{ empId: number }>('voyages')).filter(v => v.empId === 18).length;
  // Romain (18) part au Maroc sur les dates de sa demande pour Abidjan (chantier K-2611).
  await run(RH, 'voyage.creer', { empId: 18, dest: 'MA', depart: '2026-11-09', retour: '2026-11-27', motif: 'Audit fournisseur' });
  const n = await voyages();
  await refused(RH, 'keystone.accepter', { id: (await dem('DK-2026-0412')).id }, /Acceptation impossible — Déplacement déjà prévu — Maroc .* Refusez la demande/);
  assert.equal((await dem('DK-2026-0412')).statut, 'attente');
  assert.equal(await voyages(), n);
  // Arrêt de travail de Thomas (6) pendant sa demande pour le Maroc : refusée, sans citer la nature.
  await run(RH, 'absence.saisir', { empId: 6, nature: 'MALADIE', du: '2026-10-26', au: '2026-10-30', justificatif: true, justificatifLe: '2026-10-10' });
  await assert.rejects(async () => await run(RH, 'keystone.accepter', { id: (await dem('DK-2026-0398')).id }),
    (e: unknown) => e instanceof ActionError && e.status === 409 && /Absence validée .*: le salarié est absent/.test(e.message) && !/maladie/i.test(e.message));
  assert.equal((await dem('DK-2026-0398')).statut, 'attente');
});

test('t088 inscription en formation pendant des congés : refusée ; demande en attente : avertissement', async () => {
  const { run, refused, domain } = await fresh();
  const sst = (await domain()).emp(1)!.certs.find(c => c.f === 'sst')!;
  // Le manager de Camille pose (et valide) des congés couvrant la session SST du 18 novembre.
  await run(mgr(16), 'absence.demander', { empId: 1, kind: 'CP', du: '2026-11-16', au: '2026-11-20' });
  await refused(RH, 'plan.inscrire', { empId: 1, certId: sst.id, sessionId: 2, conv: 'now' }, /Absence validée \(CP\)/);
  // Demande d'absence en attente (26 au 30 octobre) : simple avertissement.
  const d = await domain();
  const c = conflitsDates(d, 1, '2026-10-27', '2026-10-27', 'formation');
  assert.ok(c.length > 0 && c.every(x => !x.bad), JSON.stringify(c));
  assert.ok(c.some(x => /Demande d’absence en attente/.test(x.text)));
});

test('t088 absence posée sur une session, un déplacement ou un entretien : avertissement dans le contrôle', async () => {
  const { domain } = await fresh();
  const d = await domain();
  // Camille est inscrite à la session SST du 14 octobre, où est aussi planifié son entretien annuel.
  const chk = checkAbsence(d, d.emp(1)!, 'CP', '2026-10-14', '2026-10-14');
  assert.ok(chk.msgs.some(m => !m.bad && /session SST du 14 oct/.test(m.text)), chk.msgs.map(m => m.text).join(' | '));
  assert.ok(chk.msgs.some(m => !m.bad && /Entretien annuel d’évaluation planifié le 14 oct/.test(m.text)));
  // Clara part aux États-Unis : un arrêt signalé pendant le déplacement est signalé, sans bloquer.
  const arret = checkNature(d, d.emp(19)!, 'ABSENCE', '2026-10-13', '2026-10-14', { quand: 'avant de signaler l’absence' });
  assert.equal(arret.cant, false);
  assert.ok(arret.msgs.some(m => !m.bad && /Déplacement prévu/.test(m.text)));
});

test('t088 les messages ne révèlent jamais une nature médicale', async () => {
  const { run, domain } = await fresh();
  await run(RH, 'absence.saisir', { empId: 14, nature: 'MALADIE', du: '2026-11-02', au: '2026-11-06', justificatif: true, justificatifLe: '2026-10-10' });
  const d = await domain();
  const c = conflitsDates(d, 14, '2026-11-04', '2026-11-04', 'entretien');
  assert.ok(c.some(x => x.bad));
  assert.ok(c.every(x => !/maladie/i.test(x.text)), JSON.stringify(c));
});
