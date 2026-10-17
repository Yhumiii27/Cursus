// Solde de sortie (lot 5, chantier I, étape 2 : t128) : état des compteurs à la date de sortie (CP de la période acquise
// et en cours d'acquisition, RTT au prorata, récupération, CET), sortie en cours de période et demi-journées, absences
// postérieures ignorées, trop-pris de RTT signalé sans retenue ; photographie à l'enregistrement de la sortie, refaite à
// sa modification, retirée à son annulation, gardée une fois transmise ; rubriques de sortie désactivées par défaut,
// émises dans le lot du mois de la sortie quand elles sont actives (code Sage à confirmer pour un lot réel), réservation,
// libération et marquage comme les absences ; instantanés par profil ; impression et export CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { variablesDeLaPeriode } = await import('../server/src/variables-paie.ts');
const { REFERENCES } = await import('../server/src/integrite.ts');
const { Domain } = await import('../shared/domain.ts');
const S = await import('../shared/rules/solde-sortie.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { cpInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { rubriquesPaie } = await import('../shared/rules/paie.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const X = await import('../client/src/solde-sortie.ts');
const C = await import('../client/src/state/confirmations.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;
type Solde = import('../shared/types.ts').SoldeSortie;
type Lot = ReturnType<typeof loadFull>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Ligne = { action: string; message: string | null; payload: Record<string, any>; salaries: number[] };

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
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
  const solde = (empId: number) => db.where<Solde>('soldesSortie', 'empId', empId)[0];
  const lots = () => db.all<Lot>('lotsPaie');
  const journal = (action: string) => db.all<Ligne>('journal').filter(l => l.action === action);
  return { db, user, run, refus, d, solde, lots, journal, ADMIN, PAIE: user(7, 'rh'), GEST: user(14, 'rh'), LECTURE: user(11, 'rh') };
}
const inserer = (db: Db, a: Record<string, unknown>) => db.insert<{ id: number }>('absences', { keystone: false, justificatif: false, ...a }).id;

// — Calcul —

test('t128 sortie en cours de période : CP acquis jusqu’au mois de la sortie (mi-mois), RTT au prorata, absences postérieures ignorées', () => {
  const { db, d } = fresh();
  const mehdi = d().emp(2)!;
  const fin = S.etatSortie(d(), mehdi, '2026-10-31'), debut = S.etatSortie(d(), mehdi, '2026-10-10');
  // Période acquise 2025-2026 : celle du jour (cpInfo), reports compris ; période 2026-2027 en cours d'acquisition.
  const ci = cpInfo(d(), mehdi)!;
  assert.equal(fin.cp!.periode, 2026);
  assert.equal(fin.cp!.droit, ci.droit);
  // Sous contrat à la mi-octobre : juin à octobre, 5 mois de 25/12 ; sortie le 10 octobre : octobre ne compte pas.
  assert.equal(fin.cp!.acquis, 10.42);
  assert.equal(debut.cp!.acquis, 8.33);
  assert.equal(fin.cp!.total, Math.round((fin.cp!.solde + fin.cp!.soldeEnCours) * 100) / 100);
  // RTT 39 h : 23 jours par an, au prorata des mois sous contrat à la mi-mois (10 mois, 9 mois).
  assert.equal(fin.rtt!.droit, Math.round(23 * 10 / 12));
  assert.equal(debut.rtt!.droit, Math.round(23 * 9 / 12));
  assert.equal(fin.rtt!.pris, rttInfo(d(), mehdi)!.pris);
  assert.ok(fin.recup && fin.cet, 'récupération (heures) et CET de Mehdi');
  assert.equal(fin.cet!.total, 4);
  // Un congé postérieur à la date ne compte pas : la sortie l'annule.
  inserer(db, { empId: 2, type: 'CP', du: '2026-11-02', au: '2026-11-06', statut: 'validee' });
  assert.deepEqual(S.etatSortie(d(), d().emp(2)!, '2026-10-31').cp, fin.cp);
  // Lignes de l'état et rubriques : CP à indemniser, RTT, récupération, CET ; quantités positives seulement.
  assert.deepEqual(S.quantitesSortie(fin).map(q => q.rubrique), ['ICCP_J', 'RTT_SOLDE', 'RECUP_H', 'CET_LIQ']);
  assert.deepEqual(S.lignesEtat(fin).filter(l => l.rubrique).map(l => l.rubrique), ['ICCP_J', 'RTT_SOLDE', 'RECUP_H', 'CET_LIQ']);
  assert.match(S.resumeEtat(fin), /^CP à indemniser 17,42 j · RTT 3 j · récupération 3,5 h · CET 4 j$/);
});

test('t128 demi-journées : CP et RTT posés à la demi-journée décomptés 0,5 dans le solde de sortie', () => {
  const { db, d } = fresh();
  const avant = S.etatSortie(d(), d().emp(2)!, '2026-10-31');
  // CP du lundi 19 octobre après-midi au mardi 20 matin : une journée ; RTT le mercredi 21 au matin : une demi-journée.
  inserer(db, { empId: 2, type: 'CP', du: '2026-10-19', au: '2026-10-20', statut: 'validee', debutDemi: 'apres_midi', finDemi: 'matin' });
  inserer(db, { empId: 2, type: 'RTT', du: '2026-10-21', au: '2026-10-21', statut: 'validee', debutDemi: 'matin' });
  const apres = S.etatSortie(d(), d().emp(2)!, '2026-10-31');
  assert.equal(apres.cp!.pris - avant.cp!.pris, 1);
  assert.equal(apres.cp!.total, Math.round((avant.cp!.total - 1) * 100) / 100);
  assert.equal(apres.rtt!.pris - avant.rtt!.pris, 0.5);
  assert.equal(apres.rtt!.solde, avant.rtt!.solde - 0.5);
  // Demande de demi-journée encore en attente avant la sortie : comptée comme posée, signalée.
  inserer(db, { empId: 2, type: 'CP', du: '2026-10-23', au: '2026-10-23', statut: 'demandee', debutDemi: 'apres_midi' });
  const attente = S.etatSortie(d(), d().emp(2)!, '2026-10-31');
  assert.equal(attente.cp!.poses - apres.cp!.poses, 0.5);
  assert.ok(attente.avertissements.some(a => /^Demande de congé .* en attente : comptée comme posée/.test(a)));
});

test('t128 RTT au-delà du droit au prorata : trop-pris signalé, sans retenue (aucune ligne RTT_SOLDE)', () => {
  const { d } = fresh();
  // Sortie le 20 juin : 6 mois de droit (12 jours) pour 16 jours pris.
  const e = S.etatSortie(d(), d().emp(2)!, '2026-06-20');
  assert.equal(e.rtt!.droit, 12);
  assert.ok(e.rtt!.solde < 0 && e.rtt!.tropPris === -e.rtt!.solde);
  assert.ok(e.avertissements.some(a => /pris au-delà du droit au prorata .* sans retenue automatique/.test(a)));
  assert.ok(!S.quantitesSortie(e).some(q => q.rubrique === 'RTT_SOLDE'));
  assert.match(S.lignesEtat(e).find(l => l.rubrique === 'RTT_SOLDE')!.libelle, /trop-pris, sans retenue/);
  // Intérimaire : aucun compteur géré par Cursus.
  const interim = d().ds.employes.find(x => x.typeContrat === 'interim');
  if (interim) {
    const t = S.etatSortie(d(), interim, '2026-10-31');
    assert.deepEqual([t.cp, t.rtt, t.cet], [null, null, null]);
  }
});

// — Photographie —

test('t128 photographie : à l’enregistrement, figée malgré une correction, refaite à la modification, retirée à l’annulation', () => {
  const { db, run, d, solde, journal, ADMIN } = fresh();
  const attendu = S.etatSortie(d(), d().emp(2)!, '2026-10-16');
  const m = run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' });
  assert.match(m, / · solde de sortie photographié : CP à indemniser [\d,]+ j · RTT/);
  const s = solde(2);
  assert.deepEqual([s.date, s.lotId, s.sage, s.par], ['2026-10-16', null, false, ADMIN.nom]);
  assert.deepEqual(s.etat, attendu, 'état calculé avant la sortie, absences postérieures annulées');
  assert.equal(journal('employe.sortie').at(-1)!.payload.soldeSortie, s.id);
  // Correction ultérieure (un congé du 12 octobre validé après coup) : la photographie ne bouge pas.
  inserer(db, { empId: 2, type: 'CP', du: '2026-10-12', au: '2026-10-12', statut: 'validee' });
  assert.deepEqual(solde(2).etat, attendu);
  assert.notDeepEqual(S.etatSortie(d(), d().emp(2)!, '2026-10-16').cp, attendu.cp, 'le calcul du jour, lui, change');
  // Modification de la sortie : nouvelle photographie, même ligne.
  run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' });
  assert.equal(solde(2).id, s.id);
  assert.equal(solde(2).etat.cp!.pris, attendu.cp!.pris + 1);
  // Annulation de la sortie : photographie retirée.
  assert.match(run(ADMIN, 'employe.annulerSortie', { id: 2 }), / · solde de sortie photographié retiré$/);
  assert.equal(solde(2), undefined);
});

// — Lot de paie —

test('t128 lot de paie : rubriques de sortie désactivées par défaut, émises une fois actives, réservées, libérées, transmises', () => {
  const { db, run, refus, d, solde, lots, journal, ADMIN, PAIE } = fresh();
  run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' });
  const s = solde(2);
  // Par défaut : rien ne part, le solde est à saisir dans Sage.
  const table = rubriquesPaie(d().ds.rubriquesPaie);
  assert.deepEqual(S.elementsSorties(d(), '2026-10', table), []);
  assert.equal(S.etatTransmission(s, table, d().ti), 'à saisir dans Sage (rubriques de sortie désactivées)');
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  assert.equal(lots().at(-1)!.contenu!.sorties, undefined);
  assert.equal(solde(2).lotId, null);
  run(PAIE, 'paie.lotAnnuler', { id: lots().at(-1)!.id });

  // CP à indemniser et CET actifs (codes Sage saisis) ; RTT et récupération restent à Sage.
  run(PAIE, 'paie.rubrique', { code: 'ICCP_J', codeSage: '6100', active: true, confirmer: true });
  run(PAIE, 'paie.rubrique', { code: 'CET_LIQ', codeSage: '6400', active: true });
  const t2 = rubriquesPaie(d().ds.rubriquesPaie);
  assert.match(S.etatTransmission(solde(2), t2, d().ti), /^en attente du lot de paie de 2026-10 ; 2 compteurs à saisir dans Sage/);
  // Lot de septembre : la sortie d'octobre n'y part pas.
  assert.deepEqual(S.elementsSorties(d(), '2026-09', t2), []);
  const els = S.elementsSorties(d(), '2026-10', t2);
  assert.deepEqual(els.map(x => [x.rubrique, x.codeSage, x.periode, x.quantite]), [['ICCP_J', '6100', '2026-10', s.etat.cp!.total], ['CET_LIQ', '6400', '2026-10', 4]]);
  // Confirmation du lot annoncée avant de générer.
  assert.match(C.generationLot({ periode: '2026-10', feuilles: 3, salaries: 2, rappels: [], mode: 'simulation', sansMatricule: [], sorties: 1 }).question, /, 1 solde de sortie \(2 salariés\)/);

  // Lot réel : un code Sage à confirmer bloque (CET_LIQ).
  for (const code of Object.keys(RUBRIQUES_PAIE).filter(c => !['CET_LIQ', 'RTT_SOLDE', 'RECUP_H'].includes(c))) run(ADMIN, 'paie.rubrique', { code, confirmer: true });
  const modeAvant = process.env.SAGE_MODE;
  process.env.SAGE_MODE = 'fichier';
  try {
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 409, /pour la rubrique CET_LIQ \(Compte épargne-temps liquidé/);
  } finally {
    if (modeAvant === undefined) delete process.env.SAGE_MODE; else process.env.SAGE_MODE = modeAvant;
  }

  // Simulation : le lot emporte le solde, réservé ; fichier avec ses lignes.
  assert.match(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), / · 1 solde de sortie$/);
  const lot = lots().at(-1)!;
  assert.deepEqual(lot.sorties, [{ id: s.id, empId: 2 }]);
  assert.deepEqual(lot.resume.sorties, { elements: 2, salaries: 1 });
  assert.equal(solde(2).lotId, lot.id);
  const mat = lot.contenu!.sorties![0].matricule;
  const texte = L.fichierLot(lot.contenu!);
  assert.ok(texte.includes(`\r\n${mat};2026-10;6100;${String(s.etat.cp!.total).replace('.', ',')}\r\n`), texte);
  assert.ok(texte.includes(`\r\n${mat};2026-10;6400;4\r\n`));
  assert.equal(lot.contenu!.libelles!['6100'], RUBRIQUES_PAIE.ICCP_J.label);
  assert.deepEqual(journal('paie.lotGenerer').at(-1)!.payload.sorties, [s.id]);
  assert.ok(journal('paie.lotGenerer').at(-1)!.salaries.includes(2));
  // Variables de la période : lignes de sortie du lot.
  assert.ok(variablesDeLaPeriode(db, PAIE, '2026-10').some(v => v.rubrique === '6100' && v.detail === 'Solde de sortie au 16/10/2026'));
  // Sortie figée tant que le lot attend sa confirmation.
  refus(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' }, 409, /compris dans le lot de paie n° \d+, import à confirmer/);
  refus(ADMIN, 'employe.annulerSortie', { id: 2 }, 409);
  // Annulation du lot : solde libéré.
  assert.match(run(PAIE, 'paie.lotAnnuler', { id: lot.id }), /et 1 solde de sortie libéré/);
  assert.equal(solde(2).lotId, null);

  // Nouveau lot, confirmé : solde transmis, gardé tel quel ensuite.
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const second = lots().at(-1)!;
  run(PAIE, 'paie.lotConfirmer', { id: second.id });
  assert.deepEqual([solde(2).lotId, solde(2).sage], [second.id, true]);
  assert.equal(S.etatTransmission(solde(2), t2, d().ti), `transmis à la paie (lot n° ${second.id})`);
  assert.deepEqual(S.elementsSorties(d(), '2026-12', t2), []);
  const avant = solde(2);
  assert.match(run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' }), /solde de sortie déjà transmis à la paie \(lot n° \d+\) : gardé tel quel/);
  assert.deepEqual(solde(2), avant);
  assert.match(run(ADMIN, 'employe.annulerSortie', { id: 2 }), /solde de sortie déjà transmis à la paie \(lot n° \d+\) : à corriger dans Sage$/);
  assert.ok(solde(2), 'gardé pour l’historique');
});

test('t128 période : mois de la sortie, ou la période ouverte s’il est clos', () => {
  assert.equal(S.periodeSortie('2026-10-16', '2026-10-10'), '2026-10');
  assert.equal(S.periodeSortie('2026-09-30', '2026-10-10'), '2026-10');
  assert.equal(S.periodeSortie('2026-12-31', '2026-10-10'), '2026-12');
});

// — Données transmises —

test('t128 instantanés : soldes de sortie au service RH, à la paie et à la lecture seule seulement ; intégrité et export des données', () => {
  const { db, run, user, ADMIN, PAIE, GEST, LECTURE } = fresh();
  run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' });
  for (const u of [ADMIN, PAIE, GEST, LECTURE]) assert.equal(buildSnapshot(db, u).soldesSortie!.length, 1, u.nom);
  for (const u of [user(23, 'rh'), user(12, 'manager'), user(2, 'collaborateur')]) assert.deepEqual(buildSnapshot(db, u).soldesSortie, [], u.nom);
  assert.ok(REFERENCES.some(r => r.table === 'soldes_sortie' && r.colonne === 'emp_id'));
  assert.ok(REFERENCES.some(r => r.table === 'soldes_sortie' && r.colonne === 'lot_id'));
});

// — Impression et export —

test('t128 état imprimable et export CSV : compteurs, rubriques, source, jamais le montant', () => {
  const { run, d, ADMIN } = fresh();
  run(ADMIN, 'employe.sortie', { id: 2, date: '2026-10-16', motif: 'demission' });
  const dd = d(), e = dd.emp(2)!, solde = dd.ds.soldesSortie!.find(s => s.empId === 2)!;
  const csv = X.csvSoldeSortie(dd, e, { etat: solde.etat, solde });
  assert.equal(csv.fichier, 'solde-sortie-EMP-0002-2026-10-16.csv');
  assert.deepEqual(csv.head.slice(4, 11), ['Compteur', 'Unité', 'Droit ou acquis', 'Pris', 'Posés', 'Solde', 'Rubrique de paie']);
  const iccp = csv.rows.find(r => r[10] === 'ICCP_J')!;
  assert.equal(iccp[9], String(solde.etat.cp!.total).replace('.', ','));
  assert.ok(csv.rows.some(r => r[10] === 'RECUP_H' && r[5] === 'heures'));
  assert.match(String(iccp[11]), /^Soldes calculés par Cursus · Solde photographié le .* par .* · à saisir dans Sage/);
  const sections = X.sectionsSoldeSortie(dd, e, { etat: solde.etat, solde });
  assert.deepEqual(sections.map(s => s.title), ['Sortie', 'Compteurs au 16 oct. 2026', 'Transmission à la paie']);
  assert.ok(sections[0].rows!.some(([k, v]) => k === 'Motif' && v === 'Démission'));
  assert.match(sections[2].text!, /calculé par Sage Paie/);
  assert.ok(!/€|EUR/.test(JSON.stringify(sections)), 'aucun montant');
  // Sortie d'avant la photographie : calcul du jour, signalé comme tel.
  assert.match(X.sourceSolde(dd, { etat: solde.etat, solde: null }), /non photographié/);
});
