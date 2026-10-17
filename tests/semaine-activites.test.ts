// Lot 5, chantier B étape 1 : semaine à 7 jours (t047) — samedi et dimanche saisissables, rang des heures
// supplémentaires sur la semaine civile, ventilation par mois, repos hebdomadaire et dominical en alerte, dérogation
// d'équipe, heures du dimanche (HDIM, majoration figée), migration des lignes à 5 valeurs, vue « un jour » ; activités
// internes administrées par le service RH et amorcées par migration, mandats au CSE et compteur des heures de
// délégation (t132), visibles du RH et de l'élu seulement, tracés au journal sans texte libre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { ACTIVITES_INTERNES, SEMAINE_7_JOURS, amorcerActivites } = await import('../server/src/migrations/temps.ts');
const { Domain } = await import('../shared/domain.ts');
const { joursSemaine } = await import('../shared/dates.ts');
const { calcSheet, joursAbsence, rubriquesParPeriode, sageRubriques, semaineCouverte } = await import('../shared/rules/temps.ts');
const { alertesRepos, completerSemaine, derogationDe } = await import('../shared/rules/semaine.ts');
const { controlerActivite } = await import('../shared/rules/activites.ts');
const { compteurDelegation, controlerMandat, creditLegal, creditPropose, effectifReference, effectifSite, heuresDelegation, mandatDuMois } = await import('../shared/rules/delegation.ts');
const { PERIMETRE_FICHIER } = await import('../shared/rules/lots-paie.ts');
const { jourParDefaut } = await import('../client/src/components/heures.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof loadFull>;
type Feuille = Dataset['feuilles'][number];

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
    return o.message;
  });
  const refuse = (u: User, name: string, p: Record<string, unknown>, motif: RegExp, statut = 400) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === statut && motif.test(e.message), `${name} : ${motif}`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  const derniere = (action: string) => db.all<{ action: string; payload: Record<string, unknown>; salaries: number[] }>('journal').findLast(j => j.action === action);
  return { db, user, run, refuse, domain, derniere, RH };
}
/** Feuille de Camille Roux (35 h, Logistique) : une ligne, heures du lundi au dimanche. */
const feuille = (h: number[], extra: Partial<Feuille> = {}): Feuille =>
  ({ id: 9000, empId: 1, week: '2026-10-26', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-LOG', tache: '', ks: false, h }], contrat: null, ...extra });

// — Semaine à 7 jours —

test('rang des heures supplémentaires sur la semaine civile : 39 h en semaine et 4 h le samedi font 8 h à 25 %', () => {
  const { domain } = fresh();
  const d = domain(), e = d.emp(1)!;
  const c = calcSheet(d, e, feuille([8, 8, 8, 8, 7, 4, 0]));
  assert.deepEqual([c.total, c.normal, c.sup25, c.sup50], [43, 35, 8, 0]);
  assert.deepEqual(c.perDay, [8, 8, 8, 8, 7, 4, 0]);
  assert.deepEqual(c.repos, [], 'un samedi travaillé ne déclenche aucune alerte');
  // Le dimanche compte aussi : ses heures, dernières de la semaine, sont les plus majorées.
  const dim = calcSheet(d, e, feuille([9, 9, 9, 9, 8, 0, 4]));
  assert.deepEqual([dim.sup25, dim.sup50, dim.dimanche], [8, 5, 4]);
  // Une ligne de 5 valeurs (feuille d'avant la semaine à 7 jours) se lit avec un week-end vide.
  assert.deepEqual(calcSheet(d, e, feuille([7, 7, 7, 7, 7])).perDay, [7, 7, 7, 7, 7, 0, 0]);
  assert.deepEqual(completerSemaine([1, 2]), [1, 2, 0, 0, 0, 0, 0]);
  assert.deepEqual(joursSemaine('2026-10-26').slice(5), ['2026-10-31', '2026-11-01']);
});

test('repos hebdomadaire et dominical : alertes sans blocage, dérogation de l’équipe, cadre dirigeant exclu', () => {
  const { domain } = fresh();
  const d = domain(), e = d.emp(1)!;
  const sept = calcSheet(d, e, feuille([6, 6, 6, 6, 6, 3, 2]));
  assert.equal(sept.repos.length, 2);
  assert.match(sept.repos[0], /7 jours travaillés.*art\. L3132-1 et L3132-2/);
  assert.match(sept.repos[1], /2 h le dimanche : repos dominical \(art\. L3132-3\)/);
  assert.ok(sept.repos.every(r => sept.warn.includes(r)) && !sept.depassements.length, 'alertes, pas des dépassements à motiver');
  assert.deepEqual(alertesRepos([0, 0, 0, 0, 0, 0, 0], null), []);
  // Travail en continu pour la Logistique : le dimanche est attendu, les 7 jours restent signalés.
  const derog = { equipe: 'Logistique', type: 'feu_continu' as const, reference: 'Accord', le: '2026-10-01', par: 'RH' };
  const avec = new Domain({ ...d.ds, derogationsDominicales: [derog] });
  assert.deepEqual(derogationDe(avec.ds, e), derog);
  assert.equal(derogationDe(avec.ds, { equipe: 'Production' }), null);
  assert.equal(calcSheet(avec, e, feuille([6, 6, 6, 6, 6, 3, 2])).repos.length, 1);
  assert.deepEqual(calcSheet(avec, e, feuille([0, 6, 6, 6, 6, 3, 2])).repos, []);
  // Cadre dirigeant (art. L3111-2) : aucune alerte de repos.
  const dirigeant = { ...e, temps: 'dirigeant' as const, statut: 'cadre' as const };
  assert.deepEqual(calcSheet(d, dirigeant, feuille([6, 6, 6, 6, 6, 3, 2])).repos, []);
});

test('heures du dimanche en paie : HDIM, majoration MAJ_DIM figée à la validation, ventilation jour par jour', () => {
  const { db, run, domain, user, RH } = fresh();
  const d = domain(), e = d.emp(1)!;
  assert.deepEqual(sageRubriques(d, e, feuille([7, 7, 7, 7, 7, 0, 4])), { HN: 35, HS25: 4, HDIM: 4 });
  assert.deepEqual(sageRubriques(d, e, feuille([7, 7, 7, 7, 7, 0, 4], { majDimanche: 50 })), { HN: 35, HS25: 4, HDIM: 4, MAJ_DIM: 2 });
  // Forfait jours : décompte en jours, samedi compris ; forfait annuel : HN et HDIM.
  assert.deepEqual(sageRubriques(d, { ...e, temps: 'forfait_jours', statut: 'cadre', forfaitJours: 218 }, feuille([8, 8, 8, 8, 8, 8, 0])), { JTRAV: 6 });
  assert.deepEqual(sageRubriques(d, { ...e, temps: 'forfait_heures_annuel', statut: 'cadre', forfaitHeures: 1607 }, feuille([7, 7, 7, 7, 7, 0, 3])), { HN: 38, HDIM: 3 });
  // Semaine du 26 octobre ventilée jour par jour : le dimanche 1er novembre part en novembre, avec son rang.
  const parts = rubriquesParPeriode(new Domain({ ...d.ds, settings: { ...d.ds.settings, periodeRattachement: 'jour' } }), e, feuille([8, 8, 8, 8, 7, 2, 4]));
  assert.deepEqual(parts.map(p => [p.periode, p.rubriques]), [['2026-10', { HN: 35, HS25: 6 }], ['2026-11', { HN: 0, HS25: 2, HS50: 2, HDIM: 4 }]]);

  // Saisie : samedi et dimanche acceptés, au-delà refusé ; la majoration réglée est figée à la validation.
  const CAMILLE = user(1, 'collaborateur'), HUGO = user(16, 'manager');
  const base = { empId: 1, week: '2026-11-02' };
  run(CAMILLE, 'temps.addLine', { ...base, projet: 'INT-LOG' });
  [0, 1, 2, 3, 4].forEach(di => run(CAMILLE, 'temps.setCell', { ...base, li: 0, di, value: '7' }));
  run(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 6, value: '3,5' });
  assert.throws(() => run(CAMILLE, 'temps.setCell', { ...base, li: 0, di: 7, value: '1' }), /Cellule invalide/);
  const sh = () => loadFull(db, RH).feuilles.find(f => f.empId === 1 && f.week === '2026-11-02')!;
  assert.deepEqual(sh().lignes[0].h, [7, 7, 7, 7, 7, 0, 3.5]);
  run(CAMILLE, 'temps.submit', base);
  run(RH, 'parametres.maj', { majorationDimanche: 50 });
  run(HUGO, 'temps.validate', base);
  run(RH, 'parametres.maj', { majorationDimanche: 0 });
  assert.equal(sh().majDimanche, 50);
  assert.deepEqual(sageRubriques(domain(), domain().emp(1)!, sh()), { HN: 35, HS25: 3.5, HDIM: 3.5, MAJ_DIM: 1.8 });
  assert.match(PERIMETRE_FICHIER, /samedi et dimanche compris/);
});

test('ligne enregistrée avant la semaine à 7 jours : saisie du dimanche, migration des feuilles, Keystone et relevé', () => {
  const { db, run, domain, RH } = fresh();
  const id = db.insert<{ id: number }>('feuilles', { empId: 1, week: '2026-11-09', statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-LOG', tache: 't', ks: true, h: [7, 7, 0, 7, 7] }] }).id;
  run(RH, 'temps.setCell', { empId: 1, week: '2026-11-09', li: 0, di: 6, value: '2' });
  assert.deepEqual(db.get<Feuille>('feuilles', id)!.lignes[0].h, [7, 7, 0, 7, 7, 0, 2]);
  // Migration : seules les lignes de 5 valeurs sont complétées ; sans effet ensuite.
  db.sql.exec(`UPDATE feuilles SET lignes = '[{"projet":"INT-LOG","tache":"t","ks":true,"h":[1,2,3,4,5]}]' WHERE id = ${id}`);
  assert.equal(SEMAINE_7_JOURS.necessaire!(db), true);
  assert.match(String(SEMAINE_7_JOURS.executer(db)), /^1 feuille de temps complétée à 7 jours$/);
  assert.deepEqual(db.get<Feuille>('feuilles', id)!.lignes, [{ projet: 'INT-LOG', tache: 't', ks: true, h: [1, 2, 3, 4, 5, 0, 0] }]);
  assert.equal(SEMAINE_7_JOURS.executer(db), undefined, 'rien à reprendre');
  // Semaine couverte : le week-end n'est jamais attendu ; une absence du samedi seul ne couvre pas la semaine.
  const d = domain(), e = d.emp(1)!;
  const avec = (du: string, au: string) => new Domain({ ...d.ds, absences: [...d.ds.absences, { id: 999, empId: 1, type: 'CP', du, au, statut: 'validee', keystone: false } as Dataset['absences'][number]] });
  assert.equal(semaineCouverte(avec('2026-11-16', '2026-11-20'), e, '2026-11-16'), true);
  assert.equal(semaineCouverte(avec('2026-11-21', '2026-11-22'), e, '2026-11-16'), false);
  assert.deepEqual(joursAbsence(avec('2026-11-20', '2026-11-23'), 1, '2026-11-16').map(a => !!a), [false, false, false, false, true, true, true]);
});

test('vue « un jour » : un samedi ou un dimanche travaillé s’ouvre sur lui, sinon sur le vendredi', () => {
  const semaine = joursSemaine('2026-10-05');
  assert.equal(jourParDefaut(semaine, '2026-10-07'), 2);
  assert.equal(jourParDefaut(semaine, '2026-10-10'), 4, 'samedi sans heure : le vendredi');
  assert.equal(jourParDefaut(semaine, '2026-10-10', [7, 7, 7, 7, 7, 3, 0]), 5, 'samedi travaillé : le samedi');
  assert.equal(jourParDefaut(semaine, '2026-10-11', [7, 7, 7, 7, 7, 0, 2]), 6);
  assert.equal(jourParDefaut(semaine.slice(0, 5), '2026-10-11', [0, 0, 0, 0, 0, 0, 2]), 6, 'semaine de 5 jours transmise : le dimanche retrouvé');
  assert.equal(jourParDefaut(semaine, '2026-10-20'), 0);
});

test('dérogation au repos dominical : administrateur RH, référence exigée, suit l’équipe renommée, référence réservée au RH', () => {
  const { db, run, refuse, derniere, user, RH } = fresh();
  const GEST = user(14, 'rh');
  refuse(RH, 'temps.derogationDominicale', { equipe: 'Logistique', type: 'feu_continu', reference: ' ' }, /Travail en continu : indiquez la référence/);
  refuse(RH, 'temps.derogationDominicale', { equipe: 'Logistique', type: 'inconnu' }, /Dérogation inconnue/);
  refuse(RH, 'temps.derogationDominicale', { equipe: 'Fantôme', type: 'aucune' }, /Équipe introuvable/, 404);
  refuse(RH, 'temps.derogationDominicale', { equipe: 'Logistique', type: 'suppleance', reference: 'x'.repeat(121) }, /120 caractères/);
  refuse(GEST, 'temps.derogationDominicale', { equipe: 'Logistique', type: 'aucune' }, /./, 403);
  assert.match(String(run(RH, 'temps.derogationDominicale', { equipe: 'Logistique', type: 'feu_continu', reference: 'Accord du 3 mars 2025' })), /travail en continu/);
  assert.deepEqual(derniere('temps.derogationDominicale')!.payload, { equipe: 'Logistique', type: 'feu_continu', reference: '[texte renseigné]' });
  run(RH, 'equipe.renommer', { nom: 'Logistique', nouveau: 'Supply chain' });
  assert.deepEqual(loadFull(db, RH).derogationsDominicales!.map(x => [x.equipe, x.type, x.reference]), [['Supply chain', 'feu_continu', 'Accord du 3 mars 2025']]);
  // Hors du service RH : le type seul.
  assert.equal(buildSnapshot(db, user(16, 'manager')).derogationsDominicales![0].reference, null);
  assert.equal(buildSnapshot(db, user(7, 'rh')).derogationsDominicales![0].reference, null, 'profil paie');
  assert.match(String(run(RH, 'temps.derogationDominicale', { equipe: 'Supply chain', type: 'aucune' })), /aucune dérogation/);
  assert.deepEqual(loadFull(db, RH).derogationsDominicales, []);
});

// — Activités internes —

test('activités internes : amorcées par migration, créées, renommées, archivées par le RH, jamais un projet Keystone', () => {
  const { db, run, refuse, derniere, user, RH } = fresh();
  const codes = () => db.all<{ code: string; nom: string; statut: string }>('projets').filter(p => /^(INT-|ECOLE)/.test(p.code));
  assert.ok(codes().some(p => p.code === 'INT-DELEG'), 'délégation amorcée par le jeu de démonstration');
  // Base sans activités (production, Keystone muet) : la migration les amorce une fois, sans toucher aux existantes.
  db.sql.exec(`DELETE FROM projets WHERE code LIKE 'INT-%' AND code <> 'INT-LOG'`);
  db.sql.exec(`UPDATE projets SET nom = 'Logistique (Keystone)' WHERE code = 'INT-LOG'`);
  assert.equal(ACTIVITES_INTERNES.necessaire!(db), true);
  assert.equal(ACTIVITES_INTERNES.executer(db), '6 activités internes ajoutées (INT-PROD, INT-MAINT, INT-HSE, INT-QUA, INT-ADM, INT-DELEG)');
  assert.equal(ACTIVITES_INTERNES.necessaire!(db), false);
  assert.deepEqual(amorcerActivites(db), []);
  assert.equal(codes().find(p => p.code === 'INT-LOG')!.nom, 'Logistique (Keystone)');

  const GEST = user(14, 'rh'), LECTURE = user(11, 'rh');
  refuse(GEST, 'referentiel.activite.enregistrer', { code: 'K-2614', nom: 'X' }, /Code : « INT- »/);
  refuse(GEST, 'referentiel.activite.enregistrer', { code: 'int-log', nom: 'Doublon' }, /existe déjà/);
  refuse(GEST, 'referentiel.activite.enregistrer', { code: 'INT-FORM', nom: ' ' }, /libellé/);
  refuse(LECTURE, 'referentiel.activite.enregistrer', { code: 'INT-FORM', nom: 'Formation' }, /./, 403);
  assert.match(String(run(GEST, 'referentiel.activite.enregistrer', { code: ' int-form ', nom: 'Formation  interne' })), /INT-FORM « Formation interne » créée/);
  assert.deepEqual(derniere('referentiel.activite.enregistrer')!.payload, { code: 'INT-FORM', avant: { nom: null, statut: null }, apres: { nom: 'Formation interne', statut: 'actif' } });
  run(GEST, 'referentiel.activite.enregistrer', { id: 'INT-FORM', nom: 'Formations internes', code: 'INT-AUTRE' });
  assert.equal(codes().find(p => p.code === 'INT-FORM')!.nom, 'Formations internes');
  refuse(GEST, 'referentiel.activite.enregistrer', { id: 'K-2614', nom: 'X' }, /introuvable/, 404);
  // Archivée : plus imputable (message propre aux activités), heures déjà saisies gardées ; rétablie d'un clic.
  assert.match(String(run(GEST, 'referentiel.activite.archiver', { id: 'INT-FORM' })), /archivée/);
  assert.equal(run(GEST, 'referentiel.activite.archiver', { id: 'INT-FORM' }), null, 'déjà archivée : rien n’est refait');
  refuse(RH, 'temps.addLine', { empId: 1, week: '2026-11-02', projet: 'INT-FORM' }, /Activité interne archivée/);
  run(GEST, 'referentiel.activite.archiver', { id: 'INT-FORM', archive: false });
  assert.deepEqual(derniere('referentiel.activite.archiver')!.payload, { code: 'INT-FORM', retablir: true, avant: { statut: 'archive' }, apres: { statut: 'actif' } });
  run(RH, 'temps.addLine', { empId: 1, week: '2026-11-02', projet: 'INT-FORM' });
  // Contrôle partagé : un renommage garde le code.
  assert.deepEqual(controlerActivite({ code: 'INT-X', nom: 'Y' }, [], { code: 'ECOLE', nom: 'Z', statut: 'archive' }).activite, { code: 'ECOLE', nom: 'Y', statut: 'archive' });
  assert.match(controlerActivite({ code: '', nom: 'Y' }, [], null).erreurs.code!, /Indiquez le code/);
  assert.match(controlerActivite({ code: 'INT-X', nom: 'Y'.repeat(81) }, [], null).erreurs.nom!, /80 caractères/);
});

// — Heures de délégation —

test('crédit d’heures proposé d’après la table R2314-1, contrôle d’un mandat', () => {
  assert.deepEqual([5, 11, 49, 50, 75, 100, 199, 200, 500, 1499, 1500].map(creditLegal), [null, 10, 10, 18, 19, 21, 21, 22, 24, 24, null]);
  assert.equal(creditPropose('titulaire', 104), 21);
  assert.equal(creditPropose('suppleant', 104), 0);
  assert.equal(creditPropose('titulaire', 3), 0);
  const ok = controlerMandat({ role: 'titulaire', du: '2026-01-01', au: '', credit: '21,3' }, []);
  assert.deepEqual(ok.mandat, { role: 'titulaire', du: '2026-01-01', au: null, credit: 21.25 });
  const ko = controlerMandat({ role: 'membre', du: '2026-02-30', au: '2025-01-01', credit: '' }, []);
  assert.deepEqual(Object.keys(ko.erreurs), ['role', 'du', 'credit']);
  assert.match(controlerMandat({ role: 'titulaire', du: '2026-05-01', au: '2026-04-01', credit: 0 }, []).erreurs.au!, /suit son début/);
  assert.match(controlerMandat({ role: 'titulaire', du: '2026-05-01', au: 'x', credit: 0 }, []).erreurs.au!, /invalide/);
  assert.match(controlerMandat({ role: 'titulaire', du: '2026-05-01', credit: 300 }, []).erreurs.credit!, /de 0 à 200/);
  const autre = { id: 1, empId: 8, role: 'titulaire' as const, du: '2025-01-01', au: null, credit: 21 };
  assert.match(controlerMandat({ role: 'suppleant', du: '2026-05-01', credit: 0 }, [autre]).erreurs.du!, /couvre déjà ces dates/);
  assert.equal(mandatDuMois([autre], '2024-12'), null);
  assert.equal(mandatDuMois([autre], '2026-10'), autre);
});

test('compteur mensuel : heures INT-DELEG des feuilles validées, report sur 12 mois, une fois et demie le crédit, alerte seulement', () => {
  const { db, domain } = fresh();
  const d = domain();
  assert.ok(effectifSite(d.ds, d.ti) > 20);
  // Julien Moreau (8), titulaire depuis novembre 2025, 21 h : 3 h le 30 septembre (semaine 40, validée).
  assert.deepEqual([...heuresDelegation(d.ds, 8)], [['2026-09', 3]]);
  const c = compteurDelegation(d.ds, 8, d.ti, 104)!;
  assert.deepEqual(c.map(m => m.mois), ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(c.at(-2), { mois: '2026-09', role: 'titulaire', credit: 21, limite: 31.5, utilisees: 3, report: 228, alertes: [] });
  assert.equal(compteurDelegation(d.ds, 1, d.ti, 104), null, 'sans mandat : rien');
  // Suppléant sans crédit propre : limite d'un titulaire, chaque heure à justifier (mutualisation).
  const feuilleDeleg = (empId: number, week: string, h: number[]) => ({ id: 0, empId, week, statut: 'validee', comment: null, sage: false, keystone: false, contrat: null, lignes: [{ projet: 'INT-DELEG', tache: '', ks: false, h }, { projet: 'INT-LOG', tache: '', ks: false, h: [9, 9, 9, 9, 9, 9, 9] }] }) as Feuille;
  const ds = { ...d.ds, mandats: [{ id: 1, empId: 1, role: 'suppleant' as const, du: '2026-10-01', au: null, credit: 0 }], feuilles: [feuilleDeleg(1, '2026-10-05', [8, 8, 8, 8, 8, 0, 0]), feuilleDeleg(1, '2026-09-28', [0, 0, 0, 4, 4, 0, 0])] };
  const s = compteurDelegation(ds, 1, '2026-10-10', 104)!;
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].utilisees, s[0].limite, s[0].report], [48, 31.5, -48]);
  assert.match(s[0].alertes[0], /^48 h dans le mois : au-delà d’une fois et demie le crédit \(31,5 h, art\. R2315-5 et R2315-6\)$/);
  assert.match(s[0].alertes[1], /Crédit des 12 derniers mois dépassé de 48 h : mutualisation .* \(art\. L2315-7\) à justifier/);
  assert.ok(db.count('mandats') === 1);
});

test('mandats : saisis par le RH, vus par le RH et l’élu seulement, tracés sans texte libre', () => {
  const { db, run, refuse, derniere, user, RH } = fresh();
  const JULIEN = user(8, 'collaborateur'), SOPHIE = user(3, 'manager'), PAIE = user(7, 'rh'), GEST = user(14, 'rh');
  // Visibilité : l'élu voit son mandat, son manager et les profils restreints rien.
  assert.equal(buildSnapshot(db, RH).mandats!.length, 1);
  assert.deepEqual(buildSnapshot(db, JULIEN).mandats!.map(m => m.empId), [8]);
  assert.deepEqual(buildSnapshot(db, SOPHIE).mandats, []);
  assert.deepEqual(buildSnapshot(db, PAIE).mandats, []);
  assert.deepEqual(buildSnapshot(db, user(11, 'rh')).mandats, [], 'lecture seule');
  // Le manager voit la ligne de délégation sur la feuille de son équipe.
  assert.ok(buildSnapshot(db, SOPHIE).feuilles.some(f => f.empId === 8 && f.lignes.some(l => l.projet === 'INT-DELEG')));

  refuse(JULIEN, 'mandat.enregistrer', { empId: 8, role: 'titulaire', du: '2027-01-01', credit: 21 }, /./, 403);
  refuse(GEST, 'mandat.enregistrer', { empId: 8, role: 'titulaire', du: '2026-01-01', credit: 21 }, /couvre déjà ces dates/);
  refuse(GEST, 'mandat.enregistrer', { id: 999, role: 'titulaire', du: '2026-01-01', credit: 21 }, /Mandat introuvable/, 404);
  const m = String(run(GEST, 'mandat.enregistrer', { empId: 6, role: 'suppleant', du: '2026-01-05', au: '2029-12-31', credit: 0 }));
  assert.equal(m, 'Élu suppléant au CSE — Thomas Garnier, du 5 janv. 2026 au 31 déc. 2029, crédit de 0 h par mois enregistré');
  const id = (db.sql.prepare('SELECT id FROM mandats WHERE emp_id = 6').get() as { id: number }).id;
  assert.deepEqual(derniere('mandat.enregistrer')!.salaries, [6]);
  run(GEST, 'mandat.enregistrer', { id, role: 'titulaire', du: '2026-01-05', credit: 18 });
  const j = derniere('mandat.enregistrer')!;
  assert.deepEqual(j.payload, { id, avant: { role: 'suppleant', au: '2029-12-31', credit: 0 }, apres: { role: 'titulaire', au: null, credit: 18 } });
  assert.match(String(run(GEST, 'mandat.enregistrer', { id, role: 'titulaire', du: '2026-01-05', credit: 18 })), /modifié$/);
  refuse(GEST, 'mandat.supprimer', { id: 999 }, /introuvable/, 404);
  assert.equal(run(GEST, 'mandat.supprimer', { id }), 'Mandat au CSE de Thomas Garnier retiré');
  assert.deepEqual(derniere('mandat.supprimer')!.salaries, [6]);
  assert.equal(db.count('mandats'), 1);
});

// — Corrections de la relecture —

test('repos à vérifier : la feuille validée par le manager, une à une ou en groupe, reste signalée au service RH', async () => {
  const { db, run, user, RH } = fresh();
  const { reposAVerifier, nombreAvecRepos } = await import('../shared/rules/repos-a-verifier.ts');
  const C = await import('../client/src/state/confirmations.ts');
  const CAMILLE = user(1, 'collaborateur'), HUGO = user(16, 'manager');
  const saisir = (week: string, h: number[]) => {
    run(CAMILLE, 'temps.addLine', { empId: 1, week, projet: 'INT-LOG' });
    h.forEach((v, di) => v && run(CAMILLE, 'temps.setCell', { empId: 1, week, li: 0, di, value: String(v) }));
    run(CAMILLE, 'temps.submit', { empId: 1, week });
  };
  saisir('2026-09-14', [7, 7, 7, 7, 7, 0, 4]);
  saisir('2026-09-07', [7, 7, 7, 7, 7, 0, 0]);
  const rh = () => new Domain(buildSnapshot(db, RH));
  // Soumise : déjà signalée ; la confirmation de la validation groupée compte la feuille concernée.
  assert.deepEqual(reposAVerifier(rh()).map(r => [r.e.id, r.sh.week, r.sh.statut]), [[1, '2026-09-14', 'soumise']]);
  const lot = [{ empId: 1, week: '2026-09-14' }, { empId: 1, week: '2026-09-07' }];
  const n = nombreAvecRepos(new Domain(buildSnapshot(db, HUGO)), lot);
  assert.equal(n, 1);
  assert.match(C.validationGroupee(lot, 1, n).suites!.join(' '), /1 feuille porte une alerte de repos .* reste signalée au service RH/);
  assert.ok(!C.validationGroupee(lot, 1).suites!.some(s => /repos/.test(s)));
  // Validée en groupe par le manager : toujours visible du service RH, avec l'alerte du dimanche.
  run(HUGO, 'temps.validerLot', { feuilles: lot });
  const apres = reposAVerifier(rh());
  assert.deepEqual(apres.map(r => [r.sh.week, r.sh.statut]), [['2026-09-14', 'validee']]);
  assert.match(apres[0].alertes[0], /4 h le dimanche : repos dominical \(art\. L3132-3\)/);
  // Hors de la fenêtre de 12 semaines : plus listée.
  assert.deepEqual(reposAVerifier(rh(), '2026-12-14'), []);
});

test('compteur du suppléant : même limite pour l’élu et pour le service RH (effectif calculé par le serveur)', () => {
  const { db, user, RH } = fresh();
  db.sql.exec(`UPDATE mandats SET role = 'suppleant', credit = 0 WHERE emp_id = 8`);
  const JULIEN = user(8, 'collaborateur'), SOPHIE = user(3, 'manager');
  const vue = (u: User) => { const ds = buildSnapshot(db, u); return compteurDelegation(ds, 8, ds.today, effectifReference(ds, ds.today)); };
  const rh = vue(RH)!, elu = vue(JULIEN)!;
  const effectif = effectifSite(loadFull(db, RH), '2026-10-10');
  assert.equal(buildSnapshot(db, JULIEN).effectifCse, effectif);
  assert.equal(buildSnapshot(db, JULIEN).employes.length, 1, 'l’instantané de l’élu ne contient que lui');
  assert.deepEqual(elu, rh);
  const sept = elu.find(m => m.mois === '2026-09')!;
  assert.deepEqual([sept.limite, sept.utilisees], [creditLegal(effectif)! * 1.5, 3]);
  assert.ok(!sept.alertes.some(a => /une fois et demie/.test(a)));
  // Sans mandat, ni le manager ni les profils restreints ne reçoivent l'effectif.
  assert.equal(buildSnapshot(db, SOPHIE).effectifCse, null);
  assert.equal(buildSnapshot(db, user(7, 'rh')).effectifCse, null, 'profil paie');
  assert.equal(buildSnapshot(db, user(1, 'collaborateur')).effectifCse, null, 'collaborateur sans mandat');
});

test('relecture : mandat refusé sur soi-même, dérogation retirée avec l’équipe, archivage confirmé, export RGPD titré', async () => {
  const { db, run, refuse, user, RH } = fresh();
  const GEST = user(14, 'rh');
  refuse(GEST, 'mandat.enregistrer', { empId: 14, role: 'titulaire', du: '2026-11-01', credit: 200 }, /Vous ne pouvez pas enregistrer votre propre mandat au CSE/, 403);
  run(RH, 'mandat.enregistrer', { empId: 14, role: 'titulaire', du: '2026-11-01', credit: 21 });
  const id = (db.sql.prepare('SELECT id FROM mandats WHERE emp_id = 14').get() as { id: number }).id;
  refuse(GEST, 'mandat.supprimer', { id }, /retirer votre propre mandat/, 403);
  refuse(GEST, 'mandat.enregistrer', { id, role: 'titulaire', du: '2026-11-01', credit: 200 }, /votre propre mandat/, 403);
  // Équipe supprimée : sa dérogation part avec elle ; recréée sous le même nom, elle n'en hérite pas.
  run(RH, 'equipe.creer', { nom: 'Week-end' });
  run(RH, 'temps.derogationDominicale', { equipe: 'Week-end', type: 'suppleance', reference: 'Accord du 1er juin 2026' });
  run(RH, 'equipe.supprimer', { nom: 'Week-end' });
  assert.deepEqual(loadFull(db, RH).derogationsDominicales, []);
  run(RH, 'equipe.creer', { nom: 'Week-end' });
  assert.equal(derogationDe(loadFull(db, RH), { equipe: 'Week-end' }), null);
  // Archivage d'une activité interne : confirmé (dialogue « confirmer »), le code de délégation nommé.
  const R = await import('../client/src/state/confirmations-referentiels.ts');
  const c = R.archivageActivite({ code: 'INT-DELEG', nom: 'Délégation CSE' });
  assert.deepEqual([c.action, c.payload], ['referentiel.activite.archiver', { id: 'INT-DELEG' }]);
  assert.match(c.suites!.join(' '), /heures de délégation/);
  assert.ok(!R.archivageActivite({ code: 'INT-LOG', nom: 'Logistique' }).suites!.some(s => /délégation/.test(s)));
  // Export des données du salarié : la section des mandats porte un titre en français.
  const { donneesSalarie } = await import('../server/src/donnees.ts');
  const sections = donneesSalarie(db, 8, { journal: false, par: 'test' })!.sections as Record<string, unknown[]>;
  assert.equal(sections['Mandats au CSE'].length, 1);
  assert.ok(!('mandats' in sections));
});
