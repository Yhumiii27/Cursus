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

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerAvenants } = await import('../server/src/avenants.ts');
const { CONTRATS_HISTORIQUE, historiqueDepuisFiches } = await import('../server/src/migrations/lot6-contrats.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet, cumulAnnuel } = await import('../shared/rules/temps.ts');
const { cpInfo, recupInfo, rttDroit, rttInfo } = await import('../shared/rules/conges.ts');
const { regimeAu, regimeFiche, renouvellementsDe, segmentsContrat } = await import('../shared/rules/historique-contrat.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Ligne = import('../shared/types.ts').ContratHistorique;
type Employe = import('../shared/types.ts').Employe;

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get<Compte>('comptes', u.compteId!))!, message: o.message ?? null, result: o.result });
    return o as { message: string | null; result?: any };
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : ${re}`);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const lignes = async (empId: number) => await db.where<Ligne>('contratsHistorique', 'empId', empId);
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

test('t074 migration : historique amorcé depuis les fiches, mêmes droits pour un régime unique, tracé, sans effet ensuite', async () => {
  const { db, domain, lignes } = await fresh();
  // Base d'avant l'historique : le jeu de démonstration (un seul régime par salarié) sans aucune ligne.
  await db.exec('DELETE FROM contrats_historique');
  const avant = droits(await domain());
  assert.equal(await CONTRATS_HISTORIQUE.necessaire!(db), true);
  const compte = await db.tx(async () => await CONTRATS_HISTORIQUE.executer(db));
  assert.equal(compte, '24 lignes pour 24 fiches');
  const j = (await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).findLast(x => x.action === 'migration.contratsHistorique')!;
  assert.deepEqual(j.payload, { salaries: 24, lignes: 24 });
  // Un salarié qui n'a eu qu'un seul régime garde exactement les mêmes droits : RTT, CP, récupération, forfait annuel, feuilles.
  assert.deepEqual(droits(await domain()), avant);
  // Embauche à l'entrée, au régime de la fiche, terme prévu du CDD (terme initial avant le renouvellement de démonstration).
  const [l4] = await lignes(4);
  assert.deepEqual([l4.nature, l4.effet, l4.jusquau, l4.regime?.typeContrat, l4.applique, l4.par], ['embauche', '2026-02-02', '2026-07-31', 'cdd', true, 'Cursus']);
  // Idempotente : plus aucune fiche sans historique, rien n'est écrit au second passage.
  assert.equal(await db.tx(() => CONTRATS_HISTORIQUE.executer(db)), undefined);
  assert.equal(await db.count('contratsHistorique'), 24);
  // Auteur et salarié des lignes contrôlés comme références (server/src/integrite.ts).
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('t074 migration : régime antérieur repris des feuilles figées, inconnu sans elles (droits d’avant gardés)', async () => {
  const { db, domain, lignes } = await fresh();
  await db.exec('DELETE FROM contrats_historique');
  // Mehdi Benali passé de 39 h + RTT à 35 h le 5 octobre (garde-fou du lot 5 : semaine du 21 septembre figée sur 39 h) ;
  // Thomas Garnier passé au 35 h le 5 octobre, sans aucune feuille figée.
  const fige = (await db.all<{ id: number; empId: number; week: string }>('feuilles')).find(f => f.empId === 2 && f.week === '2026-09-21')!;
  const regime39 = regimeFiche((await db.get<Employe>('employes', 2))!);
  await db.update('feuilles', fige.id, { contrat: regime39 });
  await db.update('employes', 2, { temps: '35h', tempsDepuis: '2026-10-05' });
  await db.update('employes', 6, { temps: '35h', tempsDepuis: '2026-10-05' });
  await db.exec('UPDATE feuilles SET contrat = NULL WHERE emp_id = 6');
  const d0 = await domain();
  assert.equal(rttDroit(d0, d0.emp(2)!), null, 'sans historique, le compteur de RTT disparaissait');
  await historiqueDepuisFiches(db, '2026-10-10');
  assert.deepEqual((await lignes(2)).map(l => [l.nature, l.effet, l.regime?.temps ?? null]), [['embauche', '2016-09-01', '39h_rtt'], ['avenant', '2026-10-05', '35h']]);
  assert.deepEqual((await lignes(6)).map(l => [l.nature, l.effet, l.regime?.temps ?? null]), [['embauche', '2009-04-06', null], ['avenant', '2026-10-05', '35h']]);
  const d1 = await domain();
  // RTT de janvier à septembre gardés au prorata ; régime antérieur inconnu : rien de plus qu'avant l'historique.
  assert.equal(rttDroit(d1, d1.emp(2)!), Math.round(23 * 9 / 12));
  assert.equal(rttDroit(d1, d1.emp(6)!), rttDroit(d0, d0.emp(6)!));
  assert.equal(regimeAu(d1, d1.emp(2)!, '2026-03-02')?.temps, '39h_rtt');
  assert.equal(regimeAu(d1, d1.emp(6)!, '2026-03-02'), null);
});

test('t074 : 39 h → 35 h en cours d’année, RTT au prorata ; feuille créée 12 semaines avant figée sur l’ancien régime', async () => {
  const { db, run, RH, domain, lignes } = await fresh();
  const avant = rttInfo(await domain(), (await domain()).emp(2)!)!;
  const o = await run(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-10-05' });
  assert.equal(o.result, undefined, 'aucun solde de RTT perdu');
  assert.deepEqual((await lignes(2)).map(l => [l.nature, l.effet, l.regime?.temps, l.par]), [['embauche', '2016-09-01', '39h_rtt', 'Cursus'], ['avenant', '2026-10-05', '35h', 'Sandrine Vidal']]);
  const d = await domain(), r = rttInfo(d, d.emp(2)!)!;
  assert.deepEqual([r.droit, r.pris, r.label], [Math.round(23 * 9 / 12), avant.pris, 'RTT']);
  assert.equal(rttDroit(d, d.emp(2)!, 2027), null, 'plus de RTT l’an prochain');
  // Semaine du 13 juillet, 12 semaines avant la date d'effet (au-delà des 8 semaines du garde-fou) : feuille créée après le
  // changement, figée sur le 39 h de sa semaine ; 39 h saisies ne font aucune heure supplémentaire.
  await run(RH, 'temps.addLine', { empId: 2, week: '2026-07-13', projet: 'INT-MAINT' });
  const sh0 = (await db.all<{ empId: number; week: string; contrat: { temps: string } | null }>('feuilles')).find(f => f.empId === 2 && f.week === '2026-07-13')!;
  assert.equal(sh0.contrat?.temps, '39h_rtt');
  for (let di = 0; di < 5; di++) await run(RH, 'temps.setCell', { empId: 2, week: '2026-07-13', li: 0, di, value: '7,8' });
  const d1 = await domain(), sh = d1.ds.feuilles.find(f => f.empId === 2 && f.week === '2026-07-13')!;
  const c = calcSheet(d1, d1.emp(2)!, sh);
  assert.deepEqual([c.c.temps, c.total, c.sup25], ['39h_rtt', 39, 0]);
  // Feuille d'une semaine postérieure : elle suit la fiche, sans régime figé.
  await run(RH, 'temps.addLine', { empId: 2, week: '2026-10-12', projet: 'INT-MAINT' });
  assert.equal((await db.all<{ empId: number; week: string; contrat: unknown }>('feuilles')).find(f => f.empId === 2 && f.week === '2026-10-12')!.contrat, null);
});

test('t074 : 39 h → 35 h au 1er juillet, jours pris au-delà du droit au prorata : confirmation et solde au journal', async () => {
  const { db, run, refus, RH, domain } = await fresh();
  // Mehdi Benali : 23 j de droit au 39 h, 16 pris et 1 posé (le 2 novembre). Au 35 h dès le 1er juillet, le droit au
  // prorata de janvier à juin n'est plus que de 12 j : le solde deviendrait négatif sans que la paie le sache.
  const avant = rttInfo(await domain(), (await domain()).emp(2)!)!;
  assert.deepEqual([avant.droit, avant.pris + avant.poses], [23, 17]);
  await refus(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-07-01' },
    /n’est plus que de 12 j au prorata .*solde de -5 j, et 1 j de RTT reste posé ou validé à partir du 1 juil\. 2026.*Confirmez le changement/);
  assert.equal((await (await db.get<Employe>('employes', 2))!).temps, '39h_rtt', 'rien n’est enregistré sans confirmation');
  const o = await run(RH, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-07-01', confirmerRtt: true });
  assert.match(o.message!, /solde RTT 2026 : .* gardé au journal pour la paie/);
  const j = (await db.all<{ action: string; paie: boolean; payload: Record<string, unknown> }>('journal')).findLast(x => x.action === 'employe.rtt')!;
  assert.ok(j.paie, 'archive paie');
  assert.deepEqual(j.payload.soldeRtt, { annee: 2026, droit: 23, pris: avant.pris, poses: avant.poses, solde: avant.solde, effet: '2026-07-01', nouveauDroit: 12, apresEffet: 1 });
  const r = rttInfo(await domain(), (await domain()).emp(2)!)!;
  assert.deepEqual([r.droit, r.solde], [12, -5]);
  // Au 5 octobre, les 17 j de droit au prorata couvrent les 17 j pris ou posés : rien à confirmer, même avec le RTT du
  // 2 novembre posé après la date d'effet (acquis sous l'ancien régime).
  const { run: run2, RH: RH2 } = await fresh();
  assert.equal((await run2(RH2, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-10-05' })).result, undefined);
});

test('t074 : avenant à date future programmé, appliqué à sa date, un seul à la fois, annulable', async () => {
  const { db, run, refus, RH, domain, lignes } = await fresh();
  // Camille Roux (35 h) passe au 39 h + RTT le 2 novembre : la fiche ne change pas avant.
  const o = await run(RH, 'employe.modifier', { id: 1, temps: '39h_rtt', tempsDepuis: '2026-11-02' });
  assert.match(o.message!, /avenant programmé au 2 nov\. 2026 \(39 h avec RTT[^)]*\), appliqué à la fiche à cette date/);
  assert.deepEqual(o.result.avenant.effet, '2026-11-02');
  const e0 = await ((await db.get<Employe>('employes', 1))!);
  assert.deepEqual([e0.temps, e0.tempsDepuis], ['35h', null]);
  const programme = (await lignes(1)).find(l => !l.applique)!;
  assert.deepEqual([programme.nature, programme.effet, programme.regime?.temps], ['avenant', '2026-11-02', '39h_rtt']);
  // RTT de novembre et décembre comptés dès maintenant ; feuille du 9 novembre figée sur le régime à venir.
  const d0 = await domain();
  assert.equal(rttDroit(d0, d0.emp(1)!), Math.round(23 * 2 / 12));
  await run(RH, 'temps.addLine', { empId: 1, week: '2026-11-09', projet: 'INT-LOG' });
  const feuille = async () => (await db.all<{ empId: number; week: string; contrat: { temps: string } | null }>('feuilles')).find(f => f.empId === 1 && f.week === '2026-11-09')!;
  assert.equal((await feuille()).contrat?.temps, '39h_rtt');
  // Un autre changement de régime attend l'annulation ; un avenant futur ne change ni le statut ni la nature du contrat.
  await refus(RH, 'employe.modifier', { id: 1, temps: 'partiel', heures: 28, jourOff: [2], tempsDepuis: '2026-12-01' }, /Un avenant est déjà programmé au 2 nov\. 2026/);
  await refus(RH, 'employe.modifier', { id: 3, temps: '35h', statut: 'cadre', tempsDepuis: '2026-12-01' }, /ne porte que sur l’organisation du temps/);
  // Pas encore dû : rien n'est appliqué ; le 2 novembre, la fiche change, la ligne est appliquée et tracée.
  assert.equal(await appliquerAvenants(db, '2026-11-01'), 0);
  assert.equal(await appliquerAvenants(db, '2026-11-02'), 1);
  const e1 = await ((await db.get<Employe>('employes', 1))!);
  assert.deepEqual([e1.temps, e1.tempsDepuis], ['39h_rtt', '2026-11-02']);
  assert.ok((await lignes(1)).every(l => l.applique));
  assert.equal((await feuille()).contrat, null, 'la feuille suit désormais la fiche');
  const j = (await db.all<{ action: string; salaries: number[]; payload: Record<string, unknown> }>('journal')).findLast(x => x.action === 'employe.avenantApplique')!;
  assert.deepEqual([j.salaries, j.payload.effet], [[1], '2026-11-02']);
  assert.equal(await appliquerAvenants(db, '2026-11-03'), 0, 'appliqué une seule fois');
  // Nouvel avenant programmé, puis annulé : la fiche garde son régime, la feuille brouillon le reprend.
  await run(RH, 'employe.modifier', { id: 1, temps: '35h', tempsDepuis: '2026-12-07' });
  await run(RH, 'temps.addLine', { empId: 1, week: '2026-12-14', projet: 'INT-LOG' });
  const dec = async () => (await db.all<{ empId: number; week: string; contrat: { temps: string } | null }>('feuilles')).find(f => f.empId === 1 && f.week === '2026-12-14')!;
  assert.equal((await dec()).contrat?.temps, '35h');
  const id = (await lignes(1)).find(l => !l.applique)!.id;
  const a = await run(RH, 'employe.annulerAvenant', { id });
  assert.match(a.message!, /Avenant du 7 déc\. 2026 annulé pour Camille Roux/);
  assert.equal((await dec()).contrat, null);
  assert.ok((await (await db.get<Ligne>('contratsHistorique', id))!).annuleLe);
  assert.equal(await appliquerAvenants(db, '2026-12-07'), 0, 'un avenant annulé ne s’applique pas');
  // Déjà annulé : rien n'est refait ; avenant déjà appliqué : refus.
  assert.equal((await run(RH, 'employe.annulerAvenant', { id })).message, null);
  await refus(RH, 'employe.annulerAvenant', { id: (await lignes(1)).find(l => l.effet === '2026-11-02')!.id }, /déjà appliqué/, 409);
});

test('t074 : une sortie clôt l’historique et annule l’avenant programmé après elle ; annulée, la fin est retirée', async () => {
  const { run, RH, lignes } = await fresh();
  await run(RH, 'employe.modifier', { id: 1, temps: '39h_rtt', tempsDepuis: '2026-12-07' });
  const o = await run(RH, 'employe.sortie', { id: 1, date: '2026-11-30', motif: 'demission' });
  assert.match(o.message!, /avenant programmé annulé/);
  const [embauche, avenant] = await lignes(1);
  assert.equal(embauche.fin, '2026-11-30');
  assert.ok(avenant.annuleLe);
  await run(RH, 'employe.annulerSortie', { id: 1 });
  assert.equal((await lignes(1))[0].fin, null);
});

test('t053 : une sortie anticipée annule les renouvellements qui devaient commencer après elle ; annulée, ils reprennent', async () => {
  const { db, run, RH, lignes } = await fresh();
  // Lucas Martin : CDD au 29 janvier 2027 (déjà renouvelé une fois), renouvelé jusqu'au 30 juillet puis au 30 septembre 2027.
  await run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-07-30' });
  await run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-09-30' });
  const enVigueur = async () => (await lignes(4)).filter(l => !l.annuleLe).map(l => [l.nature, l.effet, l.fin]);
  const nRen = async () => renouvellementsDe({ contratsHistorique: await db.all<Ligne>('contratsHistorique') }, 4).length;
  assert.equal(await nRen(), 3);
  // Sortie au 20 octobre 2026 : les renouvellements du 30 janvier et du 31 juillet 2027 n'ont jamais pris effet.
  const o = await run(RH, 'employe.sortie', { id: 4, date: '2026-10-20', motif: 'licenciement' });
  assert.match(o.message!, /2 renouvellements du CDD sans effet annulés/);
  assert.deepEqual(await enVigueur(), [['embauche', '2026-02-02', null], ['renouvellement', '2026-08-01', '2026-10-20']]);
  assert.equal(await nRen(), 1);
  // Sortie déplacée au 15 février 2027 : le renouvellement du 30 janvier reprend effet, la fin passe sur lui.
  await run(RH, 'employe.sortie', { id: 4, date: '2027-02-15', motif: 'licenciement' });
  assert.deepEqual(await enVigueur(), [['embauche', '2026-02-02', null], ['renouvellement', '2026-08-01', null], ['renouvellement', '2027-01-30', '2027-02-15']]);
  // Sortie annulée : fin prévue rétablie, les trois renouvellements à nouveau en vigueur, aucune ligne close.
  await run(RH, 'employe.annulerSortie', { id: 4 });
  assert.equal((await (await db.get<Employe>('employes', 4))!).fin, '2027-09-30');
  assert.equal(await nRen(), 3);
  assert.ok((await lignes(4)).every(l => !l.fin && !l.annuleLe));
});

test('t074 : jours non travaillés d’un temps partiel lus à la date de l’absence', async () => {
  const { run, RH, domain } = await fresh();
  // Marion (temps partiel, mercredi non travaillé) ne travaille plus le vendredi à partir du 12 octobre.
  const d0 = await domain();
  const mercredi = '2026-09-30', vendredi = '2026-10-02';
  assert.deepEqual([d0.countDays(d0.emp(7)!, mercredi, mercredi, 'RECUP'), d0.countDays(d0.emp(7)!, vendredi, vendredi, 'RECUP')], [0, 1]);
  await run(RH, 'employe.modifier', { id: 7, jourOff: [4] });
  const d1 = await domain();
  // Absences antérieures au changement décomptées avec l'ancien jour non travaillé ; après, avec le nouveau.
  assert.deepEqual([d1.countDays(d1.emp(7)!, mercredi, mercredi, 'RECUP'), d1.countDays(d1.emp(7)!, vendredi, vendredi, 'RECUP')], [0, 1]);
  assert.deepEqual([d1.countDays(d1.emp(7)!, '2026-10-14', '2026-10-14', 'RECUP'), d1.countDays(d1.emp(7)!, '2026-10-16', '2026-10-16', 'RECUP')], [1, 0]);
  assert.equal(segmentsContrat(d1, d1.emp(7)!).length, 2);
});

test('t074 : historique transmis selon le profil (référence et auteur au service RH, à la paie et à la lecture seule)', async () => {
  const { db, user, run, RH } = await fresh();
  await run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-03-31', reference: 'Avenant n° 2' });
  const vue = async (empId: number | null, role: User['role']) => await buildSnapshot(db, await user(empId, role));
  const lignes4 = (u: Awaited<ReturnType<typeof vue>>) => (u.contratsHistorique ?? []).filter(l => l.empId === 4);
  // Service RH : tout ; paie et lecture seule : tout ; référent HSE : rien.
  assert.ok(lignes4(await vue(null, 'rh')).some(l => l.reference === 'Avenant n° 2' && l.par === 'Sandrine Vidal'));
  assert.ok(lignes4(await vue(7, 'rh')).some(l => l.reference === 'Avenant n° 2'));
  assert.ok(lignes4(await vue(11, 'rh')).some(l => l.reference === 'Avenant n° 2'));
  assert.deepEqual((await vue(23, 'rh')).contratsHistorique, []);
  // Manager de la Logistique : les régimes de son équipe, sans référence ni auteur ; ni le motif de recours, ni le terme
  // initial, ni aucun terme ou signature des lignes, ni les renouvellements (le terme initial et la fin prévue se liraient).
  const mgr = await vue(16, 'manager');
  assert.deepEqual(lignes4(mgr).map(l => [l.nature, l.effet, l.regime?.typeContrat]), [['embauche', '2026-02-02', 'cdd']]);
  assert.ok(lignes4(mgr).every(l => l.reference === null && l.par === null && l.parId === null && l.jusquau === null && l.signeLe === null));
  // Sortie anticipée : la date de sortie (celle de la fiche) seule, ni la fin prévue, ni les renouvellements.
  await run(RH, 'employe.sortie', { id: 4, date: '2026-10-20', motif: 'licenciement' });
  const mgr2 = await vue(16, 'manager');
  assert.deepEqual(lignes4(mgr2).map(l => [l.nature, l.jusquau, l.signeLe]), [['embauche', null, null]]);
  assert.deepEqual([mgr2.employes.find(e => e.id === 4)!.fin, mgr2.employes.find(e => e.id === 4)!.finPrevue], ['2026-10-20', null]);
  await run(RH, 'employe.annulerSortie', { id: 4 });
  const lucas = mgr.employes.find(e => e.id === 4)!;
  assert.deepEqual([lucas.motifRecours, lucas.cddFinInitiale], [null, null]);
  assert.ok(!(mgr.contratsHistorique ?? []).some(l => l.empId === 2), 'hors de son équipe');
  // L'intéressé : ses lignes (sans référence), son motif de recours et son terme initial.
  const soi = await vue(4, 'collaborateur');
  assert.ok(lignes4(soi).length >= 3 && (soi.contratsHistorique ?? []).every(l => l.empId === 4));
  assert.deepEqual([soi.employes[0].motifRecours, soi.employes[0].cddFinInitiale], ['accroissement', '2026-07-31']);
  // Référent HSE : ni motif ni terme initial.
  const hse = (await vue(23, 'rh')).employes.find(e => e.id === 4)!;
  assert.deepEqual([hse.motifRecours, hse.cddFinInitiale], [null, null]);
});

test('t074 : export RGPD, historique du contrat sous son titre ; sans auteur dans l’export remis au salarié', async () => {
  const { db, run, RH } = await fresh();
  await run(RH, 'employe.renouvelerCdd', { id: 4, jusquau: '2027-03-31', reference: 'Avenant n° 2' });
  type Section = Record<string, unknown>[];
  const rh = (await (await donneesSalarie(db, 4, { journal: true, par: 'Sandrine Vidal' }))!).sections as unknown as Record<string, Section>;
  assert.ok(!('contratsHistorique' in rh));
  assert.ok(rh['Historique du contrat'].some(l => l.reference === 'Avenant n° 2' && l.par === 'Sandrine Vidal'));
  // /api/mes-donnees : ni le nom ni la fiche de l'auteur (le portail ne les montre pas) ; ses lignes et références restent.
  const soi = (await (await donneesSalarie(db, 4, { journal: false, par: 'Lucas Martin' }))!).sections as unknown as Record<string, Section>;
  assert.ok(soi['Historique du contrat'].length >= 3);
  assert.ok(soi['Historique du contrat'].every(l => !('par' in l) && !('parId' in l)));
  assert.ok(soi['Historique du contrat'].some(l => l.reference === 'Avenant n° 2'));
});
