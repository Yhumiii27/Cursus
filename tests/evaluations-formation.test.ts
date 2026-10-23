// Tests : évaluation des formations (lot 7, chantier C, étape 2, t121 ; shared/rules/evaluation-formation.ts,
// server/src/actions/evaluations-formation.ts, server/src/evaluations-formation.ts). Fenêtres et formations concernées,
// avis à chaud du salarié ou recueilli par le service RH à la clôture, efficacité à froid du salarié et de son manager
// (réponse de l'entreprise du 23 octobre 2026), droits, remplacement et retrait, journal sans note ni commentaire,
// instantané par profil (commentaires au service RH, manager limité à ses avis sur son équipe, agrégats pour le référent
// HSE et la lecture seule), « À faire » du salarié et du manager, demandes et relances par e-mail, indicateurs par
// organisme et par formation (appréciation de session d'avant le lot 7 reprise telle quelle), conservation.
// Jeu de démonstration au 10 octobre 2026 : Mehdi Benali (2) et Thomas Garnier (6), Maintenance, manager Karim Haddad
// (12) ; Yanis Bouzid (20), Logistique, manager Hugo Lambert (16). Session 6 : EPI du 9 octobre, à clôturer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, PG } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
type Compte = import('../server/src/comptes.ts').Compte;
const { Domain } = await import('../shared/domain.ts');
const { aFaireCollaborateur } = await import('../shared/rules/a-faire.ts');
const { effacer } = await import('../server/src/conservation.ts');
const { demanderEvaluations, evaluationsDuJour } = await import('../server/src/evaluations-formation.ts');
const E = await import('../shared/rules/evaluation-formation.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Evaluation = import('../shared/types.ts').EvaluationFormation;
type Settings = import('../shared/types.ts').Settings;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Responsable RH' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: 'Manager · Logistique' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien' };
const THOMAS: User = { role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: 'Technicien' };
const HSE: User = { role: 'rh', empId: null, salarieId: 23, profilRh: 'referent_hse', nom: 'Sarah Cohen', intitule: 'Référente HSE' } as User;
const PAIE: User = { role: 'rh', empId: null, salarieId: 7, profilRh: 'paie', nom: 'Aïcha Diallo', intitule: 'Paie' } as User;
const LECTURE: User = { role: 'rh', empId: null, salarieId: 11, profilRh: 'lecture_seule', nom: 'Élodie Bernard', intitule: 'Direction' } as User;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Action exécutée comme par POST /api/actions/:nom : journal compris, signé du compte de la personne.
  const run = async (user: User, name: string, payload: Record<string, unknown>) => {
    const empId = user.empId ?? user.salarieId ?? null;
    const compte = (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
    const out = await db.tx(async () => {
      const t = await preparerTrace(db, name, payload);
      const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
      const o = typeof r === 'object' && r !== null ? r : { message: r };
      await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
      return o;
    });
    return out.message ?? '';
  };
  const refus = async (user: User, name: string, payload: Record<string, unknown>, statut: number, motif?: RegExp) => {
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => {
      assert.ok(e instanceof ActionError, String(e));
      assert.equal(e.status, statut, e.message);
      if (motif) assert.match(e.message, motif);
      return true;
    });
  };
  const domain = async (user: User = RH) => new Domain(await buildSnapshot(db, user));
  const reglages = async (r: Partial<Settings>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  /** Session clôturée (un jour) de la formation `f`, avec les participations présentes de `empIds` ; renvoie leurs identifiants. */
  const sessionClose = async (date: string, empIds: number[], f = 'sst', note: number | null = null) => {
    const s = await db.insert<{ id: number }>('sessions', {
      formation: f, date, fin: date, jours: [date], horaires: [], lieu: 'Site de Lyon — salle B', places: 12, statut: 'Clôturée', planId: null,
      bilan: { le: date, par: 'Sandrine Vidal', note, commentaire: null, motif: null },
    });
    const ids: number[] = [];
    for (const empId of empIds) ids.push((await db.insert<{ id: number }>('participations', { sessionId: s.id, empId, parcours: 'recyclage', present: true, reussi: null, certId: null })).id);
    return ids;
  };
  const evaluations = async (): Promise<Evaluation[]> => (await loadFull(db, RH)).evaluationsFormation ?? [];
  const emails = async (type: string) => (await db.query<{ contenu: unknown }>('SELECT contenu FROM envois WHERE cible = ? AND type = ? ORDER BY id', ['email', type]))
    .map(e => (typeof e.contenu === 'string' ? JSON.parse(e.contenu) : e.contenu) as { a: string[]; objet: string; texte: string });
  const journal = async (action: string) => (await db.query<{ payload: unknown; salaries: unknown }>('SELECT payload, salaries FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ payload: (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, unknown>, salaries: l.salaries }));
  return { db, run, refus, domain, reglages, sessionClose, evaluations, emails, journal };
}

// — Règles pures —

test('règles : fenêtres de saisie, formations concernées et répondants prévus', async () => {
  const { domain, sessionClose } = await fresh();
  const [p] = await sessionClose('2026-06-10', [2]);
  const d = await domain();
  const s = d.ds.settings;
  assert.deepEqual([s.evaluationsActives, s.evaluationFroidDelai, s.evaluationFroidPar, s.evaluationFroidCategories], [true, 90, 'les_deux', ['Réglementaire', 'Recommandée']], 'choix par défaut et réponse de l’entreprise');
  const c = E.cibleDe(d, { participationId: p })!;
  assert.deepEqual([c.cle, c.empId, c.organisme, c.categorie, c.fin], [`p${p}`, 2, 'Croix-Rouge française', 'Réglementaire', '2026-06-10']);
  assert.equal(E.cibleDe(d, { participationId: p, formationSuivieId: 1 }), null, 'une seule formation évaluée');
  assert.equal(E.echeanceFroid(s, c), '2026-09-08');
  // À chaud : l'avis du salarié, jusqu'au début de l'évaluation à froid.
  assert.match(E.refusEvaluation(s, '2026-10-10', c, 'chaud', 'salarie')!, /close 90 jours après/);
  assert.equal(E.refusEvaluation(s, '2026-07-01', c, 'chaud', 'salarie'), null);
  assert.match(E.refusEvaluation(s, '2026-07-01', c, 'chaud', 'manager')!, /avis du salarié/);
  assert.match(E.refusEvaluation(s, '2026-06-09', c, 'chaud', 'salarie')!, /pas terminée/);
  // À froid : à partir de l'échéance, une réponse tardive restant acceptée ; salarié et manager.
  assert.match(E.refusEvaluation(s, '2026-09-07', c, 'froid', 'salarie')!, /à partir du 08\/09\/2026/);
  assert.equal(E.refusEvaluation(s, '2026-09-08', c, 'froid', 'manager'), null);
  assert.equal(E.refusEvaluation(s, '2027-06-01', c, 'froid', 'salarie'), null);
  assert.match(E.refusEvaluation({ ...s, evaluationFroidPar: 'manager' }, '2026-10-10', c, 'froid', 'salarie')!, /remplie par le manager/);
  assert.match(E.refusEvaluation({ ...s, evaluationFroidCategories: ['Recommandée'] }, '2026-10-10', c, 'froid', 'salarie')!, /réglementaire : pas d’évaluation à froid/);
  assert.match(E.refusEvaluation({ ...s, evaluationsActives: false }, '2026-07-01', c, 'chaud', 'salarie')!, /désactivée/);
  assert.deepEqual(E.repondantsFroid({ evaluationFroidPar: 'les_deux' }), ['salarie', 'manager']);
  assert.deepEqual([E.palierFroid(0), E.palierFroid(14), E.palierFroid(15), E.palierFroid(29), E.palierFroid(45)], ['demande', 'demande', 'relance-15', 'relance-15', 'relance-30']);
  // Formation suivie hors catalogue de Mehdi (jeu de démonstration) : évaluable à chaud, pas à froid par défaut.
  const suivie = E.ciblesEvaluation(d).find(x => x.formationSuivieId)!;
  assert.deepEqual([suivie.categorie, suivie.organisme, suivie.intitule], ['Hors catalogue', 'GRETA Industrie', 'Lecture de schémas électriques industriels']);
  assert.match(E.refusEvaluation(s, '2026-10-10', suivie, 'froid', 'salarie')!, /hors catalogue : pas d’évaluation à froid/);
});

// — Saisie : salarié, manager, service RH —

test('avis à chaud du salarié dans son espace, remplacé par une nouvelle saisie, sans note au journal', async () => {
  const { run, refus, sessionClose, evaluations, journal } = await fresh();
  const [p] = await sessionClose('2026-10-02', [2]);
  const msg = await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'chaud', note: 4, commentaire: 'Formateur très clair' });
  assert.equal(msg, 'Évaluation à chaud enregistrée — Sauveteur secouriste du travail (SST), terminée le 2 oct. 2026');
  await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'chaud', note: 5, commentaire: '' });
  const l = await evaluations();
  assert.equal(l.length, 1, 'une seule évaluation par formation, type et répondant');
  assert.deepEqual([l[0].note, l[0].commentaire, l[0].repondant, l[0].auteur, l[0].auteurId], [5, null, 'salarie', 'Mehdi Benali', 2]);
  // Contrôles : note entière de 1 à 5, commentaire de 1 000 caractères au plus, type connu.
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'chaud', note: 6 }, 400, /note entière de 1 à 5/);
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'chaud', note: 3.5 }, 400, /note entière/);
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'chaud', note: 3, commentaire: 'x'.repeat(1001) }, 400, /1 000 caractères/);
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'tiede', note: 3 }, 400, /Type d’évaluation inconnu/);
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: 9999, type: 'chaud', note: 3 }, 404);
  // À froid avant l'échéance (2 janvier 2027) : refusé.
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'efficace' }, 400, /à partir du 31\/12\/2026/);
  // Journal : formation évaluée, type, répondant, ligne écrite ; jamais la note ni le commentaire.
  const j = await journal('evaluation.enregistrer');
  assert.equal(j.length, 2);
  assert.deepEqual(j[0].payload, { participationId: p, type: 'chaud', id: l[0].id, repondant: 'salarie', remplace: false });
  assert.equal(j[1].payload.remplace, true);
  assert.ok(!JSON.stringify(j).includes('Formateur'), 'commentaire jamais au journal');
});

test('efficacité à froid : le salarié et son manager, chacun son avis ; autres profils refusés', async () => {
  const { run, refus, sessionClose, evaluations, reglages } = await fresh();
  const [p, pThomas] = await sessionClose('2026-06-10', [2, 6]);
  // Le salarié pour lui-même ; un autre salarié, non.
  await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'efficace', commentaire: 'Gestes utiles sur le chantier' });
  await refus(THOMAS, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' }, 403);
  // Son manager direct : son avis de manager, quel que soit le répondant demandé ; un autre manager, non.
  assert.match(await run(KARIM, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'partielle', repondant: 'salarie' }), /\(avis du manager\)$/);
  await refus(HUGO, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' }, 403);
  // Le manager ne donne pas l'avis à chaud du salarié.
  await refus(KARIM, 'evaluation.enregistrer', { participationId: pThomas, type: 'chaud', note: 3 }, 400, /avis du salarié/);
  // Profils restreints : jamais (indicateurs agrégés seulement).
  for (const u of [HSE, PAIE, LECTURE]) await refus(u, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' }, 403);
  // Service RH : avis recueilli au nom du salarié (par défaut) ou du manager.
  assert.match(await run(RH, 'evaluation.enregistrer', { participationId: pThomas, type: 'froid', efficacite: 'non', repondant: 'manager' }), /\(avis du manager\)$/);
  assert.match(await run(RH, 'evaluation.enregistrer', { participationId: pThomas, type: 'froid', efficacite: 'efficace' }), /\(avis de Thomas Garnier\)$/);
  await refus(RH, 'evaluation.enregistrer', { participationId: pThomas, type: 'froid', efficacite: 'bof' }, 400, /efficace, partiellement ou pas efficace/);
  const l = await evaluations();
  assert.deepEqual(l.map(e => [e.empId, e.repondant, e.efficacite, e.auteur]).sort(), [
    [2, 'manager', 'partielle', 'Karim Haddad'], [2, 'salarie', 'efficace', 'Mehdi Benali'],
    [6, 'manager', 'non', 'Sandrine Vidal'], [6, 'salarie', 'efficace', 'Sandrine Vidal'],
  ].sort());
  // Réglages : remplie par le manager seul ; catégorie décochée ; évaluations désactivées.
  await reglages({ evaluationFroidPar: 'manager' });
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' }, 400, /remplie par le manager/);
  await reglages({ evaluationFroidPar: 'les_deux', evaluationFroidCategories: ['Recommandée'] });
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' }, 400, /pas d’évaluation à froid/);
  await reglages({ evaluationFroidCategories: ['Réglementaire', 'Recommandée'], evaluationsActives: false });
  await refus(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' }, 400, /désactivée/);
});

test('retrait d’un avis : son auteur ou le service RH ; tracé sans note', async () => {
  const { run, refus, sessionClose, evaluations, journal } = await fresh();
  const [p] = await sessionClose('2026-06-10', [2]);
  await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'efficace' });
  await run(KARIM, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non' });
  const [m, k] = [(await evaluations()).find(e => e.repondant === 'salarie')!, (await evaluations()).find(e => e.repondant === 'manager')!];
  await refus(KARIM, 'evaluation.retirer', { id: m.id }, 403, /auteur de l’avis/);
  await refus(MEHDI, 'evaluation.retirer', { id: k.id }, 403);
  await refus(HSE, 'evaluation.retirer', { id: k.id }, 403);
  assert.equal(await run(KARIM, 'evaluation.retirer', { id: k.id }), 'Évaluation à froid retirée (avis du manager)');
  assert.equal(await run(RH, 'evaluation.retirer', { id: m.id }), 'Évaluation à froid retirée');
  assert.deepEqual(await evaluations(), []);
  await refus(RH, 'evaluation.retirer', { id: m.id }, 404);
  const j = await journal('evaluation.retirer');
  assert.equal(j.length, 2);
  assert.equal(j[0].payload.participationId, p);
  assert.ok(!JSON.stringify(j).includes('efficace'), 'ni l’efficacité ni la note au journal');
});

test('clôture : avis à chaud des présents recueilli par le service RH, en leur nom ; refusé au référent HSE', async () => {
  const { db, run, refus, evaluations, journal } = await fresh();
  // Session 6 (EPI du 9 octobre) : Antoine Leroy, Élodie Bernard, Fatou Ndiaye, Inès Dupont, Yanis Bouzid.
  const participants = [14, 11, 17, 5, 20].map(empId => ({ empId, present: empId !== 20, note: empId === 14 ? 5 : empId === 5 ? '3' : null }));
  // Référent HSE (qui clôt les sessions) : pas d'avis nominatif.
  await refus(HSE, 'session.cloturer', { id: 6, participants }, 403, /recueillis par le service RH/);
  await refus(RH, 'session.cloturer', { id: 6, participants: participants.map(x => (x.empId === 20 ? { ...x, note: 4 } : x)) }, 400, /Yanis Bouzid : seulement pour un participant présent/);
  await refus(RH, 'session.cloturer', { id: 6, participants: participants.map(x => (x.empId === 14 ? { ...x, note: 0 } : x)) }, 400, /note entière de 1 à 5/);
  const msg = await run(RH, 'session.cloturer', { id: 6, participants, note: 4 });
  assert.match(msg, /2 avis à chaud recueillis/);
  const l = await evaluations();
  const parts = await db.query<{ id: number; emp_id: number }>('SELECT id, emp_id FROM participations WHERE session_id = 6 ORDER BY emp_id');
  assert.deepEqual(l.map(e => [e.empId, e.type, e.repondant, e.note, e.auteur, e.participationId]).sort(), [
    [14, 'chaud', 'salarie', 5, 'Sandrine Vidal', parts.find(x => x.emp_id === 14)!.id],
    [5, 'chaud', 'salarie', 3, 'Sandrine Vidal', parts.find(x => x.emp_id === 5)!.id],
  ].sort());
  // Le salarié peut modifier l'avis recueilli dans son espace.
  await run({ role: 'collaborateur', empId: 5, nom: 'Inès Dupont', intitule: 'Technicienne' }, 'evaluation.enregistrer', { participationId: parts.find(x => x.emp_id === 5)!.id, type: 'chaud', note: 4 });
  assert.equal((await evaluations()).find(e => e.empId === 5)!.note, 4);
  // Journal de la clôture : l'avis recueilli (case), jamais la note.
  const j = (await journal('session.cloturer'))[0].payload.participants as Record<string, unknown>[];
  assert.deepEqual(j.find(x => x.empId === 14), { empId: 14, present: true, reussi: null, avis: true });
  assert.deepEqual(j.find(x => x.empId === 11), { empId: 11, present: true, reussi: null });
  // Appréciation de la session par le service RH (Session.bilan.note) : gardée telle quelle.
  assert.equal((await loadFull(db, RH)).sessions.find(s => s.id === 6)!.bilan!.note, 4);
});

// — Instantané par profil —

test('instantané : commentaires au service RH, manager limité à ses avis sur son équipe, agrégats pour HSE et lecture seule', async () => {
  const { db, run, sessionClose } = await fresh();
  const [p, pThomas] = await sessionClose('2026-06-10', [2, 6]);
  await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'efficace', commentaire: 'Très utile' });
  await run(KARIM, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'partielle', commentaire: 'À consolider' });
  await run(RH, 'evaluation.enregistrer', { participationId: pThomas, type: 'froid', efficacite: 'non', commentaire: 'Recueilli' });
  const rh = await buildSnapshot(db, RH);
  assert.equal(rh.evaluationsFormation!.length, 3);
  assert.ok(rh.evaluationsFormation!.every(e => e.auteur), 'service RH : tout, auteurs et commentaires compris');
  assert.equal(rh.indicateursEvaluation, undefined, 'service RH : indicateurs calculés sur l’instantané');
  // Collaborateur : son avis seulement, sans qui l'a saisi ; ni l'avis de son manager.
  const mehdi = await buildSnapshot(db, MEHDI);
  assert.deepEqual(mehdi.evaluationsFormation!.map(e => [e.repondant, e.commentaire, e.auteur, e.auteurId]), [['salarie', 'Très utile', null, null]]);
  // Thomas : son avis recueilli par le service RH.
  assert.deepEqual((await buildSnapshot(db, THOMAS)).evaluationsFormation!.map(e => e.efficacite), ['non']);
  // Manager : ses avis de manager sur son équipe directe, jamais l'avis d'un membre.
  const karim = await buildSnapshot(db, KARIM);
  assert.deepEqual(karim.evaluationsFormation!.map(e => [e.empId, e.repondant, e.commentaire]), [[2, 'manager', 'À consolider']]);
  assert.deepEqual((await buildSnapshot(db, HUGO)).evaluationsFormation, []);
  // Référent HSE et lecture seule : aucune évaluation, indicateurs agrégés (moins de 3 réponses : ni moyenne ni taux).
  for (const u of [HSE, LECTURE]) {
    const x = await buildSnapshot(db, u);
    assert.deepEqual(x.evaluationsFormation, []);
    const i = x.indicateursEvaluation!.find(y => y.exercice === 2026)!;
    assert.deepEqual([i.total.participants, i.total.froid, i.total.froidAttendus], [2, 3, 4]);
    assert.deepEqual([i.total.efficaces, i.total.tauxEfficacite, i.total.masque], [1, 33, undefined], 'trois réponses : affichées');
    const sst = i.parFormation.find(y => y.cle.startsWith('Sauveteur'))!;
    assert.equal(sst.froid, 3);
    assert.ok(!JSON.stringify(x.indicateursEvaluation).includes('utile'), 'aucun commentaire');
  }
  // Paie : rien.
  const paie = await buildSnapshot(db, PAIE);
  assert.deepEqual([paie.evaluationsFormation, paie.indicateursEvaluation], [[], undefined]);
});

// — À faire, demandes et relances —

test('à faire : avis à chaud du mois, efficacité à froid échue pour le salarié et son manager', async () => {
  const { run, domain, sessionClose, reglages } = await fresh();
  const [recente] = await sessionClose('2026-10-02', [2]);
  const [ancienne] = await sessionClose('2026-06-10', [2, 6]);
  await sessionClose('2026-06-12', [2], 'rgpd'); // Interne : pas à froid par défaut ; à chaud, plus de 30 jours après
  let d = await domain(MEHDI);
  assert.deepEqual(aFaireCollaborateur(d, 2).evaluations.map(x => [x.cible.participationId, x.type, x.depuis]), [[ancienne, 'froid', '2026-09-08'], [recente, 'chaud', '2026-10-02']]);
  const k = await domain(KARIM);
  assert.deepEqual(E.evaluationsAFaireManager(k, 12).map(x => [x.cible.empId, x.type]), [[2, 'froid'], [6, 'froid']]);
  assert.deepEqual(E.evaluationsAFaireManager(await domain(HUGO), 16), []);
  await run(MEHDI, 'evaluation.enregistrer', { participationId: recente, type: 'chaud', note: 4 });
  await run(MEHDI, 'evaluation.enregistrer', { participationId: ancienne, type: 'froid', efficacite: 'efficace' });
  d = await domain(MEHDI);
  assert.deepEqual(aFaireCollaborateur(d, 2).evaluations, [], 'donnés : plus rien à faire');
  assert.equal(E.evaluationsAFaireManager(await domain(KARIM), 12).length, 2, 'le manager a encore les siens');
  // Remplie par le salarié seul : plus rien pour le manager ; évaluations désactivées : rien du tout.
  await reglages({ evaluationFroidPar: 'salarie' });
  assert.deepEqual(E.evaluationsAFaireManager(await domain(KARIM), 12), []);
  await reglages({ evaluationFroidPar: 'les_deux', evaluationsActives: false });
  assert.deepEqual(aFaireCollaborateur(await domain(THOMAS), 6).evaluations, []);
});

test('e-mails : avis à chaud demandé une fois, efficacité à froid demandée puis relancée au salarié et au manager', async () => {
  const { db, run, sessionClose, emails } = await fresh();
  const [recente] = await sessionClose('2026-10-02', [2]);
  const [ancienne] = await sessionClose('2026-09-01', [6]);
  // Aujourd'hui : l'avis à chaud de Mehdi (formation du 2 octobre) ; celui de Thomas (1er septembre) n'est plus demandé.
  assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 1, demandes: 1 });
  let m = await emails('evaluation.demande');
  assert.deepEqual(m.map(x => x.a[0]), ['mehdi.benali@entreprise.example']);
  assert.match(m[0].objet, /votre avis sur une formation/);
  assert.match(m[0].texte, /Sauveteur secouriste du travail \(SST\), terminée le 2 oct\. 2026 : votre avis sur la formation \(note de 1 à 5\)/);
  assert.match(m[0].texte, /votre manager ne voit pas votre avis/);
  assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 0, demandes: 0 }, 'une fois par palier');
  await run(MEHDI, 'evaluation.enregistrer', { participationId: recente, type: 'chaud', note: 5 });
  try {
    // 30 novembre (90 jours après) : efficacité à froid demandée à Thomas et à son manager.
    process.env.CURSUS_TODAY = '2026-11-30';
    assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 2, demandes: 2 });
    m = await emails('evaluation.demande');
    assert.deepEqual(m.at(-1)!.a, ['thomas.garnier@entreprise.example']);
    assert.match(m.at(-1)!.texte, /terminée le 1 sept\. 2026 : la formation vous a-t-elle été utile/);
    const mgr = await emails('evaluation.manager');
    assert.deepEqual(mgr.map(x => x.a[0]), ['karim.haddad@entreprise.example']);
    assert.match(mgr[0].objet, /efficacité des formations de votre équipe : 1 évaluation à faire/);
    assert.match(mgr[0].texte, /• Thomas Garnier — Sauveteur secouriste du travail \(SST\), terminée le 1 sept\. 2026 : la formation a-t-elle été efficace \?/);
    // Thomas répond ; 15 décembre : seul le manager est relancé.
    await run(THOMAS, 'evaluation.enregistrer', { participationId: ancienne, type: 'froid', efficacite: 'efficace', commentaire: 'Gestes repris' });
    process.env.CURSUS_TODAY = '2026-12-15';
    assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 1, demandes: 1 });
    const relance = (await emails('evaluation.manager')).at(-1)!;
    assert.match(relance.texte, /\(relance : demandée le 30 nov\. 2026\)/);
    assert.ok([...await emails('evaluation.demande'), ...await emails('evaluation.manager')].every(x => !x.texte.includes('Gestes repris')), 'jamais de commentaire');
    // Passé la fenêtre de 60 jours après l'échéance (celle de Thomas comme celle de Mehdi, le 31 décembre) : plus rien.
    process.env.CURSUS_TODAY = '2027-03-02';
    assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 0, demandes: 0 });
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
});

test('tâche quotidienne : à partir de 7 h, une fois par jour ; rien quand les évaluations sont désactivées', async () => {
  const { db, sessionClose, reglages } = await fresh();
  await sessionClose('2026-10-02', [2]);
  assert.equal(await db.tx(() => evaluationsDuJour(db, 6)), null);
  assert.deepEqual(await db.tx(() => evaluationsDuJour(db, 7)), { emails: 1, demandes: 1 });
  assert.equal(await db.tx(() => evaluationsDuJour(db, 9)), null, 'déjà passée aujourd’hui');
  await sessionClose('2026-10-03', [6]);
  await reglages({ evaluationsActives: false });
  assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 0, demandes: 0 });
});

// — Indicateurs —

test('indicateurs : par organisme et par formation, moyenne à chaud, efficacité, taux de réponse, appréciation de session reprise', async () => {
  const { run, domain, sessionClose } = await fresh();
  const sst = await sessionClose('2026-03-10', [2, 6, 18], 'sst', 4);
  const atex = await sessionClose('2026-04-14', [24], 'atex', null);
  await sessionClose('2025-11-04', [2], 'elec', 2); // exercice 2025
  // Avis recueillis par le service RH (la fenêtre de l'avis à chaud est close pour le salarié).
  for (const [p, note] of [[sst[0], 4], [sst[1], 5], [sst[2], 2], [atex[0], 3]] as const) {
    await run(RH, 'evaluation.enregistrer', { participationId: p, type: 'chaud', note });
  }
  await run(MEHDI, 'evaluation.enregistrer', { participationId: sst[0], type: 'froid', efficacite: 'efficace' });
  await run(KARIM, 'evaluation.enregistrer', { participationId: sst[0], type: 'froid', efficacite: 'partielle' });
  await run(KARIM, 'evaluation.enregistrer', { participationId: sst[1], type: 'froid', efficacite: 'efficace' });
  const d = await domain();
  const x = E.indicateursEvaluation(d, 2026);
  assert.deepEqual(x.total, {
    cle: 'Total', participants: 4, chaud: 4, moyenneChaud: 3.5, tauxChaud: 100,
    // Attendus : 4 participations concernées échues × 2 répondants.
    froidAttendus: 8, froid: 3, efficaces: 2, partielles: 1, non: 0, tauxEfficacite: 67, tauxFroid: 38,
    sessionsNotees: 1, moyenneSessions: 4,
  });
  assert.deepEqual(x.parOrganisme.map(l => [l.cle, l.participants, l.moyenneChaud, l.froid, l.sessionsNotees]), [['Apave', 1, 3, 0, 0], ['Croix-Rouge française', 3, 3.7, 3, 1]]);
  assert.deepEqual(x.parFormation.map(l => l.cle), ['Intervention en zone ATEX (niveau 1)', 'Sauveteur secouriste du travail (SST)']);
  // Exercice précédent : une session notée par le service RH, sans avis individuel.
  const y = E.indicateursEvaluation(d, 2025);
  assert.deepEqual([y.total.participants, y.total.sessionsNotees, y.total.moyenneSessions, y.parOrganisme.map(l => l.cle)], [2, 1, 2, ['Apave', 'GRETA Industrie']]);
  // Vue agrégée : sous 3 réponses, ni moyenne ni efficacité.
  const v = E.indicateursEvaluation(d, 2026, E.SEUIL_ANONYMAT);
  const apave = v.parOrganisme.find(l => l.cle === 'Apave')!;
  assert.deepEqual([apave.chaud, apave.moyenneChaud, apave.masque], [1, null, true]);
  assert.equal(v.total.moyenneChaud, 3.5, 'total : assez de réponses');
  assert.deepEqual(E.exercicesEvaluation(d), [2025, 2026]);
});

// — Conservation —

test('conservation : la catégorie « formations » vide les commentaires, garde notes et efficacité', async () => {
  const { db, run, sessionClose, evaluations } = await fresh();
  const [p] = await sessionClose('2026-06-10', [2]);
  await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'efficace', commentaire: 'Mehdi Benali : très utile' });
  await db.tx(() => effacer(db, 2, ['formations'], { ti: '2026-10-10', le: '2026-10-10T08:00:00.000Z', par: 'Sandrine Vidal' }, { motif: 'Essai', avantEcheance: true }));
  const [e] = await evaluations();
  assert.deepEqual([e.efficacite, e.commentaire, e.empId], ['efficace', null, 2]);
});

test('migration nommée lot7-formations-index-evaluations : index par salarié créé une fois, sans effet ensuite', { skip: PG && 'SQL propre à SQLite (PostgreSQL : 0010_evaluations_formation.sql)' }, async () => {
  const { SqliteDb } = await import('../server/src/db.ts');
  const { INDEX_EVALUATIONS } = await import('../server/src/migrations/lot7-formations.ts');
  const { indexExiste } = await import('../server/src/migrations/outils.ts');
  const db = new SqliteDb(':memory:');
  assert.equal(await INDEX_EVALUATIONS.necessaire!(db), true);
  assert.equal(await INDEX_EVALUATIONS.executer(db), 'index evaluations_formation_emp');
  assert.equal(indexExiste(db, 'evaluations_formation_emp'), true);
  assert.equal(await INDEX_EVALUATIONS.necessaire!(db), false);
});

// — Corrections de relecture —

test('indicateurs : avis à froid attendus comme ils sont demandés (salarié sans manager, salarié sorti avant l’échéance)', async () => {
  const { db, run, domain, sessionClose } = await fresh();
  // Karim Haddad (12) et Hugo Lambert (16) n'ont pas de manager (validations par le service RH) : l'avis du salarié seul.
  const [karim, hugo] = await sessionClose('2026-06-10', [12, 16]);
  let d = await domain();
  assert.deepEqual(E.demandesEvaluation(d).map(x => [x.cible.empId, x.repondant]), [[12, 'salarie'], [16, 'salarie']]);
  assert.equal(E.indicateursEvaluation(d, 2026).total.froidAttendus, 2);
  await run(KARIM, 'evaluation.enregistrer', { participationId: karim, type: 'froid', efficacite: 'efficace' });
  await run(HUGO, 'evaluation.enregistrer', { participationId: hugo, type: 'froid', efficacite: 'partielle' });
  d = await domain();
  assert.deepEqual([E.indicateursEvaluation(d, 2026).total.froid, E.indicateursEvaluation(d, 2026).total.tauxFroid], [2, 100], 'tous ont répondu');
  // Thomas Garnier (6), sorti le 31 août, avant l'échéance du 8 septembre : rien ne lui est demandé, ni à son manager.
  await sessionClose('2026-06-10', [6], 'atex');
  await db.update('employes', 6, { fin: '2026-08-31' });
  d = await domain();
  const atex = E.indicateursEvaluation(d, 2026).parFormation.find(l => l.cle.startsWith('Intervention en zone ATEX'))!;
  assert.deepEqual([atex.participants, atex.froidAttendus, atex.tauxFroid], [1, 0, null]);
  // Sorti après l'échéance : les deux avis lui ont été demandés, ils restent attendus.
  await db.update('employes', 6, { fin: '2026-09-30' });
  d = await domain();
  assert.equal(E.indicateursEvaluation(d, 2026).parFormation.find(l => l.cle === atex.cle)!.froidAttendus, 2);
});

test('export « Mes données » du salarié : sans l’avis à froid de son manager ; l’export du service RH le garde', async () => {
  const { db, run, sessionClose } = await fresh();
  const { donneesSalarie } = await import('../server/src/donnees.ts');
  const [p] = await sessionClose('2026-06-10', [2]);
  await run(MEHDI, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'efficace', commentaire: 'Utile au quotidien' });
  await run(KARIM, 'evaluation.enregistrer', { participationId: p, type: 'froid', efficacite: 'non', commentaire: 'Gestes non maîtrisés, à reprendre' });
  const section = (x: Awaited<ReturnType<typeof donneesSalarie>>) => x!.sections['Évaluations des formations suivies'] as Record<string, unknown>[];
  const lui = section(await donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' }));
  assert.deepEqual(lui.map(r => [r.repondant, r.efficacite, r.commentaire]), [['salarie', 'efficace', 'Utile au quotidien']]);
  assert.ok(lui.every(r => !('auteur' in r) && !('auteurId' in r)), 'sans auteur');
  assert.ok(!JSON.stringify(lui).includes('Gestes non maîtrisés'));
  const rh = section(await donneesSalarie(db, 2, { journal: true, par: 'Sandrine Vidal' }));
  assert.deepEqual(rh.map(r => r.repondant).sort(), ['manager', 'salarie']);
  assert.ok(JSON.stringify(rh).includes('Gestes non maîtrisés'));
});

test('avis à chaud demandé à partir de la clôture quand elle vient tard, jamais au-delà du début de l’évaluation à froid', async () => {
  const { db, domain, sessionClose, emails } = await fresh();
  const cloturer = async (empId: number, fin: string, le: string) => {
    const [p] = await sessionClose(fin, [empId]);
    const { sessionId } = (await db.get<{ sessionId: number }>('participations', p))!;
    await db.update('sessions', sessionId, { bilan: { le, par: 'Sandrine Vidal', note: null, commentaire: null, motif: null } });
    return p;
  };
  const tard = await cloturer(2, '2026-09-01', '2026-10-05'); // clôturée 34 jours après
  await cloturer(6, '2026-06-01', '2026-09-15'); // clôturée après l'échéance à froid du 30 août : plus d'avis à chaud
  const d = await domain(MEHDI);
  const c = E.cibleDe(d, { participationId: tard })!;
  assert.deepEqual([c.fin, c.ouverte], ['2026-09-01', '2026-10-05']);
  assert.deepEqual(E.periodeChaud(d.ds.settings, c), { du: '2026-10-05', au: '2026-11-04' });
  assert.deepEqual(aFaireCollaborateur(d, 2).evaluations.map(x => [x.cible.participationId, x.type, x.depuis]), [[tard, 'chaud', '2026-10-05']]);
  assert.deepEqual(aFaireCollaborateur(await domain(THOMAS), 6).evaluations.filter(x => x.type === 'chaud'), []);
  // Demande par e-mail : l'avis à chaud de Mehdi seul (pour Thomas, l'efficacité à froid, demandée à lui et à son manager).
  assert.deepEqual(E.demandesEvaluation(await domain()).filter(x => x.type === 'chaud').map(x => [x.destinataire, x.depuis]), [[2, '2026-10-05']]);
  await db.tx(() => demanderEvaluations(db));
  const mehdi = (await emails('evaluation.demande')).find(x => x.a[0] === 'mehdi.benali@entreprise.example')!;
  assert.match(mehdi.texte, /terminée le 1 sept\. 2026 : votre avis sur la formation/);
  // Bornée par l'échéance à froid : clôture à J+80, demande pendant 10 jours seulement.
  assert.deepEqual(E.periodeChaud(d.ds.settings, { fin: '2026-06-01', ouverte: '2026-08-20' }), { du: '2026-08-20', au: '2026-08-30' });
});

test('e-mails : un premier envoi à un palier de relance ne se dit pas relance (fonction réactivée, échéance passée)', async () => {
  const { db, domain, sessionClose, reglages, emails } = await fresh();
  await sessionClose('2026-06-10', [6]); // échéance à froid le 8 septembre, 32 jours plus tôt
  await reglages({ evaluationsActives: false });
  assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 0, demandes: 0 });
  await reglages({ evaluationsActives: true });
  assert.deepEqual(E.demandesEvaluation(await domain()).map(x => x.palier), ['relance-30', 'relance-30']);
  assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 2, demandes: 2 });
  const tous = [...await emails('evaluation.demande'), ...await emails('evaluation.manager')];
  assert.equal(tous.length, 2);
  assert.ok(tous.every(x => !x.texte.includes('relance')), 'première demande');
  assert.deepEqual(await db.tx(() => demanderEvaluations(db)), { emails: 0, demandes: 0 }, 'palier noté');
});
