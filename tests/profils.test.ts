// Profils restreints de l'espace RH (référent HSE / formation, gestionnaire de paie, lecture seule) : droits,
// écrans, données envoyées au navigateur (rien de ce que le profil ne doit pas voir, aucune donnée de santé
// détaillée), journal ; un membre du RH ne décide pas de ses propres absences, feuilles de temps ou entretiens.
// Les actions autorisées ou refusées à chaque profil sont dans la matrice des droits (tests/droits.test.ts).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { espacesDuCompte } = await import('../server/src/comptes.ts');
const { Domain } = await import('../shared/domain.ts');
const { droitsRh, PROFILS_RH, vuesDe } = await import('../shared/constants.ts');
const { absenceVueManager, natureMedicale } = await import('../shared/rules/absences.ts');
const { PROFIL_VIDE } = await import('../shared/rules/profil.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof buildSnapshot>>;
type Compte = Parameters<typeof espacesDuCompte>[1];

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cursus-profils-'));
const procs: ChildProcess[] = [];
after(() => {
  procs.forEach(p => p.kill());
  rmSync(dir, { recursive: true, force: true });
});

// Comptes de démonstration : Sandrine Vidal (administratrice RH, externe), Antoine Leroy (14, gestionnaire RH),
// Sarah Cohen (23, référente HSE), Aïcha Diallo (7, paie), Élodie Bernard (11, lecture seule).
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compte = async (empId: number | null) => (await db.get<Compte>('comptes', ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number }).id))!;
  const user = async (empId: number | null, role: User['role']) => {
    const u = await currentUser(db, { compteId: (await compte(empId)).id, role, methode: 'demo' });
    assert.ok(u, `compte ${empId} dans l’espace ${role}`);
    return u;
  };
  const run = async (u: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), payload));
  const msg = (r: unknown) => typeof r === 'string' ? r : (r as { message: string }).message;
  return {
    db, compte, user, run, msg,
    ADMIN: await user(null, 'rh'), ANTOINE: await user(14, 'rh'), HSE: await user(23, 'rh'), PAIE: await user(7, 'rh'), LECTURE: await user(11, 'rh'),
  };
}
const refus = (re: RegExp) => (e: unknown) => e instanceof ActionError && e.status === 403 && re.test(e.message);

/**
 * Aucune donnée de santé détaillée : ni visite, ni vaccination, ni nature médicale d'absence ; ni pièce de voyage, sauf
 * pour la lecture seule (`echeances`) : date d'expiration du passeport sans son numéro, et visas, comme le manager.
 */
function sansSante(ds: Dataset, echeances = false) {
  for (const e of ds.employes) {
    assert.equal(e.visite, null, `${e.nom} : date de visite transmise`);
    assert.deepEqual(e.vaccins, [], `${e.nom} : vaccinations transmises`);
    if (echeances) assert.equal(e.passeport?.numero, undefined, `${e.nom} : numéro de passeport transmis`);
    else {
      assert.equal(e.passeport, null);
      assert.deepEqual(e.visas, []);
    }
  }
  assert.ok(!ds.absences.some(a => natureMedicale(a.type)), 'nature médicale transmise');
  assert.ok(!ds.demandesCollab.some(r => r.type === 'document' || r.declaration), 'document déclaré transmis');
}

test('profils : droits, écrans et espaces ouverts par chaque profil', async () => {
  const { db, compte, HSE, PAIE, LECTURE, ADMIN } = await fresh();
  assert.deepEqual(droitsRh(HSE), ['formations']);
  assert.deepEqual(droitsRh(PAIE), ['paie']);
  assert.deepEqual(droitsRh(LECTURE), ['consultation']);
  assert.deepEqual([...droitsRh(ADMIN)].sort(), ['admin', 'consultation', 'formations', 'paie', 'rh']);
  assert.deepEqual(droitsRh({ role: 'manager', profilRh: 'rh_admin' }), [], 'aucun droit RH hors de l’espace RH');
  assert.deepEqual(PROFILS_RH.rh_gestionnaire.droits.includes('paie'), false, 'transmission à la paie : pas le gestionnaire RH');
  // Écrans : la page d'accueil est le premier ; ni temps ni absences pour le référent HSE, ni formations pour la paie.
  assert.deepEqual(vuesDe('rh', 'paie'), ['temps', 'absences']);
  assert.ok(!vuesDe('rh', 'referent_hse').some(v => ['temps', 'absences', 'entretiens', 'parametres', 'budget', 'voyages'].includes(v)));
  assert.ok(!vuesDe('rh', 'lecture_seule').includes('voyages'), 'dossiers de voyage (vaccinations) réservés au service RH');
  assert.equal(vuesDe('rh', 'rh_gestionnaire'), vuesDe('rh'));
  // Espaces : un salarié au profil restreint ouvre l'espace RH, et ses espaces habituels.
  assert.deepEqual(await espacesDuCompte(db, await compte(23)), ['rh', 'manager', 'collaborateur'], 'Sarah Cohen encadre Qualité & HSE');
  assert.deepEqual(await espacesDuCompte(db, await compte(7)), ['rh', 'collaborateur']);
  assert.deepEqual(await espacesDuCompte(db, await compte(11)), ['rh', 'collaborateur']);
  assert.match(HSE.intitule, /Référent HSE/);
  assert.equal(HSE.empId, null, 'dans l’espace RH, la personne agit pour le service');
  assert.equal(HSE.salarieId, 23);
});

test('référent HSE : formations et habilitations, aptitude à jour ou à renouveler, verdicts Go / No Go exacts, rien d’autre', async () => {
  const { db, HSE, ADMIN, run } = await fresh();
  const full = await buildSnapshot(db, ADMIN), ds = await buildSnapshot(db, HSE);
  sansSante(ds);
  assert.equal(ds.employes.length, full.employes.length, 'tout le site');
  assert.ok(ds.employes.every(e => typeof e.aptitude?.ok === 'boolean'), 'aptitude : verdict seul');
  assert.ok(ds.employes.every(e => e.repriseDate === null), 'reprise après absence longue : non transmise');
  assert.deepEqual(ds.employes.map(e => e.certs.length), full.employes.map(e => e.certs.length));
  assert.deepEqual(ds.employes.map(e => e.habs.length), full.employes.map(e => e.habs.length));
  assert.equal(ds.sessions.length, full.sessions.length);
  assert.deepEqual([ds.inscriptions.length, ds.participations.length], [full.inscriptions.length, full.participations.length]);
  assert.ok(ds.demandesCollab.length > 0 && ds.demandesCollab.every(r => r.type !== 'document'));
  // Ni temps, ni paie, ni entretiens, ni plan et budget, ni missions ; des absences, celles des ressources des chantiers
  // seulement (elles comptent au Go / No Go), sans nature médicale.
  for (const k of ['feuilles', 'cet', 'reports', 'soldesReprise', 'entretiens', 'plan', 'missions', 'taches', 'demandesVisite'] as const) assert.deepEqual(ds[k], [], k);
  const ressources = new Set(full.referentiels.chantiers.filter(c => c.statut !== 'archive').flatMap(c => c.ressources));
  assert.ok(ds.absences.length > 0 && ds.absences.length < full.absences.length && ds.absences.every(a => ressources.has(a.empId)));
  assert.deepEqual(ds.absences, full.absences.filter(a => ressources.has(a.empId)).map(absenceVueManager));
  assert.deepEqual([ds.budgets, ds.lotsPaie, ds.formatFichierPaie], [{}, [], null]);
  // Verdict exact, comme pour le manager : aptitude non valide pour une visite échue ou jamais saisie, sans date.
  const d = new Domain(ds), dRh = new Domain(full);
  assert.match(dRh.medInfo(dRh.emp(24)!).text, /non renseignée/, 'Bastien Morel : aucune visite enregistrée');
  assert.match(dRh.medInfo(dRh.emp(6)!).text, /^Aptitude échue/, 'Thomas Garnier : visite échue');
  for (const id of [24, 6]) assert.equal(d.medInfo(d.emp(id)!).text, 'Aptitude médicale non valide — visite à programmer par le service RH');
  assert.ok(dRh.medInfo(dRh.emp(2)!).ok);
  assert.equal(d.medInfo(d.emp(2)!).text, 'Aptitude médicale valide');
  assert.ok(ds.employes.every(e => !/\d|[Vv]isite du/.test(d.medInfo(e).text)), 'ni date de visite, ni échéance');
  assert.ok(ds.employes.every(e => e.visite === null && e.avis === null && !e.restrictions.length), 'avis daté et restrictions : seulement via l’aptitude');
  // Verdicts Go / No Go identiques à ceux du service RH : l'état des déplacements est calculé par le serveur. Seul le
  // libellé du motif APTITUDE est moins précis (ni « visite en retard », ni « aucune visite enregistrée »).
  const verdicts = (x: Dataset) => {
    const dx = new Domain(x);
    return dx.evaluateChantiers(dx.enrich(90, false), dx.tripsAll())
      .map(c => [c.c.id, c.status, c.res.map(r => [r.e.id, r.status, r.reasons.map(m => m.code === 'APTITUDE' ? m.code : m.detailed)])]);
  };
  const attendu = verdicts(full);
  assert.ok(JSON.stringify(attendu).includes('Formalités'), 'jeu de démonstration : des formalités de voyage pèsent sur un verdict');
  assert.deepEqual(verdicts(ds), attendu);
  assert.ok(ds.voyages.every(v => v.dossierStatut && Array.isArray(v.dossierManque)));
  assert.ok(!JSON.stringify(ds.voyages).match(/[Ff]ièvre|Hépatite|Typhoïde|DTP/), 'aucun vaccin nommé');
  // Les actions de formation passent ; celles du RH, non.
  await run(HSE, 'session.creer', { f: 'sst', date: '2026-12-01', lieu: 'Site de Lyon', places: 8 });
  await assert.rejects(async () => await run(HSE, 'medical.demander', { empId: 2 }), refus(/service RH/));
  await assert.rejects(async () => await run(HSE, 'absence.saisir', { empId: 2, nature: 'MARIAGE', du: '2026-12-15', au: '2026-12-16' }), refus(/service RH/));
});

test('gestionnaire de paie : temps, absences et soldes sans nature médicale, transmission à Sage ; ni formations, ni entretiens', async () => {
  const { db, PAIE, ADMIN, run, msg } = await fresh();
  await run(ADMIN, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-12-14', au: '2026-12-16', justificatif: true });
  await run(ADMIN, 'report.accorder', { empId: 2, jours: 1, motif: 'Arrêt maladie en fin de période' });
  const full = await buildSnapshot(db, ADMIN), ds = await buildSnapshot(db, PAIE);
  sansSante(ds);
  assert.equal(ds.feuilles.length, full.feuilles.length);
  assert.equal(ds.absences.length, full.absences.length);
  const arret = ds.absences.find(a => a.empId === 2 && a.du === '2026-12-14')!;
  assert.deepEqual([arret.type, arret.justificatif], ['ABSENCE', false], 'arrêt maladie : « Absence », dates seulement');
  assert.deepEqual([ds.cet.length, ds.soldesReprise.length], [full.cet.length, full.soldesReprise.length]);
  assert.ok(ds.reports.length > 0 && ds.reports.every(r => r.motif === ''), 'motif des reports (texte libre) retiré');
  assert.ok(ds.employes.every(e => !e.certs.length && !e.habs.length && e.aptitude === undefined), 'ni formations, ni aptitude');
  for (const k of ['sessions', 'inscriptions', 'participations', 'entretiens', 'demandesCollab', 'voyages', 'demandesKeystone', 'plan', 'missions'] as const) assert.deepEqual(ds[k], [], k);
  assert.deepEqual(ds.referentiels.chantiers, []);
  // Transmission à la paie : les lots de paie (sans leur contenu) lui sont renvoyés.
  assert.match(msg(await run(PAIE, 'temps.pushSage', {})), /marquées? transmises? — simulation, rien n’est envoyé à Sage Paie/);
  assert.ok((await buildSnapshot(db, PAIE)).lotsPaie.some(l => l.statut === 'transmis' && !('contenu' in l)));
  await assert.rejects(async () => await run(PAIE, 'temps.validate', { empId: 2, week: '2026-10-05' }), (e: unknown) => e instanceof ActionError && e.status >= 400);
});

test('lecture seule : tout en lecture, sans donnée de santé détaillée ni contenu des entretiens', async () => {
  const { db, LECTURE, ADMIN, run } = await fresh();
  await run(ADMIN, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-12-14', au: '2026-12-16' });
  const full = await buildSnapshot(db, ADMIN), ds = await buildSnapshot(db, LECTURE);
  sansSante(ds, true);
  for (const k of ['sessions', 'inscriptions', 'feuilles', 'absences', 'cet', 'plan', 'missions', 'entretiens'] as const) assert.equal(ds[k].length, full[k].length, k);
  // Échéances et alertes : celles du service RH, passeports (date d'expiration seule) et visas compris ; seuls les
  // rappels de vaccination et les échéances des visites médicales (données de santé) n'y figurent pas.
  ds.employes.forEach((e, i) => {
    const f = full.employes[i];
    assert.deepEqual([e.passeport, e.visas], [f.passeport && { expire: f.passeport.expire }, f.visas], e.nom);
  });
  const echeances = (x: Dataset) => { const dx = new Domain(x); return dx.echeances(dx.enrich(90, false), 90).map(c => `${c.emp.id} ${c.kindLabel} ${c.label} ${c.d}`); };
  const attendues = echeances(full).filter(c => !/Vaccination|Visite médicale/.test(c));
  assert.ok(attendues.some(c => / Passeport /.test(c)) && attendues.some(c => /Visa/.test(c)), 'jeu de démonstration : échéances de passeport et de visa');
  assert.deepEqual(echeances(ds), attendues);
  assert.deepEqual(ds.budgets, full.budgets);
  assert.ok(ds.entretiens.every(x => !Object.keys(x.cr).length), 'comptes rendus non transmis');
  assert.ok(full.entretiens.some(x => Object.keys(x.cr).length), 'jeu de démonstration : des comptes rendus existent');
  assert.ok(ds.employes.every(e => typeof e.aptitude?.ok === 'boolean'));
  // Reprise après une absence longue : la date reste, sans le motif (comme pour le manager).
  const reprises = ds.employes.filter(e => e.repriseDate);
  assert.ok(reprises.every(e => e.repriseMotif === 'absence longue'));
  // Aucune action : la matrice des droits le vérifie action par action ; un exemple ici.
  await assert.rejects(async () => await run(LECTURE, 'session.creer', { f: 'sst', date: '2026-12-01', lieu: 'Lyon', places: 8 }), refus(/service RH/));
});

test('membre du RH salarié : il ne décide pas de ses propres absences, feuilles de temps ou entretiens', async () => {
  const { db, user, run, msg, ADMIN, ANTOINE } = await fresh();
  // Antoine Leroy encadre l'Administration : son valideur est le service RH, c'est-à-dire un autre de ses membres.
  const d0 = new Domain(await loadFull(db, ADMIN));
  assert.equal(d0.mgrOf(d0.emp(14)!), 0);
  const antoineCollab = await user(14, 'collaborateur');
  await run(antoineCollab, 'absence.demander', { empId: 14, kind: 'CP', du: '2026-12-07', au: '2026-12-08' });
  const id = ((await db.one(`SELECT id FROM absences WHERE emp_id = 14 AND du = '2026-12-07'`)) as { id: number }).id;
  await assert.rejects(async () => await run(ANTOINE, 'absence.decider', { id, ok: true }),
    refus(/^Vous ne pouvez pas décider de votre propre demande d’absence : la décision revient à un autre membre du service RH$/));
  await assert.rejects(async () => await run(ANTOINE, 'absence.decider', { id, ok: false }), refus(/propre demande/), 'ni la refuser');
  assert.match(msg(await run(ADMIN, 'absence.decider', { id, ok: true })), /validée/);
  // Absences hors congés : ni saisie validée d'emblée, ni qualification de son propre signalement, ni report.
  await assert.rejects(async () => await run(ANTOINE, 'absence.saisir', { empId: 14, nature: 'MARIAGE', du: '2026-12-21', au: '2026-12-22' }), refus(/pour vous-même/));
  await run(ANTOINE, 'absence.signaler', { empId: 14, du: '2026-12-28', au: '2026-12-28' });
  const sig = (await db.one(`SELECT id, signale_par_interesse AS interesse FROM absences WHERE emp_id = 14 AND du = '2026-12-28'`)) as { id: number; interesse: number };
  assert.equal(sig.interesse, 1, 'signalée par l’intéressé, même depuis l’espace RH');
  await assert.rejects(async () => await run(ANTOINE, 'absence.qualifier', { id: sig.id, nature: 'MALADIE' }), refus(/qualifier votre propre absence/));
  await run(ADMIN, 'absence.qualifier', { id: sig.id, nature: 'MALADIE' });
  await run(ANTOINE, 'absence.prolonger', { id: sig.id, au: '2026-12-29' });
  assert.equal(((await db.one('SELECT statut FROM absences WHERE id = ?', [sig.id])) as { statut: string }).statut, 'signalee', 'prolongée comme intéressé : à requalifier');
  await assert.rejects(async () => await run(ANTOINE, 'absence.annuler', { id }), (e: unknown) => e instanceof ActionError && e.status === 403, 'congé validé : annulation par un autre');
  await assert.rejects(async () => await run(ANTOINE, 'report.accorder', { empId: 14, jours: 1, motif: 'Surcharge' }), refus(/report de congés/));
  // Feuille de temps : ni validée, ni renvoyée, ni corrigée après soumission par lui-même.
  const week = '2026-10-05';
  await run(antoineCollab, 'temps.addLine', { empId: 14, week, projet: 'INT-ADM' });
  for (let di = 0; di < 5; di++) await run(antoineCollab, 'temps.setCell', { empId: 14, week, li: 0, di, value: '7' });
  await run(antoineCollab, 'temps.submit', { empId: 14, week });
  await assert.rejects(async () => await run(ANTOINE, 'temps.validate', { empId: 14, week }), refus(/propre feuille de temps.*autre membre du service RH/));
  await assert.rejects(async () => await run(ANTOINE, 'temps.reject', { empId: 14, week }), refus(/propre feuille de temps/));
  await assert.rejects(async () => await run(ANTOINE, 'temps.setCell', { empId: 14, week, li: 0, di: 0, value: '9' }), /déjà soumise/);
  assert.match(msg(await run(ADMIN, 'temps.validate', { empId: 14, week })), /validée/);
  // Entretiens : jamais l'évaluateur de son propre entretien.
  await assert.rejects(async () => await run(ANTOINE, 'entretien.planifier', { empId: 14, kind: 'annuel', date: '2026-11-20' }), refus(/planifier votre propre entretien/));
  await run(ADMIN, 'entretien.planifier', { empId: 14, kind: 'annuel', date: '2026-11-20' });
  const ent = ((await db.one(`SELECT id FROM entretiens WHERE emp_id = 14 AND date = '2026-11-20'`)) as { id: number }).id;
  await assert.rejects(async () => await run(ANTOINE, 'entretien.modifier', { id: ent, section: 'bilan', value: 'Très bonne année' }), refus(/votre propre entretien/));
  await assert.rejects(async () => await run(ANTOINE, 'entretien.clore', { id: ent }), refus(/clore votre propre entretien/));
  await run(ADMIN, 'entretien.clore', { id: ent, date: '2026-10-10' });
  // Pour les autres salariés, rien ne change.
  await run(await user(2, 'collaborateur'), 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-21', au: '2026-12-21' });
  const mehdi = ((await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-21'`)) as { id: number }).id;
  assert.match(msg(await run(ANTOINE, 'absence.decider', { id: mehdi, ok: true })), /validée/);
  // Membre du RH qui a un manager : le refus le nomme.
  (await db.run(`UPDATE comptes SET profil_rh = 'rh_gestionnaire' WHERE emp_id = 2`));
  await run(await user(2, 'collaborateur'), 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-22', au: '2026-12-22' });
  const propre = ((await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-22'`)) as { id: number }).id;
  await assert.rejects(async () => await run(await user(2, 'rh'), 'absence.decider', { id: propre, ok: true }), refus(/revient à votre manager \(Karim Haddad\) ou à un autre membre du service RH/));
  assert.match(msg(await run(await user(12, 'manager'), 'absence.decider', { id: propre, ok: true })), /validée/);
});

test('administrateur RH externe rattaché ensuite à sa fiche : il ne décide plus de ses propres absences', async () => {
  const { db, compte, user, run, msg, ADMIN, ANTOINE } = await fresh();
  // Installation neuve : le premier administrateur est un compte externe, créé avant toute fiche ; la sienne vient ensuite.
  const externe = (await compte(null)).id;
  const fiche = (await run(ADMIN, 'employe.creer', { ...PROFIL_VIDE('Administration', '2024-01-08'), nom: 'Sandrine Vidal', poste: 'Responsable RH' }) as { result: { id: number } }).result.id;
  assert.match(msg(await run(ADMIN, 'compte.rattacher', { id: externe, empId: fiche })), /^Compte de Sandrine Vidal \(sandrine\.vidal@.*\) rattaché à la fiche de Sandrine Vidal$/);
  const c = (await db.get<Compte>('comptes', externe))!;
  assert.deepEqual([c.empId, c.nom, c.profilRh], [fiche, null, 'rh_admin']);
  assert.deepEqual(await espacesDuCompte(db, c), ['rh', 'collaborateur']);
  const admin = await user(fiche, 'rh');
  assert.equal(admin.salarieId, fiche);
  // Sa demande de congés : la décision revient à son manager ou à un autre membre du service RH.
  await run(await user(fiche, 'collaborateur'), 'absence.demander', { empId: fiche, kind: 'CP', du: '2026-12-07', au: '2026-12-11' });
  const id = ((await db.one(`SELECT id FROM absences WHERE emp_id = ? AND du = '2026-12-07'`, [fiche])) as { id: number }).id;
  await assert.rejects(async () => await run(admin, 'absence.decider', { id, ok: true }), refus(/propre demande d’absence : la décision revient à votre manager \(Antoine Leroy\)/));
  assert.match(msg(await run(ANTOINE, 'absence.decider', { id, ok: true })), /validée/);
  // Un compte déjà rattaché ne change pas de fiche ; une fiche qui a déjà son compte n'en reçoit pas un second.
  await assert.rejects(async () => await run(admin, 'compte.rattacher', { id: externe, empId: 2 }), /déjà rattaché à la fiche de Sandrine Vidal/);
  const cabinet = (await run(admin, 'compte.creer', { type: 'local', identifiant: 'cabinet.paie', nom: 'Cabinet Compta Plus', adresse: 'paie@cabinet.example', profilRh: 'paie' }) as { result: { id: number } }).result.id;
  await assert.rejects(async () => await run(admin, 'compte.rattacher', { id: cabinet, empId: 2 }), /Mehdi Benali a déjà un compte .* portez le profil RH sur ce compte-là/);
  await assert.rejects(async () => await run(ANTOINE, 'compte.rattacher', { id: cabinet, empId: fiche }), refus(/administrateur RH/));
});

test('comptes et accès : le profil se choisit à la création et se modifie', async () => {
  const { db, run, ADMIN } = await fresh();
  const r = await run(ADMIN, 'compte.creer', { type: 'local', identifiant: 'cabinet.paie', nom: 'Cabinet Compta Plus', adresse: 'paie@cabinet.example', profilRh: 'paie' }) as { message: string; result: { id: number } };
  assert.match(r.message, /Gestionnaire de paie/);
  const c = (await db.get<Compte>('comptes', r.result.id))!;
  assert.deepEqual(await espacesDuCompte(db, c), ['rh'], 'compte externe : espace RH seulement');
  const u = (await currentUser(db, { compteId: c.id, role: 'rh', methode: 'local' }))!;
  assert.deepEqual([u.intitule, u.salarieId, droitsRh(u)], ['Gestionnaire de paie', null, ['paie']]);
  assert.match(String(await run(ADMIN, 'compte.profil', { id: c.id, profilRh: 'lecture_seule' })), /Lecture seule/);
  assert.deepEqual(droitsRh((await currentUser(db, { compteId: c.id, role: 'rh', methode: 'local' }))!), ['consultation']);
  await assert.rejects(async () => await run(ADMIN, 'compte.profil', { id: c.id, profilRh: 'aucun' }), /compte externe/);
  // Salarié : référent HSE puis plus d'accès RH.
  const ines = ((await db.one('SELECT id FROM comptes WHERE emp_id = 5')) as { id: number }).id;
  await run(ADMIN, 'compte.profil', { id: ines, profilRh: 'referent_hse' });
  assert.deepEqual(await espacesDuCompte(db, (await db.get<Compte>('comptes', ines))!), ['rh', 'collaborateur']);
  await run(ADMIN, 'compte.profil', { id: ines, profilRh: 'aucun' });
  assert.deepEqual(await espacesDuCompte(db, (await db.get<Compte>('comptes', ines))!), ['collaborateur']);
  await assert.rejects(async () => await run(ADMIN, 'compte.creer', { type: 'local', identifiant: 'x.y', nom: 'X', adresse: 'x@y.example', profilRh: 'inconnu' }), /Profil RH inconnu/);
});

// — Scénario HTTP : instantané, journal et envois servis selon le profil —

const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const port = (s.address() as { port: number }).port; s.close(() => res(port)); });
});

async function serveur(file: string) {
  const port = await freePort();
  const p = spawn(process.execPath, [join(ROOT, 'server/src/index.ts')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', CURSUS_API_PORT: String(port), CURSUS_DB: file, CURSUS_HOST: '127.0.0.1', CURSUS_TODAY: '2026-10-10', CURSUS_DEMO: '1' },
  });
  procs.push(p);
  let out = '';
  p.stdout!.on('data', d => { out += d; });
  p.stderr!.on('data', d => { out += d; });
  await new Promise<void>((res, rej) => {
    const timer = setInterval(() => { if (out.includes('Cursus — API sur')) { clearInterval(timer); res(); } }, 20);
    p.on('exit', code => { clearInterval(timer); rej(new Error(`Serveur arrêté (code ${code}) :\n${out}`)); });
  });
  return async (path: string, init: { cookie?: string; body?: unknown } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.body !== undefined ? 'POST' : 'GET',
      headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const cookie = r.headers.get('set-cookie')?.match(/cursus_session=[^;]*/)?.[0] ?? null;
    return { status: r.status, cookie, json: await r.json().catch(() => ({})) };
  };
}

test('HTTP : journal et envois pour le service RH et la lecture seule, messages de santé masqués ; instantané restreint', async () => {
  const call = await serveur(join(dir, 'demo.db'));
  const s = await call('/api/session');
  const admin = s.cookie!;
  const rh = s.json.loginOptions.rh as { id: number; nom: string }[];
  const connecter = async (nom: string) => (await call('/api/login', { cookie: admin, body: { role: 'rh', compteId: rh.find(o => o.nom.startsWith(nom))!.id } })).cookie!;
  // L'administratrice enregistre un arrêt maladie : le message du journal nomme la nature.
  assert.equal((await call('/api/actions/absence.saisir', { cookie: admin, body: { empId: 2, nature: 'MALADIE', du: '2026-12-14', au: '2026-12-15' } })).status, 200);
  // Réponse paginée du journal (server/src/journal.ts) : { lignes, total, page, taille }.
  const ligne = (j: { lignes: { action: string; message: string | null }[] }) => j.lignes.find(r => r.action === 'absence.saisir')!;
  // Le journal n'enregistre jamais la nature d'un arrêt (server/src/journal.ts), même pour le RH.
  const vueRh = ligne((await call('/api/journal', { cookie: admin })).json).message!;
  assert.match(vueRh, /^Absence de Mehdi Benali enregistrée/);
  assert.doesNotMatch(vueRh, /maladie/i);
  const lecture = await connecter('Élodie Bernard');
  const j = await call('/api/journal', { cookie: lecture });
  assert.equal(j.status, 200);
  assert.equal(ligne(j.json).message, 'Détail réservé au service RH');
  assert.equal((await call('/api/envois', { cookie: lecture })).status, 200);
  assert.equal((await call('/api/comptes', { cookie: lecture })).status, 403, 'comptes et accès : administrateur RH');
  const data = (await call('/api/data', { cookie: lecture })).json as Dataset;
  assert.equal(data.user.profilRh, 'lecture_seule');
  assert.ok(!data.absences.some(a => a.type === 'MALADIE'));
  assert.equal((await call('/api/actions/session.creer', { cookie: lecture, body: { f: 'sst', date: '2026-12-01', lieu: 'Lyon', places: 8 } })).status, 403);
  for (const nom of ['Sarah Cohen', 'Aïcha Diallo']) {
    const c = await connecter(nom);
    assert.equal((await call('/api/journal', { cookie: c })).status, 403, `${nom} : journal`);
    assert.equal((await call('/api/envois', { cookie: c })).status, 403, `${nom} : envois`);
    const ds = (await call('/api/data', { cookie: c })).json as Dataset;
    assert.ok(ds.employes.every(e => e.visite === null && !e.vaccins.length), `${nom} : données de santé`);
  }
});
