// Lot 6, chantier 4, étape 2 : formations suivies par salarié, hors catalogue comprises (t116), historique des délivrances
// d'habilitation, titre à signer et passeport formation partagé avec le portail (t115), durée en heures et indicateurs du
// plan de formation (t122). Jeu de démonstration au 10 octobre 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
for (const k of ['CURSUS_MAIL_FROM', 'CURSUS_MAIL_TENANT', 'CURSUS_MAIL_CLIENT_ID', 'CURSUS_MAIL_CLIENT_SECRET']) delete process.env[k];

await import('./outils/client-node.ts');
const { Db } = await import('../server/src/db.ts');
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
type User = NonNullable<ReturnType<typeof currentUser>>;
type Ligne = Record<string, any>;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
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
    (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} devait être refusé`);
  const RH = user(null, 'rh');
  const domain = (u: User = RH) => new Domain(u.role === 'rh' && u === RH ? loadFull(db, RH) : buildSnapshot(db, u));
  const emp = (id: number, d = domain()) => d.enrich(90, false, { sortis: true }).find(e => e.id === id)!;
  const journal = (action: string) => db.all<Ligne>('journal').filter(l => l.action === action);
  return { db, run, refuse, user, RH, domain, emp, journal };
}

// — t116 : formations suivies —

test('formation hors catalogue saisie : non obligatoire par défaut, comptée au bilan à 8 ans, journal sans texte libre', () => {
  const { run, refuse, RH, user, domain, journal } = fresh();
  // Pierre Fontaine (10) : aucune formation non obligatoire depuis 8 ans, risque d'abondement correctif du CPF.
  const bilan = () => obligations(domain(), [10]).find(o => o.kind === 'bilan')!;
  assert.match(bilan().detail, /aucune formation non obligatoire/);
  assert.equal(bilan().risk, true);
  refuse(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Anglais', du: '2026-11-02' }, /pas encore eu lieu/);
  refuse(RH, 'formationSuivie.enregistrer', { empId: 10, du: '2026-03-02' }, /intitulé de la formation hors catalogue/);
  refuse(RH, 'formationSuivie.enregistrer', { empId: 10, f: 'inconnue', du: '2026-03-02' }, /inconnue du catalogue/);
  refuse(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Anglais', du: '2026-03-04', au: '2026-03-02' }, /précède/);
  // Obligatoire (case cochée) : ne compte pas.
  run(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Habilitation de chantier client', du: '2025-06-02', obligatoire: true });
  assert.match(bilan().detail, /aucune formation non obligatoire/);
  const msg = run(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'Anglais professionnel', du: '2026-03-02', au: '2026-03-06', duree: '17,5', organisme: 'Langues & Co' });
  assert.match(msg, /Anglais professionnel — .* · formation suivie du 2 mars 2026 enregistrée \(non obligatoire\)/);
  assert.match(bilan().detail, /formation non obligatoire suivie/);
  refuse(RH, 'formationSuivie.enregistrer', { empId: 10, libelle: 'anglais  professionnel', du: '2026-03-02' }, /déjà enregistrée pour Pierre Fontaine/);
  const x = S.suiviesEnVigueur(domain().ds, 10).find(s => s.libelle === 'Anglais professionnel')!;
  assert.deepEqual([x.f, x.au, x.duree, x.obligatoire, x.origine, x.auteur], [null, '2026-03-06', 17.5, false, 'saisie', 'Sandrine Vidal']);
  // Journal : codes, dates et durée ; ni l'intitulé ni l'organisme (texte libre).
  const j = journal('formationSuivie.enregistrer').at(-1)!;
  assert.deepEqual(j.payload, { empId: 10, du: '2026-03-02', au: '2026-03-06', duree: 17.5, obligatoire: false, id: x.id });
  assert.ok(!JSON.stringify(j).includes('Langues'));
  assert.equal(familleAction('formationSuivie.enregistrer')?.id, 'formations');
  assert.ok(JOURNAL_LABEL['formationSuivie.modifier'] && JOURNAL_LABEL['formationSuivie.annuler']);

  // Correction motivée (motif jamais au journal), puis suppression par l'administrateur RH : hors des calculs.
  refuse(RH, 'formationSuivie.modifier', { id: x.id, duree: 21 }, /Motif de la correction obligatoire/);
  run(RH, 'formationSuivie.modifier', { id: x.id, duree: 21, organisme: 'Autre organisme', motif: 'Durée de l’attestation mal recopiée' });
  const m = journal('formationSuivie.modifier').at(-1)!;
  assert.ok(!JSON.stringify(m).includes('attestation') && !JSON.stringify(m).includes('Autre organisme'), 'ni motif ni organisme');
  assert.equal(run(RH, 'formationSuivie.modifier', { id: x.id, duree: 21, motif: 'x' }), 'Aucune modification');
  const gest = user(14, 'rh');
  assert.throws(() => run(gest, 'formationSuivie.annuler', { id: x.id, motif: 'Erreur' }), (e: unknown) => e instanceof ActionError && e.status === 403);
  run(RH, 'formationSuivie.annuler', { id: x.id, motif: 'Saisie sur la mauvaise fiche' });
  assert.match(bilan().detail, /aucune formation non obligatoire/);
  assert.equal(domain().ds.formationsSuivies!.find(s => s.id === x.id)!.annuleMotif, 'Saisie sur la mauvaise fiche', 'gardée en base pour le service RH');
  refuse(RH, 'formationSuivie.annuler', { id: x.id, motif: 'Encore' }, /introuvable/, 404);
});

test('formations suivies : filtrées par profil, sans motif ni auteur hors du service RH, export RGPD', () => {
  const { db, run, RH, user, domain } = fresh();
  run(RH, 'formationSuivie.modifier', { id: S.suiviesEnVigueur(domain().ds, 2)[0].id, duree: 12, motif: 'Durée corrigée' });
  const vue = (u: User) => domain(u).ds.formationsSuivies ?? [];
  // Mehdi Benali (2) : sa formation hors catalogue de démonstration.
  const mehdi = vue(user(2, 'collaborateur'));
  assert.deepEqual(mehdi.map(x => [x.empId, x.corrigeMotif, x.auteur, x.auteurId]), [[2, null, null, null]]);
  assert.deepEqual(vue(user(6, 'collaborateur')), [], 'un autre collaborateur ne la voit pas');
  assert.deepEqual(vue(user(12, 'manager')).map(x => x.empId), [2], 'son manager la voit');
  assert.deepEqual(vue(user(16, 'manager')), [], 'un autre manager non');
  assert.equal(vue(user(23, 'rh')).length, 1, 'référent HSE');
  assert.equal(vue(user(11, 'rh')).length, 1, 'lecture seule');
  assert.deepEqual(vue(user(7, 'rh')), [], 'paie : aucune formation');
  assert.equal(vue(RH)[0].corrigeMotif, 'Durée corrigée');
  // Copie des données du salarié : la section, sans l'auteur de l'enregistrement ; complète pour le service RH.
  const perso = (donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' })! as Ligne).sections;
  assert.equal(perso['Formations suivies'][0].libelle, 'Lecture de schémas électriques industriels');
  assert.ok(!('auteur' in perso['Formations suivies'][0]));
  assert.ok('auteur' in (donneesSalarie(db, 2, { journal: true, par: 'RH' })! as Ligne).sections['Formations suivies'][0]);
  assert.ok(perso['Délivrances des habilitations (historique)'].every((x: Ligne) => !('auteurId' in x)));
  assert.equal(controlerOrphelins(db).orphelins, 0);
});

test('demande hors catalogue acceptée : à clore, close par l’action du plan réalisée (bénéficiaires de l’équipe)', () => {
  const { run, refuse, RH, user, domain, journal } = fresh();
  run(user(2, 'collaborateur'), 'demande.formation', { f: 'autre', libelle: 'Lecture de plans hydrauliques', motif: 'Maintenance des presses' });
  const r = domain().ds.demandesCollab.find(x => x.libelle === 'Lecture de plans hydrauliques')!;
  run(RH, 'demande.accepter', { id: r.id });
  const accepte = domain().ds.demandesCollab.find(x => x.id === r.id)!;
  assert.deepEqual(S.demandesAClore(domain().ds, 2).map(x => x.id), [r.id]);
  const ligne = domain().ds.plan.find(l => l.id === accepte.suite!.planId)!;
  run(RH, 'plan.avancer', { id: ligne.id, de: 'prevu' });
  // Bénéficiaire hors de l'équipe : refus, rien n'est écrit.
  refuse(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [21], du: '2026-10-05' }, /ne fait pas partie de l’équipe Maintenance/);
  refuse(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [2] }, /premier jour/);
  assert.equal(domain().ds.plan.find(l => l.id === ligne.id)!.statut, 'engage');
  const msg = run(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [2, 6], du: '2026-10-05', au: '2026-10-06', duree: 14 });
  assert.match(msg, /réalisé .* · 2 formations suivies enregistrées$/);
  const suivies = S.suiviesEnVigueur(domain().ds).filter(x => x.planActionId === ligne.id);
  assert.deepEqual(suivies.map(x => [x.empId, x.origine, x.libelle, x.obligatoire, x.demandeId]).sort(), [[2, 'plan', 'Lecture de plans hydrauliques', false, r.id], [6, 'plan', 'Lecture de plans hydrauliques', false, null]]);
  assert.deepEqual(S.demandesAClore(domain().ds, 2), [], 'demande close');
  const j = journal('plan.avancer').at(-1)!;
  assert.deepEqual(j.payload.beneficiaires, [2, 6]);
  assert.deepEqual([...j.salaries].sort(), [2, 6]);
  // Même clôture depuis un second onglet : « déjà réalisé », rien d'écrit ; le journal ne nomme aucun bénéficiaire.
  assert.match(run(RH, 'plan.avancer', { id: ligne.id, de: 'engage', coutReel: 300, beneficiaires: [2, 6], du: '2026-10-05' }), /déjà réalisé/);
  const j2 = journal('plan.avancer').at(-1)!;
  assert.notEqual(j2.id, j.id);
  assert.equal(j2.payload.beneficiaires, undefined);
  assert.deepEqual(j2.salaries ?? [], []);
  assert.equal(S.suiviesEnVigueur(domain().ds).filter(x => x.planActionId === ligne.id).length, 2);
  // Demande close par l'action réalisée : elle ne se rouvre plus (la formation suivie resterait rattachée à un refus).
  refuse(RH, 'demande.reouvrir', { id: r.id, motif: 'Acceptée par erreur' }, /Formation suivie du 5 oct\. 2026 enregistrée pour cette demande/);
  // Saisie directe d'une demande déjà close : refus.
  refuse(RH, 'formationSuivie.enregistrer', { empId: 2, demandeId: r.id, du: '2026-10-05' }, /déjà enregistrée/);
});

test('demande hors catalogue close par une saisie directe ; action réalisée par une session clôturée : pas de bénéficiaires', () => {
  const { db, run, refuse, RH, user, domain } = fresh();
  run(user(2, 'collaborateur'), 'demande.formation', { f: 'autre', libelle: 'Soudure TIG', motif: 'Réparations' });
  const r = domain().ds.demandesCollab.find(x => x.libelle === 'Soudure TIG')!;
  run(RH, 'demande.accepter', { id: r.id });
  refuse(RH, 'formationSuivie.enregistrer', { empId: 6, demandeId: r.id, du: '2026-10-01' }, /introuvable pour ce collaborateur/);
  // Ligne du plan créée par l'acceptation, encore prévue : signalée, à clore dans Plan & budget.
  assert.match(run(user(23, 'rh'), 'formationSuivie.enregistrer', { empId: 2, demandeId: r.id, du: '2026-10-01', au: '2026-10-02' }), /ligne du plan 2026 à passer « réalisée » dans Plan & budget$/);
  const x = S.suiviesEnVigueur(domain().ds, 2).find(s => s.demandeId === r.id)!;
  assert.deepEqual([x.libelle, x.origine, x.planActionId, x.auteurId], ['Soudure TIG', 'demande', domain().ds.demandesCollab.find(d => d.id === r.id)!.suite!.planId, 23]);
  // Réouverture refusée tant que la formation suivie est en vigueur ; après sa suppression (saisie erronée), possible.
  refuse(RH, 'demande.reouvrir', { id: r.id, motif: 'Acceptée par erreur' }, /Formation suivie du 1 oct\. 2026 enregistrée pour cette demande/);
  run(RH, 'formationSuivie.annuler', { id: x.id, motif: 'Saisie sur la mauvaise demande' });
  assert.match(run(RH, 'demande.reouvrir', { id: r.id, motif: 'Acceptée par erreur' }), /rouverte/);
  // Ligne réalisée par une session clôturée (SST de la Production) : ses participants ont leur certification.
  const l = db.insert<Ligne>('planActions', { exercice: 2026, f: 'sst', libelle: null, equipe: 'Maintenance', periode: 'T4', effectif: 2, cout: 360, statut: 'engage', origine: null });
  db.insert('sessions', { formation: 'sst', date: '2026-10-01', fin: '2026-10-01', jours: ['2026-10-01'], horaires: [], lieu: 'Site', places: 4, statut: 'Clôturée', planId: l.id, bilan: null });
  refuse(RH, 'plan.avancer', { id: l.id, de: 'engage', coutReel: 360, beneficiaires: [2], du: '2026-10-01' }, /session clôturée/);
});

// — t115 : historique des délivrances, titre imprimé, passeport —

test('renouvellement d’une habilitation : la délivrance précédente est close, mesure figée, sans motif ; historique au passeport', () => {
  const { db, run, RH, user, domain, emp } = fresh();
  const delivrances = (h: string) => (domain().ds.habDelivrances ?? []).filter(x => x.empId === 2 && x.h === h).sort((a, b) => a.id - b.id);
  // Amorcée depuis le titre en vigueur (comme la migration).
  assert.deepEqual(delivrances('hauteur').map(x => [x.delivree, x.par, x.expire, x.remplaceeLe]), [['2025-02-01', 'Sarah Cohen', '2028-02-01', null]]);
  run(RH, 'hab.delivrer', { empId: 2, h: 'hauteur', date: '2026-10-05', par: 'Karim Haddad', mode: 'renew' });
  assert.deepEqual(delivrances('hauteur').map(x => [x.delivree, x.par, x.remplaceeLe, x.mesure, x.auteur]),
    [['2025-02-01', 'Sarah Cohen', '2026-10-05', null, null], ['2026-10-05', 'Karim Haddad', null, null, 'Sandrine Vidal']]);
  // Retrait puis nouvelle délivrance : le retrait est figé sur la délivrance remplacée (date, jamais le motif).
  run(RH, 'hab.retirer', { empId: 2, h: 'hauteur', motif: 'Manquement grave aux règles', date: '2026-10-07' });
  run(user(23, 'rh'), 'hab.delivrer', { empId: 2, h: 'hauteur', date: '2026-10-09', par: 'Sarah Cohen', mode: 'deliver' });
  const [, retiree, actuelle] = delivrances('hauteur');
  assert.deepEqual([retiree.remplaceeLe, retiree.mesure, retiree.mesureDate, actuelle.remplaceeLe, actuelle.auteurId], ['2026-10-09', 'retrait', '2026-10-07', null, 23]);
  assert.ok(!JSON.stringify(domain().ds.habDelivrances).includes('Manquement'));
  // Titre délivré avant l'historique (aucune ligne) : sa délivrance est inscrite au moment où elle est remplacée.
  db.sql.exec(`DELETE FROM hab_delivrances WHERE emp_id = 18 AND h = 'aipr'`);
  run(RH, 'hab.delivrer', { empId: 18, h: 'aipr', date: '2026-10-08', par: 'Karim Haddad', mode: 'renew' });
  assert.deepEqual((domain().ds.habDelivrances ?? []).filter(x => x.empId === 18 && x.h === 'aipr').map(x => [x.delivree, x.remplaceeLe]), [['2022-12-01', '2026-10-08'], ['2026-10-08', null]]);
  // Passeport (fiche ou portail) : habilitations antérieures, formations suivies ; le motif du retrait n'y figure pas.
  const mehdi = user(2, 'collaborateur');
  const d = domain(mehdi);
  const sections = sectionsPasseport(d, emp(2, d));
  assert.deepEqual(sections.map(s => s.title), ['Certifications', 'Habilitations', 'Habilitations antérieures', 'Formations suivies']);
  const ant = sections.find(s => s.title === 'Habilitations antérieures')!.table!;
  assert.deepEqual(ant.head, ['Habilitation', 'Délivrée le', 'Par', 'Expirait le', 'Remplacée le', 'Mesure']);
  assert.ok(ant.rows.some(r => r[0] === 'Habilitation électrique' && r[2] === 'Philippe Aubert'), 'délivrance de démonstration remplacée en 2023');
  assert.ok(ant.rows.some(r => r[5].startsWith('Retirée le')));
  assert.ok(!JSON.stringify(sections).includes('Manquement'));
  assert.deepEqual(sections.find(s => s.title === 'Formations suivies')!.table!.rows[0].slice(0, 4), ['Lecture de schémas électriques industriels', '18 mars 2025', '19 mars 2025', '14 h']);
  // Vues : auteur retiré hors du service RH ; paie : rien.
  assert.ok((d.ds.habDelivrances ?? []).every(x => x.auteur === null && x.auteurId === null));
  assert.deepEqual(domain(user(7, 'rh')).ds.habDelivrances, []);
  assert.equal(controlerOrphelins(db).orphelins, 0);
});

test('titre d’habilitation imprimé : modèle du référentiel, prérequis vérifiés, aptitude sans l’avis, deux signatures', () => {
  const { run, RH, domain, emp } = fresh();
  const d = domain();
  const mehdi = emp(2, d);
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
  const conduite = JSON.stringify(sectionsTitre(emp(1, d), d.hm('ac489'), { delivree: '2026-10-05', par: 'Olivier Marchal' }));
  assert.match(conduite, /R4323-55 à R4323-57/);
  assert.match(conduite, /Catégories autorisées","Chariots élévateurs cat\. 3/);
  // Modèle choisi au référentiel : générique par défaut, conservé si absent de la saisie, contrôlé.
  const ref = d.ds.referentiels;
  assert.equal(controlerHabilitation({ code: 'essai', nom: 'Essai', validite: 12, signataire: 'X' }, ref.habilitations, ref.formations).habilitation!.modele, 'generique');
  assert.equal(controlerHabilitation({ nom: he.nom, detail: he.detail, prereqs: he.prereqs, validite: 36, signataire: 'X' }, ref.habilitations, ref.formations, 'he').habilitation!.modele, 'electrique');
  assert.equal(controlerHabilitation({ code: 'essai', nom: 'Essai', validite: 12, signataire: 'X', modele: 'autre' }, ref.habilitations, ref.formations).erreurs.modele, 'Choisissez le modèle du titre imprimé.');
  run(RH, 'referentiel.habilitation.enregistrer', { id: 'atex', nom: 'Habilitation ATEX', detail: 'Zones 1 et 2', prereqs: ['atex'], medical: false, validite: 36, signataire: 'Sarah Cohen', modele: 'conduite' });
  assert.equal(domain().hm('atex').modele, 'conduite');
  assert.match(JSON.stringify(sectionsTitre(emp(3), domain().hm('atex'), { delivree: '2026-10-05', par: 'Sarah Cohen' })), /Prérequis vérifiés.*ATEX/);
});

test('migration : délivrances en vigueur amorcées une fois, tracées, sans orphelin', () => {
  const { db, journal } = fresh();
  db.sql.exec('DELETE FROM hab_delivrances');
  const delivres = Number((db.sql.prepare('SELECT COUNT(*) AS n FROM hab_titres WHERE delivree IS NOT NULL').get() as { n: number }).n);
  assert.equal(HAB_DELIVRANCES.necessaire!(db), true);
  assert.equal(db.tx(() => HAB_DELIVRANCES.executer(db)), `${delivres} délivrances en vigueur inscrites`);
  assert.deepEqual(journal('migration.habDelivrances').at(-1)!.payload, { delivrances: delivres });
  assert.equal(db.tx(() => HAB_DELIVRANCES.executer(db)), undefined, 'rien à refaire');
  // Échéance avec la fin de mois (addMonths) : ac489 délivrée le 15 avril 2022, 60 mois.
  assert.equal(db.all<Ligne>('habDelivrances').find(x => x.empId === 1)!.expire, '2027-04-15');
  assert.equal(controlerOrphelins(db).orphelins, 0);
});

// — t122 : durée en heures et indicateurs —

test('durée en heures : lue dans le texte quand elle y est seule, contrôlée, extraite par la migration', () => {
  const { db, run, RH, domain } = fresh();
  assert.deepEqual(['21 h', '7 h (MAC)', '3,5 heures', '14h', '2 jours', '', '7 h + 7 h', '7 h ou 14 h', '5000 h', '2 x 7 h', '7 h par jour sur 3 jours', '21 h (3 jours)'].map(H.dureeHeuresDe),
    [21, 7, 3.5, 14, null, null, null, null, null, null, null, null], 'jamais une durée unitaire répétée prise pour le total');
  const ref = domain().ds.referentiels.formations;
  const sst = ref.find(f => f.id === 'sst')!;
  assert.equal(sst.dureeHeures, 7, 'jeu de démonstration');
  const base = { nom: sst.nom, court: sst.court, type: sst.type, validite: 24, validation: sst.validation, duree: sst.duree, organisme: sst.organisme, cout: sst.cout };
  assert.equal(controlerFormation(base, ref, 'sst').formation!.dureeHeures, 7, 'absente de la saisie : inchangée');
  assert.equal(controlerFormation({ ...base, dureeHeures: '' }, ref, 'sst').formation!.dureeHeures, null, 'vide : effacée');
  assert.match(controlerFormation({ ...base, dureeHeures: '0' }, ref, 'sst').erreurs.dureeHeures!, /0,25 à 2/);
  run(RH, 'referentiel.formation.enregistrer', { id: 'sst', ...base, dureeHeures: '10,5' });
  assert.equal(domain().fm('sst').dureeHeures, 10.5);
  // Base d'avant le lot 6 : durées en heures vides, extraites du texte quand il en donne une seule.
  db.sql.exec(`UPDATE formations SET duree_heures = NULL; UPDATE formations SET duree = '2 jours' WHERE id = 'rgpd'`);
  assert.equal(DUREE_HEURES.necessaire!(db), true);
  assert.equal(db.tx(() => DUREE_HEURES.executer(db)), '10 durées en heures extraites');
  assert.deepEqual([domain().fm('fco').dureeHeures, domain().fm('rgpd').dureeHeures ?? null], [35, null]);
});

test('heures d’une session : horaires de chaque jour, sinon la durée du catalogue, sinon inconnues', () => {
  const s = { date: '2026-11-02', fin: '2026-11-03', jours: ['2026-11-02', '2026-11-03'], horaires: [{ debut: '08:30', fin: '17:00', pause: 60 }] };
  assert.equal(H.heuresSession(s, { dureeHeures: 14 }), 15);
  assert.equal(H.heuresSession({ ...s, horaires: [] }, { dureeHeures: 14 }), 14);
  assert.equal(H.heuresSession({ ...s, horaires: [] }, { dureeHeures: null }), null);
});

test('indicateurs du plan par exercice : stagiaires, heures par catégorie, équipe et statut, durée inconnue signalée, exports', () => {
  const { db, run, RH, domain } = fresh();
  run(RH, 'formationSuivie.enregistrer', { empId: 21, libelle: 'Anglais professionnel', du: '2026-03-02', duree: 21 });
  run(RH, 'formationSuivie.enregistrer', { empId: 6, libelle: 'Conduite de réunion', du: '2026-04-02' });
  const d = domain();
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
  assert.ok(db.count('formationsSuivies') >= 3);
});

// — Constats de relecture (lot 6, chantier 4, étape 2) —

test('titre d’habilitation : seul un titre en vigueur s’imprime ; aptitude et prérequis tels qu’à la délivrance', () => {
  const { run, RH, domain, emp } = fresh();
  const hab = (h: string) => emp(2).habs.find(x => x.h === h)!;
  // Mehdi Benali : travaux en hauteur valides ; habilitation électrique échue le 1er octobre 2026.
  assert.equal(titreImprimable(hab('hauteur')), true);
  assert.equal(hab('he').key, 'exp');
  assert.equal(titreImprimable(hab('he')), false, 'titre échu');
  run(RH, 'hab.suspendre', { empId: 2, h: 'hauteur', motif: 'Vertiges signalés', date: '2026-10-06' });
  assert.equal(titreImprimable(hab('hauteur')), false, 'titre suspendu');
  run(RH, 'hab.retirer', { empId: 2, h: 'hauteur', motif: 'Manquement grave aux règles', date: '2026-10-07' });
  assert.equal(hab('hauteur').key, 'retiree');
  assert.equal(titreImprimable(hab('hauteur')), false, 'titre retiré : pas de bouton « Imprimer le titre »');
  // Prérequis non satisfait (statut « Suspendue » sans mesure) : pas d'impression.
  assert.equal(titreImprimable({ ...hab('hauteur'), mesure: null, key: 'susp', prereqOk: false }), false);
  // Aptitude non valable : jamais « vérifiée » ; prérequis : certification valide à la date de délivrance seulement.
  const d = domain();
  const mehdi = emp(2, d);
  const inapte = JSON.stringify(sectionsTitre({ ...mehdi, med: { ...mehdi.med, ok: false } }, d.hm('he'), { delivree: '2026-10-05', par: 'Karim Haddad' }));
  assert.match(inapte, /Aptitude médicale","non vérifiée/);
  assert.match(JSON.stringify(sectionsTitre(mehdi, d.hm('he'), { delivree: '2023-10-01', par: 'Karim Haddad' })), /obtenue le 14 sept\. 2023/);
  assert.match(JSON.stringify(sectionsTitre(mehdi, d.hm('he'), { delivree: '2023-09-01', par: 'Karim Haddad' })), /aucune certification valide à cette date/, 'obtenue après la délivrance');
});

test('action du plan d’une formation du catalogue réalisée sans session, puis certification : comptée une seule fois', () => {
  const { db, run, RH, user, domain, emp } = fresh();
  const l = db.insert<Ligne>('planActions', { exercice: 2026, f: 'prap', libelle: null, equipe: 'Maintenance', periode: 'T3', effectif: 1, cout: 400, statut: 'engage', origine: null });
  run(RH, 'plan.avancer', { id: l.id, de: 'engage', coutReel: 400, beneficiaires: [2], du: '2026-09-01', au: '2026-09-02' });
  const prap = (d = domain()) => H.realisationsDe(d, 2026).filter(r => r.empId === 2 && r.intitule === d.fm('prap').nom);
  assert.deepEqual(prap().map(r => [r.source, r.heures]), [['suivie', 14]], 'avant la certification : la formation suivie');
  run(RH, 'cert.ajouter', { empId: 2, f: 'prap', date: '2026-09-02' });
  assert.deepEqual(prap().map(r => [r.source, r.heures]), [['certification', 14]], 'une ligne, 14 h');
  const x = S.suiviesEnVigueur(domain().ds, 2).find(s => s.planActionId === l.id)!;
  assert.equal(S.suivieCertifiee(domain().emp(2), x), true);
  // Passeport : la PRAP figure parmi les certifications, pas une seconde fois parmi les formations suivies.
  const d = domain(user(2, 'collaborateur'));
  const sections = sectionsPasseport(d, emp(2, d));
  assert.ok(sections.find(s => s.title === 'Certifications')!.table!.rows.some(r => r[0] === d.fm('prap').nom));
  assert.ok(!sections.find(s => s.title === 'Formations suivies')!.table!.rows.some(r => r[0] === d.fm('prap').nom));
  // Certification d'une autre période (hors du premier jour au dernier, plus 7 jours) : les deux comptent.
  assert.equal(S.suivieCertifiee({ certs: [{ f: 'prap', obtenue: '2026-09-10' }] } as never, x), false);
});
