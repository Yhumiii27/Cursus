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
const CLARA: User = { role: 'collaborateur', empId: 19, nom: 'Clara Roussel', intitule: '' };
// Données de santé, y compris celle d'un enfant : nature jamais transmise au manager ni à Keystone.
const MEDICALES = ['MALADIE', 'ALD', 'AT', 'TRAJET', 'MP', 'HANDICAP_ENFANT', 'ENFANT_MALADE'];
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
  const keystone = () => db.all<{ action: string; payload: Record<string, unknown> }>('journal').filter(j => j.action.startsWith('keystone.absence.'))
    .map(j => j.payload as { type: string; absence: number; matricule: string; du: string; au: string });
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
    assert.deepEqual(keystone().at(-1), { type: 'absence.validee', absence: a.id, matricule: 'EMP-0002', du, au });
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
  assert.deepEqual(keystone().at(-1), { type: 'absence.validee', absence: a.id, matricule: 'EMP-0002', du: '2026-10-12', au: '2026-10-14' });
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
  // Dates corrigées : même absence, Keystone reçoit la nouvelle période complète, sans la nature.
  assert.deepEqual(keystone().at(-1), { type: 'absence.validee', absence: a.id, matricule: 'EMP-0002', du: '2026-10-12', au: '2026-10-15' });
  assert.ok(!keystone().some(k => k.type === 'absence.annulee' && k.absence === a.id), 'pas d’annulation pour une correction');
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
  // Keystone : identifiant de l'absence, matricule et période, jamais la nature.
  assert.ok(keystone().length >= 5);
  assert.ok(keystone().every(k => Object.keys(k).sort().join() === 'absence,au,du,matricule,type'), JSON.stringify(keystone()));
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
  assert.deepEqual(keystone().at(-1), { type: 'absence.validee', absence: id, matricule: 'EMP-0002', du: '2026-10-12', au: '2026-10-16' }, 'période complète, même absence');
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
  assert.deepEqual(keystone().at(-1), { type: 'absence.annulee', absence: val.id, matricule: 'EMP-0002', du: '2026-12-07', au: '2026-12-08' });

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
  // Tâche planifiée par Keystone sur toute la semaine : seuls le lundi et le mardi sont proposés.
  db.insert('taches', { ref: null, empId: 24, projet: 'INT-MAINT', tache: 'Apprentissage — maintenance', debut: '2027-08-30', fin: '2027-09-03',
    heures: { '2027-08-30': 7, '2027-08-31': 7, '2027-09-01': 7, '2027-09-02': 7, '2027-09-03': 7 } });
  run(RH, 'temps.suggest', { empId: 24, week: '2027-08-30' });
  assert.deepEqual(sheet(24, '2027-08-30')!.lignes.map(l => l.h), [[7, 7, 0, 0, 0]]);
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
    assert.ok(['signale_le', 'signale_par', 'signale_par_interesse', 'justificatif', 'justificatif_le', 'fin_initiale', 'annulee_le', 'annulee_par'].every(c => db.columns('absences').includes(c)));
    const rows = db.all<Absence>('absences');
    assert.deepEqual(rows.map(a => [a.empId, a.type, a.statut, a.keystone, a.justificatif, a.signaleLe, a.signaleParInteresse, a.finInitiale, a.annuleeLe]), [
      [2, 'CP', 'validee', true, false, null, false, null, null],
      [3, 'RTT', 'demandee', false, false, null, false, null, null],
    ]);
    assert.ok(readdirSync(join(dir, 'backups')).some(f => f.includes('avant-migration')), 'copie de sécurité avant migration');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('annulation par l’intéressé : son propre signalement seulement, ni qualifié ni prolongé', () => {
  const { run, abs, absId } = fresh();
  const proprePas = refus(403, /^Seul votre propre signalement, ni qualifié ni prolongé, se retire/);
  // Maternité de Clara Roussel (19), validée par le RH : la prolonger ne permet pas ensuite de l'annuler.
  const mat = abs(19, '2026-11-16');
  assert.throws(() => run(CLARA, 'absence.annuler', { id: mat.id }), refus(403, /^Absence validée : demandez son annulation/));
  run(CLARA, 'absence.prolonger', { id: mat.id, au: '2027-03-08' });
  assert.equal(absId(mat.id).statut, 'signalee');
  assert.throws(() => run(CLARA, 'absence.annuler', { id: mat.id }), proprePas);
  assert.equal(absId(mat.id).statut, 'signalee', 'toujours en vigueur');

  // Signalement du manager ou du RH : l'intéressé ne l'annule pas, son manager si.
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-19', au: '2026-10-20' });
  const parKarim = abs(2, '2026-10-19');
  assert.equal(parKarim.signaleParInteresse, false);
  assert.throws(() => run(MEHDI, 'absence.annuler', { id: parKarim.id }), proprePas);
  assert.match(msg(run(KARIM, 'absence.annuler', { id: parKarim.id })), /^Absence de Mehdi Benali annulée — Keystone prévenu/);
  run(RH, 'absence.signaler', { empId: 2, du: '2026-10-21', au: '2026-10-21' });
  assert.throws(() => run(MEHDI, 'absence.annuler', { id: abs(2, '2026-10-21').id }), proprePas);

  // Son propre signalement : retiré tant qu'il n'est ni prolongé ni qualifié.
  run(MEHDI, 'absence.signaler', { empId: 2, du: '2026-10-26', au: '2026-10-26' });
  const sien = abs(2, '2026-10-26');
  assert.equal(sien.signaleParInteresse, true);
  run(MEHDI, 'absence.prolonger', { id: sien.id, au: '2026-10-27' });
  assert.throws(() => run(MEHDI, 'absence.annuler', { id: sien.id }), proprePas);
  run(MEHDI, 'absence.signaler', { empId: 2, du: '2026-10-29', au: '2026-10-29' });
  const qualifie = abs(2, '2026-10-29');
  run(RH, 'absence.qualifier', { id: qualifie.id, nature: 'ENFANT_MALADE' });
  assert.throws(() => run(MEHDI, 'absence.annuler', { id: qualifie.id }), refus(403, /^Absence validée/));
});

test('annulation hors périmètre : refus identique, sans rien révéler de l’absence', () => {
  const { run, abs } = fresh();
  // Léa Girard (15), collaboratrice : maternité à venir de Clara, arrêt passé de Marion, demande de CP en attente.
  const ids = [abs(19, '2026-11-16').id, abs(13, '2026-10-05').id, abs(18, '2026-12-21').id];
  for (const id of ids) {
    assert.throws(() => run(LEA, 'absence.annuler', { id }), (e: unknown) =>
      e instanceof ActionError && e.status === 403 && e.message === 'Vous ne pouvez annuler qu’une absence de vous-même ou de votre équipe');
  }
  // Un manager hors de l'équipe non plus.
  assert.throws(() => run(HUGO, 'absence.annuler', { id: abs(2, '2026-11-02').id }), refus(403, /de vous-même ou de votre équipe/));
});

test('feuille soumise sans heure : renvoyée quand l’absence est raccourcie ou annulée, jamais validée à 0 h', () => {
  const { db, run, abs, sheet } = fresh();
  // Karim signale Mehdi toute la semaine 42 ; Mehdi soumet sa feuille sans heure.
  run(KARIM, 'absence.signaler', { empId: 2, du: '2026-10-12', au: '2026-10-16' });
  assert.match(msg(run(MEHDI, 'temps.submit', { empId: 2, week })), /semaine d’absence, sans heure/);
  // Retour anticipé : le RH qualifie un arrêt du lundi au mercredi seulement. La feuille repart au salarié.
  const q = msg(run(RH, 'absence.qualifier', { id: abs(2, '2026-10-12').id, nature: 'MALADIE', du: '2026-10-12', au: '2026-10-14' }));
  assert.match(q, / · feuille de temps soumise sans heure \(semaine 42\) renvoyée pour saisie$/);
  assert.deepEqual([sheet()!.statut, sheet()!.comment], ['rejetee', 'Absence annulée ou raccourcie : la semaine n’est plus couverte, saisissez les heures travaillées']);
  assert.throws(() => run(KARIM, 'temps.validate', { empId: 2, week }), /Aucune feuille en attente de validation/);

  // Mehdi signale la semaine 43, soumet sans heure puis retire son signalement : même renvoi.
  run(MEHDI, 'absence.signaler', { empId: 2, du: '2026-10-19', au: '2026-10-23' });
  run(MEHDI, 'temps.submit', { empId: 2, week: '2026-10-19' });
  assert.match(msg(run(MEHDI, 'absence.annuler', { id: abs(2, '2026-10-19').id })), /feuille de temps soumise sans heure \(semaine 43\) renvoyée pour saisie$/);
  assert.equal(sheet(2, '2026-10-19')!.statut, 'rejetee');

  // Base antérieure à ce contrôle (absence annulée sans renvoi) : la validation refuse la feuille à 0 h.
  run(RH, 'absence.saisir', { empId: 2, nature: 'SANS_SOLDE', du: '2026-10-26', au: '2026-10-30' });
  run(MEHDI, 'temps.submit', { empId: 2, week: '2026-10-26' });
  db.update('absences', abs(2, '2026-10-26').id, { statut: 'annulee' });
  assert.throws(() => run(KARIM, 'temps.validate', { empId: 2, week: '2026-10-26' }),
    refus(400, /^La semaine n’est plus couverte par une absence : renvoyez la feuille pour saisie des heures$/));
});

test('reprise : une obligation en retard n’est pas remplacée, une reprise effacée n’est pas réinscrite', () => {
  const { db, run, domain, abs } = fresh();
  const fiche = (id: number) => { const e = domain().emp(id)!; return [e.repriseMotif, e.repriseDate]; };
  const reprise = (id: number) => obligations(domain(), [id]).find(o => o.kind === 'reprise');
  // Aïcha Diallo (7) : retour de congé parental le 1er septembre 2026, entretien de reprise pas encore réalisé.
  assert.deepEqual([reprise(7)?.due, reprise(7)?.st], ['2026-09-01', 'late']);
  const m = msg(run(RH, 'absence.saisir', { empId: 7, nature: 'MATERNITE', du: '2026-12-01', au: '2027-03-22' }));
  assert.match(m, / · reprise du 1 sept\. 2026 conservée sur la fiche, entretien de reprise à réaliser : celle du 23 mars 2027 sera à inscrire ensuite$/);
  assert.deepEqual(fiche(7), ['congé parental d’éducation', '2026-09-01']);
  assert.deepEqual([reprise(7)?.due, reprise(7)?.st], ['2026-09-01', 'late'], 'obligation en retard conservée');
  // Entretien réalisé : la prolongation de la maternité inscrit sa reprise.
  db.insert('entretiens', { empId: 7, type: 'reprise', date: '2026-10-08', statut: 'realise', cr: {}, info: false });
  run(RH, 'absence.prolonger', { id: abs(7, '2026-12-01').id, au: '2027-03-23' });
  assert.deepEqual(fiche(7), ['congé de maternité', '2027-03-24']);

  // Mehdi : arrêt longue maladie passé, reprise inscrite puis effacée à la main par le RH.
  run(RH, 'absence.saisir', { empId: 2, nature: 'ALD', du: '2026-03-02', au: '2026-06-30' });
  assert.deepEqual(fiche(2), ['arrêt longue maladie', '2026-07-01']);
  run(RH, 'employe.modifier', { id: 2, repriseMotif: null, repriseDate: null });
  // Ni le retrait d'une demande de CP ni un événement familial ne la réinscrivent.
  run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  run(MEHDI, 'absence.annuler', { id: abs(2, '2026-12-07').id });
  run(RH, 'absence.saisir', { empId: 2, nature: 'NAISSANCE', du: '2026-11-23', au: '2026-11-25' });
  assert.deepEqual(fiche(2), [null, null]);
});

test('confidentialité : reprise d’un arrêt longue maladie et santé d’un enfant masquées au manager', () => {
  const { db, run, domain } = fresh();
  // Arrêt longue maladie de Mehdi : le RH voit la reprise, le manager ni la reprise ni l'obligation d'entretien.
  run(RH, 'absence.saisir', { empId: 2, nature: 'ALD', du: '2026-11-09', au: '2026-12-18' });
  assert.equal(obligations(domain(), [2]).find(o => o.kind === 'reprise')?.detail, 'Retour d’arrêt longue maladie le 21 déc. 2026 — à proposer systématiquement');
  const vue = buildSnapshot(db, KARIM);
  const mehdi = vue.employes.find(e => e.id === 2)!;
  assert.deepEqual([mehdi.repriseMotif, mehdi.repriseDate], [null, null]);
  assert.ok(!obligations(new Domain(vue), [2]).some(o => o.kind === 'reprise'));
  assert.equal(vue.absences.find(a => a.empId === 2 && a.du === '2026-11-09')!.type, 'ABSENCE');
  // Une maternité reste visible du manager comme « absence longue », avec l'élision.
  run(RH, 'absence.saisir', { empId: 17, nature: 'MATERNITE', du: '2026-11-02', au: '2027-02-21' });
  const sarah = buildSnapshot(db, { role: 'manager', empId: 23, nom: 'Sarah Cohen', intitule: '' });
  const fatou = sarah.employes.find(e => e.id === 17)!;
  assert.deepEqual([fatou.repriseMotif, fatou.repriseDate], ['absence longue', '2027-02-22']);
  assert.equal(obligations(new Domain(sarah), [17]).find(o => o.kind === 'reprise')?.detail, 'Retour d’absence longue le 22 févr. 2027 — à proposer systématiquement');

  // Annonce du handicap d'un enfant, enfant malade : « Absence » pour le manager, aucun message ne les nomme.
  run(RH, 'absence.saisir', { empId: 2, nature: 'HANDICAP_ENFANT', du: '2026-10-12', au: '2026-10-13' });
  run(RH, 'absence.saisir', { empId: 2, nature: 'ENFANT_MALADE', du: '2026-10-15', au: '2026-10-15' });
  const types = buildSnapshot(db, KARIM).absences.filter(a => a.empId === 2 && a.du >= '2026-10-12' && a.du <= '2026-10-15').map(a => a.type);
  assert.deepEqual(types, ['ABSENCE', 'ABSENCE']);
  assert.equal(buildSnapshot(db, MEHDI).absences.find(a => a.du === '2026-10-12')!.type, 'HANDICAP_ENFANT', 'l’intéressé voit le détail');
  run(KARIM, 'temps.addLine', { empId: 2, week, projet: 'INT-MAINT' });
  for (const di of [0, 3]) {
    assert.throws(() => run(KARIM, 'temps.setCell', { empId: 2, week, li: 0, di, value: '7' }), (e: unknown) =>
      e instanceof ActionError && e.message === 'Absence validée ce jour-là : aucune heure ne peut être saisie');
  }
});

test('prolongation : la durée légale porte sur toute l’absence', () => {
  const { run, domain, abs } = fresh();
  // Julien Moreau (8) : mariage du lundi 16 au jeudi 19 novembre (4 j ouvrés), prolongé jusqu'au mardi 24.
  run(RH, 'absence.saisir', { empId: 8, nature: 'MARIAGE', du: '2026-11-16', au: '2026-11-19' });
  const mariage = abs(8, '2026-11-16'), d = domain();
  const chk = checkNature(d, d.emp(8)!, 'MARIAGE', '2026-11-20', '2026-11-24', { exclure: mariage.id, quand: '', depuis: mariage.du });
  assert.ok(!chk.cant, 'simple avertissement');
  assert.equal(chk.msgs[0].text, 'Décompte : 3 j ouvrés (7 j au total) — week-ends et jours fériés exclus.');
  assert.ok(chk.msgs.some(m => !m.bad && /^Au-delà de la durée légale \(4 j ouvrés — Art\. L3142-4\)/.test(m.text)), JSON.stringify(chk.msgs));
  // Enfant malade : 3 jours puis 2 jours de prolongation, au-delà des 3 jours par an.
  run(RH, 'absence.saisir', { empId: 8, nature: 'ENFANT_MALADE', du: '2026-11-30', au: '2026-12-02' });
  const em = abs(8, '2026-11-30'), d2 = domain();
  const chk2 = checkNature(d2, d2.emp(8)!, 'ENFANT_MALADE', '2026-12-03', '2026-12-04', { exclure: em.id, quand: '', depuis: em.du });
  assert.ok(chk2.msgs.some(m => !m.bad && /^Au-delà de la durée légale \(3 j ouvrés par an/.test(m.text)), JSON.stringify(chk2.msgs));
});
