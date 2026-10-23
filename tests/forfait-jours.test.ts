// Forfait jours (lot 6, chantier 2, étape 2 : t043) : cumul annuel des jours travaillés (demi-journée jusqu'à 4 h, semaine
// à cheval sur le 31 décembre ventilée jour par jour, cible au prorata), alerte au seuil réglé, motif exigé à la validation
// au-delà du plafond, avenant de renonciation fermé sans référence d'accord (COHERENCE), plafond porté par l'avenant dans la
// limite réglée, majoration minimale, jours rachetés dans le lot de paie (JREN désactivée : à saisir dans Sage puis réglés
// hors fichier à la confirmation du lot qui les a listés, et de lui seul ; activée : dans le fichier), annulation (refusée
// dans un lot à confirmer, motif masqué au journal), instantanés de chaque profil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { horsContraintes, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { variablesDeLaPeriode, A_SAISIR } = await import('../server/src/variables-paie.ts');
const { Domain } = await import('../shared/domain.ts');
const F = await import('../shared/rules/forfait-jours.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Lot = Awaited<ReturnType<typeof loadFull>>['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };
type Avenant = import('../shared/types.ts').AvenantForfait;
type Feuille = import('../shared/types.ts').FeuilleTemps;

/** Cadre au forfait jours de la démonstration (forfait 218 jours, entré en 2011). */
const CADRE = 9;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Les feuilles du cadre sont posées par chaque test.
  await db.run('DELETE FROM feuilles WHERE emp_id = ?', [CADRE]);
  // Jours de repos 2026 du cadre tous restants (9 jours) : ni RTT pris, ni compteur repris.
  await db.run("DELETE FROM absences WHERE emp_id = ? AND type = 'RTT'", [CADRE]);
  await db.run('DELETE FROM soldes_reprise WHERE emp_id = ?', [CADRE]);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const ADMIN = await user(null, 'rh');
  const d = async () => new Domain(await loadFull(db, ADMIN));
  const regler = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  /** Feuille du cadre pour la semaine `week`, heures du lundi au dimanche. */
  const feuille = async (week: string, h: number[], statut = 'validee') => await db.insert<Feuille>('feuilles', {
    empId: CADRE, week, statut, comment: null, sage: false, keystone: false, contrat: null, lignes: [{ projet: 'INT-COM', tache: 'Avant-vente', ks: false, h }],
  });
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[] }>('journal')).filter(l => l.action === action);
  const lots = async () => await db.all<Lot>('lotsPaie');
  return { db, run, refus, d, regler, feuille, journal, lots, ADMIN, PAIE: await user(7, 'rh'), LECTURE: await user(11, 'rh'), HSE: await user(23, 'rh'), GEST: await user(14, 'rh') };
}

const SEMAINE = [8, 8, 8, 8, 8, 0, 0];

test('t043 cumul : demi-journée jusqu’à 4 h, semaine à cheval ventilée jour par jour, cible au prorata, solde de repos', async () => {
  const { d, feuille, db } = await fresh();
  await feuille('2026-09-28', [8, 8, 3, 0, 8, 4, 0]); // 1 + 1 + 0,5 + 0 + 1 + 0,5 = 4
  await feuille('2026-10-05', SEMAINE, 'soumise'); // soumise : pas encore comptée
  let k = F.cumulForfaitJours(await d(), (await d()).emp(CADRE)!, 2026)!;
  assert.equal(k.done, 4);
  assert.equal(k.cible, 218);
  assert.equal(k.plafond, 218);
  assert.equal(k.etat, 'ok');
  assert.ok(k.prorata > 160 && k.prorata < 170, 'cible à date : part de l’année écoulée au 10 octobre');
  // Semaine du lundi 28 décembre 2026 : 4 jours en 2026, le vendredi 1er janvier en 2027.
  await feuille('2026-12-28', SEMAINE);
  assert.equal(F.cumulForfaitJours(await d(), (await d()).emp(CADRE)!, 2026)!.done, 8);
  assert.equal(F.cumulForfaitJours(await d(), (await d()).emp(CADRE)!, 2027)!.done, 1);
  // Entrée en cours d'année : cible au prorata de la présence.
  await db.update('employes', CADRE, { entree: '2026-07-01' });
  k = F.cumulForfaitJours(await d(), (await d()).emp(CADRE)!, 2026)!;
  assert.equal(k.cible, Math.round(218 * 184 / 365));
  // Salarié hors forfait jours : aucun cumul.
  assert.equal(F.cumulForfaitJours(await d(), (await d()).emp(2)!, 2026), null);
  // Jours de repos du forfait (rttInfo) : droit, et reste une fois les jours rachetés retirés.
  const r = F.reposForfaitInfo(await d(), (await d()).emp(CADRE)!, { ...k, rachetes: 3 })!;
  assert.equal(r.reste, Math.round((r.solde - 3) * 10) / 10);
});

test('t043 validation : alerte au seuil sans blocage, motif du valideur exigé au-delà du plafond, tracé sans son texte', async () => {
  const { db, run, refus, feuille, journal, ADMIN, regler } = await fresh();
  // Forfait réduit à 7 jours pour atteindre le plafond en deux semaines.
  await db.update('employes', CADRE, { forfaitJours: 7 });
  await feuille('2026-09-21', [8, 8, 0, 0, 0, 0, 0]);
  await feuille('2026-09-28', SEMAINE, 'soumise');
  await regler({ forfaitJoursAlerte: 90 });
  // 2 + 5 = 7 jours sur 7 : seuil d'alerte atteint, validée avec une alerte.
  assert.match(await run(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-09-28' }), /Forfait jours 2026 : 100 % du plafond atteint/);
  // Une semaine de plus : 12 jours sur 7, motif exigé.
  await feuille('2026-10-05', SEMAINE, 'soumise');
  await refus(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-10-05' }, 400, /Forfait jours 2026 dépassé : 12 j travaillés pour un plafond de 7 j \(aucun avenant de renonciation\) : indiquez le motif/);
  assert.match(await run(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-10-05', motifForfait: 'Mise en service urgente chez le client' }), /dépassé/);
  const sh = (await db.all<Feuille>('feuilles')).find(f => f.empId === CADRE && f.week === '2026-10-05')!;
  assert.equal(sh.statut, 'validee');
  assert.equal(sh.motifForfait, 'Mise en service urgente chez le client');
  const l = (await journal('temps.validate')).at(-1)!;
  assert.equal(l.payload.motifForfait, '[texte renseigné]');
  assert.ok(!JSON.stringify(l).includes('Mise en service urgente'));
  // Hors forfait jours : aucun contrôle.
  assert.deepEqual(F.controleValidationForfait(new Domain(await loadFull(db, ADMIN)), new Domain(await loadFull(db, ADMIN)).emp(2)!, { ...sh, empId: 2 }), { depassements: [], alertes: [] });
});

test('t043 réglages : renonciation fermée sans référence d’accord (COHERENCE), plafond et majoration bornés', async () => {
  const { d } = await fresh();
  const s = (await d()).ds.settings;
  assert.equal(F.rachatOuvert(s), false);
  assert.throws(() => appliquerReglages(s, { forfaitJoursRachat: true }), (e: unknown) => e instanceof ReglageInvalide && /accord collectif/.test(e.message));
  const ouvert = appliquerReglages(s, { forfaitJoursRachat: true, forfaitJoursAccord: '  Accord   du 1er mars 2026 ', forfaitJoursPlafond: 400, forfaitJoursMajorationMin: 5 });
  assert.equal(ouvert.forfaitJoursAccord, 'Accord du 1er mars 2026');
  assert.equal(ouvert.forfaitJoursPlafond, 282);
  assert.equal(ouvert.forfaitJoursMajorationMin, 10);
  assert.equal(F.rachatOuvert(ouvert), true);
  assert.equal(appliquerReglages(s, { forfaitJoursJren: 'autre' }).forfaitJoursJren, 'signature');
});

test('t043 avenant : fermé sans accord, plafond réglé, majoration minimale, plafond de l’année porté par l’avenant', async () => {
  const { db, run, refus, d, feuille, regler, journal, ADMIN, GEST, PAIE } = await fresh();
  const avenant = { empId: CADRE, annee: 2026, jours: 4, taux: 25, signeLe: '2026-10-01', reference: 'AV-FJ-2026-01' };
  await refus(ADMIN, 'forfait.avenant', avenant, 400, /Renonciation à des jours de repos fermée/);
  await regler({ forfaitJoursRachat: true, forfaitJoursAccord: 'Accord d’entreprise du 1er mars 2026' });
  await refus(PAIE, 'forfait.avenant', avenant, 403);
  await refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 18 }, 400, /17 j au plus — forfait de 218 jours, plafond de 235 jours/);
  // On ne renonce qu'aux jours de repos restants de l'année (9 jours).
  await refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 10 }, 400, /9 j au plus — jours de repos 2026 restants \(9 j de droit, 0 j pris ou posés\)/);
  await refus(ADMIN, 'forfait.avenant', { ...avenant, taux: 5 }, 400, /de 10 à 100 %/);
  await refus(ADMIN, 'forfait.avenant', { ...avenant, signeLe: '2026-11-02' }, 400, /signature future/);
  await refus(ADMIN, 'forfait.avenant', { ...avenant, empId: 2 }, 400, /ne relève pas d’un forfait annuel en jours/);
  assert.match(await run(GEST, 'forfait.avenant', avenant), /4 jours rachetés, majoration de 25 %.* plafond 2026 porté à 222 j · paie : rubrique JREN, octobre 2026/);
  // Un second avenant de l'année : 13 jours au plus sous le plafond, mais 5 jours de repos restants seulement.
  await refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 14 }, 400, /13 j au plus.*4 j déjà rachetés en 2026/);
  await refus(ADMIN, 'forfait.avenant', { ...avenant, jours: 8 }, 400, /5 j au plus — jours de repos 2026 restants.*4 j déjà rachetés/);
  const l = (await journal('forfait.avenant')).at(-1)!;
  assert.deepEqual([l.payload.annee, l.payload.jours, l.payload.taux, l.payload.reference, l.salaries], [2026, 4, 25, '[texte renseigné]', [CADRE]]);
  assert.ok(!JSON.stringify(l).includes('AV-FJ-2026-01'));
  assert.equal(estActionPaie('forfait.avenant'), true);
  assert.equal(familleAction('forfait.annulerAvenant')?.id, 'temps');
  assert.ok(JOURNAL_LABEL['forfait.avenant'] && JOURNAL_LABEL['forfait.annulerAvenant']);
  // Le plafond de l'année devient le forfait plus 4 jours : une feuille qui dépassait le forfait n'exige plus de motif.
  await db.update('employes', CADRE, { forfaitJours: 7 });
  await feuille('2026-09-21', [8, 8, 8, 8, 8, 8, 0]);
  await feuille('2026-09-28', SEMAINE, 'soumise');
  const k = F.cumulForfaitJours(await d(), (await d()).emp(CADRE)!, 2026)!;
  assert.deepEqual([k.rachetes, k.plafond], [4, 11]);
  assert.match(await run(ADMIN, 'temps.validate', { empId: CADRE, week: '2026-09-28' }), /validée/);
});

test('t043 paie : JREN désactivée, jours à saisir dans Sage puis réglés hors fichier ; activée, dans le fichier ; annulation', async () => {
  const { db, run, refus, regler, lots, journal, ADMIN, PAIE } = await fresh();
  await regler({ forfaitJoursRachat: true, forfaitJoursAccord: 'Accord d’entreprise du 1er mars 2026' });
  await run(ADMIN, 'forfait.avenant', { empId: CADRE, annee: 2026, jours: 4, taux: 25, signeLe: '2026-10-01', reference: '' });
  const av = async () => (await db.all<Avenant>('avenantsForfait'))[0];
  // Rubrique désactivée par défaut : listée dans le résumé du lot, absente du fichier, réglée hors fichier à la confirmation.
  assert.match(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /éléments? à saisir dans Sage/);
  let lot = (await lots()).at(-1)!;
  assert.deepEqual(lot.resume.aSaisir?.filter(x => x.famille === 'rachats').map(x => [x.empId, x.rubrique, x.quantite, x.detail]),
    [[CADRE, 'JREN', 4, 'Avenant de renonciation 2026 signé le 01/10/2026 · majoration 25 %']]);
  assert.ok(!L.lignesFichier(lot.contenu!).some(x => x.rubrique === 'JREN'));
  // Réservé par le lot, sans code Sage : il ne repart pas dans un autre lot avant la confirmation de celui-ci.
  assert.deepEqual([lot.rachats, (await av()).lotId, lot.contenu!.rachats?.[0]?.codeSage], [[{ id: (await av()).id, empId: CADRE }], lot.id, null]);
  assert.equal(F.etatRachat(await av()), `dans le lot de paie n° ${lot.id}, import à confirmer`);
  assert.ok((await variablesDeLaPeriode(db, PAIE, '2026-10')).some(v => v.rubrique === A_SAISIR && v.empId === CADRE && /Avenant de renonciation/.test(v.detail)));
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  assert.deepEqual([(await av()).lotId, (await av()).sage, (await av()).horsFichier], [lot.id, true, true]);
  assert.equal(F.etatRachat(await av()), 'réglé hors fichier (saisi dans Sage)');

  // Rubrique activée : un second avenant part dans le fichier sous son code, réservé par le lot, libéré par son annulation.
  await run(PAIE, 'paie.rubrique', { code: 'JREN', active: true, codeSage: '310' });
  await run(ADMIN, 'forfait.avenant', { empId: CADRE, annee: 2026, jours: 2, taux: 30, signeLe: '2026-10-05', reference: '' });
  const second = async () => (await db.all<Avenant>('avenantsForfait'))[1];
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  lot = (await lots()).at(-1)!;
  assert.deepEqual(lot.rachats, [{ id: (await second()).id, empId: CADRE }]);
  assert.deepEqual(lot.resume.rachats, { elements: 1, salaries: 1 });
  assert.ok(L.lignesFichier(lot.contenu!).some(x => x.rubrique === '310' && x.quantite === 2));
  assert.deepEqual((await journal('paie.lotGenerer')).at(-1)!.payload.rachats, [(await second()).id]);
  // Dans un lot à confirmer : l'annulation de l'avenant est refusée.
  await refus(ADMIN, 'forfait.annulerAvenant', { id: (await second()).id, motif: 'Erreur' }, 409, /annulez d’abord ce lot/);
  await run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  assert.equal((await second()).lotId, null);
  await refus(ADMIN, 'forfait.annulerAvenant', { id: (await second()).id }, 400, /motif/);
  assert.match(await run(ADMIN, 'forfait.annulerAvenant', { id: (await second()).id, motif: 'Salarié revenu sur sa décision' }), /annulé/);
  assert.ok((await second()).annuleLe);
  const l = (await journal('forfait.annulerAvenant')).at(-1)!;
  assert.ok(!JSON.stringify(l).includes('revenu sur sa décision'));
  assert.deepEqual(l.salaries, [CADRE]);
  // Annulé : plus rien à émettre ; le premier, déjà réglé, s'annule avec la mention de la régularisation dans Sage.
  assert.deepEqual(F.elementsRachats(new Domain(await loadFull(db, ADMIN)), '2026-12', [{ code: 'JREN', codeSage: '310', active: true }]), []);
  assert.match(await run(ADMIN, 'forfait.annulerAvenant', { id: (await av()).id, motif: 'Erreur de saisie' }), /à régulariser dans Sage/);
});

test('t043 paie : la confirmation ne règle hors fichier que les avenants listés par le lot (avenant enregistré après la génération, JREN activée avant la confirmation)', async () => {
  const { db, run, refus, regler, lots, ADMIN, PAIE } = await fresh();
  await regler({ forfaitJoursRachat: true, forfaitJoursAccord: 'Accord d’entreprise du 1er mars 2026' });
  const avenant = async (i: number) => (await db.all<Avenant>('avenantsForfait'))[i];
  const etat = (a: Avenant) => [a.lotId, a.sage, a.horsFichier];
  const attente = async () => F.elementsRachats(new Domain(await loadFull(db, ADMIN)), '2026-12', [{ code: 'JREN', codeSage: '310', active: true }]).map(x => x.avenant);

  // Lot d'octobre généré (JREN désactivée), puis un avenant enregistré avant sa confirmation : il n'est pas dans le lot.
  await run(ADMIN, 'forfait.avenant', { empId: CADRE, annee: 2026, jours: 2, taux: 25, signeLe: '2026-10-01', reference: '' });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = (await lots()).at(-1)!;
  await run(ADMIN, 'forfait.avenant', { empId: CADRE, annee: 2026, jours: 3, taux: 25, signeLe: '2026-10-08', reference: '' });
  assert.deepEqual(lot.resume.aSaisir?.filter(x => x.famille === 'rachats').map(x => x.quantite), [2]);
  // Dans le lot à confirmer, même sans code Sage : l'annulation de l'avenant est refusée (le résumé le demande à la paie).
  await refus(ADMIN, 'forfait.annulerAvenant', { id: (await avenant(0)).id, motif: 'Erreur' }, 409, /annulez d’abord ce lot/);

  // La paie active JREN (son code donné) avant de confirmer le lot : le lot reste ce qu'il a listé.
  await run(PAIE, 'paie.rubrique', { code: 'JREN', active: true, codeSage: '310' });
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  assert.deepEqual(etat(await avenant(0)), [lot.id, true, true], 'listé à saisir dans Sage : réglé hors fichier');
  assert.deepEqual(etat(await avenant(1)), [null, false, false], 'enregistré après la génération : toujours en attente');
  assert.equal(F.etatRachat(await avenant(1)), 'en attente du prochain lot de paie');

  // Lot suivant : le second avenant seul, sous le code de JREN ; le premier ne repart pas dans le fichier.
  assert.deepEqual(await attente(), [(await avenant(1)).id]);
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const suivant = (await lots()).at(-1)!;
  assert.deepEqual(suivant.rachats, [{ id: (await avenant(1)).id, empId: CADRE }]);
  assert.deepEqual(L.lignesFichier(suivant.contenu!).filter(x => x.rubrique === '310').map(x => x.quantite), [3]);
  await run(PAIE, 'paie.lotConfirmer', { id: suivant.id });
  assert.deepEqual(etat(await avenant(1)), [suivant.id, true, false]);
  assert.deepEqual(await attente(), []);
});

test('t043 fiche : bloc « Forfait jours » réservé au service RH, à la paie, à la lecture seule et au manager (pas au référent HSE)', async () => {
  const source = readFileSync(new URL('../client/src/components/ForfaitJours.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!\(rh \|\| paie \|\| consultation \|\| manager\)\) return null;/);
  // Le référent HSE ne reçoit ni les feuilles du cadre ni ses avenants : son cumul serait faux.
  const { db, feuille, ADMIN, HSE } = await fresh();
  await feuille('2026-09-28', [8, 8, 8, 8, 8, 0, 0]);
  const cumul = async (u: User) => { const d = new Domain(await buildSnapshot(db, u)); return F.cumulForfaitJours(d, d.emp(CADRE)!, 2026)?.done ?? 0; };
  assert.deepEqual([await cumul(ADMIN), await cumul(HSE)], [5, 0]);
});

test('t043 paie : période des jours rachetés, mois de la signature ou décembre de l’année ; un mois clos part sur la période ouverte', () => {
  const a = { annee: 2026, signeLe: '2026-11-03' };
  assert.equal(F.periodeRachat(a, { forfaitJoursJren: 'signature' }, '2026-10-10'), '2026-11');
  assert.equal(F.periodeRachat(a, { forfaitJoursJren: 'cloture' }, '2026-10-10'), '2026-12');
  assert.equal(F.periodeRachat({ annee: 2026, signeLe: '2026-08-01' }, { forfaitJoursJren: 'signature' }, '2026-10-10'), '2026-10');
});

test('t043 instantanés : service RH complet, paie et lecture seule sans le motif, manager réduit aux jours, intéressé, référent HSE rien', async () => {
  const { db, ADMIN, PAIE, LECTURE, HSE } = await fresh();
  await db.insert('avenantsForfait', {
    empId: 12, annee: 2026, jours: 5, taux: 25, signeLe: '2026-10-01', reference: 'AV-12', creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
    annuleLe: '2026-10-02T08:00:00.000Z', annulePar: 'Sandrine Vidal', annuleMotif: 'Erreur de saisie', lotId: null, sage: false, horsFichier: false,
  });
  await db.insert('avenantsForfait', {
    empId: CADRE, annee: 2026, jours: 3, taux: 20, signeLe: '2026-10-01', reference: 'AV-9', creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
    annuleLe: null, annulePar: null, annuleMotif: null, lotId: null, sage: false, horsFichier: false,
  });
  const vue = async (u: User) => (await buildSnapshot(db, u)).avenantsForfait ?? [];
  assert.equal((await vue(ADMIN)).length, 2);
  assert.equal((await vue(ADMIN)).find(a => a.empId === 12)!.annuleMotif, 'Erreur de saisie');
  for (const u of [PAIE, LECTURE]) {
    assert.equal((await vue(u)).length, 2);
    assert.ok((await vue(u)).every(a => a.annuleMotif === null));
    assert.equal((await vue(u)).find(a => a.empId === CADRE)!.taux, 20);
  }
  assert.deepEqual(await vue(HSE), []);
  // Nadia Kaci (9) : son propre avenant, sans auteur ; manager de Clara Roussel (19), forfait jours : jours et année seulement.
  // Lot de paie n° 3 seulement désigné (aucun lot écrit) : clés étrangères contournées en PostgreSQL.
  await horsContraintes(db, async () => {
    await db.insert('avenantsForfait', {
      empId: 19, annee: 2026, jours: 2, taux: 15, signeLe: '2026-10-01', reference: 'AV-19', creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Sandrine Vidal',
      annuleLe: null, annulePar: null, annuleMotif: null, lotId: 3, sage: true, horsFichier: false,
    });
  });
  const compte = async (empId: number) => (await db.one('SELECT id FROM comptes WHERE emp_id = ?', [empId]) as { id: number }).id;
  const soi = (await buildSnapshot(db, (await currentUser(db, { compteId: await compte(CADRE), role: 'collaborateur', methode: 'demo' }))!)).avenantsForfait ?? [];
  assert.deepEqual(soi.map(a => [a.empId, a.taux, a.reference, a.creePar]), [[CADRE, 20, 'AV-9', '']]);
  const equipe = (await buildSnapshot(db, (await currentUser(db, { compteId: await compte(CADRE), role: 'manager', methode: 'demo' }))!)).avenantsForfait ?? [];
  assert.deepEqual(equipe.map(a => [a.empId, a.jours, a.taux, a.reference, a.lotId]), [[CADRE, 3, 20, 'AV-9', null], [19, 2, 0, null, null]]);
  // Le manager voit le plafond de son membre porté par l'avenant, comme le serveur à la validation.
  const dm = new Domain(await buildSnapshot(db, (await currentUser(db, { compteId: await compte(CADRE), role: 'manager', methode: 'demo' }))!));
  assert.equal(F.cumulForfaitJours(dm, dm.emp(19)!, 2026)!.plafond, 220);
});

test('t043 cumul : passage au forfait jours en cours d’année (historique des contrats), cible au prorata des périodes sous forfait', async () => {
  const { db, d } = await fresh();
  // Mehdi Benali (35 h) passe au forfait jours (218) le 1er juillet 2026 : la cible ne compte que le second semestre.
  const e = (await d()).emp(2)!;
  const regime = { statut: e.statut, typeContrat: e.typeContrat, heures: null, forfaitHeures: null, jourOff: [] };
  await db.insert('contratsHistorique', { empId: 2, effet: e.entree, nature: 'embauche', regime: { ...regime, temps: '35h', forfaitJours: null }, le: '2026-06-01', par: 'Cursus', parId: null, applique: true });
  await db.insert('contratsHistorique', { empId: 2, effet: '2026-07-01', nature: 'avenant', regime: { ...regime, temps: 'forfait_jours', forfaitJours: 218 }, le: '2026-06-01', par: 'Sandrine Vidal', parId: null, applique: true });
  await db.update('employes', 2, { temps: 'forfait_jours', forfaitJours: 218, tempsDepuis: '2026-07-01' });
  const k = F.cumulForfaitJours(await d(), (await d()).emp(2)!, 2026)!;
  assert.equal(k.forfait, 218);
  assert.equal(k.cible, Math.round(218 * 184 / 365));
});

test('t043 textes : cumul avec avenant, dépassement avec jours rachetés, état de l’avenant pour la paie', () => {
  const k = { annee: 2026, done: 230, cible: 218, forfait: 218, prorata: 168, rachetes: 10, plafond: 228, seuil: 90, etat: 'depasse' as const };
  assert.equal(F.cumulTexte(k), '230 j travaillés sur 228 j (forfait 218 + 10 rachetés par avenant)');
  assert.match(F.alerteForfait(k), /plafond de 228 j \(forfait et 10 jours rachetés par avenant\)/);
  assert.equal(F.alerteForfait({ ...k, done: 100, etat: 'ok' }), '');
  const a = { id: 1, empId: 9, annee: 2026, jours: 3, taux: 25, signeLe: '2026-10-01', reference: null, creeLe: '', creePar: '', annuleLe: null, annulePar: null, annuleMotif: null, lotId: null, sage: false, horsFichier: false };
  assert.equal(F.etatRachat(a), 'en attente du prochain lot de paie');
  assert.equal(F.etatRachat({ ...a, lotId: 4 }), 'dans le lot de paie n° 4, import à confirmer');
  assert.equal(F.etatRachat({ ...a, lotId: 4, sage: true }), 'transmis à la paie (lot n° 4)');
  assert.equal(F.etatRachat({ ...a, annuleLe: '2026-10-02' }), 'annulé');
});
