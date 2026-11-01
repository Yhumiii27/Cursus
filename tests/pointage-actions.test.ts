// Lot 12, chantier C6 (badgeage virtuel, t191), étape 1 : actions, routes, vues, journal, conservation et cache.
// - module désactivé : pointer et corriger refusés ; activation refusée sans l'accord ni l'avis du CSE ;
// - pointage.pointer : pour soi seulement, population badgée, sens déduit, doublon sous 60 s, heure du serveur en ligne,
//   heure de l'appareil hors ligne (« différé »), jamais de position, jamais au journal ;
// - corrections : demande du salarié sous 7 jours, validation et refus par le valideur « feuilles » (jamais soi-même),
//   saisie du valideur validée d'emblée, neutralisation par une ligne ajoutée, feuille validée refusée, journal sans texte ;
// - pointages en ajouts seulement (déclencheur, sur les deux moteurs), mode figé sur la feuille créée ;
// - GET /api/pointages (6 semaines) et /etat : le salarié, son manager, le service RH ; refus tracé pour les autres ;
// - instantané : demandes de correction par salarié (manager : son équipe), aucune pour les profils restreints, jamais
//   un pointage ; banc d'oracle avec les actions du badgeage ;
// - conservation : purge au-delà de la durée réglée, cascade de l'anonymisation, export des données du salarié.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_SECRET ??= randomBytes(32).toString('hex');

const { nouvelleBase, json } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { createApp } = await import('../server/src/app.ts');
const { empreinteSession, sign } = await import('../server/src/auth.ts');
const { purgerPointages, instantServeur, etatDuSalarie, bilanPeriode, lirePointages, theoriques } = await import('../server/src/pointages.ts');
const { instantParis } = await import('../shared/rules/pointage.ts');
const { effacer } = await import('../server/src/conservation.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { HORS_INSTANTANE, LECTURES } = await import('../server/src/lecture-brute.ts');
const { TABLES_CHANGEMENTS_SANS_CLE } = await import('../server/src/db.ts');
const { libelleAction, familleAction } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type Pointage = import('../shared/types.ts').Pointage;
type Correction = import('../shared/types.ts').CorrectionPointage;

const serveurs: Server[] = [];
after(() => { for (const s of serveurs) s.close(); });

const ACCORD = 'Accord d’entreprise sur le temps de travail du 1er mars 2026';
const POPULATION = [{ critere: 'equipe', valeur: 'Maintenance', mode: 'controle', effet: '2026-01-01' }];

async function fresh(actif = true) {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;
  const personne = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const P = {
    admin: await personne(null, 'rh'), gest: await personne(14, 'rh'), mgr: await personne(12, 'manager'), autM: await personne(16, 'manager'),
    coll: await personne(2, 'collaborateur'), autC: await personne(6, 'collaborateur'), hse: await personne(23, 'rh'), paie: await personne(7, 'rh'), lect: await personne(11, 'rh'),
  };
  const run = async (user: User, name: string, payload: Record<string, unknown>, o: { horsLigne?: boolean } = {}) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const ctx = makeCtx(db, user, await loadFull(db, user));
    ctx.horsLigne = o.horsLigne;
    const r = await ACTIONS[name](ctx, payload);
    const x = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user, compte: { id: 0, identifiant: user.nom } as never, message: x.message ?? null, result: x.result, horsLigne: o.horsLigne });
    return x as { message: string; result?: Record<string, any> };
  });
  const refuse = async (user: User, name: string, payload: Record<string, unknown>, motif: RegExp, status = 400, o: { horsLigne?: boolean } = {}) =>
    await assert.rejects(async () => await run(user, name, payload, o), (e: unknown) => e instanceof ActionError && motif.test(e.message) && e.status === status, `${name} : ${motif}`);
  const journal = async (action: string) => (await db.query<{ message: string; payload: unknown; salaries: unknown }>('SELECT message, payload, salaries FROM journal WHERE action = ? ORDER BY id', [action]))
    .map(l => ({ message: l.message, payload: json<Record<string, unknown>>(l.payload), salaries: json<number[]>(l.salaries) }));
  if (actif) await run(P.admin, 'parametres.maj', { pointageActif: true, pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointagePopulations: POPULATION });
  return { db, P, run, refuse, journal, compteDe };
}
const pointages = async (db: Db, empId = 2) => await db.query<Record<string, unknown>>('SELECT * FROM pointages WHERE emp_id = ? ORDER BY id', [empId]);

test('module désactivé par défaut : pointer et corriger refusés ; activation refusée sans l’accord ni l’avis du CSE', async () => {
  const { P, run, refuse, journal } = await fresh(false);
  await refuse(P.coll, 'pointage.pointer', { empId: 2 }, /Badgeage désactivé/, 409);
  await refuse(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-09T06:00:00Z', sens: 'E', motif: 'oubli' }, /Badgeage désactivé/, 409);
  await refuse(P.admin, 'parametres.maj', { pointageActif: true }, /référence de l’accord d’entreprise et la date de l’avis du CSE/);
  await refuse(P.admin, 'parametres.maj', { pointageActif: true, pointageAccord: ACCORD }, /avis du CSE/);
  await run(P.admin, 'parametres.maj', { pointageActif: true, pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointagePopulations: POPULATION });
  // Journal des réglages : la référence de l'accord n'y est que « renseignée ».
  const j = (await journal('parametres.maj')).at(-1)!;
  assert.ok(!JSON.stringify(j.payload).includes('1er mars'), 'référence de l’accord jamais recopiée');
  assert.match(JSON.stringify(j.payload), /\[texte renseigné\]/);
  assert.equal(familleAction('pointage.corriger')?.label, 'Temps — badgeage');
});

test('pointer : pour soi, population badgée, sens déduit, doublon, jamais au journal ; hors ligne différé sans position', async () => {
  const { db, P, run, refuse, journal } = await fresh();
  await refuse(P.mgr, 'pointage.pointer', { empId: 2 }, /pour lui-même/, 403);
  await refuse(P.admin, 'pointage.pointer', {}, /pour lui-même/, 403);
  // Hugo Lambert (Logistique) n'est pas dans une population badgée.
  await refuse(P.autM, 'pointage.pointer', { empId: 16 }, /ne faites pas partie d’une population/, 409);
  await refuse(P.coll, 'pointage.pointer', { empId: 2, horodatageAppareil: '2026-10-10T05:00:00Z' }, /celle du serveur/);
  await refuse(P.coll, 'pointage.pointer', { empId: 2, position: { lat: 48.5, lng: 7.7 } }, /Géolocalisation désactivée/);
  await refuse(P.coll, 'pointage.pointer', { empId: 2, sens: 'X' }, /Sens du pointage invalide/);
  const a = await run(P.coll, 'pointage.pointer', { empId: 2 });
  assert.match(a.message, /^Arrivée pointée à \d{2}:\d{2}$/);
  assert.equal(a.result!.sens, 'E');
  // Double appui : rien d'ajouté.
  const b = await run(P.coll, 'pointage.pointer', { empId: 2 });
  assert.equal(b.result!.doublon, true);
  assert.match(b.message, /déjà pointée/);
  assert.equal((await pointages(db)).length, 1);
  // Sortie : sens déduit de l'entrée en cours (une minute plus tard au moins, sinon doublon de sens différent admis).
  const c = await run(P.coll, 'pointage.pointer', { empId: 2, sens: 'S' });
  assert.equal(c.result!.sens, 'S');
  const lignes = await pointages(db);
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].source, 'virtuel');
  assert.equal(lignes[0].jour, '2026-10-10', 'jour de Paris de la date de Cursus');
  assert.equal(String(lignes[0].horodatage).slice(0, 10) <= '2026-10-10', true);
  // Aucune ligne de journal par pointage ordinaire.
  assert.deepEqual(await journal('pointage.pointer'), []);
  assert.match(libelleAction('pointage.pointer'), /jamais tracé/);
  // Hors ligne : heure de l'appareil gardée, marquée « différée » ; réglage fermé : refus.
  const appareil = new Date(instantServeur() - 30 * 60_000).toISOString();
  const d = await run(P.autC, 'pointage.pointer', { empId: 6, horodatageAppareil: appareil, sens: 'E' }, { horsLigne: true });
  assert.match(d.message, /pointage différé, fait hors ligne/);
  const [hl] = await pointages(db, 6);
  assert.equal(hl.horodatage, appareil);
  assert.ok([1, true].includes(hl.hors_ligne as never));
  assert.notEqual(hl.recu_le, appareil, 'réception par le serveur gardée à côté');
  await refuse(P.autC, 'pointage.pointer', { empId: 6, horodatageAppareil: new Date(instantServeur() + 3_600_000).toISOString() }, /en avance/, 422, { horsLigne: true });
  await refuse(P.autC, 'pointage.pointer', { empId: 6 }, /heure de l’appareil manquante/, 422, { horsLigne: true });
  await run(P.admin, 'parametres.maj', { pointageHorsLigne: false });
  await refuse(P.autC, 'pointage.pointer', { empId: 6, horodatageAppareil: appareil }, /hors ligne non admis/, 409, { horsLigne: true });
});

test('pointages en ajouts seulement : toute modification refusée par la base (déclencheur)', async () => {
  const { db, P, run } = await fresh();
  // Déclencheur posé par la migration nommée lot12-badgeage-pointages en SQLite (0027_badgeage en PostgreSQL).
  await mettreAJourBase(db);
  const { result } = await run(P.coll, 'pointage.pointer', { empId: 2 });
  await assert.rejects(db.tx(async () => { await db.run('UPDATE pointages SET sens = ? WHERE id = ?', ['S', result!.id]); }), /ajouts seulement/);
  assert.equal((await pointages(db))[0].sens, 'E');
});

test('corrections : demande sous 7 jours, validation et refus par le valideur, neutralisation, journal sans texte libre', async () => {
  const { db, P, run, refuse, journal } = await fresh();
  const demande = { empId: 2, nature: 'ajout', horodatage: '2026-10-09T05:30:00Z', sens: 'E', motif: 'oubli', commentaire: 'Badge resté au vestiaire, Mehdi' };
  await refuse(P.coll, 'pointage.corriger', { ...demande, motif: 'flemme' }, /Motif de la correction/);
  await refuse(P.coll, 'pointage.corriger', { ...demande, horodatage: '2026-09-30T05:30:00Z' }, /plus de 7 jours/, 409);
  await refuse(P.coll, 'pointage.corriger', { ...demande, horodatage: '2026-10-11T05:30:00Z' }, /à venir/);
  await refuse(P.coll, 'pointage.corriger', { ...demande, sens: undefined }, /arrivée ou d’un départ/);
  await refuse(P.coll, 'pointage.corriger', { ...demande, commentaire: 'x'.repeat(301) }, /300 caractères/);
  await refuse(P.autC, 'pointage.corriger', demande, /réservée au salarié/, 403);
  await refuse(P.autM, 'pointage.corriger', demande, /réservée au salarié/, 403);
  await refuse(P.paie, 'pointage.corriger', demande, /réservée au salarié/, 403);
  const c = await run(P.coll, 'pointage.corriger', demande);
  assert.match(c.message, /^Correction demandée : ajout d’un pointage du 9 oct\. 2026 \(Mehdi Benali\), en attente de validation$/);
  const id = c.result!.id as number;
  // Le salarié ne valide pas sa propre demande ; le manager d'une autre équipe non plus.
  await refuse(P.coll, 'pointage.validerCorrection', { id }, /réservée au manager du salarié/, 403);
  await refuse(P.autM, 'pointage.validerCorrection', { id }, /hors de votre périmètre/, 403);
  await refuse(P.mgr, 'pointage.refuserCorrection', { id }, /Motif du refus requis/);
  const v = await run(P.mgr, 'pointage.validerCorrection', { id });
  assert.match(v.message, /Correction validée/);
  await refuse(P.mgr, 'pointage.validerCorrection', { id }, /déjà traitée/, 409);
  const cree = (await pointages(db)).find(x => x.source === 'correction')!;
  assert.equal(cree.correction_id, id);
  const lue = (await db.get<Correction>('correctionsPointage', id))!;
  assert.deepEqual([lue.statut, lue.decidePar, lue.pointageCreeId], ['validee', 'Karim Haddad', cree.id]);
  // Neutralisation du pointage ajouté : une ligne qui le désigne, rien de modifié ; demande en double refusée.
  const n = await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: cree.id, motif: 'autre' });
  await refuse(P.coll, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: cree.id, motif: 'autre' }, /déjà en attente/, 409);
  await refuse(P.gest, 'pointage.refuserCorrection', { id: n.result!.id, motif: 'x'.repeat(301) }, /300 caractères/);
  await run(P.gest, 'pointage.refuserCorrection', { id: n.result!.id, motif: 'Présence constatée par l’équipe, Karim' });
  const n2 = await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: cree.id, motif: 'autre' });
  await run(P.coll, 'pointage.annulerCorrection', { id: n2.result!.id });
  // Saisie par le valideur : validée d'emblée, l'origine est gardée (demande qui n'est pas de l'intéressé).
  const m = await run(P.mgr, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: cree.id, motif: 'oubli' });
  assert.match(m.message, /^Correction enregistrée : retrait d’un pointage/);
  const neutre = (await pointages(db)).find(x => x.annule_id === cree.id)!;
  assert.equal(neutre.source, 'correction');
  assert.equal((await db.get<Correction>('correctionsPointage', m.result!.id))!.demandeParInteresse, false);
  await refuse(P.mgr, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: cree.id, motif: 'oubli' }, /déjà retiré/, 409);
  // Le service RH corrige au-delà du délai ; pas le salarié.
  await run(P.gest, 'pointage.corriger', { ...demande, horodatage: '2026-09-01T05:30:00Z' });
  // Journal : identifiants, jour, nature, motif codé, statut ; jamais le commentaire, le motif d'un refus ni une heure.
  const lignes = [...await journal('pointage.corriger'), ...await journal('pointage.validerCorrection'), ...await journal('pointage.refuserCorrection'), ...await journal('pointage.annulerCorrection')];
  assert.equal(lignes.length, 8);
  for (const l of lignes) {
    const texte = JSON.stringify(l);
    assert.ok(!/vestiaire|constatée|05:30|07:30/.test(texte), texte);
    assert.deepEqual(l.salaries, [2]);
  }
  assert.deepEqual((await journal('pointage.corriger'))[0].payload, { id, jour: '2026-10-09', nature: 'ajout', motif: 'oubli', statut: 'demandee' });
  // Feuille validée : la correction passe par la réouverture.
  await db.tx(async () => { await db.insert('feuilles', { empId: 6, week: '2026-10-05', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [] }); });
  await refuse(P.autC, 'pointage.corriger', { ...demande, empId: 6 }, /déjà validée : la correction passe par sa réouverture/, 409);
});

test('feuille créée : mode de la population figé ; déclarative sans population', async () => {
  const { db, P, run } = await fresh();
  await run(P.coll, 'temps.addLine', { empId: 2, week: '2026-10-19', projet: 'INT-MAINT' });
  const f = (await db.where<Record<string, unknown>>('feuilles', 'empId', 2)).find(x => x.week === '2026-10-19')!;
  assert.equal(f.modeTemps, 'controle');
  // Les populations changent ensuite : la feuille garde son mode.
  await run(P.admin, 'parametres.maj', { pointagePopulations: [{ ...POPULATION[0], mode: 'calcule' }] });
  assert.equal((await db.get<Record<string, unknown>>('feuilles', f.id))!.modeTemps, 'controle');
  const autre = (await db.query<{ id: number }>(`SELECT id FROM employes WHERE equipe <> 'Maintenance' AND fin IS NULL ORDER BY id LIMIT 1`))[0].id;
  await run(P.admin, 'temps.addLine', { empId: autre, week: '2026-10-19', projet: 'INT-MAINT' });
  assert.equal((await db.where<Record<string, unknown>>('feuilles', 'empId', autre)).find(x => x.week === '2026-10-19')!.modeTemps, null);
});

test('avenant : les feuilles figées des semaines précédentes reçoivent le mode de la population badgée', async () => {
  const { db, P, run } = await fresh();
  // Mehdi (Maintenance, « controle » depuis le 1er janvier) passe à 35 h au 5 octobre : semaines sans feuille figées.
  await run(P.admin, 'employe.modifier', { id: 2, temps: '35h', tempsDepuis: '2026-10-05' });
  const figees = (await db.where<{ week: string; modeTemps?: string | null }>('feuilles', 'empId', 2)).filter(f => f.week >= '2026-08-10' && f.week <= '2026-09-14');
  assert.equal(figees.length, 6);
  assert.ok(figees.every(f => f.modeTemps === 'controle'), JSON.stringify(figees.map(f => [f.week, f.modeTemps])));
});

test('feuille validée : pointage différé refusé, et poste de nuit du dimanche au lundi rattaché à la semaine validée', async () => {
  const { db, P, run, refuse } = await fresh();
  // Feuille du 28 septembre de Mehdi validée (jeu de démonstration).
  assert.equal((await db.where<Record<string, unknown>>('feuilles', 'empId', 2)).find(f => f.week === '2026-09-28')!.statut, 'validee');
  await db.tx(async () => { await db.insert('feuilles', { empId: 2, week: '2026-10-05', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [] }); });
  // Hors ligne : la file rejoue un pointage antidaté dans la semaine validée : refusé, rien n'est inséré.
  await refuse(P.coll, 'pointage.pointer', { empId: 2, horodatageAppareil: '2026-10-08T06:00:00Z', sens: 'E' }, /déjà validée : ce pointage hors ligne n’est pas enregistré/, 409, { horsLigne: true });
  // Heure sans fuseau : refusée (sinon lue dans le fuseau du processus).
  await refuse(P.coll, 'pointage.pointer', { empId: 2, horodatageAppareil: '2026-10-10T08:00', sens: 'E' }, /instant avec fuseau attendu/, 422, { horsLigne: true });
  await refuse(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-09T08:00', sens: 'E', motif: 'oubli' }, /instant avec fuseau attendu/);
  assert.equal((await pointages(db)).length, 0);
  // Semaine du 5 octobre rouverte (brouillon) ; poste du dimanche 4 octobre 21 h au lundi 5 à 5 h, rattaché au dimanche.
  await db.tx(async () => { await db.run('DELETE FROM feuilles WHERE emp_id = ? AND week = ?', [2, '2026-10-05']); });
  const entree = await db.tx(async () => await db.insert<Pointage>('pointages', { empId: 2, horodatage: '2026-10-04T19:00:00.000Z', jour: '2026-10-04', sens: 'E', source: 'virtuel', horsLigne: false, recuLe: '2026-10-04T19:00:00.000Z', annuleId: null }));
  // Ajout de la sortie oubliée du lundi 5 h : elle clôt le poste du dimanche, semaine validée.
  await refuse(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-05T03:00:00Z', sens: 'S', motif: 'oubli' }, /déjà validée/, 409);
  const sortie = await db.tx(async () => await db.insert<Pointage>('pointages', { empId: 2, horodatage: '2026-10-05T03:00:00.000Z', jour: '2026-10-05', sens: 'S', source: 'virtuel', horsLigne: false, recuLe: '2026-10-05T03:00:00.000Z', annuleId: null }));
  // Neutralisation de cette sortie (jour calendaire : lundi 5) : refusée, le poste est rattaché au dimanche 4.
  await refuse(P.coll, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: sortie.id, motif: 'autre' }, /déjà validée/, 409);
  await refuse(P.coll, 'pointage.corriger', { empId: 2, nature: 'neutralisation', pointageId: entree.id, motif: 'autre' }, /déjà validée/, 409);
  // Une arrivée oubliée du lundi 7 h ouvre un nouveau poste du lundi : admise.
  await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-05T05:00:00Z', sens: 'E', motif: 'oubli' });
  // Demande déposée avant la validation, validée après : même contrôle à la validation.
  const c = await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-05T14:00:00Z', sens: 'S', motif: 'oubli' });
  await db.tx(async () => { await db.insert('feuilles', { empId: 2, week: '2026-10-05', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [] }); });
  await refuse(P.mgr, 'pointage.validerCorrection', { id: c.result!.id }, /déjà validée/, 409);
});

test('débit-crédit et anomalies : rien avant l’activation de la population ; demi-journée d’absence sans anomalie', async () => {
  const { db, P, run } = await fresh();
  // Population Maintenance active au vendredi 9 octobre seulement ; Mehdi pointe ce jour-là de 8 h à 16 h.
  await run(P.admin, 'parametres.maj', { pointagePopulations: [{ ...POPULATION[0], effet: '2026-10-09' }] });
  const ajout = async (h: string, sens: 'E' | 'S') => await db.tx(async () => await db.insert<Pointage>('pointages', { empId: 2, horodatage: h, jour: h.slice(0, 10), sens, source: 'virtuel', horsLigne: false, recuLe: h, annuleId: null }));
  await ajout('2026-10-09T06:00:00.000Z', 'E');
  await ajout('2026-10-09T14:00:00.000Z', 'S');
  const ds = await loadFull(db, P.admin), e = ds.employes.find(x => x.id === 2)!;
  const l = await lirePointages(db, [2], '2026-10-04', '2026-10-11');
  const etat = etatDuSalarie(ds, e, l, instantParis('2026-10-10', 600));
  assert.deepEqual(etat.anomalies.filter(a => a.code === 'sans_pointage'), [], 'du lundi au jeudi : encore au déclaratif');
  const vendredi = theoriques(ds, e, '2026-10-09', '2026-10-09').get('2026-10-09')!;
  assert.ok(vendredi.pointe && vendredi.minutes > 0);
  assert.deepEqual([etat.debitCredit.semaine.realise, etat.debitCredit.semaine.theorique], [480, vendredi.minutes], 'théorique du seul vendredi');
  assert.equal(theoriques(ds, e, '2026-10-08', '2026-10-08').get('2026-10-08')!.pointe, false);
  // Population active toute la semaine : le jeudi sans pointage redevient une anomalie.
  await run(P.admin, 'parametres.maj', { pointagePopulations: POPULATION });
  const ds2 = await loadFull(db, P.admin);
  const avant = etatDuSalarie(ds2, ds2.employes.find(x => x.id === 2)!, l, instantParis('2026-10-10', 600));
  assert.ok(avant.anomalies.some(a => a.code === 'sans_pointage' && a.jour === '2026-10-08'));
  // Demi-journée de CP le mardi 6 (après-midi) ; pointé le matin de 8 h à 12 h : ni absence pointée, ni jour sans pointage.
  await db.tx(async () => { await db.insert('absences', { empId: 2, type: 'CP', du: '2026-10-06', au: '2026-10-06', statut: 'validee', keystone: false, debutDemi: 'apres_midi', finDemi: 'apres_midi' }); });
  await ajout('2026-10-06T06:00:00.000Z', 'E');
  await ajout('2026-10-06T10:00:00.000Z', 'S');
  const ds3 = await loadFull(db, P.admin), e3 = ds3.employes.find(x => x.id === 2)!;
  const b = bilanPeriode(ds3, e3, await lirePointages(db, [2], '2026-10-04', '2026-10-11'), '2026-10-05', '2026-10-09', instantParis('2026-10-10', 600));
  assert.equal(b.theoriques.get('2026-10-06')!.absence, 'demi');
  assert.deepEqual(b.anomalies.filter(a => a.jour === '2026-10-06'), []);
});

test('vues : le salarié ses demandes, le manager son équipe, le service RH toutes, les profils restreints aucune', async () => {
  const { db, P, run } = await fresh();
  await run(P.coll, 'pointage.pointer', { empId: 2 });
  await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-09T05:30:00Z', sens: 'E', motif: 'oubli', commentaire: 'Oubli' });
  await run(P.autC, 'pointage.corriger', { empId: 6, nature: 'ajout', horodatage: '2026-10-09T05:40:00Z', sens: 'E', motif: 'mission' });
  const empIds = async (u: User) => ((await buildSnapshot(db, u)).correctionsPointage ?? []).map(c => c.empId).sort((a, b) => a - b);
  assert.deepEqual(await empIds(P.admin), [2, 6]);
  assert.deepEqual(await empIds(P.gest), [2, 6]);
  assert.deepEqual(await empIds(P.mgr), [2, 6], 'équipe de la Maintenance');
  assert.deepEqual(await empIds(P.autM), [], 'autre équipe');
  assert.deepEqual(await empIds(P.coll), [2]);
  assert.deepEqual(await empIds(P.autC), [6]);
  for (const u of [P.hse, P.paie, P.lect]) assert.deepEqual(await empIds(u), [], u.nom);
  // Jamais un pointage dans l'instantané ; tables déclarées hors instantané et sans clé au journal des changements.
  for (const u of [P.admin, P.mgr, P.coll]) assert.ok(!JSON.stringify(await buildSnapshot(db, u)).includes('"horodatageAppareil"'), u.nom);
  assert.ok(HORS_INSTANTANE.has('pointages') && HORS_INSTANTANE.has('zonesPointage'));
  assert.deepEqual([...LECTURES.correctionsPointage], ['correctionsPointage']);
  assert.ok(['pointages', 'correctionsPointage', 'zonesPointage'].every(t => TABLES_CHANGEMENTS_SANS_CLE.has(t as never)));
});

/** Session ouverte en base pour un compte, cookie signé comme par Cursus. */
async function cookieDe(db: Db, compteId: number, role: User['role']) {
  const id = randomBytes(32).toString('base64url');
  await db.insert('connexions', { id: empreinteSession(id), compteId, role, methode: 'local', demoComptes: {}, creation: new Date().toISOString(), expiration: new Date(Date.now() + 3600_000).toISOString(), activite: null });
  return `cursus_session=${id}.${await sign(db, id)}`;
}

test('GET /api/pointages et /etat : salarié, manager et service RH ; refus tracé ; 6 semaines au plus ; état du jour', async () => {
  const { db, P, run, compteDe } = await fresh();
  await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-09T04:00:00Z', sens: 'E', motif: 'oubli' }).then(async c => await run(P.mgr, 'pointage.validerCorrection', { id: c.result!.id }));
  await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-09T12:00:00Z', sens: 'S', motif: 'oubli' }).then(async c => await run(P.mgr, 'pointage.validerCorrection', { id: c.result!.id }));
  await run(P.coll, 'pointage.pointer', { empId: 2, sens: 'E' });
  const app = createApp(db, { production: false, journalRequetes: false, compression: false });
  const serveur = await new Promise<Server>(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  serveurs.push(serveur);
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const get = async (chemin: string, cookie?: string, espace: string | null = 'rh') =>
    await fetch(`${base}${chemin}`, { headers: { ...(cookie ? { cookie } : {}), ...(espace ? { 'x-cursus-espace': espace } : {}) } });
  const coll = await cookieDe(db, await compteDe(2), 'collaborateur'), mgr = await cookieDe(db, await compteDe(12), 'manager');
  const autM = await cookieDe(db, await compteDe(16), 'manager'), admin = await cookieDe(db, await compteDe(null), 'rh');
  assert.equal((await get('/api/pointages/etat')).status, 401);
  assert.equal((await get('/api/pointages/etat', coll, null)).status, 403, 'garde de navigation : en-tête d’espace exigé');
  // Le salarié : son état du jour (présent depuis), débit-crédit, pointages du 9 octobre.
  const etat = await (await get('/api/pointages/etat', coll, 'collaborateur')).json() as Record<string, any>;
  assert.equal(etat.jour, '2026-10-10');
  assert.equal(etat.present, true);
  assert.match(etat.depuis, /^\d{2}:\d{2}$/);
  assert.equal(etat.mode, 'controle');
  assert.equal(etat.debitCredit.semaine.realise >= 480, true, '8 h le vendredi');
  const semaine = await (await get('/api/pointages?du=2026-10-05&au=2026-10-10', coll, 'collaborateur')).json() as Record<string, any>;
  assert.deepEqual(semaine.postes.map((x: { jour: string; travail: number }) => [x.jour, x.travail]).filter((x: [string, number]) => x[0] === '2026-10-09'), [['2026-10-09', 480]]);
  assert.equal(semaine.pointages.length, 3);
  // Le manager de la Maintenance : Mehdi, et la présence de son équipe ; un autre manager : refusé et tracé.
  assert.equal((await get('/api/pointages/etat?empId=2', mgr, 'manager')).status, 200);
  const equipe = await (await get('/api/pointages/etat?equipe=1', mgr, 'manager')).json() as Record<string, any>;
  const mehdi = equipe.presences.find((x: { empId: number }) => x.empId === 2);
  assert.equal(mehdi.etat, 'present');
  assert.ok(!JSON.stringify(equipe).match(/maladie|congé/i), 'jamais la nature d’une absence');
  assert.equal((await get('/api/pointages/etat?empId=2', autM, 'manager')).status, 403);
  assert.equal((await get('/api/pointages?empId=2', autM, 'manager')).status, 403);
  const refus = await db.query<{ message: string }>(`SELECT message FROM journal WHERE action = 'acces.refuse' ORDER BY id DESC LIMIT 1`);
  assert.match(refus[0].message, /^Pointages — hors du périmètre/);
  // Paie, référent HSE, lecture seule : rien ; service RH : tout.
  for (const empId of [7, 23, 11]) assert.equal((await get('/api/pointages?empId=2', await cookieDe(db, await compteDe(empId), 'rh'))).status, 403, `profil ${empId}`);
  assert.equal((await get('/api/pointages?empId=2&du=2026-10-01&au=2026-10-10', admin)).status, 200);
  // 6 semaines au plus, période lisible.
  assert.equal((await get('/api/pointages?empId=2&du=2026-08-01&au=2026-10-10', admin)).status, 400);
  assert.equal((await get('/api/pointages?empId=2&du=2026-10-10&au=2026-10-01', admin)).status, 400);
  assert.equal((await get('/api/pointages?empId=2&du=x', admin)).status, 400);
  assert.equal((await get('/api/pointages?empId=9999', admin)).status, 403);
});

test('conservation : purge au-delà de la durée réglée, cascade de l’anonymisation, export des données du salarié', async () => {
  const { db, P, run } = await fresh();
  const c = await run(P.coll, 'pointage.corriger', { empId: 2, nature: 'ajout', horodatage: '2026-10-09T04:00:00Z', sens: 'E', motif: 'oubli', commentaire: 'Oubli du matin' });
  await run(P.mgr, 'pointage.validerCorrection', { id: c.result!.id });
  await run(P.coll, 'pointage.pointer', { empId: 2 });
  // Pointages anciens (avec une correction validée et sa neutralisation) : supprimés à 3 ans.
  await db.tx(async () => {
    const vieux = await db.insert<Pointage>('pointages', { empId: 2, horodatage: '2023-10-02T05:00:00.000Z', jour: '2023-10-02', sens: 'E', source: 'virtuel', horsLigne: false, recuLe: '2023-10-02T05:00:00.000Z' });
    const cor = await db.insert<Correction>('correctionsPointage', { empId: 2, jour: '2023-10-02', nature: 'neutralisation', pointageId: vieux.id, motif: 'autre', statut: 'validee', demandeLe: '2023-10-02T09:00:00.000Z', demandeParInteresse: true });
    await db.insert('pointages', { empId: 2, horodatage: '2023-10-02T05:00:00.000Z', jour: '2023-10-02', sens: 'E', source: 'correction', horsLigne: false, recuLe: '2023-10-02T09:00:00.000Z', annuleId: vieux.id, correctionId: cor.id });
  });
  assert.equal(await purgerPointages(db, '2026-10-10'), 3);
  assert.equal(await purgerPointages(db, '2026-10-10'), 0, 'idempotente');
  assert.equal((await pointages(db)).length, 2, 'pointages récents gardés');
  // Export des données du salarié : pointages et demandes de correction.
  const x = (await donneesSalarie(db, 2, { journal: false, par: 'Mehdi Benali' }))!;
  assert.equal((x.sections['Pointages (badgeage)'] as unknown[]).length, 2);
  assert.equal((x.sections['Demandes de correction de pointage'] as unknown[]).length, 1);
  // Anonymisation : catégorie « temps » — demandes puis pointages supprimés.
  await db.tx(async () => await effacer(db, 2, ['temps'], { ti: '2026-10-10', le: '2026-10-10T08:00:00.000Z', par: 'Essai' }, { motif: 'Durée échue', avantEcheance: false }));
  assert.equal((await pointages(db)).length, 0);
  assert.equal((await db.where('correctionsPointage', 'empId', 2)).length, 0);
});

test('banc d’oracle : actions du badgeage en renfort, module activé, aucune divergence', async () => {
  const { baseDemo, rejouer, resumeRapport } = await import('./support/oracle.ts');
  const db = await baseDemo(nouvelleBase);
  // Tous les régimes horaires badgent (forfait jours et cadres dirigeants restent exclus) ; demandes en attente à décider.
  const regimes = ['35h', '39h_rtt', 'partiel', 'forfait_heures_hebdo', 'forfait_heures_annuel'].map(valeur => ({ critere: 'regime', valeur, mode: 'controle', effet: '2026-01-01' }));
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), pointageActif: true, pointageAccord: ACCORD, pointageCseLe: '2026-02-15', pointagePopulations: regimes });
  for (const empId of [2, 6, 2, 6, 3, 4]) {
    await db.insert('correctionsPointage', { empId, jour: '2026-10-09', nature: 'ajout', horodatage: '2026-10-09T05:00:00.000Z', sens: 'E', motif: 'oubli', statut: 'demandee', demandeLe: '2026-10-09T08:00:00.000Z', demandePar: 'Essai', demandeParInteresse: true });
  }
  const renfort = ['pointage.pointer', 'pointage.corriger', 'pointage.corriger', 'pointage.validerCorrection', 'pointage.refuserCorrection', 'pointage.annulerCorrection'].flatMap(a => Array<string>(6).fill(a));
  const rapport = await rejouer(db, { graine: 26, pas: 20, renfort });
  assert.equal(rapport.erreurs.length, 0, rapport.erreurs.join('\n'));
  assert.equal(rapport.divergences.length, 0, resumeRapport(rapport));
  const ok = Object.entries(rapport.actions).filter(([a]) => a.startsWith('pointage.')).reduce((n, [, v]) => n + v.ok, 0);
  assert.ok(ok >= 2, `${ok} actions du badgeage abouties : ${JSON.stringify(rapport.actions)}`);
});
