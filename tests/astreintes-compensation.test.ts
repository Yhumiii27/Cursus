// Compensation des astreintes chiffrée (lot 17, CU-051) : barème de Paramètres → Astreintes (0 par défaut, question
// CU-051-Q1), règles pures (forme choisie, par période et par heure, arrondi, textes), réglages (bornes, référence de
// l'accord exigée), éléments de paie AST_COMP (euros, colonne « montant » du fichier) et AST_REPOS (heures), au mois du
// début de l'astreinte, à saisir dans Sage tant que les rubriques sont désactivées, figés dans le lot ; jeu de
// démonstration du 10 octobre 2026 (Mehdi Benali, 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { variablesDeLaPeriode, A_SAISIR } = await import('../server/src/variables-paie.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { Domain } = await import('../shared/domain.ts');
const { appliquerReglages, decimal, REGLAGES } = await import('../shared/reglages.ts');
const A = await import('../shared/rules/astreintes.ts');
const P = await import('../shared/rules/astreintes-paie.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { elementsASaisir } = await import('../shared/rules/elements-lot.ts');
const { rubriquesPaie } = await import('../shared/rules/paie.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Astreinte = NonNullable<Dataset['astreintes']>[number];
type Lot = Dataset['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Settings = import('../shared/types.ts').Settings;

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
const MAINTENANT = A.instant('2026-10-10', '09:00');
const DEFAUTS = Object.fromEntries(Object.entries(REGLAGES).map(([k, r]) => [k, r.defaut])) as unknown as Settings;
/** Du lundi 28 septembre 18 h au lundi 5 octobre 8 h : 158 h. */
const SEMAINE = { du: '2026-09-28', debut: '18:00', au: '2026-10-05', fin: '08:00' };

test('règles : barème nul par défaut, forme choisie seule, par période et par heure, textes', () => {
  assert.equal(A.heuresAstreinte(SEMAINE), 158);
  assert.equal(A.baremeAstreinte(DEFAUTS), null, 'défaut : rien n’est chiffré');
  assert.equal(A.baremeAstreinte(undefined), null);
  assert.equal(A.compensationAstreinte(SEMAINE, DEFAUTS), null);
  assert.equal(A.baremeTexte(DEFAUTS), null);
  const fin = { ...DEFAUTS, astreinteMontantPeriode: 20, astreinteMontantHeure: 0.35, astreinteReposPeriode: 4 };
  assert.deepEqual(A.baremeAstreinte(fin), { forme: 'financiere', parPeriode: 20, parHeure: 0.35 });
  assert.deepEqual(A.compensationAstreinte(SEMAINE, fin), { rubrique: 'AST_COMP', quantite: 75.3 });
  assert.equal(A.baremeTexte(fin), '20,00 € par période + 0,35 € par heure d’astreinte');
  assert.equal(A.baremeTexte({ ...fin, astreinteMontantPeriode: 0 }), '0,35 € par heure d’astreinte');
  // Repos : le barème financier ne compte plus ; 4 h par période + 3 min par heure (158 h → 7,9 h).
  const repos = { ...fin, astreinteCompensation: 'repos' as const, astreinteReposHeure: 3 };
  assert.deepEqual(A.compensationAstreinte(SEMAINE, repos), { rubrique: 'AST_REPOS', quantite: 11.9 });
  assert.equal(A.baremeTexte(repos), '4 h de repos par période + 3 min de repos par heure d’astreinte');
  assert.equal(A.baremeTexte({ ...repos, astreinteReposPeriode: 0 }), '3 min de repos par heure d’astreinte');
  assert.equal(A.baremeAstreinte({ astreinteCompensation: 'repos', astreinteMontantPeriode: 50 }), null, 'barème de l’autre forme ignoré');
  assert.equal(A.baremeAstreinte({ astreinteMontantPeriode: Number.NaN, astreinteMontantHeure: -3 }), null);
  assert.equal(A.compensationQuantiteTexte({ rubrique: 'AST_COMP', quantite: 234.5 }), '234,50 €');
  assert.equal(A.compensationQuantiteTexte({ rubrique: 'AST_REPOS', quantite: 7.25 }), '7,25 h de repos');
  assert.equal(P.totauxAstreintes([{ rubrique: 'AST_H', quantite: 158 }, { rubrique: 'AST_PER', quantite: 1 }, { rubrique: 'AST_COMP', quantite: 75.3 }, { rubrique: 'AST_REPOS', quantite: 2 }]),
    '158 h d’astreinte (AST_H), 1 période (AST_PER), 75,30 € de compensation (AST_COMP), 2 h de repos (AST_REPOS)');
  assert.equal(P.detailAstreinte({ astreinte: 3, ...SEMAINE, mois: '2026-09', periode: '2026-09', rubrique: 'AST_COMP' }, p => p), 'Astreinte n° 3 du 28/09/2026 18:00 au 05/10/2026 08:00 · compensation en euros');
  assert.equal(P.detailAstreinte({ astreinte: 3, ...SEMAINE, mois: '2026-09', periode: '2026-10', rubrique: 'AST_REPOS' }, p => p),
    'Astreinte n° 3 du 28/09/2026 18:00 au 05/10/2026 08:00 · repos compensateur en heures · rappel de 2026-09');
});

test('réglages : bornes, centièmes, référence de l’accord exigée dès qu’une valeur n’est pas nulle ; rubriques désactivées', () => {
  assert.equal(decimal(0, 10)('3.456', 1), 3.46);
  assert.equal(decimal(0, 10)('abc', 1), 1);
  assert.equal(decimal(0, 10)(25, 1), 10);
  assert.equal(decimal(0, 10)(-2, 1), 0);
  assert.throws(() => appliquerReglages(DEFAUTS, { astreinteMontantPeriode: 20 }), /barème de compensation suppose l’accord/);
  const s = appliquerReglages(DEFAUTS, { astreinteMontantPeriode: 20.004, astreinteMontantHeure: 500, astreinteReposHeure: 7.6, astreinteReposPeriode: 99, astreinteAccord: 'Accord du 3 mars 2027' });
  assert.deepEqual([s.astreinteMontantPeriode, s.astreinteMontantHeure, s.astreinteReposPeriode, s.astreinteReposHeure], [20, A.MONTANT_HEURE_MAX, A.REPOS_PERIODE_MAX, 8]);
  for (const code of ['AST_COMP', 'AST_REPOS']) assert.equal(RUBRIQUES_PAIE[code].inactiveParDefaut, true, code);
  assert.deepEqual([RUBRIQUES_PAIE.AST_COMP.unite, RUBRIQUES_PAIE.AST_REPOS.unite], ['eur', 'h']);
});

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
  const inserer = async (du: string, au: string, o: Partial<Astreinte> = {}) => (await db.insert<Astreinte>('astreintes', {
    empId: 2, equipe: 'Maintenance', du, debut: '18:00', au, fin: '08:00', communiqueLe: '2026-09-10', motif: null, creeLe: '2026-09-10T08:00:00.000Z', creePar: 'Karim Haddad', ...o,
  })).id;
  const ADMIN = await user(null, 'rh');
  return { db, run, inserer, ADMIN, PAIE: await user(7, 'rh'), d: async () => new Domain(await loadFull(db, ADMIN)), lots: async () => await db.all<Lot>('lotsPaie') };
}

test('paie : sans barème, aucun élément de compensation ; financière en euros au mois du début, au montant dans le fichier, figée dans le lot', async () => {
  const { db, run, inserer, ADMIN, PAIE, d, lots } = await fresh();
  const id = await inserer('2026-09-28', '2026-10-05');
  assert.ok(!P.elementsAstreintes(await d(), '2026-10', rubriquesPaie([]), MAINTENANT).some(x => x.rubrique === 'AST_COMP' || x.rubrique === 'AST_REPOS'));
  // Barème refusé sans la référence de l'accord, puis réglé avec elle.
  await assert.rejects(run(ADMIN, 'parametres.maj', { astreinteMontantPeriode: 20 }), /barème de compensation/);
  await run(ADMIN, 'parametres.maj', { astreinteMontantPeriode: 20, astreinteMontantHeure: 0.35, astreinteAccord: 'Accord d’entreprise du 3 mars 2026' });
  const el = P.elementsAstreintes(await d(), '2026-10', rubriquesPaie([]), MAINTENANT);
  // Septembre clos : la compensation part en rappel sur octobre, comme la période.
  assert.deepEqual(el.filter(x => x.rubrique === 'AST_COMP').map(x => [x.astreinte, x.mois, x.periode, x.quantite, x.montant, x.codeSage]), [[id, '2026-09', '2026-10', 75.3, 75.3, null]]);
  assert.match(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /astreinte .*à saisir dans Sage/);
  let lot = (await lots()).at(-1)!;
  assert.deepEqual(lot.resume.astreintes, { elements: 4, salaries: 1 });
  assert.deepEqual(elementsASaisir(lot.contenu!).filter(x => x.rubrique === 'AST_COMP').map(x => [x.quantite, x.detail]),
    [[75.3, `Astreinte n° ${id} du 28/09/2026 18:00 au 05/10/2026 08:00 · compensation en euros · rappel de septembre 2026`]]);
  const v = (await variablesDeLaPeriode(db, PAIE, '2026-10')).filter(x => x.empId === 2 && /compensation en euros/.test(x.detail));
  assert.deepEqual(v.map(x => [x.rubrique, x.quantite]), [[A_SAISIR, 75.3]]);
  // Barème changé après la génération : le lot garde son contenu figé.
  await run(ADMIN, 'parametres.maj', { astreinteMontantPeriode: 50 });
  assert.equal((await lots()).at(-1)!.contenu!.astreintes!.find(x => x.rubrique === 'AST_COMP')!.quantite, 75.3);
  // Rubrique activée : une ligne au montant (quantité 1) ; les heures restent à saisir.
  await run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  await run(PAIE, 'paie.rubrique', { code: 'AST_COMP', active: true, codeSage: '430' });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  lot = (await lots()).at(-1)!;
  assert.deepEqual(L.lignesFichier(lot.contenu!).filter(x => x.rubrique === '430'), [{ matricule: lot.contenu!.astreintes![0].matricule, periode: '2026-10', rubrique: '430', quantite: 1, montant: 105.3 }]);
  assert.ok(!L.lignesFichier(lot.contenu!).some(x => x.rubrique === 'AST_H'));
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  assert.deepEqual(P.elementsAstreintes(new Domain(await loadFull(db, ADMIN)), '2026-12', rubriquesPaie([]), MAINTENANT), []);
});

test('paie : compensation en repos (AST_REPOS, heures), dans le fichier comme une quantité une fois activée', async () => {
  const { run, inserer, ADMIN, PAIE, d, lots } = await fresh();
  await inserer('2026-10-02', '2026-10-03'); // vendredi 18 h → samedi 8 h : 14 h
  await run(ADMIN, 'parametres.maj', { astreinteCompensation: 'repos', astreinteReposPeriode: 1.5, astreinteReposHeure: 6, astreinteMontantPeriode: 30, astreinteAccord: 'Décision de l’employeur du 2 février 2026' });
  const el = P.elementsAstreintes(await d(), '2026-10', rubriquesPaie([]), MAINTENANT);
  assert.deepEqual(el.filter(x => x.rubrique.startsWith('AST_')).map(x => [x.rubrique, x.quantite, x.montant]), [['AST_H', 14, undefined], ['AST_PER', 1, undefined], ['AST_REPOS', 2.9, undefined]]);
  await run(PAIE, 'paie.rubrique', { code: 'AST_REPOS', active: true, codeSage: '431' });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = (await lots()).at(-1)!;
  assert.deepEqual(L.lignesFichier(lot.contenu!).filter(x => x.rubrique === '431').map(x => [x.quantite, x.montant]), [[2.9, undefined]]);
});
