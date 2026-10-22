// Lot 6, chantier 3, étape 2 (t127, partie congé) : congé pris sur le compte épargne-temps.
// - type de congé `CET` ouvert dès qu'un jour est épargné (placé ou repris de l'ancien outil), décompté en jours ouvrés,
//   contrôlé sur le solde du CET (placements + repris − congés pris et demandés) ;
// - demande du salarié validée par son manager comme un CP, annulation qui recrédite, journal sans nature médicale ;
// - CET liquidé à la sortie et exporté corrigé des congés pris et demandés ;
// - lot de paie : rubrique « CET » désactivée et à confirmer par défaut, le congé figure nominativement « à saisir dans
//   Sage » dans le résumé du lot ;
// - plafonds de placement réglables (5 et 5 par défaut).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { ABS_LABEL, RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { absenceKinds, cetEpargne, cetInfo, checkAbsence } = await import('../shared/rules/conges.ts');
const { rubriqueAbsence } = await import('../shared/rules/absences-paie.ts');
const { estConge, uniteDecompte } = await import('../shared/rules/absences.ts');
const { natureAbsence } = await import('../shared/rules/temps.ts');
const { etatSortie, lignesEtat } = await import('../shared/rules/solde-sortie.ts');
const { rubriquesPaie } = await import('../shared/rules/paie.ts');
const { csvSoldes } = await import('../client/src/listes-csv.ts');
const { appliquerReglages, reglagesParDefaut } = await import('../shared/reglages.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Lot = Awaited<ReturnType<typeof loadFull>>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && re.test(e.message), `${name} : refus ${re}`);
  // Mehdi Benali sans placement de la démonstration : son CET part de zéro.
  await db.exec('DELETE FROM cet WHERE emp_id = 2');
  const ADMIN = await user(null, 'rh');
  const d = async () => new Domain(await loadFull(db, ADMIN));
  return { db, run, refus, d, ADMIN, PAIE: await user(7, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur') };
}

const mehdi = (d: InstanceType<typeof Domain>) => d.emp(2)!;

test('t127 type CET : congé décompté en jours ouvrés, libellés, rubrique de paie désactivée et à confirmer', () => {
  assert.ok(estConge('CET'));
  assert.equal(uniteDecompte('CET'), 'ouvrés');
  assert.equal(ABS_LABEL.CET, 'Congé sur le CET');
  assert.equal(natureAbsence('CET'), 'CET');
  assert.equal(rubriqueAbsence('CET'), 'CET');
  assert.equal(RUBRIQUES_PAIE.CET.inactiveParDefaut, true);
  const r = rubriquesPaie([]).find(x => x.code === 'CET')!;
  assert.deepEqual([r.active, r.confirmee], [false, false]);
});

test('t127 congé sur le CET : ouvert une fois des jours épargnés, contrôlé sur le solde, validé par le manager, annulé', async () => {
  const { db, run, refus, d, KARIM, MEHDI } = await fresh();
  assert.ok(!absenceKinds(await d(), mehdi(await d())).some(k => k[0] === 'CET'), 'rien d’épargné : pas de congé sur le CET');
  await run(MEHDI, 'cet.placer', { empId: 2, kind: 'RTT', jours: 2 });
  const avant = cetInfo(await d(), mehdi(await d()));
  assert.ok(absenceKinds(await d(), mehdi(await d())).some(k => k[0] === 'CET'));
  assert.deepEqual([avant.epargne, avant.pris, avant.poses, avant.total, avant.solde], [2 + avant.repris, 0, 0, 2 + avant.repris, 2 + avant.repris]);
  // Contrôle : jours ouvrés (11 novembre férié exclu), message propre au CET, solde du CET.
  const chk = checkAbsence(await d(), mehdi(await d()), 'CET', '2026-11-10', '2026-11-12');
  assert.equal(chk.n, 2);
  assert.equal(chk.cant, false);
  assert.match(chk.soldeLabel, /^Disponible sur le compte épargne-temps : /);
  assert.ok(chk.msgs.some(m => /Décompte : 2 j ouvrés/.test(m.text)));
  assert.ok(chk.msgs.some(m => /Congé pris sur le compte épargne-temps/.test(m.text)));
  const trop = avant.solde + 1;
  await refus(MEHDI, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-11-16', au: `2026-11-${16 + trop + 1}` }, /Solde insuffisant/);
  // Demande du salarié : posée, déduite du solde à poser, pas encore du total.
  assert.match(await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-11-10', au: '2026-11-12' }), /Demande de congé sur le CET envoyée/);
  const a = (await db.all<{ id: number; type: string; statut: string }>('absences')).at(-1)!;
  assert.deepEqual([a.type, a.statut], ['CET', 'demandee']);
  let ct = cetInfo(await d(), mehdi(await d()));
  assert.deepEqual([ct.poses, ct.pris, ct.total, ct.solde], [2, 0, avant.total, avant.total - 2]);
  // Validée par le manager direct, comme un CP : débitée du CET.
  assert.match(await run(KARIM, 'absence.decider', { id: a.id, ok: true }), /validée/);
  ct = cetInfo(await d(), mehdi(await d()));
  assert.deepEqual([ct.poses, ct.pris, ct.total, ct.solde], [0, 2, avant.total - 2, avant.total - 2]);
  // Journal : type de congé (ni médical ni libre), dates.
  const j = (await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).filter(l => l.action === 'absence.demander').at(-1)!;
  assert.equal(j.payload.kind, 'CET');
  // Annulée par le manager avant qu'elle commence : jours rendus au CET.
  assert.match(await run(KARIM, 'absence.annuler', { id: a.id }), /2 j de CET recrédités sur le solde/);
  assert.equal(cetInfo(await d(), mehdi(await d())).total, avant.total);
  // Vue du manager : le congé de son équipe, en clair (aucune donnée de santé).
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-11-16', au: '2026-11-16' });
  assert.ok((await buildSnapshot(db, KARIM)).absences.some(x => x.empId === 2 && x.type === 'CET'));
});

test('t127 solde repris de l’ancien outil : congé ouvert, CET liquidé à la sortie diminué des congés pris', async () => {
  const { db, run, d, KARIM } = await fresh();
  await db.update('soldesReprise', 2, { cetSolde: 6 });
  assert.equal(cetEpargne(await d(), mehdi(await d())), 6);
  await run(KARIM, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-10-19', au: '2026-10-21' });
  const ct = cetInfo(await d(), mehdi(await d()));
  assert.deepEqual([ct.repris, ct.pris, ct.total], [6, 3, 3]);
  const etat = etatSortie(await d(), mehdi(await d()), '2026-12-31');
  assert.equal(etat.cet!.total, 3);
  assert.ok(lignesEtat(etat).some(l => l.rubrique === 'CET_LIQ' && l.solde === 3));
});

test('t127 sortie et export des soldes : un congé CET demandé avant la sortie est déduit comme posé', async () => {
  const { db, run, d, MEHDI } = await fresh();
  await db.update('soldesReprise', 2, { cetSolde: 6 });
  // Demande en attente du 14 au 18 décembre (5 j ouvrés) : comptée comme posée, à la sortie comme pour un CP.
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-12-14', au: '2026-12-18' });
  const ct = cetInfo(await d(), mehdi(await d()));
  assert.deepEqual([ct.poses, ct.total, ct.solde], [5, 6, 1]);
  const etat = etatSortie(await d(), mehdi(await d()), '2026-12-31');
  assert.equal(etat.cet!.total, 1);
  assert.ok(lignesEtat(etat).some(l => l.rubrique === 'CET_LIQ' && l.solde === 1), 'jamais 6 j liquidés en plus du congé validé ensuite');
  assert.ok(etat.avertissements.some(a => /Demande de congé du 14 déc\. au 18 déc\. 2026 en attente : comptée comme posée/.test(a)));
  // Export CSV des soldes : même solde que l'écran (demandes déduites).
  const csv = csvSoldes(await d(), [mehdi(await d())]);
  assert.equal(csv.rows[0][csv.head.indexOf('CET (j)')], '1');
  // Tout le CET demandé : rien à liquider, pas de ligne.
  await db.update('soldesReprise', 2, { cetSolde: 5 });
  assert.equal(etatSortie(await d(), mehdi(await d()), '2026-12-31').cet, null);
});

test('t127 lot de paie : congé sur le CET sous la rubrique désactivée, listé « à saisir dans Sage »', async () => {
  const { db, run, KARIM, PAIE } = await fresh();
  await db.update('soldesReprise', 2, { cetSolde: 4 });
  await run(KARIM, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-10-19', au: '2026-10-20' });
  const msg = await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  assert.match(msg, /à saisir dans Sage/);
  const lot = (await db.all<Lot>('lotsPaie')).at(-1)!;
  const el = lot.contenu!.absences!.filter(x => x.rubrique === 'CET');
  assert.deepEqual(el.map(x => [x.empId, x.quantite, x.codeSage]), [[2, 2, null]]);
  const aSaisir = lot.resume.aSaisir!.filter(x => x.famille === 'absences' && x.rubrique === 'CET');
  assert.deepEqual(aSaisir.map(x => [x.empId, x.quantite]), [[2, 2]]);
  assert.match(aSaisir[0].detail, /^Absence n° \d+, du 19\/10\/2026 au 20\/10\/2026$/);
});

test('t127 plafonds de placement réglables : 5 et 5 par défaut, bornés, appliqués au placement', async () => {
  const defaut = reglagesParDefaut();
  assert.deepEqual([defaut.cetPlafondRtt, defaut.cetPlafondCp], [5, 5]);
  assert.deepEqual([appliquerReglages(defaut, { cetPlafondCp: 9 }).cetPlafondCp, appliquerReglages(defaut, { cetPlafondRtt: 40 }).cetPlafondRtt], [5, 25]);
  const { run, refus, d, ADMIN, MEHDI } = await fresh();
  await run(ADMIN, 'parametres.maj', { cetPlafondRtt: 2 });
  const ct = cetInfo(await d(), mehdi(await d()));
  assert.equal(ct.plafondRtt, 2);
  assert.ok(ct.placeRtt <= 2);
  await refus(MEHDI, 'cet.placer', { empId: 2, kind: 'RTT', jours: 3 }, /maximum 2 j/);
  await run(MEHDI, 'cet.placer', { empId: 2, kind: 'RTT', jours: 2 });
  assert.equal(cetInfo(await d(), mehdi(await d())).placeRtt, 0);
});
