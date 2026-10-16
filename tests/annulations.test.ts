// Tests du chantier « entretiens, plan de formation et déplacements », étape 2, t126 : modification et annulation d'un
// déplacement (Keystone prévenu pour un déplacement venu de Keystone, déplacement annulé hors de tous les calculs mais
// gardé dans l'historique), annulation d'un entretien planifié (.ics d'annulation, compte rendu commencé sur
// confirmation), entretien planifié à une date dépassée compté en retard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_PUBLIC_URL = 'https://cursus.example.fr';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET', 'KEYSTONE_URL']) delete process.env[k];

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { blocage, conflitsDates } = await import('../shared/rules/conflits.ts');
const { controleSortie } = await import('../shared/rules/contrats.ts');
const { refusAnnulation, refusChangement, refusModification, voyagesAnnules } = await import('../shared/rules/deplacements.ts');
const { obligations, statutObligation } = await import('../shared/rules/entretiens.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Ligne = Record<string, any>;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace au journal après). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown> = {}) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return o.message as string;
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} : refus attendu ${motif}`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  const journal = (action: string) => db.all<Ligne>('journal').filter(j => j.action === action);
  const envois = (type: string) => db.all<Ligne>('envois').filter(e => e.type === type);
  return { db, run, refus, domain, journal, envois, user, RH, KARIM: user(12, 'manager'), MEHDI: user(2, 'collaborateur') };
}
const voyageDe = (db: InstanceType<typeof Db>, empId: number, dest: string) => db.all<Ligne>('voyages').find(v => v.empId === empId && v.dest === dest)!;

// — Déplacements —

test('règles : déplacement annulé ou terminé non modifiable, Keystone limité aux dates, motif d’annulation', () => {
  assert.equal(refusChangement({ annuleLe: null, retour: '2026-10-12' }, '2026-10-10'), null);
  assert.match(refusChangement({ annuleLe: '2026-10-01', retour: '2026-11-12' }, '2026-10-10')!, /déjà annulé/);
  assert.match(refusChangement({ annuleLe: null, retour: '2026-10-09' }, '2026-10-10')!, /terminé/);
  const ks = { origine: 'keystone' as const, dest: 'CI', motif: 'Mise en service' };
  assert.equal(refusModification(ks, { dest: 'CI', depart: '2026-11-10', retour: '2026-11-20', motif: 'Mise en service' }), null);
  assert.match(refusModification(ks, { dest: 'MA', depart: '2026-11-10', retour: '2026-11-20', motif: 'Mise en service' })!, /seules ses dates/);
  assert.match(refusModification({ ...ks, origine: 'cursus' }, { dest: 'CI', depart: '2026-11-20', retour: '2026-11-10', motif: 'x' })!, /Dates et motif/);
  assert.match(refusAnnulation({ origine: 'keystone' }, '')!, /Motif/);
  assert.equal(refusAnnulation({ origine: 'cursus' }, ''), null);
  assert.match(refusAnnulation({ origine: 'cursus' }, 'x'.repeat(501))!, /trop long/);
});

test('voyage.modifier : mêmes contrôles qu’à la création, le déplacement lui-même exclu ; Keystone prévenu de nouvelles dates', () => {
  const { db, run, refus, journal, envois, RH, KARIM } = fresh();
  // Nadia Kaci (9) : Inde du 19 au 24 octobre, Arabie saoudite du 23 au 26 novembre (créé dans Cursus).
  const sa = voyageDe(db, 9, 'SA');
  refus(RH, 'voyage.modifier', { id: sa.id, depart: '2026-10-20', retour: '2026-10-25' }, /Déplacement déjà prévu/);
  // Chevauche ses propres anciennes dates : accepté.
  assert.match(run(RH, 'voyage.modifier', { id: sa.id, depart: '2026-11-22', retour: '2026-11-25', motif: 'Négociation distributeur — Riyad et Djeddah' }), /Déplacement modifié — Nadia Kaci, Arabie saoudite/);
  assert.deepEqual([db.get<Ligne>('voyages', sa.id)!.depart, db.get<Ligne>('voyages', sa.id)!.motif], ['2026-11-22', 'Négociation distributeur — Riyad et Djeddah']);
  refus(RH, 'voyage.modifier', { id: sa.id, depart: '2026-11-22', retour: '2026-11-25' }, /Aucune modification/);
  // Journal : destination et dates avant et après, jamais le motif (texte libre).
  const j = journal('voyage.modifier')[0];
  assert.deepEqual(j.payload, { id: sa.id, avant: { depart: '2026-11-23', retour: '2026-11-26' }, apres: { depart: '2026-11-22', retour: '2026-11-25' } });
  assert.ok(!JSON.stringify(j).includes('Djeddah'));
  assert.equal(envois('deplacement.modifie').length, 0, 'déplacement créé dans Cursus : rien pour Keystone');

  // Karim Haddad (12) : Côte d'Ivoire, chantier K-2611, venu de Keystone.
  const ci = voyageDe(db, 12, 'CI');
  refus(RH, 'voyage.modifier', { id: ci.id, dest: 'MA', depart: ci.depart, retour: ci.retour }, /seules ses dates/);
  refus(RH, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: ci.retour, motif: 'Autre motif' }, /seules ses dates/);
  run(RH, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: '2026-11-25' });
  const [e] = envois('deplacement.modifie');
  assert.deepEqual(e.contenu, { deplacement: ci.id, demande: null, reference: null, matricule: 'EMP-0012', chantier: 'K-2611', destination: 'CI', depart: ci.depart, retour: '2026-11-25', date: '2026-10-10' });
  // Manager : refusé (service RH seulement).
  refus(KARIM, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: '2026-11-24' }, /./, 403);
});

test('voyage.annuler : historique gardé, hors du dossier, du Go / No Go et des conflits ; Keystone prévenu sans le motif', () => {
  const { db, run, refus, domain, journal, envois, RH, user } = fresh();
  const ci = voyageDe(db, 12, 'CI');
  const avant = domain();
  assert.ok(avant.tripsAll().some(t => t.id === ci.id));
  assert.ok(blocage(conflitsDates(avant, 12, '2026-11-10', '2026-11-12', 'voyage')));
  refus(RH, 'voyage.annuler', { id: ci.id }, /Motif de l’annulation requis/);
  assert.match(run(RH, 'voyage.annuler', { id: ci.id, motif: 'Chantier reporté par le client' }), /Déplacement annulé — Karim Haddad, Côte d’Ivoire .* Keystone prévenu/);
  const v = db.get<Ligne>('voyages', ci.id)!;
  assert.deepEqual([v.annuleLe, v.annulePar, v.annuleMotif], ['2026-10-10', 'Sandrine Vidal', 'Chantier reporté par le client']);
  // Hors de tous les calculs, gardé dans l'historique.
  const d = domain();
  assert.ok(!d.tripsAll().some(t => t.id === ci.id));
  assert.deepEqual(voyagesAnnules(d.ds.voyages).map(t => t.id), [ci.id]);
  assert.equal(blocage(conflitsDates(d, 12, '2026-11-10', '2026-11-12', 'voyage')), null);
  assert.ok(!controleSortie(d, d.emp(12)!, '2026-10-31').avertissements.some(a => a.includes('Côte d’Ivoire')));
  run(RH, 'voyage.creer', { empId: 12, dest: 'CI', depart: '2026-11-10', retour: '2026-11-12', motif: 'Repérage' });
  // Keystone : période, chantier, référence ; jamais le motif.
  const [e] = envois('deplacement.annule');
  assert.equal(e.contenu.deplacement, ci.id);
  assert.ok(!JSON.stringify(e.contenu).includes('reporté'));
  // Journal : date de l'annulation, motif seulement « renseigné ».
  const j = journal('voyage.annuler')[0];
  assert.deepEqual(j.payload.apres, { annuleLe: '2026-10-10', annuleMotif: '[texte renseigné]' });
  assert.ok(!JSON.stringify(j).includes('reporté'));
  // Déjà annulé : ni nouvelle annulation, ni modification, ni formalités de détachement.
  refus(RH, 'voyage.annuler', { id: ci.id, motif: 'x' }, /déjà annulé/, 409);
  refus(RH, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: ci.retour }, /déjà annulé/, 409);
  refus(RH, 'voyage.detachement', { id: ci.id, informationLe: '2026-10-09' }, /annulé/, 409);
  // Le motif (texte libre du service RH) ne quitte pas le service RH.
  assert.equal(buildSnapshot(db, user(12, 'collaborateur')).voyages.find(x => x.id === ci.id)!.annuleMotif, null);
  assert.equal(buildSnapshot(db, user(23, 'rh')).voyages.find(x => x.id === ci.id)!.annuleMotif, null, 'référent HSE');
  assert.equal(buildSnapshot(db, RH).voyages.find(x => x.id === ci.id)!.annuleMotif, 'Chantier reporté par le client');
  // Déplacement créé dans Cursus : motif facultatif, rien pour Keystone.
  run(RH, 'voyage.annuler', { id: voyageDe(db, 9, 'SA').id });
  assert.equal(envois('deplacement.annule').length, 1);
});

test('voyage.annuler : un déplacement Keystone annulé ne bloque plus l’acceptation d’une nouvelle demande du chantier', () => {
  const { db, run, domain, envois, RH } = fresh();
  const dm = db.all<Ligne>('demandesKeystone').find(x => x.ref === 'DK-2026-0412')!;
  const { result } = db.tx(() => ACTIONS['keystone.accepter'](makeCtx(db, RH, loadFull(db, RH)), { id: dm.id })) as { result: { id: number } };
  run(RH, 'voyage.annuler', { id: result.id, motif: 'Ressource remplacée' });
  const [e] = envois('deplacement.annule');
  assert.deepEqual([e.contenu.demande, e.contenu.reference, e.contenu.chantier], [dm.id, 'DK-2026-0412', 'K-2611']);
  // Nouvelle demande, mêmes chantier et dates : acceptée, le déplacement annulé ne compte plus.
  const nouvelle = db.insert<Ligne>('demandesKeystone', { ...dm, id: undefined, ref: 'DK-2026-0499', statut: 'attente', decidee: null, decideur: null, voyageId: null });
  run(RH, 'keystone.accepter', { id: nouvelle.id });
  assert.equal(domain().tripsAll().filter(t => t.empId === 18 && t.chantier === 'K-2611').length, 1);
});

// — Entretiens —

test('entretien.annuler : évaluateur ou RH, .ics d’annulation au salarié, obligation de nouveau à planifier', () => {
  const { db, run, refus, journal, envois, RH, KARIM, MEHDI } = fresh();
  const id = (db.sql.prepare(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`).get() as { id: number }).id;
  const x = db.get<Ligne>('entretiens', id)!;
  refus(MEHDI, 'entretien.annuler', { id }, /réservée à l’évaluateur/, 403);
  assert.match(run(KARIM, 'entretien.annuler', { id }), /annulé — Mehdi Benali · annulation envoyée au salarié/);
  assert.equal(db.get('entretiens', id), undefined);
  const [mail] = envois('convocation.annulee');
  assert.deepEqual(mail.contenu.a, ['mehdi.benali@entreprise.example']);
  const ics = Buffer.from(mail.contenu.pj[0].base64, 'base64').toString('utf8');
  assert.match(ics, /METHOD:CANCEL/);
  assert.match(ics, new RegExp(`UID:entretien-${id}@cursus\\.example\\.fr`));
  assert.match(ics, /STATUS:CANCELLED/);
  // Journal : type, date et statut de l'entretien retiré, rattaché au salarié.
  const j = journal('entretien.annuler')[0];
  assert.deepEqual(j.payload.avant, { type: x.type, date: x.date, statut: 'planifie' });
  assert.deepEqual(j.salaries, [2]);
  refus(RH, 'entretien.annuler', { id }, /introuvable/, 404);
});

test('entretien.annuler : compte rendu commencé, sur confirmation seulement ; entretien clos, jamais', () => {
  const { db, run, refus, KARIM, RH } = fresh();
  run(KARIM, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const id = (db.sql.prepare(`SELECT id FROM entretiens WHERE emp_id = 2 AND type = 'epp' AND statut = 'planifie'`).get() as { id: number }).id;
  run(KARIM, 'entretien.modifier', { id, section: 'competences', value: 'Premiers échanges' });
  refus(KARIM, 'entretien.annuler', { id }, /compte rendu commencé/, 409);
  run(RH, 'entretien.annuler', { id, confirmer: true });
  assert.equal(db.get('entretiens', id), undefined);
  // Entretien clos : ni annulation, ni reprise du compte rendu.
  const annuel = (db.sql.prepare(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`).get() as { id: number }).id;
  run(KARIM, 'entretien.clore', { id: annuel, date: '2026-10-08' });
  refus(KARIM, 'entretien.annuler', { id: annuel, confirmer: true }, /déjà clos/, 409);
});

test('obligations : un entretien planifié à une date dépassée est en retard, « Planifié, date dépassée »', () => {
  const { db, run, domain, KARIM } = fresh();
  run(KARIM, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const epp = () => obligations(domain(), [2]).find(o => o.kind === 'epp')!;
  assert.equal(epp().st, 'planifie');
  assert.deepEqual(statutObligation(epp()), ['Planifié', 'tag-neutral']);
  db.sql.exec(`UPDATE entretiens SET date = '2026-10-01' WHERE emp_id = 2 AND type = 'epp' AND statut = 'planifie'`);
  assert.equal(epp().st, 'late');
  assert.deepEqual(statutObligation(epp()), ['Planifié, date dépassée', 'tag-accent']);
  // Annulé : l'obligation n'est plus planifiée.
  const id = epp().pl!.id;
  run(KARIM, 'entretien.annuler', { id });
  assert.equal(epp().pl, undefined);
});
