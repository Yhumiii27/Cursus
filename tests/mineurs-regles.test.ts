// Règles des salariés de moins de 18 ans (lot 5, chantier E, étape 2) : 8 h par jour et 35 h par semaine à motiver (motif
// ou référence de la dérogation de l'inspection, tracé au journal sans son texte), deux jours de repos consécutifs dont le
// dimanche en alerte, case « travail de nuit ou en continu » des équipes qui refuse l'affectation d'un mineur, dérogation
// pour travaux réglementés et échéance des 18 ans qui lève ces règles. Dates anniversaires : la veille, le jour, la semaine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, texteJson } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { relancesDues } = await import('../shared/rules/relances.ts');
const { recapitulatifEcheances } = await import('../server/src/relances.ts');
const { PROFIL_VIDE, validerProfil } = await import('../shared/rules/profil.ts');
const M = await import('../shared/rules/mineurs.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// Léo Martin, apprenti né le mercredi 14 octobre 2008 : mineur jusqu'au mardi 13 octobre 2026 inclus.
const LEO = { naissance: 2008, naissanceLe: '2008-10-14' };
const SEMAINE_MINEUR = '2026-10-05', SEMAINE_18_ANS = '2026-10-12', SEMAINE_MAJEUR = '2026-10-19';
const jours = (...h: number[]) => [...h, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteId = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteId(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), payload);
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: typeof r === 'string' ? r : (r as { message?: string } | null)?.message ?? null, result: r && typeof r === 'object' ? (r as { result?: unknown }).result ?? null : null });
    return r;
  });
  const refus = async (u: User, name: string, payload: Record<string, unknown>, motif: RegExp) =>
    await assert.rejects(async () => await run(u, name, payload), (x: unknown) => x instanceof ActionError && motif.test(x.message), name);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const creer = async (o: Record<string, unknown> = {}) => (await run(RH, 'employe.creer', {
    nom: 'Léo Martin', poste: 'Apprenti électromécanicien', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', jourOff: [],
    entree: '2026-09-01', fin: '2028-08-31', naissanceLe: LEO.naissanceLe, email: 'leo.martin@entreprise.example', ...o,
  }) as { result: { id: number } }).result.id;
  const journal = async (action: string) => texteJson(((await db.one('SELECT payload FROM journal WHERE action = ? ORDER BY id DESC LIMIT 1', [action])) as { payload: unknown } | undefined)?.payload ?? '');
  return { db, user, run, refus, RH, domain, creer, journal };
}

test('durées : 8 h par jour les jours de minorité, 35 h sur ces jours ; la semaine des 18 ans et après', () => {
  // Semaine entièrement mineure : 9 h un jour, 37,5 h dans la semaine.
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(9, 7, 7, 7, 7)).codes, ['jour_8h', 'semaine_35h']);
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(8, 8, 8, 8, 3)).codes, [], '8 h par jour et 35 h tout juste : permis');
  assert.match(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(9, 7, 7, 7, 4)).depassements[0], /Plus de 8 h sur une journée.*L3162-1/);
  // Semaine des 18 ans (mercredi) : 9 h le mardi, encore mineur ; 9 h le mercredi, jour anniversaire, permis.
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_18_ANS, jours(7, 9, 7, 7, 7)).codes, ['jour_8h']);
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_18_ANS, jours(7, 7, 9, 9, 9)).codes, []);
  // 35 h comptées sur les jours de minorité seulement : 39 h dans la semaine, 16 h avant les 18 ans.
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_18_ANS, jours(8, 8, 8, 8, 7)).codes, []);
  // Majeur : plus aucune règle des mineurs (dimanche compris).
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MAJEUR, jours(10, 10, 10, 10, 5, 0, 4)).codes, []);
  // Semaine inconnue (feuille pas encore créée) : aucun contrôle.
  assert.deepEqual(M.controlesMineur(LEO, null, jours(12)).codes, []);
  // Année seule (né en 2009) : mineur jusqu'au 31 décembre 2026, majeur le 1er janvier 2027 (règle à l'année).
  const annee = { naissance: 2009, naissanceLe: null };
  assert.deepEqual(M.controlesMineur(annee, '2026-12-28', jours(7, 7, 7, 9, 9)).codes, ['jour_8h'], 'jeudi 31 décembre : mineur');
  assert.deepEqual(M.controlesMineur(annee, '2026-12-28', jours(7, 7, 7, 8, 9)).codes, [], 'vendredi 1er janvier : majeur');
});

test('repos : dimanche et deux jours consécutifs, en alerte', () => {
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(7, 7, 7, 7, 7, 0, 0)).codes, []);
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(7, 7, 7, 7, 0, 4, 0)).codes, ['repos_consecutif'], 'vendredi et dimanche libres, séparés par le samedi travaillé');
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(0, 7, 7, 7, 7, 4, 0)).codes, ['repos_consecutif'], 'samedi travaillé, aucun couple de jours libres');
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_MINEUR, jours(0, 0, 7, 7, 7, 4, 0)).codes, [], 'lundi et mardi libres');
  const dim = M.controlesMineur(LEO, SEMAINE_MINEUR, jours(7, 7, 7, 7, 0, 0, 3));
  assert.deepEqual(dim.codes, ['dimanche']);
  assert.match(dim.repos[0], /3 h le dimanche.*L3164-5/);
  // Le dimanche de la semaine des 18 ans : majeur, plus d'alerte des mineurs.
  assert.deepEqual(M.controlesMineur(LEO, SEMAINE_18_ANS, jours(7, 7, 7, 7, 0, 0, 3)).codes, []);
});

test('calcSheet : dépassements des mineurs à motiver, repos en alerte, sans effet sur la paie', async () => {
  const { creer, domain } = await fresh();
  const id = await creer();
  const d = await domain(), e = d.emp(id)!;
  const sh = { week: SEMAINE_MINEUR, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: jours(9, 7, 7, 7, 7, 0, 2) }] };
  const c = calcSheet(d, e, sh);
  assert.equal(c.depassementsMineur.length, 2);
  assert.ok(c.depassementsMineur.every(x => c.depassements.includes(x) && c.warn.includes(x)));
  assert.ok(c.repos.some(x => /repos dominical d’un salarié de moins de 18 ans/.test(x)));
  // Mêmes heures après les 18 ans : seules les règles générales (aucune ici, hors repos dominical général).
  const apres = calcSheet(d, e, { ...sh, week: SEMAINE_MAJEUR });
  assert.deepEqual([apres.depassementsMineur, apres.depassements], [[], []]);
  assert.deepEqual([c.sup25, c.normal], [apres.sup25, apres.normal]);
});

test('feuille d’un mineur : motif ou référence de dérogation exigé, tracé au journal sans son texte', async () => {
  const { run, refus, RH, creer, domain, journal } = await fresh();
  const id = await creer();
  const base = { empId: id, week: SEMAINE_MINEUR };
  await run(RH, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
  for (const [di, value] of [9, 7, 7, 7, 7].entries()) await run(RH, 'temps.setCell', { ...base, li: 0, di, value: String(value) });
  await refus(RH, 'temps.submit', base, /Plus de 8 h sur une journée.*indiquez le motif du dépassement ou la référence de la dérogation de l’inspection du travail/);
  await run(RH, 'temps.submit', { ...base, motif: 'Dérogation inspection n° 2026-117' });
  assert.equal((await domain()).ds.feuilles.find(f => f.empId === id && f.week === SEMAINE_MINEUR)!.motifDepassement, 'Dérogation inspection n° 2026-117');
  const p = await journal('temps.submit');
  assert.match(p, /"depassementMineur":\["jour_8h","semaine_35h"\]/);
  assert.match(p, /"motifDepassement":"\[texte renseigné\]"/);
  assert.doesNotMatch(p, /2026-117/);
  // La semaine des 18 ans : 9 h le mercredi n'appellent aucun motif.
  const w2 = { empId: id, week: SEMAINE_18_ANS };
  await run(RH, 'temps.addLine', { ...w2, projet: 'INT-MAINT' });
  for (const [di, value] of [7, 7, 9, 7, 5].entries()) await run(RH, 'temps.setCell', { ...w2, li: 0, di, value: String(value) });
  await run(RH, 'temps.submit', w2);
  assert.doesNotMatch(await journal('temps.submit'), /depassementMineur|motifDepassement/);
});

test('équipe de nuit ou en continu : case renseignée, cochée refusée avec un mineur, affectation refusée', async () => {
  const { db, run, refus, RH, user, creer, journal } = await fresh();
  const id = await creer();
  // Case pas encore renseignée : null ; enregistrée décochée : false (le rappel de la fiche cesse).
  assert.equal((await loadFull(db, RH)).referentiels.equipes.find(q => q.nom === 'Maintenance')!.nuit, null);
  await refus(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], nuit: true }, /Léo Martin.*ne peut pas travailler de nuit.*L3163-2/);
  await run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], nuit: false });
  assert.equal((await loadFull(db, RH)).referentiels.equipes.find(q => q.nom === 'Maintenance')!.nuit, false);
  await refus(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], nuit: 'oui' }, /oui ou non/);
  // Équipe Production cochée : tracé au journal (avant, après).
  await run(RH, 'referentiel.equipe.exigences', { nom: 'Production', formations: [], habilitations: [], nuit: true });
  assert.match(await journal('referentiel.equipe.exigences'), /"nuit":true,"nuitAvant":null/);
  // Affectation d'un mineur : refusée au service RH comme au manager ; fiche et création de même.
  await refus(RH, 'equipe.affecter', { empId: id, equipe: 'Production' }, /Équipe Production \(travail de nuit ou en continu\) : Léo Martin a moins de 18 ans/);
  await refus(RH, 'employe.modifier', { id, equipe: 'Production' }, /travail de nuit ou en continu/);
  await refus(RH, 'employe.creer', {
    nom: 'Inès Faure', poste: 'Opératrice', equipe: 'Production', statut: 'ouvrier', typeContrat: 'cdd', temps: '35h', jourOff: [],
    entree: '2026-07-01', fin: '2026-12-31', naissanceLe: '2009-03-02', email: 'ines.faure@entreprise.example',
  }, /Inès Faure a moins de 18 ans/);
  await run(RH, 'equipe.affecter', { empId: id, equipe: null });
  await refus(await user(3, 'manager'), 'equipe.affecter', { empId: id, equipe: 'Production' }, /moins de 18 ans/);
  // Même date de naissance, entrée à venir le jour de ses 18 ans : jugé à l'entrée, majeur, affectation permise.
  await creer({ nom: 'Hugo Petit', email: 'hugo.petit@entreprise.example', equipe: 'Production', entree: '2026-10-14', fin: '2027-10-13' });
  // Majeur (le jour de ses 18 ans) : affectation permise.
  process.env.CURSUS_TODAY = '2026-10-14';
  try {
    await run(RH, 'equipe.affecter', { empId: id, equipe: 'Production' });
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
});

test('dérogation pour travaux réglementés : saisie sur la fiche, 3 ans, échéances et 18 ans', async () => {
  const { db, run, refus, RH, user, creer, domain, journal } = await fresh();
  const echeancesVue = async (u: User, empId: number) => { const v = new Domain(await buildSnapshot(db, u)); return v.echeances(v.enrich(60, false), 60).filter(x => x.emp.id === empId); };
  // Inès Faure : née le 2 mars 2010, mineure jusqu'au 1er mars 2028.
  const id = await creer({ nom: 'Inès Faure', email: 'ines.faure@entreprise.example', naissanceLe: '2010-03-02' });
  await refus(RH, 'employe.modifier', { id, derogationTravauxLe: '2026-10-11' }, /ne peut pas être future/);
  await refus(RH, 'employe.modifier', { id, derogationTravauxLe: '2026-02-30' }, /dérogation pour travaux réglementés invalide/);
  await run(RH, 'employe.modifier', { id, derogationTravauxLe: '2023-11-02' });
  assert.match(await journal('employe.modifier'), /derogationTravauxLe/);
  const d = await domain(), e = d.enrich(60, false).find(x => x.id === id)!;
  assert.deepEqual(M.etatMineur(e, d.ti), { majeurLe: '2028-03-02', aLAnnee: false, derogation: { le: '2023-11-02', fin: '2026-11-02', expiree: false }, derogationApresMajorite: false });
  const ech = d.echeances([e], 60).filter(x => x.emp.id === id && x.kind === 'contrat');
  const derog = ech.find(x => x.kindLabel === 'Dérogation · travaux réglementés')!;
  assert.deepEqual([derog.key, derog.statut, derog.d], ['due', 'À renouveler', 23]);
  const majeur = ech.find(x => x.label === '18 ans')!;
  assert.deepEqual([majeur.key, majeur.statut], ['ok', 'Fin des règles des mineurs']);
  // Référent HSE (sans la date de naissance) : la même échéance de dérogation que le service RH.
  assert.ok((await echeancesVue(await user(23, 'rh'), id)).some(x => x.kindLabel === M.ECHEANCE_DEROGATION && x.d === 23));
  // Le jour de l'échéance : expirée.
  process.env.CURSUS_TODAY = '2026-11-02';
  try {
    const d2 = await domain();
    const x = d2.echeances(d2.enrich(60, false), 60).find(y => y.emp.id === id && y.kindLabel === 'Dérogation · travaux réglementés')!;
    assert.deepEqual([x.key, x.statut], ['exp', 'Expirée — travaux réglementés interdits']);
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
  // Déclaration dont la fin suit les 18 ans : levée par les 18 ans, pas d'échéance de renouvellement.
  await run(RH, 'employe.modifier', { id, derogationTravauxLe: '2026-01-15' });
  const d3 = await domain();
  assert.ok(!d3.echeances(d3.enrich(60, false), 60).some(x => x.emp.id === id && x.kindLabel.startsWith('Dérogation')));
  // Vues sans la date de naissance (référent HSE, lecture seule) : l'indication du serveur, sans échéance non plus.
  for (const u of [await user(23, 'rh'), await user(11, 'rh')]) {
    const v = (await buildSnapshot(db, u)).employes.find(x => x.id === id)!;
    assert.deepEqual([v.naissanceLe, v.derogationApresMajorite], [null, true]);
    assert.ok(!(await echeancesVue(u, id)).some(x => x.kindLabel === M.ECHEANCE_DEROGATION), 'comme pour le service RH');
  }
  assert.equal((await buildSnapshot(db, await user(12, 'manager'))).employes.find(x => x.id === id)!.derogationApresMajorite, undefined, 'ni au manager');
  // Le jour des 18 ans : plus aucune échéance des mineurs.
  process.env.CURSUS_TODAY = '2028-03-02';
  try {
    const d4 = await domain();
    assert.equal(M.etatMineur(d4.emp(id)!, d4.ti), null);
    assert.ok(!d4.echeances(d4.enrich(60, false), 60).some(x => x.emp.id === id && x.kindLabel === 'Salarié de moins de 18 ans'));
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
  // Vues : le manager n'a ni la date de naissance ni la dérogation ; le référent HSE et la lecture seule la reçoivent, pas la paie.
  const vue = async (u: User) => (await buildSnapshot(db, u)).employes.find(x => x.id === id)!;
  assert.deepEqual([(await vue(await user(12, 'manager'))).derogationTravauxLe, (await vue(await user(12, 'manager'))).mineur], [null, true]);
  assert.equal((await vue(await user(23, 'rh'))).derogationTravauxLe, '2026-01-15');
  assert.equal((await vue(await user(11, 'rh'))).derogationTravauxLe, '2026-01-15');
  assert.equal((await vue(await user(7, 'rh'))).derogationTravauxLe, null);
  // Vue sans la date : aucune échéance des 18 ans à en déduire.
  assert.deepEqual(M.etatMineur({ naissance: 2010, naissanceLe: null, mineur: true }, '2026-10-10'), { majeurLe: null, aLAnnee: false, derogation: null, derogationApresMajorite: false });
});

test('année seule : 18 ans au 1er janvier, à compléter ; fiche contrôlée côté client comme côté serveur', () => {
  assert.deepEqual(M.etatMineur({ naissance: 2009, naissanceLe: null }, '2026-10-10'), { majeurLe: '2027-01-01', aLAnnee: true, derogation: null, derogationApresMajorite: false });
  assert.equal(M.etatMineur({ naissance: 2009, naissanceLe: null }, '2027-01-01'), null);
  const fiche = { ...PROFIL_VIDE('Production', '2026-10-10'), nom: 'Léo Martin', poste: 'Apprenti', email: 'leo@entreprise.example', matriculePaie: 'N0001', naissanceLe: LEO.naissanceLe, entree: '2026-09-01' };
  const opts = { equipes: ['Production'], year: 2026, mineurs: { equipes: [{ nom: 'Production', nuit: true }], today: '2026-10-10' } };
  assert.match(validerProfil(fiche, opts).errors.join(' '), /travail de nuit ou en continu/);
  assert.deepEqual(validerProfil(fiche, { ...opts, mineurs: { ...opts.mineurs, today: '2026-10-14' } }).errors, [], 'le jour des 18 ans');
  assert.deepEqual(validerProfil(fiche, { ...opts, mineurs: { equipes: [{ nom: 'Production', nuit: null }], today: '2026-10-10' } }).errors, [], 'case non renseignée : pas de refus');
  // Dérogation pour un majeur : sans objet, en avertissement.
  const majeur = { ...fiche, equipe: null, naissanceLe: '1990-01-01', derogationTravauxLe: '2026-01-01' };
  assert.match(validerProfil(majeur, opts).warnings.join(' '), /sans objet/);
});

test('feuille passée d’un salarié devenu majeur, vue du manager : contrôles de la semaine gardés, motif demandé', async () => {
  const { db, run, refus, user, creer, journal } = await fresh();
  const id = await creer();
  // 16 octobre 2026 : Léo a 18 ans depuis le 14 ; la semaine du 5 octobre, il était mineur tous les jours.
  process.env.CURSUS_TODAY = '2026-10-16';
  try {
    const mgr = await user(12, 'manager');
    const base = { empId: id, week: SEMAINE_MINEUR };
    await run(mgr, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
    for (const [di, value] of [9, 7, 7, 7, 7].entries()) await run(mgr, 'temps.setCell', { ...base, li: 0, di, value: String(value) });
    const vue = await buildSnapshot(db, mgr);
    const e = vue.employes.find(x => x.id === id)!;
    const sh = vue.feuilles.find(f => f.empId === id && f.week === SEMAINE_MINEUR)!;
    assert.deepEqual([e.naissanceLe, e.mineur, sh.mineur], [null, false, true], 'indication de la semaine, pas la date');
    // Calcul de l'écran du manager : le dépassement est connu, le champ du motif s'affiche.
    assert.equal(calcSheet(new Domain(vue), e, sh).depassementsMineur.length, 2);
    await refus(mgr, 'temps.submit', base, /Plus de 8 h sur une journée.*référence de la dérogation/);
    await run(mgr, 'temps.submit', { ...base, motif: 'Dérogation inspection n° 2026-118' });
    assert.match(await journal('temps.submit'), /"depassementMineur":\["jour_8h","semaine_35h"\]/);
    // Semaine après les 18 ans : indication fausse, aucun contrôle des mineurs.
    await run(mgr, 'temps.addLine', { empId: id, week: SEMAINE_MAJEUR, projet: 'INT-MAINT' });
    const sh2 = (await buildSnapshot(db, mgr)).feuilles.find(f => f.empId === id && f.week === SEMAINE_MAJEUR)!;
    assert.equal(sh2.mineur, false);
    // Vue du service RH : la date complète, sans indication sur la feuille.
    assert.equal((await buildSnapshot(db, await user(null, 'rh'))).feuilles.find(f => f.empId === id && f.week === SEMAINE_MINEUR)!.mineur, undefined);
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
});

test('relances par e-mail : 18 ans et dérogation au seul service RH, sous des clés propres', async () => {
  const { db, run, RH, creer, domain } = await fresh();
  await run(RH, 'messagerie.regler', { rh: 'rh@entreprise.example' });
  // Né le 3 novembre 2008 (18 ans dans 24 jours), dérogation déclarée le 1er novembre 2023 (fin dans 22 jours).
  const id = await creer({ naissanceLe: '2008-11-03', derogationTravauxLe: '2023-11-01' });
  const d = await domain();
  const dues = relancesDues(d, d.enrich(60, false), [90, 30, 7]).filter(r => r.empId === id && r.categorie === 'contrat');
  const cles = dues.map(r => r.cle).sort();
  assert.ok(cles.includes(`mineur:18ans:${id}:2026-11-03`) && cles.includes(`derogation:${id}:2026-11-01`), cles.join(' '));
  assert.ok(dues.filter(r => /^(mineur|derogation):/.test(r.cle)).every(r => r.sante), 'réservées au service RH');
  await db.tx(async () => await recapitulatifEcheances(db));
  const envois = (await db.all<Record<string, any>>('envois')).filter(x => x.type === 'echeances.recapitulatif');
  const rh = envois.filter(x => x.contenu.a[0] === 'rh@entreprise.example').map(x => x.contenu.texte).join('\n');
  assert.match(rh, /Léo Martin \(Maintenance\) — 18 ans : fin des règles des mineurs : échéance le/);
  assert.match(rh, /Léo Martin \(Maintenance\) — Dérogation pour travaux réglementés à renouveler/);
  // Manager de l'équipe Maintenance : ni le jour des 18 ans (date de naissance), ni la dérogation.
  const autres = envois.filter(x => x.contenu.a[0] !== 'rh@entreprise.example');
  assert.ok(autres.length > 0, 'récapitulatifs des managers envoyés');
  for (const x of autres) assert.doesNotMatch(x.contenu.texte, /Léo Martin.*(18 ans|Dérogation|nov\. 2026)/);
});
