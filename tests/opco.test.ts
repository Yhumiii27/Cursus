// Tests : règles des dossiers OPCO (lot 11, chantier C4, étape 1 ; shared/rules/opco.ts), par valeurs. Saisie (montants,
// heures, effectif, références, SIRET, déclaration d'activité, frais annexes selon le dispositif), transitions avec l'état
// affiché (`de`, double clic), retour d'un cran, montants calculés (à récupérer, subrogation, prise en charge, reste à charge),
// écart au solde, échéances et retards (délais 30, 90 et 60 jours réglables), relances sans montant ni nom, pièces attendues
// et manquantes, conservation de 10 ans de la facture et de l'accord, synthèse par exercice.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const O = await import('../shared/rules/opco.ts');
const { REGLAGES } = await import('../shared/reglages.ts');
type DossierOpco = import('../shared/types.ts').DossierOpco;
type VersementOpco = import('../shared/types.ts').VersementOpco;
type PlanAction = import('../shared/types.ts').PlanAction;

const DELAIS = { opcoDelaiDepot: 30, opcoDelaiJustificatifs: 90, opcoDelaiRemboursement: 60 };
const TODAY = '2026-10-10';

/** Dossier de la ligne 1 du plan 2026, à déposer, sans montant. */
const dossier = (x: Partial<DossierOpco> = {}): DossierOpco => ({
  id: 1, planActionId: 1, empId: null, exercice: 2026, opco: 'opco2i', dispositif: 'plan', statut: 'a_deposer', reference: null, du: '2026-11-16', au: '2026-11-20',
  heures: 35, effectif: 4, montantDemande: 2000, montantDemandeAnnexes: null, subrogation: false, organismeSiret: null, organismeNda: null, organismeQualiopi: true,
  deposeLe: null, accordLe: null, montantAccorde: null, accordReference: null, plafondHoraire: null, refusLe: null, refusMotif: null, factureLe: null, montantFacture: null,
  soldeLe: null, soldeEcart: null, soldeNature: null, abandonLe: null, abandonMotif: null, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal', ...x,
});
const versement = (x: Partial<VersementOpco> = {}): VersementOpco => ({
  id: 1, dossierId: 1, le: '2026-10-08', montant: 500, destinataire: 'entreprise', reference: null, saisiLe: '2026-10-08T08:00:00.000Z', saisiPar: 'Sandrine Vidal', ...x,
});
const ligne = (x: Partial<PlanAction> = {}): PlanAction => ({
  id: 1, exercice: 2026, f: 'sst', libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 4, cout: 2400, statut: 'engage', origine: 'import', ...x,
});
const accorde = (x: Partial<DossierOpco> = {}) => dossier({ statut: 'accorde', deposeLe: '2026-09-01', accordLe: '2026-09-20', montantAccorde: 1800, ...x });
const saisie = (x: Partial<Record<string, unknown>> = {}) => ({
  opco: 'opco2i', dispositif: 'plan', reference: '', du: '2026-11-16', au: '2026-11-20', heures: '35', effectif: '4', montantDemande: '2 000,50', montantDemandeAnnexes: '',
  subrogation: false, organismeSiret: '', organismeNda: '', organismeQualiopi: true, ...x,
});

test('listes fermées : onze OPCO, OPCO 2i d’abord, dispositifs, états, motifs codés et natures de pièce', () => {
  assert.equal(O.CODES_OPCO.length, 11);
  assert.equal(O.CODES_OPCO[0], 'opco2i');
  assert.equal(O.OPCOS.opco2i, 'OPCO 2i');
  assert.equal(O.LISTE_DISPOSITIFS.length, 7);
  assert.deepEqual(Object.entries(O.STATUTS_OPCO).filter(([, s]) => !s.actif).map(([k]) => k), ['refuse', 'abandonne']);
  assert.deepEqual(Object.entries(O.STATUTS_OPCO).filter(([, s]) => !s.enCours).map(([k]) => k), ['refuse', 'solde', 'abandonne']);
  assert.ok(O.estStatutOpco('solde') && !O.estStatutOpco('toString') && !O.estStatutOpco(3));
  assert.ok(O.estCodeOpco('akto') && !O.estCodeOpco('constructor'));
  assert.ok(O.estMotifRefusOpco('budget_epuise') && !O.estMotifRefusOpco('Budget épuisé'));
  assert.ok(O.estMotifAbandonOpco('renonciation') && !O.estMotifAbandonOpco(''));
  assert.ok(O.estEcartSoldeOpco('partiel') && !O.estEcartSoldeOpco('total'));
  assert.ok(O.estNaturePiece('certificat_realisation') && !O.estNaturePiece('hasOwnProperty') && !O.estNaturePiece(null));
});

test('réglages OPCO : OPCO 2i, sans subrogation, délais 30, 90 et 60 jours bornés', () => {
  assert.deepEqual([REGLAGES.opcoDefaut.defaut, REGLAGES.opcoSubrogation.defaut, REGLAGES.opcoDelaiDepot.defaut, REGLAGES.opcoDelaiJustificatifs.defaut, REGLAGES.opcoDelaiRemboursement.defaut],
    ['opco2i', false, 30, 90, 60]);
  assert.equal(REGLAGES.opcoDefaut.controle!('atlas', 'opco2i'), 'atlas');
  assert.equal(REGLAGES.opcoDefaut.controle!('inconnu', 'akto'), 'akto');
  assert.equal(REGLAGES.opcoDelaiDepot.controle!(400, 30), 180);
  assert.equal(REGLAGES.opcoDelaiJustificatifs.controle!(3, 90), 15);
  assert.equal(REGLAGES.opcoDelaiRemboursement.controle!('x', 60), 60);
});

test('saisie : montants à la française, nombres bornés, références sans espace, SIRET (Luhn, La Poste) et NDA', () => {
  assert.equal(O.montantOpco('1 234,567'), 1234.57);
  assert.equal(O.montantOpco(0), 0);
  for (const v of [-1, 1_000_001, 'abc', '', null, undefined, Number.NaN]) assert.equal(O.montantOpco(v), null, String(v));
  assert.equal(O.heuresOpco('10,5'), 10.5);
  assert.equal(O.heuresOpco(10_001), null);
  assert.equal(O.effectifOpco(4), 4);
  assert.equal(O.effectifOpco('2.5'), null);
  assert.equal(O.effectifOpco({}), null);
  assert.ok(O.referenceValide('OPCO2I-2026/0042_a.b'));
  for (const r of ['avec espace', '-commence', 'x'.repeat(41), 'é']) assert.ok(!O.referenceValide(r), r);
  assert.ok(O.siretValide('73282932000074'), 'SIRET valide (clé de Luhn)');
  assert.ok(!O.siretValide('73282932000075'), 'clé fausse');
  assert.ok(!O.siretValide('7328293200007'), '13 chiffres');
  assert.ok(O.siretValide('35600000000001'), 'La Poste : somme des chiffres multiple de 5');
  assert.ok(!O.siretValide('35600000000002'));
  assert.ok(O.ndaValide('11755555575') && !O.ndaValide('1175555557') && !O.ndaValide('1175555557A'));
});

test('contrôle de la saisie : valeurs enregistrées et une erreur par champ', () => {
  const ok = O.controlerSaisieOpco(saisie({ organismeSiret: '732 829 320 00074', organismeNda: '117 555 555 75', reference: ' OPCO-1 ', subrogation: 'true', organismeQualiopi: 'true' }));
  assert.deepEqual(ok.erreurs, {});
  assert.deepEqual(ok.champs, {
    opco: 'opco2i', dispositif: 'plan', reference: 'OPCO-1', du: '2026-11-16', au: '2026-11-20', heures: 35, effectif: 4, montantDemande: 2000.5, montantDemandeAnnexes: null,
    subrogation: true, organismeSiret: '73282932000074', organismeNda: '11755555575', organismeQualiopi: true,
  });
  // Champs facultatifs vides : null ; nombres reçus tels quels.
  const vide = O.controlerSaisieOpco(saisie({ du: null, au: undefined, heures: null, effectif: '', montantDemande: 1500, subrogation: undefined, organismeQualiopi: false }));
  assert.deepEqual(vide.erreurs, {});
  assert.deepEqual([vide.champs.du, vide.champs.au, vide.champs.heures, vide.champs.effectif, vide.champs.montantDemande, vide.champs.subrogation], [null, null, null, null, 1500, false]);
  const ko = O.controlerSaisieOpco(saisie({
    opco: 'x', dispositif: 'y', reference: 'avec espace', du: '2026-02-30', au: 'demain', heures: '-1', effectif: '1,5', montantDemande: 'beaucoup', montantDemandeAnnexes: '-3',
    organismeSiret: '123', organismeNda: '12',
  }));
  assert.deepEqual(Object.keys(ko.erreurs).sort(), ['au', 'dispositif', 'du', 'effectif', 'heures', 'montantDemande', 'montantDemandeAnnexes', 'opco', 'organismeNda', 'organismeSiret', 'reference']);
  assert.deepEqual([ko.champs.opco, ko.champs.dispositif], ['opco2i', 'plan'], 'valeurs de repli, jamais enregistrées (erreurs)');
  assert.equal(O.controlerSaisieOpco(saisie({ du: '2026-11-20', au: '2026-11-16' })).erreurs.au, 'La fin de la formation précède son début');
  // Frais annexes ou rémunération : seulement pour un dispositif qui les prévoit.
  assert.match(O.controlerSaisieOpco(saisie({ montantDemandeAnnexes: 300 })).erreurs.montantDemandeAnnexes!, /Plan de développement des compétences : ni frais annexes/);
  assert.deepEqual(O.controlerSaisieOpco(saisie({ dispositif: 'pro_a', montantDemandeAnnexes: 300 })).erreurs, {});
  assert.deepEqual(O.controlerSaisieOpco(saisie({ montantDemandeAnnexes: 0 })).erreurs, {}, '0 € de frais annexes : rien demandé');
});

test('transitions : depuis l’état attendu seulement ; `de` affiché contre le double clic', () => {
  assert.deepEqual(O.controleTransition('deposer', 'a_deposer'), { faire: true });
  assert.deepEqual(O.controleTransition('deposer', 'a_deposer', ''), { faire: true });
  assert.deepEqual(O.controleTransition('deposer', 'a_deposer', 'a_deposer'), { faire: true });
  assert.deepEqual(O.controleTransition('deposer', 'depose', 'a_deposer'), { deja: 'déjà déposé' }, 'double clic : rien n’est refait');
  assert.deepEqual(O.controleTransition('accorder', 'refuse', 'depose'), { refus: 'le dossier est maintenant « Refusé » — vérifiez-le, puis réessayez' });
  assert.deepEqual(O.controleTransition('accorder', 'depose', 'inconnu'), { refus: 'État attendu invalide' });
  assert.deepEqual(O.controleTransition('facturer', 'depose'), { refus: 'impossible depuis l’état « Déposé »' });
  assert.deepEqual(O.controleTransition('solder', 'rembourse', 'rembourse'), { faire: true });
  assert.deepEqual(O.controleTransition('abandonner', 'solde'), { refus: 'impossible depuis l’état « Soldé »' });
  assert.deepEqual(O.STATUTS_VERSEMENT, ['accorde', 'facture', 'rembourse']);
  // Acompte reçu avant l'envoi des justificatifs : leur envoi s'enregistre depuis « remboursé », une fois ; le solde les exige.
  assert.deepEqual(O.controleFacturation({ statut: 'accorde', factureLe: null }, 'accorde'), { faire: true });
  assert.deepEqual(O.controleFacturation({ statut: 'rembourse', factureLe: null }, 'rembourse'), { faire: true });
  assert.deepEqual(O.controleFacturation({ statut: 'rembourse', factureLe: '2026-10-01' }, 'rembourse'), { deja: 'justificatifs déjà envoyés' });
  assert.deepEqual(O.controleFacturation({ statut: 'rembourse', factureLe: '2026-10-01' }), { refus: 'justificatifs déjà envoyés' });
  assert.deepEqual(O.controleFacturation({ statut: 'rembourse', factureLe: '2026-10-01' }, 'accorde'), { refus: 'le dossier est maintenant « Remboursé » — vérifiez-le, puis réessayez' });
  assert.deepEqual(O.controleFacturation({ statut: 'facture', factureLe: '2026-10-01' }, 'accorde'), { deja: 'déjà justificatifs envoyés' });
  assert.deepEqual(O.controleSolde({ statut: 'rembourse', factureLe: null }, 'rembourse'), { refus: 'justificatifs (facture, certificat de réalisation) à envoyer avant le solde' });
  assert.deepEqual(O.controleSolde({ statut: 'rembourse', factureLe: '2026-10-01' }, 'rembourse'), { faire: true });
  assert.deepEqual(O.controleSolde({ statut: 'solde', factureLe: '2026-10-01' }, 'rembourse'), { deja: 'déjà soldé' });
});

test('retour d’un cran : état précédent, refus pour un dossier à déposer ou remboursé, abandon défait d’après les dates', () => {
  const vers = (d: Partial<DossierOpco>, n = 0) => O.statutPrecedent(dossier(d), n);
  assert.deepEqual(vers({ statut: 'a_deposer' }), { refus: 'dossier encore à déposer : rien à rouvrir' });
  assert.deepEqual(vers({ statut: 'depose' }), { vers: 'a_deposer' });
  assert.deepEqual(vers({ statut: 'accorde' }), { vers: 'depose' });
  assert.deepEqual(vers({ statut: 'refuse' }), { vers: 'depose' });
  assert.deepEqual(vers({ statut: 'facture' }), { vers: 'accorde' });
  assert.match((vers({ statut: 'rembourse' }, 1) as { refus: string }).refus, /annulez d’abord le versement/);
  assert.deepEqual(vers({ statut: 'solde' }, 2), { vers: 'rembourse' });
  assert.deepEqual(vers({ statut: 'solde' }), { vers: 'facture' });
  assert.deepEqual(vers({ statut: 'abandonne' }), { vers: 'a_deposer' });
  assert.deepEqual(vers({ statut: 'abandonne', deposeLe: '2026-09-01' }), { vers: 'depose' });
  assert.deepEqual(vers({ statut: 'abandonne', deposeLe: '2026-09-01', accordLe: '2026-09-20' }), { vers: 'accorde' });
  assert.deepEqual(vers({ statut: 'abandonne', deposeLe: '2026-09-01', accordLe: '2026-09-20', factureLe: '2026-10-01' }), { vers: 'facture' });
  assert.deepEqual(vers({ statut: 'abandonne' }, 1), { vers: 'rembourse' });
  assert.deepEqual(O.CHAMPS_ETAT.accorde, ['accordLe', 'montantAccorde', 'accordReference', 'plafondHoraire']);
  assert.ok(O.dossierActif(dossier({ statut: 'solde' })) && !O.dossierActif(dossier({ statut: 'abandonne' })) && !O.dossierActif(dossier({ annuleLe: '2026-10-01' })));
});

test('montants : à récupérer, subrogation, prise en charge selon l’état ; versements annulés et d’autres dossiers ignorés', () => {
  const v = [versement({ montant: 500 }), versement({ id: 2, montant: 100, annuleLe: '2026-10-09T08:00:00.000Z' }), versement({ id: 3, dossierId: 9, montant: 999 })];
  assert.deepEqual(O.versementsDe(v, 1).map(x => x.id), [1]);
  assert.deepEqual(O.versementsDe(undefined, 1), []);
  // Avant l'accord : rien d'attendu.
  assert.deepEqual(O.montantsOpco(dossier({ montantDemandeAnnexes: 250.25 }), undefined), {
    demande: 2250.25, accorde: 0, facture: null, attendu: 0, recuEntreprise: 0, payeOrganisme: 0, aRecuperer: 0, attenduOrganisme: 0, priseEnCharge: 0,
  });
  assert.equal(O.montantsOpco(dossier({ montantDemande: null }), undefined).demande, 0);
  // Accordé 1 800, facturé 1 500 (plus bas), 500 reçus : 1 000 à récupérer.
  const f = accorde({ statut: 'rembourse', factureLe: '2026-10-01', montantFacture: 1500 });
  assert.deepEqual(O.montantsOpco(f, v), {
    demande: 2000, accorde: 1800, facture: 1500, attendu: 1500, recuEntreprise: 500, payeOrganisme: 0, aRecuperer: 1000, attenduOrganisme: 0, priseEnCharge: 1500,
  });
  // Facturé au-dessus de l'accord : l'accordé fait foi.
  assert.equal(O.montantsOpco(accorde({ statut: 'facture', factureLe: '2026-10-01', montantFacture: 2500 }), []).attendu, 1800);
  // Montant accordé absent (base ancienne) : 0.
  assert.equal(O.montantsOpco(accorde({ montantAccorde: null }), []).accorde, 0);
  // Subrogation : rien à récupérer, paiement de l'organisme suivi.
  const sub = O.montantsOpco(accorde({ subrogation: true, statut: 'rembourse' }), [versement({ destinataire: 'organisme', montant: 800 })]);
  assert.deepEqual([sub.aRecuperer, sub.attenduOrganisme, sub.payeOrganisme, sub.priseEnCharge], [0, 1000, 800, 1800]);
  // Soldé, refusé, abandonné : la prise en charge est ce qui a été reçu ; plus rien n'est attendu.
  const solde = O.montantsOpco(accorde({ statut: 'solde', soldeLe: '2026-10-09' }), v);
  assert.deepEqual([solde.aRecuperer, solde.priseEnCharge], [0, 500]);
  assert.equal(O.montantsOpco(dossier({ statut: 'refuse', deposeLe: '2026-09-01', refusLe: '2026-09-15' }), []).priseEnCharge, 0);
  assert.equal(O.montantsOpco(dossier({ statut: 'depose', deposeLe: '2026-09-01' }), v).priseEnCharge, 0, 'déposé : rien d’acquis');
});

test('écart au solde : aucun, partiel ou perte, figé sur l’accordé moins le reçu', () => {
  assert.deepEqual(O.ecartAuSolde(accorde({ statut: 'rembourse' }), [versement({ montant: 1800 })]), { ecart: 0, nature: 'aucun' });
  assert.deepEqual(O.ecartAuSolde(accorde({ statut: 'rembourse' }), [versement({ montant: 2000 })]), { ecart: 0, nature: 'aucun' }, 'reçu au-delà : aucun écart');
  assert.deepEqual(O.ecartAuSolde(accorde({ statut: 'rembourse' }), [versement({ montant: 500 }), versement({ id: 2, destinataire: 'organisme', montant: 300 })]), { ecart: 1000, nature: 'partiel' });
  assert.deepEqual(O.ecartAuSolde(accorde({ statut: 'facture', factureLe: '2026-10-01', montantFacture: 1800 }), []), { ecart: 1800, nature: 'perte' });
});

test('reste à charge d’une action : coût retenu (réel une fois réalisée) moins la prise en charge de ses dossiers', () => {
  const dossiers = [accorde(), accorde({ id: 2, montantAccorde: 200 }), accorde({ id: 3, annuleLe: '2026-10-01' }), accorde({ id: 4, planActionId: 2 })];
  assert.deepEqual(O.resteACharge(ligne(), dossiers, []), { cout: 2400, priseEnCharge: 2000, reste: 400 });
  assert.deepEqual(O.resteACharge(ligne({ statut: 'realise', coutReel: 1900 }), dossiers, []), { cout: 1900, priseEnCharge: 2000, reste: -100 }, 'prise en charge au-delà du coût : reste négatif, signalé tel quel');
});

test('échéances : dépôt 30 jours avant le début, accord 7 jours avant, justificatifs 90 jours après la fin, remboursement 60 jours après l’envoi', () => {
  const e = (d: DossierOpco, v: VersementOpco[] = [], today = TODAY) => O.echeanceOpco(d, v, DELAIS, today);
  assert.deepEqual(e(dossier()), { dossierId: 1, etape: 'depot', echeance: '2026-10-17', jours: 7, retard: false, libelle: 'Dossier à déposer avant le début de la formation' });
  assert.equal(e(dossier(), [], '2026-10-18')!.retard, true);
  assert.equal(e(dossier({ du: null })), null, 'sans dates : aucune échéance');
  assert.deepEqual(e(dossier({ statut: 'depose', deposeLe: '2026-09-01' }))!.echeance, '2026-11-09');
  assert.equal(e(dossier({ statut: 'depose', du: null })), null);
  assert.deepEqual([e(accorde())!.etape, e(accorde())!.echeance], ['justificatifs', '2027-02-18']);
  assert.equal(e(accorde({ au: null })), null);
  const facture = accorde({ statut: 'facture', factureLe: '2026-08-01', montantFacture: 1800 });
  assert.deepEqual([e(facture)!.etape, e(facture)!.echeance, e(facture)!.retard], ['remboursement', '2026-09-30', true]);
  assert.equal(e({ ...facture, statut: 'rembourse' }, [versement({ montant: 1800 })]), null, 'tout reçu : rien d’attendu');
  assert.equal(e({ ...facture, factureLe: null }), null);
  // Remboursé par un acompte avant l'envoi des justificatifs : ceux-ci restent attendus après la fin.
  assert.deepEqual([e(accorde({ statut: 'rembourse' }), [versement({ montant: 200 })])!.etape, e(accorde({ statut: 'rembourse' }), [versement({ montant: 200 })])!.echeance],
    ['justificatifs', '2027-02-18']);
  assert.match(e({ ...facture, subrogation: true })!.libelle, /Paiement de l’organisme par l’OPCO/);
  for (const statut of ['refuse', 'solde', 'abandonne'] as const) assert.equal(e(dossier({ statut })), null, statut);
  assert.equal(e(dossier({ annuleLe: '2026-10-01' })), null);
  // Délais réglés autrement.
  assert.equal(O.echeanceOpco(dossier(), [], { ...DELAIS, opcoDelaiDepot: 0 }, TODAY)!.echeance, '2026-11-16');
});

test('retards : échéances dépassées seulement, de la plus ancienne à la plus récente', () => {
  const liste = [
    dossier({ id: 1 }),
    dossier({ id: 2, du: '2026-10-20' }),
    dossier({ id: 3, du: '2026-10-15' }),
    accorde({ id: 4, statut: 'facture', factureLe: '2026-08-11', montantFacture: 1800 }),
  ];
  assert.deepEqual(O.retardsOpco(liste, [], DELAIS, TODAY).map(x => [x.dossierId, x.etape, x.echeance]),
    [[3, 'depot', '2026-09-15'], [2, 'depot', '2026-09-20'], [4, 'remboursement', '2026-10-10']].filter(([, , d]) => (d as string) < TODAY));
});

test('relances : boîte du service RH, clé opco:<id>:<étape>:<échéance>, paliers réglés puis échue, ni montant ni nom de salarié', () => {
  const plan = [ligne(), ligne({ id: 2, f: null, libelle: 'Anglais technique', equipe: 'Logistique' })];
  const nom = (l: PlanAction) => `${l.f ?? l.libelle} — ${l.equipe} (${l.exercice})`;
  const dossiers = [
    dossier(), // dépôt dû le 17 octobre : palier 7 jours
    dossier({ id: 2, planActionId: 2, du: '2026-10-20' }), // dépôt dû le 20 septembre : échu
    dossier({ id: 3, du: '2027-06-01' }), // dépôt dû le 2 mai 2027 : au-delà des paliers
    dossier({ id: 4, planActionId: 99 }), // ligne inconnue : rien
    dossier({ id: 5, statut: 'solde' }), // clos : rien
  ];
  const r = O.relancesOpco(dossiers, [], plan, DELAIS, TODAY, [90, 30, 7], nom);
  assert.deepEqual(r.map(x => [x.cle, x.palier, x.empId, x.rhSeul, x.categorie, x.sante]), [
    ['opco:1:depot:2026-10-17', '7', 0, true, 'opco', false],
    ['opco:2:depot:2026-09-20', 'echu', 0, true, 'opco', false],
  ]);
  // Formation reportée : même étape, nouvelle échéance, nouvelle clé (les paliers repartent de zéro).
  assert.equal(O.relancesOpco([dossier({ du: '2026-10-22' })], [], plan, DELAIS, TODAY, [90, 30, 7], nom)[0].cle, 'opco:1:depot:2026-09-22');
  assert.equal(r[1].libelle, 'Dossier OPCO — Anglais technique — Logistique (2026) : dossier à déposer avant le début de la formation');
  for (const x of r) assert.doesNotMatch(x.libelle, /€|\d{3,} ?€|Mehdi|Benali/);
});

test('pièces attendues selon l’état ; manquantes (émargement à défaut de certificat) ; pièces exigées pour la demande de remboursement', () => {
  const natures = (d: Partial<DossierOpco>, v = 0) => O.piecesAttendues(dossier(d), v).map(a => `${a.nature}${a.requise ? '' : '?'}`);
  assert.deepEqual(natures({}), ['convention', 'programme']);
  assert.deepEqual(natures({ statut: 'depose' }), ['convention', 'programme', 'demande']);
  assert.deepEqual(natures({ statut: 'refuse' }), ['convention', 'programme', 'demande'], 'refusé : pas d’accord attendu');
  assert.deepEqual(natures({ statut: 'accorde' }), ['convention', 'programme', 'demande', 'accord']);
  assert.deepEqual(natures({ statut: 'facture' }), ['convention', 'programme', 'demande', 'accord', 'facture', 'certificat_realisation', 'emargement?']);
  assert.deepEqual(natures({ statut: 'solde' }).at(-1), 'avis_paiement');
  assert.deepEqual(natures({ statut: 'rembourse', subrogation: true }).at(-1), 'avis_paiement?', 'subrogation : avis de paiement facultatif');
  assert.deepEqual(natures({ statut: 'abandonne', deposeLe: '2026-09-01', accordLe: '2026-09-20' }), ['convention', 'programme', 'demande', 'accord']);
  assert.deepEqual(natures({ statut: 'abandonne' }, 1).at(-1), 'avis_paiement');
  assert.deepEqual(O.piecesAttendues(dossier()), O.piecesAttendues(dossier(), 0), 'versements : 0 par défaut');
  const attendues = O.piecesAttendues(dossier({ statut: 'facture' }));
  assert.deepEqual(O.piecesManquantes(attendues, ['convention', 'programme', 'demande', null]), ['accord', 'facture', 'certificat_realisation']);
  assert.deepEqual(O.piecesManquantes(attendues, ['convention', 'programme', 'demande', 'accord', 'facture', 'emargement']), [], 'émargement à défaut de certificat');
  assert.deepEqual(O.piecesPourFacturer([]), ['facture', 'certificat_realisation']);
  assert.deepEqual(O.piecesPourFacturer(['facture', 'certificat_realisation', undefined]), []);
});

test('conservation : 10 ans après la fin de l’exercice pour la facture et l’accord, l’année du dépôt si elle est plus récente', () => {
  assert.equal(O.conservationPieceOpco('facture', 2026, TODAY), '2036-12-31');
  assert.equal(O.conservationPieceOpco('accord', 2025, '2027-01-15'), '2037-12-31');
  assert.equal(O.conservationPieceOpco('accord', 2027, TODAY), '2037-12-31');
  for (const n of ['convention', 'emargement', null, undefined] as const) assert.equal(O.conservationPieceOpco(n, 2026, TODAY), null, String(n));
});

test('synthèse d’un exercice : états, montants, taux de prise en charge, reste à charge, ventilations et retards', () => {
  const plan = [ligne(), ligne({ id: 2, equipe: 'Logistique', periode: 'T1', cout: 1000, statut: 'realise', coutReel: 1200 }), ligne({ id: 3, exercice: 2027 })];
  const dossiers = [
    accorde({ statut: 'rembourse', factureLe: '2026-08-01', montantFacture: 1800 }), // 1 800 accordés, 500 reçus
    dossier({ id: 2, planActionId: 2, dispositif: 'tutorat', opco: 'akto', statut: 'refuse', deposeLe: '2026-09-01', refusLe: '2026-09-10', montantDemande: 700 }),
    dossier({ id: 3, planActionId: 2, du: '2026-10-15' }), // à déposer, en retard
    dossier({ id: 4, planActionId: 3, exercice: 2027 }), // autre exercice
    dossier({ id: 5, annuleLe: '2026-10-01' }), // supprimé
    dossier({ id: 6, planActionId: null }), // sans ligne (alternance, plus tard)
  ];
  const s = O.syntheseOpco(2026, dossiers, [versement({ montant: 500 })], plan, DELAIS, TODAY);
  assert.equal(s.exercice, 2026);
  assert.deepEqual(Object.entries(s.parStatut).filter(([, n]) => n), [['a_deposer', 2], ['refuse', 1], ['rembourse', 1]]);
  assert.deepEqual(s.total, { cle: 'total', dossiers: 4, demande: 6700, accorde: 1800, recu: 500, aRecuperer: 1300, attenduOrganisme: 0, refuse: 700, priseEnCharge: 1800 });
  // Actions qui portent un dossier actif : 2 400 + 1 200 réels.
  assert.deepEqual([s.cout, s.resteACharge, s.tauxPriseEnCharge], [3600, 1800, 50]);
  assert.deepEqual(s.parOpco.map(l => [l.cle, l.dossiers]), [['akto', 1], ['opco2i', 3]]);
  assert.deepEqual(s.parDispositif.map(l => l.cle), ['plan', 'tutorat']);
  assert.deepEqual(s.parEquipe.map(l => [l.cle, l.dossiers]), [['—', 1], ['Logistique', 2], ['Maintenance', 1]], 'sans ligne : « — »');
  assert.deepEqual(s.parTrimestre.map(l => l.cle), ['—', 'T1', 'T4']);
  assert.equal(s.retards, 2, 'dépôt du dossier 3 dû le 15 septembre ; remboursement du dossier 1 attendu le 30 septembre');
  const rien = O.syntheseOpco(2030, dossiers, undefined, plan, DELAIS, TODAY);
  assert.deepEqual([rien.total.dossiers, rien.cout, rien.tauxPriseEnCharge, rien.parOpco], [0, 0, null, []]);
});
