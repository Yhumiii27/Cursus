// Absences hors congés (arrêts, parentalité, événements familiaux, absences non payées) : circuit signalement →
// qualification, confidentialité, feuilles de temps, prolongation, reprise ; annulation ; bornes du contrat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { NATURES_ABSENCE } = await import('../shared/constants.ts');
const { checkNature, cpInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { joursAbsence } = await import('../shared/rules/temps.ts');
const { lendemainOuvre } = await import('../shared/rules/absences.ts');
const { addD } = await import('../shared/dates.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Absence = ReturnType<typeof loadFull>['absences'][number];
type NatureAbsence = keyof typeof NATURES_ABSENCE;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: '' };
const SOPHIE: User = { role: 'manager', empId: 3, nom: 'Sophie Lemaire', intitule: '' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };
const LEA: User = { role: 'collaborateur', empId: 15, nom: 'Léa Girard', intitule: '' };
const MEDICALES = ['MALADIE', 'ALD', 'AT', 'TRAJET', 'MP'];
// Semaine 42 de Mehdi Benali (2), équipe Maintenance de Karim Haddad (12) : rien de saisi.
const week = '2026-10-12';

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const run = (user: User, name: string, payload: Record<string, unknown>) => db.tx(() => ACTIONS[name](makeCtx(db, user, loadFull(db, user)), payload));
  const domain = () => new Domain(loadFull(db, RH));
  const abs = (empId: number, du: string) => domain().ds.absences.find(a => a.empId === empId && a.du === du && a.statut !== 'annulee')!;
  const absId = (id: number) => domain().ds.absences.find(a => a.id === id)!;
  const sheet = (empId = 2, w = week) => domain().ds.feuilles.find(f => f.empId === empId && f.week === w);
  /** Messages Keystone sortants (simulation : tracés dans le journal). */
  const keystone = () => db.all<{ action: string; payload: Record<string, string> }>('journal').filter(j => j.action.startsWith('keystone.absence.'))
    .map(j => j.payload as { type: string; matricule: string; du: string; au: string; nature: string });
  return { db, run, domain, abs, absId, sheet, keystone };
}
const refus = (status: number, re?: RegExp) => (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message));
const msg = (r: unknown) => String(r);

test('référentiel : chaque nature décrite, durées légales des événements familiaux', () => {
  for (const [k, n] of Object.entries(NATURES_ABSENCE)) {
    assert.ok(n.label && n.abrege && n.court && n.cp, `${k} : libellés et effet sur les CP`);
    assert.ok(['maintenue', 'indemnisee', 'non_payee'].includes(n.paie), `${k} : rémunération`);
    assert.ok(['ouvres', 'calendaires'].includes(n.decompte), `${k} : décompte`);
    if (n.duree) assert.ok(n.article, `${k} : article de la durée légale`);
  }
  assert.deepEqual(Object.keys(NATURES_ABSENCE).filter(k => NATURES_ABSENCE[k as NatureAbsence].medicale), MEDICALES);
  const duree = (k: NatureAbsence) => NATURES_ABSENCE[k].duree;
  assert.deepEqual(['MARIAGE', 'MARIAGE_ENFANT', 'NAISSANCE', 'DECES_ENFANT', 'DECES_ENFANT_JEUNE', 'DECES_PROCHE', 'HANDICAP_ENFANT'].map(k => duree(k as NatureAbsence)), [4, 1, 3, 5, 12, 3, 5]);
  assert.ok(NATURES_ABSENCE.ENFANT_MALADE.parAn && duree('ENFANT_MALADE') === 3);
  assert.deepEqual(Object.keys(NATURES_ABSENCE).filter(k => NATURES_ABSENCE[k as NatureAbsence].reprise).sort(), ['ADOPTION', 'ALD', 'MATERNITE', 'PARENTAL']);
  assert.equal(NATURES_ABSENCE.MARIAGE.paie, 'maintenue');
  assert.equal(NATURES_ABSENCE.SANS_SOLDE.paie, 'non_payee');
});

test('chaque nature : saisie par le RH, jours bloqués, soldes CP et RTT intacts, Keystone sans la nature', () => {
  const { run, domain, abs, keystone } = fresh();
  const avant = domain(), e0 = avant.emp(2)!;
  const cp0 = cpInfo(avant, e0)!.solde, rtt0 = rttInfo(avant, e0)!.solde;
  // Une nature par semaine, le lundi et le mardi, à partir du 9 novembre.
  Object.keys(NATURES_ABSENCE).forEach((nature, i) => {
    const du = addD('2026-11-09', 7 * i), au = addD(du, 1);
    const m = msg(run(RH, 'absence.saisir', { empId: 2, nature, du, au, justificatif: true, justificatifLe: '2026-10-09' }));
    assert.match(m, /^Absence de Mehdi Benali enregistrée du .* — indisponibilité transmise à Keystone/);
    const a = abs(2, du);
    assert.deepEqual([a.type, a.statut, a.justificatif, a.justificatifLe, a.keystone], [nature, 'validee', true, '2026-10-09', true]);
    assert.deepEqual(joursAbsence(domain(), 2, du).map(x => x?.type ?? null), [nature, nature, null, null, null], `${nature} : jours bloqués`);
    assert.deepEqual(keystone().at(-1), { type: 'absence.validee', matricule: 'EMP-0002', du, au, nature: 'ABSENCE' });
  });
  const apres = domain(), e1 = apres.emp(2)!;
  assert.equal(cpInfo(apres, e1)!.solde, cp0, 'solde CP non débité');
  assert.equal(rttInfo(apres, e1)!.solde, rtt0, 'solde RTT non débité');
  // Le RH seul saisit directement ; une nature inconnue est refusée.
  assert.throws(() => run(KARIM, 'absence.saisir', { empId: 2, nature: 'MARIAGE', du: '2027-04-05', au: '2027-04-05' }), refus(403));
  assert.throws(() => run(RH, 'absence.saisir', { empId: 2, nature: 'CP', du: '2027-04-05', au: '2027-04-05' }), /Nature d’absence inconnue/);
});

test('décompte et durée légale selon la nature', () => {
  const { domain } = fresh();
  const d = domain(), julien = d.emp(8)!;
  // Du vendredi au lundi : 4 jours calendaires pour un arrêt, 2 jours ouvrés pour un mariage.
  assert.equal(checkNature(d, julien, 'MALADIE', '2026-11-20', '2026-11-23', { quand: '' }).n, 4);
  const mariage = checkNature(d, julien, 'MARIAGE', '2026-11-27', '2026-11-30', { quand: '' });
  assert.equal(mariage.n, 2);
  assert.ok(mariage.msgs.some(m => m.text === 'Durée légale : 4 j ouvrés (Art. L3142-4).'));
  const long = checkNature(d, julien, 'MARIAGE', '2026-11-23', '2026-11-30', { quand: '' });
  assert.ok(!long.cant, 'au-delà de la durée légale : simple avertissement');
  assert.ok(long.msgs.some(m => !m.bad && /^Au-delà de la durée légale \(4 j ouvrés — Art\. L3142-4\)/.test(m.text)));
});

test('circuit : le manager signale, le RH qualifie (nature, justificatif, dates corrigées)', () => {
  const { run, abs, keystone } = fresh();
  const m = msg(run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-12', au: '2026-10-14' }));
  assert.equal(m, 'Absence de Mehdi Benali signalée du 12 oct. au 14 oct. 2026 — nature à préciser par le service RH · indisponibilité transmise à Keystone');
  let a = abs(2, '2026-10-12');
  assert.deepEqual([a.type, a.statut, a.signaleLe, a.signalePar, a.justificatif], ['ABSENCE', 'signalee', '2026-10-10', 'Karim Haddad', false]);
  assert.deepEqual(keystone().at(-1), { type: 'absence.validee', matricule: 'EMP-0002', du: '2026-10-12', au: '2026-10-14', nature: 'ABSENCE' });
  // Le salarié signale aussi pour lui-même ; un autre manager ne le peut pas.
  assert.throws(() => run(HUGO, 'absence.signaler', { empId: 2, du: '2026-10-19', au: '2026-10-19' }), refus(403));
  assert.match(msg(run(MEHDI, 'absence.signaler', { empId: 2, du: '2026-10-19', au: '2026-10-19' })), /à qui transmettre le justificatif/);

  // Qualification : réservée au RH.
  assert.throws(() => run(KARIM, 'absence.qualifier', { id: a.id, nature: 'MALADIE' }), refus(403));
  assert.throws(() => run(RH, 'absence.qualifier', { id: a.id, nature: 'GRIPPE' }), /Nature d’absence inconnue/);
  assert.throws(() => run(RH, 'absence.qualifier', { id: a.id, nature: 'MALADIE', justificatif: true, justificatifLe: '2026-10-20' }), /Date de réception du justificatif invalide/);
  const q = msg(run(RH, 'absence.qualifier', { id: a.id, nature: 'MALADIE', du: '2026-10-12', au: '2026-10-15', justificatif: true, justificatifLe: '2026-10-09' }));
  assert.equal(q, 'Absence de Mehdi Benali qualifiée : arrêt maladie du 12 oct. au 15 oct. 2026, justificatif reçu le 9 oct. 2026');
  a = abs(2, '2026-10-12');
  assert.deepEqual([a.type, a.statut, a.au, a.justificatif, a.justificatifLe], ['MALADIE', 'validee', '2026-10-15', true, '2026-10-09']);
  // Dates corrigées : Keystone libère l'ancienne période et reçoit la nouvelle, sans la nature.
  assert.deepEqual(keystone().slice(-2), [
    { type: 'absence.annulee', matricule: 'EMP-0002', du: '2026-10-12', au: '2026-10-14', nature: 'ABSENCE' },
    { type: 'absence.validee', matricule: 'EMP-0002', du: '2026-10-12', au: '2026-10-15', nature: 'ABSENCE' },
  ]);
  // Un congé ne se qualifie pas.
  const rtt = abs(2, '2026-11-02');
  assert.throws(() => run(RH, 'absence.qualifier', { id: rtt.id, nature: 'MALADIE' }), /hors congés, se qualifie/);
});

test('confidentialité : ni le manager ni Keystone ne reçoivent la nature médicale', () => {
  const { db, run, abs, keystone } = fresh();
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-13', au: '2026-10-13' });
  const a = abs(2, '2026-10-13');
  run(RH, 'absence.qualifier', { id: a.id, nature: 'AT', justificatif: true });
  run(RH, 'absence.saisir', { empId: 2, nature: 'MARIAGE', du: '2026-11-23', au: '2026-11-24' });
  run(RH, 'absence.saisir', { empId: 12, nature: 'MALADIE', du: '2026-10-14', au: '2026-10-16' });
  run(RH, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-11-30', au: '2026-12-01', justificatif: true });

  const vue = (u: User, empId: number, du: string) => buildSnapshot(db, u).absences.find(x => x.empId === empId && x.du === du)!;
  assert.deepEqual([vue(KARIM, 2, '2026-10-13').type, vue(KARIM, 2, '2026-10-13').statut, vue(KARIM, 2, '2026-10-13').justificatif], ['ABSENCE', 'validee', false]);
  assert.equal(vue(KARIM, 2, '2026-11-23').type, 'MARIAGE', 'nature non médicale visible du manager');
  assert.equal(vue(KARIM, 12, '2026-10-14').type, 'MALADIE', 'ses propres absences en détail');
  assert.equal(vue(MEHDI, 2, '2026-10-13').type, 'AT', 'le salarié voit ses absences en détail');
  assert.equal(vue(RH, 2, '2026-10-13').type, 'AT');
  // La seule trace côté manager : « Absence ». Les messages ne nomment jamais un arrêt, quel que soit le lecteur.
  const s = JSON.stringify(buildSnapshot(db, KARIM).absences.filter(x => x.empId === 2));
  assert.doesNotMatch(s, /"(MALADIE|ALD|AT|TRAJET|MP)"/);
  run(KARIM, 'temps.addLine', { empId: 2, week, projet: 'INT-MAINT' });
  assert.throws(() => run(KARIM, 'temps.setCell', { empId: 2, week, li: 0, di: 1, value: '8' }), (e: unknown) =>
    e instanceof ActionError && e.message === 'Absence validée ce jour-là : aucune heure ne peut être saisie');
  const annule = msg(run(KARIM, 'absence.annuler', { id: abs(2, '2026-11-30').id }));
  assert.equal(annule, 'Absence de Mehdi Benali annulée — Keystone prévenu');
  // Keystone : CP, RTT, RECUP ou une simple indisponibilité.
  assert.ok(keystone().length >= 5);
  assert.ok(keystone().every(k => ['CP', 'RTT', 'RECUP', 'ABSENCE'].includes(k.nature)), JSON.stringify(keystone()));
});

test('feuille d’une semaine d’arrêt soumise sans heure ; heures refusées un jour d’arrêt', () => {
  const { run, abs, sheet } = fresh();
  // Heures déjà proposées le mardi : à retirer avant de signaler l'absence.
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  assert.throws(() => run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-13', au: '2026-10-13' }),
    /Heures déjà saisies le mar\. 13 oct\. : les retirer de la feuille de temps \(semaine 42\) avant de signaler l’absence/);
  run(MEHDI, 'temps.removeLine', { empId: 2, week, li: 1 });
  run(MEHDI, 'temps.removeLine', { empId: 2, week, li: 0 });
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-12', au: '2026-10-16' });
  run(MEHDI, 'temps.addLine', { empId: 2, week, projet: 'INT-MAINT' });
  assert.throws(() => run(MEHDI, 'temps.setCell', { empId: 2, week, li: 0, di: 1, value: '4' }), /Absence signalée ce jour-là : aucune heure ne peut être saisie/);
  // La proposition Keystone laisse la semaine vide ; la feuille se soumet et se valide sans heure.
  run(MEHDI, 'temps.suggest', { empId: 2, week });
  assert.ok(sheet()!.lignes.every(l => l.h.every(h => h === 0)));
  assert.match(msg(run(MEHDI, 'temps.submit', { empId: 2, week })), /Feuille de temps soumise à Karim Haddad — semaine d’absence, sans heure/);
  run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal(sheet()!.statut, 'validee');

  // Qualifiée, l'absence bloque toujours, et le message nomme une nature non médicale.
  run(RH, 'absence.saisir', { empId: 2, nature: 'MARIAGE', du: '2026-10-20', au: '2026-10-20' });
  run(MEHDI, 'temps.addLine', { empId: 2, week: '2026-10-19', projet: 'INT-MAINT' });
  assert.throws(() => run(MEHDI, 'temps.setCell', { empId: 2, week: '2026-10-19', li: 0, di: 1, value: '7' }),
    /Absence validée ce jour-là \(congé pour mariage ou Pacs\) : aucune heure ne peut être saisie/);
  // Absence partielle sans heure : la feuille reste à compléter.
  assert.throws(() => run(MEHDI, 'temps.submit', { empId: 2, week: '2026-10-19' }), /Aucune heure saisie/);

  // Temps partiel (Marion Petit, ne travaille pas jeudi et vendredi) : arrêt du lundi au mercredi, semaine couverte.
  assert.equal(abs(13, '2026-10-05').type, 'MALADIE');
  run(RH, 'temps.submit', { empId: 13, week: '2026-10-05' });
  assert.equal(sheet(13, '2026-10-05')!.statut, 'soumise');
});

test('prolongation d’un arrêt : nouvelle fin, sans chevauchement, à requalifier hors RH', () => {
  const { run, abs, absId, keystone } = fresh();
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-12', au: '2026-10-14' });
  const id = abs(2, '2026-10-12').id;
  run(RH, 'absence.qualifier', { id, nature: 'MALADIE', justificatif: true });
  assert.throws(() => run(KARIM, 'absence.prolonger', { id, au: '2026-10-13' }), /Nouvelle fin requise, après le 14 oct\. 2026/);
  assert.throws(() => run(HUGO, 'absence.prolonger', { id, au: '2026-10-16' }), refus(403));
  // Mehdi a demandé un RTT le 2 novembre : pas de chevauchement.
  assert.throws(() => run(KARIM, 'absence.prolonger', { id, au: '2026-11-03' }), /Une absence existe déjà sur ces dates \(le 2 nov\. 2026\)/);
  const m = msg(run(KARIM, 'absence.prolonger', { id, au: '2026-10-16' }));
  assert.equal(m, 'Absence de Mehdi Benali prolongée jusqu’au 16 oct. 2026 — prolongation à qualifier par le service RH · indisponibilité transmise à Keystone');
  let a = absId(id);
  assert.deepEqual([a.type, a.statut, a.du, a.au, a.finInitiale], ['MALADIE', 'signalee', '2026-10-12', '2026-10-16', '2026-10-14']);
  assert.deepEqual(keystone().at(-1), { type: 'absence.validee', matricule: 'EMP-0002', du: '2026-10-15', au: '2026-10-16', nature: 'ABSENCE' });
  // Le salarié prolonge aussi ; le RH prolonge sans repasser par la qualification.
  run(MEHDI, 'absence.prolonger', { id, au: '2026-10-19' });
  run(RH, 'absence.qualifier', { id, nature: 'MALADIE', justificatif: true });
  run(RH, 'absence.prolonger', { id, au: '2026-10-21' });
  a = absId(id);
  assert.deepEqual([a.statut, a.au, a.finInitiale], ['validee', '2026-10-21', '2026-10-14']);
  // Un congé ne se prolonge pas.
  assert.throws(() => run(MEHDI, 'absence.prolonger', { id: abs(2, '2026-11-02').id, au: '2026-11-03' }), /Un congé ne se prolonge pas/);
});

test('reprise renseignée automatiquement à la fin d’une absence longue', () => {
  const { db, run, domain, abs } = fresh();
  assert.equal(lendemainOuvre('2026-12-24'), '2026-12-28', 'férié et week-end sautés');
  const fiche = () => { const e = domain().emp(17)!; return [e.repriseMotif, e.repriseDate]; };
  assert.deepEqual(fiche(), [null, null]);
  // Fatou Ndiaye (17) : maternité jusqu'au dimanche 21 février 2027, reprise le lundi.
  const m = msg(run(RH, 'absence.saisir', { empId: 17, nature: 'MATERNITE', du: '2026-11-02', au: '2027-02-21', justificatif: true }));
  assert.match(m, /reprise le 22 févr\. 2027 : entretien de parcours professionnel à proposer$/);
  assert.deepEqual(fiche(), ['congé de maternité', '2027-02-22']);
  const d = domain();
  assert.ok(obligations(d, [17]).some(o => o.kind === 'reprise' && o.due === '2027-02-22'));
  // Le manager ne voit que la mention « absence longue ».
  assert.equal(buildSnapshot(db, { role: 'manager', empId: 23, nom: 'Sarah Cohen', intitule: '' }).employes.find(e => e.id === 17)!.repriseMotif, 'absence longue');
  // Prolongation, puis congé parental : la reprise suit la dernière absence.
  const mat = abs(17, '2026-11-02');
  run(RH, 'absence.prolonger', { id: mat.id, au: '2027-03-07' });
  assert.deepEqual(fiche(), ['congé de maternité', '2027-03-08']);
  run(RH, 'absence.saisir', { empId: 17, nature: 'PARENTAL', du: '2027-03-08', au: '2027-09-07' });
  assert.deepEqual(fiche(), ['congé parental d’éducation', '2027-09-08']);
  // Annulations : la reprise revient à la maternité, puis disparaît.
  run(RH, 'absence.annuler', { id: abs(17, '2027-03-08').id });
  assert.deepEqual(fiche(), ['congé de maternité', '2027-03-08']);
  assert.match(msg(run(RH, 'absence.annuler', { id: mat.id })), /date de reprise effacée de la fiche$/);
  assert.deepEqual(fiche(), [null, null]);

  // Aïcha Diallo (7) : reprise saisie à la main le 1er septembre 2026, plus récente qu'un ancien arrêt longue maladie.
  run(RH, 'absence.saisir', { empId: 7, nature: 'ALD', du: '2026-03-02', au: '2026-06-30' });
  run(RH, 'absence.saisir', { empId: 7, nature: 'MARIAGE', du: '2026-11-02', au: '2026-11-03' });
  const aicha = domain().emp(7)!;
  assert.deepEqual([aicha.repriseMotif, aicha.repriseDate], ['congé parental d’éducation', '2026-09-01']);
  // Données de démonstration : la maternité de Clara Roussel (19) a inscrit sa reprise.
  assert.equal(domain().emp(19)!.repriseDate, '2027-03-08');
});

test('annulation selon le rôle et le statut, solde recrédité', () => {
  const { run, domain, abs, absId, keystone } = fresh();
  const soldeCp = () => { const d = domain(); return cpInfo(d, d.emp(2)!)!.solde; };
  const cp0 = soldeCp();
  // Demande en attente : le salarié la retire ; son manager la refuse plutôt.
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  assert.equal(soldeCp(), cp0 - 2);
  const dem = abs(2, '2026-12-07');
  assert.throws(() => run(KARIM, 'absence.annuler', { id: dem.id }), refus(403, /refusez-la/));
  assert.equal(msg(run(MEHDI, 'absence.annuler', { id: dem.id })), 'Demande de congés payés du 7 déc. au 8 déc. 2026 retirée — 2 j de CP recrédités sur le solde');
  assert.deepEqual([absId(dem.id).statut, absId(dem.id).annuleeLe, absId(dem.id).annuleePar], ['annulee', '2026-10-10', 'Mehdi Benali']);
  assert.equal(soldeCp(), cp0);
  assert.throws(() => run(MEHDI, 'absence.annuler', { id: dem.id }), refus(400, /déjà refusée ou annulée/));

  // Absence validée qui n'a pas commencé : le manager direct (ou le RH) l'annule, pas le salarié.
  run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  const val = abs(2, '2026-12-07');
  assert.equal(val.statut, 'validee', 'les dates libérées se reposent');
  assert.throws(() => run(MEHDI, 'absence.annuler', { id: val.id }), refus(403, /demandez son annulation à votre manager/));
  assert.throws(() => run(HUGO, 'absence.annuler', { id: val.id }), refus(403));
  assert.equal(msg(run(KARIM, 'absence.annuler', { id: val.id })), 'Absence de Mehdi Benali (congés payés) annulée — 2 j de CP recrédités sur le solde — Keystone prévenu');
  assert.equal(soldeCp(), cp0);
  assert.deepEqual(keystone().at(-1), { type: 'absence.annulee', matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08', nature: 'CP' });

  // Absence commencée ou passée : le RH seul. Nicolas Perrin (22, équipe de Sophie Lemaire) : RTT du 9 octobre.
  const rttPris = () => { const d = domain(); return rttInfo(d, d.emp(22)!)!.pris; };
  const pris0 = rttPris(), rtt = abs(22, '2026-10-09');
  assert.throws(() => run(SOPHIE, 'absence.annuler', { id: rtt.id }), refus(403, /seul le service RH peut l’annuler/));
  assert.equal(msg(run(RH, 'absence.annuler', { id: rtt.id })), 'Absence de Nicolas Perrin (RTT / repos) annulée — 1 j de RTT recrédité sur le solde — Keystone prévenu');
  assert.equal(rttPris(), pris0 - 1);

  // Signalement à venir : l'intéressé peut l'annuler lui-même.
  run(MEHDI, 'absence.signaler', { empId: 2, du: '2026-10-19', au: '2026-10-19' });
  run(MEHDI, 'absence.annuler', { id: abs(2, '2026-10-19')?.id ?? 0 });
  assert.equal(domain().ds.absences.filter(a => a.empId === 2 && a.du === '2026-10-19').map(a => a.statut).join(), 'annulee');
});

test('bornes du contrat : absences et feuilles de temps', () => {
  const { db, run, sheet } = fresh();
  // Lucas Martin (4) : CDD jusqu'au 29 janvier 2027.
  assert.throws(() => run(HUGO, 'absence.demander', { empId: 4, kind: 'CP', du: '2027-02-01', au: '2027-02-02' }), /Absence hors contrat : fin de contrat le 29 janv\. 2027\./);
  assert.throws(() => run(RH, 'absence.saisir', { empId: 4, nature: 'MARIAGE', du: '2027-01-28', au: '2027-02-01' }), /Absence hors contrat : fin de contrat le 29 janv\. 2027\./);
  // Demande antérieure au contrôle : jamais validée hors contrat.
  const legacy = db.insert<Absence>('absences', { empId: 4, type: 'CP', du: '2027-02-01', au: '2027-02-01', statut: 'demandee', keystone: false });
  assert.throws(() => run(HUGO, 'absence.decider', { id: legacy.id, ok: true }), /Absence hors contrat : fin de contrat le 29 janv\. 2027/);
  run(HUGO, 'absence.decider', { id: legacy.id, ok: false });

  // Léa Girard (15) : intérimaire entrée le 15 juin 2026.
  assert.throws(() => run(LEA, 'absence.signaler', { empId: 15, du: '2026-06-12', au: '2026-06-16' }), /Absence hors contrat : entrée le 15 juin 2026\./);
  assert.throws(() => run(LEA, 'temps.addLine', { empId: 15, week: '2020-03-02', projet: 'INT-PROD' }), /Semaine hors contrat : entrée le 15 juin 2026/);
  assert.throws(() => run(RH, 'temps.suggest', { empId: 15, week: '2026-06-08' }), /Semaine hors contrat : entrée le 15 juin 2026/);
  assert.equal(sheet(15, '2020-03-02'), undefined, 'aucune feuille créée');

  // Bastien Morel (24) : alternance jusqu'au mardi 31 août 2027 ; la semaine du 30 août reste saisissable jusqu'au mardi.
  run(RH, 'temps.suggest', { empId: 24, week: '2027-08-30' });
  assert.deepEqual(sheet(24, '2027-08-30')!.lignes.map(l => l.h), [[7, 7, 0, 0, 0], [0, 0, 0, 0, 0]]);
  assert.throws(() => run(RH, 'temps.setCell', { empId: 24, week: '2027-08-30', li: 0, di: 2, value: '7' }), /Hors contrat ce jour-là \(fin de contrat le 31 août 2027\) : aucune heure ne peut être saisie/);
  run(RH, 'temps.setCell', { empId: 24, week: '2027-08-30', li: 0, di: 1, value: '6' });
  assert.throws(() => run(RH, 'temps.addLine', { empId: 24, week: '2027-09-06', projet: 'ECOLE' }), /Semaine hors contrat : fin de contrat le 31 août 2027/);
});

test('migration : une base existante reçoit les colonnes des absences, sans perte, après une copie', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-absences-'));
  try {
    const file = join(dir, 'ancienne.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE absences (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_id INTEGER, type TEXT, du TEXT, au TEXT, statut TEXT, keystone INTEGER)`);
    old.exec(`INSERT INTO absences (emp_id, type, du, au, statut, keystone) VALUES (2, 'CP', '2026-10-19', '2026-10-23', 'validee', 1), (3, 'RTT', '2026-11-02', '2026-11-02', 'demandee', 0)`);
    old.close();
    const db = new Db(file);
    migrate(db);
    assert.ok(['signale_le', 'signale_par', 'justificatif', 'justificatif_le', 'fin_initiale', 'annulee_le', 'annulee_par'].every(c => db.columns('absences').includes(c)));
    const rows = db.all<Absence>('absences');
    assert.deepEqual(rows.map(a => [a.empId, a.type, a.statut, a.keystone, a.justificatif, a.signaleLe, a.finInitiale, a.annuleeLe]), [
      [2, 'CP', 'validee', true, false, null, null, null],
      [3, 'RTT', 'demandee', false, false, null, null, null],
    ]);
    assert.ok(readdirSync(join(dir, 'backups')).some(f => f.includes('avant-migration')), 'copie de sécurité avant migration');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
