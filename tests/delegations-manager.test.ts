// Délégation des validations d'un manager absent (t135) : valideurs pendant la délégation (suppléant, pas d'auto-validation,
// N+1 pour le suppléant lui-même), droits au premier et au dernier jour, avant et après, révocation, espace manager ouvert
// au suppléant, décision signée « par délégation de » (message, journal, e-mail), notifications et relances au suppléant,
// annonce du premier jour, instantané du suppléant et migration. Jeu de démonstration : Karim Haddad (12) encadre la
// Maintenance dont il est membre, avec Mehdi Benali (2) et Thomas Garnier (6) ; Sophie Lemaire (3) encadre la Production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { SqliteDb } = await import('../server/src/db.ts');
const { json, nouvelleBase, PG, SQLITE_SEUL, sqlite } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull, scopeIds } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { signerDelegation } = await import('../server/src/actions/delegations-manager.ts');
const { espacesDuCompte } = await import('../server/src/comptes.ts');
const { annoncerDelegations } = await import('../server/src/delegations.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { DELEGATIONS_VALIDATION } = await import('../server/src/migrations/lot6-hierarchie.ts');
const { REFERENCES } = await import('../server/src/integrite.ts');
const { Domain } = await import('../shared/domain.ts');
const { controleDelegation, deleguesA, suppleantPropose, valideursDe } = await import('../shared/rules/delegations-manager.ts');
type User = Parameters<typeof buildSnapshot>[1];
type Compte = Parameters<typeof espacesDuCompte>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin', compteId: 1 };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const MEHDI: User = { role: 'collaborateur', empId: 2, nom: 'Mehdi Benali', intitule: 'Technicien' };
const THOMAS_COLLAB: User = { role: 'collaborateur', empId: 6, nom: 'Thomas Garnier', intitule: 'Électromécanicien' };
const THOMAS: User = { role: 'manager', empId: 6, nom: 'Thomas Garnier', intitule: 'Manager · suppléant de Karim Haddad' };
const SOPHIE: User = { role: 'manager', empId: 3, nom: 'Sophie Lemaire', intitule: 'Manager · Production' };
const WEEK = '2026-09-28';

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Chemin de POST /api/actions/:nom (server/src/app.ts) : action, signature « par délégation », journal.
  const run = async (user: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const ctx = makeCtx(db, user, await loadFull(db, user));
    const r = await ACTIONS[name](ctx, p);
    const o = signerDelegation(ctx, typeof r === 'object' && r !== null ? r : { message: r });
    const compte = await db.one('SELECT * FROM comptes WHERE emp_id IS NULL') as never;
    await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result, parDelegation: [...ctx.parDelegation] });
    return o;
  });
  const refus = async (user: User, name: string, p: Record<string, unknown>, status = 403, motif?: RegExp) =>
    await assert.rejects(async () => await run(user, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!motif || motif.test(e.message)), `${name} devait être refusé (${status})`);
  /** Délégation écrite directement (dates hors des contrôles de saisie : passée, révoquée…). */
  const deleguer = async (o: { du: string; au: string; managerId?: number; suppleantId?: number; perimetre?: string[]; revoqueeLe?: string | null }) =>
    (await db.insert<{ id: number }>('delegations', {
      managerId: o.managerId ?? 12, suppleantId: o.suppleantId ?? 6, du: o.du, au: o.au, perimetre: o.perimetre ?? ['absences', 'feuilles'],
      creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad', revoqueeLe: o.revoqueeLe ?? null, revoqueePar: null, annonceeLe: '2026-10-01T08:00:00.000Z',
    })).id;
  const demande = async (empId: number) => (await db.insert<{ id: number }>('absences', { empId, type: 'CP', du: '2026-12-07', au: '2026-12-08', statut: 'demandee', keystone: false, justificatif: false })).id;
  const statut = async (id: number) => (await db.get<{ statut: string }>('absences', id))!.statut;
  const domain = async () => new Domain(await loadFull(db, RH));
  const mails = async (type: string) => (await db.all<{ cible: string; type: string; contenu: { a: string; objet: string; texte: string } }>('envois')).filter(e => e.cible === 'email' && e.type === type);
  const adresse = async (empId: number) => (await db.get<{ email: string | null }>('employes', empId))?.email ?? '';
  const compte = async (empId: number) => (await db.where<Compte>('comptes', 'empId', empId))[0];
  return { db, run, refus, deleguer, demande, statut, domain, mails, adresse, compte };
}

test('sans délégation (par défaut) : rien ne change, entretiens exclus par défaut', async () => {
  const { db, domain } = await fresh();
  assert.equal(await db.count('delegations'), 0);
  const d = await domain();
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, d.ti, 'absences').map(v => v.id), [12]);
  assert.deepEqual(valideursDe(d.ds, d.emp(12)!, d.ti, 'absences').map(v => v.id), [0], 'manager membre de son équipe : service RH');
  assert.equal(d.ds.settings.delegationEntretiens, false);
  assert.equal(suppleantPropose(d.ds, 12), 0, 'sans équipe parente, aucun N+1 : le suppléant se choisit');
});

test('règles : suppléant ajouté au manager, pas d’auto-validation, N+1 pour le suppléant, bornes et révocation', async () => {
  const { deleguer, domain, db } = await fresh();
  await deleguer({ du: '2026-10-07', au: '2026-10-09' });
  let d = await domain();
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, '2026-10-07', 'absences').map(v => v.id), [12, 6], 'premier jour : manager et suppléant');
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, '2026-10-09', 'feuilles').map(v => v.id), [12, 6], 'dernier jour');
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, '2026-10-06', 'absences').map(v => v.id), [12], 'veille : le manager seul');
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, '2026-10-10', 'absences').map(v => v.id), [12], 'lendemain : le manager seul');
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, '2026-10-07', 'entretiens').map(v => v.id), [12], 'entretiens hors périmètre');
  // Le suppléant membre de l'équipe ne décide pas pour lui-même : son N+1 (le manager remplacé n'en a pas : service RH).
  assert.deepEqual(valideursDe(d.ds, d.emp(6)!, '2026-10-07', 'absences').map(v => v.id), [12, 0]);
  assert.ok(deleguesA(d.ds, 6, '2026-10-07').some(x => x.empId === 2 && x.managerId === 12), 'Mehdi Benali : par délégation de Karim Haddad');
  assert.ok(!deleguesA(d.ds, 6, '2026-10-07').some(x => x.empId === 6 || x.empId === 12), 'ni lui-même ni le manager remplacé');
  // Équipe rattachée à la Production : le N+1 de Karim (Sophie) est proposé, et décide des demandes de Thomas.
  await db.update('equipes', 'Maintenance', { parente: 'Production' });
  d = await domain();
  assert.equal(suppleantPropose(d.ds, 12), 3);
  assert.deepEqual(valideursDe(d.ds, d.emp(6)!, '2026-10-07', 'absences').map(v => v.id), [12, 3]);
  await db.run('UPDATE delegations SET revoquee_le = ?', ['2026-10-07T09:00:00.000Z']);
  d = await domain();
  assert.deepEqual(valideursDe(d.ds, d.emp(2)!, '2026-10-07', 'absences').map(v => v.id), [12], 'révoquée : le manager seul');
});

test('droits : le suppléant décide pendant la délégation, signée « par délégation », jamais pour lui-même', async () => {
  const { db, run, refus, deleguer, demande, statut, compte } = await fresh();
  assert.ok(!(await espacesDuCompte(db, await compte(6))).includes('manager'), 'sans délégation, pas d’espace manager');
  await deleguer({ du: '2026-10-07', au: '2026-10-07' });
  assert.ok((await espacesDuCompte(db, await compte(6))).includes('manager'), 'espace manager ouvert le jour de la délégation');
  const u = await currentUser(db, { compteId: (await compte(6)).id, role: 'manager', methode: 'demo' });
  assert.match(u!.intitule, /suppléant de Karim Haddad/);
  const a = await demande(2);
  const o = await run(THOMAS, 'absence.decider', { id: a, ok: true });
  assert.equal(await statut(a), 'validee');
  assert.match(o.message!, /par délégation de Karim Haddad/);
  const j = await db.one(`SELECT payload, actor FROM journal WHERE action = 'absence.decider' ORDER BY id DESC LIMIT 1`) as { payload: unknown; actor: string };
  assert.deepEqual(json(j.payload).parDelegation, [12], 'journal : manager remplacé');
  assert.equal(j.actor, 'Thomas Garnier');
  // Sa propre demande : refusée (ni auto-validation, ni dans l'espace collaborateur).
  const propre = await demande(6);
  await refus(THOMAS, 'absence.decider', { id: propre, ok: true }, 403);
  await refus(THOMAS_COLLAB, 'absence.decider', { id: await demande(2), ok: false }, 403);
  // Le manager garde la main, le service RH aussi.
  const b = await demande(2);
  await run(KARIM, 'absence.decider', { id: b, ok: false, motif: 'Charge' });
  assert.equal(await statut(b), 'refusee');
  // Hors périmètre (entretiens) : refusé ; la feuille, dans le périmètre, se valide.
  await refus(THOMAS, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-11-20' }, 403);
  await db.run('DELETE FROM feuilles WHERE emp_id = 2 AND week = ?', [WEEK]);
  await db.insert('feuilles', { empId: 2, week: WEEK, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }] });
  const v = await run(THOMAS, 'temps.validate', { empId: 2, week: WEEK });
  assert.match(v.message!, /par délégation de Karim Haddad/);
});

test('début, fin et révocation : droits ouverts du premier au dernier jour, fermés avant, après et dès la révocation', async () => {
  const { db, run, refus, deleguer, demande, compte } = await fresh();
  const avant = await deleguer({ du: '2026-10-08', au: '2026-10-20' });
  await refus(THOMAS, 'absence.decider', { id: await demande(2), ok: true }, 403);
  assert.ok(!(await espacesDuCompte(db, await compte(6))).includes('manager'), 'à venir : pas encore d’espace manager');
  await db.run('DELETE FROM delegations WHERE id = ?', [avant]);
  await deleguer({ du: '2026-09-20', au: '2026-10-06' });
  await refus(THOMAS, 'absence.decider', { id: await demande(2), ok: true }, 403);
  assert.ok(!(await espacesDuCompte(db, await compte(6))).includes('manager'), 'terminée : espace manager refermé');
  const g = await deleguer({ du: '2026-09-20', au: '2026-10-07', managerId: 12, suppleantId: 3 });
  await run(SOPHIE, 'absence.decider', { id: await demande(2), ok: true });
  await run(KARIM, 'equipe.revoquerDelegation', { id: g });
  await refus(SOPHIE, 'absence.decider', { id: await demande(2), ok: true }, 403);
  const j = await db.one(`SELECT payload, salaries FROM journal WHERE action = 'equipe.revoquerDelegation'`) as { payload: unknown; salaries: unknown };
  assert.ok(json(j.payload).apres.revoqueeLe, 'journal : horodatage de la révocation');
  assert.deepEqual(json(j.salaries).sort((a: number, b: number) => a - b), [3, 12]);
  await refus(KARIM, 'equipe.revoquerDelegation', { id: await deleguer({ du: '2026-09-01', au: '2026-09-10' }) }, 400, /déjà terminée/);
});

test('enregistrement : contrôles, suppléant prévenu avec les demandes en attente, journal sans texte libre', async () => {
  const { db, run, refus, demande, mails, adresse } = await fresh();
  await demande(2);
  const p = { suppleantId: 6, du: '2026-10-07', au: '2026-10-16', perimetre: ['absences', 'feuilles'] };
  await refus(KARIM, 'equipe.delegation', { ...p, suppleantId: 12 }, 400, /autre personne/);
  await refus(KARIM, 'equipe.delegation', { ...p, perimetre: [] }, 400, /Choisissez/);
  await refus(KARIM, 'equipe.delegation', { ...p, perimetre: ['absences', 'entretiens'] }, 400, /entretiens n’est pas ouverte/);
  await refus(KARIM, 'equipe.delegation', { ...p, au: '2027-03-01' }, 400, /limitée à 92 jours/);
  await refus(KARIM, 'equipe.delegation', { ...p, du: '2026-09-01', au: '2026-10-06' }, 400, /déjà terminée/);
  await refus(MEHDI, 'equipe.delegation', p, 403);
  await refus(KARIM, 'equipe.delegation', { ...p, managerId: 3 }, 403);
  const o = await run(KARIM, 'equipe.delegation', p);
  assert.match(o.message!, /\(congés et feuilles de temps\) déléguées à Thomas Garnier du 7 oct\. 2026 au 16 oct\. 2026 · Thomas Garnier est prévenu \(\d+ demandes en attente\)/);
  const m = await mails('delegation.debut');
  assert.equal(m.length, 1);
  assert.equal(String(m[0].contenu.a), await adresse(6));
  assert.match(m[0].contenu.texte, /Mehdi Benali : demande de congés payés/);
  assert.ok((await db.all<{ annonceeLe: string | null }>('delegations'))[0].annonceeLe, 'annonce notée');
  const j = json((await db.one(`SELECT payload FROM journal WHERE action = 'equipe.delegation'`) as { payload: unknown }).payload);
  assert.deepEqual(j.perimetre, ['absences', 'feuilles']);
  assert.equal(j.suppleantId, 6);
  await refus(RH, 'equipe.delegation', { ...p, managerId: 12, suppleantId: 3, du: '2026-10-10', au: '2026-10-12' }, 400, /déjà délégué/);
  // Une délégation ne se transmet pas : Thomas, suppléant, ne délègue pas ; Sophie ne peut prendre Thomas pour suppléant… s'il remplace.
  await refus(SOPHIE, 'equipe.delegation', { ...p, suppleantId: 12 }, 400, /remplace lui-même|a lui-même délégué/);
});

test('notifications et relances au suppléant, annonce du premier jour par la tâche de fond', async () => {
  const { db, run, deleguer, mails, adresse } = await fresh();
  await deleguer({ du: '2026-10-07', au: '2026-10-09' });
  await db.update('employes', 12, { notifications: 'immediat' });
  await db.update('employes', 6, { notifications: 'immediat' });
  await run(MEHDI, 'absence.demander', { empId: 2, kind: 'CP', du: '2026-12-14', au: '2026-12-15' });
  const dem = await mails('absence.demande');
  assert.deepEqual(dem.map(e => String(e.contenu.a)).sort(), [await adresse(12), await adresse(6)].sort(), 'au manager et au suppléant');
  const adresseThomas = await adresse(6);
  assert.match(dem.find(e => String(e.contenu.a) === adresseThomas)!.contenu.objet, /en l’absence de Karim Haddad/);
  // Décision du suppléant : l'e-mail au salarié la signe « par délégation ».
  const a = await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-12-14'`) as { id: number };
  await run(THOMAS, 'absence.decider', { id: a.id, ok: true });
  assert.match((await mails('absence.decision')).at(-1)!.contenu.texte, /par Thomas Garnier, par délégation de Karim Haddad/);
  // Relance des feuilles par le suppléant : membres dont il décide (Mehdi Benali, sans feuille sur les semaines suivies).
  await db.run('DELETE FROM feuilles WHERE emp_id = 2');
  const r = await run(THOMAS, 'temps.relancer', {});
  assert.ok((r.result as { feuilles: { empId: number }[] }).feuilles.some(f => f.empId === 2));
  // Délégation qui commence aujourd'hui sans avoir été annoncée : la tâche de fond prévient le suppléant une fois.
  await deleguer({ du: '2026-10-07', au: '2026-10-08', managerId: 3, suppleantId: 13 });
  await db.run(`UPDATE delegations SET annoncee_le = NULL WHERE manager_id = 3`);
  assert.equal(await annoncerDelegations(db), 1);
  assert.equal(await annoncerDelegations(db), 0);
  assert.equal(String((await mails('delegation.debut')).at(-1)!.contenu.a), await adresse(13));
});

test('instantané du suppléant : membres dont il décide, sans entretiens hors périmètre, périmètre envoyé', async () => {
  const { db, deleguer, domain } = await fresh();
  await deleguer({ du: '2026-10-07', au: '2026-10-09', managerId: 12, suppleantId: 3 });
  const ds = await buildSnapshot(db, SOPHIE);
  assert.ok(ds.employes.some(e => e.id === 2), 'Mehdi Benali dans le périmètre de Sophie Lemaire');
  assert.ok(scopeIds(await domain(), SOPHIE).includes(2));
  assert.ok(ds.delegues!.some(x => x.empId === 2 && x.perimetre.join() === 'absences,feuilles'));
  assert.ok(!ds.entretiens.some(x => x.empId === 2), 'entretiens hors périmètre non transmis');
  assert.ok(!ds.employes.find(e => e.id === 2)!.visite, 'mêmes filtres de santé que pour l’équipe directe');
  assert.ok(ds.delegations!.length >= 1 && ds.delegations!.every(g => g.managerId === 3 || g.suppleantId === 3 || g.managerId === 12));
  const mehdi = await buildSnapshot(db, MEHDI);
  assert.ok(mehdi.delegations!.some(g => g.managerId === 12), 'le salarié voit la délégation de son manager');
  const karim = await buildSnapshot(db, KARIM);
  assert.ok(karim.delegations!.some(g => g.suppleantId === 3));
  // Profils restreints : la lecture seule consulte, ni le référent HSE ni la paie.
  assert.ok((await buildSnapshot(db, { role: 'rh', empId: null, nom: 'Élodie', intitule: 'Lecture', profilRh: 'lecture_seule', compteId: 99 })).delegations!.length >= 1);
  assert.deepEqual((await buildSnapshot(db, { role: 'rh', empId: null, nom: 'Aïcha', intitule: 'Paie', profilRh: 'paie', compteId: 98 })).delegations, []);
});

test('intégrité et migration lot6-hierarchie-delegations : colonnes déclarées, délégations impossibles révoquées', { skip: PG && SQLITE_SEUL }, async () => {
  assert.ok(REFERENCES.some(r => r.table === 'delegations' && r.colonne === 'manager_id'));
  assert.ok(REFERENCES.some(r => r.table === 'delegations' && r.colonne === 'suppleant_id'));
  const neuve = new SqliteDb(':memory:');
  assert.ok((await appliquerMigrations(neuve)).includes('lot6-hierarchie-delegations'));
  const { db, deleguer } = await fresh();
  const ok = await deleguer({ du: '2026-10-07', au: '2026-10-09' });
  const soi = await deleguer({ du: '2026-10-07', au: '2026-10-09', suppleantId: 12 });
  assert.equal(await DELEGATIONS_VALIDATION.executer(sqlite(db)), '1 délégation de validation impossible révoquée');
  assert.ok((await db.get<{ revoqueeLe: string | null }>('delegations', soi))!.revoqueeLe);
  assert.equal((await db.get<{ revoqueeLe: string | null }>('delegations', ok))!.revoqueeLe, null);
  assert.equal(await DELEGATIONS_VALIDATION.executer(sqlite(db)), undefined, 'rien à refaire');
});

test('entretiens : délégués seulement si le réglage les ouvre ; le réglage refermé les retire aussitôt', async () => {
  const { db, run, refus, deleguer } = await fresh();
  await deleguer({ du: '2026-10-07', au: '2026-10-09', perimetre: ['absences', 'entretiens'] });
  const p = { empId: 2, kind: 'annuel', date: '2026-11-20' };
  await refus(THOMAS, 'entretien.planifier', p, 403);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), delegationEntretiens: true });
  assert.match((await run(THOMAS, 'entretien.planifier', p)).message!, /par délégation de Karim Haddad/);
  assert.ok((await buildSnapshot(db, THOMAS)).delegues!.find(x => x.empId === 2)!.perimetre.includes('entretiens'));
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), delegationEntretiens: false });
  await refus(THOMAS, 'entretien.planifier', { ...p, date: '2026-11-27' }, 403);
  assert.match(controleDelegation({ ...await loadFull(db, RH), today: '2026-10-07' }, { managerId: 3, suppleantId: 13, du: '2026-10-10', au: '2026-10-12', perimetre: ['entretiens'] },
    { suppleant: { entree: '2020-01-01', fin: null }, nom: String })!, /n’est pas ouverte/);
});

test('écrans : décideur par délégation (state/delegues.ts), révocation confirmée (state/confirmations-delegations.ts)', async () => {
  const { decideur, membreOuDelegue } = await import('../client/src/state/delegues.ts');
  const { revocationDelegation } = await import('../client/src/state/confirmations-delegations.ts');
  const { db, deleguer } = await fresh();
  await deleguer({ du: '2026-10-07', au: '2026-10-09', managerId: 12, suppleantId: 3 });
  const d = new Domain(await buildSnapshot(db, SOPHIE));
  const mehdi = d.emp(2)!;
  assert.equal(decideur(d, mehdi, 3, 'absences'), true);
  assert.equal(decideur(d, mehdi, 3, 'entretiens'), false, 'hors périmètre');
  assert.equal(decideur(d, d.emp(3)!, 3, 'absences'), false, 'jamais pour soi');
  assert.equal(membreOuDelegue(d, mehdi, 3), true);
  const c = revocationDelegation({ id: 9, du: '2026-10-07', au: '2026-10-09' }, 'Karim Haddad', 'Sophie Lemaire', true);
  assert.equal(c.action, 'equipe.revoquerDelegation');
  assert.deepEqual(c.payload, { id: 9 });
  assert.ok(c.suites!.some(x => /reviennent à Karim Haddad/.test(x)));
});

test('Mon espace : le manager choisit un suppléant hors de son instantané et enregistre sa délégation (dialogue)', async () => {
  const { suppleantsCandidats, verifierDelegation } = await import('../client/src/state/delegation-saisie.ts');
  const { db, run, mails, adresse } = await fresh();
  const KARIM_COLLAB: User = { role: 'collaborateur', empId: 12, nom: 'Karim Haddad', intitule: 'Responsable maintenance' };
  await db.update('equipes', 'Maintenance', { parente: 'Production' });
  const ds = await buildSnapshot(db, KARIM_COLLAB);
  assert.deepEqual(ds.employes.map(e => e.id), [12], 'instantané de Mon espace : sa seule fiche');
  const d = new Domain(ds);
  const { liste, n1 } = suppleantsCandidats(d, 12);
  assert.equal(n1, 3, 'N+1 proposé');
  assert.equal(liste[0].id, 3, 'le N+1 en tête de la liste');
  assert.ok(!liste.some(p => p.id === 12), 'pas le manager lui-même');
  assert.ok(ds.suppleantsPossibles!.every(p => Object.keys(p).sort().join() === 'equipe,id,nom,poste'), 'annuaire seulement');
  const saisie = { suppleant: '3', du: '2026-10-19', au: '2026-10-23', perimetre: ['absences', 'feuilles'] as ('absences' | 'feuilles')[] };
  assert.deepEqual(verifierDelegation(d, 12, saisie, liste), { suppleant: null, perimetre: null, periode: null }, 'rien ne bloque l’envoi');
  assert.equal(verifierDelegation(d, 12, { ...saisie, suppleant: '' }, liste).suppleant, 'Choisissez le suppléant');
  assert.equal(verifierDelegation(d, 12, { ...saisie, suppleant: '999' }, liste).periode, 'Suppléant introuvable', 'hors des suppléants possibles');
  // Envoi tel que le dialogue le fait : délégation enregistrée, le suppléant prévenu d'une délégation à venir.
  const o = await run(KARIM_COLLAB, 'equipe.delegation', { managerId: 12, suppleantId: 3, du: saisie.du, au: saisie.au, perimetre: saisie.perimetre });
  assert.match(o.message!, /déléguées à Sophie Lemaire du 19 oct\. 2026 au 23 oct\. 2026/);
  assert.equal(await db.count('delegations'), 1);
  assert.equal(String((await mails('delegation.prevue')).at(-1)!.contenu.a), await adresse(3));
  // Le collaborateur sans équipe ne reçoit pas de suppléants possibles.
  assert.equal((await buildSnapshot(db, MEHDI)).suppleantsPossibles, undefined);
});

test('validation croisée : refusée quand le suppléant deviendrait le valideur de son propre valideur', async () => {
  const { db, refus, deleguer, domain } = await fresh();
  await db.update('equipes', 'Maintenance', { parente: 'Production' });
  // Sophie (N+1 de Karim) délègue à Mehdi, que Karim valide : Mehdi déciderait des congés de Karim.
  await refus(SOPHIE, 'equipe.delegation', { suppleantId: 2, du: '2026-10-07', au: '2026-10-09', perimetre: ['absences'] }, 400,
    /Mehdi Benali et Karim Haddad deviendraient chacun le valideur de l’autre/);
  // Karim délègue à Thomas, puis Sophie à Thomas sur une partie de la période : refusé (Karim valide toujours Thomas) ;
  // à Julien Moreau, membre de la Production, accepté.
  await deleguer({ du: '2026-10-07', au: '2026-10-09' });
  await refus(SOPHIE, 'equipe.delegation', { suppleantId: 6, du: '2026-10-08', au: '2026-10-12', perimetre: ['absences', 'feuilles'] }, 400, /chacun le valideur de l’autre/);
  const d = await domain();
  assert.equal(controleDelegation({ ...d.ds, today: d.ti }, { managerId: 3, suppleantId: 8, du: '2026-10-08', au: '2026-10-12', perimetre: ['absences'] },
    { suppleant: d.emp(8), nom: id => d.personName(id) }), null);
  // Sans équipe parente, Karim et Sophie ne se valident pas : Sophie peut prendre Mehdi pour suppléant.
  await db.update('equipes', 'Maintenance', { parente: null });
  const libre = await domain();
  assert.equal(controleDelegation({ ...libre.ds, today: libre.ti }, { managerId: 3, suppleantId: 2, du: '2026-10-20', au: '2026-10-22', perimetre: ['absences'] },
    { suppleant: libre.emp(2), nom: id => libre.personName(id) }), null);
});

test('signature : ni le N+1 qui décide pour le suppléant, ni une relance de sa propre équipe ne sont « par délégation »', async () => {
  const { db, run, deleguer, demande, statut } = await fresh();
  await db.update('equipes', 'Maintenance', { parente: 'Production' });
  await deleguer({ du: '2026-10-07', au: '2026-10-09' });
  // Demande de Thomas, suppléant : Sophie (N+1 de Karim) en décide en responsable hiérarchique, sans signature.
  const a = await demande(6);
  const o = await run(SOPHIE, 'absence.decider', { id: a, ok: true });
  assert.equal(await statut(a), 'validee');
  assert.doesNotMatch(o.message!, /par délégation/);
  const j = await db.one(`SELECT payload FROM journal WHERE action = 'absence.decider' ORDER BY id DESC LIMIT 1`) as { payload: unknown };
  assert.equal(json(j.payload).parDelegation, undefined);
  // Karim délègue à Sophie : sa relance d'un membre direct de la Production n'est pas signée.
  await db.run('DELETE FROM delegations');
  await deleguer({ du: '2026-10-07', au: '2026-10-09', suppleantId: 3 });
  await db.run('DELETE FROM feuilles WHERE emp_id IN (2, 8)');
  const r = await run(SOPHIE, 'temps.relancer', { empId: 8 });
  assert.doesNotMatch(r.message!, /par délégation/);
  const jr = await db.one(`SELECT payload FROM journal WHERE action = 'temps.relancer' ORDER BY id DESC LIMIT 1`) as { payload: unknown };
  assert.equal(json(jr.payload).parDelegation, undefined);
  // Le membre de l'équipe remplacée reste relançable par le suppléant.
  assert.ok(((await run(SOPHIE, 'temps.relancer', { empId: 2 })).result as { feuilles: { empId: number }[] }).feuilles.some(f => f.empId === 2));
});
