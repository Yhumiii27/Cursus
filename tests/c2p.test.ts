// Lot 7, chantier B, étape 1 : compte professionnel de prévention (t052, shared/rules/c2p.ts). Nuits comptées d'après les
// horaires figés des feuilles validées (au moins 1 h entre 0 h et 5 h), à part celles des équipes successives alternantes,
// seuils réglementaires de 120 et 50 nuits non réglables (art. D4163-2) au prorata de la période du contrat, contrat de
// moins d'un mois non déclaré, intérimaire déclaré par l'agence ; facteurs du poste cochés par le service RH ou le référent
// HSE ; synthèse transmise au service RH, au référent HSE et à la lecture seule, jamais au manager, au collaborateur ni à la
// paie ; export « à saisir dans la DSN » ; actions tracées ; migration nommée et colonne JSON lue telle qu'écrite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, PG, SQLITE_SEUL } = await import('./base.ts');
const { SqliteDb } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { C2P_COLONNES } = await import('../server/src/migrations/lot7-prevention.ts');
const { FACTEURS_C2P } = await import('../shared/constants.ts');
const { REGLAGES } = await import('../shared/reglages.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const {
  alternantTexte, anneesC2p, C2P_PLAGE, C2P_SEUIL_ALTERNANT, C2P_SEUIL_NUIT, contratMoinsDUnMois, controlerFacteursPoste, exportC2p, FACTEURS, FACTEURS_POSTE,
  facteursDuPoste, heuresC2p, heuresC2pHoraire, horairesAQualifier, ligneC2p, MENTION_C2P, nuitsC2pDeLaFeuille, qualificationAlternant, syntheseC2p,
} = await import('../shared/rules/c2p.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Feuille = Dataset['feuilles'][number];
type Employe = Dataset['employes'][number];
type Db = Awaited<ReturnType<typeof nouvelleBase>>;

const N = { code: 'N', debut: '21:00', fin: '05:00', pause: 30 };
const M = { code: 'M', debut: '05:00', fin: '13:00', pause: 30 };
/** Feuille de `empId` pour la semaine du lundi `week` : `jours` premiers jours sous l'horaire `h`, 7,5 h chacun. */
const feuille = (empId: number, week: string, o: { h?: typeof N; jours?: number; statut?: string; heures?: number; sansHoraire?: boolean } = {}) => {
  const jours = o.jours ?? 5, h = o.h ?? N, heures = o.heures ?? 7.5;
  return {
    empId, week, statut: o.statut ?? 'validee', comment: null, sage: false, keystone: false,
    lignes: [{ projet: 'INT-PROD', tache: 'Production', ks: false, h: Array.from({ length: 7 }, (_, i) => (i < jours ? heures : 0)) }],
    horairesFiges: o.sansHoraire ? null : Array.from({ length: 7 }, (_, i) => (i < jours ? h : null)),
  };
};
/** Lundis successifs à partir de `lundi`. */
const lundis = (lundi: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${lundi}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * i);
  return d.toISOString().slice(0, 10);
});

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, statut = 400) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === statut && motif.test(e.message), `${name} : ${motif}`);
  const derniere = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[]; message: string }>('journal')).findLast(j => j.action === action);
  return { db, user, run, refuse, derniere, RH: await user(null, 'rh') };
}
const poste = async (db: Db, nom: string) => ((await db.one('SELECT id FROM postes WHERE nom = ?', [nom])) as { id: number }).id;

// — Règles pures —

test('règles fixes : plage 0 h – 5 h, 120 et 50 nuits, jamais un réglage de Paramètres ; six facteurs, quatre sur le poste', () => {
  assert.deepEqual({ ...C2P_PLAGE }, { nuitDebut: 0, nuitFin: 5 });
  assert.equal(C2P_SEUIL_NUIT, 120);
  assert.equal(C2P_SEUIL_ALTERNANT, 50);
  assert.ok(Object.keys(REGLAGES).length > 0 && !Object.keys(REGLAGES).some(k => /c2p|alternant/i.test(k)), 'aucun réglage du C2P : seuils réglementaires (art. D4163-2)');
  assert.deepEqual([...FACTEURS], ['nuit', 'alternant', 'repetitif', 'hyperbare', 'temperatures', 'bruit']);
  assert.deepEqual([...FACTEURS_POSTE], ['repetitif', 'hyperbare', 'temperatures', 'bruit']);
  assert.equal(new Set(FACTEURS.map(f => FACTEURS_C2P[f].code)).size, 6, 'codes internes distincts');
});

test('nuit : la pause est placée hors de la plage 0 h – 5 h tant qu’elle y tient (poste de soirée qui finit à 1 h)', () => {
  // 20 h – 1 h, 30 min de pause : 1 h de travail dans la plage (0,9 avec la pause au prorata des heures de nuit payées).
  const S = { code: 'S', nom: 'Soirée', debut: '20:00', fin: '01:00', pause: 30 };
  assert.equal(heuresC2pHoraire(S), 1);
  assert.equal(heuresC2pHoraire({ ...S, debut: '19:30' }), 1);
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { jours: 1, heures: 4.5, h: S }) as unknown as Feuille, [S]).map(n => [n.code, n.heures]), [['S', 1]]);
  assert.deepEqual(horairesAQualifier({ horaires: [S] }), ['S'], 'horaire de nuit au sens du C2P, à qualifier');
  // Pause plus longue que le temps hors de la plage : seule la part qui n'y tient pas en est retirée.
  assert.equal(heuresC2p({ debut: 23 * 60, fin: 26 * 60, pause: 90 }), 1.5);
  assert.equal(heuresC2p({ debut: 0, fin: 300, pause: 0 }), 5);
  assert.equal(heuresC2p(null), 0);
});

test('nuit : au moins 1 h de travail entre 0 h et 5 h, d’après l’horaire figé d’une feuille validée', () => {
  const horaires = [{ ...N, nom: 'Nuit', alternant: true }, { ...M, nom: 'Matin' }];
  const sh = feuille(8, '2026-03-02', { jours: 3 }) as unknown as Feuille;
  assert.deepEqual(nuitsC2pDeLaFeuille(sh, horaires).map(n => [n.jour, n.code, n.alternant]),
    [['2026-03-02', 'N', true], ['2026-03-03', 'N', true], ['2026-03-04', 'N', true]], 'rattachée au jour où commence le poste');
  // 21 h – 5 h, 7,5 h de travail, 30 min de pause : 5 h dans la plage, la pause tient dans les 3 h hors de la plage.
  assert.equal(nuitsC2pDeLaFeuille(sh, horaires)[0].heures, 5);
  assert.equal(heuresC2pHoraire(N), 5);
  assert.equal(heuresC2pHoraire(M), 0, 'équipe du matin à partir de 5 h : aucune nuit');
  // Poste écourté : 3 h de travail et 30 min de pause à partir de 21 h finissent à 0 h 30, moins d'une heure dans la plage.
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { jours: 1, heures: 3 }) as unknown as Feuille, horaires), []);
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { jours: 1, heures: 3.5 }) as unknown as Feuille, horaires).map(n => n.heures), [1], 'fin à 1 h : 1 h pile');
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { jours: 1, heures: 4.5 }) as unknown as Feuille, horaires).map(n => n.heures), [2]);
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { h: M }) as unknown as Feuille, horaires), []);
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { statut: 'soumise' }) as unknown as Feuille, horaires), [], 'feuille non validée');
  assert.deepEqual(nuitsC2pDeLaFeuille(feuille(8, '2026-03-02', { sansHoraire: true }) as unknown as Feuille, horaires), [], 'feuille sans horaire');
  // Code inconnu du référentiel : à qualifier.
  assert.equal(nuitsC2pDeLaFeuille(sh, [])[0].alternant, null);
});

test('qualification et facteurs reçus : codes connus seulement', () => {
  assert.deepEqual(controlerFacteursPoste(['bruit', 'repetitif', 'bruit']), { facteurs: ['repetitif', 'bruit'], erreur: null });
  assert.deepEqual(controlerFacteursPoste([]), { facteurs: [], erreur: null });
  assert.match(controlerFacteursPoste(['nuit']).erreur!, /inconnu : nuit/, 'nuit et équipes alternantes se comptent, ne se cochent pas');
  assert.match(controlerFacteursPoste('bruit').erreur!, /liste/);
  assert.deepEqual(facteursDuPoste({ c2p: ['bruit', 'inconnu' as never, 'hyperbare'] }), ['hyperbare', 'bruit']);
  assert.deepEqual(facteursDuPoste(null), []);
  assert.deepEqual([true, 'true', false, 'false', null, '', 'oui', undefined].map(qualificationAlternant), [true, true, false, false, null, null, undefined, undefined]);
  assert.deepEqual([true, false, null].map(alternantTexte), ['Équipes successives alternantes', 'Non alternant', 'À qualifier']);
  assert.deepEqual(anneesC2p('2027-01-15'), [2027, 2026]);
});

test('contrat : prorata de la période dans l’année, moins d’un mois non déclaré, intérimaire déclaré par l’agence', () => {
  const ds = { referentiels: { postes: [], horaires: [{ ...N, nom: 'Nuit' }] } } as unknown as Dataset;
  const e = (x: Partial<Employe>) => ({ id: 1, nom: 'Essai', typeContrat: 'cdd', entree: '2026-07-01', fin: '2026-12-31', poste: '', posteId: null, ...x }) as Employe;
  const l = ligneC2p(ds, e({}), [], 2026)!;
  assert.deepEqual([l.du, l.au, l.declarant], ['2026-07-01', '2026-12-31', 'employeur']);
  assert.equal(l.prorata, 184 / 365);
  assert.deepEqual([l.seuilNuit, l.seuilAlternant], [60.49, 25.21]);
  assert.equal(ligneC2p(ds, e({}), [], 2025), null, 'pas encore sous contrat');
  assert.equal(ligneC2p(ds, e({}), [], 2027), null, 'sorti');
  assert.deepEqual(ligneC2p(ds, e({ typeContrat: 'cdi', entree: '2010-01-04', fin: null }), [], 2026)!.prorata, 1);
  // Un mois exactement est déclaré ; trois semaines ne le sont pas.
  assert.equal(contratMoinsDUnMois({ entree: '2026-03-01', fin: '2026-03-31' }), false);
  assert.equal(contratMoinsDUnMois({ entree: '2026-03-02', fin: '2026-03-20' }), true);
  assert.equal(contratMoinsDUnMois({ entree: '2026-03-02', fin: null }), false);
  const court = ligneC2p(ds, e({ entree: '2026-03-02', fin: '2026-03-20' }), lundis('2026-03-02', 3).map(w => feuille(1, w) as unknown as Feuille), 2026)!;
  assert.equal(court.declarant, null);
  assert.equal(court.nuits, 15);
  assert.deepEqual(court.expositions, [], 'contrat de moins d’un mois : non déclaré, même au-delà du seuil au prorata');
  assert.equal(ligneC2p(ds, e({ typeContrat: 'interim', fin: null }), [], 2026)!.declarant, 'ett');
});

test('synthèse : nuits par année, équipes alternantes à part, horaires à qualifier, semaines sans horaire, feuilles non validées', () => {
  const horaires = [{ ...N, nom: 'Nuit' }, { ...M, nom: 'Matin' }, { code: 'N2', nom: 'Nuit en 3x8', debut: '22:00', fin: '06:00', pause: 30, alternant: true }];
  const postes = [{ id: 1, nom: 'Opérateur', formations: [], habilitations: [], c2p: ['bruit'] }];
  const emp = { id: 1, nom: 'Essai', typeContrat: 'cdi', entree: '2010-01-04', fin: null, poste: 'Opérateur', posteId: 1 } as unknown as Employe;
  const N2 = { code: 'N2', debut: '22:00', fin: '06:00', pause: 30 };
  const feuilles = [
    // 24 semaines de nuits non qualifiées : 120 nuits, seuil atteint.
    ...lundis('2026-01-05', 24).map(w => feuille(1, w)),
    // 10 semaines en 3x8 : 50 nuits alternantes, seuil atteint, sans compter au travail de nuit.
    ...lundis('2026-07-06', 10).map(w => feuille(1, w, { h: N2 })),
    // Semaine à cheval sur deux années : quatre nuits en 2026, une en 2027.
    feuille(1, '2026-12-28'),
    feuille(1, '2026-09-21', { sansHoraire: true }),
    feuille(1, '2026-09-28', { statut: 'soumise' }),
    feuille(1, '2026-10-05', { statut: 'brouillon', jours: 0 }),
  ] as unknown as Feuille[];
  const ds = { today: '2026-10-10', referentiels: { postes, horaires, equipes: [] }, employes: [emp], feuilles } as unknown as Dataset;
  const s = syntheseC2p(ds, 2026), [l] = s.lignes;
  assert.equal(s.arrete, '2026-10-10');
  assert.deepEqual([l.nuits, l.nuitsAlternantes, l.nuitsAQualifier], [124, 50, 124]);
  assert.deepEqual(l.expositions, ['nuit', 'alternant', 'bruit']);
  assert.deepEqual(l.facteursPoste, ['bruit']);
  assert.equal(l.semainesSansHoraire, 1);
  assert.equal(l.feuillesNonValidees, 1, 'une feuille sans heure n’est pas signalée');
  assert.deepEqual(s.horairesAQualifier, ['N']);
  const s27 = syntheseC2p(ds, 2027);
  assert.deepEqual([s27.lignes[0].nuits, s27.lignes[0].expositions], [1, ['bruit']]);
  // Horaire qualifié non alternant : plus à qualifier ; ses nuits restent au travail de nuit.
  const qualifie = { ...ds, referentiels: { ...ds.referentiels, horaires: horaires.map(h => (h.code === 'N' ? { ...h, alternant: false } : h)) } } as unknown as Dataset;
  assert.deepEqual([syntheseC2p(qualifie, 2026).lignes[0].nuitsAQualifier, syntheseC2p(qualifie, 2026).horairesAQualifier], [0, []]);
  // Horaire archivé sous lequel une nuit à qualifier a été comptée : toujours listé.
  const archive = { ...ds, referentiels: { ...ds.referentiels, horaires: horaires.map(h => (h.code === 'N' ? { ...h, archive: '2026-10-01' } : h)) } } as unknown as Dataset;
  assert.deepEqual(syntheseC2p(archive, 2026).horairesAQualifier, ['N']);
  assert.deepEqual(horairesAQualifier(archive.referentiels), [], 'archivé et sans nuit comptée : plus listé');
  // Export : une ligne par facteur exposé, codes internes et code DSN présumé à confirmer.
  const x = exportC2p({ employes: [{ ...emp, matriculePaie: 'S0042' }] }, s);
  assert.equal(x.fichier, 'c2p-2026-2026-10-10.csv');
  assert.deepEqual(x.rows.map(r => [r[1], r[2], r[4], r[6], r[9], r[10]]), [
    ['S0042', 'EMP-0001', 'C2P-NUIT', '08 (à confirmer)', 124, '120'],
    ['S0042', 'EMP-0001', 'C2P-ESA', '09 (à confirmer)', 50, '50'],
    ['S0042', 'EMP-0001', 'C2P-BRUIT', '07 (à confirmer)', '', ''],
  ]);
  assert.ok(x.rows.every(r => r.at(-1) === MENTION_C2P));
  assert.equal(x.head.length, x.rows[0].length);
  // Intérimaire et salarié inconnu de l'instantané : aucune ligne.
  assert.deepEqual(exportC2p({ employes: [] }, s).rows, []);
  assert.deepEqual(exportC2p({ employes: [emp] }, { ...s, lignes: [{ ...l, declarant: 'ett' }] }).rows, []);
});

// — Actions, journal, instantanés —

test('facteurs du poste : service RH et référent HSE, codes connus, tracés avant et après', async () => {
  const { db, user, run, refuse, derniere, RH } = await fresh();
  const HSE = await user(23, 'rh');
  const cariste = await poste(db, 'Cariste');
  assert.match((await run(HSE, 'referentiel.poste.expositions', { id: cariste, facteurs: ['bruit', 'temperatures'] }))!, /2 facteurs d’exposition cochés \(températures extrêmes, bruit\)/);
  assert.deepEqual((await db.get<{ c2p: string[] }>('postes', cariste))!.c2p, ['temperatures', 'bruit']);
  const j = (await derniere('referentiel.poste.expositions'))!;
  assert.deepEqual([j.payload.id, j.payload.avant, j.payload.apres], [cariste, { c2p: null }, { c2p: ['temperatures', 'bruit'] }]);
  assert.ok(JOURNAL_LABEL['referentiel.poste.expositions'] && familleAction('referentiel.poste.expositions')?.id === 'referentiels');
  assert.match((await run(RH, 'referentiel.poste.expositions', { id: cariste, facteurs: ['temperatures', 'bruit'] }))!, /inchangés/);
  assert.match((await run(RH, 'referentiel.poste.expositions', { id: cariste, facteurs: [] }))!, /aucun facteur/);
  assert.equal((await db.get<{ c2p: unknown }>('postes', cariste))!.c2p, null);
  await refuse(RH, 'referentiel.poste.expositions', { id: cariste, facteurs: ['nuit'] }, /inconnu/);
  await refuse(RH, 'referentiel.poste.expositions', { id: 99999, facteurs: [] }, /introuvable/, 404);
  await refuse(await user(11, 'rh'), 'referentiel.poste.expositions', { id: cariste, facteurs: [] }, /réservée/, 403);
  // La modification du poste par le service RH ne touche pas aux facteurs.
  await run(HSE, 'referentiel.poste.expositions', { id: cariste, facteurs: ['bruit'] });
  const p = (await db.get<{ nom: string; formations: string[]; habilitations: string[] }>('postes', cariste))!;
  await run(RH, 'referentiel.poste.enregistrer', { id: cariste, nom: p.nom, formations: p.formations, habilitations: p.habilitations });
  assert.deepEqual((await db.get<{ c2p: string[] }>('postes', cariste))!.c2p, ['bruit']);
});

test('qualification d’un horaire : oui, non, à qualifier ; JSON lu tel qu’écrit sur les deux moteurs, tracé', async () => {
  const { db, user, run, refuse, derniere } = await fresh();
  const HSE = await user(23, 'rh');
  const lire = async () => (await db.get<{ alternant: unknown }>('horaires', 'N'))!.alternant;
  assert.equal(await lire(), null, 'horaire d’exemple : à qualifier, jamais coché d’office');
  assert.match((await run(HSE, 'referentiel.horaire.alternant', { id: 'n', alternant: true }))!, /Horaire N : équipes successives alternantes/);
  assert.equal(await lire(), true);
  assert.deepEqual([(await derniere('referentiel.horaire.alternant'))!.payload.code, (await derniere('referentiel.horaire.alternant'))!.payload.apres], ['N', { alternant: true }]);
  assert.match((await run(HSE, 'referentiel.horaire.alternant', { id: 'N', alternant: false }))!, /non alternant/);
  assert.equal(await lire(), false, 'faux reste faux (distinct de « à qualifier »)');
  assert.equal(await run(HSE, 'referentiel.horaire.alternant', { id: 'N', alternant: 'false' }), null, 'déjà qualifié ainsi : rien');
  await run(HSE, 'referentiel.horaire.alternant', { id: 'N', alternant: null });
  assert.equal(await lire(), null);
  await refuse(HSE, 'referentiel.horaire.alternant', { id: 'N', alternant: 'oui' }, /Qualification invalide/);
  await refuse(HSE, 'referentiel.horaire.alternant', { id: 'ZZ', alternant: true }, /introuvable/, 404);
  assert.ok(JOURNAL_LABEL['referentiel.horaire.alternant']);
  // L'enregistrement de l'horaire par le service RH garde la qualification.
  await run(HSE, 'referentiel.horaire.alternant', { id: 'N', alternant: true });
  await run(await user(null, 'rh'), 'referentiel.horaire.enregistrer', { id: 'N', nom: 'Équipe de nuit', debut: '21:00', fin: '05:00', pause: 45 });
  assert.equal(await lire(), true);
});

test('instantanés : synthèse au service RH, au référent HSE et à la lecture seule ; ni facteurs ni synthèse au manager, au collaborateur, à la paie', async () => {
  const { db, user, run, RH } = await fresh();
  // Julien Moreau (Production, CDI) : 24 semaines de nuits ; Léa Girard (intérim depuis le 15 juin) : 2 semaines.
  for (const w of lundis('2026-01-05', 24)) await db.insert('feuilles', feuille(8, w));
  for (const w of lundis('2026-06-15', 2)) await db.insert('feuilles', feuille(15, w));
  const operateur = (await db.get<{ posteId: number }>('employes', 8))!.posteId;
  await run(RH, 'referentiel.poste.expositions', { id: operateur, facteurs: ['repetitif'] });
  const rh = await buildSnapshot(db, RH);
  assert.deepEqual(rh.c2p!.map(s => s.annee), [2026, 2025]);
  const julien = rh.c2p![0].lignes.find(l => l.empId === 8)!;
  assert.deepEqual([julien.nuits, julien.nuitsAQualifier, julien.expositions], [120, 120, ['nuit', 'repetitif']]);
  const lea = rh.c2p![0].lignes.find(l => l.empId === 15)!;
  assert.deepEqual([lea.declarant, lea.nuits, lea.du], ['ett', 10, '2026-06-15']);
  assert.deepEqual(rh.c2p![0].horairesAQualifier, ['N']);
  for (const [qui, u] of [['référent HSE', await user(23, 'rh')], ['lecture seule', await user(11, 'rh')]] as const) {
    const ds = await buildSnapshot(db, u);
    assert.deepEqual(ds.c2p, rh.c2p, qui);
    assert.deepEqual(ds.referentiels.postes.find(p => p.id === operateur)!.c2p, ['repetitif'], qui);
  }
  for (const [qui, u] of [['paie', await user(7, 'rh')], ['manager', await user(12, 'manager')], ['collaborateur', await user(8, 'collaborateur')]] as const) {
    const ds = await buildSnapshot(db, u);
    assert.equal(ds.c2p, undefined, qui);
    assert.ok(ds.referentiels.postes.every(p => !p.c2p), `${qui} : facteurs des postes retirés`);
  }
});

test('migration lot7-prevention-c2p : rien à reprendre, rien coché d’office (postes ni horaires d’exemple)', { skip: PG && SQLITE_SEUL }, async () => {
  const db = new SqliteDb(':memory:');
  assert.ok(MIGRATIONS.includes(C2P_COLONNES));
  assert.ok((await appliquerMigrations(db)).includes('lot7-prevention-c2p'), 'base neuve : exécutée, sans effet');
  assert.equal((await db.get<{ alternant: unknown }>('horaires', 'N'))!.alternant, null, 'horaire N d’exemple : à qualifier');
  assert.equal(await C2P_COLONNES.necessaire!({ neuve: false } as unknown as InstanceType<typeof SqliteDb>), false, 'base existante : notée faite, rien à reprendre');
  assert.equal(await C2P_COLONNES.executer(db), undefined);
  assert.deepEqual(await appliquerMigrations(db), [], 'une seule fois');
  // Base de démonstration : aucun poste n'a de facteur coché.
  const demo = await nouvelleBase();
  await seedDemo(demo);
  assert.ok((await demo.all<{ c2p: unknown }>('postes')).every(p => p.c2p == null));
  assert.ok((await demo.all<{ alternant: unknown }>('horaires')).every(h => h.alternant == null));
});
