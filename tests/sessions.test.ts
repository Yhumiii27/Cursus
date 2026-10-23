// Tests : sessions de formation — session passée et Go / No Go, clôture (présence, évaluation),
// cycle de vie (confirmer, modifier, annuler), contrôles de création, nombre d'inscrits calculé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull } = await import('../server/src/dataset.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { REGLES } = await import('../server/src/journal.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { etatInscription, inscritsDe, listeOrganisme } = await import('../shared/rules/sessions.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Responsable RH' };
const HUGO: User = { role: 'manager', empId: 16, nom: 'Hugo Lambert', intitule: 'Manager · Logistique' };
const CAMILLE: User = { role: 'collaborateur', empId: 1, nom: 'Camille Roux', intitule: 'Cariste' };

/** Exécute `fn` à une autre date du jour (CURSUS_TODAY), puis revient au 10 octobre 2026. */
async function le<T>(date: string, fn: () => T | Promise<T>): Promise<T> {
  const avant = process.env.CURSUS_TODAY;
  process.env.CURSUS_TODAY = date;
  try { return await fn(); } finally { process.env.CURSUS_TODAY = avant; }
}

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Chantier en France du 1er au 5 décembre exigeant le SST de Camille Roux (obtenu le 20/11/2024, expire le 20/11/2026),
  // inscrite au recyclage SST du 14 octobre (session 1).
  await db.insert('chantiers', { id: 'K-TEST', nom: 'Essai', client: 'Client', lieu: 'Lyon', pays: 'FR', debut: '2026-12-01', fin: '2026-12-05', chef: 'Sarah Cohen', habs: [], certs: ['sst'], ressources: [1] });
  const run = async (user: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload));
  const forbidden = async (user: User, name: string, payload: Record<string, unknown>) =>
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => e instanceof ActionError && e.status === 403, `${name} devait être refusé`);
  const domain = async () => new Domain(await loadFull(db, RH));
  const emp = async (id: number) => (await domain()).enrich(90, false).find(e => e.id === id)!;
  /** Certification en vigueur d'un collaborateur pour une formation. */
  const cert = async (empId: number, f: string) => (await emp(empId)).rawCerts.find(c => c.f === f)!;
  const session = async (id: number) => (await domain()).session(id)!;
  const plan = async (id: number) => (await domain()).ds.plan.find(l => l.id === id)!;
  const echCert = async (empId: number, f: string) => {
    const d = await domain();
    return d.echeances(d.enrich(90, false), 90).find(x => x.kind === 'cert' && x.emp.id === empId && x.label === d.fm(f).court)!;
  };
  const verdict = async () => {
    const d = await domain();
    return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-TEST')!.res.find(r => r.e.id === 1)!;
  };
  return { db, run, forbidden, domain, emp, cert, session, plan, echCert, verdict };
}

// — t109 : session passée, clôture —

test('t109 : avant la session, recyclage planifié ; après, « Session passée — à clôturer », plus de Go sous réserve', async () => {
  const { cert, echCert, domain, verdict } = await fresh();
  // Avant (10 octobre) : le recyclage SST du 14 octobre est planifié et vaut « Go sous réserve ».
  assert.equal((await cert(1, 'sst')).session?.id, 1);
  assert.equal((await echCert(1, 'sst')).planned, true);
  assert.equal((await verdict()).status, 'reserve');
  assert.ok((await verdict()).reasons.some(r => r.minimal === 'Recyclage planifié avant le démarrage'));
  // La session EPI du 9 octobre est déjà passée : Inès Dupont n'est plus « planifiée ».
  assert.equal((await cert(5, 'epi')).session, null);
  assert.equal((await cert(5, 'epi')).sessionPassee?.id, 6);

  // Après (20 octobre) : sessions des 9 et 14 octobre passées, non clôturées (reproduction du défaut).
  await le('2026-10-20', async () => {
    const d = await domain();
    for (const [empId, f, sessionId] of [[1, 'sst', 1], [5, 'epi', 6]] as const) {
      const c = await cert(empId, f);
      assert.equal(c.session, null, 'plus planifiée');
      assert.equal(c.sessionPassee?.id, sessionId);
      const x = await echCert(empId, f);
      assert.equal(x.planned, false);
      assert.equal(x.plannedLabel, 'Session passée — à clôturer');
      assert.deepEqual(x.action?.intent, { type: 'openCloture', sessionId });
    }
    assert.equal(d.sessionStatut((await d.session(1))!), 'Session passée — à clôturer');
    assert.ok(!d.upcoming().some(s => s.id === 1 || s.id === 6));
    assert.deepEqual(d.aCloturer().map(s => s.id), [6, 1]);
    // Inscriptions « planifiées » du tableau de bord : plus aucune sur une session passée.
    assert.ok(!d.enrich(90, false).flatMap(e => e.certs).some(c => c.session && c.session.date < d.ti));
    const v = await verdict();
    assert.equal(v.status, 'nogo', 'recyclage manqué : No Go, et non Go sous réserve');
    assert.ok(v.reasons.some(r => r.code === 'CERTIFICATION' && r.level === 'nogo'));
  });
});

test('clôture, présence seule : présents certifiés au jour de la session, absents à replanifier', async () => {
  const { db, run, cert, emp, echCert, session, domain } = await fresh();
  assert.deepEqual(inscritsDe(await domain(), await session(6)).map(i => [i.empId, i.parcours]),
    [[14, 'recyclage'], [11, 'recyclage'], [17, 'initiale'], [5, 'recyclage'], [20, 'initiale']]);
  assert.equal((await session(6)).inscrits, 5);
  const ancienne = (await cert(5, 'epi')).id;

  const msg = await run(RH, 'session.cloturer', {
    id: 6, note: 4, commentaire: 'Exercice d’évacuation apprécié',
    participants: [{ empId: 5, present: true }, { empId: 11, present: true }, { empId: 14, present: false }, { empId: 17, present: true }, { empId: 20, present: false }],
  });
  assert.match(String(msg), /EPI incendie du 9 oct\. 2026 clôturée — 3 certifications enregistrées · à replanifier : Antoine Leroy, Yanis Bouzid/);
  const s = await session(6);
  assert.equal(s.statut, 'Clôturée');
  assert.deepEqual(s.bilan, { le: '2026-10-10', par: 'Sandrine Vidal', note: 4, commentaire: 'Exercice d’évacuation apprécié', motif: null });
  assert.equal(s.inscrits, 5, 'résultats conservés');

  // Recyclage, présente : certification datée du jour de la session ; l'ancienne passe en historique.
  const ines = await emp(5);
  const epi = ines.rawCerts.find(c => c.f === 'epi')!;
  assert.deepEqual([epi.obtenue, epi.key, epi.session, epi.sessionPassee], ['2026-10-09', 'ok', null, null]);
  assert.ok(ines.anciennes.some(c => c.id === ancienne));
  // Recyclage, absent : de nouveau à planifier.
  assert.equal((await cert(14, 'epi')).sessionId, null);
  assert.equal((await echCert(14, 'epi')).action?.label, 'Planifier');
  // Formation initiale, présente : certification obtenue, inscription close.
  assert.equal((await cert(17, 'epi')).obtenue, '2026-10-09');
  assert.ok(!(await domain()).ds.inscriptions.some(i => i.empId === 17));
  // Formation initiale, absent : inscription à replanifier, puis réinscrit par son manager.
  const d = await domain();
  const insc = d.ds.inscriptions.find(i => i.empId === 20 && i.sessionId === 6)!;
  const etat = etatInscription(d, insc)!;
  assert.equal(etat.etat, 'a_planifier');
  assert.equal(etat.etat === 'a_planifier' && etat.motif, 'Absent à la session du 9 oct. 2026');
  await assert.rejects(async () => await run(HUGO, 'plan.inscrire', { empId: 20, inscriptionId: insc.id, sessionId: 6 }), /Session clôturée/);
  await run(HUGO, 'plan.inscrire', { empId: 20, inscriptionId: insc.id, sessionId: 12, conv: 'later' });
  assert.equal((await domain()).ds.inscriptions.find(i => i.id === insc.id)!.sessionId, 12);
  assert.equal((await session(12)).inscrits, 1);
  assert.equal((await session(6)).inscrits, 5, 'la session clôturée garde ses résultats');

  const parts = await db.all<{ empId: number; present: boolean; reussi: boolean | null; certId: number | null; parcours: string }>('participations');
  assert.deepEqual(parts.map(p => [p.empId, p.parcours, p.present, p.reussi, !!p.certId]).sort((a, b) => Number(a[0]) - Number(b[0])), [
    [5, 'recyclage', true, null, true], [11, 'recyclage', true, null, true], [14, 'recyclage', false, null, false],
    [17, 'initiale', true, null, true], [20, 'initiale', false, null, false],
  ]);
  await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 6, participants: [] }), /déjà clôturée/);
});

test('clôture, évaluation requise : échec et absence à replanifier, réussite certifiée, plan réalisé', async () => {
  const { db, run, cert, session, plan, domain, echCert, verdict } = await fresh();
  const tous = [
    { empId: 1, present: true, reussi: false }, { empId: 10, present: true, reussi: true }, { empId: 13, present: false },
    { empId: 7, present: true, reussi: true }, { empId: 19, present: true, reussi: false }, { empId: 14, present: true, reussi: true },
  ];
  await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 1, participants: tous }), /n’a pas encore eu lieu/);
  await le('2026-10-20', async () => {
    // Contrôles : rien n'est écrit tant que la clôture est incomplète.
    await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 1, participants: tous.map(({ reussi: _reussi, ...x }) => x) }), /Résultat de l’évaluation à renseigner : /);
    await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 1, participants: tous.slice(1) }), /Présence à renseigner : Camille Roux/);
    await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 1, participants: [...tous, { empId: 2, present: true, reussi: true }] }), /Mehdi Benali ne figure pas parmi les inscrits/);
    await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 1, participants: tous, note: 6 }), /note entière de 1 à 5/);
    assert.equal(await db.count('participations'), 0);
    assert.equal((await session(1)).statut, 'Confirmée');

    const msg = await run(RH, 'session.cloturer', { id: 1, participants: tous });
    assert.match(String(msg), /3 certifications enregistrées · à replanifier : .* · action du plan réalisée/);
    // Échec à l'évaluation : pas de certification, recyclage de nouveau à planifier, No Go maintenu.
    const sst = await cert(1, 'sst');
    assert.deepEqual([sst.obtenue, sst.sessionId, sst.convoc], ['2024-11-20', null, null]);
    assert.equal((await echCert(1, 'sst')).action?.label, 'Planifier');
    assert.equal((await verdict()).status, 'nogo');
    // Réussite : certification datée du 14 octobre ; absence : à planifier.
    assert.equal((await cert(10, 'sst')).obtenue, '2026-10-14');
    assert.equal((await cert(13, 'sst')).sessionId, null);
    assert.equal((await cert(7, 'sst')).obtenue, '2026-10-14');
    assert.equal((await cert(14, 'sst')).obtenue, '2026-10-14');
    const d = await domain();
    const clara = etatInscription(d, d.ds.inscriptions.find(i => i.empId === 19)!)!;
    assert.equal(clara.etat === 'a_planifier' && clara.motif, 'Non obtenue à la session du 14 oct. 2026');
    const p = (await db.all<{ empId: number; present: boolean; reussi: boolean | null; certId: number | null }>('participations')).find(x => x.empId === 1)!;
    assert.deepEqual([p.present, p.reussi, p.certId], [true, false, null]);
    // L'action du plan rattachée (SST Logistique, engagée) est réalisée.
    assert.equal((await plan(7)).statut, 'realise');
  });
});

test('Go / No Go après la session : réussite → Go ; recyclage manqué (absente) → No Go', async () => {
  const ok = await fresh();
  await le('2026-10-20', async () => {
    await ok.run(RH, 'session.cloturer', { id: 1, participants: inscritsDe(await ok.domain(), await ok.session(1)).map(i => ({ empId: i.empId, present: true, reussi: true })) });
    assert.equal((await ok.verdict()).status, 'go');
  });
  const ko = await fresh();
  await le('2026-10-20', async () => {
    await ko.run(RH, 'session.cloturer', { id: 1, participants: inscritsDe(await ko.domain(), await ko.session(1)).map(i => ({ empId: i.empId, present: i.empId !== 1, reussi: true })) });
    const v = await ko.verdict();
    assert.equal(v.status, 'nogo');
    assert.ok(!v.reasons.some(r => r.level === 'reserve'));
  });
});

test('un inscrit d’une session passée y reste jusqu’à la clôture : ni réinscription, ni demande acceptée', async () => {
  const { run, cert, session, domain, emp } = await fresh();
  // Formation initiale : Yanis Bouzid, inscrit à la session EPI du 9 octobre, passée et non clôturée.
  const insc = (await domain()).ds.inscriptions.find(i => i.empId === 20 && i.sessionId === 6)!;
  await assert.rejects(async () => await run(HUGO, 'plan.inscrire', { empId: 20, inscriptionId: insc.id, sessionId: 12 }),
    /Session du 9 oct\. 2026 passée : le service RH la clôture d’abord \(présence, résultat\)/);
  await run(HUGO, 'demande.formation', { empId: 20, f: 'epi', sessionId: 12, motif: 'Formation initiale à replanifier' });
  const demEpi = (await domain()).ds.demandesCollab.filter(r => r.empId === 20 && r.f === 'epi' && r.statut === 'attente').at(-1)!;
  await assert.rejects(async () => await run(RH, 'demande.accepter', { id: demEpi.id }), /Session du 9 oct\. 2026 passée : clôturez-la d’abord/);
  assert.equal((await domain()).ds.inscriptions.find(i => i.id === insc.id)!.sessionId, 6);
  assert.equal((await session(6)).inscrits, 5);

  await le('2026-10-20', async () => {
    // Recyclage : Camille Roux, inscrite à la session SST du 14 octobre.
    await assert.rejects(async () => await run(HUGO, 'plan.inscrire', { empId: 1, certId: (await cert(1, 'sst')).id, sessionId: 2 }), /Session du 14 oct\. 2026 passée : le service RH la clôture d’abord/);
    await assert.rejects(async () => await run(RH, 'plan.inscrire', { empId: 1, certId: (await cert(1, 'sst')).id, sessionId: 2 }), /Session du 14 oct\. 2026 passée : clôturez-la d’abord/);
    await run(CAMILLE, 'demande.formation', { f: 'sst', sessionId: 2, motif: 'Recyclage manqué' });
    const dem = (await domain()).ds.demandesCollab.filter(r => r.empId === 1 && r.f === 'sst' && r.statut === 'attente').at(-1)!;
    await assert.rejects(async () => await run(RH, 'demande.accepter', { id: dem.id }), /clôturez-la d’abord/);
    assert.deepEqual([(await cert(1, 'sst')).sessionId, (await session(1)).inscrits], [1, 6]);
    // Après la clôture (absente), la demande s'accepte.
    await run(RH, 'session.cloturer', { id: 1, participants: inscritsDe(await domain(), await session(1)).map(i => ({ empId: i.empId, present: i.empId !== 1, reussi: true })) });
    await run(RH, 'demande.accepter', { id: dem.id });
    assert.equal((await cert(1, 'sst')).session?.id, 2);
  });

  // Habilitation dont le prérequis attend la clôture : la fiche propose de clôturer, plus de replanifier.
  await le('2026-11-20', async () => {
    const lucas = await emp(4), hab = lucas.habs.find(h => h.h === 'ac489')!;
    assert.equal(lucas.rawCerts.find(c => c.f === 'caces489')!.sessionPassee?.id, 3);
    assert.deepEqual((await domain()).habAction(4, hab), { label: 'Clôturer la session', intent: { type: 'openCloture', sessionId: 3 } });
  });
});

test('une session clôturée ne déclenche la réalisation du plan que sans autre session ouverte', async () => {
  const { db, run, plan } = await fresh();
  // Session 2 rattachée à la même action (SST Logistique) : la clôture de la session 1 la laisse engagée.
  await db.update('sessions', 2, { planId: 7 });
  await le('2026-10-20', async () => {
    const msg = await run(RH, 'session.cloturer', { id: 1, participants: [1, 10, 13, 7, 19, 14].map(empId => ({ empId, present: false })) });
    assert.doesNotMatch(String(msg), /action du plan/);
    assert.equal((await plan(7)).statut, 'engage');
  });
});

// — t112 : cycle de vie —

test('t112 : confirmer avec la liste nominative pour l’organisme', async () => {
  const { run, forbidden, session, domain } = await fresh();
  await forbidden(HUGO, 'session.confirmer', { id: 2 });
  await forbidden(CAMILLE, 'session.confirmer', { id: 2 });
  const l = listeOrganisme(await domain(), await session(2));
  assert.equal(l.fichier, 'inscrits-sst-2026-11-18.csv');
  assert.deepEqual(l.head, ['Nom', 'Poste', 'Parcours', 'Certification à renouveler (obtenue le)']);
  assert.deepEqual(l.rows, [['Nadia Kaci', 'Responsable grands comptes', 'Formation initiale', '']]);
  assert.match(String(await run(RH, 'session.confirmer', { id: 2 })), /SST du 18 nov\. 2026 confirmée — liste de 1 inscrit à transmettre à Croix-Rouge française/);
  assert.equal((await session(2)).statut, 'Confirmée');
  await assert.rejects(async () => await run(RH, 'session.confirmer', { id: 2 }), /déjà confirmée/);
  // Session « à confirmer » dont la date est passée : à clôturer ou à annuler, plus à confirmer.
  await le('2026-11-10', async () => await assert.rejects(async () => await run(RH, 'session.confirmer', { id: 7 }), /Session passée : clôturez-la, ou annulez-la/));
  // Recyclage : la date de la certification à renouveler figure dans la liste.
  assert.deepEqual(listeOrganisme(await domain(), await session(1)).rows.find(r => r[0] === 'Camille Roux'), ['Camille Roux', 'Cariste', 'Recyclage', '20 nov. 2024']);
});

test('t112 : modifier date, lieu et places (places ≥ inscrits, convocations à renvoyer)', async () => {
  const { run, forbidden, cert, session, domain } = await fresh();
  await run(RH, 'plan.inscrire', { empId: 1, certId: (await cert(1, 'sst')).id, sessionId: 2, conv: 'now' });
  assert.equal((await session(2)).inscrits, 2);
  await forbidden(HUGO, 'session.modifier', { id: 2, lieu: 'Ailleurs' });
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 2, places: 1 }), /inférieur au nombre d’inscrits \(2\)/);
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 2, places: 2.5 }), /nombre entier/);
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 2, date: '2026-10-01' }), /postérieure à aujourd’hui/);
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 2, lieu: '  ' }), /Lieu requis/);
  assert.equal(await run(RH, 'session.modifier', { id: 2, places: 12 }), 'Aucune modification');

  const msg = await run(RH, 'session.modifier', { id: 2, date: '2026-11-19', lieu: 'Site de Lyon — salle C', places: 10 });
  assert.match(String(msg), /modifiée — date : 19 nov\. 2026 · lieu : Site de Lyon — salle C · 10 places · 2 convocations à renvoyer/);
  const s = await session(2);
  assert.deepEqual([s.date, s.lieu, s.places, s.inscrits], ['2026-11-19', 'Site de Lyon — salle C', 10, 2]);
  assert.equal((await cert(1, 'sst')).convoc, 'later');
  assert.equal((await domain()).ds.inscriptions.find(i => i.empId === 9)!.convoc, 'later');
  // Les places seules ne touchent pas aux convocations.
  await run(RH, 'plan.inscrire', { empId: 10, certId: (await cert(10, 'sst')).id, sessionId: 2, conv: 'now' });
  assert.doesNotMatch(String(await run(RH, 'session.modifier', { id: 2, places: 4 })), /convocation/);
  assert.equal((await cert(10, 'sst')).convoc, 'now');
  // Une date passée reste admise si elle ne change pas (lieu corrigé après coup, sans convocation à renvoyer).
  await le('2026-11-25', async () => assert.match(String(await run(RH, 'session.modifier', { id: 2, lieu: 'Salle B' })), /lieu : Salle B$/));
  assert.equal((await cert(10, 'sst')).convoc, 'now');
  // Session confirmée : une nouvelle date est à faire confirmer par l'organisme ; un autre lieu, non.
  assert.equal((await session(4)).statut, 'Confirmée');
  assert.match(String(await run(RH, 'session.modifier', { id: 4, lieu: 'AFTRAL Corbas' })), /lieu : AFTRAL Corbas$/);
  assert.equal((await session(4)).statut, 'Confirmée');
  assert.match(String(await run(RH, 'session.modifier', { id: 4, date: '2026-11-26' })), /date : 26 nov\. 2026 · nouvelle date à faire confirmer par AFTRAL$/);
  assert.equal((await session(4)).statut, 'À confirmer');
  await run(RH, 'session.confirmer', { id: 4 });
  assert.equal((await session(4)).statut, 'Confirmée');
});

test('t112 : une session passée, à clôturer, se redate au jour où elle a eu lieu', async () => {
  const { run, cert, session, domain } = await fresh();
  // Session à venir : une date passée reste refusée.
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 1, date: '2026-10-08' }), /postérieure à aujourd’hui/);
  // La session EPI prévue le 9 octobre a eu lieu le 8 : la clôture datera les certifications de ce jour.
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 6, date: '2026-02-30' }), /Date de la session requise/);
  assert.equal(await run(RH, 'session.modifier', { id: 6, date: '2026-10-08' }), 'Session EPI incendie du 9 oct. 2026 modifiée — date : 8 oct. 2026',
    'session passée : ni convocation à renvoyer, ni confirmation à demander');
  assert.deepEqual([(await session(6)).date, (await session(6)).statut, (await cert(14, 'epi')).convoc], ['2026-10-08', 'Confirmée', 'now']);
  await run(RH, 'session.cloturer', { id: 6, participants: [5, 11, 14, 17, 20].map(empId => ({ empId, present: true })) });
  assert.deepEqual([(await cert(5, 'epi')).obtenue, (await cert(17, 'epi')).obtenue], ['2026-10-08', '2026-10-08']);

  await le('2026-10-20', async () => {
    // Recyclage saisi au 14 octobre, jour prévu de la session SST : Camille Roux y reste, sans décision à prendre.
    await run(RH, 'cert.ajouter', { empId: 1, f: 'sst', date: '2026-10-14' });
    assert.equal(inscritsDe(await domain(), await session(1)).find(i => i.empId === 1)!.dejaObtenue?.obtenue, '2026-10-14');
    // La session a eu lieu le 15 : ce recyclage ne vient pas d'elle, la place est libérée (même règle que cert.ajouter).
    assert.match(String(await run(RH, 'session.modifier', { id: 1, date: '2026-10-15' })),
      /date : 15 oct\. 2026 · recyclage déjà enregistré avant cette date, place libérée : Camille Roux$/);
    assert.ok(!inscritsDe(await domain(), await session(1)).some(i => i.empId === 1));
    assert.equal((await session(1)).inscrits, 5);
    // Reportée en réalité : une date à venir reste possible, avec convocations à renvoyer et confirmation à obtenir.
    const msg = await run(RH, 'session.modifier', { id: 1, date: '2026-10-28' });
    assert.match(String(msg), /date : 28 oct\. 2026 · 5 convocations à renvoyer · nouvelle date à faire confirmer par Croix-Rouge française$/);
    assert.equal((await session(1)).statut, 'À confirmer');
    assert.equal((await cert(10, 'sst')).session?.id, 1, 'de nouveau planifiée');
  });
});

test('t112 : annuler libère inscriptions et certifications, qui redeviennent à planifier', async () => {
  const { run, forbidden, cert, session, plan, domain, echCert, verdict } = await fresh();
  await forbidden(HUGO, 'session.annuler', { id: 1 });
  assert.equal((await verdict()).status, 'reserve');
  const msg = await run(RH, 'session.annuler', { id: 1, motif: 'Formateur indisponible' });
  assert.match(String(msg), /SST du 14 oct\. 2026 annulée — 6 inscrits à replanifier · action du plan de nouveau prévue/);
  const s = await session(1);
  assert.deepEqual([s.statut, s.inscrits, s.bilan?.motif, s.bilan?.par], ['Annulée', 0, 'Formateur indisponible', 'Sandrine Vidal']);
  // Recyclages : certifications détachées, de nouveau à planifier ; Go / No Go sans réserve de recyclage.
  for (const id of [1, 10, 13]) assert.equal((await cert(id, 'sst')).sessionId, null);
  assert.equal((await echCert(1, 'sst')).action?.label, 'Planifier');
  assert.equal((await verdict()).status, 'nogo');
  // Formations initiales : à replanifier.
  const d = await domain();
  for (const empId of [7, 14, 19]) {
    const e = etatInscription(d, d.ds.inscriptions.find(i => i.empId === empId && i.sessionId === 1)!)!;
    assert.equal(e.etat === 'a_planifier' && e.motif, 'Session du 14 oct. 2026 annulée');
  }
  assert.equal((await plan(7)).statut, 'prevu');
  assert.ok(!d.upcoming().some(x => x.id === 1));
  // Plus rien ne s'y rattache.
  await assert.rejects(async () => await run(RH, 'plan.inscrire', { empId: 1, certId: (await cert(1, 'sst')).id, sessionId: 1 }), /Session annulée/);
  await assert.rejects(async () => await run(RH, 'session.modifier', { id: 1, lieu: 'Salle C' }), /annulée : elle ne peut plus être modifiée/);
  await assert.rejects(async () => await run(RH, 'session.annuler', { id: 1 }), /annulée/);
  await le('2026-10-20', async () => await assert.rejects(async () => await run(RH, 'session.cloturer', { id: 1, participants: [] }), /rien à clôturer/));
  // Une session clôturée ne s'annule plus.
  await run(RH, 'session.cloturer', { id: 6, participants: [5, 11, 14, 17, 20].map(empId => ({ empId, present: true })) });
  await assert.rejects(async () => await run(RH, 'session.annuler', { id: 6 }), /clôturée : elle ne peut plus être modifiée/);
});

// — t081 : contrôles à la création —

test('t081 : création contrôlée — action du plan prévue de la même formation, date future, places entières', async () => {
  const { run, forbidden, plan, session, domain } = await fresh();
  const base = { f: 'fco', date: '2026-12-15', lieu: 'AFTRAL Saint-Priest', places: 8 };
  await forbidden(HUGO, 'session.creer', base);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, date: '' }), /Date de la session requise/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, date: '2026-02-30' }), /Date de la session requise/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, date: '2026-10-01' }), /postérieure à aujourd’hui/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, date: '2026-10-10' }), /postérieure à aujourd’hui/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, places: 2.5 }), /nombre entier, au moins 1/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, places: 0 }), /nombre entier, au moins 1/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, places: '' }), /nombre entier, au moins 1/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, lieu: ' ' }), /Lieu requis/);
  const d = await domain();
  const id = (f: string | null, statut: string) => d.ds.plan.find(l => l.f === f && l.statut === statut)!.id;
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, planId: 999 }), /Action du plan introuvable/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, planId: id('caces486', 'prevu') }), /autre formation/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, f: 'sst', planId: id('sst', 'realise') }), /déjà réalisée/);
  await assert.rejects(async () => await run(RH, 'session.creer', { ...base, f: 'sst', planId: id('sst', 'engage') }), /déjà engagée/);
  assert.equal((await plan(id('sst', 'realise'))).statut, 'realise', 'une action réalisée ne repasse pas « engagée »');
  assert.equal((await domain()).ds.sessions.length, 13, 'aucune session créée');

  const fco = id('fco', 'prevu');
  const out = await run(RH, 'session.creer', { ...base, places: '8', planId: fco }) as { message: string; result: { id: number } };
  assert.match(out.message, /Session FCO créée pour le 15 déc\. 2026 — 8 places · action du plan engagée/);
  const s = await session(out.result.id);
  assert.deepEqual([s.statut, s.places, s.inscrits, s.planId], ['À confirmer', 8, 0, fco]);
  assert.equal((await plan(fco)).statut, 'engage');
  // Sans action du plan.
  const libre = await run(RH, 'session.creer', { ...base, f: 'aipr', places: 6 }) as { result: { id: number } };
  assert.equal((await session(libre.result.id)).planId, null);
});

// — t093 : nombre d'inscrits calculé —

test('t093 : nombre d’inscrits juste après inscription, certification, annulation et clôture', async () => {
  const { db, run, cert, session, domain } = await fresh();
  const n = async (id: number) => (await session(id)).inscrits;
  // Inscription en formation initiale (demande acceptée) puis certification saisie : la place est libérée.
  const dem = (await domain()).ds.demandesCollab.find(r => r.empId === 13 && r.f === 'caces489')!;
  await run(RH, 'demande.accepter', { id: dem.id });
  assert.equal(await n(4), 1);
  await run(RH, 'cert.ajouter', { empId: 13, f: 'caces489', date: '2026-10-05' });
  assert.equal(await n(4), 0, 'inscription close par la certification : place libérée');
  // Inscription au recyclage et changement de session.
  await run(HUGO, 'plan.inscrire', { empId: 1, certId: (await cert(1, 'sst')).id, sessionId: 2 });
  assert.deepEqual([await n(1), await n(2)], [5, 2]);
  // Recyclage saisi avant la session : la place est libérée.
  assert.match(String(await run(RH, 'cert.ajouter', { empId: 10, f: 'sst', date: '2026-10-05' })), /inscription à la session du 14 oct\. 2026 annulée/);
  assert.equal(await n(1), 4);
  // Recyclage saisi à la date d'une session passée : elle l'a produit, l'inscrite y reste sans décision à prendre.
  await run(RH, 'cert.ajouter', { empId: 5, f: 'epi', date: '2026-10-09' });
  assert.equal(await n(6), 5);
  const deja = inscritsDe(await domain(), await session(6)).find(i => i.empId === 5)!;
  assert.equal(deja.dejaObtenue?.obtenue, '2026-10-09');
  await run(RH, 'session.cloturer', { id: 6, participants: [11, 14, 17, 20].map(empId => ({ empId, present: true })) });
  assert.equal(await n(6), 5, 'clôture : un résultat par inscrit');
  assert.equal((await cert(5, 'epi')).obtenue, '2026-10-09', 'pas de seconde certification');
  assert.equal((await db.all<{ empId: number; certId: number }>('participations')).find(p => p.empId === 5)!.certId, (await cert(5, 'epi')).id);
  // Annulation : plus aucun inscrit.
  await run(RH, 'session.annuler', { id: 2 });
  assert.equal(await n(2), 0);
  // Session pleine : inscription refusée, place libérée par un départ.
  await run(RH, 'session.modifier', { id: 3, places: 2 });
  await assert.rejects(async () => await run(RH, 'plan.inscrire', { empId: 10, certId: (await cert(10, 'caces489')).id, sessionId: 3 }), /complète/);
});

test('droits : le manager inscrit son équipe, sans clôture ni annulation ; résultats limités au périmètre', async () => {
  const { db, run, forbidden, cert } = await fresh();
  for (const u of [HUGO, CAMILLE]) {
    await forbidden(u, 'session.cloturer', { id: 6, participants: [] });
    await forbidden(u, 'session.annuler', { id: 2 });
    await forbidden(u, 'session.modifier', { id: 2, lieu: 'Ailleurs' });
    await forbidden(u, 'session.creer', { f: 'fco', date: '2026-12-15', lieu: 'AFTRAL', places: 8 });
  }
  await run(HUGO, 'plan.inscrire', { empId: 1, certId: (await cert(1, 'sst')).id, sessionId: 2 });
  const commentaire = 'Antoine Leroy absent : arrêt maladie';
  await run(RH, 'session.cloturer', { id: 6, commentaire, note: 3, participants: [5, 11, 14, 17, 20].map(empId => ({ empId, present: empId !== 20 })) });
  await run(RH, 'session.annuler', { id: 7, motif: 'Formateur malade' });
  const h = await buildSnapshot(db, HUGO);
  assert.deepEqual(h.participations.map(p => p.empId), [20], 'Logistique : Yanis Bouzid seulement');
  assert.equal(h.sessions.find(s => s.id === 6)!.inscrits, 5, 'nombre calculé sur toutes les données');
  assert.deepEqual((await buildSnapshot(db, CAMILLE)).participations, []);
  // Bilan (évaluation à chaud, motif d'annulation : textes libres) réservé au service RH ; seule la date de clôture ou
  // d'annulation reste (lot 7, t121 : départ de la demande d'avis à chaud), sans auteur.
  for (const u of [HUGO, CAMILLE]) {
    const ds = await buildSnapshot(db, u);
    assert.ok(ds.sessions.every(s => !s.bilan || (s.bilan.par === '' && s.bilan.note == null && s.bilan.commentaire == null && s.bilan.motif == null)), `bilan transmis à ${u.nom}`);
    assert.deepEqual(ds.sessions.filter(s => s.id === 6 || s.id === 7).map(s => s.statut), ['Clôturée', 'Annulée']);
    assert.doesNotMatch(JSON.stringify(ds), /arrêt maladie|Formateur malade/);
  }
  const rh = (await buildSnapshot(db, RH)).sessions;
  assert.deepEqual([rh.find(s => s.id === 6)!.bilan?.commentaire, rh.find(s => s.id === 7)!.bilan?.motif], [commentaire, 'Formateur malade']);
  // Toutes ces actions sont tracées dans le journal (route POST /api/actions/:nom), sans condition.
  for (const a of ['session.creer', 'session.confirmer', 'session.modifier', 'session.annuler', 'session.cloturer']) {
    assert.ok(ACTIONS[a] && REGLES[a] && !REGLES[a].tracer, a);
  }
});

test('migration : formations validées sur la présence, ancien compteur d’inscrits ignoré', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-'));
  const file = join(dir, 'ancienne.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE formations (id TEXT PRIMARY KEY, nom TEXT, court TEXT, type TEXT, validite INTEGER, duree TEXT, organisme TEXT, cout REAL)`);
    old.exec(`INSERT INTO formations VALUES ('sst', 'Sauveteur secouriste du travail', 'SST', 'Réglementaire', 24, '7 h', 'Croix-Rouge française', 180)`);
    old.exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, formation TEXT, date TEXT, lieu TEXT, places INTEGER, inscrits INTEGER, statut TEXT)`);
    old.exec(`INSERT INTO sessions (formation, date, lieu, places, inscrits, statut) VALUES ('sst', '2026-11-18', 'Salle B', 12, 9, 'À confirmer')`);
    old.exec(`CREATE TABLE certifications (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_id INTEGER, f TEXT, obtenue TEXT, session_id INTEGER, convoc TEXT)`);
    old.exec(`INSERT INTO certifications (emp_id, f, obtenue, session_id, convoc) VALUES (1, 'sst', '2024-11-20', 1, 'now')`);
    old.close();
    // Démarrage : schéma (colonnes et tables ajoutées) puis migrations, comme server/src/index.ts.
    const db = new Db(file);
    await migrate(db);
    const ds = await loadFull(db, RH);
    assert.equal(ds.referentiels.formations[0].validation, 'presence');
    const [s] = ds.sessions;
    assert.deepEqual([s.inscrits, s.planId, s.bilan, s.statut], [1, null, null, 'À confirmer'], 'compteur recalculé : 1 inscrit nominatif, pas 9');
    assert.deepEqual(ds.participations, []);
    await migrate(db);
    assert.equal((await loadFull(db, RH)).referentiels.formations[0].validation, 'presence', 'migration rejouable');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration : sessions passées d’une ancienne base — places des certifications remplacées, historique sans décision clôturé', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-'));
  const file = join(dir, 'ancienne.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE formations (id TEXT PRIMARY KEY, nom TEXT, court TEXT, type TEXT, validite INTEGER, duree TEXT, organisme TEXT, cout REAL)`);
    old.exec(`INSERT INTO formations VALUES ('epi', 'Équipier de première intervention incendie', 'EPI incendie', 'Réglementaire', 12, '4 h', 'Interne · HSE', 40)`);
    old.exec(`CREATE TABLE employes (id INTEGER PRIMARY KEY, nom TEXT, equipe TEXT, poste TEXT)`);
    old.exec(`INSERT INTO employes VALUES (5, 'Inès Dupont', 'Production', 'Animatrice HSE'), (11, 'Thomas Girard', 'Qualité', 'Auditeur'), (14, 'Antoine Leroy', 'Administration', 'Chargé RH')`);
    old.exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, formation TEXT, date TEXT, lieu TEXT, places INTEGER, inscrits INTEGER, statut TEXT)`);
    old.exec(`INSERT INTO sessions (id, formation, date, lieu, places, inscrits, statut) VALUES
      (1, 'epi', '2026-10-09', 'Atelier', 15, 2, 'Confirmée'), (2, 'epi', '2026-09-15', 'Atelier', 15, 0, 'Confirmée'),
      (3, 'epi', '2026-06-10', 'Atelier', 15, 1, 'Confirmée'), (4, 'epi', '2026-12-10', 'Atelier', 15, 0, 'À confirmer')`);
    old.exec(`CREATE TABLE certifications (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_id INTEGER, f TEXT, obtenue TEXT, session_id INTEGER, convoc TEXT)`);
    // Inès Dupont, inscrite à la session du 9 octobre, a renouvelé ailleurs le 1er octobre (saisi par l'ancienne
    // version, qui ne libérait pas la place d'une session passée). Thomas Girard n'a aucun résultat.
    // Antoine Leroy, inscrit à la session du 10 juin, a son recyclage saisi à cette date.
    old.exec(`INSERT INTO certifications (id, emp_id, f, obtenue, session_id, convoc) VALUES
      (1, 5, 'epi', '2025-10-01', 1, 'now'), (2, 5, 'epi', '2026-10-01', NULL, NULL), (3, 11, 'epi', '2025-09-01', 1, 'now'),
      (4, 14, 'epi', '2025-06-01', 3, 'now'), (5, 14, 'epi', '2026-06-10', NULL, NULL)`);
    old.close();
    const db = new Db(file);
    await migrate(db);
    const d = new Domain(await loadFull(db, RH));
    // Place d'Inès libérée : pas de « déjà renouvelée » ni de présence supposée à la clôture.
    assert.equal((await db.get<{ sessionId: number | null }>('certifications', 1))!.sessionId, null);
    assert.deepEqual(inscritsDe(d, (await d.session(1))!).map(i => [i.nom, !!i.dejaObtenue]), [['Thomas Girard', false]]);
    // Historique sans décision à prendre : session vide, et session dont l'inscrit a déjà son recyclage.
    assert.deepEqual(d.aCloturer().map(s => s.id), [1], 'reste à clôturer : la session dont un inscrit n’a pas de résultat');
    for (const id of [2, 3]) {
      const s = (await d.session(id))!;
      assert.equal(s.statut, 'Clôturée');
      assert.deepEqual([s.bilan?.par, s.bilan?.le], ['Cursus', '2026-10-10']);
    }
    assert.deepEqual(d.ds.participations.map(p => [p.sessionId, p.empId, p.present, p.certId]), [[3, 14, true, 5]]);
    assert.deepEqual([(await d.session(2))!.inscrits, (await d.session(3))!.inscrits, (await d.session(4))!.statut], [0, 1, 'À confirmer']);
    // Une seule fois : une session passée plus tard sans inscrit attend la clôture du service RH.
    await db.insert('sessions', { formation: 'epi', date: '2026-10-01', lieu: 'Atelier', places: 10, statut: 'Confirmée', planId: null, bilan: null });
    await migrate(db);
    assert.deepEqual(new Domain(await loadFull(db, RH)).aCloturer().map(s => s.id), [5, 1]);
    assert.equal(await db.count('participations'), 1);
    // La clôture de la session du 9 octobre n'enregistre que Thomas Girard.
    await db.tx(async () => await ACTIONS['session.cloturer'](makeCtx(db, RH, await loadFull(db, RH)), { id: 1, participants: [{ empId: 11, present: true }] }));
    assert.deepEqual((await db.all<{ sessionId: number; empId: number }>('participations')).filter(p => p.sessionId === 1).map(p => p.empId), [11]);
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
