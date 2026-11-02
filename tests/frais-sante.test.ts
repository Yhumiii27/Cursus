// Notes de frais, lot 12, chantier C2, étape 2 : scission des frais médicaux (choix par défaut du chantier, le delta d'une
// dépense dépassant son budget avec le marqueur « toute la table » de lignes_frais) :
// - une dépense d'une note médicale va dans `lignes_frais_sante`, les autres dans `lignes_frais`, avec des identifiants
//   communs aux deux tables ; l'instantané les réunit dans `lignesFrais`, dans l'ordre des identifiants ;
// - modification, refus, plafonnement, suppression et justificatifs visent la table de la note ;
// - journal des changements : clés des dépenses ordinaires, marqueur seul pour les dépenses médicales ; un delta d'une
//   dépense ordinaire relit sa seule ligne ;
// - migration SQLite lot12-frais-sante : dépenses médicales reprises de lignes_frais avec leur identifiant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
(await import('../server/src/logs.ts')).reglerJournaux({ sortie: () => {} });
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { lireBrut } = await import('../server/src/lecture-brute.ts');
const { lireDelta, relectureComplete } = await import('../server/src/delta.ts');
const { insererLigneFrais, ligneFraisParId, tableLignesFrais } = await import('../server/src/frais-sante.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { FRAIS_SANTE } = await import('../server/src/migrations/lot12-frais-sante.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const DEPENSE = { date: '2026-10-06', montant: 20, sansJustificatif: true, attestation: true };

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compte = async (empId: number | null) => (await db.one<{ id: number }>(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!.id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compte(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p) as { result: Record<string, number> });
  return { db, run, MEHDI: await user(2, 'collaborateur'), MANON: await user(21, 'rh'), ADMIN: await user(null, 'rh') };
}

test('dépenses médicales dans leur table, identifiants communs, réunies dans l’instantané ; écritures dans la table de la note', async () => {
  const { db, run, MEHDI, MANON } = await fresh();
  assert.deepEqual([tableLignesFrais({ medicale: true }), tableLignesFrais({ medicale: false })], ['lignesFraisSante', 'lignesFrais']);
  const med = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10', medicale: true })).result.note;
  const ord = (await run(MEHDI, 'frais.note.creer', { periode: '2026-10' })).result.note;
  const m1 = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: med, ...DEPENSE, categorie: 'medical' })).result.ligne;
  const o1 = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: ord, ...DEPENSE, categorie: 'divers' })).result.ligne;
  const m2 = (await run(MEHDI, 'frais.ligne.ajouter', { noteId: med, ...DEPENSE, categorie: 'medical', montant: 12 })).result.ligne;
  assert.ok(m1 < o1 && o1 < m2, 'identifiants croissants, communs aux deux tables');
  assert.equal((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM lignes_frais WHERE note_id = ?', [med]))!.n, 0, 'aucune dépense médicale dans lignes_frais');
  assert.deepEqual((await db.query<{ id: number }>('SELECT id FROM lignes_frais_sante WHERE note_id = ? ORDER BY id', [med])).map(x => Number(x.id)), [m1, m2]);
  assert.equal((await ligneFraisParId(db, m1))?.table, 'lignesFraisSante');
  assert.equal((await ligneFraisParId(db, o1))?.table, 'lignesFrais');
  assert.equal(await ligneFraisParId(db, 999_999), undefined);
  // Une insertion sans identifiant qui suit (démonstration, essais) ne reprend pas un identifiant médical.
  const apres = await db.insert<{ id: number }>('lignesFrais', { noteId: ord, empId: 2, ...DEPENSE, categorie: 'divers', devise: 'EUR', montantEur: 20 });
  assert.ok(apres.id > m2);
  // Instantané : les deux tables réunies, dans l'ordre des identifiants ; vue du salarié comprise.
  const ids = (await loadFull(db, MEHDI)).lignesFrais!.map(l => l.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.ok([m1, m2, o1].every(id => ids.includes(id)));
  assert.ok((await buildSnapshot(db, MEHDI, { cache: false })).lignesFrais!.some(l => l.id === m1));
  // Modification, suppression : dans la table de la note.
  await run(MEHDI, 'frais.ligne.modifier', { id: m2, ...DEPENSE, categorie: 'medical', montant: 15 });
  assert.equal((await db.get<{ montant: number }>('lignesFraisSante', m2))!.montant, 15);
  await run(MEHDI, 'frais.ligne.supprimer', { id: m2 });
  assert.equal(await db.get('lignesFraisSante', m2), undefined);
  // Contrôle (refus, plafonnement) d'une dépense médicale.
  await run(MEHDI, 'frais.note.soumettre', { id: med });
  await run(MANON, 'frais.ligne.plafonner', { id: m1, montant: 18 });
  assert.equal((await db.get<{ montantRetenu: number }>('lignesFraisSante', m1))!.montantRetenu, 18);
  await run(MANON, 'frais.ligne.refuser', { id: m1, motif: 'Hors politique' });
  assert.ok((await db.get<{ refuseeLe: string | null }>('lignesFraisSante', m1))!.refuseeLe);
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
});

test('journal des changements : clés des dépenses ordinaires, marqueur seul pour les dépenses médicales ; delta par clé', async () => {
  const { db } = await fresh();
  const n = async (medicale: boolean) => (await db.insert<{ id: number }>('notesFrais', { empId: 2, periode: '2026-10', medicale, statut: 'brouillon', creeLe: '2026-10-06T08:00:00.000Z', creePar: 'Essai' })).id;
  const ord = await n(false), med = await n(true);
  const brut = await db.lecture(async () => await lireBrut(db, '2026-10-10'));
  const avant = await db.revisionBase();
  const o = await insererLigneFrais(db, { medicale: false }, { noteId: ord, empId: 2, ...DEPENSE, categorie: 'divers', devise: 'EUR', montantEur: 20 });
  const m = await insererLigneFrais(db, { medicale: true }, { noteId: med, empId: 2, ...DEPENSE, categorie: 'medical', devise: 'EUR', montantEur: 20 });
  const lignes = await db.query<{ tbl: string; pk: string | null }>('SELECT tbl, pk FROM changements WHERE n > ? AND tbl IN (?, ?)', [avant, 'lignes_frais', 'lignes_frais_sante']);
  assert.ok(lignes.some(c => c.tbl === 'lignes_frais' && c.pk === String(o.id)), 'dépense ordinaire inscrite par sa clé');
  assert.ok(lignes.filter(c => c.tbl === 'lignes_frais_sante').every(c => c.pk === null), 'dépense médicale : marqueur « toute la table » seul');
  assert.ok(!lignes.some(c => c.pk === String(m.id)), 'jamais la clé d’une dépense médicale');
  // Delta : la dépense ordinaire relue par sa clé, la table médicale (petite) en entier.
  const ch = (await db.lireChangements(avant, await db.revisionBase()))!;
  assert.equal(relectureComplete('lignesFrais', ch.get('lignesFrais')!), false);
  assert.equal(relectureComplete('lignesFraisSante', ch.get('lignesFraisSante')!), true);
  const d = await db.lecture(async () => await lireDelta(db, brut, ch));
  assert.deepEqual(d.tables.get('lignesFrais')!.lignes.map(l => l.id), [o.id]);
});

test('migration SQLite lot12-frais-sante : dépenses médicales reprises avec leur identifiant, index posés', { skip: process.env.CURSUS_TEST_ENGINE === 'pg' }, async () => {
  const { db } = await fresh();
  const sql = db as unknown as Parameters<typeof FRAIS_SANTE.executer>[0];
  // Base d'avant la scission : une dépense médicale rangée avec les autres.
  const med = (await db.insert<{ id: number }>('notesFrais', { empId: 2, periode: '2026-10', medicale: true, statut: 'brouillon', creeLe: '2026-10-06T08:00:00.000Z', creePar: 'Essai' })).id;
  const l = await db.insert<{ id: number }>('lignesFrais', { noteId: med, empId: 2, ...DEPENSE, categorie: 'medical', devise: 'EUR', montantEur: 20, commercant: 'Pharmacie' });
  assert.equal(await FRAIS_SANTE.necessaire!(sql), true);
  assert.match(String(await FRAIS_SANTE.executer(sql)), /^1 dépense de frais médicaux déplacée ; index lignes_frais_sante_note, lignes_frais_sante_emp$/);
  assert.equal(await db.get('lignesFrais', l.id), undefined);
  assert.equal((await db.get<{ commercant: string }>('lignesFraisSante', l.id))!.commercant, 'Pharmacie');
  assert.equal(await FRAIS_SANTE.necessaire!(sql), false, 'rien à reprendre ensuite');
});
