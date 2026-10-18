// Hiérarchie des managers (t136) : équipe parente, valideur du manager (N+1), éléments en attente redirigés (message,
// e-mail au nouveau valideur, journal), contrôles (boucle, profondeur, validation croisée), renommage et suppression,
// consultation N+2 en lecture seule (périmètre, filtres de santé, aucune décision) et migration des rattachements
// impossibles. Jeu de démonstration : Karim Haddad (12) encadre la Maintenance dont il est membre, Sophie Lemaire (3) la
// Production ; Mehdi Benali (2) est membre de la Maintenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, loadFull, scopeIds } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { HIERARCHIE_EQUIPES } = await import('../server/src/migrations/lot6-hierarchie.ts');
const { Domain } = await import('../shared/domain.ts');
const { controleParente, equipesDescendantes, PROFONDEUR_MAX, valideurHierarchique } = await import('../shared/rules/hierarchie.ts');
type User = Parameters<typeof buildSnapshot>[1];

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin', compteId: 1 };
const KARIM: User = { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: 'Manager · Maintenance' };
const SOPHIE: User = { role: 'manager', empId: 3, nom: 'Sophie Lemaire', intitule: 'Manager · Production' };
const WEEK = '2026-10-12';

function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  // Chemin de POST /api/actions/:nom : état lu avant, action, trace au journal dans la même transaction.
  const run = (user: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, user, loadFull(db, user)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    const compte = db.sql.prepare('SELECT * FROM comptes WHERE emp_id IS NULL').get() as never;
    journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
    return o;
  });
  const refus = (user: User, name: string, p: Record<string, unknown>, status = 403, motif?: RegExp) =>
    assert.throws(() => run(user, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!motif || motif.test(e.message)), `${name} devait être refusé (${status})`);
  const domain = () => new Domain(loadFull(db, RH));
  const mails = (type: string) => db.all<{ cible: string; type: string; contenu: { a: string; objet: string; texte: string } }>('envois').filter(e => e.cible === 'email' && e.type === type);
  return { db, run, refus, domain, mails };
}

test('sans équipe parente (par défaut) : le manager membre de son équipe reste validé par le service RH', () => {
  const { domain } = fresh();
  const d = domain();
  assert.ok(d.ds.referentiels.equipes.every(q => !q.parente), 'aucune équipe parente dans la démonstration');
  assert.equal(d.mgrOf(d.emp(12)!), 0, 'Karim Haddad : service RH');
  assert.equal(d.mgrOf(d.emp(2)!), 12, 'Mehdi Benali : son manager');
  assert.equal(d.ds.settings.consultationN2, false, 'consultation N+2 désactivée par défaut');
});

test('règles : valideur N+1, équipe sans manager, boucle et profondeur', () => {
  const eq = [
    { nom: 'Site', managerId: 1, parente: null }, { nom: 'Service', managerId: 2, parente: 'Site' },
    { nom: 'Atelier', managerId: 3, parente: 'Service' }, { nom: 'Vacante', managerId: null, parente: 'Atelier' },
    { nom: 'Équipe', managerId: 3, parente: 'Atelier' },
  ];
  assert.equal(valideurHierarchique(eq, { id: 3, equipe: 'Atelier' }), 2, 'manager de l’atelier : celui du service');
  assert.equal(valideurHierarchique(eq, { id: 3, equipe: 'Équipe' }), 2, 'manager des deux équipes : le premier autre que lui, plus haut');
  assert.equal(valideurHierarchique(eq, { id: 1, equipe: 'Site' }), 0, 'sommet : service RH');
  assert.equal(valideurHierarchique(eq, { id: 9, equipe: 'Vacante' }), 0, 'équipe sans manager : service RH, comme avant');
  assert.deepEqual(equipesDescendantes(eq, ['Service']).sort(), ['Atelier', 'Vacante', 'Équipe'].sort());
  assert.match(controleParente(eq, 'Site', 'Atelier')!, /boucle/);
  assert.match(controleParente(eq, 'Site', 'Site')!, /propre équipe parente/);
  assert.match(controleParente(eq, 'Site', 'Inconnue')!, /introuvable/);
  assert.equal(PROFONDEUR_MAX, 4);
  assert.match(controleParente([...eq, { nom: 'Racine', managerId: 5, parente: null }], 'Site', 'Racine')!, /limitée à 4 niveaux/, 'cinq niveaux refusés');
  assert.equal(controleParente(eq, 'Vacante', 'Site'), null);
});

test('équipe parente : le manager remonte à son N+1, éléments en attente redirigés, nouveau valideur prévenu, journal', () => {
  const { db, run, refus, domain, mails } = fresh();
  // Demande de CP, feuille soumise et entretien planifié de Karim Haddad, en attente du service RH.
  const abs = db.insert<{ id: number }>('absences', { empId: 12, type: 'CP', du: '2026-12-07', au: '2026-12-08', statut: 'demandee', keystone: false, justificatif: false }).id;
  const sh = db.insert<{ id: number }>('feuilles', { empId: 12, week: WEEK, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }] }).id;
  const ent = db.insert<{ id: number }>('entretiens', { empId: 12, type: 'annuel', date: '2026-11-20', statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null }).id;
  // Autres feuilles de Karim déjà soumises dans la démonstration (semaine 40).
  const deja = db.all<{ id: number; empId: number; statut: string }>('feuilles').filter(f => f.empId === 12 && f.statut === 'soumise' && f.id !== sh).map(f => f.id);
  const n = 3 + deja.length;
  refus(KARIM, 'absence.decider', { id: abs, ok: true }, 403);
  refus(SOPHIE, 'absence.decider', { id: abs, ok: true }, 403);

  const r = run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' }) as { message: string };
  assert.match(r.message, new RegExp(`L’équipe Maintenance est rattachée à l’équipe Production · ${n} éléments en attente redirigés vers Sophie Lemaire \\(message envoyé au nouveau valideur\\) :`));
  assert.match(r.message, /Karim Haddad : demande de congés payés du lundi 7 décembre au mardi 8 décembre 2026/);
  assert.match(r.message, /feuille de temps de la semaine 42, soumise/);
  const d = domain();
  assert.equal(d.mgrOf(d.emp(12)!), 3, 'Karim Haddad : Sophie Lemaire, manager de l’équipe parente');
  assert.equal(d.mgrOf(d.emp(2)!), 12, 'les membres gardent leur manager');

  // Nouveau valideur prévenu (e-mail aussitôt : réglage de Sophie Lemaire), sans nature d'absence de santé.
  const [m] = mails('hierarchie.redirection');
  assert.ok(m, 'e-mail au nouveau valideur');
  assert.match(m.contenu.objet, new RegExp(`${n} demandes en attente vous reviennent — équipe Maintenance`));
  assert.match(m.contenu.texte, /désormais rattachée à l’équipe Production/);

  // Journal : identifiants et valideurs seulement.
  const j = db.all<{ action: string; payload: Record<string, unknown>; salaries: number[] }>('journal').findLast(l => l.action === 'equipe.parente')!;
  assert.deepEqual(j.payload.avant, { parente: null });
  assert.deepEqual(j.payload.apres, { parente: 'Production' });
  assert.deepEqual(j.payload.redirections, [
    { kind: 'absence', id: abs, avant: 0, apres: 3 }, ...[...deja, sh].sort((a, b) => a - b).map(id => ({ kind: 'feuille', id, avant: 0, apres: 3 })),
    { kind: 'entretien', id: ent, avant: 0, apres: 3 },
  ]);
  assert.deepEqual(j.salaries, [12]);

  // Décisions : Sophie Lemaire (N+1) décide, Karim Haddad jamais pour lui-même ; le service RH garde la main.
  assert.ok(run(SOPHIE, 'temps.validate', { empId: 12, week: WEEK }));
  assert.ok(run(SOPHIE, 'absence.decider', { id: abs, ok: true }));
  refus(KARIM, 'temps.setCell', { empId: 12, week: '2026-10-19', li: 0, di: 0, value: 7 }, 400);
  // Snapshot de Sophie : Karim y figure (équipe directe), pas les membres de la Maintenance.
  const vue = buildSnapshot(db, SOPHIE);
  assert.ok(vue.employes.some(e => e.id === 12));
  assert.ok(!vue.employes.some(e => e.id === 2), 'consultation N+2 désactivée : Mehdi Benali hors du périmètre');
  assert.deepEqual(vue.lectureSeule, []);

  // Retrait de l'équipe parente : retour au service RH.
  run(RH, 'equipe.parente', { nom: 'Maintenance', parente: null });
  assert.equal(domain().mgrOf(domain().emp(12)!), 0);
});

test('contrôles : boucle, validation croisée, renommage suivi, suppression refusée tant qu’une équipe est rattachée', () => {
  const { db, run, refus, domain } = fresh();
  run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  refus(RH, 'equipe.parente', { nom: 'Production', parente: 'Maintenance' }, 400, /boucle/);
  refus(RH, 'equipe.parente', { nom: 'Production', parente: 'Inconnue' }, 400, /introuvable/);
  refus(KARIM, 'equipe.parente', { nom: 'Production', parente: null }, 403);
  // Renommage : l'équipe rattachée suit le nouveau nom.
  run(RH, 'equipe.renommer', { nom: 'Production', nouveau: 'Fabrication' });
  assert.equal(domain().ds.referentiels.equipes.find(q => q.nom === 'Maintenance')!.parente, 'Fabrication');
  assert.equal(domain().mgrOf(domain().emp(12)!), 3);
  // Suppression d'une équipe vide : refusée tant qu'une équipe y est rattachée.
  run(RH, 'equipe.creer', { nom: 'Direction technique' });
  run(RH, 'equipe.parente', { nom: 'Fabrication', parente: 'Direction technique' });
  refus(RH, 'equipe.supprimer', { nom: 'Direction technique' }, 400, /Une équipe est rattachée à Direction technique \(Fabrication\)/);
  run(RH, 'equipe.parente', { nom: 'Fabrication', parente: null });
  assert.ok(run(RH, 'equipe.supprimer', { nom: 'Direction technique' }));
  assert.equal(db.all('equipes').length, 6);

  // Validation croisée : la fiche de Sophie Lemaire rangée dans la Maintenance, son valideur serait Karim Haddad, et
  // celui de Karim Haddad, Sophie Lemaire.
  const { run: run2, refus: refus2, db: db2 } = fresh();
  db2.update('employes', 3, { equipe: 'Maintenance' });
  refus2(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' }, 400, /Sophie Lemaire et Karim Haddad deviendraient chacun le valideur de l’autre/);
  db2.update('employes', 3, { equipe: 'Production' });
  assert.ok(run2(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' }));
});

test('consultation N+2 : membres des équipes rattachées en lecture seule, sans donnée de santé ni décision', () => {
  const { db, run, refus } = fresh();
  run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  run(RH, 'parametres.maj', { consultationN2: true });
  const d = new Domain(loadFull(db, SOPHIE));
  const membres = d.ds.employes.filter(e => e.equipe === 'Maintenance' && e.id !== 12).map(e => e.id).sort((a, b) => a - b);
  assert.ok(membres.includes(2));
  assert.deepEqual([...scopeIds(d, SOPHIE)].sort((a, b) => a - b), [...new Set([3, ...d.ds.employes.filter(e => e.equipe === 'Production' && e.id !== 3).map(e => e.id), 12, ...membres])].sort((a, b) => a - b));

  // Avis médical et visite enregistrés pour Mehdi Benali : jamais transmis, verdict seul.
  db.update('employes', 2, { avis: 'restrictions', restrictions: [{ texte: 'Port de charges limité', jusquau: null }] });
  db.insert('entretiens', { empId: 2, type: 'annuel', date: '2026-11-20', statut: 'planifie', cr: { bilan: 'Texte' }, info: false, signSal: null, signMgr: null });
  const abs = db.insert<{ id: number }>('absences', { empId: 2, type: 'CP', du: '2026-12-14', au: '2026-12-14', statut: 'demandee', keystone: false, justificatif: false }).id;
  const vue = buildSnapshot(db, SOPHIE);
  assert.deepEqual([...vue.lectureSeule!].sort((a, b) => a - b), membres);
  const mehdi = vue.employes.find(e => e.id === 2)!;
  assert.equal(mehdi.visite, null);
  assert.equal(mehdi.avis, null);
  assert.deepEqual(mehdi.restrictions, []);
  assert.deepEqual(Object.keys(mehdi.aptitude ?? {}).sort(), ['aProgrammer', 'ok'], 'aptitude : verdict seul, ni avis ni restrictions');
  assert.equal(mehdi.matriculePaie, null);
  assert.ok(!vue.entretiens.some(x => x.empId === 2), 'entretiens des équipes rattachées : affaire du valideur direct');
  assert.ok(!vue.demandesCollab.some(x => x.empId === 2));
  assert.ok(vue.absences.some(a => a.id === abs), 'absences consultables (vue manager)');
  // Karim Haddad, équipe directe de Sophie Lemaire, garde l'aptitude détaillée du manager.
  assert.ok(!vue.lectureSeule!.includes(12));

  // Aucune décision : le valideur reste Karim Haddad (N+1 de Mehdi Benali).
  refus(SOPHIE, 'absence.decider', { id: abs, ok: true }, 403);
  refus(SOPHIE, 'temps.setCell', { empId: 2, week: WEEK, li: 0, di: 0, value: 7 }, 403);
  refus(SOPHIE, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-12-01' }, 403);
  refus(SOPHIE, 'absence.signaler', { empId: 2, du: '2026-12-01', au: '2026-12-01' }, 403);
  assert.ok(run(KARIM, 'absence.decider', { id: abs, ok: true }));
  // Karim Haddad ne voit pas l'équipe de sa responsable (seulement vers le bas).
  assert.deepEqual(buildSnapshot(db, KARIM).lectureSeule, []);
  // Réglage retiré : retour au périmètre direct.
  run(RH, 'parametres.maj', { consultationN2: false });
  assert.ok(!buildSnapshot(db, SOPHIE).employes.some(e => e.id === 2));
});

test('migration lot6-hierarchie-equipes : rattachements impossibles retirés, sans effet sur une base propre', () => {
  const db = new Db(':memory:');
  seedDemo(db);
  db.update('equipes', 'Maintenance', { parente: 'Disparue' });
  db.update('equipes', 'Production', { parente: 'Production' });
  db.update('equipes', 'Logistique', { parente: 'Maintenance' });
  assert.equal(HIERARCHIE_EQUIPES.executer(db), '2 rattachements d’équipe impossibles retirés');
  const eq = db.all<{ nom: string; parente: string | null }>('equipes');
  assert.deepEqual(eq.filter(q => q.parente).map(q => [q.nom, q.parente]), [['Logistique', 'Maintenance']]);
  assert.equal(HIERARCHIE_EQUIPES.executer(db), undefined, 'rien à refaire');
  // Liste complète : la migration en fait partie, sans effet sur une base neuve.
  const neuve = new Db(':memory:');
  assert.ok(appliquerMigrations(neuve).includes('lot6-hierarchie-equipes'));
});
