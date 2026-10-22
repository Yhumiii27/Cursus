// Lot 6, chantier 1 étape 2 (t048) : contrôles tirés des horaires de poste — repos quotidien de 11 h et pause de 20 min en
// alerte avec motif, heures de nuit sur la plage réglée (HNUIT, MAJ_NUIT figée à la validation, rubriques inactives listées
// « à saisir dans Sage »), nuit refusée aux mineurs, statut de travailleur de nuit et alerte « suivi médical adapté »,
// réglages du travail de nuit (valeurs de la loi, accord exigé pour s'en écarter), aucun contrôle rétroactif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { PG, nouvelleBase, sqlite } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { HORAIRES_NUIT_FIGEE } = await import('../server/src/migrations/lot6-horaires.ts');
const { variablesDeLaPeriode, A_SAISIR } = await import('../server/src/variables-paie.ts');
const { Domain } = await import('../shared/domain.ts');
const { appliquerReglages, ReglageInvalide, reglagesParDefaut } = await import('../shared/reglages.ts');
const { calcSheet, sageRubriques } = await import('../shared/rules/temps.ts');
const { naissanceDeLaFeuille } = await import('../shared/rules/mineurs.ts');
const { elementsASaisir } = await import('../shared/rules/elements-lot.ts');
const R = await import('../shared/rules/repos-nuit.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Feuille = Dataset['feuilles'][number];

const J = { code: 'J', debut: '08:00', fin: '16:00', pause: 60 };
const M = { code: 'M', debut: '05:00', fin: '13:00', pause: 30 };
const AM = { code: 'AM', debut: '13:00', fin: '21:00', pause: 30 };
const N = { code: 'N', debut: '21:00', fin: '05:00', pause: 30 };
const SEMAINE = '2026-10-19';
const jours = (...h: number[]) => [...h, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
const sans = <T>(...x: T[]) => [...x, null, null, null, null, null, null, null].slice(0, 7) as (T | null)[];

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteId = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteId(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o: { message?: string | null; result?: unknown } = typeof r === 'object' && r !== null ? r as { message?: string; result?: unknown } : { message: r as string | null };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result ?? null });
    return o.message ?? null;
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && motif.test(e.message), `${name} : ${motif}`);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const feuille = async (empId: number, week = SEMAINE) => (await db.all<Feuille>('feuilles')).find(f => f.empId === empId && f.week === week)!;
  const derniere = async (action: string) => (await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).findLast(j => j.action === action);
  /** Feuille de Mehdi (Maintenance, horaire J proposé) : heures de chaque jour et horaires choisis. */
  const saisir = async (u: User, h: number[], horaires: (string | null)[] = [], empId = 2, week = SEMAINE) => {
    const base = { empId, week };
    await run(u, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
    for (const [di, v] of (h).entries()) { if (v) await run(u, 'temps.setCell', { ...base, li: 0, di, value: String(v) }); }
    for (const [di, c] of (horaires).entries()) { if (c != null) await run(u, 'temps.horaire', { ...base, di, code: c }); }
    return base;
  };
  return { db, user, run, refuse, RH, domain, feuille, derniere, saisir };
}

test('heures de nuit : plage réglée, pause retirée au prorata, poste de nuit rattaché au jour où il commence', () => {
  const s = R.reglagesNuit(undefined);
  assert.deepEqual([s.nuitDebut, s.nuitFin, s.nuitSeuilQuotidien, s.nuitSeuilAnnuel, s.nuitMajoration], [21, 6, 3, 270, 0], 'valeurs de la loi par défaut');
  // N de 21 h à 5 h, 7,5 h travaillées : tout de nuit.
  assert.equal(R.heuresDeNuit(R.plageDuJour(N, 7.5, 1), s), 7.5);
  // M de 5 h à 13 h : une heure de nuit (5 h – 6 h), pause retirée au prorata (60 × 450 / 480 min).
  assert.equal(R.heuresDeNuit(R.plageDuJour(M, 7.5, 0), s), 0.94);
  assert.equal(R.heuresDeNuit(R.plageDuJour(AM, 7.5, 0), s), 0, 'AM finit à 21 h : aucune heure de nuit');
  // AM prolongé de 2 h (fin à 23 h) : 2 h de nuit, au prorata de la pause.
  assert.equal(R.heuresDeNuit(R.plageDuJour(AM, 9.5, 0), s), 1.9);
  // Plage de nuit d'un accord, 22 h – 7 h : N n'a plus que 7 h de nuit au prorata.
  assert.equal(R.heuresDeNuit(R.plageDuJour(N, 7.5, 0), { nuitDebut: 22, nuitFin: 7 }), 6.56);
  assert.equal(R.plageDuJour(N, 0, 0), null, 'sans heure, aucune plage');
  assert.equal(R.plageDuJour(null, 7, 0), null, 'sans horaire, aucune plage (comportement d’avant)');
});

test('repos quotidien de 11 h et pause de 20 min : alertes datées, dimanche précédent compris ; cadre dirigeant exclu', () => {
  // AM le lundi (fin à 21 h), M le mardi (reprise à 5 h) : 8 h de repos.
  const c = R.controlesReposNuit(sans(AM, M), jours(7.5, 7.5), SEMAINE, {});
  assert.deepEqual(c.codes, ['repos_quotidien']);
  assert.match(c.repos[0], /Repos quotidien de 11 h consécutives \(art\. L3131-1\) non respecté : 8 h avant le mar\. 20 oct\. \(fin à 21 h, reprise à 5 h\)/);
  // M puis AM : 16 h de repos, permis ; J tous les jours : 16 h.
  assert.deepEqual(R.controlesReposNuit(sans(M, AM), jours(7.5, 7.5), SEMAINE, {}).codes, []);
  assert.deepEqual(R.controlesReposNuit([J, J, J, J, J, null, null], jours(7, 7, 7, 7, 7), SEMAINE, {}).codes, []);
  // Heures en plus de l'horaire : la journée s'allonge (J de 8 h à 21 h avec 12 h), reprise à 5 h le lendemain : 8 h.
  assert.deepEqual(R.controlesReposNuit(sans(J, M), jours(12, 7.5), SEMAINE, {}).codes, ['repos_quotidien']);
  // Dimanche précédent de nuit (fin le lundi à 5 h), M le lundi à 5 h : aucun repos.
  const veille = R.controlesReposNuit(sans(M), jours(7.5), SEMAINE, { veille: { horaire: N, heures: 7.5 } });
  assert.match(veille.repos[0], /aucun repos avant le lun\. 19 oct\. \(fin à 5 h, reprise à 5 h\)/);
  // Pause : 20 min dès 6 h de travail ; un horaire sans pause de 7 h l'enfreint, de 5 h non.
  const P0 = { code: 'P0', debut: '06:00', fin: '13:00', pause: 0 };
  const p = R.controlesReposNuit(sans(P0, P0), jours(7, 5), SEMAINE, {});
  assert.deepEqual(p.codes, ['pause']);
  assert.match(p.pauses[0], /Pause de 20 min au moins dès 6 h de travail \(art\. L3121-16\) : lun\. 19 oct\. \(7 h, pause de 0 min\)$/);
  // Cadre dirigeant : ni repos ni pause contrôlés ; les heures de nuit restent comptées.
  const dir = R.controlesReposNuit(sans(AM, M), jours(7.5, 7.5), SEMAINE, { exclu: true });
  assert.deepEqual([dir.codes, dir.nuit], [[], 0.94]);
  // Sans horaire : aucun contrôle, comme avant.
  assert.deepEqual(R.controlesReposNuit(Array(7).fill(null), jours(13, 13), SEMAINE, {}).codes, []);
});

test('mineur : nuit refusée (22 h – 6 h, 20 h – 6 h avant 16 ans), repos de 12 h, pause de 30 min au-delà de 4 h 30', () => {
  const LEO = { naissance: 2008, naissanceLe: '2008-10-14', nom: 'Léo Martin' }; // 18 ans le 14 octobre 2026
  const INES = { naissance: 2011, naissanceLe: '2011-03-02', nom: 'Inès Faure' }; // 15 ans
  const n = R.controlesReposNuit(sans(N), jours(7.5), '2026-10-05', { naissance: LEO });
  assert.deepEqual(n.codes, ['nuit_mineur']);
  assert.match(n.nuitMineur[0], /Travail de nuit interdit à un salarié de moins de 18 ans.*lun\. 5 oct\. \(21 h – 5 h\)/);
  assert.match(R.refusNuitMineur(LEO, M, '2026-10-12')!, /Horaire M \(5 h – 13 h\) : Léo Martin a moins de 18 ans et ne peut pas travailler de 22 h à 6 h/);
  assert.equal(R.refusNuitMineur(LEO, M, '2026-10-14'), null, 'le jour des 18 ans : permis');
  assert.equal(R.refusNuitMineur(LEO, J, '2026-10-12'), null);
  // Moins de 16 ans : AM (fin à 21 h) empiète sur 20 h – 6 h.
  assert.match(R.refusNuitMineur(INES, AM, '2026-10-12')!, /de 20 h à 6 h/);
  assert.equal(R.refusNuitMineur(LEO, AM, '2026-10-12'), null, '16 ans et plus : 21 h, permis');
  // Repos de 12 h : J de 8 h à 16 h puis J à 8 h (16 h) permis ; J prolongé jusqu'à 21 h puis 8 h : 11 h, refusé au mineur.
  const LONG = { code: 'L', debut: '08:00', fin: '16:00', pause: 60 };
  assert.deepEqual(R.controlesReposNuit(sans(LONG, LONG), jours(12, 7), '2026-10-05', { naissance: LEO }).codes, ['repos_quotidien']);
  assert.deepEqual(R.controlesReposNuit(sans(LONG, LONG), jours(12, 7), '2026-10-05', {}).codes, [], '11 h tout juste pour un majeur');
  // Pause de 30 min au-delà de 4 h 30 : M (30 min) suffit ; 15 min non.
  const P15 = { code: 'P', debut: '08:00', fin: '13:00', pause: 15 };
  assert.match(R.controlesReposNuit(sans(P15), jours(5), '2026-10-05', { naissance: LEO }).pauses[0], /Pause de 30 min.*art\. L3162-3/);
  // Moins de 16 ans : repos de 14 h, annoncé tel quel. J (8 h – 16 h 30) puis reprise à 6 h : 13,5 h.
  const E6 = { code: 'E', debut: '06:00', fin: '13:00', pause: 30 };
  const ines = R.controlesReposNuit(sans(J, E6), jours(7.5, 6), '2026-10-19', { naissance: INES });
  assert.deepEqual(ines.codes, ['repos_quotidien']);
  assert.match(ines.repos[0], /^Repos quotidien de 14 h \(salarié de moins de 16 ans, art\. L3164-1\) non respecté : 13,5 h avant le mar\. 20 oct\./);
  // Vue sans la date de naissance : l'indication `moins16` de la feuille donne le même seuil ; sans elle, 12 h seulement.
  const vue = { naissance: 2011, naissanceLe: null, mineur: true };
  assert.equal(R.controlesReposNuit(sans(J, E6), jours(7.5, 6), '2026-10-19', { naissance: naissanceDeLaFeuille(vue, { mineur: true, moins16: true }) }).repos[0], ines.repos[0]);
  assert.deepEqual(R.controlesReposNuit(sans(J, E6), jours(7.5, 6), '2026-10-19', { naissance: naissanceDeLaFeuille(vue, { mineur: true }) }).codes, []);
});

test('moins de 16 ans : la feuille vue par le manager porte l’indication, son écran demande le motif comme le serveur', async () => {
  const { db, run, refuse, RH, user, domain } = await fresh();
  const KARIM = await user(12, 'manager');
  await run(RH, 'employe.creer', {
    nom: 'Inès Faure', poste: 'Apprentie', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', jourOff: [],
    entree: '2026-09-01', fin: '2028-08-31', naissanceLe: '2011-06-01', email: 'ines.faure@entreprise.example',
  });
  const id = (await db.all<{ id: number; nom: string }>('employes')).find(e => e.nom === 'Inès Faure')!.id;
  const b = { empId: id, week: SEMAINE };
  await run(RH, 'temps.addLine', { ...b, projet: 'INT-MAINT' });
  // Lundi J prolongé jusqu'à 19 h (10 h), mardi J à 8 h : 13 h de repos, assez à 16 ans, pas avant.
  await run(RH, 'temps.setCell', { ...b, li: 0, di: 0, value: '10' });
  await run(RH, 'temps.setCell', { ...b, li: 0, di: 1, value: '7' });
  await run(RH, 'temps.horaire', { ...b, di: 0, code: 'J' });
  await run(RH, 'temps.horaire', { ...b, di: 1, code: 'J' });
  const rh = await domain(), attendu = calcSheet(rh, rh.emp(id)!, rh.ds.feuilles.find(f => f.empId === id && f.week === SEMAINE)!).reposQuotidien;
  assert.match(attendu[0], /Repos quotidien de 14 h/);
  const snap = await buildSnapshot(db, KARIM), sh = snap.feuilles.find(f => f.empId === id && f.week === SEMAINE)!;
  assert.deepEqual([snap.employes.find(e => e.id === id)!.naissanceLe, sh.mineur, sh.moins16], [null, true, true], 'indications de la semaine, jamais la date');
  const d = new Domain(snap);
  assert.deepEqual(calcSheet(d, d.emp(id)!, sh).reposQuotidien, attendu, 'même alerte chez le manager que sur le serveur');
  await refuse(RH, 'temps.submit', b, /Repos quotidien de 14 h/);
});

test('feuille : repos et pause à motiver, nuit d’un mineur refusée, heures de nuit et majoration figée à la validation', async () => {
  const { db, run, refuse, RH, user, feuille, derniere, domain, saisir } = await fresh();
  const MEHDI = await user(2, 'collaborateur'), KARIM = await user(12, 'manager');
  // Lundi AM, mardi M : repos de 8 h ; mercredi N (nuit), jeudi sans heure.
  const base = await saisir(MEHDI, [7.5, 7.5, 7.5], ['AM', 'M', 'N']);
  const d = await domain(), c = calcSheet(d, d.emp(2)!, await feuille(2));
  assert.equal(c.nuit, 8.44);
  assert.equal(c.reposQuotidien.length, 1);
  assert.ok(c.depassements.includes(c.reposQuotidien[0]), 'à motiver comme un dépassement');
  await refuse(MEHDI, 'temps.submit', base, /Repos quotidien de 11 h.*indiquez le motif du dépassement avant de soumettre/);
  await run(MEHDI, 'temps.submit', { ...base, motif: 'Remplacement d’un collègue absent' });
  assert.equal((await feuille(2)).statut, 'soumise');
  assert.deepEqual((await derniere('temps.submit'))!.payload.reposNuit, ['repos_quotidien'], 'contrôle codé au journal, sans le motif');
  // Majoration réglée à 25 % : figée à la validation ; un changement ultérieur ne touche plus la semaine.
  await run(RH, 'parametres.maj', { nuitMajoration: 25 });
  await run(KARIM, 'temps.validate', base);
  assert.equal((await feuille(2)).majNuit, 25);
  await run(RH, 'parametres.maj', { nuitMajoration: 50 });
  const d2 = await domain(), r = sageRubriques(d2, d2.emp(2)!, await feuille(2));
  assert.deepEqual([r.HNUIT, r.MAJ_NUIT], [8.4, 2.1]);
  assert.equal(r.HN, 22.5, 'heures de nuit comprises dans les heures normales');

  // Léo, apprenti mineur de la Maintenance : horaire de nuit refusé au choix, et une feuille proposée en M refusée.
  await run(RH, 'employe.creer', {
    nom: 'Léo Martin', poste: 'Apprenti', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', jourOff: [],
    entree: '2026-09-01', fin: '2028-08-31', naissanceLe: '2010-01-04', email: 'leo.martin@entreprise.example',
  });
  const id = (await db.all<{ id: number; nom: string }>('employes')).find(e => e.nom === 'Léo Martin')!.id;
  const b = { empId: id, week: SEMAINE };
  await run(RH, 'temps.addLine', { ...b, projet: 'INT-MAINT' });
  await run(RH, 'temps.setCell', { ...b, li: 0, di: 0, value: '7' });
  await refuse(RH, 'temps.horaire', { ...b, di: 0, code: 'N' }, /Horaire N \(21 h – 5 h\) : Léo Martin a moins de 18 ans/);
  await run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], horaire: 'M' });
  await refuse(RH, 'temps.submit', { ...b, motif: 'Inventaire' }, /Travail de nuit interdit à un salarié de moins de 18 ans.*changez l’horaire du jour avant de soumettre/);
  await run(RH, 'temps.horaire', { ...b, di: 0, code: 'J' });
  await run(RH, 'temps.submit', b);
  assert.equal((await feuille(id)).statut, 'soumise');
});

test('aucun contrôle rétroactif : feuille validée d’avant les horaires sans heure de nuit ; migration de la majoration figée', async () => {
  const { db, domain } = await fresh();
  const validees = (await db.all<Feuille>('feuilles')).filter(f => f.statut === 'validee');
  assert.ok(validees.length > 0 && validees.every(f => !f.horairesFiges), 'démonstration : feuilles validées sans horaire');
  const d = await domain();
  assert.ok(validees.every(f => calcSheet(d, d.emp(f.empId)!, f).nuit === 0 && !calcSheet(d, d.emp(f.empId)!, f).reposQuotidien.length));
  // Migration nommée (propre au fichier SQLite) ; sur PostgreSQL, 0003_lot6_etape2.sql fait la même reprise.
  if (PG) return;
  assert.equal(await HORAIRES_NUIT_FIGEE.necessaire!(sqlite(db)), true);
  assert.ok((await appliquerMigrations(sqlite(db))).includes('lot6-horaires-majoration-nuit'));
  assert.ok((await db.all<Feuille>('feuilles')).filter(f => f.statut === 'validee').every(f => f.majNuit === 0));
  assert.ok((await db.all<Feuille>('feuilles')).filter(f => f.statut !== 'validee').every(f => f.majNuit == null), 'brouillons et soumises : le réglage s’appliquera');
  assert.deepEqual(await appliquerMigrations(sqlite(db)), [], 'une seule fois');
});

test('paie : HNUIT et MAJ_NUIT inactives, listées « à saisir dans Sage » dans l’export et le lot ; actives, dans le fichier', async () => {
  const { db, run, RH, user, saisir } = await fresh();
  const MEHDI = await user(2, 'collaborateur'), KARIM = await user(12, 'manager'), PAIE = await user(7, 'rh');
  await run(RH, 'parametres.maj', { nuitMajoration: 25 });
  const base = await saisir(MEHDI, [0, 0, 7.5], ['', '', 'N']);
  await run(MEHDI, 'temps.submit', base);
  await run(KARIM, 'temps.validate', base);
  const nuit = (await variablesDeLaPeriode(db, PAIE, '2026-10')).filter(l => l.empId === 2 && /heures de nuit/i.test(l.libelle));
  assert.deepEqual(nuit.map(l => [l.rubrique, l.quantite, l.etat]), [[A_SAISIR, 7.5, 'En attente d’un lot'], [A_SAISIR, 1.9, 'En attente d’un lot']]);
  assert.match(nuit[0].detail, /Semaine 2026-S43 · heures de nuit/);
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = (await db.all<{ contenu: { lignes: { matricule: string; rubriques: Record<string, number> }[]; aSaisir?: { famille: string; empId: number; periode: string; rubrique: string; quantite: number; detail: string }[] } }>('lotsPaie')).at(-1)!;
  assert.deepEqual(lot.contenu.aSaisir!.filter(x => x.famille === 'nuit').map(x => [x.empId, x.rubrique, x.quantite]), [[2, 'HNUIT', 7.5], [2, 'MAJ_NUIT', 1.9]]);
  assert.ok(lot.contenu.lignes.every(l => !('HNUIT' in l.rubriques)), 'absentes du fichier');
  assert.equal(elementsASaisir(lot.contenu).filter(x => x.famille === 'nuit').length, 2, 'dans le résumé du lot');
  // Activées par la paie : dans le fichier, plus à saisir.
  const autre = await fresh();
  await autre.run(autre.RH, 'parametres.maj', { nuitMajoration: 25 });
  await autre.run(await autre.user(7, 'rh'), 'paie.rubrique', { code: 'HNUIT', active: true, codeSage: '2100' });
  const b2 = await autre.saisir(await autre.user(2, 'collaborateur'), [0, 0, 7.5], ['', '', 'N']);
  await autre.run(await autre.user(2, 'collaborateur'), 'temps.submit', b2);
  await autre.run(await autre.user(12, 'manager'), 'temps.validate', b2);
  const v = (await variablesDeLaPeriode(autre.db, await autre.user(7, 'rh'), '2026-10')).filter(l => l.empId === 2 && /heures de nuit/i.test(l.libelle));
  assert.deepEqual(v.map(l => [l.rubrique, l.quantite]), [['2100', 7.5], [A_SAISIR, 1.9]], 'MAJ_NUIT encore inactive');
});

test('paie : feuille régularisée, l’écart des heures de nuit inactives listé « à saisir dans Sage » (régularisation)', async () => {
  const { db, run, RH, user, saisir, feuille } = await fresh();
  const MEHDI = await user(2, 'collaborateur'), KARIM = await user(12, 'manager'), PAIE = await user(7, 'rh');
  type Lot = { id: number; contenu: { rubriquesFeuilles: { empId: number; week: string; aSaisir?: Record<string, Record<string, number>> }[]; aSaisir?: { famille: string; empId: number; periode: string; rubrique: string; quantite: number; detail: string }[] } };
  const dernierLot = async () => (await db.all<Lot>('lotsPaie')).at(-1)!;
  await run(RH, 'parametres.maj', { nuitMajoration: 25 });
  const base = await saisir(MEHDI, [0, 0, 7.5], ['', '', 'N']);
  await run(MEHDI, 'temps.submit', base);
  await run(KARIM, 'temps.validate', base);
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = await dernierLot();
  assert.deepEqual(lot.contenu.rubriquesFeuilles.find(x => x.empId === 2 && x.week === SEMAINE)!.aSaisir, { '2026-10': { HNUIT: 7.5, MAJ_NUIT: 1.9 } }, 'gardées par feuille');
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  // Rouverte par l'administrateur RH : la nuit du mercredi était une après-midi.
  await run(RH, 'temps.rouvrir', { ...base, motif: 'Horaire du mercredi erroné' });
  assert.deepEqual((await feuille(2)).reouverture!.aSaisir, { '2026-10': { HNUIT: 7.5, MAJ_NUIT: 1.9 } });
  assert.equal((await buildSnapshot(db, KARIM)).feuilles.find(f => f.empId === 2 && f.week === SEMAINE)!.reouverture!.aSaisir, undefined, 'jamais chez le manager');
  await run(RH, 'temps.horaire', { ...base, di: 2, code: 'AM' });
  await run(KARIM, 'temps.validate', base);
  // Export des variables puis lot correctif : la baisse des heures de nuit, à retirer de la saisie manuelle.
  const v = (await variablesDeLaPeriode(db, PAIE, '2026-10')).filter(l => l.empId === 2 && /heures de nuit/i.test(l.libelle) && l.etat === 'En attente d’un lot');
  assert.deepEqual(v.map(l => [l.rubrique, l.quantite]), [[A_SAISIR, -7.5], [A_SAISIR, -1.9]]);
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const nuit = (await dernierLot()).contenu.aSaisir!.filter(x => x.famille === 'nuit');
  assert.deepEqual(nuit.map(x => [x.empId, x.periode, x.rubrique, x.quantite]), [[2, '2026-10', 'HNUIT', -7.5], [2, '2026-10', 'MAJ_NUIT', -1.9]]);
  assert.match(nuit[0].detail, /^Semaine 2026-S43 · heures de nuit .* · régularisation$/);
  assert.equal((await dernierLot()).contenu.rubriquesFeuilles.find(x => x.empId === 2 && x.week === SEMAINE)!.aSaisir, undefined, 'plus aucune heure de nuit');
});

test('travailleur de nuit : deux semaines de deux nuits parmi les quatre dernières, ou 270 h sur 12 mois ; suivi adapté signalé', async () => {
  const { db, user, domain } = await fresh();
  const nuits = async (week: string, n: number, empId = 2) => (await db.run('DELETE FROM feuilles WHERE emp_id = ? AND week = ?', [empId, week]), await db.insert<Feuille>('feuilles', {
    empId, week, statut: 'validee', comment: null, sage: false, keystone: false, contrat: null, majNuit: 0,
    lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: Array.from({ length: 7 }, (_, i) => (i < n ? 7.5 : 0)) }],
    horairesFiges: Array.from({ length: 7 }, (_, i) => (i < n ? N : null)),
  }));
  const statut = async () => R.statutNuit((await domain()).ds, 2, '2026-10-10');
  assert.equal((await statut()).travailleur, false);
  await nuits('2026-09-21', 2);
  assert.deepEqual([(await statut()).travailleur, (await statut()).semaines], [false, 1], 'une seule semaine : pas habituel');
  await nuits('2026-09-28', 1);
  assert.equal((await statut()).travailleur, false, 'une seule nuit cette semaine-là');
  await nuits('2026-09-14', 3);
  assert.deepEqual([(await statut()).travailleur, (await statut()).critere], [true, 'hebdomadaire']);
  // Fiche : travailleur de nuit, alerte de suivi adapté (VIP) dans les visites dues, sans changer le type de suivi.
  const d = await domain(), emps = d.enrich(90, false), e = emps.find(x => x.id === 2)!;
  assert.equal(e.med.suivi!.type, 'vip');
  assert.equal(e.med.suiviNuit, true);
  assert.equal(e.suivi ?? null, null, 'type de suivi inchangé');
  const ech = d.echeances(emps, 90).filter(x => x.emp.id === 2 && x.label === R.SUIVI_NUIT);
  assert.equal(ech.length, 1);
  assert.equal(ech[0].action!.intent.type, 'medical');
  // VIP adaptée saisie : plus d'alerte.
  await db.update('employes', 2, { suivi: 'vip_adapte' });
  assert.equal((await domain()).medInfo((await domain()).emp(2)!).suiviNuit, false);
  // 270 h sur 12 mois : 36 nuits de 7,5 h réparties sur des semaines d'une seule nuit.
  for (let k = 0; k < 36; k++) {
    const w = new Date(Date.UTC(2025, 10, 3 + 7 * k)).toISOString().slice(0, 10);
    await nuits(w, 1, 6);
  }
  const t = R.statutNuit((await domain()).ds, 6, '2026-10-10');
  assert.deepEqual([t.travailleur, t.critere, t.heures12Mois], [true, 'annuel', 270]);
  // Vues : le référent HSE, sans les feuilles, reçoit l'indication ; le manager la calcule sur les feuilles de son équipe.
  const hse = await buildSnapshot(db, await user(23, 'rh'));
  assert.deepEqual([hse.feuilles.length, hse.employes.find(x => x.id === 6)!.travailleurNuit, hse.employes.find(x => x.id === 2)!.travailleurNuit], [0, true, true]);
  const mgr = await buildSnapshot(db, await user(12, 'manager'));
  assert.equal(mgr.employes.find(x => x.id === 6)!.travailleurNuit, undefined);
  assert.equal(R.estTravailleurNuit(mgr, mgr.employes.find(x => x.id === 6)!, '2026-10-10'), true);
});

test('travailleur de nuit : des nuits ponctuelles séparées par des semaines de journée sans horaire ne font pas un horaire habituel', async () => {
  const { db, domain } = await fresh();
  // Équipe de journée sans horaire par défaut : feuilles validées figées en jours sans horaire, sauf les semaines de nuit.
  const feuille = async (week: string, n: number) => (await db.run('DELETE FROM feuilles WHERE emp_id = 2 AND week = ?', [week]), await db.insert<Feuille>('feuilles', {
    empId: 2, week, statut: 'validee', comment: null, sage: false, keystone: false, contrat: null, majNuit: 0,
    lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7.5, 7.5, 7, 7, 7, 0, 0] }],
    horairesFiges: Array.from({ length: 7 }, (_, i) => (i < n ? N : null)),
  }));
  await feuille('2026-02-02', 2);
  await feuille('2026-09-07', 2);
  for (const w of ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']) await feuille(w, 0);
  const t = R.statutNuit((await domain()).ds, 2, '2026-10-10');
  assert.deepEqual([t.travailleur, t.critere, t.semaines, t.heures12Mois], [false, null, 0, 30], 'les semaines sans horaire comptent sans nuit');
  // Les mêmes nuits dans les quatre dernières feuilles validées : habituel.
  await feuille('2026-09-28', 2);
  assert.deepEqual([R.statutNuit((await domain()).ds, 2, '2026-10-10').critere, R.statutNuit((await domain()).ds, 2, '2026-10-10').semaines], [null, 1]);
  await feuille('2026-10-05', 2);
  assert.deepEqual([R.statutNuit((await domain()).ds, 2, '2026-10-10').critere, R.statutNuit((await domain()).ds, 2, '2026-10-10').semaines], ['hebdomadaire', 2]);
});

test('réglages du travail de nuit : valeurs de la loi, 9 h de nuit au moins, accord exigé pour s’en écarter, référence masquée au journal', async () => {
  const s = reglagesParDefaut();
  assert.throws(() => appliquerReglages(s, { nuitDebut: 22 }), (e: unknown) => e instanceof ReglageInvalide && /9 heures consécutives/.test(e.message));
  assert.throws(() => appliquerReglages(s, { nuitDebut: 22, nuitFin: 7 }), (e: unknown) => e instanceof ReglageInvalide && /accord collectif/.test(e.message));
  assert.throws(() => appliquerReglages(s, { nuitSeuilAnnuel: 300 }), ReglageInvalide);
  const ok = appliquerReglages(s, { nuitDebut: 22, nuitFin: 7, nuitSeuilAnnuel: 300, nuitAccord: '  Accord   du 3 mars 2027 ' });
  assert.deepEqual([ok.nuitDebut, ok.nuitFin, ok.nuitSeuilAnnuel, ok.nuitAccord], [22, 7, 300, 'Accord du 3 mars 2027']);
  assert.deepEqual([appliquerReglages(s, { nuitDebut: 'tard' }).nuitDebut, appliquerReglages(s, { nuitMajoration: 33 }).nuitMajoration], [21, 35], 'bornes et pas');
  const { run, RH, derniere } = await fresh();
  await run(RH, 'parametres.maj', { nuitDebut: 22, nuitFin: 7, nuitAccord: 'Accord d’entreprise du 3 mars 2027' });
  const p = JSON.stringify((await derniere('parametres.maj'))!.payload);
  assert.ok(!p.includes('3 mars'), 'texte de la référence jamais recopié au journal');
  assert.match(p, /nuitDebut/);
});
