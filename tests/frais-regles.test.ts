// Notes de frais (lot 11, chantier C5) : règles pures, tests par valeurs — statuts et circuit, montants et totaux, doublons,
// frais médicaux, barème kilométrique (CV plafonnés, majoration électrique, cumul, régularisation), politique interne et
// limites d'exonération (un frais réel n'est jamais réintégrable), cumul avec les forfaits de grand déplacement jour par
// jour, lecture d'un reçu collé, TVA, imputation des avances et éléments de paie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const F = await import('../shared/rules/frais.ts');
const K = await import('../shared/rules/frais-km.ts');
const P = await import('../shared/rules/frais-politique.ts');
const C = await import('../shared/rules/frais-cumul.ts');
const T = await import('../shared/rules/frais-tva.ts');
const Lr = await import('../shared/rules/frais-lecture.ts');
const Pa = await import('../shared/rules/frais-paie.ts');
const { trancheDemo } = await import('../server/src/frais-demo.ts');
type LigneFrais = import('../shared/types.ts').LigneFrais;
type NoteFrais = import('../shared/types.ts').NoteFrais;
type BaremeKm = import('../shared/types.ts').BaremeKm;

const BAREME: BaremeKm[] = trancheDemo(2026).map((t, i) => ({ ...t, id: i + 1, type: 'voiture' as const, saisiLe: '', saisiPar: '' }));
const ligne = (o: Partial<LigneFrais>): LigneFrais => ({
  id: 1, noteId: 1, empId: 2, date: '2026-10-06', categorie: 'repas', montant: 20, devise: 'EUR', taux: null, montantEur: 20, tvaTaux: null, tvaMontant: null,
  commercant: null, forfait: null, km: null, vehiculeId: null, depart: null, arrivee: null, invites: null, motifDepassement: null, sansJustificatif: false,
  attestation: false, montantRetenu: null, refuseeLe: null, refusMotif: null, ...o,
});
const note = (o: Partial<NoteFrais>): NoteFrais => ({
  id: 1, empId: 2, periode: '2026-10', voyageId: null, missionId: null, projet: null, medicale: false, statut: 'brouillon', creeLe: '', creePar: '', soumiseLe: null,
  valideeLe: null, valideePar: null, controleeLe: null, controleePar: null, renvoyeeLe: null, renvoyeePar: null, renvoiMotif: null, lotId: null, payeeLe: null,
  annuleeLe: null, annuleePar: null, annuleMotif: null, ...o,
});

test('circuit : statuts, transitions, soumission sans manager pour une note médicale ou un salarié sans valideur', () => {
  assert.equal(F.statutASoumission({ medicale: false }, 12), 'soumise');
  assert.equal(F.statutASoumission({ medicale: true }, 12), 'validee', 'une note médicale ne passe jamais par le manager');
  assert.equal(F.statutASoumission({ medicale: false }, 0), 'validee', 'manager sans N+1 : directement au contrôle');
  assert.equal(F.statutApresValidation('manager_controle'), 'validee');
  assert.equal(F.statutApresValidation('manager'), 'controlee');
  assert.ok(F.transitionPermise('soumise', 'validee') && F.transitionPermise('validee', 'a_corriger') && !F.transitionPermise('payee', 'annulee') && !F.transitionPermise('brouillon', 'payee'));
  assert.ok(F.noteModifiable({ statut: 'a_corriger' }) && !F.noteModifiable({ statut: 'soumise' }));
  assert.ok(F.noteSoumise({ statut: 'validee' }) && !F.noteSoumise({ statut: 'annulee' }) && !F.noteSoumise({ statut: 'brouillon' }));
  assert.ok(F.notePayee({ statut: 'en_paiement' }) && F.notePayee({ statut: 'payee' }) && !F.notePayee({ statut: 'controlee' }));
  assert.match(F.erreurCategoriePourNote({ medicale: true }, 'repas')!, /que des frais médicaux/);
  assert.match(F.erreurCategoriePourNote({ medicale: false }, 'medical')!, /note séparée/);
  assert.equal(F.erreurCategoriePourNote({ medicale: true }, 'medical'), null);
  assert.equal(F.categorieJournal('medical'), 'divers', 'une catégorie réelle, que d’autres dépenses produisent aussi');
  assert.ok(F.estCategorieFrais(F.categorieJournal('medical')));
  assert.equal(F.categorieJournal('hotel'), 'hotel');
  assert.ok(F.estPeriodeFrais('2026-10') && !F.estPeriodeFrais('2026-13') && F.estDevise('USD') && !F.estDevise('usd'));
});

test('montants : euros, devise au taux saisi, montant retenu, totaux et totaux montrés au manager sans note médicale', () => {
  assert.equal(F.enEuros(12.345, 'EUR', null), 12.35);
  assert.equal(F.enEuros(100, 'MAD', 0.092), 9.2);
  assert.equal(F.enEuros(100, 'USD', null), null, 'taux manquant');
  assert.equal(F.montantRetenu(ligne({ montantEur: 30, montantRetenu: 25 })), 25);
  assert.equal(F.montantRetenu(ligne({ montantEur: 30, refuseeLe: '2026-10-08' })), 0);
  assert.deepEqual(F.totauxNote([ligne({ montantEur: 30, montantRetenu: 25 }), ligne({ montantEur: 10 }), ligne({ montantEur: 99, refuseeLe: 'x' })]),
    { lignes: 2, refusees: 1, demande: 40, retenu: 35 });
  const notes = [note({ id: 1 }), note({ id: 2, medicale: true }), note({ id: 3, statut: 'annulee' })];
  const lignes = [ligne({ noteId: 1, montantEur: 20 }), ligne({ noteId: 2, montantEur: 35, categorie: 'medical' }), ligne({ noteId: 3, montantEur: 50 })];
  assert.deepEqual(F.totauxEquipe(notes, lignes), { notes: 1, lignes: 1, refusees: 0, demande: 20, retenu: 20 }, 'ni note médicale, ni note annulée');
});

test('doublons : même salarié, date, montant et commerçant (forme normalisée) ; même empreinte de justificatif', () => {
  const a = ligne({ id: 1, noteId: 1, commercant: 'Brasserie du Port', montantEur: 18.9 });
  const b = ligne({ id: 2, noteId: 2, commercant: 'BRASSERIE DU PORT !', montantEur: 18.9 });
  const c = ligne({ id: 3, noteId: 3, commercant: 'Brasserie du Port', montantEur: 18.9 });
  const d = ligne({ id: 4, noteId: 1, commercant: 'Brasserie du Port', montantEur: 19 });
  const notes = [note({ id: 1 }), note({ id: 2 }), note({ id: 3, statut: 'annulee' })];
  assert.equal(F.cleDoublon(a), '2|2026-10-06|18.90|brasserie du port');
  assert.deepEqual(F.doublonsDe(a, [a, b, c, d], notes), [2], 'note annulée et montant différent écartés');
  assert.deepEqual(F.doublonsDe(a, [a, { ...b, refuseeLe: 'x' }], notes), [], 'ligne refusée écartée');
  assert.deepEqual(F.doublonsEmpreinte([{ ligneId: 5, empreinte: 'aa' }, { ligneId: 2, empreinte: 'aa' }, { ligneId: 3, empreinte: 'bb' }, { ligneId: 4, empreinte: null }]), [[2, 5]]);
});

test('barème kilométrique : tranche, CV plafonnés à 7, majoration électrique, part marginale, cumul et régularisation', () => {
  const v5 = { type: 'voiture' as const, cv: 5, electrique: false };
  assert.equal(K.montantAnnuelIk(BAREME, 2026, v5, 4000), 2544); // 4 000 × 0,636
  assert.equal(K.montantAnnuelIk(BAREME, 2026, v5, 10000), 4965); // 10 000 × 0,357 + 1 395
  assert.equal(K.montantAnnuelIk(BAREME, 2026, v5, 25000), 10675); // 25 000 × 0,427
  assert.equal(K.montantAnnuelIk(BAREME, 2026, { ...v5, electrique: true }, 4000), 3052.8, 'majoration de 20 %');
  assert.equal(K.montantAnnuelIk(BAREME, 2026, { ...v5, cv: 11 }, 1000), 697, 'plafonné à 7 CV');
  assert.equal(K.montantAnnuelIk(BAREME, 2026, { ...v5, cv: 11 }, 1000, true), 697, 'au-delà de 7 CV, la tranche 7+ du barème vaut aussi');
  assert.equal(K.montantAnnuelIk(BAREME, 2025, v5, 1000), null, 'barème de l’année absent');
  assert.ok(K.baremeSaisi(BAREME, 2026) && !K.baremeSaisi(BAREME, 2027));
  assert.equal(K.cvRetenus('voiture', 9), 7);
  assert.equal(K.cvRetenus('moto', 9), 9);
  // Part marginale : les trajets de l'année s'additionnent au montant annuel, changement de tranche compris.
  const t1 = K.ikDuTrajet(BAREME, 2026, v5, 0, 4900)!, t2 = K.ikDuTrajet(BAREME, 2026, v5, 4900, 300)!;
  assert.equal(t1, 3116.4);
  assert.equal(Math.round((t1 + t2) * 100) / 100, K.montantAnnuelIk(BAREME, 2026, v5, 5200));
  const lignes = [ligne({ id: 3, categorie: 'ik', km: 50, date: '2026-03-01' }), ligne({ id: 2, categorie: 'ik', km: 70, date: '2026-02-01' }), ligne({ id: 9, categorie: 'ik', km: 10, date: '2025-12-01' }),
    ligne({ id: 4, categorie: 'ik', km: 30, date: '2026-04-01', refuseeLe: 'x' }), ligne({ id: 5, categorie: 'repas', date: '2026-04-01' })];
  const annee = K.lignesIkDeLAnnee(lignes, [note({ id: 1 })], 2, 2026);
  assert.deepEqual(annee.map(l => l.id), [2, 3]);
  assert.equal(K.cumulKm(annee), 120);
  assert.equal(K.cumulKm(annee, { id: 3, date: '2026-03-01' }), 70);
  // Régularisation : dû au barème sur 120 km (76,32 €) moins ce qui a été remboursé.
  assert.equal(K.regularisationIk(BAREME, 2026, v5, annee, 70), 6.32);
  assert.equal(K.regularisationIk(BAREME, 2026, v5, [...annee, ligne({ categorie: 'ik', km: 5, vehiculeId: 9 })], 0), null, 'deux véhicules : à calculer par véhicule');
  // Saisie dans le désordre (relecture du lot 11) : B (20 mars, 4 000 km) saisie avant A (1er mars, 4 000 km). Recalculées
  // dans l'ordre des trajets : 2 544 € pour A, 1 707 € pour B, soit le barème annuel de 8 000 km (4 251 €).
  const veh = [{ id: 1, ...v5 }];
  const ab = [ligne({ id: 1, categorie: 'ik', km: 4000, date: '2026-03-20', vehiculeId: 1 }), ligne({ id: 2, categorie: 'ik', km: 4000, date: '2026-03-01', vehiculeId: 1 })];
  assert.equal(K.montantAnnuelIk(BAREME, 2026, v5, 8000), 4251);
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2026, veh, ab, new Map())], [[2, 2544], [1, 1707]]);
  // B déjà payée à 2 544 € : l'écart (837 €) est régularisé sur A, total 4 251 € ; la limite d'exonération de A, elle, ne
  // reprend pas le trop-perçu de B (seul un complément dû compte), rien n'est déclaré réintégrable à tort.
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2026, veh, ab, new Map([[1, 2544]]))], [[2, 1707]]);
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2026, veh, ab, new Map([[1, 2544]]), { limite: true })], [[2, 2544]]);
  // B payée à 1 000 € (barème publié après coup) : le complément dû (707 €) passe sur A.
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2026, veh, ab, new Map([[1, 1000]]))], [[2, 3251]]);
  // Trop-perçu plus grand que les lignes à payer : jamais en dessous de zéro, reporté sur les suivantes.
  const abc = [...ab, ligne({ id: 3, categorie: 'ik', km: 100, date: '2026-04-01', vehiculeId: 1 })];
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2026, veh, abc, new Map([[2, 5000]]))], [[1, 0], [3, 0]]);
  // Véhicule inconnu, année sans barème : null (à calculer).
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2026, [], ab, new Map())], [[2, null], [1, null]]);
  assert.deepEqual([...K.indemnitesIkAnnee(BAREME, 2025, veh, ab, new Map())], [[2, null], [1, null]]);
  assert.equal(K.ikReintegrable(100, 80), 20);
  assert.equal(K.ikReintegrable(70, 80), 0);
  assert.equal(K.ikReintegrable(70, null), null);
  assert.ok(K.vehiculeAuJour({ du: '2026-01-05', au: null }, '2026-10-06') && !K.vehiculeAuJour({ du: '2026-01-05', au: '2026-06-30' }, '2026-10-06'));
});

test('politique : dépassement interne (motif ou plafonnement, jamais réintégrable), limite d’exonération (réintégrable), justificatif, invités', () => {
  const s = { fraisPlafonds: { repas: 25 }, fraisSeuilJustificatif: 0, fraisDelaiSoumissionMois: 3 };
  const cx = { settings: s, today: '2026-10-10', justificatifs: 1, forfaits: [{ id: 1, annee: 2026, code: 'repas_restaurant' as const, pays: null, montant: 21.1, saisiLe: '', saisiPar: '' }] };
  const codes = (a: { code: string; niveau: string }[]) => a.map(x => `${x.code}:${x.niveau}`);
  // Frais réel au-delà du plafond interne : bloquant sans motif, alerte avec motif, information une fois plafonné ; jamais réintégrable.
  assert.deepEqual(codes(P.alertesLigne(ligne({ montantEur: 32 }), cx)), ['plafond:bloquant']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ montantEur: 32, motifDepassement: 'Client' }), cx)), ['plafond:alerte']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ montantEur: 32, montantRetenu: 25 }), cx)), ['plafond:info']);
  assert.equal(P.depassementPolitique(s.fraisPlafonds, ligne({ montantEur: 32 })), 7);
  assert.equal(P.reintegrable(ligne({ montantEur: 320 }), cx), 0, 'un frais réel justifié n’est jamais réintégrable');
  assert.equal(P.totalReintegrable(P.alertesLigne(ligne({ montantEur: 320, motifDepassement: 'x' }), cx)), 0);
  // Allocation forfaitaire au-delà de la limite d'exonération : part réintégrable signalée.
  const forfait = ligne({ categorie: 'forfait', forfait: 'repas_restaurant', montantEur: 25 });
  assert.equal(P.reintegrable(forfait, cx), 3.9);
  assert.deepEqual(P.alertesLigne(forfait, cx).map(a => [a.code, a.reintegrable ?? null]), [['limite', 3.9]]);
  assert.equal(P.reintegrable({ ...forfait, date: '2027-01-04' }, cx), null, 'limite de l’année non saisie');
  assert.ok(P.alertesLigne({ ...forfait, date: '2027-01-04' }, { ...cx, today: '2027-01-10' }).some(a => a.code === 'bareme' && a.niveau === 'alerte'));
  assert.equal(P.reintegrable(ligne({ categorie: 'ik', montantEur: 90 }), { limiteIk: 76.32 }), 13.68);
  assert.equal(P.limiteForfait(cx.forfaits, 2026, 'repas_restaurant'), 21.1);
  assert.deepEqual(P.forfaitDeLaLigne('etranger:MA'), { code: 'etranger', pays: 'MA' });
  assert.equal(P.forfaitDeLaLigne('inconnu'), null);
  // Justificatif, attestation, invités, week-end, absence, délai, doublon, restaurant au-delà de 150 € HT.
  const s0 = { ...cx, settings: { ...s, fraisPlafonds: {} }, justificatifs: 0 };
  assert.deepEqual(codes(P.alertesLigne(ligne({}), s0)), ['justificatif:bloquant']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ sansJustificatif: true, attestation: true }), s0)), ['attestation:alerte']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ montantEur: 5 }), { ...s0, settings: { ...s0.settings, fraisSeuilJustificatif: 10 } })), [], 'sous le seuil');
  assert.deepEqual(codes(P.alertesLigne(ligne({ categorie: 'repas_affaires' }), { ...s0, justificatifs: 1 })), ['invites:bloquant']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ date: '2026-10-04' }), { ...s0, justificatifs: 1, absent: true })), ['absence:alerte', 'weekend:info']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ date: '2026-06-02' }), { ...s0, justificatifs: 1 })), ['delai:alerte']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ date: '2026-07-02' }), { ...s0, justificatifs: 1 })), [], 'juillet + 3 mois : jusqu’au 31 octobre');
  assert.deepEqual(codes(P.alertesLigne(ligne({}), { ...s0, justificatifs: 1, doublons: [7] })), ['doublon:alerte']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ categorie: 'repas_affaires', invites: 'Client', montantEur: 200, tvaTaux: 10 }), { ...s0, justificatifs: 1 })), ['facture:alerte']);
  assert.deepEqual(codes(P.alertesLigne(ligne({ categorie: 'ik', montantEur: 76.32 }), { ...s0, limiteIk: 76.32 })), [], 'ni justificatif ni plafond pour une indemnité');
  assert.equal(P.bloquantes(P.alertesLigne(ligne({}), s0)).length, 1);
  assert.deepEqual(P.alertesLigne(ligne({ refuseeLe: 'x' }), s0), [], 'ligne refusée : aucune alerte');
});

test('cumul avec les forfaits de grand déplacement et de mission à l’étranger, jour par jour', () => {
  const absent = (j: string) => j === '2026-10-07';
  const mission = C.joursSejour({ source: 'mission', du: '2026-10-05', au: '2026-10-09' }, absent);
  assert.deepEqual([...mission].map(([j, r]) => [j, [...r].sort()]), [
    ['2026-10-05', ['GD_JOUR', 'GD_NUIT']], ['2026-10-06', ['GD_JOUR', 'GD_NUIT']], ['2026-10-08', ['GD_JOUR', 'GD_NUIT']], ['2026-10-09', ['GD_JOUR']],
  ]);
  const voyage = C.joursSejour({ source: 'voyage', du: '2026-10-12', au: '2026-10-13' }, () => false, '2026-10-12');
  assert.deepEqual([...voyage].map(([j, r]) => [j, [...r]]), [['2026-10-12', ['ETR_JOUR']]], 'jours après la sortie écartés');
  const jours = C.joursForfait([mission, voyage]);
  const lignes = [
    ligne({ id: 1, date: '2026-10-05', categorie: 'repas' }),
    ligne({ id: 2, date: '2026-10-09', categorie: 'hotel' }), // dernier jour : pas de nuit au forfait
    ligne({ id: 3, date: '2026-10-08', categorie: 'hotel' }),
    ligne({ id: 4, date: '2026-10-07', categorie: 'repas' }), // jour d'absence : pas de forfait
    ligne({ id: 5, date: '2026-10-06', categorie: 'forfait', forfait: 'gd_logement_autres' }),
    ligne({ id: 6, date: '2026-10-12', categorie: 'hotel' }),
    ligne({ id: 7, date: '2026-10-06', categorie: 'train' }),
    ligne({ id: 8, date: '2026-10-05', categorie: 'repas_affaires', refuseeLe: 'x' }),
  ];
  assert.deepEqual(C.cumulsForfait(lignes, jours).map(c => [c.ligneId, c.rubrique]), [[1, 'GD_JOUR'], [3, 'GD_NUIT'], [5, 'GD_NUIT'], [6, 'ETR_JOUR']]);
  // L'alerte est bloquante.
  const a = P.alertesLigne(lignes[0], { settings: { fraisPlafonds: {}, fraisSeuilJustificatif: 0, fraisDelaiSoumissionMois: 3 }, today: '2026-10-10', justificatifs: 1, cumul: { ligneId: 1, date: '2026-10-05', rubrique: 'GD_JOUR' } });
  assert.deepEqual(a.map(x => [x.code, x.niveau]), [['cumul', 'bloquant']]);
});

test('TVA : taux proposé, TVA tirée du TTC, part récupérable par catégorie, note simplifiée', () => {
  assert.equal(T.tauxPropose('repas'), 10);
  assert.equal(T.tauxPropose('ik'), null);
  assert.equal(T.tvaDepuisTtc(110, 10), 10);
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'repas', montantEur: 55, tvaTaux: 10 })), 5);
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'hotel', montantEur: 110, tvaTaux: 10 })), 0, 'hébergement du personnel');
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'train', montantEur: 110, tvaTaux: 10 })), 0, 'transport de personnes');
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'carburant', montantEur: 120, tvaMontant: 20 })), 16, 'carburant à 80 %');
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'repas', montantEur: 220, tvaTaux: 10 })), 0, 'au-delà de 150 € HT : facture au nom de l’entreprise');
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'repas', devise: 'USD', montantEur: 55, tvaTaux: 10 })), 0, 'TVA étrangère');
  assert.equal(T.tvaRecuperable(ligne({ categorie: 'divers', montantEur: 60, tvaTaux: 20, refuseeLe: 'x' })), 0);
  assert.ok(T.factureEntrepriseAVerifier(ligne({ categorie: 'repas', montantEur: 220, tvaTaux: 10 })) && !T.factureEntrepriseAVerifier(ligne({ categorie: 'repas', montantEur: 22, tvaTaux: 10 })));
  assert.ok(T.estTauxTva(5.5) && T.estTauxTva(0) && !T.estTauxTva(7));
});

test('lecture d’un reçu collé : montant total, date, devise, TVA, SIRET, commerçant ; propositions seulement', () => {
  const r = Lr.lireRecu('BRASSERIE DU PORT\n12 quai des Belges 13001 Marseille\nSIRET 123 456 789 00012\nLe 07/10/2026 12:41\n2 Plat du jour   29,00\n1 Café            2,50\nTOTAL TTC        31,50 €\nTVA 10,00 %  HT 28,64  TVA 2,86\nCB  31,50');
  assert.deepEqual(r, { montant: 31.5, date: '2026-10-07', devise: 'EUR', tva: [{ taux: 10, montant: 2.86 }], siret: '12345678900012', commercant: 'BRASSERIE DU PORT' });
  assert.deepEqual(Lr.lireRecu('SNCF\nBillet Paris - Lyon\nDate: 2026-10-05\nMontant 87.40 EUR'), { montant: 87.4, date: '2026-10-05', devise: 'EUR', commercant: 'SNCF' });
  assert.deepEqual(Lr.lireRecu('Taxi Atlas\n05/10/26\n120 MAD'), { montant: 120, date: '2026-10-05', devise: 'MAD', commercant: 'Taxi Atlas' });
  assert.deepEqual(Lr.lireRecu(''), {});
  assert.equal(Lr.montantLu('1 234,56'), 1234.56);
  assert.equal(Lr.montantLu('1.234,5'), 1234.5);
  assert.equal(Lr.montantLu('abc'), null);
  assert.equal(Lr.dateLue('le 31/02/2026 puis le 01/03/2026'), '2026-03-01', 'date impossible écartée');
  assert.equal(Object.keys(Lr.lireRecu('x'.repeat(20000))).length <= 1, true, 'texte borné');
});

test('paie : parts d’une note, imputation des avances, éléments et notes réservées', () => {
  const ds = {
    lignesFrais: [
      ligne({ id: 1, noteId: 1, montantEur: 40 }), ligne({ id: 2, noteId: 1, categorie: 'forfait', forfait: 'repas_restaurant', montantEur: 25 }),
      ligne({ id: 3, noteId: 1, categorie: 'ik', montantEur: 90, km: 100, vehiculeId: 1 }), ligne({ id: 4, noteId: 1, montantEur: 10, refuseeLe: 'x' }),
      ligne({ id: 5, noteId: 2, categorie: 'medical', montantEur: 35 }),
    ],
    referentiels: { forfaitsFrais: [{ id: 1, annee: 2026, code: 'repas_restaurant' as const, pays: null, montant: 21.1, saisiLe: '', saisiPar: '' }] },
  };
  const d = { ds } as unknown as Parameters<typeof Pa.partsNote>[0];
  assert.deepEqual(Pa.partsNote(d, note({ id: 1 }), () => 63.6), { reels: 40, ik: 63.6, forfaits: 21.1, reintegrable: 30.3, total: 155 });
  assert.deepEqual(Pa.partsNote(d, note({ id: 2, medicale: true }), () => null), { reels: 35, ik: 0, forfaits: 0, reintegrable: 0, total: 35 }, 'frais médicaux : frais réels, rubrique commune');
  const avances = [{ id: 1, empId: 2, montant: 100, voyageId: 7, missionId: null, statut: 'versee' as const, demandeLe: '', valideeLe: null, valideePar: null, lotId: 3, verseeLe: null, annuleeLe: null, annuleePar: null, refusMotif: null }];
  const notes = [note({ id: 4, voyageId: 7, statut: 'payee' }), note({ id: 5, voyageId: 7, statut: 'controlee' }), note({ id: 6, voyageId: 8, statut: 'controlee' }), note({ id: 7, voyageId: 7, statut: 'brouillon' })];
  assert.deepEqual([...Pa.imputationsAvances(notes, avances, () => 60)], [[5, 60]], 'note payée sans déduction transmise : elle ne consomme pas le solde');
  assert.deepEqual([...Pa.imputationsAvances(notes, avances, () => 60, new Map([[4, 60]]))], [[5, 40]], 'solde diminué des déductions transmises, même séjour seulement');
  assert.deepEqual([...Pa.imputationsAvances([...notes, note({ id: 8, voyageId: 7, statut: 'controlee', lotId: 3 })], avances, () => 60)], [[5, 60]], 'note déjà dans un lot : rien de plus');
  // Relecture du lot 11, sur deux lots : avance de 500 € validée et note A (300 €) contrôlée emportées par le même lot
  // (l'avance y est imputée), puis note B (400 €) au lot suivant : déduite du reste (200 €), jamais deux fois payée.
  const avance = (statut: 'validee' | 'versee', lotId: number | null) => ({ ...avances[0], montant: 500, statut, lotId });
  const lot1 = Pa.imputationsAvances([note({ id: 1, voyageId: 7, statut: 'controlee' })], [avance('validee', null)], () => 300);
  assert.deepEqual([...lot1], [[1, 300]], 'avance versée par ce lot imputée dans ce lot');
  const transmis = Pa.deductionsDuContenu([{ note: 1, rubrique: 'FRAIS_AVANCE_DED', montant: -300 }, { note: 1, rubrique: 'FRAIS_REMB', montant: 300 }, { note: null, rubrique: 'FRAIS_AVANCE', montant: 500 }]);
  assert.deepEqual([...transmis], [[1, 300]]);
  const lot2 = Pa.imputationsAvances([note({ id: 1, voyageId: 7, statut: 'payee', lotId: 1 }), note({ id: 2, voyageId: 7, statut: 'controlee' })], [avance('versee', 1)], n => (n.id === 1 ? 300 : 400), transmis);
  assert.deepEqual([...lot2], [[2, 200]], '500 − 300 déjà déduits : 200 sur la note B ; total versé 500 + 300 + 400 − 500 = 700');
  // Note payée avant l'avance (aucune déduction transmise) : l'avance s'impute en entier sur la note suivante.
  assert.deepEqual([...Pa.imputationsAvances([note({ id: 1, voyageId: 7, statut: 'payee', lotId: 1 }), note({ id: 2, voyageId: 7, statut: 'controlee' })], [avance('versee', 2)], () => 400)], [[2, 400]]);
  assert.deepEqual(Pa.fraisDuContenu([
    { note: 5, avance: null, empId: 2, matricule: 'X', periode: '2026-10', rubrique: 'FRAIS_REMB', codeSage: null, quantite: 1, montant: 10 },
    { note: 5, avance: null, empId: 2, matricule: 'X', periode: '2026-10', rubrique: 'FRAIS_IK', codeSage: null, quantite: 1, montant: 5 },
    { note: null, avance: 9, empId: 3, matricule: 'Y', periode: '2026-10', rubrique: 'FRAIS_AVANCE', codeSage: null, quantite: 1, montant: 50 },
  ]), [{ id: 5, empId: 2 }, { id: 9, empId: 3, avance: true }]);
});

test('réglage conservationFraisAns : 10 ans au moins (pièces comptables, art. L123-22 du Code de commerce)', async () => {
  const { appliquerReglages, REGLAGES, reglagesParDefaut } = await import('../shared/reglages.ts');
  const DEFAULT_SETTINGS = reglagesParDefaut();
  assert.equal(REGLAGES.conservationFraisAns.defaut, 10);
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { conservationFraisAns: 10 }).conservationFraisAns, 10);
  // Bornée comme les autres durées : une valeur hors bornes est ramenée à 10 ans, jamais en deçà du terme légal.
  for (const ans of [0, 5, 6, 9, 11]) assert.equal(appliquerReglages(DEFAULT_SETTINGS, { conservationFraisAns: ans }).conservationFraisAns, 10, String(ans));
});
