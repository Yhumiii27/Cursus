// Suivi médical (t059) : type de suivi (VIP, VIP adaptée, suivi individuel renforcé déduit du référentiel ou saisi),
// échéance de la prochaine visite — date fixée par le médecin du travail, sinon périodicité de Paramètres → Santé —,
// alerte « examen d'aptitude requis » du suivi renforcé, et confidentialité : ni le manager ni les profils restreints ne
// reçoivent le type de suivi, la prochaine visite ou l'examen ; le journal ne retient que `empId` (le message, qui nomme le
// type, est masqué aux lecteurs hors service RH) ; l'export RGPD les contient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.KEYSTONE_URL;
delete process.env.KEYSTONE_TOKEN;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, DEFAULT_SETTINGS, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS, changeVerdicts } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { contexte, enregistrerAffectation, enregistrerChantier } = await import('../server/src/integrations/keystone-entrant.ts');
const { champsRetenus } = await import('../server/src/journal.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { Domain } = await import('../shared/domain.ts');
const { EXAMEN_REQUIS } = await import('../shared/constants.ts');
const { addMonths, parse } = await import('../shared/dates.ts');
const { matricule } = await import('../shared/format.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { relancesDues } = await import('../shared/rules/relances.ts');
const { controlerAvis } = await import('../shared/rules/sante.ts');
const { analyserReprise } = await import('../shared/rules/reprise.ts');
const { echeanceVisite, examenAttendu, suiviDe } = await import('../shared/rules/suivi-medical.ts');
type User = import('../shared/types.ts').CurrentUser;
type Dataset = import('../shared/types.ts').Dataset;
type Corps = Record<string, any>;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };
const HSE: User = { role: 'rh', empId: null, nom: 'Sarah Cohen', intitule: 'Référente HSE', profilRh: 'referent_hse' };
const LECTURE: User = { role: 'rh', empId: null, nom: 'Élodie Bernard', intitule: 'Lecture seule', profilRh: 'lecture_seule' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };

// Mehdi Benali (2) : visite du 15 juin 2025, habilitation électrique (he) et travaux en hauteur délivrées.
// Aïcha Diallo (7) : visite du 1er oct. 2025, aucune habilitation.
async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
    if (changeVerdicts(name)) await suivreVerdicts(db);
    return typeof r === 'object' && r !== null ? r.message : r;
  });
  const domain = async (ds?: Dataset) => new Domain(ds ?? await loadFull(db, RH));
  const emp = async (id: number, ds?: Dataset) => (await domain(ds)).enrich(90, false).find(e => e.id === id)!;
  const echeance = async (id: number) => { const d = await domain(); return d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'med' && x.emp.id === id); };
  const regler = async (p: Corps) => await db.setSetting('app', { ...await db.getSetting<Corps>('app', {}), ...p });
  return { db, run, domain, emp, echeance, regler };
}
const refus = (re: RegExp, status = 400) => (e: unknown) => e instanceof ActionError && e.status === status && re.test(e.message);
const jour = (d: Date | null) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('par défaut : 24 mois pour tous les types de suivi, comme avant (aucune échéance ne change)', async () => {
  const { db, emp, domain } = await fresh();
  assert.deepEqual([DEFAULT_SETTINGS.santeVipMois, DEFAULT_SETTINGS.santeVipAdapteeMois, DEFAULT_SETTINGS.santeSirIntermediaireMois, DEFAULT_SETTINGS.santeSirAptitudeMois], [24, 24, 24, 48]);
  // Jeu de démonstration (aucune case SIR, aucun type saisi) : VIP, échéance à 24 mois de la visite pour chacun.
  for (const e of (await domain()).enrich(90, false).filter(x => x.visite)) {
    assert.equal(e.med.suivi!.type, 'vip');
    assert.equal(jour(e.med.exp), jour(addMonths(parse(e.visite!), 24)), e.nom);
  }
  // VIP adaptée et suivi renforcé saisis : toujours 24 mois (visite intermédiaire).
  for (const suivi of ['vip_adapte', 'sir'] as const) {
    await db.update('employes', 7, { suivi });
    assert.equal(jour((await emp(7)).med.exp), '2027-10-01', suivi);
  }
});

test('périodicité tirée des réglages ; la prochaine visite fixée par le médecin prime toujours', async () => {
  const { db, emp, regler } = await fresh();
  await regler({ santeVipMois: 48, santeVipAdapteeMois: 36 });
  assert.equal(jour((await emp(7)).med.exp), '2029-10-01', 'VIP à 48 mois');
  assert.equal((await emp(7)).med.text, 'Visite du 1 oct. 2025 · aptitude valide jusqu’au 1 oct. 2029');
  await db.update('employes', 7, { suivi: 'vip_adapte' });
  assert.equal(jour((await emp(7)).med.exp), '2028-10-01', 'VIP adaptée à 36 mois');
  assert.match((await emp(7)).med.text, /jusqu’au 1 oct\. 2028 \(périodicité VIP adaptée de 36 mois\)$/);
  // Date fixée par le médecin : plus tôt ou plus tard que la périodicité, elle l'emporte.
  await db.update('employes', 7, { prochaineVisite: '2026-04-01' });
  assert.equal(jour((await emp(7)).med.exp), '2026-04-01');
  assert.equal((await emp(7)).med.ok, false, 'échue : visite fixée au 1er avril 2026 non faite');
  assert.match((await emp(7)).med.text, /^Aptitude échue le 1 avr\. 2026 \(date fixée par le médecin du travail\)/);
  await db.update('employes', 7, { prochaineVisite: '2030-06-01' });
  assert.equal(jour((await emp(7)).med.exp), '2030-06-01');
});

test('suivi renforcé déduit du référentiel (habilitation ou poste cochés SIR), prioritaire sur le type saisi', async () => {
  const { db, emp, domain } = await fresh();
  await db.update('employes', 2, { suivi: 'vip_adapte' });
  assert.equal((await emp(2)).med.suivi!.type, 'vip_adapte');
  await db.update('habilitations', 'he', { sir: true });
  assert.deepEqual((await emp(2)).med.suivi, { type: 'sir', deduit: true, origines: ['Habilitation électrique'], saisi: 'vip_adapte' });
  // Titre retiré, ou habilitation archivée : plus de suivi renforcé déduit.
  const t = (await db.all<Corps>('habTitres')).find(x => x.empId === 2 && x.h === 'he')!;
  await db.update('habTitres', t.id, { mesure: 'retrait' });
  assert.equal((await emp(2)).med.suivi!.type, 'vip_adapte');
  await db.update('habTitres', t.id, { mesure: null });
  await db.update('habilitations', 'he', { archive: '2026-10-01' });
  assert.equal((await emp(2)).med.suivi!.deduit, false);
  // Poste coché « SIR » : tous ses titulaires.
  const poste = await db.insert<Corps>('postes', { nom: 'Électricien de maintenance', formations: [], habilitations: [], archive: null, sir: true });
  await db.update('employes', 7, { posteId: poste.id });
  assert.deepEqual(suiviDe((await domain()).ds, await emp(7)).origines, ['poste Électricien de maintenance']);
});

test('suivi renforcé : visite intermédiaire puis examen d’aptitude, alerte « examen d’aptitude requis » sans examen enregistré', async () => {
  const { db, emp, echeance, domain } = await fresh();
  await db.update('employes', 7, { suivi: 'sir' });
  // Aucun examen enregistré : l'aptitude reste valide mais passe « à renouveler », échéance à programmer.
  assert.equal((await emp(7)).med.ok, true);
  assert.equal((await emp(7)).med.examenRequis, true);
  assert.equal((await domain()).medKey((await emp(7)).med, 90), 'due');
  assert.match((await emp(7)).med.text, /examen d’aptitude requis \(suivi renforcé\)$/);
  const x = (await echeance(7))!;
  assert.deepEqual([x.label, x.statut, x.key, x.sansDate, x.d, x.action?.label], [EXAMEN_REQUIS, 'Examen requis', 'due', true, 0, 'Demander la visite']);
  // Récapitulatif des échéances : relancé comme échu, sous une clé stable, jamais dans celui d'un manager (santé).
  const d = await domain(), r = relancesDues(d, d.enrich(90, false), [90, 30, 7]).find(y => y.cle === 'med:7:examen')!;
  assert.deepEqual([r.palier, r.libelle, r.sante], ['echu', 'Examen médical d’aptitude à programmer', true]);

  // Examen du 1er oct. 2025 : visite intermédiaire à 24 mois.
  await db.update('employes', 7, { examenAptitude: '2025-10-01' });
  assert.deepEqual([(await emp(7)).med.examenRequis, jour((await emp(7)).med.exp), (await emp(7)).med.prochaine], [false, '2027-10-01', 'intermediaire']);
  assert.equal((await domain()).medKey((await emp(7)).med, 90), 'ok');
  // Visite intermédiaire faite le 1er oct. 2027 : l'examen d'aptitude revient 48 mois après le dernier examen.
  assert.deepEqual(echeanceVisite({ examenAptitude: '2025-10-01' }, parse('2027-10-01'), 'sir', DEFAULT_SETTINGS),
    { exp: parse('2029-10-01'), prochaine: 'aptitude' });
  assert.deepEqual(echeanceVisite({ examenAptitude: '2025-10-01' }, parse('2027-10-01'), 'sir', { ...DEFAULT_SETTINGS, santeSirAptitudeMois: 36 }),
    { exp: parse('2028-10-01'), prochaine: 'aptitude' });
});

test('suivi renforcé sans examen : l’échéance datée de l’aptitude et ses relances par paliers restent, en plus de l’examen requis', async () => {
  const { db, domain } = await fresh();
  // Aptitude valide jusqu'au 25 nov. 2026, à 46 jours : palier 90 jours.
  await db.update('employes', 7, { visite: '2024-11-25', suivi: 'sir' });
  const d = await domain(), emps = d.enrich(90, false);
  const med = d.echeances(emps, 90).filter(x => x.kind === 'med' && x.emp.id === 7).map(x => [x.label, jour(x.exp), x.key]);
  assert.deepEqual(med, [[EXAMEN_REQUIS, '2026-10-10', 'due'], ['Aptitude médicale', '2026-11-25', 'due']]);
  const r = relancesDues(d, emps, [90, 30, 7]).filter(y => y.empId === 7 && y.categorie === 'visite').map(y => [y.cle, y.palier]);
  assert.deepEqual(r, [['med:7:examen', 'echu'], ['med:7:2026-11-25', '90']]);
  // Aptitude lointaine : l'échéance datée reste « valide » (seul l'examen est à programmer).
  await db.update('employes', 7, { visite: '2026-06-01' });
  const loin = (await domain()).echeances((await domain()).enrich(90, false), 90).find(x => x.label === 'Aptitude médicale' && x.emp.id === 7)!;
  assert.deepEqual([jour(loin.exp), loin.key, loin.action], ['2028-06-01', 'ok', null]);
});

test('dialogue d’avis : case « examen médical d’aptitude » cochée seulement quand l’examen est attendu', async () => {
  const { db, emp } = await fresh();
  assert.equal(examenAttendu((await emp(7)).med), false, 'VIP');
  await db.update('employes', 7, { suivi: 'sir' });
  assert.equal(examenAttendu((await emp(7)).med), true, 'suivi renforcé sans examen enregistré');
  await db.update('employes', 7, { visite: '2026-10-01', examenAptitude: '2025-10-01' });
  assert.equal((await emp(7)).med.prochaine, 'intermediaire');
  assert.equal(examenAttendu((await emp(7)).med), false, 'visite intermédiaire attendue : la case reste décochée');
  // Renouvellement de l'examen plus proche que la visite intermédiaire : cochée.
  await db.update('employes', 7, { visite: '2027-10-01', examenAptitude: '2025-10-01' });
  assert.equal((await emp(7)).med.prochaine, 'aptitude');
  assert.equal(examenAttendu((await emp(7)).med), true);
  assert.equal(examenAttendu({ suivi: null, prochaine: null }), false, 'verdict seul');
});

test('reprise des visites : l’aperçu annonce l’échéance de la périodicité réglée', async () => {
  const { domain, regler } = await fresh();
  await regler({ santeVipMois: 48 });
  const l = analyserReprise(await domain(), 'visites', `Matricule;Date de visite;Avis\n${matricule(7)};02/10/2026;Apte`, { colonnes: ['matricule', 'date', 'avis'] }).lignes[0];
  assert.match(l.detail ?? '', /à renouveler avant le 2 oct\. 2030$/);
});

test('avis du médecin : prochaine visite et examen d’aptitude enregistrés, contrôlés, remis à zéro par l’avis suivant', async () => {
  const { db, run, emp } = await fresh();
  const fiche = async () => (await db.get<Corps>('employes', 7))!;
  await run(RH, 'medical.avis', { empId: 7, date: '2026-10-08', avis: 'apte', prochaineVisite: '2027-04-08', examen: true });
  assert.deepEqual([(await fiche()).visite, (await fiche()).prochaineVisite, (await fiche()).examenAptitude], ['2026-10-08', '2027-04-08', '2026-10-08']);
  assert.equal(jour((await emp(7)).med.exp), '2027-04-08');
  // Visite suivante sans date fixée ni examen : périodicité, dernier examen conservé.
  await run(RH, 'medical.avis', { empId: 7, date: '2026-10-09', avis: 'apte' });
  assert.deepEqual([(await fiche()).prochaineVisite, (await fiche()).examenAptitude], [null, '2026-10-08']);
  const avis = (p: Corps) => async () => await run(RH, 'medical.avis', { empId: 7, date: '2026-10-08', avis: 'apte', ...p });
  await assert.rejects(avis({ prochaineVisite: '2026-10-08' }), refus(/doit suivre la visite/));
  await assert.rejects(avis({ prochaineVisite: '2031-10-09' }), refus(/plus de 5 ans après la visite \(au plus tard le 8 oct\. 2031\)/));
  await assert.rejects(avis({ prochaineVisite: '2027-02-30' }), refus(/prochaine visite invalide/));
  // Avis d'inaptitude : aucune prochaine visite retenue.
  assert.equal(controlerAvis({ date: '2026-10-08', avis: 'inapte', prochaineVisite: '2027-01-01' }, '2026-10-10').avis.prochaineVisite, null);
});

test('type de suivi saisi sur la fiche : service RH seul, liste fermée ; vide : VIP par défaut', async () => {
  const { db, run } = await fresh();
  assert.match(String(await run(RH, 'medical.suivi', { empId: 7, suivi: 'vip_adapte' })), /Type de suivi médical enregistré — Aïcha Diallo · VIP adaptée/);
  assert.equal((await db.get<Corps>('employes', 7))!.suivi, 'vip_adapte');
  assert.match(String(await run(RH, 'medical.suivi', { empId: 7, suivi: 'vip_adapte' })), /inchangé/);
  await run(RH, 'medical.suivi', { empId: 7, suivi: '' });
  assert.equal((await db.get<Corps>('employes', 7))!.suivi, null);
  await assert.rejects(async () => await run(RH, 'medical.suivi', { empId: 7, suivi: 'renforce' }), refus(/Type de suivi inconnu/));
  await assert.rejects(async () => await run(KARIM, 'medical.suivi', { empId: 2, suivi: 'sir' }), refus(/service RH/, 403));
  await assert.rejects(async () => await run(HSE, 'medical.suivi', { empId: 2, suivi: 'sir' }), refus(/service RH/, 403));
});

test('confidentialité : ni le manager ni les profils restreints ne reçoivent le suivi ; l’intéressé et l’export RGPD, oui ; le journal, l’identifiant seul', async () => {
  const { db, run } = await fresh();
  await run(RH, 'medical.suivi', { empId: 2, suivi: 'sir' });
  await run(RH, 'medical.avis', { empId: 2, date: '2026-10-08', avis: 'apte', prochaineVisite: '2028-10-08', examen: true });
  const champs = (e: Corps) => [e.suivi ?? null, e.prochaineVisite ?? null, e.examenAptitude ?? null];
  for (const u of [KARIM, HSE, LECTURE]) {
    const m = (await buildSnapshot(db, u)).employes.find(e => e.id === 2)!;
    assert.deepEqual(champs(m), [null, null, null], u.nom);
    assert.equal(m.aptitude?.ok ?? true, true, `${u.nom} : verdict seul`);
    assert.equal(new Domain(await buildSnapshot(db, u)).medInfo(m).suivi ?? null, null);
  }
  assert.deepEqual(champs((await buildSnapshot(db, MEHDI)).employes.find(e => e.id === 2)!), ['sir', '2028-10-08', '2026-10-08']);
  assert.deepEqual(champs((await buildSnapshot(db, RH)).employes.find(e => e.id === 2)!), ['sir', '2028-10-08', '2026-10-08']);
  // Droit d'accès (RGPD) : la fiche exportée contient le suivi médical.
  assert.deepEqual(champs((await donneesSalarie(db, 2, { journal: false, par: 'test' }))!.sections.Fiche as Corps), ['sir', '2028-10-08', '2026-10-08']);
  // Journal : identifiant seul pour le type de suivi ; ni prochaine visite ni examen pour l'avis.
  assert.deepEqual(champsRetenus('medical.suivi', { empId: 2, suivi: 'sir' }), { empId: 2 });
  assert.deepEqual(champsRetenus('medical.avis', { empId: 2, date: '2026-10-08', avis: 'apte', prochaineVisite: '2028-10-08', examen: true }), { empId: 2, date: '2026-10-08' });
});

test('Go / No Go : prochaine visite fixée par le médecin dépassée → réserve APTITUDE, verdict seul non valide', async () => {
  const { db, run, domain } = await fresh();
  await db.tx(async () => {
    await enregistrerChantier(await contexte(db), 'K-S1', { nom: 'Inventaire', lieu: 'Lyon', pays: 'FR', debut: '2026-11-03', fin: '2026-11-05' });
    await enregistrerAffectation(await contexte(db), 'AF-S1', { matricule: matricule(7), chantier: 'K-S1', du: '2026-11-03', au: '2026-11-05' });
    await suivreVerdicts(db);
  });
  const motifs = async () => {
    const d = await domain();
    return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-S1')!.res.find(r => r.e.id === 7)!.reasons.map(r => `${r.code}:${r.level}`);
  };
  assert.deepEqual(await motifs(), []);
  await run(RH, 'medical.avis', { empId: 7, date: '2025-10-01', avis: 'apte', prochaineVisite: '2026-10-01' });
  assert.deepEqual(await motifs(), ['APTITUDE:reserve']);
  assert.equal((await buildSnapshot(db, HSE)).employes.find(e => e.id === 7)!.aptitude!.ok, false, 'verdict seul : aptitude non valide');
  // Suivi renforcé sans examen : alerte seulement, aucun motif Go / No Go (le verdict du manager reste valide).
  await run(RH, 'medical.avis', { empId: 7, date: '2026-10-01', avis: 'apte' });
  await run(RH, 'medical.suivi', { empId: 7, suivi: 'sir' });
  assert.deepEqual(await motifs(), []);
});

test('référentiels : case « suivi individuel renforcé » des habilitations et des postes, décochée par défaut, tracée', async () => {
  const { db, run } = await fresh();
  assert.ok((await db.all<Corps>('habilitations')).every(h => h.sir === false), 'référentiel type : aucune case cochée');
  const hab = (await db.get<Corps>('habilitations', 'he'))!;
  await run(RH, 'referentiel.habilitation.enregistrer', { id: 'he', nom: hab.nom, detail: hab.detail, prereqs: hab.prereqs, medical: true, validite: hab.validite, signataire: hab.signataire, sir: true });
  assert.equal((await db.get<Corps>('habilitations', 'he'))!.sir, true);
  await run(RH, 'referentiel.poste.enregistrer', { nom: 'Opérateur de conditionnement', formations: [], habilitations: [], sir: true });
  assert.equal((await db.all<Corps>('postes')).find(p => p.nom === 'Opérateur de conditionnement')!.sir, true);
  await run(RH, 'referentiel.poste.enregistrer', { nom: 'Agent de pesée', formations: [], habilitations: [] });
  assert.equal((await db.all<Corps>('postes')).find(p => p.nom === 'Agent de pesée')!.sir, false);
});

test('réglages Santé : bornes légales, visite intermédiaire avant l’examen d’aptitude', () => {
  const maj = (p: Corps) => appliquerReglages(DEFAULT_SETTINGS, p);
  assert.equal(maj({ santeVipMois: 72 }).santeVipMois, 60, 'VIP : 5 ans au plus');
  assert.equal(maj({ santeVipMois: 6 }).santeVipMois, 12);
  assert.equal(maj({ santeVipAdapteeMois: 48 }).santeVipAdapteeMois, 36, 'VIP adaptée : 3 ans au plus');
  assert.equal(maj({ santeSirIntermediaireMois: 36 }).santeSirIntermediaireMois, 24, 'visite intermédiaire : 2 ans au plus');
  assert.equal(maj({ santeSirAptitudeMois: 60 }).santeSirAptitudeMois, 48, 'examen d’aptitude : 4 ans au plus');
  assert.throws(() => maj({ santeSirIntermediaireMois: 24, santeSirAptitudeMois: 12 }), (e: unknown) => e instanceof ReglageInvalide && /visite intermédiaire/.test(e.message));
});
