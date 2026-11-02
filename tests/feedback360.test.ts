// Tests : feedback 360°, étape 3 du chantier C3 du lot 12 (shared/rules/feedback360.ts, server/src/feedback360.ts,
// server/src/actions/feedback360.ts, server/src/vues-entretiens-suivis.ts).
// - règles pures : activation refusée sans les références de l'avis du CSE et de l'AIPD (COHERENCE), seuil jamais sous
//   3, réponse contrôlée, groupes restitués (partition d'au moins 3 réponses, catégories fusionnées), synthèse masquée,
//   relation déduite de l'organisation ;
// - cycle complet : proposition du salarié, sollicitation par le manager (au moins 3), réponses chiffrées en attente,
//   compteur global seulement pour l'évaluateur et l'évalué, clôture et versement par lot, relecture des commentaires,
//   clôture de l'entretien (réponses brutes supprimées, synthèse gardée) ;
// - absence de lien entre une réponse et sa sollicitation : ni colonne, ni ordre, ni identifiant séquentiel, ni clé au
//   journal des changements, ni trace au journal des actions ;
// - sous le seuil : rien n'est versé ; refus (types, module, répondant, fenêtre) ; tâche horaire (clôture à l'échéance,
//   relance, purge à 6 mois) ; jamais hors ligne ; notifications génériques.
// Jeu de démonstration au 10 octobre 2026 : Mehdi Benali (2, Maintenance), annuel planifié ; Karim Haddad (12) encadre la
// Maintenance ; Thomas Garnier (6), Sophie Lemaire (3), Julien Moreau (8), Lucas Martin (4) répondants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
process.env.CURSUS_PIECES_KEY = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;

const { nouvelleBase, PG } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const F = await import('../server/src/feedback360.ts');
const R = await import('../shared/rules/feedback360.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { ACTIONS_HORS_LIGNE, refusHorsLigne } = await import('../shared/hors-ligne.ts');
const { NOTIFICATIONS_PUSH } = await import('../shared/notifications-push.ts');
const { avisADonner } = await import('../shared/rules/a-faire.ts');
const { comptesDemo } = await import('../server/src/seed.ts');
const { CHAMPS_HORS_VUES, CHAMPS_PAR_SALARIE } = await import('../server/src/vues-cache.ts');
const { HORS_INSTANTANE, LECTURES } = await import('../server/src/lecture-brute.ts');
const { rejouer, resumeRapport } = await import('./support/oracle.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Entretien = import('../shared/types.ts').Entretien;
type Reponse360 = import('../shared/types.ts').Reponse360;
type Sollicitation360 = import('../shared/types.ts').Sollicitation360;

// — Règles pures —

test('règles : activation refusée sans les références de l’avis du CSE et de l’AIPD ; seuil jamais sous 3', () => {
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { feedback360Actif: true }), (e: unknown) => e instanceof ReglageInvalide && /avis du CSE.*AIPD/.test(e.message));
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { feedback360Actif: true, feedback360Cse: 'Avis du 12 mars 2027' }), /AIPD/);
  const s = appliquerReglages(DEFAULT_SETTINGS, { feedback360Actif: true, feedback360Cse: 'Avis du 12 mars 2027', feedback360Aipd: 'AIPD-2027-02' });
  assert.equal(s.feedback360Actif, true);
  assert.equal(DEFAULT_SETTINGS.feedback360Actif, false, 'livré désactivé');
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { feedback360Seuil: 1 }).feedback360Seuil, 3, 'jamais sous 3');
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { feedback360ConservationMois: 12 }).feedback360ConservationMois, 6, '6 mois au plus');
});

test('règles : réponse contrôlée (questions du questionnaire en vigueur, notes de 1 à 4, commentaire limité)', () => {
  assert.deepEqual(R.lireReponse360({ notes: { cooperation: '4', fiabilite: 2, ecoute: '' }, verbatim: '  Très   fiable  ' }),
    { version: R.QUESTIONNAIRE_360.version, notes: { cooperation: 4, fiabilite: 2 }, verbatim: 'Très fiable' });
  assert.match(R.lireReponse360({ notes: {} }) as string, /au moins une question/);
  assert.match(R.lireReponse360({ notes: { sante: 3 } }) as string, /inconnue/);
  assert.match(R.lireReponse360({ notes: { cooperation: 5 } }) as string, /1 \(rarement\) à 4/);
  assert.match(R.lireReponse360({ notes: { cooperation: 3 }, verbatim: 'x'.repeat(501) }) as string, /500/);
  // Aucune question sur la santé ni la vie personnelle.
  assert.ok(R.QUESTIONNAIRE_360.questions.every(q => !/santé|médical|personnel|famille|opinion/i.test(q.libelle)));
});

const rep = (relation: Reponse360['relation'], n: number, i = 0): Reponse360 => ({
  id: `r${relation}${i}`, empId: 2, entretienId: 1, relation, versionQuestionnaire: '2027-1', notes: { cooperation: n, fiabilite: n }, verbatim: null, verbatimStatut: null, modereLe: null, moderePar: null,
});

test('règles : groupes restitués, une partition d’au moins 3 réponses (catégories fusionnées en dessous)', () => {
  // Rien sous le seuil.
  assert.deepEqual(R.groupes360([rep('pair', 3), rep('pair', 4)], 3), []);
  // 3 collègues seuls, un N+2 et un encadré : le reste (2) ne fait pas un groupe, il rejoint le plus petit groupe.
  const g1 = R.groupes360([rep('pair', 2, 1), rep('pair', 2, 2), rep('pair', 2, 3), rep('n2', 4), rep('encadre', 4)], 3);
  assert.deepEqual(g1.map(g => [g.relations, g.reponses]), [[['pair', 'n2', 'encadre'], 5]]);
  // 4 collègues, 3 encadrés, 1 N+2 sollicités : le N+2 rejoint le plus petit groupe au seuil (encadrés), jamais seul ;
  // l'intitulé est le même qu'il ait répondu ou non (catégories sollicitées, pas celles qui ont répondu).
  const sollicitees: Reponse360['relation'][] = ['pair', 'n2', 'encadre'];
  const g2 = R.groupes360([...[1, 2, 3, 4].map(i => rep('pair', 3, i)), ...[1, 2, 3].map(i => rep('encadre', 2, i)), rep('n2', 4)], 3, sollicitees);
  assert.deepEqual(g2.map(g => [g.relations, g.reponses]), [[['pair'], 4], [['n2', 'encadre'], 4]]);
  const g2sans = R.groupes360([...[1, 2, 3, 4].map(i => rep('pair', 3, i)), ...[1, 2, 3].map(i => rep('encadre', 2, i))], 3, sollicitees);
  assert.deepEqual(g2sans.map(g => [g.relations, g.reponses]), [[['pair'], 4], [['n2', 'encadre'], 3]]);
  // Les catégories sous le seuil sont toujours versées dans le plus petit groupe au seuil, même assez nombreuses ensemble :
  // sans quoi leur groupe propre existerait ou non selon que le N+2 a répondu.
  const g3 = R.groupes360([...[1, 2, 3].map(i => rep('pair', 3, i)), rep('n2', 1), rep('encadre', 1, 1), rep('encadre', 1, 2)], 3, sollicitees);
  assert.deepEqual(g3.map(g => [g.relations, g.reponses]), [[['pair', 'n2', 'encadre'], 6]]);
  // Sans catégorie au seuil : un seul groupe, toutes les catégories sollicitées citées.
  const g4 = R.groupes360([rep('pair', 3, 1), rep('pair', 3, 2), rep('encadre', 2, 1)], 3, sollicitees);
  assert.deepEqual(g4.map(g => [g.relations, g.reponses]), [[['pair', 'n2', 'encadre'], 3]]);
  for (const g of [...g1, ...g2, ...g2sans, ...g3, ...g4]) assert.ok(g.reponses >= 3, 'aucun groupe sous le seuil');
});

test('règles : la synthèse ne dit pas si le N+2 (ou toute petite catégorie) a répondu', () => {
  // Scénarios des relecteurs : 4 collègues, le N+2 et 2 ou 3 encadrés sollicités ; le N+2 répond ou non.
  const cas: [Reponse360[], Reponse360['relation'][]][] = [
    [[...[1, 2, 3].map(i => rep('pair', 3, i)), ...[1, 2, 3].map(i => rep('encadre', 2, i))], ['pair', 'n2', 'encadre']],
    [[...[1, 2, 3].map(i => rep('pair', 3, i)), ...[1, 2].map(i => rep('encadre', 2, i))], ['pair', 'n2', 'encadre']],
    [[1, 2, 3].map(i => rep('pair', 3, i)), ['pair', 'n2']],
  ];
  // Forme de la synthèse sans les nombres ni les moyennes : groupes (intitulés, relations) et relations de l'ensemble.
  const forme = (s: ReturnType<typeof R.synthese360>) => ({
    groupes: s.groupes.map(g => [R.libelleGroupe360(g), g.relations]), ensemble: s.ensemble?.relations, sollicitees: s.sollicitees, insuffisant: s.insuffisant,
  });
  for (const [rs, sollicitees] of cas) {
    const o = { envoyees: 8, closeLe: '2026-10-20', seuil: 3, sollicitees };
    const sans = R.synthese360(rs, o);
    const avec = R.synthese360([...rs, rep('n2', 4)], o);
    assert.deepEqual(forme(avec), forme(sans), JSON.stringify(forme(avec)));
    assert.ok(sans.ensemble!.relations.includes('n2'), 'catégorie sollicitée citée, qu’elle ait répondu ou non');
  }
});

test('règles : synthèse (ensemble, moyennes masquées sous le seuil, verbatims retenus seulement)', () => {
  const rs = [rep('pair', 4, 1), rep('pair', 3, 2), rep('pair', 2, 3)];
  rs[0].notes = { cooperation: 4, ecoute: 2 };
  rs[1].verbatim = 'Fiable'; rs[1].verbatimStatut = 'retenu';
  rs[2].verbatim = 'À relire'; rs[2].verbatimStatut = 'a_moderer';
  const s = R.synthese360(rs, { envoyees: 5, closeLe: '2026-10-20', seuil: 3 });
  assert.equal(s.insuffisant, false);
  assert.deepEqual(s.groupes, [], 'un seul groupe : l’ensemble suffit');
  assert.equal(s.ensemble!.moyennes.cooperation, 3);
  assert.equal(s.ensemble!.moyennes.ecoute, null, 'une seule note : masquée');
  assert.equal(s.ensemble!.moyennes.fiabilite, null, 'deux notes : masquée');
  assert.deepEqual(s.verbatims, ['Fiable']);
  assert.equal(s.aModerer, 1);
  const sous = R.synthese360(rs.slice(0, 2), { envoyees: 5, closeLe: '2026-10-20', seuil: 3 });
  assert.equal(sous.insuffisant, true);
  assert.equal(sous.ensemble, null);
  assert.deepEqual(sous.verbatims, []);
  // Une question masquée dans un groupe l'est aussi dans l'ensemble (sinon la différence la révélerait).
  const deux = [...[1, 2, 3].map(i => rep('pair', 3, i)), ...[1, 2, 3].map(i => rep('encadre', 1, i))];
  deux[3].notes = { cooperation: 1 };
  const s2 = R.synthese360(deux, { envoyees: 6, closeLe: '2026-10-20', seuil: 3 });
  assert.equal(s2.groupes.length, 2);
  assert.equal(s2.groupes[1].moyennes.fiabilite, null);
  assert.equal(s2.ensemble!.moyennes.fiabilite, null);
  assert.equal(s2.ensemble!.moyennes.cooperation, 2);
});

test('règles : relation déduite de l’organisation, sollicitation masquée, limite de conservation', () => {
  const mgr = new Map([[2, 12], [12, 20], [30, 2]]);
  const mgrOf = (id: number) => mgr.get(id) ?? null;
  assert.equal(R.relation360(mgrOf, 2, 20), 'n2');
  assert.equal(R.relation360(mgrOf, 2, 30), 'encadre');
  assert.equal(R.relation360(mgrOf, 2, 6), 'pair');
  const s: Sollicitation360 = { id: 1, empId: 2, entretienId: 1, repondantEmpId: 6, relation: 'pair', statut: 'repondue', proposeeLe: null, proposeePar: null, envoyeeLe: 'x', echeance: '2026-10-31', relanceeLe: 'y', closeLe: null };
  assert.equal(R.sollicitationMasquee(s).statut, 'envoyee');
  assert.equal(R.sollicitationMasquee({ ...s, statut: 'declinee' }).statut, 'envoyee');
  assert.equal(R.sollicitationMasquee({ ...s, statut: 'proposee' }).statut, 'proposee');
  assert.equal(R.sollicitationMasquee(s).relanceeLe, null);
  assert.equal(R.limiteConservation360('2026-10-10', 6), '2026-04-10');
  assert.equal(R.limiteConservation360('2026-08-31', 6), '2026-02-28');
});

test('jamais hors ligne ; notifications et e-mails génériques', () => {
  assert.ok(!ACTIONS_HORS_LIGNE.some(a => a.startsWith('feedback360.')));
  assert.match(refusHorsLigne('feedback360.repondre', { empId: 6 }, 6)!, /non admise hors ligne/);
  for (const t of ['feedback360.demande', 'feedback360.relance']) {
    assert.ok(NOTIFICATIONS_PUSH[t], t);
    assert.ok(!/évalu|feedback|360/i.test(NOTIFICATIONS_PUSH[t].corps), 'texte générique');
  }
});

// — Base de démonstration —

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
  const personne = async (empId: number | null, role: User['role'] = 'rh') => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const u = {
    admin: await personne(null), gest: await personne(14), lecture: await personne(11), hse: await personne(23), paie: await personne(7),
    karim: await personne(12, 'manager'), hugo: await personne(16, 'manager'), mehdi: await personne(2, 'collaborateur'),
    thomas: await personne(6, 'collaborateur'), sophie: await personne(3, 'collaborateur'), julien: await personne(8, 'collaborateur'), lucas: await personne(4, 'collaborateur'),
  };
  const run = async (user: User, name: string, payload: Record<string, unknown>) => {
    const compte = await compteDe(user.empId ?? user.salarieId ?? null);
    return await db.tx(async () => {
      const t = await preparerTrace(db, name, payload);
      const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
      const o = typeof r === 'object' && r !== null ? r : { message: r, result: undefined };
      await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
      return o as { message: string | null; result?: any };
    });
  };
  const refus = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, statut = 400) => {
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => {
      assert.ok(e instanceof ActionError, String(e));
      assert.equal(e.status, statut, e.message);
      assert.match(e.message, motif);
      return true;
    });
  };
  const reglages = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  await reglages({ feedback360Actif: true, feedback360Cse: 'Avis du CSE du 12 mars 2027', feedback360Aipd: 'AIPD-2027-02' });
  const annuel = async (empId = 2) => (await db.one<{ id: number }>(`SELECT id FROM entretiens WHERE emp_id = ? AND type = 'annuel' AND statut = 'planifie'`, [empId]))!.id;
  const entretien = async (id: number) => (await db.get<Entretien>('entretiens', id))!;
  const sollicitations = async (entretienId: number) => await db.where<Sollicitation360>('feedbackSollicitations', 'entretienId', entretienId);
  const sienne = async (entretienId: number, empId: number) => (await sollicitations(entretienId)).find(s => s.repondantEmpId === empId)!;
  const snap = async (user: User) => await buildSnapshot(db, user, { cache: false });
  const journal = async (action: string) => await db.query<{ payload: string | Record<string, unknown>; message: string; salaries: string | number[] }>('SELECT payload, message, salaries FROM journal WHERE action = ? ORDER BY id', [action]);
  return { db, u, run, refus, reglages, annuel, entretien, sollicitations, sienne, snap, journal };
}

const NOTES = (n: number) => Object.fromEntries(R.QUESTIONNAIRE_360.questions.map(q => [q.cle, n]));

test('cycle : proposition, sollicitation, réponses chiffrées, compteur global, versement par lot, relecture, clôture', async () => {
  const { db, u, run, refus, annuel, entretien, sollicitations, sienne, snap, journal } = await fresh();
  const x = await annuel();
  // Le salarié propose deux collègues ; l'évaluateur ne peut lancer la collecte à moins de 3.
  await run(u.mehdi, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3] });
  assert.deepEqual((await sollicitations(x)).map(s => [s.repondantEmpId, s.statut]), [[6, 'proposee'], [3, 'proposee']]);
  await refus(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3] }, /au moins 3/);
  await refus(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [12] }, /conduit l’entretien/);
  await refus(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [2] }, /lui-même/);
  const r = await run(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 8, 4] });
  assert.match(r.message!, /4 répondants sollicités/);
  assert.ok((await sollicitations(x)).every(s => s.statut === 'envoyee' && s.echeance === '2026-10-31'));
  // Le N+2 de Mehdi n'existe pas ici : relations « collègue » pour tous.
  assert.ok((await sollicitations(x)).every(s => s.relation === 'pair'));
  // Notifications : jamais le nom de l'évalué.
  const textes = await db.query<{ texte: string; objet: string }>(`SELECT texte, objet FROM notifications WHERE type = 'feedback360.demande'`);
  const envois = (await db.query<{ contenu: unknown }>(`SELECT contenu FROM envois WHERE type = 'feedback360.demande'`)).map(e => JSON.stringify(e.contenu));
  for (const t of [...textes.map(n => n.texte + n.objet), ...envois]) assert.ok(!/Mehdi|Benali/.test(t), 'notification sans le nom de l’évalué');
  assert.ok(textes.length + envois.length >= 4, 'chaque répondant est prévenu');

  // Réponses : chiffrées dans le tampon, rien dans les réponses versées.
  await run(u.thomas, 'feedback360.repondre', { id: (await sienne(x, 6)).id, notes: NOTES(4), verbatim: 'Toujours prêt à dépanner l’équipe' });
  await run(u.sophie, 'feedback360.repondre', { id: (await sienne(x, 3)).id, notes: NOTES(3), verbatim: '' });
  await run(u.julien, 'feedback360.repondre', { id: (await sienne(x, 8)).id, notes: NOTES(2) });
  // Thomas modifie son avis tant que la collecte est ouverte ; Lucas décline.
  await run(u.thomas, 'feedback360.repondre', { id: (await sienne(x, 6)).id, notes: NOTES(4), verbatim: 'Toujours prêt à aider l’équipe' });
  await run(u.lucas, 'feedback360.decliner', { id: (await sienne(x, 4)).id });
  const tampon = await db.query<{ contenu: string }>('SELECT contenu FROM feedback_tampon');
  assert.equal(tampon.length, 3);
  assert.ok(tampon.every(t => t.contenu.startsWith('CURSUSF1:') && !t.contenu.includes('aider')), 'chiffré');
  assert.equal((await db.query('SELECT id FROM feedback_reponses')).length, 0, 'rien de versé avant la clôture');
  await refus(u.mehdi, 'feedback360.repondre', { id: (await sienne(x, 6)).id, notes: NOTES(1) }, /personne sollicitée/, 403);

  // Vues : l'évaluateur et l'évalué voient qui est sollicité et un compteur global, jamais qui a répondu ou décliné.
  for (const user of [u.karim, u.mehdi]) {
    const v = await snap(user);
    const l = (v.feedbackSollicitations ?? []).filter(s => s.entretienId === x);
    assert.equal(l.length, 4);
    assert.ok(l.every(s => s.statut === 'envoyee' && s.relanceeLe === null), `${user.nom} : statut masqué`);
    assert.deepEqual(v.suiviFeedback?.find(s => s.entretienId === x), { entretienId: x, envoyees: 4, reponses: 3, declinees: 1, echeance: '2026-10-31', close: false });
    assert.ok(!JSON.stringify(v).includes('aider'));
  }
  // Le service RH conduit lui aussi des entretiens (évaluateur de tout salarié) : même vue masquée, même compteur global.
  for (const user of [u.admin, u.gest]) {
    const v = await snap(user);
    const l = (v.feedbackSollicitations ?? []).filter(s => s.entretienId === x);
    assert.equal(l.length, 4);
    assert.ok(l.every(s => s.statut === 'envoyee' && s.relanceeLe === null), `${user.nom} (service RH) : statut masqué`);
    assert.deepEqual(v.suiviFeedback?.find(s => s.entretienId === x), { entretienId: x, envoyees: 4, reponses: 3, declinees: 1, echeance: '2026-10-31', close: false });
  }
  // Le répondant ne voit que sa sollicitation ; un autre manager et les profils restreints, rien.
  const vt = await snap(u.thomas);
  assert.deepEqual((vt.feedbackSollicitations ?? []).map(s => [s.repondantEmpId, s.statut]), [[6, 'repondue']]);
  assert.equal(avisADonner(vt.feedbackSollicitations ?? [], 6, '2026-10-10').length, 0);
  assert.equal(avisADonner((await snap(u.lucas)).feedbackSollicitations ?? [], 4, '2026-10-10').length, 0, 'décliné : plus rien à donner');
  for (const user of [u.hugo, u.lecture, u.hse, u.paie]) assert.deepEqual((await snap(user)).feedbackSollicitations ?? [], [], user.nom);
  // Les réponses n'entrent dans aucun instantané, même pour le service RH.
  assert.equal('feedbackReponses' in await snap(u.admin), false);

  // L'entretien ne se clôt pas pendant la collecte.
  await refus(u.karim, 'entretien.clore', { id: x, date: '2026-10-10' }, /collecte/, 409);
  // Clôture de la collecte : versement par lot.
  const c = await run(u.karim, 'feedback360.clore', { entretienId: x });
  assert.match(c.message!, /3 réponses sur 4/);
  assert.equal((await db.query('SELECT id FROM feedback_tampon')).length, 0, 'tampon purgé');
  const versees = await db.where<Reponse360>('feedbackReponses', 'entretienId', x);
  assert.equal(versees.length, 3);
  assert.ok(versees.every(v => /^[0-9a-f]{24}$/.test(v.id)), 'identifiant aléatoire');
  assert.equal(versees.filter(v => v.verbatimStatut === 'a_moderer').length, 1);
  assert.deepEqual((await sollicitations(x)).map(s => s.statut).sort(), ['declinee', 'repondue', 'repondue', 'repondue']);
  let s = R.lireSynthese360((await entretien(x)).syntheseFeedback)!;
  assert.equal(s.reponses, 3);
  assert.equal(s.ensemble!.moyennes.cooperation, 3);
  assert.deepEqual(s.verbatims, [], 'commentaire restitué après la relecture seulement');
  assert.equal(s.aModerer, 1);
  await refus(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [10] }, /un seul feedback/, 409);

  // Relecture par le service RH (jamais par un manager) ; synthèse recalculée.
  const [com] = await F.commentaires360(db, null);
  assert.deepEqual(Object.keys(com).sort(), ['empId', 'entretienId', 'id', 'statut', 'verbatim'], 'ni relation ni notes');
  await refus(u.karim, 'feedback360.moderer', { id: com.id, decision: 'retenu' }, /service RH/, 403);
  await run(u.gest, 'feedback360.moderer', { id: com.id, decision: 'retenu' });
  s = R.lireSynthese360((await entretien(x)).syntheseFeedback)!;
  assert.deepEqual(s.verbatims, ['Toujours prêt à aider l’équipe']);
  assert.equal(s.aModerer, 0);
  // La synthèse voyage avec l'entretien : évaluateur et évalué, jamais la lecture seule.
  assert.ok(R.lireSynthese360((await snap(u.mehdi)).entretiens.find(y => y.id === x)!.syntheseFeedback));
  assert.equal((await snap(u.lecture)).entretiens.find(y => y.id === x)?.syntheseFeedback ?? null, null);

  // Clôture de l'entretien : réponses brutes, tampon et sollicitations supprimés, synthèse gardée.
  await run(u.karim, 'entretien.clore', { id: x, date: '2026-10-10' });
  assert.equal((await db.query('SELECT id FROM feedback_reponses WHERE entretien_id = ?', [x])).length, 0);
  assert.equal((await sollicitations(x)).length, 0);
  assert.deepEqual(R.lireSynthese360((await entretien(x)).syntheseFeedback)!.verbatims, ['Toujours prêt à aider l’équipe']);

  // Journal : ni réponse ni refus d'un répondant ; jamais un répondant nommé ou désigné.
  assert.deepEqual(await journal('feedback360.repondre'), []);
  assert.deepEqual(await journal('feedback360.decliner'), []);
  for (const a of ['feedback360.solliciter', 'feedback360.clore', 'feedback360.moderer']) {
    for (const l of await journal(a)) {
      const sal = typeof l.salaries === 'string' ? JSON.parse(l.salaries) as number[] : l.salaries;
      assert.deepEqual(sal, [2], `${a} : seul l’évalué`);
      const txt = JSON.stringify(l.payload) + l.message;
      assert.ok(!/Thomas|Sophie|Julien|Lucas|aider/.test(txt), `${a} : ${txt}`);
    }
  }
});

test('absence de lien entre une réponse et sa sollicitation : colonnes, ordre, identifiants, journal des changements', async () => {
  const { db, u, run, annuel, sienne } = await fresh();
  // Aucune colonne de la table des réponses ne désigne un répondant, une sollicitation ou un moment de réception.
  const colonnes = Object.keys((await import('../server/src/db.ts')).TABLES.feedbackReponses.cols);
  assert.deepEqual(colonnes.filter(c => /sollicit|repondant|recu|recept|date|cree|envoy|le$/i.test(c) && c !== 'modereLe'), []);
  const x = await annuel();
  await run(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 8, 4] });
  const ordre = [6, 3, 8, 4];
  for (const [i, r] of ordre.entries()) {
    const user = { 6: u.thomas, 3: u.sophie, 8: u.julien, 4: u.lucas }[r]!;
    await run(user, 'feedback360.repondre', { id: (await sienne(x, r)).id, notes: { cooperation: i + 1 } });
  }
  // Les changements des tables du 360° n'inscrivent aucune clé (ni sollicitation, ni réponse).
  const cles = await db.query<{ tbl: string; pk: string | null }>(`SELECT tbl, pk FROM changements WHERE tbl LIKE 'feedback%'`);
  assert.ok(cles.length > 0 && cles.every(c => c.pk === null), JSON.stringify(cles));
  // Versement avec un tirage connu (permutation inverse) : l'ordre d'insertion suit le tirage, pas celui des sollicitations.
  await db.tx(async () => {
    const ds = await loadFull(db, u.admin);
    await F.clore360({ db, ds }, { id: x }, () => 0);
  });
  const lignes = await db.query<{ id: string; notes: string | Record<string, number> }>(`SELECT id, notes FROM feedback_reponses ORDER BY ${PG ? 'ctid' : 'rowid'}`);
  const notes = lignes.map(l => (typeof l.notes === 'string' ? JSON.parse(l.notes) : l.notes).cooperation);
  assert.deepEqual(notes, [2, 3, 4, 1], 'ordre d’insertion : celui du tirage, pas celui des réponses');
  assert.equal(new Set(lignes.map(l => l.id)).size, 4);
  assert.ok(lignes.every(l => /^[0-9a-f]{24}$/.test(l.id)));
  // Tirage par défaut : sur 30 versements, l'ordre des sollicitations n'est pas reproduit à chaque fois.
  let identiques = 0;
  for (let k = 0; k < 30; k++) if (F.melanger([1, 2, 3, 4, 5]).join() === '1,2,3,4,5') identiques++;
  assert.ok(identiques < 30);
});

test('sous le seuil : rien n’est versé ni restitué ; tâche horaire : clôture à l’échéance, relance, purge à 6 mois', async () => {
  const { db, u, run, refus, annuel, entretien, sollicitations, sienne } = await fresh();
  const x = await annuel();
  await run(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 8] });
  await run(u.thomas, 'feedback360.repondre', { id: (await sienne(x, 6)).id, notes: NOTES(3), verbatim: 'Commentaire unique' });
  await run(u.sophie, 'feedback360.repondre', { id: (await sienne(x, 3)).id, notes: NOTES(2) });
  // Relance automatique 3 jours avant l'échéance (31 octobre), une seule fois, du seul répondant sans réponse.
  const b1 = await F.tacheFeedback360(db, '2026-10-28');
  assert.equal(b1.relances, 1);
  const relances = [...await db.query(`SELECT id FROM notifications WHERE type = 'feedback360.relance'`), ...await db.query(`SELECT id FROM envois WHERE type = 'feedback360.relance'`)];
  assert.equal(relances.length, 1, 'le répondant sans réponse est relancé (e-mail ou récapitulatif)');
  assert.equal((await F.tacheFeedback360(db, '2026-10-29')).relances, 0, 'pas deux fois');
  assert.ok((await sienne(x, 8)).relanceeLe);
  // Échéance passée : la tâche clôt la collecte ; 2 réponses sur 3, sous le seuil : rien de versé, tampon purgé.
  const b2 = await F.tacheFeedback360(db, '2026-11-01');
  assert.equal(b2.closes, 1);
  assert.equal((await db.query('SELECT id FROM feedback_reponses')).length, 0);
  assert.equal((await db.query('SELECT id FROM feedback_tampon')).length, 0);
  const s = R.lireSynthese360((await entretien(x)).syntheseFeedback)!;
  assert.equal(s.insuffisant, true);
  assert.equal(s.reponses, 2);
  assert.ok(!JSON.stringify(s).includes('Commentaire unique'));
  assert.equal((await sienne(x, 8)).statut, 'expiree');
  // Conservation : sollicitations purgées 6 mois après l'envoi, synthèse gardée.
  assert.equal((await F.tacheFeedback360(db, '2027-03-01')).purgees, 0);
  assert.equal((await F.tacheFeedback360(db, '2027-04-30')).purgees, 1);
  assert.equal((await sollicitations(x)).length, 0);
  assert.ok(R.lireSynthese360((await entretien(x)).syntheseFeedback));
  // L'entretien, reporté, est encore planifié : la synthèse jointe vaut collecte close, aucune nouvelle collecte ne l'écrase.
  assert.equal((await entretien(x)).statut, 'planifie');
  await refus(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 8] }, /un seul feedback/, 409);
  await refus(u.mehdi, 'feedback360.solliciter', { entretienId: x, repondantIds: [6] }, /un seul feedback/, 409);
});

test('refus : type d’entretien, module désactivé, fenêtre échue, sollicitation envoyée non retirable, hors périmètre', async () => {
  const { db, u, run, refus, reglages, annuel, sienne } = await fresh();
  await run(u.karim, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const epp = (await db.one<{ id: number }>(`SELECT id FROM entretiens WHERE emp_id = 2 AND type = 'epp' AND statut = 'planifie'`))!.id;
  await refus(u.karim, 'feedback360.solliciter', { entretienId: epp, repondantIds: [6, 3, 8] }, /L6315-1/);
  const x = await annuel();
  await refus(u.hugo, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 8] }, /évaluateur/, 403);
  // Le membre du service RH qui conduit la collecte (compte RH, salarié rattaché 14) ne se désigne pas répondant.
  await refus(u.gest, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 14] }, /conduit l’entretien/);
  await run(u.karim, 'feedback360.solliciter', { entretienId: x, repondantIds: [6, 3, 8] });
  await refus(u.karim, 'feedback360.retirer', { id: (await sienne(x, 6)).id }, /ne se retire plus/, 409);
  await refus(u.thomas, 'feedback360.repondre', { id: (await sienne(x, 6)).id, notes: {} }, /au moins une question/);
  await db.update('feedbackSollicitations', (await sienne(x, 6)).id, { echeance: '2026-10-09' });
  await refus(u.thomas, 'feedback360.repondre', { id: (await sienne(x, 6)).id, notes: NOTES(3) }, /Fenêtre de réponse close/, 409);
  await reglages({ feedback360Actif: false });
  await refus(u.sophie, 'feedback360.repondre', { id: (await sienne(x, 3)).id, notes: NOTES(3) }, /non activé/, 409);
  // Module désactivé pendant une collecte : l'entretien se clôt quand même, réponses en attente supprimées.
  await run(u.karim, 'entretien.clore', { id: x, date: '2026-10-10' });
  assert.equal((await db.query('SELECT id FROM feedback_sollicitations WHERE entretien_id = ?', [x])).length, 0);
});

test('tampon : chiffré avec la clé, sollicitation authentifiée ; sans clé hors production, gardé lisible pour le versement', () => {
  const cle = randomBytes(32);
  const c = { version: '2027-1', notes: { cooperation: 3 }, verbatim: 'Fiable' };
  const v = F.sceller360(c, 7, cle);
  assert.ok(v.startsWith('CURSUSF1:') && !v.includes('Fiable'));
  assert.deepEqual(F.ouvrir360(v, 7, cle), c);
  assert.throws(() => F.ouvrir360(v, 8, cle), 'ligne déplacée sur une autre sollicitation');
  assert.throws(() => F.ouvrir360(v, 7, randomBytes(32)));
  assert.deepEqual(F.ouvrir360(F.sceller360(c, 7, null), 7, null), c);
  assert.equal(F.refusSansCle360({ NODE_ENV: 'development' }), null);
  assert.match(F.refusSansCle360({ NODE_ENV: 'production' })!, /CURSUS_PIECES_KEY/);
  assert.equal(F.refusSansCle360({ NODE_ENV: 'production', CURSUS_PIECES_KEY: randomBytes(32).toString('hex') }), null);
});

test('cache incrémental : sollicitations champ commun, réponses hors de l’instantané ; banc d’oracle, module activé', async () => {
  assert.ok(!CHAMPS_HORS_VUES.has('feedbackSollicitations') && !CHAMPS_PAR_SALARIE.has('feedbackSollicitations'), 'deux salariés par ligne : champ commun');
  assert.ok(HORS_INSTANTANE.has('feedbackReponses') && HORS_INSTANTANE.has('feedbackTampon'));
  assert.ok(!('feedbackReponses' in LECTURES));
  const { db, u, run, annuel } = await fresh();
  await db.tx(async () => await comptesDemo(db));
  await run(u.karim, 'feedback360.solliciter', { entretienId: await annuel(), repondantIds: [6, 3, 8] });
  const actions = ['feedback360.solliciter', 'feedback360.repondre', 'feedback360.decliner', 'feedback360.relancer', 'feedback360.clore'];
  const x = await rejouer(db, { graine: 20261103, pas: 60, verifierTous: 3, jeux: 0, sql: 0, seulement: [...actions, ...actions, 'entretien.planifier', 'temps.setCell'] });
  assert.deepEqual(x.erreurs, [], resumeRapport(x));
  assert.deepEqual(x.divergences, [], resumeRapport(x));
  assert.ok(Object.entries(x.actions).some(([a, s]) => a.startsWith('feedback360.') && s.ok > 0), `${resumeRapport(x)}\n${JSON.stringify(x.actions)}`);
});
