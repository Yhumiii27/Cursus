// Planning d'équipe, habilitations des postes déjà planifiés (CU-142, lot 18), sur le jeu de démonstration du 10 octobre
// 2026 (Karim Haddad, 12, encadre la Maintenance : Mehdi Benali, 2, dont l'habilitation électrique est expirée ; Thomas
// Garnier, 6 ; Romain Chevalier, 18) : un poste à venir, publié ou brouillon, dont l'habilitation exigée manque ou
// expirera avant lui est signalé au planificateur, jamais stocké ni journalisé ; jours passés, repos et absences ignorés ;
// jamais la réserve d'aptitude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { Domain } = await import('../shared/domain.ts');
const { fichesEnrichies } = await import('../shared/rules/planning-apercu.ts');
const { habilitationsPlanifiees, manquesDuJour, CODES_HABILITATION_PLANIFIEE } = await import('../shared/rules/planning-habilitations.ts');
const { HORAIRES_EXEMPLES } = await import('../shared/rules/horaires.ts');
const V = await import('../client/src/components/planning/planning-vue.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Creneau = import('../shared/types-planning.ts').Creneau;
type HoraireFige = import('../shared/types.ts').HoraireFige;

const H: Record<string, HoraireFige> = Object.fromEntries(HORAIRES_EXEMPLES.map(h => [h.code, { code: h.code, debut: h.debut, fin: h.fin, pause: h.pause }]));

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  const compteId = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteId(empId), role, methode: 'demo' }))!;
  return { db, KARIM: await user(12, 'manager'), RH: await user(null, 'rh') };
}
type Db = Awaited<ReturnType<typeof fresh>>['db'];

const creneau = async (db: Db, empId: number, jour: string, horaire: string | null, statut: 'publie' | 'brouillon' = 'publie') => {
  const h = horaire ? H[horaire] : null;
  return (await db.insert<Creneau>('creneaux', {
    empId, jour, equipe: 'Maintenance', horaire, debut: h?.debut ?? null, fin: h?.fin ?? null, pause: h?.pause ?? 0, source: 'manuel', statut,
    version: statut === 'publie' ? 1 : null, publieLe: statut === 'publie' ? '2026-10-01T08:00:00.000Z' : null, publiePar: statut === 'publie' ? 'Karim Haddad' : null,
    communiqueLe: statut === 'publie' ? '2026-10-01' : null, horsDelai: false, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad',
  })).id;
};

test('poste publié ou brouillon à venir : habilitation exigée manquante signalée, jours passés et repos ignorés, sans aptitude', async () => {
  const { db, KARIM } = await fresh();
  await creneau(db, 2, '2026-10-08', 'M');          // passé : ignoré
  await creneau(db, 2, '2026-10-12', 'M');          // publié, à venir
  await creneau(db, 2, '2026-10-13', null);         // repos
  await creneau(db, 2, '2026-10-14', 'AM', 'brouillon');
  await creneau(db, 6, '2026-10-12', 'AM');         // Thomas : réserve d'aptitude seulement, jamais rendue ici
  const journal = (await db.query('SELECT COUNT(*) AS n FROM journal', []) as { n: number }[])[0].n;
  const d = new Domain(await loadFull(db, KARIM));
  const m = habilitationsPlanifiees(d, { creneaux: d.ds.creneaux ?? [], fiches: fichesEnrichies(d), au: '2026-10-31' });
  assert.ok(m.length > 0);
  assert.ok(m.every(x => x.empId === 2 && CODES_HABILITATION_PLANIFIEE.includes(x.code)), JSON.stringify(m));
  assert.deepEqual([...new Set(m.map(x => x.jour))], ['2026-10-12', '2026-10-14']);
  assert.deepEqual([...new Set(m.map(x => `${x.jour}:${x.statut}:${x.horaire}`))], ['2026-10-12:publie:M', '2026-10-14:brouillon:AM']);
  assert.ok(m.some(x => x.code === 'habilitation' && /^habilitation exigée .+ expirée le /.test(x.texte)), JSON.stringify(m));
  assert.equal(manquesDuJour(m, 2, '2026-10-12').length, m.filter(x => x.jour === '2026-10-12').length);
  // Filtre du planificateur, période vide ou passée, début ramené à aujourd'hui.
  assert.deepEqual(habilitationsPlanifiees(d, { creneaux: d.ds.creneaux ?? [], fiches: fichesEnrichies(d), au: '2026-10-31', retenir: id => id !== 2 }), []);
  assert.deepEqual(habilitationsPlanifiees(d, { creneaux: d.ds.creneaux ?? [], fiches: fichesEnrichies(d), du: '2026-10-01', au: '2026-10-09' }), []);
  assert.deepEqual(habilitationsPlanifiees(d, { creneaux: d.ds.creneaux ?? [], fiches: fichesEnrichies(d), du: '2026-10-13', au: '2026-10-31' }).map(x => x.jour)[0], '2026-10-14');
  assert.deepEqual(habilitationsPlanifiees(d, { creneaux: d.ds.creneaux ?? [], fiches: new Map(), au: '2026-10-31' }), [], 'sans fiche : rien');
  // Calculé, jamais écrit.
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM journal', []) as { n: number }[])[0].n, journal);
});

test('habilitation valide aujourd’hui qui expire avant le poste : « expirée … avant ce poste » ; absence en vigueur : non comptée', async () => {
  const { db, KARIM } = await fresh();
  const d0 = new Domain(await loadFull(db, KARIM));
  const romain = fichesEnrichies(d0).get(18)!;
  // Habilitations exigées de Romain sur son poste : prendre la première qu'il détient et la faire expirer le 20 octobre.
  const fiche = { ...romain, habs: romain.habs.map(h => ({ ...h, key: 'valid', mesure: null, exp: new Date(2026, 9, 20), checks: [] })) };
  await creneau(db, 18, '2026-10-19', 'M');
  await creneau(db, 18, '2026-10-26', 'M');
  await creneau(db, 18, '2026-10-27', 'M');
  await db.insert('absences', { empId: 18, type: 'CP', du: '2026-10-27', au: '2026-10-27', jours: 1, statut: 'validee', creeLe: '2026-10-01T08:00:00Z' });
  const d = new Domain(await loadFull(db, KARIM));
  const m = habilitationsPlanifiees(d, { creneaux: d.ds.creneaux ?? [], fiches: new Map([[18, fiche as typeof romain]]), au: '2026-10-31' }).filter(x => x.code !== 'formation');
  assert.equal(m.length, 1, JSON.stringify(m));
  assert.ok(m.every(x => x.jour === '2026-10-26' && x.code === 'habilitation_expire' && x.texte.endsWith('expirée le 20 oct. 2026, avant ce poste')), JSON.stringify(m));
});

test('vue : « ! » dans la grille du planificateur, liste par équipe, module désactivé ou consultation : rien', async () => {
  const { db, KARIM } = await fresh();
  await creneau(db, 2, '2026-10-12', 'M');
  const d = new Domain(await loadFull(db, KARIM));
  const jours = V.joursDe('2026-10-12', 14);
  const mehdi = V.grilleEquipe(d, 'Maintenance', jours, true).lignes.find(l => l.empId === 2)!;
  assert.equal(mehdi.cases[0].habilitation, true);
  assert.match(mehdi.cases[0].texte, /; habilitation exigée .+ expirée le /);
  assert.equal(V.grilleEquipe(d, 'Maintenance', jours, false).lignes.find(l => l.empId === 2)!.cases[0].habilitation, false);
  assert.equal(V.grilleEquipe(d, 'Maintenance', V.joursDe('2026-09-14', 14), true).lignes.find(l => l.empId === 2)?.cases[0].habilitation, undefined, 'passé');
  assert.ok(V.habilitationsAVenir(d, () => true).length > 0);
  assert.ok(V.habilitationsAVenir(d, () => true, 'Maintenance').every(x => x.equipe === 'Maintenance'));
  assert.deepEqual(V.habilitationsAVenir(d, () => true, 'Logistique'), []);
  assert.deepEqual(V.habilitationsAVenir(d, () => false), []);
  const ds = await loadFull(db, KARIM);
  assert.deepEqual(V.habilitationsAVenir(new Domain({ ...ds, settings: { ...ds.settings, planningActif: false } }), () => true), []);
  assert.deepEqual(V.habilitationsAVenir(new Domain({ ...ds, creneaux: [] }), () => true), [], 'aucun poste à venir');
});
