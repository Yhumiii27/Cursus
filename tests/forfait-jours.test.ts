// Forfait jours (lot 6, chantier 2, étape 2 : t043) : cumul annuel des jours travaillés (demi-journée jusqu'à 4 h, semaine
// à cheval sur le 31 décembre ventilée jour par jour, cible au prorata), alerte au seuil réglé, motif exigé à la validation
// au-delà du plafond, avenant de renonciation fermé sans référence d'accord (COHERENCE), plafond porté par l'avenant dans la
// limite réglée, majoration minimale, jours rachetés dans le lot de paie (JREN désactivée : à saisir dans Sage puis réglés
// hors fichier ; activée : dans le fichier), annulation (refusée dans un lot à confirmer, motif masqué au journal),
// instantanés de chaque profil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { variablesDeLaPeriode, A_SAISIR } = await import('../server/src/variables-paie.ts');
const { Domain } = await import('../shared/domain.ts');
const F = await import('../shared/rules/forfait-jours.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Lot = ReturnType<typeof loadFull>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Avenant = import('../shared/types.ts').AvenantForfait;
type Feuille = import('../shared/types.ts').FeuilleTemps;

/** Cadre au forfait jours de la démonstration (forfait 218 jours, entré en 2011). */
const CADRE = 9;

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  // Les feuilles du cadre sont posées par chaque test.
  db.sql.prepare('DELETE FROM feuilles WHERE emp_id = ?').run(CADRE);
  // Jours de repos 2026 du cadre tous restants (9 jours) : ni RTT pris, ni compteur repris.
  db.sql.prepare("DELETE FROM absences WHERE emp_id = ? AND type = 'RTT'").run(CADRE);
  db.sql.prepare('DELETE FROM soldes_reprise WHERE emp_id = ?').run(CADRE);
  const compteDe = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId), role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const ADMIN = user(null, 'rh');
  const d = () => new Domain(loadFull(db, ADMIN));
  const regler = (r: Record<string, unknown>) => db.setSetting('app', { ...db.getSetting<Record<string, unknown>>('app', {}), ...r });
  /** Feuille du cadre pour la semaine `week`, heures du lundi au dimanche. */
  const feuille = (week: string, h: number[], statut = 'validee') => db.insert<Feuille>('feuilles', {
    empId: CADRE, week, statut, comment: null, sage: false, keystone: false, contrat: null, lignes: [{ projet: 'INT-COM', tache: 'Avant-vente', ks: false, h }],
  });
  const journal = (action: string) => db.all<{ action: string; payload: Record<string, any>; salaries: number[] }>('journal').filter(l => l.action === action);
  const lots = () => db.all<Lot>('lotsPaie');
  return { db, run, refus, d, regler, feuille, journal, lots, ADMIN, PAIE: user(7, 'rh'), LECTURE: user(11, 'rh'), HSE: user(23, 'rh'), GEST: user(14, 'rh') };
}

const SEMAINE = [8, 8, 8, 8, 8, 0, 0];

test('t043 cumul : demi-journée jusqu’à 4 h, semaine à cheval ventilée jour par jour, cible au prorata, solde de repos', () => {
  const { d, feuille, db } = fresh();
  feuille('2026-09-28', [8, 8, 3, 0, 8, 4, 0]); // 1 + 1 + 0,5 + 0 + 1 + 0,5 = 4
  feuille('2026-10-05', SEMAINE, 'soumise'); // soumise : pas encore comptée
  let k = F.cumulForfaitJours(d(), d().emp(CADRE)!, 2026)!;
  assert.equal(k.done, 4);
  assert.equal(k.cible, 218);
  assert.equal(k.plafond, 218);
  assert.equal(k.etat, 'ok');
  assert.ok(k.prorata > 160 && k.prorata < 170, 'cible à date : part de l’année écoulée au 10 octobre');
  // Semaine du lundi 28 décembre 2026 : 4 jours en 2026, le vendredi 1er janvier en 2027.
  feuille('2026-12-28', SEMAINE);
  assert.equal(F.cumulForfaitJours(d(), d().emp(CADRE)!, 2026)!.done, 8);
  assert.equal(F.cumulForfaitJours(d(), d().emp(CADRE)!, 2027)!.done, 1);
  // Entrée en cours d'année : cible au prorata de la présence.
  db.update('employes', CADRE, { entree: '2026-07-01' });
  k = F.cumulForfaitJours(d(), d().emp(CADRE)!, 2026)!;
  assert.equal(k.cible, Math.round(218 * 184 / 365));
  // Salarié hors forfait jours : aucun cumul.
  assert.equal(F.cumulForfaitJours(d(), d().emp(2)!, 2026), null);
  // Jours de repos du forfait (rttInfo) : droit, et reste une fois les jours rachetés retirés.
  const r = F.reposForfaitInfo(d(), d().emp(CADRE)!, { ...k, rachetes: 3 })!;
  assert.equal(r.reste, Math.round((r.solde - 3) * 10) / 10);
});

test('t043 validation : alerte au seuil sans blocage, motif du valideur exigé au-delà du plafond, tracé sans son texte', () => {
  const { db, run, refus, feuille, journal, ADMIN, regler } = fresh();
  // Forfait réduit à 7 jours pour atteindre le plafond en deux semaines.
  db.update('employes', CADRE, { forfaitJours: 7 });
  feuille('2026-09-21', [8, 8, 0, 0, 0, 0, 0]);
  feuille('2026-09-28', SEMAINE, 'soumise');
  regler({ forfaitJoursAlerte: 90 });
  // 2 + 5 = 7 jours sur 7 : seuil d'alerte atteint, validée avec une alerte.
  assert.match(run(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-09-28' }), /Forfait jours 2026 : 100 % du plafond atteint/);
  // Une semaine de plus : 12 jours sur 7, motif exigé.
  feuille('2026-10-05', SEMAINE, 'soumise');
  refus(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-10-05' }, 400, /Forfait jours 2026 dépassé : 12 j travaillés pour un plafond de 7 j \(aucun avenant de renonciation\) : indiquez le motif/);
  assert.match(run(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-10-05', motifForfait: 'Mise en service urgente chez le client' }), /dépassé/);
  const sh = db.all<Feuille>('feuilles').find(f => f.empId === CADRE && f.week === '2026-10-05')!;
  assert.equal(sh.statut, 'validee');
  assert.equal(sh.motifForfait, 'Mise en service urgente chez le client');
  const l = journal('temps.validate').at(-1)!;
  assert.equal(l.payload.motifForfait, '[texte renseigné]');
  assert.ok(!JSON.stringify(l).includes('Mise en service urgente'));
  // Hors forfait jours : aucun contrôle.
  assert.deepEqual(F.controleValidationForfait(new Domain(loadFull(db, ADMIN)), new Domain(loadFull(db, ADMIN)).emp(2)!, { ...sh, empId: 2 }), { depassements: [], alertes: [] });
});

test('t043 réglages : renonciation fermée sans référence d’accord (COHERENCE), plafond et majoration bornés', () => {
  const { d } = fresh();
  const s = d().ds.settings;
  assert.equal(F.rachatOuvert(s), false);
  assert.throws(() => appliquerReglages(s, { forfaitJoursRachat: true }), (e: unknown) => e instanceof ReglageInvalide && /accord collectif/.test(e.message));
  const ouvert = appliquerReglages(s, { forfaitJoursRachat: true, forfaitJoursAccord: '  Accord   du 1er mars 2026 ', forfaitJoursPlafond: 400, forfaitJoursMajorationMin: 5 });
  assert.equal(ouvert.forfaitJoursAccord, 'Accord du 1er mars 2026');
  assert.equal(ouvert.forfaitJoursPlafond, 282);
  assert.equal(ouvert.forfaitJoursMajorationMin, 10);
  assert.equal(F.rachatOuvert(ouvert), true);
  assert.equal(appliquerReglages(s, { forfaitJoursJren: 'autre' }).forfaitJoursJren, 'signature');
});

test('t043 avenant : fermé sans accord, plafond réglé, majoration minimale, plafond de l’année porté par l’avenant', () => {
  const { db, run, refus, d, feuille, regler, journal, ADMIN, GEST, PAIE } = fresh();
  const avenant = { empId: CADRE, annee: 2026, jours: 4, taux: 25, signeLe: '2026-10-01', reference: 'AV-FJ-2026-01' };
  refus(ADMIN, 'forfait.avenant', avenant, 400, /Renonciation à des jours de repos fermée/);
  regler({ forfaitJoursRachat: true, forfaitJoursAccord: 'Accord d’entreprise du 1er mars 2026' });
  refus(PAIE, 'forfait.avenant', avenant, 403);
  refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 18 }, 400, /17 j au plus — forfait de 218 jours, plafond de 235 jours/);
  // On ne renonce qu'aux jours de repos restants de l'année (9 jours).
  refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 10 }, 400, /9 j au plus — jours de repos 2026 restants \(9 j de droit, 0 j pris ou posés\)/);
  refus(ADMIN, 'forfait.avenant', { ...avenant, taux: 5 }, 400, /de 10 à 100 %/);
  refus(ADMIN, 'forfait.avenant', { ...avenant, signeLe: '2026-11-02' }, 400, /signature future/);
  refus(ADMIN, 'forfait.avenant', { ...avenant, empId: 2 }, 400, /ne relève pas d’un forfait annuel en jours/);
  assert.match(run(GEST, 'forfait.avenant', avenant), /4 jours rachetés, majoration de 25 %.* plafond 2026 porté à 222 j · paie : rubrique JREN, octobre 2026/);
  // Un second avenant de l'année : 13 jours au plus sous le plafond, mais 5 jours de repos restants seulement.
  refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 14 }, 400, /13 j au plus.*4 j déjà rachetés en 2026/);
  refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 8 }, 400, /5 j au plus — jours de repos 2026 restants.*4 j déjà rachetés/);
  const l = journal('forfait.avenant').at(-1)!;
  assert.deepEqual([l.payload.annee, l.payload.jours, l.payload.taux, l.payload.reference, l.salaries], [2026, 4, 25, '[texte renseigné]', [CADRE]]);
  assert.ok(!JSON.stringify(l).includes('AV-FJ-2026-01'));
  assert.equal(estActionPaie('forfait.avenant'), true);
  assert.equal(familleAction('forfait.annulerAvenant')?.id, 'temps');
  assert.ok(JOURNAL_LABEL['forfait.avenant'] && JOURNAL_LABEL['forfait.annulerAvenant']);
  // Le plafond de l'année devient le forfait plus 4 jours : une feuille qui dépassait le forfait n'exige plus de motif.
  db.update('employes', CADRE, { forfaitJours: 7 });
  feuille('2026-09-21', [8, 8, 8, 8, 8, 8, 0]);
  feuille('2026-09-28', SEMAINE, 'soumise');
  const k = F.cumulForfaitJours(d(), d().emp(CADRE)!, 2026)!;
  assert.deepEqual([k.rachetes, k.plafond], [4, 11]);
  assert.match(run(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-09-28' }), /validée/);
});

test('t043 paie : JREN désactivée, jours à saisir dans Sage puis réglés hors fichier ; activée, dans le fichier ; annulation', () => {
  const { db, run, refus, regler, lots, journal, ADMIN, PAIE } = fresh();
  regler({ forfaitJoursRachat: true, forfaitJoursAccord: 'Accord d’entreprise du 1er mars 2026' });
  run(ADMIN, 'forfait.avenant', { empId: CADRE, annee: 2026, jours: 4, taux: 25, signeLe: '2026-10-01', reference: '' });
  const av = () => db.all<Avenant>('avenantsForfait')[0];
  // Rubrique désactivée par défaut : listée dans le résumé du lot, absente du fichier, réglée hors fichier à la confirmation.
  assert.match(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /éléments? à saisir dans Sage/);
  let lot = lots().at(-1)!;
  assert.deepEqual(lot.resume.aSaisir?.filter(x => x.famille === 'rachats').map(x => [x.empId, x.rubrique, x.quantite, x.detail]),
    [[CADRE, 'JREN', 4, 'Avenant de renonciation 2026 signé le 01/10/2026 · majoration 25 %']]);
  assert.ok(!L.lignesFichier(lot.contenu!).some(x => x.rubrique === 'JREN'));
  assert.ok(variablesDeLaPeriode(db, PAIE, '2026-10').some(v => v.rubrique === A_SAISIR && v.empId === CADRE && /Avenant de renonciation/.test(v.detail)));
  run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  assert.deepEqual([av().lotId, av().sage, av().horsFichier], [lot.id, true, true]);
  assert.equal(F.etatRachat(av()), 'réglé hors fichier (saisi dans Sage)');

  // Rubrique activée : un second avenant part dans le fichier sous son code, réservé par le lot, libéré par son annulation.
  run(PAIE, 'paie.rubrique', { code: 'JREN', active: true, codeSage: '310' });
  run(ADMIN, 'forfait.avenant', { empId: CADRE, annee: 2026, jours: 2, taux: 30, signeLe: '2026-10-05', reference: '' });
  const second = () => db.all<Avenant>('avenantsForfait')[1];
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  lot = lots().at(-1)!;
  assert.deepEqual(lot.rachats, [{ id: second().id, empId: CADRE }]);
  assert.deepEqual(lot.resume.rachats, { elements: 1, salaries: 1 });
  assert.ok(L.lignesFichier(lot.contenu!).some(x => x.rubrique === '310' && x.quantite === 2));
  assert.deepEqual(journal('paie.lotGenerer').at(-1)!.payload.rachats, [second().id]);
  // Dans un lot à confirmer : l'annulation de l'avenant est refusée.
  refus(ADMIN, 'forfait.annulerAvenant', { id: second().id, motif: 'Erreur' }, 409, /annulez d’abord ce lot/);
  run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  assert.equal(second().lotId, null);
  refus(ADMIN, 'forfait.annulerAvenant', { id: second().id }, 400, /motif/);
  assert.match(run(ADMIN, 'forfait.annulerAvenant', { id: second().id, motif: 'Salarié revenu sur sa décision' }), /annulé/);
  assert.ok(second().annuleLe);
  const l = journal('forfait.annulerAvenant').at(-1)!;
  assert.ok(!JSON.stringify(l).includes('revenu sur sa décision'));
  assert.deepEqual(l.salaries, [CADRE]);
  // Annulé : plus rien à émettre ; le premier, déjà réglé, s'annule avec la mention de la régularisation dans Sage.
  assert.deepEqual(F.elementsRachats(new Domain(loadFull(db, ADMIN)), '2026-12', [{ code: 'JREN', codeSage: '310', active: true }]), []);
  assert.match(run(ADMIN, 'forfait.annulerAvenant', { id: av().id, motif: 'Erreur de saisie' }), /à régulariser dans Sage/);
});

test('t043 paie : période des jours rachetés, mois de la signature ou décembre de l’année ; un mois clos part sur la période ouverte', () => {
  const a = { annee: 2026, signeLe: '2026-11-03' };
  assert.equal(F.periodeRachat(a, { forfaitJoursJren: 'signature' }, '2026-10-10'), '2026-11');
  assert.equal(F.periodeRachat(a, { forfaitJoursJren: 'cloture' }, '2026-10-10'), '2026-12');
  assert.equal(F.periodeRachat({ annee: 2026, signeLe: '2026-08-01' }, { forfaitJoursJren: 'signature' }, '2026-10-10'), '2026-10');
});

test('t043 instantanés : service RH complet, paie et lecture seule sans le motif, manager réduit aux jours, intéressé, référent HSE rien', () => {
  const { db, ADMIN, PAIE, LECTURE, HSE } = fresh();
  db.insert('avenantsForfait', {
    empId: 12, annee: 2026, jours: 5, taux: 25, signeLe: '2026-10-01', reference: 'AV-12', creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
    annuleLe: '2026-10-02T08:00:00.000Z', annulePar: 'Sandrine Vidal', annuleMotif: 'Erreur de saisie', lotId: null, sage: false, horsFichier: false,
  });
  db.insert('avenantsForfait', {
    empId: CADRE, annee: 2026, jours: 3, taux: 20, signeLe: '2026-10-01', reference: 'AV-9', creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
    annuleLe: null, annulePar: null, annuleMotif: null, lotId: null, sage: false, horsFichier: false,
  });
  const vue = (u: User) => buildSnapshot(db, u).avenantsForfait ?? [];
  assert.equal(vue(ADMIN).length, 2);
  assert.equal(vue(ADMIN).find(a => a.empId === 12)!.annuleMotif, 'Erreur de saisie');
  for (const u of [PAIE, LECTURE]) {
    assert.equal(vue(u).length, 2);
    assert.ok(vue(u).every(a => a.annuleMotif === null));
    assert.equal(vue(u).find(a => a.empId === CADRE)!.taux, 20);
  }
  assert.deepEqual(vue(HSE), []);
  // Nadia Kaci (9) : son propre avenant, sans auteur ; manager de Clara Roussel (19), forfait jours : jours et année seulement.
  db.insert('avenantsForfait', {
    empId: 19, annee: 2026, jours: 2, taux: 15, signeLe: '2026-10-01', reference: 'AV-19', creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
    annuleLe: null, annulePar: null, annuleMotif: null, lotId: 3, sage: true, horsFichier: false,
  });
  const compte = (empId: number) => (db.sql.prepare('SELECT id FROM comptes WHERE emp_id = ?').get(empId) as { id: number }).id;
  const soi = buildSnapshot(db, currentUser(db, { compteId: compte(CADRE), role: 'collaborateur', methode: 'demo' })!).avenantsForfait ?? [];
  assert.deepEqual(soi.map(a => [a.empId, a.taux, a.reference, a.creePar]), [[CADRE, 20, 'AV-9', '']]);
  const equipe = buildSnapshot(db, currentUser(db, { compteId: compte(CADRE), role: 'manager', methode: 'demo' })!).avenantsForfait ?? [];
  assert.deepEqual(equipe.map(a => [a.empId, a.jours, a.taux, a.reference, a.lotId]), [[CADRE, 3, 20, 'AV-9', null], [19, 2, 0, null, null]]);
  // Le manager voit le plafond de son membre porté par l'avenant, comme le serveur à la validation.
  const dm = new Domain(buildSnapshot(db, currentUser(db, { compteId: compte(CADRE), role: 'manager', methode: 'demo' })!));
  assert.equal(F.cumulForfaitJours(dm, dm.emp(19)!, 2026)!.plafond, 220);
});

test('t043 cumul : passage au forfait jours en cours d’année (historique des contrats), cible au prorata des périodes sous forfait', () => {
  const { db, d } = fresh();
  // Mehdi Benali (35 h) passe au forfait jours (218) le 1er juillet 2026 : la cible ne compte que le second semestre.
  const e = d().emp(2)!;
  const regime = { statut: e.statut, typeContrat: e.typeContrat, heures: null, forfaitHeures: null, jourOff: [] };
  db.insert('contratsHistorique', { empId: 2, effet: e.entree, nature: 'embauche', regime: { ...regime, temps: '35h', forfaitJours: null }, le: '2026-06-01', par: 'Cursus', parId: null, applique: true });
  db.insert('contratsHistorique', { empId: 2, effet: '2026-07-01', nature: 'avenant', regime: { ...regime, temps: 'forfait_jours', forfaitJours: 218 }, le: '2026-06-01', par: 'Sandrine Vidal', parId: null, applique: true });
  db.update('employes', 2, { temps: 'forfait_jours', forfaitJours: 218, tempsDepuis: '2026-07-01' });
  const k = F.cumulForfaitJours(d(), d().emp(2)!, 2026)!;
  assert.equal(k.forfait, 218);
  assert.equal(k.cible, Math.round(218 * 184 / 365));
});

test('t043 textes : cumul avec avenant, dépassement avec jours rachetés, état de l’avenant pour la paie', () => {
  const k = { annee: 2026, done: 230, cible: 218, forfait: 218, prorata: 168, rachetes: 10, plafond: 228, seuil: 90, etat: 'depasse' as const };
  assert.equal(F.cumulTexte(k), '230 j travaillés sur 228 j (forfait 218 + 10 rachetés par avenant)');
  assert.match(F.alerteForfait(k), /plafond de 228 j \(forfait et 10 jours rachetés par avenant\)/);
  assert.equal(F.alerteForfait({ ...k, done: 100, etat: 'ok' }), '');
  const a = { id: 1, empId: 9, annee: 2026, jours: 3, taux: 25, signeLe: '2026-10-01', reference: null, creeLe: '', creePar: '', annuleLe: null, annulePar: null, annuleMotif: null, lotId: null, sage: false, horsFichier: false };
  assert.equal(F.etatRachat(a), 'en attente du prochain lot de paie');
  assert.equal(F.etatRachat({ ...a, lotId: 4 }), 'dans le lot de paie n° 4, import à confirmer');
  assert.equal(F.etatRachat({ ...a, lotId: 4, sage: true }), 'transmis à la paie (lot n° 4)');
  assert.equal(F.etatRachat({ ...a, annuleLe: '2026-10-02' }), 'annulé');
});
