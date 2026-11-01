// Astreintes dans la paie (t049, lot 7, étape 2) : heures (AST_H) et périodes (AST_PER) des astreintes terminées, famille
// « astreintes » du registre des éléments de lot, sur le jeu de démonstration (Mehdi Benali, 2, Maintenance ; intérimaire,
// 15) le 10 octobre 2026. Répartition des heures entre les mois, mois clos en rappel, rubriques désactivées par défaut (à
// saisir dans Sage : résumé du lot, export des variables), réservation par le lot, libération à son annulation,
// transmission à sa confirmation, rubrique activée dans le fichier, journal, instantanés, migration nommée et références.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase, PG, SQLITE_SEUL, sqlite } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { variablesDeLaPeriode, A_SAISIR } = await import('../server/src/variables-paie.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { ASTREINTES_PAIE_INDEX } = await import('../server/src/migrations/lot7-astreintes.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { REFERENCES } = await import('../server/src/integrite.ts');
const { FAMILLES } = await import('../server/src/elements-lot.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const { Domain } = await import('../shared/domain.ts');
const { instant } = await import('../shared/rules/astreintes.ts');
const P = await import('../shared/rules/astreintes-paie.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { rubriquesPaie } = await import('../shared/rules/paie.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type Astreinte = NonNullable<Dataset['astreintes']>[number];
type Lot = Dataset['lotsPaie'][number] & { contenu: import('../shared/types.ts').SagePush | null };

/** Heure présente des actions (heure de Paris, au jour CURSUS_TODAY). */
horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');
const MAINTENANT = instant('2026-10-10', '09:00');

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return String(o.message);
  });
  /** Astreinte écrite directement (passée : hors des contrôles de la planification). */
  const inserer = async (du: string, au: string, o: Partial<Astreinte> = {}) => (await db.insert<Astreinte>('astreintes', {
    empId: 2, equipe: 'Maintenance', du, debut: '18:00', au, fin: '08:00', communiqueLe: '2026-09-10', motif: null, creeLe: '2026-09-10T08:00:00.000Z', creePar: 'Karim Haddad', ...o,
  })).id;
  const astreinte = async (id: number) => (await db.get<Astreinte>('astreintes', id))!;
  const lots = async () => await db.all<Lot>('lotsPaie');
  const journal = async (action: string) => (await db.all<{ action: string; payload: Record<string, any>; salaries: number[] }>('journal')).filter(l => l.action === action);
  const ADMIN = await user(null, 'rh');
  const d = async () => new Domain(await loadFull(db, ADMIN));
  return { db, run, inserer, astreinte, lots, journal, d, user, ADMIN, PAIE: await user(7, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur') };
}

test('parts d’une astreinte : heures réparties entre les mois, période comptée le mois de son début', () => {
  assert.deepEqual(P.partsAstreinte({ du: '2026-09-28', debut: '18:00', au: '2026-10-05', fin: '08:00' }), [
    { mois: '2026-09', rubrique: 'AST_H', quantite: 54 },
    { mois: '2026-09', rubrique: 'AST_PER', quantite: 1 },
    { mois: '2026-10', rubrique: 'AST_H', quantite: 104 },
  ]);
  // Sur trois mois (31 jours au plus) : chaque mois a ses heures.
  assert.deepEqual(P.partsAstreinte({ du: '2026-11-30', debut: '20:00', au: '2027-01-01', fin: '06:30' }).map(p => [p.mois, p.rubrique, p.quantite]),
    [['2026-11', 'AST_H', 4], ['2026-11', 'AST_PER', 1], ['2026-12', 'AST_H', 744], ['2027-01', 'AST_H', 6.5]]);
  // Fin à minuit pile : rien le mois suivant.
  assert.deepEqual(P.partsAstreinte({ du: '2026-10-31', debut: '08:00', au: '2026-11-01', fin: '00:00' }).map(p => [p.mois, p.rubrique, p.quantite]),
    [['2026-10', 'AST_H', 16], ['2026-10', 'AST_PER', 1]]);
  assert.equal(P.totauxAstreintes([{ rubrique: 'AST_H', quantite: 54 }, { rubrique: 'AST_PER', quantite: 1 }, { rubrique: 'AST_H', quantite: 104 }]), '158 h d’astreinte (AST_H), 1 période (AST_PER)');
  assert.equal(P.etatPaieAstreinte({ lotId: 4, sage: true, annuleLe: null }), 'transmise à la paie (lot n° 4)');
  assert.equal(P.etatPaieAstreinte({ lotId: 4, sage: false, annuleLe: null }), 'dans le lot de paie n° 4, import à confirmer');
  assert.equal(P.etatPaieAstreinte({ lotId: null, sage: false, annuleLe: null }), null);
});

test('éléments : astreintes terminées seulement, mois clos en rappel, intérimaire et astreinte annulée exclus, rubrique active', async () => {
  const { inserer, d } = await fresh();
  const passee = await inserer('2026-09-28', '2026-10-05');
  await inserer('2026-10-09', '2026-10-12'); // en cours le 10 octobre : attend sa fin
  await inserer('2026-10-02', '2026-10-03', { annuleLe: '2026-09-30T10:00:00.000Z', annulePar: 'Karim Haddad', annuleMotif: 'Remplacé' });
  await inserer('2026-09-21', '2026-09-22', { empId: 15, equipe: null }); // intérimaire : payé par son agence
  const table = rubriquesPaie([]);
  let el = P.elementsAstreintes(await d(), '2026-10', table, MAINTENANT);
  // Septembre est clos le 10 octobre : ses heures et sa période partent en rappel sur octobre.
  assert.deepEqual(el.map(x => [x.astreinte, x.mois, x.periode, x.rubrique, x.quantite, x.codeSage]), [
    [passee, '2026-09', '2026-10', 'AST_H', 54, null],
    [passee, '2026-09', '2026-10', 'AST_PER', 1, null],
    [passee, '2026-10', '2026-10', 'AST_H', 104, null],
  ]);
  assert.equal(P.detailAstreinte(el[0], p => p), `Astreinte n° ${passee} du 28/09/2026 18:00 au 05/10/2026 08:00 · rappel de 2026-09`);
  assert.deepEqual(P.astreintesDuContenu(el), [{ id: passee, empId: 2 }]);
  // Le 12 octobre à 9 h, l'astreinte en cours est terminée ; rubrique AST_H active, AST_PER toujours à saisir.
  el = P.elementsAstreintes(await d(), '2026-10', table.map(r => (r.code === 'AST_H' ? { ...r, active: true, codeSage: '420' } : r)), instant('2026-10-12', '09:00'));
  assert.deepEqual(el.filter(x => x.astreinte !== passee).map(x => [x.rubrique, x.quantite, x.codeSage]), [['AST_H', 62, '420'], ['AST_PER', 1, null]]);
  // Lot d'une période antérieure à celle de ses parts : l'astreinte attend le lot suivant, entière.
  assert.deepEqual(P.elementsAstreintes(await d(), '2026-09', table, MAINTENANT), []);
});

test('lot de paie : AST_H et AST_PER désactivées, à saisir dans Sage ; réservées, libérées, transmises ; activées, dans le fichier', async () => {
  const { db, run, inserer, astreinte, lots, journal, ADMIN, PAIE } = await fresh();
  // lot 11 — notes de frais : famille « frais » en dernier.
  assert.deepEqual(FAMILLES.map(f => f.cle), ['sorties', 'deplacements', 'rachats', 'astreintes', 'frais']);
  for (const code of ['AST_H', 'AST_PER', 'AST_COMP']) assert.equal(RUBRIQUES_PAIE[code].inactiveParDefaut, true, code);
  const id = await inserer('2026-09-28', '2026-10-05');
  assert.match(await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' }), /1 astreinte .*à saisir dans Sage/);
  let lot = (await lots()).at(-1)!;
  assert.deepEqual(lot.astreintes, [{ id, empId: 2 }]);
  assert.deepEqual(lot.resume.astreintes, { elements: 3, salaries: 1 });
  assert.deepEqual(lot.resume.aSaisir?.filter(x => x.famille === 'astreintes').map(x => [x.rubrique, x.quantite, x.periode]),
    [['AST_H', 54, '2026-10'], ['AST_PER', 1, '2026-10'], ['AST_H', 104, '2026-10']]);
  assert.ok(!L.lignesFichier(lot.contenu!).some(x => x.rubrique.startsWith('AST')));
  assert.equal((await astreinte(id)).lotId, lot.id);
  assert.deepEqual((await journal('paie.lotGenerer')).at(-1)!.payload.astreintes, [id]);
  assert.ok((await journal('paie.lotGenerer')).at(-1)!.salaries.includes(2));
  // Export des variables : sous « À saisir dans Sage », avec le détail de l'astreinte.
  const v = (await variablesDeLaPeriode(db, PAIE, '2026-10')).filter(x => x.empId === 2 && x.detail.startsWith('Astreinte n°'));
  assert.deepEqual(v.map(x => [x.rubrique, x.quantite]).sort((a, b) => Number(a[1]) - Number(b[1])), [[A_SAISIR, 1], [A_SAISIR, 54], [A_SAISIR, 104]]);
  assert.match(v.find(x => x.quantite === 54)!.libelle, /^Heures d’astreinte/);
  assert.match(v.find(x => x.quantite === 54)!.detail, /rappel de septembre 2026$/);
  // Réservée : pas d'élément pour un autre lot tant que celui-ci n'est ni confirmé ni annulé.
  assert.deepEqual(P.elementsAstreintes(new Domain(await loadFull(db, ADMIN)), '2026-12', rubriquesPaie([]), MAINTENANT), []);
  // Annulation du lot : l'astreinte est de nouveau en attente (colonne `sage` vide d'une ligne d'avant l'étape 2 comprise).
  await run(PAIE, 'paie.lotAnnuler', { id: lot.id });
  assert.equal((await astreinte(id)).lotId, null);
  // Rubrique AST_H activée : ses heures partent dans le fichier sous leur code ; AST_PER reste à saisir dans Sage.
  await run(PAIE, 'paie.rubrique', { code: 'AST_H', active: true, codeSage: '420' });
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  lot = (await lots()).at(-1)!;
  assert.ok(L.lignesFichier(lot.contenu!).some(x => x.rubrique === '420' && x.quantite === 158 && x.periode === '2026-10'));
  assert.deepEqual(lot.resume.aSaisir?.filter(x => x.famille === 'astreintes').map(x => x.rubrique), ['AST_PER']);
  await run(PAIE, 'paie.lotConfirmer', { id: lot.id });
  assert.deepEqual([(await astreinte(id)).lotId, (await astreinte(id)).sage], [lot.id, true]);
  assert.equal(P.etatPaieAstreinte(await astreinte(id)), `transmise à la paie (lot n° ${lot.id})`);
  // Transmise : elle ne repart plus.
  assert.deepEqual(P.elementsAstreintes(new Domain(await loadFull(db, ADMIN)), '2026-12', rubriquesPaie([]), MAINTENANT), []);
});

test('instantanés : le service RH voit le lot de l’astreinte, ni le manager ni le salarié pour un autre', async () => {
  const { db, run, inserer, user, KARIM, MEHDI, PAIE } = await fresh();
  const id = await inserer('2026-09-28', '2026-10-05');
  await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const lotDe = async (u: User) => (await buildSnapshot(db, u)).astreintes?.find(a => a.id === id)?.lotId ?? null;
  assert.ok(await lotDe(await user(null, 'rh')));
  assert.ok(await lotDe(PAIE));
  assert.equal(await lotDe(KARIM), null);
  assert.ok(await lotDe(MEHDI), 'le salarié voit l’état de sa propre astreinte');
});

test('migration nommée lot7-astreintes-paie-index, migration PostgreSQL 0008 et référence au lot', { skip: PG && SQLITE_SEUL }, async () => {
  assert.ok(MIGRATIONS.includes(ASTREINTES_PAIE_INDEX));
  const { db } = await fresh();
  // Base neuve : migrations nommées appliquées (la nôtre comprise), puis plus rien.
  assert.ok((await appliquerMigrations(sqlite(db))).includes(ASTREINTES_PAIE_INDEX.nom));
  assert.deepEqual(await appliquerMigrations(sqlite(db)), []);
  // Base de l'étape 1 : sans l'index.
  await db.exec('DROP INDEX astreintes_lot');
  assert.equal(await ASTREINTES_PAIE_INDEX.necessaire!(sqlite(db)), true);
  assert.equal(await db.tx(async () => await ASTREINTES_PAIE_INDEX.executer(sqlite(db))), 'index astreintes_lot');
  assert.equal(await ASTREINTES_PAIE_INDEX.necessaire!(sqlite(db)), false);
  assert.ok(REFERENCES.some(r => r.table === 'astreintes' && r.colonne === 'lot_id' && r.cible === 'lots_paie'));
  const sql = readFileSync(new URL('../server/migrations-pg/0008_astreintes_paie.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE "astreintes" ADD COLUMN "lot_id" integer;/);
  assert.match(sql, /ALTER TABLE "astreintes" ADD COLUMN "sage" boolean DEFAULT false NOT NULL;/);
  assert.match(sql, /ALTER TABLE "lots_paie" ADD COLUMN "astreintes" json;/);
  assert.match(sql, /FOREIGN KEY \("lot_id"\) REFERENCES "lots_paie"\("id"\)/);
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?VIEW/);
});
