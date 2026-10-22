// Demi-journées de congé (lot 5, chantier C, t129) : CP, RTT ou repos, récupération à la demi-journée au premier et au
// dernier jour ; décompte pondéré, imputation des CP au demi-jour (anticipation, hors droit), chevauchement de deux
// demi-journées opposées, feuille de temps (une demi-journée de travail au plus), Keystone (journée entière), export,
// e-mails, annulation et clôture (jours rendus au demi-jour), migration nommée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { DEMI_JOURNEES } = await import('../server/src/migrations/conges.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { Domain } = await import('../shared/domain.ts');
const { checkAbsence, checkNature, cpInfo, imputationCp, joursCp, recupInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { lignesClotureCp } = await import('../shared/rules/clotures.ts');
const { chevauche, demiDuJour, demiJournees, demiTexte, heuresDemiJournee, periodeDemiTexte } = await import('../shared/rules/demi-journees.ts');
const { demandesEnAttenteMessage, demiJoursAbsence, heuresSurAbsence, heuresSurDemandes, joursAbsence, semaineCouverte } = await import('../shared/rules/temps.ts');
const { joursDecomptes } = await import('../shared/rules/absences.ts');
const { csvAbsences } = await import('../client/src/listes-csv.ts');
type User = Parameters<typeof buildSnapshot>[1];

const ADMIN: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: '', profilRh: 'rh_admin' };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: '' };
// Semaine 42 de Mehdi Benali (2, 39 h + RTT, équipe de Karim Haddad) : rien de saisi ; la proposition Keystone donne
// 8, 8, 8, 0, 0 (ligne 0) et 0, 0, 0, 8, 7 (ligne 1).
const week = '2026-10-12';

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  // Chemin de POST /api/actions/:nom : état lu avant l'action, trace au journal après.
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: o.message ?? null, result: o.result });
    return String(o.message ?? r);
  });
  const refused = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp) =>
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => e instanceof ActionError && motif.test(e.message), `${name} devait être refusé (${motif})`);
  const domain = async (today?: string) => { const ds = await loadFull(db, ADMIN); return new Domain(today ? { ...ds, today } : ds); };
  const emp = async (id: number) => (await domain()).emp(id)!;
  /** Congé enregistré tel quel, sans contrôle. */
  const conge = async (empId: number, type: string, du: string, au: string, demi: { debutDemi?: string; finDemi?: string } = {}, statut = 'validee') =>
    await db.insert<{ id: number }>('absences', { empId, type, du, au, statut, keystone: statut === 'validee', ...demi });
  const sheet = async () => (await domain()).ds.feuilles.find(f => f.empId === 2 && f.week === week)!;
  const cell = (li: number, di: number, value: string) => ({ empId: 2, week, li, di, value });
  return { db, run, refused, domain, emp, conge, sheet, cell };
}
async function le<T>(date: string, fn: () => T | Promise<T>): Promise<T> {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = date;
  try { return await fn(); } finally { process.env.CURSUS_TODAY = avant; }
}

test('règle des demi-journées : natures, premier et dernier jour, congé d’un seul jour', () => {
  assert.equal(demiJournees('CP', '2026-11-09', '2026-11-13', 'apres_midi', 'matin').erreur, null);
  assert.equal(demiJournees('RTT', '2026-11-09', '2026-11-09', 'matin', null).erreur, null);
  assert.equal(demiJournees('RECUP', '2026-11-09', '2026-11-09', 'apres_midi', undefined).erreur, null);
  assert.match(demiJournees('MARIAGE', '2026-11-09', '2026-11-09', 'matin', null).erreur!, /Seuls les congés payés/);
  assert.match(demiJournees('CP', '2026-11-09', '2026-11-09', 'matin', 'matin').erreur!, /une seule demi-journée/);
  assert.match(demiJournees('CP', '2026-11-09', '2026-11-10', 'matin', null).erreur!, /premier jour/);
  assert.match(demiJournees('CP', '2026-11-09', '2026-11-10', null, 'apres_midi').erreur!, /dernier jour/);
  // Valeur inconnue : refusée, jamais prise pour une journée entière ; absente, nulle ou vide : journée entière.
  assert.match(demiJournees('CP', '2026-11-09', '2026-11-10', 'soir', null).erreur!, /Demi-journée inconnue/);
  assert.match(demiJournees('CP', '2026-11-09', '2026-11-10', null, 1).erreur!, /Demi-journée inconnue/);
  assert.match(demiJournees('MARIAGE', '2026-11-09', '2026-11-10', 'apres-midi', null).erreur!, /Demi-journée inconnue/);
  assert.deepEqual(demiJournees('CP', '2026-11-09', '2026-11-10', '', undefined), { demi: { debutDemi: null, finDemi: null }, erreur: null });

  const a = { du: '2026-11-09', au: '2026-11-13', debutDemi: 'apres_midi' as const, finDemi: 'matin' as const };
  assert.deepEqual(['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-16'].map(j => demiDuJour(a, j)), ['apres_midi', null, 'matin', null]);
  // Deux demi-journées opposées le même jour : admises ; la même demi-journée, ou plus d'un jour en commun : chevauchement.
  const matin = { du: '2026-11-09', au: '2026-11-09', debutDemi: 'matin' as const };
  assert.equal(chevauche(matin, { du: '2026-11-09', au: '2026-11-12', debutDemi: 'apres_midi' }), false);
  assert.equal(chevauche(matin, { du: '2026-11-09', au: '2026-11-09', debutDemi: 'matin' }), true);
  assert.equal(chevauche(matin, { du: '2026-11-09', au: '2026-11-09' }), true);
  assert.equal(chevauche({ du: '2026-11-05', au: '2026-11-09', finDemi: 'matin' }, { du: '2026-11-09', au: '2026-11-10', debutDemi: 'apres_midi' }), false);
  assert.equal(chevauche({ du: '2026-11-05', au: '2026-11-10', finDemi: 'matin' }, { du: '2026-11-09', au: '2026-11-10', debutDemi: 'apres_midi' }), true);
  assert.equal(chevauche(matin, { du: '2026-11-10', au: '2026-11-10' }), false);

  assert.equal(periodeDemiTexte(a), 'du 9 nov. (après-midi) au 13 nov. 2026 (matin)');
  assert.equal(periodeDemiTexte(matin), 'le 9 nov. 2026 (matin)');
  assert.equal(periodeDemiTexte({ du: '2026-11-09', au: '2026-11-10' }), 'du 9 nov. au 10 nov. 2026');
  assert.equal(demiTexte(a), 'après-midi le premier jour · matin le dernier jour');
  assert.equal(heuresDemiJournee(7), 4);
  assert.equal(heuresDemiJournee(7.8), 4);
  assert.equal(heuresDemiJournee(10), 5);
  // Temps partiel à journées courtes : la moitié de la journée, jamais la journée entière.
  assert.equal(heuresDemiJournee(4), 2);
  assert.equal(heuresDemiJournee(3.5), 1.75);
});

test('décompte pondéré : 0,5 par demi-journée, soldes CP, RTT et récupération', async () => {
  const { domain, emp, conge } = await fresh();
  const d = await domain(), mehdi = await emp(2);
  assert.equal(d.countDays(mehdi, '2026-11-09', '2026-11-13', 'CP', { debutDemi: 'apres_midi', finDemi: 'matin' }), 3, '11 novembre férié');
  assert.deepEqual(d.countedDays(mehdi, '2026-11-09', '2026-11-10', 'CP', { debutDemi: 'apres_midi' }), [{ jour: '2026-11-09', poids: 0.5 }, { jour: '2026-11-10', poids: 1 }]);
  assert.equal(d.countDays(mehdi, '2026-11-09', '2026-11-09', 'RTT', { debutDemi: 'matin' }), 0.5);
  assert.equal(joursDecomptes(d, mehdi, { type: 'CP', du: '2026-11-09', au: '2026-11-09', debutDemi: 'matin' }), 0.5);

  const cp = cpInfo(d, mehdi)!, rt = rttInfo(d, mehdi)!;
  await conge(2, 'CP', '2026-11-09', '2026-11-10', { debutDemi: 'apres_midi' }, 'demandee');
  await conge(2, 'RTT', '2026-11-16', '2026-11-16', { debutDemi: 'matin' });
  await conge(2, 'RECUP', '2026-11-16', '2026-11-16', { debutDemi: 'apres_midi' }, 'demandee');
  const d2 = await domain();
  assert.deepEqual([cpInfo(d2, mehdi)!.poses - cp.poses, cpInfo(d2, mehdi)!.solde], [1.5, cp.solde - 1.5]);
  assert.deepEqual([rttInfo(d2, mehdi)!.pris - rt.pris, rttInfo(d2, mehdi)!.solde], [0.5, rt.solde - 0.5]);
  assert.equal(recupInfo(d2, mehdi)!.poses, 0.5 * d.dayH(mehdi), 'demi-journée de récupération : la moitié d’une journée en heures');
});

test('demande de congé : contrôles, demi-journée sur un jour non travaillé, chevauchement', async () => {
  const { domain, emp, conge } = await fresh();
  const mehdi = await emp(2);
  let chk = checkAbsence(await domain(), mehdi, 'CP', '2026-11-09', '2026-11-09', false, { debutDemi: 'matin' });
  assert.deepEqual([chk.cant, chk.n, chk.demi], [false, 0.5, { debutDemi: 'matin', finDemi: null }]);
  assert.match(chk.msgs[0].text, /Décompte : 0,5 j ouvrés/);
  chk = checkAbsence(await domain(), mehdi, 'CP', '2026-11-07', '2026-11-10', false, { debutDemi: 'apres_midi' });
  assert.ok(chk.cant && chk.msgs.some(m => m.bad && /Le premier jour n’est pas un jour travaillé/.test(m.text)), 'samedi');
  chk = checkAbsence(await domain(), mehdi, 'CP', '2026-11-09', '2026-11-11', false, { finDemi: 'matin' });
  assert.ok(chk.cant && chk.msgs.some(m => m.bad && /Le dernier jour n’est pas un jour travaillé/.test(m.text)), '11 novembre');
  chk = checkAbsence(await domain(), mehdi, 'CP', '2026-11-09', '2026-11-10', false, { debutDemi: 'matin' });
  assert.ok(chk.cant && chk.msgs.some(m => m.bad && /premier jour/.test(m.text)));

  // CP le matin du lundi 9 : un RTT l'après-midi est admis, un autre congé le matin ou la journée entière ne l'est pas.
  await conge(2, 'CP', '2026-11-09', '2026-11-09', { debutDemi: 'matin' });
  assert.equal(checkAbsence(await domain(), mehdi, 'RTT', '2026-11-09', '2026-11-09', false, { debutDemi: 'apres_midi' }).cant, false);
  assert.equal(checkAbsence(await domain(), mehdi, 'RTT', '2026-11-09', '2026-11-13', false, { debutDemi: 'apres_midi' }).cant, false);
  const meme = checkAbsence(await domain(), mehdi, 'RTT', '2026-11-09', '2026-11-09', false, { debutDemi: 'matin' });
  assert.ok(meme.cant && meme.msgs.some(m => m.bad && m.text === 'Une absence existe déjà sur ces dates.'));
  assert.equal(checkAbsence(await domain(), mehdi, 'RTT', '2026-11-09', '2026-11-09').cant, true, 'journée entière');
  // Absence hors congés (journées entières) : elle chevauche la demi-journée.
  const arret = checkNature(await domain(), mehdi, 'MALADIE', '2026-11-09', '2026-11-10', { quand: 'avant d’enregistrer l’absence' });
  assert.ok(arret.cant && arret.msgs.some(m => m.bad && /Une absence existe déjà sur ces dates \(le 9 nov\. 2026\)/.test(m.text)));
  assert.equal(checkNature(await domain(), mehdi, 'MALADIE', '2026-11-10', '2026-11-10', { quand: 'avant d’enregistrer l’absence' }).cant, false);
});

test('imputation des CP au demi-jour : journée répartie entre deux périodes, anticipation, hors droit', async () => {
  const { db, domain, emp } = await fresh();
  // Sophie Lemaire (3), sans absence : 0,5 j restant sur la période en cours, rien d'acquis en plus sur la suivante au 10 octobre.
  (await db.run(`INSERT OR REPLACE INTO soldes_reprise (emp_id, cp_pris, rtt_pris, recup_acquis, recup_pris, arrete_le, cp_solde, cp_solde_suivant) VALUES (3, 0, 0, 0, 0, '2026-10-10', 0.5, 0)`));
  const d = await domain(), sophie = await emp(3);
  assert.equal(cpInfo(d, sophie)!.solde, 0.5);
  // Le matin du 12 octobre : sur la période en cours.
  assert.equal(checkAbsence(d, sophie, 'CP', '2026-10-12', '2026-10-12', false, { debutDemi: 'matin' }).cant, false);
  // La journée entière : 0,5 j sur la période, le reste hors droit (aucun jour acquis à cette date sur la suivante).
  const oct = imputationCp(d, sophie, { du: '2026-10-12', au: '2026-10-12' }).filter(j => j.statut === 'nouveau');
  assert.deepEqual(oct.map(j => [j.poids, j.periode, j.anticipe, j.horsDroit]), [[0.5, 2026, false, false], [0.5, 2026, false, true]]);
  const refus = checkAbsence(d, sophie, 'CP', '2026-10-12', '2026-10-12');
  assert.ok(refus.cant && refus.msgs.some(m => m.bad && /Solde insuffisant/.test(m.text)));
  // Le 2 novembre : 0,5 j sur la période, 0,5 j par anticipation sur les 2,08 j acquis en octobre.
  const nov = imputationCp(d, sophie, { du: '2026-11-02', au: '2026-11-02' }).filter(j => j.statut === 'nouveau');
  assert.deepEqual(nov.map(j => [j.poids, j.periode, j.anticipe, j.horsDroit]), [[0.5, 2026, false, false], [0.5, 2027, true, false]]);
  const ok = checkAbsence(d, sophie, 'CP', '2026-11-02', '2026-11-03');
  assert.deepEqual([ok.cant, ok.n], [false, 2]);
  assert.ok(ok.msgs.some(m => /Prise par anticipation/.test(m.text)));
  // Posée : solde de la période épuisé, 1,5 j anticipés.
  await db.insert('absences', { empId: 3, type: 'CP', du: '2026-11-02', au: '2026-11-03', statut: 'demandee', keystone: false });
  const apres = cpInfo(await domain(), sophie)!;
  assert.deepEqual([apres.solde, apres.anticipes, apres.suivante], [0, 1.5, 1.5]);
  assert.equal(joursCp(imputationCp(await domain(), sophie)), 2);
});

test('pose par l’action : demi-journées enregistrées, tracées, transmises à Keystone en journées entières', async () => {
  const { db, run, refused, domain } = await fresh();
  await refused(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-11-09', au: '2026-11-10', debutDemi: 'matin' }, /premier jour/);
  await refused(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-11-09', au: '2026-11-09', debutDemi: 'matin', finDemi: 'matin' }, /une seule demi-journée/);
  const msg = await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-11-09', au: '2026-11-13', debutDemi: 'apres_midi', finDemi: 'matin' });
  assert.match(msg, /Demande de congés payés envoyée/);
  const a = (await domain()).ds.absences.find(x => x.empId === 2 && x.du === '2026-11-09')!;
  assert.deepEqual([a.debutDemi, a.finDemi, a.statut], ['apres_midi', 'matin', 'demandee']);
  // Journal : codes seulement.
  const j = (await db.one(`SELECT payload FROM journal WHERE action = 'absence.demander' ORDER BY id DESC LIMIT 1`)) as { payload: string };
  assert.deepEqual(JSON.parse(j.payload), { empId: 2, kind: 'CP', du: '2026-11-09', au: '2026-11-13', debutDemi: 'apres_midi', finDemi: 'matin' });
  // Demi-journée inconnue (texte libre) : demande refusée, rien de la chaîne reçue au journal.
  await refused(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-07', au: '2026-12-08', debutDemi: 'suivi médical', finDemi: { note: 'x' } }, /Demi-journée inconnue/);
  assert.ok(!JSON.stringify(await db.all('journal')).includes('suivi médical'), 'texte libre absent du journal');
  // E-mail au valideur : la demi-journée est précisée.
  const mail = JSON.stringify([...await db.all('envois'), ...await db.all('notifications')]);
  assert.ok(mail.includes('du lundi 9 novembre au vendredi 13 novembre 2026 (après-midi le premier jour · matin le dernier jour)'), 'e-mail de la demande');
  // Validée : Keystone reçoit la journée entière (contrat inchangé, aucun champ demi-journée).
  await run(KARIM, 'absence.decider', { id: a.id, ok: true });
  const ks = (await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).filter(x => x.action === 'keystone.absence.validee').at(-1)!;
  assert.deepEqual(ks.payload, { type: 'absence.validee', absence: a.id, matricule: 'EMP-0002', du: '2026-11-09', au: '2026-11-13' });
  // Un autre congé l'après-midi du 13 : admis, posé et validé par le manager.
  await run(KARIM, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-11-13', au: '2026-11-13', debutDemi: 'apres_midi' });
  await refused(KARIM, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-11-13', au: '2026-11-13', debutDemi: 'matin' }, /Une absence existe déjà/);
  // Annulation : 3 j de CP recrédités (11 novembre férié), 0,5 j de RTT.
  const rtt = (await domain()).ds.absences.find(x => x.empId === 2 && x.type === 'RTT' && x.du === '2026-11-13')!;
  assert.match(await run(ADMIN, 'absence.annuler', { id: rtt.id }), /0,5 j de RTT recrédité sur le solde/);
  assert.match(await run(ADMIN, 'absence.annuler', { id: a.id }), /3 j de CP recrédités sur le solde/);
});

test('feuille de temps : une demi-journée de travail au plus le jour d’une demi-journée d’absence', async () => {
  const { run, refused, domain, conge, sheet, cell } = await fresh();
  // CP le matin du mardi 13 octobre : le jour reste saisissable, 4 h au plus (Mehdi : 7,8 h par jour).
  await conge(2, 'CP', '2026-10-13', '2026-10-13', { debutDemi: 'matin' });
  const d = await domain();
  // Semaine à 7 jours (lot 5) : samedi et dimanche compris.
  assert.deepEqual(joursAbsence(d, 2, week).map(a => a?.type ?? null), [null, null, null, null, null, null, null]);
  assert.deepEqual(demiJoursAbsence(d, 2, week).map(x => x && [x.absence.type, x.demi, x.max]), [null, ['CP', 'matin', 4], null, null, null, null, null]);
  assert.equal(semaineCouverte(d, (await d.emp(2))!, week), false);
  // Proposition Keystone : 8 h ramenées à 4 h.
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  assert.deepEqual((await sheet()).lignes.map(l => l.h), [[8, 4, 8, 0, 0, 0, 0], [0, 0, 0, 8, 7, 0, 0]]);
  await refused(MEHDI, 'temps.setCell', cell(0, 1, '5'), /Demi-journée d’absence le mar\. 13 oct\. \(CP, matin\) : 4 h de travail au plus ce jour-là, toutes lignes cumulées \(5 h saisies\)/);
  await refused(MEHDI, 'temps.setCell', cell(1, 1, '1'), /4 h de travail au plus/);
  await run(MEHDI, 'temps.setCell', cell(0, 1, '3,5'));
  await run(MEHDI, 'temps.setCell', cell(1, 1, '0,5'));
  assert.deepEqual(heuresSurAbsence(await domain(), await sheet()), []);
  // L'après-midi posé à son tour en RTT : le jour devient entier, plus aucune heure.
  await conge(2, 'RTT', '2026-10-13', '2026-10-13', { debutDemi: 'apres_midi' });
  assert.equal(joursAbsence(await domain(), 2, week)[1]?.type, 'CP');
  await refused(MEHDI, 'temps.setCell', cell(0, 1, '4'), /Absence validée ce jour-là \(CP\) : aucune heure ne peut être saisie/);
  await refused(MEHDI, 'temps.submit', { empId: 2, week }, /Absence validée le mar\. 13 oct\. \(CP\) : retirez les heures saisies ce jour-là/);
});

test('feuille de temps : heures saisies avant la demi-journée, soumission et validation de la demande', async () => {
  const { run, refused, domain, conge, sheet, cell } = await fresh();
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  // Demande de CP l'après-midi du lundi 12 : 8 h saisies ce jour-là, la validation de l'absence est refusée.
  const id = (await conge(2, 'CP', '2026-10-12', '2026-10-12', { debutDemi: 'apres_midi' }, 'demandee')).id;
  await refused(KARIM, 'absence.decider', { id, ok: true }, /Heures déjà saisies le lun\. 12 oct\./);
  await run(MEHDI, 'temps.setCell', cell(0, 0, '4'));
  await run(KARIM, 'absence.decider', { id, ok: true });
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  await run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal((await sheet()).statut, 'validee');
  // Une demi-journée validée sans contrôle sur une journée de 8 h : soumission refusée avec la marche à suivre.
  const autre = await fresh();
  await autre.run(MEHDI, 'temps.suggest', { empId: 2, week });
  await autre.conge(2, 'RTT', '2026-10-14', '2026-10-14', { debutDemi: 'matin' });
  await autre.refused(MEHDI, 'temps.submit', { empId: 2, week }, /Demi-journée d’absence le mer\. 14 oct\. \(RTT, matin\) : 4 h de travail au plus ce jour-là, toutes lignes cumulées avant de soumettre la feuille/);
  assert.equal((await autre.domain()).ds.feuilles.find(f => f.empId === 2 && f.week === week)!.statut, 'brouillon');
  assert.equal((await domain()).ds.absences.find(a => a.id === id)!.statut, 'validee');
});

test('validation de la feuille : demande en attente sur une demi-journée, seule ou à côté d’une demi-journée validée', async () => {
  const { run, refused, domain, conge, sheet, cell } = await fresh();
  // CP validé le matin du mardi 13 : 4 h admises ce jour-là ; RTT demandé l'après-midi, le jour deviendrait entier.
  await conge(2, 'CP', '2026-10-13', '2026-10-13', { debutDemi: 'matin' });
  await run(MEHDI, 'temps.suggest', { empId: 2, week });
  assert.match(await run(MEHDI, 'absence.demander', { empId: 2, kind: 'RTT', du: '2026-10-13', au: '2026-10-13', debutDemi: 'apres_midi' }), /Demande de rtt \/ repos envoyée/);
  const enVigueur = heuresSurDemandes(await domain(), await sheet());
  assert.deepEqual(enVigueur.map(x => [x.day, x.absence.type, x.absence.statut, x.demi ?? null]), [['2026-10-13', 'RTT', 'demandee', null]]);
  await run(MEHDI, 'temps.submit', { empId: 2, week });
  await refused(KARIM, 'temps.validate', { empId: 2, week },
    /Demande d’absence en attente le mar\. 13 oct\. \(RTT\) : décidez-la avant de valider la feuille — pour l’accepter, retirez d’abord les heures saisies ce jour-là/);
  assert.equal((await sheet()).statut, 'soumise');
  // Demande refusée : la feuille se valide (4 h sur la demi-journée de CP).
  const rtt = (await domain()).ds.absences.find(a => a.empId === 2 && a.type === 'RTT' && a.du === '2026-10-13')!;
  await run(KARIM, 'absence.decider', { id: rtt.id, ok: false });
  await run(KARIM, 'temps.validate', { empId: 2, week });
  assert.equal((await sheet()).statut, 'validee');

  // Demande seule d'une demi-journée, 8 h saisies : à ramener à 4 h, pas à retirer.
  const autre = await fresh();
  await autre.run(MEHDI, 'temps.suggest', { empId: 2, week });
  await autre.conge(2, 'CP', '2026-10-12', '2026-10-12', { debutDemi: 'apres_midi' }, 'demandee');
  await autre.run(MEHDI, 'temps.submit', { empId: 2, week });
  await autre.refused(KARIM, 'temps.validate', { empId: 2, week },
    /Demande d’absence en attente le lun\. 12 oct\. \(CP\) : décidez-la avant de valider la feuille — pour l’accepter, ramenez d’abord les heures saisies ce jour-là à 4 h$/);
  const d = await autre.domain(), sh = d.ds.feuilles.find(f => f.empId === 2 && f.week === week)!;
  assert.match(demandesEnAttenteMessage(heuresSurDemandes(d, sh), false), /plus de 4 h saisies ce jour-là, à ramener à 4 h si elle est acceptée/);
  // 4 h ce jour-là : plus rien n'empêche la validation.
  await autre.run(KARIM, 'temps.reject', { empId: 2, week });
  await autre.run(MEHDI, 'temps.setCell', cell(0, 0, '4'));
  assert.deepEqual(heuresSurDemandes(await autre.domain(), (await autre.domain()).ds.feuilles.find(f => f.empId === 2 && f.week === week)!), []);
});

test('export des absences : jours décomptés au demi-jour et colonne des demi-journées', async () => {
  const { domain, conge } = await fresh();
  await conge(2, 'CP', '2026-11-09', '2026-11-13', { debutDemi: 'apres_midi', finDemi: 'matin' });
  await conge(2, 'RTT', '2026-11-16', '2026-11-16', { debutDemi: 'matin' });
  const d = await domain();
  const list = d.ds.absences.filter(a => a.empId === 2).map(a => ({ a, e: d.emp(2)! }));
  const rows = csvAbsences(d, list).rows;
  assert.deepEqual(rows.find(r => r[4] === '09/11/2026')!.slice(3), ['Congés payés', '09/11/2026', '13/11/2026', '3', 'jours ouvrés', 'Validée', 'après-midi le premier jour · matin le dernier jour']);
  assert.deepEqual(rows.find(r => r[4] === '16/11/2026')!.slice(6), ['0,5', 'jours travaillés', 'Validée', 'matin']);
});

test('clôture des CP : jours rendus au demi-jour après la clôture', async () => {
  const { run, domain } = await fresh();
  // CP du lundi 24 mai 2027 au vendredi 28 au matin (4,5 j), posés et validés par le manager ; période close le 15 juin.
  await le('2027-05-10', async () => await run(KARIM, 'absence.demander', { empId: 2, kind: 'CP', du: '2027-05-24', au: '2027-05-28', finDemi: 'matin' }));
  const solde = lignesClotureCp(await domain('2027-06-15'), 2026).find(l => l.e.id === 2)!.solde;
  await le('2027-06-15', async () => await run(ADMIN, 'conges.cloturer', { type: 'CP', periode: 2026, lignes: [{ empId: 2, decision: 'reporter', jours: solde }] }));
  const mai = (await domain('2027-06-20')).ds.absences.find(a => a.empId === 2 && a.du === '2027-05-24')!;
  const msg = await le('2027-06-20', async () => await run(ADMIN, 'absence.annuler', { id: mai.id }));
  assert.match(msg, /4,5 j de CP rendus : 4,5 j de la période close 2025-2026 reportés sur 2026-2027/);
});

test('migration lot5-conges-demi-journees : demi-journées hors de la règle ramenées à la journée entière', async () => {
  const db = new Db(':memory:');
  const ligne = async (type: string, du: string, au: string, debutDemi: string | null, finDemi: string | null) =>
    (await db.insert<{ id: number }>('absences', { empId: 2, type, du, au, statut: 'validee', keystone: true, debutDemi, finDemi })).id;
  const ok = await ligne('CP', '2026-11-09', '2026-11-13', 'apres_midi', 'matin');
  const unJour = await ligne('RTT', '2026-11-16', '2026-11-16', 'matin', null);
  const nature = await ligne('MARIAGE', '2026-11-17', '2026-11-18', 'apres_midi', null);
  const inconnue = await ligne('CP', '2026-11-19', '2026-11-20', 'soir', 'matin');
  const finSeule = await ligne('RECUP', '2026-11-23', '2026-11-23', null, 'matin');
  const inversees = await ligne('CP', '2026-11-24', '2026-11-25', 'matin', 'apres_midi');
  assert.deepEqual(await appliquerMigrations(db, [DEMI_JOURNEES]), ['lot5-conges-demi-journees']);
  const demi = async (id: number) => { const a = (await db.get<{ debutDemi: string | null; finDemi: string | null }>('absences', id))!; return [a.debutDemi, a.finDemi]; };
  assert.deepEqual(await Promise.all([ok, unJour, nature, inconnue, finSeule, inversees].map(demi)),
    [['apres_midi', 'matin'], ['matin', null], [null, null], [null, 'matin'], [null, null], [null, null]]);
  assert.deepEqual(await appliquerMigrations(db, [DEMI_JOURNEES]), [], 'une seule fois');
  assert.ok(MIGRATIONS.includes(DEMI_JOURNEES), 'dans la liste des migrations');
  // Base existante sans demi-journée : seulement notée faite.
  const existante = new Db(':memory:');
  await seedDemo(existante);
  assert.equal(await DEMI_JOURNEES.necessaire!(Object.assign(Object.create(existante) as typeof existante, { neuve: false })), false);
});
