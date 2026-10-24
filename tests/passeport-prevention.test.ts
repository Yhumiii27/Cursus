// Lot 7, chantier B, étape 2 : Passeport de prévention (t066, shared/rules/passeport-prevention.ts). Formations
// santé-sécurité marquées au catalogue (migration d'amorçage, Référentiels → Formations), lignes à déclarer
// (certifications et formations suivies non annulées des formations marquées, sans double compte), suivi « déclarée le »
// (table declarations_passeport) pour ne pas déclarer deux fois, export CSV au gabarit réglable produit et tracé par le
// serveur (service RH et référent HSE), mention « format à confirmer », aucun NIR ; instantanés filtrés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';

const express = (await import('express')).default;
const { nouvelleBase, PG, SQLITE_SEUL } = await import('./base.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { seedDemo, FORMATIONS } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { openSession } = await import('../server/src/auth.ts');
const { routesPasseportPrevention } = await import('../server/src/passeport-prevention.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { REFERENCES } = await import('../server/src/integrite.ts');
const { TRAITEMENTS } = await import('../server/src/conservation.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { PASSEPORT_PREVENTION } = await import('../server/src/migrations/lot7-prevention.ts');
const { Domain } = await import('../shared/domain.ts');
const { REGLAGES, ReglageInvalide } = await import('../shared/reglages.ts');
const { JOURNAL_LABEL, familleAction, CHAMP_LABEL } = await import('../shared/journal.ts');
const { controlerFormation } = await import('../shared/rules/referentiels.ts');
const P = await import('../shared/rules/passeport-prevention.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, statut = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === statut && motif.test(e.message), `${name} : ${motif}`);
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[]; message: string }>('journal')).filter(j => j.action === action);
  const domain = async () => new Domain(await loadFull(db, RH));
  const RH = await user(null, 'rh');
  return { db, user, run, refuse, journal, domain, compteDe, RH };
}
/** Certification de Mehdi Benali (salarié 2) dans une formation du catalogue. */
const certDe = async (db: Awaited<ReturnType<typeof nouvelleBase>>, empId: number, f: string) =>
  ((await db.one('SELECT id FROM certifications WHERE emp_id = ? AND f = ? ORDER BY id', [empId, f])) as { id: number }).id;

// — Règles pures —

test('marquage proposé : formations santé-sécurité du catalogue type, ni FCO ni RGPD ; la démonstration les porte', () => {
  const marquees = FORMATIONS.filter(f => (f as { passeportPrevention?: boolean }).passeportPrevention).map(f => f.id);
  assert.deepEqual(marquees, ['sst', 'elec', 'atex', 'caces489', 'caces486', 'epi', 'aipr', 'hauteur', 'prap']);
  assert.deepEqual(FORMATIONS.filter(f => P.passeportPropose(f)).map(f => f.id), marquees, 'même liste que l’aide du dialogue');
  assert.ok(P.passeportPropose({ id: 'x1', court: 'Habilitation électrique', nom: 'Recyclage' }));
  assert.ok(P.passeportPropose({ id: 'x2', court: 'Sauveteur', nom: 'Sauveteur secouriste' }));
  assert.ok(!P.passeportPropose({ id: 'excel', court: 'Excel', nom: 'Tableur avancé' }));
  assert.ok(P.marqueePasseport({ passeportPrevention: true }) && !P.marqueePasseport(undefined) && !P.marqueePasseport({}));
});

test('lignes à déclarer : certifications et formations suivies des formations marquées, période, sans double compte ni annulées', async () => {
  const { db, domain } = await fresh();
  const d0 = await domain();
  const toutes = P.lignesPasseport(d0, { du: '2000-01-01', au: '2026-10-10' });
  assert.ok(toutes.length > 40);
  assert.ok(toutes.every(l => d0.fm(l.formation)?.passeportPrevention), 'formations marquées seulement');
  assert.ok(!toutes.some(l => ['fco', 'rgpd'].includes(l.formation)));
  // Année en cours : dernier jour dans la période, triées par date.
  const an = P.lignesPasseport(d0, P.periodeParDefaut('2026-10-10'));
  assert.ok(an.length && an.every(l => l.au >= '2026-01-01' && l.au <= '2026-10-10'));
  assert.deepEqual(an.map(l => l.au), an.map(l => l.au).sort());
  const cleSst = `cert:${await certDe(db, 17, 'sst')}`;
  const sst = an.find(l => l.cle === cleSst)!;
  assert.deepEqual([sst.origine, sst.empId, sst.du, sst.au, sst.duree, sst.resultat, sst.organisme, sst.declareLe], ['certification', 17, '2026-04-01', '2026-04-01', 7, 'Acquise (évaluation réussie)', 'Croix-Rouge française', null]);
  assert.equal(an.find(l => l.formation === 'epi')!.resultat, 'Acquise (présence)');
  // Intérimaire (Léa Girard) : signalée, la déclaration revenant en principe à l'agence.
  assert.ok(an.some(l => l.empId === 15 && l.interim));
  // Certification produite par une session clôturée (participation qui la porte, fin de session = obtention) : dates et
  // heures de la session.
  const certSst = await certDe(db, 2, 'sst');
  await db.insert('sessions', { formation: 'sst', date: '2026-09-28', fin: '2026-09-29', jours: ['2026-09-28', '2026-09-29'], horaires: [], lieu: 'Salle', places: 8, statut: 'Clôturée', planId: null, bilan: null });
  const sid = ((await db.one('SELECT MAX(id) AS id FROM sessions')) as { id: number }).id;
  await db.update('certifications', certSst, { obtenue: '2026-09-29', sessionId: null });
  await db.insert('participations', { sessionId: sid, empId: 2, parcours: 'recyclage', present: true, reussi: true, certId: certSst });
  // Formations suivies : une marquée (comptée), une représentée par la certification (pas de double compte), une hors
  // catalogue (non déclarée), une annulée (non déclarée), une de durée saisie.
  const suivie = async (x: Record<string, unknown>) => (await db.insert<{ id: number }>('formationsSuivies', {
    empId: 2, libelle: null, duree: null, organisme: null, obligatoire: true, origine: 'saisie', planActionId: null, demandeId: null, le: '2026-10-01', auteur: 'RH', auteurId: null, ...x,
  })).id;
  const atex = await suivie({ f: 'atex', du: '2026-06-02', au: '2026-06-03', duree: 10.5, organisme: 'Bureau Veritas' });
  const doublon = await suivie({ f: 'sst', du: '2026-09-28', au: '2026-09-29' });
  await suivie({ f: null, libelle: 'Gestes et postures', du: '2026-05-05', au: '2026-05-05' });
  const annulee = await suivie({ f: 'aipr', du: '2026-03-03', au: '2026-03-03', annuleLe: '2026-03-10', annulePar: 'RH', annuleMotif: 'Erreur' });
  const prap = await suivie({ f: 'prap', du: '2026-02-02', au: '2026-02-03' });
  const d = await domain();
  const l = P.lignesPasseport(d, { du: '2026-01-01', au: '2026-10-10' }).filter(x => x.empId === 2);
  const parCle = new Map(l.map(x => [x.cle, x]));
  const s = parCle.get(`cert:${certSst}`)!;
  assert.deepEqual([s.du, s.au, s.duree], ['2026-09-28', '2026-09-29', 7], 'session sans horaires : durée du catalogue');
  assert.deepEqual([parCle.get(`suivie:${atex}`)!.duree, parCle.get(`suivie:${atex}`)!.organisme, parCle.get(`suivie:${atex}`)!.resultat], [10.5, 'Bureau Veritas', 'Formation suivie']);
  assert.equal(parCle.get(`suivie:${prap}`)!.organisme, 'INRS', 'organisme du catalogue à défaut');
  assert.ok(!parCle.has(`suivie:${doublon}`), 'représentée par la certification');
  assert.ok(!parCle.has(`suivie:${annulee}`));
  assert.equal(l.filter(x => x.origine === 'suivie').length, 2, 'hors catalogue jamais déclarée');
  // Certification annulée, dossier anonymisé : plus de ligne.
  await db.update('certifications', certSst, { annuleLe: '2026-10-05', annulePar: 'RH', annuleMotif: 'Erreur' });
  await db.update('employes', 17, { anonymiseLe: '2026-10-09' });
  const d2 = await domain();
  const l2 = P.lignesPasseport(d2, { du: '2026-01-01', au: '2026-10-10' });
  assert.ok(!l2.some(x => x.cle === `cert:${certSst}`) && !l2.some(x => x.empId === 17));
  // Formation démarquée : ses lignes disparaissent.
  await db.update('formations', 'prap', { passeportPrevention: false });
  assert.ok(!P.lignesPasseport(await domain(), { du: '2026-01-01', au: '2026-10-10' }).some(x => x.formation === 'prap'));
});

test('certification de session : datée de son obtention ; dates et heures d’une session seulement si elle en est issue', async () => {
  const { db, user, run, domain, RH } = await fresh();
  const HSE = await user(23, 'rh');
  const { inscritsDe } = await import('../shared/rules/sessions.ts');
  const lignesDe = async (empId: number, du: string, au: string, declarees = false) => P.lignesPasseport(await domain(), { du, au, declarees }).filter(l => l.empId === empId && l.formation === 'epi');
  // Certification d’Inès Dupont (salariée 5) obtenue le 05/11/2025, inscrite au recyclage du 09/10/2026 (session 6,
  // confirmée, pas clôturée) : `sessionId` désigne ce recyclage, il ne la date pas.
  const ancienne = await certDe(db, 5, 'epi');
  assert.equal(((await db.get<{ sessionId: number }>('certifications', ancienne))!).sessionId, 6);
  assert.deepEqual((await lignesDe(5, '2026-01-01', '2026-12-31')).map(l => l.cle), [], 'rien en 2026 tant que la session n’est pas clôturée');
  const avant = (await lignesDe(5, '2025-01-01', '2025-12-31'))[0];
  assert.deepEqual([avant.cle, avant.du, avant.au, avant.duree], [`cert:${ancienne}`, '2025-11-05', '2025-11-05', 4]);
  // Inscription à un recyclage à venir (plan.inscrire) : la certification garde sa date, rien n'est daté de la session.
  const manon = await certDe(db, 21, 'epi');
  const dateManon = ((await db.get<{ obtenue: string }>('certifications', manon))!).obtenue;
  await run(HSE, 'plan.inscrire', { empId: 21, certId: manon, sessionId: 12, convoc: 'later' });
  assert.equal(((await db.get<{ sessionId: number }>('certifications', manon))!).sessionId, 12);
  const l21 = P.lignesPasseport(await domain(), { du: '2025-01-01', au: '2026-12-31' }).filter(l => l.cle === `cert:${manon}`);
  assert.deepEqual(l21.map(l => [l.du, l.au]), [[dateManon, dateManon]]);
  assert.ok(!P.lignesPasseport(await domain(), { du: '2026-10-11', au: '2026-12-31' }).length, 'aucune ligne pour une session à venir');
  // L'ancienne certification, déclarée (2025), puis la session clôturée, tous présents : une seule ligne en 2026, la
  // nouvelle certification, datée de la session ; l'ancienne reste en 2025 avec sa date.
  await run(RH, 'passeport.declarer', { cles: [`cert:${ancienne}`], le: '2026-10-10' });
  const s6 = (await domain()).session(6)!;
  const participants = inscritsDe(await domain(), s6).map(i => ({ empId: i.empId, present: true, reussi: true }));
  await run(HSE, 'session.cloturer', { id: 6, participants });
  const apres = await lignesDe(5, '2026-01-01', '2026-12-31', true);
  const nouvelle = ((await db.one('SELECT MAX(id) AS id FROM certifications WHERE emp_id = 5 AND f = ?', ['epi'])) as { id: number }).id;
  assert.deepEqual(apres.map(l => [l.cle, l.du, l.au, l.duree, l.declareLe]), [[`cert:${nouvelle}`, '2026-10-09', '2026-10-09', 4, null]]);
  assert.deepEqual((await lignesDe(5, '2025-01-01', '2025-12-31', true)).map(l => [l.cle, l.au, l.declareLe]), [[`cert:${ancienne}`, '2025-11-05', '2026-10-10']]);
  // Session de plusieurs jours avec horaires (CACES R489, 21-23/10/2026) : du, au et heures de la session.
  await db.update('sessions', 3, { horaires: [{ debut: '08:30', fin: '12:30', pause: 0 }] });
  const ti = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = '2026-10-23';
  try {
    const s3 = (await domain()).session(3)!;
    await run(HSE, 'session.cloturer', { id: 3, participants: inscritsDe(await domain(), s3).map(i => ({ empId: i.empId, present: true, reussi: true })) });
    const caces = (await db.all<{ id: number; f: string; obtenue: string; empId: number }>('certifications')).filter(c => c.f === 'caces489' && c.obtenue === '2026-10-23');
    assert.ok(caces.length > 0);
    const lignes = P.lignesPasseport(await domain(), { du: '2026-10-01', au: '2026-10-31' }).filter(l => l.formation === 'caces489');
    assert.deepEqual(new Set(lignes.map(l => `${l.du}|${l.au}|${l.duree}`)), new Set(['2026-10-21|2026-10-23|12']));
    assert.equal(lignes.length, caces.length);
  } finally {
    process.env.CURSUS_TODAY = ti;
  }
});

test('contrôles : période, clés, jour de déclaration ; prénom et nom ; export au gabarit réglable, sans NIR, mention du format', async () => {
  assert.deepEqual(P.controlerPeriode('2026-01-01', '2026-10-10'), { periode: { du: '2026-01-01', au: '2026-10-10' }, erreur: null });
  assert.match(P.controlerPeriode('2026-01-01', undefined).erreur!, /deux dates/);
  assert.match(P.controlerPeriode('2026-02-30', '2026-03-01').erreur!, /deux dates/);
  assert.match(P.controlerPeriode('2026-05-01', '2026-04-01').erreur!, /fin précède/);
  assert.match(P.controlerPeriode('2000-01-01', '2026-01-01').erreur!, /10 ans/);
  assert.deepEqual(P.clesValides(['cert:3', 'suivie:4', 'cert:3']), { certs: [3], suivies: [4] });
  for (const v of [[], 'cert:3', ['cert:0'], ['cert:x'], ['autre:3'], [3], ['cert:1', 'cert:2']]) assert.equal(P.clesValides(v, v.length === 2 ? 1 : 2000), null, JSON.stringify(v));
  assert.equal(P.erreurDateDeclaration('2026-10-10', '2026-10-10'), null);
  assert.match(P.erreurDateDeclaration('2026-10-11', '2026-10-10')!, /à venir/);
  assert.match(P.erreurDateDeclaration('', '2026-10-10')!, /Indiquez/);
  assert.deepEqual(P.prenomNom('Mehdi Benali'), { prenom: 'Mehdi', nom: 'Benali' });
  assert.deepEqual(P.prenomNom(' Jean  de la Fontaine '), { prenom: 'Jean', nom: 'de la Fontaine' });
  assert.deepEqual(P.prenomNom('Cher'), { prenom: '', nom: 'Cher' });
  assert.equal(P.cleLigne({ certId: 4 }), 'cert:4');
  assert.equal(P.cleLigne({ suivieId: 7 }), 'suivie:7');
  assert.equal(P.plageLigne({ du: '2026-03-02', au: '2026-03-02' }), P.plageLigne({ du: '2026-03-02', au: '2026-03-02' }));
  assert.match(P.plageLigne({ du: '2026-03-02', au: '2026-03-03' }), / – /);
  // Gabarit par défaut : les dix colonnes demandées ; NIR et code facultatifs, décochés.
  assert.deepEqual(REGLAGES.passeportColonnes.defaut, ['nom', 'prenom', 'naissance', 'matricule', 'intitule', 'organisme', 'du', 'au', 'duree', 'resultat']);
  const ctl = REGLAGES.passeportColonnes.controle!;
  assert.deepEqual(ctl(['resultat', 'nom', 'inconnue', 'nom'], []), ['nom', 'resultat'], 'ordre du gabarit, inconnues écartées');
  assert.throws(() => ctl([], ['nom']), ReglageInvalide);
  assert.throws(() => ctl('nom', ['nom']), ReglageInvalide);
  assert.ok(CHAMP_LABEL.passeportColonnes && CHAMP_LABEL.passeportPrevention);
  // Export : identité de la fiche complète (date de naissance), dates JJ/MM/AAAA, heures à virgule, mention sur chaque ligne.
  const { db, domain } = await fresh();
  await db.update('employes', 2, { naissanceLe: '1990-04-12', matriculePaie: 'S0002' });
  const d = await domain();
  const lignes = P.lignesPasseport(d, { du: '2025-01-01', au: '2025-12-31' }).filter(l => l.empId === 2);
  const x = P.exportPasseport(d, lignes, REGLAGES.passeportColonnes.defaut, { du: '2025-01-01', au: '2025-12-31' });
  assert.equal(x.fichier, 'passeport-prevention-2025-01-01-2025-12-31.csv');
  assert.deepEqual(x.head, ['Nom', 'Prénom', 'Date de naissance', 'Matricule de paie', 'Intitulé de la formation', 'Organisme de formation', 'Du', 'Au', 'Durée (heures)', 'Résultat', 'Mention']);
  assert.deepEqual(x.rows.find(r => r[4] === 'Sauveteur secouriste du travail (SST)'),
    ['Benali', 'Mehdi', '12/04/1990', 'S0002', 'Sauveteur secouriste du travail (SST)', 'Croix-Rouge française', '03/05/2025', '03/05/2025', '7', 'Acquise (évaluation réussie)', P.MENTION_PASSEPORT]);
  const y = P.exportPasseport(d, [{ ...lignes[0], duree: 3.5 }, { ...lignes[0], duree: null, empId: 9999 }], ['code', 'nir', 'duree'], { du: '2025-01-01', au: '2025-12-31' });
  assert.deepEqual(y.head, ['NIR', 'Code de la formation', 'Durée (heures)', 'Mention'], 'ordre du gabarit, pas celui du réglage');
  assert.deepEqual(y.rows.map(r => r.slice(0, 3)), [['', lignes[0].formation, '3,5'], ['', lignes[0].formation, '']], 'NIR toujours vide ; durée inconnue vide');
  const z = P.exportPasseport(d, [{ ...lignes[0], empId: 9999 }], ['nom', 'prenom', 'naissance', 'matricule'], { du: '2025-01-01', au: '2025-12-31' });
  assert.deepEqual(z.rows[0].slice(0, 4), ['', '', '', ''], 'fiche introuvable : identité vide');
  // Rappel d'une ligne déjà déclarée (correction, annulation).
  assert.equal(P.rappelDeclaration({}, 'cert:1'), '');
  assert.match(P.rappelDeclaration({ declarationsPasseport: [{ id: 1, empId: 2, certId: 1, suivieId: null, declareLe: '2026-10-01', le: '2026-10-01', auteur: null, auteurId: null }] }, 'cert:1'), /déjà déclarée au Passeport de prévention le 1 oct/);
});

// — Catalogue —

test('case « Passeport de prévention » : contrôlée avec la formation, inchangée si absente, tracée avant et après', async () => {
  const liste = FORMATIONS as unknown as Dataset['referentiels']['formations'];
  const base = { nom: 'Gestes et postures', court: 'Gestes', type: 'Recommandée', validite: 24, validation: 'presence', code: 'gestes' };
  assert.equal(controlerFormation(base, liste).formation!.passeportPrevention, false, 'décochée à la création');
  assert.equal(controlerFormation({ ...base, passeportPrevention: 'true' }, liste).formation!.passeportPrevention, true);
  const sst = { ...FORMATIONS[0] } as Record<string, unknown>;
  assert.equal(controlerFormation({ ...sst }, liste, 'sst').formation!.passeportPrevention, true, 'absente de la saisie : inchangée');
  assert.equal(controlerFormation({ ...sst, passeportPrevention: false }, liste, 'sst').formation!.passeportPrevention, false);
  const { db, run, user, journal } = await fresh();
  const HSE = await user(23, 'rh');
  await run(HSE, 'referentiel.formation.enregistrer', { ...sst, id: 'sst', passeportPrevention: false });
  assert.equal((await db.get<{ passeportPrevention: boolean }>('formations', 'sst'))!.passeportPrevention, false);
  const j = (await journal('referentiel.formation.enregistrer')).at(-1)!;
  assert.deepEqual([j.payload.code, j.payload.avant, j.payload.apres], ['sst', { passeportPrevention: true }, { passeportPrevention: false }]);
  // Référentiel type chargé sur un catalogue vide : la case suit (aucun NIR, aucune donnée personnelle).
  assert.ok((await db.all<{ id: string; passeportPrevention: boolean }>('formations')).filter(f => f.passeportPrevention).length === 8);
});

// — Actions, journal, export, instantanés —

test('déclarées : service RH et référent HSE, jamais deux fois, jour contrôlé, tracées ; marque retirée ; plus proposées', async () => {
  const { db, user, run, refuse, journal, domain, RH } = await fresh();
  const HSE = await user(23, 'rh');
  const sst = await certDe(db, 17, 'sst'), epi = await certDe(db, 21, 'epi');
  const cles = [`cert:${sst}`, `cert:${epi}`];
  await refuse(HSE, 'passeport.declarer', { cles, le: '2026-10-11' }, /à venir/);
  await refuse(HSE, 'passeport.declarer', { cles, le: '2026-04-10' }, /précéder le dernier jour de la formation \(14 avr/);
  await refuse(HSE, 'passeport.declarer', { cles: ['cert:999999'], le: '2026-10-09' }, /plus à déclarer/);
  await refuse(HSE, 'passeport.declarer', { cles: `cert:${sst}`, le: '2026-10-09' }, /invalides/);
  await refuse(await user(11, 'rh'), 'passeport.declarer', { cles, le: '2026-10-09' }, /réservée/, 403);
  await refuse(await user(7, 'rh'), 'passeport.declarer', { cles, le: '2026-10-09' }, /réservée/, 403);
  assert.match((await run(HSE, 'passeport.declarer', { cles, le: '2026-10-09' }))!, /2 lignes marquées déclarées le 9 oct.* \(2 salariés\)/);
  const rows = await db.all<{ empId: number; certId: number; suivieId: number | null; declareLe: string; auteur: string; auteurId: number }>('declarationsPasseport');
  assert.deepEqual(rows.map(r => [r.empId, r.certId, r.suivieId, r.declareLe, r.auteur, r.auteurId]), [[17, sst, null, '2026-10-09', 'Sarah Cohen', 23], [21, epi, null, '2026-10-09', 'Sarah Cohen', 23]]);
  const j = (await journal('passeport.declarer')).at(-1)!;
  assert.deepEqual([j.payload.le, j.payload.lignes, [...j.salaries].sort((a, b) => a - b)], ['2026-10-09', 2, [17, 21]]);
  assert.ok(!/Croix|SST|Ndiaye|Faure/.test(JSON.stringify(j.payload)), 'ni intitulé ni nom au journal');
  assert.ok(JOURNAL_LABEL['passeport.declarer'] && familleAction('passeport.declarer')?.id === 'formations');
  // Plus proposées ; affichées avec leur date quand on demande aussi les déclarées.
  const d = await domain();
  assert.ok(!P.lignesPasseport(d, { du: '2026-01-01', au: '2026-10-10' }).some(l => cles.includes(l.cle)));
  assert.deepEqual(P.lignesPasseport(d, { du: '2026-01-01', au: '2026-10-10', declarees: true }).filter(l => cles.includes(l.cle)).map(l => l.declareLe), ['2026-10-09', '2026-10-09']);
  await refuse(RH, 'passeport.declarer', { cles: [`cert:${sst}`], le: '2026-10-10' }, /déjà déclarée \(le 9 oct/);
  // Correction et annulation d'une ligne déclarée : rappel de la corriger sur la plateforme.
  assert.match((await run(RH, 'cert.modifier', { id: sst, date: '2026-04-02', motif: 'Date erronée' }))!, /déjà déclarée au Passeport de prévention le 9 oct.*à corriger aussi sur la plateforme/);
  // Marque retirée : de nouveau proposée.
  await refuse(HSE, 'passeport.retirer', { cle: 'cert:abc' }, /invalide/);
  await refuse(HSE, 'passeport.retirer', { cle: 'cert:999999' }, /pas marquée/, 404);
  assert.match((await run(HSE, 'passeport.retirer', { cle: `cert:${epi}` }))!, /marque du 9 oct.* retirée \(Manon Faure\)/);
  assert.deepEqual((await journal('passeport.retirer')).at(-1)!.payload.cle, `cert:${epi}`);
  assert.deepEqual((await journal('passeport.retirer')).at(-1)!.salaries, [21]);
  assert.ok(P.lignesPasseport(await domain(), { du: '2026-01-01', au: '2026-10-10' }).some(l => l.cle === `cert:${epi}`));
  // Formation suivie déclarée, puis corrigée et supprimée : rappel dans les deux messages.
  const fs = (await db.insert<{ id: number }>('formationsSuivies', {
    empId: 2, f: 'atex', libelle: null, du: '2026-06-02', au: '2026-06-03', duree: 7, organisme: null, obligatoire: true, origine: 'saisie',
    planActionId: null, demandeId: null, le: '2026-06-04', auteur: 'RH', auteurId: null,
  })).id;
  await run(RH, 'passeport.declarer', { cles: [`suivie:${fs}`], le: '2026-06-03' });
  assert.match((await run(RH, 'formationSuivie.modifier', { id: fs, duree: 8, motif: 'Durée erronée' }))!, /corrigée · déjà déclarée au Passeport de prévention le 3 juin/);
  assert.match((await run(RH, 'formationSuivie.annuler', { id: fs, motif: 'Doublon' }))!, /supprimée \(saisie erronée\) · déjà déclarée/);
  assert.match((await run(RH, 'cert.annuler', { id: sst, motif: 'Erreur de saisie' }))!, /déjà déclarée au Passeport de prévention/);
});

test('export : service RH et référent HSE seulement, gabarit des Paramètres, date de naissance lue par le serveur, tracé', async () => {
  const { db, run, journal, compteDe, RH } = await fresh();
  await db.update('employes', 17, { naissanceLe: '1988-02-29', matriculePaie: 'S0017' });
  await run(RH, 'parametres.maj', { passeportColonnes: ['nom', 'prenom', 'naissance', 'matricule', 'nir', 'intitule', 'au'] });
  const app = express();
  app.get('/essai/session/:compte', async (req, res) => { await openSession(db, res, { compteId: Number(req.params.compte), role: 'rh', methode: 'demo' }); res.end(); });
  app.use(routesPasseportPrevention(db));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const session = async (compte: number) => (await fetch(`${base}/essai/session/${compte}`)).headers.get('set-cookie')!.split(';')[0];
    const get = (q: string, cookie?: string) => fetch(`${base}/api/formations/passeport-prevention?${q}`, { headers: cookie ? { cookie } : {} });
    assert.equal((await get('du=2026-01-01&au=2026-10-10')).status, 401);
    for (const empId of [11, 7]) assert.equal((await get('du=2026-01-01&au=2026-10-10', await session(await compteDe(empId)))).status, 403, `profil ${empId}`);
    assert.equal((await journal('acces.refuse')).at(-1)!.message, 'Export du Passeport de prévention — réservé au service RH et au référent HSE');
    const hse = await session(await compteDe(23));
    assert.equal((await get('du=2026-13-01&au=2026-10-10', hse)).status, 400);
    const r = await get('du=2026-01-01&au=2026-10-10', hse);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="passeport-prevention-2026-01-01-2026-10-10.csv"');
    const csv = await r.text();
    assert.ok(csv.startsWith('Nom;Prénom;Date de naissance;Matricule de paie;NIR;Intitulé de la formation;Au;Mention\r\n'));
    assert.ok(csv.includes(`Ndiaye;Fatou;29/02/1988;S0017;;Sauveteur secouriste du travail (SST);01/04/2026;${P.MENTION_PASSEPORT}`), 'date de naissance que l’instantané du référent HSE ne porte pas');
    const n = csv.trim().split('\r\n').length - 1;
    const t = (await journal('passeport.exporter')).at(-1)!;
    assert.deepEqual([t.payload.du, t.payload.au, t.payload.vue, t.payload.lignes], ['2026-01-01', '2026-10-10', 'a-declarer', n]);
    assert.ok(t.salaries.includes(17));
    assert.match(t.message, /^Passeport de prévention : lignes à déclarer du 1 janv\. 2026 au 10 oct\. 2026 exportées — \d+ lignes \(\d+ lignes? d’intérimaires? écartées? : déclarées par l’agence\)$/);
    // Clés des lignes exportées en en-tête (marque « déclarées » limitée à l'export), nombre de lignes, intérimaires écartés.
    const clesExportees = r.headers.get('X-Passeport-Lignes')!.split(',');
    assert.equal(clesExportees.length, n);
    assert.equal(r.headers.get('X-Passeport-Nombre'), String(n));
    assert.ok(Number(r.headers.get('X-Passeport-Interimaires')) > 0 && t.payload.interimaires === Number(r.headers.get('X-Passeport-Interimaires')));
    const dRh = new Domain(await loadFull(db, RH));
    const aDeclarer = P.lignesPasseport(dRh, { du: '2026-01-01', au: '2026-10-10' });
    assert.deepEqual(clesExportees, aDeclarer.filter(l => !l.interim).map(l => l.cle), 'lignes à déclarer, sans les intérimaires');
    assert.ok(!t.salaries.includes(15) && !csv.includes('Girard'), 'intérimaire (Léa Girard) écartée de l’export');
    assert.equal((await get('du=2026-01-01&au=2026-10-10&vue=toutes', hse)).status, 400);
    assert.ok(!/Ndiaye|1988|SST/.test(JSON.stringify(t)), 'ni nom ni date de naissance au journal');
    assert.ok(JOURNAL_LABEL['passeport.exporter'] && familleAction('passeport.exporter')?.id === 'formations');
    // Déclarées : hors de l'export des lignes à déclarer ; la vue « Déjà déclarées » n'exporte qu'elles.
    await run(RH, 'passeport.declarer', { cles: [`cert:${await certDe(db, 17, 'sst')}`], le: '2026-10-01' });
    assert.ok(!(await (await get('du=2026-01-01&au=2026-10-10', hse)).text()).includes('Ndiaye;Fatou'));
    const avec = await get('du=2026-01-01&au=2026-10-10&vue=declarees', await session(await compteDe(14)));
    const lignesDeclarees = (await avec.text()).trim().split('\r\n').slice(1);
    assert.equal(lignesDeclarees.length, 1, 'les seules lignes déclarées');
    assert.ok(lignesDeclarees[0].startsWith('Ndiaye;Fatou'));
    assert.equal(avec.headers.get('X-Passeport-Lignes'), null, 'rien à marquer depuis cet export');
    assert.equal(avec.headers.get('X-Passeport-Nombre'), '1');
    const td = (await journal('passeport.exporter')).at(-1)!;
    assert.deepEqual([td.payload.vue, td.payload.lignes], ['declarees', 1]);
    assert.match(td.message, /lignes déjà déclarées du .* exportées — 1 ligne$/);
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('instantanés : déclarations au service RH, sans auteur au référent HSE et à la lecture seule ; rien ailleurs ; copie des données', async () => {
  const { db, user, run, RH } = await fresh();
  const cle = `cert:${await certDe(db, 2, 'sst')}`;
  await run(RH, 'passeport.declarer', { cles: [cle], le: '2026-10-01' });
  const rh = await buildSnapshot(db, RH);
  assert.equal(rh.declarationsPasseport!.length, 1);
  assert.equal(rh.declarationsPasseport![0].auteur, 'Sandrine Vidal');
  assert.ok(rh.referentiels.formations.find(f => f.id === 'sst')!.passeportPrevention);
  for (const [qui, u] of [['référent HSE', await user(23, 'rh')], ['lecture seule', await user(11, 'rh')]] as const) {
    const ds = await buildSnapshot(db, u);
    assert.deepEqual(ds.declarationsPasseport!.map(x => [x.declareLe, x.auteur, x.auteurId]), [['2026-10-01', null, null]], qui);
    assert.ok(!ds.employes.some(e => e.naissanceLe), `${qui} : jamais la date de naissance dans l’instantané`);
  }
  for (const [qui, u] of [['paie', await user(7, 'rh')], ['manager', await user(12, 'manager')], ['collaborateur', await user(2, 'collaborateur')]] as const) {
    assert.deepEqual((await buildSnapshot(db, u)).declarationsPasseport, [], qui);
  }
  // Copie des données du salarié : la déclaration, sans l'auteur pour l'intéressé.
  const pour = await donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' });
  const sect = (pour!.sections as Record<string, Record<string, unknown>[]>)['Formations déclarées au Passeport de prévention'];
  assert.deepEqual(sect.map(x => [x.declareLe, 'auteur' in x]), [['2026-10-01', false]]);
  // Intégrité et conservation : références déclarées, chacune traitée.
  for (const c of ['emp_id', 'auteur_id', 'cert_id', 'suivie_id']) assert.ok(REFERENCES.some(r => r.table === 'declarations_passeport' && r.colonne === c), c);
  assert.deepEqual([TRAITEMENTS['declarations_passeport.emp_id'], TRAITEMENTS['declarations_passeport.auteur_id']], [{ mode: 'gardee' }, { mode: 'auteur' }]);
});

// — Migration —

test('migration lot7-prevention-passeport : formations santé-sécurité cochées sur une base existante, tracée, une seule fois', { skip: PG && SQLITE_SEUL }, async () => {
  const db = new SqliteDb(':memory:');
  assert.ok(MIGRATIONS.includes(PASSEPORT_PREVENTION), 'migration inscrite dans la liste (après celles du lot 6)');
  assert.ok((await appliquerMigrations(db)).includes('lot7-prevention-passeport'), 'base neuve : exécutée, sans effet (catalogue vide)');
  assert.equal(await db.count('journal'), 0);
  // Base existante : catalogue saisi à la main avant cette version, case vide (NULL).
  for (const f of FORMATIONS) await db.insert('formations', { ...f, id: `${f.id}-x`, passeportPrevention: null });
  await db.insert('formations', { id: 'chimie', nom: 'Risque chimique — sensibilisation', court: 'Chimie', type: 'Interne', validite: 12, validation: 'presence' });
  await db.exec('DROP INDEX declarations_passeport_emp');
  assert.equal(await PASSEPORT_PREVENTION.necessaire!(Object.assign(db, { neuve: false })), true);
  assert.match(String(await PASSEPORT_PREVENTION.executer(db)), /^9 formations santé-sécurité marquées pour le Passeport de prévention$/);
  const cochees = (await db.all<{ id: string; passeportPrevention: boolean }>('formations')).filter(f => f.passeportPrevention).map(f => f.id).sort();
  assert.deepEqual(cochees, ['aipr-x', 'atex-x', 'caces486-x', 'caces489-x', 'elec-x', 'epi-x', 'hauteur-x', 'prap-x', 'sst-x']);
  const j = (await db.all<{ action: string; payload: { formations: string[] }; message: string }>('journal')).at(-1)!;
  assert.equal(j.action, 'migration.passeportPrevention');
  assert.equal(j.payload.formations.length, 9);
  assert.ok(JOURNAL_LABEL['migration.passeportPrevention'] && familleAction('migration.passeportPrevention')?.id === 'formations');
  // Déjà dans l'état visé : rien à faire ; une formation décochée ensuite par le service RH le reste.
  assert.equal(await PASSEPORT_PREVENTION.necessaire!(db), false);
  await db.update('formations', 'sst-x', { passeportPrevention: false });
  assert.equal(await PASSEPORT_PREVENTION.necessaire!(Object.assign(db, { neuve: false })), true, 'une décochée serait recochée : la migration ne repasse jamais (nom enregistré)');
  assert.deepEqual(await appliquerMigrations(db), [], 'une seule fois');
  assert.equal((await db.get<{ passeportPrevention: boolean }>('formations', 'sst-x'))!.passeportPrevention, false);
  // Sans formation à cocher, l'index seul.
  const vide = new SqliteDb(':memory:');
  assert.equal(await PASSEPORT_PREVENTION.executer(vide), 'index declarations_passeport_emp');
});
