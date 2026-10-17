// Réouverture d'une feuille validée et lots correctifs (t131, lot 5, chantier A, étape 2) : action temps.rouvrir
// (administrateur RH seul, motif obligatoire de 500 caractères au plus, tracé au journal sans le texte), refus d'une
// feuille d'un lot généré ou d'un intérimaire dont le relevé est parti, rubriques déjà transmises gardées, écart à la
// revalidation dans un lot « correctif » (rappel de la période close), « annule et remplace » sans quantité négative,
// renvoi Keystone avec les projets retirés à 0, récupération recalculée, vues du manager, reprise des lots d'avant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
delete process.env.SAGE_MODE;

const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { RUBRIQUES_PAR_FEUILLE } = await import('../server/src/migrations/paie.ts');
const { Domain } = await import('../shared/domain.ts');
const { sagePending } = await import('../shared/rules/temps.ts');
const { recupInfo } = await import('../shared/rules/conges.ts');
const { fichierLot, lignesFichier } = await import('../shared/rules/lots-paie.ts');
const R = await import('../shared/rules/regularisation.ts');
const { estActionPaie, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<ReturnType<typeof currentUser>>;
type Dataset = ReturnType<typeof loadFull>;
type Feuille = Dataset['feuilles'][number];
type Lot = Dataset['lotsPaie'][number] & { contenu: { lignes: { matricule: string; semaine: string; periode?: string; periode_origine?: string; rubriques: Record<string, number>; correctif?: boolean; remplace?: boolean }[]; rubriquesFeuilles?: { empId: number; week: string; periodes: Record<string, Record<string, number>> }[]; regularisation?: string } | null };

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
function fresh() {
  const db = new Db(':memory:');
  seedDemo(db);
  const compteDe = (empId: number | null) => db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number };
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId).id, role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const ADMIN = user(null, 'rh');
  const domain = () => new Domain(loadFull(db, ADMIN));
  const sheet = (empId: number, week: string) => db.all<Feuille>('feuilles').find(f => f.empId === empId && f.week === week)!;
  const dernierLot = () => db.all<Lot>('lotsPaie').at(-1)!;
  const keystone = () => db.all<{ cible: string; type: string; contenu: Record<string, unknown> }>('envois').filter(e => e.cible === 'keystone' && e.type === 'heures.validees');
  return { db, run, refus, domain, sheet, dernierLot, keystone, ADMIN, PAIE: user(7, 'rh'), GEST: user(14, 'rh'), KARIM: user(12, 'manager'), MEHDI: user(2, 'collaborateur') };
}

const MOTIF = 'Heures du lundi oubliées sur le projet de maintenance';
// Mehdi Benali (39 h + RTT, matricule de paie 004102) : semaine 39 transmise (lot historique, sans contenu), semaine 40
// validée, en attente de transmission.
const S39 = '2026-09-21', S40 = '2026-09-28';

test('t131 réouverture : administrateur RH seul, motif obligatoire (500 caractères au plus), feuille validée seulement', () => {
  const { run, refus, sheet, ADMIN, GEST, PAIE, KARIM } = fresh();
  refus(GEST, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF }, 403, /administrateur RH/);
  refus(PAIE, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF }, 403);
  refus(KARIM, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF }, 403);
  refus(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: '  ' }, 400, /motif de la réouverture/);
  refus(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: 'x'.repeat(501) }, 400, /500 caractères au plus/);
  refus(ADMIN, 'temps.rouvrir', { empId: 3, week: S40, motif: MOTIF }, 400, /Seule une feuille validée se rouvre/);
  assert.equal(R.erreurMotifReouverture('x'.repeat(500)), null);
  const msg = run(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF });
  assert.match(msg, /^Feuille de la semaine 40 de Mehdi Benali rouverte — à corriger puis revalider · pas encore transmise à la paie$/);
  const sh = sheet(2, S40);
  assert.equal(sh.statut, 'soumise');
  assert.deepEqual([sh.reouverture?.motif, sh.reouverture?.transmise, sh.reouverture?.rubriques, sh.reouverture?.renvoyee], [MOTIF, false, null, false]);
});

test('t131 réouverture refusée dans un lot généré (annuler d’abord le lot) et pour un intérimaire dont le relevé est parti', () => {
  const { db, run, refus, sheet, dernierLot, ADMIN, PAIE } = fresh();
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = dernierLot();
  assert.equal(sheet(2, S40).lotId, lot.id);
  refus(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF }, 409, new RegExp(`lot de paie n° ${lot.id}, import à confirmer : annulez d’abord ce lot`));
  run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  run(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF });
  // Léa Girard, intérimaire de Proman Lyon : relevé de la semaine 39 envoyé à l'agence.
  db.insert('releves', { agence: 'PROMAN LYON', semaine: S39, adresse: 'agence@example.fr', creation: '2026-09-28T08:00:00Z', par: 'Cursus', envoiId: null, interimaires: 1, heures: 35, enAttente: 0 });
  refus(ADMIN, 'temps.rouvrir', { empId: 15, week: S39, motif: MOTIF }, 409, /Relevé d’heures de la semaine 39 déjà envoyé à l’agence Proman Lyon/);
  assert.equal(sheet(15, S39).statut, 'validee');
});

test('t131 feuille transmise rouverte : rubriques gardées, écart à la revalidation dans un lot correctif, rappel de septembre', () => {
  const { db, run, sheet, domain, dernierLot, keystone, ADMIN, PAIE } = fresh();
  const avant = sheet(2, S39);
  assert.ok(avant.sage && avant.keystone);
  const msg = run(ADMIN, 'temps.rouvrir', { empId: 2, week: S39, motif: MOTIF, renvoyer: true });
  assert.match(msg, /renvoyée au salarié pour correction · déjà transmise à la paie : à la revalidation, seul l’écart partira dans le prochain lot \(lot correctif\) · Keystone recevra/);
  let sh = sheet(2, S39);
  // Lot historique sans contenu : la feuille est recalculée telle que validée.
  assert.deepEqual([sh.statut, sh.sage, sh.lotId, sh.comment, sh.reouverture?.source, sh.reouverture?.lot], ['rejetee', false, null, MOTIF, 'recalcul', 1]);
  assert.deepEqual(sh.reouverture?.rubriques, { '2026-09': { HN: 39 } });
  assert.deepEqual(sh.reouverture?.keystone, { 'K-2620': 15 });
  assert.equal(sagePending(domain()).some(f => f.id === sh.id), false, 'plus en attente tant qu’elle n’est pas revalidée');
  // Le salarié corrige : 2 h de plus le lundi, les heures du projet Keystone passées en maintenance.
  run(ADMIN, 'temps.setCell', { empId: 2, week: S39, li: 0, di: 0, value: '10' });
  for (const [di, v] of [[3, '8'], [4, '7']] as const) run(ADMIN, 'temps.setCell', { empId: 2, week: S39, li: 0, di, value: v });
  for (const di of [3, 4]) run(ADMIN, 'temps.setCell', { empId: 2, week: S39, li: 1, di, value: '0' });
  run(ADMIN, 'temps.submit', { empId: 2, week: S39 });
  const valide = run(ADMIN, 'temps.validate', { empId: 2, week: S39 });
  assert.match(valide, /heures des projets Keystone renvoyées à Keystone · feuille déjà transmise à la paie : l’écart partira dans le prochain lot \(lot correctif\)/);
  // Keystone : le projet retiré part à 0, l'événement remplace le précédent de la semaine.
  assert.deepEqual(keystone().at(-1)!.contenu.projets, { 'K-2620': 0 });
  sh = sheet(2, S39);
  assert.ok(R.aRegulariser(sh));
  assert.ok(sagePending(domain()).some(f => f.id === sh.id), 'à régulariser : de nouveau en attente');
  // Lot de la période ouverte : l'écart seul (+2 h à 25 %), en rappel de septembre ; lot « correctif ».
  const gen = run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  assert.match(gen, /lot correctif : 1 feuille rouverte régularisée · rappel de septembre 2026/);
  const lot = dernierLot();
  assert.deepEqual([lot.type, lot.correctifs], ['correctif', [{ empId: 2, week: S39 }]]);
  const lignes = lot.contenu!.lignes.filter(l => l.semaine === '2026-S39' && l.matricule === '004102');
  assert.deepEqual(lignes, [{ matricule: '004102', semaine: '2026-S39', periode: '2026-10', periode_origine: '2026-09', rubriques: { HS25: 2 }, correctif: true }]);
  assert.deepEqual(lot.contenu!.rubriquesFeuilles!.find(x => x.empId === 2 && x.week === S39)!.periodes, { '2026-09': { HN: 39, HS25: 2 } });
  assert.ok(lignesFichier(lot.contenu!).some(l => l.matricule === '004102' && l.periode === '2026-10' && l.rubrique === 'HS25' && l.quantite === 2));
  // Confirmé : transmise ; rouverte de nouveau, elle reprend ce que les deux lots ont envoyé (contenu figé du correctif).
  run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  assert.equal(sheet(2, S39).sage, true);
  assert.match(R.mentionReouverture(sheet(2, S39), x => x), /régularisation transmise/);
  run(ADMIN, 'temps.rouvrir', { empId: 2, week: S39, motif: 'Deuxième correction' });
  const r = sheet(2, S39).reouverture!;
  assert.deepEqual([r.source, r.lot, r.rubriques, r.keystone, r.precedentes?.map(x => x.motif)], ['lot', lot.id, { '2026-09': { HN: 39, HS25: 2 } }, {}, [MOTIF]]);
  // Journal : action de paie, sans le texte du motif.
  const j = db.sql.prepare(`SELECT payload, message FROM journal WHERE action = 'temps.rouvrir' ORDER BY id DESC`).get() as { payload: string; message: string };
  assert.ok(estActionPaie('temps.rouvrir') && JOURNAL_LABEL['temps.rouvrir']);
  assert.doesNotMatch(j.payload + j.message, /Deuxième correction/);
  assert.match(j.payload, /"motif":"\[texte renseigné\]"/);
  assert.match(j.payload, /"transmise":true/);
});

test('t131 sans quantité négative : « annule et remplace », rubriques complètes de la période d’origine, quantité nulle gardée', () => {
  const { run, sheet, dernierLot, ADMIN, PAIE } = fresh();
  run(PAIE, 'paie.formatFichier', { negatifs: false });
  // Semaine 40 transmise d'abord (lot ordinaire), puis rouverte : un jour de moins, sans heures supplémentaires.
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  run(PAIE, 'paie.lotConfirmer', { id: dernierLot().id });
  run(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF });
  assert.deepEqual(sheet(2, S40).reouverture?.rubriques, { '2026-10': { HN: 39 } });
  run(ADMIN, 'temps.setCell', { empId: 2, week: S40, li: 1, di: 4, value: '0' });
  run(ADMIN, 'temps.validate', { empId: 2, week: S40 });
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = dernierLot();
  assert.equal(lot.contenu!.regularisation, 'remplace');
  // Période d'origine ouverte (octobre) : rubriques complètes du salarié pour octobre (les autres semaines transmises
  // comprises), la feuille corrigée telle que revalidée.
  const l = lot.contenu!.lignes.filter(x => x.remplace);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].matricule, l[0].periode, l[0].rubriques.HN], ['004102', '2026-10', 32]);
  // « Annule et remplace » : une quantité nulle part dans le fichier (elle remplace celle déjà importée).
  const contenu = { lignes: [{ matricule: '004102', semaine: '2026-S40', periode: '2026-10', rubriques: { HN: 32, HS25: 0 }, correctif: true, remplace: true }] };
  assert.deepEqual(lignesFichier(contenu).map(x => [x.rubrique, x.quantite]), [['HN', 32], ['HS25', 0]]);
  assert.match(fichierLot(contenu), /004102;2026-10;HS25;0\r\n/);
  assert.deepEqual(lignesFichier({ lignes: [{ ...contenu.lignes[0], remplace: false }] }).map(x => x.rubrique), ['HN'], 'écart : quantité nulle omise');
});

test('t131 règles : écart par période, annule et remplace, projets Keystone retirés à 0, semaine vidée', () => {
  assert.deepEqual(R.ecartRubriques({ '2026-09': { HN: 35, HS25: 2 } }, { '2026-09': { HN: 35, HS25: 4.5, HDIM: 3 } }), { '2026-09': { HS25: -2.5, HDIM: -3 } });
  assert.deepEqual(R.ecartRubriques({ '2026-10': { HN: 7 } }, { '2026-09': { HN: 7 } }), { '2026-10': { HN: 7 }, '2026-09': { HN: -7 } });
  assert.equal(R.modeRegularisation(undefined), 'ecart');
  assert.equal(R.modeRegularisation({ negatifs: false }), 'remplace');
  assert.deepEqual(R.projetsRevalidation({ 'K-1': 7 }, { keystone: { 'K-1': 3, 'K-2': 4 } }), { 'K-2': 0, 'K-1': 7 });
  // Semaine vidée de toute heure Keystone : l'événement part quand même, projets à 0.
  assert.deepEqual(R.projetsRevalidation({}, { keystone: { 'K-2': 4 } }), { 'K-2': 0 });
  assert.deepEqual(R.projetsRevalidation({}, null), {});
  assert.deepEqual(R.reouvertureNeutre({ le: 'x', par: 'Sandrine Vidal', motif: 'm', renvoyee: true, transmise: true, lot: 3, rubriques: { a: {} }, keystone: {}, precedentes: [] }),
    { le: 'x', par: 'Sandrine Vidal', motif: '', renvoyee: true, transmise: true, lot: null, rubriques: null, keystone: null });
});

test('t131 récupération recalculée : feuille rouverte hors du compteur, revalidée avec ses nouvelles heures', () => {
  const { db, run, sheet, domain, ADMIN } = fresh();
  // Semaine 40 de Mehdi en repos de remplacement (mode figé) : 2 h à 25 % donnent 2 h 30 de repos.
  db.update('feuilles', sheet(2, S40).id, { heuresSup: 'repos', lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [10, 8, 8, 8, 7, 0, 0] }] });
  const acq = () => recupInfo(domain(), domain().emp(2)!)!.acq;
  const a0 = acq();
  run(ADMIN, 'temps.rouvrir', { empId: 2, week: S40, motif: MOTIF });
  assert.equal(acq(), a0 - 2.5, 'feuille rouverte : son repos sort du compteur');
  run(ADMIN, 'temps.setCell', { empId: 2, week: S40, li: 0, di: 1, value: '10' });
  run(ADMIN, 'temps.validate', { empId: 2, week: S40 });
  assert.equal(sheet(2, S40).heuresSup, 'repos', 'mode des heures supplémentaires figé gardé');
  assert.equal(acq(), a0 + 2.5, 'revalidée : 4 h à 25 %, 5 h de repos');
});

test('t131 vues : le manager et le collaborateur voient la réouverture sans motif ni rubriques ; la paie la voit entière', () => {
  const { db, run, ADMIN, KARIM, MEHDI, PAIE } = fresh();
  run(ADMIN, 'temps.rouvrir', { empId: 2, week: S39, motif: MOTIF });
  for (const u of [KARIM, MEHDI]) {
    const r = buildSnapshot(db, u).feuilles.find(f => f.empId === 2 && f.week === S39)!.reouverture!;
    assert.deepEqual([r.motif, r.rubriques, r.keystone, r.transmise, r.par], ['', null, null, true, 'Sandrine Vidal']);
  }
  const p = buildSnapshot(db, PAIE).feuilles.find(f => f.empId === 2 && f.week === S39)!.reouverture!;
  assert.equal(p.motif, MOTIF);
  assert.deepEqual(p.rubriques, { '2026-09': { HN: 39 } });
});

test('t131 migration lot5-paie-rubriques-par-feuille : rubriques des feuilles reprises des lignes des lots d’avant, tracé', () => {
  const { db, run, dernierLot, PAIE } = fresh();
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lot = dernierLot(), attendu = lot.contenu!.rubriquesFeuilles!;
  // Lot d'avant le lot 5 : contenu sans les rubriques par feuille.
  db.sql.prepare(`UPDATE lots_paie SET contenu = json_remove(contenu, '$.rubriquesFeuilles') WHERE id = ?`).run(lot.id);
  assert.match(String(RUBRIQUES_PAR_FEUILLE.executer(db)), /^1 lot de paie : rubriques de \d+ feuilles reprises$/);
  const repris = dernierLot().contenu!.rubriquesFeuilles!;
  // Feuilles sans aucune heure transmise exceptées (le salarié n'a pas de ligne : rien à rapprocher), identiques.
  assert.ok(repris.length > 0);
  for (const r of repris) assert.deepEqual(r, attendu.find(x => x.empId === r.empId && x.week === r.week));
  assert.equal(RUBRIQUES_PAR_FEUILLE.executer(db), undefined, 'plus rien à reprendre');
  assert.ok(db.sql.prepare(`SELECT 1 FROM journal WHERE action = 'migration.rubriquesFeuilles'`).get());
});
