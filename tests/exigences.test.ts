// Formations et habilitations exigées par poste et par équipe (t055) : un salarié à qui il en manque une est « Non
// conforme », avec une échéance « exigence manquante » et son action ; référentiel des postes administré par le service
// RH (création, modification, archivage), poste choisi sur la fiche, migration des intitulés déjà saisis, journal, données
// transmises aux profils restreints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { POSTES } = await import('../server/src/migrations/referentiels.ts');
const { Domain } = await import('../shared/domain.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const X = await import('../shared/rules/exigences.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Db = InstanceType<typeof Db>;
interface Ligne { action: string; message: string | null; payload: Record<string, any>; salaries: number[] | null }

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
    return { message: String(o.message), result: o.result as Record<string, any> | undefined };
  });
  const refuse = (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) => assert.throws(() => run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} devait être refusé`);
  const RH = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, RH));
  const emp = (id: number) => { const d = domain(); return d.enrich(90, false, { sortis: true }).find(e => e.id === id)!; };
  const ech = (id: number) => { const d = domain(); return d.echeances(d.enrich(90, false), 90).filter(x => x.kind === 'exigence' && x.emp.id === id); };
  const poste = (nom: string) => db.all<{ id: number; nom: string; formations: string[]; habilitations: string[]; archive: string | null }>('postes').find(p => p.nom === nom)!;
  const journal = (action: string) => db.all<Ligne>('journal').filter(l => l.action === action);
  return { db, run, refuse, user, RH, domain, emp, ech, poste, journal };
}

test('démonstration : un poste par intitulé des fiches, exigences déclarées pour quelques postes et la Logistique', () => {
  const { db, emp, poste } = fresh();
  const libelles = new Set(db.all<{ poste: string }>('employes').map(e => e.poste));
  assert.equal(db.count('postes'), libelles.size, 'un poste par intitulé distinct');
  assert.ok(db.all<{ posteId: number | null }>('employes').every(e => e.posteId != null), 'chaque fiche rattachée à son poste');
  assert.deepEqual([poste('Cariste').formations, poste('Cariste').habilitations], [['caces489'], ['ac489']]);
  // Caristes : CACES et autorisation de conduite détenus, statut inchangé.
  assert.deepEqual(emp(1).manquants, []);
  assert.deepEqual(emp(16).manquants, []);
  // Lucas Martin (Logistique) n'a pas le SST exigé de toute l'équipe.
  assert.deepEqual(emp(4).manquants.map(m => [m.type, m.id, m.origines]), [['formation', 'sst', ['équipe Logistique']]]);
  assert.equal(emp(4).worst, 'exp');
});

test('sans exigence déclarée, le statut ne change pas ; une exigence jamais obtenue rend non conforme (t055)', () => {
  const { db, emp, ech, poste } = fresh();
  // Référentiel sans exigence (comme en production à la mise en service).
  db.sql.exec(`UPDATE postes SET formations = '[]', habilitations = '[]'; UPDATE equipes SET exigences = NULL`);
  const sansExigence = new Map([1, 2, 4, 16, 24].map(id => [id, emp(id).worst]));
  assert.ok([...sansExigence.keys()].every(id => emp(id).manquants.length === 0));
  // Cariste sans CACES : Camille Roux perd sa certification CACES R489 et son autorisation de conduite.
  db.sql.exec(`DELETE FROM certifications WHERE emp_id = 1 AND f = 'caces489'; DELETE FROM hab_titres WHERE emp_id = 1`);
  assert.equal(emp(1).manquants.length, 0, 'aucune exigence : rien ne manque');
  const avant1 = emp(1).worst;
  db.update('postes', poste('Cariste').id, { formations: ['caces489'], habilitations: ['ac489'] });
  const camille = emp(1);
  assert.notEqual(avant1, 'exp');
  assert.equal(camille.worst, 'exp', 'Non conforme');
  assert.equal(X.manquantsTexte(camille.manquants), 'Formation exigée non suivie : CACES R489 · Habilitation exigée non délivrée : Autorisation de conduite — chariots R489');
  // Échéances « exigence manquante » : sans date (au jour, parmi les dépassées), avec leur action.
  const [f, h] = ech(1);
  assert.deepEqual([f.label, f.kindLabel, f.statut, f.key, f.sansDate, f.d], ['CACES R489', 'Exigence du poste Cariste', 'Formation exigée non suivie', 'exp', true, 0]);
  assert.deepEqual(f.action, { label: 'Inscrire à la formation', intent: { type: 'goFormation', f: 'caces489' } });
  assert.deepEqual(h.action, { label: 'Demander l’habilitation', intent: { type: 'demanderHab', empId: 1, h: 'ac489' } });
  // Hugo Lambert, cariste qui détient les deux, reste tel quel.
  assert.equal(emp(16).worst, sansExigence.get(16));
});

test('exigence remplie par un titre échu : suivie par sa propre échéance, pas comme manquante', () => {
  const { db, emp, poste } = fresh();
  // Lucas Martin, préparateur : CACES R489 obtenu en 2021 (60 mois), habilitation détenue.
  db.update('postes', poste('Préparateur de commandes').id, { formations: ['caces489'], habilitations: ['ac489'] });
  db.sql.exec(`UPDATE certifications SET obtenue = '2020-01-15' WHERE emp_id = 4 AND f = 'caces489'`);
  const lucas = emp(4);
  assert.deepEqual(lucas.manquants.map(m => m.id), ['sst'], 'seul le SST de l’équipe manque');
  assert.equal(lucas.certs.find(c => c.f === 'caces489')!.key, 'exp');
});

test('exigences du poste et de l’équipe réunies, éléments archivés et filtre « réglementaires uniquement »', () => {
  const { db, domain, poste } = fresh();
  db.update('equipes', 'Logistique', { exigences: { formations: ['sst', 'caces489'], habilitations: [] } });
  const d = domain();
  const camille = d.emp(1)!;
  const ex = X.exigencesDe(d.ds, camille);
  assert.deepEqual(ex.find(x => x.id === 'caces489')!.origines, ['poste Cariste', 'équipe Logistique'], 'une exigence commune aux deux, comptée une fois');
  assert.equal(X.origineTexte(ex.find(x => x.id === 'caces489')!), 'Exigence du poste Cariste et de l’équipe Logistique');
  // Formation archivée : plus exigée.
  db.update('formations', 'sst', { archive: '2026-10-01' });
  assert.ok(!X.exigencesDe(domain().ds, camille).some(x => x.id === 'sst'));
  db.update('formations', 'sst', { archive: null });
  // Formation exigée non réglementaire : écartée par le filtre « réglementaires uniquement ».
  db.update('postes', poste('Opératrice').id, { formations: ['rgpd'], habilitations: [] });
  const d2 = domain();
  const marion = (onlyReg: boolean) => d2.enrich(90, onlyReg).find(e => e.id === 13)!.manquants.map(m => m.id);
  assert.equal(d2.fm('rgpd').type === 'Réglementaire', false);
  assert.deepEqual(marion(false), ['rgpd']);
  assert.deepEqual(marion(true), []);
});

test('habilitation exigée : demandée (hab.demander), en attente de délivrance, puis délivrée', () => {
  const { db, run, refuse, user, RH, emp, ech, poste } = fresh();
  db.update('postes', poste('Technicien de maintenance').id, { formations: ['elec'], habilitations: ['he', 'aipr'] });
  // Mehdi Benali n'a pas l'AIPR (ni formation, ni habilitation : prérequis non satisfait).
  assert.deepEqual(emp(2).manquants.map(m => m.id), ['aipr']);
  refuse(user(2, 'collaborateur'), 'hab.demander', { empId: 2, h: 'aipr' }, /réservée/, 403);
  const hse = user(23, 'rh');
  assert.match(run(hse, 'hab.demander', { empId: 2, h: 'aipr' }).message, /AIPR demandée pour Mehdi Benali — à délivrer/);
  assert.match(run(RH, 'hab.demander', { empId: 2, h: 'aipr' }).message, /déjà demandée/, 'rien n’est refait');
  refuse(RH, 'hab.demander', { empId: 2, h: 'he' }, /déjà délivrée/);
  const t = db.all<{ empId: number; h: string; delivree: string | null; demande: string | null }>('habTitres').filter(x => x.empId === 2 && x.h === 'aipr');
  assert.deepEqual(t.map(x => [x.delivree, x.demande]), [[null, '2026-10-10']]);
  // Toujours manquante (non délivrée) : l'échéance dit la demande, et propose d'abord le prérequis.
  const [e] = ech(2);
  assert.equal(e.plannedLabel, 'Demandée le 10 oct.');
  assert.deepEqual(e.action, { label: 'Inscrire à la formation', intent: { type: 'goFormation', f: 'aipr' } });
  // Habilitation archivée : plus demandée.
  db.update('habilitations', 'atex', { archive: '2026-10-01' });
  refuse(RH, 'hab.demander', { empId: 2, h: 'atex' }, /archivée/);
});

test('formation exigée : inscription planifiée affichée, session passée à clôturer', () => {
  const { db, emp, ech } = fresh();
  // Lucas Martin, sans SST (exigence de la Logistique), inscrit à une session de SST à venir.
  const s = db.all<{ id: number; formation: string; date: string; statut: string }>('sessions').find(x => x.formation === 'sst' && x.date > '2026-10-10' && x.statut !== 'Annulée')!;
  db.insert('inscriptions', { empId: 4, sessionId: s.id, convoc: 'later', date: '2026-10-10', convocLe: null });
  assert.equal(emp(4).worst, 'exp', 'toujours non conforme jusqu’à la certification');
  const [e] = ech(4);
  assert.equal(e.planned, true);
  assert.match(e.plannedLabel, /^Session du /);
  assert.equal(e.action, null);
  db.update('sessions', s.id, { date: '2026-10-05' });
  const [p] = ech(4);
  assert.deepEqual([p.planned, p.action?.label], [false, 'Clôturer']);
});

test('postes : création, modification (effet annoncé, intitulé recopié), archivage refusé tant qu’occupé ; service RH seul', () => {
  const { run, refuse, user, RH, emp, poste, journal } = fresh();
  refuse(user(23, 'rh'), 'referentiel.poste.enregistrer', { nom: 'Soudeur' }, /réservée au service RH/, 403);
  refuse(RH, 'referentiel.poste.enregistrer', { nom: ' cariste ' }, /porte déjà cet intitulé/);
  refuse(RH, 'referentiel.poste.enregistrer', { nom: 'Soudeur', formations: ['inconnue'] }, /Formation inconnue ou archivée : inconnue/);
  const cree = run(RH, 'referentiel.poste.enregistrer', { nom: 'Soudeur', formations: ['sst'], habilitations: [] });
  assert.equal(cree.message, 'Poste « Soudeur » ajouté au référentiel');
  assert.deepEqual(poste('Soudeur').formations, ['sst']);
  // Exigence ajoutée au poste d'Opératrice : Marion Petit et Léa Girard n'ont pas l'EPI incendie / le CACES.
  const id = poste('Opératrice').id;
  const r = run(RH, 'referentiel.poste.enregistrer', { id, nom: 'Opératrice de production', formations: ['caces489'], habilitations: [] });
  assert.match(r.message, /^Poste « Opératrice » renommé « Opératrice de production » sur 2 fiches · 2 salariés deviennent non conformes : Marion Petit \(CACES R489\) et Léa Girard \(CACES R489\)$/);
  assert.deepEqual(r.result!.salaries, [13, 15]);
  assert.equal(emp(13).poste, 'Opératrice de production', 'le libellé de la fiche suit le poste');
  assert.equal(emp(13).worst, 'exp');
  // Journal : identifiant, intitulé et codes avant / après, rattaché aux salariés devenus non conformes.
  const j = journal('referentiel.poste.enregistrer').at(-1)!;
  assert.equal(j.payload.id, id);
  assert.deepEqual(j.payload.avant, { nom: 'Opératrice', formations: [] });
  assert.deepEqual(j.payload.apres, { nom: 'Opératrice de production', formations: ['caces489'] });
  assert.deepEqual(j.salaries, [13, 15]);
  assert.deepEqual(journal('referentiel.poste.enregistrer')[0].payload.apres, { nom: 'Soudeur', formations: ['sst'], habilitations: [] });
  assert.equal(familleAction('referentiel.poste.enregistrer')?.id, 'referentiels');
  // Archivage : refusé tant qu'un salarié présent l'occupe, possible ensuite, puis rétablissement.
  refuse(RH, 'referentiel.poste.archiver', { id }, /2 salariés occupent ce poste/);
  assert.match(run(RH, 'referentiel.poste.archiver', { id: poste('Soudeur').id }).message, /archivé — plus proposé/);
  assert.ok(poste('Soudeur').archive);
  refuse(RH, 'employe.modifier', { id: 13, posteId: poste('Soudeur').id }, /archivé : rétablissez-le/);
  assert.match(run(RH, 'referentiel.poste.archiver', { id: poste('Soudeur').id, archive: false }).message, /rétabli/);
  assert.ok(Object.hasOwn(JOURNAL_LABEL, 'referentiel.poste.archiver') && Object.hasOwn(JOURNAL_LABEL, 'hab.demander'));
});

test('exigences communes d’une équipe : enregistrées, effet annoncé, vidées', () => {
  const { db, run, refuse, user, RH, emp } = fresh();
  refuse(user(12, 'manager'), 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: ['sst'] }, /réservée au service RH/, 403);
  refuse(RH, 'referentiel.equipe.exigences', { nom: 'Inconnue', formations: [] }, /Équipe introuvable/, 404);
  const r = run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: ['caces486'], habilitations: [] });
  assert.match(r.message, /^Exigences communes de l’équipe Maintenance enregistrées · \d+ salariés? devien/);
  assert.deepEqual(db.get<{ exigences: unknown }>('equipes', 'Maintenance')!.exigences, { formations: ['caces486'], habilitations: [] });
  assert.ok(emp(2).manquants.some(m => m.id === 'caces486'));
  const v = run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [] });
  assert.match(v.message, /n’ont plus d’exigence manquante|n’a plus d’exigence manquante/);
  assert.equal(db.get<{ exigences: unknown }>('equipes', 'Maintenance')!.exigences, null);
});

test('fiche : poste choisi dans la liste, intitulé repris, nouveau poste créé par le service RH', () => {
  const { db, run, refuse, user, RH, emp, poste } = fresh();
  const fiche = {
    nom: 'Nouvel Embauché', equipe: 'Logistique', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', jourOff: [], entree: '2026-10-10',
    naissance: 1995, email: 'nouvel.embauche@entreprise.example', matriculePaie: 'N9999',
  };
  // Poste choisi : son intitulé devient celui de la fiche ; ses exigences s'appliquent aussitôt.
  const id = run(RH, 'employe.creer', { ...fiche, posteId: poste('Cariste').id, poste: 'peu importe' }).result!.id as number;
  assert.deepEqual([emp(id).poste, emp(id).posteId], ['Cariste', poste('Cariste').id]);
  assert.deepEqual(emp(id).manquants.map(m => m.id).sort(), ['ac489', 'caces489', 'sst']);
  // Intitulé seul (import) : rattaché au poste du même nom, ou nouveau poste sans exigence.
  const id2 = run(RH, 'employe.creer', { ...fiche, nom: 'Autre Embauché', email: 'autre@entreprise.example', matriculePaie: 'N9998', poste: 'CARISTE' }).result!.id as number;
  assert.equal(emp(id2).posteId, poste('Cariste').id);
  const id3 = run(RH, 'employe.creer', { ...fiche, nom: 'Troisième', email: 'trois@entreprise.example', matriculePaie: 'N9997', poste: 'Soudeur  TIG' }).result!.id as number;
  assert.deepEqual([poste('Soudeur TIG').formations, emp(id3).posteId], [[], poste('Soudeur TIG').id]);
  refuse(RH, 'employe.creer', { ...fiche, nom: 'Quatre', email: 'quatre@entreprise.example', matriculePaie: 'N9996', posteId: 9999 }, /Poste inconnu/);
  // Manager : poste choisi dans la liste ; un intitulé seul précise le poste actuel sans le changer ; pas de création.
  const karim = user(12, 'manager');
  run(karim, 'employe.modifier', { id: 2, posteId: poste('Électromécanicien').id, poste: '' });
  assert.deepEqual([emp(2).poste, emp(2).posteId], ['Électromécanicien', poste('Électromécanicien').id]);
  run(karim, 'employe.modifier', { id: 2, poste: 'Électromécanicien confirmé' });
  assert.deepEqual([emp(2).poste, emp(2).posteId], ['Électromécanicien confirmé', poste('Électromécanicien').id]);
  refuse(karim, 'employe.modifier', { id: 2, posteId: null, poste: 'Poste inventé' }, /Poste inconnu : choisissez-le dans la liste/);
  assert.equal(db.all('postes').length, new Set(db.all<{ nom: string }>('postes').map(p => p.nom)).size);
});

test('données transmises : postes à tous les espaces, exigences retirées pour le profil paie (sans titres)', () => {
  const { db, user } = fresh();
  const paie = buildSnapshot(db, user(7, 'rh'));
  assert.ok(paie.referentiels.postes.length > 0);
  assert.ok(paie.referentiels.postes.every(p => !p.formations.length && !p.habilitations.length));
  assert.ok(paie.referentiels.equipes.every(q => !q.exigences));
  assert.ok(new Domain(paie).enrich(90, false).every(e => !e.manquants.length), 'personne compté non conforme faute de titres transmis');
  const hse = buildSnapshot(db, user(23, 'rh'));
  assert.ok(new Domain(hse).enrich(90, false).find(e => e.id === 4)!.manquants.length === 1);
  const mgr = buildSnapshot(db, user(16, 'manager'));
  assert.deepEqual(new Domain(mgr).enrich(90, false).find(e => e.id === 4)!.manquants.map(m => m.id), ['sst']);
  const collab = buildSnapshot(db, user(4, 'collaborateur'));
  assert.equal(collab.employes.length, 1);
  assert.ok(collab.referentiels.postes.length > 0);
});

test('proposition d’exigences : titres détenus par tous les titulaires ; effet annoncé avant l’enregistrement', () => {
  const { domain, poste } = fresh();
  const d = domain();
  const p = X.exigencesProposees(d.ds, X.titulaires(d.ds, poste('Technicien de maintenance').id));
  assert.deepEqual(p, { formations: ['sst', 'elec', 'hauteur'], habilitations: ['he', 'hauteur'] });
  assert.deepEqual(X.exigencesProposees(d.ds, []), { formations: [], habilitations: [] });
  const effet = X.effetExigences(d.ds, { postes: d.ds.referentiels.postes.map(x => (x.nom === 'Cariste' ? { ...x, formations: [...x.formations, 'prap'] } : x)) });
  assert.deepEqual(effet.nouveaux, []);
  const effet2 = X.effetExigences(d.ds, { postes: d.ds.referentiels.postes.map(x => (x.nom === 'Cariste' ? { ...x, formations: [...x.formations, 'fco'] } : x)) });
  assert.deepEqual(effet2.nouveaux.map(n => [n.nom, n.manquants]), [['Camille Roux', ['FCO']], ['Hugo Lambert', ['FCO']]]);
  assert.equal(X.effetTexte(effet2), '2 salariés deviennent non conformes : Camille Roux (FCO) et Hugo Lambert (FCO)');
  // Contrôles partagés avec le dialogue.
  assert.equal(X.controlerPoste({ nom: '' }, d.ds.referentiels).erreurs.nom, 'Indiquez l’intitulé du poste.');
  assert.equal(X.controlerPoste({ nom: 'x'.repeat(81) }, d.ds.referentiels).erreurs.nom, '80 caractères au plus.');
  assert.equal(X.controlerPoste({ nom: 'Cariste' }, d.ds.referentiels, poste('Cariste').id).erreurs.nom, undefined, 'son propre intitulé');
});

test('migration nommée : un poste par intitulé déjà saisi, variantes réunies, une seule fois, tracée ; base neuve sans effet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-postes-'));
  try {
    const file = join(dir, 'cursus.db');
    const db = new Db(file);
    assert.deepEqual(appliquerMigrations(db).includes('lot4-referentiels-postes'), true, 'base neuve : exécutée');
    assert.equal(db.count('postes'), 0, 'sans effet');
    seedDemo(db);
    // Base d'avant la mise à jour : aucun poste, fiches non rattachées, migration pas encore enregistrée ; une variante.
    db.sql.exec(`DELETE FROM postes; UPDATE employes SET poste_id = NULL; UPDATE employes SET poste = 'opératrice ' WHERE id = 15;
      DELETE FROM migrations WHERE nom = 'lot4-referentiels-postes'`);
    const n = new Set(db.all<{ poste: string }>('employes').map(e => e.poste.trim().toLowerCase())).size;
    db.sql.close();
    const ancienne = new Db(file);
    assert.equal(POSTES.necessaire(ancienne), true);
    assert.deepEqual(appliquerMigrations(ancienne), ['lot4-referentiels-postes']);
    assert.equal(ancienne.count('postes'), n);
    const postes = ancienne.all<{ id: number; nom: string; formations: string[]; habilitations: string[] }>('postes');
    assert.ok(postes.every(p => !p.formations.length && !p.habilitations.length), 'aucune exigence créée d’office');
    const emps = ancienne.all<{ id: number; poste: string; posteId: number }>('employes');
    const op = postes.find(p => p.nom === 'Opératrice')!;
    assert.deepEqual(emps.filter(e => e.posteId === op.id).map(e => [e.id, e.poste]), [[13, 'Opératrice'], [15, 'Opératrice']], 'variante réunie, libellé aligné');
    const j = ancienne.all<Ligne>('journal').filter(l => l.action === 'migration.postes');
    assert.equal(j.length, 1);
    assert.match(j[0].message!, new RegExp(`^Reprise : ${n} postes pour 24 fiches — exigences à saisir`));
    assert.ok(!JSON.stringify(j[0].payload).includes('Opératrice'), 'aucun intitulé recopié au journal');
    assert.equal(familleAction('migration.postes')?.id, 'referentiels');
    assert.deepEqual(appliquerMigrations(ancienne), [], 'rien à refaire');
    ancienne.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
