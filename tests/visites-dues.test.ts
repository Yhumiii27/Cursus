// Visites dues à un événement (t060) : embauche (3 mois, le jour de l'entrée pour un suivi renforcé ou un mineur, dispense
// par une visite récente), reprise après un arrêt (seuils de l'art. R4624-31 : maternité et maladie professionnelle quelle
// que soit la durée, 30 jours d'accident du travail, 60 jours de maladie), mi-carrière (âge réglable), fin de carrière ou
// post-exposition à la sortie (rappel sans blocage pour une habilitation SIR ou ATEX) ; échéances, relances, motif de la
// demande de visite, et confidentialité : le manager ne reçoit que « visite à programmer ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, DEFAULT_SETTINGS, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { champsRetenus } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { MOTIFS_VISITE } = await import('../shared/constants.ts');
const { appliquerReglages } = await import('../shared/reglages.ts');
const { relancesDues } = await import('../shared/rules/relances.ts');
const { motifParDefaut } = await import('../shared/rules/sante.ts');
const { texteVisiteSortie, visiteAProgrammer, visitesDues } = await import('../shared/rules/visites-dues.ts');
type User = import('../shared/types.ts').CurrentUser;
type Dataset = import('../shared/types.ts').Dataset;
type Corps = Record<string, any>;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const HSE: User = { role: 'rh', empId: null, nom: 'Sarah Cohen', intitule: 'Référente HSE', profilRh: 'referent_hse' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };

// Aïcha Diallo (7) : entrée en 2014, visite du 1er oct. 2025, née en 1983, aucune absence de santé.
// Sophie Lemaire (3) : née en 1981, 45 ans en 2026. Mehdi Benali (2) : habilitation électrique, équipe de Karim Haddad.
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => {
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    if (changeVerdicts(name)) suivreVerdicts(db);
    return typeof r === 'object' && r !== null ? r.message : r;
  });
  const domain = (ds: Dataset = loadFull(db, RH)) => new Domain(ds);
  const emp = (id: number, ds?: Dataset) => domain(ds).enrich(90, false).find(e => e.id === id)!;
  const dues = (id: number) => (emp(id).med.dues ?? []).map(v => [v.motif, v.le]);
  const echeances = (id: number, ds?: Dataset) => { const d = domain(ds); return d.echeances(d.enrich(90, false), 90).filter(x => x.kind === 'med' && x.emp.id === id); };
  const arret = (empId: number, type: string, du: string, au: string, statut = 'validee') => db.insert<{ id: number }>('absences', { empId, type, du, au, statut, keystone: false });
  const regler = (p: Corps) => db.setSetting('app', { ...db.getSetting<Corps>('app', {}), ...p });
  return { db, run, domain, emp, dues, echeances, arret, regler };
}
const jour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('motifs : mi-carrière et fin de carrière ou post-exposition ajoutés, avec leurs articles', () => {
  assert.deepEqual(Object.keys(MOTIFS_VISITE), ['periodique', 'embauche', 'reprise', 'employeur', 'mi_carriere', 'fin_carriere']);
  assert.equal(MOTIFS_VISITE.mi_carriere.article, 'Art. L4624-2-2');
  assert.match(MOTIFS_VISITE.fin_carriere.article, /L4624-2-1/);
  // Motif proposé : celui de la visite due la plus proche, sinon embauche ou renouvellement comme avant.
  assert.equal(motifParDefaut({ visite: null }), 'embauche');
  assert.equal(motifParDefaut({ visite: '2025-01-01' }), 'periodique');
  assert.equal(motifParDefaut({ visite: '2025-01-01' }, [{ motif: 'reprise' }, { motif: 'mi_carriere' }]), 'reprise');
});

test('embauche : 3 mois après l’entrée, le jour même pour un suivi renforcé ou un mineur ; close par une visite après l’entrée', () => {
  const { db, dues, echeances } = fresh();
  db.update('employes', 7, { entree: '2026-09-01', visite: null, avis: null });
  assert.deepEqual(dues(7), [['embauche', '2026-12-01']]);
  // Aucune visite enregistrée : la visite d'embauche, datée, remplace « Visite médicale non renseignée ».
  const [x] = echeances(7);
  assert.deepEqual([echeances(7).length, x.label, x.statut, x.key, jour(x.exp), !!x.sansDate, x.motifVisite], [1, 'Visite d’embauche', 'À programmer', 'due', '2026-12-01', false, 'embauche']);
  assert.deepEqual(x.action, { label: 'Demander la visite', intent: { type: 'medical', empId: 7, motif: 'embauche' } });
  // Suivi renforcé (examen d'aptitude avant l'affectation, art. R4624-24) : le jour de l'entrée, dépassée.
  db.update('employes', 7, { suivi: 'sir' });
  assert.deepEqual(dues(7), [['embauche', '2026-09-01']]);
  assert.deepEqual([echeances(7)[0].statut, echeances(7)[0].key], ['Dépassée', 'exp']);
  // Mineur à l'entrée (art. R4624-18) : le jour de l'entrée aussi.
  db.update('employes', 7, { suivi: null, naissance: 2010, naissanceLe: '2010-05-01' });
  assert.deepEqual(dues(7), [['embauche', '2026-09-01']]);
  // Visite enregistrée après l'entrée : close.
  db.update('employes', 7, { naissance: 1983, naissanceLe: '1983-12-05', visite: '2026-10-01', avis: 'apte' });
  assert.deepEqual(dues(7), []);
});

test('embauche : dispense par une visite des 5 ans qui précèdent (2 ans en suivi renforcé) ; fiche ancienne sans visite inchangée', () => {
  const { db, dues, echeances } = fresh();
  // Visite de 2024, embauche en septembre 2026 : dispense présumée (art. R4624-15).
  db.update('employes', 7, { entree: '2026-09-01', visite: '2024-01-15', avis: 'apte' });
  assert.deepEqual(dues(7), []);
  // Suivi renforcé : au-delà de 2 ans, plus de dispense (art. R4624-27) ; avis d'inaptitude non plus.
  db.update('employes', 7, { suivi: 'sir' });
  assert.deepEqual(dues(7), [['embauche', '2026-09-01']]);
  db.update('employes', 7, { suivi: null, visite: '2026-02-01', avis: 'inapte' });
  assert.deepEqual(dues(7), [['embauche', '2026-12-01']]);
  // Ancienneté de plus de 2 ans sans aucune visite (dossier repris sans ses visites) : « non renseignée », comme avant.
  db.update('employes', 7, { entree: '2014-10-01', visite: null, avis: null });
  assert.deepEqual(dues(7), []);
  assert.deepEqual(echeances(7).map(x => [x.label, !!x.sansDate]), [['Visite médicale non renseignée', true]]);
});

test('reprise : seuils de l’art. R4624-31 (maternité, maladie professionnelle, 30 jours d’AT, 60 jours de maladie), arrêts jointifs réunis', () => {
  const { db, dues, arret } = fresh();
  // Accident du travail de 29 jours : rien ; de 30 jours : reprise le premier jour ouvré qui suit (lundi 31 août).
  const at = arret(7, 'AT', '2026-08-01', '2026-08-29');
  assert.deepEqual(dues(7), []);
  db.update('absences', at.id, { au: '2026-08-30' });
  assert.deepEqual(dues(7), [['reprise', '2026-08-31']]);
  db.remove('absences', at.id);
  // Maladie de 59 jours : rien ; deux arrêts jointifs de 30 jours : 60 jours, visite due.
  const m1 = arret(7, 'MALADIE', '2026-06-01', '2026-07-29');
  assert.deepEqual(dues(7), []);
  db.update('absences', m1.id, { au: '2026-06-30' });
  arret(7, 'MALADIE', '2026-07-01', '2026-07-30');
  assert.deepEqual(dues(7), [['reprise', '2026-07-31']]);
  // Visite enregistrée après la fin de l'arrêt : close.
  db.update('employes', 7, { visite: '2026-08-03', avis: 'apte' });
  assert.deepEqual(dues(7), []);
  // Congé de maternité et maladie professionnelle : quelle que soit la durée.
  const mat = arret(7, 'MATERNITE', '2026-09-01', '2026-09-05');
  assert.deepEqual(dues(7), [['reprise', '2026-09-07']], 'samedi 5 sept. : reprise le lundi');
  db.remove('absences', mat.id);
  arret(7, 'MP', '2026-09-14', '2026-09-16');
  assert.deepEqual(dues(7), [['reprise', '2026-09-17']]);
  // Accident de trajet : accident non professionnel, 60 jours ; une absence signalée (à qualifier) ne compte pas.
  arret(5, 'TRAJET', '2026-10-01', '2026-11-29');
  arret(5, 'MALADIE', '2026-06-01', '2026-09-01', 'signalee');
  assert.deepEqual(dues(5), [['reprise', '2026-11-30']]);
});

test('mi-carrière : l’année des 45 ans (âge réglable), close par la visite demandée pour ce motif, pas par une visite périodique', () => {
  const { db, run, dues, echeances, regler, domain } = fresh();
  assert.deepEqual(dues(3), [['mi_carriere', '2026-12-31']]);
  const [x] = echeances(3).filter(y => y.motifVisite);
  assert.deepEqual([x.label, x.statut, x.key], ['Visite de mi-carrière', 'À programmer', 'due']);
  // Sarah Cohen, 45 ans en 2025 : dépassée ; Thomas Garnier, 45 ans en 2021, avant la loi : rien.
  assert.deepEqual(dues(23), [['mi_carriere', '2025-12-31']]);
  assert.deepEqual(dues(6), []);
  // Âge fixé par accord : 44 ans, Sophie Lemaire en 2025, dépassée ; 47 ans, en 2028, pas encore (Thomas Garnier, né en
  // 1976, en 2023 : plus suivie).
  regler({ santeMiCarriereAge: 44 });
  assert.deepEqual(dues(3), [['mi_carriere', '2025-12-31']]);
  regler({ santeMiCarriereAge: 47 });
  assert.deepEqual([dues(3), dues(6)], [[], []]);
  regler({ santeMiCarriereAge: 45 });
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { santeMiCarriereAge: 70 }).santeMiCarriereAge, 55, 'borné');
  // Visite périodique : la mi-carrière reste due.
  db.update('employes', 3, { visite: '2026-10-01' });
  assert.deepEqual(dues(3), [['mi_carriere', '2026-12-31']]);
  // Demande sans motif : celui de la visite due ; l'avis la clôt et la visite n'est plus due.
  run(RH, 'medical.demander', { empId: 3 });
  assert.equal(loadFull(db, RH).demandesVisite.find(v => v.empId === 3)!.motif, 'mi_carriere');
  assert.deepEqual(echeances(3).filter(y => y.motifVisite).map(y => [y.planned, y.action]), [[true, null]]);
  run(RH, 'medical.avis', { empId: 3, date: '2026-10-10', avis: 'apte' });
  assert.deepEqual(dues(3), []);
  // Relances : clé par motif et par échéance, libellé neutre, donnée de santé (jamais au manager).
  const d = domain();
  const r = relancesDues(d, d.enrich(90, false), [90, 30, 7]).filter(y => y.empId === 23 && y.categorie === 'visite');
  assert.deepEqual(r.map(y => [y.cle, y.palier, y.libelle, y.sante]), [['med:23:mi_carriere:2025-12-31', 'echu', 'Visite médicale à programmer', true]]);
});

test('fin de carrière ou post-exposition : à la sortie d’un salarié en suivi renforcé ou exposé ; rappel ATEX sans blocage', () => {
  const { db, run, dues, echeances, domain, emp } = fresh();
  // Mehdi Benali : habilitation électrique cochée « SIR » au référentiel, suivi renforcé. Départ à la retraite.
  db.update('habilitations', 'he', { sir: true });
  assert.match(texteVisiteSortie(domain(), emp(2), '2026-12-31', 'retraite')!, /^Visite de fin de carrière à demander avant le départ/);
  run(RH, 'employe.sortie', { id: 2, date: '2026-12-31', motif: 'retraite' });
  assert.deepEqual(dues(2).filter(([m]) => m === 'fin_carriere'), [['fin_carriere', '2026-12-31']]);
  const x = echeances(2).find(y => y.motifVisite === 'fin_carriere')!;
  assert.deepEqual([x.label, x.action?.intent], ['Visite de fin de carrière', { type: 'medical', empId: 2, motif: 'fin_carriere' }]);
  // La visite demandée pour ce motif, puis l'avis : close.
  run(RH, 'medical.demander', { empId: 2, motif: 'fin_carriere' });
  run(RH, 'medical.avis', { empId: 2, date: '2026-10-10', avis: 'apte' });
  assert.deepEqual(dues(2).filter(([m]) => m === 'fin_carriere'), []);

  // Poste coché « exposé » (Camille Roux, cariste) : visite post-exposition pour une démission.
  db.update('postes', 1, { expose: true });
  assert.match(texteVisiteSortie(domain(), emp(1), '2026-11-30', 'demission')!, /^Visite post-exposition à demander/);
  // Fiche cochée par le service RH (`medical.suivi`) : même effet ; le journal ne retient que l'identifiant.
  assert.match(String(run(RH, 'medical.suivi', { empId: 7, expose: true })), /exposé à des risques particuliers/);
  assert.equal(loadFull(db, RH).employes.find(e => e.id === 7)!.expose, true);
  assert.deepEqual(champsRetenus('medical.suivi', { empId: 7, suivi: null, expose: true }), { empId: 7 });
  assert.match(texteVisiteSortie(domain(), emp(7), '2026-11-30', 'licenciement')!, /^Visite post-exposition/);
  // Décès : rien ; départ passé : prévenir le service de santé au travail.
  assert.equal(texteVisiteSortie(domain(), emp(7), '2026-11-30', 'deces'), null);
  assert.match(texteVisiteSortie(domain(), emp(7), '2026-10-01', 'demission')!, /départ passé/);

  // Habilitation ATEX exigée par le poste, aucune case cochée : rappel seulement, aucune échéance.
  db.update('postes', 8, { habilitations: ['atex'] });
  assert.match(texteVisiteSortie(domain(), emp(8), '2026-11-30', 'demission')!, /^Vérifier si une visite post-exposition est due \(Habilitation ATEX\)/);
  run(RH, 'employe.sortie', { id: 8, date: '2026-11-30', motif: 'demission' });
  assert.deepEqual(dues(8).filter(([m]) => m === 'fin_carriere'), []);
  // Aucune exposition ni habilitation à risques : rien.
  assert.equal(texteVisiteSortie(domain(), emp(9), '2026-11-30', 'demission'), null);
  // Le poste porte sa case au référentiel et au journal.
  run(RH, 'referentiel.poste.enregistrer', { id: 1, nom: 'Cariste', formations: [], habilitations: ['ac489'], sir: false, expose: false });
  assert.equal(loadFull(db, RH).referentiels.postes.find(p => p.id === 1)!.expose, false);
});

test('confidentialité : le manager et le référent HSE ne reçoivent que « visite à programmer », jamais le motif, l’arrêt ni l’exposition', () => {
  const { db, run, domain, emp, arret } = fresh();
  arret(2, 'MP', '2026-09-14', '2026-09-16');
  run(RH, 'medical.suivi', { empId: 2, expose: true });
  const full = loadFull(db, RH);
  assert.equal(visiteAProgrammer(new Domain(full), full.employes.find(e => e.id === 2)!), true);
  for (const user of [KARIM, HSE]) {
    const vue = buildSnapshot(db, user), m = vue.employes.find(e => e.id === 2)!;
    assert.deepEqual([m.visite, m.expose, m.aptitude], [null, null, { ok: true, avis: 'apte', restrictions: [], aProgrammer: true }], user.nom);
    // Ni visite due, ni échéance médicale, ni nature de l'arrêt dans sa vue ; « visite à programmer » dans le texte.
    const x = emp(2, vue);
    assert.deepEqual([x.med.dues, x.med.aProgrammer], [undefined, true]);
    assert.equal(x.med.text, 'Aptitude médicale valide · visite à programmer par le service RH');
    assert.deepEqual(visitesDues(domain(vue), vue.employes.find(e => e.id === 2)!), []);
    const d = domain(vue);
    assert.deepEqual(d.echeances(d.enrich(90, false), 90).filter(y => y.kind === 'med' && y.emp.id === 2), []);
  }
  assert.ok(buildSnapshot(db, KARIM).absences.filter(a => a.empId === 2).every(a => a.type !== 'MP'));
  // Sans visite due : aucune mention.
  assert.equal(buildSnapshot(db, KARIM).employes.find(e => e.id === 6)!.aptitude!.aProgrammer, undefined);
});
