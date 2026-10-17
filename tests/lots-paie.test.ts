// Lots de paie (lot 4, chantier 4, étape 2 : t029 et mode fichier de t019) : lot d'une période au contenu figé, feuilles
// réservées, fichier d'import téléchargé (route GET tracée, format réglable), confirmation de l'import (seule à marquer
// les feuilles transmises) ou annulation avant elle, reprise des feuilles déjà transmises en lot historique, droits,
// journal et données transmises à chaque profil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';

const express = (await import('express')).default;
const { Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { champsRetenus, journaliserAction, preparerTrace, tracerRefus } = await import('../server/src/journal.ts');
const { openSession } = await import('../server/src/auth.ts');
const { routesFichierPaie } = await import('../server/src/fichier-paie.ts');
const { lireLots } = await import('../server/src/lots-paie.ts');
const { LOTS_HISTORIQUES } = await import('../server/src/migrations/paie.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { Domain } = await import('../shared/domain.ts');
const { sagePending } = await import('../shared/rules/temps.ts');
const L = await import('../shared/rules/lots-paie.ts');
const { estActionPaie, familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const C = await import('../client/src/state/confirmations.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<ReturnType<typeof currentUser>>;
type Lot = ReturnType<typeof lireLots>[number] & { contenu: { lignes: { matricule: string; semaine: string; periode?: string; periode_origine?: string; rubriques: Record<string, number> }[] } | null };
type Ligne = { action: string; message: string | null; payload: Record<string, any>; salaries: number[]; paie: boolean };

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
function fresh(db: Db = new Db(':memory:')) {
  seedDemo(db);
  const compteDe = (empId: number | null) => (db.sql.prepare(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL')
    .get(...(empId ? [empId] : [])) as { id: number }).id;
  const user = (empId: number | null, role: User['role']) => currentUser(db, { compteId: compteDe(empId), role, methode: 'demo' })!;
  const run = (u: User, name: string, p: Record<string, unknown>) => db.tx(() => {
    const t = preparerTrace(db, name, p);
    const r = ACTIONS[name](makeCtx(db, u, loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    journaliserAction(db, t, { user: u, compte: db.get('comptes', u.compteId)!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refus = (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    assert.throws(() => run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  const lots = () => db.all<Lot>('lotsPaie');
  const journal = (action: string) => db.all<Ligne>('journal').filter(l => l.action === action);
  const transmises = () => Number((db.sql.prepare('SELECT COUNT(*) AS n FROM feuilles WHERE sage = 1').get() as { n: number }).n);
  return { db, user, compteDe, run, refus, lots, journal, transmises, ADMIN: user(null, 'rh'), PAIE: user(7, 'rh'), GEST: user(14, 'rh'), KARIM: user(12, 'manager') };
}
function avecEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const avant = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  try { return fn(); } finally {
    Object.entries(avant).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}

/** Route du fichier d'import montée seule, avec une route d'essai qui ouvre une session pour un compte. */
async function serveurFichier(db: Db) {
  const app = express();
  app.get('/essai/session/:compte', (req, res) => { openSession(db, res, { compteId: Number(req.params.compte), role: 'rh', methode: 'demo' }); res.end(); });
  app.use(routesFichierPaie(db));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const session = async (compte: number) => (await fetch(`${base}/essai/session/${compte}`)).headers.get('set-cookie')!.split(';')[0];
  const fichier = (id: number, cookie?: string) => fetch(`${base}/api/paie/lots/${id}/fichier`, { headers: cookie ? { cookie } : {} });
  return { session, fichier, fermer: () => new Promise(r => srv.close(r)) };
}

// — Règles du fichier —

test('t019 fichier d’import : une ligne par salarié, période et rubrique, format réglable', () => {
  const contenu: { lignes: { matricule: string; semaine: string; periode?: string; periode_origine?: string; rubriques: Record<string, number> }[] } = {
    lignes: [
      { matricule: '004102', semaine: '2026-S40', periode: '2026-10', periode_origine: '2026-09', rubriques: { HN: 21, HS25: 1.5 } },
      { matricule: '004102', semaine: '2026-S41', periode: '2026-10', rubriques: { HN: 35, HS25: 2 } },
      { matricule: '004101', semaine: '2026-S41', periode: '2026-10', rubriques: { HN: 35, HS50: 0 } },
    ],
  };
  // Rappel compris : il part sur la période ouverte, avec la semaine ordinaire du même salarié.
  assert.deepEqual(L.lignesFichier(contenu), [
    { matricule: '004101', periode: '2026-10', rubrique: 'HN', quantite: 35 },
    { matricule: '004102', periode: '2026-10', rubrique: 'HN', quantite: 56 },
    { matricule: '004102', periode: '2026-10', rubrique: 'HS25', quantite: 3.5 },
  ]);
  assert.equal(L.fichierLot(contenu), 'matricule;periode;rubrique;quantite\r\n004101;2026-10;HN;35\r\n004102;2026-10;HN;56\r\n004102;2026-10;HS25;3,5\r\n');
  const f = { ...L.FORMAT_FICHIER_DEFAUT, separateur: 'tab', colonnes: ['rubrique', 'matricule', 'quantite', 'periode'], formatPeriode: 'MM/AAAA', decimale: '.', entete: false } as const;
  assert.equal(L.fichierLot(contenu, { ...f, colonnes: [...f.colonnes] }).split('\r\n')[2], 'HS25\t004102\t3.5\t10/2026');
  assert.equal(L.periodeFichier('2026-10', 'AAAAMM'), '202610');
  assert.equal(L.periodeFichier('2026-10', 'MMAAAA'), '102026');
  // Un code qui contient le séparateur est mis entre guillemets.
  assert.equal(L.fichierLot({ lignes: [{ matricule: 'A', semaine: '', periode: '2026-10', rubriques: { 'X,1': 1 } }] }, { ...L.FORMAT_FICHIER_DEFAUT, separateur: ',', decimale: '.', entete: false }), 'A,2026-10,"X,1",1\r\n');
  assert.deepEqual(L.resumeContenu(contenu), { lignes: 3, salaries: 2, rubriques: { HN: 91, HS25: 3.5 } });
  // Quarts d'heure : totaux au centième, comme les lignes du fichier (12,25 et non 12,3, que Sage ne retrouverait pas).
  const quarts = { lignes: [{ matricule: 'A', semaine: '', periode: '2026-10', rubriques: { HS25: 4.25 } }, { matricule: 'B', semaine: '', periode: '2026-10', rubriques: { HS25: 8 } }] };
  assert.deepEqual(L.resumeContenu(quarts).rubriques, { HS25: 12.25 });
  assert.equal(L.totauxTexte(L.resumeContenu(quarts)), 'HS25 12,25');
  assert.equal(L.totauxTexte({ lignes: 3, salaries: 2, rubriques: { HN: 1225.5, HS25: 3.5 } }), `HN ${(1225.5).toLocaleString('fr-FR')} · HS25 3,5`);
  assert.equal(L.nomFichierLot({ id: 12, periode: '2026-10' }), 'sage-paie-2026-10-lot-12.csv');
  assert.equal(L.nomFichierLot({ id: 12, periode: '2026-10' }, { ...L.FORMAT_FICHIER_DEFAUT, separateur: 'tab' }), 'sage-paie-2026-10-lot-12.txt');
  // Contrôle du format reçu.
  const d = L.FORMAT_FICHIER_DEFAUT;
  assert.match(String(L.controlerFormat({ separateur: '|' }, d)), /Séparateur inconnu/);
  assert.match(String(L.controlerFormat({ formatPeriode: 'AA' }, d)), /Format de période inconnu/);
  assert.match(String(L.controlerFormat({ decimale: ' ' }, d)), /Séparateur décimal inconnu/);
  assert.match(String(L.controlerFormat({ colonnes: ['matricule', 'matricule', 'rubrique', 'quantite'] }, d)), /chacune une fois/);
  assert.match(String(L.controlerFormat({ colonnes: 'matricule' }, d)), /chacune une fois/);
  assert.match(String(L.controlerFormat({ separateur: ',' }, d)), /doit différer/);
  assert.deepEqual(L.controlerFormat({ separateur: ',', decimale: '.', entete: 0 }, d), { ...d, separateur: ',', decimale: '.', entete: false });
  assert.equal(L.erreurReference(''), null);
  assert.equal(L.erreurReference('IMP-2026/10'), null);
  assert.match(String(L.erreurReference('import du 12 octobre')), /40 caractères au plus/);
  assert.ok(L.lotActif({ statut: 'genere' }) && L.lotActif({ statut: 'transmis' }) && !L.lotActif({ statut: 'annule' }));
});

test('t029 choix des feuilles : période de destination, au plus tard celle du lot', () => {
  const s = { periodeRattachement: 'dimanche' as const, clotureJour: 0 };
  const sheets = [{ week: '2026-09-21' }, { week: '2026-09-28' }, { week: '2026-10-26' }];
  // Le 10 octobre, septembre est clos : la semaine du 21 septembre part en rappel sur octobre ; celle du 26 octobre va sur
  // novembre (son dimanche).
  assert.deepEqual(sheets.map(sh => L.periodeDeLaFeuille(sh.week, s, '2026-10-10')), ['2026-10', '2026-10', '2026-11']);
  assert.deepEqual(L.feuillesDuLot(sheets, '2026-10', s, '2026-10-10'), sheets.slice(0, 2));
  assert.deepEqual(L.feuillesDuLot(sheets, '2026-11', s, '2026-10-10'), sheets);
  assert.deepEqual(L.feuillesDuLot(sheets, '2026-09', s, '2026-10-10'), []);
});

// — Cycle d'un lot de fichier —

test('t029 lot de fichier : généré, feuilles réservées, fichier tracé, import confirmé qui seul les marque transmises', async () => {
  const { db, run, refus, lots, journal, transmises, compteDe, ADMIN, PAIE, GEST } = fresh();
  for (const code of Object.keys(RUBRIQUES_PAIE)) run(ADMIN, 'paie.rubrique', { code, confirmer: true });
  const avant = transmises(), enAttente = sagePending(new Domain(loadFull(db, ADMIN))).length;
  assert.ok(enAttente > 0);
  await avecEnv({ SAGE_MODE: 'fichier' }, async () => {
    refus(GEST, 'paie.lotGenerer', { periode: '2026-10' }, 403);
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-13' }, 400, /Période de paie invalide/);
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-09' }, 400, /Aucune feuille validée en attente pour septembre 2026/);
    assert.match(String(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' })),
      new RegExp(`^Lot n° \\d+ généré — ${enAttente} feuilles \\(\\d+ salariés\\), octobre 2026 · téléchargez le fichier d’import, importez-le dans Sage, puis confirmez l’import$`));
    const lot = lots().at(-1)!;
    assert.deepEqual([lot.mode, lot.statut, lot.periode, lot.feuilles.length, lot.telechargements], ['fichier', 'genere', '2026-10', enAttente, 0]);
    assert.match(lot.cle, /^[0-9a-f-]{36}$/, 'clé d’idempotence');
    assert.ok(lot.contenu!.lignes.length > 0 && lot.resume.lignes === L.lignesFichier(lot.contenu!).length);
    // Feuilles réservées, pas transmises : plus en attente, jamais dans un second lot.
    assert.equal(transmises(), avant);
    assert.equal(sagePending(new Domain(loadFull(db, ADMIN))).length, 0);
    assert.ok(loadFull(db, ADMIN).feuilles.filter(f => f.lotId === lot.id).length === enAttente);
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 400, /Aucune feuille/);
    refus(PAIE, 'temps.pushSage', {}, 400, /Aucune feuille validée en attente/);
    // Import à confirmer : d'abord le fichier.
    refus(PAIE, 'paie.lotConfirmer', { id: lot.id }, 409, /téléchargez d’abord son fichier d’import/);
    refus(PAIE, 'paie.lotConfirmer', { id: 999 }, 404);

    const srv = await serveurFichier(db);
    try {
      assert.equal((await srv.fichier(lot.id)).status, 401);
      const gest = await srv.fichier(lot.id, await srv.session(compteDe(14)));
      assert.equal(gest.status, 403, 'gestionnaire RH : pas de droit « paie »');
      const paie = await srv.session(compteDe(7));
      assert.equal((await srv.fichier(999, paie)).status, 404);
      const r = await srv.fichier(lot.id, paie);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-disposition'), `attachment; filename="sage-paie-2026-10-lot-${lot.id}.csv"`);
      assert.match(r.headers.get('content-type')!, /^text\/csv/);
      const texte = await r.text();
      assert.equal(texte, L.fichierLot(lot.contenu!));
      assert.ok(texte.split('\r\n').slice(1).filter(Boolean).every(l => /^\d{6};2026-10;[A-Z0-9_]+;\d+(,\d+)?$/.test(l)), 'matricules de paie, période, code, quantité');
      // Format réglé par la paie : appliqué au téléchargement suivant, contenu inchangé.
      refus(GEST, 'paie.formatFichier', { separateur: ',' }, 403);
      refus(PAIE, 'paie.formatFichier', { separateur: ',' }, 400, /doit différer/);
      assert.match(String(run(PAIE, 'paie.formatFichier', { separateur: 'tab', entete: false, colonnes: ['matricule', 'rubrique', 'quantite', 'periode'], formatPeriode: 'MMAAAA' })), /prochains téléchargements/);
      const r2 = await srv.fichier(lot.id, paie);
      assert.match(r2.headers.get('content-disposition')!, /\.txt"$/);
      assert.match((await r2.text()).split('\r\n')[0], /^\d{6}\t[A-Z0-9_]+\t\d+(,\d+)?\t102026$/);
      const f = journal('paie.formatFichier').at(-1)!;
      assert.deepEqual([f.payload.avant.separateur ?? ';', f.payload.apres.separateur], [';', 'tab']);
      assert.ok(f.paie && estActionPaie('paie.formatFichier'));
      // Chaque téléchargement est tracé (archive paie), salarié par salarié, et compté sur le lot.
      const t = journal('sage.fichier');
      assert.equal(t.length, 2);
      assert.match(t[0].message!, new RegExp(`^Fichier d’import Sage du lot n° ${lot.id} téléchargé — octobre 2026, \\d+ lignes$`));
      assert.deepEqual([t[0].payload.lot, t[0].payload.cle, t[0].paie], [lot.id, lot.cle, true]);
      assert.deepEqual(t[0].salaries.sort(), [...new Set(lot.feuilles.map(x => x.empId))].sort());
      assert.equal(journal('acces.refuse').at(-1)!.message, 'Fichier d’import Sage — réservé à l’administrateur RH et au gestionnaire de paie');
      assert.equal(lots().at(-1)!.telechargements, 2);

      // Confirmation de l'import : datée, signée, référence contrôlée ; elle seule marque les feuilles transmises.
      refus(PAIE, 'paie.lotConfirmer', { id: lot.id, reference: 'import du 12 octobre' }, 400, /40 caractères au plus/);
      refus(GEST, 'paie.lotConfirmer', { id: lot.id }, 403);
      // Refus de droits (403, tracé au journal comme POST /api/actions/:nom le fait) : une référence en texte libre est
      // refusée avant les droits, jamais recopiée au journal ; une référence valide (un code) l'est.
      const refusTrace = (p: Record<string, unknown>) => {
        try { run(GEST, 'paie.lotConfirmer', p); } catch (e) {
          if (e instanceof ActionError && e.status === 403) tracerRefus(db, { user: GEST, compte: db.get('comptes', GEST.compteId)! }, 'Confirmer l’import', e.message, { action: 'paie.lotConfirmer', p });
          return (e as InstanceType<typeof ActionError>).status;
        }
      };
      const libre = 'Import fait par Mme Martin, voir son commentaire';
      assert.equal(refusTrace({ id: lot.id, reference: libre }), 400);
      assert.equal(refusTrace({ id: lot.id, reference: 'IMP-X' }), 403);
      const refuses = journal('acces.refuse').filter(l => l.payload.action === 'paie.lotConfirmer');
      assert.deepEqual(refuses.map(l => l.payload.reference), ['IMP-X']);
      assert.ok(!JSON.stringify(journal('acces.refuse')).includes('Mme Martin'));
      assert.deepEqual(champsRetenus('paie.lotConfirmer', { id: lot.id, reference: libre }), { id: lot.id }, 'règle du journal : texte libre écarté');
      assert.match(String(run(PAIE, 'paie.lotConfirmer', { id: lot.id, reference: 'IMP-2026-10' })),
        new RegExp(`^Lot n° ${lot.id} : import dans Sage confirmé — ${enAttente} feuilles marquées transmises · référence IMP-2026-10$`));
      const confirme = lots().at(-1)!;
      assert.deepEqual([confirme.statut, confirme.confirmePar, confirme.reference], ['transmis', 'Aïcha Diallo', 'IMP-2026-10']);
      assert.equal(transmises(), avant + enAttente);
      const j = journal('paie.lotConfirmer').at(-1)!;
      assert.deepEqual([j.payload.id, j.payload.reference, j.payload.avant.statut, j.payload.apres.statut, j.paie], [lot.id, 'IMP-2026-10', 'genere', 'transmis', true]);
      assert.equal(j.payload.feuilles.length, enAttente);
      assert.ok(j.salaries.includes(lot.feuilles[0].empId));
      assert.equal(run(PAIE, 'paie.lotConfirmer', { id: lot.id }), `Lot n° ${lot.id} : import déjà confirmé`);
      refus(PAIE, 'paie.lotAnnuler', { id: lot.id }, 409, /ne s’annule plus/);
      // Un lot transmis se télécharge encore (contrôle, audit).
      assert.equal((await srv.fichier(lot.id, paie)).status, 200);
    } finally {
      await srv.fermer();
    }
  });
  const g = journal('paie.lotGenerer').at(-1)!;
  assert.deepEqual([g.payload.periode, g.payload.feuilles.length, g.paie, familleAction('paie.lotGenerer')?.id], ['2026-10', enAttente, true, 'temps']);
  for (const a of ['paie.lotGenerer', 'paie.lotConfirmer', 'paie.lotAnnuler', 'paie.formatFichier', 'sage.fichier', 'migration.lotsPaie', 'temps.relancer', 'temps.validerLot']) assert.ok(JOURNAL_LABEL[a], a);
});

test('t029 contrôles d’un lot réel : matricule de paie et codes Sage confirmés', () => {
  const { db, run, refus, lots, ADMIN, PAIE } = fresh();
  db.insert('feuilles', { empId: 24, week: '2026-10-05', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7] }], contrat: null });
  avecEnv({ SAGE_MODE: 'fichier' }, () => {
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 400, /^Transmission refusée : 1 salarié sans matricule de paie \(Bastien Morel\)/);
    run(ADMIN, 'employe.modifier', { id: 24, matriculePaie: '004124' });
    refus(PAIE, 'paie.lotGenerer', { periode: '2026-10' }, 409, /^Transmission impossible : code Sage à confirmer pour les rubriques HN/);
  });
  assert.equal(lots().filter(l => !l.historique).length, 0, 'aucun lot créé');
});

test('t029 simulation, annulation : feuilles libérées, fichier d’un lot annulé refusé, lot de simulation jamais confirmé en réel', async () => {
  const { db, run, refus, lots, journal, transmises, compteDe, ADMIN, PAIE, KARIM } = fresh();
  db.insert('feuilles', { empId: 24, week: '2026-10-05', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [{ projet: 'INT-MAINT', tache: '', ks: false, h: [7, 7, 7, 7, 7] }], contrat: null });
  const avant = transmises(), enAttente = () => sagePending(new Domain(loadFull(db, ADMIN))).length, n = enAttente();
  // Simulation : salarié sans matricule et codes à confirmer acceptés, avec un avertissement.
  assert.match(String(run(PAIE, 'paie.lotGenerer', { periode: '2026-10' })), /· simulation : rien n’est envoyé à Sage Paie · 1 salarié sans matricule de paie \(Bastien Morel\)/);
  const lot = lots().at(-1)!;
  assert.deepEqual([lot.mode, lot.sansMatricule], ['simulation', [24]]);
  avecEnv({ SAGE_MODE: 'fichier' }, () => refus(PAIE, 'paie.lotConfirmer', { id: lot.id }, 409, /généré en simulation : rien n’a été envoyé/));
  // Annulation : feuilles libérées, de nouveau en attente ; le fichier d'un lot annulé ne se télécharge plus.
  refus(KARIM, 'paie.lotAnnuler', { id: lot.id }, 403);
  assert.match(String(run(PAIE, 'paie.lotAnnuler', { id: lot.id })), new RegExp(`^Lot n° ${lot.id} annulé — ${n} feuilles libérées, de nouveau en attente$`));
  assert.equal(enAttente(), n);
  assert.deepEqual([lots().at(-1)!.statut, lots().at(-1)!.annulePar], ['annule', 'Aïcha Diallo']);
  assert.equal(lots().at(-1)!.feuilles.length, n, 'feuilles gardées sur le lot annulé');
  assert.equal(run(PAIE, 'paie.lotAnnuler', { id: lot.id }), `Lot n° ${lot.id} déjà annulé`);
  refus(PAIE, 'paie.lotConfirmer', { id: lot.id }, 409, /annulé : générez un nouveau lot/);
  const a = journal('paie.lotAnnuler')[0];
  assert.deepEqual([a.payload.avant.statut, a.payload.apres.statut, a.paie], ['genere', 'annule', true]);
  const srv = await serveurFichier(db);
  try {
    const paie = await srv.session(compteDe(7));
    assert.equal((await srv.fichier(lot.id, paie)).status, 409);
    // Nouveau lot, fichier téléchargé, puis annulé : la confirmation rappelle de supprimer l'import dans Sage.
    run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
    const second = lots().at(-1)!;
    assert.equal((await srv.fichier(second.id, paie)).status, 200);
    assert.match(String(run(PAIE, 'paie.lotAnnuler', { id: second.id })), /si son fichier a été importé dans Sage, supprimez-y cet import/);
    // Lot historique : aucun fichier.
    const historique = lots().find(l => l.historique)!;
    assert.equal((await srv.fichier(historique.id, paie)).status, 409);
  } finally {
    await srv.fermer();
  }
  // Simulation : confirmé sans fichier, référence simulée.
  run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
  const troisieme = lots().at(-1)!;
  assert.match(String(run(PAIE, 'paie.lotConfirmer', { id: troisieme.id })), /marqué transmis \(simulation, rien n’est envoyé à Sage Paie\) — .* · référence SIM-2026-10-\d+$/);
  assert.equal(transmises(), avant + n);
  // Instantanés : lots sans contenu pour le service RH, la paie et la lecture seule ; rien pour le manager ni le collaborateur.
  const vus = buildSnapshot(db, PAIE).lotsPaie;
  assert.ok(vus.length >= 4 && vus.every(l => !('contenu' in l)) && vus[0].id === troisieme.id, 'du plus récent au plus ancien');
  assert.ok(buildSnapshot(db, ADMIN).formatFichierPaie);
  for (const u of [KARIM, fresh(db).user(2, 'collaborateur')]) {
    const ds = buildSnapshot(db, u);
    assert.deepEqual([ds.lotsPaie, ds.formatFichierPaie], [[], null]);
  }
});

test('t029 transmission en un clic : simulation seulement, en un lot transmis', () => {
  const { run, refus, lots, journal, PAIE } = fresh();
  avecEnv({ SAGE_MODE: 'fichier' }, () => refus(PAIE, 'temps.pushSage', {}, 503, /Générez le lot de la période/));
  run(PAIE, 'temps.pushSage', {});
  const lot = lots().at(-1)!;
  assert.deepEqual([lot.mode, lot.statut, lot.periode], ['simulation', 'transmis', '2026-10']);
  assert.match(lot.reference!, /^SIM-2026-10-\d+$/);
  assert.equal(journal('temps.pushSage').at(-1)!.payload.lot, lot.id);
});

// — Reprise —

test('t029 migration : feuilles déjà transmises réunies en un lot historique, une seule fois, tracé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-lots-'));
  try {
    const file = join(dir, 'cursus.db');
    const db = new Db(file);
    appliquerMigrations(db);
    seedDemo(db);
    // Base d'avant les lots : feuilles transmises sans lot, dernière transmission gardée dans un réglage.
    db.sql.exec(`UPDATE feuilles SET lot_id = NULL; DELETE FROM lots_paie; DELETE FROM migrations WHERE nom = 'lot4-paie-lots-historiques'`);
    // Envoi du 2 octobre (septembre clos) de la semaine du 21 septembre : rappel de septembre sur la paie d'octobre.
    db.setSetting('lastSagePush', { mode: 'simulation', envoye_le: '2026-10-02T17:02:00+02:00', lignes: [], periodes: ['2026-10'] });
    const transmises = Number((db.sql.prepare('SELECT COUNT(*) AS n FROM feuilles WHERE sage = 1').get() as { n: number }).n);
    assert.ok(transmises > 0);
    db.sql.close();
    const ancienne = new Db(file);
    assert.equal(LOTS_HISTORIQUES.necessaire!(ancienne), true);
    assert.deepEqual(appliquerMigrations(ancienne), ['lot4-paie-lots-historiques']);
    const [lot] = lireLots(ancienne);
    assert.deepEqual([lot.statut, lot.historique, lot.mode, lot.feuilles.length, lot.creation], ['transmis', true, 'simulation', transmises, '2026-10-02T15:02:00.000Z']);
    // Période selon la règle de rattachement au jour de l'envoi (et non le mois du lundi de la semaine).
    assert.deepEqual([lot.periode, lot.periodes, lot.rappels], ['2026-10', ['2026-10'], ['2026-09']]);
    assert.equal(Number((ancienne.sql.prepare('SELECT COUNT(*) AS n FROM feuilles WHERE sage = 1 AND lot_id IS NULL').get() as { n: number }).n), 0);
    const j = ancienne.all<Ligne>('journal').filter(l => l.action === 'migration.lotsPaie');
    assert.equal(j.length, 1);
    assert.equal(j[0].message, `Reprise : ${transmises} feuilles déjà transmises à la paie réunies dans le lot historique n° ${lot.id}`);
    assert.ok(j[0].paie && familleAction('migration.lotsPaie')?.id === 'temps');
    assert.equal(LOTS_HISTORIQUES.necessaire!(ancienne), false);
    assert.deepEqual(appliquerMigrations(ancienne), [], 'rien à refaire');
    ancienne.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// — Confirmations de l'écran Temps —

test('t029 confirmations : génération, annulation, validation groupée', () => {
  const g = C.generationLot({
    periode: '2026-10', feuilles: 3, salaries: 2, mode: 'fichier', sansMatricule: [],
    rappels: [{ periode: '2026-10', origine: '2026-09', feuilles: 1, salaries: 1, semaines: ['1|2026-09-21'] }],
  });
  assert.equal(g.question, 'Générer le lot d’octobre 2026 : 3 feuilles validées (2 salariés) ?');
  assert.match(C.generationLot({ periode: '2026-11', feuilles: 1, salaries: 1, mode: 'fichier', sansMatricule: [], rappels: [] }).question, /^Générer le lot de novembre 2026/);
  assert.deepEqual([g.titre, g.action, g.payload], ['Générer le fichier d’import', 'paie.lotGenerer', { periode: '2026-10' }]);
  assert.ok(g.suites!.includes('Rappel : 1 feuille de septembre 2026, période close, part sur octobre 2026.'));
  assert.ok(g.suites!.includes(L.PERIMETRE_FICHIER));
  const s = C.generationLot({ periode: '2026-10', feuilles: 1, salaries: 1, mode: 'simulation', sansMatricule: ['Bastien Morel'], rappels: [] });
  assert.equal(s.titre, 'Générer le lot (simulation)');
  assert.ok(s.suites!.some(x => /^Simulation : rien n’est envoyé/.test(x)) && s.suites!.some(x => /Bastien Morel/.test(x)));
  const a = C.annulationLot({ id: 4, periode: '2026-10', feuilles: [{ empId: 1, week: '2026-10-05' }, { empId: 2, week: '2026-10-05' }], telechargements: 1 });
  assert.deepEqual([a.question, a.action, a.payload], ['Annuler le lot n° 4 (octobre 2026) ?', 'paie.lotAnnuler', { id: 4 }]);
  assert.ok(a.suites![0].startsWith('Ses 2 feuilles redeviennent') && /supprimez-y cet import/.test(a.suites![1]));
  assert.equal(C.annulationLot({ id: 5, periode: '2026-10', feuilles: [{ empId: 1, week: '2026-10-05' }], telechargements: 0 }).suites!.join(), 'Sa feuille redevient en attente et pourra partir dans un nouveau lot.');
  const v = C.validationGroupee([{ empId: 2, week: '2026-10-05' }, { empId: 6, week: '2026-10-05' }], 2);
  assert.deepEqual([v.question, v.bouton, v.action], ['Valider 2 feuilles soumises (2 salariés) ?', 'Valider les 2 feuilles', 'temps.validerLot']);
  assert.equal(C.validationGroupee([{ empId: 2, week: '2026-10-05' }], 1).bouton, 'Valider la feuille');
});
