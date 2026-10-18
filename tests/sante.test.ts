// Tests de la santé au travail : échéance d'aptitude médicale dans les Échéances et le statut (t056), avis du médecin
// du travail — apte, restrictions, inapte — avec suspension des habilitations incompatibles, vue réduite du manager et
// verdict seul pour Keystone (t062), demandes de visite suivies jusqu'à la saisie de la visite (t114).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { SqliteDb: Db } = await import('../server/src/db.ts');
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
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
    if (changeVerdicts(name)) await suivreVerdicts(db);
    return typeof r === 'object' && r !== null ? r.message : r;
  });
  const domain = async (ds?: Dataset) => new Domain(ds ?? await loadFull(db, RH));
  const emp = async (id: number, ds?: Dataset) => { const d = await domain(ds); return d.enrich(90, false).find(e => e.id === id)!; };
  const echeance = async (id: number) => { const d = await domain(); return d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'med' && x.emp.id === id); };
  const verdict = async (chantier: string, empId: number) => {
    const d = await domain();
    return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === chantier)!.res.find(r => r.e.id === empId)!;
  };
  const motifs = async (chantier: string, empId: number) => (await verdict(chantier, empId)).reasons.map(r => `${r.code}:${r.level}`);
  const chantier = async (id: string, c: Corps, affectations: [empId: number, du: string, au: string][]) => await db.tx(async () => {
    await enregistrerChantier(await contexte(db), id, c);
    for (const [i, [empId, du, au]] of affectations.entries()) await enregistrerAffectation(await contexte(db), `AF-${id}-${i}`, { matricule: matricule(empId), chantier: id, du, au });
    await suivreVerdicts(db);
  });
  const envoyes = async () => (await db.all<{ type: string; contenu: Corps }>('envois')).filter(e => e.type === 'verdict.modifie').map(e => e.contenu);
  const demandes = async (empId: number) => (await db.all<Corps>('demandesVisite')).filter(x => x.empId === empId);
  const titre = async (empId: number, h: string) => (await db.all<Corps>('habTitres')).find(t => t.empId === empId && t.h === h)!;
  return { db, run, domain, emp, echeance, verdict, motifs, chantier, envoyes, demandes, titre };
}
const refus = (re: RegExp, status = 400) => (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message);
const jour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// — t056 : échéance d'aptitude médicale —

test('t056 : l’aptitude médicale a son échéance (type Visite médicale), avec action, et compte dans le statut', async () => {
  const { db, domain, emp, echeance } = await fresh();
  const d = await domain(), ech = d.echeances(d.enrich(90, false), 90).filter(x => x.kind === 'med');
  // Une échéance d'aptitude par collaborateur, celle de Bastien Morel (aucune visite) remplacée par sa visite d'embauche ;
  // visites dues à un événement en plus (shared/rules/visites-dues.ts, tests/visites-dues.test.ts).
  assert.equal(ech.filter(x => !x.motifVisite).length, 23);
  assert.deepEqual(ech.filter(x => x.motifVisite).map(x => [x.emp.id, x.motifVisite]), [[3, 'mi_carriere'], [19, 'reprise'], [23, 'mi_carriere'], [24, 'embauche']]);

  // Thomas Garnier : visite du 20 août 2024, aptitude échue le 20 août 2026.
  const thomas = (await echeance(6))!;
  assert.deepEqual([thomas.kindLabel, thomas.label, thomas.statut, thomas.key, thomas.exp.getTime(), thomas.d], ['Visite médicale', 'Aptitude médicale', 'Échue', 'exp', new Date(2026, 7, 20).getTime(), -51]);
  assert.deepEqual(thomas.action, { label: 'Demander la visite', intent: { type: 'medical', empId: 6 } });
  // Bastien Morel : aucune visite enregistrée, entré le 1er sept. 2025 : visite d'embauche dépassée depuis le 1er déc. 2025,
  // déjà demandée (jeu de démonstration).
  const bastien = (await echeance(24))!;
  assert.deepEqual([bastien.label, bastien.statut, bastien.key, !!bastien.sansDate, jour(bastien.exp), bastien.planned, bastien.plannedLabel, bastien.action],
    ['Visite d’embauche', 'Dépassée', 'exp', false, '2025-12-01', true, 'Visite demandée le 5 oct.', null]);
  assert.equal((await emp(24)).worst, 'exp', 'collaborateur sans visite : non conforme');

  // Fatou Ndiaye n'a aucune habilitation : son aptitude compte quand même dans le statut.
  assert.equal((await emp(17)).worst, 'ok');
  await db.update('employes', 17, { visite: '2024-11-15' });
  assert.equal((await emp(17)).worst, 'due', 'aptitude à renouveler sous 90 jours');
  assert.deepEqual([(await echeance(17))!.statut, (await echeance(17))!.key, (await emp(17)).next!.d], ['À renouveler', 'due', 36]);
  await db.update('employes', 17, { visite: '2024-09-01' });
  assert.equal((await emp(17)).worst, 'exp');
  assert.equal((await echeance(17))!.statut, 'Échue');

  // Le manager ne reçoit que le verdict : aucune échéance datée, mais le statut en tient compte.
  const vue = await buildSnapshot(db, KARIM), dm = await domain(vue);
  assert.deepEqual(dm.echeances(dm.enrich(90, false), 90).filter(x => x.kind === 'med').map(x => x.emp.id), [12], 'sa propre échéance seulement');
  assert.equal((await emp(6, vue)).worst, 'exp');
  assert.equal((await emp(6, vue)).med.text, 'Aptitude médicale non valide — visite à programmer par le service RH');
});

test('Go / No Go : aptitude non valide aujourd’hui → réserve APTITUDE ; Keystone ne reçoit qu’un libellé neutre', async () => {
  const { db, run, motifs, verdict, domain, chantier } = await fresh();
  // Aïcha Diallo, aucune habilitation qui exige l'aptitude ; chantier en France sans exigence.
  await db.update('employes', 7, { visite: '2024-09-01' });
  await chantier('K-M1', { nom: 'Inventaire', lieu: 'Lyon', pays: 'FR', debut: '2026-11-03', fin: '2026-11-05' }, [[7, '2026-11-03', '2026-11-05']]);
  assert.deepEqual(await motifs('K-M1', 7), ['APTITUDE:reserve']);
  assert.equal((await verdict('K-M1', 7)).status, 'reserve', 'alerte, pas de blocage');
  assert.equal((await verdict('K-M1', 7)).reasons[0].detailed, 'Visite médicale périodique en retard : affectation à vérifier avec le service RH');
  // Aptitude valide aujourd'hui, même si elle échoit pendant (ou avant) le chantier : rien, la date ne sort pas.
  await db.update('employes', 7, { visite: '2024-11-04' });
  assert.deepEqual(await motifs('K-M1', 7), []);
  await db.update('employes', 7, { visite: '2024-10-20' });
  assert.deepEqual(await motifs('K-M1', 7), []);
  // Aucune visite enregistrée : réserve.
  db.sql.prepare('UPDATE employes SET visite = NULL WHERE id = 7').run();
  assert.equal((await verdict('K-M1', 7)).reasons[0].detailed, 'Aucune visite médicale enregistrée : affectation à vérifier avec le service RH');

  // Partage détaillé : un seul libellé neutre, quelle que soit la cause (retard, restrictions ou les deux), sans date.
  await run(RH, 'medical.avis', { empId: 7, date: '2024-09-01', avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite d’engins', jusquau: '' }] });
  assert.deepEqual(await motifs('K-M1', 7), ['APTITUDE:reserve'], 'une seule réserve pour le retard et les restrictions');
  assert.equal((await verdict('K-M1', 7)).reasons[0].detailed, 'Visite médicale périodique en retard · Restrictions d’aptitude en vigueur : affectation à vérifier avec le service RH');
  const d = await domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-M1')!;
  assert.deepEqual(d.verdictKeystone(ch, true, '2026-10-10T05:00:00.000Z').ressources[0].motifs, [{ code: 'APTITUDE', niveau: 'GO_RESERVE', libelle: 'Aptitude médicale à vérifier avec le service RH' }]);
  assert.deepEqual(d.keystonePayload(ch, true, '2026-10-10T05:00:00.000Z').ressources[0].motifs, [{ code: 'APTITUDE', libelle: 'Aptitude médicale à vérifier avec le service RH' }]);
});

test('Go / No Go : le motif APTITUDE ne dépend pas des dates de présence — une sonde de Keystone n’apprend ni visite ni fin de restriction', async () => {
  const { db, domain, chantier } = await fresh();
  let n = 0;
  /** Chantier sonde d'un jour, posé comme le ferait Keystone, et motifs transmis en partage détaillé pour la ressource. */
  const sonde = async (empId: number, jour: string) => {
    const id = `K-SONDE-${++n}`;
    await chantier(id, { nom: 'Sonde', lieu: 'Lyon', pays: 'FR', debut: jour, fin: jour }, [[empId, jour, jour]]);
    const d = await domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === id)!;
    return JSON.stringify(d.verdictKeystone(ch, true, '2026-10-10T05:00:00.000Z').ressources[0].motifs);
  };
  // Mehdi Benali : visite du 15 juin 2025, aptitude jusqu'au 15 juin 2027. Avant et après l'échéance : mêmes motifs.
  assert.equal(await sonde(2, '2027-06-14'), await sonde(2, '2027-06-16'));
  assert.equal(await sonde(2, '2026-10-15'), await sonde(2, '2028-01-10'));
  // Inès Dupont : restrictions jusqu'au 31 décembre 2026. Avant et après leur terme : même réserve, au libellé neutre.
  const ines = await sonde(5, '2026-12-30');
  assert.equal(ines, JSON.stringify([{ code: 'APTITUDE', niveau: 'GO_RESERVE', libelle: 'Aptitude médicale à vérifier avec le service RH' }]));
  assert.equal(await sonde(5, '2027-01-04'), ines);
  // Ni la date de la visite, ni l'avis, ni l'existence de restrictions dans ce qui part.
  for (const x of ['2026-09-28', '28 sept.', 'estriction', '31 déc.', 'charges', 'hauteur']) assert.ok(!ines.includes(x), x);
  // Le lendemain du terme, la réserve tombe pour tous les chantiers à la fois (état du jour).
  await db.update('employes', 5, { restrictions: [{ texte: 'Pas de travail en hauteur', jusquau: '2026-10-09' }] });
  assert.equal(await sonde(5, '2026-10-14'), '[]');
});

// — t062 : avis du médecin du travail —

test('t062 : avis avec restrictions — restrictions datées, habilitation incompatible suspendue, manager : verdict et restrictions', async () => {
  const { db, run, emp, titre, motifs, verdict, chantier, envoyes, domain } = await fresh();
  const msg = await run(RH, 'medical.avis', {
    empId: 2, date: '2026-10-08', avis: 'restrictions', suspendre: ['hauteur'],
    restrictions: [{ texte: '  Pas de travail en hauteur ', jusquau: '2026-12-31' }, { texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }, { texte: '', jusquau: '' }],
  });
  assert.equal(msg, 'Avis du médecin du travail enregistré — Mehdi Benali · Apte avec restrictions, visite du 8 oct. 2026 · 1 habilitation suspendue');
  const row = (await db.get<Corps>('employes', 2))!;
  assert.deepEqual([row.visite, row.avis, row.restrictions], ['2026-10-08', 'restrictions',
    [{ texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }, { texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }]]);
  const t = await titre(2, 'hauteur');
  // Datée du jour de la décision : la date de la visite ne se lit pas dans celle de la suspension.
  assert.deepEqual([t.mesure, t.mesureDate, t.mesureMotif, t.mesurePar], ['suspension', '2026-10-10', MOTIF_RESTRICTION, 'Sandrine Vidal']);
  const mehdi = await emp(2);
  assert.equal(mehdi.med.ok, true, 'apte avec restrictions : aptitude valide');
  assert.equal(mehdi.med.text, 'Visite du 8 oct. 2026 · apte avec restrictions, aptitude valide jusqu’au 8 oct. 2028');
  assert.equal(mehdi.habs.find(h => h.h === 'hauteur')!.key, 'susp');

  // Manager : verdict et restrictions en vigueur, ni date de visite, ni avis daté ; le motif de la suspension ne dit rien de plus.
  const vue = await buildSnapshot(db, KARIM), m = vue.employes.find(e => e.id === 2)!;
  assert.deepEqual([m.visite, m.avis, m.restrictions, m.aptitude], [null, null, [], {
    ok: true, avis: 'restrictions', restrictions: [{ texte: 'Pas de travail en hauteur', jusquau: '2026-12-31' }, { texte: 'Pas de port de charges de plus de 15 kg', jusquau: '2026-12-31' }],
  }]);
  assert.equal((await emp(2, vue)).med.text, 'Apte avec restrictions — avis du médecin du travail');
  assert.equal(m.habs.find(h => h.h === 'hauteur')!.mesureMotif, MOTIF_RESTRICTION);
  assert.ok(!JSON.stringify(m).includes('2026-10-08'), 'aucune date de visite transmise au manager');
  // Le collaborateur voit son propre avis.
  const sienne = (await buildSnapshot(db, collab(2, 'Mehdi Benali'))).employes[0];
  assert.deepEqual([sienne.visite, sienne.avis, sienne.restrictions.length], ['2026-10-08', 'restrictions', 2]);

  // Go / No Go : réserve pendant les restrictions, rien après leur terme ; Keystone ne reçoit que le code.
  await chantier('K-R1', { nom: 'Révision compresseur', lieu: 'Feyzin', pays: 'FR', debut: '2026-11-16', fin: '2026-11-20' }, [[2, '2026-11-16', '2026-11-20']]);
  await chantier('K-R2', { nom: 'Arrêt annuel', lieu: 'Feyzin', pays: 'FR', debut: '2027-01-11', fin: '2027-01-15', habilitations: ['hauteur'] }, [[2, '2027-01-11', '2027-01-15']]);
  assert.deepEqual(await motifs('K-R1', 2), ['APTITUDE:reserve']);
  assert.equal((await verdict('K-R1', 2)).reasons[0].detailed, 'Restrictions d’aptitude en vigueur : affectation à vérifier avec le service RH');
  // Restrictions en vigueur aujourd'hui : même réserve pour un chantier qui commence après leur terme (état du jour, jamais
  // rapporté aux dates de présence) ; le titre reste suspendu.
  assert.deepEqual(await motifs('K-R2', 2), ['APTITUDE:reserve', 'HABILITATION_SUSPENDUE:nogo']);
  const d = await domain(), ch = d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-R1')!;
  const detaille = JSON.stringify(d.verdictKeystone(ch, true, '2026-10-10T05:00:00.000Z'));
  for (const x of ['charges', '15 kg', 'hauteur', 'estriction', '2026-10-08', '8 oct.', '31 déc.']) assert.ok(!detaille.includes(x), `rien de l’avis dans le verdict : ${x}`);
  assert.deepEqual((await envoyes()).filter(v => v.chantier === 'K-R1').at(-1)!.ressource.motifs, [{ code: 'APTITUDE', niveau: 'GO_RESERVE' }]);

  // Nouvel avis apte : la suspension décidée à l'avis précédent est levée, les restrictions s'effacent.
  assert.equal(await run(RH, 'medical.avis', { empId: 2, date: '2026-10-10', avis: 'apte', lever: ['hauteur'] }),
    'Avis du médecin du travail enregistré — Mehdi Benali · Apte, visite du 10 oct. 2026 · 1 suspension levée · 2 chantiers signalés à Keystone');
  assert.deepEqual([(await titre(2, 'hauteur')).mesure, (await db.get<Corps>('employes', 2))!.restrictions, (await db.get<Corps>('employes', 2))!.avis], [null, [], 'apte']);
  assert.deepEqual(await motifs('K-R1', 2), []);
  assert.deepEqual(await motifs('K-R2', 2), []);
});

test('t062 : avis d’inaptitude — habilitations qui exigent l’aptitude non valides d’office, No Go APTITUDE, manager : verdict seul', async () => {
  const { db, run, emp, echeance, motifs, envoyes } = await fresh();
  // Romain Chevalier : à Tanger (K-2614) et à Abidjan (K-2611), Go jusqu'ici.
  assert.deepEqual(await motifs('K-2614', 18), []);
  await run(RH, 'medical.avis', { empId: 18, date: '2026-10-09', avis: 'inapte', restrictions: [{ texte: 'ignorée', jusquau: '' }] });
  const romain = await emp(18);
  assert.deepEqual([romain.med.ok, romain.med.text, romain.worst, (await db.get<Corps>('employes', 18))!.restrictions], [false, 'Inapte — avis du médecin du travail du 9 oct. 2026', 'exp', []]);
  // Habilitation électrique et travaux en hauteur exigent l'aptitude : suspendues (prérequis) ; AIPR, non.
  assert.deepEqual(romain.habs.map(h => [h.h, h.key, h.mesure]), [['he', 'susp', null], ['aipr', 'ok', null], ['hauteur', 'susp', null]]);
  assert.deepEqual(await motifs('K-2614', 18), ['APTITUDE:nogo', 'HABILITATION:nogo', 'HABILITATION:nogo']);
  assert.deepEqual((await envoyes()).filter(v => v.chantier === 'K-2614' && v.ressource.matricule === 'EMP-0018').at(-1)!.ressource.motifs[0], { code: 'APTITUDE', niveau: 'NO_GO' });
  assert.deepEqual([(await echeance(18))!.label, (await echeance(18))!.statut, (await echeance(18))!.key], ['Avis d’inaptitude', 'Inapte', 'exp']);
  // Manager : le verdict, rien d'autre.
  const vue = await buildSnapshot(db, KARIM), m = vue.employes.find(e => e.id === 18)!;
  assert.deepEqual([m.visite, m.avis, m.aptitude], [null, null, { ok: false, avis: 'inapte', restrictions: [] }]);
  assert.equal((await emp(18, vue)).med.text, 'Inapte — avis du médecin du travail');
  // Avis d'inaptitude : aucune suspension n'est levée.
  await assert.rejects(async () => await run(RH, 'medical.avis', { empId: 5, date: '2026-10-09', avis: 'inapte', lever: ['hauteur'] }), refus(/aucune suspension n’est levée/));
});

test('t062 : contrôles de l’avis et des habilitations désignées', async () => {
  const { run } = await fresh();
  const avis = (p: Corps) => async () => await run(RH, 'medical.avis', { empId: 2, date: '2026-10-08', avis: 'apte', ...p });
  await assert.rejects(avis({ avis: 'restrictions' }), refus(/Recopiez au moins une restriction/));
  await assert.rejects(avis({ avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: '2026-09-30' }] }), refus(/Restriction 1 : la date de fin précède la visite/));
  await assert.rejects(avis({ avis: 'restrictions', restrictions: [{ texte: 'x'.repeat(301), jusquau: '' }] }), refus(/300 caractères au plus/));
  await assert.rejects(avis({ avis: 'restrictions', restrictions: [{ texte: '', jusquau: '2026-12-31' }] }), refus(/Restriction 1 : recopiez le texte/));
  await assert.rejects(avis({ date: '2026-10-11' }), refus(/postérieure à aujourd’hui/));
  await assert.rejects(avis({ avis: 'favorable' }), refus(/Avis du médecin du travail requis/));
  await assert.rejects(avis({ avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: '' }], suspendre: ['ac489'] }), refus(/ne détient pas ce titre : Autorisation de conduite — chariots R489/));
  await assert.rejects(avis({ suspendre: ['hauteur'], lever: ['hauteur'] }), refus(/pas les deux/));
  // Suspension d'un autre motif : ni redoublée, ni levée par l'avis.
  await run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Incident sur passerelle' });
  await assert.rejects(avis({ avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: '' }], suspendre: ['hauteur'] }), refus(/déjà suspendue/));
  await assert.rejects(avis({ lever: ['hauteur'] }), refus(/n’est pas suspendue à la suite d’un avis/));
  await assert.rejects(async () => await run(KARIM, 'medical.avis', { empId: 2, date: '2026-10-08', avis: 'apte' }), refus(/service RH/, 403));
  // Règle partagée avec le dialogue : lignes vides ignorées, espaces normalisés, sans terme → null ; hors restrictions, vidées.
  assert.deepEqual(controlerAvis({ date: '2026-10-01', avis: 'restrictions', restrictions: [{ texte: ' Pas  de conduite ', jusquau: '' }, { texte: ' ', jusquau: '' }] }, '2026-10-10'),
    { avis: { date: '2026-10-01', avis: 'restrictions', restrictions: [{ texte: 'Pas de conduite', jusquau: null }], prochaineVisite: null, examen: false }, errors: [] });
  assert.deepEqual(controlerAvis({ date: '2026-10-01', avis: 'apte', restrictions: [{ texte: 'x', jusquau: '' }] }, '2026-10-10').avis.restrictions, []);
});

test('t062 : la fiche ne change plus la date de visite (avis du médecin du travail) ; une base existante reste apte', async () => {
  const { db, run, emp } = await fresh();
  await assert.rejects(async () => await run(RH, 'employe.modifier', { id: 2, visite: '2026-10-01' }), refus(/s’enregistre avec l’avis du médecin du travail/));
  // Fiche complète renvoyée telle quelle (visite inchangée) : acceptée.
  assert.equal(await run(RH, 'employe.modifier', { id: 2, poste: 'Technicien de maintenance confirmé', visite: '2025-06-15' }), 'Fiche de Mehdi Benali mise à jour');
  // Visite saisie avant l'enregistrement des avis (colonnes vides) : apte, sans restriction.
  db.sql.prepare('UPDATE employes SET avis = NULL, restrictions = NULL WHERE id = 3').run();
  const sophie = await emp(3);
  assert.deepEqual([sophie.restrictions, sophie.med.avis, sophie.med.ok, sophie.med.text], [[], 'apte', true, 'Visite du 12 sept. 2025 · aptitude valide jusqu’au 12 sept. 2027']);
});

// — t114 : demandes de visite médicale —

test('t114 : la demande de visite est enregistrée, affichée « Visite demandée le … », puis close par la saisie de la visite', async () => {
  const { db, run, domain, emp, echeance, demandes } = await fresh();
  const he = async () => (await emp(6)).habs.find(h => h.h === 'he')!;
  assert.equal((await domain()).habAction(6, await he())!.intent.type, 'medical');
  assert.equal(await run(RH, 'medical.demander', { empId: 6 }), 'Visite médicale demandée — Thomas Garnier (renouvellement) · demande envoyée au service de santé au travail');
  assert.deepEqual((await demandes(6)).map(x => [x.motif, x.le, x.par, x.statut, x.closeLe]), [['periodique', '2026-10-10', 'Sandrine Vidal', 'demandee', null]]);
  // E-mail au service de santé au travail : le contenu de la demande imprimable, sans aucune information médicale.
  const [mail] = (await db.all<{ cible: string; type: string; contenu: { a: string[]; objet: string; texte: string; repondreA?: string } }>('envois'))
    .filter(e => e.type === 'visite.demande');
  assert.deepEqual([mail.cible, mail.contenu.a, mail.contenu.objet], ['email', ['contact@sante-travail.example'], 'Demande de visite médicale — Thomas Garnier']);
  assert.match(mail.contenu.texte, /matricule 004106/, 'matricule de paie');
  assert.match(mail.contenu.texte, /Visite demandée : Visite périodique — renouvellement de l’aptitude \(Art\. R4624-16 et R4624-28 du Code du travail\)/);
  assert.match(mail.contenu.texte, /Habilitations du poste qui exigent l’aptitude médicale : .*Habilitation électrique/);
  assert.doesNotMatch(mail.contenu.texte, /[Éé]chue|[Ii]napte|restriction|apte avec/);
  assert.ok(mail.contenu.repondreA, 'les réponses vont au service RH');
  // Le bouton n'est plus proposé : « Visite demandée le … » à sa place, dans les habilitations (ouvre la demande en cours)
  // comme dans les échéances (visite et habilitation, affichées comme planifiées).
  assert.deepEqual((await domain()).habAction(6, await he()), { label: 'Visite demandée le 10 oct.', intent: { type: 'medical', empId: 6 } });
  assert.deepEqual([(await echeance(6))!.planned, (await echeance(6))!.plannedLabel, (await echeance(6))!.action], [true, 'Visite demandée le 10 oct.', null]);
  const d = await domain(), nomHe = (await he()).hm.nom, echHe = d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'hab' && x.emp.id === 6 && x.label === nomHe)!;
  assert.deepEqual([echHe.planned, echHe.plannedLabel], [true, 'Visite demandée le 10 oct.']);
  assert.equal((await emp(6)).med.text, 'Aptitude échue le 20 août 2026 — visite demandée le 10 oct. 2026');
  await assert.rejects(async () => await run(RH, 'medical.demander', { empId: 6 }), refus(/Visite déjà demandée le 10 oct\. 2026 pour Thomas Garnier/));
  await assert.rejects(async () => await run(RH, 'medical.demander', { empId: 3, motif: 'confort' }), refus(/Motif de visite inconnu/));

  // Réservée au service RH et à l'intéressé : jamais transmise au manager.
  assert.deepEqual((await buildSnapshot(db, KARIM)).demandesVisite, []);
  assert.deepEqual((await buildSnapshot(db, collab(6, 'Thomas Garnier'))).demandesVisite.map(x => x.motif), ['periodique']);
  assert.deepEqual((await buildSnapshot(db, collab(2, 'Mehdi Benali'))).demandesVisite, []);

  // La visite saisie clôt la demande.
  assert.match(String(await run(RH, 'medical.avis', { empId: 6, date: '2026-10-10', avis: 'apte' })), /· demande de visite close/);
  assert.deepEqual((await demandes(6)).map(x => [x.statut, x.closeLe, x.closePar]), [['realisee', '2026-10-10', 'Sandrine Vidal']]);
  assert.equal((await emp(6)).med.ok, true);
  assert.deepEqual([(await echeance(6))!.key, (await echeance(6))!.planned, (await echeance(6))!.action], ['ok', false, null], 'aptitude valide : rien à demander');
  // Une nouvelle demande reste possible depuis la fiche, par exemple à la demande de l'employeur.
  assert.match(String(await run(RH, 'medical.demander', { empId: 6, motif: 'employeur' })), /Thomas Garnier \(à la demande de l’employeur\)/);
});

test('t114 : annulation d’une demande ; une visite antérieure à la demande ne la clôt pas', async () => {
  const { db, run, demandes, emp } = await fresh();
  const [x] = await demandes(24);
  assert.equal(x.motif, 'embauche');
  assert.equal(await run(RH, 'medical.annuler', { id: x.id }), 'Demande de visite annulée — Bastien Morel');
  assert.deepEqual([(await demandes(24))[0].statut, (await demandes(24))[0].closeLe, (await demandes(24))[0].closePar], ['annulee', '2026-10-10', 'Sandrine Vidal']);
  await assert.rejects(async () => await run(RH, 'medical.annuler', { id: x.id }), refus(/introuvable ou déjà close/));
  // Sans visite enregistrée, le motif proposé est la visite d'embauche. Sans adresse du service de santé au travail,
  // rien ne part : la demande est à imprimer.
  await run(RH, 'messagerie.regler', { santeTravail: '' });
  assert.match(String(await run(RH, 'medical.demander', { empId: 24 })), /demande à imprimer pour le service de santé au travail \(aucune adresse/);
  assert.ok(!(await db.all<{ type: string }>('envois')).some(e => e.type === 'visite.demande'));
  assert.deepEqual((await demandes(24)).map(v => [v.motif, v.statut]), [['embauche', 'annulee'], ['embauche', 'demandee']]);
  await run(RH, 'medical.avis', { empId: 24, date: '2026-10-01', avis: 'apte' });
  assert.equal((await demandes(24))[1].statut, 'demandee', 'visite du 1er octobre : la demande du 10 reste en cours');
  assert.equal((await emp(24)).med.text, 'Visite du 1 oct. 2026 · aptitude valide jusqu’au 1 oct. 2028 · visite demandée le 10 oct. 2026');
});

test('jeu de démonstration : Inès Dupont, avis avec restrictions, travaux en hauteur suspendus ; sa manager voit les restrictions', async () => {
  const { db, motifs, emp } = await fresh();
  assert.equal((await emp(5)).habs.find(h => h.h === 'hauteur')!.key, 'susp');
  assert.ok((await motifs('K-2625', 5)).includes('APTITUDE:reserve'), 'audit de Tema pendant les restrictions');
  const m = (await buildSnapshot(db, SARAH)).employes.find(e => e.id === 5)!;
  assert.deepEqual(m.aptitude!.restrictions!.map(r => r.texte), ['Pas de port de charges de plus de 15 kg', 'Pas de travail en hauteur']);
  assert.equal(m.visite, null);
});
