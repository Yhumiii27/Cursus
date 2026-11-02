// Lot 12, chantier C6 (badgeage virtuel, t191), étape 2 : mode « calcule » et ligne PTG, horaires variables, mention
// d'information, page Confidentialité.
// - règles pures : ligne PTG (pointé moins la ventilation, écarts), pointé de la semaine, horaire variable (plages, durée
//   de référence, plafonds et référence de l'accord), plage fixe non couverte, mention d'information ;
// - feuille au mode « calcule » : ligne PTG tenue par les pointages (jamais saisie ni supprimée), ventilation au-delà du
//   pointé refusée à la soumission, pointé figé à la soumission puis à la validation, jamais renvoyée à Keystone,
//   `pointage.reprendreFeuille` et son journal sans heure ;
// - `referentiel.horaire.variable` : contrôles, journal sans la référence de l'accord ; débit-crédit sur la durée de
//   référence ; anomalie « plage fixe ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET ??= randomBytes(32).toString('hex');

const { nouvelleBase, json } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { bilanPeriode, etatDuSalarie, lirePointages, theoriques } = await import('../server/src/pointages.ts');
const { heuresKeystone } = await import('../server/src/integrations/keystone.ts');
const { anomaliesPointage, instantParis, postesDesPointages } = await import('../shared/rules/pointage.ts');
const { avecLignePointee, CODE_PTG, ecartsTexte, estLignePointee, memesLignes, pointeDeLaSemaine, totalDuJour } = await import('../shared/rules/pointage-feuille.ts');
const { controlerHoraireVariable, horsPlagesFixes, minutesSaisies, refusModificationVariable, SANS_VARIABLE } = await import('../shared/rules/horaires-variables.ts');
const { mentionInformationPointage } = await import('../shared/rules/pointage-information.ts');
const { INFO_CONFIDENTIALITE } = await import('../shared/confidentialite.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { Domain } = await import('../shared/domain.ts');
const { libelleAction } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type Feuille = import('../shared/types.ts').FeuilleTemps;
type Pointage = import('../shared/types.ts').Pointage;

const ACCORD = 'Accord d’entreprise sur le temps de travail du 1er mars 2026';
const iso = (jour: string, hhmm: string) => new Date(instantParis(jour, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)))).toISOString();

// — Règles pures —

test('ligne PTG : pointé moins la ventilation, en tête, jamais négative ; écarts au-delà du pointé', () => {
  const projet = { projet: 'KS-001', tache: 'Montage', ks: false, h: [5, 9, 0, 0, 0] };
  const { lignes, ecarts } = avecLignePointee([projet], [8, 7.5, 2, 0, 0, 0, 0]);
  assert.equal(lignes[0].projet, CODE_PTG);
  assert.equal(lignes[0].pt, true);
  assert.deepEqual(lignes[0].h, [3, 0, 2, 0, 0, 0, 0]);
  assert.deepEqual(lignes[1].h, [5, 9, 0, 0, 0, 0, 0], 'ligne du salarié complétée à 7 jours, jamais réduite');
  assert.deepEqual(ecarts, [{ di: 1, ventile: 9, pointe: 7.5 }]);
  assert.match(ecartsTexte(ecarts, ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']), /^mar\. : 9 h ventilées pour 7,5 h pointées$/);
  // Recalcul sur une feuille qui porte déjà la ligne : remplacée, pas doublée.
  const encore = avecLignePointee(lignes, [8, 10, 2, 0, 0, 0, 0]);
  assert.equal(encore.lignes.filter(l => estLignePointee(l)).length, 1);
  assert.deepEqual(encore.ecarts, []);
  assert.ok(memesLignes(lignes, avecLignePointee(lignes, [8, 7.5, 2, 0, 0, 0, 0]).lignes));
  assert.ok(!memesLignes(lignes, encore.lignes));
  // Jamais renvoyée à Keystone, seules les heures des projets.
  assert.deepEqual(heuresKeystone(encore.lignes), { 'KS-001': 14 });
});

test('pointé de la semaine : postes du jour de rattachement, pauses déduites, poste de nuit au jour de son début', () => {
  const l = [
    { id: 1, horodatage: iso('2026-10-05', '08:00'), sens: 'E' as const, annuleId: null },
    { id: 2, horodatage: iso('2026-10-05', '12:00'), sens: 'S' as const, annuleId: null },
    { id: 3, horodatage: iso('2026-10-05', '12:45'), sens: 'E' as const, annuleId: null },
    { id: 4, horodatage: iso('2026-10-05', '16:30'), sens: 'S' as const, annuleId: null },
    // Nuit du dimanche 11 au lundi 12 : rattachée au dimanche de la semaine.
    { id: 5, horodatage: iso('2026-10-11', '21:00'), sens: 'E' as const, annuleId: null },
    { id: 6, horodatage: iso('2026-10-12', '05:00'), sens: 'S' as const, annuleId: null },
  ];
  assert.deepEqual(pointeDeLaSemaine(postesDesPointages(l), '2026-10-05'), [7.75, 0, 0, 0, 0, 0, 8]);
});

test('horaire variable : plages dans l’amplitude, fixes entourées de mobiles, plafonds supplétifs ou référence de l’accord', () => {
  const J = { code: 'J', debut: '08:00', fin: '17:00', pause: 60 };
  const plages = [{ type: 'mobile', debut: '8:00', fin: '9 h 30' }, { type: 'fixe', debut: '09:30', fin: '11:30' }, { type: 'mobile', debut: '11:30', fin: '14:00' },
    { type: 'fixe', debut: '14:00', fin: '16:00' }, { type: 'mobile', debut: '16:00', fin: '17:00' }];
  const ok = controlerHoraireVariable(J, { variable: true, plages });
  assert.deepEqual(ok.erreurs, {});
  assert.equal(ok.champs!.dureeReference, 480, 'durée de l’horaire par défaut');
  assert.deepEqual([ok.champs!.reportMaxSemaine, ok.champs!.cumulMax, ok.champs!.accordVariable], [180, 600, null]);
  assert.equal(ok.champs!.plages![0].fin, '09:30', 'heures normalisées');
  assert.deepEqual(controlerHoraireVariable(J, { variable: false }).champs, SANS_VARIABLE);
  const erreur = (p: Record<string, unknown>, h = J) => Object.values(controlerHoraireVariable(h, { variable: true, plages, ...p }).erreurs).join(' ');
  assert.match(erreur({}, { code: 'N', debut: '21:00', fin: '05:00', pause: 30 }), /horaire de nuit/);
  assert.match(erreur({ plages: [{ type: 'mobile', debut: '07:00', fin: '09:00' }, ...plages.slice(1)] }), /amplitude/);
  assert.match(erreur({ plages: plages.map(p => ({ ...p, type: 'mobile' })) }), /Au moins une plage fixe/);
  assert.match(erreur({ plages: plages.slice(1) }), /première et la dernière plage sont mobiles/);
  assert.match(erreur({ plages: [plages[0], { type: 'fixe', debut: '09:00', fin: '11:30' }, ...plages.slice(2)] }), /chevauchent/);
  assert.match(erreur({ plages: [] }), /au moins une plage fixe/);
  assert.match(erreur({ reportMaxSemaine: '4' }), /référence de l’accord/);
  assert.deepEqual(controlerHoraireVariable(J, { variable: true, plages, reportMaxSemaine: '4', cumulMax: '12', accordVariable: ACCORD }).champs!.reportMaxSemaine, 240);
  assert.match(erreur({ reportMaxSemaine: '5', cumulMax: '4', accordVariable: ACCORD }), /cumul autorisé ne peut pas être inférieur/);
  assert.match(erreur({ dureeReference: '0,5' }), /Durée de référence/);
  assert.deepEqual([minutesSaisies('7,5'), minutesSaisies('7:30'), minutesSaisies('7 h 30'), minutesSaisies('abc'), minutesSaisies('')], [450, 450, 450, null, null]);
});

test('plage fixe : arrivée après le début, sortie pendant la plage ; couverte : rien', () => {
  const fixes = [{ type: 'fixe' as const, debut: '09:30', fin: '11:30' }, { type: 'fixe' as const, debut: '14:00', fin: '16:00' }];
  const t = (h: string) => instantParis('2026-10-06', Number(h.slice(0, 2)) * 60 + Number(h.slice(3)));
  assert.deepEqual(horsPlagesFixes(fixes, '2026-10-06', [[t('08:00'), t('12:00')], [t('13:00'), t('17:00')]]), []);
  const r = horsPlagesFixes(fixes, '2026-10-06', [[t('09:45'), t('12:00')], [t('13:00'), t('15:00')], [t('15:10'), t('17:00')]]);
  assert.deepEqual(r.map(x => [x.plage.debut, x.manque]), [['09:30', '09:30'], ['14:00', '15:00']]);
  assert.deepEqual(horsPlagesFixes(fixes, '2026-10-06', []), [], 'jour sans pointage : « jour prévu sans pointage » suffit');
});

test('plage fixe : jugée le jour même une fois finie seulement, jamais un jour de demi-journée d’absence', () => {
  const fixes = [{ type: 'fixe' as const, debut: '09:30', fin: '11:30' }, { type: 'fixe' as const, debut: '14:00', fin: '16:00' }];
  const j = '2026-10-06';
  const p = (id: number, hhmm: string, sens: 'E' | 'S') => ({ id, horodatage: iso(j, hhmm), sens, annuleId: null });
  const base = { du: j, au: j, prevus: new Set([j]), plagesFixes: new Map([[j, fixes]]) };
  const fixe = (x: Parameters<typeof anomaliesPointage>[0]) => anomaliesPointage(x).filter(a => a.code === 'plage_fixe').map(a => a.texte);
  // Arrivée à 8 h 30, lecture à 10 h : aucune plage n'est encore manquée (poste en cours, plages à venir).
  assert.deepEqual(fixe({ ...base, pointages: [p(1, '08:30', 'E')], maintenant: instantParis(j, 600) }), []);
  // Arrivée à 10 h, pause à midi, lecture à 12 h 30 : la plage du matin, finie, est manquée ; celle de l'après-midi pas encore.
  assert.deepEqual(fixe({ ...base, pointages: [p(1, '10:00', 'E'), p(2, '12:00', 'S')], maintenant: instantParis(j, 750) }), ['Plage fixe 09:30 – 11:30 non couverte (dès 09:30)']);
  // Demi-journée de congé le matin, pointage de 13 h 30 à 17 h 30 : rien, ni le jour même ni le lendemain.
  const apresMidi = [p(1, '13:30', 'E'), p(2, '17:30', 'S')];
  for (const maintenant of [instantParis(j, 18 * 60), instantParis('2026-10-07', 600)]) {
    assert.deepEqual(fixe({ ...base, pointages: apresMidi, demiAbsents: new Map([[j, 240]]), maintenant }), []);
  }
  // Témoin : sans la demi-journée d'absence, la plage du matin serait manquée.
  assert.deepEqual(fixe({ ...base, pointages: apresMidi, maintenant: instantParis('2026-10-07', 600) }), ['Plage fixe 09:30 – 11:30 non couverte (dès 09:30)']);
});

test('horaire variable : début, fin ou pause modifiés seulement si les plages tiennent encore', () => {
  const J = { code: 'J', nom: 'Journée', debut: '08:00', fin: '16:00', pause: 60, variable: true, dureeReference: 420, reportMaxSemaine: 180, cumulMax: 600, accordVariable: null,
    plages: [{ type: 'mobile' as const, debut: '08:00', fin: '09:30' }, { type: 'fixe' as const, debut: '09:30', fin: '11:30' }, { type: 'mobile' as const, debut: '11:30', fin: '16:00' }] };
  assert.equal(refusModificationVariable(J, { code: 'J', debut: '07:30', fin: '17:00', pause: 45 }), null, 'amplitude élargie');
  assert.match(refusModificationVariable(J, { code: 'J', debut: '22:00', fin: '06:00', pause: 30 }) ?? '', /horaire de nuit[^]*Repassez-le d’abord en horaire fixe/);
  assert.match(refusModificationVariable(J, { code: 'J', debut: '08:30', fin: '16:00', pause: 60 }) ?? '', /amplitude de l’horaire \(08:30 – 16:00\)/);
  assert.equal(refusModificationVariable({ ...J, ...SANS_VARIABLE }, { code: 'J', debut: '22:00', fin: '06:00', pause: 30 }), null, 'horaire fixe : rien à contrôler');
});

test('total du jour en mode « calcule » : le plus grand du pointé et de la ventilation, jamais leur somme', () => {
  const projet = { projet: 'KS-001', tache: 'Montage', ks: false, h: [3, 13, 0, 0, 0, 0, 0] };
  const { lignes } = avecLignePointee([projet], [3, 13, 2, 0, 0, 0, 0]);
  assert.deepEqual([0, 1, 2].map(di => totalDuJour(lignes, di, [3, 13, 2, 0, 0, 0, 0])), [3, 13, 2]);
  // Ligne PTG encore pleine (avant recalcul) : la ventilation ajoutée n'est pas comptée deux fois.
  const pleine = [{ ...lignes[0], h: [3, 13, 2, 0, 0, 0, 0] }, projet];
  assert.deepEqual([0, 1].map(di => totalDuJour(pleine, di, [3, 13, 2, 0, 0, 0, 0])), [3, 13]);
  assert.equal(totalDuJour(pleine, 0, null), 6, 'feuille déclarative : somme des lignes');
  // Seul le marqueur `pt` désigne la ligne système : un projet Keystone de code « PTG » reste une ligne ordinaire.
  assert.ok(!estLignePointee({ projet: CODE_PTG }));
});

test('mention d’information et page Confidentialité : finalité, fondement, populations, conservation, ni position ni biométrie', () => {
  const m = mentionInformationPointage({
    pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointageDelaiCorrectionJours: 7, pointageHorsLigne: true, conservationPointagesAns: 3,
    pointagePopulations: [{ critere: 'equipe', valeur: 'Maintenance', mode: 'controle', effet: '2027-01-04' }],
  });
  const t = m.join('\n');
  for (const x of [ACCORD, 'L2312-38', 'D3171-8', 'Maintenance', '7 jours', '3 ans', 'forfait jours', 'Aucune position, aucune photo ni donnée biométrique', 'CNIL']) assert.ok(t.includes(x), x);
  // Intérimaires : exclus par défaut (`pointageInterim` faux), et la mention le dit ; inclus, elle ne les exclut plus.
  assert.match(t, /cadres dirigeants, ni les intérimaires\./);
  const avecInterim = mentionInformationPointage({
    pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointageDelaiCorrectionJours: 7, pointageHorsLigne: true, conservationPointagesAns: 3, pointageInterim: true,
    pointagePopulations: [{ critere: 'equipe', valeur: 'Maintenance', mode: 'controle', effet: '2027-01-04' }],
  }).join('\n');
  assert.ok(!avecInterim.includes('intérimaires') && avecInterim.includes('cadres dirigeants.'));
  assert.match(mentionInformationPointage({ pointageAccord: '', pointageCseLe: null, pointageDelaiCorrectionJours: 7, pointageHorsLigne: false, conservationPointagesAns: 1, pointagePopulations: [] }).join('\n'),
    /\[référence à compléter\][^]*\[date à compléter\][^]*aucune population[^]*1 an,/);
  const page = JSON.stringify(INFO_CONFIDENTIALITE);
  assert.match(page, /Pointage des heures/);
  assert.match(page, /Ni position, ni photo, ni donnée biométrique/);
});

// — Actions —

async function fresh(mode: 'controle' | 'calcule' = 'calcule') {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const personne = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const P = { admin: await personne(null, 'rh'), mgr: await personne(12, 'manager'), coll: await personne(2, 'collaborateur') };
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const ctx = makeCtx(db, user, await loadFull(db, user));
    const r = await ACTIONS[name](ctx, payload);
    const x = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: x.message ?? null, result: x.result });
    return x as { message: string; result?: Record<string, any> };
  });
  const refuse = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, status = 400) =>
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message) && e.status === status, `${name} : ${motif}`);
  const journal = async (action: string) => (await db.query<{ payload: unknown }>('SELECT payload FROM journal WHERE action = ? ORDER BY id', [action])).map(l => json<Record<string, unknown>>(l.payload));
  await run(P.admin, 'parametres.maj', { pointageActif: true, pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointagePopulations: [{ critere: 'equipe', valeur: 'Maintenance', mode, effet: '2026-01-01' }] });
  // Semaine du 5 octobre de Mehdi (Maintenance) : sans feuille, pour que la feuille créée reçoive le mode de la population.
  await db.tx(async () => { await db.run('DELETE FROM feuilles WHERE emp_id = ? AND week = ?', [2, '2026-10-05']); });
  return { db, P, run, refuse, journal };
}
const pointer = async (db: Db, jour: string, hhmm: string, sens: 'E' | 'S') => await db.tx(async () => {
  const h = iso(jour, hhmm);
  await db.insert<Pointage>('pointages', { empId: 2, horodatage: h, jour, sens, source: 'virtuel', horsLigne: false, recuLe: h, annuleId: null });
});
const feuille = async (db: Db) => (await db.where<Feuille>('feuilles', 'empId', 2)).find(f => f.week === '2026-10-05')!;

test('mode « calcule » : ligne PTG tenue par les pointages, ventilation au-delà du pointé refusée, pointé figé à la soumission et à la validation', async () => {
  const { db, P, run, refuse, journal } = await fresh();
  // Lundi 8 h – 12 h, 13 h – 17 h ; mardi 8 h – 15 h 30.
  for (const [j, h, s] of [['2026-10-05', '08:00', 'E'], ['2026-10-05', '12:00', 'S'], ['2026-10-05', '13:00', 'E'], ['2026-10-05', '17:00', 'S'], ['2026-10-06', '08:00', 'E'], ['2026-10-06', '15:30', 'S']] as const) {
    await pointer(db, j, h, s);
  }
  await run(P.coll, 'temps.addLine', { empId: 2, week: '2026-10-05', projet: 'INT-MAINT' });
  let f = await feuille(db);
  assert.equal(f.modeTemps, 'calcule');
  assert.deepEqual(f.lignes.map(l => [l.projet, !!l.pt]), [[CODE_PTG, true], ['INT-MAINT', false]]);
  assert.deepEqual(f.lignes[0].h, [8, 7.5, 0, 0, 0, 0, 0], 'pointé entier, rien encore ventilé');
  // Ventilation : le reste suit à chaque saisie ; la ligne PTG ne se saisit ni ne se supprime.
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 0, value: '5' });
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 1, value: '9' });
  f = await feuille(db);
  assert.deepEqual(f.lignes[0].h, [3, 0, 0, 0, 0, 0, 0]);
  await refuse(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 0, di: 2, value: '3' }, /Ligne des heures pointées/);
  await refuse(P.coll, 'temps.removeLine', { empId: 2, week: '2026-10-05', li: 0 }, /Ligne des heures pointées/);
  // Mardi : 9 h ventilées pour 7,5 h pointées : la soumission est refusée.
  await refuse(P.coll, 'temps.submit', { empId: 2, week: '2026-10-05' }, /ventilées au-delà du pointé[^]*9 h ventilées pour 7,5 h pointées/);
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 1, value: '7' });
  await run(P.coll, 'temps.submit', { empId: 2, week: '2026-10-05' });
  f = await feuille(db);
  assert.equal(f.statut, 'soumise');
  assert.deepEqual(f.pointeFige, [8, 7.5, 0, 0, 0, 0, 0]);
  assert.deepEqual(f.lignes[0].h, [3, 0.5, 0, 0, 0, 0, 0]);
  // Décompte inchangé : la ligne PTG compte comme une autre (15,5 h pointées dans la semaine).
  const ds = await loadFull(db, P.admin);
  assert.equal(calcSheet(new Domain(ds), ds.employes.find(e => e.id === 2)!, f).total, 15.5);
  // Le manager ajoute un pointage oublié mercredi (validé d'emblée) puis valide : pointé refigé.
  await run(P.mgr, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: iso('2026-10-07', '08:00'), sens: 'E', motif: 'oubli' });
  await run(P.mgr, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: iso('2026-10-07', '10:00'), sens: 'S', motif: 'oubli' });
  await run(P.mgr, 'temps.validate', { empId: 2, week: '2026-10-05' });
  f = await feuille(db);
  assert.equal(f.statut, 'validee');
  assert.deepEqual(f.pointeFige, [8, 7.5, 2, 0, 0, 0, 0]);
  assert.deepEqual(f.lignes[0].h, [3, 0.5, 2, 0, 0, 0, 0]);
  // Après la validation : une correction passe par la réouverture ; reprendre le pointé aussi.
  await refuse(P.mgr, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: iso('2026-10-08', '08:00'), sens: 'E', motif: 'oubli' }, /réouverture/, 409);
  await refuse(P.coll, 'pointage.reprendreFeuille', { empId: 2, week: '2026-10-05' }, /déjà soumise ou validée/);
  // Pointage arrivé après la validation (inséré sans passer par les actions) : signalé, jamais réécrit dans la feuille.
  await pointer(db, '2026-10-08', '08:00', 'E');
  await pointer(db, '2026-10-08', '09:00', 'S');
  const ds2 = await loadFull(db, P.admin), e = ds2.employes.find(x => x.id === 2)!;
  const b = bilanPeriode(ds2, e, await lirePointages(db, [2], '2026-10-04', '2026-10-12'), '2026-10-05', '2026-10-11', instantParis('2026-10-10', 600));
  assert.ok(b.anomalies.some(a => a.code === 'apres_validation' && a.jour === '2026-10-08'));
  assert.deepEqual((await feuille(db)).lignes[0].h, [3, 0.5, 2, 0, 0, 0, 0]);
  assert.deepEqual(await journal('pointage.reprendreFeuille'), []);
});

test('pointage.reprendreFeuille : feuille au mode « calcule » seulement, ligne reprise, journal sans heure', async () => {
  const { db, P, run, refuse, journal } = await fresh();
  await run(P.coll, 'temps.addLine', { empId: 2, week: '2026-10-05', projet: 'INT-MAINT' });
  assert.deepEqual((await feuille(db)).lignes[0].h, [0, 0, 0, 0, 0, 0, 0]);
  await pointer(db, '2026-10-09', '06:00', 'E');
  await pointer(db, '2026-10-09', '14:15', 'S');
  const r = await run(P.coll, 'pointage.reprendreFeuille', { empId: 2, week: '2026-10-05' });
  assert.match(r.message, /Pointé repris sur la feuille : 8,3 h restent à répartir/);
  assert.deepEqual((await feuille(db)).lignes[0].h, [0, 0, 0, 0, 8.25, 0, 0]);
  const [j] = await journal('pointage.reprendreFeuille');
  assert.deepEqual([j.empId, j.week, j.ecarts], [2, '2026-10-05', 0]);
  assert.ok(!JSON.stringify(j).includes('8.25'), 'jamais une heure au journal');
  assert.match(libelleAction('pointage.reprendreFeuille'), /mode calculé/);
  // Feuille déclarative (Hugo Lambert, Logistique) : refus.
  await run(P.admin, 'temps.addLine', { empId: 16, week: '2026-10-19', projet: 'INT-MAINT' });
  await refuse(P.admin, 'pointage.reprendreFeuille', { empId: 16, week: '2026-10-19' }, /Feuille déclarative/, 409);
});

test('mode « controle » : feuille déclarative, aucune ligne PTG ni pointé figé', async () => {
  const { db, P, run } = await fresh('controle');
  await pointer(db, '2026-10-05', '08:00', 'E');
  await pointer(db, '2026-10-05', '16:00', 'S');
  await run(P.coll, 'temps.addLine', { empId: 2, week: '2026-10-05', projet: 'INT-MAINT' });
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 0, di: 0, value: '7' });
  await run(P.coll, 'temps.submit', { empId: 2, week: '2026-10-05' });
  const f = await feuille(db);
  assert.equal(f.modeTemps, 'controle');
  assert.deepEqual(f.lignes.map(l => l.projet), ['INT-MAINT']);
  assert.equal(f.pointeFige ?? null, null);
});

test('referentiel.horaire.variable : service RH, contrôles, journal sans la référence de l’accord ; débit-crédit et plage fixe', async () => {
  const { db, P, run, refuse, journal } = await fresh('controle');
  const plages = [{ type: 'mobile', debut: '08:00', fin: '09:30' }, { type: 'fixe', debut: '09:30', fin: '11:30' }, { type: 'mobile', debut: '11:30', fin: '16:00' }];
  await refuse(P.admin, 'referentiel.horaire.variable', { id: 'ZZ', variable: true, plages }, /introuvable/, 404);
  await refuse(P.admin, 'referentiel.horaire.variable', { id: 'J', variable: true, plages: plages.slice(1) }, /première et la dernière plage sont mobiles/);
  await refuse(P.admin, 'referentiel.horaire.variable', { id: 'J', variable: true, plages, reportMaxSemaine: '5' }, /référence de l’accord/);
  const r = await run(P.admin, 'referentiel.horaire.variable', { id: 'J', variable: true, plages, dureeReference: '7', reportMaxSemaine: '5', cumulMax: '15', accordVariable: ACCORD });
  assert.match(r.message, /Horaire J variable : mobile 08:00 – 09:30 · fixe 09:30 – 11:30 · mobile 11:30 – 16:00, 7 h par jour, report de 5 h par semaine et 15 h de cumul/);
  const h = await db.get<Record<string, unknown>>('horaires', 'J');
  assert.deepEqual([h!.dureeReference, h!.reportMaxSemaine, h!.cumulMax, h!.accordVariable], [420, 300, 900, ACCORD]);
  const [j] = await journal('referentiel.horaire.variable');
  assert.ok(!JSON.stringify(j).includes('1er mars'), 'référence de l’accord jamais recopiée');
  assert.deepEqual([j.code, j.plages, j.accord], ['J', 3, true]);
  // Théorique du jour : la durée de référence (7 h) à la place de celle de l'horaire J ; plafonds de l'horaire.
  await db.tx(async () => { await db.run('UPDATE equipes SET horaire = ? WHERE nom = ?', ['J', 'Maintenance']); });
  await pointer(db, '2026-10-08', '09:45', 'E');
  await pointer(db, '2026-10-08', '16:00', 'S');
  const ds = await loadFull(db, P.admin), e = ds.employes.find(x => x.id === 2)!;
  const t = theoriques(ds, e, '2026-10-08', '2026-10-08').get('2026-10-08')!;
  assert.equal(t.minutes, 420);
  assert.equal(t.variable?.code, 'J');
  const l = await lirePointages(db, [2], '2026-10-04', '2026-10-11');
  const b = bilanPeriode(ds, e, l, '2026-10-05', '2026-10-09', instantParis('2026-10-10', 600));
  assert.deepEqual(b.anomalies.filter(a => a.code === 'plage_fixe').map(a => [a.jour, a.texte]), [['2026-10-08', 'Plage fixe 09:30 – 11:30 non couverte (dès 09:30)']]);
  const etat = etatDuSalarie(ds, e, l, instantParis('2026-10-10', 600));
  assert.equal(etat.debitCredit.periode.semaines[0].report, Math.max(-300, Math.min(300, etat.debitCredit.semaine.solde)), 'report plafonné à 5 h (horaire variable)');
  // Retour à un horaire fixe : plages et plafonds retirés.
  await run(P.admin, 'referentiel.horaire.variable', { id: 'J', variable: false });
  const fixe = await db.get<Record<string, unknown>>('horaires', 'J');
  assert.deepEqual([fixe!.variable, fixe!.plages, fixe!.dureeReference, fixe!.accordVariable], [false, null, null, null]);
});

test('mode « calcule » : ventilation d’un jour de demi-journée d’absence ou de plus de 12 h, jamais comptée deux fois', async () => {
  const { db, P, run, refuse } = await fresh();
  // CP de Mehdi le lundi 5 octobre au matin (validé).
  await db.tx(async () => { await db.insert('absences', { empId: 2, type: 'CP', du: '2026-10-05', au: '2026-10-05', statut: 'validee', keystone: false, debutDemi: 'matin' }); });
  const ds = await loadFull(db, P.admin);
  const d = new Domain(ds);
  const { demiJoursAbsence } = await import('../shared/rules/temps.ts');
  const demi = demiJoursAbsence(d, 2, '2026-10-05')[0];
  assert.ok(demi && demi.max >= 3 && demi.max < 6, 'demi-journée d’absence de Mehdi le lundi 5 octobre');
  // Lundi : 3 h pointées l'après-midi ; mardi : 13 h d'affilée.
  for (const [j, h, sens] of [['2026-10-05', '13:30', 'E'], ['2026-10-05', '16:30', 'S'], ['2026-10-06', '07:00', 'E'], ['2026-10-06', '20:00', 'S']] as const) await pointer(db, j, h, sens);
  await run(P.coll, 'temps.addLine', { empId: 2, week: '2026-10-05', projet: 'INT-MAINT' });
  assert.deepEqual((await feuille(db)).lignes[0].h.slice(0, 2), [3, 13]);
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 0, value: '3' });
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 1, value: '13' });
  const f = await feuille(db);
  assert.deepEqual(f.lignes.map(l => l.h.slice(0, 2)), [[0, 0], [3, 13]]);
  // Au-delà du pointé, la demi-journée reste contrôlée sur le total réel du jour.
  await refuse(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 0, value: String(demi.max + 1) }, /Demi-journée d’absence/);
});

test('projet Keystone de code « PTG » : ligne ordinaire, jamais confondue avec la ligne système', async () => {
  const { db, P, run } = await fresh();
  await db.tx(async () => { await db.insert('projets', { code: 'PTG', nom: 'Projet PTG', statut: 'actif' }); });
  await pointer(db, '2026-10-06', '08:00', 'E');
  await pointer(db, '2026-10-06', '15:00', 'S');
  await run(P.coll, 'temps.addLine', { empId: 2, week: '2026-10-05', projet: 'PTG' });
  let f = await feuille(db);
  assert.deepEqual(f.lignes.map(l => [l.projet, !!l.pt]), [[CODE_PTG, true], ['PTG', false]]);
  await run(P.coll, 'temps.setCell', { empId: 2, week: '2026-10-05', li: 1, di: 1, value: '4' });
  f = await feuille(db);
  assert.deepEqual(f.lignes.map(l => l.h[1]), [3, 4]);
  assert.deepEqual(heuresKeystone(f.lignes), { PTG: 4 });
  await run(P.coll, 'temps.removeLine', { empId: 2, week: '2026-10-05', li: 1 });
  assert.deepEqual((await feuille(db)).lignes.map(l => l.projet), [CODE_PTG]);
});

test('referentiel.horaire.enregistrer : un horaire variable ne devient ni de nuit ni trop court pour ses plages', async () => {
  const { db, P, run, refuse } = await fresh('controle');
  const plages = [{ type: 'mobile', debut: '08:00', fin: '09:30' }, { type: 'fixe', debut: '09:30', fin: '11:30' }, { type: 'mobile', debut: '11:30', fin: '16:00' }];
  await run(P.admin, 'referentiel.horaire.variable', { id: 'J', variable: true, plages });
  const J = (await db.get<Record<string, unknown>>('horaires', 'J'))!;
  await refuse(P.admin, 'referentiel.horaire.enregistrer', { id: 'J', nom: J.nom, debut: '22:00', fin: '06:00', pause: 30 }, /horaire de nuit[^]*horaire fixe/);
  await refuse(P.admin, 'referentiel.horaire.enregistrer', { id: 'J', nom: J.nom, debut: '08:30', fin: J.fin, pause: J.pause }, /amplitude/);
  assert.deepEqual([(await db.get<Record<string, unknown>>('horaires', 'J'))!.debut], [J.debut], 'rien d’enregistré');
  // Nom ou pause seuls : admis.
  await run(P.admin, 'referentiel.horaire.enregistrer', { id: 'J', nom: 'Journée variable', debut: J.debut, fin: J.fin, pause: 45 });
  // Redevenu fixe : toute modification est de nouveau admise.
  await run(P.admin, 'referentiel.horaire.variable', { id: 'J', variable: false });
  await run(P.admin, 'referentiel.horaire.enregistrer', { id: 'J', nom: 'Nuit', debut: '22:00', fin: '06:00', pause: 30 });
});
