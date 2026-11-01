// Tests : entretiens suivis, étape 1 (lot 12, chantier C3, t194 ; shared/rules/objectifs.ts, shared/rules/souhaits.ts,
// server/src/actions/objectifs.ts, server/src/actions/souhaits.ts, server/src/vues-entretiens-suivis.ts).
// - règles pures : types interdits (parcours professionnel, art. L6315-1), saisie, poids, reprise des objectifs ouverts,
//   clôture bloquée selon le mode « objectifs facultatifs », compteurs par équipe sous le seuil d'anonymat, souhaits ;
// - cycle complet d'un objectif : fixation, proposition validée, clôture, avancement, ajustement motivé, évaluation à
//   l'annuel suivant, reconduction défaite ;
// - souhaits : avis, versement à la clôture des seuls favorables, doublons (demande en attente, souhaits identiques, aucun
//   second versement), origine « entretien » sur la ligne du plan ;
// - annulation d'un entretien : objectifs retirés ou rouverts ; instantané par espace et par profil ; journal sans texte
//   libre ; types du point de mi-année et du point de suivi en PostgreSQL ; point de mi-année dû par réglage.
// Jeu de démonstration au 10 octobre 2026 : Mehdi Benali (2), Maintenance, annuel planifié le 20 octobre ; Karim Haddad
// (12) encadre la Maintenance ; Hugo Lambert (16) la Logistique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET = randomBytes(32).toString('hex');
delete process.env.CURSUS_DEMO;

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { controlerOrphelins, REFERENCES } = await import('../server/src/integrite.ts');
const { migrationsPg } = await import('../server/src/db-pg.ts');
const { ENT_TYPES } = await import('../shared/constants.ts');
const { Domain } = await import('../shared/domain.ts');
const { obligations } = await import('../shared/rules/entretiens.ts');
const R = await import('../shared/rules/objectifs.ts');
const S = await import('../shared/rules/souhaits.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Compte = import('../server/src/comptes.ts').Compte;
type Objectif = import('../shared/types.ts').Objectif;
type Entretien = import('../shared/types.ts').Entretien;
type DemandeCollab = import('../shared/types.ts').DemandeCollab;

// — Règles pures —

const obj = (o: Partial<Objectif>): Objectif => ({
  id: 1, empId: 2, entretienId: 10, evalueEntretienId: null, reconduitDe: null, libelle: 'Objectif', mesure: null, categorie: 'individuel', poids: null, echeance: null,
  avancement: 0, statut: 'ouvert', evaluation: null, commentaireSal: null, creeLe: '', creePar: '', modifieLe: null, modifiePar: null, ajusteLe: null, ajusteMotif: null,
  libelleInitial: null, ...o,
});

test('règles : jamais d’objectif dans un entretien de parcours professionnel ; fixation et évaluation à l’annuel seulement', () => {
  for (const t of ['epp', 'reprise', 'bilan'] as const) assert.match(R.refusTypeObjectifs(t)!, /L6315-1/);
  assert.match(R.refusTypeObjectifs('forfait')!, /L3121-64/);
  assert.equal(R.refusTypeObjectifs('annuel', true), null);
  assert.equal(R.refusTypeObjectifs('mi_annee'), null, 'le point de mi-année porte le suivi');
  assert.match(R.refusTypeObjectifs('mi_annee', true)!, /entretien annuel/);
  assert.match(R.refusTypeObjectifs('point', true)!, /entretien annuel/);
  // Les deux nouveaux types existent, sans section d'objectifs rédigée par le salarié seul.
  assert.ok(ENT_TYPES.mi_annee.sections.some(s => s[0] === 'avancement') && ENT_TYPES.point.sections.length === 2);
});

test('règles : saisie d’un objectif (libellé, mesure, catégorie, poids, échéance) et de son avancement', () => {
  assert.deepEqual(R.lireObjectif({ libelle: '  Réduire   les arrêts ', categorie: 'collectif', poids: '30', echeance: '2027-06-30' }),
    { libelle: 'Réduire les arrêts', mesure: null, categorie: 'collectif', poids: 30, echeance: '2027-06-30' });
  assert.match(R.lireObjectif({ libelle: ' ' }) as string, /Libellé/);
  assert.match(R.lireObjectif({ libelle: 'x'.repeat(201) }) as string, /trop long/);
  assert.match(R.lireObjectif({ libelle: 'x', mesure: 'm'.repeat(501) }) as string, /trop long/);
  assert.match(R.lireObjectif({ libelle: 'x', categorie: 'prime' }) as string, /Catégorie/);
  assert.match(R.lireObjectif({ libelle: 'x', poids: 120 }) as string, /Poids/);
  assert.match(R.lireObjectif({ libelle: 'x', echeance: '2027-02-30' }) as string, /Échéance/);
  // Modification : un champ absent garde sa valeur, une valeur vide efface poids et échéance.
  const actuel = { libelle: 'A', mesure: 'M', categorie: 'individuel' as const, poids: 20, echeance: '2027-01-31' };
  assert.deepEqual(R.lireObjectif({ poids: '', echeance: null }, actuel), { ...actuel, poids: null, echeance: null });
  assert.equal(R.lireAvancement('50'), 50);
  assert.match(R.lireAvancement(101) as string, /0 à 100/);
  assert.match(R.lireAvancement('') as string, /0 à 100/);
  assert.match(R.lireAvancement(12.5) as string, /entier/);
});

test('règles : poids au plus 100 %, objectifs repris, clôture selon le mode « objectifs facultatifs »', () => {
  const liste = [obj({ id: 1, entretienId: 20, poids: 60 }), obj({ id: 2, entretienId: 20, poids: 30 })];
  assert.equal(R.refusPoids(liste, 20, 10), null);
  assert.match(R.refusPoids(liste, 20, 20)!, /110 %/);
  assert.equal(R.refusPoids(liste, 20, 70, 1), null, 'l’objectif modifié ne compte qu’une fois');
  const entretiens = [{ id: 10, statut: 'realise' as const }, { id: 20, statut: 'planifie' as const }];
  const x = { id: 20, empId: 2, type: 'annuel' as const };
  const objectifs = [
    obj({ id: 3, entretienId: 10 }), obj({ id: 4, entretienId: 10, statut: 'atteint', evalueEntretienId: 20 }), obj({ id: 5, entretienId: 10, statut: 'atteint', evalueEntretienId: 9 }),
    obj({ id: 6, entretienId: 20 }), obj({ id: 7, entretienId: 10, empId: 3 }),
  ];
  assert.deepEqual(R.objectifsARevoir(objectifs, entretiens, x).map(o => o.id), [3, 4], 'en cours d’un entretien clos, et ceux évalués à celui-ci');
  assert.deepEqual(R.objectifsARevoir(objectifs, entretiens, { ...x, type: 'mi_annee' }), []);
  const s = { objectifsActifs: true, objectifsFacultatifs: false };
  assert.match(R.blocageClotureObjectifs(objectifs, entretiens, x, s)!, /Un objectif de la période précédente à évaluer/);
  assert.equal(R.blocageClotureObjectifs(objectifs, entretiens, x, { ...s, objectifsFacultatifs: true }), null, 'mode facultatif');
  assert.equal(R.blocageClotureObjectifs(objectifs, entretiens, x, { ...s, objectifsActifs: false }), null);
  const propose = [...objectifs, obj({ id: 8, entretienId: 20, statut: 'propose' }), obj({ id: 9, entretienId: 20, statut: 'propose' })];
  assert.match(R.blocageClotureObjectifs(propose, entretiens, x, { ...s, objectifsFacultatifs: true })!, /2 objectifs proposés par le salarié : validez-les/, 'toujours');
});

test('règles : compteurs par équipe, sans libellé ni résultat, masqués sous 3 salariés', () => {
  const employes = [{ id: 1, equipe: 'Maintenance' }, { id: 2, equipe: 'Maintenance' }, { id: 3, equipe: 'Maintenance' }, { id: 4, equipe: 'Logistique' }];
  const c = R.compteursObjectifs([
    obj({ id: 1, empId: 1 }), obj({ id: 2, empId: 2, statut: 'atteint' }), obj({ id: 3, empId: 3, statut: 'non_atteint' }), obj({ id: 4, empId: 3, statut: 'propose' }),
    obj({ id: 5, empId: 4 }),
  ], employes);
  assert.deepEqual(c, [
    { equipe: 'Logistique', salaries: 0, objectifs: 0, ouverts: 0, evalues: 0, masque: true },
    { equipe: 'Maintenance', salaries: 3, objectifs: 3, ouverts: 1, evalues: 2 },
  ]);
  assert.ok(!JSON.stringify(c).includes('Objectif'));
});

test('règles : souhaits de formation (saisie, clés, versement des seuls favorables, motif fixe)', () => {
  const fm = (f: string) => (f === 'sst' ? {} : f === 'vieux' ? { archive: '2025-01-01' } : undefined);
  assert.deepEqual(S.lireSouhait({ f: 'sst' }, fm), { f: 'sst', libelle: null, priorite: 'normale', objectifId: null });
  assert.deepEqual(S.lireSouhait({ f: 'autre', libelle: ' Anglais  technique ', priorite: 'haute', objectifId: '4' }, fm), { f: null, libelle: 'Anglais technique', priorite: 'haute', objectifId: 4 });
  assert.match(S.lireSouhait({ f: 'xyz' }, fm) as string, /inconnue/);
  assert.match(S.lireSouhait({ f: 'vieux' }, fm) as string, /retirée du catalogue/);
  assert.match(S.lireSouhait({}, fm) as string, /requis/);
  assert.match(S.lireSouhait({ libelle: 'x'.repeat(201) }, fm) as string, /trop long/);
  assert.match(S.lireSouhait({ f: 'sst', priorite: 'urgente' }, fm) as string, /Priorité/);
  assert.match(S.lireSouhait({ f: 'sst', objectifId: 'a' }, fm) as string, /Objectif/);
  const s = (o: Partial<import('../shared/types.ts').SouhaitFormation>) => ({ cle: 's1', f: 'sst', libelle: null, priorite: 'normale' as const, objectifId: null, auteur: 'sal' as const, avis: null, demandeId: null, verseLe: null, nonVerse: null, ...o });
  assert.equal(S.nouvelleCle([]), 's1');
  assert.equal(S.nouvelleCle([s({ cle: 's1' }), s({ cle: 's4' })]), 's5');
  const x = { souhaits: [s({ cle: 's1', avis: 'favorable' }), s({ cle: 's2', avis: 'defavorable' }), s({ cle: 's3' }), s({ cle: 's4', avis: 'favorable', demandeId: 9 })] };
  assert.deepEqual(S.souhaitsAVerser(x).map(y => y.cle), ['s1'], 'favorable, jamais deux fois');
  assert.deepEqual(S.souhaitsSansAvis(x).map(y => y.cle), ['s3']);
  assert.equal(S.motifVersement('2026-10-06'), 'Souhait exprimé à l’entretien du 6 oct. 2026');
  assert.equal(S.refusTypeSouhaits('epp'), null);
  assert.match(S.refusTypeSouhaits('forfait')!, /parcours professionnel/);
  assert.deepEqual(S.souhaitsDe({ souhaits: null }), []);
});

test('migration 0024 : entretiens_type_check admet tous les types d’ENT_TYPES ; aucune vue pub_', () => {
  let valeurs: string[] = [];
  for (const m of migrationsPg()) {
    for (const r of m.sql.matchAll(/"entretiens_type_check" CHECK \("type" IN \(([^)]*)\)\)/g)) valeurs = [...r[1].matchAll(/'([^']+)'/g)].map(v => v[1]);
  }
  assert.deepEqual(valeurs.sort(), Object.keys(ENT_TYPES).sort());
  const m = migrationsPg().find(x => x.nom === '0024_entretiens_suivis')!;
  assert.ok(m, 'migration 0024');
  assert.doesNotMatch(m.sql, /CREATE (OR REPLACE )?VIEW/i);
  assert.match(m.sql, /ALTER TABLE "entretiens" DROP CONSTRAINT "entretiens_type_check";/);
  for (const t of ['objectifs', 'feedback_sollicitations', 'feedback_tampon', 'feedback_reponses']) assert.match(m.sql, new RegExp(`'${t}'`), `déclencheurs de ${t}`);
});

// — Sur la base —

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => (await db.one<Compte>(empId ? 'SELECT * FROM comptes WHERE emp_id = ?' : 'SELECT * FROM comptes WHERE emp_id IS NULL', empId ? [empId] : []))!;
  const personne = async (empId: number | null, role: User['role'] = 'rh') => (await currentUser(db, { compteId: (await compteDe(empId)).id, role, methode: 'demo' }))!;
  const u = {
    admin: await personne(null), gest: await personne(14), lecture: await personne(11), hse: await personne(23), paie: await personne(7),
    karim: await personne(12, 'manager'), hugo: await personne(16, 'manager'), mehdi: await personne(2, 'collaborateur'), thomas: await personne(6, 'collaborateur'),
  };
  const run = async (user: User, name: string, payload: Record<string, unknown>) => {
    const compte = await compteDe(user.empId ?? user.salarieId ?? null);
    return await db.tx(async () => {
      const t = await preparerTrace(db, name, payload);
      const r = await ACTIONS[name](makeCtx(db, user, await loadFull(db, user)), payload);
      const o = typeof r === 'object' && r !== null ? r : { message: r, result: undefined };
      await journaliserAction(db, t, { user, compte, message: o.message ?? null, result: o.result });
      return o as { message: string | null; result?: any };
    });
  };
  const refus = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, statut = 400) => {
    await assert.rejects(async () => await run(user, name, payload), (e: unknown) => {
      assert.ok(e instanceof ActionError, String(e));
      assert.equal(e.status, statut, e.message);
      assert.match(e.message, motif);
      return true;
    });
  };
  const reglages = async (r: Record<string, unknown>) => await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), ...r });
  const annuel = async (empId = 2) => (await db.one<{ id: number }>(`SELECT id FROM entretiens WHERE emp_id = ? AND type = 'annuel' AND statut = 'planifie'`, [empId]))!.id;
  const objectif = async (id: number) => (await db.get<Objectif>('objectifs', id))!;
  const entretien = async (id: number) => (await db.get<Entretien>('entretiens', id))!;
  const journal = async (action: string) => (await db.query<{ payload: unknown; message: string }>('SELECT payload, message FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ payload: (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, any>, message: l.message }));
  return { db, u, run, refus, reglages, annuel, objectif, entretien, journal };
}

test('types interdits : aucun objectif ni proposition dans un entretien de parcours professionnel, contrôle du serveur', async () => {
  const { u, run, refus, db } = await fresh();
  await run(u.karim, 'entretien.planifier', { empId: 2, kind: 'epp', date: '2026-11-16' });
  const epp = (await db.one<{ id: number }>(`SELECT id FROM entretiens WHERE emp_id = 2 AND type = 'epp' AND statut = 'planifie'`))!.id;
  await refus(u.karim, 'objectif.ajouter', { entretienId: epp, libelle: 'Objectif', categorie: 'individuel' }, /L6315-1/);
  await refus(u.mehdi, 'objectif.proposer', { entretienId: epp, libelle: 'Objectif', categorie: 'individuel' }, /L6315-1/);
  // Point de mi-année : planifiable, mais les objectifs ne s'y fixent pas.
  await run(u.karim, 'entretien.planifier', { empId: 2, kind: 'mi_annee', date: '2026-11-17' });
  const mi = (await db.one<{ id: number }>(`SELECT id FROM entretiens WHERE emp_id = 2 AND type = 'mi_annee'`))!.id;
  await refus(u.karim, 'objectif.ajouter', { entretienId: mi, libelle: 'Objectif', categorie: 'individuel' }, /fixent et s’évaluent à l’entretien annuel/);
  // Souhaits : l'entretien de parcours professionnel les recueille ; pas le forfait jours.
  await run(u.mehdi, 'entretien.souhait', { id: epp, f: 'sst' });
  assert.equal(await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM objectifs').then(r => Number(r!.n)), 0);
});

test('cycle d’un objectif : fixé, proposé puis validé, clôture, avancement, ajustement motivé, évaluation et reconduction', async () => {
  const { u, run, refus, reglages, annuel, objectif, entretien, journal, db } = await fresh();
  const x = await annuel();
  // Fixation par le manager ; un autre manager, un autre salarié, le profil en lecture seule sont refusés.
  const a = (await run(u.karim, 'objectif.ajouter', { entretienId: x, libelle: 'Réduire de 20 % les arrêts de la presse 3', mesure: 'Heures d’arrêt GMAO', categorie: 'individuel', poids: 60, echeance: '2027-06-30' })).result.id as number;
  await refus(u.hugo, 'objectif.ajouter', { entretienId: x, libelle: 'x', categorie: 'individuel' }, /évaluateur/, 403);
  await refus(u.thomas, 'objectif.proposer', { entretienId: x, libelle: 'x', categorie: 'individuel' }, /salarié/, 403);
  await refus(u.lecture, 'objectif.ajouter', { entretienId: x, libelle: 'x', categorie: 'individuel' }, /évaluateur/, 403);
  await refus(u.karim, 'objectif.ajouter', { entretienId: x, libelle: 'Deuxième', categorie: 'collectif', poids: 50 }, /110 %/);
  // Proposition du salarié : la clôture attend sa validation ; le manager la valide en la modifiant.
  const p = (await run(u.mehdi, 'objectif.proposer', { entretienId: x, libelle: 'Passer l’habilitation électrique BR', categorie: 'developpement' })).result.id as number;
  assert.equal((await objectif(p)).statut, 'propose');
  await refus(u.karim, 'entretien.clore', { id: x, date: '2026-10-09' }, /Un objectif proposé par le salarié/, 409);
  assert.match((await run(u.karim, 'objectif.modifier', { id: p, poids: 40 })).message!, /validé/);
  assert.equal((await objectif(p)).statut, 'ouvert');
  await run(u.karim, 'entretien.clore', { id: x, date: '2026-10-09' });
  // Entretien clos : objectifs figés, le salarié met à jour l'avancement avec un commentaire ; le manager ajuste.
  await refus(u.karim, 'objectif.modifier', { id: a, poids: 50 }, /figés/, 409);
  await run(u.mehdi, 'objectif.avancer', { id: a, avancement: 30, commentaire: 'Nouvelle procédure de graissage en place' });
  await refus(u.karim, 'objectif.avancer', { id: a, avancement: 40, commentaire: 'x' }, /commentaire est celui du salarié/);
  await refus(u.thomas, 'objectif.avancer', { id: a, avancement: 40 }, /salarié ou son évaluateur/, 403);
  await refus(u.karim, 'objectif.ajuster', { id: a, echeance: '2027-09-30' }, /Motif/);
  await refus(u.karim, 'objectif.ajuster', { id: a, motif: 'x' }, /Aucun changement/);
  await run(u.karim, 'objectif.ajuster', { id: a, libelle: 'Réduire de 15 % les arrêts de la presse 3', echeance: '2027-09-30', motif: 'Arrêt technique reporté à l’été' });
  let o = await objectif(a);
  assert.deepEqual([o.avancement, o.commentaireSal, o.ajusteLe, o.libelleInitial, o.echeance], [30, 'Nouvelle procédure de graissage en place', '2026-10-10', 'Réduire de 20 % les arrêts de la presse 3', '2027-09-30']);
  await run(u.karim, 'objectif.ajuster', { id: a, libelle: 'Réduire de 10 % les arrêts', motif: 'Second ajustement' });
  assert.equal((await objectif(a)).libelleInitial, 'Réduire de 20 % les arrêts de la presse 3', 'libellé d’origine conservé');
  // Annuel suivant : évaluation exigée pour clore (mode obligatoire), reconduction créée puis défaite.
  await run(u.karim, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-12-01' });
  const y = await annuel();
  await refus(u.karim, 'objectif.evaluer', { id: a, entretienId: x, statut: 'atteint' }, /clos/, 409);
  await refus(u.karim, 'objectif.evaluer', { id: a, entretienId: y, statut: 'sans_objet' }, /indiquez pourquoi/);
  await refus(u.karim, 'objectif.evaluer', { id: a, entretienId: y, statut: 'super' }, /Résultat inconnu/);
  await reglages({ objectifsFacultatifs: false });
  await db.exec(`UPDATE entretiens SET date = '2026-10-10' WHERE id = ${y}`);
  await refus(u.karim, 'entretien.clore', { id: y }, /2 objectifs de la période précédente à évaluer/, 409);
  const r1 = await run(u.karim, 'objectif.evaluer', { id: a, entretienId: y, statut: 'reconduit', echeance: '2027-12-31' });
  const enfant = r1.result.reconduit as number;
  assert.deepEqual([(await objectif(enfant)).reconduitDe, (await objectif(enfant)).entretienId, (await objectif(enfant)).statut, (await objectif(enfant)).echeance], [a, y, 'ouvert', '2027-12-31']);
  await refus(u.karim, 'objectif.retirer', { id: enfant }, /changez l’évaluation/, 409);
  await run(u.karim, 'objectif.evaluer', { id: a, entretienId: y, statut: 'partiel', evaluation: 'Gain de 12 %' });
  assert.equal(await db.get('objectifs', enfant), undefined, 'reconduction défaite : ligne retirée');
  o = await objectif(a);
  assert.deepEqual([o.statut, o.evalueEntretienId, o.evaluation], ['partiel', y, 'Gain de 12 %']);
  await run(u.karim, 'objectif.evaluer', { id: p, entretienId: y, statut: 'atteint' });
  await refus(u.karim, 'objectif.avancer', { id: p, avancement: 100 }, /atteint/, 409);
  await run(u.karim, 'entretien.clore', { id: y });
  assert.equal((await entretien(y)).statut, 'realise');
  // Journal : identifiants, codes, dates ; jamais le libellé, la mesure, l'évaluation ni un commentaire.
  const textes = JSON.stringify([...await journal('objectif.ajouter'), ...await journal('objectif.avancer'), ...await journal('objectif.ajuster'), ...await journal('objectif.evaluer'), ...await journal('objectif.proposer')]);
  for (const t of ['presse', 'GMAO', 'graissage', 'Gain de 12', 'habilitation électrique', 'Arrêt technique']) assert.ok(!textes.includes(t), t);
  assert.ok(textes.includes('[texte renseigné]'));
  const evalue = (await journal('objectif.evaluer')).at(-1)!.payload;
  assert.equal(evalue.resultat, 'atteint');
});

test('souhaits : avis du manager, versement des seuls favorables à la clôture, doublons, origine « entretien » au plan', async () => {
  const { u, run, refus, annuel, entretien, journal, db } = await fresh();
  const x = await annuel();
  // Demande identique déjà en attente pour Mehdi (formation SST) : le souhait favorable n'est pas versé une seconde fois.
  await run(u.mehdi, 'demande.formation', { f: 'sst', motif: 'Recyclage' });
  const s1 = (await run(u.mehdi, 'entretien.souhait', { id: x, f: 'sst' })).result.cle;
  const s2 = (await run(u.mehdi, 'entretien.souhait', { id: x, f: 'autre', libelle: 'Anglais technique', priorite: 'haute' })).result.cle;
  const s3 = (await run(u.karim, 'entretien.souhait', { id: x, f: 'autre', libelle: 'anglais technique' })).result.cle;
  const s4 = (await run(u.mehdi, 'entretien.souhait', { id: x, f: 'autre', libelle: 'Soudure TIG' })).result.cle;
  const s5 = (await run(u.mehdi, 'entretien.souhait', { id: x, f: 'autre', libelle: 'Gestion du stress' })).result.cle;
  assert.deepEqual([s1, s2, s3, s4, s5], ['s1', 's2', 's3', 's4', 's5']);
  // Chacun ses souhaits ; l'avis revient à l'évaluateur ; un autre manager est refusé.
  await refus(u.karim, 'entretien.souhait', { id: x, op: 'modifier', cle: s2, libelle: 'Anglais' }, /donnez votre avis/, 403);
  await refus(u.mehdi, 'entretien.avisSouhait', { id: x, cle: s2, avis: 'favorable' }, /propres souhaits|évaluateur/, 403);
  await refus(u.hugo, 'entretien.avisSouhait', { id: x, cle: s2, avis: 'favorable' }, /évaluateur/, 403);
  await refus(u.karim, 'entretien.avisSouhait', { id: x, cle: s2, avis: 'peut-être' }, /Avis inconnu/);
  for (const [cle, avis] of [[s1, 'favorable'], [s2, 'favorable'], [s3, 'favorable'], [s4, 'favorable'], [s5, 'defavorable']]) await run(u.karim, 'entretien.avisSouhait', { id: x, cle, avis });
  // Le salarié réécrit un souhait : l'avis donné ne vaut plus.
  await run(u.mehdi, 'entretien.souhait', { id: x, op: 'modifier', cle: s4, libelle: 'Soudure TIG inox' });
  assert.equal((await entretien(x)).souhaits!.find(s => s.cle === s4)!.avis, null);
  await run(u.mehdi, 'entretien.souhait', { id: x, op: 'retirer', cle: s4 });
  const r = await run(u.karim, 'entretien.clore', { id: x, date: '2026-10-09' });
  assert.match(r.message!, /1 souhait de formation versé au service RH · 2 souhaits déjà demandés ou sans suite/);
  const demandes = (await db.all<DemandeCollab>('demandesCollab')).filter(d => d.entretienId === x);
  assert.equal(demandes.length, 1, 'un seul versement pour deux souhaits identiques (anglais)');
  assert.deepEqual([demandes[0].libelle, demandes[0].f, demandes[0].parId, demandes[0].motif, demandes[0].statut], ['Anglais technique', null, 12, 'Souhait exprimé à l’entretien du 9 oct. 2026', 'attente']);
  const souhaits = (await entretien(x)).souhaits!;
  assert.deepEqual(souhaits.map(s => [s.cle, s.demandeId ? 'demande' : null, s.nonVerse]), [
    ['s1', 'demande', 'deja_demande'], ['s2', 'demande', null], ['s3', 'demande', 'deja_demande'], ['s5', null, null],
  ]);
  assert.equal(souhaits.find(s => s.cle === s3)!.demandeId, demandes[0].id);
  // Souhaits figés après la clôture ; jamais versés deux fois.
  await refus(u.mehdi, 'entretien.souhait', { id: x, f: 'sst' }, /figés/, 409);
  // Le service RH accepte la demande versée : ligne du plan d'origine « entretien ».
  await run(u.admin, 'demande.accepter', { id: demandes[0].id });
  const plan = (await db.all<{ origine: string; libelle: string }>('planActions')).filter(l => l.libelle === 'Anglais technique');
  assert.deepEqual(plan.map(l => l.origine), ['entretien']);
  // Journal : ni intitulé libre ni avis en texte ; la clôture liste la demande versée.
  const j = JSON.stringify([...await journal('entretien.souhait'), ...await journal('entretien.avisSouhait')]);
  for (const t of ['Anglais', 'Soudure', 'stress']) assert.ok(!j.includes(t), t);
  assert.deepEqual((await journal('entretien.clore')).at(-1)!.payload.demandes, [demandes[0].id]);
});

test('annulation d’un entretien : objectifs fixés retirés, objectifs évalués rouverts ; sortie sans référence orpheline', async () => {
  const { u, run, annuel, objectif, db } = await fresh();
  const x = await annuel();
  const a = (await run(u.karim, 'objectif.ajouter', { entretienId: x, libelle: 'A', categorie: 'individuel' })).result.id as number;
  await run(u.karim, 'entretien.clore', { id: x, date: '2026-10-09' });
  await run(u.karim, 'entretien.planifier', { empId: 2, kind: 'annuel', date: '2026-12-01' });
  const y = await annuel();
  const enfant = (await run(u.karim, 'objectif.evaluer', { id: a, entretienId: y, statut: 'reconduit' })).result.reconduit as number;
  const b = (await run(u.karim, 'objectif.ajouter', { entretienId: y, libelle: 'B', categorie: 'collectif' })).result.id as number;
  const r = await run(u.karim, 'entretien.annuler', { id: y, confirmer: true });
  assert.match(r.message!, /2 objectifs fixés retirés · 1 objectif évalué de nouveau en cours/);
  assert.deepEqual([(await objectif(a)).statut, (await objectif(a)).evalueEntretienId], ['ouvert', null]);
  for (const id of [enfant, b]) assert.equal(await db.get('objectifs', id), undefined);
  assert.equal((await controlerOrphelins(db, [...REFERENCES])).orphelins, 0);
});

test('instantané : objectifs du périmètre pour le manager et le salarié, compteurs pour la lecture seule, rien pour le référent HSE et la paie', async () => {
  const { u, run, annuel, reglages, db } = await fresh();
  const x = await annuel();
  await run(u.karim, 'objectif.ajouter', { entretienId: x, libelle: 'Objectif de Mehdi', categorie: 'individuel' });
  await run(u.karim, 'entretien.souhait', { id: x, f: 'autre', libelle: 'Formation confidentielle' });
  const ids = async (user: User) => ((await buildSnapshot(db, user, { cache: false })).objectifs ?? []).map(o => o.empId);
  assert.deepEqual(await ids(u.karim), [2]);
  assert.deepEqual(await ids(u.mehdi), [2]);
  assert.deepEqual(await ids(u.thomas), []);
  assert.deepEqual(await ids(u.hugo), []);
  assert.deepEqual(await ids(u.admin), [2]);
  for (const p of [u.lecture, u.hse, u.paie]) {
    const v = await buildSnapshot(db, p, { cache: false });
    assert.deepEqual(v.objectifs, [], p.profilRh!);
    assert.ok(!JSON.stringify(v).includes('Formation confidentielle'), `${p.profilRh} : souhait`);
    assert.ok(!JSON.stringify(v).includes('Objectif de Mehdi'), `${p.profilRh} : objectif`);
    assert.deepEqual(v.feedbackSollicitations ?? [], []);
  }
  // Lecture seule : compteurs par équipe (Maintenance masquée sous 3 salariés concernés).
  assert.deepEqual((await buildSnapshot(db, u.lecture, { cache: false })).compteursObjectifs, [{ equipe: 'Maintenance', salaries: 0, objectifs: 0, ouverts: 0, evalues: 0, masque: true }]);
  assert.deepEqual((await buildSnapshot(db, u.hse, { cache: false })).compteursObjectifs, []);
  // Consultation N+2 : la Maintenance rattachée à la Production, Hugo n'en reçoit que les compteurs.
  await db.run(`UPDATE equipes SET parente = 'Logistique' WHERE nom = 'Maintenance'`);
  await reglages({ consultationN2: true });
  const n2 = await buildSnapshot(db, u.hugo, { cache: false });
  assert.deepEqual(n2.objectifs, []);
  assert.equal(n2.compteursObjectifs?.length, 1);
  assert.ok(!JSON.stringify(n2).includes('Objectif de Mehdi'));
});

test('point de mi-année : aucune obligation par défaut, due dans sa fenêtre quand le réglage la rend obligatoire', async () => {
  const { db, reglages, u } = await fresh();
  const mi = async () => obligations(new Domain(await loadFull(db, { role: 'rh', empId: null, nom: 'Essai', intitule: '', profilRh: 'rh_admin' })), [2]).filter(o => o.kind === 'mi_annee');
  assert.deepEqual(await mi(), []);
  await reglages({ pointMiAnneeActif: true, pointMiAnneeDebut: '05-01', pointMiAnneeFin: '07-15' });
  const [o] = await mi();
  assert.deepEqual([o.due, o.st, o.detail], ['2026-07-15', 'late', 'Point de mi-année 2026 — du 1er mai au 15 juillet']);
  // Tenu dans l'année : plus dû.
  await db.insert('entretiens', { empId: 2, type: 'mi_annee', date: '2026-06-10', statut: 'realise', cr: {}, info: true, signSal: null, signMgr: '2026-06-10' });
  assert.deepEqual(await mi(), []);
  assert.ok(u.admin);
});
