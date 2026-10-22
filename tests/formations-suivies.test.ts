// Lot 6, chantier 4, étape 2 : formations suivies par salarié, hors catalogue comprises (t116), historique des délivrances
// d'habilitation, titre à signer et passeport formation partagé avec le portail (t115), durée en heures et indicateurs du
// plan de formation (t122). Jeu de démonstration au 10 octobre 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET']) delete process.env[k];

await import('./outils/client-node.ts');
const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { DUREE_HEURES, HAB_DELIVRANCES } = await import('../server/src/migrations/lot6-securite.ts');
const { Domain } = await import('../shared/domain.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const S = await import('../shared/rules/formations-suivies.ts');
const H = await import('../shared/rules/heures-formation.ts');
const { controlerFormation, controlerHabilitation } = await import('../shared/rules/referentiels.ts');
const { csvPlan } = await import('../client/src/listes-csv.ts');
const { csvFormationsSuivies, csvIndicateurs } = await import('../client/src/formations-csv.ts');
const { sectionsPasseport } = await import('../client/src/passeport.ts');
const { sectionsTitre, titreImprimable } = await import('../client/src/titre-habilitation.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ligne = Record<string, any>;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteDe = async (empId: number | null) => await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) => await assert.rejects(async () => await run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} devait être refusé`);
  const RH = await user(null, 'rh');
  const domain = async (u: User = RH) => new Domain(u.role === 'rh' && u === RH ? await loadFull(db, RH) : await buildSnapshot(db, u));
  const emp = async (id: number, d?: InstanceType<typeof Domain>) => (d ?? await domain()).enrich(90, false, { sortis: true }).find(e => e.id === id)!;
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(l => l.action === action);
  return { db, run, refuse, user, RH, domain, emp, journal };
}

// — t116 : formations suivies —

test('formation hors catalogue saisie : non obligatoire par défaut, comptée au bilan à 8 ans, journal sans texte libre', async () => {
  const { run, refuse, RH, user, domain, journal } = await fresh();
  // Pierre Fontaine (10) : aucune formation non obligatoire depuis 8 ans, risque d'abondement correctif du CPF.
  const bilan = async () => obligations(await domain(), [10]).find(o => o.kind === 'bilan')!;
  assert.match((await bilan()).detail, /aucune formation non obligatoire/);
  assert.equal((await bilan()).risk, true);
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Anglais', du: '2026-11-02' }, /pas encore eu lieu/);
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 10, du: '2026-03-02' }, /intitulé de la formation hors catalogue/);
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 10, f: 'inconnue', du: '2026-03-02' }, /inconnue du catalogue/);
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Anglais', du: '2026-03-04', au: '2026-03-02' }, /précède/);
  // Obligatoire (case cochée) : ne compte pas.
  await run(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Habilitation de chantier client', du: '2025-06-02', obligatoire: true });
  assert.match((await bilan()).detail, /aucune formation non obligatoire/);
  const msg = await run(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Anglais professionnel', du: '2026-03-02', au: '2026-03-06', duree: '17,5', organisme: 'Langues & Co' });
  assert.match(msg, /Anglais professionnel — .* · formation suivie du 2 mars 2026 enregistrée \(non obligatoire\)/);
  assert.match((await bilan()).detail, /formation non obligatoire suivie/);
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'anglais  professionnel', du: '2026-03-02' }, /déjà enregistrée pour Pierre Fontaine/);
  const x = S.suiviesEnVigueur((await domain()).ds, 10).find(s => s.libelle === 'Anglais professionnel')!;
  assert.deepEqual([x.f, x.au, x.duree, x.obligatoire, x.origine, x.auteur], [null, '2026-03-06', 17.5, false, 'saisie', 'Sandrine Vidal']);
  // Journal : codes, dates et durée ; ni l'intitulé ni l'organisme (texte libre).
  const j = (await journal('formationSuivie.enregistrer')).at(-1)!;
  assert.deepEqual(j.payload, { empId: 10, du: '2026-03-02', au: '2026-03-06', duree: 17.5, obligatoire: false, id: x.id });
  assert.ok(!JSON.stringify(j).includes('Langues'));
  assert.equal(familleAction('formationSuivie.enregistrer')?.id, 'formations');
  assert.ok(JOURNAL_LABEL['formationSuivie.modifier'] && JOURNAL_LABEL['formationSuivie.annuler']);

  // Correction motivée (motif jamais au journal), puis suppression par l'administrateur RH : hors des calculs.
  await refuse(RH, 'formationSuivie.modifier', { id: x.id, duree: 21 }, /Motif de la correction obligatoire/);
  await run(RH, 'formationSuivie.modifier', { id: x.id, duree: 21, organisme: 'Autre organisme', motif: 'Durée de l’attestation mal recopiée' });
  const m = (await journal('formationSuivie.modifier')).at(-1)!;
  assert.ok(!JSON.stringify(m).includes('attestation') && !JSON.stringify(m).includes('Autre organisme'), 'ni motif ni organisme');
  assert.equal(await run(RH, 'formationSuivie.modifier', { id: x.id, duree: 21, motif: 'x' }), 'Aucune modification');
  const gest = await user(14, 'rh');
  await assert.rejects(async () => await run(gest, 'formationSuivie.annuler', { id: x.id, motif: 'Erreur' }), (e: unknown) => e instanceof ActionError && e.status === 403);
  await run(RH, 'formationSuivie.annuler', { id: x.id, motif: 'Saisie sur la mauvaise fiche' });
  assert.match((await bilan()).detail, /aucune formation non obligatoire/);
  assert.equal((await domain()).ds.formationsSuivies!.find(s => s.id === x.id)!.annuleMotif, 'Saisie sur la mauvaise fiche', 'gardée en base pour le service RH');
  await refuse(RH, 'formationSuivie.annuler', { id: x.id, motif: 'Encore' }, /introuvable/, 404);
});

test('formations suivies : filtrées par profil, sans motif ni auteur hors du service RH, export RGPD', async () => {
  const { db, run, RH, user, domain } = await fresh();
  await run(RH, 'formationSuivie.modifier', { id: S.suiviesEnVigueur((await domain()).ds, 2)[0].id, duree: 12, motif: 'Durée corrigée' });
  const vue = async (u: User) => (await domain(u)).ds.formationsSuivies ?? [];
  // Mehdi Benali (2) : sa formation hors catalogue de démonstration.
  const mehdi = await vue(await user(2, 'collaborateur'));
  assert.deepEqual(mehdi.map(x => [x.empId, x.corrigeMotif, x.auteur, x.auteurId]), [[2, null, null, null]]);
  assert.deepEqual(await vue(await user(6, 'collaborateur')), [], 'un autre collaborateur ne la voit pas');
  assert.deepEqual((await vue(await user(12, 'manager'))).map(x => x.empId), [2], 'son manager la voit');
  assert.deepEqual(await vue(await user(16, 'manager')), [], 'un autre manager non');
  assert.equal((await vue(await user(23, 'rh'))).length, 1, 'référent HSE');
  assert.equal((await vue(await user(11, 'rh'))).length, 1, 'lecture seule');
  assert.deepEqual(await vue(await user(7, 'rh')), [], 'paie : aucune formation');
  assert.equal((await vue(RH))[0].corrigeMotif, 'Durée corrigée');
  // Copie des données du salarié : la section, sans l'auteur de l'enregistrement ; complète pour le service RH.
  const perso = ((await donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' }))! as Ligne).sections;
  assert.equal(perso['Formations suivies'][0].libelle, 'Lecture de schémas électriques industriels');
  assert.ok(!('auteur' in perso['Formations suivies'][0]));
  assert.ok('auteur' in ((await donneesSalarie(db, 2, { journal: true, par: 'RH' }))! as Ligne).sections['Formations suivies'][0]);
  assert.ok(perso['Délivrances des habilitations (historique)'].every((x: Ligne) => !('auteurId' in x)));
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('demande hors catalogue acceptée : à clore, close par l’action du plan réalisée (bénéficiaires de l’équipe)', async () => {
  const { run, refuse, RH, user, domain, journal } = await fresh();
  await run(await user(2, 'collaborateur'), 'demande.formation', { f: 'autre', libelle: 'Lecture de plans hydrauliques', motif: 'Maintenance des presses' });
  const r = (await domain()).ds.demandesCollab.find(x => x.libelle === 'Lecture de plans hydrauliques')!;
  await run(RH, 'demande.accepter', { id: r.id });
  const accepte = (await domain()).ds.demandesCollab.find(x => x.id === r.id)!;
  assert.deepEqual(S.demandesAClore((await domain()).ds, 2).map(x => x.id), [r.id]);
  const ligne = (await domain()).ds.plan.find(l => l.id === accepte.suite!.planId)!;
  await run(RH, 'plan.avancer', { id: ligne.id, de: 'prevu' });
  // Bénéficiaire hors de l'équipe : refus, rien n'est écrit.
  await refuse(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [21], du: '2026-10-05' }, /ne fait pas partie de l’équipe Maintenance/);
  await refuse(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [2] }, /premier jour/);
  assert.equal((await domain()).ds.plan.find(l => l.id === ligne.id)!.statut, 'engage');
  const msg = await run(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [2, 6], du: '2026-10-05', au: '2026-10-06', duree: 14 });
  assert.match(msg, /réalisé .* · 2 formations suivies enregistrées$/);
  const suivies = S.suiviesEnVigueur((await domain()).ds).filter(x => x.planActionId === ligne.id);
  assert.deepEqual(suivies.map(x => [x.empId, x.origine, x.libelle, x.obligatoire, x.demandeId]).sort(), [[2, 'plan', 'Lecture de plans hydrauliques', false, r.id], [6, 'plan', 'Lecture de plans hydrauliques', false, null]]);
  assert.deepEqual(S.demandesAClore((await domain()).ds, 2), [], 'demande close');
  const j = (await journal('plan.avancer')).at(-1)!;
  assert.deepEqual(j.payload.beneficiaires, [2, 6]);
  assert.deepEqual([...j.salaries].sort(), [2, 6]);
  // Même clôture depuis un second onglet : « déjà réalisé », rien d'écrit ; le journal ne nomme aucun bénéficiaire.
  assert.match(await run(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [2, 6], du: '2026-10-05' }), /déjà réalisé/);
  const j2 = (await journal('plan.avancer')).at(-1)!;
  assert.notEqual(j2.id, j.id);
  assert.equal(j2.payload.beneficiaires, undefined);
  assert.deepEqual(j2.salaries ?? [], []);
  assert.equal(S.suiviesEnVigueur((await domain()).ds).filter(x => x.planActionId === ligne.id).length, 2);
  // Demande close par l'action réalisée : elle ne se rouvre plus (la formation suivie resterait rattachée à un refus).
  await refuse(RH, 'demande.reouvrir', { id: r.id, motif: 'Acceptée par erreur' }, /Formation suivie du 5 oct\. 2026 enregistrée pour cette demande/);
  // Saisie directe d'une demande déjà close : refus.
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 2, demandeId: r.id, du: '2026-10-05' }, /déjà enregistrée/);
});

test('demande hors catalogue close par une saisie directe ; action réalisée par une session clôturée : pas de bénéficiaires', async () => {
  const { db, run, refuse, RH, user, domain } = await fresh();
  await run(await user(2, 'collaborateur'), 'demande.formation', { f: 'autre', libelle: 'Soudure TIG', motif: 'Réparations' });
  const r = (await domain()).ds.demandesCollab.find(x => x.libelle === 'Soudure TIG')!;
  await run(RH, 'demande.accepter', { id: r.id });
  await refuse(RH, 'formationSuivie.enregistrer', { empId: 6, demandeId: r.id, du: '2026-10-01' }, /introuvable pour ce collaborateur/);
  // Ligne du plan créée par l'acceptation, encore prévue : signalée, à clore dans Plan & budget.
  assert.match(await run(await user(23, 'rh'), 'formationSuivie.enregistrer', { empId: 2, demandeId: r.id, du: '2026-10-01', au: '2026-10-02' }), /ligne du plan 2026 à passer « réalisée » dans Plan & budget$/);
  const x = S.suiviesEnVigueur((await domain()).ds, 2).find(s => s.demandeId === r.id)!;
  assert.deepEqual([x.libelle, x.origine, x.planActionId, x.auteurId], ['Soudure TIG', 'demande', (await domain()).ds.demandesCollab.find(d => d.id === r.id)!.suite!.planId, 23]);
  // Réouverture refusée tant que la formation suivie est en vigueur ; après sa suppression (saisie erronée), possible.
  await refuse(RH, 'demande.reouvrir', { id: r.id, motif: 'Acceptée par erreur' }, /Formation suivie du 1 oct\. 2026 enregistrée pour cette demande/);
  await run(RH, 'formationSuivie.annuler', { id: x.id, motif: 'Saisie sur la mauvaise demande' });
  assert.match(await run(RH, 'demande.reouvrir', { id: r.id, motif: 'Acceptée par erreur' }), /rouverte/);
  // Ligne réalisée par une session clôturée (SST de la Production) : ses participants ont leur certification.
  const l = await db.insert<Ligne>('planActions', { exercice: 2026, f: 'sst', libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 2, cout: 360, statut: 'engage', origine: null });
  await db.insert('sessions', { formation: 'sst', date: '2026-10-01', fin: '2026-10-01', jours: ['2026-10-01'], horaires: [], lieu: 'Site', places: 4, statut: 'Clôturée', planId: l.id, bilan: null });
  await refuse(RH, 'plan.avancer', { id: l.id, de: 'engage', coutReel: 360, beneficiaires: [2], du: '2026-10-01' }, /session clôturée/);
});

// — t115 : historique des délivrances, titre imprimé, passeport —

test('renouvellement d’une habilitation : la délivrance précédente est close, mesure figée, sans motif ; historique au passeport', async () => {
  const { db, run, RH, user, domain, emp } = await fresh();
  const delivrances = async (h: string) => ((await domain()).ds.habDelivrances ?? []).filter(x => x.empId === 2 && x.h === h).sort((a, b) => a.id - b.id);
  // Amorcée depuis le titre en vigueur (comme la migration).
  assert.deepEqual((await delivrances('hauteur')).map(x => [x.delivree, x.par, x.expire, x.remplaceeLe]), [['2025-02-01', 'Sarah Cohen', '2028-02-01', null]]);
  await run(RH, 'hab.delivrer', { empId: 2, h: 'hauteur', date: '2026-10-05', par: 'Karim Haddad', mode: 'renew' });
  assert.deepEqual((await delivrances('hauteur')).map(x => [x.delivree, x.par, x.remplaceeLe, x.mesure, x.auteur]),
    [['2025-02-01', 'Sarah Cohen', '2026-10-05', null, null], ['2026-10-05', 'Karim Haddad', null, null, 'Sandrine Vidal']]);
  // Retrait puis nouvelle délivrance : le retrait est figé sur la délivrance remplacée (date, jamais le motif).
  await run(RH, 'hab.retirer', { empId: 2, h: 'hauteur', motif: 'Manquement grave aux règles', date: '2026-10-07' });
  await run(await user(23, 'rh'), 'hab.delivrer', { empId: 2, h: 'hauteur', date: '2026-10-09', par: 'Sarah Cohen', mode: 'deliver' });
  const [, retiree, actuelle] = await delivrances('hauteur');
  assert.deepEqual([retiree.remplaceeLe, retiree.mesure, retiree.mesureDate, actuelle.remplaceeLe, actuelle.auteurId], ['2026-10-09', 'retrait', '2026-10-07', null, 23]);
  assert.ok(!JSON.stringify((await domain()).ds.habDelivrances).includes('Manquement'));
  // Titre délivré avant l'historique (aucune ligne) : sa délivrance est inscrite au moment où elle est remplacée.
  await db.exec(`DELETE FROM hab_delivrances WHERE emp_id = 18 AND h = 'aipr'`);
  await run(RH, 'hab.delivrer', { empId: 18, h: 'aipr', date: '2026-10-08', par: 'Karim Haddad', mode: 'renew' });
  assert.deepEqual(((await domain()).ds.habDelivrances ?? []).filter(x => x.empId === 18 && x.h === 'aipr').map(x => [x.delivree, x.remplaceeLe]), [['2022-12-01', '2026-10-08'], ['2026-10-08', null]]);
  // Passeport (fiche ou portail) : habilitations antérieures, formations suivies ; le motif du retrait n'y figure pas.
  const mehdi = await user(2, 'collaborateur');
  const d = await domain(mehdi);
  const sections = sectionsPasseport(d, await emp(2, d));
  assert.deepEqual(sections.map(s => s.title), ['Certifications', 'Habilitations', 'Habilitations antérieures', 'Formations suivies']);
  const ant = sections.find(s => s.title === 'Habilitations antérieures')!.table!;
  assert.deepEqual(ant.head, ['Habilitation', 'Délivrée le', 'Par', 'Expirait le', 'Remplacée le', 'Mesure']);
  assert.ok(ant.rows.some(r => r[0] === 'Habilitation électrique' && r[2] === 'Philippe Aubert'), 'délivrance de démonstration remplacée en 2023');
  assert.ok(ant.rows.some(r => r[5].startsWith('Retirée le')));
  assert.ok(!JSON.stringify(sections).includes('Manquement'));
  assert.deepEqual(sections.find(s => s.title === 'Formations suivies')!.table!.rows[0].slice(0, 4), ['Lecture de schémas électriques industriels', '18 mars 2025', '19 mars 2025', '14 h']);
  // Vues : auteur retiré hors du service RH ; paie : rien.
  assert.ok((d.ds.habDelivrances ?? []).every(x => x.auteur === null && x.auteurId === null));
  assert.deepEqual((await domain(await user(7, 'rh'))).ds.habDelivrances, []);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('titre d’habilitation imprimé : modèle du référentiel, prérequis vérifiés, aptitude sans l’avis, deux signatures', async () => {
  const { run, RH, domain, emp } = await fresh();
  const d = await domain();
  const mehdi = await emp(2, d);
  const he = d.hm('he');
  assert.equal(he.modele, 'electrique');
  const titre = sectionsTitre(mehdi, he, { delivree: '2026-10-05', par: 'Karim Haddad' });
  const texte = JSON.stringify(titre);
  assert.deepEqual(titre.map(s => s.title), ['Titulaire', 'Habilitation', 'Prérequis vérifiés à la délivrance', 'Champ de l’habilitation', 'Mentions', 'Signatures']);
  assert.match(texte, /NF C18-510/);
  assert.match(texte, /B1V · B2V · BR/);
  assert.match(texte, /Valable jusqu’au","5 oct\. 2029/);
  assert.match(texte, /Aptitude médicale","vérifiée/);
  assert.ok(!/\bavis\b|\bapte\b|inapte/i.test(texte), 'jamais l’avis ni les restrictions');
  assert.match(texte, /Pour l’employeur","Karim Haddad/);
  assert.match(texte, /Le titulaire","Mehdi Benali/);
  const conduite = JSON.stringify(sectionsTitre(await emp(1, d), d.hm('ac489'), { delivree: '2026-10-05', par: 'Olivier Marchal' }));
  assert.match(conduite, /R4323-55 à R4323-57/);
  assert.match(conduite, /Catégories autorisées","Chariots élévateurs cat\. 3/);
  // Modèle choisi au référentiel : générique par défaut, conservé si absent de la saisie, contrôlé.
  const ref = d.ds.referentiels;
  assert.equal(controlerHabilitation({ code: 'essai', nom: 'Essai', validite: 12, signataire: 'X' }, ref.habilitations, ref.formations).habilitation!.modele, 'generique');
  assert.equal(controlerHabilitation({ nom: he.nom, detail: he.detail, prereqs: he.prereqs, validite: 36, signataire: 'X' }, ref.habilitations, ref.formations, 'he').habilitation!.modele, 'electrique');
  assert.equal(controlerHabilitation({ code: 'essai', nom: 'Essai', validite: 12, signataire: 'X', modele: 'autre' }, ref.habilitations, ref.formations).erreurs.modele, 'Choisissez le modèle du titre imprimé.');
  await run(RH, 'referentiel.habilitation.enregistrer', { id: 'atex', nom: 'Habilitation ATEX', detail: 'Zones 1 et 2', prereqs: ['atex'], medical: false, validite: 36, signataire: 'Sarah Cohen', modele: 'conduite' });
  assert.equal((await domain()).hm('atex').modele, 'conduite');
  assert.match(JSON.stringify(sectionsTitre(await emp(3), (await domain()).hm('atex'), { delivree: '2026-10-05', par: 'Sarah Cohen' })), /Prérequis vérifiés.*ATEX/);
});

test('migration : délivrances en vigueur amorcées une fois, tracées, sans orphelin', async () => {
  const { db, journal } = await fresh();
  await db.exec('DELETE FROM hab_delivrances');
  const delivres = Number((await db.one('SELECT COUNT(*) AS n FROM hab_titres WHERE delivree IS NOT NULL') as { n: number }).n);
  assert.equal(await HAB_DELIVRANCES.necessaire!(db), true);
  assert.equal(await db.tx(async () => await HAB_DELIVRANCES.executer(db)), `${delivres} délivrances en vigueur inscrites`);
  assert.deepEqual((await journal('migration.habDelivrances')).at(-1)!.payload, { delivrances: delivres });
  assert.equal(await db.tx(() => HAB_DELIVRANCES.executer(db)), undefined, 'rien à refaire');
  // Échéance avec la fin de mois (addMonths) : ac489 délivrée le 15 avril 2022, 60 mois.
  assert.equal((await db.all<Ligne>('habDelivrances')).find(x => x.empId === 1)!.expire, '2027-04-15');
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

// — t122 : durée en heures et indicateurs —

test('durée en heures : lue dans le texte quand elle y est seule, contrôlée, extraite par la migration', async () => {
  const { db, run, RH, domain } = await fresh();
  assert.deepEqual(['21 h', '7 h (MAC)', '3,5 heures', '14h', '2 jours', '', '7 h + 7 h', '7 h ou 14 h', '5000 h', '2 x 7 h', '7 h par jour sur 3 jours', '21 h (3 jours)'].map(H.dureeHeuresDe),
    [21, 7, 3.5, 14, null, null, null, null, null, null, null, null], 'jamais une durée unitaire répétée prise pour le total');
  const ref = (await domain()).ds.referentiels.formations;
  const sst = ref.find(f => f.id === 'sst')!;
  assert.equal(sst.dureeHeures, 7, 'jeu de démonstration');
  const base = { nom: sst.nom, court: sst.court, type: sst.type, validite: 24, validation: sst.validation, duree: sst.duree, organisme: sst.organisme, cout: sst.cout };
  assert.equal(controlerFormation(base, ref, 'sst').formation!.dureeHeures, 7, 'absente de la saisie : inchangée');
  assert.equal(controlerFormation({ ...base, dureeHeures: '' }, ref, 'sst').formation!.dureeHeures, null, 'vide : effacée');
  assert.match(controlerFormation({ ...base, dureeHeures: '0' }, ref, 'sst').erreurs.dureeHeures!, /0,25 à 2/);
  await run(RH, 'referentiel.formation.enregistrer', { id: 'sst', ...base, dureeHeures: '10,5' });
  assert.equal((await domain()).fm('sst').dureeHeures, 10.5);
  // Base d'avant le lot 6 : durées en heures vides, extraites du texte quand il en donne une seule.
  await db.exec(`UPDATE formations SET duree_heures = NULL; UPDATE formations SET duree = '2 jours' WHERE id = 'rgpd'`);
  assert.equal(await DUREE_HEURES.necessaire!(db), true);
  assert.equal(await db.tx(async () => await DUREE_HEURES.executer(db)), '10 durées en heures extraites');
  assert.deepEqual([(await domain()).fm('fco').dureeHeures, (await domain()).fm('rgpd').dureeHeures ?? null], [35, null]);
});

test('heures d’une session : horaires de chaque jour, sinon la durée du catalogue, sinon inconnues', () => {
  const s = { date: '2026-11-02', fin: '2026-11-03', jours: ['2026-11-02', '2026-11-03'], horaires: [{ debut: '08:30', fin: '17:00', pause: 60 }] };
  assert.equal(H.heuresSession(s, { dureeHeures: 14 }), 15);
  assert.equal(H.heuresSession({ ...s, horaires: [] }, { dureeHeures: 14 }), 14);
  assert.equal(H.heuresSession({ ...s, horaires: [] }, { dureeHeures: null }), null);
});

test('indicateurs du plan par exercice : stagiaires, heures par catégorie, équipe et statut, durée inconnue signalée, exports', async () => {
  const { db, run, RH, domain } = await fresh();
  await run(RH, 'formationSuivie.enregistrer', { empId: 21, libelle: 'Anglais professionnel', du: '2026-03-02', duree: 21 });
  await run(RH, 'formationSuivie.enregistrer', { empId: 6, libelle: 'Conduite de réunion', du: '2026-04-02' });
  const d = await domain();
  const x = H.indicateursFormation(d, 2026);
  const hors = x.parCategorie.find(l => l.cle === 'Hors catalogue')!;
  assert.deepEqual([hors.stagiaires, hors.realisations, hors.heures, hors.inconnues], [2, 2, 21, 1]);
  assert.ok(x.inconnues.some(r => r.intitule === 'Conduite de réunion'), 'durée inconnue signalée');
  assert.equal(x.total.realisations, x.parCategorie.reduce((n, l) => n + l.realisations, 0));
  assert.equal(x.total.heures, x.parEquipe.reduce((n, l) => Math.round((n + l.heures) * 100) / 100, 0));
  assert.deepEqual(x.parStatut.map(l => l.cle), ['Ouvrier / employé', 'Technicien / agent de maîtrise', 'Ingénieur / cadre']);
  // Une certification produite par une session clôturée n'est comptée qu'une fois (par la participation).
  const parSession = new Set(d.ds.participations.map(p => p.certId).filter(Boolean));
  assert.ok(x.realisations.filter(r => r.source === 'certification').every(r => !d.ds.employes.some(e => e.certs.some(c => parSession.has(c.id) && c.obtenue === r.date && e.id === r.empId && d.fm(c.f).nom === r.intitule))));
  // Plan : actions hors reportées, réalisées, taux, coûts.
  const plan = d.ds.plan.filter(l => l.exercice === 2026 && l.statut !== 'reporte');
  assert.equal(x.actions, plan.length);
  assert.equal(x.tauxRealisation, Math.round(plan.filter(l => l.statut === 'realise').length / plan.length * 100));
  // Exports : indicateurs et formations suivies de l'exercice.
  const c = csvIndicateurs(d, x);
  assert.deepEqual(c.head, ['Regroupement', 'Valeur', 'Stagiaires', 'Formations réalisées', 'Heures', 'Durée inconnue']);
  assert.ok(c.rows.some(r => r[0] === 'Catégorie' && r[1] === 'Hors catalogue' && r[4] === '21'));
  assert.ok(c.rows.some(r => r[0] === 'Durée inconnue' && String(r[1]).startsWith('Conduite de réunion')));
  const fs = csvFormationsSuivies(d, 2026);
  assert.equal(fs.rows.length, 2, 'celle de 2025 (démonstration) hors de l’exercice');
  assert.deepEqual(fs.rows.find(r => r[0] === 'Manon Faure')?.slice(3, 8), ['Anglais professionnel', 'Hors catalogue', '02/03/2026', '02/03/2026', '21']);
  // Plan exporté : catégorie et durée en heures du catalogue.
  const p = csvPlan(d, 2026, d.ds.plan.filter(l => l.exercice === 2026));
  assert.deepEqual(p.head.slice(-2), ['Catégorie', 'Durée (h)']);
  assert.ok(p.rows.some(r => r[1] === 'Sauveteur secouriste du travail (SST)' && r[9] === 'Réglementaire' && r[10] === '7'));
  assert.ok(await db.count('formationsSuivies') >= 3);
});

// — Constats de relecture (lot 6, chantier 4, étape 2) —

test('titre d’habilitation : seul un titre en vigueur s’imprime ; aptitude et prérequis tels qu’à la délivrance', async () => {
  const { run, RH, domain, emp } = await fresh();
  const hab = async (h: string) => (await emp(2)).habs.find(x => x.h === h)!;
  // Mehdi Benali : travaux en hauteur valides ; habilitation électrique échue le 1er octobre 2026.
  assert.equal(titreImprimable(await hab('hauteur')), true);
  assert.equal((await hab('he')).key, 'exp');
  assert.equal(titreImprimable(await hab('he')), false, 'titre échu');
  await run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Vertiges signalés', date: '2026-10-06' });
  assert.equal(titreImprimable(await hab('hauteur')), false, 'titre suspendu');
  await run(RH, 'hab.retirer', { empId: 2, h: 'hauteur', motif: 'Manquement grave aux règles', date: '2026-10-07' });
  assert.equal((await hab('hauteur')).key, 'retiree');
  assert.equal(titreImprimable(await hab('hauteur')), false, 'titre retiré : pas de bouton « Imprimer le titre »');
  // Prérequis non satisfait (statut « Suspendue » sans mesure) : pas d'impression.
  assert.equal(titreImprimable({ ...await hab('hauteur'), mesure: null, key: 'susp', prereqOk: false }), false);
  // Aptitude non valable : jamais « vérifiée » ; prérequis : certification valide à la date de délivrance seulement.
  const d = await domain();
  const mehdi = await emp(2, d);
  const inapte = JSON.stringify(sectionsTitre({ ...mehdi, med: { ...mehdi.med, ok: false } }, d.hm('he'), { delivree: '2026-10-05', par: 'Karim Haddad' }));
  assert.match(inapte, /Aptitude médicale","non vérifiée/);
  assert.match(JSON.stringify(sectionsTitre(mehdi, d.hm('he'), { delivree: '2023-10-01', par: 'Karim Haddad' })), /obtenue le 14 sept\. 2023/);
  assert.match(JSON.stringify(sectionsTitre(mehdi, d.hm('he'), { delivree: '2023-09-01', par: 'Karim Haddad' })), /aucune certification valide à cette date/, 'obtenue après la délivrance');
});

test('action du plan d’une formation du catalogue réalisée sans session, puis certification : comptée une seule fois', async () => {
  const { db, run, RH, user, domain, emp } = await fresh();
  const l = await db.insert<Ligne>('planActions', { exercice: 2026, f: 'prap', libelle: null, equipe: 'Maintenance', periode: 'T3', effectif: 1, cout: 400, statut: 'engage', origine: null });
  await run(RH, 'plan.avancer', { id: l.id, de: 'engage', coutReel: 400, beneficiaires: [2], du: '2026-09-01', au: '2026-09-02' });
  const prap = async (dd?: InstanceType<typeof Domain>) => { const d = dd ?? await domain(); return H.realisationsDe(d, 2026).filter(r => r.empId === 2 && r.intitule === d.fm('prap').nom); };
  assert.deepEqual((await prap()).map(r => [r.source, r.heures]), [['suivie', 14]], 'avant la certification : la formation suivie');
  await run(RH, 'cert.ajouter', { empId: 2, f: 'prap', date: '2026-09-02' });
  assert.deepEqual((await prap()).map(r => [r.source, r.heures]), [['certification', 14]], 'une ligne, 14 h');
  const x = S.suiviesEnVigueur((await domain()).ds, 2).find(s => s.planActionId === l.id)!;
  assert.equal(S.suivieCertifiee((await domain()).emp(2), x), true);
  // Passeport : la PRAP figure parmi les certifications, pas une seconde fois parmi les formations suivies.
  const d = await domain(await user(2, 'collaborateur'));
  const sections = sectionsPasseport(d, await emp(2, d));
  assert.ok(sections.find(s => s.title === 'Certifications')!.table!.rows.some(r => r[0] === d.fm('prap').nom));
  assert.ok(!sections.find(s => s.title === 'Formations suivies')!.table!.rows.some(r => r[0] === d.fm('prap').nom));
  // Certification d'une autre période (hors du premier jour au dernier, plus 7 jours) : les deux comptent.
  assert.equal(S.suivieCertifiee({ certs: [{ f: 'prap', obtenue: '2026-09-10' }] } as never, x), false);
});
