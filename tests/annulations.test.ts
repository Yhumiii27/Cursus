// Tests du chantier « entretiens, plan de formation et déplacements », étape 2, t126 : modification et annulation d'un
// déplacement (Keystone prévenu pour un déplacement venu de Keystone, déplacement annulé hors de tous les calculs mais
// gardé dans l'historique), annulation d'un entretien planifié (.ics d'annulation, compte rendu commencé sur
// confirmation), entretien planifié à une date dépassée compté en retard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_PUBLIC_URL = 'https://cursus.example.fr';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET', 'CURSUS_OIDC_TENANT', 'CURSUS_OIDC_CLIENT_ID', 'CURSUS_OIDC_CLIENT_SECRET', 'KEYSTONE_URL']) delete process.env[k];

const { nouvelleBase } = await import('./base.ts');
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
const { annulationEntretien } = await import('../client/src/state/confirmations-annulations.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ligne = Record<string, any>;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace au journal après). */
async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown> = {}) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message as string;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} : refus attendu ${motif}`);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(j => j.action === action);
  const envois = async (type: string) => (await db.all<Ligne>('envois')).filter(e => e.type === type);
  return { db, run, refus, domain, journal, envois, user, RH, KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur') };
}
const voyageDe = async (db: import('../server/src/db.ts').Db, empId: number, dest: string) => (await db.all<Ligne>('voyages')).find(v => v.empId === empId && v.dest === dest)!;

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

test('voyage.modifier : mêmes contrôles qu’à la création, le déplacement lui-même exclu ; Keystone prévenu de nouvelles dates', async () => {
  const { db, run, refus, journal, envois, RH, KARIM } = await fresh();
  // Nadia Kaci (9) : Inde du 19 au 24 octobre, Arabie saoudite du 23 au 26 novembre (créé dans Cursus).
  const sa = await voyageDe(db, 9, 'SA');
  await refus(RH, 'voyage.modifier', { id: sa.id, depart: '2026-10-20', retour: '2026-10-25' }, /Déplacement déjà prévu/);
  // Chevauche ses propres anciennes dates : accepté.
  assert.match(await run(RH, 'voyage.modifier', { id: sa.id, depart: '2026-11-22', retour: '2026-11-25', motif: 'Négociation distributeur — Riyad et Djeddah' }), /Déplacement modifié — Nadia Kaci, Arabie saoudite/);
  assert.deepEqual([(await db.get<Ligne>('voyages', sa.id))!.depart, (await db.get<Ligne>('voyages', sa.id))!.motif], ['2026-11-22', 'Négociation distributeur — Riyad et Djeddah']);
  await refus(RH, 'voyage.modifier', { id: sa.id, depart: '2026-11-22', retour: '2026-11-25' }, /Aucune modification/);
  // Journal : destination et dates avant et après, jamais le motif (texte libre).
  const j = (await journal('voyage.modifier'))[0];
  assert.deepEqual(j.payload, { id: sa.id, avant: { depart: '2026-11-23', retour: '2026-11-26' }, apres: { depart: '2026-11-22', retour: '2026-11-25' } });
  assert.ok(!JSON.stringify(j).includes('Djeddah'));
  assert.equal((await envois('deplacement.modifie')).length, 0, 'déplacement créé dans Cursus : rien pour Keystone');

  // Karim Haddad (12) : Côte d'Ivoire, chantier K-2611, venu de Keystone.
  const ci = await voyageDe(db, 12, 'CI');
  await refus(RH, 'voyage.modifier', { id: ci.id, dest: 'MA', depart: ci.depart, retour: ci.retour }, /seules ses dates/);
  await refus(RH, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: ci.retour, motif: 'Autre motif' }, /seules ses dates/);
  await run(RH, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: '2026-11-25' });
  const [e] = await envois('deplacement.modifie');
  assert.deepEqual(e.contenu, { deplacement: ci.id, demande: null, reference: null, matricule: 'EMP-0012', chantier: 'K-2611', destination: 'CI', depart: ci.depart, retour: '2026-11-25', date: '2026-10-10' });
  // Manager : refusé (service RH seulement).
  await refus(KARIM, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: '2026-11-24' }, /./, 403);
});

test('voyage.modifier : autre pays ou période élargie, formalités de détachement à refaire ; dates resserrées, certificat gardé', async () => {
  const { db, run, domain, journal, RH } = await fresh();
  await run(RH, 'voyage.creer', { empId: 3, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Rétrofit — Tanger' });
  const t = (await db.all<Ligne>('voyages')).find(v => v.empId === 3 && v.dest === 'MA')!;
  await run(RH, 'voyage.detachement', { id: t.id, detachementLe: '2026-10-05' });
  const certificat = async () => (await domain()).readiness((await domain()).emp(3)!, await db.get<Ligne>('voyages', t.id) as any).items.find(i => i.k === 'detachement')!;
  assert.ok((await certificat()).ok);
  // Dates resserrées dans la période couverte : le certificat vaut toujours.
  await run(RH, 'voyage.modifier', { id: t.id, depart: '2026-11-03', retour: '2026-11-06' });
  assert.equal((await db.get<Ligne>('voyages', t.id))!.detachementLe, '2026-10-05');
  // Ghana (pays sans convention) : le certificat obtenu pour le Maroc ne le couvre pas, le dossier redevient incomplet.
  assert.match(await run(RH, 'voyage.modifier', { id: t.id, dest: 'GH', depart: '2026-11-03', retour: '2026-11-06' }), /formalités de détachement à refaire/);
  assert.equal((await db.get<Ligne>('voyages', t.id))!.detachementLe, null);
  assert.equal((await certificat()).ok, false);
  assert.deepEqual((await journal('voyage.modifier')).at(-1)!.payload.apres, { dest: 'GH', detachementLe: null });
  // Période élargie au-delà de celle du certificat : à refaire aussi ; mission devenue longue : information écrite à remettre.
  await run(RH, 'voyage.detachement', { id: t.id, detachementLe: '2026-10-09' });
  await run(RH, 'voyage.modifier', { id: t.id, dest: 'GH', depart: '2026-11-03', retour: '2026-12-11' });
  assert.equal((await db.get<Ligne>('voyages', t.id))!.detachementLe, null);
  await run(RH, 'voyage.detachement', { id: t.id, detachementLe: '2026-10-09', informationLe: '2026-10-09' });
  await run(RH, 'voyage.modifier', { id: t.id, dest: 'GH', depart: '2026-11-03', retour: '2026-12-10' });
  const v = (await db.get<Ligne>('voyages', t.id))!;
  assert.deepEqual([v.detachementLe, v.informationLe], ['2026-10-09', null], 'durée changée : information écrite à refaire, certificat gardé');
});

test('voyage.annuler : historique gardé, hors du dossier, du Go / No Go et des conflits ; Keystone prévenu sans le motif', async () => {
  const { db, run, refus, domain, journal, envois, RH, user } = await fresh();
  const ci = await voyageDe(db, 12, 'CI');
  const avant = await domain();
  assert.ok(avant.tripsAll().some(t => t.id === ci.id));
  assert.ok(blocage(conflitsDates(avant, 12, '2026-11-10', '2026-11-12', 'voyage')));
  await refus(RH, 'voyage.annuler', { id: ci.id }, /Motif de l’annulation requis/);
  assert.match(await run(RH, 'voyage.annuler', { id: ci.id, motif: 'Chantier reporté par le client' }), /Déplacement annulé — Karim Haddad, Côte d’Ivoire .* Keystone prévenu/);
  const v = (await db.get<Ligne>('voyages', ci.id))!;
  assert.deepEqual([v.annuleLe, v.annulePar, v.annuleMotif], ['2026-10-10', 'Sandrine Vidal', 'Chantier reporté par le client']);
  // Hors de tous les calculs, gardé dans l'historique.
  const d = await domain();
  assert.ok(!d.tripsAll().some(t => t.id === ci.id));
  assert.deepEqual(voyagesAnnules(d.ds.voyages).map(t => t.id), [ci.id]);
  assert.equal(blocage(conflitsDates(d, 12, '2026-11-10', '2026-11-12', 'voyage')), null);
  assert.ok(!controleSortie(d, d.emp(12)!, '2026-10-31').avertissements.some(a => a.includes('Côte d’Ivoire')));
  await run(RH, 'voyage.creer', { empId: 12, dest: 'CI', depart: '2026-11-10', retour: '2026-11-12', motif: 'Repérage' });
  // Keystone : période, chantier, référence ; jamais le motif.
  const [e] = await envois('deplacement.annule');
  assert.equal(e.contenu.deplacement, ci.id);
  assert.ok(!JSON.stringify(e.contenu).includes('reporté'));
  // Journal : date de l'annulation, motif seulement « renseigné ».
  const j = (await journal('voyage.annuler'))[0];
  assert.deepEqual(j.payload.apres, { annuleLe: '2026-10-10', annuleMotif: '[texte renseigné]' });
  assert.ok(!JSON.stringify(j).includes('reporté'));
  // Déjà annulé : ni nouvelle annulation, ni modification, ni formalités de détachement.
  await refus(RH, 'voyage.annuler', { id: ci.id, motif: 'x' }, /déjà annulé/, 409);
  await refus(RH, 'voyage.modifier', { id: ci.id, depart: ci.depart, retour: ci.retour }, /déjà annulé/, 409);
  await refus(RH, 'voyage.detachement', { id: ci.id, informationLe: '2026-10-09' }, /annulé/, 409);
  // Le motif (texte libre du service RH) ne quitte pas le service RH.
  assert.equal((await buildSnapshot(db, await user(12, 'collaborateur'))).voyages.find(x => x.id === ci.id)!.annuleMotif, null);
  assert.equal((await buildSnapshot(db, await user(23, 'rh'))).voyages.find(x => x.id === ci.id)!.annuleMotif, null, 'référent HSE');
  assert.equal((await buildSnapshot(db, RH)).voyages.find(x => x.id === ci.id)!.annuleMotif, 'Chantier reporté par le client');
  // Déplacement créé dans Cursus : motif facultatif, rien pour Keystone.
  await run(RH, 'voyage.annuler', { id: (await voyageDe(db, 9, 'SA')).id });
  assert.equal((await envois('deplacement.annule')).length, 1);
});

test('voyage.annuler : un déplacement Keystone annulé ne bloque plus l’acceptation d’une nouvelle demande du chantier', async () => {
  const { db, run, domain, envois, RH } = await fresh();
  const dm = (await db.all<Ligne>('demandesKeystone')).find(x => x.ref === 'DK-2026-0412')!;
  const { result } = await db.tx(async () => await ACTIONS['keystone.accepter'](makeCtx(db, RH, await loadFull(db, RH)), { id: dm.id })) as { result: { id: number } };
  await run(RH, 'voyage.annuler', { id: result.id, motif: 'Ressource remplacée' });
  const [e] = await envois('deplacement.annule');
  assert.deepEqual([e.contenu.demande, e.contenu.reference, e.contenu.chantier], [dm.id, 'DK-2026-0412', 'K-2611']);
  // Nouvelle demande, mêmes chantier et dates : acceptée, le déplacement annulé ne compte plus.
  const nouvelle = await db.insert<Ligne>('demandesKeystone', { ...dm, id: undefined, ref: 'DK-2026-0499', statut: 'attente', decidee: null, decideur: null, voyageId: null });
  await run(RH, 'keystone.accepter', { id: nouvelle.id });
  assert.equal((await domain()).tripsAll().filter(t => t.empId === 18 && t.chantier === 'K-2611').length, 1);
});

// — Entretiens —

test('entretien.annuler : évaluateur ou RH, .ics d’annulation au salarié, obligation de nouveau à planifier', async () => {
  const { db, run, refus, journal, envois, RH, KARIM, MEHDI } = await fresh();
  const id = ((await db.one(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`)) as { id: number }).id;
  const x = (await db.get<Ligne>('entretiens', id))!;
  await refus(MEHDI, 'entretien.annuler', { id }, /réservée à l’évaluateur/, 403);
  assert.match(await run(KARIM, 'entretien.annuler', { id }), /annulé — Mehdi Benali · annulation envoyée au salarié/);
  assert.equal(await db.get('entretiens', id), undefined);
  const [mail] = await envois('convocation.annulee');
  assert.deepEqual(mail.contenu.a, ['mehdi.benali@entreprise.example']);
  const ics = Buffer.from(mail.contenu.pj[0].base64, 'base64').toString('utf8');
  assert.match(ics, /METHOD:CANCEL/);
  assert.match(ics, new RegExp(`UID:entretien-${id}@cursus\\.example\\.fr`));
  assert.match(ics, /STATUS:CANCELLED/);
  // Journal : type, date et statut de l'entretien retiré, rattaché au salarié.
  const j = (await journal('entretien.annuler'))[0];
  assert.deepEqual(j.payload.avant, { type: x.type, date: x.date, statut: 'planifie' });
  assert.deepEqual(j.salaries, [2]);
  await refus(RH, 'entretien.annuler', { id }, /introuvable/, 404);
});

test('entretien.annuler : compte rendu commencé, sur confirmation seulement ; entretien clos, jamais', async () => {
  const { db, run, refus, KARIM, RH } = await fresh();
  await run(KARIM, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const id = ((await db.one(`SELECT id FROM entretiens WHERE emp_id = 2 AND type = 'epp' AND statut = 'planifie'`)) as { id: number }).id;
  await run(KARIM, 'entretien.modifier', { id, section: 'competences', value: 'Premiers échanges' });
  await refus(KARIM, 'entretien.annuler', { id }, /compte rendu commencé/, 409);
  await run(RH, 'entretien.annuler', { id, confirmer: true });
  assert.equal(await db.get('entretiens', id), undefined);
  // Entretien clos : ni annulation, ni reprise du compte rendu.
  const annuel = ((await db.one(`SELECT id FROM entretiens WHERE emp_id = 2 AND statut = 'planifie'`)) as { id: number }).id;
  await run(KARIM, 'entretien.clore', { id: annuel, date: '2026-10-08' });
  await refus(KARIM, 'entretien.annuler', { id: annuel, confirmer: true }, /déjà clos/, 409);
});

test('entretien.annuler : compte rendu écrit par le salarié depuis la dernière relecture, annulation non confirmée refusée', async () => {
  const { db, run, refus, KARIM, MEHDI } = await fresh();
  await run(KARIM, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const x = (await db.all<Ligne>('entretiens')).find(y => y.empId === 2 && y.type === 'epp' && y.statut === 'planifie')!;
  // L'évaluateur a ouvert l'entretien vierge : la confirmation n'annonce aucune suppression, et n'envoie pas `confirmer`.
  const c = annulationEntretien(x as any, 'Mehdi Benali', { crCommence: false, passe: false });
  assert.deepEqual(c.payload, { id: x.id });
  // Entre-temps, le salarié rédige sa section depuis son portail.
  await run(MEHDI, 'entretien.modifier', { id: x.id, section: 'parcours', value: 'Évoluer vers la maintenance' });
  await refus(KARIM, 'entretien.annuler', c.payload!, /compte rendu commencé/, 409);
  assert.ok(await db.get('entretiens', x.id), 'entretien et compte rendu du salarié conservés');
  // Rouverte sur des données à jour, la confirmation annonce la suppression et la confirme.
  assert.deepEqual(annulationEntretien(x as any, 'Mehdi Benali', { crCommence: true, passe: false }).payload, { id: x.id, confirmer: true });
});

test('obligations : entretien annuel de l’année planifié à une date dépassée, en retard ; clos, plus rien', async () => {
  const { db, run, domain, KARIM } = await fresh();
  const annuel = async () => obligations(await domain(), [2]).find(o => o.kind === 'annuel');
  const x = (await db.all<Ligne>('entretiens')).find(y => y.empId === 2 && y.type === 'annuel' && y.statut === 'planifie')!;
  assert.equal(await annuel(), undefined, 'planifié à venir : rien à traiter');
  await db.exec(`UPDATE entretiens SET date = '2026-10-05' WHERE id = ${x.id}`);
  const o = (await annuel())!;
  assert.equal(o.st, 'late');
  assert.equal(o.pl!.id, x.id);
  assert.deepEqual(statutObligation(o), ['Planifié, date dépassée', 'tag-accent']);
  await run(KARIM, 'entretien.clore', { id: x.id, date: '2026-10-05' });
  assert.equal(await annuel(), undefined);
});

test('obligations : un entretien planifié à une date dépassée est en retard, « Planifié, date dépassée »', async () => {
  const { db, run, domain, KARIM } = await fresh();
  await run(KARIM, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const epp = async () => obligations(await domain(), [2]).find(o => o.kind === 'epp')!;
  assert.equal((await epp()).st, 'planifie');
  assert.deepEqual(statutObligation(await epp()), ['Planifié', 'tag-neutral']);
  await db.exec(`UPDATE entretiens SET date = '2026-10-01' WHERE emp_id = 2 AND type = 'epp' AND statut = 'planifie'`);
  assert.equal((await epp()).st, 'late');
  assert.deepEqual(statutObligation(await epp()), ['Planifié, date dépassée', 'tag-accent']);
  // Annulé : l'obligation n'est plus planifiée.
  const id = (await epp()).pl!.id;
  await run(KARIM, 'entretien.annuler', { id });
  assert.equal((await epp()).pl, undefined);
});
