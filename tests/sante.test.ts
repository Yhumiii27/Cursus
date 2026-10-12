// Tests de la santé au travail : échéance d'aptitude médicale dans les Échéances et le statut (t056), avis du médecin
// du travail — apte, restrictions, inapte — avec suspension des habilitations incompatibles, vue réduite du manager et
// verdict seul pour Keystone (t062), demandes de visite suivies jusqu'à la saisie de la visite (t114).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { contexte, enregistrerAffectation, enregistrerChantier } = await import('../server/src/integrations/keystone-entrant.ts');
const { Domain } = await import('../shared/domain.ts');
const { MOTIF_RESTRICTION } = await import('../shared/constants.ts');
const { matricule } = await import('../shared/format.ts');
const { controlerAvis } = await import('../shared/rules/sante.ts');
type User = import('../shared/types.ts').CurrentUser;
type Dataset = import('../shared/types.ts').Dataset;
type Corps = Record<string, any>;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const SARAH: User = { role: 'manager', empId: 23, nom: 'Sarah Cohen', intitule: 'Manager · Qualité & HSE' };
const collab = (empId: number, nom: string): User => ({ role: 'collaborateur', empId, nom, intitule: '' });

/** Base de démonstration ; les actions passent par le même enchaînement que POST /api/actions/:nom (suivi des verdicts compris). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => {
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload);
    if (changeVerdicts(name)) suivreVerdicts(db);
    return typeof r === 'object' && r !== null ? r.message : r;
  });
  const domain = (ds: Dataset = loadFull(db, RH)) => new Domain(ds);
  const emp = (id: number, ds?: Dataset) => { const d = domain(ds); return d.enrich(90, false).find(e => e.id === id)!; };
  const echeance = (id: number) => { const d = domain(); return d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'med' && x.emp.id === id); };
  const verdict = (chantier: string, empId: number) => {
    const d = domain();
    return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === chantier)!.res.find(r => r.e.id === empId)!;
  };
  const motifs = (chantier: string, empId: number) => verdict(chantier, empId).reasons.map(r => `${r.code}:${r.level}`);
  const chantier = (id: string, c: Corps, affectations: [empId: number, du: string, au: string][]) => db.tx(() => {
    enregistrerChantier(contexte(db), id, c);
    affectations.forEach(([empId, du, au], i) => enregistrerAffectation(contexte(db), `AF-${id}-${i}`, { matricule: matricule(empId), chantier: id, du, au }));
    suivreVerdicts(db);
  });
  const envoyes = () => db.all<{ type: string; contenu: Corps }>('envois').filter(e => e.type === 'verdict.modifie').map(e => e.contenu);
  const demandes = (empId: number) => db.all<Corps>('demandesVisite').filter(x => x.empId === empId);
  const titre = (empId: number, h: string) => db.all<Corps>('habTitres').find(t => t.empId === empId && t.h === h)!;
  return { db, run, domain, emp, echeance, verdict, motifs, chantier, envoyes, demandes, titre };
}
const refus = (re: RegExp, status = 400) => (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message);

// — t056 : échéance d'aptitude médicale —

test('t056 : l’aptitude médicale a son échéance (type Visite médicale), avec action, et compte dans le statut', () => {
  const { db, domain, emp, echeance } = fresh();
  const d = domain(), ech = d.echeances(d.enrich(90, false), 90).filter(x => x.kind === 'med');
  assert.equal(ech.length, 24, 'une échéance d’aptitude par collaborateur');

  // Thomas Garnier : visite du 20 août 2024, aptitude échue le 20 août 2026.
  const thomas = echeance(6)!;
  assert.deepEqual([thomas.kindLabel, thomas.label, thomas.statut, thomas.key, thomas.exp.getTime(), thomas.d], ['Visite médicale', 'Aptitude médicale', 'Échue', 'exp', new Date(2026, 7, 20).getTime(), -51]);
  assert.deepEqual(thomas.action, { label: 'Demander la visite', intent: { type: 'medical', empId: 6 } });
  // Bastien Morel : aucune visite enregistrée, visite d'embauche déjà demandée (jeu de démonstration).
  const bastien = echeance(24)!;
  assert.deepEqual([bastien.label, bastien.statut, bastien.key, bastien.sansDate, bastien.planned, bastien.plannedLabel, bastien.action],
    ['Visite médicale non renseignée', 'Non renseignée', 'exp', true, true, 'Visite demandée le 5 oct.', null]);
  assert.equal(emp(24).worst, 'exp', 'collaborateur sans visite : non conforme');

  // Fatou Ndiaye n'a aucune habilitation : son aptitude compte quand même dans le statut.
  assert.equal(emp(17).worst, 'ok');
  db.update('employes', 17, { visite: '2024-11-15' });
  assert.equal(emp(17).worst, 'due', 'aptitude à renouveler sous 90 jours');
  assert.deepEqual([echeance(17)!.statut, echeance(17)!.key, emp(17).next!.d], ['À renouveler', 'due', 36]);
  db.update('employes', 17, { visite: '2024-09-01' });
  assert.equal(emp(17).worst, 'exp');
  assert.equal(echeance(17)!.statut, 'Échue');

  // Le manager ne reçoit que le verdict : aucune échéance datée, mais le statut en tient compte.
  const vue = buildSnapshot(db, KARIM), dm = domain(vue);
  assert.deepEqual(dm.echeances(dm.enrich(90, false), 90).filter(x => x.kind === 'med').map(x => x.emp.id), [12], 'sa propre échéance seulement');
  assert.equal(emp(6, vue).worst, 'exp');
  assert.equal(emp(6, vue).med.text, 'Aptitude médicale non valide — visite à programmer par le service RH');
});

test('Go / No Go : aptitude non valide aujourd’hui → réserve APTITUDE ; Keystone ne reçoit qu’un libellé neutre', () => {
  const { db, run, motifs, verdict, domain, chantier } = fresh();
  // Aïcha Diallo, aucune habilitation qui exige l'aptitude ; chantier en France sans exigence.
  db.update('employes', 7, { visite: '2024-09-01' });
  chantier('K-M1', { nom: 'Inventaire', lieu: 'Lyon', pays: 'FR', debut: '2026-11-03', fin: '2026-11-05' }, [[7, '2026-11-03', '2026-11-05']]);
  assert.deepEqual(motifs('K-M1', 7), ['APTITUDE:reserve']);
  assert.equal(verdict('K-M1', 7).status, 'reserve', 'alerte, pas de blocage');
  assert.equal(verdict('K-M1', 7).reasons[0].detailed, 'Visite médicale périodique en retard : affectation à vérifier avec le service RH');
  // Aptitude valide aujourd'hui, même si elle échoit pendant (ou avant) le chantier : rien, la date ne sort pas.
  db.update('employes', 7, { visite: '2024-11-04' });
  assert.deepEqual(motifs('K-M1', 7), []);
  db.update('employes', 7, { visite: '2024-10-20' });
  assert.deepEqual(motifs('K-M1', 7), []);
  // Aucune visite enregistrée : réserve.
  db.sql.prepare('UPDATE employes SET visite = NULL WHERE id = 7').run();
  assert.equal(verdict('K-M1', 7).reasons[0].detailed, 'Aucune visite médicale enregistrée : affectation à vérifier avec le service RH');

  // Partage détaillé : un seul libellé neutre, quelle que soit la cause (retard, restrictions ou les deux), sans date.
  run(RH, 'medical.avis', { empId: 7, date: '2024-09-01', avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite d’engins', jusquau: '' }] });
  assert.deepEqual(motifs('K-M1', 7), ['APTITUDE:reserve'], 'une seule réserve pour le retard et les restrictions');
  assert.equal(verdict('K-M1', 7).reasons[0].detailed, 'Visite médicale périodique en retard · Restrictions d’aptitude en vigueur : affectation à vérifier avec le service RH');
  const d = domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-M1')!;
  assert.deepEqual(d.verdictKeystone(ch, true).ressources[0].motifs, [{ code: 'APTITUDE', niveau: 'GO_RESERVE', libelle: 'Aptitude médicale à vérifier avec le service RH' }]);
  assert.deepEqual(d.keystonePayload(ch, true).ressources[0].motifs, [{ code: 'APTITUDE', libelle: 'Aptitude médicale à vérifier avec le service RH' }]);
});

test('Go / No Go : le motif APTITUDE ne dépend pas des dates de présence — une sonde de Keystone n’apprend ni visite ni fin de restriction', () => {
  const { db, domain, chantier } = fresh();
  let n = 0;
  /** Chantier sonde d'un jour, posé comme le ferait Keystone, et motifs transmis en partage détaillé pour la ressource. */
  const sonde = (empId: number, jour: string) => {
    const id = `K-SONDE-${++n}`;
    chantier(id, { nom: 'Sonde', lieu: 'Lyon', pays: 'FR', debut: jour, fin: jour }, [[empId, jour, jour]]);
    const d = domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === id)!;
    return JSON.stringify(d.verdictKeystone(ch, true).ressources[0].motifs);
  };
  // Mehdi Benali : visite du 15 juin 2025, aptitude jusqu'au 15 juin 2027. Avant et après l'échéance : mêmes motifs.
  assert.equal(sonde(2, '2027-06-14'), sonde(2, '2027-06-16'));
  assert.equal(sonde(2, '2026-10-15'), sonde(2, '2028-01-10'));
  // Inès Dupont : restrictions jusqu'au 31 décembre 2026. Avant et après leur terme : même réserve, au libellé neutre.
  const ines = sonde(5, '2026-12-30');
  assert.equal(ines, JSON.stringify([{ code: 'APTITUDE', niveau: 'GO_RESERVE', libelle: 'Aptitude médicale à vérifier avec le service RH' }]));
  assert.equal(sonde(5, '2027-01-04'), ines);
  // Ni la date de la visite, ni l'avis, ni l'existence de restrictions dans ce qui part.
  for (const x of ['2026-09-28', '28 sept.', 'estriction', '31 déc.', 'charges', 'hauteur']) assert.ok(!ines.includes(x), x);
  // Le lendemain du terme, la réserve tombe pour tous les chantiers à la fois (état du jour).
  db.update('employes', 5, { restrictions: [{ texte: 'Pas de travail en hauteur', jusquau: '2026-10-09' }] });
  assert.equal(sonde(5, '2026-10-14'), '[]');
});

// — t062 : avis du médecin du travail —

test('t062 : avis avec restrictions — restrictions datées, habilitation incompatible suspendue, manager : verdict et restrictions', () => {
  const { db, run, emp, titre, motifs, verdict, chantier, envoyes, domain } = fresh();
  const msg = run(RH, 'medical.avis', {
    empId: 2, date: '2026-10-08', avis: 'restrictions', suspendre: ['hauteur'],
    restrictions: [{ texte: '  Pas de travail en hauteur ', jusquau: '2026-12-31' }, { texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }, { texte: '', jusquau: '' }],
  });
  assert.equal(msg, 'Avis du médecin du travail enregistré — Mehdi Benali · Apte avec restrictions, visite du 8 oct. 2026 · 1 habilitation suspendue');
  const row = db.get<Corps>('employes', 2)!;
  assert.deepEqual([row.visite, row.avis, row.restrictions], ['2026-10-08', 'restrictions',
    [{ texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }, { texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }]]);
  const t = titre(2, 'hauteur');
  // Datée du jour de la décision : la date de la visite ne se lit pas dans celle de la suspension.
  assert.deepEqual([t.mesure, t.mesureDate, t.mesureMotif, t.mesurePar], ['suspension', '2026-10-10', MOTIF_RESTRICTION, 'Sandrine Vidal']);
  const mehdi = emp(2);
  assert.equal(mehdi.med.ok, true, 'apte avec restrictions : aptitude valide');
  assert.equal(mehdi.med.text, 'Visite du 8 oct. 2026 · apte avec restrictions, aptitude valide jusqu’au 8 oct. 2028');
  assert.equal(mehdi.habs.find(h => h.h === 'hauteur')!.key, 'susp');

  // Manager : verdict et restrictions en vigueur, ni date de visite, ni avis daté ; le motif de la suspension ne dit rien de plus.
  const vue = buildSnapshot(db, KARIM), m = vue.employes.find(e => e.id === 2)!;
  assert.deepEqual([m.visite, m.avis, m.restrictions, m.aptitude], [null, null, [], {
    ok: true, avis: 'restrictions', restrictions: [{ texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }, { texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }],
  }]);
  assert.equal(emp(2, vue).med.text, 'Apte avec restrictions — avis du médecin du travail');
  assert.equal(m.habs.find(h => h.h === 'hauteur')!.mesureMotif, MOTIF_RESTRICTION);
  assert.ok(!JSON.stringify(m).includes('2026-10-08'), 'aucune date de visite transmise au manager');
  // Le collaborateur voit son propre avis.
  const sienne = buildSnapshot(db, collab(2, 'Mehdi Benali')).employes[0];
  assert.deepEqual([sienne.visite, sienne.avis, sienne.restrictions.length], ['2026-10-08', 'restrictions', 2]);

  // Go / No Go : réserve pendant les restrictions, rien après leur terme ; Keystone ne reçoit que le code.
  chantier('K-R1', { nom: 'Révision compresseur', lieu: 'Feyzin', pays: 'FR', debut: '2026-11-16', fin: '2026-11-20' }, [[2, '2026-11-16', '2026-11-20']]);
  chantier('K-R2', { nom: 'Arrêt annuel', lieu: 'Feyzin', pays: 'FR', debut: '2027-01-11', fin: '2027-01-15', habilitations: ['hauteur'] }, [[2, '2027-01-11', '2027-01-15']]);
  assert.deepEqual(motifs('K-R1', 2), ['APTITUDE:reserve']);
  assert.equal(verdict('K-R1', 2).reasons[0].detailed, 'Restrictions d’aptitude en vigueur : affectation à vérifier avec le service RH');
  // Restrictions en vigueur aujourd'hui : même réserve pour un chantier qui commence après leur terme (état du jour, jamais
  // rapporté aux dates de présence) ; le titre reste suspendu.
  assert.deepEqual(motifs('K-R2', 2), ['APTITUDE:reserve', 'HABILITATION_SUSPENDUE:nogo']);
  const d = domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-R1')!;
  const detaille = JSON.stringify(d.verdictKeystone(ch, true));
  for (const x of ['charges', '15 kg', 'hauteur', 'estriction', '2026-10-08', '8 oct.', '31 déc.']) assert.ok(!detaille.includes(x), `rien de l’avis dans le verdict : ${x}`);
  assert.deepEqual(envoyes().filter(v => v.chantier === 'K-R1').at(-1)!.ressource.motifs, [{ code: 'APTITUDE', niveau: 'GO_RESERVE' }]);

  // Nouvel avis apte : la suspension décidée à l'avis précédent est levée, les restrictions s'effacent.
  assert.equal(run(RH, 'medical.avis', { empId: 2, date: '2026-10-10', avis: 'apte', lever: ['hauteur'] }),
    'Avis du médecin du travail enregistré — Mehdi Benali · Apte, visite du 10 oct. 2026 · 1 suspension levée · 2 chantiers signalés à Keystone');
  assert.deepEqual([titre(2, 'hauteur').mesure, db.get<Corps>('employes', 2)!.restrictions, db.get<Corps>('employes', 2)!.avis], [null, [], 'apte']);
  assert.deepEqual(motifs('K-R1', 2), []);
  assert.deepEqual(motifs('K-R2', 2), []);
});

test('t062 : avis d’inaptitude — habilitations qui exigent l’aptitude non valides d’office, No Go APTITUDE, manager : verdict seul', () => {
  const { db, run, emp, echeance, motifs, envoyes } = fresh();
  // Romain Chevalier : à Tanger (K-2614) et à Abidjan (K-2611), Go jusqu'ici.
  assert.deepEqual(motifs('K-2614', 18), []);
  run(RH, 'medical.avis', { empId: 18, date: '2026-10-09', avis: 'inapte', restrictions: [{ texte: 'ignorée', jusquau: '' }] });
  const romain = emp(18);
  assert.deepEqual([romain.med.ok, romain.med.text, romain.worst, db.get<Corps>('employes', 18)!.restrictions], [false, 'Inapte — avis du médecin du travail du 9 oct. 2026', 'exp', []]);
  // Habilitation électrique et travaux en hauteur exigent l'aptitude : suspendues (prérequis) ; AIPR, non.
  assert.deepEqual(romain.habs.map(h => [h.h, h.key, h.mesure]), [['he', 'susp', null], ['aipr', 'ok', null], ['hauteur', 'susp', null]]);
  assert.deepEqual(motifs('K-2614', 18), ['APTITUDE:nogo', 'HABILITATION:nogo', 'HABILITATION:nogo']);
  assert.deepEqual(envoyes().filter(v => v.chantier === 'K-2614' && v.ressource.matricule === 'EMP-0018').at(-1)!.ressource.motifs[0], { code: 'APTITUDE', niveau: 'NO_GO' });
  assert.deepEqual([echeance(18)!.label, echeance(18)!.statut, echeance(18)!.key], ['Avis d’inaptitude', 'Inapte', 'exp']);
  // Manager : le verdict, rien d'autre.
  const vue = buildSnapshot(db, KARIM), m = vue.employes.find(e => e.id === 18)!;
  assert.deepEqual([m.visite, m.avis, m.aptitude], [null, null, { ok: false, avis: 'inapte', restrictions: [] }]);
  assert.equal(emp(18, vue).med.text, 'Inapte — avis du médecin du travail');
  // Avis d'inaptitude : aucune suspension n'est levée.
  assert.throws(() => run(RH, 'medical.avis', { empId: 5, date: '2026-10-09', avis: 'inapte', lever: ['hauteur'] }), refus(/aucune suspension n’est levée/));
});

test('t062 : contrôles de l’avis et des habilitations désignées', () => {
  const { run } = fresh();
  const avis = (p: Corps) => () => run(RH, 'medical.avis', { empId: 2, date: '2026-10-08', avis: 'apte', ...p });
  assert.throws(avis({ avis: 'restrictions' }), refus(/Recopiez au moins une restriction/));
  assert.throws(avis({ avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: '2026-09-30' }] }), refus(/Restriction 1 : la date de fin précède la visite/));
  assert.throws(avis({ avis: 'restrictions', restrictions: [{ texte: 'x'.repeat(301), jusquau: '' }] }), refus(/300 caractères au plus/));
  assert.throws(avis({ avis: 'restrictions', restrictions: [{ texte: '', jusquau: '2026-12-31' }] }), refus(/Restriction 1 : recopiez le texte/));
  assert.throws(avis({ date: '2026-10-11' }), refus(/postérieure à aujourd’hui/));
  assert.throws(avis({ avis: 'favorable' }), refus(/Avis du médecin du travail requis/));
  assert.throws(avis({ avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: '' }], suspendre: ['ac489'] }), refus(/ne détient pas ce titre : Autorisation de conduite — chariots R489/));
  assert.throws(avis({ suspendre: ['hauteur'], lever: ['hauteur'] }), refus(/pas les deux/));
  // Suspension d'un autre motif : ni redoublée, ni levée par l'avis.
  run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Incident sur passerelle' });
  assert.throws(avis({ avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: '' }], suspendre: ['hauteur'] }), refus(/déjà suspendue/));
  assert.throws(avis({ lever: ['hauteur'] }), refus(/n’est pas suspendue à la suite d’un avis/));
  assert.throws(() => run(KARIM, 'medical.avis', { empId: 2, date: '2026-10-08', avis: 'apte' }), refus(/service RH/, 403));
  // Règle partagée avec le dialogue : lignes vides ignorées, espaces normalisés, sans terme → null ; hors restrictions, vidées.
  assert.deepEqual(controlerAvis({ date: '2026-10-01', avis: 'restrictions', restrictions: [{ texte: ' Pas  de conduite ', jusquau: '' }, { texte: ' ', jusquau: '' }] }, '2026-10-10'),
    { avis: { date: '2026-10-01', avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: null }] }, errors: [] });
  assert.deepEqual(controlerAvis({ date: '2026-10-01', avis: 'apte', restrictions: [{ texte: 'x', jusquau: '' }] }, '2026-10-10').avis.restrictions, []);
});

test('t062 : la fiche ne change plus la date de visite (avis du médecin du travail) ; une base existante reste apte', () => {
  const { db, run, emp } = fresh();
  assert.throws(() => run(RH, 'employe.modifier', { id: 2, visite: '2026-10-01' }), refus(/s’enregistre avec l’avis du médecin du travail/));
  // Fiche complète renvoyée telle quelle (visite inchangée) : acceptée.
  assert.equal(run(RH, 'employe.modifier', { id: 2, poste: 'Technicien de maintenance confirmé', visite: '2025-06-15' }), 'Fiche de Mehdi Benali mise à jour');
  // Visite saisie avant l'enregistrement des avis (colonnes vides) : apte, sans restriction.
  db.sql.prepare('UPDATE employes SET avis = NULL, restrictions = NULL WHERE id = 3').run();
  const sophie = emp(3);
  assert.deepEqual([sophie.restrictions, sophie.med.avis, sophie.med.ok, sophie.med.text], [[], 'apte', true, 'Visite du 12 sept. 2025 · aptitude valide jusqu’au 12 sept. 2027']);
});

// — t114 : demandes de visite médicale —

test('t114 : la demande de visite est enregistrée, affichée « Visite demandée le … », puis close par la saisie de la visite', () => {
  const { db, run, domain, emp, echeance, demandes } = fresh();
  const he = () => emp(6).habs.find(h => h.h === 'he')!;
  assert.equal(domain().habAction(6, he())!.intent.type, 'medical');
  assert.equal(run(RH, 'medical.demander', { empId: 6 }), 'Visite médicale demandée — Thomas Garnier (renouvellement) · demande à transmettre au service de santé au travail');
  assert.deepEqual(demandes(6).map(x => [x.motif, x.le, x.par, x.statut, x.closeLe]), [['periodique', '2026-10-10', 'Sandrine Vidal', 'demandee', null]]);
  // Le bouton n'est plus proposé : « Visite demandée le … » à sa place, dans les habilitations (ouvre la demande en cours)
  // comme dans les échéances (visite et habilitation, affichées comme planifiées).
  assert.deepEqual(domain().habAction(6, he()), { label: 'Visite demandée le 10 oct.', intent: { type: 'medical', empId: 6 } });
  assert.deepEqual([echeance(6)!.planned, echeance(6)!.plannedLabel, echeance(6)!.action], [true, 'Visite demandée le 10 oct.', null]);
  const d = domain(), echHe = d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'hab' && x.emp.id === 6 && x.label === he().hm.nom)!;
  assert.deepEqual([echHe.planned, echHe.plannedLabel], [true, 'Visite demandée le 10 oct.']);
  assert.equal(emp(6).med.text, 'Aptitude échue le 20 août 2026 — visite demandée le 10 oct. 2026');
  assert.throws(() => run(RH, 'medical.demander', { empId: 6 }), refus(/Visite déjà demandée le 10 oct\. 2026 pour Thomas Garnier/));
  assert.throws(() => run(RH, 'medical.demander', { empId: 3, motif: 'confort' }), refus(/Motif de visite inconnu/));

  // Réservée au service RH et à l'intéressé : jamais transmise au manager.
  assert.deepEqual(buildSnapshot(db, KARIM).demandesVisite, []);
  assert.deepEqual(buildSnapshot(db, collab(6, 'Thomas Garnier')).demandesVisite.map(x => x.motif), ['periodique']);
  assert.deepEqual(buildSnapshot(db, collab(2, 'Mehdi Benali')).demandesVisite, []);

  // La visite saisie clôt la demande.
  assert.match(String(run(RH, 'medical.avis', { empId: 6, date: '2026-10-10', avis: 'apte' })), /· demande de visite close/);
  assert.deepEqual(demandes(6).map(x => [x.statut, x.closeLe, x.closePar]), [['realisee', '2026-10-10', 'Sandrine Vidal']]);
  assert.equal(emp(6).med.ok, true);
  assert.deepEqual([echeance(6)!.key, echeance(6)!.planned, echeance(6)!.action], ['ok', false, null], 'aptitude valide : rien à demander');
  // Une nouvelle demande reste possible depuis la fiche, par exemple à la demande de l'employeur.
  assert.match(String(run(RH, 'medical.demander', { empId: 6, motif: 'employeur' })), /Thomas Garnier \(à la demande de l’employeur\)/);
});

test('t114 : annulation d’une demande ; une visite antérieure à la demande ne la clôt pas', () => {
  const { run, demandes, emp } = fresh();
  const [x] = demandes(24);
  assert.equal(x.motif, 'embauche');
  assert.equal(run(RH, 'medical.annuler', { id: x.id }), 'Demande de visite annulée — Bastien Morel');
  assert.deepEqual([demandes(24)[0].statut, demandes(24)[0].closeLe, demandes(24)[0].closePar], ['annulee', '2026-10-10', 'Sandrine Vidal']);
  assert.throws(() => run(RH, 'medical.annuler', { id: x.id }), refus(/introuvable ou déjà close/));
  // Sans visite enregistrée, le motif proposé est la visite d'embauche.
  run(RH, 'medical.demander', { empId: 24 });
  assert.deepEqual(demandes(24).map(v => [v.motif, v.statut]), [['embauche', 'annulee'], ['embauche', 'demandee']]);
  run(RH, 'medical.avis', { empId: 24, date: '2026-10-01', avis: 'apte' });
  assert.equal(demandes(24)[1].statut, 'demandee', 'visite du 1er octobre : la demande du 10 reste en cours');
  assert.equal(emp(24).med.text, 'Visite du 1 oct. 2026 · aptitude valide jusqu’au 1 oct. 2028 · visite demandée le 10 oct. 2026');
});

test('jeu de démonstration : Inès Dupont, avis avec restrictions, travaux en hauteur suspendus ; sa manager voit les restrictions', () => {
  const { db, motifs, emp } = fresh();
  assert.equal(emp(5).habs.find(h => h.h === 'hauteur')!.key, 'susp');
  assert.ok(motifs('K-2625', 5).includes('APTITUDE:reserve'), 'audit de Tema pendant les restrictions');
  const m = buildSnapshot(db, SARAH).employes.find(e => e.id === 5)!;
  assert.deepEqual(m.aptitude!.restrictions!.map(r => r.texte), ['Pas de port de charges de plus de 15 kg', 'Pas de travail en hauteur']);
  assert.equal(m.visite, null);
});
