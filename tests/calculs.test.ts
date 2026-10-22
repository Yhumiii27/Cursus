// Non-régression des défauts de calcul relevés par l'audit (lot 3) : statut des dossiers voyage vu du manager,
// semaines à cheval sur deux années, journées de plus de 24 h, RTT d'un contrat court, dates impossibles,
// clôture d'un entretien à venir, date du jour à Paris, imputation des congés payés sur leur période.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull, todayIso } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { debutJourParis, horodatageParis, isoParis, isValidDate, toIso } = await import('../shared/dates.ts');
const { buildSagePayload, calcSheet, cumulAnnuel } = await import('../shared/rules/temps.ts');
const { checkAbsence, cpInfo, rttDroit, reposForfait } = await import('../shared/rules/conges.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const { parseTrips } = await import('../shared/rules/imports.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Feuille = Dataset['feuilles'][number];
type Absence = Dataset['absences'][number];

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
const feuille = (empId: number, week: string, h: number[], id = 9000): Feuille =>
  ({ id, empId, week, statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-PROD', tache: '', ks: false, h }], contrat: null });

test('t075 le manager voit l’état du dossier voyage calculé par le serveur, vaccinations comprises', async () => {
  const { db, run, domain } = await fresh();
  // Romain (18, équipe de Karim) : fièvre jaune et e-Visa à jour, passeport valide jusqu'en 2029.
  await run(RH, 'formalite.enregistrer', { empId: 18, kind: 'vaccin', v: 'fj', date: '2020-05-04' });
  await run(RH, 'formalite.enregistrer', { empId: 18, kind: 'visa', dest: 'CI', visaType: 'e-Visa d’affaires', obtenu: '2026-10-01', expire: '2027-09-30' });
  await run(RH, 'voyage.creer', { empId: 18, dest: 'CI', depart: '2026-12-07', retour: '2026-12-11', motif: 'Mise en service — Abidjan' });
  // Certificat de sécurité sociale du détachement obtenu : le dossier est complet.
  await run(RH, 'voyage.detachement', { id: (await domain()).tripsAll().find(t => t.empId === 18 && t.dest === 'CI')!.id, detachementLe: '2026-10-09' });
  const rh = (await domain()).tripsAll().find(t => t.empId === 18 && t.dest === 'CI')!;
  assert.equal(rh.r.status, 'pret');
  // Le manager ne reçoit pas les vaccinations : sans l'état précalculé, il verrait « À compléter ».
  const dm = new Domain(await buildSnapshot(db, mgr(12)));
  const vu = dm.tripsAll().find(t => t.id === rh.id)!;
  assert.equal(dm.tripStatus(vu), 'pret');
  assert.equal(vu.r.status, 'pret', 'prochain déplacement de la fiche (Équipe) : état du serveur');
});

test('t076 semaine à cheval sur deux années : année ISO pour Sage, cumul annuel ventilé jour par jour', async () => {
  const { domain } = await fresh();
  const d0 = await domain();
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

test('t077 journée de plus de 24 h refusée, motif exigé au-delà de 10 h par jour ou 48 h par semaine', async () => {
  const { db, run, refused, domain } = await fresh();
  const w = '2026-10-19', base = { empId: 1, week: w };
  await run(collab(1), 'temps.addLine', { ...base, projet: 'INT-LOG' });
  await run(collab(1), 'temps.addLine', { ...base, projet: 'INT-PROD' });
  await run(collab(1), 'temps.setCell', { ...base, li: 0, di: 0, value: '20' });
  await refused(collab(1), 'temps.setCell', { ...base, li: 1, di: 0, value: '20' }, /24 h/);
  await run(collab(1), 'temps.setCell', { ...base, li: 1, di: 0, value: '4' });
  for (const di of [1, 2, 3, 4]) await run(collab(1), 'temps.setCell', { ...base, li: 0, di, value: '7' });
  const sh = async () => (await domain()).ds.feuilles.find(f => f.empId === 1 && f.week === w)!;
  assert.deepEqual(calcSheet(await domain(), (await domain()).emp(1)!, await sh()).perDay, [24, 7, 7, 7, 7, 0, 0]);
  await refused(collab(1), 'temps.submit', base, /motif/i);
  await run(collab(1), 'temps.submit', { ...base, motif: 'Panne de la ligne 2, intervention de nuit' });
  assert.equal((await sh()).statut, 'soumise');
  assert.equal((await sh()).motifDepassement, 'Panne de la ligne 2, intervention de nuit');
  // Feuille écrite avant le contrôle (deux lignes de 20 h le même jour) : ni soumise, ni validée.
  await db.update('feuilles', (await sh()).id, { statut: 'brouillon', lignes: [{ projet: 'INT-LOG', tache: '', ks: false, h: [20, 7, 7, 7, 7] }, { projet: 'INT-PROD', tache: '', ks: false, h: [20, 0, 0, 0, 0] }] });
  await refused(collab(1), 'temps.submit', { ...base, motif: 'x' }, /24 h/);
  await db.update('feuilles', (await sh()).id, { statut: 'soumise' });
  await refused(mgr(16), 'temps.validate', base, /24 h/);
  // Sans dépassement, aucun motif n'est demandé.
  await run(collab(1), 'temps.addLine', { empId: 1, week: '2026-11-02', projet: 'INT-LOG' });
  for (const di of [0, 1, 2, 3, 4]) await run(collab(1), 'temps.setCell', { empId: 1, week: '2026-11-02', li: 0, di, value: '7' });
  await run(collab(1), 'temps.submit', { empId: 1, week: '2026-11-02' });
});

test('t077 dépassement introduit par le valideur : motif exigé à la validation', async () => {
  const { run, refused, domain } = await fresh();
  const w = '2026-10-19', base = { empId: 1, week: w };
  await run(collab(1), 'temps.addLine', { ...base, projet: 'INT-LOG' });
  for (const di of [0, 1, 2, 3, 4]) await run(collab(1), 'temps.setCell', { ...base, li: 0, di, value: '7' });
  await run(collab(1), 'temps.submit', base);
  await run(mgr(16), 'temps.setCell', { ...base, li: 0, di: 2, value: '12' });
  await refused(mgr(16), 'temps.validate', base, /motif/i);
  await run(mgr(16), 'temps.validate', { ...base, motif: 'Inventaire annuel' });
  const sh = (await domain()).ds.feuilles.find(f => f.empId === 1 && f.week === w)!;
  assert.equal(sh.statut, 'validee');
  assert.equal(sh.motifDepassement, 'Inventaire annuel');
});

test('t077 le motif du salarié n’est pas remplacé par celui du valideur', async () => {
  const { run, domain } = await fresh();
  const w = '2026-10-19', base = { empId: 1, week: w };
  await run(collab(1), 'temps.addLine', { ...base, projet: 'INT-LOG' });
  for (const di of [0, 1, 2, 3, 4]) await run(collab(1), 'temps.setCell', { ...base, li: 0, di, value: di === 0 ? '12' : '7' });
  await run(collab(1), 'temps.submit', { ...base, motif: 'Inventaire annuel demandé par le chef d’atelier' });
  // Le valideur corrige la feuille, toujours au-delà de 10 h, et envoie son propre motif : celui du salarié reste.
  await run(mgr(16), 'temps.setCell', { ...base, li: 0, di: 1, value: '11' });
  await run(mgr(16), 'temps.validate', { ...base, motif: 'Choix personnel du salarié' });
  const sh = (await domain()).ds.feuilles.find(f => f.empId === 1 && f.week === w)!;
  assert.equal(sh.statut, 'validee');
  assert.equal(sh.motifDepassement, 'Inventaire annuel demandé par le chef d’atelier');
});

test('t078 RTT et jours de repos proratisés de l’entrée à la fin du contrat', async () => {
  const { domain } = await fresh();
  const d0 = await domain();
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
  // Un mois compte si le salarié est présent à la mi-mois : une semaine à cheval sur deux mois ne donne aucun jour.
  for (const [entree, fin] of [['2026-03-30', '2026-04-03'], ['2026-06-29', '2026-07-03']]) {
    const semaine = avec(2, { typeContrat: 'cdd', entree, fin, tempsDepuis: null });
    assert.equal(rttDroit(semaine, semaine.emp(2)!), 0, `${entree} → ${fin}`);
  }
  const quinzaine = avec(2, { typeContrat: 'cdd', entree: '2026-03-09', fin: '2026-03-20', tempsDepuis: null });
  assert.equal(rttDroit(quinzaine, quinzaine.emp(2)!), Math.round(23 / 12));
  // Entrée après la mi-mars, passage au régime après la mi-septembre : le mois commencé ne compte pas.
  const mars = avec(2, { entree: '2026-03-20', tempsDepuis: null });
  assert.equal(rttDroit(mars, mars.emp(2)!), Math.round(23 * 9 / 12));
  const regime = avec(2, { tempsDepuis: '2026-09-21' });
  assert.equal(rttDroit(regime, regime.emp(2)!), Math.round(23 * 3 / 12));
});

test('t079 dates impossibles refusées (saisie, import CSV, actions)', async () => {
  for (const s of ['2026-02-31', '2026-13-45', '2026-02-29', '2026-04-31', '2026-00-10']) assert.equal(isValidDate(s), false, s);
  for (const s of ['2024-02-29', '2026-12-31', '2026-01-01']) assert.equal(isValidDate(s), true, s);
  assert.equal(toIso('31/02/2026'), null);
  assert.equal(toIso('45.13.2026'), null);
  assert.equal(toIso('29/02/2024'), '2024-02-29');
  const { run, refused, domain } = await fresh();
  const rows = parseTrips(await domain(), 'reference;collaborateur;destination;depart;retour;motif\nDD-1;Clara Roussel;Maroc;31/02/2027;03/03/2027;Salon');
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].errs.includes('Dates invalides'));
  await refused(RH, 'voyage.creer', { empId: 19, dest: 'MA', depart: '2027-02-31', retour: '2027-03-02', motif: 'Salon' }, /Dates/);
  await refused(RH, 'entretien.planifier', { empId: 14, kind: 'epp', date: '2026-11-31' }, /Date/);
  await refused(RH, 'absence.saisir', { empId: 14, nature: 'MARIAGE', du: '2026-11-31', au: '2026-12-02' }, /./);
  await refused(collab(1), 'absence.demander', { empId: 1, kind: 'CP', du: '2026-11-31', au: '2026-12-02' }, /./);
  await refused(RH, 'cert.ajouter', { empId: 1, f: 'sst', date: '2026-02-30' }, /Date/);
  assert.equal((await domain()).ds.absences.some(a => a.du === '2026-11-31'), false);
  await run(RH, 'cert.ajouter', { empId: 1, f: 'prap', date: '2026-02-28' });
  // Date du jour figée invalide : ignorée.
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = '2026-02-31';
  try { assert.notEqual(todayIso(), '2026-02-31'); } finally { process.env.CURSUS_TODAY = avant; }
});

test('t094 une échéance tombe au dernier jour du mois cible quand son jour n’y existe pas', async () => {
  const { addM, iso, parse } = await import('../shared/dates.ts');
  // 29 février + 36 mois : le 28 février, jamais le 1er mars (titre valide un jour de trop).
  assert.equal(addM('2024-02-29', 36), '2027-02-28');
  assert.equal(addM('2024-02-29', 48), '2028-02-29');
  assert.equal(addM('2027-01-31', 1), '2027-02-28');
  assert.equal(addM('2028-01-31', 1), '2028-02-29');
  assert.equal(addM('2026-08-31', 6), '2027-02-28');
  assert.equal(addM('2027-08-31', 6), '2028-02-29');
  assert.equal(addM('2026-03-31', 6), '2026-09-30');
  assert.equal(addM('2026-03-31', -1), '2026-02-28');
  // Jour présent dans le mois cible : inchangé.
  assert.equal(addM('2026-10-10', 12), '2027-10-10');
  assert.equal(addM('2026-12-31', 1), '2027-01-31');
  // Échéances calculées à l'affichage : certification (ATEX, 36 mois) et habilitation (AIPR, 60 mois) du 29 février.
  const { db, domain } = await fresh();
  await db.insert('certifications', { empId: 1, f: 'atex', obtenue: '2024-02-29', sessionId: null, convoc: null, convocLe: null });
  await db.insert('habTitres', { empId: 1, h: 'aipr', delivree: '2024-02-29', par: 'Karim Haddad', demande: null });
  const camille = (await domain()).enrich(90, false).find(e => e.id === 1)!;
  assert.equal(iso(camille.rawCerts.find(c => c.f === 'atex')!.exp), '2027-02-28');
  assert.equal(iso(camille.habs.find(h => h.h === 'aipr')!.exp!), '2029-02-28');
  // Non-régression du jeu de démonstration : chaque échéance tombe dans le mois cible, au même jour que le titre,
  // ou au dernier jour du mois quand ce jour n'y existe pas.
  const d = await domain(), emps = d.enrich(90, false);
  const conforme = (base: string, mois: number, exp: Date) => {
    const b = parse(base), ecart = exp.getFullYear() * 12 + exp.getMonth() - (b.getFullYear() * 12 + b.getMonth());
    const dernier = new Date(exp.getFullYear(), exp.getMonth() + 1, 0).getDate();
    return ecart === mois && (exp.getDate() === b.getDate() || (exp.getDate() === dernier && b.getDate() > dernier));
  };
  let n = 0;
  for (const e of emps) {
    for (const c of [...e.rawCerts, ...e.anciennes]) { n++; assert.ok(conforme(c.obtenue, c.fm.validite, c.exp), `${e.nom} · ${c.f}`); }
    for (const h of e.habs.filter(x => x.delivree)) { n++; assert.ok(conforme(h.delivree!, h.hm.validite, h.exp!), `${e.nom} · ${h.h}`); }
  }
  assert.ok(n > 50, 'titres du jeu de démonstration contrôlés');
});

test('t080 un entretien ne se clôt pas avant sa date ; la clôture enregistre la date réelle', async () => {
  const { run, refused, domain } = await fresh();
  const x = (await domain()).ds.entretiens.find(e => e.empId === 1 && e.statut === 'planifie')!;
  assert.equal(x.date, '2026-10-14');
  await refused(RH, 'entretien.clore', { id: x.id }, /prévu le/);
  await refused(RH, 'entretien.clore', { id: x.id, date: '2026-10-12' }, /aujourd’hui au plus tard/);
  await refused(RH, 'entretien.clore', { id: x.id, date: '2026-02-31' }, /Date/);
  await run(RH, 'entretien.clore', { id: x.id, date: '2026-10-09' });
  const y = (await domain()).ds.entretiens.find(e => e.id === x.id)!;
  assert.equal(y.statut, 'realise');
  assert.equal(y.date, '2026-10-09');
  assert.equal(y.signMgr, '2026-10-10');
});

test('t080 la date réelle saisie à la clôture n’est pas antérieure à la planification', async () => {
  const { run, refused, domain } = await fresh();
  // Manon (21, équipe d'Antoine) : un seul entretien de parcours sur 8 ans, risque d'abondement correctif du CPF.
  const bilan = async () => obligations(await domain(), [21]).find(o => o.kind === 'bilan')!;
  const avant = await bilan();
  assert.equal(avant.risk, true);
  assert.match(avant.detail, /^1 entretien de parcours sur 8 ans/);
  await run(mgr(14), 'entretien.planifier', { empId: 21, kind: 'epp', date: '2026-11-16' });
  const x = (await domain()).ds.entretiens.find(e => e.empId === 21 && e.type === 'epp' && e.statut === 'planifie')!;
  assert.equal(x.planifieLe, '2026-10-10');
  await refused(mgr(14), 'entretien.clore', { id: x.id, date: '2021-03-15' }, /le 10 oct\. 2026 au plus tôt \(entretien planifié le 10 oct\. 2026\)/);
  await refused(mgr(14), 'entretien.clore', { id: x.id, date: '2026-10-09' }, /au plus tôt/);
  assert.equal((await domain()).ds.entretiens.find(e => e.id === x.id)!.statut, 'planifie');
  assert.deepEqual([(await bilan()).detail, (await bilan()).risk], [avant.detail, avant.risk]);
  // Tenu le jour même de sa planification : accepté.
  await run(mgr(14), 'entretien.clore', { id: x.id, date: '2026-10-10' });
  // Planifié avant que Cursus conserve ce jour (base existante) : 30 jours au plus avant aujourd'hui pour un entretien
  // à venir ; passé, pas avant sa date prévue.
  const prevu = async (empId: number) => (await domain()).ds.entretiens.find(e => e.empId === empId && e.type === 'annuel' && e.statut === 'planifie')!;
  assert.equal((await prevu(1)).planifieLe, null);
  await refused(RH, 'entretien.clore', { id: (await prevu(1)).id, date: '2026-09-09' }, /le 10 sept\. 2026 au plus tôt/);
  const avantJour = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = '2026-10-25';
  try {
    await refused(RH, 'entretien.clore', { id: (await prevu(2)).id, date: '2026-10-19' }, /le 20 oct\. 2026 au plus tôt \(entretien prévu le 20 oct\. 2026\)/);
    await run(RH, 'entretien.clore', { id: (await prevu(2)).id, date: '2026-10-22' });
  } finally { process.env.CURSUS_TODAY = avantJour; }
  await run(RH, 'entretien.clore', { id: (await prevu(1)).id, date: '2026-09-10' });
});

test('t083 date du jour et horodatage dans le fuseau Europe/Paris, quel que soit celui du serveur', async () => {
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
    // Minuit à Paris (bornes des filtres du journal) : hiver, été, et les deux jours de changement d'heure.
    assert.equal(debutJourParis('2026-01-15'), '2026-01-14T23:00:00.000Z');
    assert.equal(debutJourParis('2026-07-15'), '2026-07-14T22:00:00.000Z');
    assert.equal(debutJourParis('2026-03-29'), '2026-03-28T23:00:00.000Z');
    assert.equal(debutJourParis('2026-10-25'), '2026-10-24T22:00:00.000Z');
    const avant = process.env.CURSUS_TODAY;
    delete process.env.CURSUS_TODAY;
    try { assert.equal(todayIso(new Date('2026-03-01T23:15:00Z')), '2026-03-02'); } finally { process.env.CURSUS_TODAY = avant; }
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  // Transmission à Sage : heure réelle de l'envoi, décalage d'hiver.
  const { domain } = await fresh();
  const p = buildSagePayload(await domain(), [], 'TEST', new Date('2026-01-15T08:05:09Z'));
  assert.equal(p.envoye_le, '2026-01-15T09:05:09+01:00');
});

/** Camille (1, 35 h, 25 j acquis par an) sans compteur repris ni absence : seules les absences données comptent. */
async function camille(today: string, absences: Partial<Absence>[], fiche: Partial<Dataset['employes'][number]> = {}) {
  const { domain } = await fresh();
  const d0 = await domain();
  const abs = absences.map((a, i) => ({ id: 9000 + i, empId: 1, type: 'CP', statut: 'validee', keystone: false, ...a }) as Absence);
  const d = new Domain({
    ...d0.ds, today,
    employes: d0.ds.employes.map(e => e.id === 1 ? { ...e, ...fiche } : e),
    absences: [...d0.ds.absences.filter(a => a.empId !== 1), ...abs],
    soldesReprise: d0.ds.soldesReprise.filter(s => s.empId !== 1),
  });
  return { d, e: d.emp(1)! };
}

test('t086 un CP de l’été prochain est imputé sur la période en cours d’acquisition', async () => {
  const { d, e } = await camille('2026-10-10', [{ du: '2027-07-05', au: '2027-07-09' }]);
  const cp = cpInfo(d, e)!;
  assert.equal(cp.droit, 25);
  assert.equal(cp.pris, 0, 'rien n’est pris sur la période 2025-2026');
  assert.equal(cp.solde, 25);
  assert.equal(cp.suivante, 5, 'cinq jours imputés sur la période 2026-2027');
  assert.equal(cp.anticipes, 0);
});

test('t086 les jours de juin d’un congé commencé en mai sont décomptés sur la nouvelle période', async () => {
  // Du lundi 24 mai au vendredi 4 juin 2027 : 6 jours en mai, 4 en juin.
  const mai = await camille('2027-05-20', [{ du: '2027-05-24', au: '2027-06-04' }]);
  assert.equal(cpInfo(mai.d, mai.e)!.pris, 6);
  assert.equal(cpInfo(mai.d, mai.e)!.suivante, 4);
  const juin = await camille('2027-06-15', [{ du: '2027-05-24', au: '2027-06-04' }]);
  const cp = cpInfo(juin.d, juin.e)!;
  assert.equal(cp.periodes.label, '2026-2027');
  assert.equal(cp.pris, 4);
  assert.equal(cp.solde, 25 - 4);
});

test('t086 les CP pris par anticipation sont déduits de la période suivante au 1er juin', async () => {
  // Du 2 novembre au 11 décembre 2026 : 29 jours ouvrés (11 novembre férié), pour 25 acquis.
  const conge = { du: '2026-11-02', au: '2026-12-11' };
  const oct = await camille('2026-10-10', [conge]);
  const cp = cpInfo(oct.d, oct.e)!;
  assert.equal(cp.pris, 25);
  assert.equal(cp.solde, 0);
  assert.equal(cp.anticipes, 4);
  assert.equal(cp.suivante, 4);
  const juin = await camille('2027-06-15', [conge]);
  const apres = cpInfo(juin.d, juin.e)!;
  assert.equal(apres.pris, 4, 'jours anticipés imputés sur la période 2026-2027');
  assert.equal(apres.solde, 21);
});

test('t086 59 ans dans l’année : les 5 jours de la CCN restent acquis à la période après le 1er juin', async () => {
  // Camille née en 1968 : 59 ans en 2027. 24 jours en juillet-août 2026 (14 juillet férié), 5 en avril 2027.
  const conges = [{ du: '2026-07-06', au: '2026-08-07' }, { du: '2027-04-12', au: '2027-04-16' }];
  const au = async (today: string) => { const { d, e } = await camille(today, conges, { naissance: 1968 }); return cpInfo(d, e)!; };
  // Jusqu'en décembre 2026, période 2025-2026 sans supplément : un jour d'avril sur ses 25 jours, 4 anticipés.
  const oct = await au('2026-10-10');
  assert.deepEqual([oct.droit, oct.ageSupp, oct.pris, oct.solde, oct.anticipes], [25, 0, 25, 0, 4]);
  // Dès janvier 2027, l'année des 59 ans : 30 jours, les jours d'avril tiennent dans la période.
  const mai = await au('2027-05-20');
  assert.deepEqual([mai.droit, mai.ageSupp, mai.pris, mai.solde, mai.anticipes], [30, 5, 29, 1, 0]);
  // Au 1er juin, la période passée garde ses 30 jours : rien n'est repris sur la nouvelle.
  const juin = await au('2027-06-15');
  assert.equal(juin.periodes.label, '2026-2027');
  assert.deepEqual([juin.droit, juin.pris, juin.solde], [30, 0, 30]);
});

test('t086 anticipation dans la limite des jours acquis à la date du congé', async () => {
  const { d, e } = await camille('2026-10-10', [{ du: '2026-11-02', au: '2026-12-11' }]);
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

test('t086 une demande ne prive pas une absence déjà posée de ses jours', async () => {
  // 20 jours validés en avril 2027. Une demande en décembre passe avant eux dans l'imputation : les jours d'avril
  // qui dépassent alors le solde sont anticipés, dans la limite des jours acquis en avril (10 mois, ≈ 20,8 j).
  const { d, e } = await camille('2026-10-10', [{ du: '2027-04-05', au: '2027-04-30' }]);
  assert.equal(cpInfo(d, e)!.solde, 5);
  const chk = checkAbsence(d, e, 'CP', '2026-12-07', '2026-12-18');
  assert.equal(chk.cant, false, chk.msgs.map(m => m.text).join(' | '));
  // 25 jours validés de mi-novembre à mi-décembre : une demande d'octobre les repousserait au-delà des jours acquis.
  const plein = await camille('2026-10-10', [{ du: '2026-11-16', au: '2026-12-18' }]);
  assert.equal(cpInfo(plein.d, plein.e)!.solde, 0);
  assert.equal(checkAbsence(plein.d, plein.e, 'CP', '2026-10-19', '2026-11-06').cant, true);
});

test('t086 demande d’été par l’action : solde de la période en cours inchangé', async () => {
  const { run, domain } = await fresh();
  const avant = cpInfo(await domain(), (await domain()).emp(1)!)!.solde;
  await run(collab(1), 'absence.demander', { empId: 1, kind: 'CP', du: '2027-07-05', au: '2027-07-09' });
  const cp = cpInfo(await domain(), (await domain()).emp(1)!)!;
  assert.equal(cp.solde, avant);
  assert.equal(cp.suivante, 5);
});
