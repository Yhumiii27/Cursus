// Règles du droit du travail et de la paie sur la lecture partagée (lot 9, chantier 4) : pour chaque salarié, les règles
// de shared/ qui dépendent de l'historique ou de la période en cours donnent exactement le même résultat sur le jeu
// remis aux actions par la lecture partagée (entrée du cache de l'instantané, dérivée d'une révision à la suivante par le
// delta des lignes changées depuis le lot 9) et sur le jeu de la relecture complète (`loadFull`) : repos compensateur (recupInfo), congés (cpInfo,
// acquisitionPeriode des périodes de référence encadrant aujourd'hui), RTT (rttInfo), CET (cetInfo), contingent annuel,
// COR à valider de chaque feuille soumise, moyenne sur 12 semaines, requalification d'un temps partiel, cumul du forfait
// jours, synthèse du C2P (années suivies), feuilles en attente de la paie (sagePending). Sur le jeu de démonstration et sur
// le jeu de charge d'un an, après une suite d'écritures (tests/support/oracle.ts), sur le moteur de la suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;

const { nouvelleBase } = await import('./base.ts');
const { baseDemo, baseUnAn, rejouer } = await import('./support/oracle.ts');
const { buildSnapshot, loadFull, todayIso } = await import('../server/src/dataset.ts');
const { donneesAction, remettreStatistiques, statistiquesCache } = await import('../server/src/cache-instantane.ts');
const { Domain } = await import('../shared/domain.ts');
const { cetInfo, cpInfo, recupInfo, rttInfo } = await import('../shared/rules/conges.ts');
const { acquisitionPeriode } = await import('../shared/rules/acquisition-cp.ts');
const { contingentAnnuel, corAValider, moyenne12Semaines, requalificationPartiel } = await import('../shared/rules/durees.ts');
const { cumulForfaitJours } = await import('../shared/rules/forfait-jours.ts');
const { anneesC2p, syntheseC2p } = await import('../shared/rules/c2p.ts');
const { sagePending } = await import('../shared/rules/temps.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type User = Dataset['user'];

/** Administrateur RH : tous les droits, paie comprise (résumés de la paie dans le jeu). */
const RH: User = { role: 'rh', empId: null, nom: 'Règles', intitule: 'Administrateur RH', profilRh: 'rh_admin' };

/** Résultat d'une règle, ou son erreur (même message attendu des deux côtés). */
const resultat = (f: () => unknown) => { try { return f(); } catch (err) { return { erreur: err instanceof Error ? err.message : String(err) }; } };

/** Règles calculées sur `ds`, par clé « règle|salarié|précision ». */
function regles(ds: Dataset): Map<string, unknown> {
  const d = new Domain(ds);
  const out = new Map<string, unknown>();
  for (const e of ds.employes) {
    const cle = (r: string, x = '') => `${r}|${e.id}${x ? `|${x}` : ''}`;
    out.set(cle('recupInfo'), resultat(() => recupInfo(d, e)));
    out.set(cle('cpInfo'), resultat(() => cpInfo(d, e)));
    for (const A of [d.year - 1, d.year, d.year + 1]) out.set(cle('acquisitionPeriode', String(A)), resultat(() => acquisitionPeriode(d, e, A)));
    out.set(cle('rttInfo'), resultat(() => rttInfo(d, e)));
    out.set(cle('cetInfo'), resultat(() => cetInfo(d, e)));
    out.set(cle('contingentAnnuel'), resultat(() => contingentAnnuel(d, e)));
    for (const sh of ds.feuilles.filter(f => f.empId === e.id && f.statut === 'soumise')) out.set(cle('corAValider', sh.week), resultat(() => corAValider(d, e, sh)));
    out.set(cle('moyenne12Semaines'), resultat(() => moyenne12Semaines(d, e)));
    out.set(cle('requalificationPartiel'), resultat(() => requalificationPartiel(d, e)));
    out.set(cle('cumulForfaitJours'), resultat(() => cumulForfaitJours(d, e)));
  }
  for (const a of anneesC2p(ds.today)) out.set(`syntheseC2p|${a}`, resultat(() => syntheseC2p(ds, a)));
  out.set('sagePending', resultat(() => sagePending(d).map(sh => sh.id)));
  return out;
}

/**
 * Jeu de la lecture partagée (comme une action le reçoit : `donneesAction` dans sa transaction, l'entrée de la révision
 * courante exigée) et jeu de la relecture complète, lus sur le même état.
 */
async function deuxJeux(db: Db): Promise<{ partage: Dataset; complet: Dataset }> {
  await db.lecture(async () => await buildSnapshot(db, RH));
  return await db.tx(async () => {
    let directes = 0;
    const partage = await donneesAction(db, RH, todayIso(), async u => { directes++; return await loadFull(db, u); });
    assert.equal(directes, 0, 'jeu servi par la lecture partagée');
    return { partage, complet: await loadFull(db, RH) };
  });
}

/** Compare règle par règle ; rend le nombre de résultats comparés. */
function comparer(partage: Dataset, complet: Dataset): number {
  const a = regles(complet), b = regles(partage);
  assert.deepEqual([...b.keys()], [...a.keys()]);
  for (const [cle, attendu] of a) assert.ok(isDeepStrictEqual(b.get(cle), attendu), `${cle} : ${JSON.stringify(b.get(cle))?.slice(0, 300)} au lieu de ${JSON.stringify(attendu)?.slice(0, 300)}`);
  return a.size;
}

test('démonstration : règles de chaque salarié identiques sur la lecture partagée et la relecture complète, avant et après une suite d’écritures', async () => {
  const db = await baseDemo(nouvelleBase);
  const { partage, complet } = await deuxJeux(db);
  const n = comparer(partage, complet);
  assert.ok(n >= complet.employes.length * 10, `${n} résultats`);
  // Après des écritures (saisies, absences, compteurs, SQL direct) : nouvelle entrée, dérivée par le delta des lignes
  // changées (lot 9, étape 2) et jamais relue en entier, mêmes règles.
  remettreStatistiques();
  const x = await rejouer(db, { graine: 11, pas: 40, sql: 0.3, verifier: false });
  assert.ok(x.ecritures > 0);
  const apres = await deuxJeux(db);
  const stats = statistiquesCache(db);
  assert.ok(stats.entreesDerivees > 0 && stats.entreesCompletes === 0, JSON.stringify(stats));
  comparer(apres.partage, apres.complet);
  // Le jeu a bien changé (sinon la comparaison n'apprend rien de neuf).
  assert.notDeepEqual(JSON.parse(JSON.stringify({ ...apres.complet, revision: 0 })), JSON.parse(JSON.stringify({ ...complet, revision: 0 })));
});

test('jeu de charge d’un an : règles des 120 salariés identiques sur la lecture partagée et la relecture complète', async () => {
  const { db, jeu } = await baseUnAn(nouvelleBase);
  remettreStatistiques();
  await rejouer(db, { graine: 12, pas: 15, sql: 0.3, verifier: false });
  const { partage, complet } = await deuxJeux(db);
  const stats = statistiquesCache(db);
  assert.ok(stats.entreesDerivees > 0 && stats.entreesCompletes === 1, `jeu de la lecture partagée dérivé par le delta : ${JSON.stringify(stats)}`);
  assert.ok(complet.employes.length >= 120 && complet.feuilles.length > 5000, `${complet.employes.length} fiches, ${complet.feuilles.length} feuilles`);
  assert.ok(complet.feuilles.some(f => f.statut === 'soumise') && sagePending(new Domain(complet)).length > 0, 'feuilles soumises et en attente de paie');
  assert.ok(jeu.lots >= 10);
  const n = comparer(partage, complet);
  assert.ok(n >= 120 * 10, `${n} résultats`);
});
