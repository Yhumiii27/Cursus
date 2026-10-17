// Lot 5, chantier C, étape 2 (t041) : acquisition des congés payés pendant les arrêts (loi 2024-364), report de 15 mois
// calculé à la clôture et information du salarié à son retour (art. L3141-19-3).
// - acquisition mois par mois : maladie de 3 mois (2 jours ouvrables par mois au minimum légal, réglage « assimilé »),
//   accident du travail d'un an (travail effectif, sans limite), arrêt longue maladie d'un an (plafond de 20 jours ouvrés),
//   congé parental (prorata), absence courte (équivalence de l'art. L3141-4), mémoïsation par instantané ;
// - salarié repris de Lucca avec un arrêt en 2026 : le solde à la date d'arrêté reste celui de Lucca ;
// - clôture : report imposé des jours acquis pendant l'arrêt et de ceux qu'il a empêché de prendre, échéance prolongée
//   par l'information ;
// - information au retour : tâche du service RH, e-mail au salarié sans la nature de l'arrêt, enregistrement, reports
//   légaux prolongés, confidentialité (manager, profils restreints), journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace, pourLecteur } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { NATURES_ABSENCE } = await import('../shared/constants.ts');
const { acquisitionPeriode, acquisPendantArret, acquisPendantArrets, effetAcquisition, joursAcquis, joursEmpeches } = await import('../shared/rules/acquisition-cp.ts');
const { cpInfo, soldePeriode } = await import('../shared/rules/conges.ts');
const { echeanceReportArret, lignesClotureCp } = await import('../shared/rules/clotures.ts');
const { contenuInformation, retoursAInformer } = await import('../shared/rules/information-retour.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Dataset = ReturnType<typeof loadFull>;
type Absence = Dataset['absences'][number];

const ADMIN: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '', profilRh: 'rh_admin' };
const GEST: User = { role: 'rh', empId: null, nom: 'Antoine Leroy', intitule: '', profilRh: 'rh_gestionnaire', salarieId: 14 };
const PAIE: User = { role: 'rh', empId: null, nom: 'Aïcha Diallo', intitule: '', profilRh: 'paie', salarieId: 7 };
const LECTURE: User = { role: 'rh', empId: null, nom: 'Élodie Bernard', intitule: '', profilRh: 'lecture_seule', salarieId: 11 };
const SOPHIE: User = { role: 'manager', empId: 3, nom: 'Sophie Lemaire', intitule: '' };
const collab = (empId: number): User => ({ role: 'collaborateur', empId, nom: `#${empId}`, intitule: '' });

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, payload);
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refused = (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, status?: number) =>
    assert.throws(() => run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message) && (!status || e.status === status), `${name} devait être refusé (${motif})`);
  const arret = (empId: number, type: string, du: string, au: string) => db.insert<Absence>('absences', {
    empId, type, du, au, statut: 'validee', keystone: true, justificatif: true, justificatifLe: du,
  });
  const domain = (today?: string) => { const ds = loadFull(db, ADMIN); return new Domain(today ? { ...ds, today } : ds); };
  return { db, run, refused, arret, domain };
}

/** Domaine de démonstration avec des absences ajoutées (sans contrôle) et des réglages modifiés. */
const base = (() => { const db = new Db(':memory:'); seedDemo(db); return loadFull(db, ADMIN); })();
let n = 9000;
function avec(absences: Partial<Absence>[], settings: Partial<Dataset['settings']> = {}, ds: Dataset = base, today = '2026-10-10') {
  const ajout = absences.map(a => ({ id: ++n, empId: 3, statut: 'validee', keystone: true, justificatif: true, ...a }) as Absence);
  return new Domain({ ...ds, today, absences: [...ds.absences, ...ajout], settings: { ...ds.settings, ...settings } });
}
const sophie = (d: InstanceType<typeof Domain>) => d.emp(3)!;
const proche = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('t041 natures : effet sur l’acquisition de chacune (assimilé, maladie, non), absence à qualifier comme une maladie', () => {
  const par = (effet: string) => Object.entries(NATURES_ABSENCE).filter(([, n]) => n.cpAcquisition === effet).map(([k]) => k).sort();
  assert.deepEqual(par('maladie'), ['ALD', 'MALADIE']);
  assert.deepEqual(par('non'), ['ENFANT_MALADE', 'INJUSTIFIEE', 'PARENTAL', 'SANS_SOLDE']);
  for (const t of ['AT', 'TRAJET', 'MP', 'MATERNITE', 'PATERNITE', 'ADOPTION', 'MARIAGE', 'NAISSANCE', 'DECES_PROCHE', 'DEUIL_ENFANT']) assert.ok(par('assimile').includes(t), t);
  assert.equal(effetAcquisition({ type: 'ABSENCE' }), 'maladie');
  assert.equal(effetAcquisition({ type: 'CP' }), null, 'un congé est du travail effectif');
  assert.equal(effetAcquisition({ type: 'ABSENCE', cpAcquisition: 'assimile' }), 'assimile', 'absence masquée du profil paie');
});

test('t041 maladie de 3 mois : 2 jours ouvrables par mois d’arrêt au minimum légal, travail effectif si le réglage l’assimile', () => {
  const sans = avec([]);
  assert.equal(joursAcquis(sans, sophie(sans), 2027), 25);
  const mal = { type: 'MALADIE' as const, du: '2026-11-01', au: '2027-01-31' };
  const d = avec([mal]), x = acquisitionPeriode(d, sophie(d), 2027);
  // Novembre, décembre, janvier : 5/3 de jour ouvré chacun ; les 9 autres mois 25/12.
  proche(x.mois[5], 5 / 3);
  proche(x.mois[4], 25 / 12);
  proche(x.total, 9 * 25 / 12 + 5);
  proche(x.maladie, 5);
  assert.equal(joursAcquis(d, sophie(d), 2027), 24, '23,75 j arrondis au jour supérieur');
  proche(acquisPendantArrets(d, sophie(d), 2027), 5);
  // Accord ou CCN plus favorable confirmé : la maladie compte comme du travail effectif.
  const assimilee = avec([mal], { cpMaladie: 'assimile' });
  assert.equal(joursAcquis(assimilee, sophie(assimilee), 2027), 25);
  proche(acquisPendantArrets(assimilee, sophie(assimilee), 2027), 3 * 25 / 12);
  // Demi-mois d'arrêt : la moitié du mois en travail, l'autre moitié à 2 jours ouvrables par mois.
  const demi = avec([{ type: 'MALADIE', du: '2026-11-16', au: '2026-11-30' }]);
  proche(acquisitionPeriode(demi, sophie(demi), 2027).mois[5], 25 / 12 / 2 + 5 / 3 / 2);
  // Une absence encore à qualifier compte comme une maladie (elle est protégée).
  const signalee = avec([{ type: 'ABSENCE', du: '2026-11-01', au: '2027-01-31', statut: 'signalee' }]);
  proche(acquisitionPeriode(signalee, sophie(signalee), 2027).total, x.total);
  // Absence annulée ou refusée : sans effet.
  const annulee = avec([{ ...mal, statut: 'annulee' }]);
  assert.equal(joursAcquis(annulee, sophie(annulee), 2027), 25);
  // Le solde en tient compte : période en cours d'acquisition (affichée « en cours ») et droits de la période.
  assert.equal(cpInfo(sans, sophie(sans))!.enCours, 8.3);
  const enCours = avec([{ type: 'MALADIE', du: '2026-07-01', au: '2026-08-31' }]);
  assert.equal(cpInfo(enCours, sophie(enCours))!.enCours, 7.5, '2 mois à 25/12, 2 mois à 5/3');
});

test('t041 accident du travail d’un an : travail effectif sans limite ; arrêt longue maladie d’un an : 20 jours ouvrés au plus', () => {
  const at = avec([{ type: 'AT', du: '2026-06-01', au: '2027-05-31' }]);
  assert.equal(joursAcquis(at, sophie(at), 2027), 25, 'plus de limite d’un an (loi 2024-364)');
  proche(acquisPendantArrets(at, sophie(at), 2027), 25);
  const ald = avec([{ type: 'ALD', du: '2026-06-01', au: '2027-05-31' }]);
  const x = acquisitionPeriode(ald, sophie(ald), 2027);
  proche(x.maladie, 20);
  assert.equal(joursAcquis(ald, sophie(ald), 2027), 20, '24 jours ouvrables par période');
  // Arrêt à cheval sur deux périodes de référence : jours acquis pendant l'arrêt sur chacune.
  const cheval = avec([{ id: 8001, type: 'MALADIE', du: '2026-04-01', au: '2026-07-31' }]);
  proche(acquisPendantArret(cheval, sophie(cheval), { id: 8001, du: '2026-04-01', au: '2026-07-31' }), 4 * 5 / 3);
  proche(acquisPendantArrets(cheval, sophie(cheval), 2026), 2 * 5 / 3);
});

test('t041 congé parental : acquisition au prorata ; absence courte : un mois entier par équivalence (art. L3141-4)', () => {
  const parental = avec([{ type: 'PARENTAL', du: '2026-09-01', au: '2027-02-28' }]);
  const x = acquisitionPeriode(parental, sophie(parental), 2027);
  assert.deepEqual(x.mois.map(m => (m === 0 ? 0 : 1)), [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
  assert.equal(joursAcquis(parental, sophie(parental), 2027), 13, '6 mois à 25/12 : 12,5 j arrondis');
  assert.equal(acquisPendantArrets(parental, sophie(parental), 2027), 0, 'pas un arrêt protégé : rien à reporter');
  // 3 jours sans solde : il reste 4 semaines de travail, le mois compte en entier.
  const court = avec([{ type: 'SANS_SOLDE', du: '2026-10-05', au: '2026-10-07' }]);
  proche(acquisitionPeriode(court, sophie(court), 2027).mois[4], 25 / 12);
  // 10 jours sans solde : 21 jours de travail, 18 jours ouvrables ; prorata des jours du mois.
  const long = avec([{ type: 'SANS_SOLDE', du: '2026-10-01', au: '2026-10-10' }]);
  proche(acquisitionPeriode(long, sophie(long), 2027).mois[4], 25 / 12 * 21 / 31);
  // Événement familial : travail effectif.
  const mariage = avec([{ type: 'MARIAGE', du: '2026-10-05', au: '2026-10-30' }]);
  proche(acquisitionPeriode(mariage, sophie(mariage), 2027).mois[4], 25 / 12);
  // Hors contrat à la mi-mois : rien, comme avant.
  const lucas = avec([]);
  assert.equal(acquisitionPeriode(lucas, lucas.emp(4)!, 2027).mois[8], 0, 'CDD terminé le 29 janvier');
});

test('t041 mémoïsation : un calcul par salarié et par période pour un instantané, refait sur un nouvel instantané', () => {
  const d = avec([{ type: 'MALADIE', du: '2026-11-01', au: '2027-01-31' }]);
  const x = acquisitionPeriode(d, sophie(d), 2027);
  assert.equal(acquisitionPeriode(d, sophie(d), 2027), x, 'même objet : pas de nouveau calcul');
  assert.notEqual(acquisitionPeriode(d, { ...sophie(d), fin: '2026-12-31' }, 2027), x, 'fiche aux dates modifiées : autre calcul');
  const autre = avec([]);
  assert.notEqual(acquisitionPeriode(autre, sophie(autre), 2027), x);
  assert.equal(joursAcquis(autre, sophie(autre), 2027), 25);
});

test('t041 salarié repris de Lucca avec un arrêt en 2026 : le solde à la date d’arrêté reste celui de Lucca', () => {
  const ds: Dataset = {
    ...base,
    soldesReprise: base.soldesReprise.map(s => s.empId === 3 ? { ...s, arreteLe: '2027-01-01', cpPris: 0, cpSolde: 12, cpSoldeSuivant: 9.5 } : s),
  };
  // Arrêt de février à avril 2026 (période de référence 2025-2026) et de septembre à octobre 2026 (période en cours d'acquisition).
  const arrets = [{ type: 'MALADIE' as const, du: '2026-02-01', au: '2026-04-30' }, { type: 'MALADIE' as const, du: '2026-09-01', au: '2026-10-31' }];
  for (const d of [avec([], {}, ds, '2027-01-01'), avec(arrets, {}, ds, '2027-01-01')]) {
    assert.equal(cpInfo(d, sophie(d))!.solde, 12, 'CP N-1 de Lucca');
    // CP N : les 9,5 j de Lucca, plus les 5 mois de janvier à mai à acquérir.
    proche(soldePeriode(d, sophie(d), 2027) - (joursAcquis(d, sophie(d), 2027) - (acquisitionPeriode(d, sophie(d), 2027).mois.slice(0, 7).reduce((s, m) => s + m, 0) - 9.5)), 0);
  }
  const d = avec(arrets, {}, ds, '2027-01-01');
  proche(acquisitionPeriode(d, sophie(d), 2027).total, 10 * 25 / 12 + 2 * 5 / 3);
  proche(acquisitionPeriode(d, sophie(d), 2026).total, 9 * 25 / 12 + 3 * 5 / 3);
  // Retour d'arrêt antérieur à la mise en service, délai d'un mois échu : l'information relevait de l'ancien outil.
  assert.ok(!retoursAInformer(d).some(r => r.e.id === 3));
});

test('t041 clôture : report imposé des jours acquis pendant l’arrêt et de ceux qu’il a empêché de prendre, au demi-jour', () => {
  const { domain, arret } = fresh();
  // Mehdi : maladie de janvier à mars 2026 (période de référence 2025-2026).
  arret(2, 'MALADIE', '2026-01-01', '2026-03-31');
  const l = lignesClotureCp(domain('2027-06-15'), 2026).find(x => x.e.id === 2)!;
  assert.deepEqual([l.impose, l.acquisArret, l.empeches, l.legal, l.expireLegal], ['report_legal', 5, 0, 5, '2028-08-31']);
  assert.ok(l.solde > 5, 'le reste du solde est au choix du service RH');
  // Sophie : accident du travail de 3 jours ouvrés en juin 2026, pendant la période de prise.
  arret(3, 'AT', '2026-06-08', '2026-06-10');
  const m = lignesClotureCp(domain('2027-06-15'), 2026).find(x => x.e.id === 3)!;
  assert.deepEqual([m.impose, m.empeches, m.legal], ['report_legal', 3, 3]);
  // Congé parental : rien d'imposé.
  arret(18, 'PARENTAL', '2025-09-01', '2026-02-28');
  assert.equal(lignesClotureCp(domain('2027-06-15'), 2026).find(x => x.e.id === 18)!.impose, null);
  // Jours au demi-jour supérieur : 1 mois d'arrêt maladie (1,67 j) donne 2 j imposés.
  arret(22, 'MALADIE', '2025-11-01', '2025-11-30');
  const nicolas = lignesClotureCp(domain('2027-06-15'), 2026).find(x => x.e.id === 22)!;
  assert.deepEqual([nicolas.acquisArret, nicolas.legal], [1.67, 2]);
  assert.equal(joursEmpeches(domain('2027-06-15'), domain().emp(22)!, 2026), 0);
});

test('t041 information au retour : tâche du service RH, e-mail sans la nature, enregistrement, reports prolongés', () => {
  const { db, run, refused, arret, domain } = fresh();
  // Marion (13) : arrêt maladie du 5 au 7 octobre (démonstration), reprise le 8, information attendue avant le 8 novembre.
  const t = retoursAInformer(domain()).find(r => r.e.id === 13)!;
  assert.deepEqual([t.a.type, t.retour, t.avant, t.retard], ['MALADIE', '2026-10-08', '2026-11-08', false]);
  assert.equal(retoursAInformer(domain('2026-11-09')).find(r => r.e.id === 13)!.retard, true);
  // Arrêts qui se suivent : un seul retour, au dernier. Arrêt en cours : pas encore de retour.
  const a1 = arret(6, 'AT', '2026-09-07', '2026-09-18'), a2 = arret(6, 'MALADIE', '2026-09-21', '2026-10-02');
  arret(18, 'MALADIE', '2026-10-05', '2026-10-20');
  const ids = retoursAInformer(domain()).map(r => r.a.id);
  assert.ok(ids.includes(a2.id) && !ids.includes(a1.id));
  assert.ok(!retoursAInformer(domain()).some(r => r.e.id === 18), 'arrêt en cours');
  const id = (sql: string) => (db.sql.prepare(sql).get() as { id: number }).id;
  refused(ADMIN, 'conges.informer', { id: id(`SELECT id FROM absences WHERE emp_id = 18 AND type = 'MALADIE'`) }, /Absence en cours/);
  refused(ADMIN, 'conges.informer', { id: a1.id }, /suivie d’un autre arrêt/);
  refused(ADMIN, 'conges.informer', { id: id(`SELECT id FROM absences WHERE emp_id = 10 AND type = 'MARIAGE'`) }, /arrêt de maladie ou d’accident/, 404);
  refused(SOPHIE, 'conges.informer', { id: t.a.id }, /réservée au service RH/, 403);
  refused(PAIE, 'conges.informer', { id: t.a.id }, /réservée au service RH/, 403);
  // Un report légal de Marion courait pendant l'arrêt : il court 15 mois à compter de l'information.
  const r = db.insert<{ id: number }>('reports', { empId: 13, jours: 2, motif: 'Clôture — report légal', par: 'Sandrine Vidal', date: '2026-06-02', sens: 'recu', periode: 2026, expire: '2027-08-31' });
  const c = contenuInformation(domain(), domain().emp(13)!, t.a, '2026-10-10');
  const msg = run(ADMIN, 'conges.informer', { id: t.a.id });
  assert.match(msg, /^Information de Marion Petit sur ses congés \(absence du 5 oct\. au 7 oct\. 2026\) envoyée par e-mail — .* à prendre jusqu’au 31 mai 2027, report jusqu’au 31 août 2028 · 1 report légal prolongé jusqu’au 10 janv\. 2028$/);
  assert.equal(db.get<{ expire: string }>('reports', r.id)!.expire, '2028-01-10');
  const info = loadFull(db, ADMIN).informationsCp!.find(i => i.absenceId === t.a.id)!;
  assert.deepEqual([info.empId, info.le, info.jours, info.limite, info.echeance, info.par], [13, '2026-10-10', c.jours, '2027-05-31', '2028-08-31', 'Sandrine Vidal']);
  assert.equal(info.arret, 0, '3 jours d’arrêt : le mois compte en entier (équivalence), rien d’acquis au titre de l’arrêt');
  // E-mail au salarié : jours, date limite, échéance du report ; jamais la nature de l'arrêt.
  const mail = db.all<{ type: string; contenu: unknown }>('envois').filter(e => e.type === 'conges.information');
  assert.equal(mail.length, 1);
  const texte = JSON.stringify(mail[0].contenu);
  assert.match(texte, /Vos congés payés à votre retour/);
  assert.match(texte, /à prendre jusqu’au 31 mai 2027/);
  assert.match(texte, /reportés jusqu’au 31 août 2028/);
  assert.doesNotMatch(texte, /maladie|arrêt|accident/i);
  // Une seule information par arrêt : la tâche disparaît, une relance ne refait rien.
  assert.ok(!retoursAInformer(domain()).some(r => r.a.id === t.a.id));
  assert.match(run(ADMIN, 'conges.informer', { id: t.a.id }), /déjà donnée le 10 oct\. 2026/);
  assert.equal(loadFull(db, ADMIN).informationsCp!.length, 1);
  // Un membre du RH ne s'informe pas lui-même.
  const antoine = arret(14, 'MALADIE', '2026-09-28', '2026-10-02');
  refused(GEST, 'conges.informer', { id: antoine.id }, /propres congés/, 403);
  // Sans adresse : enregistrée, à remettre.
  db.update('employes', 6, { email: null });
  assert.match(run(ADMIN, 'conges.informer', { id: a2.id }), /enregistrée, sans e-mail \(aucune adresse\) : à lui remettre/);
  // Confidentialité : l'intéressé la voit ; ni son manager, ni les profils restreints.
  const vue = (u: User) => buildSnapshot(db, u).informationsCp ?? [];
  assert.equal(vue(collab(13)).length, 1);
  assert.equal(vue(collab(6)).length, 1);
  assert.equal(vue(SOPHIE).length, 0, 'Sophie, manager de Marion');
  assert.equal(vue(PAIE).length, 0);
  assert.equal(vue(LECTURE).length, 0);
  // Journal : arrêt visé, jour et échéances ; masqué à la lecture seule (il désigne un arrêt de santé).
  const j = db.sql.prepare(`SELECT payload, salaries, message FROM journal WHERE action = 'conges.informer' ORDER BY id LIMIT 1`).get() as { payload: string; salaries: string; message: string };
  assert.deepEqual(JSON.parse(j.payload), { id: t.a.id, le: '2026-10-10', jours: c.jours, arret: info.arret, limite: '2027-05-31', echeance: '2028-08-31' });
  assert.deepEqual(JSON.parse(j.salaries), [13]);
  const ligne = { action: 'conges.informer', message: j.message, details: { id: 1 } } as never;
  assert.equal((pourLecteur(LECTURE, [ligne])[0] as { message: string }).message, 'Détail réservé au service RH');
});

test('t041 échéance du report légal : 15 mois après l’information du salarié si elle est plus tardive', () => {
  const ds = { ...base, informationsCp: [{ id: 1, empId: 3, absenceId: 1, du: '2026-11-01', au: '2027-12-20', le: '2028-09-20', jours: 10, arret: 15, limite: '2029-05-31', echeance: '2029-12-20', par: 'RH' }] };
  const d = new Domain(ds);
  assert.equal(echeanceReportArret(d, 3, 2027), '2029-12-20');
  assert.equal(echeanceReportArret(d, 3, 2028), '2030-08-31', '15 mois après la fin de la période, plus tard que l’information');
  assert.equal(echeanceReportArret(d, 2, 2027), '2029-08-31', 'sans information : 15 mois après la fin de la période');
  assert.equal(echeanceReportArret(d, 3, 2030), '2032-08-31', 'information antérieure à la période : sans effet');
});

test('t041 profil paie : absence masquée avec son effet sur l’acquisition, soldes identiques à ceux du service RH', () => {
  const { db, arret } = fresh();
  // Accident du travail de Marion : la paie et le manager reçoivent « Absence ».
  arret(13, 'AT', '2026-06-01', '2026-09-30');
  const rh = new Domain(buildSnapshot(db, ADMIN)), paie = new Domain(buildSnapshot(db, PAIE)), mgr = new Domain(buildSnapshot(db, SOPHIE));
  const a = (d: InstanceType<typeof Domain>) => d.ds.absences.find(x => x.empId === 13 && x.du === '2026-06-01')!;
  assert.deepEqual([a(paie).type, a(paie).cpAcquisition], ['ABSENCE', 'assimile']);
  assert.deepEqual([a(mgr).type, a(mgr).cpAcquisition], ['ABSENCE', undefined], 'le manager ne reçoit pas l’effet (il trahirait l’accident)');
  const enCours = (d: InstanceType<typeof Domain>) => cpInfo(d, d.emp(13)!)!.enCours;
  assert.equal(enCours(paie), enCours(rh));
  assert.ok(enCours(mgr) < enCours(rh), 'le manager calcule comme une maladie : affichage approché, plus prudent');
  assert.doesNotMatch(JSON.stringify(buildSnapshot(db, PAIE).absences), /"AT"/);
});
