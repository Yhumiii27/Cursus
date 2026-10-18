// Lot 5, chantier B étape 2 : jours fériés travaillés (t039 : 1er mai majoré de 100 %, autres fériés en quantité et
// majoration réglable, saisie permise par le réglage et tracée), plafond des heures complémentaires (t050 : le dixième,
// le tiers avec un accord, dépassement avec motif), moyenne sur 12 semaines et requalification du temps partiel (t040),
// contingent annuel d'heures supplémentaires et contrepartie obligatoire en repos figée à la validation, créditée et
// transmise à la paie, heures sup reprises de Lucca (t042).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { addD } = await import('../shared/dates.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { calcSheet, rubriquesEmises, rubriquesParPeriode, sageRubriques } = await import('../shared/rules/temps.ts');
const { feriesDeLaSemaine, mentionFerie, plafondComplementaires } = await import('../shared/rules/majorations.ts');
const { alertesDurees, alertesValidation, contingentAnnuel, contingentsDeLaSemaine, corAValider, heuresSupDansAnnee, moyenne12Semaines, requalificationPartiel } = await import('../shared/rules/durees.ts');
const { rubriquesAConfirmer, rubriquesPaie } = await import('../shared/rules/paie.ts');
const { recupInfo } = await import('../shared/rules/conges.ts');
const { analyserReprise } = await import('../shared/rules/reprise.ts');
const { matriculeAffiche } = await import('../shared/rules/matricules.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Feuille = Dataset['feuilles'][number];

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message as string;
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, statut = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === statut && motif.test(e.message), `${name} : ${motif}`);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const derniere = async (action: string) => (await db.all<{ action: string; payload: Record<string, unknown>; message: string }>('journal')).findLast(j => j.action === action);
  return { db, user, run, refuse, domain, derniere, RH };
}

let n = 9000;
/** Feuille validée de `empId` (une ligne, heures du lundi au dimanche). */
const feuille = (week: string, h: number[], extra: Partial<Feuille> = {}): Feuille =>
  ({ id: n++, empId: 1, week, statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-LOG', tache: '', ks: false, h }], contrat: null, ...extra });
/** Domaine de la démonstration où les feuilles de `empId` sont remplacées par `feuilles`. */
const avec = (d: InstanceType<typeof Domain>, feuilles: Feuille[], settings: Partial<Dataset['settings']> = {}, empId = 1) =>
  new Domain({ ...d.ds, feuilles: [...d.ds.feuilles.filter(f => f.empId !== empId), ...feuilles], settings: { ...d.ds.settings, ...settings } });
/** `k` lundis consécutifs finissant au lundi `fin`, du plus ancien au plus récent. */
const lundis = (fin: string, k: number) => Array.from({ length: k }, (_, i) => addD(fin, -7 * (k - 1 - i)));

// — Jours fériés (t039) —

test('1er mai travaillé : MAJ_1MAI de 100 %, compté dans la semaine, ventilé sur mai ; autres fériés en FERIE_TRAV', async () => {
  const { domain } = await fresh();
  const d = await domain(), e = d.emp(1)!;
  // Semaine du 27 avril 2026 : le vendredi 1er mai travaillé 7 h.
  assert.deepEqual(feriesDeLaSemaine('2026-04-27'), [null, null, null, null, '1er_mai', null, null]);
  const mai = feuille('2026-04-27', [7, 7, 7, 7, 7, 0, 0], { statut: 'brouillon' });
  assert.deepEqual(sageRubriques(d, e, mai), { HN: 35, MAJ_1MAI: 7 });
  const c = calcSheet(d, e, mai);
  assert.deepEqual([c.total, c.mai1, c.ferie, c.sup25], [35, 7, 0, 0], 'heures du 1er mai : travail effectif de la semaine');
  // Un samedi en plus : les heures du férié gardent leur rang, les supplémentaires restent les dernières.
  assert.deepEqual(sageRubriques(d, e, feuille('2026-04-27', [7, 7, 7, 7, 7, 4, 0])), { HN: 35, HS25: 4, MAJ_1MAI: 7 });
  // Semaine à cheval sur avril et mai, ventilée jour par jour : la majoration part en mai, avec le jour (périodes closes au
  // 10 octobre : rappels sur octobre, période d'origine gardée).
  const jour = avec(d, [], { periodeRattachement: 'jour' });
  assert.deepEqual(rubriquesParPeriode(jour, e, mai).map(p => [p.origine, p.rubriques]), [['2026-04', { HN: 28 }], ['2026-05', { HN: 7, MAJ_1MAI: 7 }]]);
  // Mois du dimanche (par défaut) : une seule part, en mai.
  assert.deepEqual(rubriquesParPeriode(d, e, mai).map(p => [p.origine, p.rubriques]), [['2026-05', { HN: 35, MAJ_1MAI: 7 }]]);
  // Ascension (jeudi 14 mai 2026) : quantité sans majoration par défaut ; majorée selon le réglage, ou le taux figé.
  const ascension = feuille('2026-05-11', [7, 7, 7, 7, 7, 0, 0], { statut: 'brouillon' });
  assert.deepEqual(sageRubriques(d, e, ascension), { HN: 35, FERIE_TRAV: 7 });
  assert.deepEqual(sageRubriques(avec(d, [], { tauxMajorationFerie: 50 }), e, ascension), { HN: 35, FERIE_TRAV: 7, MAJ_FERIE: 3.5 });
  assert.deepEqual(sageRubriques(avec(d, [], { tauxMajorationFerie: 50 }), e, { ...ascension, majFerie: 25 }), { HN: 35, FERIE_TRAV: 7, MAJ_FERIE: 1.8 });
  // Sans semaine (calcul d'une proposition), aucun férié repéré ; forfait jours : décompte en jours seul.
  assert.equal(calcSheet(d, e, { lignes: mai.lignes }).mai1, 0);
  assert.deepEqual(sageRubriques(d, { ...e, temps: 'forfait_jours', statut: 'cadre' }, mai), { JTRAV: 5 });
  // Mentions de la feuille.
  assert.equal(mentionFerie('1er_mai', 0, 0), 'Férié (1er mai)');
  assert.equal(mentionFerie('1er_mai', 7, 0), 'Férié travaillé : majoré 100 %');
  assert.equal(mentionFerie('ferie', 7, 0), 'Férié travaillé');
  assert.equal(mentionFerie('ferie', 7, 25), 'Férié travaillé : majoré 25 %');
  // Nouvelles rubriques : code Sage à confirmer, un lot réel les refuse tant qu'elles ne le sont pas ; désactivables.
  for (const code of ['MAJ_1MAI', 'FERIE_TRAV', 'MAJ_FERIE', 'COR_ACQUIS']) assert.ok(RUBRIQUES_PAIE[code], code);
  const table = rubriquesPaie([]);
  const emises = rubriquesEmises(avec(d, [mai]), [mai]);
  assert.deepEqual(rubriquesAConfirmer(emises, table).map(r => r.code).sort(), ['HN', 'MAJ_1MAI']);
  const inactive = rubriquesPaie([{ code: 'MAJ_1MAI', codeSage: 'MAJ_1MAI', active: false, confirmeLe: null, confirmePar: null }]);
  assert.deepEqual(rubriquesAConfirmer(emises, inactive).map(r => r.code), ['HN']);
});

test('saisie un jour férié : permise par le réglage, tracée au journal, majoration figée à la validation', async () => {
  const { db, run, refuse, user, domain, derniere, RH } = await fresh();
  const CAMILLE = await user(1, 'collaborateur'), HUGO = await user(16, 'manager');
  // Semaine du 9 novembre 2026 : mercredi 11 novembre (Armistice).
  const base = { empId: 1, week: '2026-11-09' };
  await run(CAMILLE, 'temps.addLine', { ...base, projet: 'INT-LOG' });
  await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 2, value: '7' });
  const j = (await derniere('temps.ferie'))!;
  assert.match(j.message, /^Heures un jour férié — Camille Roux, INT-LOG le 11 nov\. 2026 : 0 h → 7 h \(feuille en brouillon\)$/);
  assert.equal(j.payload.ferie, true);
  // Un jour ordinaire, la saisie du salarié n'est pas tracée.
  const avant = (await db.all('journal')).length;
  await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 0, value: '7' });
  assert.equal((await db.all('journal')).length, avant);
  // Réglage désactivé : refus, vider la cellule reste possible.
  await run(RH, 'parametres.maj', { feriesTravaillesAutorises: false });
  await refuse(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 2, value: '8' }, /Jour férié : la saisie d’heures un jour férié est désactivée/);
  await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 2, value: '0' });
  await run(RH, 'parametres.maj', { feriesTravaillesAutorises: true, tauxMajorationFerie: 50 });
  await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 2, value: '7' });
  for (const di of [1, 3, 4]) await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di, value: '7' });
  await run(CAMILLE, 'temps.submit', base);
  await run(HUGO, 'temps.validate', base);
  await run(RH, 'parametres.maj', { tauxMajorationFerie: 0 });
  const sh = (await loadFull(db, RH)).feuilles.find(f => f.empId === 1 && f.week === base.week)!;
  assert.equal(sh.majFerie, 50, 'taux figé à la validation');
  assert.deepEqual(sageRubriques(await domain(), (await domain()).emp(1)!, sh), { HN: 35, FERIE_TRAV: 7, MAJ_FERIE: 3.5 });
});

// — Heures complémentaires (t050) —

test('temps partiel : plafond du dixième par défaut, le tiers seulement avec un accord, dépassement avec motif', async () => {
  const { db, run, refuse, domain, RH } = await fresh();
  const d = await domain(), e = d.emp(13)!; // 21 h, jeudi et vendredi non travaillés
  assert.deepEqual(plafondComplementaires(d.ds.settings), { diviseur: 10, label: 'dixième', article: 'art. L3123-28' });
  const sh = (h: number[]) => feuille('2026-11-16', h, { empId: 13, statut: 'brouillon' });
  // 23,25 h : 2,25 h complémentaires, au-delà de 2,1 h.
  const c = calcSheet(d, e, await sh([7.75, 7.75, 7.75, 0, 0, 0, 0]));
  assert.deepEqual([c.hc10, Math.round(c.hc25 * 100) / 100], [2.1, 0.15]);
  assert.match(c.depassements[0], /^Heures complémentaires au-delà du dixième de la durée contractuelle \(2,1 h au plus, art\. L3123-28\)$/);
  assert.deepEqual(calcSheet(d, e, await sh([7.7, 7.7, 7.7, 0, 0, 0, 0])).depassements, [], 'au plus le dixième : rien');
  // Le tiers suppose la référence d'un accord (COHERENCE) ; avec elle, plus de dépassement.
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { plafondHeuresComplementaires: 'tiers' }), (x: unknown) => x instanceof ReglageInvalide && /art\. L3123-20/.test(x.message));
  const tiers = avec(d, [], { plafondHeuresComplementaires: 'tiers', heuresComplementairesAccord: 'Accord du 3 mars 2026' }, 13);
  assert.deepEqual(calcSheet(tiers, e, await sh([7.75, 7.75, 7.75, 0, 0, 0, 0])).depassements, []);
  assert.match(calcSheet(tiers, e, await sh([10, 9.5, 9.5, 0, 0, 0, 0])).depassements[0], /au-delà du tiers .*7 h au plus, art\. L3123-20/);
  // Soumission : motif exigé au-delà du plafond.
  const base = { empId: 13, week: '2026-11-16' };
  await run(RH, 'temps.addLine', { ...base, projet: 'INT-PROD' });
  for (const di of [0, 1, 2]) await run(RH, 'temps.setCell', { ...base, li: 0, di, value: '7,75' });
  await refuse(RH, 'temps.submit', base, /Heures complémentaires au-delà du dixième .* : indiquez le motif du dépassement avant de soumettre la feuille/);
  await run(RH, 'temps.submit', { ...base, motif: 'Inventaire annuel' });
  assert.equal((await db.all<Feuille>('feuilles')).find(f => f.empId === 13 && f.week === base.week)!.motifDepassement, 'Inventaire annuel');
});

// — Moyenne sur 12 semaines et requalification (t040) —

test('moyenne sur 12 semaines : 12 semaines travaillées, semaines sans feuille ou d’absence sautées, 46 h avec un accord', async () => {
  const { domain } = await fresh();
  const d = await domain(), e = d.emp(1)!;
  const semaine46 = [9.2, 9.2, 9.2, 9.2, 9.2, 0, 0];
  // 11 semaines à 46 h : pas encore 12 semaines, pas d'alerte.
  const onze = lundis('2026-09-28', 11).map(w => feuille(w, semaine46));
  assert.equal(moyenne12Semaines(avec(d, onze), e, '2026-10-05')!.depasse, false);
  // Une semaine sans feuille et une semaine d'absence (sans heure) sont sautées : la 12e est plus ancienne.
  const plus = [...onze, feuille('2026-07-06', semaine46), feuille('2026-10-05', [0, 0, 0, 0, 0, 0, 0])];
  const m = moyenne12Semaines(avec(d, plus), e, '2026-10-05')!;
  assert.deepEqual([m.semaines, m.moyenne, m.max, m.du, m.au, m.depasse], [12, 46, 44, '2026-07-06', '2026-09-28', true]);
  // Une feuille non validée ne compte pas.
  assert.equal(moyenne12Semaines(avec(d, [...onze, feuille('2026-07-06', semaine46, { statut: 'soumise' })]), e, '2026-10-05')!.depasse, false);
  // 46 h seulement avec la référence d'un accord (COHERENCE) ; sans elle, le maximum reste 44 h.
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { moyenne12SemainesMax: 46 }), (x: unknown) => x instanceof ReglageInvalide && /art\. L3121-23/.test(x.message));
  assert.equal(moyenne12Semaines(avec(d, plus, { moyenne12SemainesMax: 46 }), e, '2026-10-05')!.max, 44);
  assert.equal(moyenne12Semaines(avec(d, plus, { moyenne12SemainesMax: 46, moyenne12SemainesAccord: 'Accord du 1er juin 2026' }), e, '2026-10-05')!.depasse, false);
  // Forfait jours : sans objet. Alerte du service RH (écran Temps).
  assert.equal(moyenne12Semaines(d, { ...e, temps: 'forfait_jours', statut: 'cadre' }), null);
  const a = alertesDurees(avec(d, plus)).filter(x => x.e.id === 1);
  assert.deepEqual(a.map(x => x.type), ['moyenne']);
  assert.match(a[0].texte, /^Moyenne de 46 h sur les 12 dernières semaines travaillées, au-delà de 44 h \(art\. L3121-22\)$/);
});

test('temps partiel : 12 semaines sur 15 à 2 h au moins au-delà du contrat, nouvel horaire proposé', async () => {
  const { domain } = await fresh();
  const d = await domain(), e = d.emp(13)!; // 21 h
  const sem = (w: string, h: number) => feuille(w, [h / 3, h / 3, h / 3, 0, 0, 0, 0], { empId: 13 });
  const quinze = lundis('2026-10-05', 15).map((w, i) => sem(w, i < 3 ? 21 : 23.5));
  const r = requalificationPartiel(avec(d, quinze, {}, 13), e, '2026-10-05')!;
  assert.deepEqual([r.semaines, r.auDela, r.base, r.proposition, r.depasse], [15, 12, 21, 23, true]);
  // 11 semaines seulement : pas d'alerte ; un temps plein : sans objet.
  const onze = lundis('2026-10-05', 15).map((w, i) => sem(w, i < 4 ? 21 : 23.5));
  assert.equal(requalificationPartiel(avec(d, onze, {}, 13), e, '2026-10-05')!.depasse, false);
  assert.equal(requalificationPartiel(d, d.emp(1)!), null);
  const a = alertesDurees(avec(d, quinze, {}, 13)).filter(x => x.e.id === 13);
  assert.match(a.find(x => x.type === 'requalification')!.texte, /12 semaines sur les 15 dernières travaillées — horaire du contrat à porter à 23 h, sauf opposition du salarié, avec un préavis de 7 jours \(art\. L3123-13\)$/);
});

// — Contingent et contrepartie obligatoire en repos (t042) —

test('contingent : heures sup de l’année hors repos et intérim, semaine à cheval ventilée, heures reprises, alerte à 90 %', async () => {
  const { domain } = await fresh();
  const d = await domain(), e = d.emp(1)!;
  const sem45 = [9, 9, 9, 9, 9, 0, 0];
  // 20 semaines à 45 h (10 h sup chacune) : 200 h sur 220, alerte (90 %).
  const vingt = lundis('2026-09-28', 20).map(w => feuille(w, sem45));
  const k = contingentAnnuel(avec(d, vingt), e, 2026)!;
  assert.deepEqual([k.cumul, k.max, k.part, k.etat, k.cor, k.accord], [200, 220, 91, 'alerte', 0, false]);
  // Semaines en mode repos et intérimaire : hors contingent (art. L3121-30).
  assert.equal(contingentAnnuel(avec(d, vingt.map(f => ({ ...f, heuresSup: 'repos' as const }))), e, 2026)!.cumul, 0);
  assert.equal(contingentAnnuel(avec(d, vingt), { ...e, typeContrat: 'interim' }, 2026), null);
  // Semaine du 28 décembre 2026 : jusqu'au jeudi 31, 36 h (1 h sup) ; le samedi 2 janvier porte les 9 autres.
  const cheval = feuille('2026-12-28', [9, 9, 9, 9, 0, 9, 0]);
  assert.deepEqual([heuresSupDansAnnee(d, e, cheval, 2026), heuresSupDansAnnee(d, e, cheval, 2027), heuresSupDansAnnee(d, e, cheval, 2025)], [1, 9, 0]);
  // Heures reprises de Lucca (année de la date d'arrêté) : comptées, sans COR pour celles d'avant la reprise.
  const ds = avec(d, vingt).ds;
  const repris = new Domain({ ...ds, soldesReprise: ds.soldesReprise.map(s => (s.empId === 1 ? { ...s, arreteLe: '2026-03-01', heuresSupAnnee: 230 } : s)) });
  const r = contingentAnnuel(repris, e, 2026)!;
  assert.deepEqual([r.reprises, r.cumul, r.etat, r.cor], [230, 430, 'depasse', 200]);
  assert.equal(contingentAnnuel(repris, e, 2027)!.reprises, 0, 'autre année : rien de repris');
});

test('COR : figée à chaque validation par différence annuelle, créditée même payée, émise dans COR_ACQUIS', async () => {
  const { db, run, user, domain, RH } = await fresh();
  const CAMILLE = await user(1, 'collaborateur'), HUGO = await user(16, 'manager');
  const sh = async (week: string) => (await loadFull(db, RH)).feuilles.find(f => f.empId === 1 && f.week === week)!;
  const saisir = async (week: string, h: number) => {
    const base = { empId: 1, week };
    await run(CAMILLE, 'temps.addLine', { ...base, projet: 'INT-LOG' });
    for (const di of [0, 1, 2, 3, 4]) await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di, value: String(h) });
    await run(CAMILLE, 'temps.submit', base);
  };
  // Total de l'année figé sur les feuilles = COR due recalculée sur toutes les feuilles validées.
  const juste = async () => {
    const d = await domain();
    const figee = d.ds.feuilles.filter(f => f.empId === 1 && f.statut === 'validee').reduce((x, f) => x + (f.cor?.['2026'] ?? 0), 0);
    assert.equal(Math.round(figee * 100) / 100, contingentAnnuel(d, d.emp(1)!, 2026)?.cor ?? 0);
  };
  const recupAvant = recupInfo(await domain(), (await domain()).emp(1)!)?.acq ?? 0;
  const cumul0 = contingentAnnuel(await domain(), (await domain()).emp(1)!, 2026)?.cumul ?? 0;
  // Contingent ramené juste au-dessus du cumul déjà validé : la semaine à 45 h (10 h sup) le dépasse de 4 h.
  await run(RH, 'parametres.maj', { contingentHeuresSup: Math.ceil(cumul0) + 6 });
  const depasse = 10 - (Math.ceil(cumul0) + 6 - cumul0);
  await saisir('2026-11-23', 9);
  const msg = await run(HUGO, 'temps.validate', { empId: 1, week: '2026-11-23' });
  assert.equal((await sh('2026-11-23')).cor!['2026'], Math.round(depasse * 100) / 100);
  assert.match(msg, /Contingent 2026 : .* — dépassé : .*de contrepartie obligatoire en repos \(100 %, art\. L3121-30 et L3121-38\)/);
  assert.match(msg, /de contrepartie obligatoire en repos créditées au compteur de récupération/);
  await juste();
  // Heures supplémentaires payées (mode par défaut) : la COR est quand même créditée, et part en paie.
  const d1 = await domain();
  assert.equal(Math.round((recupInfo(d1, d1.emp(1)!)!.acq - recupAvant) * 100) / 100, Math.round(depasse * 100) / 100);
  assert.equal(sageRubriques(d1, d1.emp(1)!, await sh('2026-11-23')).COR_ACQUIS, Math.round(depasse * 10) / 10);
  assert.equal(sageRubriques(d1, d1.emp(1)!, await sh('2026-11-23')).RCR_ACQUIS, undefined);
  // Validation hors de l'ordre chronologique : la semaine antérieure porte sa part, le total reste juste.
  await saisir('2026-11-16', 9);
  await run(HUGO, 'temps.validate', { empId: 1, week: '2026-11-16' });
  assert.equal((await sh('2026-11-16')).cor!['2026'], 10, 'tout au-delà du contingent');
  await juste();
  // Contingent relevé : la COR déjà créditée est corrigée sur la feuille validée suivante (négative).
  await run(RH, 'parametres.maj', { contingentHeuresSup: 1000 });
  await saisir('2026-11-30', 7);
  await run(HUGO, 'temps.validate', { empId: 1, week: '2026-11-30' });
  assert.equal((await sh('2026-11-30')).cor!['2026'], -Math.round((depasse + 10) * 100) / 100);
  await juste();
  // corAValider d'une feuille sans heure sup, contingent inchangé : rien.
  const d2 = await domain();
  assert.equal(corAValider(d2, d2.emp(1)!, { ...await sh('2026-11-30'), id: 999999, week: '2026-12-07' }), null);
});

test('reprise Lucca : heures sup déjà faites dans l’année, facultatives, contrôlées et enregistrées', async () => {
  const { db, run, domain, RH } = await fresh();
  const d = await domain(), e = d.emp(1)!;
  const texte = `Matricule;Heures sup de l’année (heures)\n${matriculeAffiche(e)};12,5\n`;
  const a = analyserReprise(d, 'soldes', texte, { colonnes: ['matricule', 'heuresSup'], dateReprise: '2026-03-01' });
  const l = a.lignes[0];
  assert.equal(l.ecriture?.type, 'soldes');
  assert.match(l.detail, /heures sup 2026 12,5 h/);
  const hors = analyserReprise(d, 'soldes', `Matricule;Heures sup de l’année (heures)\n${matriculeAffiche(e)};1200\n`, { colonnes: ['matricule', 'heuresSup'], dateReprise: '2026-03-01' });
  assert.match(hors.lignes[0].erreurs.join(), /Heures sup de l’année hors des bornes \(0 à 1000\)/);
  await run(RH, 'reprise.importer', { type: 'soldes', texte, colonnes: ['matricule', 'heuresSup'], dateReprise: '2026-03-01', fichier: 'soldes.csv' });
  assert.equal((await db.get<{ heuresSupAnnee: number }>('soldesReprise', 1))!.heuresSupAnnee, 12.5);
  assert.equal(contingentAnnuel(await domain(), (await domain()).emp(1)!, 2026)!.reprises, 12.5);
});

test('semaine à cheval sur deux années : contingent de chaque année signalé à la validation', async () => {
  const { domain } = await fresh();
  const d0 = await domain(), e = d0.emp(1)!;
  // 200 h sup validées en 2026 sur un contingent de 204 h (alerte), puis la semaine du 28 décembre 2026 : 10 h du lundi au
  // jeudi 31 (5 h sup en 2026), 7 h le samedi 2 janvier (7 h sup en 2027).
  const vingt = lundis('2026-09-28', 20).map(w => feuille(w, [9, 9, 9, 9, 9, 0, 0]));
  const cheval = feuille('2026-12-28', [10, 10, 10, 10, 0, 7, 0]);
  const d = avec(d0, vingt, { contingentHeuresSup: 204 });
  assert.deepEqual(contingentsDeLaSemaine(d, e, cheval.week, [...vingt, cheval]).map(k => [k.annee, k.cumul, k.etat]), [[2026, 205, 'depasse'], [2027, 7, null]]);
  const msg = alertesValidation(d, e, vingt, [...vingt, cheval], cheval.week, 0);
  assert.equal(msg.length, 1);
  assert.match(msg[0], /^Contingent 2026 : 205 h d’heures supplémentaires sur 204 h \(100 %\) — dépassé/);
});

test('validation groupée : les seuils de durée franchis sont repris au message', async () => {
  const { run, user, domain, RH } = await fresh();
  const CAMILLE = await user(1, 'collaborateur'), HUGO = await user(16, 'manager');
  const cumul0 = contingentAnnuel(await domain(), (await domain()).emp(1)!, 2026)?.cumul ?? 0;
  await run(RH, 'parametres.maj', { contingentHeuresSup: Math.ceil(cumul0) + 6 });
  const base = { empId: 1, week: '2026-11-23' };
  await run(CAMILLE, 'temps.addLine', { ...base, projet: 'INT-LOG' });
  for (const di of [0, 1, 2, 3, 4]) await run(CAMILLE, 'temps.setCell', { ...base, li: 0, di, value: '9' });
  await run(CAMILLE, 'temps.submit', base);
  const msg = await run(HUGO, 'temps.validerLot', { feuilles: [base] });
  const nom = (await domain()).emp(1)!.nom;
  assert.match(msg, new RegExp(`^1 feuille validée · ${nom} S48 : Contingent 2026 : .* — dépassé`));
  assert.match(msg, new RegExp(`· ${nom} S48 : .*de contrepartie obligatoire en repos créditées au compteur de récupération`));
});

test('reprise Lucca : heures sup des feuilles validées avant la date d’arrêté signalées (comptées en plus)', async () => {
  const { domain } = await fresh();
  const d = avec(await domain(), lundis('2026-09-28', 20).map(w => feuille(w, [9, 9, 9, 9, 9, 0, 0])));
  const e = d.emp(1)!;
  const texte = `Matricule;Heures sup de l’année (heures)\n${matriculeAffiche(e)};150\n`;
  const o = { colonnes: ['matricule', 'heuresSup'] };
  const juillet = analyserReprise(d, 'soldes', texte, { ...o, dateReprise: '2026-07-01' }).lignes[0];
  assert.match(juillet.avertissements.join(' | '), /70 h d’heures supplémentaires 2026 validées dans Cursus avant le 1 juil\. 2026 : comptées au contingent en plus de celles reprises/);
  // Sept semaines à 45 h, du 18 mai au 29 juin. Arrêté avant les feuilles validées, ou colonne absente : rien à signaler.
  assert.doesNotMatch(analyserReprise(d, 'soldes', texte, { ...o, dateReprise: '2026-05-01' }).lignes[0].avertissements.join(), /heures supplémentaires/);
  const sansColonne = `Matricule;CET (jours)\n${matriculeAffiche(e)};2\n`;
  assert.doesNotMatch(analyserReprise(d, 'soldes', sansColonne, { colonnes: ['matricule', 'cet'], dateReprise: '2026-07-01' }).lignes[0].avertissements.join(), /heures supplémentaires/);
});
