// Lot 6, chantier 1 étape 2 (t048) : contrôles tirés des horaires de poste — repos quotidien de 11 h et pause de 20 min en
// alerte avec motif, heures de nuit sur la plage réglée (HNUIT, MAJ_NUIT figée à la validation, rubriques inactives listées
// « à saisir dans Sage »), nuit refusée aux mineurs, statut de travailleur de nuit et alerte « suivi médical adapté »,
// réglages du travail de nuit (valeurs de la loi, accord exigé pour s'en écarter), aucun contrôle rétroactif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
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
const { elementsASaisir } = await import('../shared/rules/elements-lot.ts');
const R = await import('../shared/rules/repos-nuit.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof loadFull>;
type Feuille = Dataset['feuilles'][number];

const J = { code: 'J', debut: '08:00', fin: '16:00', pause: 60 };
const M = { code: 'M', debut: '05:00', fin: '13:00', pause: 30 };
const AM = { code: 'AM', debut: '13:00', fin: '21:00', pause: 30 };
const N = { code: 'N', debut: '21:00', fin: '05:00', pause: 30 };
const SEMAINE = '2026-10-19';
const jours = (...h: number[]) => [...h, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
const sans = <T>(...x: T[]) => [...x, null, null, null, null, null, null, null].slice(0, 7) as (T | null)[];

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteId = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteId(empId), role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o: { message?: string | null; result?: unknown } = typeof r === 'object' && r !== null ? r as { message?: string; result?: unknown } : { message: r as string | null };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result ?? null });
    return o.message ?? null;
  });
  const refuse = (u: User, name: string, p: Record<string, unknown>, motif: RegExp) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && motif.test(e.message), `${name} : ${motif}`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  const feuille = (empId: number, week = SEMAINE) => db.all<Feuille>('feuilles').find(f => f.empId === empId && f.week === week)!;
  const derniere = (action: string) => db.all<{ action: string; payload: Record<string, unknown> }>('journal').findLast(j => j.action === action);
  /** Feuille de Mehdi (Maintenance, horaire J proposé) : heures de chaque jour et horaires choisis. */
  const saisir = (u: User, h: number[], horaires: (string | null)[] = [], empId = 2, week = SEMAINE) => {
    const base = { empId, week };
    run(u, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
    h.forEach((v, di) => { if (v) run(u, 'temps.setCell', { ...base, li: 0, di, value: String(v) }); });
    horaires.forEach((c, di) => { if (c != null) run(u, 'temps.horaire', { ...base, di, code: c }); });
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
});

test('feuille : repos et pause à motiver, nuit d’un mineur refusée, heures de nuit et majoration figée à la validation', () => {
  const { db, run, refuse, RH, user, feuille, derniere, domain, saisir } = fresh();
  const MEHDI = user(2, 'collaborateur'), KARIM = user(12, 'manager');
  // Lundi AM, mardi M : repos de 8 h ; mercredi N (nuit), jeudi sans heure.
  const base = saisir(MEHDI, [7.5, 7.5, 7.5], ['AM', 'M', 'N']);
  const d = domain(), c = calcSheet(d, d.emp(2)!, feuille(2));
  assert.equal(c.nuit, 8.44);
  assert.equal(c.reposQuotidien.length, 1);
  assert.ok(c.depassements.includes(c.reposQuotidien[0]), 'à motiver comme un dépassement');
  refuse(MEHDI, 'temps.submit', base, /Repos quotidien de 11 h.*indiquez le motif du dépassement avant de soumettre/);
  run(MEHDI, 'temps.submit', { ...base, motif: 'Remplacement d’un collègue absent' });
  assert.equal(feuille(2).statut, 'soumise');
  assert.deepEqual(derniere('temps.submit')!.payload.reposNuit, ['repos_quotidien'], 'contrôle codé au journal, sans le motif');
  // Majoration réglée à 25 % : figée à la validation ; un changement ultérieur ne touche plus la semaine.
  run(RH, 'parametres.maj', { nuitMajoration: 25 });
  run(KARIM, 'temps.validate', base);
  assert.equal(feuille(2).majNuit, 25);
  run(RH, 'parametres.maj', { nuitMajoration: 50 });
  const d2 = domain(), r = sageRubriques(d2, d2.emp(2)!, feuille(2));
  assert.deepEqual([r.HNUIT, r.MAJ_NUIT], [8.4, 2.1]);
  assert.equal(r.HN, 22.5, 'heures de nuit comprises dans les heures normales');

  // Léo, apprenti mineur de la Maintenance : horaire de nuit refusé au choix, et une feuille proposée en M refusée.
  run(RH, 'employe.creer', {
    nom: 'Léo Martin', poste: 'Apprenti', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', jourOff: [],
    entree: '2026-09-01', fin: '2028-08-31', naissanceLe: '2010-01-04', email: 'leo.martin@entreprise.example',
  });
  const id = db.all<{ id: number; nom: string }>('employes').find(e => e.nom === 'Léo Martin')!.id;
  const b = { empId: id, week: SEMAINE };
  run(RH, 'temps.addLine', { ...b, projet: 'INT-MAINT' });
  run(RH, 'temps.setCell', { ...b, li: 0, di: 0, value: '7' });
  refuse(RH, 'temps.horaire', { ...b, di: 0, code: 'N' }, /Horaire N \(21 h – 5 h\) : Léo Martin a moins de 18 ans/);
  run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], horaire: 'M' });
  refuse(RH, 'temps.submit', { ...b, motif: 'Inventaire' }, /Travail de nuit interdit à un salarié de moins de 18 ans.*changez l’horaire du jour avant de soumettre/);
  run(RH, 'temps.horaire', { ...b, di: 0, code: 'J' });
  run(RH, 'temps.submit', b);
  assert.equal(feuille(id).statut, 'soumise');
});

test('aucun contrôle rétroactif : feuille validée d’avant les horaires sans heure de nuit ; migration de la majoration figée', () => {
  const { db, domain } = fresh();
  const validees = db.all<Feuille>('feuilles').filter(f => f.statut === 'validee');
  assert.ok(validees.length > 0 && validees.every(f => !f.horairesFiges), 'démonstration : feuilles validées sans horaire');
  const d = domain();
  assert.ok(validees.every(f => calcSheet(d, d.emp(f.empId)!, f).nuit === 0 && !calcSheet(d, d.emp(f.empId)!, f).reposQuotidien.length));
  assert.equal(HORAIRES_NUIT_FIGEE.necessaire!(db), true);
  assert.ok(appliquerMigrations(db).includes('lot6-horaires-majoration-nuit'));
  assert.ok(db.all<Feuille>('feuilles').filter(f => f.statut === 'validee').every(f => f.majNuit === 0));
  assert.ok(db.all<Feuille>('feuilles').filter(f => f.statut !== 'validee').every(f => f.majNuit == null), 'brouillons et soumises : le réglage s’appliquera');
  assert.deepEqual(appliquerMigrations(db), [], 'une seule fois');
});

test('paie : HNUIT et MAJ_NUIT inactives, listées « à saisir dans Sage » dans l’export et le lot ; actives, dans le fichier', () => {
  const { db, run, RH, user, saisir } = fresh();
  const MEHDI = user(2, 'collaborateur'), KARIM = user(12, 'manager'), PAIE = user(7, 'rh');
  run(RH, 'parametres.maj', { nuitMajoration: 25 });
  const base = saisir(MEHDI, [0, 0, 7.5], ['', '', 'N']);
  run(MEHDI, 'temps.submit', base);
  run(KARIM, 'temps.validate', base);
  const nuit = variablesDeLaPeriode(db, PAIE, '2026-10').filter(l => l.empId === 2 && /heures de nuit/i.test(l.libelle));
  assert.deepEqual(nuit.map(l => [l.rubrique, l.quantite, l.etat]), [[A_SAISIR, 7.5, 'En attente d’un lot'], [A_SAISIR, 1.9, 'En attente d’un lot']]);
  assert.match(nuit[0].detail, /Semaine 2026-S43 · heures de nuit/);
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = db.all<{ contenu: { lignes: { matricule: string; rubriques: Record<string, number> }[]; aSaisir?: { famille: string; empId: number; periode: string; rubrique: string; quantite: number; detail: string }[] } }>('lotsPaie').at(-1)!;
  assert.deepEqual(lot.contenu.aSaisir!.filter(x => x.famille === 'nuit').map(x => [x.empId, x.rubrique, x.quantite]), [[2, 'HNUIT', 7.5], [2, 'MAJ_NUIT', 1.9]]);
  assert.ok(lot.contenu.lignes.every(l => !('HNUIT' in l.rubriques)), 'absentes du fichier');
  assert.equal(elementsASaisir(lot.contenu).filter(x => x.famille === 'nuit').length, 2, 'dans le résumé du lot');
  // Activées par la paie : dans le fichier, plus à saisir.
  const autre = fresh();
  autre.run(autre.RH, 'parametres.maj', { nuitMajoration: 25 });
  autre.run(autre.user(7, 'rh'), 'paie.rubrique', { code: 'HNUIT', active: true, codeSage: '2100' });
  const b2 = autre.saisir(autre.user(2, 'collaborateur'), [0, 0, 7.5], ['', '', 'N']);
  autre.run(autre.user(2, 'collaborateur'), 'temps.submit', b2);
  autre.run(autre.user(12, 'manager'), 'temps.validate', b2);
  const v = variablesDeLaPeriode(autre.db, autre.user(7, 'rh'), '2026-10').filter(l => l.empId === 2 && /heures de nuit/i.test(l.libelle));
  assert.deepEqual(v.map(l => [l.rubrique, l.quantite]), [['2100', 7.5], [A_SAISIR, 1.9]], 'MAJ_NUIT encore inactive');
});

test('travailleur de nuit : deux semaines de deux nuits parmi les quatre dernières, ou 270 h sur 12 mois ; suivi adapté signalé', () => {
  const { db, user, domain } = fresh();
  const nuits = (week: string, n: number, empId = 2) => (db.sql.prepare('DELETE FROM feuilles WHERE emp_id = ? AND week = ?').run(empId, week), db.insert<Feuille>('feuilles', {
    empId, week, statut: 'validee', comment: null, sage: false, keystone: false, contrat: null, majNuit: 0,
    lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: Array.from({ length: 7 }, (_, i) => (i < n ? 7.5 : 0)) }],
    horairesFiges: Array.from({ length: 7 }, (_, i) => (i < n ? N : null)),
  }));
  const statut = () => R.statutNuit(domain().ds, 2, '2026-10-10');
  assert.equal(statut().travailleur, false);
  nuits('2026-09-21', 2);
  assert.deepEqual([statut().travailleur, statut().semaines], [false, 1], 'une seule semaine : pas habituel');
  nuits('2026-09-28', 1);
  assert.equal(statut().travailleur, false, 'une seule nuit cette semaine-là');
  nuits('2026-09-14', 3);
  assert.deepEqual([statut().travailleur, statut().critere], [true, 'hebdomadaire']);
  // Fiche : travailleur de nuit, alerte de suivi adapté (VIP) dans les visites dues, sans changer le type de suivi.
  const d = domain(), emps = d.enrich(90, false), e = emps.find(x => x.id === 2)!;
  assert.equal(e.med.suivi!.type, 'vip');
  assert.equal(e.med.suiviNuit, true);
  assert.equal(e.suivi ?? null, null, 'type de suivi inchangé');
  const ech = d.echeances(emps, 90).filter(x => x.emp.id === 2 && x.label === R.SUIVI_NUIT);
  assert.equal(ech.length, 1);
  assert.equal(ech[0].action!.intent.type, 'medical');
  // VIP adaptée saisie : plus d'alerte.
  db.update('employes', 2, { suivi: 'vip_adapte' });
  assert.equal(domain().medInfo(domain().emp(2)!).suiviNuit, false);
  // 270 h sur 12 mois : 36 nuits de 7,5 h réparties sur des semaines d'une seule nuit.
  for (let k = 0; k < 36; k++) {
    const w = new Date(Date.UTC(2025, 10, 3 + 7 * k)).toISOString().slice(0, 10);
    nuits(w, 1, 6);
  }
  const t = R.statutNuit(domain().ds, 6, '2026-10-10');
  assert.deepEqual([t.travailleur, t.critere, t.heures12Mois], [true, 'annuel', 270]);
  // Vues : le référent HSE, sans les feuilles, reçoit l'indication ; le manager la calcule sur les feuilles de son équipe.
  const hse = buildSnapshot(db, user(23, 'rh'));
  assert.deepEqual([hse.feuilles.length, hse.employes.find(x => x.id === 6)!.travailleurNuit, hse.employes.find(x => x.id === 2)!.travailleurNuit], [0, true, true]);
  const mgr = buildSnapshot(db, user(12, 'manager'));
  assert.equal(mgr.employes.find(x => x.id === 6)!.travailleurNuit, undefined);
  assert.equal(R.estTravailleurNuit(mgr, mgr.employes.find(x => x.id === 6)!, '2026-10-10'), true);
});

test('réglages du travail de nuit : valeurs de la loi, 9 h de nuit au moins, accord exigé pour s’en écarter, référence masquée au journal', () => {
  const s = reglagesParDefaut();
  assert.throws(() => appliquerReglages(s, { nuitDebut: 22 }), (e: unknown) => e instanceof ReglageInvalide && /9 heures consécutives/.test(e.message));
  assert.throws(() => appliquerReglages(s, { nuitDebut: 22, nuitFin: 7 }), (e: unknown) => e instanceof ReglageInvalide && /accord collectif/.test(e.message));
  assert.throws(() => appliquerReglages(s, { nuitSeuilAnnuel: 300 }), ReglageInvalide);
  const ok = appliquerReglages(s, { nuitDebut: 22, nuitFin: 7, nuitSeuilAnnuel: 300, nuitAccord: '  Accord   du 3 mars 2027 ' });
  assert.deepEqual([ok.nuitDebut, ok.nuitFin, ok.nuitSeuilAnnuel, ok.nuitAccord], [22, 7, 300, 'Accord du 3 mars 2027']);
  assert.deepEqual([appliquerReglages(s, { nuitDebut: 'tard' }).nuitDebut, appliquerReglages(s, { nuitMajoration: 33 }).nuitMajoration], [21, 35], 'bornes et pas');
  const { run, RH, derniere } = fresh();
  run(RH, 'parametres.maj', { nuitDebut: 22, nuitFin: 7, nuitAccord: 'Accord d’entreprise du 3 mars 2027' });
  const p = JSON.stringify(derniere('parametres.maj')!.payload);
  assert.ok(!p.includes('3 mars'), 'texte de la référence jamais recopié au journal');
  assert.match(p, /nuitDebut/);
});
