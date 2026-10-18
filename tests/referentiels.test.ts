// Référentiels administrés dans Cursus (t110) : catalogue vide en production et référentiel type, création et
// modification contrôlées (codes, validités, prérequis, formalités d'entrée), archivage au lieu de la suppression,
// effet d'une validité modifiée sur les titres détenus, journal avant / après, échanges avec Keystone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { champsRetenus, journaliserAction, preparerTrace, REGLES } = await import('../server/src/journal.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { ROUTES_V1 } = await import('../server/src/integrations/keystone-routes.ts');
const { contexte } = await import('../server/src/integrations/keystone-entrant.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { Domain } = await import('../shared/domain.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const { parseTrips } = await import('../shared/rules/imports.ts');
const R = await import('../shared/rules/referentiels.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = InstanceType<typeof Db>;
interface Ligne { action: string; message: string | null; payload: Record<string, any>; salaries: number[] | null }

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace après). */
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) => await assert.rejects(async () => await run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} devait être refusé (${motif})`);
  const derniere = async (action: string) => (await db.all<Ligne>('journal')).findLast(j => j.action === action)!;
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  return { db, run, refuse, derniere, domain, RH, HSE: await user(23, 'rh'), LECTURE: await user(11, 'rh'), MEHDI: await user(2, 'collaborateur'), KARIM: await user(12, 'manager') };
}

const SST = { id: 'sst', nom: 'Sauveteur secouriste du travail (SST)', court: 'SST', type: 'Réglementaire', validite: 24, duree: '7 h (MAC)', organisme: 'Croix-Rouge française', cout: 180, validation: 'evaluation' };

test('base neuve : référentiels vides, puis référentiel type chargé une seule fois, habilitations après les formations', async () => {
  const db = new Db(':memory:');
  const RH = { role: 'rh', empId: null, nom: 'Responsable RH', intitule: '', profilRh: 'rh_admin' } as User;
  const HSE = { ...RH, profilRh: 'referent_hse' } as User;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => String(await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p)));
  const nombre = async (t: 'formations' | 'habilitations' | 'destinations') => (await loadFull(db, RH)).referentiels[t].length;
  assert.deepEqual([await nombre('formations'), await nombre('habilitations'), await nombre('destinations')], [0, 0, 0]);
  await assert.rejects(async () => await run(RH, 'referentiel.charger', { referentiel: 'habilitations' }), /Formations prérequises absentes du catalogue .*chargez d’abord le catalogue type des formations/);
  assert.match(await run(HSE, 'referentiel.charger', { referentiel: 'formations' }), /^11 formations du référentiel type ajoutées : à vérifier/);
  assert.match(await run(HSE, 'referentiel.charger', { referentiel: 'habilitations' }), /^6 habilitations/);
  await assert.rejects(async () => await run(HSE, 'referentiel.charger', { referentiel: 'destinations' }), (e: unknown) => e instanceof ActionError && e.status === 403, 'destinations : service RH');
  assert.match(await run(RH, 'referentiel.charger', { referentiel: 'destinations' }), /^8 destinations/);
  assert.deepEqual([await nombre('formations'), await nombre('habilitations'), await nombre('destinations')], [11, 6, 8]);
  await assert.rejects(async () => await run(RH, 'referentiel.charger', { referentiel: 'formations' }), /déjà rempli : le référentiel type ne se charge que dans un référentiel vide/);
  await assert.rejects(async () => await run(RH, 'referentiel.charger', { referentiel: 'salaries' }), /Référentiel inconnu/);
  // Repris tels quels de la démonstration, en vigueur.
  const f = (await loadFull(db, RH)).referentiels.formations.find(x => x.id === 'caces489')!;
  assert.deepEqual([f.validite, f.validation, f.archive], [60, 'evaluation', null]);
  assert.deepEqual((await loadFull(db, RH)).referentiels.habilitations.find(h => h.id === 'he')!.prereqs, ['elec']);
});

test('référentiel type des habilitations : jamais chargé en vigueur sur une formation prérequise archivée', async () => {
  const db = new Db(':memory:');
  const HSE = { role: 'rh', empId: null, nom: 'Référent HSE', intitule: '', profilRh: 'referent_hse' } as User;
  const run = async (name: string, p: Record<string, unknown>) => await db.tx(async () => String(await ACTIONS[name](makeCtx(db, HSE, await loadFull(db, HSE)), p)));
  await run('referentiel.charger', { referentiel: 'formations' });
  // Aucune habilitation ne l'exige encore : la formation AIPR s'archive…
  await run('referentiel.formation.archiver', { id: 'aipr' });
  // … mais l'habilitation AIPR, chargée en vigueur, l'exigerait sans que personne ne puisse plus l'obtenir.
  await assert.rejects(async () => await run('referentiel.charger', { referentiel: 'habilitations' }),
    (e: unknown) => e instanceof ActionError && e.message === '1 formation prérequise archivée : AIPR — rétablissez-la d’abord (onglet Formations), puis chargez le référentiel type');
  assert.equal((await loadFull(db, HSE)).referentiels.habilitations.length, 0, 'rien de chargé');
  await run('referentiel.formation.archiver', { id: 'aipr', archive: false });
  assert.match(await run('referentiel.charger', { referentiel: 'habilitations' }), /^6 habilitations/);
});

test('formation : création contrôlée (code, intitulé, validité, coût), modification tracée avant / après', async () => {
  const { run, refuse, derniere, domain, HSE } = await fresh();
  const nouvelle = { code: 'CACES485', nom: 'CACES R485 — Gerbeurs', court: 'CACES R485', type: 'Réglementaire', validite: '60', duree: '14 h', organisme: 'AFTRAL', cout: '450,50', validation: 'evaluation' };
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, code: 'sst' }, /Ce code désigne déjà une formation/);
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, code: 'autre' }, /Code réservé/);
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, code: 'caces 485' }, /lettres minuscules sans accent/);
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, validite: '0' }, /Validité en mois : nombre entier de 1 à 240/);
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, nom: 'sauveteur secouriste du travail (SST)' }, /porte déjà cet intitulé/);
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, cout: '-5' }, /Coût en euros/);
  await refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, id: 'inconnue' }, /Formation introuvable/, 404);
  assert.equal(await run(HSE, 'referentiel.formation.enregistrer', nouvelle), 'Formation « CACES R485 » ajoutée au catalogue');
  const f = (await domain()).fm('caces485');
  assert.deepEqual([f.validite, f.cout, f.type, f.archive], [60, 450.5, 'Réglementaire', null], 'code en minuscules, nombres lus en français');
  assert.ok((await domain()).forms(false).some(x => x.id === 'caces485'), 'proposée dans les listes');
  const cree = await derniere('referentiel.formation.enregistrer');
  assert.equal(cree.payload.code, 'caces485', 'code normalisé comme l’action');
  assert.deepEqual(cree.payload.apres, { nom: 'CACES R485 — Gerbeurs', court: 'CACES R485', type: 'Réglementaire', validite: 60, duree: '14 h', organisme: 'AFTRAL', cout: 450.5, validation: 'evaluation' });
  // Modification : le code ne change pas, seules les valeurs modifiées sont tracées.
  await run(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, id: 'caces485', code: 'ignore', organisme: 'Apave', cout: 480 });
  const modif = await derniere('referentiel.formation.enregistrer');
  assert.deepEqual([modif.payload.avant, modif.payload.apres], [{ organisme: 'AFTRAL', cout: 450.5 }, { organisme: 'Apave', cout: 480 }]);
  assert.equal((await domain()).fm('ignore'), undefined);
  assert.ok(REGLES['referentiel.formation.enregistrer'] && JOURNAL_LABEL['referentiel.formation.enregistrer']);
  assert.equal(familleAction('referentiel.charger')!.id, 'referentiels');
});

test('validité modifiée : échéances existantes recalculées, titres devenus échus annoncés avant l’enregistrement', async () => {
  const { db, run, domain, derniere, RH } = await fresh();
  const d = await domain();
  // SST de 24 à 12 mois : les certifications obtenues il y a plus d'un an deviennent échues.
  const effet = R.effetModification(d.ds, 'formations', { ...d.fm('sst'), validite: 12 });
  assert.ok(effet.echus.length >= 3, `${effet.echus.length} titres échus`);
  assert.ok(effet.echus.some(t => t.nom === 'Mehdi Benali' && t.titre === 'SST'), 'SST du 3 mai 2025');
  assert.deepEqual(effet.retablis, []);
  assert.match(R.titresTexte(effet.echus), / et \d+ autres?$/);
  const msg = await run(RH, 'referentiel.formation.enregistrer', { ...SST, validite: 12 });
  assert.match(msg, new RegExp(`validité 24 → 12 mois, échéances recalculées · ${effet.echus.length} titres deviennent échus : `));
  const mehdi = (await domain()).enrich(90, false).find(e => e.id === 2)!;
  assert.equal(mehdi.certs.find(c => c.f === 'sst')!.key, 'exp', 'échéance recalculée à l’affichage');
  assert.deepEqual((await derniere('referentiel.formation.enregistrer')).payload.avant, { validite: 24 });
  // Retour à 24 mois : les mêmes titres redeviennent valides.
  assert.match(await run(RH, 'referentiel.formation.enregistrer', SST), new RegExp(`${effet.echus.length} titres redeviennent valides`));
  // Habilitation électrique de 36 à 12 mois : celle de Romain Chevalier (1er mars 2025) expire, No Go transmis à Keystone.
  await suivreVerdicts(db, { initial: true });
  const he = (await domain()).hm('he');
  assert.match(await run(RH, 'referentiel.habilitation.enregistrer', { ...he, id: 'he', validite: 12 }), /Romain Chevalier \(Habilitation électrique\)/);
  const changes = (await suivreVerdicts(db)).filter(v => v.empId === 18);
  assert.ok(changes.length > 0, 'verdict Go / No Go modifié signalé à Keystone');
});

test('archivage d’une formation : refusé tant qu’elle est exigée ou planifiée ; plus proposée ni suivie, gardée au dossier', async () => {
  const { db, run, refuse, domain, RH, HSE, MEHDI, KARIM } = await fresh();
  await refuse(HSE, 'referentiel.formation.archiver', { id: 'elec' }, /Prérequis de : Habilitation électrique/);
  await refuse(HSE, 'referentiel.formation.archiver', { id: 'rgpd' }, /1 session ouverte \(à venir ou à clôturer\)/);
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  assert.match(await run(HSE, 'referentiel.formation.archiver', { id: 'aipr' }), /archivée — plus proposée ni suivie ; les certifications restent au dossier/);
  assert.equal((await domain()).fm('aipr').archive, '2026-10-10');
  assert.ok(!(await domain()).forms(false).some(f => f.id === 'aipr'), 'plus proposée');
  // Romain Chevalier détient l'AIPR : certification au dossier (prérequis, Go / No Go), hors du statut et des échéances.
  const romain = async () => (await domain()).enrich(90, false).find(e => e.id === 18)!;
  assert.ok((await romain()).rawCerts.some(c => c.f === 'aipr'));
  assert.ok(!(await romain()).certs.some(c => c.f === 'aipr'));
  assert.ok(!(await domain()).echeances((await domain()).enrich(90, false), 90).some(x => x.kind === 'cert' && x.label === 'AIPR'));
  // Aucune nouvelle saisie sur une formation archivée.
  await refuse(RH, 'cert.ajouter', { empId: 2, f: 'aipr', date: '2026-10-01' }, /Formation archivée : rétablissez-la d’abord/);
  await refuse(RH, 'session.creer', { f: 'aipr', date: '2026-12-01', lieu: 'Lyon', places: 8 }, /Formation archivée/);
  await refuse(MEHDI, 'demande.formation', { f: 'aipr', motif: 'Chantier réseaux' }, /Formation archivée/);
  await refuse(KARIM, 'demande.formation', { f: 'aipr', motif: 'Chantier réseaux', empId: 2 }, /Formation archivée/);
  // Reconnue de Keystone (exigence d'un chantier) et listée dans GET /referentiels.
  assert.ok((await contexte(db)).formations.has('aipr'));
  // Rétablie : de nouveau proposée.
  assert.match(await run(HSE, 'referentiel.formation.archiver', { id: 'aipr', archive: false }), /rétablie au catalogue/);
  assert.equal((await domain()).fm('aipr').archive, null);
  await run(RH, 'cert.ajouter', { empId: 2, f: 'aipr', date: '2026-10-01' });
});

test('habilitation : prérequis du catalogue, archivage (titres au dossier, hors suivi), plus de délivrance ni de demande', async () => {
  const { run, refuse, derniere, domain, RH, HSE, MEHDI } = await fresh();
  const base = { code: 'chimie', nom: 'Autorisation produits chimiques', detail: 'Dépotage et transvasement', prereqs: ['atex', 'inconnue'], medical: true, validite: 36, signataire: 'Sarah Cohen' };
  await refuse(HSE, 'referentiel.habilitation.enregistrer', base, /Formation inconnue ou archivée : inconnue/);
  await refuse(HSE, 'referentiel.habilitation.enregistrer', { ...base, prereqs: ['atex'], signataire: ' ' }, /Indiquez le signataire/);
  assert.equal(await run(HSE, 'referentiel.habilitation.enregistrer', { ...base, prereqs: ['atex', 'atex'] }), 'Habilitation « Autorisation produits chimiques » ajoutée au référentiel');
  assert.deepEqual((await domain()).hm('chimie').prereqs, ['atex']);
  assert.deepEqual((await derniere('referentiel.habilitation.enregistrer')).payload.apres.prereqs, ['atex']);
  // Habilitation ATEX de Sophie Lemaire (n° 3) : archivée, son titre reste au dossier sans compter dans le suivi.
  const sophie = async () => (await domain()).enrich(90, false).find(e => e.id === 3)!;
  // Le chantier de Feyzin exige l'habilitation ATEX : verdicts inchangés par l'archivage (titres toujours reconnus).
  const feyzin = async () => { const d = await domain(); return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-2620')!.res.map(r => [r.e.id, r.status, r.reasons.map(x => x.code)]); };
  const verdicts = await feyzin();
  assert.ok(verdicts.some(([id]) => id === 3));
  assert.match(await run(HSE, 'referentiel.habilitation.archiver', { id: 'atex' }), /archivée — plus proposée ni suivie ; 3 titres restent au dossier/);
  const titre = (await sophie()).habs.find(h => h.h === 'atex')!;
  assert.match(titre.note, /Habilitation archivée au référentiel : plus suivie/);
  assert.equal((await domain()).habAction(3, titre), null, 'plus aucune action proposée');
  assert.ok(!(await domain()).echeances((await domain()).enrich(90, false), 90).some(x => x.kind === 'hab' && x.label === 'Habilitation ATEX'));
  await refuse(RH, 'hab.delivrer', { empId: 3, h: 'atex', date: '2026-10-10', par: 'Sarah Cohen', mode: 'renew' }, /Habilitation archivée/);
  await refuse(MEHDI, 'demande.habilitation', { h: 'atex', motif: 'Zone 1' }, /Habilitation archivée/);
  // Un prérequis déjà inscrit dont la formation est archivée depuis reste accepté ; un nouveau, non.
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  await run(HSE, 'referentiel.formation.archiver', { id: 'aipr' });
  const aipr = (await domain()).hm('aipr');
  assert.match(await run(HSE, 'referentiel.habilitation.enregistrer', { ...aipr, id: 'aipr', signataire: 'Sarah Cohen' }), /modifiée$/);
  await refuse(HSE, 'referentiel.habilitation.enregistrer', { ...base, code: 'reseaux', nom: 'Réseaux', prereqs: ['aipr'] }, /Formation inconnue ou archivée : aipr/);
  assert.deepEqual(await feyzin(), verdicts);
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'atex', archive: false });
  assert.equal((await domain()).hm('atex').archive, null);
});

test('habilitation rétablie : jamais avec un prérequis archivé, que plus personne ne pourrait obtenir', async () => {
  const { run, refuse, domain, HSE } = await fresh();
  // L'archivage de la formation n'est permis qu'une fois l'habilitation qui l'exige archivée…
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  await run(HSE, 'referentiel.formation.archiver', { id: 'aipr' });
  // … qui ne se rétablit pas avant elle (sinon : en vigueur, proposée, mais aucune certification AIPR possible).
  await refuse(HSE, 'referentiel.habilitation.archiver', { id: 'aipr', archive: false }, /^1 prérequis archivé : AIPR — rétablissez d’abord cette formation \(onglet Formations\), ou retirez-la de ses prérequis$/);
  assert.equal((await domain()).hm('aipr').archive, '2026-10-10');
  assert.deepEqual(R.prerequisArchives((await domain()).hm('aipr'), (await domain()).ds.referentiels.formations).map(f => f.id), ['aipr']);
  // Une habilitation en vigueur n'accepte pas de prérequis archivé, même déjà inscrit (donnée incohérente à corriger).
  const enVigueur = { ...(await domain()).hm('aipr'), archive: null };
  const { erreurs } = R.controlerHabilitation({ ...enVigueur }, [enVigueur], (await domain()).ds.referentiels.formations, 'aipr');
  assert.equal(erreurs.prereqs, 'Formation inconnue ou archivée : aipr.');
  // Dans l'ordre : la formation, puis l'habilitation.
  await run(HSE, 'referentiel.formation.archiver', { id: 'aipr', archive: false });
  assert.match(await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr', archive: false }), /rétablie au référentiel/);
  assert.equal((await domain()).hm('aipr').archive, null);
  // Ou bien le prérequis retiré de l'habilitation archivée, qui se rétablit alors sans lui.
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  await run(HSE, 'referentiel.formation.archiver', { id: 'aipr' });
  await run(HSE, 'referentiel.habilitation.enregistrer', { ...(await domain()).hm('aipr'), id: 'aipr', prereqs: [] });
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr', archive: false });
  assert.deepEqual([(await domain()).hm('aipr').archive, (await domain()).hm('aipr').prereqs], [null, []]);
});

test('demandes déposées avant l’archivage : acceptation refusée, annoncées à l’archivage et dans sa confirmation', async () => {
  const { db, run, refuse, domain, RH, HSE, MEHDI } = await fresh();
  const C = await import('../client/src/state/confirmations-referentiels.ts');
  const attente = async (q: Record<string, unknown>) => (await db.all<{ id: number; empId: number; statut: string } & Record<string, unknown>>('demandesCollab'))
    .find(r => r.empId === 2 && r.statut === 'attente' && Object.entries(q).every(([k, v]) => r[k] === v))!;
  // Mehdi Benali : AIPR demandée et acceptée (titre en attente de délivrance), nacelles R486 et formation AIPR demandées.
  await run(MEHDI, 'demande.habilitation', { h: 'aipr', motif: 'Chantier réseaux' });
  assert.match(await run(RH, 'demande.accepter', { id: (await attente({ h: 'aipr' })).id }), /en attente de délivrance/);
  await run(MEHDI, 'demande.habilitation', { h: 'ac486', motif: 'Maintenance en hauteur' });
  await run(MEHDI, 'demande.formation', { f: 'aipr', motif: 'Chantier réseaux' });
  const ds = (await domain()).ds;
  assert.deepEqual([R.titresADelivrer(ds, 'aipr'), R.demandesEnAttente(ds, 'habilitations', 'ac486'), R.demandesEnAttente(ds, 'formations', 'aipr')], [1, 1, 1]);
  assert.equal(R.demandesEnAttente(ds, 'habilitations', 'aipr'), 0, 'demande acceptée : plus en attente');
  // Confirmations : titres demandés qui sortent de « En attente », demandes qui ne pourront plus qu'être refusées.
  const h = C.archivageHabilitation((await domain()).hm('aipr'), 1, { demandes: 0, aDelivrer: 1 });
  assert.ok(h.suites!.includes('1 titre demandé attend sa délivrance : il quitte l’écran Habilitations et ne se délivre plus, sauf à rétablir l’habilitation.'));
  const f = C.archivageFormation((await domain()).fm('aipr'), 1, 2);
  assert.ok(f.suites!.includes('2 demandes de collaborateurs attendent une réponse (tableau de bord) : elles ne pourront plus qu’être refusées, sauf à rétablir la formation.'));
  assert.ok(!C.archivageFormation((await domain()).fm('aipr'), 1).suites!.some(x => /attend/.test(x)));
  // Archivage : le message reprend ce qui reste en attente.
  assert.match(await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' }), / · 1 titre demandé reste à délivrer après rétablissement$/);
  assert.match(await run(HSE, 'referentiel.habilitation.archiver', { id: 'ac486' }), / · 1 demande en attente : à refuser, ou à accepter après rétablissement$/);
  assert.match(await run(HSE, 'referentiel.formation.archiver', { id: 'aipr' }), / · 1 demande en attente : à refuser, ou à accepter après rétablissement$/);
  // Acceptation refusée : rien ne pourrait aboutir (délivrance, session). Ni titre « en attente », ni action du plan.
  const titres = (await db.all('habTitres')).length, plan = (await db.all('planActions')).length;
  await refuse(RH, 'demande.accepter', { id: (await attente({ h: 'ac486' })).id }, /^Habilitation archivée : rétablissez-la d’abord \(écran Référentiels\), ou refusez la demande$/);
  await refuse(HSE, 'demande.accepter', { id: (await attente({ type: 'formation', f: 'aipr' })).id }, /^Formation archivée : rétablissez-la d’abord \(écran Référentiels\), ou refusez la demande$/);
  assert.deepEqual([(await db.all('habTitres')).length, (await db.all('planActions')).length], [titres, plan]);
  // Le refus reste possible ; rétablie, l'habilitation accepte de nouveau la demande.
  assert.match(await run(RH, 'demande.refuser', { id: (await attente({ type: 'formation', f: 'aipr' })).id, motif: 'Formation retirée du catalogue' }), /Demande refusée/);
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'ac486', archive: false });
  assert.match(await run(RH, 'demande.accepter', { id: (await attente({ h: 'ac486' })).id }), /en attente de délivrance/);
});

test('journal des référentiels : code normalisé, jamais de texte libre ; validité modifiée rattachée aux titulaires', async () => {
  const { db, run, derniere, domain, RH, HSE } = await fresh();
  // Champs ignorés par l'action (code en modification, valeur d'`archive`) : jamais recopiés tels quels.
  await run(HSE, 'referentiel.formation.enregistrer', { ...SST, code: 'Texte libre : Mehdi Benali inapte' });
  assert.deepEqual((await derniere('referentiel.formation.enregistrer')).payload, { code: 'sst' });
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr', archive: 'arrêt maladie de Mehdi Benali' });
  assert.deepEqual((await derniere('referentiel.habilitation.archiver')).payload, { code: 'aipr', retablir: false, avant: { archive: null }, apres: { archive: '2026-10-10' } });
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr', archive: false });
  assert.equal((await derniere('referentiel.habilitation.archiver')).payload.retablir, true);
  // Refus d'accès (tracé avec les champs retenus) : une saisie qui n'a pas la forme d'un code n'est pas recopiée.
  assert.deepEqual(champsRetenus('referentiel.formation.enregistrer', { code: 'Mehdi Benali, arrêt maladie', nom: 'x' }), { code: null });
  assert.deepEqual(champsRetenus('referentiel.destination.archiver', { id: 'vn', archive: 'texte libre' }), { code: 'VN', retablir: false });
  assert.deepEqual(champsRetenus('referentiel.charger', { referentiel: 'Mehdi Benali, arrêt maladie' }), { referentiel: null });
  assert.deepEqual(champsRetenus('referentiel.charger', { referentiel: 'habilitations' }), { referentiel: 'habilitations' });
  // Validité SST de 24 à 12 mois : le message nomme des titulaires, la ligne leur est rattachée (filtre, export de leurs données).
  const effet = R.effetModification((await domain()).ds, 'formations', { ...(await domain()).fm('sst'), validite: 12 });
  const message = await run(RH, 'referentiel.formation.enregistrer', { ...SST, validite: 12 });
  assert.deepEqual(new Set((await derniere('referentiel.formation.enregistrer')).salaries), new Set(effet.echus.map(t => t.empId)));
  const nomme = effet.echus.find(t => message.includes(t.nom))!;
  const lignes = (await donneesSalarie(db, nomme.empId, { journal: true, par: 'test' }))!.sections['Journal des actions le concernant'] as { code: string; message: string }[];
  assert.ok(lignes.some(x => x.code === 'referentiel.formation.enregistrer' && x.message.includes(nomme.nom)), `${nomme.nom} : ligne dans l’export de ses données`);
  // Sans titre touché : aucun salarié rattaché.
  await run(RH, 'referentiel.formation.enregistrer', { ...SST, validite: 12, organisme: 'Apave' });
  assert.deepEqual((await derniere('referentiel.formation.enregistrer')).salaries, []);
});

test('Keystone : GET /referentiels donne la date d’archivage, le code archivé reste reçu', async () => {
  const { db, run, RH } = await fresh();
  await run(RH, 'referentiel.destination.archiver', { id: 'VN' });
  const lire = ROUTES_V1.find(([m, chemin]) => m === 'get' && chemin === '/referentiels')![2];
  const ref = (await lire(db, {} as never, {} as never)).body as Record<string, { code: string; archive: string | null }[]>;
  assert.deepEqual(ref.destinations.find(x => x.code === 'VN'), { code: 'VN', pays: 'Vietnam', archive: '2026-10-10' });
  assert.equal(ref.destinations.find(x => x.code === 'MA')!.archive, null);
  assert.ok(ref.habilitations.every(x => x.archive === null) && ref.certifications.every(x => x.archive === null));
  assert.ok((await contexte(db)).destinations.has('VN'), 'toujours reçu');
});

test('destination : code pays, vaccins obligatoires ou recommandés, archivage ; service RH seulement', async () => {
  const { db, run, refuse, derniere, domain, RH, HSE } = await fresh();
  const base = { code: 'de', pays: 'Allemagne', visa: 'none', visaSub: 'Union européenne', oblig: [], rec: [], passMois: '', secu: '' };
  await refuse(HSE, 'referentiel.destination.enregistrer', base, /service RH/, 403);
  await refuse(RH, 'referentiel.destination.enregistrer', { ...base, code: 'fr' }, /La France n’est pas une destination à l’étranger/);
  await refuse(RH, 'referentiel.destination.enregistrer', { ...base, code: 'DEU' }, /Code pays à deux lettres/);
  await refuse(RH, 'referentiel.destination.enregistrer', { ...base, code: 'MA' }, /Ce code désigne déjà une destination/);
  await refuse(RH, 'referentiel.destination.enregistrer', { ...base, rec: ['dtp'] }, /DTP : toujours recommandé/);
  await refuse(RH, 'referentiel.destination.enregistrer', { ...base, oblig: ['fj'], rec: ['fj'] }, /soit obligatoire, soit recommandé/);
  await refuse(RH, 'referentiel.destination.enregistrer', { ...base, passMois: '30' }, /de 0 à 24/);
  assert.equal(await run(RH, 'referentiel.destination.enregistrer', base), 'Destination « Allemagne » ajoutée au référentiel');
  const de = (await domain()).destOf('DE')!;
  assert.deepEqual([de.passMois, de.secu, de.oblig], [0, null, []]);
  assert.equal((await domain()).destSummary(de).includes('Certificat A1'), true, 'sécurité sociale déduite du code pays');
  // Modification : les déplacements prévus suivent la nouvelle règle (dossier recalculé à l'affichage).
  const ma = (await domain()).destOf('MA')!;
  assert.match(await run(RH, 'referentiel.destination.enregistrer', { ...ma, id: 'MA', passMois: 3 }), /déplacements? prévus? sui/);
  assert.deepEqual([(await derniere('referentiel.destination.enregistrer')).payload.avant, (await derniere('referentiel.destination.enregistrer')).payload.apres], [{ passMois: 0 }, { passMois: 3 }]);
  // Archivée : plus proposée pour un nouveau déplacement, ni dans un import ; reconnue de Keystone.
  assert.match(await run(RH, 'referentiel.destination.archiver', { id: 'vn' }), /Destination « Vietnam » archivée/);
  await refuse(RH, 'voyage.creer', { empId: 2, dest: 'VN', depart: '2026-11-02', retour: '2026-11-06', motif: 'Salon' }, /Destination archivée/);
  const rows = parseTrips(await domain(), 'reference;collaborateur;destination;depart;retour;motif\nDD-9;Mehdi Benali;Vietnam;02/11/2026;06/11/2026;Salon');
  assert.ok(rows[0].errs.includes('Destination archivée : Vietnam'));
  assert.ok((await contexte(db)).destinations.has('VN'));
  assert.equal((await derniere('referentiel.destination.archiver')).payload.apres.archive, '2026-10-10');
});

test('instantanés : archivage transmis à tous, listes en vigueur ; contrôles partagés avec les dialogues', async () => {
  const { db, run, RH, HSE, KARIM, MEHDI, LECTURE } = await fresh();
  await run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  await run(HSE, 'referentiel.formation.archiver', { id: 'aipr' });
  for (const u of [KARIM, MEHDI, HSE, LECTURE]) {
    const ds = await buildSnapshot(db, u);
    assert.equal(ds.referentiels.formations.find(f => f.id === 'aipr')?.archive, '2026-10-10', `${u.nom} : formation archivée nommée`);
    assert.ok(!R.actifs(ds.referentiels.formations).some(f => f.id === 'aipr'));
  }
  assert.equal(new Domain(await buildSnapshot(db, RH)).fm('aipr').court, 'AIPR', 'reste lisible (historique)');
  // Code proposé d'après le nom court, libre dans le référentiel.
  assert.equal(R.codeSuggere('CACES R489', ['caces-r489']), 'caces-r489-2');
  assert.equal(R.codeSuggere('Équipier incendie', []), 'equipier-incendie');
  // Erreurs par champ, toutes à la fois (formulaire).
  const { erreurs } = R.controlerFormation({ code: '', nom: '', court: '', type: '', validite: '', validation: '' }, []);
  assert.deepEqual(Object.keys(erreurs).sort(), ['code', 'court', 'nom', 'type', 'validation', 'validite']);
});

test('écran Référentiels : confirmations d’archivage et de chargement, données seulement', async () => {
  const C = await import('../client/src/state/confirmations-referentiels.ts');
  const f = C.archivageFormation({ id: 'aipr', court: 'AIPR' }, 1);
  assert.deepEqual([f.action, f.payload], ['referentiel.formation.archiver', { id: 'aipr' }]);
  assert.ok(f.suites!.some(s => /Les certifications de 1 salarié restent au dossier/.test(s)));
  assert.deepEqual(C.archivageDestination({ code: 'VN', pays: 'Vietnam' }, 0).payload, { id: 'VN' });
  assert.equal(C.archivageHabilitation({ id: 'he', nom: 'Habilitation électrique' }, 4).action, 'referentiel.habilitation.archiver');
  const c = C.chargementType('habilitations');
  assert.deepEqual([c.action, c.payload], ['referentiel.charger', { referentiel: 'habilitations' }]);
  for (const x of [f, c]) assert.deepEqual(JSON.parse(JSON.stringify(x)), x, 'gardée dans le brouillon d’une reconnexion');
});
