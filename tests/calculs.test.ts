// Non-régression des défauts de calcul relevés par l'audit (lot 3) : statut des dossiers voyage vu du manager,
// semaines à cheval sur deux années, journées de plus de 24 h, RTT d'un contrat court, dates impossibles,
// clôture d'un entretien à venir, date du jour à Paris, imputation des congés payés sur leur période.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull, todayIso } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { horodatageParis, isoParis, isValidDate, toIso } = await import('../shared/dates.ts');
const { buildSagePayload, calcSheet, cumulAnnuel } = await import('../shared/rules/temps.ts');
const { checkAbsence, cpInfo, rttDroit, reposForfait } = await import('../shared/rules/conges.ts');
const { parseTrips } = await import('../shared/rules/imports.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Dataset = ReturnType<typeof loadFull>;
type Feuille = Dataset['feuilles'][number];
type Absence = Dataset['absences'][number];

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
const feuille = (empId: number, week: string, h: number[], id = 9000): Feuille =>
  ({ id, empId, week, statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-PROD', tache: '', ks: false, h }], contrat: null });

test('t075 le manager voit l’état du dossier voyage calculé par le serveur, vaccinations comprises', () => {
  const { db, run, domain } = fresh();
  // Romain (18, équipe de Karim) : fièvre jaune et e-Visa à jour, passeport valide jusqu'en 2029.
  run(RH, 'formalite.enregistrer', { empId: 18, kind: 'vaccin', v: 'fj', date: '2020-05-04' });
  run(RH, 'formalite.enregistrer', { empId: 18, kind: 'visa', dest: 'CI', visaType: 'e-Visa d’affaires', obtenu: '2026-10-01', expire: '2027-09-30' });
  run(RH, 'voyage.creer', { empId: 18, dest: 'CI', depart: '2026-12-07', retour: '2026-12-11', motif: 'Mise en service — Abidjan' });
  const rh = domain().tripsAll().find(t => t.empId === 18 && t.dest === 'CI')!;
  assert.equal(rh.r.status, 'pret');
  // Le manager ne reçoit pas les vaccinations : sans l'état précalculé, il verrait « À compléter ».
  const dm = new Domain(buildSnapshot(db, mgr(12)));
  const vu = dm.tripsAll().find(t => t.id === rh.id)!;
  assert.equal(dm.tripStatus(vu), 'pret');
  assert.equal(vu.r.status, 'pret', 'prochain déplacement de la fiche (Équipe) : état du serveur');
});

test('t076 semaine à cheval sur deux années : année ISO pour Sage, cumul annuel ventilé jour par jour', () => {
  const { domain } = fresh();
  const d0 = domain();
  // Semaine du lundi 29 décembre 2025 : semaine 1 de 2026 (le jeudi 1er janvier est en 2026, et férié).
  const s1 = feuille(11, '2025-12-29', [8, 8, 8, 0, 8]);
  const s53 = feuille(11, '2026-12-28', [7, 7, 7, 7, 0], 9001);
  const s2027 = feuille(11, '2027-01-04', [7, 7, 7, 7, 7], 9002);
  const d = new Domain({ ...d0.ds, feuilles: [s1, s53, s2027] });
  const p = buildSagePayload(d, [s1, s53, s2027], 'TEST');
  assert.deepEqual(p.lignes.map(l => l.semaine), ['2026-S01', '2026-S53', '2027-S01']);
  const e = d.emp(11)!;
  // Lundi à mercredi en 2025, vendredi en 2026 ; jeudi 31 décembre 2026 en 2026, rien le vendredi 1er janvier 2027.
  assert.equal(cumulAnnuel(d, e, 2025).done, 24);
  assert.equal(cumulAnnuel(d, e, 2026).done, 8 + 28);
  assert.equal(cumulAnnuel(d, e, 2027).done, 35);
});

test('t077 journée de plus de 24 h refusée, motif exigé au-delà de 10 h par jour ou 48 h par semaine', () => {
  const { db, run, refused, domain } = fresh();
  const w = '2026-10-19', base = { empId: 1, week: w };
  run(collab(1), 'temps.addLine', { ...base, projet: 'INT-LOG' });
  run(collab(1), 'temps.addLine', { ...base, projet: 'INT-PROD' });
  run(collab(1), 'temps.setCell', { ...base, li: 0, di: 0, value: '20' });
  refused(collab(1), 'temps.setCell', { ...base, li: 1, di: 0, value: '20' }, /24 h/);
  run(collab(1), 'temps.setCell', { ...base, li: 1, di: 0, value: '4' });
  [1, 2, 3, 4].forEach(di => run(collab(1), 'temps.setCell', { ...base, li: 0, di, value: '7' }));
  const sh = () => domain().ds.feuilles.find(f => f.empId === 1 && f.week === w)!;
  assert.deepEqual(calcSheet(domain(), domain().emp(1)!, sh()).perDay, [24, 7, 7, 7, 7]);
  refused(collab(1), 'temps.submit', base, /motif/i);
  run(collab(1), 'temps.submit', { ...base, motif: 'Panne de la ligne 2, intervention de nuit' });
  assert.equal(sh().statut, 'soumise');
  assert.equal(sh().motifDepassement, 'Panne de la ligne 2, intervention de nuit');
  // Feuille écrite avant le contrôle (deux lignes de 20 h le même jour) : ni soumise, ni validée.
  db.update('feuilles', sh().id, { statut: 'brouillon', lignes: [{ projet: 'INT-LOG', tache: '', ks: false, h: [20, 7, 7, 7, 7] }, { projet: 'INT-PROD', tache: '', ks: false, h: [20, 0, 0, 0, 0] }] });
  refused(collab(1), 'temps.submit', { ...base, motif: 'x' }, /24 h/);
  db.update('feuilles', sh().id, { statut: 'soumise' });
  refused(mgr(16), 'temps.validate', base, /24 h/);
  // Sans dépassement, aucun motif n'est demandé.
  run(collab(1), 'temps.addLine', { empId: 1, week: '2026-11-02', projet: 'INT-LOG' });
  [0, 1, 2, 3, 4].forEach(di => run(collab(1), 'temps.setCell', { empId: 1, week: '2026-11-02', li: 0, di, value: '7' }));
  run(collab(1), 'temps.submit', { empId: 1, week: '2026-11-02' });
});

test('t077 dépassement introduit par le valideur : motif exigé à la validation', () => {
  const { run, refused, domain } = fresh();
  const w = '2026-10-19', base = { empId: 1, week: w };
  run(collab(1), 'temps.addLine', { ...base, projet: 'INT-LOG' });
  [0, 1, 2, 3, 4].forEach(di => run(collab(1), 'temps.setCell', { ...base, li: 0, di, value: '7' }));
  run(collab(1), 'temps.submit', base);
  run(mgr(16), 'temps.setCell', { ...base, li: 0, di: 2, value: '12' });
  refused(mgr(16), 'temps.validate', base, /motif/i);
  run(mgr(16), 'temps.validate', { ...base, motif: 'Inventaire annuel' });
  const sh = domain().ds.feuilles.find(f => f.empId === 1 && f.week === w)!;
  assert.equal(sh.statut, 'validee');
  assert.equal(sh.motifDepassement, 'Inventaire annuel');
});

test('t078 RTT et jours de repos proratisés de l’entrée à la fin du contrat', () => {
  const { domain } = fresh();
  const d0 = domain();
  const avec = (id: number, patch: Partial<Dataset['employes'][number]>) =>
    new Domain({ ...d0.ds, employes: d0.ds.employes.map(e => e.id === id ? { ...e, ...patch } : e) });
  // CDD de janvier à mars, 39 h avec RTT : 3 mois sur 12.
  const cdd = avec(2, { typeContrat: 'cdd', entree: '2026-01-05', fin: '2026-03-31', tempsDepuis: null });
  assert.equal(rttDroit(cdd, cdd.emp(2)!), Math.round(23 * 3 / 12));
  // Forfait jours d'avril à septembre : 6 mois.
  const fj = avec(9, { typeContrat: 'cdd', entree: '2026-04-01', fin: '2026-09-30', tempsDepuis: null });
  assert.equal(rttDroit(fj, fj.emp(9)!), Math.round(reposForfait(2026) * 6 / 12));
  // Fin de contrat l'an prochain : droit de l'année entière ; contrat terminé avant l'année : aucun droit.
  const long = avec(2, { typeContrat: 'cdd', entree: '2025-06-02', fin: '2027-05-31', tempsDepuis: null });
  assert.equal(rttDroit(long, long.emp(2)!), 23);
  const fini = avec(2, { typeContrat: 'cdd', entree: '2025-01-06', fin: '2025-12-19', tempsDepuis: null });
  assert.equal(rttDroit(fini, fini.emp(2)!), 0);
});

test('t079 dates impossibles refusées (saisie, import CSV, actions)', () => {
  for (const s of ['2026-02-31', '2026-13-45', '2026-02-29', '2026-04-31', '2026-00-10']) assert.equal(isValidDate(s), false, s);
  for (const s of ['2024-02-29', '2026-12-31', '2026-01-01']) assert.equal(isValidDate(s), true, s);
  assert.equal(toIso('31/02/2026'), null);
  assert.equal(toIso('45.13.2026'), null);
  assert.equal(toIso('29/02/2024'), '2024-02-29');
  const { run, refused, domain } = fresh();
  const rows = parseTrips(domain(), 'reference;collaborateur;destination;depart;retour;motif\nDD-1;Clara Roussel;Maroc;31/02/2027;03/03/2027;Salon');
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].errs.includes('Dates invalides'));
  refused(RH, 'voyage.creer', { empId: 19, dest: 'MA', depart: '2027-02-31', retour: '2027-03-02', motif: 'Salon' }, /Dates/);
  refused(RH, 'entretien.planifier', { empId: 14, kind: 'epp', date: '2026-11-31' }, /Date/);
  refused(RH, 'absence.saisir', { empId: 14, nature: 'MARIAGE', du: '2026-11-31', au: '2026-12-02' }, /./);
  refused(collab(1), 'absence.demander', { empId: 1, kind: 'CP', du: '2026-11-31', au: '2026-12-02' }, /./);
  refused(RH, 'cert.ajouter', { empId: 1, f: 'sst', date: '2026-02-30' }, /Date/);
  assert.equal(domain().ds.absences.some(a => a.du === '2026-11-31'), false);
  run(RH, 'cert.ajouter', { empId: 1, f: 'prap', date: '2026-02-28' });
  // Date du jour figée invalide : ignorée.
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = '2026-02-31';
  try { assert.notEqual(todayIso(), '2026-02-31'); } finally { process.env.CURSUS_TODAY = avant; }
});

test('t080 un entretien ne se clôt pas avant sa date ; la clôture enregistre la date réelle', () => {
  const { run, refused, domain } = fresh();
  const x = domain().ds.entretiens.find(e => e.empId === 1 && e.statut === 'planifie')!;
  assert.equal(x.date, '2026-10-14');
  refused(RH, 'entretien.clore', { id: x.id }, /prévu le/);
  refused(RH, 'entretien.clore', { id: x.id, date: '2026-10-12' }, /aujourd’hui au plus tard/);
  refused(RH, 'entretien.clore', { id: x.id, date: '2026-02-31' }, /Date/);
  run(RH, 'entretien.clore', { id: x.id, date: '2026-10-09' });
  const y = domain().ds.entretiens.find(e => e.id === x.id)!;
  assert.equal(y.statut, 'realise');
  assert.equal(y.date, '2026-10-09');
  assert.equal(y.signMgr, '2026-10-10');
});

test('t083 date du jour et horodatage dans le fuseau Europe/Paris, quel que soit celui du serveur', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    // Entre minuit et 2 h à Paris, il est encore la veille en UTC.
    assert.equal(isoParis(new Date('2026-01-14T23:30:00Z')), '2026-01-15');
    assert.equal(isoParis(new Date('2026-07-14T22:30:00Z')), '2026-07-15');
    assert.equal(isoParis(new Date('2026-07-14T21:30:00Z')), '2026-07-14');
    assert.equal(horodatageParis(new Date('2026-01-15T08:05:09Z')), '2026-01-15T09:05:09+01:00');
    assert.equal(horodatageParis(new Date('2026-07-15T08:05:09Z')), '2026-07-15T10:05:09+02:00');
    assert.equal(horodatageParis(new Date('2026-03-29T00:30:00Z')), '2026-03-29T01:30:00+01:00');
    assert.equal(horodatageParis(new Date('2026-03-29T01:30:00Z')), '2026-03-29T03:30:00+02:00');
    const avant = process.env.CURSUS_TODAY;
    delete process.env.CURSUS_TODAY;
    try { assert.equal(todayIso(new Date('2026-03-01T23:15:00Z')), '2026-03-02'); } finally { process.env.CURSUS_TODAY = avant; }
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  // Transmission à Sage : heure réelle de l'envoi, décalage d'hiver.
  const { domain } = fresh();
  const p = buildSagePayload(domain(), [], 'TEST', new Date('2026-01-15T08:05:09Z'));
  assert.equal(p.envoye_le, '2026-01-15T09:05:09+01:00');
});

/** Camille (1, 35 h, 25 j acquis par an) sans compteur repris ni absence : seules les absences données comptent. */
function camille(today: string, absences: Partial<Absence>[]) {
  const { domain } = fresh();
  const d0 = domain();
  const abs = absences.map((a, i) => ({ id: 9000 + i, empId: 1, type: 'CP', statut: 'validee', keystone: false, ...a }) as Absence);
  const d = new Domain({
    ...d0.ds, today,
    absences: [...d0.ds.absences.filter(a => a.empId !== 1), ...abs],
    soldesReprise: d0.ds.soldesReprise.filter(s => s.empId !== 1),
  });
  return { d, e: d.emp(1)! };
}

test('t086 un CP de l’été prochain est imputé sur la période en cours d’acquisition', () => {
  const { d, e } = camille('2026-10-10', [{ du: '2027-07-05', au: '2027-07-09' }]);
  const cp = cpInfo(d, e)!;
  assert.equal(cp.droit, 25);
  assert.equal(cp.pris, 0, 'rien n’est pris sur la période 2025-2026');
  assert.equal(cp.solde, 25);
  assert.equal(cp.suivante, 5, 'cinq jours imputés sur la période 2026-2027');
  assert.equal(cp.anticipes, 0);
});

test('t086 les jours de juin d’un congé commencé en mai sont décomptés sur la nouvelle période', () => {
  // Du lundi 24 mai au vendredi 4 juin 2027 : 6 jours en mai, 4 en juin.
  const mai = camille('2027-05-20', [{ du: '2027-05-24', au: '2027-06-04' }]);
  assert.equal(cpInfo(mai.d, mai.e)!.pris, 6);
  assert.equal(cpInfo(mai.d, mai.e)!.suivante, 4);
  const juin = camille('2027-06-15', [{ du: '2027-05-24', au: '2027-06-04' }]);
  const cp = cpInfo(juin.d, juin.e)!;
  assert.equal(cp.periodes.label, '2026-2027');
  assert.equal(cp.pris, 4);
  assert.equal(cp.solde, 25 - 4);
});

test('t086 les CP pris par anticipation sont déduits de la période suivante au 1er juin', () => {
  // Du 2 novembre au 11 décembre 2026 : 29 jours ouvrés (11 novembre férié), pour 25 acquis.
  const conge = { du: '2026-11-02', au: '2026-12-11' };
  const oct = camille('2026-10-10', [conge]);
  const cp = cpInfo(oct.d, oct.e)!;
  assert.equal(cp.pris, 25);
  assert.equal(cp.solde, 0);
  assert.equal(cp.anticipes, 4);
  assert.equal(cp.suivante, 4);
  const juin = camille('2027-06-15', [conge]);
  const apres = cpInfo(juin.d, juin.e)!;
  assert.equal(apres.pris, 4, 'jours anticipés imputés sur la période 2026-2027');
  assert.equal(apres.solde, 21);
});

test('t086 anticipation dans la limite des jours acquis à la date du congé', () => {
  const { d, e } = camille('2026-10-10', [{ du: '2026-11-02', au: '2026-12-11' }]);
  // Janvier 2027 : 7 mois acquis sur la période 2026-2027 (≈ 14,6 j), dont 4 déjà anticipés.
  const court = checkAbsence(d, e, 'CP', '2027-01-04', '2027-01-08');
  assert.equal(court.cant, false);
  assert.ok(court.msgs.some(m => !m.bad && /anticipation/.test(m.text)));
  const long = checkAbsence(d, e, 'CP', '2027-01-04', '2027-01-29');
  assert.equal(long.cant, true);
  assert.ok(long.msgs.some(m => m.bad && /Solde insuffisant/.test(m.text)));
  // L'été suivant : imputé sur les 25 jours de la période 2026-2027, moins les 4 anticipés.
  const ete = checkAbsence(d, e, 'CP', '2027-07-05', '2027-07-30');
  assert.equal(ete.cant, false, ete.msgs.map(m => m.text).join(' | '));
  assert.ok(ete.msgs.some(m => /2026-2027/.test(m.text)));
  assert.match(ete.soldeLabel, /Disponible sur la période 2026-2027 : 21 j/);
  const trop = checkAbsence(d, e, 'CP', '2027-06-07', '2027-07-30');
  assert.equal(trop.cant, true);
});

test('t086 une demande ne prive pas une absence déjà posée de ses jours', () => {
  // 20 jours validés en avril 2027. Une demande en décembre passe avant eux dans l'imputation : les jours d'avril
  // qui dépassent alors le solde sont anticipés, dans la limite des jours acquis en avril (10 mois, ≈ 20,8 j).
  const { d, e } = camille('2026-10-10', [{ du: '2027-04-05', au: '2027-04-30' }]);
  assert.equal(cpInfo(d, e)!.solde, 5);
  const chk = checkAbsence(d, e, 'CP', '2026-12-07', '2026-12-18');
  assert.equal(chk.cant, false, chk.msgs.map(m => m.text).join(' | '));
  // 25 jours validés de mi-novembre à mi-décembre : une demande d'octobre les repousserait au-delà des jours acquis.
  const plein = camille('2026-10-10', [{ du: '2026-11-16', au: '2026-12-18' }]);
  assert.equal(cpInfo(plein.d, plein.e)!.solde, 0);
  assert.equal(checkAbsence(plein.d, plein.e, 'CP', '2026-10-19', '2026-11-06').cant, true);
});

test('t086 demande d’été par l’action : solde de la période en cours inchangé', () => {
  const { run, domain } = fresh();
  const avant = cpInfo(domain(), domain().emp(1)!)!.solde;
  run(collab(1), 'absence.demander', { empId: 1, kind: 'CP', du: '2027-07-05', au: '2027-07-09' });
  const cp = cpInfo(domain(), domain().emp(1)!)!;
  assert.equal(cp.solde, avant);
  assert.equal(cp.suivante, 5);
});
