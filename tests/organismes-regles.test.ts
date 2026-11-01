// Tests : règles pures des organismes de formation et de l'e-learning (lot 12, chantier C4, étape 1 ; shared/rules/organismes.ts,
// shared/rules/elearning.ts). Clé de rapprochement des textes libres, saisie contrôlée (fiche, conditions, contact, tarif,
// module), état Qualiopi et avertissements (jamais un blocage), organisme d'une session, d'une ligne du plan et d'une
// formation suivie (fiche fusionnée suivie), fusion (jamais deux SIRET différents), inscriptions (expiration calculée, fin à
// valider), import d'avancement (colonnes fermées, sans temps de connexion, idempotent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aliasApresFusion, avertissementsOrganisme, cleOrganisme, clesFiche, codePropose, controlerConditions, controlerContact, controlerOrganisme, controlerTarif,
  estInterne, etatQualiopi, graphieDominante, ndaManquant, organismeDeSession, organismeDeSuivie, organismeDuPlan, organismeFinal, qualiopiValideLe, rattachementsDe,
  refusFusion, resumeOrganisme, siteWebValide, tarifEnVigueur, texteOrganisme,
} from '../shared/rules/organismes.ts';
import {
  avancementDe, controlerModule, dateSaisie, effetImport, etatInscription, finAcces, finAutomatique, finAValider, heuresRetenues, inscriptionOuverte, inscriptionOuverteDe,
  lireImportElearning, reussiteDe, urlModuleValide,
} from '../shared/rules/elearning.ts';
import type { Dataset, Formation } from '../shared/types.ts';
import type { InscriptionElearning, ModuleElearning, Organisme, OrganismeTarif } from '../shared/types-organismes.ts';

const fiche = (o: Partial<Organisme> & { id: number; nomUsuel: string }): Organisme => ({
  code: o.nomUsuel.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), raisonSociale: null, type: 'externe', siret: null, nda: null, ndaRegion: null, qualiopi: false, qualiopiCategories: [],
  qualiopiCertificateur: null, qualiopiNumero: null, qualiopiValideJusquau: null, qualiopiVerifieLe: null, adresse: null, siteWeb: null, subrogationAcceptee: false,
  delaiAnnulationJours: null, conditions: null, alias: [], aVerifier: false, source: 'saisie', archive: null, creeLe: null, creePar: null, fusionneDans: null, fusionneLe: null,
  fusionnePar: null, fusionneMotif: null, ...o,
});
const module = (o: Partial<ModuleElearning> = {}): ModuleElearning => ({
  id: 1, code: 'RGPD-EL', intitule: 'RGPD', organismeId: null, formation: 'rgpd', url: 'https://formation.example/rgpd', dureeHeures: 2, langue: 'fr', coutLicence: 10,
  accesMois: 6, attestationRequise: false, archive: null, creeLe: null, creePar: null, ...o,
});
const inscription = (o: Partial<InscriptionElearning> = {}): InscriptionElearning => ({
  id: 1, empId: 2, moduleId: 1, planActionId: null, inscritLe: '2026-09-15', inscritPar: null, echeance: null, statut: 'inscrit', avancement: null, avancementSource: null,
  avancementLe: null, declareLe: null, termineLe: null, heures: null, reussi: null, certId: null, suivieId: null, abandonLe: null, corrigeLe: null, corrigePar: null,
  corrigeMotif: null, annuleLe: null, annulePar: null, annuleMotif: null, ...o,
});
const SIRET_A = '77568516000001', SIRET_B = '44712345000002';

test('clé de rapprochement : casse, accents, ponctuation et formes juridiques ignorés ; internes à part ; texte inconnu écarté', () => {
  assert.equal(cleOrganisme('Apave SAS'), 'apave');
  assert.equal(cleOrganisme('  APAVE  '), cleOrganisme('apave'));
  assert.equal(cleOrganisme('Croix-Rouge française'), 'croix rouge francaise');
  assert.equal(cleOrganisme('Dupont & Fils SARL'), 'dupont et fils');
  assert.notEqual(cleOrganisme('APAVE Sud Europe'), cleOrganisme('Apave'), 'une agence n’est jamais rapprochée d’office');
  assert.equal(cleOrganisme('SA'), 'sa', 'forme juridique seule : gardée');
  assert.equal(cleOrganisme(null), '');
  assert.equal(cleOrganisme('Interne · HSE'), 'interne hse');
  assert.ok(estInterne('Interne · HSE') && estInterne('interne - DSI') && !estInterne('Internet Formation'));
  assert.equal(texteOrganisme('  Apave   Sud '), 'Apave Sud');
  for (const v of ['', '   ', null, 42, 'Organisme non renseigné', 'ORGANISME NON RENSEIGNE']) assert.equal(texteOrganisme(v), null, String(v));
  assert.equal(graphieDominante(['APAVE', 'Apave', 'Apave', 'APAVE SAS']), 'Apave');
  assert.equal(graphieDominante(['b', 'a']), 'a', 'à égalité : ordre alphabétique');
  assert.equal(graphieDominante([]), '');
  assert.equal(codePropose('Croix-Rouge française', new Set()), 'CROIX-ROUGE-FRANCAISE');
  assert.equal(codePropose('Apave', new Set(['APAVE', 'APAVE-2'])), 'APAVE-3');
  assert.equal(codePropose('···', new Set()), 'ORGANISME');
  assert.deepEqual([...clesFiche(fiche({ id: 1, nomUsuel: 'Apave', alias: ['APAVE SAS', 'Apave'] }))], ['apave']);
});

test('fiche saisie : identité, SIRET (clé exacte, unique), déclaration d’activité, Qualiopi décoché sans reste, site web', () => {
  const existants = [fiche({ id: 1, nomUsuel: 'Apave', siret: SIRET_A }), fiche({ id: 2, nomUsuel: 'Ancienne', archive: '2026-01-01' })];
  const ok = controlerOrganisme({ nomUsuel: 'AFTRAL', siret: SIRET_B, nda: '119 3056 7893', qualiopi: true, qualiopiCategories: ['formation'], qualiopiValideJusquau: '2027-01-31', siteWeb: 'https://aftral.example' }, existants);
  assert.deepEqual(ok.erreurs, {});
  assert.equal(ok.valeur!.code, 'AFTRAL');
  assert.equal(ok.valeur!.nda, '11930567893');
  assert.equal(ok.valeur!.type, 'externe');
  const err = controlerOrganisme({ code: 'mauvais code', nomUsuel: 'APAVE sas', siret: '12345678901234', nda: '123', type: 'autre', qualiopiCategories: ['x'], qualiopiValideJusquau: '2026-02-30', siteWeb: 'ftp://x' }, existants).erreurs;
  assert.deepEqual(Object.keys(err).sort(), ['code', 'nda', 'nomUsuel', 'qualiopiCategories', 'qualiopiValideJusquau', 'siret', 'siteWeb', 'type']);
  assert.match(err.nomUsuel!, /fusionnez/);
  assert.match(controlerOrganisme({ nomUsuel: 'Autre', siret: SIRET_A }, existants).erreurs.siret!, /déjà celui d’un autre organisme/);
  assert.match(controlerOrganisme({ nomUsuel: '' }, existants).erreurs.nomUsuel!, /Indiquez/);
  assert.match(controlerOrganisme({ nomUsuel: 'x'.repeat(81) }, existants).erreurs.nomUsuel!, /80 caractères/);
  assert.match(controlerOrganisme({ code: 'APAVE', nomUsuel: 'Apave Bis' }, existants).erreurs.code!, /déjà/);
  // Nom d'une fiche archivée : réutilisable ; modification : code inchangé, champs absents gardés, Qualiopi décoché vidé.
  assert.deepEqual(controlerOrganisme({ nomUsuel: 'Ancienne' }, existants).erreurs, {});
  const avant = fiche({ id: 3, nomUsuel: 'Socotec', qualiopi: true, qualiopiCategories: ['formation'], qualiopiNumero: 'Q1', qualiopiValideJusquau: '2027-01-01', siret: SIRET_B });
  const modif = controlerOrganisme({ qualiopi: false }, [...existants, avant], avant).valeur!;
  assert.deepEqual([modif.code, modif.nomUsuel, modif.siret, modif.qualiopiCategories, modif.qualiopiNumero, modif.qualiopiValideJusquau], ['SOCOTEC', 'Socotec', SIRET_B, [], null, null]);
  assert.ok(siteWebValide('http://exemple.example') && !siteWebValide('https://u:p@x.example') && !siteWebValide(`https://${'a'.repeat(200)}.example`) && !siteWebValide('pas une adresse'));
});

test('conditions, contact et tarif : contrôles ; tarif en vigueur à la date (le plus récent), jamais un archivé', () => {
  const c = controlerConditions({ delaiAnnulationJours: '10', subrogationAcceptee: 'true', conditions: 'Paiement à 30 jours' }, { subrogationAcceptee: false, delaiAnnulationJours: null, conditions: null });
  assert.deepEqual(c.valeur, { subrogationAcceptee: true, delaiAnnulationJours: 10, conditions: 'Paiement à 30 jours' });
  assert.ok(controlerConditions({ delaiAnnulationJours: '400' }, c.valeur!).erreurs.delaiAnnulationJours);
  assert.ok(controlerConditions({ conditions: 'x'.repeat(501) }, c.valeur!).erreurs.conditions);
  assert.deepEqual(controlerConditions({ delaiAnnulationJours: '' }, c.valeur!).valeur!.delaiAnnulationJours, null);
  const ct = controlerContact({ nom: 'Julie Martin', email: 'Julie.Martin@Apave.example', telephone: '+33 1 23 45 67 89', role: 'commercial', principal: true });
  assert.deepEqual(ct.valeur, { nom: 'Julie Martin', fonction: null, email: 'julie.martin@apave.example', telephone: '+33 1 23 45 67 89', role: 'commercial', principal: true });
  assert.deepEqual(Object.keys(controlerContact({ nom: '', email: 'x', telephone: 'abc', role: 'chef' }).erreurs).sort(), ['email', 'nom', 'role', 'telephone']);
  assert.equal(controlerContact({ fonction: 'Formateur' }, ct.valeur).valeur!.nom, 'Julie Martin', 'champ absent gardé');
  const formations = [{ id: 'elec' }] as Formation[];
  const t = controlerTarif({ formation: 'elec', montantHt: '480,5', valableDu: '2026-01-01', valableAu: '2026-12-31' }, formations, null, '2026-10-10');
  assert.deepEqual(t.valeur, { formation: 'elec', libelle: null, modalite: 'inter', unite: 'stagiaire', montantHt: 480.5, valableDu: '2026-01-01', valableAu: '2026-12-31' });
  assert.deepEqual(Object.keys(controlerTarif({ formation: 'xx', modalite: 'z', unite: 'y', montantHt: '-1', valableDu: '2026-13-01' }, formations, null, '2026-10-10').erreurs).sort(),
    ['formation', 'modalite', 'montantHt', 'unite', 'valableDu']);
  assert.match(controlerTarif({ montantHt: 1 }, formations, null, '2026-10-10').erreurs.libelle!, /formation du catalogue ou un libellé/);
  assert.match(controlerTarif({ libelle: 'Audit', montantHt: 1, valableDu: '2026-05-01', valableAu: '2026-04-01' }, formations, null, '2026-10-10').erreurs.valableAu!, /précède/);
  const tarif = (o: Partial<OrganismeTarif>): OrganismeTarif => ({ id: 1, organismeId: 1, formation: 'elec', libelle: null, modalite: 'inter', unite: 'stagiaire', montantHt: 400, valableDu: '2025-01-01', valableAu: null, archive: null, creeLe: null, creePar: null, ...o });
  const tarifs = [tarif({ id: 1 }), tarif({ id: 2, valableDu: '2026-01-01', montantHt: 480 }), tarif({ id: 3, valableDu: '2026-06-01', archive: '2026-07-01' }), tarif({ id: 4, modalite: 'intra', valableDu: '2026-02-01' })];
  assert.equal(tarifEnVigueur(tarifs, 1, 'elec', '2026-10-10', 'inter')?.id, 2);
  assert.equal(tarifEnVigueur(tarifs, 1, 'elec', '2025-06-01')?.id, 1);
  assert.equal(tarifEnVigueur(tarifs, 1, 'elec', '2026-10-10')?.id, 4);
  assert.equal(tarifEnVigueur(tarifs, 2, 'elec', '2026-10-10'), null);
  assert.equal(tarifEnVigueur(undefined, 1, null, '2026-10-10'), null);
});

test('Qualiopi : état à une date, palier réglé, jamais pour un service interne ; avertissements sans blocage ; NDA absent signalé', () => {
  const o = (x: Partial<Organisme>) => fiche({ id: 1, nomUsuel: 'Apave', ...x });
  assert.equal(etatQualiopi(o({ type: 'interne' }), '2026-10-10', 60), 'sans_objet');
  assert.equal(etatQualiopi(o({}), '2026-10-10', 60), 'non_certifie');
  assert.equal(etatQualiopi(o({ qualiopi: true }), '2026-10-10', 60), 'a_verifier');
  assert.equal(etatQualiopi(o({ qualiopi: true, qualiopiValideJusquau: '2026-10-09' }), '2026-10-10', 60), 'echu');
  assert.equal(etatQualiopi(o({ qualiopi: true, qualiopiValideJusquau: '2026-10-10' }), '2026-10-10', 60), 'a_echeance', 'valide le jour même');
  assert.equal(etatQualiopi(o({ qualiopi: true, qualiopiValideJusquau: '2026-12-09' }), '2026-10-10', 60), 'a_echeance');
  assert.equal(etatQualiopi(o({ qualiopi: true, qualiopiValideJusquau: '2026-12-10' }), '2026-10-10', 60), 'certifie');
  assert.ok(qualiopiValideLe(o({ qualiopi: true, qualiopiValideJusquau: '2026-11-16' }), '2026-11-16'));
  assert.ok(!qualiopiValideLe(o({ qualiopi: true }), '2026-11-16') && !qualiopiValideLe(o({ type: 'interne', qualiopi: true, qualiopiValideJusquau: '2030-01-01' }), '2026-11-16'));
  assert.ok(ndaManquant(o({})) && ndaManquant(o({ type: 'independant' })) && !ndaManquant(o({ type: 'interne' })) && !ndaManquant(o({ nda: '11755468475' })));
  assert.deepEqual(avertissementsOrganisme(o({ type: 'interne' }), '2026-11-16'), []);
  assert.equal(avertissementsOrganisme(o({}), '2026-11-16').length, 2);
  assert.match(avertissementsOrganisme(o({ qualiopi: true, nda: '11755468475' }), '2026-11-16')[0], /sans date de validité/);
  assert.match(avertissementsOrganisme(o({ qualiopi: true, qualiopiValideJusquau: '2026-09-30', nda: '11755468475' }), '2026-11-16')[0], /échue/);
  assert.deepEqual(avertissementsOrganisme(o({ qualiopi: true, qualiopiValideJusquau: '2027-09-30', nda: '11755468475' }), '2026-11-16'), []);
});

test('organisme d’un objet : le sien (session figée), sinon celui du catalogue ; fiche fusionnée suivie ; fusion jamais entre SIRET différents', () => {
  const apave = fiche({ id: 1, nomUsuel: 'Apave', siret: SIRET_A }), sud = fiche({ id: 2, nomUsuel: 'APAVE Sud', fusionneDans: 1, alias: ['Apave sud'] });
  const aftral = fiche({ id: 3, nomUsuel: 'AFTRAL', siret: SIRET_B }), boucle = fiche({ id: 4, nomUsuel: 'Boucle', fusionneDans: 4 });
  const ds = { organismes: [apave, sud, aftral, boucle], referentiels: { formations: [{ id: 'elec', organismeId: 2 }, { id: 'fco', organismeId: null }] } } as unknown as Dataset;
  assert.equal(organismeFinal(ds.organismes, 2)?.id, 1);
  assert.equal(organismeFinal(ds.organismes, 4)?.id, 4, 'boucle tenue à distance');
  assert.equal(organismeFinal(ds.organismes, null), null);
  assert.equal(organismeFinal(undefined, 1), null);
  assert.equal(organismeDeSession(ds, { formation: 'elec', organismeId: 3 })?.id, 3, 'figé à la création');
  assert.equal(organismeDeSession(ds, { formation: 'elec', organismeId: null })?.id, 1, 'catalogue, fiche fusionnée suivie');
  assert.equal(organismeDuPlan(ds, { f: 'fco', organismeId: null }), null);
  assert.equal(organismeDuPlan(ds, { f: null, organismeId: null }), null);
  assert.equal(organismeDuPlan(ds, { f: 'fco', organismeId: 3 })?.id, 3);
  assert.equal(organismeDeSuivie(ds, { f: 'elec', organisme: null, organismeId: null })?.id, 1);
  assert.equal(organismeDeSuivie(ds, { f: 'elec', organisme: 'GRETA', organismeId: null }), null, 'texte libre saisi : pas celui du catalogue');
  assert.equal(organismeDeSuivie(ds, { f: null, organisme: null, organismeId: 3 })?.id, 3);
  assert.deepEqual(Object.keys(resumeOrganisme(apave)).sort(), ['archive', 'code', 'id', 'nomUsuel', 'type']);
  assert.match(refusFusion(fiche({ id: 5, nomUsuel: 'Apave 2', siret: SIRET_B }), apave)!, /SIRET différents/);
  assert.match(refusFusion(apave, apave)!, /différents/);
  assert.match(refusFusion(sud, aftral)!, /déjà fusionné/);
  assert.match(refusFusion(fiche({ id: 6, nomUsuel: 'Interne', type: 'interne' }), aftral)!, /service interne/);
  assert.match(refusFusion(aftral, fiche({ id: 7, nomUsuel: 'Vieux', archive: '2026-01-01' }))!, /archivé/);
  assert.equal(refusFusion(null, apave), 'Organisme introuvable');
  assert.equal(refusFusion(fiche({ id: 8, nomUsuel: 'Apave SA' }), apave), null, 'source sans SIRET');
  assert.deepEqual(aliasApresFusion(fiche({ id: 8, nomUsuel: 'Apave SA', alias: ['APAVE SA', 'Apave'] }), fiche({ id: 1, nomUsuel: 'Apave', alias: ['APAVE'] })), ['APAVE', 'Apave SA', 'APAVE SA']);
  const r = rattachementsDe({ referentiels: { formations: [{ organismeId: 1 }, { organismeId: 2 }] }, sessions: [{ organismeId: 1 }], plan: [] } as unknown as Dataset, 1);
  assert.deepEqual(r, { formations: 1, sessions: 1, suivies: 0, plan: 0, dossiers: 0, modules: 0, contacts: 0, tarifs: 0 });
});

test('module : lien https seulement (jamais javascript:, identifiants, espaces), organisme et formation en vigueur, valeurs bornées', () => {
  for (const u of ['https://formation.example/rgpd', 'https://elearning.example:8443/m?x=1']) assert.ok(urlModuleValide(u), u);
  for (const u of ['http://formation.example', 'javascript:alert(1)', 'https://u:p@formation.example', 'https://formation.example/a b', '', 42, `https://x.example/${'a'.repeat(500)}`, 'data:text/html,x']) {
    assert.equal(urlModuleValide(u), false, String(u));
  }
  const formations = [{ id: 'rgpd' }, { id: 'vieille', archive: '2026-01-01' }] as Formation[];
  const organismes = [fiche({ id: 1, nomUsuel: 'DSI', type: 'interne' }), fiche({ id: 2, nomUsuel: 'Ancien', archive: '2026-01-01' })];
  const ok = controlerModule({ code: 'rgpd-el', intitule: 'RGPD en ligne', organismeId: '1', formation: 'rgpd', url: 'https://formation.example/rgpd', dureeHeures: '1,5', coutLicence: '12', accesMois: '12' }, [], formations, organismes);
  assert.deepEqual(ok.valeur, { code: 'RGPD-EL', intitule: 'RGPD en ligne', organismeId: 1, formation: 'rgpd', url: 'https://formation.example/rgpd', dureeHeures: 1.5, langue: 'fr', coutLicence: 12, accesMois: 12, attestationRequise: false });
  const err = controlerModule({ code: 'RGPD-EL', intitule: '', organismeId: '9', formation: 'inconnue', url: 'http://x', dureeHeures: '0', langue: 'xx', coutLicence: '-1', accesMois: '0' }, [module()], formations, organismes).erreurs;
  assert.deepEqual(Object.keys(err).sort(), ['accesMois', 'code', 'coutLicence', 'dureeHeures', 'formation', 'intitule', 'langue', 'organismeId', 'url']);
  assert.match(controlerModule({ code: 'A', intitule: 'x', organismeId: 2, url: 'https://a.example', formation: 'vieille' }, [], formations, organismes).erreurs.organismeId!, /archivé/);
  assert.match(controlerModule({ code: 'A', intitule: 'x', url: 'https://a.example', formation: 'vieille' }, [], formations, organismes).erreurs.formation!, /archivée/);
  // Modification : code gardé, organisme et formation archivés acceptés s'ils sont déjà ceux du module.
  const avant = module({ organismeId: 2, formation: 'vieille' });
  assert.deepEqual(controlerModule({ intitule: 'Nouveau' }, [avant], formations, organismes, avant).erreurs, {});
  assert.equal(controlerModule({ organismeId: '' }, [avant], formations, organismes, avant).valeur!.organismeId, null);
});

test('inscription : ouverte, expirée (calculée), fin à valider, heures retenues ; avancement, réussite et date saisis', () => {
  const m = module({ accesMois: 1 });
  assert.ok(inscriptionOuverte(inscription()) && inscriptionOuverte(inscription({ statut: 'en_cours' })));
  assert.ok(!inscriptionOuverte(inscription({ statut: 'termine' })) && !inscriptionOuverte(inscription({ annuleLe: '2026-10-01' })));
  assert.equal(finAcces(inscription(), m), '2026-10-15');
  assert.equal(finAcces(inscription(), module({ accesMois: null })), null);
  assert.equal(etatInscription(inscription(), m, '2026-10-15'), 'inscrit');
  assert.equal(etatInscription(inscription(), m, '2026-10-16'), 'expire');
  assert.equal(etatInscription(inscription({ statut: 'termine' }), m, '2026-12-01'), 'termine');
  assert.ok(finAValider(inscription({ declareLe: '2026-10-08' })) && finAValider(inscription({ avancement: 100 })) && !finAValider(inscription({ avancement: 99 })));
  assert.ok(!finAValider(inscription({ declareLe: '2026-10-08', statut: 'termine' })));
  assert.equal(heuresRetenues(inscription({ heures: 3 }), m), 3);
  assert.equal(heuresRetenues(inscription(), m), 2);
  assert.equal(heuresRetenues(inscription(), module({ dureeHeures: null })), null);
  assert.equal(inscriptionOuverteDe([inscription({ id: 1, statut: 'termine' }), inscription({ id: 2 })], 2, 1)?.id, 2);
  assert.equal(inscriptionOuverteDe(undefined, 2, 1), null);
  assert.deepEqual(['40', '40 %', '0', '', '100', '101', 'x', '33,6'].map(avancementDe), [40, 40, 0, null, 100, NaN, NaN, 34]);
  assert.deepEqual(['oui', 'Réussi', 'non', 'échec', '', 'sans objet', 'peut-être', true, null].map(reussiteDe), [true, true, false, false, null, null, undefined, true, null]);
  assert.deepEqual(['2026-10-08', '08/10/2026', '', '31/02/2026', 'demain'].map(dateSaisie), ['2026-10-08', '2026-10-08', null, '', '']);
});

test('import d’avancement : colonnes fermées (aucun temps de connexion), rapprochement par matricule ou e-mail, erreurs par ligne, effet idempotent', () => {
  const d = {
    employes: [{ id: 2, matriculePaie: '004102', email: 'mehdi.benali@entreprise.example' }, { id: 6, matriculePaie: null, email: null }],
    modulesElearning: [module()], inscriptionsElearning: [inscription({ id: 10, empId: 2 }), inscription({ id: 11, empId: 6, statut: 'en_cours', avancement: 30, avancementSource: 'import' })],
  };
  assert.deepEqual(lireImportElearning('', d, '2026-10-10'), { refus: 'Fichier vide' });
  assert.match((lireImportElearning('matricule;module;temps passé;score\nEMP-0002;RGPD-EL;3h;80', d, '2026-10-10') as { refus: string }).refus, /Colonne non admise : « temps passé », « score »/);
  assert.match((lireImportElearning('statut;avancement\nen cours;10', d, '2026-10-10') as { refus: string }).refus, /En-tête attendu/);
  assert.match((lireImportElearning('matricule;module', d, '2026-10-10') as { refus: string }).refus, /Aucune ligne/);
  const lu = lireImportElearning([
    'Matricule;E-mail;Code du module;Statut;Avancement;Date de fin;Réussite',
    '004102;;rgpd-el;en cours;40 %;;',
    ';mehdi.benali@entreprise.example;RGPD-EL;terminé;;08/10/2026;oui',
    'EMP-0006;;RGPD-EL;;30;;',
    'EMP-0099;;RGPD-EL;;10;;',
    'EMP-0002;;INCONNU;;10;;',
    'EMP-0002;;RGPD-EL;abandonné;150;2027-01-01;peut-être',
    'EMP-0002;;RGPD-EL;;;;',
    ';;;;;;',
  ].join('\n'), d, '2026-10-10');
  assert.ok('lignes' in lu);
  const lignes = (lu as { lignes: ReturnType<typeof lireImportElearning> extends infer R ? R extends { lignes: infer L } ? L : never : never }).lignes;
  assert.deepEqual(lignes.map(l => [l.n, l.empId, l.inscriptionId, l.errs]), [
    [2, 2, 10, []], [3, 2, 10, []], [4, 6, 11, []],
    [5, null, null, ['salarié introuvable (matricule ou e-mail)']],
    [6, 2, null, ['module inconnu']],
    [7, 2, 10, ['statut inconnu (inscrit, en cours, terminé)', 'avancement : nombre de 0 à 100', 'date de fin dans le futur', 'réussite : oui, non ou vide']],
    [8, 2, 10, ['aucune valeur à reprendre']],
  ], 'ligne entièrement vide écartée par la lecture');
  const [l1, l2, l3] = lignes;
  assert.deepEqual(effetImport(l1, d.inscriptionsElearning[0], '2026-10-10'), { avancement: 40, avancementSource: 'import', avancementLe: '2026-10-10', statut: 'en_cours' });
  assert.deepEqual(effetImport(l2, d.inscriptionsElearning[0], '2026-10-10'), { avancement: 100, avancementSource: 'import', avancementLe: '2026-10-08', reussi: true, statut: 'en_cours' });
  assert.equal(effetImport(l3, d.inscriptionsElearning[1], '2026-10-10'), null, 'valeur identique : rien ne change');
  assert.equal(effetImport(l2, inscription({ id: 10, statut: 'en_cours', avancement: 100, avancementSource: 'import', avancementLe: '2026-10-08', reussi: true }), '2026-10-10'), null);
  assert.ok(finAutomatique(true, module(), l2) && !finAutomatique(false, module(), l2) && !finAutomatique(true, module({ attestationRequise: true }), l2) && !finAutomatique(true, module(), l1));
  assert.match((lireImportElearning('matricule;module\nEMP-0002;RGPD-EL\nEMP-0006;RGPD-EL;x', { ...d, inscriptionsElearning: [] }, '2026-10-10') as { lignes: { errs: string[] }[] }).lignes[0].errs[0], /aucune inscription ouverte/);
});
