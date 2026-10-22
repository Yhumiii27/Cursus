// Lot 6, chantier 1 étape 1 : jours fériés et journée de solidarité réglés par année (t051) — calendrier de 2026 et de
// 2027, aucun effet rétroactif (le réglage de 2027 ne change aucun décompte de 2026, une année d'avant 2027 n'est jamais
// réglable), année engagée modifiée seulement avec un motif jamais recopié au journal ni transmis hors du service RH ;
// horaires de poste (t048) — référentiel « Horaires », horaire par défaut de l'équipe, horaire du jour proposé, choisi et
// figé à la soumission, exemples amorcés par migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { HORAIRES_EXEMPLES_MIGRATION, amorcerHoraires } = await import('../server/src/migrations/lot6-horaires.ts');
const { Domain } = await import('../shared/domain.ts');
const { configurerFeries, estJourneeSolidarite, feriesOf, isFerie, journeeSolidarite } = await import('../shared/dates.ts');
const { anneesReglables, controlerFeries, feriesDeLAnnee } = await import('../shared/rules/feries.ts');
const { reposForfait } = await import('../shared/rules/conges.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { feriesDeLaSemaine } = await import('../shared/rules/majorations.ts');
const { controlerHoraire, dureeHoraire, finitLeLendemain, horairesAFiger, horairesDeLaFeuille, normaliserHeure, plageTexte } = await import('../shared/rules/horaires.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Absence = Dataset['absences'][number];
type Feuille = Dataset['feuilles'][number];

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, statut = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === statut && motif.test(e.message), `${name} : ${motif}`);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const derniere = async (action: string) => (await db.all<{ action: string; payload: Record<string, unknown>; salaries: number[]; message: string }>('journal')).findLast(j => j.action === action);
  return { db, user, run, refuse, domain, derniere, RH };
}
/** Congé validé de Mehdi Benali (Maintenance, 35 h). */
const conge = async (db: InstanceType<typeof Db>, du: string, au: string, extra: Record<string, unknown> = {}) => await db.insert<Absence>('absences', {
  empId: 2, type: 'CP', du, au, statut: 'validee', keystone: false, justificatif: false, ...extra,
});
/** Décompte de chaque absence de l'année (jours ouvrés), dans l'ordre des identifiants. */
const decomptes = (d: InstanceType<typeof Domain>, annee: number) => d.ds.absences
  .filter(a => a.du.startsWith(String(annee)) || a.au.startsWith(String(annee)))
  .map(a => [a.id, d.countDays(d.emp(a.empId)!, a.du, a.au, a.type, a)]);
/** Jours de repos du forfait jours (218 jours) en 2027, calendrier légal : 365 − 104 jours de week-end − 25 CP − 7 fériés en semaine − 218. */
const REPOS_2027 = 11;
const PENTECOTE = { annee: 2027, solidarite: 'pentecote_travaillee', nonChomes: [] };

// — Calendrier —

test('fériés 2026 et 2027 : calendrier légal par défaut, lundi de Pentecôte chômé', () => {
  configurerFeries(null);
  assert.deepEqual([...feriesOf(2026)], ['2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25', '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25']);
  assert.deepEqual([...feriesOf(2027)], ['2027-01-01', '2027-03-29', '2027-05-01', '2027-05-08', '2027-05-06', '2027-05-17', '2027-07-14', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25']);
  assert.equal(journeeSolidarite(2027), null);
  assert.equal(reposForfait(2027), REPOS_2027);
});

test('2027 : lundi de Pentecôte travaillé ou autre férié, fériés non chômés, 1er mai toujours chômé ; 2026 jamais touchée', () => {
  const le = '2026-10-10', par = 'Essai';
  configurerFeries({ 2027: { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: ['1er_mai', '8_mai'], le, par }, 2026: { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: ['noel'], le, par } });
  assert.equal(isFerie('2027-05-17'), false, 'journée de solidarité travaillée');
  assert.equal(estJourneeSolidarite('2027-05-17'), true);
  assert.equal(isFerie('2027-05-08'), false, 'férié non chômé');
  assert.equal(isFerie('2027-05-01'), true, 'le 1er mai reste chômé, même inscrit parmi les non chômés');
  // Jours de repos du forfait (shared/rules/conges.ts, inchangé) : ils suivent isFerie, un férié de semaine travaillé
  // ouvre un jour de plus à répartir (Pentecôte, un lundi) ; le 8 mai 2027 tombe un samedi, sans effet.
  assert.equal(reposForfait(2027), REPOS_2027 + 1);
  assert.equal(feriesDeLaSemaine('2027-05-17')[0], null, 'aucune majoration de férié le jour de solidarité');
  // Une ligne 2026 (base modifiée hors de Cursus) est ignorée : avant la mise en service, calendrier légal.
  assert.equal(isFerie('2026-05-25'), true);
  assert.equal(isFerie('2026-12-25'), true);
  assert.equal(journeeSolidarite(2026), null);
  configurerFeries({ 2027: { solidarite: 'autre_ferie', solidariteFerie: '11_novembre', nonChomes: [], le, par } });
  assert.deepEqual([isFerie('2027-11-11'), isFerie('2027-05-17')], [false, true], 'le 11 novembre travaillé, Pentecôte chômée');
  configurerFeries({ 2027: { solidarite: 'hors_calendrier', solidariteFerie: null, nonChomes: [], le, par } });
  assert.equal(feriesOf(2027).size, 11, 'fractionnée ou par RTT : calendrier inchangé');
  configurerFeries(null);
  assert.equal(isFerie('2027-05-17'), true, 'calendrier légal rétabli');
});

test('contrôle du réglage : année réglable (2027 au plus tôt, jamais passée), modalité, férié de solidarité, 1er mai', () => {
  assert.deepEqual(anneesReglables('2026-10-10'), [2027, 2028]);
  assert.deepEqual(anneesReglables('2027-03-01'), [2027, 2028, 2029]);
  const today = '2026-10-10';
  assert.match(controlerFeries({ annee: 2026, solidarite: 'pentecote_chomee' }, today).erreurs.annee!, /à partir de 2027/);
  assert.match(controlerFeries({ annee: 2031, solidarite: 'pentecote_chomee' }, today).erreurs.annee!, /2027, 2028/);
  assert.match(controlerFeries({ annee: 2027, solidarite: 'autre_ferie', solidariteFerie: '1er_mai' }, today).erreurs.solidariteFerie!, /toujours chômé/);
  assert.match(controlerFeries({ annee: 2027, solidarite: 'autre_ferie', solidariteFerie: 'pentecote' }, today).erreurs.solidariteFerie!, /Lundi de Pentecôte travaillé/);
  assert.match(controlerFeries({ annee: 2027, solidarite: 'autre_ferie' }, today).erreurs.solidariteFerie!, /Choisissez/);
  // Férié qui tombe un samedi ou un dimanche de l'année : il ne ferait travailler aucun jour ouvré.
  assert.match(controlerFeries({ annee: 2027, solidarite: 'autre_ferie', solidariteFerie: 'noel' }, today).erreurs.solidariteFerie!, /Noël tombe un samedi en 2027 : choisissez un férié de semaine/);
  assert.match(controlerFeries({ annee: 2027, solidarite: 'autre_ferie', solidariteFerie: '15_aout' }, today).erreurs.solidariteFerie!, /tombe un dimanche en 2027/);
  assert.deepEqual(controlerFeries({ annee: 2028, solidarite: 'autre_ferie', solidariteFerie: 'noel' }, today).reglage, { solidarite: 'autre_ferie', solidariteFerie: 'noel', nonChomes: [] }, 'Noël 2028 : un lundi');
  assert.match(controlerFeries({ annee: 2027, solidarite: 'pentecote_chomee', nonChomes: ['1er_mai'] }, today).erreurs.nonChomes!, /1er mai/);
  assert.match(controlerFeries({ annee: 2027, solidarite: 'pentecote_chomee', nonChomes: ['paques', 'x'] }, today).erreurs.nonChomes!, /inconnue/);
  assert.ok(controlerFeries({ annee: 2027, solidarite: 'x' }, today).erreurs.solidarite);
  // Le férié de solidarité n'est pas répété parmi les non chômés ; ordre du calendrier.
  assert.deepEqual(controlerFeries({ annee: 2027, solidarite: 'pentecote_travaillee', nonChomes: ['noel', 'pentecote', '8_mai'] }, today).reglage,
    { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: ['8_mai', 'noel'] });
  assert.deepEqual(feriesDeLAnnee(2027, { solidarite: 'autre_ferie', solidariteFerie: 'ascension', nonChomes: ['noel'] }).filter(f => f.sort !== 'chome').map(f => [f.code, f.sort]),
    [['ascension', 'solidarite'], ['noel', 'travaille']]);
});

// — Action et non-rétroactivité —

test('parametres.feries : régler 2027 ne modifie aucun décompte de 2026, et recalcule les congés de 2027 qui couvrent le jour', async () => {
  const { db, run, refuse, domain, derniere, RH, user } = await fresh();
  const pont = await conge(db, '2027-05-17', '2027-05-21');
  await conge(db, '2026-05-25', '2026-05-29');
  const avant2026 = decomptes(await domain(), 2026);
  assert.equal((await domain()).countDays((await domain()).emp(2)!, '2027-05-17', '2027-05-21', 'CP'), 4, 'lundi de Pentecôte chômé : 4 jours');
  await refuse(RH, 'parametres.feries', { annee: 2026, solidarite: 'pentecote_travaillee' }, /à partir de 2027/);
  await refuse(await user(14, 'rh'), 'parametres.feries', PENTECOTE, /administrateur RH/, 403);
  const message = String(await run(RH, 'parametres.feries', PENTECOTE));
  assert.match(message, /Jours fériés 2027 : Lundi de Pentecôte travaillé · autres fériés chômés · 1 absence recalculée : Mehdi Benali du 17 mai 2027 \(4 → 5 j\)/);
  const d = await domain();
  assert.deepEqual(decomptes(d, 2026), avant2026, 'aucun décompte de 2026 ne change');
  assert.equal(isFerie('2026-05-25'), true);
  assert.equal(d.countDays(d.emp(2)!, '2027-05-17', '2027-05-21', 'CP'), 5, 'Pentecôte 2027 travaillée : décomptée en congé');
  const j = (await derniere('parametres.feries'))!;
  assert.deepEqual(j.payload, { annee: 2027, avant: { solidarite: 'pentecote_chomee', solidariteFerie: null, nonChomes: [] }, apres: { solidarite: 'pentecote_travaillee', solidariteFerie: null, nonChomes: [] } });
  assert.deepEqual(j.salaries, [2]);
  assert.equal(await run(RH, 'parametres.feries', PENTECOTE), null, 'même réglage : rien n’est refait');
  // Année engagée : une absence de 2027 transmise à la paie ; motif exigé, jamais recopié au journal ni hors du service RH.
  await db.update('absences', pont.id, { sage: true });
  await refuse(RH, 'parametres.feries', { annee: 2027, solidarite: 'pentecote_chomee' }, /Année 2027 déjà engagée \(1 absence transmise à la paie\) : indiquez le motif/, 409);
  await run(RH, 'parametres.feries', { annee: 2027, solidarite: 'pentecote_chomee', motif: 'Avis du CSE du 3 mars 2027' });
  assert.deepEqual((await derniere('parametres.feries'))!.payload.motif, '[texte renseigné]');
  assert.equal((await loadFull(db, RH)).calendrierFeries!['2027'].motif, 'Avis du CSE du 3 mars 2027');
  assert.equal((await buildSnapshot(db, await user(12, 'manager'))).calendrierFeries!['2027'].motif, null, 'manager : réglage sans motif');
  assert.equal((await buildSnapshot(db, await user(7, 'rh'))).calendrierFeries!['2027'].motif, null, 'profil paie : réglage sans motif');
  assert.equal((await buildSnapshot(db, await user(2, 'collaborateur'))).calendrierFeries!['2027'].solidarite, 'pentecote_chomee', 'le calendrier est transmis à tous');
});

// — Horaires de poste —

test('horaire de poste : heures normalisées, poste de nuit qui finit le lendemain, pause, code unique', () => {
  assert.deepEqual(['8', '8h', '8 h 30', '08:30', '21.15', '24:00', 'x'].map(normaliserHeure), ['08:00', '08:00', '08:30', '08:30', '21:15', null, null]);
  const nuit = { code: 'N', nom: 'Nuit', debut: '21:00', fin: '05:00', pause: 30 };
  assert.deepEqual([finitLeLendemain(nuit), dureeHoraire(nuit), plageTexte(nuit)], [true, 7.5, '21 h – 5 h (lendemain)']);
  const existants = [{ ...nuit, archive: '2026-01-01' }];
  assert.match(controlerHoraire({ code: 'n', nom: 'Autre', debut: '22', fin: '6' }, existants, null).erreurs.code!, /existe déjà/);
  assert.match(controlerHoraire({ code: '2X', nom: 'A', debut: '8', fin: '9' }, [], null).erreurs.code!, /commençant par une lettre/);
  assert.match(controlerHoraire({ code: 'A', nom: 'A', debut: '8', fin: '8' }, [], null).erreurs.fin!, /différer/);
  assert.match(controlerHoraire({ code: 'A', nom: 'A', debut: '8', fin: '9', pause: '60' }, [], null).erreurs.pause!, /plus courte/);
  assert.match(controlerHoraire({ code: 'A', nom: 'A', debut: '8', fin: '16', pause: '1,5' }, [], null).erreurs.pause!, /entier/);
  assert.deepEqual(controlerHoraire({ code: ' am2 ', nom: ' Après-midi  bis ', debut: '13', fin: '21:00', pause: '' }, [], null).horaire,
    { code: 'AM2', nom: 'Après-midi bis', debut: '13:00', fin: '21:00', pause: 0, archive: null });
});

test('horaire du jour : proposé par l’équipe les jours qui portent des heures, tant que la feuille est en saisie', () => {
  const J = { code: 'J', debut: '08:00', fin: '16:00', pause: 60 };
  const r = { horaires: [{ ...J, nom: 'Journée' }], equipes: [{ nom: 'Maintenance', managerId: 12, ordre: 0, horaire: 'J' }] };
  const perDay = [7, 7, 0, 0, 0, 0, 0];
  const brouillon = { statut: 'brouillon' as const, horaires: ['', null, null, null, 'J', null, null] };
  assert.deepEqual(horairesDeLaFeuille(r, 'Maintenance', brouillon, perDay).map(j => [j.code, j.propose]),
    [[null, false], ['J', true], [null, false], [null, false], ['J', false], [null, false], [null, false]]);
  // Figés à la soumission avec leurs heures ; un jour sans heure ni choix n'en a aucun.
  assert.deepEqual(horairesAFiger(r, 'Maintenance', brouillon, perDay), { horairesFiges: [null, J, null, null, J, null, null] });
  // Feuille soumise d'avant les horaires : aucun, jamais proposé après coup (aucun contrôle rétroactif), rien à figer.
  assert.ok(horairesDeLaFeuille(r, 'Maintenance', { statut: 'soumise', horaires: undefined }, perDay).every(j => j.code === null));
  assert.deepEqual(horairesAFiger(r, 'Maintenance', { statut: 'soumise', horaires: undefined }, perDay), {});
  // Équipe sans horaire, feuille sans choix et référentiel sans horaire en vigueur : rien n'est enregistré à la soumission.
  assert.deepEqual(horairesAFiger({ ...r, horaires: [] }, 'Logistique', { statut: 'brouillon', horaires: null }, perDay), {});
  // Feuille soumise, puis horaire J modifié au référentiel : les heures figées restent celles de la soumission.
  const soumise = { statut: 'soumise' as const, horaires: null, horairesFiges: [J, null, null, null, null, null, null] };
  const r2 = { ...r, horaires: [{ ...J, nom: 'Journée', debut: '07:00', fin: '15:00' }] };
  assert.deepEqual(horairesDeLaFeuille(r2, 'Maintenance', soumise, [7, 0, 0, 0, 0, 0, 0]).map(j => j.horaire), [J, null, null, null, null, null, null]);
  // Le valideur y ajoute des heures le mardi : l'horaire de l'équipe y est proposé, avec les heures du référentiel.
  assert.deepEqual(horairesDeLaFeuille(r2, 'Maintenance', soumise, [7, 7, 0, 0, 0, 0, 0]).slice(0, 2).map(j => [j.code, j.propose, j.horaire?.debut]),
    [['J', false, '08:00'], ['J', true, '07:00']]);
  // Validée : les horaires figés, tels quels, quelles que soient les heures.
  assert.deepEqual(horairesDeLaFeuille(r2, null, { ...soumise, statut: 'validee' }, [0, 0, 0, 0, 0, 0, 0]).map(j => j.code), ['J', null, null, null, null, null, null]);
});

test('horaires : référentiel, horaire par défaut de l’équipe, choix du jour, figé à la soumission, journal', async () => {
  const { db, run, refuse, derniere, RH, user } = await fresh();
  const GEST = await user(14, 'rh'), KARIM = await user(12, 'manager'), MEHDI = await user(2, 'collaborateur'), LECTURE = await user(11, 'rh');
  const ref = async () => (await loadFull(db, RH)).referentiels;
  assert.deepEqual((await ref()).horaires!.map(h => h.code), ['J', 'M', 'AM', 'N'], 'exemples amorcés dans la démonstration');
  assert.equal((await ref()).equipes.find(q => q.nom === 'Maintenance')!.horaire, 'J');
  assert.match(String(await run(GEST, 'referentiel.horaire.enregistrer', { code: 'S', nom: 'Samedi matin', debut: '6', fin: '12', pause: 0 })), /Horaire S · 6 h – 12 h créé/);
  assert.deepEqual((await derniere('referentiel.horaire.enregistrer'))!.payload, {
    code: 'S', avant: { nom: null, debut: null, finHoraire: null, pause: null }, apres: { nom: 'Samedi matin', debut: '06:00', finHoraire: '12:00', pause: 0 },
  });
  await refuse(GEST, 'referentiel.horaire.enregistrer', { code: 's', nom: 'Doublon', debut: '6', fin: '12' }, /existe déjà/);
  await refuse(LECTURE, 'referentiel.horaire.enregistrer', { code: 'X', nom: 'X', debut: '6', fin: '12' }, /./, 403);
  await run(GEST, 'referentiel.horaire.enregistrer', { id: 'S', nom: 'Samedi matin', debut: '6', fin: '13', pause: 15 });
  assert.deepEqual((await derniere('referentiel.horaire.enregistrer'))!.payload, { code: 'S', avant: { finHoraire: '12:00', pause: 0 }, apres: { finHoraire: '13:00', pause: 15 } });
  // Archivage refusé tant qu'une équipe le propose ; un horaire archivé ne se choisit plus.
  await refuse(GEST, 'referentiel.horaire.archiver', { id: 'J' }, /proposé par défaut à l’équipe Maintenance, Administration/);
  assert.match(String(await run(GEST, 'referentiel.horaire.archiver', { id: 'S' })), /archivé/);
  await refuse(GEST, 'referentiel.equipe.exigences', { nom: 'Logistique', formations: ['sst'], habilitations: [], horaire: 'S' }, /archivé : rétablissez-le/);
  assert.match(String(await run(GEST, 'referentiel.equipe.exigences', { nom: 'Logistique', formations: ['sst'], habilitations: [], horaire: 'm' })), /horaire M proposé/);
  assert.equal((await derniere('referentiel.equipe.exigences'))!.payload.horaire, 'M');
  await run(GEST, 'referentiel.horaire.archiver', { id: 'S', archive: false });

  // Feuille de Mehdi (Maintenance, horaire J) : heures du lundi et du mardi, nuit choisie le mardi.
  const week = '2026-10-19', base = { empId: 2, week };
  await run(MEHDI, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 0, value: '7' });
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 1, value: '7' });
  await refuse(MEHDI, 'temps.horaire', { ...base, di: 7, code: 'N' }, /Jour invalide/);
  await refuse(MEHDI, 'temps.horaire', { ...base, di: 1, code: 'Z' }, /introuvable/, 404);
  await refuse(await user(6, 'collaborateur'), 'temps.horaire', { ...base, di: 1, code: 'N' }, /./, 403);
  await run(MEHDI, 'temps.horaire', { ...base, di: 1, code: 'n' });
  assert.equal(await derniere('temps.horaire'), undefined, 'le choix du salarié sur sa propre feuille n’est pas tracé');
  await run(KARIM, 'temps.horaire', { ...base, di: 2, code: '' });
  assert.deepEqual((await derniere('temps.horaire'))!.payload, { empId: 2, week, avant: { horaire: null }, apres: { horaire: '' }, jour: '2026-10-21', feuille: 'brouillon' });
  const sh = async () => (await db.all<Feuille>('feuilles')).find(f => f.empId === 2 && f.week === week)!;
  assert.deepEqual((await sh()).horaires, [null, 'N', '', null, null, null, null]);
  await run(MEHDI, 'temps.submit', base);
  assert.deepEqual((await sh()).horaires, [null, 'N', '', null, null, null, null], 'les choix ne sont pas touchés par la soumission');
  const codes = async () => (await sh()).horairesFiges!.map(h => h?.code ?? null);
  assert.deepEqual(await codes(), ['J', 'N', null, null, null, null, null], 'figé à la soumission : l’horaire de l’équipe le lundi');
  assert.deepEqual((await sh()).horairesFiges![1], { code: 'N', debut: '21:00', fin: '05:00', pause: 30 });
  // Changer ensuite l'horaire de l'équipe ne touche pas la feuille soumise.
  await run(GEST, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [], horaire: '' });
  assert.equal((await ref()).equipes.find(q => q.nom === 'Maintenance')!.horaire, null);
  const d = new Domain(await loadFull(db, RH));
  assert.deepEqual(horairesDeLaFeuille(d.ds.referentiels, 'Maintenance', await sh(), [7, 7, 0, 0, 0, 0, 0]).map(j => j.code), ['J', 'N', null, null, null, null, null]);
  // Une feuille soumise ne se modifie plus que par son valideur.
  await refuse(MEHDI, 'temps.horaire', { ...base, di: 0, code: 'M' }, /déjà soumise/);
  await run(KARIM, 'temps.horaire', { ...base, di: 0, code: 'M' });
  assert.equal((await sh()).horaires![0], 'M');
  // Les horaires et l'horaire de l'équipe sont transmis au manager et au collaborateur (aucune donnée personnelle).
  assert.deepEqual((await buildSnapshot(db, MEHDI)).referentiels.horaires!.map(h => h.code), ['J', 'M', 'AM', 'N', 'S']);
  assert.equal((await buildSnapshot(db, KARIM)).feuilles.find(f => f.empId === 2 && f.week === week)!.horaires![1], 'N');
  assert.equal((await buildSnapshot(db, MEHDI)).feuilles.find(f => f.empId === 2 && f.week === week)!.horairesFiges![1]!.code, 'N');
  // Heures de N modifiées au référentiel après la soumission : la feuille garde celles d'alors, jusqu'à sa validation.
  assert.match(String(await run(GEST, 'referentiel.horaire.enregistrer', { id: 'N', nom: 'Équipe de nuit', debut: '22', fin: '6', pause: 30 })), /gardent les heures d’avant/);
  await run(KARIM, 'temps.validate', base);
  assert.equal((await sh()).statut, 'validee');
  assert.deepEqual(await codes(), ['M', 'N', null, null, null, null, null], 'refigé à la validation, avec le choix du valideur');
  assert.deepEqual((await sh()).horairesFiges![1], { code: 'N', debut: '21:00', fin: '05:00', pause: 30 }, 'heures du code déjà figé inchangées');
  assert.equal((await sh()).horairesFiges![0]!.debut, '05:00');
});

test('horaire du jour : une feuille renvoyée repart des choix et de l’équipe, puis se refige à la soumission suivante', async () => {
  const { db, run, user } = await fresh();
  const KARIM = await user(12, 'manager'), MEHDI = await user(2, 'collaborateur');
  const week = '2026-10-19', base = { empId: 2, week };
  const sh = async () => (await db.all<Feuille>('feuilles')).find(f => f.empId === 2 && f.week === week)!;
  const codes = async () => (await sh()).horairesFiges!.map(h => h?.code ?? null);
  const affiches = async () => {
    const d = new Domain(await loadFull(db, MEHDI));
    return horairesDeLaFeuille(d.ds.referentiels, 'Maintenance', await sh(), calcSheet(d, d.emp(2)!, await sh()).perDay).map(j => [j.code, j.propose]);
  };
  // Mehdi (Maintenance, horaire J) : 7 h le lundi, soumise ; Karim la renvoie.
  await run(MEHDI, 'temps.addLine', { ...base, projet: 'INT-MAINT' });
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 0, value: '7' });
  await run(MEHDI, 'temps.submit', base);
  assert.deepEqual(await codes(), ['J', null, null, null, null, null, null]);
  await run(KARIM, 'temps.reject', { ...base, comment: 'Le mercredi, pas le lundi' });
  // Heures déplacées du lundi au mercredi : le lundi perd l'horaire proposé, le mercredi le reçoit.
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 0, value: '' });
  await run(MEHDI, 'temps.setCell', { ...base, li: 0, di: 2, value: '7' });
  assert.deepEqual((await affiches()).slice(0, 3), [[null, false], [null, false], ['J', true]]);
  await run(MEHDI, 'temps.submit', base);
  assert.deepEqual(await codes(), [null, null, 'J', null, null, null, null], 'figé le jour travaillé, et lui seul');
  assert.equal((await sh()).horaires ?? null, null, 'aucun choix inscrit');
});

test('migration lot6-horaires-exemples : exemples amorcés une fois, sans toucher aux horaires existants', async () => {
  const db = new Db(':memory:');
  assert.deepEqual((await appliquerMigrations(db)).includes('lot6-horaires-exemples'), true, 'base neuve : exemples ajoutés');
  assert.deepEqual((await db.all<{ code: string }>('horaires', 'rowid')).map(h => h.code), ['J', 'M', 'AM', 'N']);
  assert.deepEqual(await appliquerMigrations(db), [], 'une seule fois');
  // Base où le service RH a modifié J et supprimé (hors de Cursus) N : la migration ne touche que les codes absents.
  await db.exec(`UPDATE horaires SET debut = '07:30' WHERE code = 'J'`);
  await db.exec(`DELETE FROM horaires WHERE code = 'N'`);
  assert.equal(await HORAIRES_EXEMPLES_MIGRATION.necessaire!(db), true);
  assert.deepEqual(await amorcerHoraires(db), ['N']);
  assert.equal((await (await db.get<{ debut: string }>('horaires', 'J'))!).debut, '07:30');
  assert.equal(await HORAIRES_EXEMPLES_MIGRATION.necessaire!(db), false);
  // Feuilles existantes : aucune ne reçoit d'horaire (aucun contrôle rétroactif).
  assert.equal(Number(((await db.one('SELECT COUNT(*) AS n FROM feuilles WHERE horaires IS NOT NULL OR horaires_figes IS NOT NULL')) as { n: number }).n), 0);
});
