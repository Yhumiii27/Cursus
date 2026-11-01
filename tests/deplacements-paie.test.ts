// Déplacements dans la paie (lot 6, chantier 2, étape 1 : t031) et registre des éléments de lot : jours et nuits de grand
// déplacement en France (chantiers qualifiés par le service RH), jours à l'étranger par pays, trajets aller et retour,
// jours d'absence exclus, ventilation par mois et rappel, écart avec ce que les lots ont emporté (régularisation d'un
// déplacement annulé), réglage désactivé par défaut (éléments « à saisir dans Sage », listés dans le résumé du lot et
// l'export, jamais renvoyés), réglage activé (fichier d'import, codes à confirmer), premier jour transmis, migration
// d'une base existante (avec des lots même sans séjour), missions qui se chevauchent ou se suivent (un séjour), affectation
// réaffectée (régularisation chez l'ancien salarié), instantanés de chaque profil ; soldes de sortie migrés dans le
// registre et listés à saisir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { A_SAISIR, variablesDeLaPeriode } = await import('../server/src/variables-paie.ts');
const { CLE_DEPUIS_DEPLACEMENTS, deplacementsAEmettre, premierJourDeplacements } = await import('../server/src/deplacements-paie.ts');
const { FAMILLES } = await import('../server/src/elements-lot.ts');
const { DEPLACEMENTS_DEPART } = await import('../server/src/migrations/lot6-paie.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { Domain } = await import('../shared/domain.ts');
const P = await import('../shared/rules/deplacements-paie.ts');
const E = await import('../shared/rules/elements-lot.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { rubriquesPaie } = await import('../shared/rules/paie.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Lot = Awaited<ReturnType<typeof loadFull>>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Ligne = { action: string; message: string | null; payload: Record<string, any>; salaries: number[]; paie: boolean };

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const ADMIN = await user(null, 'rh');
  const d = async () => new Domain(await loadFull(db, ADMIN));
  const lots = async () => await db.all<Lot>('lotsPaie');
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(l => l.action === action);
  return { db, run, refus, d, lots, journal, ADMIN, PAIE: await user(7, 'rh'), LECTURE: await user(11, 'rh'), HSE: await user(23, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur') };
}
const avecMode = async <T>(mode: string, f: () => Promise<T>): Promise<T> => {
  const avant = process.env.SAGE_MODE;
  process.env.SAGE_MODE = mode;
  try { return await f(); } finally { if (avant === undefined) delete process.env.SAGE_MODE; else process.env.SAGE_MODE = avant; }
};

// — Règles —

test('t031 séjour : jours calendaires, nuits = jours − 1, deux trajets, absences exclues, ventilation par mois', async () => {
  const { db, d } = await fresh();
  // Mission de 5 jours à Feyzin (19 au 23 octobre) : 5 jours, 4 nuits, aller et retour.
  const m = { source: 'mission' as const, id: 1, empId: 3, du: '2026-10-19', au: '2026-10-23', pays: 'FR' };
  assert.deepEqual(P.partsSejour(await d(), m, '2026-12').map(p => [p.rubrique, p.mois, p.quantite]), [['GD_JOUR', '2026-10', 5], ['GD_NUIT', '2026-10', 4], ['TRAJET', '2026-10', 2]]);
  // Un jour d'absence validée au milieu : 4 jours, 3 nuits ; les trajets restent.
  await db.insert('absences', { empId: 3, type: 'RTT', du: '2026-10-21', au: '2026-10-21', statut: 'validee', keystone: true });
  assert.deepEqual(P.partsSejour(await d(), m, '2026-12').map(p => [p.rubrique, p.quantite]), [['GD_JOUR', 4], ['GD_NUIT', 3], ['TRAJET', 2]]);
  // Déplacement à cheval sur deux mois (Tanger, 27 octobre au 6 novembre) : jours à l'étranger mois par mois, un trajet chacun.
  const v = { source: 'voyage' as const, id: 3, empId: 18, du: '2026-10-27', au: '2026-11-06', pays: 'MA' };
  assert.deepEqual(P.partsSejour(await d(), v, '2026-12').map(p => [p.rubrique, p.mois, p.quantite, p.du, p.au]), [
    ['ETR_JOUR', '2026-10', 5, '2026-10-27', '2026-10-31'], ['TRAJET', '2026-10', 1, '2026-10-27', '2026-10-27'],
    ['ETR_JOUR', '2026-11', 6, '2026-11-01', '2026-11-06'], ['TRAJET', '2026-11', 1, '2026-11-06', '2026-11-06'],
  ]);
  // Lot d'octobre : novembre attend ; premier jour transmis : les jours d'avant restent à Sage.
  assert.deepEqual(P.partsSejour(await d(), v, '2026-10').map(p => p.mois), ['2026-10', '2026-10']);
  assert.deepEqual(P.partsSejour(await d(), v, '2026-12', '2026-11-01').map(p => [p.rubrique, p.quantite]), [['ETR_JOUR', 6], ['TRAJET', 1]]);
  // Séjour entièrement couvert par une absence : rien, pas même les trajets.
  await db.insert('absences', { empId: 18, type: 'CP', du: '2026-10-27', au: '2026-11-06', statut: 'validee', keystone: true });
  assert.deepEqual(P.partsSejour(await d(), v, '2026-12'), []);
  // Rubriques : désactivées par défaut, unités (jours, nombre), libellés lisibles en Windows-1252.
  for (const r of P.RUBRIQUES_DEPLACEMENT) assert.equal(RUBRIQUES_PAIE[r].inactiveParDefaut, true, r);
  assert.deepEqual(P.RUBRIQUES_DEPLACEMENT.map(r => RUBRIQUES_PAIE[r].unite), ['j', 'nombre', 'j', 'nombre']);
  assert.ok(P.RUBRIQUES_DEPLACEMENT.every(r => !RUBRIQUES_PAIE[r].label.includes('—')));
  assert.ok(rubriquesPaie([]).filter(r => P.RUBRIQUES_DEPLACEMENT.includes(r.code as 'GD_JOUR')).every(r => !r.active && !r.confirmee));
});

test('t031 séjours : déplacements à l’étranger en vigueur, missions des seuls chantiers qualifiés, intérimaires exclus', async () => {
  const { db, run, refus, d, journal, ADMIN, KARIM } = await fresh();
  const sejours = async () => P.sejoursPaie(await d()).map(s => `${s.source}:${s.empId}:${s.pays}`);
  // Démonstration : déplacements à l'étranger ; Feyzin (en France) n'est pas encore qualifié, rien de ses missions.
  assert.ok((await sejours()).includes('voyage:18:MA') && !(await sejours()).some(s => s.startsWith('mission:')));
  assert.ok((await d()).ds.referentiels.chantiers.filter(P.aQualifier).some(c => c.id === 'K-2620'));
  assert.equal(P.grandDeplacementPropose((await d()).chantier('K-2620')!), true, 'proposé pour un chantier en France');
  assert.equal(P.grandDeplacementPropose((await d()).chantier('K-2614')!), false);
  // Qualification par le service RH : ses missions comptent ; le manager ne qualifie pas ; un chantier à l'étranger non plus.
  await refus(KARIM, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: true }, 403);
  await refus(ADMIN, 'chantier.grandDeplacement', { id: 'K-2614', grandDeplacement: true }, 400, /à l’étranger/);
  await refus(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: 'oui' }, 400);
  await refus(ADMIN, 'chantier.grandDeplacement', { id: 'K-9999', grandDeplacement: true }, 404);
  assert.match(await run(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: true }), /^Chantier K-2620 \(Maintenance zone ATEX, Feyzin\) : grand déplacement — 4 missions · jours, nuits et trajets calculés, à saisir dans Sage/);
  assert.deepEqual((await sejours()).filter(s => s.startsWith('mission:')).sort(), ['mission:22:FR', 'mission:2:FR', 'mission:3:FR', 'mission:8:FR']);
  const j = (await journal('chantier.grandDeplacement')).at(-1)!;
  assert.deepEqual([j.payload.chantier, j.payload.avant?.grandDeplacement ?? null, j.payload.apres?.grandDeplacement, j.paie], ['K-2620', null, true, true]);
  assert.deepEqual(j.salaries.sort((a, b) => a - b), [2, 3, 8, 22]);
  assert.equal(familleAction('chantier.grandDeplacement')?.id, 'deplacements');
  assert.ok(JOURNAL_LABEL['chantier.grandDeplacement'] && estActionPaie('chantier.grandDeplacement'));
  assert.match(await run(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: true }), /qualification inchangée/);
  // Déplacement annulé : il sort ; intérimaire : exclu des éléments (payé par son agence).
  const v = (await d()).ds.voyages.find(x => x.empId === 9 && x.dest === 'IN')!;
  await run(ADMIN, 'voyage.annuler', { id: v.id, motif: 'Salon reporté' });
  assert.ok(!(await sejours()).includes('voyage:9:IN'));
  await db.update('employes', 3, { typeContrat: 'interim', agence: 'Proman Lyon' });
  assert.ok(!(await deplacementsAEmettre(db, await d(), '2026-10')).some(x => x.empId === 3));
});

test('t031 missions qui se chevauchent ou se suivent : un seul séjour par salarié, chaque jour compté une fois', async () => {
  const { db, run, d, ADMIN } = await fresh();
  await run(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: true });
  const mehdi = async () => (await deplacementsAEmettre(db, await d(), '2026-10')).filter(x => x.empId === 2).map(x => [x.rubrique, x.quantite]);
  assert.deepEqual(await mehdi(), [['GD_JOUR', 2], ['GD_NUIT', 1], ['TRAJET', 2]]);
  const m = (await d()).ds.missions.find(x => x.empId === 2 && x.projet === 'K-2620')!;
  // Seconde affectation aux mêmes dates : rien de plus (pas 4 jours et 2 nuits pour 2 jours calendaires).
  await db.insert('missions', { empId: 2, projet: 'K-2620', lieu: m.lieu, du: m.du, au: m.au, type: m.type, ref: null });
  assert.deepEqual(await mehdi(), [['GD_JOUR', 2], ['GD_NUIT', 1], ['TRAJET', 2]]);
  // Changement de chantier le dernier jour (fin le 9, suite du 9 au 12) : un séjour de 5 jours, 4 nuits, aller et retour.
  await db.insert('missions', { empId: 2, projet: 'K-2620', lieu: m.lieu, du: m.au, au: '2026-10-12', type: m.type, ref: null });
  assert.deepEqual(await mehdi(), [['GD_JOUR', 5], ['GD_NUIT', 4], ['TRAJET', 2]]);
  // Mission qui suit le lendemain (affectations découpées) : même séjour, sous l'identifiant de la première mission.
  await db.insert('missions', { empId: 2, projet: 'K-2620', lieu: m.lieu, du: '2026-10-13', au: '2026-10-13', type: m.type, ref: null });
  assert.deepEqual(await mehdi(), [['GD_JOUR', 6], ['GD_NUIT', 5], ['TRAJET', 2]]);
  assert.ok((await deplacementsAEmettre(db, await d(), '2026-10')).filter(x => x.empId === 2).every(x => x.source === 'mission' && x.sourceId === m.id));
  // Après un jour d'écart : un autre séjour, avec ses trajets.
  await db.insert('missions', { empId: 2, projet: 'K-2620', lieu: m.lieu, du: '2026-10-15', au: '2026-10-16', type: m.type, ref: null });
  assert.deepEqual((await mehdi()).filter(([r]) => r === 'TRAJET').map(([, q]) => q), [2, 2]);
});

test('t031 affectation réaffectée par Keystone après transmission : régularisée chez l’ancien salarié, émise chez le nouveau', async () => {
  const { db, run, d, lots, ADMIN, PAIE } = await fresh();
  await run(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: true });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  await run(PAIE, 'paie.lotConfirmer', { id: (await lots()).at(-1)!.id });
  assert.deepEqual(await deplacementsAEmettre(db, await d(), '2026-10'), []);
  // Mission de Mehdi Benali (8 et 9 octobre) renvoyée par Keystone pour un autre salarié.
  const m = (await d()).ds.missions.find(x => x.empId === 2 && x.projet === 'K-2620')!;
  await db.update('missions', m.id, { empId: 5 });
  const reg = await deplacementsAEmettre(db, await d(), '2026-10');
  assert.deepEqual(reg.filter(x => x.empId === 2).map(x => [x.rubrique, x.quantite, x.sourceId]), [['GD_JOUR', -2, m.id], ['GD_NUIT', -1, m.id], ['TRAJET', -2, m.id]]);
  assert.deepEqual(reg.filter(x => x.empId === 5).map(x => [x.rubrique, x.quantite, x.sourceId]), [['GD_JOUR', 2, m.id], ['GD_NUIT', 1, m.id], ['TRAJET', 2, m.id]]);
  assert.equal(reg.length, 6);
});

// — Cycle d'un lot —

test('t031 réglage désactivé (défaut) : éléments sans code Sage, « à saisir dans Sage » dans le résumé et l’export, jamais renvoyés', async () => {
  const { db, run, d, lots, journal, ADMIN, PAIE } = await fresh();
  assert.equal((await d()).ds.settings.deplacementsFichierPaie, false);
  await run(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: true });
  const msg = await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  assert.match(msg, / · 7 séjours \(déplacements\) · \d+ éléments à saisir dans Sage/);
  const lot = (await lots()).at(-1)!;
  const dep = lot.contenu!.deplacements!;
  assert.ok(dep.length && dep.every(x => x.codeSage === null), 'aucun code Sage : hors du fichier');
  assert.ok(!L.lignesFichier(lot.contenu!).some(l => P.RUBRIQUES_DEPLACEMENT.includes(l.rubrique as 'GD_JOUR')));
  // Mehdi Benali, repérage à Feyzin les 8 et 9 octobre : 2 jours, 1 nuit, 2 trajets.
  assert.deepEqual(dep.filter(x => x.empId === 2).map(x => [x.rubrique, x.quantite]), [['GD_JOUR', 2], ['GD_NUIT', 1], ['TRAJET', 2]]);
  // Tanger : octobre seulement dans le lot d'octobre ; pays en détail.
  assert.deepEqual(dep.filter(x => x.empId === 18).map(x => [x.rubrique, x.quantite, x.pays]), [['ETR_JOUR', 5, 'MA'], ['TRAJET', 1, 'MA']]);
  // Résumé : liste nominative à saisir dans Sage, détail avec le pays.
  const aSaisir = lot.resume.aSaisir!.filter(x => x.famille === 'deplacements');
  assert.equal(aSaisir.length, dep.length);
  assert.ok(aSaisir.some(x => x.empId === 18 && x.rubrique === 'ETR_JOUR' && x.detail.startsWith('Maroc · du 27/10/2026 au 31/10/2026 · déplacement n° ')));
  assert.deepEqual(lot.resume.deplacements, { elements: dep.length, salaries: new Set(dep.map(x => x.empId)).size });
  assert.deepEqual(lot.deplacements!.find(x => x.empId === 18), { source: 'voyage', id: (await d()).ds.voyages.find(v => v.empId === 18 && v.dest === 'MA')!.id, empId: 18 });
  // Journal : séjours par source et identifiant, salariés ; jamais une quantité ni un pays.
  const j = (await journal('paie.lotGenerer')).at(-1)!;
  assert.ok(j.payload.deplacements.every((x: string) => /^(voyage|mission):\d+$/.test(x)));
  assert.ok(j.salaries.includes(18) && !JSON.stringify(j.payload).includes('MA'));
  // Export des variables : lignes « À saisir dans Sage », pays et dates en détail.
  const vars = (await variablesDeLaPeriode(db, PAIE, '2026-10')).filter(v => v.empId === 18);
  assert.ok(vars.some(v => v.rubrique === A_SAISIR && v.libelle === RUBRIQUES_PAIE.ETR_JOUR.label && v.detail.startsWith('Maroc · du 27/10/2026') && v.lot === `n° ${lot.id}`));
  // Réservés tant que le lot attend : plus rien à émettre ; annulé, de nouveau en attente (lignes supprimées).
  assert.deepEqual(await deplacementsAEmettre(db, await d(), '2026-10'), []);
  assert.match(await run(PAIE, 'paie.lotAnnuler', { id: lot.id }), / et 7 séjours \(déplacements\) libérés, de nouveau en attente/);
  assert.equal((await db.all('deplacementsPaie')).length, 0);
  assert.equal((await deplacementsAEmettre(db, await d(), '2026-10')).length, dep.length);
  // Confirmé : transmis (saisis dans Sage), ils ne repartent plus, même une fois le réglage coché.
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  await run(PAIE, 'paie.lotConfirmer', { id: (await lots()).at(-1)!.id });
  assert.ok((await db.all<{ sage: boolean }>('deplacementsPaie')).every(x => x.sage));
  await run(ADMIN, 'parametres.maj', { deplacementsFichierPaie: true });
  assert.deepEqual(await deplacementsAEmettre(db, await d(), '2026-10'), []);
  // Novembre : la suite du séjour à Tanger part dans le lot de novembre.
  assert.ok((await deplacementsAEmettre(db, await d(), '2026-11')).some(x => x.empId === 18 && x.mois === '2026-11' && x.rubrique === 'ETR_JOUR' && x.quantite === 6));
});

test('t031 réglage activé : fichier d’import sous les codes Sage, codes à confirmer, régularisation d’un déplacement annulé', async () => {
  const { db, run, refus, d, lots, ADMIN, PAIE } = await fresh();
  await run(ADMIN, 'parametres.maj', { deplacementsFichierPaie: true });
  // Rubriques encore désactivées : toujours à saisir dans Sage.
  assert.ok((await deplacementsAEmettre(db, await d(), '2026-10')).every(x => x.codeSage === null));
  await run(PAIE, 'paie.rubrique', { code: 'ETR_JOUR', codeSage: '7300', active: true });
  await run(PAIE, 'paie.rubrique', { code: 'TRAJET', codeSage: '7400', active: true });
  // Lot réel : code à confirmer → refus (ETR_JOUR), après confirmation des autres rubriques.
  for (const code of Object.keys(RUBRIQUES_PAIE).filter(c => c !== 'ETR_JOUR')) await run(ADMIN, 'paie.rubrique', { code, confirmer: true });
  await avecMode('fichier', async () => await refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 409, /pour la rubrique ETR_JOUR/));
  await run(PAIE, 'paie.rubrique', { code: 'ETR_JOUR', confirmer: true });
  await avecMode('fichier', async () => await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }));
  const lot = (await lots()).at(-1)!;
  const mat = lot.contenu!.deplacements!.find(x => x.empId === 18)!.matricule;
  const lignes = L.lignesFichier(lot.contenu!).filter(l => l.matricule === mat);
  assert.deepEqual(lignes.filter(l => ['7300', '7400'].includes(l.rubrique)).map(l => [l.rubrique, l.quantite]), [['7300', 5], ['7400', 1]]);
  assert.equal(lot.contenu!.libelles!['7300'], RUBRIQUES_PAIE.ETR_JOUR.label);
  assert.ok(!lot.resume.aSaisir?.some(x => x.famille === 'deplacements'), 'tout est dans le fichier');
  assert.match(L.perimetreFichier(true, true), /jours et nuits de grand déplacement, jours à l’étranger et trajets : les heures de nuit restent saisies dans Sage\.$/);
  assert.match(L.perimetreFichier(false, true), /absences et heures de nuit restent saisies dans Sage\.$/);
  // Import confirmé, puis le déplacement aux États-Unis (12 au 16 octobre)… : celui de Tanger est raccourci au 30 octobre.
  await db.update('lotsPaie', lot.id, { telechargements: 1 });
  await avecMode('fichier', async () => await run(PAIE, 'paie.lotConfirmer', { id: lot.id }));
  const v = (await d()).ds.voyages.find(x => x.empId === 18 && x.dest === 'MA')!;
  await run(ADMIN, 'voyage.modifier', { id: v.id, depart: '2026-10-27', retour: '2026-10-30' });
  // Le séjour finit en octobre : 4 jours au lieu de 5 (régularisation de −1) et le trajet retour s'ajoute en octobre.
  const reg = (await deplacementsAEmettre(db, await d(), '2026-11')).filter(x => x.empId === 18);
  assert.deepEqual(reg.map(x => [x.rubrique, x.mois, x.quantite, x.codeSage]), [['ETR_JOUR', '2026-10', -1, '7300'], ['TRAJET', '2026-10', 1, '7400']]);
  // Annulé ensuite : tout ce qui est parti se régularise (négatif), sous les codes d'origine.
  await run(ADMIN, 'voyage.annuler', { id: v.id, motif: 'Chantier reporté' });
  assert.deepEqual((await deplacementsAEmettre(db, await d(), '2026-11')).filter(x => x.empId === 18).map(x => [x.rubrique, x.quantite, x.codeSage]), [['ETR_JOUR', -5, '7300'], ['TRAJET', -1, '7400']]);
});

test('t031 premier jour transmis : réglage de mise en service, date posée par le premier lot d’une base neuve, migration', async () => {
  const { db, run, d, lots, journal, ADMIN, PAIE } = await fresh();
  assert.equal(await premierJourDeplacements(db, (await d()).ds.settings), null);
  await run(ADMIN, 'parametres.maj', { deplacementsPaieAPartirDu: '2026-10-15' });
  assert.ok((await deplacementsAEmettre(db, await d(), '2026-10')).every(x => x.du >= '2026-10-15'), 'jours d’avant laissés à Sage');
  // États-Unis, 12 au 16 octobre : les 15 et 16 seulement, et le trajet retour (l'aller, le 12, est avant la date).
  assert.deepEqual((await deplacementsAEmettre(db, await d(), '2026-10')).filter(x => x.empId === 19).map(x => [x.rubrique, x.quantite, x.du]), [['ETR_JOUR', 2, '2026-10-15'], ['TRAJET', 1, '2026-10-16']]);
  await run(ADMIN, 'parametres.maj', { deplacementsPaieAPartirDu: null });
  // Base sans lot (mise en service) : le premier lot pose la date au premier jour de la période ouverte.
  await db.exec('DELETE FROM lots_paie');
  assert.match(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), / · déplacements transmis à partir du 1 oct\. 2026/);
  assert.equal(await db.getSetting(CLE_DEPUIS_DEPLACEMENTS, null), '2026-10-01');
  assert.equal((await journal('migration.deplacementsPaie')).at(-1)!.payload.depuis, '2026-10-01');
  assert.ok(estActionPaie('migration.deplacementsPaie'));
  assert.doesNotMatch(await run(PAIE, 'paie.lotAnnuler', { id: (await lots()).at(-1)!.id }), /à partir du/);
  // Migration nommée : base existante avec des déplacements, sans date ; une seule fois ; sans effet sur une base neuve.
  // (Base de démonstration en mémoire : aucune migration encore enregistrée, toutes passent.)
  await db.setSetting(CLE_DEPUIS_DEPLACEMENTS, null);
  assert.equal(await DEPLACEMENTS_DEPART.necessaire!(db), true);
  assert.ok((await appliquerMigrations(db)).includes(DEPLACEMENTS_DEPART.nom));
  assert.equal(await db.getSetting(CLE_DEPUIS_DEPLACEMENTS, null), '2026-10-01');
  assert.deepEqual(await appliquerMigrations(db), [], 'une seule fois');
  assert.ok(MIGRATIONS.at(-1) === DEPLACEMENTS_DEPART || MIGRATIONS.includes(DEPLACEMENTS_DEPART));
  // Base existante qui a déjà des lots mais aucun séjour (Keystone pas encore branché) : la date est posée aussi, faute
  // de quoi les affectations passées reçues ensuite partiraient en rappel (le premier lot ne la pose plus).
  const dir = mkdtempSync(join(tmpdir(), 'cursus-deplacements-'));
  try {
    const avant = new Db(join(dir, 'base.db'));
    await appliquerMigrations(avant);
    await avant.insert('lotsPaie', { periode: '2026-09', statut: 'transmis' });
    (await avant.run('DELETE FROM migrations WHERE nom = ?', [DEPLACEMENTS_DEPART.nom]));
    avant.sql.close();
    const existante = new Db(join(dir, 'base.db'));
    assert.equal(existante.neuve, false);
    assert.equal(await DEPLACEMENTS_DEPART.necessaire!(existante), true);
    assert.ok((await appliquerMigrations(existante)).includes(DEPLACEMENTS_DEPART.nom));
    assert.equal(await existante.getSetting(CLE_DEPUIS_DEPLACEMENTS, null), '2026-10-01');
    existante.sql.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const neuve = new Db(':memory:');
  await appliquerMigrations(neuve);
  assert.equal(await neuve.getSetting(CLE_DEPUIS_DEPLACEMENTS, null), null, 'base neuve : la date vient du premier lot');
});

test('t031 instantanés : déplacements en attente pour le service RH, la paie et la lecture seule ; rien ailleurs', async () => {
  const { db, run, ADMIN, PAIE, LECTURE, HSE, KARIM, MEHDI } = await fresh();
  const rh = (await buildSnapshot(db, ADMIN)).deplacementsPaie!;
  assert.ok(rh.elements.some(x => x.empId === 18 && x.rubrique === 'ETR_JOUR' && x.pays === 'MA' && x.aSaisir));
  // Feyzin, et le dépannage de Grenoble (archivé, missions d'octobre) : chantiers en France à qualifier.
  assert.deepEqual(rh.aQualifier.map(c => c.chantier).sort(), ['K-2620', 'K-2633']);
  assert.deepEqual((await buildSnapshot(db, PAIE)).deplacementsPaie, rh);
  assert.deepEqual((await buildSnapshot(db, LECTURE)).deplacementsPaie, rh);
  for (const u of [HSE, KARIM, MEHDI]) assert.equal((await buildSnapshot(db, u)).deplacementsPaie ?? null, null);
  await run(ADMIN, 'chantier.grandDeplacement', { id: 'K-2620', grandDeplacement: false });
  assert.deepEqual((await buildSnapshot(db, ADMIN)).deplacementsPaie!.aQualifier.map(c => c.chantier), ['K-2633']);
});

test('registre des éléments de lot : soldes de sortie inchangés, compteurs sans rubrique active listés à saisir dans Sage', async () => {
  const { db, run, lots, ADMIN, PAIE } = await fresh();
  // lot 11 — notes de frais : famille « frais » en dernier.
  assert.deepEqual(FAMILLES.map(f => f.cle), ['sorties', 'deplacements', 'rachats', 'astreintes', 'frais']);
  await run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = (await lots()).at(-1)!;
  // Comme avant : aucune rubrique de sortie active, rien ne part, le solde n'est pas réservé…
  assert.equal(lot.contenu!.sorties, undefined);
  assert.ok(!lot.sorties?.length);
  // … mais ses compteurs sont listés, nominativement, à saisir dans Sage.
  const s = lot.resume.aSaisir!.filter(x => x.famille === 'sorties');
  assert.ok(s.length && s.every(x => x.empId === 2 && x.detail === 'Solde de sortie au 16/10/2026'));
  assert.ok(s.some(x => x.rubrique === 'ICCP_J'));
  assert.ok((await variablesDeLaPeriode(db, PAIE, '2026-10')).some(v => v.empId === 2 && v.rubrique === A_SAISIR && v.libelle === RUBRIQUES_PAIE.ICCP_J.label));
  // Confirmation : réglé hors fichier, comme avant.
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  const solde = (await db.all<{ empId: number; horsFichier: boolean; sage: boolean; lotId: number }>('soldesSortie')).find(x => x.empId === 2)!;
  assert.deepEqual([solde.horsFichier, solde.sage, solde.lotId], [true, true, lot.id]);
  // Lecteur sans droit « paie » : la rubrique d'une absence à saisir est retirée (elle en dit la catégorie).
  await db.update('rubriquesPaie', 'ABS_NP', { active: false });
  const contenu = { lignes: [], absences: [{ absence: 9, empId: 1, matricule: 'X', mois: '2026-10', periode: '2026-10', rubrique: 'ABS_NP', codeSage: null, quantite: 1, du: '2026-10-07', au: '2026-10-07' }] };
  assert.deepEqual(E.elementsASaisir(contenu).map(x => [x.famille, x.rubrique]), [['absences', 'ABS_NP']]);
  await db.update('lotsPaie', lot.id, { resume: L.resumeContenu(contenu) });
  const gest = (await buildSnapshot(db, { ...ADMIN, profilRh: 'rh_gestionnaire' } as User)).lotsPaie.find(l => l.id === lot.id)!;
  assert.equal(gest.resume.aSaisir![0].rubrique, '');
});
