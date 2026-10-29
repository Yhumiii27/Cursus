// Validation groupée sur un `Domain` partagé entre les feuilles d'une tranche (lot 10, chantier B) : mémos par salarié
// (`Domain.memoSalarie`), repris par `avecFeuillesDe` pour les salariés dont aucune feuille n'a changé, oubliés pour celui
// de la feuille validée ; relevés des agences cherchés en fin de tranche. Référence : la méthode d'avant, un `Domain` neuf
// après chaque feuille (CURSUS_VALIDATION_DOMAIN_PARTAGE=0), et chaque feuille validée seule (`temps.validate`) sur une
// lecture complète de la base. Même état de la base, même message attendus ; puis le banc d'oracle (même graine, les deux
// méthodes, lots groupés par salarié : mêmes tirages, mêmes issues, même base ; les deux modes y sont comparés entre eux,
// la comparaison avec chaque feuille validée seule est celle du lot de 52 feuilles). Enfin les tâches du quart d'heure,
// dont la lecture reprend le cache de l'instantané dans leur transaction (`lecturePartagee(db, { enTransaction: true })`) :
// mêmes relevés qu'en relisant tout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET ??= randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;
delete process.env.CURSUS_VALIDATION_DOMAIN_PARTAGE;
delete process.env.CURSUS_CACHE_INSTANTANE;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { tachesEmails } = await import('../server/src/notifications.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { domainePartageActif, validerEnTranches } = await import('../server/src/actions/suivi-feuilles.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { calcSheet } = await import('../shared/rules/temps.ts');
const { horairesAFiger } = await import('../shared/rules/horaires.ts');
const { addD } = await import('../shared/dates.ts');
const { baseUnAn, rejouer } = await import('./support/oracle.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Sortie = { message?: string | null; result?: unknown };

/**
 * Production (35 h, horaire du matin) : contingent franchi en cours de lot ; dimanche de nuit la semaine du 14 septembre,
 * repos quotidien du lundi suivant (motif donné) lu sur la feuille de la veille, validée dans la même tranche.
 */
const SALARIE = 8;
/** Deux intérimaires de Proman Lyon (le second le devient ici) : le relevé d'une semaine part quand les deux sont validées. */
const INTERIM_A = 15, INTERIM_B = 4;
/** Logistique (35 h) : une feuille porte des heures sur une absence validée, refusée au milieu de ses autres semaines. */
const AUTRE = 10;
/** Production, temps partiel : heures complémentaires. */
const PARTIEL = 13;
const EMPS = [SALARIE, INTERIM_A, INTERIM_B, AUTRE, PARTIEL];
const SEMAINES = Array.from({ length: 31 }, (_, i) => addD('2026-03-02', 7 * i)); // du 2 mars au 28 septembre
const INTERIM = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
const AUTRES = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
const PARTIELS = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
/** Semaine d'AUTRE dont le mercredi est une absence validée, où des heures sont saisies : refusée. */
const REFUSEE = '2026-08-17';

/**
 * Lot demandé (52 feuilles, trois tranches) : semaines du salarié hors de l'ordre chronologique (contrepartie en repos
 * portée par la feuille validée), feuilles des autres mêlées, intérimaires A et B d'une même semaine dans deux tranches.
 */
function lot() {
  const salarie = [...SEMAINES.slice(15).reverse(), ...SEMAINES.slice(0, 15)].map(week => ({ empId: SALARIE, week }));
  const autres = [
    ...INTERIM.map(week => ({ empId: INTERIM_A, week })), ...AUTRES.map(week => ({ empId: AUTRE, week })),
    ...PARTIELS.map(week => ({ empId: PARTIEL, week })), ...INTERIM.map(week => ({ empId: INTERIM_B, week })),
  ];
  const out: { empId: number; week: string }[] = [];
  // Une feuille d'un autre salarié toutes les deux du salarié, puis le reste.
  while (salarie.length || autres.length) {
    out.push(...salarie.splice(0, 2));
    if (autres.length) out.push(autres.shift()!);
  }
  return out;
}

async function base() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const m = await db.getSetting<{ agences: { nom: string; adresse: string; depuis?: string }[] }>('messagerie', { agences: [] });
  await db.setSetting('messagerie', { ...m, agences: m.agences.map(a => ({ ...a, depuis: '2026-08-01' })) });
  await db.run('UPDATE employes SET type_contrat = ?, agence = ? WHERE id = ?', ['interim', 'Proman Lyon', INTERIM_B]);
  await db.run(`DELETE FROM feuilles WHERE emp_id IN (${EMPS.map(() => '?').join(', ')}) AND week >= ?`, [...EMPS, '2026-01-01']);
  await db.run(`DELETE FROM absences WHERE emp_id IN (${EMPS.map(() => '?').join(', ')}) AND au >= ?`, [...EMPS, '2026-01-01']);
  const compte = (await db.one('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin'])) as { id: number };
  const rh = (await currentUser(db, { compteId: compte.id, role: 'rh', methode: 'demo' }))!;
  const ds = await loadFull(db, rh);
  /** Feuille soumise, ses horaires figés comme à la soumission (`temps.submit`). */
  const inserer = async (empId: number, week: string, h: number[], plus: { horaires?: (string | null)[]; motifDepassement?: string } = {}) => {
    const lignes = [{ projet: 'INT-LOG', tache: 'Logistique interne', ks: false, h }, { projet: 'K-2620', tache: 'Repérage site Feyzin', ks: true, h: [0, 0, 1, 0, 0, 0, 0] }];
    const perDay = h.map((v, i) => v + (i === 2 ? 1 : 0));
    const figes = horairesAFiger(ds.referentiels, ds.employes.find(e => e.id === empId)!.equipe, { statut: 'brouillon', horaires: plus.horaires ?? null, horairesFiges: null }, perDay);
    await db.insert('feuilles', { empId, week, statut: 'soumise', comment: null, sage: false, keystone: false, contrat: null, lignes, ...plus, ...figes });
  };
  for (const w of SEMAINES) {
    if (w === '2026-09-14') await inserer(SALARIE, w, [9, 9, 9, 8, 0, 0, 8], { horaires: [null, null, null, null, null, null, 'N'] });
    else if (w === '2026-09-21') await inserer(SALARIE, w, [9, 9, 9, 8, 8, 0, 0], { motifDepassement: 'Relève exceptionnelle de l’équipe de nuit' });
    else await inserer(SALARIE, w, [9, 9, 9, 8, 8, 0, 0]);
  }
  for (const w of INTERIM) { await inserer(INTERIM_A, w, [7, 7, 7, 7, 6, 0, 0]); await inserer(INTERIM_B, w, [8, 7, 7, 7, 7, 0, 0]); }
  for (const w of AUTRES) await inserer(AUTRE, w, [8, 8, 8, 8, 6, 0, 0]);
  await db.insert('absences', { empId: AUTRE, type: 'CP', du: addD(REFUSEE, 2), au: addD(REFUSEE, 2), statut: 'validee', jours: 1, commentaire: null, creation: '2026-08-01T08:00:00.000Z' });
  for (const w of PARTIELS) await inserer(PARTIEL, w, [7, 7, 7, 7, 5, 0, 0], { motifDepassement: 'Inventaire' });
  /** Une passe de l'action dans sa transaction, journal compris, comme POST /api/actions (server/src/app.ts). */
  const passe = (u: User, name: string) => async (p: Record<string, any>): Promise<Sortie> => await db.tx(async () => {
    const trace = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, trace, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o;
  });
  return { db, rh, passe };
}

/** État comparé : feuilles des salariés (tout ce qui est figé à la validation), relevés, messages en file. */
async function etat(db: Db) {
  const feuilles = await db.query(`SELECT emp_id AS "empId", week, statut, keystone, contrat, heures_sup AS "heuresSup", maj_dimanche AS "majDimanche",
    maj_ferie AS "majFerie", maj_nuit AS "majNuit", cor, horaires, horaires_figes AS "horairesFiges", motif_depassement AS "motif"
    FROM feuilles WHERE emp_id IN (${EMPS.map(() => '?').join(', ')}) AND week >= ? ORDER BY emp_id, week`, [...EMPS, '2026-01-01']);
  const releves = await db.query('SELECT agence, semaine, interimaires, heures, en_attente AS "enAttente" FROM releves ORDER BY semaine, agence, id');
  const envois = (await db.query<{ cible: string; type: string; contenu: unknown }>('SELECT cible, type, contenu FROM envois'))
    .map(e => JSON.stringify([e.cible, e.type, typeof e.contenu === 'string' ? JSON.parse(e.contenu) : e.contenu])).sort();
  return JSON.parse(JSON.stringify({ feuilles, releves, envois }));
}

/** Validation groupée par tranches, la variable de repli posée (`repli`) ou non. */
async function valider(repli: boolean) {
  const b = await base();
  if (repli) process.env.CURSUS_VALIDATION_DOMAIN_PARTAGE = '0';
  try {
    assert.equal(domainePartageActif(), !repli);
    const r = await validerEnTranches({ feuilles: lot() }, b.passe(b.rh, 'temps.validerLot'));
    const journal = (await b.db.all<{ action: string; message: string; payload: unknown }>('journal')).filter(l => l.action === 'temps.validerLot').map(l => [l.message, l.payload]);
    return { r, etat: await etat(b.db), journal };
  } finally {
    delete process.env.CURSUS_VALIDATION_DOMAIN_PARTAGE;
  }
}

test('Domain : mémos par salarié tenus sur demande, repris pour les autres salariés, oubliés pour ceux dont les feuilles changent', () => {
  const ds = { today: '2026-10-10', calendrierFeries: {} } as never;
  const k1 = {}, k2 = {}, T = Symbol('essai');
  let n = 0;
  const calcul = () => ++n;
  // Sans mémo : chaque appel calcule.
  const simple = new Domain(ds);
  assert.equal(simple.memoParSalarie, false);
  assert.deepEqual([simple.memoSalarie(1, T, k1, k1, calcul), simple.memoSalarie(1, T, k1, k1, calcul)], [1, 2]);
  assert.equal(simple.avecFeuillesDe(ds, [1]).memoParSalarie, false);
  n = 0;
  const d = new Domain(ds, { memoParSalarie: true });
  assert.equal(d.memoSalarie(1, T, k1, k1, calcul), 1);
  assert.equal(d.memoSalarie(1, T, k1, k1, calcul), 1, 'même salarié, mêmes clés : mémorisé');
  assert.equal(d.memoSalarie(1, T, k1, k2, calcul), 2, 'seconde clé distincte');
  assert.equal(d.memoSalarie(2, T, k1, k1, calcul), 3, 'autre salarié');
  const suite = d.avecFeuillesDe(ds, [1]);
  assert.notEqual(suite, d);
  assert.equal(suite.memoParSalarie, true);
  assert.equal(suite.memoSalarie(2, T, k1, k1, calcul), 3, 'salarié 2 : mémo repris');
  assert.equal(suite.memoSalarie(1, T, k1, k1, calcul), 4, 'salarié 1 : recalculé');
  assert.equal(d.memoSalarie(1, T, k1, k1, calcul), 1, 'l’instantané d’avant garde ses propres mémos');
});

test('calcSheet : même décompte avec ou sans mémos, et après une feuille remplacée (feuille de la veille comprise)', async () => {
  const { db, rh } = await base();
  const ds = await loadFull(db, rh);
  const decomptes = (d: InstanceType<typeof Domain>) => d.ds.feuilles.map(sh => calcSheet(d, d.emp(sh.empId)!, sh));
  const avec = new Domain(ds, { memoParSalarie: true });
  assert.deepEqual(decomptes(avec), decomptes(new Domain(ds)));
  assert.equal(calcSheet(avec, avec.emp(SALARIE)!, ds.feuilles.find(f => f.empId === SALARIE)!), calcSheet(avec, avec.emp(SALARIE)!, ds.feuilles.find(f => f.empId === SALARIE)!), 'résultat mémorisé');
  // Dimanche de nuit retiré de la feuille du 14 septembre : la feuille du 21 (repos quotidien du lundi) change de décompte.
  const i = ds.feuilles.findIndex(f => f.empId === SALARIE && f.week === '2026-09-14');
  const suivante = ds.feuilles.find(f => f.empId === SALARIE && f.week === '2026-09-21')!;
  const avant = calcSheet(avec, avec.emp(SALARIE)!, suivante).reposQuotidien;
  assert.ok(avant.length, 'repos quotidien insuffisant après le dimanche de nuit');
  const ds2 = { ...ds, feuilles: ds.feuilles.with(i, { ...ds.feuilles[i], horaires: null, lignes: ds.feuilles[i].lignes.map(l => ({ ...l, h: [...l.h.slice(0, 6), 0] })) }) };
  const suite = avec.avecFeuillesDe(ds2, [SALARIE]);
  assert.deepEqual(decomptes(suite), decomptes(new Domain(ds2)));
  assert.deepEqual(calcSheet(suite, suite.emp(SALARIE)!, suivante).reposQuotidien, []);
  // Mémos des autres salariés repris tels quels : même objet que dans l'instantané d'avant.
  const autre = ds.feuilles.find(f => f.empId === AUTRE)!;
  assert.equal(calcSheet(suite, suite.emp(AUTRE)!, autre), calcSheet(avec, avec.emp(AUTRE)!, autre));
});

test('validerLot : Domain partagé, Domain neuf par feuille et validation une à une donnent la même base et le même message', async () => {
  // Référence : chaque feuille validée seule, sur une lecture complète de la base relue pour elle.
  const ref = await base();
  const refus: string[] = [];
  for (const f of lot()) {
    try { await ref.passe(ref.rh, 'temps.validate')(f); } catch (err) { if (!(err instanceof ActionError)) throw err; refus.push(`${f.empId} ${f.week}`); }
  }
  assert.deepEqual(refus, [`${AUTRE} ${REFUSEE}`], 'seule la feuille aux heures sur une absence est refusée');
  const attendu = await etat(ref.db);
  const partage = await valider(false), repli = await valider(true);
  assert.deepEqual(partage.etat, attendu);
  assert.deepEqual(repli.etat, attendu);
  assert.deepEqual(partage.r, repli.r, 'même message et même résultat');
  assert.deepEqual(partage.journal, repli.journal, 'mêmes lignes de journal');
  assert.equal(partage.journal.length, 3, 'trois tranches');
  // Ce que la comparaison couvre : contingent franchi en cours de lot, relevés complets d'une agence à deux intérimaires,
  // feuille de la veille validée dans la tranche (dimanche de nuit), refus au milieu des semaines d'un salarié.
  const f = attendu.feuilles as { empId: number; week: string; statut: string; cor: unknown; motif: string | null }[];
  assert.ok(f.filter(x => x.empId === SALARIE && x.cor && JSON.stringify(x.cor) !== '{}').length >= 2);
  assert.ok(f.filter(x => x.statut === 'validee').length === lot().length - 1);
  assert.equal(f.find(x => x.empId === AUTRE && x.week === REFUSEE)!.statut, 'soumise');
  const releves = (attendu.releves as { agence: string; semaine: string; interimaires: number; enAttente: number }[]).filter(r => r.agence === 'Proman Lyon');
  assert.ok(releves.length >= 2 && releves.every(r => r.interimaires === 2 && r.enAttente === 0), JSON.stringify(releves));
  assert.equal(new Set(releves.map(r => r.semaine)).size, releves.length, 'un relevé par semaine');
  assert.match(String(partage.r.message), new RegExp(`^${lot().length - 1} feuilles validées · 1 feuille non validée`));
  assert.match(String(partage.r.message), /Repos quotidien|repos quotidien|contingent|Contingent/);
});

test('banc d’oracle : même graine, Domain partagé ou neuf par feuille, mêmes issues et même base', async () => {
  const jouer = async (repli: boolean) => {
    const { db } = await baseUnAn(nouvelleBase);
    const soumises = async () => Number((await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM feuilles WHERE statut = 'soumise'"))!.n);
    const avant = await soumises();
    if (repli) process.env.CURSUS_VALIDATION_DOMAIN_PARTAGE = '0';
    try {
      // Lots groupés par salarié (`lotsGroupes`) : toutes les feuilles soumises de trois à huit salariés, semaines
      // consécutives comprises (environ quatre par salarié sur le jeu d'un an), sur une ou deux tranches.
      const x = await rejouer(db, { graine: 20261029, pas: 40, verifier: false, sql: 0.1, renfort: Array<string>(40).fill('temps.validerLot'), lotsGroupes: true });
      const feuilles = await db.query('SELECT id, emp_id, week, statut, keystone, contrat, heures_sup, maj_dimanche, maj_ferie, maj_nuit, cor, horaires, horaires_figes, motif_depassement, motif_forfait, lignes FROM feuilles ORDER BY id');
      const releves = await db.query('SELECT agence, semaine, interimaires, heures, en_attente FROM releves ORDER BY id');
      return { rapport: [x.actions, x.sql, x.motifs, x.ecritures, x.erreurs], base: JSON.parse(JSON.stringify({ feuilles, releves })), validees: avant - await soumises() };
    } finally {
      delete process.env.CURSUS_VALIDATION_DOMAIN_PARTAGE;
    }
  };
  const partage = await jouer(false), repli = await jouer(true);
  const lots = (partage.rapport[0] as Record<string, { ok: number }>)['temps.validerLot'];
  assert.ok(lots && lots.ok >= 5, `validations groupées faites : ${JSON.stringify(lots)}`);
  // Des lots de plusieurs salariés et semaines, pas quelques feuilles éparses : la reprise et l'oubli des mémos comptent.
  assert.ok(partage.validees >= 10 * lots.ok, `feuilles validées : ${partage.validees} en ${lots.ok} validations groupées`);
  assert.equal(partage.validees, repli.validees);
  assert.deepEqual(partage.rapport, repli.rapport);
  assert.deepEqual(partage.base, repli.base);
});

test('tâches du quart d’heure : lecture reprise du cache de l’instantané dans la transaction, mêmes relevés que la lecture complète', async () => {
  const passage = async (cache: boolean) => {
    const { db, rh } = await base();
    if (!cache) process.env.CURSUS_CACHE_INSTANTANE = '0';
    try {
      // Entrée du cache lue (comme au démarrage), puis feuilles des intérimaires validées par un outil : leurs relevés sont dus.
      await db.lecture(async () => await buildSnapshot(db, rh));
      await db.run('UPDATE feuilles SET statut = ? WHERE emp_id IN (?, ?)', ['validee', INTERIM_A, INTERIM_B]);
      let relectures = 0;
      const query = db.query.bind(db);
      db.query = (async (sql: string, params?: readonly never[]) => {
        if (/^\s*SELECT \* FROM feuilles\s+ORDER BY/i.test(sql)) relectures++;
        return await query(sql, params);
      }) as typeof db.query;
      const r = await tachesEmails(db, 6);
      db.query = query;
      return { r, relectures, etat: await etat(db) };
    } finally {
      delete process.env.CURSUS_CACHE_INSTANTANE;
    }
  };
  const avec = await passage(true), sans = await passage(false);
  assert.ok(avec.r.releves >= 2, `relevés envoyés : ${avec.r.releves}`);
  assert.deepEqual(avec.r, sans.r);
  assert.deepEqual(avec.etat, sans.etat);
  assert.equal(sans.relectures, 1, 'sans cache : une lecture complète, sous le verrou');
  assert.equal(avec.relectures, 0, 'avec le cache : entrée dérivée par le delta, aucune relecture de toute la base');
});
