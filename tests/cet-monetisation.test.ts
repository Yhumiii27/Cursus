// lot 13 — CET (monétisation) : utilisation des jours du compte épargne-temps en complément de rémunération
// (shared/rules/cet-monetisation.ts, server/src/actions/cet-monetisation.ts, server/src/cet-paie.ts) :
// - fermée par défaut, ouverte avec la référence de l'accord (COHERENCE) ;
// - seuls les jours venus des RTT se monétisent, congés sur le CET imputés d'abord sur les CP placés ; plafond annuel ;
// - demande du salarié, validation ou refus du service RH, annulation ; solde du CET déduit ;
// - famille de lot CET_MON : désactivée, « à saisir dans Sage », réservée, réglée hors fichier ; activée, dans le fichier ;
// - vues : manager sans motif ni auteur, référent HSE sans rien, paie sans motif ; journal sans motif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { variablesDeLaPeriode, A_SAISIR } = await import('../server/src/variables-paie.ts');
const { Domain } = await import('../shared/domain.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { cetInfo } = await import('../shared/rules/conges.ts');
const M = await import('../shared/rules/cet-monetisation.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { rubriquesPaie } = await import('../shared/rules/paie.ts');
const { etatSortie } = await import('../shared/rules/solde-sortie.ts');
const { appliquerReglages, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
const { estActionPaie, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Lot = Awaited<ReturnType<typeof loadFull>>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Monetisation = import('../shared/types.ts').MonetisationCet;

const ACCORD = 'Accord d’entreprise sur le CET du 1er mars 2026';

async function fresh() {
  const db = await nouvelleBase();
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
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp, status?: number) =>
    await assert.rejects(async () => await run(u, name, p),
      (e: unknown) => e instanceof ActionError && re.test(e.message) && (status == null || e.status === status), `${name} : refus ${re}`);
  const regler = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  // Mehdi Benali (fiche 2) : CET remis à zéro, puis 2 CP de 5e semaine et 3 RTT 2026 épargnés.
  await db.exec('DELETE FROM cet WHERE emp_id = 2');
  await db.insert('cet', { empId: 2, type: 'CP', jours: 2, date: '2026-06-02', periode: '2026-2027' });
  await db.insert('cet', { empId: 2, type: 'RTT', jours: 3, date: '2026-10-01', periode: '2026' });
  const ADMIN = await user(null, 'rh');
  const d = async () => new Domain(await loadFull(db, ADMIN));
  const demandes = async () => await db.all<Monetisation>('monetisationsCet');
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[] }>('journal')).filter(l => l.action === action);
  const lots = async () => await db.all<Lot>('lotsPaie');
  return {
    db, run, refus, regler, d, demandes, journal, lots, ADMIN,
    PAIE: await user(7, 'rh'), HSE: await user(23, 'rh'), LECTURE: await user(11, 'rh'), KARIM: await user(12, 'manager'),
    MEHDI: await user(2, 'collaborateur'), THOMAS: await user(6, 'collaborateur'),
  };
}

const mehdi = (d: InstanceType<typeof Domain>) => d.emp(2)!;

test('lot 13 réglages : monétisation fermée par défaut, ouverte seulement avec la référence de l’accord ; CET_MON désactivée', () => {
  const s = reglagesParDefaut();
  assert.deepEqual([s.cetMonetisation, s.cetMonetisationAccord, s.cetMonetisationPlafond, s.cetReprisMonetisable], [false, '', 10, false]);
  assert.throws(() => appliquerReglages(s, { cetMonetisation: true }), (e: unknown) => e instanceof ReglageInvalide && /art\. L3151-3/.test(e.message));
  assert.equal(appliquerReglages(s, { cetMonetisation: true, cetMonetisationAccord: ACCORD }).cetMonetisation, true);
  assert.equal(appliquerReglages(s, { cetMonetisationPlafond: 0 }).cetMonetisationPlafond, 1, 'un jour au moins');
  assert.equal(RUBRIQUES_PAIE.CET_MON.inactiveParDefaut, true);
  assert.deepEqual((({ active, confirmee }) => [active, confirmee])(rubriquesPaie([]).find(x => x.code === 'CET_MON')!), [false, false]);
  assert.deepEqual(M.reglagesMonetisation({ cetMonetisation: true, cetMonetisationAccord: '' }).ouverte, false, 'case cochée sans accord : fermée');
  assert.equal(M.periodeMonetisation('2026-10-10', '2026-10-10'), '2026-10');
  assert.equal(M.periodeMonetisation('2026-09-30', '2026-10-10'), '2026-10', 'au plus tôt la période ouverte');
  for (const a of ['cet.monetisation.valider', 'cet.monetisation.refuser', 'cet.monetisation.annuler']) assert.ok(estActionPaie(a), a);
  assert.ok(!estActionPaie('cet.monetiser'));
  for (const a of ['cet.monetiser', 'cet.monetisation.valider', 'cet.monetisation.refuser', 'cet.monetisation.annuler']) assert.ok(JOURNAL_LABEL[a], a);
});

test('lot 13 jours monétisables : RTT seulement, congés imputés d’abord sur les CP placés, plafond de l’année, solde', async () => {
  const { run, refus, regler, d, MEHDI } = await fresh();
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 }, /pas ouverte/);
  await regler({ cetMonetisation: true, cetMonetisationAccord: ACCORD });
  let m = M.monetisationInfo(await d(), mehdi(await d()));
  assert.deepEqual([m.origine, m.parOrigine, m.parPlafond, m.solde, m.possible], [3, 3, 10, 5, 3], 'les 2 CP placés ne se monétisent pas');
  // Congé sur le CET de 3 jours ouvrés demandé : 2 imputés sur les CP placés, 1 sur les RTT.
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CET', du: '2026-12-14', au: '2026-12-16' });
  m = M.monetisationInfo(await d(), mehdi(await d()));
  assert.deepEqual([m.parOrigine, m.solde, m.possible], [2, 2, 2]);
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 3 }, /Solde du compte épargne-temps insuffisant : 2 j/);
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 0.3 }, /demi-journée/);
  // Solde repris de l'ancien outil : monétisable seulement si le réglage le dit.
  await regler({ cetMonetisationPlafond: 1 });
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 1.5 }, /Plafond de 1 j monétisés par an atteint/);
  assert.match(await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 }), /Demande de monétisation de 1 j .* à valider par le service RH/);
  const ct = cetInfo(await d(), mehdi(await d()));
  assert.deepEqual([ct.monetisationsEnAttente, ct.monetises, ct.solde, ct.total], [1, 0, 1, 5], 'demande en attente déduite du solde, pas du total');
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 0.5 }, /Plafond/, undefined);
});

test('lot 13 origine : solde repris monétisable selon le réglage ; refus d’un salarié sorti', async () => {
  const { db, refus, regler, d, MEHDI, ADMIN, run } = await fresh();
  await regler({ cetMonetisation: true, cetMonetisationAccord: ACCORD });
  await db.exec('DELETE FROM cet WHERE emp_id = 2');
  await db.run('UPDATE soldes_reprise SET cet_solde = 4 WHERE emp_id = 2');
  assert.equal(M.monetisationInfo(await d(), mehdi(await d())).possible, 0, 'repris d’origine inconnue : non monétisable');
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 }, /Seuls les jours venus des RTT/);
  await regler({ cetReprisMonetisable: true });
  assert.equal(M.monetisationInfo(await d(), mehdi(await d())).possible, 4);
  assert.match(await run(ADMIN, 'cet.monetiser', { empId: 2, jours: 2 }), /enregistrée/);
  assert.equal((await db.all<Monetisation>('monetisationsCet'))[0].demandeParInteresse, false, 'demandée par le service RH');
  await db.run(`UPDATE employes SET fin = '2026-10-31', motif_sortie = 'demission' WHERE id = 2`);
  await refus(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 }, /liquidé en entier avec le solde de tout compte/);
});

test('lot 13 décision : validation par le service RH (période de paie), refus et annulation motivés, journal sans motif', async () => {
  const { run, refus, regler, demandes, journal, d, ADMIN, MEHDI, THOMAS, KARIM } = await fresh();
  await regler({ cetMonetisation: true, cetMonetisationAccord: ACCORD });
  await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1.5 });
  const [a] = await demandes();
  await refus(THOMAS, 'cet.monetiser', { empId: 2, jours: 1 }, /propre compte/, 403);
  await refus(KARIM, 'cet.monetisation.valider', { id: a.id }, /./, 403);
  await refus(MEHDI, 'cet.monetisation.valider', { id: a.id }, /./, 403);
  assert.match(await run(ADMIN, 'cet.monetisation.valider', { id: a.id }), /validée · paie : rubrique CET_MON, octobre 2026/);
  let v = (await demandes())[0];
  assert.deepEqual([v.statut, v.periode, v.lotId, v.sage], ['validee', '2026-10', null, false]);
  assert.equal(M.etatMonetisation(v), 'validée, paie de octobre 2026');
  assert.deepEqual([cetInfo(await d(), mehdi(await d())).monetises, cetInfo(await d(), mehdi(await d())).total], [1.5, 3.5]);
  await refus(ADMIN, 'cet.monetisation.valider', { id: a.id }, /rien à valider/, 409);
  // Le salarié ne retire plus une monétisation validée ; le service RH l'annule hors lot, motif exigé.
  await refus(MEHDI, 'cet.monetisation.annuler', { id: a.id }, /seul le service RH/, 403);
  await refus(ADMIN, 'cet.monetisation.annuler', { id: a.id }, /motif/);
  assert.match(await run(ADMIN, 'cet.monetisation.annuler', { id: a.id, motif: 'Validée par erreur, salarié revenu sur sa demande' }), /annulée/);
  v = (await demandes())[0];
  assert.deepEqual([v.statut, v.periode, cetInfo(await d(), mehdi(await d())).total], ['annulee', null, 5]);
  // Refus : motif exigé ; le salarié retire sa demande en attente sans motif.
  await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 });
  const b = (await demandes())[1];
  await refus(ADMIN, 'cet.monetisation.refuser', { id: b.id }, /motif du refus/);
  assert.match(await run(ADMIN, 'cet.monetisation.refuser', { id: b.id, motif: 'Fenêtre de l’accord close' }), /refusée/);
  await refus(MEHDI, 'cet.monetisation.annuler', { id: b.id }, /refusée/, 409);
  await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 });
  const c = (await demandes())[2];
  assert.match(await run(MEHDI, 'cet.monetisation.annuler', { id: c.id }), /annulée/);
  // Journal : jours et identifiants, jamais le texte d'un motif ; salarié concerné.
  for (const action of ['cet.monetisation.refuser', 'cet.monetisation.annuler']) {
    for (const l of await journal(action)) {
      assert.ok(!/erreur|Fenêtre/.test(JSON.stringify(l)), `${action} : motif absent du journal`);
      assert.deepEqual(l.salaries, [2]);
    }
  }
  assert.deepEqual((await journal('cet.monetiser'))[0].payload.jours, 1.5);
});

test('lot 13 paie : CET_MON désactivée à saisir dans Sage, réservée, protégée, réglée hors fichier ; activée, dans le fichier', async () => {
  const { run, refus, regler, demandes, journal, lots, ADMIN, PAIE, MEHDI, db } = await fresh();
  await regler({ cetMonetisation: true, cetMonetisationAccord: ACCORD });
  await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1.5 });
  await run(ADMIN, 'cet.monetisation.valider', { id: (await demandes())[0].id });
  assert.match(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /éléments? à saisir dans Sage/);
  let lot = (await lots()).at(-1)!;
  const [x] = lot.resume.aSaisir!.filter(e => e.famille === 'monetisationsCet');
  assert.deepEqual([x.empId, x.rubrique, x.quantite], [2, 'CET_MON', 1.5]);
  assert.equal(x.detail, `Monétisation du CET, demande n° ${(await demandes())[0].id}`);
  assert.ok(!L.lignesFichier(lot.contenu!).some(l => l.rubrique === 'CET_MON'));
  assert.deepEqual([lot.monetisationsCet, (await demandes())[0].lotId], [[{ id: (await demandes())[0].id, empId: 2 }], lot.id]);
  assert.deepEqual(lot.resume.monetisationsCet, { elements: 1, salaries: 1 });
  assert.deepEqual((await journal('paie.lotGenerer')).at(-1)!.payload.monetisationsCet, [(await demandes())[0].id]);
  assert.ok((await variablesDeLaPeriode(db, PAIE, '2026-10')).some(v => v.rubrique === A_SAISIR && v.empId === 2 && /Monétisation du CET/.test(v.detail)));
  await refus(ADMIN, 'cet.monetisation.annuler', { id: (await demandes())[0].id, motif: 'Erreur' }, /annulez d’abord ce lot/, 409);
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  let m = (await demandes())[0];
  assert.deepEqual([m.lotId, m.sage, m.horsFichier], [lot.id, true, true]);
  assert.equal(M.etatMonetisation(m), 'réglée hors fichier (saisie dans Sage)');
  await refus(ADMIN, 'cet.monetisation.annuler', { id: m.id, motif: 'Erreur' }, /correction se fait dans Sage/, 409);

  // Rubrique activée (code donné par la paie) : la demande suivante part dans le fichier ; l'annulation du lot la libère.
  await run(PAIE, 'paie.rubrique', { code: 'CET_MON', active: true, codeSage: '6450' });
  await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 });
  await run(ADMIN, 'cet.monetisation.valider', { id: (await demandes())[1].id });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  lot = (await lots()).at(-1)!;
  assert.ok(L.lignesFichier(lot.contenu!).some(l => l.rubrique === '6450' && l.quantite === 1));
  assert.ok(!(lot.resume.aSaisir ?? []).some(e => e.famille === 'monetisationsCet'));
  await run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  m = (await demandes())[1];
  assert.deepEqual([m.lotId, m.sage], [null, false]);
  assert.equal(M.etatMonetisation(m), 'validée, paie de octobre 2026');
});

test('lot 13 vues : manager sans motif ni auteur, collègue sans rien, référent HSE sans rien, paie sans motif ; solde de sortie', async () => {
  const { db, run, regler, demandes, d, ADMIN, PAIE, HSE, LECTURE, KARIM, MEHDI, THOMAS } = await fresh();
  await regler({ cetMonetisation: true, cetMonetisationAccord: ACCORD });
  await run(ADMIN, 'cet.monetiser', { empId: 2, jours: 1 });
  await run(ADMIN, 'cet.monetisation.refuser', { id: (await demandes())[0].id, motif: 'Fenêtre de l’accord close' });
  await run(MEHDI, 'cet.monetiser', { empId: 2, jours: 1 });
  const vue = async (u: User) => (await buildSnapshot(db, u)).monetisationsCet ?? [];
  // RH : tout, motif et auteurs compris.
  assert.deepEqual((await vue(ADMIN)).map(m => [m.statut, m.motif, m.decidePar != null]), [['refusee', 'Fenêtre de l’accord close', true], ['demandee', null, false]]);
  // Le salarié : ses demandes, motif du refus compris, sans le nom du membre du service RH qui a demandé ou décidé.
  const siennes = await vue(MEHDI);
  assert.deepEqual(siennes.map(m => [m.statut, m.motif, m.decidePar, m.demandePar]), [['refusee', 'Fenêtre de l’accord close', null, ''], ['demandee', null, null, 'Mehdi Benali']]);
  // Son manager : jours et état, ni motif ni auteur ; le solde du CET calculé est le même que celui du service RH.
  const equipe = await vue(KARIM);
  assert.deepEqual(equipe.map(m => [m.statut, m.jours, m.motif, m.demandePar, m.decidePar]), [['refusee', 1, null, '', null], ['demandee', 1, null, '', null]]);
  const dk = new Domain(await buildSnapshot(db, KARIM));
  assert.equal(cetInfo(dk, dk.emp(2)!).solde, cetInfo(await d(), mehdi(await d())).solde);
  // Un collègue, le référent HSE : rien ; paie et lecture seule : tout, sans motif.
  assert.deepEqual(await vue(THOMAS), []);
  assert.deepEqual(await vue(HSE), []);
  for (const u of [PAIE, LECTURE]) assert.deepEqual((await vue(u)).map(m => [m.statut, m.motif]), [['refusee', null], ['demandee', null]]);
  // Solde de sortie : la demande en attente est déduite du CET liquidé (comme un congé demandé).
  const e = await d();
  const etat = etatSortie(e, mehdi(e), '2026-10-31');
  assert.equal(etat.cet?.total, cetInfo(e, mehdi(e)).solde);
  assert.equal(etat.cet?.total, 4);
});
