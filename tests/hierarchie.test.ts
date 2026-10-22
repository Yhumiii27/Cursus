// Hiérarchie des managers (t136) : équipe parente, valideur du manager (N+1), éléments en attente redirigés (message,
// e-mail au nouveau valideur, journal), contrôles (boucle, profondeur, validation croisée), renommage et suppression,
// consultation N+2 en lecture seule (périmètre, filtres de santé, aucune décision) et migration des rattachements
// impossibles. Jeu de démonstration : Karim Haddad (12) encadre la Maintenance dont il est membre, Sophie Lemaire (3) la
// Production ; Mehdi Benali (2) est membre de la Maintenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-07';

const { SqliteDb: Db } = await import('../server/src/db.ts');
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

async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  // Chemin de POST /api/actions/:nom : état lu avant, action, trace au journal dans la même transaction.
  const run = async (user: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    const compte = (await db.one('SELECT * FROM comptes WHERE emp_id IS NULL')) as never;
    await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
    return o;
  });
  const refus = async (user: User, name: string, p: Record<string, unknown>, status = 403, motif?: RegExp) =>
    await assert.rejects(async () => await run(user, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!motif || motif.test(e.message)), `${name} devait être refusé (${status})`);
  const domain = async () => new Domain(await loadFull(db, RH));
  const mails = async (type: string) => (await db.all<{ cible: string; type: string; contenu: { a: string; objet: string; texte: string } }>('envois')).filter(e => e.cible === 'email' && e.type === type);
  return { db, run, refus, domain, mails };
}

test('sans équipe parente (par défaut) : le manager membre de son équipe reste validé par le service RH', async () => {
  const { domain } = await fresh();
  const d = await domain();
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

test('équipe parente : le manager remonte à son N+1, éléments en attente redirigés, nouveau valideur prévenu, journal', async () => {
  const { db, run, refus, domain, mails } = await fresh();
  // Demande de CP, feuille soumise et entretien planifié de Karim Haddad, en attente du service RH.
  const abs = (await db.insert<{ id: number }>('absences', { empId: 12, type: 'CP', du: '2026-12-07', au: '2026-12-08', statut: 'demandee', keystone: false, justificatif: false })).id;
  const sh = (await db.insert<{ id: number }>('feuilles', { empId: 12, week: WEEK, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }] })).id;
  const ent = (await db.insert<{ id: number }>('entretiens', { empId: 12, type: 'annuel', date: '2026-11-20', statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null })).id;
  // Autres feuilles de Karim déjà soumises dans la démonstration (semaine 40).
  const deja = (await db.all<{ id: number; empId: number; statut: string }>('feuilles')).filter(f => f.empId === 12 && f.statut === 'soumise' && f.id !== sh).map(f => f.id);
  const n = 3 + deja.length;
  await refus(KARIM, 'absence.decider', { id: abs, ok: true }, 403);
  await refus(SOPHIE, 'absence.decider', { id: abs, ok: true }, 403);

  const r = (await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' })) as { message: string };
  assert.match(r.message, new RegExp(`L’équipe Maintenance est rattachée à l’équipe Production · ${n} éléments en attente redirigés vers Sophie Lemaire \\(message envoyé au nouveau valideur\\) :`));
  assert.match(r.message, /Karim Haddad : demande de congés payés du lundi 7 décembre au mardi 8 décembre 2026/);
  assert.match(r.message, /feuille de temps de la semaine 42, soumise/);
  const d = await domain();
  assert.equal(d.mgrOf(d.emp(12)!), 3, 'Karim Haddad : Sophie Lemaire, manager de l’équipe parente');
  assert.equal(d.mgrOf(d.emp(2)!), 12, 'les membres gardent leur manager');

  // Nouveau valideur prévenu (e-mail aussitôt : réglage de Sophie Lemaire), sans nature d'absence de santé.
  const [m] = await mails('hierarchie.redirection');
  assert.ok(m, 'e-mail au nouveau valideur');
  assert.match(m.contenu.objet, new RegExp(`${n} demandes en attente vous reviennent — équipe Maintenance`));
  assert.match(m.contenu.texte, /désormais rattachée à l’équipe Production/);

  // Journal : identifiants et valideurs seulement.
  const j = (await db.all<{ action: string; payload: Record<string, unknown>; salaries: number[] }>('journal')).findLast(l => l.action === 'equipe.parente')!;
  assert.deepEqual(j.payload.avant, { parente: null });
  assert.deepEqual(j.payload.apres, { parente: 'Production' });
  assert.deepEqual(j.payload.redirections, [
    { kind: 'absence', id: abs, avant: 0, apres: 3 }, ...[...deja, sh].sort((a, b) => a - b).map(id => ({ kind: 'feuille', id, avant: 0, apres: 3 })),
    { kind: 'entretien', id: ent, avant: 0, apres: 3 },
  ]);
  assert.deepEqual(j.salaries, [12]);

  // Décisions : Sophie Lemaire (N+1) décide, Karim Haddad jamais pour lui-même ; le service RH garde la main.
  assert.ok(await run(SOPHIE, 'temps.validate', { empId: 12, week: WEEK }));
  assert.ok(await run(SOPHIE, 'absence.decider', { id: abs, ok: true }));
  await refus(KARIM, 'temps.setCell', { empId: 12, week: '2026-10-19', li: 0, di: 0, value: 7 }, 400);
  // Snapshot de Sophie : Karim y figure (équipe directe), pas les membres de la Maintenance.
  const vue = await buildSnapshot(db, SOPHIE);
  assert.ok(vue.employes.some(e => e.id === 12));
  assert.ok(!vue.employes.some(e => e.id === 2), 'consultation N+2 désactivée : Mehdi Benali hors du périmètre');
  assert.deepEqual(vue.lectureSeule, []);

  // Retrait de l'équipe parente : retour au service RH.
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: null });
  assert.equal((await domain()).mgrOf((await domain()).emp(12)!), 0);
});

test('contrôles : boucle, validation croisée, renommage suivi, suppression refusée tant qu’une équipe est rattachée', async () => {
  const { db, run, refus, domain } = await fresh();
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  await refus(RH, 'equipe.parente', { nom: 'Production', parente: 'Maintenance' }, 400, /boucle/);
  await refus(RH, 'equipe.parente', { nom: 'Production', parente: 'Inconnue' }, 400, /introuvable/);
  await refus(KARIM, 'equipe.parente', { nom: 'Production', parente: null }, 403);
  // Renommage : l'équipe rattachée suit le nouveau nom.
  await run(RH, 'equipe.renommer', { nom: 'Production', nouveau: 'Fabrication' });
  assert.equal((await domain()).ds.referentiels.equipes.find(q => q.nom === 'Maintenance')!.parente, 'Fabrication');
  assert.equal((await domain()).mgrOf((await domain()).emp(12)!), 3);
  // Suppression d'une équipe vide : refusée tant qu'une équipe y est rattachée.
  await run(RH, 'equipe.creer', { nom: 'Direction technique' });
  await run(RH, 'equipe.parente', { nom: 'Fabrication', parente: 'Direction technique' });
  await refus(RH, 'equipe.supprimer', { nom: 'Direction technique' }, 400, /Une équipe est rattachée à Direction technique \(Fabrication\)/);
  await run(RH, 'equipe.parente', { nom: 'Fabrication', parente: null });
  assert.ok(await run(RH, 'equipe.supprimer', { nom: 'Direction technique' }));
  assert.equal((await db.all('equipes')).length, 6);

  // Validation croisée : la fiche de Sophie Lemaire rangée dans la Maintenance, son valideur serait Karim Haddad, et
  // celui de Karim Haddad, Sophie Lemaire.
  const { run: run2, refus: refus2, db: db2 } = await fresh();
  await db2.update('employes', 3, { equipe: 'Maintenance' });
  await refus2(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' }, 400, /Sophie Lemaire et Karim Haddad deviendraient chacun le valideur de l’autre/);
  await db2.update('employes', 3, { equipe: 'Production' });
  assert.ok(await run2(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' }));
});

test('consultation N+2 : membres des équipes rattachées en lecture seule, sans donnée de santé ni décision', async () => {
  const { db, run, refus } = await fresh();
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  await run(RH, 'parametres.maj', { consultationN2: true });
  const d = new Domain(await loadFull(db, SOPHIE));
  const membres = d.ds.employes.filter(e => e.equipe === 'Maintenance' && e.id !== 12).map(e => e.id).sort((a, b) => a - b);
  assert.ok(membres.includes(2));
  assert.deepEqual([...scopeIds(d, SOPHIE)].sort((a, b) => a - b), [...new Set([3, ...d.ds.employes.filter(e => e.equipe === 'Production' && e.id !== 3).map(e => e.id), 12, ...membres])].sort((a, b) => a - b));

  // Avis médical et visite enregistrés pour Mehdi Benali : jamais transmis, verdict seul.
  await db.update('employes', 2, { avis: 'restrictions', restrictions: [{ texte: 'Port de charges limité', jusquau: null }] });
  await db.insert('entretiens', { empId: 2, type: 'annuel', date: '2026-11-20', statut: 'planifie', cr: { bilan: 'Texte' }, info: false, signSal: null, signMgr: null });
  const abs = (await db.insert<{ id: number }>('absences', { empId: 2, type: 'CP', du: '2026-12-14', au: '2026-12-14', statut: 'demandee', keystone: false, justificatif: false })).id;
  const vue = await buildSnapshot(db, SOPHIE);
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
  await refus(SOPHIE, 'absence.decider', { id: abs, ok: true }, 403);
  await refus(SOPHIE, 'temps.setCell', { empId: 2, week: WEEK, li: 0, di: 0, value: 7 }, 403);
  await refus(SOPHIE, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-12-01' }, 403);
  await refus(SOPHIE, 'absence.signaler', { empId: 2, du: '2026-12-01', au: '2026-12-01' }, 403);
  assert.ok(await run(KARIM, 'absence.decider', { id: abs, ok: true }));
  // Karim Haddad ne voit pas l'équipe de sa responsable (seulement vers le bas).
  assert.deepEqual((await buildSnapshot(db, KARIM)).lectureSeule, []);
  // Réglage retiré : retour au périmètre direct.
  await run(RH, 'parametres.maj', { consultationN2: false });
  assert.ok(!(await buildSnapshot(db, SOPHIE)).employes.some(e => e.id === 2));
});

test('migration lot6-hierarchie-equipes : rattachements impossibles retirés, sans effet sur une base propre', async () => {
  const db = new Db(':memory:');
  await seedDemo(db);
  await db.update('equipes', 'Maintenance', { parente: 'Disparue' });
  await db.update('equipes', 'Production', { parente: 'Production' });
  await db.update('equipes', 'Logistique', { parente: 'Maintenance' });
  assert.equal(await HIERARCHIE_EQUIPES.executer(db), '2 rattachements d’équipe impossibles retirés');
  const eq = await db.all<{ nom: string; parente: string | null }>('equipes');
  assert.deepEqual(eq.filter(q => q.parente).map(q => [q.nom, q.parente]), [['Logistique', 'Maintenance']]);
  assert.equal(await HIERARCHIE_EQUIPES.executer(db), undefined, 'rien à refaire');
  // Liste complète : la migration en fait partie, sans effet sur une base neuve.
  const neuve = new Db(':memory:');
  assert.ok((await appliquerMigrations(neuve)).includes('lot6-hierarchie-equipes'));
});

test('hiérarchie en place : changement de manager, affectation et fiche refusés s’ils créent une validation croisée', async () => {
  const { run, refus, domain } = await fresh();
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  // Mehdi Benali (membre de la Maintenance) manager de la Production : Karim Haddad le validerait, et lui Karim Haddad.
  await refus(RH, 'equipe.manager', { nom: 'Production', managerId: 2 }, 400, /Mehdi Benali et Karim Haddad deviendraient chacun le valideur de l’autre/);
  await refus(RH, 'equipe.modifier', { nom: 'Production', managerId: 2 }, 400, /deviendraient chacun le valideur de l’autre/);
  // Fiche de Sophie Lemaire rangée dans la Maintenance : Karim Haddad la validerait, et elle Karim Haddad.
  await refus(RH, 'equipe.affecter', { empId: 3, equipe: 'Maintenance' }, 400, /Sophie Lemaire et Karim Haddad deviendraient chacun le valideur de l’autre/);
  await refus(RH, 'employe.modifier', { id: 3, equipe: 'Maintenance' }, 400, /Sophie Lemaire et Karim Haddad deviendraient chacun le valideur de l’autre/);
  const d = await domain();
  assert.equal(d.emp(3)!.equipe, 'Production', 'rien n’a été enregistré');
  assert.equal(d.ds.referentiels.equipes.find(q => q.nom === 'Production')!.managerId, 3);
  // Sans équipe parente, ces mêmes modifications restent permises (aucune validation croisée).
  const autre = await fresh();
  assert.ok(await autre.run(RH, 'equipe.affecter', { empId: 3, equipe: 'Maintenance' }));
  assert.ok(await autre.run(RH, 'equipe.manager', { nom: 'Production', managerId: 2 }));
});

test('hiérarchie en place : le nouveau manager d’une équipe parente reçoit les éléments en attente des managers rattachés', async () => {
  const { db, run, domain } = await fresh();
  await run(RH, 'equipe.parente', { nom: 'Maintenance', parente: 'Production' });
  const sh = (await db.insert<{ id: number }>('feuilles', { empId: 12, week: WEEK, statut: 'soumise', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }] })).id;
  const avis = async () => [...await db.all<{ type: string }>('envois'), ...await db.all<{ type: string }>('notifications')].filter(e => e.type === 'hierarchie.redirection').length;
  const n0 = await avis();
  // Marion Petit (13), membre de la Production, en devient manager : la feuille de Karim Haddad lui revient.
  type R = { message: string; result?: { redirections: { kind: string; id: number; empId: number; avant: number; apres: number }[] } };
  const r = (await run(RH, 'equipe.manager', { nom: 'Production', managerId: 13 })) as R;
  assert.equal((await domain()).mgrOf((await domain()).emp(12)!), 13);
  assert.match(r.message, /^Marion Petit devient manager de l’équipe Production · \d+ éléments? en attente redirigés? vers Marion Petit \(message envoyé au nouveau valideur\) :/);
  assert.ok(r.result!.redirections.some(x => x.kind === 'feuille' && x.id === sh && x.avant === 3 && x.apres === 13));
  assert.ok(r.result!.redirections.every(x => x.empId === 12), 'membres de la Production : comme avant, sans avis');
  assert.equal(await avis(), n0 + 1, 'nouveau valideur prévenu');
  const j = (await db.all<{ action: string; payload: Record<string, unknown>; salaries: number[] }>('journal')).findLast(l => l.action === 'equipe.manager')!;
  assert.ok((j.payload.redirections as { id: number }[]).some(x => x.id === sh));
  assert.ok(j.salaries.includes(12));
  // Par la modification de l'équipe (dialogue) : même redirection, gardée au journal.
  const r2 = (await run(RH, 'equipe.modifier', { nom: 'Production', managerId: 3 })) as R;
  assert.ok(r2.result?.redirections.length);
  assert.ok((await db.all<{ action: string; payload: Record<string, unknown> }>('journal')).findLast(l => l.action === 'equipe.modifier')!.payload.redirections);
  // Équipe sans équipe rattachée : rien de nouveau (ni avis, ni redirection au résultat).
  const r3 = (await run(RH, 'equipe.manager', { nom: 'Logistique', managerId: 1 })) as R;
  assert.equal(typeof r3.message, 'string');
  assert.equal(r3.result, undefined);
});
