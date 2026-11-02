// Notes de frais, lot 12, chantier C2, étape 2 (option des 2 mois, réponse du propriétaire du 1er novembre 2026) : les
// vues du service RH et de la comptabilité ne reçoivent les dépenses et justificatifs que des notes en circuit, annulées
// ou payées depuis moins de 2 mois ; les autres notes de la fenêtre de 13 mois y ont un résumé calculé par le serveur
// (`resumesFrais`) ; le manager et le collaborateur gardent tout le détail de la fenêtre :
// - règles pures : borne du détail, totaux d'une note par ses dépenses ou son résumé, totaux d'équipe, catégories ;
// - vues : résumés, parts réintégrables et alertes du service RH et de la comptabilité calculés sur l'instantané complet
//   (cumul kilométrique exact de l'année) ; rien pour la paie, le référent HSE et la lecture seule ;
// - prérequis de l'activation (Paramètres → Notes de frais) ; écran : notes plus anciennes et recherche de l'historique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser } = await import('../server/src/dataset.ts');
const { CHAMPS_PAR_SALARIE } = await import('../server/src/vues-cache.ts');
const { LECTURES } = await import('../server/src/lecture-brute.ts');
const F = await import('../shared/rules/frais-fenetre.ts');
const { prerequisFrais, RUBRIQUES_FRAIS } = await import('../shared/rules/frais-activation.ts');
const { REGLAGES } = await import('../shared/reglages.ts');
const { notesArchivees } = await import('./support/frais-archives.ts');
const H = await import('../client/src/components/frais/historique.ts');
const C = await import('../client/src/components/frais/commun.ts');
const { depensesParMois } = C;
const { Domain } = await import('../shared/domain.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { limitesIk } = await import('../shared/rules/frais-paie.ts');
const { alertesDeNote } = await import('../shared/rules/frais-alertes.ts');
const { totalReintegrable } = await import('../shared/rules/frais-politique.ts');
const { LIBELLES_ONGLETS_FRAIS, ongletFraisDe, ongletsFrais } = await import('../client/src/components/frais/onglets.ts');
import type { LigneFrais, NoteFrais, ResumeNoteFrais } from '../shared/types.ts';
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const T = '2026-10-10';

test('règle du détail : borne à 2 mois, notes en circuit, annulées et payées depuis moins de 2 mois détaillées', () => {
  assert.equal(F.DETAIL_FRAIS_MOIS, 2);
  assert.equal(F.borneDetailFrais(T), '2026-08-10');
  assert.equal(F.detailEnLigne({ statut: 'payee', payeeLe: '2026-08-09' }, T), false);
  assert.equal(F.detailEnLigne({ statut: 'payee', payeeLe: '2026-08-10' }, T), true, 'payée le jour de la borne : détaillée');
  assert.equal(F.detailEnLigne({ statut: 'annulee', payeeLe: null }, T), true);
  assert.equal(F.detailEnLigne({ statut: 'controlee', payeeLe: null }, T), true);
  assert.equal(F.detailEnLigne({ statut: 'payee', payeeLe: null }, T), true, 'payée sans date : gardée détaillée');
});

const ligne = (id: number, noteId: number, categorie: LigneFrais['categorie'], montantEur: number, o: Partial<LigneFrais> = {}) =>
  ({ id, noteId, empId: 2, categorie, montantEur, montantRetenu: null, refuseeLe: null, ...o }) as LigneFrais;
const resume = (noteId: number, o: Partial<ResumeNoteFrais> = {}): ResumeNoteFrais =>
  ({ noteId, empId: 2, depenses: 2, refusees: 1, demande: 50, retenu: 45, parCategorie: { repas: 20, train: 25 }, ...o });

test('totaux d’une note : dépenses de l’instantané, ou résumé ; totaux d’équipe et catégories des deux sources', () => {
  const lignes = [ligne(1, 10, 'repas', 12), ligne(2, 10, 'hotel', 80, { montantRetenu: 70 }), ligne(3, 10, 'taxi', 9, { refuseeLe: '2026-09-01' })];
  const resumes = [resume(20), resume(30, { empId: 2, parCategorie: { medical: 40 }, retenu: 40, demande: 40, depenses: 1, refusees: 0 })];
  assert.deepEqual(F.totauxVue({ id: 10 }, lignes, resumes), { lignes: 2, refusees: 1, demande: 92, retenu: 82, detail: true });
  assert.deepEqual(F.totauxVue({ id: 20 }, lignes, resumes), { lignes: 2, refusees: 1, demande: 50, retenu: 45, detail: false });
  assert.deepEqual(F.totauxVue({ id: 99 }, undefined, undefined), { lignes: 0, refusees: 0, demande: 0, retenu: 0, detail: true });
  assert.equal(F.resumeDe(resumes, 20), resumes[0]);
  assert.equal(F.resumeDe(resumes, 20), resumes[0], 'index gardé pour le même tableau');
  assert.equal(F.resumeDe([], 20), undefined);
  const notes = [
    { id: 10, medicale: false, statut: 'validee' }, { id: 20, medicale: false, statut: 'payee' }, { id: 30, medicale: true, statut: 'payee' },
    { id: 40, medicale: false, statut: 'annulee' },
  ] as NoteFrais[];
  assert.deepEqual(F.totauxEquipeVue(notes, lignes, resumes), { notes: 2, lignes: 4, refusees: 2, demande: 142, retenu: 127 }, 'frais médicaux et notes annulées exclus');
  assert.deepEqual(Object.fromEntries(F.retenuParCategorie(new Set([10, 20, 30]), lignes, resumes)), { repas: 32, hotel: 70, train: 25, medical: 40 });
  // Dépenses par mois : résumés comptés au mois de leur note.
  const mois = [{ id: 10, periode: '2026-09', statut: 'validee' }, { id: 20, periode: '2026-05', statut: 'payee' }, { id: 50, periode: '2026-04', statut: 'payee' }] as NoteFrais[];
  assert.deepEqual(depensesParMois(mois, lignes, '2025-11-01', [resume(20), resume(50, { depenses: 0, refusees: 2, retenu: 0 })]),
    [{ mois: '2026-05', montant: 45, notes: 1 }, { mois: '2026-09', montant: 82, notes: 1 }]);
});

test('écran : période des notes plus anciennes, recherche contrôlée, onglet Historique du service RH et de la comptabilité', () => {
  assert.deepEqual(H.periodeAnciennes(T), { du: '2023-10', au: '2025-09' });
  assert.deepEqual(H.periodeAnciennes(T, 1), { du: '2021-10', au: '2023-09' });
  assert.equal(H.libellePeriode({ du: '2023-10', au: '2025-09' }), 'octobre 2023 à septembre 2025');
  assert.deepEqual(H.lireRecherche(H.RECHERCHE_VIDE, T), { ok: true, note: null, filtres: { empId: null, du: '2024-11', au: '2026-10', statut: null } });
  assert.deepEqual(H.lireRecherche({ ...H.RECHERCHE_VIDE, note: ' 42 ', du: 'n’importe' }, T), { ok: true, note: 42 }, 'un numéro de note suffit');
  assert.deepEqual(H.lireRecherche({ ...H.RECHERCHE_VIDE, note: '4,2' }, T), { ok: false, erreurs: { note: 'Numéro de note invalide.' } });
  assert.deepEqual(H.lireRecherche({ empId: '2', du: '2025-01', au: '2025-06-15', statut: 'payee', note: '' }, T),
    { ok: true, note: null, filtres: { empId: 2, du: '2025-01', au: '2025-06', statut: 'payee' } });
  assert.deepEqual(H.lireRecherche({ ...H.RECHERCHE_VIDE, du: '2023-01', au: '2025-06' }, T), { ok: false, erreurs: { du: '24 mois au plus par recherche.' } });
  assert.deepEqual(H.lireRecherche({ ...H.RECHERCHE_VIDE, du: '2025-07', au: '2025-06' }, T), { ok: false, erreurs: { du: 'Le début suit la fin.' } });
  assert.deepEqual(H.lireRecherche({ empId: 'x', du: '2025-13', au: 'mai', statut: 'perdue', note: '' }, T),
    { ok: false, erreurs: { au: 'Mois invalide.', du: 'Mois invalide.', statut: 'Statut inconnu.', empId: 'Salarié inconnu.' } });
  assert.ok(ongletsFrais('rh').includes('historique') && !ongletsFrais('manager').includes('historique') && !ongletsFrais('collaborateur').includes('historique'));
  assert.equal(ongletFraisDe('collaborateur', 'historique'), 'notes');
  assert.equal(LIBELLES_ONGLETS_FRAIS.historique, 'Historique');
});

test('prérequis de l’activation : comptes, rubriques FRAIS_* actives et confirmées, barème de l’année ; défaut inchangé', () => {
  assert.equal(REGLAGES.notesFraisActives.defaut, false, 'verdicts de l’essai de charge pas tous tenus : désactivé par défaut');
  assert.deepEqual(RUBRIQUES_FRAIS, ['FRAIS_REMB', 'FRAIS_IK', 'FRAIS_FORFAIT', 'FRAIS_REINT', 'FRAIS_AVANCE', 'FRAIS_AVANCE_DED']);
  const rien = prerequisFrais({ fraisComptes: {} }, [], [], 2026);
  assert.deepEqual(rien.map(p => [p.cle, p.ok]), [['comptes', false], ['rubriques', false], ['bareme', false]]);
  assert.match(rien[1].detail, /FRAIS_REMB, FRAIS_IK, FRAIS_FORFAIT, FRAIS_REINT, FRAIS_AVANCE, FRAIS_AVANCE_DED/);
  assert.match(rien[2].detail, /^Barème 2026 manquant/);
  const pret = prerequisFrais({ fraisComptes: { repas: '625600', hotel: '625100' } },
    RUBRIQUES_FRAIS.map(code => ({ code, codeSage: code, active: true, confirmeLe: '2026-10-01', confirmePar: 'Paie' })),
    [{ annee: 2026, type: 'voiture' } as never], 2026);
  assert.deepEqual(pret.map(p => [p.cle, p.ok, p.detail]), [
    ['comptes', true, '2 catégories avec son compte'], ['rubriques', true, 'Actives, codes Sage confirmés par la paie'], ['bareme', true, 'Saisi'],
  ]);
  const une = prerequisFrais({ fraisComptes: { repas: '625600' } }, RUBRIQUES_FRAIS.map(code => ({ code, codeSage: code, active: code !== 'FRAIS_IK', confirmeLe: '2026-10-01', confirmePar: 'Paie' })), [], 2026);
  assert.equal(une[0].detail, '1 catégorie avec son compte');
  assert.match(une[1].detail, /: FRAIS_IK ;/);
});

test('vues : détail de 2 mois pour le service RH et la comptabilité seulement, résumés, parts réintégrables et alertes sur l’instantané complet', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  const a = await notesArchivees(db);
  const note = async (empId: number, periode: string, payeeLe: string | null, o: Record<string, unknown> = {}) => (await db.insert<{ id: number }>('notesFrais', {
    empId, periode, voyageId: null, missionId: null, projet: null, medicale: false, statut: payeeLe ? 'payee' : 'brouillon', creeLe: `${periode}-28T17:00:00.000Z`, creePar: 'Essai', payeeLe, lotId: null, ...o,
  })).id;
  const depense = async (noteId: number, empId: number, categorie: string, montant: number, o: Record<string, unknown> = {}) => (await db.insert<{ id: number }>('lignesFrais', {
    noteId, empId, date: '2026-05-12', categorie, montant, devise: 'EUR', montantEur: montant, sansJustificatif: true, attestation: true, ...o,
  })).id;
  const ordinaire = await note(2, '2026-04', '2026-05-28');
  await depense(ordinaire, 2, 'repas', 20);
  await depense(ordinaire, 2, 'train', 31.5);
  // Payée le 1er juillet : allocation repas de 35 € pour une limite de 21,10 € (13,90 € réintégrables), hors du détail.
  const allocation = await note(2, '2026-06', '2026-07-01');
  await depense(allocation, 2, 'forfait', 35, { date: '2026-06-10', forfait: 'repas_restaurant' });
  // Trajets de 6 000 km payés en juillet (hors du détail), puis une note en circuit de 300 km en octobre, véhicule de 8 CV :
  // la limite d'exonération de la note en circuit dépend du cumul de l'année.
  const v8 = await db.insert<{ id: number }>('vehiculesPerso', { empId: 6, type: 'voiture', cv: 8, electrique: false, du: '2026-01-01', au: null, creeLe: '2026-01-02T08:00:00.000Z', creePar: 'Essai' });
  const trajets = await note(6, '2026-06', '2026-07-28');
  await depense(trajets, 6, 'ik', 3500, { date: '2026-06-15', km: 6000, vehiculeId: v8.id });
  const enCircuit = await note(6, '2026-10', null);
  const trajet = await depense(enCircuit, 6, 'ik', 250, { date: '2026-10-05', km: 300, vehiculeId: v8.id });
  const recente = await note(2, '2026-08', '2026-09-28');
  await depense(recente, 2, 'repas', 15);
  const compte = async (empId: number | null) => (await db.one<{ id: number }>(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!.id;
  const vue = async (empId: number | null, role: User['role']) => await buildSnapshot(db, (await currentUser(db, { compteId: await compte(empId), role, methode: 'demo' }))!);
  const ids = (ds: { resumesFrais?: ResumeNoteFrais[] }) => (ds.resumesFrais ?? []).map(r => r.noteId).sort((x, y) => x - y);
  const full = new Domain(await loadFull(db, (await currentUser(db, { compteId: await compte(null), role: 'rh', methode: 'demo' }))!));

  const rh = await vue(null, 'rh');
  assert.deepEqual(ids(rh), [a.bord, ordinaire, allocation, trajets].sort((x, y) => x - y), 'notes payées entre les deux bornes');
  assert.deepEqual(rh.resumesFrais!.find(r => r.noteId === ordinaire), { noteId: ordinaire, empId: 2, depenses: 2, refusees: 0, demande: 51.5, retenu: 51.5, parCategorie: { repas: 20, train: 31.5 } });
  assert.ok(!rh.lignesFrais!.some(l => l.noteId === ordinaire) && rh.lignesFrais!.some(l => l.noteId === recente), 'détail des seules notes payées depuis moins de 2 mois');
  assert.ok(!rh.pieces!.some(p => p.id === a.pieceBord), 'justificatifs des dépenses retirées : retirés aussi');
  assert.ok(rh.notesFrais!.some(n => n.id === ordinaire), 'en-tête de la note dans l’instantané');
  // Part réintégrable calculée par le serveur pour une note sans son détail (tableau de bord).
  assert.equal(rh.reintegrableFrais![allocation], 13.9);
  const dRh = new Domain(rh);
  assert.equal(C.syntheseNote(dRh, rh.notesFrais!.find(n => n.id === allocation)!).reintegrable, 13.9);
  // Note en circuit : alertes et part réintégrable sur le cumul exact de l'année (les trajets de juillet sont hors de la vue).
  const nc = rh.notesFrais!.find(n => n.id === enCircuit)!;
  assert.notEqual(limitesIk(dRh)(rh.lignesFrais!.find(l => l.id === trajet)!), limitesIk(full)(full.ds.lignesFrais!.find(l => l.id === trajet)!), 'la vue seule tronquerait le cumul');
  assert.deepEqual(C.syntheseNote(dRh, nc).alertes, alertesDeNote(full, nc));
  assert.equal(C.syntheseNote(dRh, nc).reintegrable, totalReintegrable([...alertesDeNote(full, nc).values()].flat()));
  assert.equal(rh.reintegrableFrais![enCircuit] ?? 0, totalReintegrable([...alertesDeNote(full, nc).values()].flat()));
  // Comptabilité : même détail, frais médicaux compris.
  const compta = await vue(21, 'rh');
  assert.deepEqual(ids(compta), ids(rh));
  assert.deepEqual(compta.reintegrableFrais, rh.reintegrableFrais);
  assert.ok(!compta.lignesFrais!.some(l => l.noteId === ordinaire));
  // Manager et collaborateur : tout le détail de la fenêtre, aucun résumé (réponse du propriétaire : vues RH et comptabilité).
  const mehdi = await vue(2, 'collaborateur');
  assert.deepEqual([ids(mehdi), mehdi.reintegrableFrais], [[], undefined]);
  assert.ok(mehdi.lignesFrais!.some(l => l.noteId === ordinaire) && mehdi.lignesFrais!.some(l => l.noteId === allocation));
  assert.equal(C.syntheseNote(new Domain(mehdi), mehdi.notesFrais!.find(n => n.id === allocation)!).reintegrable, 13.9);
  const karim = await vue(12, 'manager');
  assert.ok(karim.lignesFrais!.some(l => l.noteId === ordinaire) && !ids(karim).length);
  for (const [empId, quoi] of [[7, 'paie'], [23, 'référent HSE'], [11, 'lecture seule']] as const) {
    const ds = await vue(empId, 'rh');
    assert.deepEqual([ds.resumesFrais ?? [], ds.lignesFrais, ds.reintegrableFrais], [[], [], undefined], quoi);
  }
  assert.ok(!CHAMPS_PAR_SALARIE.has('resumesFrais') && !('resumesFrais' in LECTURES), 'calculés par la vue, jamais lus');
});
