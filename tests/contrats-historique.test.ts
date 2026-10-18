// Historique des contrats (t074) : régime en vigueur à une date (shared/rules/historique-contrat.ts), migration
// lot6-contrats-historique (amorce depuis les fiches et les feuilles figées, non-régression des droits d'un salarié qui n'a
// eu qu'un seul régime), RTT au prorata des régimes de l'année, feuille créée pour une semaine ancienne figée sur son
// régime, avenant programmé à une date future (appliqué à sa date, annulable, annulé par une sortie), jours non travaillés
// d'un temps partiel lus à la date de l'absence, lignes transmises selon le profil (server/src/dataset.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerAvenants } = await import('../server/src/avenants.ts');
const { CONTRATS_HISTORIQUE, historiqueDepuisFiches } = await import('../server/src/migrations/lot6-contrats.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet, cumulAnnuel } = await import('../shared/rules/temps.ts');
const { cpInfo, recupInfo, rttDroit, rttInfo } = await import('../shared/rules/conges.ts');
const { regimeAu, regimeFiche, segmentsContrat } = await import('../shared/rules/historique-contrat.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Ligne = import('../shared/types.ts').ContratHistorique;
type Employe = import('../shared/types.ts').Employe;

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get<Compte>('comptes', u.compteId!)!, message: o.message ?? null, result: o.result });
    return o as { message: string | null; result?: any };
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : ${re}`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  const lignes = (empId: number) => db.where<Ligne>('contratsHistorique', 'empId', empId);
  return { db, user, run, refus, RH, domain, lignes };
}

/** Droits et compteurs calculés pour chaque salarié : ce qu'aucune migration ne doit changer pour un régime unique. */
function droits(d: InstanceType<typeof Domain>) {
  return d.ds.employes.map(e => ({
    id: e.id, rtt2025: rttDroit(d, e, 2025), rtt2026: rttDroit(d, e, 2026), rtt2027: rttDroit(d, e, 2027), rtt: rttInfo(d, e), cp: cpInfo(d, e),
    recup: recupInfo(d, e), annuel: d.contratOf(e).annuel ? cumulAnnuel(d, e, 2026) : null,
    feuilles: d.ds.feuilles.filter(f => f.empId === e.id).map(f => calcSheet(d, e, f).total),
  }));
}

test('t074 migration : historique amorcé depuis les fiches, mêmes droits pour un régime unique, tracé, sans effet ensuite', () => {
  const { db, domain, lignes } = fresh();
  // Base d'avant l'historique : le jeu de démonstration (un seul régime par salarié) sans aucune ligne.
  db.sql.exec('DELETE FROM contrats_historique');
  const avant = droits(domain());
  assert.equal(CONTRATS_HISTORIQUE.necessaire!(db), true);
  const compte = db.tx(() => CONTRATS_HISTORIQUE.executer(db));
  assert.equal(compte, '24 lignes pour 24 fiches');
  const j = db.all<{ action: string; payload: Record<string, unknown> }>('journal').findLast(x => x.action === 'migration.contratsHistorique')!;
  assert.deepEqual(j.payload, { salaries: 24, lignes: 24 });
  // Un salarié qui n'a eu qu'un seul régime garde exactement les mêmes droits : RTT, CP, récupération, forfait annuel, feuilles.
  assert.deepEqual(droits(domain()), avant);
  // Embauche à l'entrée, au régime de la fiche, terme prévu du CDD (terme initial avant le renouvellement de démonstration).
  const [l4] = lignes(4);
  assert.deepEqual([l4.nature, l4.effet, l4.jusquau, l4.regime?.typeContrat, l4.applique, l4.par], ['embauche', '2026-02-02', '2026-07-31', 'cdd', true, 'Cursus']);
  // Idempotente : plus aucune fiche sans historique, rien n'est écrit au second passage.
  assert.equal(db.tx(() => CONTRATS_HISTORIQUE.executer(db)), undefined);
  assert.equal(db.count('contratsHistorique'), 24);
  // Auteur et salarié des lignes contrôlés comme références (server/src/integrite.ts).
  assert.equal(controlerOrphelins(db).orphelins, 0);
});

test('t074 migration : régime antérieur repris des feuilles figées, inconnu sans elles (droits d’avant gardés)', () => {
  const { db, domain, lignes } = fresh();
  db.sql.exec('DELETE FROM contrats_historique');
  // Mehdi Benali passé de 39 h + RTT à 35 h le 5 octobre (garde-fou du lot 5 : semaine du 21 septembre figée sur 39 h) ;
  // Thomas Garnier passé au 35 h le 5 octobre, sans aucune feuille figée.
  const fige = db.all<{ id: number; empId: number; week: string }>('feuilles').find(f => f.empId === 2 && f.week === '2026-09-21')!;
  const regime39 = regimeFiche(db.get<Employe>('employes', 2)!);
  db.update('feuilles', fige.id, { contrat: regime39 });
  db.update('employes', 2, { temps: '35h', tempsDepuis: '2026-10-05' });
  db.update('employes', 6, { temps: '35h', tempsDepuis: '2026-10-05' });
  db.sql.exec('UPDATE feuilles SET contrat = NULL WHERE emp_id = 6');
  const d0 = domain();
  assert.equal(rttDroit(d0, d0.emp(2)!), null, 'sans historique, le compteur de RTT disparaissait');
  historiqueDepuisFiches(db, '2026-10-10');
  assert.deepEqual(lignes(2).map(l => [l.nature, l.effet, l.regime?.temps ?? null]), [['embauche', '2016-09-01', '39h_rtt'], ['avenant', '2026-10-05', '35h']]);
  assert.deepEqual(lignes(6).map(l => [l.nature, l.effet, l.regime?.temps ?? null]), [['embauche', '2009-04-06', null], ['avenant', '2026-10-05', '35h']]);
  const d1 = domain();
  // RTT de janvier à septembre gardés au prorata ; régime antérieur inconnu : rien de plus qu'avant l'historique.
  assert.equal(rttDroit(d1, d1.emp(2)!), Math.round(23 * 9 / 12));
  assert.equal(rttDroit(d1, d1.emp(6)!), rttDroit(d0, d0.emp(6)!));
  assert.equal(regimeAu(d1, d1.emp(2)!, '2026-03-02')?.temps, '39h_rtt');
  assert.equal(regimeAu(d1, d1.emp(6)!, '2026-03-02'), null);
});

test('t074 : 39 h → 35 h en cours d’année, RTT au prorata ; feuille créée 12 semaines avant figée sur l’ancien régime', () => {
  const { db, run, RH, domain, lignes } = fresh();
  const avant = rttInfo(domain(), domain().emp(2)!)!;
  const o = run(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-10-05' });
  assert.equal(o.result, undefined, 'aucun solde de RTT perdu');
  assert.deepEqual(lignes(2).map(l => [l.nature, l.effet, l.regime?.temps, l.par]), [['embauche', '2016-09-01', '39h_rtt', 'Cursus'], ['avenant', '2026-10-05', '35h', 'Sandrine Vidal']]);
  const d = domain(), r = rttInfo(d, d.emp(2)!)!;
  assert.deepEqual([r.droit, r.pris, r.label], [Math.round(23 * 9 / 12), avant.pris, 'RTT']);
  assert.equal(rttDroit(d, d.emp(2)!, 2027), null, 'plus de RTT l’an prochain');
  // Semaine du 13 juillet, 12 semaines avant la date d'effet (au-delà des 8 semaines du garde-fou) : feuille créée après le
  // changement, figée sur le 39 h de sa semaine ; 39 h saisies ne font aucune heure supplémentaire.
  run(RH, 'temps.addLine', { empId: 2, week: '2026-07-13', projet: 'INT-MAINT' });
  const sh0 = db.all<{ empId: number; week: string; contrat: { temps: string } | null }>('feuilles').find(f => f.empId === 2 && f.week === '2026-07-13')!;
  assert.equal(sh0.contrat?.temps, '39h_rtt');
  for (let di = 0; di < 5; di++) run(RH, 'temps.setCell', { empId: 2, week: '2026-07-13', li: 0, di, value: '7,8' });
  const d1 = domain(), sh = d1.ds.feuilles.find(f => f.empId === 2 && f.week === '2026-07-13')!;
  const c = calcSheet(d1, d1.emp(2)!, sh);
  assert.deepEqual([c.c.temps, c.total, c.sup25], ['39h_rtt', 39, 0]);
  // Feuille d'une semaine postérieure : elle suit la fiche, sans régime figé.
  run(RH, 'temps.addLine', { empId: 2, week: '2026-10-12', projet: 'INT-MAINT' });
  assert.equal(db.all<{ empId: number; week: string; contrat: unknown }>('feuilles').find(f => f.empId === 2 && f.week === '2026-10-12')!.contrat, null);
});

test('t074 : avenant à date future programmé, appliqué à sa date, un seul à la fois, annulable', () => {
  const { db, run, refus, RH, domain, lignes } = fresh();
  // Camille Roux (35 h) passe au 39 h + RTT le 2 novembre : la fiche ne change pas avant.
  const o = run(RH, 'employe.modifier', { id: 1, temps: '39h_rtt', tempsDepuis: '2026-11-02' });
  assert.match(o.message!, /avenant programmé au 2 nov\. 2026 \(39 h avec RTT[^)]*\), appliqué à la fiche à cette date/);
  assert.deepEqual(o.result.avenant.effet, '2026-11-02');
  const e0 = db.get<Employe>('employes', 1)!;
  assert.deepEqual([e0.temps, e0.tempsDepuis], ['35h', null]);
  const programme = lignes(1).find(l => !l.applique)!;
  assert.deepEqual([programme.nature, programme.effet, programme.regime?.temps], ['avenant', '2026-11-02', '39h_rtt']);
  // RTT de novembre et décembre comptés dès maintenant ; feuille du 9 novembre figée sur le régime à venir.
  const d0 = domain();
  assert.equal(rttDroit(d0, d0.emp(1)!), Math.round(23 * 2 / 12));
  run(RH, 'temps.addLine', { empId: 1, week: '2026-11-09', projet: 'INT-LOG' });
  const feuille = () => db.all<{ empId: number; week: string; contrat: { temps: string } | null }>('feuilles').find(f => f.empId === 1 && f.week === '2026-11-09')!;
  assert.equal(feuille().contrat?.temps, '39h_rtt');
  // Un autre changement de régime attend l'annulation ; un avenant futur ne change ni le statut ni la nature du contrat.
  refus(RH, 'employe.modifier', { id: 1, temps: 'partiel', heures: 28, jourOff: [2], tempsDepuis: '2026-12-01' }, /Un avenant est déjà programmé au 2 nov\. 2026/);
  refus(RH, 'employe.modifier', { id: 3, temps: '35h', statut: 'cadre', tempsDepuis: '2026-12-01' }, /ne porte que sur l’organisation du temps/);
  // Pas encore dû : rien n'est appliqué ; le 2 novembre, la fiche change, la ligne est appliquée et tracée.
  assert.equal(appliquerAvenants(db, '2026-11-01'), 0);
  assert.equal(appliquerAvenants(db, '2026-11-02'), 1);
  const e1 = db.get<Employe>('employes', 1)!;
  assert.deepEqual([e1.temps, e1.tempsDepuis], ['39h_rtt', '2026-11-02']);
  assert.ok(lignes(1).every(l => l.applique));
  assert.equal(feuille().contrat, null, 'la feuille suit désormais la fiche');
  const j = db.all<{ action: string; salaries: number[]; payload: Record<string, unknown> }>('journal').findLast(x => x.action === 'employe.avenantApplique')!;
  assert.deepEqual([j.salaries, j.payload.effet], [[1], '2026-11-02']);
  assert.equal(appliquerAvenants(db, '2026-11-03'), 0, 'appliqué une seule fois');
  // Nouvel avenant programmé, puis annulé : la fiche garde son régime, la feuille brouillon le reprend.
  run(RH, 'employe.modifier', { id: 1, temps: '35h', tempsDepuis: '2026-12-07' });
  run(RH, 'temps.addLine', { empId: 1, week: '2026-12-14', projet: 'INT-LOG' });
  const dec = () => db.all<{ empId: number; week: string; contrat: { temps: string } | null }>('feuilles').find(f => f.empId === 1 && f.week === '2026-12-14')!;
  assert.equal(dec().contrat?.temps, '35h');
  const id = lignes(1).find(l => !l.applique)!.id;
  const a = run(RH, 'employe.annulerAvenant', { id });
  assert.match(a.message!, /Avenant du 7 déc\. 2026 annulé pour Camille Roux/);
  assert.equal(dec().contrat, null);
  assert.ok(db.get<Ligne>('contratsHistorique', id)!.annuleLe);
  assert.equal(appliquerAvenants(db, '2026-12-07'), 0, 'un avenant annulé ne s’applique pas');
  // Déjà annulé : rien n'est refait ; avenant déjà appliqué : refus.
  assert.equal(run(RH, 'employe.annulerAvenant', { id }).message, null);
  refus(RH, 'employe.annulerAvenant', { id: lignes(1).find(l => l.effet === '2026-11-02')!.id }, /déjà appliqué/, 409);
});

test('t074 : une sortie clôt l’historique et annule l’avenant programmé après elle ; annulée, la fin est retirée', () => {
  const { run, RH, lignes } = fresh();
  run(RH, 'employe.modifier', { id: 1, temps: '39h_rtt', tempsDepuis: '2026-12-07' });
  const o = run(RH, 'employe.sortie', { id: 1, date: '2026-11-30', motif: 'demission' });
  assert.match(o.message!, /avenant programmé annulé/);
  const [embauche, avenant] = lignes(1);
  assert.equal(embauche.fin, '2026-11-30');
  assert.ok(avenant.annuleLe);
  run(RH, 'employe.annulerSortie', { id: 1 });
  assert.equal(lignes(1)[0].fin, null);
});

test('t074 : jours non travaillés d’un temps partiel lus à la date de l’absence', () => {
  const { run, RH, domain } = fresh();
  // Marion (temps partiel, mercredi non travaillé) ne travaille plus le vendredi à partir du 12 octobre.
  const d0 = domain();
  const mercredi = '2026-09-30', vendredi = '2026-10-02';
  assert.deepEqual([d0.countDays(d0.emp(7)!, mercredi, mercredi, 'RECUP'), d0.countDays(d0.emp(7)!, vendredi, vendredi, 'RECUP')], [0, 1]);
  run(RH, 'employe.modifier', { id: 7, jourOff: [4] });
  const d1 = domain();
  // Absences antérieures au changement décomptées avec l'ancien jour non travaillé ; après, avec le nouveau.
  assert.deepEqual([d1.countDays(d1.emp(7)!, mercredi, mercredi, 'RECUP'), d1.countDays(d1.emp(7)!, vendredi, vendredi, 'RECUP')], [0, 1]);
  assert.deepEqual([d1.countDays(d1.emp(7)!, '2026-10-14', '2026-10-14', 'RECUP'), d1.countDays(d1.emp(7)!, '2026-10-16', '2026-10-16', 'RECUP')], [1, 0]);
  assert.equal(segmentsContrat(d1, d1.emp(7)!).length, 2);
});

test('t074 : historique transmis selon le profil (référence et auteur au service RH, à la paie et à la lecture seule)', () => {
  const { db, user, run, RH } = fresh();
  run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-03-31', reference: 'Avenant n° 2' });
  const vue = (empId: number | null, role: User['role']) => buildSnapshot(db, user(empId, role));
  const lignes4 = (u: ReturnType<typeof vue>) => (u.contratsHistorique ?? []).filter(l => l.empId === 4);
  // Service RH : tout ; paie et lecture seule : tout ; référent HSE : rien.
  assert.ok(lignes4(vue(null, 'rh')).some(l => l.reference === 'Avenant n° 2' && l.par === 'Sandrine Vidal'));
  assert.ok(lignes4(vue(7, 'rh')).some(l => l.reference === 'Avenant n° 2'));
  assert.ok(lignes4(vue(11, 'rh')).some(l => l.reference === 'Avenant n° 2'));
  assert.deepEqual(vue(23, 'rh').contratsHistorique, []);
  // Manager de la Logistique : les lignes de son équipe, sans référence ni auteur ; ni le motif de recours, ni le terme initial.
  const mgr = vue(16, 'manager');
  assert.ok(lignes4(mgr).length >= 3 && lignes4(mgr).every(l => l.reference === null && l.par === null && l.parId === null));
  const lucas = mgr.employes.find(e => e.id === 4)!;
  assert.deepEqual([lucas.motifRecours, lucas.cddFinInitiale], [null, null]);
  assert.ok(!(mgr.contratsHistorique ?? []).some(l => l.empId === 2), 'hors de son équipe');
  // L'intéressé : ses lignes (sans référence), son motif de recours et son terme initial.
  const soi = vue(4, 'collaborateur');
  assert.ok(lignes4(soi).length >= 3 && (soi.contratsHistorique ?? []).every(l => l.empId === 4));
  assert.deepEqual([soi.employes[0].motifRecours, soi.employes[0].cddFinInitiale], ['accroissement', '2026-07-31']);
  // Référent HSE : ni motif ni terme initial.
  const hse = vue(23, 'rh').employes.find(e => e.id === 4)!;
  assert.deepEqual([hse.motifRecours, hse.cddFinInitiale], [null, null]);
});
