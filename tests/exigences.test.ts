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

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { POSTES, postesDepuisFiches, rattacherFiches } = await import('../server/src/migrations/referentiels.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { Domain } = await import('../shared/domain.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const X = await import('../shared/rules/exigences.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = import('../server/src/db.ts').Db;
interface Ligne { action: string; message: string | null; payload: Record<string, any>; salaries: number[] | null }

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (état lu avant l'action, trace après). */
async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return { message: String(o.message), result: o.result as Record<string, any> | undefined };
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status = 400) => await assert.rejects(async () => await run(u, name, p),
    (e: unknown) => e instanceof ActionError && e.status === status && motif.test(e.message), `${name} devait être refusé`);
  const RH = await user(null, 'rh');
  const domain = async () => new Domain(await loadFull(db, RH));
  const emp = async (id: number) => { const d = await domain(); return d.enrich(90, false, { sortis: true }).find(e => e.id === id)!; };
  const ech = async (id: number) => { const d = await domain(); return d.echeances(d.enrich(90, false), 90).filter(x => x.kind === 'exigence' && x.emp.id === id); };
  const poste = async (nom: string) => (await db.all<{ id: number; nom: string; formations: string[]; habilitations: string[]; archive: string | null }>('postes')).find(p => p.nom === nom)!;
  const journal = async (action: string) => (await db.all<Ligne>('journal')).filter(l => l.action === action);
  return { db, run, refuse, user, RH, domain, emp, ech, poste, journal };
}

test('démonstration : un poste par intitulé des fiches, exigences déclarées pour quelques postes et la Logistique', async () => {
  const { db, emp, poste } = await fresh();
  const libelles = new Set((await db.all<{ poste: string }>('employes')).map(e => e.poste));
  assert.equal(await db.count('postes'), libelles.size, 'un poste par intitulé distinct');
  assert.ok((await db.all<{ posteId: number | null }>('employes')).every(e => e.posteId != null), 'chaque fiche rattachée à son poste');
  assert.deepEqual([(await poste('Cariste')).formations, (await poste('Cariste')).habilitations], [['caces489'], ['ac489']]);
  // Caristes : CACES et autorisation de conduite détenus, statut inchangé.
  assert.deepEqual((await emp(1)).manquants, []);
  assert.deepEqual((await emp(16)).manquants, []);
  // Lucas Martin (Logistique) n'a pas le SST exigé de toute l'équipe.
  assert.deepEqual((await emp(4)).manquants.map(m => [m.type, m.id, m.origines]), [['formation', 'sst', ['équipe Logistique']]]);
  assert.equal((await emp(4)).worst, 'exp');
});

test('sans exigence déclarée, le statut ne change pas ; une exigence jamais obtenue rend non conforme (t055)', async () => {
  const { db, emp, ech, poste } = await fresh();
  // Référentiel sans exigence (comme en production à la mise en service).
  await db.exec(`UPDATE postes SET formations = '[]', habilitations = '[]'; UPDATE equipes SET exigences = NULL`);
  const sansExigence = new Map(await Promise.all([1, 2, 4, 16, 24].map(async id => [id, (await emp(id)).worst] as const)));
  for (const id of sansExigence.keys()) assert.equal((await emp(id)).manquants.length, 0);
  // Cariste sans CACES : Camille Roux perd sa certification CACES R489 et son autorisation de conduite.
  await db.exec(`DELETE FROM certifications WHERE emp_id = 1 AND f = 'caces489'; DELETE FROM hab_titres WHERE emp_id = 1`);
  assert.equal((await emp(1)).manquants.length, 0, 'aucune exigence : rien ne manque');
  const avant1 = (await emp(1)).worst;
  await db.update('postes', (await poste('Cariste')).id, { formations: ['caces489'], habilitations: ['ac489'] });
  const camille = await emp(1);
  assert.notEqual(avant1, 'exp');
  assert.equal(camille.worst, 'exp', 'Non conforme');
  assert.equal(X.manquantsTexte(camille.manquants), 'Formation exigée non suivie : CACES R489 · Habilitation exigée non délivrée : Autorisation de conduite — chariots R489');
  // Échéances « exigence manquante » : sans date (au jour, parmi les dépassées), avec leur action.
  const [f, h] = await ech(1);
  assert.deepEqual([f.label, f.kindLabel, f.statut, f.key, f.sansDate, f.d], ['CACES R489', 'Exigence du poste Cariste', 'Formation exigée non suivie', 'exp', true, 0]);
  assert.deepEqual(f.action, { label: 'Inscrire à la formation', intent: { type: 'goFormation', f: 'caces489' } });
  assert.deepEqual(h.action, { label: 'Demander l’habilitation', intent: { type: 'demanderHab', empId: 1, h: 'ac489', nom: 'Camille Roux', label: 'Autorisation de conduite — chariots R489' } });
  // Hugo Lambert, cariste qui détient les deux, reste tel quel.
  assert.equal((await emp(16)).worst, sansExigence.get(16));
});

test('exigence remplie par un titre échu : suivie par sa propre échéance, pas comme manquante', async () => {
  const { db, emp, poste } = await fresh();
  // Lucas Martin, préparateur : CACES R489 obtenu en 2021 (60 mois), habilitation détenue.
  await db.update('postes', (await poste('Préparateur de commandes')).id, { formations: ['caces489'], habilitations: ['ac489'] });
  await db.exec(`UPDATE certifications SET obtenue = '2020-01-15' WHERE emp_id = 4 AND f = 'caces489'`);
  const lucas = await emp(4);
  assert.deepEqual(lucas.manquants.map(m => m.id), ['sst'], 'seul le SST de l’équipe manque');
  assert.equal(lucas.certs.find(c => c.f === 'caces489')!.key, 'exp');
});

test('exigences du poste et de l’équipe réunies, éléments archivés et filtre « réglementaires uniquement »', async () => {
  const { db, domain, poste } = await fresh();
  await db.update('equipes', 'Logistique', { exigences: { formations: ['sst', 'caces489'], habilitations: [] } });
  const d = await domain();
  const camille = (await d.emp(1))!;
  const ex = X.exigencesDe(d.ds, camille);
  assert.deepEqual(ex.find(x => x.id === 'caces489')!.origines, ['poste Cariste', 'équipe Logistique'], 'une exigence commune aux deux, comptée une fois');
  assert.equal(X.origineTexte(ex.find(x => x.id === 'caces489')!), 'Exigence du poste Cariste et de l’équipe Logistique');
  // Formation archivée : plus exigée.
  await db.update('formations', 'sst', { archive: '2026-10-01' });
  assert.ok(!X.exigencesDe((await domain()).ds, camille).some(x => x.id === 'sst'));
  await db.update('formations', 'sst', { archive: null });
  // Formation exigée non réglementaire : écartée par le filtre « réglementaires uniquement ».
  await db.update('postes', (await poste('Opératrice')).id, { formations: ['rgpd'], habilitations: [] });
  const d2 = await domain();
  const marion = (onlyReg: boolean) => d2.enrich(90, onlyReg).find(e => e.id === 13)!.manquants.map(m => m.id);
  assert.equal(d2.fm('rgpd').type === 'Réglementaire', false);
  assert.deepEqual(marion(false), ['rgpd']);
  assert.deepEqual(marion(true), []);
});

test('habilitation exigée : demandée (hab.demander), en attente de délivrance, puis délivrée', async () => {
  const { db, run, refuse, user, RH, emp, ech, poste } = await fresh();
  await db.update('postes', (await poste('Technicien de maintenance')).id, { formations: ['elec'], habilitations: ['he', 'aipr'] });
  // Mehdi Benali n'a pas l'AIPR (ni formation, ni habilitation : prérequis non satisfait).
  assert.deepEqual((await emp(2)).manquants.map(m => m.id), ['aipr']);
  await refuse(await user(2, 'collaborateur'), 'hab.demander', { empId: 2, h: 'aipr' }, /réservée/, 403);
  const hse = await user(23, 'rh');
  assert.match((await run(hse, 'hab.demander', { empId: 2, h: 'aipr' })).message, /AIPR demandée pour Mehdi Benali — à délivrer/);
  assert.match((await run(RH, 'hab.demander', { empId: 2, h: 'aipr' })).message, /déjà demandée/, 'rien n’est refait');
  await refuse(RH, 'hab.demander', { empId: 2, h: 'he' }, /déjà délivrée/);
  const t = (await db.all<{ empId: number; h: string; delivree: string | null; demande: string | null }>('habTitres')).filter(x => x.empId === 2 && x.h === 'aipr');
  assert.deepEqual(t.map(x => [x.delivree, x.demande]), [[null, '2026-10-10']]);
  // Toujours manquante (non délivrée) : l'échéance dit la demande, et propose d'abord le prérequis.
  const [e] = await ech(2);
  assert.equal(e.plannedLabel, 'Demandée le 10 oct.');
  assert.deepEqual(e.action, { label: 'Inscrire à la formation', intent: { type: 'goFormation', f: 'aipr' } });
  // Interface : la demande se confirme (le titre en attente ne se retire pas), puis lance `hab.demander`.
  const C = await import('../client/src/state/confirmations-referentiels.ts');
  const c = C.demandeHabilitation({ empId: 2, h: 'aipr', nom: 'Mehdi Benali', label: 'AIPR' });
  assert.deepEqual([c.action, c.payload, c.question], ['hab.demander', { empId: 2, h: 'aipr' }, 'Demander l’habilitation « AIPR » pour Mehdi Benali ?']);
  assert.ok(c.suites!.some(t => /ne se retire pas/.test(t)));
  // Habilitation archivée : plus demandée.
  await db.update('habilitations', 'atex', { archive: '2026-10-01' });
  await refuse(RH, 'hab.demander', { empId: 2, h: 'atex' }, /archivée/);
});

test('formation exigée : inscription planifiée affichée, session passée à clôturer', async () => {
  const { db, emp, ech } = await fresh();
  // Lucas Martin, sans SST (exigence de la Logistique), inscrit à une session de SST à venir.
  const s = (await db.all<{ id: number; formation: string; date: string; statut: string }>('sessions')).find(x => x.formation === 'sst' && x.date > '2026-10-10' && x.statut !== 'Annulée')!;
  await db.insert('inscriptions', { empId: 4, sessionId: s.id, convoc: 'later', date: '2026-10-10', convocLe: null });
  assert.equal((await emp(4)).worst, 'exp', 'toujours non conforme jusqu’à la certification');
  const [e] = await ech(4);
  assert.equal(e.planned, true);
  assert.match(e.plannedLabel, /^Session du /);
  assert.equal(e.action, null);
  await db.update('sessions', s.id, { date: '2026-10-05' });
  const [p] = await ech(4);
  assert.deepEqual([p.planned, p.action?.label], [false, 'Clôturer']);
});

test('postes : création, modification (effet annoncé, intitulé recopié), archivage refusé tant qu’occupé ; service RH seul', async () => {
  const { run, refuse, user, RH, emp, poste, journal } = await fresh();
  await refuse(await user(23, 'rh'), 'referentiel.poste.enregistrer', { nom: 'Soudeur' }, /réservée au service RH/, 403);
  await refuse(RH, 'referentiel.poste.enregistrer', { nom: ' cariste ' }, /porte déjà cet intitulé/);
  await refuse(RH, 'referentiel.poste.enregistrer', { nom: 'Soudeur', formations: ['inconnue'] }, /Formation inconnue ou archivée : inconnue/);
  const cree = await run(RH, 'referentiel.poste.enregistrer', { nom: 'Soudeur', formations: ['sst'], habilitations: [] });
  assert.equal(cree.message, 'Poste « Soudeur » ajouté au référentiel');
  assert.deepEqual((await poste('Soudeur')).formations, ['sst']);
  // Exigence ajoutée au poste d'Opératrice : Marion Petit et Léa Girard n'ont pas l'EPI incendie / le CACES.
  const id = (await poste('Opératrice')).id;
  const r = await run(RH, 'referentiel.poste.enregistrer', { id, nom: 'Opératrice de production', formations: ['caces489'], habilitations: [] });
  assert.match(r.message, /^Poste « Opératrice » renommé « Opératrice de production » sur 2 fiches · 2 salariés deviennent non conformes : Marion Petit \(CACES R489\) et Léa Girard \(CACES R489\)$/);
  assert.deepEqual(r.result!.salaries, [13, 15]);
  assert.equal((await emp(13)).poste, 'Opératrice de production', 'le libellé de la fiche suit le poste');
  assert.equal((await emp(13)).worst, 'exp');
  // Journal : identifiant, intitulé et codes avant / après, rattaché aux salariés devenus non conformes.
  const j = (await journal('referentiel.poste.enregistrer')).at(-1)!;
  assert.equal(j.payload.id, id);
  assert.deepEqual(j.payload.avant, { nom: 'Opératrice', formations: [] });
  assert.deepEqual(j.payload.apres, { nom: 'Opératrice de production', formations: ['caces489'] });
  assert.deepEqual(j.salaries, [13, 15]);
  assert.deepEqual((await journal('referentiel.poste.enregistrer'))[0].payload.apres, { nom: 'Soudeur', formations: ['sst'], habilitations: [] });
  assert.equal(familleAction('referentiel.poste.enregistrer')?.id, 'referentiels');
  // Archivage : refusé tant qu'un salarié présent l'occupe, possible ensuite, puis rétablissement.
  await refuse(RH, 'referentiel.poste.archiver', { id }, /2 salariés occupent ce poste/);
  assert.match((await run(RH, 'referentiel.poste.archiver', { id: (await poste('Soudeur')).id })).message, /archivé — plus proposé/);
  assert.ok((await poste('Soudeur')).archive);
  await refuse(RH, 'employe.modifier', { id: 13, posteId: (await poste('Soudeur')).id }, /archivé : rétablissez-le/);
  assert.match((await run(RH, 'referentiel.poste.archiver', { id: (await poste('Soudeur')).id, archive: false })).message, /rétabli/);
  assert.ok(Object.hasOwn(JOURNAL_LABEL, 'referentiel.poste.archiver') && Object.hasOwn(JOURNAL_LABEL, 'hab.demander'));
});

test('exigences communes d’une équipe : enregistrées, effet annoncé, vidées', async () => {
  const { db, run, refuse, user, RH, emp } = await fresh();
  await refuse(await user(12, 'manager'), 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: ['sst'] }, /réservée au service RH/, 403);
  await refuse(RH, 'referentiel.equipe.exigences', { nom: 'Inconnue', formations: [] }, /Équipe introuvable/, 404);
  const r = await run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: ['caces486'], habilitations: [] });
  assert.match(r.message, /^Exigences communes de l’équipe Maintenance enregistrées · \d+ salariés? devien/);
  assert.deepEqual((await db.get<{ exigences: unknown }>('equipes', 'Maintenance'))!.exigences, { formations: ['caces486'], habilitations: [] });
  assert.ok((await emp(2)).manquants.some(m => m.id === 'caces486'));
  const v = await run(RH, 'referentiel.equipe.exigences', { nom: 'Maintenance', formations: [], habilitations: [] });
  assert.match(v.message, /n’ont plus d’exigence manquante|n’a plus d’exigence manquante/);
  assert.equal((await db.get<{ exigences: unknown }>('equipes', 'Maintenance'))!.exigences, null);
});

test('fiche : poste choisi dans la liste, intitulé repris, nouveau poste créé par le service RH', async () => {
  const { db, run, refuse, RH, emp, poste } = await fresh();
  const fiche = {
    nom: 'Nouvel Embauché', equipe: 'Logistique', statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', jourOff: [], entree: '2026-10-10',
    naissance: 1995, email: 'nouvel.embauche@entreprise.example', matriculePaie: 'N9999',
  };
  // Poste choisi : son intitulé devient celui de la fiche ; ses exigences s'appliquent aussitôt.
  const id = (await run(RH, 'employe.creer', { ...fiche, posteId: (await poste('Cariste')).id, poste: 'peu importe' })).result!.id as number;
  assert.deepEqual([(await emp(id)).poste, (await emp(id)).posteId], ['Cariste', (await poste('Cariste')).id]);
  assert.deepEqual((await emp(id)).manquants.map(m => m.id).sort(), ['ac489', 'caces489', 'sst']);
  // Intitulé seul (import) : rattaché au poste du même nom, ou nouveau poste sans exigence.
  const id2 = (await run(RH, 'employe.creer', { ...fiche, nom: 'Autre Embauché', email: 'autre@entreprise.example', matriculePaie: 'N9998', poste: 'CARISTE' })).result!.id as number;
  assert.equal((await emp(id2)).posteId, (await poste('Cariste')).id);
  const id3 = (await run(RH, 'employe.creer', { ...fiche, nom: 'Troisième', email: 'trois@entreprise.example', matriculePaie: 'N9997', poste: 'Soudeur  TIG' })).result!.id as number;
  assert.deepEqual([(await poste('Soudeur TIG')).formations, (await emp(id3)).posteId], [[], (await poste('Soudeur TIG')).id]);
  await refuse(RH, 'employe.creer', { ...fiche, nom: 'Quatre', email: 'quatre@entreprise.example', matriculePaie: 'N9996', posteId: 9999 }, /Poste inconnu/);
  // Libellé précisé du même poste : gardé quand la fiche est renvoyée avec son poste (dialogue du service RH).
  await run(RH, 'employe.modifier', { id: 2, poste: 'Technicien de maintenance confirmé' });
  const tech = (await poste('Technicien de maintenance')).id;
  assert.deepEqual([(await emp(2)).poste, (await emp(2)).posteId], ['Technicien de maintenance confirmé', tech]);
  await run(RH, 'employe.modifier', { id: 2, posteId: tech, poste: 'Technicien de maintenance confirmé', jourOff: [] });
  assert.equal((await emp(2)).poste, 'Technicien de maintenance confirmé', 'libellé précisé gardé');
  // Renommer le poste ne l'écrase pas ; les fiches qui portaient l'intitulé du poste le suivent.
  await run(RH, 'referentiel.poste.enregistrer', { id: tech, nom: 'Technicien de maintenance industrielle', formations: [], habilitations: [] });
  assert.equal((await emp(2)).poste, 'Technicien de maintenance confirmé');
  assert.ok((await db.all<{ id: number; poste: string; posteId: number }>('employes')).filter(e => e.posteId === tech && e.id !== 2).every(e => e.poste === 'Technicien de maintenance industrielle'));
  // Un autre poste choisi donne son intitulé.
  await run(RH, 'employe.modifier', { id: 2, posteId: (await poste('Électromécanicien')).id, poste: 'Technicien de maintenance confirmé' });
  assert.deepEqual([(await emp(2)).poste, (await emp(2)).posteId], ['Électromécanicien', (await poste('Électromécanicien')).id]);
  assert.equal((await db.all('postes')).length, new Set((await db.all<{ nom: string }>('postes')).map(p => p.nom)).size);
});

test('manager : précise l’intitulé du poste sans en changer ; le poste et ses exigences restent au service RH', async () => {
  const { db, run, refuse, user, RH, emp, poste } = await fresh();
  // Camille Roux (Logistique, cariste) : le CACES exigé du poste ne s'évite pas en changeant de poste.
  const hugo = await user(16, 'manager');
  await run(RH, 'employe.modifier', { id: 1, posteId: (await poste('Cariste')).id });
  await db.exec(`DELETE FROM certifications WHERE emp_id = 1 AND f = 'caces489'`);
  assert.ok((await emp(1)).manquants.some(m => m.id === 'caces489'));
  const autre = (await poste('Préparateur de commandes')).id;
  await refuse(hugo, 'employe.modifier', { id: 1, posteId: autre, poste: 'Préparateur de commandes' }, /réservés au service RH : posteId/, 403);
  // Intitulé d'un autre poste saisi : le poste reste celui du service RH, l'intitulé n'en est qu'un libellé précisé.
  await run(hugo, 'employe.modifier', { id: 1, poste: 'Préparateur de commandes' });
  assert.deepEqual([(await emp(1)).poste, (await emp(1)).posteId], ['Préparateur de commandes', (await poste('Cariste')).id]);
  assert.ok((await emp(1)).manquants.some(m => m.id === 'caces489'), 'toujours non conforme');
  await run(hugo, 'employe.modifier', { id: 1, poste: 'Cariste confirmée' });
  assert.deepEqual([(await emp(1)).poste, (await emp(1)).posteId], ['Cariste confirmée', (await poste('Cariste')).id]);
  // Fiche hors référentiel (écrite sans poste) : intitulé renvoyé tel quel avec les jours non travaillés, sans refus.
  const sophie = await user(3, 'manager');
  await db.exec(`UPDATE employes SET poste = 'Régleuse', poste_id = NULL WHERE id = 13`);
  await run(sophie, 'employe.modifier', { id: 13, poste: 'Régleuse', jourOff: [2] });
  assert.deepEqual([(await emp(13)).jourOff, (await emp(13)).posteId], [[2], null]);
  await refuse(sophie, 'employe.modifier', { id: 13, poste: 'Poste inventé' }, /Poste inconnu : le service RH l’ajoute d’abord/);
  // Intitulé d'un poste existant : rattachée à ce poste (ses exigences s'ajoutent, rien n'est levé).
  await run(sophie, 'employe.modifier', { id: 13, poste: 'opératrice' });
  assert.equal((await emp(13)).posteId, (await poste('Opératrice')).id);
});

test('fiches écrites sans poste (import, reprise depuis Lucca) : exigences appliquées, rattachées au démarrage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-fiches-'));
  try {
    // Base neuve de production : migrations passées sans effet, aucun poste.
    const db = new Db(join(dir, 'cursus.db'));
    await migrate(db);
    await appliquerMigrations(db);
    assert.equal(await db.count('postes'), 0);
    await db.insert('formations', { id: 'caces489', nom: 'CACES R489', court: 'CACES R489', type: 'Réglementaire', validite: 60, cout: 0, organisme: null, validation: 'presence', archive: null });
    // Import des salariés : fiches écrites directement, sans `posteId`.
    const fiche = async (nom: string, poste: string) => (await db.insert<{ id: number }>('employes', {
      nom, poste, posteId: null, equipe: null, statut: 'ouvrier', typeContrat: 'cdi', temps: '35h', jourOff: [], entree: '2027-01-01', naissance: 1990,
    })).id;
    const a = await fiche('Ana Cariste', 'Cariste'), b = await fiche('Bruno Cariste', 'CARISTE'), c = await fiche('Chloé Soudeuse', 'Soudeuse');
    const RH = { role: 'rh', empId: null, nom: 'RH', intitule: 'RH' } as unknown as User;
    // Poste déclaré par le service RH avant tout redémarrage : ses exigences s'appliquent déjà aux fiches de même intitulé.
    await db.insert('postes', { nom: 'Cariste', formations: ['caces489'], habilitations: [], archive: null });
    const d = new Domain(await loadFull(db, RH));
    const manquants = (id: number) => d.enrich(90, false).find(e => e.id === id)!.manquants.map(m => m.id);
    assert.deepEqual([manquants(a), manquants(b), manquants(c)], [['caces489'], ['caces489'], []]);
    assert.deepEqual(X.titulaires(d.ds, d.ds.referentiels.postes[0].id).map(e => e.id), [a, b]);
    // Démarrage suivant (ou fin d'import) : fiches rattachées, poste créé sans exigence pour l'intitulé inconnu, libellés gardés.
    await migrate(db);
    const emps = await db.all<{ id: number; poste: string; posteId: number | null }>('employes');
    const cariste = (await db.all<{ id: number; nom: string }>('postes')).find(p => p.nom === 'Cariste')!.id;
    assert.deepEqual(emps.map(e => [e.poste, e.posteId]), [['Cariste', cariste], ['CARISTE', cariste], ['Soudeuse', (await db.all<{ id: number; nom: string }>('postes')).find(p => p.nom === 'Soudeuse')!.id]]);
    assert.equal((await db.all<Ligne>('journal')).filter(l => l.action === 'migration.postes').length, 1);
    assert.equal(await rattacherFiches(db), undefined, 'rien à refaire');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('effet des exigences annoncé avec le filtre « réglementaires uniquement » de l’affichage', async () => {
  const { domain, poste } = await fresh();
  const d = await domain();
  const operatrice = (await poste('Opératrice')).id;
  const avec = (onlyReg: boolean) => X.effetExigences({ ...d.ds, settings: { ...d.ds.settings, uniquementReglementaire: onlyReg } },
    { postes: d.ds.referentiels.postes.map(x => (x.id === operatrice ? { ...x, formations: ['rgpd'] } : x)) });
  assert.ok(avec(false).nouveaux.length > 0);
  assert.deepEqual(avec(true).nouveaux, [], 'formation non réglementaire : personne ne devient non conforme à l’écran');
});

test('données transmises : postes à tous les espaces, exigences retirées pour le profil paie (sans titres)', async () => {
  const { db, user } = await fresh();
  const paie = await buildSnapshot(db, await user(7, 'rh'));
  assert.ok(paie.referentiels.postes.length > 0);
  assert.ok(paie.referentiels.postes.every(p => !p.formations.length && !p.habilitations.length));
  assert.ok(paie.referentiels.equipes.every(q => !q.exigences));
  assert.ok(new Domain(paie).enrich(90, false).every(e => !e.manquants.length), 'personne compté non conforme faute de titres transmis');
  const hse = await buildSnapshot(db, await user(23, 'rh'));
  assert.ok(new Domain(hse).enrich(90, false).find(e => e.id === 4)!.manquants.length === 1);
  const mgr = await buildSnapshot(db, await user(16, 'manager'));
  assert.deepEqual(new Domain(mgr).enrich(90, false).find(e => e.id === 4)!.manquants.map(m => m.id), ['sst']);
  const collab = await buildSnapshot(db, await user(4, 'collaborateur'));
  assert.equal(collab.employes.length, 1);
  assert.ok(collab.referentiels.postes.length > 0);
});

test('proposition d’exigences : titres détenus par tous les titulaires ; effet annoncé avant l’enregistrement', async () => {
  const { domain, poste } = await fresh();
  const d = await domain();
  const p = X.exigencesProposees(d.ds, X.titulaires(d.ds, (await poste('Technicien de maintenance')).id));
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
  assert.equal(X.controlerPoste({ nom: 'Cariste' }, d.ds.referentiels, (await poste('Cariste')).id).erreurs.nom, undefined, 'son propre intitulé');
});

test('migration nommée : un poste par intitulé déjà saisi, variantes réunies, une seule fois, tracée ; base neuve sans effet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-postes-'));
  try {
    const file = join(dir, 'cursus.db');
    const db = new Db(file);
    assert.deepEqual((await appliquerMigrations(db)).includes('lot4-referentiels-postes'), true, 'base neuve : exécutée');
    assert.equal(await db.count('postes'), 0, 'sans effet');
    await seedDemo(db);
    // Base d'avant la mise à jour : aucun poste, fiches non rattachées, migration pas encore enregistrée ; une variante.
    await db.exec(`UPDATE employes SET poste_id = NULL; DELETE FROM postes; UPDATE employes SET poste = 'opératrice ' WHERE id = 15;
      DELETE FROM migrations WHERE nom = 'lot4-referentiels-postes'`);
    const n = new Set((await db.all<{ poste: string }>('employes')).map(e => e.poste.trim().toLowerCase())).size;
    db.sql.close();
    const ancienne = new Db(file);
    assert.equal(await POSTES.necessaire(ancienne), true);
    assert.deepEqual(await appliquerMigrations(ancienne), ['lot4-referentiels-postes']);
    assert.equal(await ancienne.count('postes'), n);
    const postes = await ancienne.all<{ id: number; nom: string; formations: string[]; habilitations: string[] }>('postes');
    assert.ok(postes.every(p => !p.formations.length && !p.habilitations.length), 'aucune exigence créée d’office');
    const emps = await ancienne.all<{ id: number; poste: string; posteId: number }>('employes');
    const op = postes.find(p => p.nom === 'Opératrice')!;
    assert.deepEqual(emps.filter(e => e.posteId === op.id).map(e => [e.id, e.poste]), [[13, 'Opératrice'], [15, 'opératrice ']], 'variante réunie, libellé saisi gardé');
    const j = (await ancienne.all<Ligne>('journal')).filter(l => l.action === 'migration.postes');
    assert.equal(j.length, 1);
    assert.match(j[0].message!, new RegExp(`^Reprise : ${n} postes pour 24 fiches — exigences à saisir`));
    assert.ok(!JSON.stringify(j[0].payload).includes('Opératrice'), 'aucun intitulé recopié au journal');
    assert.equal(familleAction('migration.postes')?.id, 'referentiels');
    assert.deepEqual(await appliquerMigrations(ancienne), [], 'rien à refaire');
    ancienne.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration : à égalité de variantes, le poste ne prend pas la forme tout en capitales', async () => {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.exec(`UPDATE employes SET poste_id = NULL; DELETE FROM postes; UPDATE employes SET poste = 'CARISTE' WHERE id = 1`);
  await postesDepuisFiches(db);
  const p = (await db.all<{ id: number; nom: string }>('postes')).find(x => x.nom.toLowerCase() === 'cariste')!;
  assert.equal(p.nom, 'Cariste');
  assert.deepEqual((await db.all<{ id: number; poste: string; posteId: number }>('employes')).filter(e => e.posteId === p.id).map(e => [e.id, e.poste]), [[1, 'CARISTE'], [16, 'Cariste']]);
});
