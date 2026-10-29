// Mémos des calculs de vue et synthèse du C2P incrémentale (lot 10, chantier A ; server/src/memo-vues.ts,
// server/src/c2p-incremental.ts) :
// - pour chaque compte, chaque espace et chaque profil RH, la vue calculée avec les mémos est strictement égale à celle
//   calculée sans aucun mémo (`sansMemo`), mémos froids puis chauds, avant et après une suite d'écritures (validation,
//   naissance corrigée, horaire requalifié, feuilles retirées) ;
// - la synthèse du C2P incrémentale est celle de `syntheseC2p`, et ne recalcule que les lignes des salariés touchés ;
// - une feuille mémoïsée garde son objet tant que ni elle ni la naissance de son salarié ne changent ; la clé suit la
//   naissance (date corrigée : indication recalculée) ;
// - CURSUS_MEMO_VUES=0 coupe tout mémo ; la lecture directe de l'oracle (`cache: false`) calcule sans mémo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_MEMO_VUES;

const { grosseDemo, lecteurs } = await import('./support/vues-lot10.ts');
const { buildSnapshot, loadFull, vueDe } = await import('../server/src/dataset.ts');
const { MEMO, memoParEntrees, memoParObjet, memoVuesActif, sansMemo } = await import('../server/src/memo-vues.ts');
const { syntheseC2pIncrementale } = await import('../server/src/c2p-incremental.ts');
const { syntheseC2p } = await import('../shared/rules/c2p.ts');
const { configurerFeries } = await import('../shared/dates.ts');
const { PROFILS_RH } = await import('../shared/constants.ts');
type Db = Awaited<ReturnType<typeof grosseDemo>>;
type User = import('../shared/types.ts').CurrentUser;
type Dataset = import('../shared/types.ts').Dataset;

const RH: User = { role: 'rh', empId: null, nom: 'Mémo', intitule: 'Essai', profilRh: 'rh_admin' };

/** Comptes de la base dans chacun de leurs espaces, plus chaque profil de l'espace RH. */
async function tous(db: Db): Promise<User[]> {
  return [...(await lecteurs(db)).map(x => x.user), ...(Object.keys(PROFILS_RH) as NonNullable<User['profilRh']>[]).map(profilRh => ({ ...RH, profilRh }))];
}

/** Chaque vue avec mémos (deux fois : mémos froids puis chauds) égale à la vue sans mémo, sur la même lecture. */
async function comparer(db: Db, users: User[], quand: string): Promise<void> {
  const full = await loadFull(db, RH);
  configurerFeries(full.calendrierFeries);
  for (const u of users) {
    const data = await loadFull(db, u);
    const sans = sansMemo(() => vueDe(data, u));
    for (const passage of ['froid', 'chaud']) {
      const avec = vueDe(data, u);
      assert.ok(isDeepStrictEqual(avec, sans), `${quand}, ${u.role} ${u.profilRh ?? u.empId}, mémos ${passage}`);
    }
  }
}

test('vues avec et sans mémo : identiques pour chaque compte et chaque profil RH, avant et après des écritures', async () => {
  const db = await grosseDemo();
  const users = await tous(db);
  assert.ok(users.some(u => u.role === 'manager') && users.some(u => u.profilRh === 'paie') && users.some(u => u.profilRh === 'lecture_seule'));
  await comparer(db, users, 'départ');
  // Feuilles : statut changé (validation), lignes modifiées, une feuille retirée.
  const f = (await db.all<{ id: number; empId: number; statut: string }>('feuilles')).filter(x => x.statut === 'validee');
  await db.run('UPDATE feuilles SET statut = ? WHERE id = ?', ['soumise', f[0].id]);
  await db.run('UPDATE feuilles SET comment = ? WHERE emp_id = ?', ['Reprise', f[1].empId]);
  await db.run('DELETE FROM feuilles WHERE id = ?', [f[2].id]);
  // Naissance corrigée (salarié devenu mineur), horaire de nuit requalifié (alternance), poste exposé.
  await db.run('UPDATE employes SET naissance = ?, naissance_le = ? WHERE id = ?', [2009, '2009-03-14', 8]);
  await db.run(`UPDATE horaires SET alternant = ? WHERE code = 'N'`, [true]);
  await comparer(db, await tous(db), 'après les écritures');
});

test('mémo par feuille : même objet tant que la feuille et la naissance ne changent pas ; naissance corrigée : recalculé', async () => {
  const db = await grosseDemo();
  const paie: User = { ...RH, profilRh: 'paie' };
  const avant = await loadFull(db, paie);
  configurerFeries(avant.calendrierFeries);
  const v1 = vueDe(avant, paie), v2 = vueDe(avant, paie);
  assert.ok(v1.feuilles.length > 256);
  assert.ok(v1.feuilles.every((sh, i) => sh === v2.feuilles[i]), 'feuilles mémoïsées : mêmes objets d’une vue à l’autre');
  // Naissance du salarié 8 corrigée : ses feuilles reçoivent l'indication recalculée, les autres restent les mêmes objets.
  const emp = avant.employes.find(e => e.id === 8)!;
  const apres = { ...avant, employes: avant.employes.map(e => (e.id === 8 ? { ...e, naissance: 2010, naissanceLe: '2010-06-01' } : e)) };
  const v3 = vueDe(apres, paie);
  const sans = sansMemo(() => vueDe(apres, paie));
  assert.ok(isDeepStrictEqual(v3, sans), 'vue égale à la vue sans mémo');
  assert.ok(v3.feuilles.some(sh => sh.empId === 8 && sh.mineur === true), 'feuilles du salarié devenu mineur');
  assert.ok(v3.feuilles.filter(sh => sh.empId !== 8).every(sh => v1.feuilles.includes(sh)), 'autres feuilles reprises');
  assert.ok(emp.naissanceLe !== '2010-06-01');
});

test('C2P incrémental : égal à syntheseC2p, seules les lignes des salariés touchés recalculées', async () => {
  const db = await grosseDemo();
  const full = await loadFull(db, RH);
  configurerFeries(full.calendrierFeries);
  const annees = [2026, 2025, 2024];
  for (const a of annees) assert.deepEqual(syntheseC2pIncrementale(full, a), syntheseC2p(full, a), `année ${a}`);
  assert.ok(syntheseC2p(full, 2025).lignes.some(l => l.nuits > 0) && syntheseC2p(full, 2025).horairesAQualifier.length, 'nuits comptées et horaires à qualifier');
  // Tranche : deux feuilles du salarié 8 remplacées (copies non validées), comme un delta.
  const idx = full.feuilles.map((sh, i) => [sh, i] as const).filter(([sh]) => sh.empId === 8 && sh.week.startsWith('2025')).slice(0, 2).map(([, i]) => i);
  const feuilles = full.feuilles.slice();
  for (const i of idx) feuilles[i] = { ...feuilles[i], statut: 'soumise' };
  const apres = { ...full, feuilles };
  const avant = MEMO.calcules;
  const s = syntheseC2pIncrementale(apres, 2025);
  assert.equal(MEMO.calcules - avant, 1, 'une ligne recalculée (salarié 8)');
  assert.deepEqual(s, syntheseC2p(apres, 2025));
  const reprises = s.lignes.filter(l => l.empId !== 8);
  const precedente = syntheseC2pIncrementale(full, 2025).lignes;
  assert.ok(reprises.every(l => precedente.includes(l)), 'lignes des autres salariés : mêmes objets');
  // Horaire requalifié (référentiels changés) : tout recalculé, toujours égal.
  const referentiels = { ...full.referentiels, horaires: (full.referentiels.horaires ?? []).map(h => (h.code === 'N' ? { ...h, alternant: true } : h)) };
  const requalifie = { ...apres, referentiels };
  assert.deepEqual(syntheseC2pIncrementale(requalifie, 2025), syntheseC2p(requalifie, 2025));
});

test('mémos coupés : CURSUS_MEMO_VUES=0 et sansMemo ; lecture directe de l’oracle sans mémo', async () => {
  let n = 0;
  const f = memoParEntrees((a: object) => { n++; return { a }; });
  const o = {};
  assert.equal(f(o), f(o));
  assert.equal(n, 1);
  assert.equal(memoParObjet('essai', o, 'x', () => 1), 1);
  assert.equal(memoParObjet('essai', o, 'x', () => 2), 1, 'mémoïsé');
  assert.equal(memoParObjet('essai', o, 'y', () => 3), 3, 'autre clé');
  sansMemo(() => {
    assert.equal(memoVuesActif(), false);
    assert.equal(memoParObjet('essai', o, 'x', () => 4), 4, 'sans mémo : recalculé');
    f(o);
  });
  assert.equal(n, 2);
  process.env.CURSUS_MEMO_VUES = '0';
  try {
    assert.equal(memoVuesActif(), false);
    f(o);
    assert.equal(n, 3);
  } finally {
    delete process.env.CURSUS_MEMO_VUES;
  }
  assert.equal(memoVuesActif(), true);
  // Lecture directe (`cache: false`, oracle) : aucun mémo lu ni rempli.
  const db = await grosseDemo();
  const avant = { ...MEMO };
  const direct = await db.lecture(async () => await buildSnapshot(db, { ...RH, profilRh: 'lecture_seule' }, { cache: false })) as Dataset;
  assert.deepEqual(MEMO, avant, 'aucun mémo touché');
  assert.ok(direct.c2p?.length);
});
