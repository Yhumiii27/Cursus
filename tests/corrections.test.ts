// Tests : corrections d'une saisie erronée (t119) — certification modifiée ou annulée (garde-fou des habilitations, place
// de session, historique réservé au service RH), ligne du plan corrigée ou supprimée, demande retirée par son auteur ou
// rouverte par le service RH (ce que l'acceptation avait créé est défait), journal sans motif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
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
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ligne = Record<string, any>;

const MOTIF = 'Saisie sur la mauvaise fiche — confidentiel 4471';

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  /** Chemin de POST /api/actions/:nom : état lu avant l'action, trace au journal après. */
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message as string;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, re: RegExp, status = 400) => await assert.rejects(async () => await run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message), `${name} : refus attendu ${re}`);
  const ds = async () => await loadFull(db, await user(null, 'rh'));
  const domain = async () => new Domain(await ds());
  const derniere = async (action: string) => (await db.all<Ligne>('journal')).findLast(j => j.action === action);
  return {
    db, user, run, refus, ds, domain, derniere,
    RH: await user(null, 'rh'), GEST: await user(14, 'rh'), HSE: await user(23, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur'),
  };
}

// — Certifications —

test('certification annulée : hors de tous les calculs, gardée pour le service RH seul, motif jamais au journal', async () => {
  const { db, run, refus, ds, domain, derniere, RH, GEST, KARIM, HSE, MEHDI } = await fresh();
  // Mehdi : SST du 3 mai 2025 (aucune habilitation ne s'appuie dessus).
  await refus(GEST, 'cert.annuler', { id: 5, motif: MOTIF }, /administrateur RH/, 403);
  await refus(RH, 'cert.annuler', { id: 5, motif: '  ' }, /Motif de la correction obligatoire/);
  const msg = await run(RH, 'cert.annuler', { id: 5, motif: MOTIF });
  assert.match(msg, /SST du 3 mai 2025 supprimée du dossier de Mehdi Benali/);
  const mehdi = (await ds()).employes.find(e => e.id === 2)!;
  assert.ok(!mehdi.certs.some(c => c.id === 5), 'hors des certifications du dossier');
  assert.deepEqual(mehdi.certsAnnulees!.map(c => [c.id, c.annuleLe, c.annulePar, c.annuleMotif]), [[5, '2026-10-10', 'Sandrine Vidal', MOTIF]]);
  assert.ok(!(await domain()).enrich(90, false).find(e => e.id === 2)!.rawCerts.some(c => c.f === 'sst'), 'plus de SST suivie');
  // Ni le manager, ni l'intéressé, ni le référent HSE ne reçoivent la certification annulée.
  for (const u of [KARIM, MEHDI, HSE]) {
    const e = (await buildSnapshot(db, u)).employes.find(x => x.id === 2)!;
    assert.deepEqual(e.certsAnnulees, [], `${u.nom} : rien d’annulé`);
    assert.ok(!e.certs.some(c => c.id === 5));
  }
  const j = (await derniere('cert.annuler'))!;
  assert.equal(j.payload.f, 'sst');
  assert.equal(j.payload.obtenue, '2025-05-03');
  assert.deepEqual(j.payload.apres, { annuleLe: '2026-10-10' });
  assert.ok(!JSON.stringify(j).includes('4471'), 'motif absent du journal');
  assert.ok(JOURNAL_LABEL['cert.annuler'] && JOURNAL_LABEL['cert.modifier']);
  await refus(RH, 'cert.annuler', { id: 5, motif: MOTIF }, /introuvable ou déjà supprimée/, 404);
});

test('certification : refus quand une habilitation délivrée s’appuie sur elle sans autre certification valide', async () => {
  const { run, refus, domain, ds, RH, HSE } = await fresh();
  const mehdi = async () => (await ds()).employes.find(e => e.id === 2)!;
  // Travail en hauteur de Mehdi : prérequis la formation hauteur du 10 janvier 2025 (certification 6).
  assert.deepEqual(habilitationsAppuyees(await domain(), await mehdi(), (await mehdi()).certs.filter(c => c.id !== 6)).map(a => a.h), ['hauteur']);
  await refus(RH, 'cert.annuler', { id: 6, motif: MOTIF }, /Suppression impossible : l’habilitation Autorisation travaux en hauteur \(Travail en hauteur\).*Suspendez d’abord/);
  // Une date qui la rendrait expirée fait tomber le prérequis ; une date voisine, non.
  await refus(HSE, 'cert.modifier', { id: 6, date: '2019-01-10', motif: MOTIF }, /Correction impossible/);
  await refus(HSE, 'cert.modifier', { id: 6, date: '2027-01-10', motif: MOTIF }, /postérieure à aujourd’hui/);
  assert.match(await run(HSE, 'cert.modifier', { id: 6, date: '2025-01-17', motif: MOTIF }), /corrigée — Mehdi Benali · obtenue le 17 janv\. 2025/);
  // Une certification plus récente de la même formation, saisie par erreur : la précédente, valide, suffit au prérequis,
  // la suppression passe sans refus et l'habilitation reste valide.
  const habHauteur = async () => (await domain()).enrich(90, false).find(e => e.id === 2)!.habs.find(h => h.h === 'hauteur')!.key;
  await run(RH, 'cert.ajouter', { empId: 2, f: 'hauteur', date: '2026-09-01' });
  const recente = (await mehdi()).certs.find(c => c.f === 'hauteur' && c.obtenue === '2026-09-01')!;
  assert.deepEqual(habilitationsAppuyees(await domain(), await mehdi(), (await mehdi()).certs.filter(c => c.id !== recente.id)), []);
  assert.match(await run(RH, 'cert.annuler', { id: recente.id, motif: MOTIF }), /certification du 17 janv\. 2025 de nouveau en vigueur/);
  assert.equal((await mehdi()).certs.find(c => c.f === 'hauteur')!.id, 6, 'celle du 10 (corrigée au 17) janvier 2025 revient en vigueur');
  assert.ok(['ok', 'due'].includes(await habHauteur()), 'habilitation hauteur toujours valide');
  // Suspendue, l'habilitation ne s'appuie plus sur rien : la suppression passe, l'habilitation reste suspendue.
  await run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Vérification du titre' });
  await run(RH, 'cert.annuler', { id: 6, motif: MOTIF });
  assert.equal((await domain()).enrich(90, false).find(e => e.id === 2)!.habs.find(h => h.h === 'hauteur')!.key, 'susp');
  // Une certification plus ancienne et valide prend le relais : pas de refus.
  await run(RH, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-09-01' });
  const nouvelle = (await mehdi()).certs.find(c => c.f === 'sst' && c.obtenue === '2026-09-01')!;
  await run(RH, 'cert.annuler', { id: nouvelle.id, motif: MOTIF });
  assert.equal((await mehdi()).certs.find(c => c.f === 'sst')!.obtenue, '2025-05-03', 'la précédente revient en vigueur');
});

test('certification modifiée : date et formation corrigées, motif réservé au service RH, session de l’ancienne formation quittée', async () => {
  const { db, run, refus, ds, derniere, RH, GEST, HSE, KARIM, MEHDI } = await fresh();
  await refus(KARIM, 'cert.modifier', { id: 5, date: '2025-05-05', motif: MOTIF }, /réservée au service RH et au référent HSE/, 403);
  await refus(MEHDI, 'cert.modifier', { id: 5, date: '2025-05-05', motif: MOTIF }, /réservée/, 403);
  assert.equal(await run(GEST, 'cert.modifier', { id: 5, date: '2025-05-03', motif: MOTIF }), 'Aucune modification');
  await run(GEST, 'cert.modifier', { id: 5, date: '2025-05-05', motif: MOTIF });
  const c = (await ds()).employes.find(e => e.id === 2)!.certs.find(x => x.id === 5)!;
  assert.deepEqual([c.obtenue, c.corrigeLe, c.corrigePar, c.corrigeMotif], ['2025-05-05', '2026-10-10', 'Antoine Leroy', MOTIF]);
  for (const u of [KARIM, MEHDI, HSE]) assert.equal((await buildSnapshot(db, u)).employes.find(e => e.id === 2)!.certs.find(x => x.id === 5)!.corrigeMotif, null, `${u.nom} : sans motif`);
  const j = (await derniere('cert.modifier'))!;
  assert.deepEqual([j.payload.avant, j.payload.apres], [{ obtenue: '2025-05-03' }, { obtenue: '2025-05-05' }]);
  assert.ok(!JSON.stringify(j).includes('4471'));

  // Thomas Garnier : habilitation électrique inscrite à la session du 27 octobre (certification 16), électricité suspendue.
  const inscrits = async () => (await ds()).sessions.find(s => s.id === 5)!.inscrits;
  assert.equal(await inscrits(), 1);
  assert.match(await run(RH, 'cert.modifier', { id: 16, f: 'sst', motif: MOTIF }), /formation : SST.*inscription à la session du 27 oct\. 2026 annulée/);
  assert.equal(await inscrits(), 0, 'place libérée');
  const t = (await ds()).employes.find(e => e.id === 6)!.certs.find(x => x.id === 16)!;
  assert.deepEqual([t.f, t.sessionId, t.convoc], ['sst', null, null]);
});

test('certification annulée : place de session libérée, résultat de clôture détaché, reprise des places sans elle', async () => {
  const { db, run, ds, RH } = await fresh();
  // Lucas Martin : CACES R489 inscrit à la session du 21 octobre (certification 11), habilitation ac489 qui s'appuie dessus.
  assert.equal((await ds()).sessions.find(s => s.id === 3)!.inscrits, 2);
  await run(RH, 'hab.suspendre', { empId: 4, h: 'ac489', motif: 'Contrôle' });
  assert.match(await run(RH, 'cert.annuler', { id: 11, motif: MOTIF }), /inscription à la session du 21 oct\. 2026 annulée/);
  assert.equal((await ds()).sessions.find(s => s.id === 3)!.inscrits, 1);
  // Certification issue d'une clôture : le résultat ne la désigne plus.
  const p = await db.insert<{ id: number }>('participations', { sessionId: 6, empId: 5, parcours: 'recyclage', present: true, reussi: null, certId: 13 });
  await run(RH, 'cert.annuler', { id: 13, motif: MOTIF });
  assert.equal((await db.get<Ligne>('participations', p.id))!.certId, null);
  // Une certification annulée plus récente ne libère pas la place de la précédente au démarrage.
  await db.insert('certifications', { empId: 3, f: 'epi', obtenue: '2026-10-01', sessionId: null, convoc: null, annuleLe: '2026-10-05', annulePar: 'X', annuleMotif: 'Erreur' });
  await db.update('certifications', 8, { sessionId: 12, convoc: 'later' });
  await libererPlacesRemplacees(db);
  assert.equal((await db.get<Ligne>('certifications', 8))!.sessionId, 12);
});

// — Plan de formation —

test('ligne du plan : correction motivée, formation figée par une session, suppression hors des sommes', async () => {
  const { run, refus, ds, domain, derniere, RH, GEST } = await fresh();
  const ligne = async (id: number) => (await ds()).plan.find(l => l.id === id);
  await refus(GEST, 'plan.modifier', { id: 11, periode: 'T3', motif: '' }, /Motif de la correction obligatoire/);
  await refus(GEST, 'plan.modifier', { id: 11, periode: 'T5', motif: MOTIF }, /Choisissez le trimestre/);
  await refus(GEST, 'plan.modifier', { id: 11, equipe: 'Inconnue', motif: MOTIF }, /Équipe inconnue/);
  await refus(GEST, 'plan.modifier', { id: 11, effectif: 0, motif: MOTIF }, /Nombre entier/);
  assert.match(await run(GEST, 'plan.modifier', { id: 11, periode: 'T3', effectif: 3, cout: '2 100', motif: MOTIF }), /corrigée — période : T3 · effectif : 3 · coût prévu : 2/);
  assert.deepEqual([(await ligne(11))!.periode, (await ligne(11))!.effectif, (await ligne(11))!.cout, (await ligne(11))!.corrigePar], ['T3', 3, 2100, 'Antoine Leroy']);
  const j = (await derniere('plan.modifier'))!;
  assert.deepEqual(j.payload.apres, { periode: 'T3', effectif: 3, cout: 2100 });
  // Hors catalogue : l'intitulé n'est pas recopié au journal.
  await run(GEST, 'plan.modifier', { id: 13, f: '', libelle: 'Formation réseaux enterrés', motif: MOTIF });
  assert.equal((await derniere('plan.modifier'))!.payload.apres.libelle, '[texte renseigné]');
  // Ligne engagée par la session du 27 octobre : sa formation ne change pas, le reste oui ; elle ne se supprime pas.
  await refus(GEST, 'plan.modifier', { id: 9, f: 'sst', motif: MOTIF }, /session est rattachée/);
  await run(GEST, 'plan.modifier', { id: 9, periode: 'T3', motif: MOTIF });
  await refus(RH, 'plan.supprimer', { id: 9, motif: MOTIF }, /annulez d’abord la session/);
  assert.equal(refusSuppressionLigne(await domain(), (await ligne(1))!), 'Action réalisée : elle ne se supprime plus');
  await refus(RH, 'plan.modifier', { id: 1, cout: 10, motif: MOTIF }, /réalisée, elle ne se modifie plus/);
  // Suppression : administrateur RH, ligne gardée en base mais hors de l'instantané et du prévu.
  await refus(GEST, 'plan.supprimer', { id: 12, motif: MOTIF }, /administrateur RH/, 403);
  const prevu = async () => budgetSummary(await domain(), 2026, 80).prevu;
  const avant = await prevu();
  await run(RH, 'plan.supprimer', { id: 12, motif: MOTIF });
  assert.equal(await ligne(12), undefined);
  assert.ok(await prevu() < avant, 'retirée du prévu');
  assert.deepEqual((await derniere('plan.supprimer'))!.payload.exercice, 2026);
  assert.ok(!JSON.stringify(await derniere('plan.supprimer')).includes('4471'));
  await refus(RH, 'plan.supprimer', { id: 12, motif: MOTIF }, /introuvable/, 404);
});

test('ligne du plan : exercice clos refusé, contrôle du dialogue identique au serveur', async () => {
  const { db, refus, domain, RH } = await fresh();
  await db.insert('exercicesClos', { exercice: 2026, le: '2026-10-01', par: 'X' });
  await refus(RH, 'plan.modifier', { id: 11, periode: 'T3', motif: MOTIF }, /Exercice 2026 clos/);
  await refus(RH, 'plan.supprimer', { id: 11, motif: MOTIF }, /Exercice 2026 clos/);
  const d = await domain(), l = d.ds.plan.find(x => x.id === 9)!;
  const e = erreursLignePlan(d, l, { f: 'sst', libelle: '', equipe: 'Maintenance', periode: 'T2', effectif: '2', cout: '-1' });
  assert.match(e.formation!, /session est rattachée/);
  assert.match(e.cout!, /0 ou plus/);
  assert.equal(e.equipe, null);
});

// — Demandes —

test('demande retirée par son auteur seul, tant qu’elle attend', async () => {
  const { run, refus, ds, user, RH } = await fresh();
  const SOPHIE = await user(3, 'collaborateur'), SOPHIE_MGR = await user(3, 'manager'), MARION = await user(13, 'collaborateur');
  // Demande 2 : Sophie, pour elle-même (habilitation hauteur) ; demande 1 : Sophie (manager) pour Marion.
  await refus(RH, 'demande.annuler', { id: 2 }, /Seul l’auteur/, 403);
  await refus(MARION, 'demande.annuler', { id: 1 }, /faite par votre manager/, 403);
  assert.equal(await run(SOPHIE, 'demande.annuler', { id: 2 }), 'Demande retirée');
  assert.equal(await run(SOPHIE_MGR, 'demande.annuler', { id: 1 }), 'Demande pour Marion Petit retirée');
  const r = (await ds()).demandesCollab.find(x => x.id === 2)!;
  assert.deepEqual([r.statut, r.reponse], ['retiree', 'Retirée le 10 oct. 2026']);
  await refus(SOPHIE, 'demande.annuler', { id: 2 }, /déjà traitée/);
  await refus(RH, 'demande.reouvrir', { id: 2, motif: MOTIF }, /retirée par son auteur/);
});

test('demande rouverte : inscription, ligne du plan ou titre en attente défaits, demande de nouveau à décider', async () => {
  const { db, run, refus, ds, domain, derniere, RH, HSE, user } = await fresh();
  const demande = async (id: number) => (await ds()).demandesCollab.find(x => x.id === id)!;
  // Demande 1 : Marion Petit, CACES R489 à la session du 25 novembre → inscription en formation initiale.
  await run(RH, 'demande.accepter', { id: 1 });
  assert.equal((await ds()).sessions.find(s => s.id === 4)!.inscrits, 1);
  assert.equal((await demande(1)).suite!.sessionId, 4);
  assert.deepEqual(effetsReouverture(await domain(), await demande(1), (await domain()).emp(13)!).length, 1);
  await refus(RH, 'demande.reouvrir', { id: 1 }, /Motif de la correction obligatoire/);
  assert.match(await run(HSE, 'demande.reouvrir', { id: 1, motif: MOTIF }), /Demande de Marion Petit rouverte.*retiré de la session du 25 nov\. 2026/);
  assert.equal((await ds()).sessions.find(s => s.id === 4)!.inscrits, 0);
  assert.ok(!(await ds()).inscriptions.some(i => i.empId === 13 && i.sessionId === 4));
  const r = await demande(1);
  assert.deepEqual([r.statut, r.reponse, r.suite, r.rouvertePar, r.rouverteMotif], ['attente', null, null, 'Sarah Cohen', MOTIF]);
  // Motif de la réouverture : service RH seulement.
  assert.equal((await buildSnapshot(db, await user(13, 'collaborateur'))).demandesCollab.find(x => x.id === 1)!.rouverteMotif, null);
  assert.equal((await buildSnapshot(db, HSE)).demandesCollab.find(x => x.id === 1)!.rouverteMotif, null);
  assert.deepEqual([(await derniere('demande.reouvrir'))!.payload.avant, (await derniere('demande.reouvrir'))!.payload.apres], [{ statut: 'acceptee' }, { statut: 'attente' }]);

  // Demande 2 : Sophie, habilitation hauteur → titre en attente de délivrance, retiré à la réouverture.
  await run(RH, 'demande.accepter', { id: 2 });
  assert.ok((await ds()).employes.find(e => e.id === 3)!.habs.some(h => h.h === 'hauteur' && !h.delivree));
  await run(RH, 'demande.reouvrir', { id: 2, motif: MOTIF });
  assert.ok(!(await ds()).employes.find(e => e.id === 3)!.habs.some(h => h.h === 'hauteur'));
  // Délivrée depuis l'acceptation : la demande ne se rouvre plus.
  await run(RH, 'demande.accepter', { id: 2 });
  await db.update('habTitres', (await ds()).employes.find(e => e.id === 3)!.habs.find(h => h.h === 'hauteur')!.id, { delivree: '2026-10-09', par: 'X', demande: null });
  await refus(RH, 'demande.reouvrir', { id: 2, motif: MOTIF }, /délivrée depuis l’acceptation/);

  // Demande 4 : refusée (Anglais technique) → simplement de nouveau en attente, sans motif de refus.
  await run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  assert.deepEqual([(await demande(4)).statut, (await demande(4)).motifRefus ?? null], ['attente', null]);
  // Acceptée sans session : ligne ajoutée au plan, supprimée à la réouverture… sauf une fois engagée.
  await run(RH, 'demande.accepter', { id: 4 });
  const planId = (await demande(4)).suite!.planId!;
  assert.ok((await ds()).plan.some(l => l.id === planId));
  await run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  assert.ok(!(await ds()).plan.some(l => l.id === planId), 'ligne retirée du plan');
  assert.equal((await db.get<Ligne>('planActions', planId))!.annuleMotif, MOTIF);
  await run(RH, 'demande.accepter', { id: 4 });
  await run(RH, 'plan.avancer', { id: (await demande(4)).suite!.planId, de: 'prevu' });
  await refus(RH, 'demande.reouvrir', { id: 4, motif: MOTIF }, /déjà engagée/);
  // Document déclaré : jamais rouvert.
  await refus(RH, 'demande.reouvrir', { id: 3, motif: MOTIF }, /ne se rouvre pas/);
});

test('certification corrigée devenue la plus récente : la remplacée quitte sa session ; demande inscrite sur un titre effacée', async () => {
  const { db, run, ds, domain, RH } = await fresh();
  // Thomas Garnier : électricité du 20 janvier 2024 inscrite à la session du 27 octobre. Une ancienne saisie, redatée
  // après elle, devient la certification en vigueur : la remplacée n'a plus rien à faire à la session.
  const ancienne = (await db.insert<{ id: number }>('certifications', { empId: 6, f: 'elec', obtenue: '2020-01-01', sessionId: null, convoc: null })).id;
  assert.match(await run(RH, 'cert.modifier', { id: ancienne, date: '2026-10-01', motif: MOTIF }), /certification remplacée retirée de la session du 27 oct\. 2026/);
  assert.equal((await ds()).sessions.find(s => s.id === 5)!.inscrits, 0);
  // Mehdi : habilitation électrique expirée, renouvellement demandé puis accepté (demande inscrite sur le titre).
  const id = (await db.insert<{ id: number }>('demandesCollab', {
    empId: 2, type: 'habilitation', f: null, h: 'he', libelle: null, label: null, sessionId: null, motif: 'Chantier', date: '2026-10-06', statut: 'attente', reponse: null, parId: null,
  })).id;
  await run(RH, 'demande.accepter', { id });
  const r = async () => (await ds()).demandesCollab.find(x => x.id === id)!;
  assert.deepEqual(effetsReouverture(await domain(), await r(), (await domain()).emp(2)!), ['La demande inscrite sur le titre (renouvellement ou nouvelle délivrance) est effacée.']);
  assert.match(await run(RH, 'demande.reouvrir', { id, motif: MOTIF }), /demande effacée du titre/);
  assert.equal((await ds()).employes.find(e => e.id === 2)!.habs.find(h => h.h === 'he')!.demande, null);
  // Réouverture d'une demande refusée : rien à défaire ; ce que la confirmation annonce d'une acceptation dans le plan.
  assert.deepEqual(effetsReouverture(await domain(), { ...await r(), statut: 'refusee' }, (await domain()).emp(2)!), []);
  await run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  await run(RH, 'demande.accepter', { id: 4 });
  assert.match(effetsReouverture(await domain(), (await ds()).demandesCollab.find(x => x.id === 4)!, (await domain()).emp(19)!)[0], /ligne ajoutée au plan/);
});

test('demande acceptée avant l’enregistrement de sa suite : retrouvée d’après la demande', async () => {
  const { db, run, ds, RH } = await fresh();
  await run(RH, 'demande.accepter', { id: 1 });
  await db.update('demandesCollab', 1, { suite: null });
  await run(RH, 'demande.reouvrir', { id: 1, motif: MOTIF });
  assert.ok(!(await ds()).inscriptions.some(i => i.empId === 13 && i.sessionId === 4));
});

test('certification annulée : l’inscription en formation initiale qu’elle avait close est rendue, ou signalée à refaire', async () => {
  const { db, run, ds, domain, user, RH } = await fresh();
  const inscrits = async () => (await ds()).sessions.find(s => s.id === 1)!.inscrits;
  // Aïcha Diallo (7) : inscrite et convoquée à la session SST du 14 octobre (inscription 1, 6 inscrits).
  assert.equal(await inscrits(), 6);
  await run(RH, 'cert.ajouter', { empId: 7, f: 'sst', date: '2026-10-01' });
  assert.equal(await inscrits(), 5, 'la certification clôt l’inscription');
  const sst = async () => (await ds()).employes.find(e => e.id === 7)!.certs.find(c => c.f === 'sst')!;
  assert.deepEqual((await sst()).inscriptionsCloses!.map(i => [i.id, i.sessionId]), [[1, 1]]);
  // Gardées pour le service RH seulement.
  assert.equal((await buildSnapshot(db, await user(7, 'collaborateur'))).employes.find(e => e.id === 7)!.certs.find(c => c.f === 'sst')!.inscriptionsCloses, null);
  // La confirmation l'annonce, comme le serveur.
  const emp = (await domain()).emp(7)!;
  assert.deepEqual(inscriptionsARendre(await domain(), emp, await sst(), certsApres(emp.certs, (await sst()).id)).map(r => [r.i.id, r.refus]), [[1, null]]);
  assert.match(await run(RH, 'cert.annuler', { id: (await sst()).id, motif: MOTIF }), /supprimée du dossier de Aïcha Diallo · inscription SST à la session du 14 oct\. 2026 rétablie/);
  assert.equal(await inscrits(), 6);
  assert.deepEqual(await db.get<Ligne>('inscriptions', 1), { id: 1, empId: 7, sessionId: 1, convoc: 'now', date: '2026-09-28', convocLe: '2026-09-28' }, 'telle qu’elle était');

  // Session devenue complète entre-temps : pas de surréservation, le message dit de réinscrire.
  await run(RH, 'cert.ajouter', { empId: 7, f: 'sst', date: '2026-10-02' });
  await db.update('sessions', 1, { places: 5 });
  assert.match(await run(RH, 'cert.annuler', { id: (await sst()).id, motif: MOTIF }), /retour impossible \(session complète\), salarié à réinscrire/);
  assert.equal(await inscrits(), 5);
  assert.ok(!(await ds()).inscriptions.some(i => i.empId === 7 && i.sessionId === 1));

  // Formation changée par une correction : l'inscription close à l'ancienne formation est rendue.
  await db.update('sessions', 1, { places: 12 });
  await db.insert('inscriptions', { empId: 7, sessionId: 1, convoc: 'later', date: '2026-10-10', convocLe: null });
  await run(RH, 'cert.ajouter', { empId: 7, f: 'sst', date: '2026-10-03' });
  const id = (await sst()).id;
  assert.match(await run(RH, 'cert.modifier', { id, f: 'prap', motif: MOTIF }), /inscription SST à la session du 14 oct\. 2026 rétablie/);
  assert.ok((await ds()).inscriptions.some(i => i.empId === 7 && i.sessionId === 1));
});

test('demande rouverte : retour à la session quittée seulement si elle l’accueille encore (places, date)', async () => {
  const { db, run, ds, domain, derniere, RH } = await fresh();
  const demande = async (empId: number, f: string, sessionId: number) => (await db.insert<{ id: number }>('demandesCollab', {
    empId, type: 'formation', f, h: null, libelle: null, label: null, sessionId, motif: null, date: '2026-10-05', statut: 'attente', reponse: null, parId: null, declaration: null,
  })).id;
  const inscrits = async (id: number) => (await ds()).sessions.find(s => s.id === id)!.inscrits;
  // Camille Roux (1) : recyclage SST à la session du 14 octobre (6 inscrits) ; demande pour celle du 18 novembre.
  const a = await demande(1, 'sst', 2);
  await run(RH, 'demande.accepter', { id: a });
  assert.equal(await inscrits(1), 5);
  // Les places du 14 octobre sont ramenées à 5 : la place libérée est reprise.
  await db.update('sessions', 1, { places: 5 });
  const r = (await ds()).demandesCollab.find(x => x.id === a)!;
  assert.deepEqual(effetsReouverture(await domain(), r, (await domain()).emp(1)!).slice(1), ['Retour à la session du 14 oct. 2026 impossible (session complète) : le recyclage redevient à planifier.']);
  assert.match(await run(RH, 'demande.reouvrir', { id: a, motif: MOTIF }), /retiré de la session du 18 nov\. 2026.*retour à la session du 14 oct\. 2026 impossible \(session complète\) : recyclage à planifier/);
  assert.equal(await inscrits(1), 5, 'pas de surréservation');
  assert.deepEqual([(await db.get<Ligne>('certifications', 2))!.sessionId, (await db.get<Ligne>('certifications', 2))!.convoc], [null, null]);
  // Le journal garde ce que la réouverture a défait (identifiants seulement).
  assert.deepEqual((await derniere('demande.reouvrir'))!.payload.defait, { sessionId: 2, certId: 2, retourSessionId: null });

  // Avec une place libre, le recyclage la retrouve.
  await db.update('sessions', 1, { places: 12 });
  await db.update('certifications', 2, { sessionId: 1, convoc: 'now' });
  const b = await demande(1, 'sst', 2);
  await run(RH, 'demande.accepter', { id: b });
  assert.match(await run(RH, 'demande.reouvrir', { id: b, motif: MOTIF }), /de nouveau inscrit à la session du 14 oct\. 2026, convocation à envoyer/);
  assert.equal((await db.get<Ligne>('certifications', 2))!.sessionId, 1);

  // Yanis Bouzid (20) : formation initiale CACES R489 du 21 octobre (inscription 5), déplacée au 25 novembre ; la session
  // du 21 octobre passe sans être clôturée : l'inscription n'y revient pas (elle bloquerait toute réinscription).
  const c = await demande(20, 'caces489', 4);
  await run(RH, 'demande.accepter', { id: c });
  assert.equal((await db.get<Ligne>('inscriptions', 5))!.sessionId, 4);
  await db.update('sessions', 3, { date: '2026-10-06', fin: '2026-10-08', jours: ['2026-10-06', '2026-10-07', '2026-10-08'] });
  assert.match(await run(RH, 'demande.reouvrir', { id: c, motif: MOTIF }), /retour à la session du 6 oct\. 2026 impossible \(session commencée ou passée\) : inscription en formation initiale retirée, à refaire/);
  assert.equal(await db.get<Ligne>('inscriptions', 5), undefined);
  assert.equal(await inscrits(4), 0);
  assert.deepEqual((await derniere('demande.reouvrir'))!.payload.defait, { sessionId: 4, inscriptionId: 5, inscriptionRetiree: true, retourSessionId: null });
});

test('demande rouverte : la ligne du plan supprimée est tracée au journal (exercice, formation, équipe, coût)', async () => {
  const { db, run, ds, derniere, RH } = await fresh();
  // Demande 4 (Anglais technique), refusée : rouverte, puis acceptée sans session (ligne ajoutée au plan).
  await run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  await run(RH, 'demande.accepter', { id: 4 });
  const planId = (await ds()).demandesCollab.find(x => x.id === 4)!.suite!.planId!;
  const l = (await db.get<Ligne>('planActions', planId))!;
  await run(RH, 'demande.reouvrir', { id: 4, motif: MOTIF });
  const j = (await derniere('demande.reouvrir'))!;
  assert.deepEqual(j.payload.defait, { planId, exercice: l.exercice, f: l.f, equipe: l.equipe, periode: l.periode, cout: l.cout });
  assert.ok(!JSON.stringify(j).includes('4471'), 'motif absent du journal');
});
