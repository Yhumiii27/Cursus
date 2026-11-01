// Notes de frais, lot 12, chantier C2, étape 1 : fenêtre de 13 mois après paiement dans l'instantané, sur le jeu de
// démonstration du 10 octobre 2026 complété de notes archivées (tests/support/frais-archives.ts) :
// - règle de la fenêtre (borne, note archivée, période d'une recherche dans l'historique) ;
// - lectures ciblées en base : cumul kilométrique de l'année (note tardive de l'année passée), doublons hors de la
//   fenêtre, notes à exporter (archivées comprises), éléments de la famille « frais » d'un lot ;
// - refus 409 « note archivée » de toute écriture sur une note hors de la fenêtre (actions de frais, justificatifs) ;
// - routes d'historique filtrées par les règles de l'instantané : collaborateur, manager limité à `idsFrais` (jamais une
//   note médicale d'autrui), comptabilité et service RH (frais médicaux compris), paie sans lignes ni justificatifs,
//   référent HSE et lecture seule en 403 tracé ; pagination, période de 24 mois au plus, consultation d'autrui tracée
//   (`frais.historique.consulter`, salariés et nombre de notes seulement) ; garde de navigation.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
// Démonstration : connexion sans mot de passe (routes).
process.env.CURSUS_DEMO = '1';

const { nouvelleBase } = await import('./base.ts');
(await import('../server/src/logs.ts')).reglerJournaux({ sortie: () => {} });
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, idsFrais, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { createApp } = await import('../server/src/app.ts');
const { Domain } = await import('../shared/domain.ts');
const { avecHistorique, avecHistoriquePaie, ikDeLAnneeEnBase, notesExportablesEnBase, salariesIkDeLAnnee } = await import('../server/src/frais-base.ts');
const { FAMILLE_FRAIS } = await import('../server/src/frais-paie.ts');
const F = await import('../shared/rules/frais-fenetre.ts');
const { JOURNAL_LABEL, familleAction } = await import('../shared/journal.ts');
const { notesArchivees } = await import('./support/frais-archives.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Db = Awaited<ReturnType<typeof nouvelleBase>>;

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const a = await notesArchivees(db);
  const compteDe = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o as { message: string; result?: any };
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>) => {
    try { await run(u, name, p); } catch (e) { if (e instanceof ActionError) return { status: e.status, message: e.message }; throw e; }
    assert.fail(`${name} aurait dû être refusée`);
  };
  return {
    db, a, run, refus,
    ADMIN: await user(null, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur'), MANON: await user(21, 'rh'),
  };
}

test('règle de la fenêtre : borne à 13 mois, note archivée payée avant la borne, période de recherche de 24 mois au plus', () => {
  assert.equal(F.borneFrais('2026-10-10'), '2025-09-10');
  assert.equal(F.borneFrais('2026-03-31'), '2025-02-28', 'fin de mois');
  const n = (statut: string, payeeLe: string | null) => ({ statut, payeeLe }) as never;
  assert.equal(F.noteArchivee(n('payee', '2025-09-09'), '2026-10-10'), true);
  assert.equal(F.noteArchivee(n('payee', '2025-09-10'), '2026-10-10'), false, 'payée le jour de la borne : dans la fenêtre');
  assert.equal(F.noteArchivee(n('en_paiement', '2024-01-01'), '2026-10-10'), false, 'seules les notes payées sortent');
  assert.equal(F.noteArchivee(n('controlee', null), '2026-10-10'), false);
  assert.match(F.refusNoteArchivee(12), /^Note de frais n° 12 archivée \(payée depuis plus de 13 mois\)/);
  assert.deepEqual(F.periodeHistorique({}, '2026-10-10'), { du: '2024-11', au: '2026-10' }, '24 derniers mois par défaut');
  assert.deepEqual(F.periodeHistorique({ du: '2025-01-15', au: '2025-06' }, '2026-10-10'), { du: '2025-01', au: '2025-06' });
  assert.deepEqual(F.periodeHistorique({ du: '2023-01', au: '2024-12' }, '2026-10-10'), { du: '2023-01', au: '2024-12' }, '24 mois exactement');
  assert.match((F.periodeHistorique({ du: '2023-01', au: '2025-01' }, '2026-10-10') as { erreur: string }).erreur, /24 mois au plus/);
  assert.match((F.periodeHistorique({ du: '2025-06', au: '2025-01' }, '2026-10-10') as { erreur: string }).erreur, /à l’envers/);
  assert.match((F.periodeHistorique({ du: '2025-13' }, '2026-10-10') as { erreur: string }).erreur, /Début de période invalide/);
  assert.match((F.periodeHistorique({ au: 'demain' }, '2026-10-10') as { erreur: string }).erreur, /Fin de période invalide/);
});

test('index des doublons : mêmes identifiants, dans le même ordre, que doublonsDe ligne par ligne', async () => {
  const { doublonsDe, indexDoublons } = await import('../shared/rules/frais.ts');
  const l = (id: number, noteId: number, o: Record<string, unknown> = {}) => ({ id, noteId, empId: 2, date: '2026-10-06', montantEur: 18.9, commercant: 'Brasserie du Port', refuseeLe: null, ...o }) as never;
  const lignes = [l(1, 10), l(2, 11, { commercant: 'BRASSERIE  du port' }), l(3, 12), l(4, 13, { refuseeLe: '2026-10-07' }), l(5, 14), l(6, 10, { montantEur: 19 }), l(7, 15, { empId: 3 })];
  const notes = [{ id: 12, statut: 'annulee' }, { id: 10, statut: 'brouillon' }] as never[];
  const index = indexDoublons(lignes, notes);
  for (const x of [...lignes, l(99, 10), l(100, 10, { date: '2026-10-07' })]) assert.deepEqual(index(x), doublonsDe(x, lignes, notes), `ligne ${(x as { id: number }).id}`);
});

test('lectures ciblées : cumul kilométrique de l’année avec les trajets archivés, doublons hors de la fenêtre, barème d’une année passée', async () => {
  const { db, a, run, MEHDI, ADMIN } = await fresh();
  assert.deepEqual((await ikDeLAnneeEnBase(db, 2, 2025)).lignes.map(l => l.id), [a.trajet], 'trajet de la note archivée lu en base');
  assert.deepEqual(await salariesIkDeLAnnee(db, 2025), [2]);
  // Note tardive de 2025 (délai de soumission jusqu'à 24 mois) : la part marginale part du cumul de l'année (4 990 km
  // archivés), dans la deuxième tranche du barème : (5 040 × 0,357 + 1 395) − 4 990 × 0,636 = 20,64 €, et non 31,80 €.
  const { result: { note } } = await run(MEHDI, 'frais.note.creer', { periode: '2025-12' });
  const ik = await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2025-12-15', categorie: 'ik', km: 50, vehiculeId: a.vehicule2025, sansJustificatif: true, attestation: true });
  assert.equal((await db.get<{ montantEur: number }>('lignesFrais', ik.result.ligne))!.montantEur, 20.64);
  // Doublon d'une dépense archivée (même date, même montant, même commerçant) : signalé.
  const d = await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2025-06-12', categorie: 'repas', montant: 18.9, commercant: 'Brasserie du Port', sansJustificatif: true, attestation: true });
  assert.match(d.message, /doublon possible avec 1 autre dépense/);
  // Barème 2025 republié : la ligne de la note tardive est recalculée, celle de la note archivée (payée) jamais.
  const tranches = (await db.all<{ annee: number; cvMin: number; cvMax: number | null; kmMin: number; kmMax: number | null; a: number; b: number }>('baremesKm')).filter(t => t.annee === 2025)
    .map(t => ({ cvMin: t.cvMin, cvMax: t.cvMax, kmMin: t.kmMin, kmMax: t.kmMax, a: t.a, b: t.b === 1395 ? 1400 : t.b }));
  await run(ADMIN, 'frais.bareme.enregistrer', { annee: 2025, type: 'voiture', tranches });
  assert.equal((await db.get<{ montantEur: number }>('lignesFrais', ik.result.ligne))!.montantEur, 25.64, 'constante b de 1 395 à 1 400 € : + 5 €');
  assert.equal((await db.get<{ montantEur: number }>('lignesFrais', a.trajet))!.montantEur, 3173.64, 'trajet payé inchangé');

  // Instantané complété : rien à ajouter pour une dépense de la fenêtre (même objet), sinon les lignes de la base.
  const ds = await loadFull(db, ADMIN);
  assert.equal(await avecHistorique(db, ds, [{ empId: 2, date: '2026-10-06', categorie: 'repas' }]), ds);
  const h = await avecHistorique(db, ds, [{ empId: 2, date: '2025-06-12', categorie: 'repas' }]);
  assert.ok(h.lignesFrais!.some(l => l.id === a.repas) && h.notesFrais!.some(n => n.id === a.archivee));
  assert.equal(h.lignesFrais!.length, ds.lignesFrais!.length + 1, 'la dépense archivée du même jour seulement');
  // Même justificatif (empreinte) qu'une dépense archivée : la dépense et le justificatif reviennent.
  const lid = ds.lignesFrais!.find(l => l.noteId === note && l.categorie === 'repas')!.id;
  const avecPiece = { ...ds, pieces: [...ds.pieces!, { id: 99_999, empId: 2, objet: 'ligneFrais', objetId: lid, nom: 'r.pdf', type: 'application/pdf', taille: 3, empreinte: 'empreinte-repas-2025' } as never] };
  const e = await avecHistorique(db, avecPiece, [{ id: lid, empId: 2, date: '2025-11-30', categorie: 'repas' }]);
  assert.ok(e.pieces!.some(p => p.id === a.pieceRepas) && e.lignesFrais!.some(l => l.id === a.repas));
});

test('paie et export : éléments du lot sur l’instantané complété, notes archivées jamais exportées comprises dans l’export', async () => {
  const { db, a, run, MEHDI, MANON } = await fresh();
  // Note tardive de 2025 contrôlée : les trajets archivés de l'année complètent l'instantané du lot (limite d'exonération).
  const { result: { note } } = await run(MEHDI, 'frais.note.creer', { periode: '2025-12' });
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2025-12-15', categorie: 'ik', km: 50, vehiculeId: a.vehicule2025, sansJustificatif: true, attestation: true });
  await db.run(`UPDATE notes_frais SET statut = 'controlee' WHERE id = ?`, [note]);
  // Avance de Thomas Garnier déjà imputée par un lot (note archivée) : la note transmise revient pour les déductions.
  await db.run(`UPDATE notes_frais SET lot_id = 1 WHERE id = ?`, [a.thomas]);
  await db.insert('avancesFrais', { empId: 6, montant: 100, voyageId: null, missionId: null, statut: 'versee', demandeLe: '2025-03-01T08:00:00.000Z', valideeLe: null, valideePar: null, lotId: null, verseeLe: '2025-03-31', annuleeLe: null, annuleePar: null, refusMotif: null });
  const ds = await loadFull(db, MANON);
  assert.ok(!ds.lignesFrais!.some(l => l.id === a.trajet));
  const c = await avecHistoriquePaie(db, ds);
  assert.ok(c.lignesFrais!.some(l => l.id === a.trajet), 'trajet archivé de l’année');
  assert.ok(c.notesFrais!.some(n => n.id === a.thomas), 'note transmise d’un salarié qui a une avance');
  const elements = await FAMILLE_FRAIS.aEmettre(db, new Domain(ds), '2026-10');
  assert.deepEqual(elements.filter(x => x.note === note).map(x => [x.rubrique, x.montant]), [['FRAIS_IK', 20.64]]);

  // Export : notes exportables lues en base ; `attendues` reste le nombre affiché (celles de la fenêtre).
  assert.deepEqual((await notesExportablesEnBase(db)).map(n => n.id).sort((x, y) => x - y), [a.archivee, a.bord, a.medicale, a.thomas, a.nadia, note].sort((x, y) => x - y));
  const g = await run(MANON, 'frais.export.generer', { attendues: 2 });
  assert.match(g.message, /— 6 notes \(dont 4 notes archivées\),/);
  assert.equal(g.result.archivees, 4);
  const x = await db.get<{ notes: number[] }>('exportsFrais', g.result.export);
  assert.ok(x!.notes.includes(a.nadia) && x!.notes.includes(a.medicale));
});

test('note archivée : toute écriture refusée (409), actions de frais et justificatifs', async () => {
  const { db, a, refus, ADMIN, KARIM, MEHDI, MANON } = await fresh();
  const archivee = (r: { status: number; message: string }) => { assert.equal(r.status, 409); assert.match(r.message, /archivée \(payée depuis plus de 13 mois\)/); };
  archivee(await refus(ADMIN, 'frais.note.annuler', { id: a.archivee, motif: 'Essai' }));
  archivee(await refus(ADMIN, 'frais.note.controler', { id: a.thomas }));
  archivee(await refus(KARIM, 'frais.note.valider', { id: a.thomas }));
  archivee(await refus(KARIM, 'frais.note.renvoyer', { id: a.thomas, motif: 'Essai' }));
  archivee(await refus(MEHDI, 'frais.note.soumettre', { id: a.archivee }));
  archivee(await refus(MEHDI, 'frais.ligne.ajouter', { noteId: a.archivee, date: '2025-06-13', categorie: 'divers', montant: 5, sansJustificatif: true, attestation: true }));
  archivee(await refus(MEHDI, 'frais.ligne.modifier', { id: a.repas, montant: 10 }));
  archivee(await refus(MEHDI, 'frais.ligne.supprimer', { id: a.repas }));
  archivee(await refus(MANON, 'frais.ligne.refuser', { id: a.repas, motif: 'Essai' }));
  archivee(await refus(MANON, 'frais.ligne.plafonner', { id: a.repas, montant: 1 }));
  archivee(await refus(ADMIN, 'piece.retirer', { id: a.pieceRepas, motif: 'Essai' }));
  // Hors du périmètre, le refus reste celui d'avant (403, rien n'est révélé de la note) ; dans la fenêtre, rien ne change.
  assert.equal((await refus(MEHDI, 'frais.note.annuler', { id: a.thomas, motif: 'Essai' })).status, 403);
  assert.match((await refus(ADMIN, 'frais.note.annuler', { id: a.bord, motif: 'Essai' })).message, /en paiement ou payée/);
  assert.equal((await db.get<{ statut: string }>('notesFrais', a.archivee))!.statut, 'payee');
});

// — Routes d'historique —

let srv: Server, port: number, dbHttp: Db, A: Awaited<ReturnType<typeof notesArchivees>>;
const dist = mkdtempSync(join(tmpdir(), 'cursus-frais-hist-'));
before(async () => {
  dbHttp = await nouvelleBase();
  await seedDemo(dbHttp);
  A = await notesArchivees(dbHttp);
  srv = await new Promise<Server>(ok => { const s = createApp(dbHttp, { dist, production: false }).listen(0, '127.0.0.1', () => ok(s)); });
  port = (srv.address() as AddressInfo).port;
});
after(() => { srv?.close(); rmSync(dist, { recursive: true, force: true }); });
interface Reponse { status: number; headers: IncomingHttpHeaders; corps: Buffer; json: () => any }
function appel(chemin: string, o: { method?: string; headers?: Record<string, string>; corps?: string } = {}): Promise<Reponse> {
  return new Promise((ok, ko) => {
    const req = request({ host: '127.0.0.1', port, path: chemin, method: o.method ?? 'GET', headers: o.headers }, r => {
      const m: Buffer[] = [];
      r.on('data', (x: Buffer) => m.push(x));
      r.on('end', () => { const corps = Buffer.concat(m); ok({ status: r.statusCode!, headers: r.headers, corps, json: () => JSON.parse(corps.toString('utf8')) }); });
    }).on('error', ko);
    req.end(o.corps);
  });
}
const post = async (chemin: string, corps: unknown, cookie: string, espace = 'rh') => await appel(chemin, { method: 'POST', corps: JSON.stringify(corps), headers: { 'content-type': 'application/json', cookie, 'x-cursus-espace': espace } });
/** Session ouverte dans un espace ; en-têtes d'un appel par fetch depuis l'écran. */
async function session(role: string, empId: number | null): Promise<Record<string, string>> {
  const s = await appel('/api/session');
  const cookie = String(s.headers['set-cookie']).match(/cursus_session=[^;]*/)![0];
  const compte = (await dbHttp.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const r = await post('/api/login', { role, compteId: compte.id, password: 'x' }, cookie, role);
  assert.equal(r.status, 200, JSON.stringify(r.json()));
  return { cookie: String(r.headers['set-cookie'] ?? cookie).match(/cursus_session=[^;]*/)?.[0] ?? cookie, 'x-cursus-espace': role, 'sec-fetch-site': 'same-origin' };
}
const lire = async (chemin: string, h: Record<string, string>) => await appel(chemin, { headers: h });
const journal = async (action: string) => (await dbHttp.all<{ action: string; message: string | null; payload: Record<string, unknown>; salaries: number[] | null }>('journal')).filter(l => l.action === action);
const PERIODE = '?du=2025-01&au=2026-10';

test('historique du collaborateur : ses notes, archivées comprises, médicales comprises ; justificatifs sans empreinte ; rien d’autrui', async () => {
  const h = await session('collaborateur', 2);
  const r = await lire(`/api/frais/historique${PERIODE}`, h);
  assert.equal(r.status, 200);
  const x = r.json();
  assert.ok(x.notes.every((n: { empId: number }) => n.empId === 2));
  for (const id of [A.archivee, A.bord, A.medicale]) assert.ok(x.notes.some((n: { id: number }) => n.id === id), `note ${id}`);
  assert.deepEqual(x.notes.map((n: { id: number }) => n.id), x.notes.map((n: { id: number }) => n.id).sort((p: number, q: number) => q - p), 'de la plus récente à la plus ancienne');
  assert.equal(x.totaux[A.archivee], 3192.54);
  assert.deepEqual([x.du, x.au, x.page, x.parPage], ['2025-01', '2026-10', 1, 100]);
  const d = (await lire(`/api/frais/historique/${A.archivee}`, h)).json();
  assert.deepEqual(d.lignes.map((l: { id: number }) => l.id).sort(), [A.repas, A.trajet].sort());
  assert.deepEqual(d.pieces.map((p: { id: number; empreinte: unknown }) => [p.id, p.empreinte]), [[A.pieceRepas, null]]);
  const m = (await lire(`/api/frais/historique/${A.medicale}`, h)).json();
  assert.deepEqual(m.pieces.map((p: { id: number }) => p.id), [A.pieceMedicale], 'ses propres frais médicaux');
  // Note d'un autre, salarié d'un autre, inconnue : même refus (403), tracé quand la note existe.
  const avant = (await journal('acces.refuse')).length;
  assert.equal((await lire(`/api/frais/historique/${A.thomas}`, h)).status, 403);
  assert.equal((await lire('/api/frais/historique/999999', h)).status, 403);
  assert.equal((await lire(`/api/frais/historique${PERIODE}&empId=6`, h)).status, 403);
  assert.equal((await journal('acces.refuse')).length, avant + 2);
  assert.equal((await journal('frais.historique.consulter')).length, 0, 'ses propres notes : rien au journal');
});

test('historique du manager : salariés dont il valide les frais (idsFrais), jamais une note médicale d’autrui ; justificatifs ordinaires', async () => {
  const h = await session('manager', 12);
  const ids = idsFrais(new Domain(await loadFull(dbHttp, { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' })), { role: 'manager', empId: 12, nom: 'Karim Haddad', intitule: '' });
  assert.ok(ids.has(2) && ids.has(6) && !ids.has(9), 'Mehdi Benali et Thomas Garnier, pas Nadia Kaci');
  const x = (await lire(`/api/frais/historique${PERIODE}`, h)).json();
  const vues = new Set(x.notes.map((n: { id: number }) => n.id));
  assert.ok(vues.has(A.archivee) && vues.has(A.thomas) && vues.has(A.bord));
  assert.ok(!vues.has(A.medicale), 'note médicale d’un salarié de l’équipe : jamais');
  assert.ok(!vues.has(A.nadia), 'hors de idsFrais');
  assert.ok(x.notes.every((n: { empId: number }) => n.empId === 12 || ids.has(n.empId)));
  assert.equal(x.total, x.notes.length, 'pagination sur le seul périmètre');
  const d = (await lire(`/api/frais/historique/${A.archivee}`, h)).json();
  assert.equal(d.lignes.length, 2);
  assert.deepEqual(d.pieces.map((p: { id: number; empreinte: unknown }) => [p.id, p.empreinte]), [[A.pieceRepas, null]]);
  assert.equal((await lire(`/api/frais/historique/${A.medicale}`, h)).status, 403);
  assert.equal((await lire(`/api/frais/historique/${A.nadia}`, h)).status, 403);
  assert.equal((await lire(`/api/frais/historique${PERIODE}&empId=9`, h)).status, 403);
  // Filtre sur un salarié de son périmètre : ses notes ordinaires seulement.
  const f = (await lire(`/api/frais/historique${PERIODE}&empId=2`, h)).json();
  assert.ok(f.notes.length > 0 && f.notes.every((n: { empId: number; medicale: boolean }) => n.empId === 2 && !n.medicale));
  assert.ok(f.notes.some((n: { id: number }) => n.id === A.archivee) && f.notes.some((n: { id: number }) => n.id === A.bord));
});

test('historique de la comptabilité et du service RH : tout, frais médicaux compris ; consultation d’autrui tracée (salariés et nombre seulement)', async () => {
  const manon = await session('rh', 21);
  const avant = (await journal('frais.historique.consulter')).length;
  const x = (await lire(`/api/frais/historique${PERIODE}&statut=payee`, manon)).json();
  for (const id of [A.archivee, A.medicale, A.thomas, A.nadia, A.bord]) assert.ok(x.notes.some((n: { id: number }) => n.id === id));
  assert.ok(x.notes.every((n: { statut: string }) => n.statut === 'payee'));
  assert.equal(x.notes.find((n: { id: number }) => n.id === A.medicale).medicale, true);
  const m = (await lire(`/api/frais/historique/${A.medicale}`, manon)).json();
  assert.deepEqual(m.pieces.map((p: { id: number; empreinte: unknown }) => [p.id, p.empreinte]), [[A.pieceMedicale, null]], 'frais médicaux, sans empreinte');
  assert.equal((await lire('/api/frais/historique/999999', manon)).status, 404, 'tout voir : introuvable');
  const traces = (await journal('frais.historique.consulter')).slice(avant);
  assert.equal(traces.length, 2);
  assert.deepEqual(Object.keys(traces[0].payload), ['notes']);
  assert.equal(traces[0].payload.notes, x.notes.length);
  assert.deepEqual([...traces[0].salaries!].sort((p, q) => p - q), [...new Set(x.notes.map((n: { empId: number }) => n.empId))].sort((p, q) => (p as number) - (q as number)));
  assert.deepEqual([traces[1].payload, traces[1].salaries], [{ notes: 1 }, [2]]);
  assert.match(traces[1].message!, /^Historique des notes de frais consulté — 1 note$/);
  assert.equal(JOURNAL_LABEL['frais.historique.consulter'], 'Historique des notes de frais consulté');
  assert.equal(familleAction('frais.historique.consulter')?.id, 'frais');
  // Service RH : justificatifs avec empreinte (comme son instantané).
  const admin = await session('rh', null);
  const d = (await lire(`/api/frais/historique/${A.archivee}`, admin)).json();
  assert.equal(d.pieces[0].empreinte, 'empreinte-repas-2025');
});

test('historique de la paie : notes à rembourser sans lignes, justificatifs, motif ni indicateur médical ; HSE et lecture seule refusés', async () => {
  const paie = await session('rh', 7);
  const x = (await lire(`/api/frais/historique${PERIODE}`, paie)).json();
  assert.ok(x.notes.some((n: { id: number }) => n.id === A.archivee));
  assert.ok(x.notes.every((n: { statut: string; medicale: boolean; renvoiMotif: unknown; valideePar: unknown }) => ['controlee', 'en_paiement', 'payee'].includes(n.statut) && !n.medicale && n.renvoiMotif === null && n.valideePar === null));
  assert.deepEqual(x.totaux, {});
  const d = (await lire(`/api/frais/historique/${A.medicale}`, paie)).json();
  assert.deepEqual([d.note.medicale, d.lignes, d.pieces], [false, [], []]);
  for (const [empId, quoi] of [[23, 'référent HSE'], [11, 'lecture seule']] as const) {
    const h = await session('rh', empId);
    const avant = (await journal('acces.refuse')).length;
    assert.equal((await lire(`/api/frais/historique${PERIODE}`, h)).status, 403, quoi);
    assert.equal((await lire(`/api/frais/historique/${A.archivee}`, h)).status, 403, quoi);
    assert.equal((await journal('acces.refuse')).length, avant + 2, `${quoi} : refus tracés`);
  }
});

test('historique : pagination de 100 notes, paramètres contrôlés, garde de navigation, connexion requise', async () => {
  const admin = await session('rh', null);
  await dbHttp.tx(async () => {
    for (let i = 0; i < 105; i++) {
      await dbHttp.insert('notesFrais', {
        empId: 16, periode: '2024-12', voyageId: null, missionId: null, projet: null, medicale: false, statut: 'payee', creeLe: '2024-12-28T17:00:00.000Z', creePar: 'Essai',
        soumiseLe: null, valideeLe: null, valideePar: null, controleeLe: null, controleePar: null, renvoyeeLe: null, renvoyeePar: null, renvoiMotif: null, lotId: null,
        payeeLe: '2025-01-28', annuleeLe: null, annuleePar: null, annuleMotif: null,
      });
    }
  });
  const p1 = (await lire('/api/frais/historique?du=2024-12&au=2024-12&empId=16', admin)).json();
  assert.deepEqual([p1.total, p1.pages, p1.notes.length], [105, 2, 100]);
  const p2 = (await lire('/api/frais/historique?du=2024-12&au=2024-12&empId=16&page=2', admin)).json();
  assert.equal(p2.notes.length, 5);
  assert.ok(Math.min(...p1.notes.map((n: { id: number }) => n.id)) > Math.max(...p2.notes.map((n: { id: number }) => n.id)));
  for (const q of ['?du=2023-01&au=2025-06', '?du=2025-06&au=2025-01', '?statut=perdue', '?page=0', '?empId=abc']) {
    assert.equal((await lire(`/api/frais/historique${q}`, admin)).status, 400, q);
  }
  assert.equal((await appel('/api/frais/historique', { headers: { cookie: admin.cookie } })).status, 403, 'sans en-tête d’espace : navigation refusée');
  assert.equal((await appel(`/api/frais/historique/${A.archivee}`, { headers: { cookie: admin.cookie, 'sec-fetch-site': 'cross-site', 'x-cursus-espace': 'rh' } })).status, 403);
  assert.equal((await appel('/api/frais/historique', { headers: { 'x-cursus-espace': 'rh' } })).status, 401);
});
