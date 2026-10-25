// Oracle d'exactitude du cache de l'instantané (lot 9, chantier 4 ; banc : tests/support/oracle.ts, comparaisons :
// scripts/charge/verifier.ts). Une suite d'écritures aléatoire et reproductible (actions du registre par des comptes tirés
// au hasard, SQL direct), et après chaque pas : vue de chaque compte, espace et profil RH, entrée du cache et jeu d'action
// de chaque lecteur, identiques (`isDeepStrictEqual`) à la relecture complète lue directement. Sur le moteur de la suite
// (SQLite par défaut, PostgreSQL avec npm run test:pg), avec le jeu de démonstration et le jeu de charge d'un an.
// Réglages : CURSUS_ORACLE_GRAINES (graines séparées par des virgules), CURSUS_ORACLE_PAS (pas de la démonstration),
// CURSUS_ORACLE_COMPLET=1 (passage long : 300 pas, comparaison de tous les lecteurs à chaque pas, jeu d'un an compris).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_CACHE_INSTANTANE;

const { nouvelleBase } = await import('./base.ts');
const { baseDemo, baseUnAn, rejouer, resumeRapport } = await import('./support/oracle.ts');
const { cleLecteur, comparerJeuAction, ecart, instantaneDirect, lecteursDe, LECTEUR_ENTREE, Porte, verifierExactitude } = await import('../scripts/charge/verifier.ts');
const { buildSnapshot } = await import('../server/src/dataset.ts');
const { cacheActif } = await import('../server/src/cache-instantane.ts');
const { PROFILS_RH } = await import('../shared/constants.ts');
const { juger, statistiques } = await import('../scripts/charge/seuils.ts');

const COMPLET = process.env.CURSUS_ORACLE_COMPLET === '1';
const GRAINES = (process.env.CURSUS_ORACLE_GRAINES?.trim() || (COMPLET ? '20261010,42,7' : '20261010')).split(',').map(Number);
const PAS = Number(process.env.CURSUS_ORACLE_PAS) || (COMPLET ? 300 : 40);
const demo = async () => await baseDemo(nouvelleBase);

test('comparaison : premier écart en profondeur, à l’identique', () => {
  assert.equal(ecart({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), null);
  assert.equal(ecart({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), '$.a[1].b : attendu 2, obtenu 3');
  assert.equal(ecart([1, 2], [1]), '$ : 2 éléments attendus, 1 obtenus');
  assert.match(ecart({ a: 1, b: undefined }, { a: 1 })!, /\$\.b : absent de la lecture partagée/);
  assert.match(ecart({ a: 1 }, { a: 1, c: null })!, /\$\.c : en trop/);
  assert.equal(ecart({ n: 1 }, { n: '1' }), '$.n : attendu 1, obtenu "1"', 'types comparés');
  assert.equal(ecart([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]), '$[0].id : attendu 1, obtenu 2', 'ordre des lignes comparé');
  assert.equal(ecart(new Map([[1, 'a']]), new Map([[1, 'b']])), '$ : prototypes différents', 'Map : écart signalé à sa racine');
});

test('lecture directe de l’oracle : le cache reste actif pour les autres lectures, rien n’est coupé pour le processus', async () => {
  // Relecture du lot 9 : couper le cache par CURSUS_CACHE_INSTANTANE pendant une comparaison faisait relire toute la base
  // à chaque GET /api/data concurrent de l'essai de charge.
  const db = await demo();
  const u = (await lecteursDe(db)).find(x => x.role === 'collaborateur')!;
  let relectures = 0;
  const query = db.query.bind(db);
  db.query = (async (sql: string, params?: readonly never[]) => {
    if (/^\s*SELECT \* FROM feuilles\s+ORDER BY/i.test(sql)) relectures++;
    return await query(sql, params);
  }) as typeof db.query;
  const servie = async () => await db.lecture(async () => await buildSnapshot(db, u));
  await servie();
  relectures = 0;
  // La lecture directe relit tout, une seule fois ; la lecture servie en même temps vient du cache.
  const [directe, enCache] = await Promise.all([instantaneDirect(db, u), servie()]);
  assert.equal(relectures, 1, 'lecture directe seulement');
  assert.equal(process.env.CURSUS_CACHE_INSTANTANE, undefined, 'variable d’environnement jamais posée');
  assert.equal(cacheActif(), true);
  assert.equal(ecart(directe, enCache), null);
  // L'entrée du cache n'a été ni remplacée ni vidée : la lecture suivante n'en relit rien, et une action la reprend.
  await servie();
  assert.equal(relectures, 1);
  assert.deepEqual(await comparerJeuAction(db, LECTEUR_ENTREE, true), { ecart: null, directe: false });
});

test('porte des écritures : fermée après les écritures en cours, les suivantes attendent l’ouverture', async () => {
  const porte = new Porte();
  const journal: string[] = [];
  let finir!: () => void;
  const enCours = porte.passer(async () => { journal.push('début 1'); await new Promise<void>(ok => { finir = ok; }); journal.push('fin 1'); });
  await new Promise(ok => setImmediate(ok));
  const fermee = porte.fermer().then(() => journal.push('fermée'));
  const suivante = porte.passer(async () => { journal.push('écriture 2'); });
  await new Promise(ok => setImmediate(ok));
  assert.deepEqual(journal, ['début 1'], 'la fermeture attend l’écriture en cours');
  finir();
  await Promise.all([enCours, fermee]);
  await new Promise(ok => setImmediate(ok));
  assert.deepEqual(journal, ['début 1', 'fin 1', 'fermée'], 'l’écriture suivante attend l’ouverture');
  porte.ouvrir();
  await suivante;
  assert.deepEqual(journal.at(-1), 'écriture 2');
  assert.equal(porte.passees, 2);
  // Porte fermée sans écriture en cours : aussitôt.
  await porte.fermer();
  porte.ouvrir();
});

test('essai de charge : invariant entier « aucune divergence », jamais assoupli par la marge', () => {
  const route = statistiques([1], { e4xx: 0, e5xx: 0, e503: 0, delais: 0 });
  const sonde = { sante: route, attenteVerrouMax: 0, attentesMax: 0, tenueVerrouMax: 0, attentePoolMax: 0, poolAttenteMax: 0, lecturesAttenteMax: 0, ecrituresAttenteMax: 0, attenteFileMax: 0, rssMax: 0, tasMax: 0 };
  const verdict = (exactitude?: { comparaisons: number; divergences: number; echecs?: number }) => juger({}, sonde, { marge: 3, exactitude }).find(v => v.critere === 'aucune divergence avec la relecture complète');
  assert.equal(verdict(), undefined, 'essai sans --verifier-exactitude : non jugé');
  assert.deepEqual(verdict({ comparaisons: 356, divergences: 0, echecs: 0 }), { critere: 'aucune divergence avec la relecture complète', mesure: '0 sur 356 comparaisons', seuil: '0 (au moins une comparaison, aucune interrompue)', ok: true, invariant: true });
  assert.equal(verdict({ comparaisons: 356, divergences: 1 })!.ok, false);
  // Comparaison d'état levée (délai dépassé…) alors qu'une autre a abouti : un état n'a pas été vérifié, l'invariant échoue.
  assert.deepEqual(verdict({ comparaisons: 356, divergences: 0, echecs: 1 }), { critere: 'aucune divergence avec la relecture complète', mesure: '0 sur 356 comparaisons, 1 comparaison d’état interrompue', seuil: '0 (au moins une comparaison, aucune interrompue)', ok: false, invariant: true });
  assert.equal(verdict({ comparaisons: 0, divergences: 0 })!.ok, false, 'aucune comparaison faite : rien n’est prouvé');
});

test('lecteurs : chaque compte dans chacun de ses espaces, puis chaque profil RH', async () => {
  const db = await demo();
  const lecteurs = await lecteursDe(db);
  const cles = lecteurs.map(cleLecteur);
  for (const p of Object.keys(PROFILS_RH)) assert.ok(cles.includes(`rh|${p}`), `profil ${p}`);
  assert.ok(lecteurs.some(u => u.role === 'manager') && lecteurs.some(u => u.role === 'collaborateur'));
  // Un manager est aussi collaborateur : deux espaces, deux lecteurs.
  const manager = lecteurs.find(u => u.role === 'manager')!;
  assert.ok(lecteurs.some(u => u.role === 'collaborateur' && u.empId === manager.empId));
  assert.deepEqual(await lecteursDe(db, (_c, espace) => espace === 'manager').then(l => l.filter(u => u.role !== 'rh').every(u => u.role === 'manager')), true);
});

test('l’oracle voit une divergence : cache resté sur un état que la base n’a plus', async () => {
  const db = await demo();
  const lecteurs = (await lecteursDe(db)).filter(u => u.role === 'rh' || u.empId === 2);
  // État de référence : aucune divergence.
  const avant = await verifierExactitude(db, lecteurs);
  assert.deepEqual(avant.divergences, []);
  assert.equal(avant.triviales, 0, 'entrée lue par les vues : chaque jeu d’action vient de la lecture partagée');
  assert.ok(avant.comparaisons >= lecteurs.length * 2 + 1);
  // Écriture qui contourne la révision (révision ramenée à sa valeur) : le cache sert l'ancien état, l'oracle le voit.
  const n = await db.revisionBase();
  await db.run('UPDATE employes SET nom = ? WHERE id = ?', ['Mehdi Hors-Révision', 2]);
  await db.run('UPDATE revision SET n = ?', [n]);
  const b = await verifierExactitude(db, lecteurs);
  assert.ok(b.divergences.some(d => d.objet === 'vue' && d.cle === 'collaborateur|2' && /Mehdi Hors-Révision/.test(d.ecart)), JSON.stringify(b.divergences.slice(0, 3)));
  assert.ok(b.divergences.some(d => d.objet === 'entrée' && d.cle === cleLecteur(LECTEUR_ENTREE)));
  assert.ok(b.divergences.some(d => d.objet === 'action'));
  // La révision avance de nouveau : plus d'écart.
  await db.run('UPDATE revision SET n = ?', [n + 1]);
  assert.deepEqual((await verifierExactitude(db, lecteurs)).divergences, []);
  // Cache coupé : l'entrée n'est pas exigée, tout est lu directement ; les jeux d'action sont alors triviaux, à part.
  process.env.CURSUS_CACHE_INSTANTANE = '0';
  try {
    const coupe = await verifierExactitude(db, lecteurs.slice(0, 2));
    assert.deepEqual(coupe.divergences, []);
    assert.equal(coupe.triviales, 3, 'entrée et deux jeux d’action lus directement');
  } finally {
    delete process.env.CURSUS_CACHE_INSTANTANE;
  }
  // Comparaison pendant laquelle la révision change sans cesse : refaite, puis « état instable ».
  let k = 0;
  const instable = await verifierExactitude(db, [lecteurs[0]], { jeux: false, essais: 2, apres: async () => { await db.setSetting('essai', ++k); } });
  assert.equal(instable.refaites, 4, 'vue puis entrée, deux essais chacune');
  assert.deepEqual(instable.divergences.map(d => [d.objet, /^état instable : révision \d+ → \d+/.test(d.ecart)]), [['vue', true], ['entrée', true]]);
  assert.ok((await db.lecture(async () => await buildSnapshot(db, lecteurs[0]))).employes.length);
});

test('suite d’écritures reproductible : même graine, mêmes tirages et mêmes issues', async () => {
  const [a, b] = await Promise.all([demo(), demo()]);
  const [x, y] = await Promise.all([rejouer(a, { graine: 5, pas: 25, verifier: false }), rejouer(b, { graine: 5, pas: 25, verifier: false })]);
  assert.deepEqual([x.actions, x.sql, x.motifs, x.ecritures], [y.actions, y.sql, y.motifs, y.ecritures]);
  assert.ok(x.ecritures > 0);
  assert.deepEqual(x.erreurs, []);
});

for (const graine of GRAINES) {
  test(`démonstration, graine ${graine} : ${PAS} pas, lecture partagée identique à la relecture complète après chaque pas`, async () => {
    const db = await demo();
    // Jeux d'action de tous les lecteurs tous les 5 pas (celui de l'acteur avant chaque action, toujours) ; tout au dernier pas.
    const x = await rejouer(db, { graine, pas: PAS, verifierTous: 1, jeux: COMPLET ? 1 : 5, sql: 0.25 });
    const resume = resumeRapport(x);
    assert.deepEqual(x.divergences, [], resume);
    assert.deepEqual(x.erreurs, [], resume);
    // La suite a vraiment écrit, par des actions et par du SQL direct, et a tout comparé à chaque pas. Elle a exercé la
    // saisie, chemin que le cache incrémental doit tenir exact (relecture de l'étape 1 : sans acteur ni ligne adaptés,
    // presque toutes les saisies étaient refusées) : au moins une saisie de cellule, une soumission ou une décision sur
    // une feuille, et une action d'absence validées. Graine choisie qui n'y suffit pas en ${PAS} pas : allonger
    // CURSUS_ORACLE_PAS.
    assert.ok(x.ecritures >= PAS / 10, resume);
    const validees = (garder: (nom: string) => boolean) => Object.entries(x.actions).filter(([n]) => garder(n)).reduce((n, [, s]) => n + s.ok, 0);
    assert.ok(validees(n => n === 'temps.setCell') >= 1, resume);
    assert.ok(validees(n => ['temps.submit', 'temps.validate', 'temps.reject', 'temps.validerLot'].includes(n)) >= 1, resume);
    assert.ok(validees(n => n.startsWith('absence.')) >= 1, resume);
    assert.ok(validees(() => true) >= PAS / 5, resume);
    assert.ok(Object.keys(x.sql).length >= 3, resume);
    assert.equal(x.verifications, PAS, resume);
    // Vérification après chaque pas : l'entrée de la révision courante est là quand l'action suivante la lit ; seule une
    // action du premier pas, avant toute lecture, peut la trouver absente (comparaison triviale, comptée à part).
    assert.ok(x.triviales <= 1, resume);
  });
}

test('jeu de charge d’un an : suite d’écritures, lecture partagée identique à la relecture complète', async () => {
  const { db, jeu } = await baseUnAn(nouvelleBase);
  assert.ok(jeu.employes.length >= 120 && (await db.count('feuilles')) > 5000, `${jeu.employes.length} fiches`);
  // Chaque pas : deux profils RH et deux autres lecteurs tirés au hasard ; au dernier : les cinq profils RH, 4 managers
  // et 4 collaborateurs, vues et jeux d'action (une vue RH coûte 0,4 à 0,7 s sur ce jeu). CURSUS_ORACLE_COMPLET=1 : tous
  // les lecteurs à chaque pas.
  type Lecteurs = Awaited<ReturnType<typeof lecteursDe>>;
  const echantillon = (tous: Lecteurs, r: { choix: <T>(l: readonly T[]) => T }) => {
    const rh = tous.filter(u => u.role === 'rh'), autres = tous.filter(u => u.role !== 'rh');
    return [r.choix(rh), r.choix(rh), r.choix(autres), r.choix(autres)];
  };
  const x = await rejouer(db, {
    graine: GRAINES[0], pas: COMPLET ? 60 : 4, verifierTous: 1, sql: 0.3, jeux: COMPLET ? 5 : 0, lecteurs: COMPLET ? undefined : echantillon,
    lecteursFinaux: COMPLET ? undefined : tous => [
      ...tous.filter(u => u.role === 'rh').slice(-5), ...tous.filter(u => u.role === 'manager').slice(0, 4), ...tous.filter(u => u.role === 'collaborateur').slice(0, 4),
    ],
  });
  const resume = resumeRapport(x);
  assert.deepEqual(x.divergences, [], resume);
  assert.deepEqual(x.erreurs, [], resume);
  assert.ok(x.ecritures >= 1, resume);
});
