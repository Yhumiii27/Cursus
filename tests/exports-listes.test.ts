// Exports CSV des listes RH (t140) : annuaire, registre des habilitations, soldes, absences et plan de formation.
// Contenu des fichiers (colonnes, lignes affichées, nombres à la française), jamais de donnée de santé : ni nature
// d'une absence hors congés, quel que soit le profil, ni motif d'une suspension ; mention des soldes calculés par Cursus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { Domain } = await import('../shared/domain.ts');
const { NATURES_ABSENCE } = await import('../shared/constants.ts');
const { celluleCsv, texteCsv } = await import('../shared/csv.ts');
const { habSuivie } = await import('../shared/rules/referentiels.ts');
const { csvAbsences, csvAnnuaire, csvPlan, csvRegistre, csvSoldes, MENTION_SOLDES, nombre } = await import('../client/src/listes-csv.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// Comptes de démonstration : Sandrine Vidal (administratrice RH), Karim Haddad (12) encadre Mehdi (2).
async function fresh() {
  const db = new Db(':memory:');
  await seedDemo(db);
  const compteId = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: compteId(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), payload));
  // Données telles que le navigateur les reçoit (GET /api/data) : déjà restreintes au profil.
  const domaine = async (u: User) => new Domain(await buildSnapshot(db, u));
  return { db, user, run, domaine, RH: await user(null, 'rh') };
}

/** Texte complet du fichier, tel que téléchargé. */
const fichier = (x: { head: string[]; rows: (string | number)[][] }) => texteCsv(x.head, x.rows);
/** Libellés de toutes les natures d'absence hors congés : aucun ne doit figurer dans un export. */
const NATURES = Object.values(NATURES_ABSENCE).map(n => n.label);

test('annuaire : lignes affichées, colonnes de l’écran, matricule de paie absent pour le manager', async () => {
  const { domaine, RH, user } = await fresh();
  const d = await domaine(RH);
  const emps = d.enrich(d.ds.settings.horizonAlerte, d.ds.settings.uniquementReglementaire);
  // Comme l'écran : filtre d'équipe appliqué par la page, l'export ne reprend que ces lignes.
  const prod = emps.filter(e => e.equipe === 'Production');
  const x = csvAnnuaire(d, prod);
  assert.equal(x.fichier, 'annuaire-2026-10-10.csv');
  assert.deepEqual(x.head, ['Collaborateur', 'Matricule', 'Matricule de paie', 'Poste', 'Équipe', 'Contrat', 'Entrée', 'Sortie', 'Statut de conformité', 'Prochaine échéance']);
  assert.equal(x.rows.length, prod.length);
  assert.ok(x.rows.every(r => r[4] === 'Production' && /^EMP-\d{4}$/.test(String(r[1])) && /^\d{2}\/\d{2}\/\d{4}$/.test(String(r[6]))));
  assert.ok(x.rows.every(r => ['À jour', 'À renouveler', 'Non conforme'].includes(String(r[8]))), 'statut de conformité de l’écran');
  // Manager : son équipe seulement (jeu de données restreint), sans matricule de paie.
  const dm = await domaine(await user(12, 'manager'));
  // Comme l'écran : les membres de ses équipes, sans lui-même.
  const m = csvAnnuaire(dm, dm.enrich(30, false).filter(e => e.id !== 12 && dm.mgrOf(e) === 12));
  assert.ok(m.rows.length > 0, 'équipe du manager');
  assert.deepEqual(m.rows.filter(r => r[2] !== '').map(r => r[0]), [], 'aucun matricule de paie');
});

test('registre des habilitations : statut sans le motif d’une suspension, prérequis manquants', async () => {
  const { domaine, run, RH } = await fresh();
  await run(RH, 'hab.suspendre', { empId: 18, h: 'he', motif: 'Incident sur armoire électrique', date: '2026-10-09' });
  const d = await domaine(RH);
  const rows = d.enrich(30, false).flatMap(e => e.habs.filter(habSuivie).map(h => ({ e, h })));
  const x = csvRegistre(d, rows);
  assert.equal(x.fichier, 'registre-habilitations-2026-10-10.csv');
  assert.deepEqual(x.head, ['Titulaire', 'Matricule', 'Équipe', 'Habilitation', 'Délivrée le', 'Délivrée par', 'Échéance', 'Statut', 'Prérequis manquants']);
  assert.equal(x.rows.length, rows.length);
  const suspendu = x.rows.find(r => r[1] === 'EMP-0018' && r[7] === 'Suspendue');
  assert.ok(suspendu, 'titre suspendu exporté avec son statut');
  assert.doesNotMatch(fichier(x), /Incident sur armoire/, 'le motif de la mesure (texte libre) reste hors du fichier');
});

test('soldes : nombres à la française, compteurs non concernés vides, mention « soldes calculés par Cursus »', async () => {
  const { domaine, RH } = await fresh();
  const d = await domaine(RH);
  const x = csvSoldes(d, d.ds.employes);
  assert.equal(x.fichier, 'soldes-2026-10-10.csv');
  assert.deepEqual(x.head, ['Collaborateur', 'Matricule', 'Équipe', 'Contrat', 'CP 2025-2026 (j)', 'Droit CP 2025-2026 (j)', 'CP en acquisition 2026-2027 (j)',
    'RTT / repos 2026 (j)', 'Récupération (h)', 'CET (j)', 'Soldes au', 'Source']);
  assert.equal(x.rows.length, d.ds.employes.length);
  assert.ok(x.rows.every(r => r[10] === '10/10/2026' && r[11] === MENTION_SOLDES && MENTION_SOLDES === 'Soldes calculés par Cursus'));
  assert.ok(x.rows.every(r => r.slice(4, 10).every(c => c === '' || c === 'Agence d’intérim' || /^-?\d+(,\d+)?$/.test(String(c)))), 'nombres sans point décimal');
  assert.equal(nombre(12.5), '12,5');
  assert.equal(nombre(-2.25), '-2,25');
  // Un solde négatif reste un nombre : pas d'apostrophe devant (seules les vraies formules sont neutralisées).
  assert.equal(celluleCsv('-2,5'), '-2,5');
  assert.equal(celluleCsv('-2+3'), '\'-2+3');
});

test('absences : jamais la nature d’une absence hors congés, quel que soit le profil', async () => {
  const { domaine, run, RH, user } = await fresh();
  await run(RH, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-10-12', au: '2026-10-14', justificatif: true, justificatifLe: '2026-10-09' });
  for (const u of [RH, await user(12, 'manager')]) {
    const d = await domaine(u);
    const list = d.ds.absences.map(a => ({ a, e: d.emp(a.empId)! })).filter(x => x.e);
    const x = csvAbsences(d, list);
    assert.equal(x.fichier, 'absences-2026-10-10.csv');
    assert.deepEqual(x.head, ['Collaborateur', 'Matricule', 'Équipe', 'Absence', 'Du', 'Au', 'Jours', 'Décompte', 'Statut', 'Demi-journées']);
    const arret = x.rows.find(r => r[1] === 'EMP-0002' && r[4] === '12/10/2026');
    assert.ok(arret, u.role);
    assert.equal(arret[3], 'Absence');
    assert.equal(arret[6], '3');
    const texte = fichier(x);
    for (const n of NATURES) assert.ok(!texte.includes(n), `${u.role} : « ${n} » dans l’export`);
    assert.doesNotMatch(texte, /maladie|arrêt|accident|médic/i);
    // Les congés restent nommés.
    assert.ok(x.rows.some(r => r[3] === 'Congés payés' || r[3] === 'RTT / repos'));
  }
});

test('absences : deux natures hors congés sur une même période donnent la même ligne (ni unité, ni nombre de jours)', async () => {
  const { domaine, run, RH, user } = await fresh();
  // Du vendredi au lundi (week-end compris) : 4 jours calendaires, 2 jours ouvrés.
  await run(RH, 'absence.saisir', { empId: 2, nature: 'MALADIE', du: '2026-10-16', au: '2026-10-19', justificatif: true, justificatifLe: '2026-10-09' });
  await run(RH, 'absence.saisir', { empId: 3, nature: 'ENFANT_MALADE', du: '2026-10-16', au: '2026-10-19', justificatif: true, justificatifLe: '2026-10-09' });
  for (const u of [RH, await user(12, 'manager')]) {
    const d = await domaine(u);
    const list = d.ds.absences.map(a => ({ a, e: d.emp(a.empId)! })).filter(x => x.e);
    const x = csvAbsences(d, list);
    const ligne = (m: string) => x.rows.find(r => r[1] === m && r[4] === '16/10/2026');
    const arret = ligne('EMP-0002');
    assert.ok(arret, u.role);
    assert.deepEqual(arret.slice(3), ['Absence', '16/10/2026', '19/10/2026', '4', 'jours calendaires', 'Qualifiée', '']);
    // Le manager ne voit que son équipe : l'enfant malade de l'EMP-0003 n'y figure que pour le RH.
    const enfant = ligne('EMP-0003');
    if (u === RH) {
      assert.ok(enfant);
      assert.deepEqual(enfant.slice(3), arret.slice(3), 'lignes identiques hors nom, matricule et équipe');
    }
  }
});

test('plan de formation : exercice, filtre de statut, coût retenu et origine', async () => {
  const { domaine, RH } = await fresh();
  const d = await domaine(RH);
  const plan = d.ds.plan.filter(l => l.exercice === 2026);
  assert.ok(plan.length > 0, 'plan de démonstration');
  const prevus = plan.filter(l => l.statut === 'prevu');
  const x = csvPlan(d, 2026, prevus);
  assert.equal(x.fichier, 'plan-formation-2026-2026-10-10.csv');
  assert.deepEqual(x.head, ['Exercice', 'Formation', 'Équipe', 'Période', 'Effectif', 'Coût (€)', 'Coût prévu (€)', 'Statut', 'Origine']);
  assert.equal(x.rows.length, prevus.length);
  assert.ok(x.rows.every(r => r[0] === 2026 && r[7] === 'Prévu' && /^T[1-4]$/.test(String(r[3])) && /^\d+(,\d+)?$/.test(String(r[5]))));
});
