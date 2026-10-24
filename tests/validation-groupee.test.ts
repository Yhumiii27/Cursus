// Validation groupée des feuilles (lot 8, chantier E, étape 1) : une seule lecture complète de la base par tranche, la
// feuille validée remplacée dans la lecture (server/src/actions/temps.ts, `remplacerFeuille`), relevé de l'agence calculé
// sur le Domain de l'appelant, tranches de 25 feuilles au plus (une transaction chacune) et reprise qui saute les feuilles
// déjà validées. Référence : la méthode d'avant, une lecture complète de la base par feuille (chaque feuille validée
// seule, `temps.validate`, dans sa transaction) ; même état de la base attendu, contrepartie en repos cumulée d'une
// feuille à l'autre (contingent franchi en cours de lot) et relevé d'un intérimaire compris.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { TRANCHE_MAX, validerEnTranches } = await import('../server/src/actions/suivi-feuilles.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { CURSUS_OCCUPE } = await import('../server/src/erreurs.ts');
const { addD } = await import('../shared/dates.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Sortie = { message?: string | null; result?: unknown };

/** Salarié à 35 h (contingent franchi en cours d'année à 43 h par semaine) et intérimaire de l'agence Proman Lyon. */
const SALARIE = 8, INTERIMAIRE = 15;
const SEMAINES = Array.from({ length: 31 }, (_, i) => addD('2026-03-02', 7 * i)); // du 2 mars au 28 septembre
const INTERIM = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
/** Lot demandé : les semaines de l'intérimaire mêlées à celles du salarié (36 feuilles, deux tranches). */
const LOT = SEMAINES.map(week => ({ empId: SALARIE, week }));
INTERIM.forEach((week, i) => LOT.splice(3 + 7 * i, 0, { empId: INTERIMAIRE, week }));

async function base() {
  const db = await nouvelleBase();
  await seedDemo(db);
  // Relevés automatiques de l'agence depuis août : la dernière feuille validée d'une semaine révolue fait partir le relevé.
  const m = await db.getSetting<{ agences: { nom: string; adresse: string; depuis?: string }[] }>('messagerie', { agences: [] });
  await db.setSetting('messagerie', { ...m, agences: m.agences.map(a => ({ ...a, depuis: '2026-08-01' })) });
  await db.run('DELETE FROM feuilles WHERE emp_id IN (?, ?) AND week >= ?', [SALARIE, INTERIMAIRE, '2026-01-01']);
  await db.run('DELETE FROM absences WHERE emp_id IN (?, ?) AND au >= ?', [SALARIE, INTERIMAIRE, '2026-01-01']);
  const inserer = async (empId: number, week: string, h: number[]) => await db.insert('feuilles', {
    empId, week, statut: 'soumise', comment: null, sage: false, keystone: false, contrat: null,
    lignes: [{ projet: 'INT-LOG', tache: 'Logistique interne', ks: false, h: [...h, 0, 0] }, { projet: 'K-2620', tache: 'Repérage site Feyzin', ks: false, h: [0, 0, 0, 0, 0, 0, 0] }],
  });
  for (const w of SEMAINES) await inserer(SALARIE, w, [9, 9, 9, 8, 8]);
  for (const w of INTERIM) await inserer(INTERIMAIRE, w, [7, 7, 7, 7, 7]);
  const compte = (await db.one('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin'])) as { id: number };
  const rh = (await currentUser(db, { compteId: compte.id, role: 'rh', methode: 'demo' }))!;
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

/** État comparé : feuilles des deux salariés (statut et valeurs figées à la validation), relevés, messages en file. */
async function etat(db: Db) {
  const feuilles = await db.query(`SELECT emp_id AS "empId", week, statut, keystone, contrat, heures_sup AS "heuresSup", maj_dimanche AS "majDimanche",
    maj_ferie AS "majFerie", cor, horaires, motif_depassement AS "motif" FROM feuilles WHERE emp_id IN (?, ?) AND week >= ? ORDER BY emp_id, week`, [SALARIE, INTERIMAIRE, '2026-01-01']);
  const releves = await db.query('SELECT agence, semaine, interimaires, heures, en_attente AS "enAttente" FROM releves ORDER BY semaine, agence');
  // Messages en file : clé tirée au hasard pour un e-mail, comparés par cible, type et contenu.
  const envois = (await db.query<{ cible: string; type: string; contenu: unknown }>('SELECT cible, type, contenu FROM envois'))
    .map(e => JSON.stringify([e.cible, e.type, typeof e.contenu === 'string' ? JSON.parse(e.contenu) : e.contenu])).sort();
  return JSON.parse(JSON.stringify({ feuilles, releves, envois }));
}

test('validerLot : une lecture de la base pour tout le lot, même résultat qu’une lecture par feuille (contingent cumulé, intérimaire)', async () => {
  // Référence : chaque feuille validée seule, sur une lecture complète de la base relue pour elle (méthode d'avant).
  const ref = await base();
  for (const f of LOT) {
    try { await ref.passe(ref.rh, 'temps.validate')(f); } catch (err) { if (!(err instanceof ActionError)) throw err; }
  }
  const attendu = await etat(ref.db);
  const cor = attendu.feuilles.filter((f: { cor: unknown }) => f.cor && JSON.stringify(f.cor) !== '{}' && JSON.stringify(f.cor) !== 'null');
  assert.ok(cor.length >= 2, 'le contingent est franchi en cours de lot : plusieurs feuilles portent une contrepartie en repos');
  assert.ok(attendu.releves.some((r: { agence: string }) => r.agence === 'Proman Lyon'), 'la validation de l’intérimaire fait partir le relevé de son agence');
  assert.ok(attendu.feuilles.every((f: { statut: string }) => f.statut === 'validee'));

  // Une seule passe (appel direct de l'action, une lecture de la base) : même état.
  const un = await base();
  let lectures = 0;
  const lire = un.db.lecture.bind(un.db);
  un.db.lecture = (async (fn: () => unknown) => { lectures++; return await lire(fn); }) as typeof un.db.lecture;
  const o = await un.passe(un.rh, 'temps.validerLot')({ feuilles: LOT });
  un.db.lecture = lire;
  assert.match(String(o.message), /^36 feuilles validées/);
  assert.deepEqual(await etat(un.db), attendu);
  assert.equal(lectures, 1, 'une seule lecture complète de la base, relevé de l’agence compris');

  // Par tranches de 25 (POST /api/actions) : deux transactions, deux lignes de journal, même état.
  const tr = await base();
  const r = await validerEnTranches({ feuilles: LOT }, tr.passe(tr.rh, 'temps.validerLot'));
  assert.equal(TRANCHE_MAX, 25);
  assert.match(String(r.message), /^36 feuilles validées/);
  assert.deepEqual((r.result as { validees: unknown[] }).validees.length, 36);
  assert.deepEqual(await etat(tr.db), attendu);
  const lignes = (await tr.db.all<{ action: string; message: string; payload: { validees: unknown[] } }>('journal')).filter(l => l.action === 'temps.validerLot');
  assert.deepEqual(lignes.map(l => [l.message.replace(/ ·.*$/, ''), l.payload.validees.length]), [
    ['25 feuilles validées (tranche 1 sur 2 d’une validation groupée)', 25], ['11 feuilles validées (tranche 2 sur 2 d’une validation groupée)', 11],
  ]);
});

test('validerLot par tranches : interruption (Cursus occupé) puis reprise qui saute les feuilles déjà validées', async () => {
  const { db, rh, passe } = await base();
  const une = passe(rh, 'temps.validerLot');
  let appels = 0;
  // Seconde tranche : délai d'attente du verrou dépassé (lock_timeout, code 55P03), sa transaction n'a rien écrit.
  const occupee = async (p: Record<string, any>) => {
    if (++appels === 2) throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    return await une(p);
  };
  const r = await validerEnTranches({ feuilles: LOT }, occupee);
  const res = r.result as { validees: unknown[]; restantes: { empId: number; week: string }[] };
  assert.equal(res.validees.length, 25);
  assert.deepEqual(res.restantes, LOT.slice(25));
  assert.match(String(r.message), new RegExp(`^25 feuilles validées · validation interrompue \\(${CURSUS_OCCUPE.replace(/[.]/g, '\\.')}\\) : 11 feuilles restantes à valider de nouveau`));
  assert.equal(((await db.one('SELECT COUNT(*) AS n FROM feuilles WHERE statut = ? AND emp_id IN (?, ?) AND week >= ?', ['validee', SALARIE, INTERIMAIRE, '2026-01-01'])) as { n: number }).n, 25);
  // Reprise de la même validation : les 25 premières sont sautées, les 11 autres validées.
  const reprise = await validerEnTranches({ feuilles: LOT }, une);
  assert.match(String(reprise.message), /^11 feuilles validées · 25 feuilles déjà validées, sautées/);
  assert.equal(((await db.one('SELECT COUNT(*) AS n FROM feuilles WHERE statut = ? AND emp_id IN (?, ?) AND week >= ?', ['validee', SALARIE, INTERIMAIRE, '2026-01-01'])) as { n: number }).n, 36);
  // Une erreur dès la première tranche est rendue telle quelle : rien n'a été fait.
  const db2 = await base();
  await assert.rejects(validerEnTranches({ feuilles: LOT }, async () => { throw Object.assign(new Error('lock timeout'), { code: '55P03' }); }), (e: { code?: string }) => e.code === '55P03');
  assert.equal(((await db2.db.one('SELECT COUNT(*) AS n FROM journal WHERE action = ?', ['temps.validerLot'])) as { n: number }).n, 0);
});

test('validerLot par tranches : refus sur toutes les tranches, sans ligne de journal ni écriture ; liste invalide refusée d’emblée', async () => {
  const { db, passe } = await base();
  const compte = (await db.one('SELECT id FROM comptes WHERE emp_id = ?', [16])) as { id: number };
  const hugo = (await currentUser(db, { compteId: compte.id, role: 'manager', methode: 'demo' }))!;
  // Hugo (Logistique) n'est le valideur d'aucune de ces feuilles : 403, et aucune tranche journalisée.
  await assert.rejects(validerEnTranches({ feuilles: LOT }, passe(hugo, 'temps.validerLot')), (e: unknown) => e instanceof ActionError && e.status === 403 && e.message.startsWith('Aucune feuille validée : '));
  assert.equal(((await db.one('SELECT COUNT(*) AS n FROM journal WHERE action = ?', ['temps.validerLot'])) as { n: number }).n, 0);
  await assert.rejects(validerEnTranches({ feuilles: [...LOT, { empId: 'x', week: 'y' }] }, passe(hugo, 'temps.validerLot')), (e: unknown) => e instanceof ActionError && e.status === 400);
  await assert.rejects(validerEnTranches({ feuilles: Array.from({ length: 201 }, () => LOT[0]) }, passe(hugo, 'temps.validerLot')), /200 feuilles au plus/);
});
