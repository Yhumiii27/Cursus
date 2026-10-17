// Absences dans le fichier d'import de la paie (lot 5, chantier I, étape 1 : t028) : rubriques d'absence, jours pondérés
// au demi-jour ventilés par mois, rappel d'une période close, écart avec ce que les lots ont déjà emporté (prolongation,
// annulation, requalification : régularisation), réservation, libération et marquage des absences par le lot, réglage
// d'activation, codes à confirmer, rubrique désactivée, périmètre du fichier, migration d'une base reprise, export des
// variables de la période, journal et données transmises à chaque profil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const express = (await import('express')).default;
const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { openSession } = await import('../server/src/auth.ts');
const { routesFichierPaie } = await import('../server/src/fichier-paie.ts');
const { csvVariables, routesVariablesPaie, variablesDeLaPeriode } = await import('../server/src/variables-paie.ts');
const { absencesAEmettre, CLE_DEPUIS, lireDepuis } = await import('../server/src/absences-paie.ts');
const { ABSENCES_ANTERIEURES } = await import('../server/src/migrations/paie.ts');
const { Domain } = await import('../shared/domain.ts');
const A = await import('../shared/rules/absences-paie.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { NATURES_ABSENCE, RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const C = await import('../client/src/state/confirmations.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;
type Element = import('../shared/types.ts').ElementAbsencePaie;
type Lot = ReturnType<typeof loadFull>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Ligne = { action: string; message: string | null; payload: Record<string, any>; salaries: number[]; paie: boolean };

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
function fresh(db: Db = new Db(':memory:'), semer = true) {
  if (semer) seedDemo(db);
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
  const lots = () => db.all<Lot>('lotsPaie');
  const journal = (action: string) => db.all<Ligne>('journal').filter(l => l.action === action);
  const absence = (id: number) => db.get<import('../shared/types.ts').Absence>('absences', id)!;
  const ADMIN = user(null, 'rh');
  const d = () => new Domain(loadFull(db, ADMIN));
  return { db, user, compteDe, run, refus, lots, journal, absence, d, ADMIN, PAIE: user(7, 'rh'), GEST: user(14, 'rh'), LECTURE: user(11, 'rh'), KARIM: user(12, 'manager') };
}
const inserer = (db: Db, a: Record<string, unknown>) => db.insert<{ id: number }>('absences', { keystone: true, ...a }).id;
const sansEmis = { emis: [], reservees: new Set<number>(), depuis: null };

// — Règles —

test('t028 rubriques : congés et natures, chacune dans la table des rubriques à confirmer', () => {
  assert.deepEqual(['CP', 'RTT', 'RECUP'].map(t => A.rubriqueAbsence(t as 'CP')), ['CP', 'RTT', 'RECUP']);
  assert.equal(A.rubriqueAbsence('ABSENCE'), null, 'absence à qualifier : rien ne part');
  assert.equal(A.rubriqueAbsence('MALADIE'), 'ABS_IND_SANTE');
  assert.equal(A.rubriqueAbsence('MATERNITE'), 'ABS_IND_PARENT');
  assert.equal(A.rubriqueAbsence('MARIAGE'), 'ABS_MAINT_FAMILLE');
  assert.equal(A.rubriqueAbsence('DEUIL_ENFANT'), 'ABS_IND_FAMILLE');
  assert.equal(A.rubriqueAbsence('PARENTAL'), 'ABS_NP');
  assert.equal(A.rubriqueAbsence('ENFANT_MALADE'), 'ABS_NP');
  assert.equal(A.rubriqueAbsence('SANS_SOLDE'), 'ABS_NP');
  // Toute nature a sa rubrique dans la table (sinon elle partirait sans code à confirmer).
  for (const n of Object.keys(NATURES_ABSENCE)) assert.ok(Object.hasOwn(RUBRIQUES_PAIE, A.rubriqueAbsence(n as 'MALADIE')!), n);
  assert.deepEqual([RUBRIQUES_PAIE.CP.unite, RUBRIQUES_PAIE.RTT.unite, RUBRIQUES_PAIE.RECUP.unite, RUBRIQUES_PAIE.ABS_IND_SANTE.unite], ['j', 'j', 'h', 'j']);
  // Libellés lisibles en Windows-1252 (colonne « libellé » du fichier) : aucun tiret long.
  assert.ok(Object.values(RUBRIQUES_PAIE).every(r => !r.label.includes('—')));
  assert.equal(L.perimetreFichier(false), L.PERIMETRE_FICHIER);
  assert.match(L.perimetreFichier(true), /absences validées en jours \(récupération en heures\), ventilées par mois/);
  assert.equal(A.absencesDansLeFichier(undefined), true, 'activé par défaut');
});

test('t028 ventilation : jours pondérés au demi-jour, mois par mois, rappel d’un mois clos, récupération en heures', () => {
  const { db, d } = fresh();
  // CP du mardi 29 septembre après-midi au vendredi 2 octobre matin : 1,5 jour en septembre, 1,5 en octobre.
  const cp = inserer(db, { empId: 1, type: 'CP', du: '2026-09-29', au: '2026-10-02', debutDemi: 'apres_midi', finDemi: 'matin', statut: 'validee' });
  // Accident du travail à cheval sur octobre et novembre : jours calendaires, novembre hors d'un lot d'octobre.
  const at = inserer(db, { empId: 10, type: 'AT', du: '2026-10-26', au: '2026-11-04', statut: 'validee' });
  // Récupération d'une demi-journée (35 h : 7 h par jour) ; intérimaire : jamais ; demande en attente : jamais.
  const recup = inserer(db, { empId: 5, type: 'RECUP', du: '2026-10-20', au: '2026-10-20', debutDemi: 'matin', statut: 'validee' });
  const interim = inserer(db, { empId: 15, type: 'CP', du: '2026-10-21', au: '2026-10-21', statut: 'validee' });
  assert.deepEqual(A.partsAbsence(d(), d().ds.absences.find(a => a.id === cp)!, '2026-12'), [
    { mois: '2026-09', quantite: 1.5, du: '2026-09-29', au: '2026-09-30' },
    { mois: '2026-10', quantite: 1.5, du: '2026-10-01', au: '2026-10-02' },
  ]);
  assert.deepEqual(A.partsAbsence(d(), d().ds.absences.find(a => a.id === at)!, '2026-12').map(p => [p.mois, p.quantite]), [['2026-10', 6], ['2026-11', 4]]);
  assert.deepEqual(A.partsAbsence(d(), d().ds.absences.find(a => a.id === cp)!, '2026-12', '2026-10-01').map(p => p.mois), ['2026-10'], 'jours d’avant la date de départ exclus');

  const el = A.elementsAbsences(d(), { jusqua: '2026-10', ...sansEmis });
  const de = (id: number) => el.filter(x => x.absence === id).map(x => [x.mois, x.periode, x.rubrique, x.quantite]);
  // Le 10 octobre, septembre est clos : ses jours partent en rappel sur octobre.
  assert.deepEqual(de(cp), [['2026-09', '2026-10', 'CP', 1.5], ['2026-10', '2026-10', 'CP', 1.5]]);
  assert.deepEqual(de(at), [['2026-10', '2026-10', 'ABS_IND_SANTE', 6]]);
  assert.deepEqual(de(recup), [['2026-10', '2026-10', 'RECUP', 3.5]]);
  assert.deepEqual(de(interim), []);
  assert.ok(!el.some(x => x.empId === 20), 'absence signalée, à qualifier : rien');
  assert.ok(!el.some(x => d().ds.absences.find(a => a.id === x.absence)!.statut === 'demandee'), 'demande en attente : rien');
  assert.equal(el.find(x => x.absence === cp)!.matricule, '004101', 'matricule de paie');
  // Novembre : le lot de novembre emporte ses jours.
  assert.deepEqual(A.elementsAbsences(d(), { jusqua: '2026-11', ...sansEmis }).filter(x => x.absence === at).map(x => x.quantite), [6, 4]);
  // Résumé par période (écran Temps) et par lot.
  const groupes = A.absencesParPeriode(el);
  const oct = groupes.find(g => g.periode === '2026-10')!;
  assert.deepEqual([oct.rappels, oct.regularisations, oct.empIds.includes(1)], [['2026-09'], 0, true]);
  assert.ok(oct.rubriques.includes('CP') && oct.rubriques.includes('ABS_IND_SANTE'));
  assert.deepEqual(A.absencesDuLot(groupes, '2026-09').absences, 0);
  assert.equal(A.detailElement(el.find(x => x.absence === cp && x.mois === '2026-09')!, p => p), 'Absence n° ' + cp + ', du 29/09/2026 au 30/09/2026 · rappel de 2026-09');
});

test('t028 écart avec les lots : déjà parti, réservé, prolongé, annulé ou requalifié (régularisation)', () => {
  const { db, d } = fresh();
  const at = inserer(db, { empId: 10, type: 'AT', du: '2026-10-26', au: '2026-10-31', statut: 'validee' });
  const premier = A.elementsAbsences(d(), { jusqua: '2026-10', ...sansEmis }).filter(x => x.absence === at);
  assert.deepEqual(premier.map(x => [x.rubrique, x.quantite]), [['ABS_IND_SANTE', 6]]);
  const emis = premier;
  const avec = (o: Partial<Parameters<typeof A.elementsAbsences>[1]> = {}) =>
    A.elementsAbsences(d(), { jusqua: '2026-11', emis, reservees: new Set(), depuis: null, ...o }).filter(x => x.absence === at).map(x => [x.mois, x.rubrique, x.quantite]);
  assert.deepEqual(avec(), [], 'déjà parti : rien de plus');
  // Prolongée : seuls les nouveaux jours partent.
  db.update('absences', at, { au: '2026-11-03' });
  assert.deepEqual(avec(), [['2026-11', 'ABS_IND_SANTE', 3]]);
  // Réservée par un lot à confirmer : attend sa confirmation ou son annulation.
  assert.deepEqual(avec({ reservees: new Set([at]) }), []);
  // Raccourcie : régularisation négative du mois.
  db.update('absences', at, { au: '2026-10-28' });
  assert.deepEqual(avec(), [['2026-10', 'ABS_IND_SANTE', -3]]);
  // Requalifiée (mariage, jours ouvrés) : la rubrique partie est reprise, la nouvelle part.
  db.update('absences', at, { type: 'MARIAGE', au: '2026-10-31' });
  assert.deepEqual(avec(), [['2026-10', 'ABS_MAINT_FAMILLE', 5], ['2026-10', 'ABS_IND_SANTE', -6]]);
  // Repassée « à qualifier » après une prolongation signalée : attend la qualification.
  db.update('absences', at, { statut: 'signalee' });
  assert.deepEqual(avec(), []);
  // Annulée : tout ce qui est parti est repris.
  db.update('absences', at, { statut: 'annulee' });
  const reg = A.elementsAbsences(d(), { jusqua: '2026-11', emis, reservees: new Set(), depuis: null }).filter(x => x.absence === at);
  assert.deepEqual(reg.map(x => [x.periode, x.rubrique, x.quantite]), [['2026-10', 'ABS_IND_SANTE', -6]]);
  assert.match(A.detailElement(reg[0], p => p), /· régularisation \(absence annulée, raccourcie ou requalifiée après transmission\)$/);
  assert.equal(A.absencesParPeriode(reg)[0].regularisations, 1);
});

test('t028 fichier : absences ventilées, régularisation négative, rubrique désactivée absente, résumé séparé', () => {
  const contenu = {
    lignes: [{ matricule: '004101', semaine: '2026-S41', periode: '2026-10', rubriques: { HN: 35 } }],
    absences: [
      { absence: 1, empId: 1, matricule: '004101', mois: '2026-09', periode: '2026-10', rubrique: 'CP', codeSage: 'CP', quantite: 1.5, du: '2026-09-29', au: '2026-09-30' },
      { absence: 1, empId: 1, matricule: '004101', mois: '2026-10', periode: '2026-10', rubrique: 'CP', codeSage: 'CP', quantite: 1.5, du: '2026-10-01', au: '2026-10-02' },
      { absence: 2, empId: 2, matricule: '004102', mois: '2026-10', periode: '2026-10', rubrique: 'ABS_IND_SANTE', codeSage: '5100', quantite: -2, du: '2026-10-05', au: '2026-10-06' },
      { absence: 3, empId: 2, matricule: '004102', mois: '2026-10', periode: '2026-10', rubrique: 'ABS_NP', codeSage: null, quantite: 1, du: '2026-10-07', au: '2026-10-07' },
    ] satisfies Element[],
  };
  assert.deepEqual(L.lignesFichier(contenu), [
    { matricule: '004101', periode: '2026-10', rubrique: 'CP', quantite: 3 },
    { matricule: '004101', periode: '2026-10', rubrique: 'HN', quantite: 35 },
    { matricule: '004102', periode: '2026-10', rubrique: '5100', quantite: -2 },
  ]);
  assert.match(L.fichierLot(contenu), /004102;2026-10;5100;-2\r\n$/);
  assert.deepEqual(L.resumeContenu(contenu), {
    lignes: 3, salaries: 2, rubriques: { HN: 35 },
    absences: { elements: 4, salaries: 2, rubriques: { CP: 3, 5100: -2 } },
  });
  assert.deepEqual(Object.keys(L.libellesSage(contenu, [])), ['5100', 'CP', 'HN']);
});

// — Cycle d'un lot —

test('t028 lot de fichier : absences réservées, libérées à l’annulation, marquées transmises à la confirmation, régularisées ensuite', async () => {
  const { db, run, refus, lots, journal, absence, d, compteDe, ADMIN, PAIE, GEST } = fresh();
  for (const code of Object.keys(RUBRIQUES_PAIE)) run(ADMIN, 'paie.rubrique', { code, confirmer: true });
  const oct = d().ds.absences.filter(a => a.statut === 'validee' && a.du < '2026-11-01' && A.rubriqueAbsence(a.type));
  assert.equal(oct.length, 5, 'CP, RTT et arrêt maladie validés d’octobre');
  const modeAvant = process.env.SAGE_MODE;
  process.env.SAGE_MODE = 'fichier';
  try {
    // Codes à confirmer : une rubrique d'absence non confirmée bloque le lot réel.
    run(ADMIN, 'paie.rubrique', { code: 'ABS_IND_SANTE', confirmer: false });
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 409, /pour la rubrique ABS_IND_SANTE \(Absence indemnisée, santé/);
    run(ADMIN, 'paie.rubrique', { code: 'ABS_IND_SANTE', codeSage: '5100', confirmer: true });

    assert.match(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), / · 5 absences$/);
    const lot = lots().at(-1)!;
    assert.deepEqual(lot.absences!.map(a => a.id).sort(), oct.map(a => a.id).sort());
    assert.ok(oct.every(a => absence(a.id).lotId === lot.id && !absence(a.id).sage), 'réservées, pas transmises');
    const sante = lot.contenu!.absences!.find(x => x.rubrique === 'ABS_IND_SANTE')!;
    assert.deepEqual([sante.codeSage, sante.quantite, sante.empId], ['5100', 3, 13], 'code Sage figé ; arrêt de 3 jours calendaires');
    assert.ok(lot.resume.absences && lot.resume.absences.rubriques['5100'] === 3);
    assert.ok(lot.periodes.includes('2026-10'));
    // Rien de plus à émettre tant que le lot attend sa confirmation.
    assert.deepEqual(buildSnapshot(db, PAIE).absencesPaie, []);
    // Journal : identifiants des absences, salariés concernés, jamais la nature ni la rubrique.
    const g = journal('paie.lotGenerer').at(-1)!;
    assert.deepEqual(g.payload.absences.sort(), oct.map(a => a.id).sort());
    assert.ok(g.salaries.includes(13));
    assert.ok(!/MALADIE|ABS_|maladie|arrêt/.test(JSON.stringify(g)), JSON.stringify(g));

    // Fichier : lignes d'absence avec les heures, téléchargement tracé avec les salariés des absences.
    const app = express();
    app.get('/essai/session/:compte', (req, res) => { openSession(db, res, { compteId: Number(req.params.compte), role: 'rh', methode: 'demo' }); res.end(); });
    app.use(routesFichierPaie(db));
    const srv = app.listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    try {
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const cookie = (await fetch(`${base}/essai/session/${compteDe(7)}`)).headers.get('set-cookie')!.split(';')[0];
      const texte = await (await fetch(`${base}/api/paie/lots/${lot.id}/fichier`, { headers: { cookie } })).text();
      assert.match(texte, /\r\n004113;2026-10;5100;3\r\n/);
      assert.match(texte, /\r\n004108;2026-10;CP;5\r\n/);
      assert.ok(journal('sage.fichier').at(-1)!.salaries.includes(13));
    } finally {
      await new Promise(r => srv.close(r));
    }

    // Annulation : absences libérées, de nouveau en attente.
    assert.match(run(PAIE, 'paie.lotAnnuler', { id: lot.id }), /et 5 absences libérées/);
    assert.ok(oct.every(a => absence(a.id).lotId === null));
    assert.equal(buildSnapshot(db, PAIE).absencesPaie!.find(x => x.periode === '2026-10')!.absences, 5);

    // Nouveau lot, confirmé : absences marquées transmises.
    run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
    const second = lots().at(-1)!;
    db.update('lotsPaie', second.id, { telechargements: 1 });
    assert.match(run(PAIE, 'paie.lotConfirmer', { id: second.id }), /— \d+ feuilles marquées transmises · 5 absences$/);
    assert.ok(oct.every(a => absence(a.id).sage && absence(a.id).lotId === second.id));
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 400, /^Aucune feuille validée en attente pour octobre 2026, ni absence$/);

    // CP annulé après sa transmission : le service RH est prévenu, la régularisation part dans un lot sans feuille.
    const cp = oct.find(a => a.empId === 14)!;
    assert.match(run(ADMIN, 'absence.annuler', { id: cp.id }), /déjà transmise à la paie : l’écart partira dans le prochain lot de paie \(régularisation\)$/);
    const attente = buildSnapshot(db, PAIE).absencesPaie!;
    assert.deepEqual(attente.map(x => [x.periode, x.absences, x.regularisations]), [['2026-10', 1, 1]]);
    assert.match(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /^Lot n° \d+ généré — 0 feuille \(1 salarié\), octobre 2026 .* · 1 absence, dont 1 régularisation$/);
    const troisieme = lots().at(-1)!;
    assert.deepEqual(troisieme.contenu!.absences!.map(x => [x.absence, x.rubrique, x.quantite]), [[cp.id, 'CP', -5]]);
    assert.equal(L.fichierLot(troisieme.contenu!).split('\r\n')[1], '004114;2026-10;CP;-5');
    // Absence d'un lot à confirmer modifiée : le message propose de régénérer le lot.
    const rtt = oct.find(a => a.empId === 16)!;
    db.update('absences', rtt.id, { lotId: troisieme.id });
    assert.match(run(ADMIN, 'absence.annuler', { id: rtt.id }), /comprise dans le lot de paie n° \d+, import à confirmer : annulez-le puis générez-le de nouveau/);
    refus(GEST, 'paie.lotAnnuler', { id: troisieme.id }, 403);
  } finally {
    if (modeAvant === undefined) delete process.env.SAGE_MODE; else process.env.SAGE_MODE = modeAvant;
  }
});

test('t028 réglage désactivé : le fichier se limite aux heures ; rubrique désactivée : la nature reste à Sage, sans repartir', () => {
  const { db, run, lots, d, ADMIN, PAIE } = fresh();
  assert.equal(d().ds.settings.absencesFichierPaie, true, 'activé par défaut');
  run(ADMIN, 'parametres.maj', { absencesFichierPaie: false });
  assert.deepEqual(buildSnapshot(db, ADMIN).absencesPaie, []);
  assert.doesNotMatch(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /absence/);
  assert.equal(lots().at(-1)!.contenu!.absences, undefined);
  assert.deepEqual(lots().at(-1)!.absences, []);
  run(PAIE, 'paie.lotAnnuler', { id: lots().at(-1)!.id });
  // Réactivé, avec la rubrique CP désactivée : l'élément est emporté sans code Sage, absent du fichier.
  run(ADMIN, 'parametres.maj', { absencesFichierPaie: true });
  run(ADMIN, 'paie.rubrique', { code: 'CP', active: false });
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = lots().at(-1)!;
  assert.ok(lot.contenu!.absences!.some(x => x.rubrique === 'CP' && x.codeSage === null));
  assert.ok(!L.lignesFichier(lot.contenu!).some(l => l.rubrique === 'CP'));
  run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  // Rubrique réactivée : les CP déjà emportés ne repartent pas (saisis dans Sage par la paie).
  run(ADMIN, 'paie.rubrique', { code: 'CP', active: true });
  assert.deepEqual(buildSnapshot(db, PAIE).absencesPaie, []);
});

test('t028 simulation en un clic : feuilles et absences dans le même lot transmis', () => {
  const { run, lots, absence, PAIE } = fresh();
  assert.match(run(PAIE, 'temps.pushSage', {}), / · 5 absences$/);
  const lot = lots().at(-1)!;
  assert.equal(lot.statut, 'transmis');
  assert.ok(lot.absences!.every(a => absence(a.id).sage));
});

// — Données transmises —

test('t028 instantanés : absences en attente et codes réservés à la paie ; rien hors du service RH', () => {
  const { db, run, user, PAIE, ADMIN, GEST, LECTURE, KARIM } = fresh();
  const rubriques = (u: User) => buildSnapshot(db, u).absencesPaie!.flatMap(g => g.rubriques);
  assert.ok(rubriques(ADMIN).includes('ABS_IND_SANTE') && rubriques(PAIE).includes('CP'));
  assert.equal(buildSnapshot(db, GEST).absencesPaie![0].absences, 5, 'gestionnaire RH : le nombre');
  assert.deepEqual(rubriques(GEST), [], 'gestionnaire RH : sans rubrique (catégorie de la nature)');
  assert.deepEqual(rubriques(LECTURE), [], 'lecture seule : sans rubrique');
  assert.equal(buildSnapshot(db, LECTURE).absencesPaie![0].absences, 5);
  for (const u of [KARIM, user(2, 'collaborateur'), user(23, 'rh')]) assert.deepEqual(buildSnapshot(db, u).absencesPaie, []);
  run(PAIE, 'temps.pushSage', {});
  // Lot : totaux des absences par code Sage pour la paie seulement.
  assert.ok(Object.keys(buildSnapshot(db, PAIE).lotsPaie[0].resume.absences!.rubriques).length > 0);
  assert.deepEqual(buildSnapshot(db, GEST).lotsPaie[0].resume.absences!.rubriques, {});
  assert.deepEqual(buildSnapshot(db, LECTURE).lotsPaie[0].resume.absences!.rubriques, {});
  assert.equal(buildSnapshot(db, LECTURE).lotsPaie[0].resume.absences!.elements, 5);
  // Lot et indicateur de transmission d'une absence : service RH et paie ; ni le manager, ni l'intéressé, ni le référent HSE.
  assert.ok(buildSnapshot(db, PAIE).absences.some(a => a.sage && a.lotId));
  assert.ok(buildSnapshot(db, ADMIN).absences.some(a => a.sage && a.lotId));
  for (const u of [KARIM, user(8, 'collaborateur'), user(23, 'rh')]) {
    assert.ok(buildSnapshot(db, u).absences.every(a => !a.sage && a.lotId == null), u.nom);
  }
});

// — Migration —

test('t028 migration lot5-paie-absences-anterieures : jours des périodes passées laissés à Sage, une fois, tracé', () => {
  // Base reprise (fichier rouvert : plus neuve), dont les absences validées n'ont jamais eu de date de départ.
  const dir = mkdtempSync(join(tmpdir(), 'cursus-absences-paie-'));
  try {
    const premiere = new Db(join(dir, 'cursus.db'));
    seedDemo(premiere);
    premiere.sql.close();
    migrationReprise(new Db(join(dir, 'cursus.db')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function migrationReprise(db: Db) {
  const { d, journal } = fresh(db, false);
  assert.equal(db.neuve, false);
  const avant = inserer(db, { empId: 1, type: 'CP', du: '2026-09-21', au: '2026-09-25', statut: 'validee' });
  // La date n'est pas posée ; une base neuve n'en a pas besoin (rien à reprendre).
  assert.equal(lireDepuis(db), null);
  assert.equal(ABSENCES_ANTERIEURES.necessaire!(db), true);
  const neuve = new Db(':memory:');
  assert.equal(ABSENCES_ANTERIEURES.necessaire!(neuve), true);
  assert.equal(ABSENCES_ANTERIEURES.executer(neuve), undefined, 'base neuve : sans effet');
  assert.equal(lireDepuis(neuve), null);
  assert.ok(A.elementsAbsences(d(), { jusqua: '2026-10', ...sansEmis }).some(x => x.absence === avant), 'sans la date : septembre en rappel');
  assert.match(String(ABSENCES_ANTERIEURES.executer(db)), /à partir du 2026-10-01/);
  assert.equal(db.getSetting(CLE_DEPUIS, null), '2026-10-01');
  assert.equal(ABSENCES_ANTERIEURES.necessaire!(db), false, 'une seule fois');
  const m = journal('migration.absencesPaie').at(-1)!;
  assert.deepEqual(m.payload, { depuis: '2026-10-01', absences: 1 });
  assert.ok(m.paie && estActionPaie('migration.absencesPaie') && JOURNAL_LABEL['migration.absencesPaie']);
  assert.equal(familleAction('migration.absencesPaie')?.id, 'temps');
  // Le lot ne reprend plus septembre.
  assert.ok(!absencesAEmettre(db, d(), '2026-10').some(x => x.absence === avant));
  db.sql.close();
}

// — Export des variables de la période —

test('t028 variables de la période : lots et attente, droit « paie », tracé sans nature', async () => {
  const { db, run, journal, compteDe, ADMIN, PAIE } = fresh();
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  run(ADMIN, 'absence.saisir', { empId: 1, nature: 'MALADIE', du: '2026-10-08', au: '2026-10-09', justificatif: false });
  const lignes = variablesDeLaPeriode(db, PAIE, '2026-10');
  assert.ok(lignes.some(l => l.lot.startsWith('n° ') && l.etat === 'Import à confirmer' && l.rubrique === 'HN'));
  assert.ok(lignes.some(l => l.lot.startsWith('n° ') && l.rubrique === 'CP' && /^Absence n° \d+, du 19\/10\/2026 au 23\/10\/2026$/.test(l.detail)));
  const attente = lignes.filter(l => l.etat === 'En attente d’un lot');
  assert.deepEqual(attente.map(l => [l.matricule, l.rubrique, l.quantite]), [['004101', 'ABS_IND_SANTE', 2]]);
  assert.ok(lignes.every(l => !/maladie|arrêt/i.test(l.detail)), 'jamais la nature dans le détail');
  assert.ok(lignes.some(l => /^Semaine 2026-S\d\d/.test(l.detail)));
  const csv = csvVariables(lignes);
  assert.ok(csv.startsWith('﻿Matricule de paie;Salarié;Rubrique Sage;Libellé;Quantité;Détail;Lot;État\r\n'));

  const app = express();
  app.get('/essai/session/:compte', (req, res) => { openSession(db, res, { compteId: Number(req.params.compte), role: 'rh', methode: 'demo' }); res.end(); });
  app.use(routesVariablesPaie(db));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const session = async (compte: number) => (await fetch(`${base}/essai/session/${compte}`)).headers.get('set-cookie')!.split(';')[0];
    const get = (p: string, cookie?: string) => fetch(`${base}/api/paie/variables/${p}`, { headers: cookie ? { cookie } : {} });
    assert.equal((await get('2026-10')).status, 401);
    assert.equal((await get('2026-10', await session(compteDe(14)))).status, 403, 'gestionnaire RH : pas de droit « paie »');
    assert.equal(journal('acces.refuse').at(-1)!.message, 'Variables de paie de la période — réservé à l’administrateur RH et au gestionnaire de paie');
    const paie = await session(compteDe(7));
    assert.equal((await get('2026-13', paie)).status, 400);
    const r = await get('2026-10', paie);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="variables-paie-2026-10.csv"');
    assert.match(await r.text(), /;ABS_IND_SANTE;.*;2;Absence n° \d+, du 08\/10\/2026 au 09\/10\/2026;;En attente d’un lot/);
    const t = journal('sage.variables').at(-1)!;
    assert.deepEqual([t.payload.periode, t.payload.lignes, t.paie], ['2026-10', lignes.length, true]);
    assert.ok(t.salaries.includes(1) && t.salaries.includes(13));
    assert.match(t.message!, /^Variables de paie d’octobre 2026 exportées — \d+ lignes$/);
    assert.ok(!/ABS_|maladie/i.test(JSON.stringify(t)));
    assert.ok(JOURNAL_LABEL['sage.variables'] && estActionPaie('sage.variables'));
  } finally {
    await new Promise(r => srv.close(r));
  }
});

// — Confirmations —

test('t028 confirmations : absences, régularisations et rappels annoncés avant de générer', () => {
  const g = C.generationLot({
    periode: '2026-10', feuilles: 3, salaries: 4, mode: 'fichier', sansMatricule: [], rappels: [],
    perimetre: L.perimetreFichier(true), absences: { absences: 2, regularisations: 1, rappels: ['2026-09'] },
  });
  assert.equal(g.question, 'Générer le lot d’octobre 2026 : 3 feuilles validées, 2 absences (4 salariés) ?');
  assert.ok(g.suites!.some(x => /^Absences validées : 2 absences, .*dont 1 régularisation .* ; rappel de septembre 2026, période close\.$/.test(x)));
  assert.ok(g.suites!.includes(A.PERIMETRE_FICHIER_ABSENCES));
  const a = C.annulationLot({ id: 4, periode: '2026-10', feuilles: [], telechargements: 0, absences: [{ id: 1, empId: 1 }] });
  assert.deepEqual(a.suites, ['1 absence redevient en attente.']);
  assert.ok(C.transmissionSage(2, 1, [], L.perimetreFichier(true), { absences: 1, regularisations: 0, rappels: [] }).suites!.some(x => x.startsWith('Absences validées : 1 absence')));
});
