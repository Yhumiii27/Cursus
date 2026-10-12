// Doublons et conflits de dates d'un salarié (lot 3) : demandes de formation, entretiens planifiés, déplacements,
// inscriptions et absences. Contrôle commun (`shared/rules/conflits.ts`) : blocage quand le salarié est absent
// ou que l'engagement existe déjà, avertissement sinon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
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

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const refused = (user: User, name: string, payload: Record<string, unknown>, motif: RegExp) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message), `${name} devait être refusé (${motif})`);
  const domain = () => new Domain(loadFull(db, RH));
  return { db, run, refused, domain };
}

test('t088 deux demandes de formation identiques en attente : la seconde est refusée', () => {
  const { run, refused, domain } = fresh();
  run(collab(2), 'demande.formation', { f: 'atex', motif: 'Interventions en zone ATEX' });
  refused(collab(2), 'demande.formation', { f: 'atex', motif: 'Encore' }, /déjà en cours/);
  // Par le manager pour le même salarié : même refus.
  refused(mgr(12), 'demande.formation', { empId: 2, f: 'atex', motif: 'Chantier Feyzin' }, /déjà en cours/);
  // Hors catalogue : même intitulé, à la casse et aux accents près.
  run(collab(2), 'demande.formation', { f: 'autre', libelle: 'Anglais technique', motif: 'Clients export' });
  refused(collab(2), 'demande.formation', { f: 'autre', libelle: ' anglais  TECHNIQUE ', motif: 'x' }, /déjà en cours/);
  run(collab(2), 'demande.formation', { f: 'autre', libelle: 'Allemand', motif: 'Clients export' });
  assert.equal(domain().ds.demandesCollab.filter(r => r.empId === 2 && r.type === 'formation' && r.statut === 'attente').length, 3);
  // Déjà inscrit à une session à venir de cette formation (Camille, SST le 14 octobre).
  refused(collab(1), 'demande.formation', { f: 'sst', motif: 'Recyclage' }, /déjà inscrit/);
});

test('t088 un seul entretien planifié par type ; pas d’entretien un jour d’absence', () => {
  const { run, refused } = fresh();
  // Camille (1) a déjà un entretien annuel planifié le 14 octobre.
  refused(RH, 'entretien.planifier', { empId: 1, kind: 'annuel', date: '2026-11-05' }, /déjà planifié le 14 oct/);
  run(RH, 'entretien.planifier', { empId: 1, kind: 'epp', date: '2026-11-05' });
  refused(RH, 'entretien.planifier', { empId: 1, kind: 'epp', date: '2026-11-12' }, /déjà planifié/);
  // Antoine (14) est en congé validé du 19 au 23 octobre.
  refused(RH, 'entretien.planifier', { empId: 14, kind: 'epp', date: '2026-10-21' }, /Absence validée/);
  run(RH, 'entretien.planifier', { empId: 14, kind: 'epp', date: '2026-10-26' });
});

test('t088 déplacements qui se chevauchent ou pendant une absence : refusés', () => {
  const { run, refused, domain } = fresh();
  // Clara (19) part aux États-Unis du 12 au 16 octobre.
  refused(RH, 'voyage.creer', { empId: 19, dest: 'MA', depart: '2026-10-15', retour: '2026-10-20', motif: 'Salon' }, /Déplacement déjà prévu/);
  run(RH, 'voyage.creer', { empId: 19, dest: 'MA', depart: '2026-10-17', retour: '2026-10-20', motif: 'Salon' });
  refused(RH, 'voyage.creer', { empId: 14, dest: 'MA', depart: '2026-10-20', retour: '2026-10-22', motif: 'Audit' }, /Absence validée/);
  // Import CSV : chevauchement avec un déplacement existant, ou entre deux lignes du fichier.
  const csv = 'reference;collaborateur;destination;depart;retour;motif\n'
    + 'DD-1;Clara Roussel;Maroc;14/10/2026;15/10/2026;Visite\n'
    + 'DD-2;Mehdi Benali;Maroc;09/11/2026;13/11/2026;Visite\n'
    + 'DD-3;Mehdi Benali;Inde;12/11/2026;16/11/2026;Salon\n';
  const rows = parseTrips(domain(), csv);
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].errs.some(x => /Déplacement déjà prévu/.test(x)), rows[0].errs.join(' | '));
  assert.equal(rows[1].ok, true, rows[1].errs.join(' | '));
  assert.equal(rows[2].ok, false);
  assert.ok(rows[2].errs.some(x => /ligne 2/.test(x)), rows[2].errs.join(' | '));
});

test('t088 inscription en formation pendant des congés : refusée ; demande en attente : avertissement', () => {
  const { run, refused, domain } = fresh();
  const sst = domain().emp(1)!.certs.find(c => c.f === 'sst')!;
  // Le manager de Camille pose (et valide) des congés couvrant la session SST du 18 novembre.
  run(mgr(16), 'absence.demander', { empId: 1, kind: 'CP', du: '2026-11-16', au: '2026-11-20' });
  refused(RH, 'plan.inscrire', { empId: 1, certId: sst.id, sessionId: 2, conv: 'now' }, /Absence validée \(CP\)/);
  // Demande d'absence en attente (26 au 30 octobre) : simple avertissement.
  const d = domain();
  const c = conflitsDates(d, 1, '2026-10-27', '2026-10-27', 'formation');
  assert.ok(c.length > 0 && c.every(x => !x.bad), JSON.stringify(c));
  assert.ok(c.some(x => /Demande d’absence en attente/.test(x.text)));
});

test('t088 absence posée sur une session, un déplacement ou un entretien : avertissement dans le contrôle', () => {
  const { domain } = fresh();
  const d = domain();
  // Camille est inscrite à la session SST du 14 octobre, où est aussi planifié son entretien annuel.
  const chk = checkAbsence(d, d.emp(1)!, 'CP', '2026-10-14', '2026-10-14');
  assert.ok(chk.msgs.some(m => !m.bad && /session SST du 14 oct/.test(m.text)), chk.msgs.map(m => m.text).join(' | '));
  assert.ok(chk.msgs.some(m => !m.bad && /Entretien annuel d’évaluation planifié le 14 oct/.test(m.text)));
  // Clara part aux États-Unis : un arrêt signalé pendant le déplacement est signalé, sans bloquer.
  const arret = checkNature(d, d.emp(19)!, 'ABSENCE', '2026-10-13', '2026-10-14', { quand: 'avant de signaler l’absence' });
  assert.equal(arret.cant, false);
  assert.ok(arret.msgs.some(m => !m.bad && /Déplacement prévu/.test(m.text)));
});

test('t088 les messages ne révèlent jamais une nature médicale', () => {
  const { run, domain } = fresh();
  run(RH, 'absence.saisir', { empId: 14, nature: 'MALADIE', du: '2026-11-02', au: '2026-11-06', justificatif: true, justificatifLe: '2026-10-10' });
  const d = domain();
  const c = conflitsDates(d, 14, '2026-11-04', '2026-11-04', 'entretien');
  assert.ok(c.some(x => x.bad));
  assert.ok(c.every(x => !/maladie/i.test(x.text)), JSON.stringify(c));
});
