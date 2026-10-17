// Tests : corrections d'une saisie erronée (t119) — certification modifiée ou annulée (garde-fou des habilitations, place
// de session, historique réservé au service RH), ligne du plan corrigée ou supprimée, demande retirée par son auteur ou
// rouverte par le service RH (ce que l'acceptation avait créé est défait), journal sans motif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { libererPlacesRemplacees } = await import('../server/src/migrate.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { budgetSummary } = await import('../shared/rules/budget.ts');
const { certsApres, effetsReouverture, erreursLignePlan, habilitationsAppuyees, inscriptionsARendre, refusSuppressionLigne } = await import('../shared/rules/corrections.ts');
const { JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Ligne = Record<string, any>;

const MOTIF = 'Saisie sur la mauvaise fiche — confidentiel 4471';

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  /** Chemin de POST /api/actions/:nom : état lu avant l'action, trace au journal après. */
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return o.message as string;
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) => assert.throws(() => run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : refus attendu ${re}`);
  const ds = () => loadFull(db, user(null, 'rh'));
  const domain = () => new Domain(ds());
  const derniere = (action: string) => db.all<Ligne>('journal').findLast(j => j.action === action);
  return {
    db, user, run, refus, ds, domain, derniere,
    RH: user(null, 'rh'), GEST: user(14, 'rh'), HSE: user(23, 'rh'), KARIM: user(12, 'manager'), MEHDI: user(2, 'collaborateur'),
  };
}

// — Certifications —

test('certification annulée : hors de tous les calculs, gardée pour le service RH seul, motif jamais au journal', () => {
  const { db, run, refus, ds, domain, derniere, RH, GEST, KARIM, HSE, MEHDI } = fresh();
  // Mehdi : SST du 3 mai 2025 (aucune habilitation ne s'appuie dessus).
  refus(GEST, 'cert.annuler', { id: 5, motif: MOTIF }, /administrateur RH/, 403);
  refus(RH, 'cert.annuler', { id: 5, motif: '  ' }, /Motif de la correction obligatoire/);
  const msg = run(RH, 'cert.annuler', { id: 5, motif: MOTIF });
  assert.match(msg, /SST du 3 mai 2025 supprimée du dossier de Mehdi Benali/);
  const mehdi = ds().employes.find(e => e.id === 2)!;
  assert.ok(!mehdi.certs.some(c => c.id === 5), 'hors des certifications du dossier');
  assert.deepEqual(mehdi.certsAnnulees!.map(c => [c.id, c.annuleLe, c.annulePar, c.annuleMotif]), [[5, '2026-10-10', 'Sandrine Vidal', MOTIF]]);
  assert.ok(!domain().enrich(90, false).find(e => e.id === 2)!.rawCerts.some(c => c.f === 'sst'), 'plus de SST suivie');
  // Ni le manager, ni l'intéressé, ni le référent HSE ne reçoivent la certification annulée.
  for (const u of [KARIM, MEHDI, HSE]) {
    const e = buildSnapshot(db, u).employes.find(x => x.id === 2)!;
    assert.deepEqual(e.certsAnnulees, [], `${u.nom} : rien d’annulé`);
    assert.ok(!e.certs.some(c => c.id === 5));
  }
  const j = derniere('cert.annuler')!;
  assert.equal(j.payload.f, 'sst');
  assert.equal(j.payload.obtenue, '2025-05-03');
  assert.deepEqual(j.payload.apres, { annuleLe: '2026-10-10' });
  assert.ok(!JSON.stringify(j).includes('4471'), 'motif absent du journal');
  assert.ok(JOURNAL_LABEL['cert.annuler'] && JOURNAL_LABEL['cert.modifier']);
  refus(RH, 'cert.annuler', { id: 5, motif: MOTIF }, /introuvable ou déjà supprimée/, 404);
});

test('certification : refus quand une habilitation délivrée s’appuie sur elle sans autre certification valide', () => {
  const { run, refus, domain, ds, RH, HSE } = fresh();
  const mehdi = () => ds().employes.find(e => e.id === 2)!;
  // Travail en hauteur de Mehdi : prérequis la formation hauteur du 10 janvier 2025 (certification 6).
  assert.deepEqual(habilitationsAppuyees(domain(), mehdi(), mehdi().certs.filter(c => c.id !== 6)).map(a => a.h), ['hauteur']);
  refus(RH, 'cert.annuler', { id: 6, motif: MOTIF }, /Suppression impossible : l’habilitation Autorisation travaux en hauteur \(Travail en hauteur\).*Suspendez d’abord/);
  // Une date qui la rendrait expirée fait tomber le prérequis ; une date voisine, non.
  refus(HSE, 'cert.modifier', { id: 6, date: '2019-01-10', motif: MOTIF }, /Correction impossible/);
  refus(HSE, 'cert.modifier', { id: 6, date: '2027-01-10', motif: MOTIF }, /postérieure à aujourd’hui/);
  assert.match(run(HSE, 'cert.modifier', { id: 6, date: '2025-01-17', motif: MOTIF }), /corrigée — Mehdi Benali · obtenue le 17 janv\. 2025/);
  // Une certification plus récente de la même formation, saisie par erreur : la précédente, valide, suffit au prérequis,
  // la suppression passe sans refus et l'habilitation reste valide.
  const habHauteur = () => domain().enrich(90, false).find(e => e.id === 2)!.habs.find(h => h.h === 'hauteur')!.key;
  run(RH, 'cert.ajouter', { empId: 2, f: 'hauteur', date: '2026-09-01' });
  const recente = mehdi().certs.find(c => c.f === 'hauteur' && c.obtenue === '2026-09-01')!;
  assert.deepEqual(habilitationsAppuyees(domain(), mehdi(), mehdi().certs.filter(c => c.id !== recente.id)), []);
  assert.match(run(RH, 'cert.annuler', { id: recente.id, motif: MOTIF }), /certification du 17 janv\. 2025 de nouveau en vigueur/);
  assert.equal(mehdi().certs.find(c => c.f === 'hauteur')!.id, 6, 'celle du 10 (corrigée au 17) janvier 2025 revient en vigueur');
  assert.ok(['ok', 'due'].includes(habHauteur()), 'habilitation hauteur toujours valide');
  // Suspendue, l'habilitation ne s'appuie plus sur rien : la suppression passe, l'habilitation reste suspendue.
  run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Vérification du titre' });
  run(RH, 'cert.annuler', { id: 6, motif: MOTIF });
  assert.equal(domain().enrich(90, false).find(e => e.id === 2)!.habs.find(h => h.h === 'hauteur')!.key, 'susp');
  // Une certification plus ancienne et valide prend le relais : pas de refus.
  run(RH, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-09-01' });
  const nouvelle = mehdi().certs.find(c => c.f === 'sst' && c.obtenue === '2026-09-01')!;
  run(RH, 'cert.annuler', { id: nouvelle.id, motif: MOTIF });
  assert.equal(mehdi().certs.find(c => c.f === 'sst')!.obtenue, '2025-05-03', 'la précédente revient en vigueur');
});

test('certification modifiée : date et formation corrigées, motif réservé au service RH, session de l’ancienne formation quittée', () => {
  const { db, run, refus, ds, derniere, RH, GEST, HSE, KARIM, MEHDI } = fresh();
  refus(KARIM, 'cert.modifier', { id: 5, date: '2025-05-05', motif: MOTIF }, /réservée au service RH et au référent HSE/, 403);
  refus(MEHDI, 'cert.modifier', { id: 5, date: '2025-05-05', motif: MOTIF }, /réservée/, 403);
  assert.equal(run(GEST, 'cert.modifier', { id: 5, date: '2025-05-03', motif: MOTIF }), 'Aucune modification');
  run(GEST, 'cert.modifier', { id: 5, date: '2025-05-05', motif: MOTIF });
  const c = ds().employes.find(e => e.id === 2)!.certs.find(x => x.id === 5)!;
  assert.deepEqual([c.obtenue, c.corrigeLe, c.corrigePar, c.corrigeMotif], ['2025-05-05', '2026-10-10', 'Antoine Leroy', MOTIF]);
  for (const u of [KARIM, MEHDI, HSE]) assert.equal(buildSnapshot(db, u).employes.find(e => e.id === 2)!.certs.find(x => x.id === 5)!.corrigeMotif, null, `${u.nom} : sans motif`);
  const j = derniere('cert.modifier')!;
  assert.deepEqual([j.payload.avant, j.payload.apres], [{ obtenue: '2025-05-03' }, { obtenue: '2025-05-05' }]);
  assert.ok(!JSON.stringify(j).includes('4471'));

  // Thomas Garnier : habilitation électrique inscrite à la session du 27 octobre (certification 16), électricité suspendue.
  const inscrits = () => ds().sessions.find(s => s.id === 5)!.inscrits;
  assert.equal(inscrits(), 1);
  assert.match(run(RH, 'cert.modifier', { id: 16, f: 'sst', motif: MOTIF }), /formation : SST.*inscription à la session du 27 oct\. 2026 annulée/);
  assert.equal(inscrits(), 0, 'place libérée');
  const t = ds().employes.find(e => e.id === 6)!.certs.find(x => x.id === 16)!;
  assert.deepEqual([t.f, t.sessionId, t.convoc], ['sst', null, null]);
});

test('certification annulée : place de session libérée, résultat de clôture détaché, reprise des places sans elle', () => {
  const { db, run, ds, RH } = fresh();
  // Lucas Martin : CACES R489 inscrit à la session du 21 octobre (certification 11), habilitation ac489 qui s'appuie dessus.
  assert.equal(ds().sessions.find(s => s.id === 3)!.inscrits, 2);
  run(RH, 'hab.suspendre', { empId: 4, h: 'ac489', motif: 'Contrôle' });
  assert.match(run(RH, 'cert.annuler', { id: 11, motif: MOTIF }), /inscription à la session du 21 oct\. 2026 annulée/);
  assert.equal(ds().sessions.find(s => s.id === 3)!.inscrits, 1);
  // Certification issue d'une clôture : le résultat ne la désigne plus.
  const p = db.insert<{ id: number }>('participations', { sessionId: 6, empId: 5, parcours: 'recyclage', present: true, reussi: null, certId: 13 });
  run(RH, 'cert.annuler', { id: 13, motif: MOTIF });
  assert.equal(db.get<Ligne>('participations', p.id)!.certId, null);
  // Une certification annulée plus récente ne libère pas la place de la précédente au démarrage.
  db.insert('certifications', { empId: 3, f: 'epi', obtenue: '2026-10-01', sessionId: null, convoc: null, annuleLe: '2026-10-05', annulePar: 'X', annuleMotif: 'Erreur' });
  db.update('certifications', 8, { sessionId: 12, convoc: 'later' });
  libererPlacesRemplacees(db);
  assert.equal(db.get<Ligne>('certifications', 8)!.sessionId, 12);
});

// — Plan de formation —

test('ligne du plan : correction motivée, formation figée par une session, suppression hors des sommes', () => {
  const { run, refus, ds, domain, derniere, RH, GEST } = fresh();
  const ligne = (id: number) => ds().plan.find(l => l.id === id);
  refus(GEST, 'plan.modifier', { id: 11, periode: 'T3', motif: '' }, /Motif de la correction obligatoire/);
  refus(GEST, 'plan.modifier', { id: 11, periode: 'T5', motif: MOTIF }, /Choisissez le trimestre/);
  refus(GEST, 'plan.modifier', { id: 11, equipe: 'Inconnue', motif: MOTIF }, /Équipe inconnue/);
  refus(GEST, 'plan.modifier', { id: 11, effectif: 0, motif: MOTIF }, /Nombre entier/);
  assert.match(run(GEST, 'plan.modifier', { id: 11, periode: 'T3', effectif: 3, cout: '2 100', motif: MOTIF }), /corrigée — période : T3 · effectif : 3 · coût prévu : 2/);
  assert.deepEqual([ligne(11)!.periode, ligne(11)!.effectif, ligne(11)!.cout, ligne(11)!.corrigePar], ['T3', 3, 2100, 'Antoine Leroy']);
  const j = derniere('plan.modifier')!;
  assert.deepEqual(j.payload.apres, { periode: 'T3', effectif: 3, cout: 2100 });
  // Hors catalogue : l'intitulé n'est pas recopié au journal.
  run(GEST, 'plan.modifier', { id: 13, f: '', libelle: 'Formation réseaux enterrés', motif: MOTIF });
  assert.equal(derniere('plan.modifier')!.payload.apres.libelle, '[texte renseigné]');
  // Ligne engagée par la session du 27 octobre : sa formation ne change pas, le reste oui ; elle ne se supprime pas.
  refus(GEST, 'plan.modifier', { id: 9, f: 'sst', motif: MOTIF }, /session est rattachée/);
  run(GEST, 'plan.modifier', { id: 9, periode: 'T3', motif: MOTIF });
  refus(RH, 'plan.supprimer', { id: 9, motif: MOTIF }, /annulez d’abord la session/);
  assert.equal(refusSuppressionLigne(domain(), ligne(1)!), 'Action réalisée : elle ne se supprime plus');
  refus(RH, 'plan.modifier', { id: 1, cout: 10, motif: MOTIF }, /réalisée, elle ne se modifie plus/);
  // Suppression : administrateur RH, ligne gardée en base mais hors de l'instantané et du prévu.
  refus(GEST, 'plan.supprimer', { id: 12, motif: MOTIF }, /administrateur RH/, 403);
  const prevu = () => budgetSummary(domain(), 2026, 80).prevu;
  const avant = prevu();
  run(RH, 'plan.supprimer', { id: 12, motif: MOTIF });
  assert.equal(ligne(12), undefined);
  assert.ok(prevu() < avant, 'retirée du prévu');
  assert.deepEqual(derniere('plan.supprimer')!.payload.exercice, 2026);
  assert.ok(!JSON.stringify(derniere('plan.supprimer')).includes('4471'));
  refus(RH, 'plan.supprimer', { id: 12, motif: MOTIF }, /introuvable/, 404);
});

test('ligne du plan : exercice clos refusé, contrôle du dialogue identique au serveur', () => {
  const { db, refus, domain, RH } = fresh();
  db.insert('exercicesClos', { exercice: 2026, le: '2026-10-01', par: 'X' });
  refus(RH, 'plan.modifier', { id: 11, periode: 'T3', motif: MOTIF }, /Exercice 2026 clos/);
  refus(RH, 'plan.supprimer', { id: 11, motif: MOTIF }, /Exercice 2026 clos/);
  const d = domain(), l = d.ds.plan.find(x => x.id === 9)!;
  const e = erreursLignePlan(d, l, { f: 'sst', libelle: '', equipe: 'Maintenance', periode: 'T2', effectif: '2', cout: '-1' });
  assert.match(e.formation!, /session est rattachée/);
  assert.match(e.cout!, /0 ou plus/);
  assert.equal(e.equipe, null);
});

// — Demandes —

test('demande retirée par son auteur seul, tant qu’elle attend', () => {
  const { run, refus, ds, user, RH } = fresh();
  const SOPHIE = user(3, 'collaborateur'), SOPHIE_MGR = user(3, 'manager'), MARION = user(13, 'collaborateur');
  // Demande 2 : Sophie, pour elle-même (habilitation hauteur) ; demande 1 : Sophie (manager) pour Marion.
  refus(RH, 'demande.annuler', { id: 2 }, /Seul l’auteur/, 403);
  refus(MARION, 'demande.annuler', { id: 1 }, /faite par votre manager/, 403);
  assert.equal(run(SOPHIE, 'demande.annuler', { id: 2 }), 'Demande retirée');
  assert.equal(run(SOPHIE_MGR, 'demande.annuler', { id: 1 }), 'Demande pour Marion Petit retirée');
  const r = ds().demandesCollab.find(x => x.id === 2)!;
  assert.deepEqual([r.statut, r.reponse], ['retiree', 'Retirée le 10 oct. 2026']);
  refus(SOPHIE, 'demande.annuler', { id: 2 }, /déjà traitée/);
  refus(RH, 'demande.reouvrir', { id: 2, motif: MOTIF }, /retirée par son auteur/);
});

test('demande rouverte : inscription, ligne du plan ou titre en attente défaits, demande de nouveau à décider', () => {
  const { db, run, refus, ds, domain, derniere, RH, HSE, user } = fresh();
  const demande = (id: number) => ds().demandesCollab.find(x => x.id === id)!;
  // Demande 1 : Marion Petit, CACES R489 à la session du 25 novembre → inscription en formation initiale.
  run(RH, 'demande.accepter', { id: 1 });
  assert.equal(ds().sessions.find(s => s.id === 4)!.inscrits, 1);
  assert.equal(demande(1).suite!.sessionId, 4);
  assert.deepEqual(effetsReouverture(domain(), demande(1), domain().emp(13)!).length, 1);
  refus(RH, 'demande.reouvrir', { id: 1 }, /Motif de la correction obligatoire/);
  assert.match(run(HSE, 'demande.reouvrir', { id: 1, motif: MOTIF }), /Demande de Marion Petit rouverte.*retiré de la session du 25 nov\. 2026/);
  assert.equal(ds().sessions.find(s => s.id === 4)!.inscrits, 0);
  assert.ok(!ds().inscriptions.some(i => i.empId === 13 && i.sessionId === 4));
  const r = demande(1);
  assert.deepEqual([r.statut, r.reponse, r.suite, r.rouvertePar, r.rouverteMotif], ['attente', null, null, 'Sarah Cohen', MOTIF]);
  // Motif de la réouverture : service RH seulement.
  assert.equal(buildSnapshot(db, user(13, 'collaborateur')).demandesCollab.find(x => x.id === 1)!.rouverteMotif, null);
  assert.equal(buildSnapshot(db, HSE).demandesCollab.find(x => x.id === 1)!.rouverteMotif, null);
  assert.deepEqual([derniere('demande.reouvrir')!.payload.avant, derniere('demande.reouvrir')!.payload.apres], [{ statut: 'acceptee' }, { statut: 'attente' }]);

  // Demande 2 : Sophie, habilitation hauteur → titre en attente de délivrance, retiré à la réouverture.
  run(RH, 'demande.accepter', { id: 2 });
  assert.ok(ds().employes.find(e => e.id === 3)!.habs.some(h => h.h === 'hauteur' && !h.delivree));
  run(RH, 'demande.reouvrir', { id: 2, motif: MOTIF });
  assert.ok(!ds().employes.find(e => e.id === 3)!.habs.some(h => h.h === 'hauteur'));
  // Délivrée depuis l'acceptation : la demande ne se rouvre plus.
  run(RH, 'demande.accepter', { id: 2 });
  db.update('habTitres', ds().employes.find(e => e.id === 3)!.habs.find(h => h.h === 'hauteur')!.id, { delivree: '2026-10-09', par: 'X', demande: null });
  refus(RH, 'demande.reouvrir', { id: 2, motif: MOTIF }, /délivrée depuis l’acceptation/);

  // Demande 4 : refusée (Anglais technique) → simplement de nouveau en attente, sans motif de refus.
  run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  assert.deepEqual([demande(4).statut, demande(4).motifRefus ?? null], ['attente', null]);
  // Acceptée sans session : ligne ajoutée au plan, supprimée à la réouverture… sauf une fois engagée.
  run(RH, 'demande.accepter', { id: 4 });
  const planId = demande(4).suite!.planId!;
  assert.ok(ds().plan.some(l => l.id === planId));
  run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  assert.ok(!ds().plan.some(l => l.id === planId), 'ligne retirée du plan');
  assert.equal(db.get<Ligne>('planActions', planId)!.annuleMotif, MOTIF);
  run(RH, 'demande.accepter', { id: 4 });
  run(RH, 'plan.avancer', { id: demande(4).suite!.planId, de: 'prevu' });
  refus(RH, 'demande.reouvrir', { id: 4, motif: MOTIF }, /déjà engagée/);
  // Document déclaré : jamais rouvert.
  refus(RH, 'demande.reouvrir', { id: 3, motif: MOTIF }, /ne se rouvre pas/);
});

test('certification corrigée devenue la plus récente : la remplacée quitte sa session ; demande inscrite sur un titre effacée', () => {
  const { db, run, ds, domain, RH } = fresh();
  // Thomas Garnier : électricité du 20 janvier 2024 inscrite à la session du 27 octobre. Une ancienne saisie, redatée
  // après elle, devient la certification en vigueur : la remplacée n'a plus rien à faire à la session.
  const ancienne = db.insert<{ id: number }>('certifications', { empId: 6, f: 'elec', obtenue: '2020-01-01', sessionId: null, convoc: null }).id;
  assert.match(run(RH, 'cert.modifier', { id: ancienne, date: '2026-10-01', motif: MOTIF }), /certification remplacée retirée de la session du 27 oct\. 2026/);
  assert.equal(ds().sessions.find(s => s.id === 5)!.inscrits, 0);
  // Mehdi : habilitation électrique expirée, renouvellement demandé puis accepté (demande inscrite sur le titre).
  const id = db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'habilitation', f: null, h: 'he', libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: 'attente', reponse: null, parId: null,
  }).id;
  run(RH, 'demande.accepter', { id });
  const r = () => ds().demandesCollab.find(x => x.id === id)!;
  assert.deepEqual(effetsReouverture(domain(), r(), domain().emp(2)!), ['La demande inscrite sur le titre (renouvellement ou nouvelle délivrance) est effacée.']);
  assert.match(run(RH, 'demande.reouvrir', { id, motif: MOTIF }), /demande effacée du titre/);
  assert.equal(ds().employes.find(e => e.id === 2)!.habs.find(h => h.h === 'he')!.demande, null);
  // Réouverture d'une demande refusée : rien à défaire ; ce que la confirmation annonce d'une acceptation dans le plan.
  assert.deepEqual(effetsReouverture(domain(), { ...r(), statut: 'refusee' }, domain().emp(2)!), []);
  run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  run(RH, 'demande.accepter', { id: 4 });
  assert.match(effetsReouverture(domain(), ds().demandesCollab.find(x => x.id === 4)!, domain().emp(19)!)[0], /ligne ajoutée au plan/);
});

test('demande acceptée avant l’enregistrement de sa suite : retrouvée d’après la demande', () => {
  const { db, run, ds, RH } = fresh();
  run(RH, 'demande.accepter', { id: 1 });
  db.update('demandesCollab', 1, { suite: null });
  run(RH, 'demande.reouvrir', { id: 1, motif: MOTIF });
  assert.ok(!ds().inscriptions.some(i => i.empId === 13 && i.sessionId === 4));
});

test('certification annulée : l’inscription en formation initiale qu’elle avait close est rendue, ou signalée à refaire', () => {
  const { db, run, ds, domain, user, RH } = fresh();
  const inscrits = () => ds().sessions.find(s => s.id === 1)!.inscrits;
  // Aïcha Diallo (7) : inscrite et convoquée à la session SST du 14 octobre (inscription 1, 6 inscrits).
  assert.equal(inscrits(), 6);
  run(RH, 'cert.ajouter', { empId: 7, f: 'sst', date: '2026-10-01' });
  assert.equal(inscrits(), 5, 'la certification clôt l’inscription');
  const sst = () => ds().employes.find(e => e.id === 7)!.certs.find(c => c.f === 'sst')!;
  assert.deepEqual(sst().inscriptionsCloses!.map(i => [i.id, i.sessionId]), [[1, 1]]);
  // Gardées pour le service RH seulement.
  assert.equal(buildSnapshot(db, user(7, 'collaborateur')).employes.find(e => e.id === 7)!.certs.find(c => c.f === 'sst')!.inscriptionsCloses, null);
  // La confirmation l'annonce, comme le serveur.
  const emp = domain().emp(7)!;
  assert.deepEqual(inscriptionsARendre(domain(), emp, sst(), certsApres(emp.certs, sst().id)).map(r => [r.i.id, r.refus]), [[1, null]]);
  assert.match(run(RH, 'cert.annuler', { id: sst().id, motif: MOTIF }), /supprimée du dossier de Aïcha Diallo · inscription SST à la session du 14 oct\. 2026 rétablie/);
  assert.equal(inscrits(), 6);
  assert.deepEqual(db.get<Ligne>('inscriptions', 1), { id: 1, empId: 7, sessionId: 1, convoc: 'now', date: '2026-09-28', convocLe: '2026-09-28' }, 'telle qu’elle était');

  // Session devenue complète entre-temps : pas de surréservation, le message dit de réinscrire.
  run(RH, 'cert.ajouter', { empId: 7, f: 'sst', date: '2026-10-02' });
  db.update('sessions', 1, { places: 5 });
  assert.match(run(RH, 'cert.annuler', { id: sst().id, motif: MOTIF }), /retour impossible \(session complète\), salarié à réinscrire/);
  assert.equal(inscrits(), 5);
  assert.ok(!ds().inscriptions.some(i => i.empId === 7 && i.sessionId === 1));

  // Formation changée par une correction : l'inscription close à l'ancienne formation est rendue.
  db.update('sessions', 1, { places: 12 });
  db.insert('inscriptions', { empId: 7, sessionId: 1, convoc: 'later', date: '2026-10-10', convocLe: null });
  run(RH, 'cert.ajouter', { empId: 7, f: 'sst', date: '2026-10-03' });
  const id = sst().id;
  assert.match(run(RH, 'cert.modifier', { id, f: 'prap', motif: MOTIF }), /inscription SST à la session du 14 oct\. 2026 rétablie/);
  assert.ok(ds().inscriptions.some(i => i.empId === 7 && i.sessionId === 1));
});

test('demande rouverte : retour à la session quittée seulement si elle l’accueille encore (places, date)', () => {
  const { db, run, ds, domain, derniere, RH } = fresh();
  const demande = (empId: number, f: string, sessionId: number) => db.insert<{ id: number }>('demandesCollab', {
    empId, type: 'formation', f, h: null, libelle: null, label: null, sessionId, motif: null, date: '2026-10-05', statut: 'attente', reponse: null, parId: null, declaration: null,
  }).id;
  const inscrits = (id: number) => ds().sessions.find(s => s.id === id)!.inscrits;
  // Camille Roux (1) : recyclage SST à la session du 14 octobre (6 inscrits) ; demande pour celle du 18 novembre.
  const a = demande(1, 'sst', 2);
  run(RH, 'demande.accepter', { id: a });
  assert.equal(inscrits(1), 5);
  // Les places du 14 octobre sont ramenées à 5 : la place libérée est reprise.
  db.update('sessions', 1, { places: 5 });
  const r = ds().demandesCollab.find(x => x.id === a)!;
  assert.deepEqual(effetsReouverture(domain(), r, domain().emp(1)!).slice(1), ['Retour à la session du 14 oct. 2026 impossible (session complète) : le recyclage redevient à planifier.']);
  assert.match(run(RH, 'demande.reouvrir', { id: a, motif: MOTIF }), /retiré de la session du 18 nov\. 2026.*retour à la session du 14 oct\. 2026 impossible \(session complète\) : recyclage à planifier/);
  assert.equal(inscrits(1), 5, 'pas de surréservation');
  assert.deepEqual([db.get<Ligne>('certifications', 2)!.sessionId, db.get<Ligne>('certifications', 2)!.convoc], [null, null]);
  // Le journal garde ce que la réouverture a défait (identifiants seulement).
  assert.deepEqual(derniere('demande.reouvrir')!.payload.defait, { sessionId: 2, certId: 2, retourSessionId: null });

  // Avec une place libre, le recyclage la retrouve.
  db.update('sessions', 1, { places: 12 });
  db.update('certifications', 2, { sessionId: 1, convoc: 'now' });
  const b = demande(1, 'sst', 2);
  run(RH, 'demande.accepter', { id: b });
  assert.match(run(RH, 'demande.reouvrir', { id: b, motif: MOTIF }), /de nouveau inscrit à la session du 14 oct\. 2026, convocation à envoyer/);
  assert.equal(db.get<Ligne>('certifications', 2)!.sessionId, 1);

  // Yanis Bouzid (20) : formation initiale CACES R489 du 21 octobre (inscription 5), déplacée au 25 novembre ; la session
  // du 21 octobre passe sans être clôturée : l'inscription n'y revient pas (elle bloquerait toute réinscription).
  const c = demande(20, 'caces489', 4);
  run(RH, 'demande.accepter', { id: c });
  assert.equal(db.get<Ligne>('inscriptions', 5)!.sessionId, 4);
  db.update('sessions', 3, { date: '2026-10-06', fin: '2026-10-08', jours: ['2026-10-06', '2026-10-07', '2026-10-08'] });
  assert.match(run(RH, 'demande.reouvrir', { id: c, motif: MOTIF }), /retour à la session du 6 oct\. 2026 impossible \(session commencée ou passée\) : inscription en formation initiale retirée, à refaire/);
  assert.equal(db.get<Ligne>('inscriptions', 5), undefined);
  assert.equal(inscrits(4), 0);
  assert.deepEqual(derniere('demande.reouvrir')!.payload.defait, { sessionId: 4, inscriptionId: 5, inscriptionRetiree: true, retourSessionId: null });
});

test('demande rouverte : la ligne du plan supprimée est tracée au journal (exercice, formation, équipe, coût)', () => {
  const { db, run, ds, derniere, RH } = fresh();
  // Demande 4 (Anglais technique), refusée : rouverte, puis acceptée sans session (ligne ajoutée au plan).
  run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  run(RH, 'demande.accepter', { id: 4 });
  const planId = ds().demandesCollab.find(x => x.id === 4)!.suite!.planId!;
  const l = db.get<Ligne>('planActions', planId)!;
  run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  const j = derniere('demande.reouvrir')!;
  assert.deepEqual(j.payload.defait, { planId, exercice: l.exercice, f: l.f, equipe: l.equipe, periode: l.periode, cout: l.cout });
  assert.ok(!JSON.stringify(j).includes('4471'), 'motif absent du journal');
});
