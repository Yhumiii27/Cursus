// Lot 6, chantier 3, étape 2 (t046) : congé principal et jours de fractionnement des congés payés.
// - seuils légaux en jours ouvrables convertis (5 ouvrés = 6 ouvrables), crédit de 1 ou 2 jours, 5e semaine exclue ;
// - imputation sur la période de CP : un congé de mai imputé à la période précédente compte hors période pour elle, pris
//   par anticipation il tombe dans la fenêtre de la nouvelle ;
// - congés continus (week-ends compris, demi-journée qui coupe) ; avertissements de `checkAbsence` (24 jours ouvrables
//   d'affilée, congé principal compromis, jours de fractionnement ouverts), jamais bloquants ;
// - alerte avant le 31 octobre, propositions à partir du 1er novembre (dates limites), règle « aucun jour » ;
// - action `conges.fractionnement` : crédit en report reçu compté dans les droits, renonciation, refus, journal, vues.
// - réglages : règle, référence de l'accord exigée, période réglable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const F = await import('../shared/rules/fractionnement.ts');
const { checkAbsence, cpDroit, soldePeriode } = await import('../shared/rules/conges.ts');
const { appliquerReglages, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof loadFull>;
type Absence = Dataset['absences'][number];
type Db = InstanceType<typeof Db>;

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  // Compteurs repris arrêtés au 1er janvier 2027 (mise en service) : les périodes de 2027 sont suivies par Cursus.
  db.sql.exec(`UPDATE soldes_reprise SET arrete_le = '2027-01-01'`);
  const compteDe = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId), role, methode: 'demo' })!;
  return { db, user, ADMIN: user(null, 'rh'), GEST: user(14, 'rh'), PAIE: user(7, 'rh'), HSE: user(23, 'rh') };
}

/** Exécute `fn` à la date `jour` (date du jour lue par l'instantané). */
function le<T>(jour: string, fn: () => T): T {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = jour;
  try { return fn(); } finally { process.env.CURSUS_TODAY = avant; }
}
function runner(db: Db) {
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : refus ${re}`);
  return { run, refus };
}

const { db: db0, ADMIN: ADMIN0 } = fresh();
const base = loadFull(db0, ADMIN0);
let n = 9000;
/** Domaine de démonstration (compteurs arrêtés au 1er janvier 2027) avec des congés de Sophie Lemaire ajoutés, à une date. */
function avec(conges: Partial<Absence>[], today = '2027-11-02', settings: Partial<Dataset['settings']> = {}, ds: Dataset = base) {
  const ajout = conges.map(a => ({ id: ++n, empId: 3, type: 'CP', statut: 'validee', keystone: true, ...a }) as Absence);
  return new Domain({ ...ds, today, absences: [...ds.absences, ...ajout], settings: { ...ds.settings, ...settings } });
}
const sophie = (d: InstanceType<typeof Domain>) => d.emp(3)!;
const etat = (d: InstanceType<typeof Domain>, A = 2027) => F.etatFractionnement(d, sophie(d), A);

test('t046 seuils : conversion ouvrés-ouvrables, 1 ou 2 jours, fenêtre réglable, libellés', () => {
  assert.deepEqual([F.ouvrables(20), F.ouvrables(10), F.ouvrables(5), F.ouvrables(2.5)], [24, 12, 6, 3]);
  assert.deepEqual([0, 2, 2.5, 4, 4.5, 5, 10, 20].map(F.joursFractionnement), [0, 0, 1, 1, 1, 2, 2, 2]);
  assert.deepEqual(F.fenetrePrincipale(undefined, 2027), { du: '2027-05-01', au: '2027-10-31' });
  assert.deepEqual(F.fenetrePrincipale({ fractionnementDebut: '06-01', fractionnementFin: '09-30' }, 2027), { du: '2027-06-01', au: '2027-09-30' });
  assert.equal(F.fenetreTexte(F.fenetrePrincipale(undefined, 2027)), 'du 1er mai au 31 octobre 2027');
  assert.equal(F.regleFractionnement(undefined), 'legal');
});

test('t046 réglages : règle légale par défaut, référence exigée pour un accord ou la renonciation, période ordonnée', () => {
  const s = reglagesParDefaut();
  assert.deepEqual([s.fractionnementRegle, s.fractionnementAccord, s.fractionnementDebut, s.fractionnementFin], ['legal', '', '05-01', '10-31']);
  assert.throws(() => appliquerReglages(s, { fractionnementRegle: 'accord' }), (e: unknown) => e instanceof ReglageInvalide && /art\. L3141-21/.test(e.message));
  assert.throws(() => appliquerReglages(s, { fractionnementRegle: 'aucun' }), ReglageInvalide);
  assert.equal(appliquerReglages(s, { fractionnementRegle: 'aucun', fractionnementAccord: 'Accord du 3 mars 2026' }).fractionnementRegle, 'aucun');
  assert.equal(appliquerReglages(s, { fractionnementRegle: 'autre' }).fractionnementRegle, 'legal');
  assert.throws(() => appliquerReglages(s, { fractionnementDebut: '11-01' }), /le début doit précéder la fin/);
  assert.throws(() => appliquerReglages(s, { fractionnementFin: '02-29' }), ReglageInvalide);
});

test('t046 calcul : congé principal dans la période, jours hors période, 5e semaine exclue', () => {
  // Aucun congé : tout le principal reste à prendre hors période (potentiel 2), rien encore de pris.
  const vide = etat(avec([]));
  assert.deepEqual([vide.principal, vide.dans, vide.hors, vide.restant, vide.credit, vide.potentiel, vide.principalOk], [20, 0, 0, 20, 0, 2, false]);
  // Deux semaines en août (10 ouvrés continus) et une semaine en novembre (5 ouvrés = 6 ouvrables) : 2 jours.
  const x = etat(avec([{ du: '2027-08-02', au: '2027-08-13' }, { du: '2027-11-15', au: '2027-11-19' }]));
  assert.deepEqual([x.dans, x.hors, x.joursHors, x.credit, x.potentiel, x.plusLong, x.principalOk], [10, 5, 5, 2, 2, 10, true]);
  // Trois semaines en été, deux hors période : seule une semaine du principal est hors période (5e semaine exclue).
  const y = etat(avec([{ du: '2027-07-19', au: '2027-08-06' }, { du: '2027-11-15', au: '2027-11-26' }]));
  assert.deepEqual([y.dans, y.hors, y.restant, y.joursHors, y.credit], [15, 10, 5, 5, 2]);
  // Quatre semaines en été : la semaine prise hors période est la 5e, aucun jour.
  const z = etat(avec([{ du: '2027-07-05', au: '2027-07-30' }, { du: '2027-11-15', au: '2027-11-19' }]));
  assert.deepEqual([z.dans, z.restant, z.credit, z.potentiel], [19, 1, 0, 0]);
  // 3 ouvrés hors période (3,6 ouvrables) : 1 jour ; 2 ouvrés (2,4 ouvrables) : aucun.
  assert.equal(etat(avec([{ du: '2027-06-07', au: '2027-06-25' }, { du: '2027-11-15', au: '2027-11-17' }])).credit, 1);
  assert.equal(etat(avec([{ du: '2027-06-07', au: '2027-06-25' }, { du: '2027-11-15', au: '2027-11-16' }])).credit, 0);
  // Fenêtre réglée du 1er juin au 30 septembre : un congé d'octobre passe hors période.
  const w = F.etatFractionnement(avec([{ du: '2027-10-04', au: '2027-10-15' }], '2027-11-02', { fractionnementDebut: '06-01', fractionnementFin: '09-30' }), base.employes.find(e => e.id === 3)!, 2027);
  assert.deepEqual([w.dans, w.hors, w.credit], [0, 10, 2]);
});

test('t046 congés continus : week-ends et fériés compris, absences qui se suivent réunies, demi-journée qui coupe', () => {
  const deux = avec([{ du: '2027-08-02', au: '2027-08-06' }, { du: '2027-08-09', au: '2027-08-13' }]);
  assert.deepEqual(F.blocsConges(deux, sophie(deux)).filter(b => b.du >= '2027').map(b => [b.du, b.au, b.jours.length]), [['2027-08-02', '2027-08-13', 10]]);
  assert.equal(etat(deux).plusLong, 10);
  // Le vendredi au matin seulement : l'après-midi travaillé coupe le congé.
  const coupe = avec([{ du: '2027-08-02', au: '2027-08-06', finDemi: 'matin' }, { du: '2027-08-09', au: '2027-08-13' }]);
  assert.equal(etat(coupe).plusLong, 5);
  // Le lundi à partir de l'après-midi : coupé aussi.
  const apresMidi = avec([{ du: '2027-08-02', au: '2027-08-06' }, { du: '2027-08-09', au: '2027-08-13', debutDemi: 'apres_midi' }]);
  assert.equal(etat(apresMidi).plusLong, 5);
  // Un jour ouvré entre deux congés les sépare ; le 14 juillet (férié) ne les sépare pas.
  assert.equal(etat(avec([{ du: '2027-08-02', au: '2027-08-05' }, { du: '2027-08-09', au: '2027-08-13' }])).plusLong, 5);
  assert.equal(etat(avec([{ du: '2027-07-07', au: '2027-07-13' }, { du: '2027-07-15', au: '2027-07-21' }])).plusLong, 10);
  // Demande refusée ou annulée : ignorée.
  assert.equal(etat(avec([{ du: '2027-08-02', au: '2027-08-13', statut: 'refusee' }])).plusLong, 0);
});

test('t046 congé de mai : imputé à la période précédente, il compte hors période pour elle ; par anticipation, dans la fenêtre de la nouvelle', () => {
  const large = { ...base, soldesReprise: base.soldesReprise.map(s => (s.empId === 3 ? { ...s, cpPris: 0, cpSolde: null } : s)) };
  const mai = avec([{ du: '2027-05-24', au: '2027-05-26' }], '2027-11-02', {}, large);
  assert.equal(F.etatFractionnement(mai, sophie(mai), 2026).hors, 3, 'période 2026-2027 : pris hors de mai-octobre 2026');
  assert.equal(etat(mai).dans, 0, 'rien sur la période 2027');
  // Période 2026-2027 épuisée : les jours de mai sont pris par anticipation sur 2027-2028, dans sa fenêtre.
  const epuise = { ...base, soldesReprise: base.soldesReprise.map(s => (s.empId === 3 ? { ...s, cpPris: 40, cpSolde: null } : s)) };
  const anticipe = avec([{ du: '2027-05-24', au: '2027-05-26' }], '2027-11-02', {}, epuise);
  assert.equal(etat(anticipe).dans, 3);
});

test('t046 checkAbsence : avertissements seulement — 24 jours ouvrables, congé principal compromis, jours de fractionnement', () => {
  const d = avec([], '2027-03-01');
  // Cinq semaines d'affilée : au-delà de 24 jours ouvrables, rappel des dérogations ; la demande reste possible.
  const long = checkAbsence(d, sophie(d), 'CP', '2027-07-19', '2027-08-20');
  assert.ok(long.msgs.some(m => !m.bad && /au-delà de 24 jours ouvrables d’affilée \(art\. L3141-17\).*enfant ou adulte handicapé/.test(m.text)));
  assert.equal(long.cant, false);
  // Quatre semaines d'affilée : rien.
  assert.ok(!checkAbsence(d, sophie(d), 'CP', '2027-07-05', '2027-07-30').msgs.some(m => /L3141-17/.test(m.text)));
  // Une semaine en novembre : 2 jours de fractionnement, à confirmer par le service RH.
  const nov = checkAbsence(d, sophie(d), 'CP', '2027-11-15', '2027-11-19');
  assert.ok(nov.msgs.some(m => !m.bad && /2 jours de fractionnement \(art\. L3141-23\), à confirmer par le service RH après le 31 octobre/.test(m.text)));
  // Sous un accord : la règle légale à vérifier ; sous « aucun jour » : rien.
  const accord = avec([], '2027-03-01', { fractionnementRegle: 'accord', fractionnementAccord: 'Accord X' });
  assert.ok(checkAbsence(accord, sophie(accord), 'CP', '2027-11-15', '2027-11-19').msgs.some(m => /à vérifier avec l’accord d’entreprise/.test(m.text)));
  const aucun = avec([], '2027-03-01', { fractionnementRegle: 'aucun', fractionnementAccord: 'Accord X' });
  assert.ok(!checkAbsence(aucun, sophie(aucun), 'CP', '2027-11-15', '2027-11-19').msgs.some(m => /fractionnement/.test(m.text)));
  // Une semaine déjà hors période, la seconde n'ajoute rien : pas de nouveau message.
  const deja = avec([{ du: '2027-11-15', au: '2027-11-19' }], '2027-03-01');
  assert.ok(!checkAbsence(deja, sophie(deja), 'CP', '2027-11-22', '2027-11-26').msgs.some(m => /de fractionnement/.test(m.text)));
  // Presque tout le solde posé hors période, sans congé principal : il ne pourrait plus être pris.
  const solde = soldePeriode(d, sophie(d), 2027);
  assert.ok(solde > 12, `solde 2027 de Sophie : ${solde}`);
  const reste = checkAbsence(d, sophie(d), 'CP', '2027-11-02', '2027-12-17');
  assert.ok(reste.msgs.some(m => !m.bad && /le congé principal d’au moins 12 jours ouvrables continus \(10 j ouvrés\) du 1er mai au 31 octobre 2027 ne pourrait plus être pris/.test(m.text)), JSON.stringify(reste.msgs));
  // Avec le congé principal déjà posé en août : rien à signaler.
  const ete = avec([{ du: '2027-08-02', au: '2027-08-13' }], '2027-03-01');
  assert.ok(!checkAbsence(ete, sophie(ete), 'CP', '2027-11-02', '2027-11-12').msgs.some(m => /ne pourrait plus/.test(m.text)));
  // Période non suivie (compteurs arrêtés après le début de sa fenêtre) : aucun avertissement de fractionnement.
  const nonSuivie = new Domain({ ...base, today: '2026-10-10', soldesReprise: base.soldesReprise.map(s => ({ ...s, arreteLe: '2026-10-10' })) });
  assert.equal(F.periodeSuivie(nonSuivie, sophie(nonSuivie), 2026), false);
  assert.ok(!checkAbsence(nonSuivie, sophie(nonSuivie), 'CP', '2026-11-16', '2026-11-20').msgs.some(m => /fractionnement|congé principal/.test(m.text)));
});

test('t046 alerte avant le 31 octobre (60 jours), propositions à partir du 1er novembre', () => {
  const sans = (jour: string, conges: Partial<Absence>[] = [], s = {}) => F.principauxAPrevoir(avec(conges, jour, s)).some(x => x.e.id === 3);
  assert.equal(sans('2027-08-31'), false, 'trop tôt');
  assert.equal(sans('2027-09-01'), true, '60 jours avant');
  assert.equal(sans('2027-10-31'), true, 'dernier jour');
  assert.equal(sans('2027-11-01'), false, 'période passée');
  assert.equal(sans('2027-09-15', [{ du: '2027-08-02', au: '2027-08-13' }]), false, 'congé principal pris');
  assert.equal(sans('2027-09-15', [{ du: '2027-08-02', au: '2027-08-13', statut: 'demandee' }]), false, 'congé principal demandé');
  const propose = (jour: string, conges: Partial<Absence>[] = [], s = {}) => F.fractionnementsAProposer(avec(conges, jour, s)).find(x => x.e.id === 3 && x.periode === 2027);
  assert.equal(propose('2027-10-31'), undefined, 'période en cours');
  assert.equal(propose('2027-11-01')?.propose, 2);
  assert.equal(propose('2027-11-01', [{ du: '2027-06-07', au: '2027-06-25' }, { du: '2027-08-02', au: '2027-08-02' }])?.propose, 1, '16 ouvrés pris : 4 restants, 1 jour');
  assert.equal(propose('2027-11-01', [{ du: '2027-06-07', au: '2027-06-25' }, { du: '2027-08-02', au: '2027-08-04' }]), undefined, '18 ouvrés pris : rien');
  assert.equal(propose('2027-11-01', [], { fractionnementRegle: 'aucun', fractionnementAccord: 'Accord X' }), undefined, 'aucun jour par accord');
  // Groupées par période pour le bandeau ; la période précédente reste proposée tant qu'elle n'est pas clôturée.
  const g = F.fractionnementsAFaire(avec([], '2028-03-01'));
  assert.deepEqual(g.map(x => x.periode), [2027]);
  assert.ok(g[0].lignes.some(l => l.e.id === 3));
  assert.deepEqual(F.fractionnementsAFaire(avec([], '2028-06-02')).map(x => x.periode), [2027]);
  const clos = new Domain({ ...base, today: '2028-06-02', clotures: [...base.clotures, { id: 1, empId: 3, type: 'CP', periode: 2027, solde: 0, decision: 'solde_nul', reportes: 0, perdus: 0, expire: null, reportId: null, motif: null, le: '2028-06-02', par: 'x' }] });
  assert.ok(!F.fractionnementsAProposer(clos, 2027).some(x => x.e.id === 3), 'période clôturée');
});

test('t046 conges.fractionnement : crédit en report reçu compté dans les droits, renonciation, refus, journal, vues', () => {
  const { db, user, ADMIN, GEST, PAIE, HSE } = fresh();
  const { run, refus } = runner(db);
  const d = () => le('2027-11-02', () => new Domain(loadFull(db, ADMIN)));
  const droitAvant = cpDroit(d(), d().emp(2)!, 2027).droit;
  const soldeAvant = soldePeriode(d(), d().emp(2)!, 2027);
  le('2027-10-31', () => refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [] }, /jusqu’au 31 oct\. 2027/));
  le('2027-11-02', () => {
    refus(ADMIN, 'conges.fractionnement', { periode: 'x' }, /Période de congés payés invalide/);
    refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 3, decision: 'crediter', jours: 3 }] }, /1 ou 2 jours/);
    refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 3, decision: 'plus tard' }] }, /choisissez le crédit/);
    refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 3, decision: 'crediter' }, { empId: 3, decision: 'renoncer' }] }, /une seule décision/);
    refus(GEST, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 14, decision: 'crediter', jours: 2 }] }, /propres jours de fractionnement/, 403);
    assert.equal(run(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [] }), 'Jours de fractionnement 2026-2027 : aucune décision enregistrée');
    const msg = run(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 2, decision: 'crediter', jours: 2 }, { empId: 3, decision: 'renoncer' }] });
    assert.match(msg, /^Jours de fractionnement 2026-2027 : 1 salarié crédité \(2 j en tout, jusqu’au 31 mai 2028\), 1 renonciation notée · \d+ salariés restent à décider$/);
    // Déjà décidé : plus proposé, refusé.
    refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 2, decision: 'crediter', jours: 2 }] }, /déjà décidé/);
  });
  const r = db.all<{ empId: number; jours: number; sens: string; periode: number; expire: string; origine: string | null; motif: string }>('reports').filter(x => x.origine === 'fractionnement');
  assert.deepEqual(r.map(x => [x.empId, x.jours, x.sens, x.periode, x.expire]), [[2, 2, 'recu', 2027, '2028-05-31']]);
  const fr = db.all<{ empId: number; decision: string; jours: number; reportId: number | null }>('fractionnements');
  const rid = db.all<{ id: number; origine: string | null }>('reports').find(y => y.origine === 'fractionnement')!.id;
  assert.deepEqual(fr.map(x => [x.empId, x.decision, x.jours, x.reportId]), [[2, 'credite', 2, rid], [3, 'renonce', 0, null]]);
  // Compté dans les droits et le solde de la période.
  assert.equal(cpDroit(d(), d().emp(2)!, 2027).droit, droitAvant + 2);
  assert.equal(soldePeriode(d(), d().emp(2)!, 2027), soldeAvant + 2);
  // Journal : période, décision de chaque salarié ; archive de la paie ; famille des congés.
  const j = db.all<{ action: string; payload: Record<string, any>; salaries: number[]; message: string }>('journal').filter(l => l.action === 'conges.fractionnement').at(-1)!;
  assert.deepEqual(j.payload.lignes, [{ empId: 2, decision: 'credite', jours: 2 }, { empId: 3, decision: 'renonce', jours: 0 }]);
  assert.deepEqual([...j.salaries].sort(), [2, 3]);
  assert.ok(estActionPaie('conges.fractionnement'));
  assert.equal(JOURNAL_LABEL['conges.fractionnement'], 'Jours de fractionnement des congés payés');
  assert.equal(familleAction('conges.fractionnement')?.id, 'absences');
  // Vues : décision à l'intéressé, au service RH, à la paie ; le manager ne voit que le report reçu, sans motif.
  le('2027-11-02', () => {
    const mehdi = user(2, 'collaborateur');
    assert.deepEqual((buildSnapshot(db, mehdi).fractionnements ?? []).map(x => x.empId), [2]);
    assert.equal((buildSnapshot(db, PAIE).fractionnements ?? []).length, 2);
    assert.equal((buildSnapshot(db, HSE).fractionnements ?? []).length, 0);
    // Karim Haddad, manager de Mehdi Benali.
    const mgr = new Domain(loadFull(db, ADMIN)).mgrOf(base.employes.find(e => e.id === 2)!);
    assert.equal(mgr, 12);
    const vue = buildSnapshot(db, user(mgr, 'manager'));
    assert.deepEqual(vue.fractionnements ?? [], []);
    assert.ok(vue.reports.some(x => x.empId === 2 && x.origine === 'fractionnement' && x.motif === ''));
  });
  // Règle « aucun jour » : refus.
  le('2027-11-02', () => {
    run(ADMIN, 'parametres.maj', { fractionnementRegle: 'aucun', fractionnementAccord: 'Accord du 3 mars 2026' });
    refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [] }, /écartés par accord collectif/);
    // Le journal des réglages masque la référence de l'accord.
    const p = db.all<{ action: string; payload: Record<string, any> }>('journal').filter(l => l.action === 'parametres.maj').at(-1)!;
    assert.ok(!JSON.stringify(p.payload).includes('3 mars'));
  });
});

test('t046 sous un accord : jours par demi-journée jusqu’au plafond retenu', () => {
  const { db, ADMIN } = fresh();
  const { run, refus } = runner(db);
  le('2027-11-02', () => {
    run(ADMIN, 'parametres.maj', { fractionnementRegle: 'accord', fractionnementAccord: 'Accord du 3 mars 2026' });
    refus(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 3, decision: 'crediter', jours: 2.25 }] }, /par demi-journée/);
    assert.match(run(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 3, decision: 'crediter', jours: 2.5 }] }), /2,5 j en tout/);
    // Sans jours : le nombre proposé.
    assert.match(run(ADMIN, 'conges.fractionnement', { periode: 2027, lignes: [{ empId: 2, decision: 'crediter' }] }), /1 salarié crédité \(2 j en tout/);
  });
});
