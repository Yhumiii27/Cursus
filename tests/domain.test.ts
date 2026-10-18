// Tests des règles métier partagées, sur le jeu de démonstration (date figée au 7 octobre 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const { cpPeriods, feriesOf, mondayOf } = await import('../shared/dates.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { checkAbsence, cpInfo, reposForfait, rttInfo } = await import('../shared/rules/conges.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const { parsePlan, SAMPLE_PLAN_CSV } = await import('../shared/rules/imports.ts');

const db = await nouvelleBase();
await seedDemo(db);
const ds = await loadFull(db, { role: 'rh', empId: null, nom: 'Test', intitule: '' });
const d = new Domain(ds);
const emps = d.enrich(90, false);
const byId = (id: number) => emps.find(e => e.id === id)!;

test('jeu de démonstration chargé', () => {
  assert.equal(ds.employes.length, 24);
  assert.equal(ds.sessions.length, 13);
  assert.equal(ds.referentiels.equipes.length, 6);
});

test('dates : fériés calculés et périodes de congés', () => {
  const f = feriesOf(2026);
  for (const s of ['2026-01-01', '2026-04-06', '2026-05-14', '2026-05-25', '2026-11-11']) assert.ok(f.has(s), s);
  assert.ok(feriesOf(2027).has('2027-03-29'));
  const p = cpPeriods('2026-10-07');
  assert.equal(p.label, '2025-2026');
  assert.equal(p.prisStart, '2026-06-01');
  assert.equal(p.monthsElapsed, 4);
  assert.equal(cpPeriods('2027-03-15').label, '2025-2026');
  assert.equal(mondayOf('2026-10-07'), '2026-10-05');
});

test('certifications : expirée, à renouveler, valide', () => {
  const mehdi = byId(2), camille = byId(1);
  assert.equal(mehdi.certs.find(c => c.f === 'elec')!.key, 'exp');
  assert.equal(mehdi.worst, 'exp');
  const sst = camille.certs.find(c => c.f === 'sst')!;
  assert.equal(sst.key, 'due');
  assert.ok(sst.session, 'inscription déjà planifiée');
  assert.equal(d.enrich(30, false).find(e => e.id === 1)!.certs.find(c => c.f === 'sst')!.key, 'ok');
});

test('habilitations : prérequis et aptitude médicale', () => {
  const thomas = byId(6);
  const he = thomas.habs.find(h => h.h === 'he')!;
  assert.equal(he.key, 'susp', 'aptitude médicale échue → suspendue');
  assert.ok(he.failing.some(c => c.type === 'med'));
  assert.equal(d.habAction(6, he)!.intent.type, 'medical');
  const bastien = byId(24);
  assert.equal(bastien.habs[0].key, 'pending');
});

test('formalités de voyage', () => {
  const romain = ds.voyages.find(v => v.empId === 18)!;
  assert.equal(d.readiness(d.emp(18)!, romain).status, 'pret');
  const karim = ds.voyages.find(v => v.empId === 12)!;
  const r = d.readiness(d.emp(12)!, karim);
  assert.equal(r.items.find(i => i.k === 'passeport')!.ok, false, 'validité < 6 mois après l’entrée');
  assert.equal(r.status, 'bloc');
});

test('Go / No Go Keystone', () => {
  const ch = d.evaluateChantiers(emps, d.tripsAll()).find(x => x.c.id === 'K-2614')!;
  assert.equal(ch.status, 'nogo');
  const payload = d.keystonePayload(ch, false, '2026-10-10T05:00:00.000Z');
  assert.equal(payload.statut, 'NO_GO');
  // Horodatage réel transmis tel quel (paramètre obligatoire : plus d'heure fictive « 07:00+02:00 »).
  assert.equal(payload.evalue_le, '2026-10-10T05:00:00.000Z');
  assert.equal(d.verdictKeystone(ch, false, '2026-10-10T05:00:00.000Z').evalue_le, '2026-10-10T05:00:00.000Z');
  assert.ok(payload.ressources.every(r => /^EMP-\d{4}$/.test(r.matricule)));
  assert.ok(payload.ressources.every(r => r.motifs.every(m => typeof m === 'string')), 'codes de motif uniquement');
});

test('feuilles de temps : heures supplémentaires et complémentaires', () => {
  const h39 = d.emp(2)!; // 39 h
  const c = calcSheet(d, h39, { lignes: [{ projet: 'X', tache: '', ks: false, h: [9, 9, 9, 9, 9] }] });
  assert.equal(c.total, 45);
  assert.equal(c.sup25, 4);
  assert.equal(c.sup50, 2);
  // Heures supplémentaires payées par défaut : aucun repos ; remplacées par un repos, 4 × 1,25 + 2 × 1,5.
  assert.equal(c.recup, 0);
  assert.equal(calcSheet(d, h39, { lignes: [{ projet: 'X', tache: '', ks: false, h: [9, 9, 9, 9, 9] }], heuresSup: 'repos' }).recup, 8);
  const partiel = d.emp(7)!; // 28 h
  const p = calcSheet(d, partiel, { lignes: [{ projet: 'X', tache: '', ks: false, h: [8, 8, 0, 8, 8] }] });
  assert.equal(p.hc10, 2.8);
  assert.ok(Math.abs(p.hc25 - 1.2) < 1e-9);
  const forfait = calcSheet(d, d.emp(9)!, { lignes: [{ projet: 'X', tache: '', ks: false, h: [8, 3, 0, 8, 8] }] });
  assert.equal(forfait.jours, 3.5);
  assert.ok(calcSheet(d, h39, { lignes: [{ projet: 'X', tache: '', ks: false, h: [11, 0, 0, 0, 0] }] }).warn.length > 0);
});

test('congés : décompte, soldes, forfait jours', () => {
  const e = d.emp(1)!;
  assert.equal(d.countDays(e, '2026-11-09', '2026-11-13', 'CP'), 4, '11 novembre férié');
  assert.equal(reposForfait(2026), 9);
  const cp = cpInfo(d, e)!;
  assert.equal(cp.droit, 25);
  assert.ok(cp.solde >= 0);
  assert.equal(cpInfo(d, d.emp(15)!), null, 'intérim : congés gérés par l’agence');
  assert.equal(cpInfo(d, d.emp(12)!)!.ageSupp, 5, '+5 jours à partir de 59 ans');
  assert.equal(rttInfo(d, d.emp(1)!), null, '35 h : pas de RTT');
  const chk = checkAbsence(d, e, 'CP', '2026-10-26', '2026-10-30');
  assert.ok(chk.cant, 'chevauche une demande existante');
  assert.ok(chk.msgs.some(m => m.bad && m.text.includes('existe déjà')));
});

test('entretiens obligatoires', () => {
  const o = obligations(d, ds.employes.map(e => e.id));
  assert.ok(o.some(x => x.id === 7 && x.kind === 'reprise'), 'entretien de reprise après congé parental');
  assert.ok(!o.some(x => x.id === 15), 'intérimaires exclus');
  assert.ok(o.some(x => x.kind === 'epp' && x.st === 'late'));
});

test('import du plan prévisionnel', () => {
  const rows = parsePlan(d, SAMPLE_PLAN_CSV);
  assert.equal(rows.length, 11);
  const stress = rows.find(r => r.libelle === 'Gestion du stress')!;
  assert.equal(stress.ok, false);
  assert.match(stress.errs[0], /Équipe inconnue/);
  const prap = rows.find(r => r.libelle === 'PRAP')!;
  assert.equal(prap.estime, true);
  assert.equal(prap.cout, 6 * 420);
});
