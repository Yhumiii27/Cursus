// Vigilance des pays, coordonnées sur place et contact d'urgence (lot 6, chantier 2, étape 1 : t068) : couleur de France
// Diplomatie et jour de sa vérification sur la destination (contrôles, journal), alerte d'un passage à l'orange ou au rouge
// (message, salariés au journal, e-mails à la boîte du service RH et au manager), réserve DEPLACEMENT du Go / No Go en zone rouge,
// rappel de vérification avant un départ ; hébergement, contact local et inscription sur Ariane du déplacement (Keystone
// non prévenu, textes réservés au service RH) ; contact d'urgence de la fiche (portail, service RH seul, export RGPD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { Domain } = await import('../shared/domain.ts');
const V = await import('../shared/rules/vigilance.ts');
const { controlerDestination } = await import('../shared/rules/referentiels.ts');
const { INFO_CONFIDENTIALITE } = await import('../shared/confidentialite.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ligne = { action: string; message: string | null; payload: Record<string, any>; salaries: number[] };
type Envoi = { cible: string; type: string; contenu: { a: string[]; objet: string; texte: string } };

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const ADMIN = await user(null, 'rh');
  const d = async () => new Domain(await loadFull(db, ADMIN));
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(l => l.action === action);
  // E-mails partis aussitôt, et notifications gardées pour le récapitulatif quotidien (Karim Haddad, manager de la Maintenance).
  const mails = async (type: string) => [
    ...(await db.all<Envoi>('envois')).filter(e => e.cible === 'email' && e.type === type).map(e => ({ a: e.contenu.a, objet: e.contenu.objet, texte: e.contenu.texte })),
    ...(await db.all<{ type: string; adresse: string; objet: string; texte: string }>('notifications')).filter(n => n.type === type).map(n => ({ a: [n.adresse], objet: n.objet, texte: n.texte })),
  ];
  return { db, run, refus, d, journal, mails, ADMIN, PAIE: await user(7, 'rh'), LECTURE: await user(11, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur'), THOMAS: await user(6, 'collaborateur') };
}
const MAROC = { id: 'MA', pays: 'Maroc', visa: 'none', visaSub: 'séjour ≤ 90 jours', oblig: [], rec: ['hepA', 'typhoide'], passMois: 3, secu: 'convention' };

test('t068 vigilance : couleur et jour de la vérification contrôlés ; non renseignée par défaut, gardée par un appel ancien', async () => {
  assert.deepEqual(V.controlerVigilance('', '', '2026-10-10'), { erreurs: {}, vigilance: null, vigilanceLe: null });
  assert.equal(V.controlerVigilance('violet', '', '2026-10-10').erreurs.vigilance, 'Vigilance inconnue : vert, jaune, orange ou rouge.');
  assert.match(V.controlerVigilance('orange', '', '2026-10-10').erreurs.vigilanceLe!, /jour de la vérification/);
  assert.match(V.controlerVigilance('orange', '2026-10-11', '2026-10-10').erreurs.vigilanceLe!, /à venir/);
  assert.deepEqual(V.controlerVigilance('jaune', '2026-10-01', '2026-10-10'), { erreurs: {}, vigilance: 'jaune', vigilanceLe: '2026-10-01' });
  assert.equal(V.devientDeconseillee(null, 'orange'), true);
  assert.equal(V.devientDeconseillee('jaune', 'rouge'), true);
  assert.equal(V.devientDeconseillee('rouge', 'orange'), false, 'une baisse n’alerte pas');
  assert.equal(V.devientDeconseillee('orange', 'orange'), false);
  assert.equal(V.devientDeconseillee(null, 'jaune'), false);
  const { d } = await fresh();
  const liste = (await d()).ds.referentiels.destinations;
  assert.ok(liste.every(x => !x.vigilance), 'non renseignée par défaut');
  // Appel sans les champs de vigilance (ancien écran) : la vigilance enregistrée est gardée.
  const avec = liste.map(x => (x.code === 'MA' ? { ...x, vigilance: 'jaune' as const, vigilanceLe: '2026-10-01' } : x));
  assert.equal(controlerDestination(MAROC, avec, 'MA', '2026-10-10').destination!.vigilance, 'jaune');
  assert.equal(controlerDestination({ ...MAROC, vigilance: '', vigilanceLe: '' }, avec, 'MA', '2026-10-10').destination!.vigilance, null);
});

test('t068 passage à l’orange ou au rouge : déplacements prévus signalés, e-mails à la boîte du service RH et au manager du voyageur, journal ; zone rouge en réserve', async () => {
  const { run, refus, d, journal, mails, ADMIN } = await fresh();
  await refus(ADMIN, 'referentiel.destination.enregistrer', { ...MAROC, vigilance: 'rouge' }, 400, /jour de la vérification/);
  // Jaune : aucune alerte.
  await run(ADMIN, 'referentiel.destination.enregistrer', { ...MAROC, vigilance: 'jaune', vigilanceLe: '2026-10-09' });
  assert.equal((await mails('voyage.vigilance')).length, 0);
  // Orange : le déplacement de Romain Chevalier (chantier de Tanger) est listé ; son manager est prévenu, et la boîte du
  // service RH aussi bien que l'auteur en fasse partie (boîte partagée : les collègues qui suivent les déplacements).
  const voyageur = (await d()).ds.voyages.find(v => v.dest === 'MA' && !v.annuleLe)!;
  const nom = (await d()).personName(voyageur.empId);
  const msg = await run(ADMIN, 'referentiel.destination.enregistrer', { ...MAROC, vigilance: 'orange', vigilanceLe: '2026-10-10' });
  assert.match(msg, new RegExp(`^Destination « Maroc » modifiée · vigilance orange \\(France Diplomatie : déconseillé sauf raison impérative\\) : 1 déplacement prévu vers ce pays \\(${nom} du`));
  const e = await mails('voyage.vigilance');
  assert.deepEqual(e.map(x => [x.a, x.objet]), [
    [['rh@entreprise.example'], 'Vigilance orange — Maroc : 1 déplacement prévu'],
    [['karim.haddad@entreprise.example'], 'Vigilance orange — Maroc : 1 déplacement de votre équipe'],
  ]);
  assert.match(msg, /service RH et managers prévenus/);
  assert.ok(e.every(x => x.texte.includes(nom)));
  const j = (await journal('referentiel.destination.enregistrer')).at(-1)!;
  assert.deepEqual([j.payload.avant.vigilance, j.payload.apres.vigilance, j.payload.apres.vigilanceLe], ['jaune', 'orange', '2026-10-10']);
  assert.deepEqual(j.salaries, [voyageur.empId]);
  // Toujours orange : pas de nouvelle alerte. Rouge : nouvelle alerte, et réserve DEPLACEMENT au Go / No Go.
  await run(ADMIN, 'referentiel.destination.enregistrer', { ...MAROC, vigilance: 'orange', vigilanceLe: '2026-10-10' });
  assert.equal((await mails('voyage.vigilance')).length, 2);
  const avantRouge = await d();
  const statut = (dm: InstanceType<typeof Domain>) => {
    const c = dm.chantier('K-2614')!;
    const res = dm.evaluateChantiers(dm.enrich(90, false), dm.tripsAll()).find(x => x.c.id === c.id)!.res.find(r => r.e.id === voyageur.empId)!;
    return res.reasons.filter(r => r.code === 'DEPLACEMENT').map(r => r.minimal);
  };
  assert.deepEqual(statut(avantRouge), []);
  assert.match(await run(ADMIN, 'referentiel.destination.enregistrer', { ...MAROC, vigilance: 'rouge', vigilanceLe: '2026-10-10' }), /vigilance rouge/);
  assert.equal((await mails('voyage.vigilance')).length, 4);
  assert.deepEqual(statut(await d()), ['Destination formellement déconseillée']);
});

test('t068 rappel de vérification avant un départ : jamais vérifiée, ou depuis plus de N jours (réglable)', async () => {
  const v = { retour: '2026-10-20' };
  assert.match(V.rappelVigilance({ vigilance: null, vigilanceLe: null }, v, '2026-10-10')!, /jamais vérifiée/);
  assert.equal(V.rappelVigilance({ vigilance: 'vert', vigilanceLe: '2026-09-15' }, v, '2026-10-10'), null);
  assert.match(V.rappelVigilance({ vigilance: 'vert', vigilanceLe: '2026-09-01' }, v, '2026-10-10')!, /plus de 30 jours/);
  assert.equal(V.rappelVigilance({ vigilance: 'vert', vigilanceLe: '2026-09-01' }, v, '2026-10-10', 60), null);
  assert.equal(V.rappelVigilance({ vigilance: null, vigilanceLe: null }, { retour: '2026-10-01' }, '2026-10-10'), null, 'déplacement terminé');
  const { run, refus, d, ADMIN } = await fresh();
  assert.equal((await d()).ds.settings.vigilanceRappelJours, 30);
  await run(ADMIN, 'parametres.maj', { vigilanceRappelJours: 60 });
  assert.equal((await d()).ds.settings.vigilanceRappelJours, 60);
  await run(ADMIN, 'parametres.maj', { vigilanceRappelJours: 1000 });
  assert.equal((await d()).ds.settings.vigilanceRappelJours, 180, 'borné');
  await refus(ADMIN, 'parametres.maj', { deplacementsPaieAPartirDu: '2026-02-30' }, 400);
});

test('t068 coordonnées sur place : hébergement, contact et Ariane modifiables, Keystone non prévenu, textes réservés au service RH', async () => {
  const { db, run, refus, d, journal, ADMIN, KARIM } = await fresh();
  const t = (await d()).ds.voyages.find(v => v.origine === 'keystone' && v.dest === 'MA')!;
  const keystone = async () => (await db.all<{ cible: string }>('envois')).filter(e => e.cible === 'keystone').length;
  const k0 = await keystone();
  assert.match(await run(ADMIN, 'voyage.modifier', { id: t.id, hebergement: 'Hôtel Atlas, Tanger', contactSurPlace: 'M. Alami +212 6 00 00 00', arianeLe: '2026-10-09' }), /coordonnées sur place enregistrées/);
  const apres = (await d()).ds.voyages.find(v => v.id === t.id)!;
  assert.deepEqual([apres.hebergement, apres.contactSurPlace, apres.arianeLe, apres.depart], ['Hôtel Atlas, Tanger', 'M. Alami +212 6 00 00 00', '2026-10-09', t.depart]);
  assert.equal(await keystone(), k0, 'champs propres à Cursus : Keystone n’est pas prévenu');
  await refus(ADMIN, 'voyage.modifier', { id: t.id, arianeLe: '2026-10-11' }, 400, /à venir/);
  await refus(ADMIN, 'voyage.modifier', { id: t.id, hebergement: 'x'.repeat(201) }, 400, /200 caractères/);
  await refus(ADMIN, 'voyage.modifier', { id: t.id, hebergement: 'Hôtel Atlas, Tanger' }, 400, /Aucune modification/);
  // Journal : la date d'Ariane, jamais le texte de l'hébergement ou du contact.
  const j = (await journal('voyage.modifier')).at(-1)!;
  assert.equal(j.payload.apres.arianeLe, '2026-10-09');
  assert.ok(!JSON.stringify(j.payload).includes('Atlas') && !JSON.stringify(j.payload).includes('Alami'));
  // Manager (Karim encadre-t-il le voyageur ? sa vue ne reçoit de toute façon ni hébergement ni contact).
  const vue = (await buildSnapshot(db, KARIM)).voyages.find(v => v.id === t.id);
  if (vue) assert.deepEqual([vue.hebergement, vue.contactSurPlace], [null, null]);
});

test('t068 coordonnées sur place enregistrées malgré une absence signalée pendant le déplacement ; un changement de dates reste contrôlé', async () => {
  const { run, refus, d, ADMIN } = await fresh();
  const t = (await d()).ds.voyages.find(v => v.empId === 18 && v.dest === 'MA')!;
  // Arrêt signalé à Tanger, du 29 au 30 octobre.
  await run(ADMIN, 'absence.signaler', { empId: 18, type: 'AM', du: '2026-10-29', au: '2026-10-30' });
  assert.match(await run(ADMIN, 'voyage.modifier', { id: t.id, hebergement: 'Hôtel Tanger' }), /coordonnées sur place enregistrées/);
  // Dates transmises inchangées (dialogue « Modifier le déplacement ») : enregistré aussi.
  assert.match(await run(ADMIN, 'voyage.modifier', { id: t.id, depart: t.depart, retour: t.retour, dest: t.dest, contactSurPlace: 'Accueil chantier' }), /coordonnées sur place enregistrées/);
  assert.equal((await d()).ds.voyages.find(v => v.id === t.id)!.hebergement, 'Hôtel Tanger');
  // Dates changées : le chevauchement de l'absence est refusé, comme avant.
  await refus(ADMIN, 'voyage.modifier', { id: t.id, depart: t.depart, retour: '2026-11-07' }, 400, /absent/);
});

test('t068 contact d’urgence : saisi depuis le portail, vu du service RH et de l’intéressé seulement, journal sans le texte, export RGPD', async () => {
  const { db, run, refus, journal, ADMIN, PAIE, LECTURE, KARIM, MEHDI, THOMAS } = await fresh();
  await refus(MEHDI, 'employe.contactUrgence', { empId: 2, nom: 'Nadia Benali (sœur)', telephone: 'abc' }, 400, /Téléphone/);
  await refus(MEHDI, 'employe.contactUrgence', { empId: 2, nom: 'Nadia Benali (sœur)', telephone: '' }, 400, /Indiquez le téléphone/);
  await refus(THOMAS, 'employe.contactUrgence', { empId: 2, nom: 'X', telephone: '0600000000' }, 403);
  await refus(KARIM, 'employe.contactUrgence', { empId: 2, nom: 'X', telephone: '0600000000' }, 403);
  assert.equal(await run(MEHDI, 'employe.contactUrgence', { empId: 2, nom: 'Nadia Benali (sœur)', telephone: '06 12 34 56 78' }), 'Contact d’urgence enregistré — visible du service RH seulement');
  const fiche = async (u: User) => (await buildSnapshot(db, u)).employes.find(e => e.id === 2);
  assert.deepEqual([(await (await fiche(MEHDI))!).urgenceNom, (await (await fiche(MEHDI))!).urgenceTel], ['Nadia Benali (sœur)', '06 12 34 56 78']);
  assert.equal((await (await fiche(ADMIN))!).urgenceNom, 'Nadia Benali (sœur)');
  for (const u of [KARIM, PAIE, LECTURE]) assert.deepEqual([(await fiche(u))?.urgenceNom ?? null, (await fiche(u))?.urgenceTel ?? null], [null, null]);
  const j = (await journal('employe.contactUrgence')).at(-1)!;
  assert.deepEqual(j.salaries, [2]);
  assert.ok(!JSON.stringify(j).includes('Nadia') && !JSON.stringify(j).includes('06 12'));
  // Copie des données : dans la fiche ; page Confidentialité : mentionné.
  assert.equal(((await (await donneesSalarie(db, 2, { journal: false, par: 'essai' }))!).sections.Fiche as Record<string, unknown>).urgenceNom, 'Nadia Benali (sœur)');
  // Saisi par l'intéressé ou par le service RH (fiche) : la notice le dit (docs/RGPD.md).
  assert.ok(INFO_CONFIDENTIALITE.some(r => r.points.some(([t, x]) => t === 'Contact d’urgence' && x.includes('par le service RH'))));
  // Retiré : les deux champs vides.
  assert.equal(await run(ADMIN, 'employe.contactUrgence', { empId: 2, nom: '', telephone: '' }), 'Contact d’urgence de Mehdi Benali retiré');
  assert.equal((await (await fiche(ADMIN))!).urgenceNom, null);
});
