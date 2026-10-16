// Non-régression des défauts confirmés par la revue contradictoire (contrats, équipes, managers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet, cumulAnnuel, sageRubriques } = await import('../shared/rules/temps.ts');
const { cetInfo, recupInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const { profilOf, validerProfil } = await import('../shared/rules/profil.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const mgr = (empId: number): User => ({ role: 'manager', empId, nom: `#${empId}`, intitule: '' });
const collab = (empId: number): User => ({ role: 'collaborateur', empId, nom: `#${empId}`, intitule: '' });

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const refused = (user: User, name: string, payload: Record<string, unknown>, status = 403) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === status, `${name} devait être refusé (${status})`);
  const domain = () => new Domain(loadFull(db, RH));
  return { db, run, refused, domain };
}
const ligne = (h: number[]) => ({ lignes: [{ projet: 'X', tache: '', ks: false, h }] });

test('#1 pas de validation croisée entre managers', () => {
  const { refused, run } = fresh();
  refused(mgr(12), 'equipe.affecter', { empId: 16, equipe: 'Maintenance' }); // Hugo encadre Logistique
  run(RH, 'equipe.creer', { nom: 'Direction technique', managerId: 9 });
  run(RH, 'equipe.affecter', { empId: 12, equipe: 'Direction technique' }); // Karim a pour manager Nadia
  refused(mgr(12), 'equipe.affecter', { empId: 9, equipe: 'Maintenance' }); // son propre manager
});

test('#2 #4 aucune donnée de santé dans le périmètre du manager', () => {
  const { db, run } = fresh();
  run(collab(2), 'formalite.enregistrer', { empId: 2, kind: 'vaccin', v: 'fj', date: '2026-09-01' });
  run(RH, 'employe.modifier', { id: 6, repriseMotif: 'congé sabbatique', repriseDate: '2026-09-15' });
  const s = buildSnapshot(db, mgr(12));
  assert.ok(!s.demandesCollab.some(r => r.type === 'document' && r.empId !== 12));
  assert.equal(s.employes.find(e => e.id === 6)!.repriseMotif, 'absence longue');
});

test('#3 #33 inscription : bonne formation, session à venir, sans double comptage', () => {
  const { run, domain } = fresh();
  const d = domain();
  const elec = d.emp(2)!.certs.find(c => c.f === 'elec')!;
  assert.throws(() => run(mgr(12), 'plan.inscrire', { empId: 2, certId: elec.id, sessionId: 13 }), /autre formation/);
  const sst = d.emp(1)!.certs.find(c => c.f === 'sst')!; // déjà inscrite en session 1
  const avant = (id: number) => d.session(id)!.inscrits;
  run(RH, 'plan.inscrire', { empId: 1, certId: sst.id, sessionId: 2 });
  run(RH, 'plan.inscrire', { empId: 1, certId: sst.id, sessionId: 2 });
  const s = domain().ds.sessions;
  assert.equal(s.find(x => x.id === 1)!.inscrits, avant(1) - 1, 'ancienne place libérée');
  assert.equal(s.find(x => x.id === 2)!.inscrits, avant(2) + 1, 'compté une seule fois');
});

test('#6 #32 #31 demande de formation : session contrôlée, inscription en formation initiale', () => {
  const { run, domain } = fresh();
  assert.throws(() => run(mgr(12), 'demande.formation', { empId: 18, f: 'aipr', sessionId: 9, motif: 'x' }), /Session invalide/);
  const dem = domain().ds.demandesCollab.find(r => r.empId === 13 && r.f === 'caces489')!; // Marion n'a jamais eu le CACES
  const avant = domain().session(4)!.inscrits;
  run(RH, 'demande.accepter', { id: dem.id });
  const d = domain();
  assert.ok(d.ds.inscriptions.some(i => i.empId === 13 && i.sessionId === 4));
  assert.equal(d.ds.sessions.find(s => s.id === 4)!.inscrits, avant + 1);
  run(RH, 'cert.ajouter', { empId: 13, f: 'caces489', date: '2026-11-26' });
  assert.ok(!domain().ds.inscriptions.some(i => i.empId === 13), 'clôturée par la certification');
});

test('#8 #24 #35 un intérimaire n’est jamais manager', () => {
  const { run } = fresh();
  assert.throws(() => run(RH, 'equipe.creer', { nom: 'Test', managerId: 15 }), /intérimaire/);
  assert.throws(() => run(RH, 'employe.modifier', { id: 16, typeContrat: 'interim', agence: 'X' }), /désignez d’abord un autre manager/);
});

test('#9 champs mal typés : refus 400', () => {
  const { refused } = fresh();
  refused(mgr(12), 'employe.modifier', { id: 24, poste: { a: 1 } }, 400);
});

test('#10 #30 changement de régime : historique figé, RTT au prorata', () => {
  const { run, domain } = fresh();
  const d0 = domain();
  const nico = d0.emp(22)!;
  const recupAvant = recupInfo(d0, nico)!.acq;
  // RTT de l'année déjà pris, que le 35 h n'ouvre pas : le changement se confirme (garde-fou, tests/sorties.test.ts).
  assert.throws(() => run(RH, 'employe.modifier', { id: 22, temps: '35h' }), /Confirmez le changement/);
  run(RH, 'employe.modifier', { id: 22, temps: '35h', confirmerRtt: true });
  const d1 = domain();
  assert.equal(recupInfo(d1, d1.emp(22)!)!.acq, recupAvant, 'semaines validées recalculées avec leur régime');
  assert.equal(d1.emp(22)!.tempsDepuis, '2026-10-07');
  run(RH, 'employe.modifier', { id: 1, temps: '39h_rtt', tempsDepuis: '2026-10-01' });
  const d2 = domain();
  assert.equal(rttInfo(d2, d2.emp(1)!)!.droit, Math.round(23 * 3 / 12), 'RTT d’octobre à décembre');
  const sh = d2.ds.feuilles.find(f => f.empId === 9 && f.statut === 'validee')!;
  const avant = sageRubriques(d2, d2.emp(9)!, sh);
  run(RH, 'employe.modifier', { id: 9, temps: '35h', confirmerRtt: true });
  const d3 = domain();
  assert.deepEqual(sageRubriques(d3, d3.emp(9)!, d3.ds.feuilles.find(f => f.id === sh.id)!), avant);
});

test('#11 #12 alertes et heures incluses selon le régime', () => {
  const { domain } = fresh();
  const d = domain();
  const forfait = calcSheet(d, d.emp(9)!, ligne([12, 12, 12, 12, 2]));
  assert.ok(!forfait.warn.some(w => w.includes('L3121-18') || w.includes('L3121-20')));
  const hebdo46 = { ...d.emp(14)!, heures: 46 };
  const c = calcSheet(d, hebdo46, ligne([10, 10, 10, 10, 6]));
  assert.equal(c.incluses25, 8);
  assert.equal(c.incluses50, 3);
  const base = profilOf(d.emp(14)!);
  const opts = { equipes: d.equipes, year: 2026 };
  assert.ok(!validerProfil({ ...base, heures: 47 }, opts).ok);
  assert.ok(validerProfil({ ...base, heures: 45 }, opts).warnings.length > 0);
});

test('#13 #14 #15 #19 contrôles de fiche', () => {
  const { domain, run } = fresh();
  const d = domain();
  const opts = { equipes: d.equipes, year: 2026 };
  const marion = profilOf(d.emp(7)!);
  assert.ok(!validerProfil({ ...marion, heures: 30, jourOff: [0, 1, 2] }, opts).ok, '15 h par jour');
  const lea = profilOf(d.emp(15)!);
  assert.ok(!validerProfil({ ...lea, temps: 'forfait_jours' }, opts).ok, 'intérim au forfait');
  run(RH, 'employe.modifier', { id: 15, temps: '39h_rtt' });
  const d2 = domain();
  assert.equal(rttInfo(d2, d2.emp(15)!), null);
  assert.equal(cetInfo(d2, d2.emp(15)!).placeRtt, 0);
  const elodie = profilOf(d.emp(11)!);
  assert.ok(validerProfil({ ...elodie, forfaitHeures: 1200 }, opts).warnings.some(w => w.includes('temps partiel')));
  const bastien = profilOf(d.emp(24)!);
  const alt = validerProfil({ ...bastien, fin: null }, opts);
  assert.ok(alt.ok && alt.warnings.some(w => w.includes('CDI')));
});

test('#16 CP d’un temps partiel : décompte à partir du premier jour travaillé', () => {
  const { domain } = fresh();
  const d = domain();
  const aicha = d.emp(7)!; // mercredi non travaillé
  assert.equal(d.countDays(aicha, '2026-10-14', '2026-10-14', 'CP'), 0);
  assert.equal(d.countDays(aicha, '2026-10-14', '2026-10-16', 'CP'), 2);
  assert.equal(d.countDays(aicha, '2026-10-12', '2026-10-16', 'CP'), 5, 'jour non travaillé à l’intérieur de la période');
});

test('#17 #18 entretien forfait et cumul annuel selon les dates', () => {
  const { run, domain } = fresh();
  run(RH, 'employe.modifier', { id: 1, statut: 'cadre', temps: 'forfait_jours' });
  const d = domain();
  const o = obligations(d, [1]).find(x => x.kind === 'forfait')!;
  assert.equal(o.due, '2027-10-07');
  const elodie = { ...d.emp(11)!, entree: '2026-09-01' };
  const cum = cumulAnnuel(d, elodie, 2026);
  assert.ok(cum.cible < 600, 'cible proratisée sur 4 mois de présence');
});

test('#36 démo : forfait hebdomadaire à 38,5 h avec heures incluses', () => {
  const { domain } = fresh();
  const d = domain();
  const sh = d.ds.feuilles.find(f => f.empId === 14 && f.statut === 'validee')!;
  assert.equal(calcSheet(d, d.emp(14)!, sh).total, 38.5);
  assert.equal(sageRubriques(d, d.emp(14)!, sh).HSF25, 3.5);
});

test('#19 alternance : fin facultative mais contrôlée si saisie', () => {
  const { domain } = fresh();
  const d = domain();
  const opts = { equipes: d.equipes, year: 2026 };
  const bastien = profilOf(d.emp(24)!);
  assert.ok(!validerProfil({ ...bastien, fin: '2020-01-01' }, opts).ok, 'fin avant l’entrée');
  assert.ok(!validerProfil({ ...bastien, fin: 'abc' }, opts).ok, 'date invalide');
  assert.equal(validerProfil({ ...bastien, fin: '2027-08-31' }, opts).profil.fin, '2027-08-31');
});

test('changement sans nouveau régime de temps : effet au jour de la modification', () => {
  const { run, domain } = fresh();
  run(RH, 'employe.modifier', { id: 13, heures: 24, tempsDepuis: '2026-09-14' });
  run(collab(13), 'temps.addLine', { empId: 13, week: '2026-09-14', projet: 'INT-PROD' });
  run(RH, 'employe.modifier', { id: 13, jourOff: [0], tempsDepuis: '2026-09-14' });
  const d = domain();
  assert.equal(d.emp(13)!.tempsDepuis, '2026-09-14', 'date d’effet du régime conservée');
  const sh = d.ds.feuilles.find(f => f.empId === 13 && f.week === '2026-09-14')!;
  assert.deepEqual(sh.contrat?.jourOff, [3, 4], 'semaine antérieure figée avec les anciens jours non travaillés');
});
