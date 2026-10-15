// Référentiels administrés dans Cursus (t110) : catalogue vide en production et référentiel type, création et
// modification contrôlées (codes, validités, prérequis, formalités d'entrée), archivage au lieu de la suppression,
// effet d'une validité modifiée sur les titres détenus, journal avant / après, échanges avec Keystone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace, REGLES } = await import('../server/src/journal.ts');
const { contexte } = await import('../server/src/integrations/keystone-entrant.ts');
const { suivreVerdicts } = await import('../server/src/integrations/keystone-verdicts.ts');
const { Domain } = await import('../shared/domain.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const { parseTrips } = await import('../shared/rules/imports.ts');
const R = await import('../shared/rules/referentiels.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Db = InstanceType<typeof Db>;
interface Ligne { action: string; message: string | null; payload: Record<string, any> }

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace après). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refuse = (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) => assert.throws(() => run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} devait être refusé (${motif})`);
  const derniere = (action: string) => db.all<Ligne>('journal').findLast(j => j.action === action)!;
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  return { db, run, refuse, derniere, domain, RH, HSE: user(23, 'rh'), LECTURE: user(11, 'rh'), MEHDI: user(2, 'collaborateur'), KARIM: user(12, 'manager') };
}

const SST = { id: 'sst', nom: 'Sauveteur secouriste du travail (SST)', court: 'SST', type: 'Réglementaire', validite: 24, duree: '7 h (MAC)', organisme: 'Croix-Rouge française', cout: 180, validation: 'evaluation' };

test('base neuve : référentiels vides, puis référentiel type chargé une seule fois, habilitations après les formations', () => {
  const db = new Db(':memory:');
  const RH = { role: 'rh', empId: null, nom: 'Responsable RH', intitule: '', profilRh: 'rh_admin' } as User;
  const HSE = { ...RH, profilRh: 'referent_hse' } as User;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => String(ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p)));
  const nombre = (t: 'formations' | 'habilitations' | 'destinations') => loadFull(db, RH).referentiels[t].length;
  assert.deepEqual([nombre('formations'), nombre('habilitations'), nombre('destinations')], [0, 0, 0]);
  assert.throws(() => run(RH, 'referentiel.charger', { referentiel: 'habilitations' }), /Formations prérequises absentes du catalogue .*chargez d’abord le catalogue type des formations/);
  assert.match(run(HSE, 'referentiel.charger', { referentiel: 'formations' }), /^11 formations du référentiel type ajoutées : à vérifier/);
  assert.match(run(HSE, 'referentiel.charger', { referentiel: 'habilitations' }), /^6 habilitations/);
  assert.throws(() => run(HSE, 'referentiel.charger', { referentiel: 'destinations' }), (e: unknown) => e instanceof ActionError && e.status === 403, 'destinations : service RH');
  assert.match(run(RH, 'referentiel.charger', { referentiel: 'destinations' }), /^8 destinations/);
  assert.deepEqual([nombre('formations'), nombre('habilitations'), nombre('destinations')], [11, 6, 8]);
  assert.throws(() => run(RH, 'referentiel.charger', { referentiel: 'formations' }), /déjà rempli : le référentiel type ne se charge que dans un référentiel vide/);
  assert.throws(() => run(RH, 'referentiel.charger', { referentiel: 'salaries' }), /Référentiel inconnu/);
  // Repris tels quels de la démonstration, en vigueur.
  const f = loadFull(db, RH).referentiels.formations.find(x => x.id === 'caces489')!;
  assert.deepEqual([f.validite, f.validation, f.archive], [60, 'evaluation', null]);
  assert.deepEqual(loadFull(db, RH).referentiels.habilitations.find(h => h.id === 'he')!.prereqs, ['elec']);
});

test('formation : création contrôlée (code, intitulé, validité, coût), modification tracée avant / après', () => {
  const { run, refuse, derniere, domain, HSE } = fresh();
  const nouvelle = { code: 'CACES485', nom: 'CACES R485 — Gerbeurs', court: 'CACES R485', type: 'Réglementaire', validite: '60', duree: '14 h', organisme: 'AFTRAL', cout: '450,50', validation: 'evaluation' };
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, code: 'sst' }, /Ce code désigne déjà une formation/);
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, code: 'autre' }, /Code réservé/);
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, code: 'caces 485' }, /lettres minuscules sans accent/);
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, validite: '0' }, /Validité en mois : nombre entier de 1 à 240/);
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, nom: 'sauveteur secouriste du travail (SST)' }, /porte déjà cet intitulé/);
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, cout: '-5' }, /Coût en euros/);
  refuse(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, id: 'inconnue' }, /Formation introuvable/, 404);
  assert.equal(run(HSE, 'referentiel.formation.enregistrer', nouvelle), 'Formation « CACES R485 » ajoutée au catalogue');
  const f = domain().fm('caces485');
  assert.deepEqual([f.validite, f.cout, f.type, f.archive], [60, 450.5, 'Réglementaire', null], 'code en minuscules, nombres lus en français');
  assert.ok(domain().forms(false).some(x => x.id === 'caces485'), 'proposée dans les listes');
  const cree = derniere('referentiel.formation.enregistrer');
  assert.equal(cree.payload.code, 'CACES485');
  assert.deepEqual(cree.payload.apres, { nom: 'CACES R485 — Gerbeurs', court: 'CACES R485', type: 'Réglementaire', validite: 60, duree: '14 h', organisme: 'AFTRAL', cout: 450.5, validation: 'evaluation' });
  // Modification : le code ne change pas, seules les valeurs modifiées sont tracées.
  run(HSE, 'referentiel.formation.enregistrer', { ...nouvelle, id: 'caces485', code: 'ignore', organisme: 'Apave', cout: 480 });
  const modif = derniere('referentiel.formation.enregistrer');
  assert.deepEqual([modif.payload.avant, modif.payload.apres], [{ organisme: 'AFTRAL', cout: 450.5 }, { organisme: 'Apave', cout: 480 }]);
  assert.equal(domain().fm('ignore'), undefined);
  assert.ok(REGLES['referentiel.formation.enregistrer'] && JOURNAL_LABEL['referentiel.formation.enregistrer']);
  assert.equal(familleAction('referentiel.charger')!.id, 'referentiels');
});

test('validité modifiée : échéances existantes recalculées, titres devenus échus annoncés avant l’enregistrement', () => {
  const { db, run, domain, derniere, RH } = fresh();
  const d = domain();
  // SST de 24 à 12 mois : les certifications obtenues il y a plus d'un an deviennent échues.
  const effet = R.effetModification(d.ds, 'formations', { ...d.fm('sst'), validite: 12 });
  assert.ok(effet.echus.length >= 3, `${effet.echus.length} titres échus`);
  assert.ok(effet.echus.some(t => t.nom === 'Mehdi Benali' && t.titre === 'SST'), 'SST du 3 mai 2025');
  assert.deepEqual(effet.retablis, []);
  assert.match(R.titresTexte(effet.echus), / et \d+ autres?$/);
  const msg = run(RH, 'referentiel.formation.enregistrer', { ...SST, validite: 12 });
  assert.match(msg, new RegExp(`validité 24 → 12 mois, échéances recalculées · ${effet.echus.length} titres deviennent échus : `));
  const mehdi = domain().enrich(90, false).find(e => e.id === 2)!;
  assert.equal(mehdi.certs.find(c => c.f === 'sst')!.key, 'exp', 'échéance recalculée à l’affichage');
  assert.deepEqual(derniere('referentiel.formation.enregistrer').payload.avant, { validite: 24 });
  // Retour à 24 mois : les mêmes titres redeviennent valides.
  assert.match(run(RH, 'referentiel.formation.enregistrer', SST), new RegExp(`${effet.echus.length} titres redeviennent valides`));
  // Habilitation électrique de 36 à 12 mois : celle de Romain Chevalier (1er mars 2025) expire, No Go transmis à Keystone.
  suivreVerdicts(db, { initial: true });
  const he = domain().hm('he');
  assert.match(run(RH, 'referentiel.habilitation.enregistrer', { ...he, id: 'he', validite: 12 }), /Romain Chevalier \(Habilitation électrique\)/);
  const changes = suivreVerdicts(db).filter(v => v.empId === 18);
  assert.ok(changes.length > 0, 'verdict Go / No Go modifié signalé à Keystone');
});

test('archivage d’une formation : refusé tant qu’elle est exigée ou planifiée ; plus proposée ni suivie, gardée au dossier', () => {
  const { db, run, refuse, domain, RH, HSE, MEHDI, KARIM } = fresh();
  refuse(HSE, 'referentiel.formation.archiver', { id: 'elec' }, /Prérequis de : Habilitation électrique/);
  refuse(HSE, 'referentiel.formation.archiver', { id: 'rgpd' }, /1 session ouverte \(à venir ou à clôturer\)/);
  run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  assert.match(run(HSE, 'referentiel.formation.archiver', { id: 'aipr' }), /archivée — plus proposée ni suivie ; les certifications restent au dossier/);
  assert.equal(domain().fm('aipr').archive, '2026-10-10');
  assert.ok(!domain().forms(false).some(f => f.id === 'aipr'), 'plus proposée');
  // Romain Chevalier détient l'AIPR : certification au dossier (prérequis, Go / No Go), hors du statut et des échéances.
  const romain = () => domain().enrich(90, false).find(e => e.id === 18)!;
  assert.ok(romain().rawCerts.some(c => c.f === 'aipr'));
  assert.ok(!romain().certs.some(c => c.f === 'aipr'));
  assert.ok(!domain().echeances(domain().enrich(90, false), 90).some(x => x.kind === 'cert' && x.label === 'AIPR'));
  // Aucune nouvelle saisie sur une formation archivée.
  refuse(RH, 'cert.ajouter', { empId: 2, f: 'aipr', date: '2026-10-01' }, /Formation archivée : rétablissez-la d’abord/);
  refuse(RH, 'session.creer', { f: 'aipr', date: '2026-12-01', lieu: 'Lyon', places: 8 }, /Formation archivée/);
  refuse(MEHDI, 'demande.formation', { f: 'aipr', motif: 'Chantier réseaux' }, /Formation archivée/);
  refuse(KARIM, 'demande.formation', { f: 'aipr', motif: 'Chantier réseaux', empId: 2 }, /Formation archivée/);
  // Reconnue de Keystone (exigence d'un chantier) et listée dans GET /referentiels.
  assert.ok(contexte(db).formations.has('aipr'));
  // Rétablie : de nouveau proposée.
  assert.match(run(HSE, 'referentiel.formation.archiver', { id: 'aipr', archive: false }), /rétablie au catalogue/);
  assert.equal(domain().fm('aipr').archive, null);
  run(RH, 'cert.ajouter', { empId: 2, f: 'aipr', date: '2026-10-01' });
});

test('habilitation : prérequis du catalogue, archivage (titres au dossier, hors suivi), plus de délivrance ni de demande', () => {
  const { run, refuse, derniere, domain, RH, HSE, MEHDI } = fresh();
  const base = { code: 'chimie', nom: 'Autorisation produits chimiques', detail: 'Dépotage et transvasement', prereqs: ['atex', 'inconnue'], medical: true, validite: 36, signataire: 'Sarah Cohen' };
  refuse(HSE, 'referentiel.habilitation.enregistrer', base, /Formation inconnue ou archivée : inconnue/);
  refuse(HSE, 'referentiel.habilitation.enregistrer', { ...base, prereqs: ['atex'], signataire: ' ' }, /Indiquez le signataire/);
  assert.equal(run(HSE, 'referentiel.habilitation.enregistrer', { ...base, prereqs: ['atex', 'atex'] }), 'Habilitation « Autorisation produits chimiques » ajoutée au référentiel');
  assert.deepEqual(domain().hm('chimie').prereqs, ['atex']);
  assert.deepEqual(derniere('referentiel.habilitation.enregistrer').payload.apres.prereqs, ['atex']);
  // Habilitation ATEX de Sophie Lemaire (n° 3) : archivée, son titre reste au dossier sans compter dans le suivi.
  const sophie = () => domain().enrich(90, false).find(e => e.id === 3)!;
  // Le chantier de Feyzin exige l'habilitation ATEX : verdicts inchangés par l'archivage (titres toujours reconnus).
  const feyzin = () => { const d = domain(); return d.evaluateChantiers(d.enrich(90, false), d.tripsAll()).find(x => x.c.id === 'K-2620')!.res.map(r => [r.e.id, r.status, r.reasons.map(x => x.code)]); };
  const verdicts = feyzin();
  assert.ok(verdicts.some(([id]) => id === 3));
  assert.match(run(HSE, 'referentiel.habilitation.archiver', { id: 'atex' }), /archivée — plus proposée ni suivie ; 3 titres restent au dossier/);
  const titre = sophie().habs.find(h => h.h === 'atex')!;
  assert.match(titre.note, /Habilitation archivée au référentiel : plus suivie/);
  assert.equal(domain().habAction(3, titre), null, 'plus aucune action proposée');
  assert.ok(!domain().echeances(domain().enrich(90, false), 90).some(x => x.kind === 'hab' && x.label === 'Habilitation ATEX'));
  refuse(RH, 'hab.delivrer', { empId: 3, h: 'atex', date: '2026-10-10', par: 'Sarah Cohen', mode: 'renew' }, /Habilitation archivée/);
  refuse(MEHDI, 'demande.habilitation', { h: 'atex', motif: 'Zone 1' }, /Habilitation archivée/);
  // Un prérequis déjà inscrit dont la formation est archivée depuis reste accepté ; un nouveau, non.
  run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  run(HSE, 'referentiel.formation.archiver', { id: 'aipr' });
  const aipr = domain().hm('aipr');
  assert.match(run(HSE, 'referentiel.habilitation.enregistrer', { ...aipr, id: 'aipr', signataire: 'Sarah Cohen' }), /modifiée$/);
  refuse(HSE, 'referentiel.habilitation.enregistrer', { ...base, code: 'reseaux', nom: 'Réseaux', prereqs: ['aipr'] }, /Formation inconnue ou archivée : aipr/);
  assert.deepEqual(feyzin(), verdicts);
  run(HSE, 'referentiel.habilitation.archiver', { id: 'atex', archive: false });
  assert.equal(domain().hm('atex').archive, null);
});

test('destination : code pays, vaccins obligatoires ou recommandés, archivage ; service RH seulement', () => {
  const { db, run, refuse, derniere, domain, RH, HSE } = fresh();
  const base = { code: 'de', pays: 'Allemagne', visa: 'none', visaSub: 'Union européenne', oblig: [], rec: [], passMois: '', secu: '' };
  refuse(HSE, 'referentiel.destination.enregistrer', base, /service RH/, 403);
  refuse(RH, 'referentiel.destination.enregistrer', { ...base, code: 'fr' }, /La France n’est pas une destination à l’étranger/);
  refuse(RH, 'referentiel.destination.enregistrer', { ...base, code: 'DEU' }, /Code pays à deux lettres/);
  refuse(RH, 'referentiel.destination.enregistrer', { ...base, code: 'MA' }, /Ce code désigne déjà une destination/);
  refuse(RH, 'referentiel.destination.enregistrer', { ...base, rec: ['dtp'] }, /DTP : toujours recommandé/);
  refuse(RH, 'referentiel.destination.enregistrer', { ...base, oblig: ['fj'], rec: ['fj'] }, /soit obligatoire, soit recommandé/);
  refuse(RH, 'referentiel.destination.enregistrer', { ...base, passMois: '30' }, /de 0 à 24/);
  assert.equal(run(RH, 'referentiel.destination.enregistrer', base), 'Destination « Allemagne » ajoutée au référentiel');
  const de = domain().destOf('DE')!;
  assert.deepEqual([de.passMois, de.secu, de.oblig], [0, null, []]);
  assert.equal(domain().destSummary(de).includes('Certificat A1'), true, 'sécurité sociale déduite du code pays');
  // Modification : les déplacements prévus suivent la nouvelle règle (dossier recalculé à l'affichage).
  const ma = domain().destOf('MA')!;
  assert.match(run(RH, 'referentiel.destination.enregistrer', { ...ma, id: 'MA', passMois: 3 }), /déplacements? prévus? sui/);
  assert.deepEqual([derniere('referentiel.destination.enregistrer').payload.avant, derniere('referentiel.destination.enregistrer').payload.apres], [{ passMois: 0 }, { passMois: 3 }]);
  // Archivée : plus proposée pour un nouveau déplacement, ni dans un import ; reconnue de Keystone.
  assert.match(run(RH, 'referentiel.destination.archiver', { id: 'vn' }), /Destination « Vietnam » archivée/);
  refuse(RH, 'voyage.creer', { empId: 2, dest: 'VN', depart: '2026-11-02', retour: '2026-11-06', motif: 'Salon' }, /Destination archivée/);
  const rows = parseTrips(domain(), 'reference;collaborateur;destination;depart;retour;motif\nDD-9;Mehdi Benali;Vietnam;02/11/2026;06/11/2026;Salon');
  assert.ok(rows[0].errs.includes('Destination archivée : Vietnam'));
  assert.ok(contexte(db).destinations.has('VN'));
  assert.equal(derniere('referentiel.destination.archiver').payload.apres.archive, '2026-10-10');
});

test('instantanés : archivage transmis à tous, listes en vigueur ; contrôles partagés avec les dialogues', () => {
  const { db, run, RH, HSE, KARIM, MEHDI, LECTURE } = fresh();
  run(HSE, 'referentiel.habilitation.archiver', { id: 'aipr' });
  run(HSE, 'referentiel.formation.archiver', { id: 'aipr' });
  for (const u of [KARIM, MEHDI, HSE, LECTURE]) {
    const ds = buildSnapshot(db, u);
    assert.equal(ds.referentiels.formations.find(f => f.id === 'aipr')?.archive, '2026-10-10', `${u.nom} : formation archivée nommée`);
    assert.ok(!R.actifs(ds.referentiels.formations).some(f => f.id === 'aipr'));
  }
  assert.equal(new Domain(buildSnapshot(db, RH)).fm('aipr').court, 'AIPR', 'reste lisible (historique)');
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
