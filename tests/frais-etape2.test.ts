// Notes de frais, étape 2 (lot 11, chantier C5) sur le jeu de démonstration du 10 octobre 2026 : fichier d'écritures
// (règles par valeurs, frais médicaux au compte et au libellé génériques, TVA au prorata), exports comptables (actions,
// journal en liste blanche, route du fichier tracée, droits), dépense rapide (note du mois créée au besoin, jamais
// médicale, admise hors ligne), notifications du circuit (e-mails et téléphone, sans montant ni motif), justificatifs de
// frais lus par le manager (jamais ceux des frais médicaux), alertes partagées client et serveur, règles d'écran.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
// Démonstration : session RH d'office et connexion sans mot de passe (route du fichier).
process.env.CURSUS_DEMO = '1';

const { nouvelleBase } = await import('./base.ts');
(await import('../server/src/logs.ts')).reglerJournaux({ sortie: () => {} });
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { createApp } = await import('../server/src/app.ts');
const { Domain } = await import('../shared/domain.ts');
const X = await import('../shared/rules/frais-export.ts');
const { alertesDeNote } = await import('../shared/rules/frais-alertes.ts');
const { refusHorsLigne } = await import('../shared/hors-ligne.ts');
const { NOTIFICATIONS_PUSH, TYPES_PUSH } = await import('../shared/notifications-push.ts');
const { REGLAGES, ReglageInvalide } = await import('../shared/reglages.ts');
const { EMAIL_LABEL, PROFILS_RH, vuesDe } = await import('../shared/constants.ts');
const { ACTIONS_PAIE, JOURNAL_LABEL } = await import('../shared/journal.ts');
const S = await import('../client/src/components/frais/saisie.ts');
const C = await import('../client/src/components/frais/commun.ts');
const O = await import('../client/src/components/frais/onglets.ts');
const { versFile, libelleSaisie } = await import('../client/src/pwa/saisie-hors-ligne.ts');
const { lireRecu } = await import('../shared/rules/frais-lecture.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Dataset = Awaited<ReturnType<typeof loadFull>>;
type LigneFrais = NonNullable<Dataset['lignesFrais']>[number];
type NoteFrais = NonNullable<Dataset['notesFrais']>[number];

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
    return o as { message: string; result?: any };
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>) => {
    try { await run(u, name, p); } catch (e) { if (e instanceof ActionError) return { status: e.status, message: e.message }; throw e; }
    assert.fail(`${name} aurait dû être refusée`);
  };
  const journal = async (action: string) => (await db.all<{ action: string; message: string | null; payload: Record<string, unknown>; salaries: number[] | null }>('journal')).filter(l => l.action === action);
  return {
    db, run, refus, journal, ADMIN: await user(null, 'rh'), KARIM: await user(12, 'manager'), MEHDI: await user(2, 'collaborateur'),
    MANON: await user(21, 'rh'), HSE: await user(23, 'rh'), PAIE: await user(7, 'rh'),
  };
}

const R = { fraisComptes: {}, fraisCompteGenerique: '6256', fraisCompteTva: '44566', fraisCompteSalarie: '421', fraisJournal: 'OD' };
const ligne = (o: Partial<LigneFrais>): LigneFrais => ({
  id: 1, noteId: 9, empId: 2, date: '2026-10-06', categorie: 'repas', montant: 22, devise: 'EUR', taux: null, montantEur: 22, tvaTaux: 10, tvaMontant: null,
  commercant: 'Brasserie', forfait: null, km: null, vehiculeId: null, depart: null, arrivee: null, invites: null, motifDepassement: null,
  sansJustificatif: false, attestation: false, montantRetenu: null, refuseeLe: null, refusMotif: null, ...o,
} as LigneFrais);
const note = (o: Partial<NoteFrais> = {}) => ({ id: 9, empId: 2, periode: '2026-10', medicale: false, statut: 'controlee', controleeLe: '2026-10-08T09:00:00.000Z', ...o }) as NoteFrais;

// — Règles du fichier d'écritures —

test('écritures d’une note : charges par compte, TVA récupérable, crédit du salarié ; équilibrées', () => {
  const lignes = [
    ligne({ id: 1, categorie: 'repas', montantEur: 22, montant: 22, tvaTaux: 10 }),
    ligne({ id: 2, categorie: 'train', montantEur: 80, montant: 80, tvaTaux: 10 }),
    ligne({ id: 3, categorie: 'carburant', montantEur: 60, montant: 60, tvaTaux: 20 }),
    ligne({ id: 4, categorie: 'hotel', montantEur: 90, montant: 90, refuseeLe: '2026-10-08' }),
  ];
  const e = X.ecrituresNote(note(), lignes, { nom: 'Mehdi Benali', compteTiers: 'M0002' }, R, '2026-10-08');
  // Repas : TVA 2,00 récupérable ; carburant : 80 % de 10,00 ; train : aucune ; hôtel refusé : rien.
  assert.deepEqual(e.map(x => [x.compte, x.debit, x.credit, x.compteTiers]), [
    ['6061', 52, 0, null], ['6251', 80, 0, null], ['6256', 20, 0, null], ['44566', 10, 0, null], ['421', 0, 162, 'M0002'],
  ]);
  assert.ok(e.every(x => x.journal === 'OD' && x.piece === 'NDF-9' && x.libelle === 'NDF 9 Mehdi Benali' && x.date === '2026-10-08'));
  const t = X.totauxEcritures(e);
  assert.deepEqual(t, { ecritures: 5, debit: 162, credit: 162 });
  // Comptes réglés par catégorie ; une dépense ramenée au plafond garde sa TVA au prorata.
  const regle = { ...R, fraisComptes: { repas: '625600' } };
  const plafonne = X.ecrituresNote(note(), [ligne({ montantEur: 22, montant: 22, tvaTaux: 10, montantRetenu: 11 })], { nom: 'M', compteTiers: 'X' }, regle, '2026-10-08');
  assert.deepEqual(plafonne.map(x => [x.compte, x.debit, x.credit]), [['625600', 10, 0], ['44566', 1, 0], ['421', 0, 11]]);
  assert.deepEqual(X.ecrituresNote(note(), [ligne({ refuseeLe: '2026-10-08' })], { nom: 'M', compteTiers: 'X' }, R, '2026-10-08'), [], 'rien de retenu : aucune écriture');
  assert.equal(X.dateEcriture({ controleeLe: null }, '2026-10-10'), '2026-10-10');
});

test('date d’écriture : jour du contrôle à Paris, au passage de minuit (hiver et été) et du mois', () => {
  // 1er novembre 2026 à 0 h 30 à Paris (UTC+1) : écriture du 1er novembre, pas du 31 octobre.
  assert.equal(X.dateEcriture({ controleeLe: '2026-10-31T23:30:00.000Z' }, '2026-11-02'), '2026-11-01');
  // 1er juillet 2026 à 1 h 30 à Paris (UTC+2).
  assert.equal(X.dateEcriture({ controleeLe: '2026-06-30T23:30:00.000Z' }, '2026-07-02'), '2026-07-01');
  // Juste avant minuit à Paris : la veille.
  assert.equal(X.dateEcriture({ controleeLe: '2026-10-31T22:59:59.000Z' }, '2026-11-02'), '2026-10-31');
  assert.equal(X.dateEcriture({ controleeLe: '2026-10-08T09:00:00.000Z' }, '2026-10-10'), '2026-10-08');
});

test('frais médicaux : compte générique (même que « divers »), même libellé que toute dépense, sans TVA', () => {
  const med = X.ecrituresNote(note({ medicale: true }), [ligne({ categorie: 'medical', montantEur: 35, montant: 35, tvaTaux: 10 })], { nom: 'Clara Roussel', compteTiers: 'C' }, { ...R, fraisComptes: { medical: '6999', divers: '6258' } as never }, '2026-10-08');
  assert.deepEqual(med.map(x => [x.compte, x.debit, x.credit]), [['6256', 35, 0], ['421', 0, 35]]);
  assert.ok(med.every(x => x.libelle === 'NDF 9 Clara Roussel'));
  assert.equal(X.compteDeCharge('medical', { ...R, fraisComptes: { medical: '6999' } as never }), '6256', 'jamais de compte propre');
  assert.equal(X.compteDeCharge('divers', R), '6256');
  assert.deepEqual(X.lireComptes({ repas: ' 625600 ', medical: '6999', train: '' }), { repas: '625600' }, 'frais médicaux ignorés');
  assert.equal(typeof X.lireComptes({ repas: '62-56' }), 'string');
  assert.equal(typeof X.lireComptes([]), 'string');
});

test('fichier au gabarit : séparateur, décimale, dates, en-tête, colonnes, guillemets, encodage ; gabarit contrôlé', () => {
  const e = X.ecrituresNote(note(), [ligne({ montantEur: 22, montant: 22, tvaTaux: null })], { nom: 'Élodie « B; »', compteTiers: 'E1' }, R, '2026-10-08');
  const t = X.fichierEcritures(e, X.GABARIT_FRAIS_DEFAUT);
  assert.equal(t.split('\r\n')[0], 'journal;date;compte;compte_tiers;piece;libelle;debit;credit');
  assert.equal(t.split('\r\n')[1], 'OD;08/10/2026;6256;;NDF-9;"NDF 9 Élodie « B; »";22,00;0,00');
  const g = { ...X.GABARIT_FRAIS_DEFAUT, separateur: 'tab' as const, decimale: '.' as const, entete: false, formatDate: 'AAAA-MM-JJ' as const, colonnes: ['date', 'compte', 'debit', 'credit'] as const };
  assert.equal(X.fichierEcritures(e, { ...g, colonnes: [...g.colonnes] }), '2026-10-08\t6256\t22.00\t0.00\r\n2026-10-08\t421\t0.00\t22.00\r\n');
  assert.equal(X.nomFichierEcritures(3, g), 'ecritures-frais-3.txt');
  assert.equal(X.nomFichierEcritures(3, X.GABARIT_FRAIS_DEFAUT), 'ecritures-frais-3.csv');
  assert.deepEqual([...X.octetsEcritures('É', { encodage: 'windows-1252' })], [0xc9]);
  assert.deepEqual(X.lireGabarit({ ...X.GABARIT_FRAIS_DEFAUT }), X.GABARIT_FRAIS_DEFAUT);
  assert.match(String(X.lireGabarit({ ...X.GABARIT_FRAIS_DEFAUT, colonnes: ['date', 'compte'] })), /obligatoires : débit, crédit/);
  assert.match(String(X.lireGabarit({ ...X.GABARIT_FRAIS_DEFAUT, colonnes: ['date', 'date', 'compte', 'debit', 'credit'] })), /en double/);
  for (const k of ['separateur', 'decimale', 'encodage', 'formatDate'] as const) assert.equal(typeof X.lireGabarit({ ...X.GABARIT_FRAIS_DEFAUT, [k]: 'x' }), 'string', k);
  assert.equal(typeof X.lireGabarit({ ...X.GABARIT_FRAIS_DEFAUT, colonnes: 'date' }), 'string');
  assert.equal(typeof X.lireGabarit(null), 'string');
  assert.deepEqual(X.COLONNES_ECRITURE_FACULTATIVES, ['journal', 'compteTiers', 'piece', 'libelle']);
  // Réglages : contrôles des comptes, du journal et du gabarit (parametres.maj).
  assert.equal(REGLAGES.fraisJournal.controle!(' ach ', 'OD'), 'ACH');
  assert.throws(() => REGLAGES.fraisJournal.controle!('JOURNAL1', 'OD'), ReglageInvalide);
  assert.throws(() => REGLAGES.fraisCompteTva.controle!('44 566', '44566'), ReglageInvalide);
  assert.throws(() => REGLAGES.fraisGabarit.controle!({ separateur: '|' }, X.GABARIT_FRAIS_DEFAUT), ReglageInvalide);
  assert.throws(() => REGLAGES.fraisComptes.controle!({ repas: '?' }, {}), ReglageInvalide);
  assert.deepEqual(REGLAGES.fraisComptes.controle!({ repas: '6256a' }, {}), { repas: '6256A' });
});

test('notes à exporter : contrôlées, en paiement ou payées, hors exports en vigueur', () => {
  const notes = [note({ id: 1, statut: 'validee' }), note({ id: 2 }), note({ id: 3, statut: 'payee' }), note({ id: 4, statut: 'en_paiement' })];
  assert.deepEqual(X.notesAExporter(notes, []).map(n => n.id), [2, 3, 4]);
  assert.deepEqual(X.notesAExporter(notes, [{ id: 1, notes: [2, 3], annuleLe: null }]).map(n => n.id), [4]);
  assert.deepEqual(X.notesAExporter(notes, [{ id: 1, notes: [2, 3], annuleLe: '2026-10-09' }, { id: 2, notes: null, annuleLe: null }]).map(n => n.id), [2, 3, 4], 'export annulé');
});

// — Exports comptables : actions, journal, droits —

test('export comptable : généré par la comptabilité, liste vérifiée, journal en liste blanche, annulé ; refusé aux autres', async () => {
  const { db, run, refus, journal, MANON, ADMIN, HSE, PAIE, MEHDI, KARIM } = await fresh();
  // Notes validées de la démonstration (n° 3 de Nadia, n° 4 médicale de Clara) contrôlées par la comptabilité.
  await run(MANON, 'frais.note.controler', { id: 3 });
  await run(MANON, 'frais.note.controler', { id: 4 });
  assert.equal((await refus(MANON, 'frais.export.generer', { attendues: 5 })).status, 409, 'liste changée depuis l’affichage');
  for (const u of [HSE, PAIE, MEHDI, KARIM]) assert.equal((await refus(u, 'frais.export.generer', {})).status, 403);
  const r = await run(MANON, 'frais.export.generer', { attendues: 2 });
  assert.match(r.message, /^Export comptable n° \d+ généré — 2 notes, \d+ lignes d’écriture/);
  assert.doesNotMatch(r.message, /€|Roussel|Kaci/);
  const x = await db.get<{ notes: number[]; contenu: { lignes: { compte: string; libelle: string; debit: number; credit: number }[]; debit: number; credit: number } }>('exportsFrais', r.result.export);
  assert.deepEqual(x!.notes, [3, 4]);
  assert.equal(x!.contenu.debit, x!.contenu.credit);
  // Frais médicaux de Clara : compte générique, libellé de toute note.
  const clara = x!.contenu.lignes.filter(l => l.libelle.includes('Clara'));
  assert.deepEqual(clara.map(l => l.compte), ['6256', '421']);
  const j = (await journal('frais.export.generer')).at(-1)!;
  assert.deepEqual(Object.keys(j.payload).sort(), ['attendues', 'export', 'lignes', 'montant', 'notes'].sort());
  assert.equal(j.payload.notes, 2);
  assert.ok(j.salaries!.includes(9) && j.salaries!.length === 2);
  assert.doesNotMatch(JSON.stringify(j), /medical|Pharmacie|commercant/i);
  assert.ok(ACTIONS_PAIE.includes('frais.export.generer') && ACTIONS_PAIE.includes('frais.export.fichier'));
  for (const a of ['frais.export.generer', 'frais.export.annuler', 'frais.export.fichier']) assert.ok(JOURNAL_LABEL[a], a);
  // Rien de plus à exporter ; annulation (par le service RH) : les notes redeviennent à exporter.
  assert.match((await refus(MANON, 'frais.export.generer', {})).message, /Aucune note contrôlée/);
  assert.equal((await refus(HSE, 'frais.export.annuler', { id: r.result.export })).status, 403);
  assert.equal((await refus(ADMIN, 'frais.export.annuler', { id: 999 })).status, 404);
  assert.match((await run(ADMIN, 'frais.export.annuler', { id: r.result.export })).message, /2 notes redeviennent à exporter/);
  assert.match((await run(ADMIN, 'frais.export.annuler', { id: r.result.export })).message, /déjà annulé/);
  assert.match((await run(MANON, 'frais.export.generer', {})).message, /2 notes/);
  // Module désactivé : plus de génération.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), notesFraisActives: false });
  assert.equal((await refus(MANON, 'frais.export.generer', {})).status, 409);
});

test('note d’un export en vigueur : ni renvoyée ni annulée tant que l’export n’est pas annulé ; recontrôlée, elle est réexportée', async () => {
  const { db, run, refus, MANON, ADMIN, MEHDI } = await fresh();
  const { result: { note: id, empId } } = await run(MEHDI, 'frais.note.creer', { periode: '2026-10' });
  assert.equal(empId, 2);
  const { result: { ligne } } = await run(MEHDI, 'frais.ligne.ajouter', { noteId: id, date: '2026-10-07', categorie: 'divers', montant: 84, sansJustificatif: true, attestation: true });
  await run(MEHDI, 'frais.note.soumettre', { id });
  await run(ADMIN, 'frais.note.valider', { id });
  await run(MANON, 'frais.note.controler', { id });
  const x = (await run(MANON, 'frais.export.generer', {})).result.export as number;
  assert.ok((await db.get<{ notes: number[] }>('exportsFrais', x))!.notes.includes(id));
  // Renvoi par le contrôleur ou annulation par le service RH : refusés, avec l'export à annuler.
  for (const [u, a] of [[MANON, 'frais.note.renvoyer'], [ADMIN, 'frais.note.renvoyer'], [ADMIN, 'frais.note.annuler']] as const) {
    const r = await refus(u, a, { id, motif: 'Montant à revoir' });
    assert.equal(r.status, 409, a);
    assert.match(r.message, new RegExp(`n° ${id} figure dans l’export comptable n° ${x} ; annulez d’abord cet export`));
  }
  assert.equal((await db.get<NoteFrais>('notesFrais', id))!.statut, 'controlee');
  // Export annulé : renvoi admis ; corrigée, resoumise et recontrôlée, la note entre dans le nouvel export au nouveau montant.
  await run(ADMIN, 'frais.export.annuler', { id: x });
  await run(MANON, 'frais.note.renvoyer', { id, motif: 'Montant à revoir' });
  await run(MEHDI, 'frais.ligne.modifier', { id: ligne, date: '2026-10-07', categorie: 'divers', montant: 134, sansJustificatif: true, attestation: true });
  await run(MEHDI, 'frais.note.soumettre', { id });
  await run(ADMIN, 'frais.note.valider', { id });
  await run(MANON, 'frais.note.controler', { id });
  const y = (await run(MANON, 'frais.export.generer', {})).result.export as number;
  const ex = await db.get<{ notes: number[]; contenu: { lignes: { piece: string; compte: string; credit: number }[] } }>('exportsFrais', y);
  assert.ok(ex!.notes.includes(id));
  assert.equal(ex!.contenu.lignes.find(l => l.piece === `NDF-${id}` && l.compte === '421')!.credit, 134);
  // Après annulation de ce second export, l'annulation de la note par le service RH est admise.
  await run(ADMIN, 'frais.export.annuler', { id: y });
  assert.match((await run(ADMIN, 'frais.note.annuler', { id, motif: 'x' })).message, /annulée/);
});

// — Route du fichier —

let srv: Server, port: number, dbHttp: Awaited<ReturnType<typeof nouvelleBase>>;
const dist = mkdtempSync(join(tmpdir(), 'cursus-frais2-'));
before(async () => {
  dbHttp = await nouvelleBase();
  await seedDemo(dbHttp);
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
async function connexion(role: string, empId: number | null): Promise<string> {
  const s = await appel('/api/session');
  const cookie = String(s.headers['set-cookie']).match(/cursus_session=[^;]*/)![0];
  const compte = (await dbHttp.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number };
  const r = await post('/api/login', { role, compteId: compte.id, password: 'x' }, cookie, role);
  assert.equal(r.status, 200, JSON.stringify(r.json()));
  return String(r.headers['set-cookie'] ?? cookie).match(/cursus_session=[^;]*/)?.[0] ?? cookie;
}

test('route : liste et fichier d’écritures (gabarit en vigueur), téléchargement compté et tracé ; refus tracé ; en-tête d’espace exigé', async () => {
  const manon = await connexion('rh', 21);
  const h = { cookie: manon, 'x-cursus-espace': 'rh', 'sec-fetch-site': 'same-origin' };
  assert.equal((await post('/api/actions/frais.note.controler', { id: 3 }, manon)).status, 200);
  const g = await post('/api/actions/frais.export.generer', { attendues: 1 }, manon);
  assert.equal(g.status, 200, JSON.stringify(g.json()));
  const liste = await appel('/api/frais/exports', { headers: h });
  assert.equal(liste.status, 200);
  const [x] = liste.json().exports;
  assert.deepEqual([x.notes, x.ecritures, x.telechargements, x.contenu, x.cle], [[3], 3, 0, undefined, undefined]);
  assert.equal((await appel('/api/frais/exports', { headers: { cookie: manon } })).status, 403, 'sans en-tête d’espace : navigation refusée');
  const f = await appel(`/api/frais/exports/${x.id}/fichier`, { headers: h });
  assert.equal(f.status, 200);
  assert.match(String(f.headers['content-disposition']), /ecritures-frais-\d+\.csv/);
  assert.match(f.corps.toString('utf8'), /^journal;date;compte;compte_tiers;piece;libelle;debit;credit\r\nOD;\d{2}\/\d{2}\/\d{4};6257;;NDF-3;NDF 3 Nadia Kaci;76,36;0,00\r\nOD;[^;]+;44566;;NDF-3;NDF 3 Nadia Kaci;7,64;0,00\r\nOD;[^;]+;421;004109;NDF-3;NDF 3 Nadia Kaci;0,00;84,00\r\n$/);
  const t = (await dbHttp.all<{ action: string; payload: Record<string, unknown>; salaries: number[] }>('journal')).filter(l => l.action === 'frais.export.fichier').at(-1)!;
  assert.deepEqual([t.payload.export, t.payload.lignes, t.salaries], [x.id, 3, [9]]);
  assert.equal((await dbHttp.get<{ telechargements: number }>('exportsFrais', x.id))!.telechargements, 1);
  assert.equal((await appel('/api/frais/exports/999/fichier', { headers: h })).status, 404);
  // Annulé : plus de fichier. Collaborateur : refusé et tracé.
  assert.equal((await post('/api/actions/frais.export.annuler', { id: x.id }, manon)).status, 200);
  assert.equal((await appel(`/api/frais/exports/${x.id}/fichier`, { headers: h })).status, 409);
  const mehdi = await connexion('collaborateur', 2);
  const avant = (await dbHttp.all<{ action: string }>('journal')).filter(l => l.action === 'acces.refuse').length;
  assert.equal((await appel('/api/frais/exports', { headers: { cookie: mehdi, 'x-cursus-espace': 'collaborateur' } })).status, 403);
  assert.equal((await dbHttp.all<{ action: string }>('journal')).filter(l => l.action === 'acces.refuse').length, avant + 1);
  assert.equal((await appel('/api/frais/exports', { headers: { 'x-cursus-espace': 'rh' } })).status, 401);
});

test('justificatif de frais : lu par le manager qui valide les frais du salarié, jamais celui de frais médicaux', async () => {
  const id = async (objet: string, empId: number) => (await dbHttp.insert<{ id: number }>('pieces', {
    empId, objet, objetId: 1, nom: 'recu.png', type: 'image/png', taille: 3, empreinte: 'x', fichier: `absent-${objet}.bin`, jeton: null, deposeLe: '2026-10-05T08:00:00.000Z', deposePar: 'Essai', deposeCompteId: null,
  })).id;
  const ordinaire = await id('ligneFrais', 2), medical = await id('ligneFraisSante', 2);
  const karim = await connexion('manager', 12);
  const h = { cookie: karim, 'x-cursus-espace': 'manager', 'sec-fetch-site': 'same-origin' };
  // Fichier absent du dépôt : la pièce est permise (au-delà du contrôle des droits), contrairement à la médicale (404).
  assert.notEqual((await appel(`/api/pieces/${ordinaire}`, { headers: h })).status, 404);
  assert.equal((await appel(`/api/pieces/${medical}`, { headers: h })).status, 404);
});

// — Dépense rapide, hors ligne —

test('dépense rapide : brouillon du mois réutilisé ou créé, jamais une note médicale ni pour un autre ; admise hors ligne', async () => {
  const { run, refus, journal, MEHDI, ADMIN } = await fresh();
  const p = { empId: 2, date: '2026-10-09', categorie: 'repas', montant: 18, sansJustificatif: true, attestation: true };
  const r1 = await run(MEHDI, 'frais.ligne.ajouter', p);
  assert.equal(r1.result.note, 1, 'brouillon d’octobre de la démonstration');
  assert.doesNotMatch(r1.message, /créée/);
  const r2 = await run(MEHDI, 'frais.ligne.ajouter', { ...p, date: '2026-09-28' });
  assert.match(r2.message, /\(créée — septembre 2026\)/);
  assert.notEqual(r2.result.note, 1);
  assert.equal((await run(MEHDI, 'frais.ligne.ajouter', { ...p, date: '2026-09-29' })).result.note, r2.result.note, 'même mois : même note');
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { ...p, categorie: 'medical', date: '2026-08-03' })).message, /note séparée/);
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { ...p, categorie: 'medical' })).message, /note séparée/);
  assert.equal((await refus(MEHDI, 'frais.ligne.ajouter', { ...p, empId: 6 })).status, 403);
  assert.match((await refus(MEHDI, 'frais.ligne.ajouter', { ...p, date: '2026-13-01' })).message, /Date de la dépense invalide/);
  assert.match((await run(ADMIN, 'frais.ligne.ajouter', { ...p, empId: 6, date: '2026-10-02' })).message, /créée/);
  const j = (await journal('frais.ligne.ajouter')).at(-1)!;
  assert.equal(j.payload.noteId ?? null, null, 'sans note désignée');
  // Registre hors ligne : personnelle, jamais médicale ; la file garde la forme de l'écran.
  assert.equal(refusHorsLigne('frais.ligne.ajouter', p, 2), null);
  const data = { user: { empId: 2 } } as unknown as Dataset;
  assert.deepEqual(versFile('frais.ligne.ajouter', p, data), { nom: 'frais.ligne.ajouter', payload: p });
  assert.equal(versFile('frais.ligne.ajouter', { ...p, jetons: ['j'] }, data), null, 'avec photo : gardée par l’écran avec sa pièce');
  assert.equal(versFile('frais.ligne.ajouter', { ...p, categorie: 'medical' }, data), null);
  assert.equal(libelleSaisie('frais.ligne.ajouter', p), 'Dépense · Repas · le 9 oct. 2026 : 18,00 €');
  assert.equal(libelleSaisie('frais.ligne.ajouter', { ...p, montant: '', devise: 'USD', categorie: 'x' }), 'Dépense · Dépense · le 9 oct. 2026');
  assert.match(libelleSaisie('frais.ligne.ajouter', { ...p, devise: 'USD' }), /18,00 USD$/);
});

// — Notifications —

test('notifications du circuit : manager à la soumission, boîte RH au contrôle, salarié au renvoi, au contrôle et au paiement ; sans montant', async () => {
  const { db, run, MEHDI, KARIM, MANON, ADMIN } = await fresh();
  // Notifications aussitôt pour tous (pas de récapitulatif quotidien).
  await db.run(`UPDATE employes SET notification = 'immediat'`).catch(() => {});
  const types = async () => {
    const mails = (await db.all<{ cible: string; type: string; contenu: { objet: string; texte: string } }>('envois')).filter(e => e.cible === 'email' && e.type.startsWith('frais.'));
    const recap = (await db.all<{ type: string; objet: string; texte: string }>('notifications')).filter(n => n.type.startsWith('frais.'));
    return [...mails.map(m => ({ type: m.type, objet: m.contenu.objet, texte: m.contenu.texte })), ...recap];
  };
  const { result: { note } } = await run(MEHDI, 'frais.note.creer', { periode: '2026-10' });
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: note, date: '2026-10-06', categorie: 'divers', montant: 20, sansJustificatif: true, attestation: true, commercant: 'Boutique Secrète' });
  await run(MEHDI, 'frais.note.soumettre', { id: note });
  await run(KARIM, 'frais.note.renvoyer', { id: note, motif: 'Motif très confidentiel' });
  await run(MEHDI, 'frais.note.soumettre', { id: note });
  await run(KARIM, 'frais.note.valider', { id: note });
  await run(MANON, 'frais.note.controler', { id: note });
  // Note médicale soumise : directement à la boîte du service RH, même message.
  const { result: { note: med } } = await run(MEHDI, 'frais.note.creer', { periode: '2026-10', medicale: true });
  await run(MEHDI, 'frais.ligne.ajouter', { noteId: med, date: '2026-10-06', categorie: 'medical', montant: 30, sansJustificatif: true, attestation: true });
  await run(MEHDI, 'frais.note.soumettre', { id: med });
  // Paiement : lot de paie généré puis confirmé (simulation).
  await run(ADMIN, 'paie.lotGenerer', { periode: '2026-10' }).catch(() => null);
  const lot = await db.one('SELECT id FROM lots_paie ORDER BY id DESC LIMIT 1') as { id: number } | undefined;
  if (lot) await run(ADMIN, 'paie.lotConfirmer', { id: lot.id }).catch(() => null);
  const t = await types();
  const parType = (k: string) => t.filter(x => x.type === k);
  assert.ok(parType('frais.soumise').length >= 2, 'au manager à chaque soumission');
  assert.match(parType('frais.soumise')[0].objet, /Note de frais à valider — Mehdi Benali/);
  assert.equal(parType('frais.renvoyee').length, 1);
  // Boîte du service RH et comptabilité (Manon Faure, profil comptabilite : contrôleuse désignée le 31 octobre 2026), à
  // chaque note qui attend le contrôle.
  const aControler = (await db.all<{ cible: string; type: string; contenu: { a: string[]; objet: string; texte: string } }>('envois'))
    .filter(e => e.cible === 'email' && e.type === 'frais.acontroler');
  const boite = (await db.getSetting<{ rh: string }>('messagerie', { rh: '' })).rh;
  const manon = (await db.get<{ email: string | null }>('employes', 21))!.email;
  assert.ok(manon, 'adresse de Manon Faure');
  assert.equal(aControler.filter(e => e.contenu.a.includes(boite)).length, 2, 'validée par le manager, puis note médicale');
  assert.equal(aControler.filter(e => e.contenu.a.includes(manon!)).length, 2, 'la comptabilité aussi');
  const parBoite = aControler.filter(e => e.contenu.a.includes(boite)).map(e => e.contenu.texte.replace(/n° \d+/, ''));
  assert.equal(parBoite[0], parBoite[1], 'même message pour la note médicale');
  assert.equal(parType('frais.validee').length, 1);
  for (const x of t) assert.doesNotMatch(`${x.objet} ${x.texte}`, /€|Boutique|confidentiel|médic/i, x.type);
  if (lot && (await db.get<{ statut: string }>('lotsPaie', lot.id))?.statut === 'transmis') assert.ok(parType('frais.payee').length >= 1, 'remboursement');
  for (const k of ['frais.soumise', 'frais.acontroler', 'frais.renvoyee', 'frais.validee', 'frais.payee']) assert.ok(EMAIL_LABEL[k], k);
  for (const k of ['frais.soumise', 'frais.acontroler', 'frais.renvoyee', 'frais.validee', 'frais.payee']) {
    assert.ok(TYPES_PUSH.includes(k), k);
    assert.equal(NOTIFICATIONS_PUSH[k].vue, 'frais');
  }
});

// — Vues, alertes partagées et règles d'écran —

test('vues : écran frais dans les trois espaces et seul écran de la comptabilité ; alertes identiques client et serveur', async () => {
  const { db, MEHDI, MANON, KARIM } = await fresh();
  assert.deepEqual(PROFILS_RH.comptabilite.vues, ['frais']);
  for (const r of ['rh', 'manager', 'collaborateur'] as const) assert.ok(vuesDe(r).includes('frais'), r);
  assert.deepEqual(vuesDe('rh', 'comptabilite'), ['frais']);
  const ds = await db.lecture(async () => await buildSnapshot(db, MEHDI, { cache: false })) as Dataset;
  const d = new Domain(ds);
  const n = ds.notesFrais!.find(x => x.id === 1)!;
  const a = alertesDeNote(d, n);
  assert.ok([...a.values()].flat().some(x => x.niveau === 'bloquant'), 'la note de démonstration de Mehdi a un point bloquant');
  const s = C.syntheseNote(d, n);
  assert.equal(s.bloquantes, [...a.values()].flat().filter(x => x.niveau === 'bloquant').length);
  assert.ok(C.droitsNote(d, ds.user, n).soumettre && !C.droitsNote(d, ds.user, n).valider);
  const dk = new Domain(await db.lecture(async () => await buildSnapshot(db, KARIM, { cache: false })) as Dataset);
  const soumise = dk.ds.notesFrais!.find(x => x.statut === 'soumise')!;
  assert.ok(C.droitsNote(dk, dk.ds.user, soumise).valider);
  assert.ok(!(dk.ds.notesFrais ?? []).some(x => x.medicale && x.empId !== 12), 'aucune note médicale d’autrui chez le manager');
  const dm = new Domain(await db.lecture(async () => await buildSnapshot(db, MANON, { cache: false })) as Dataset);
  const validee = dm.ds.notesFrais!.find(x => x.statut === 'validee')!;
  assert.ok(C.droitsNote(dm, dm.ds.user, validee).controler && C.controleur(dm.ds.user));
  assert.deepEqual(O.ongletsFrais('rh'), ['controle', 'notes', 'avances', 'exports', 'tableau']);
  assert.equal(O.ongletFraisDe('rh', 'premier'), 'controle');
  assert.equal(O.ongletFraisDe('manager', 'controle'), 'valider');
  assert.equal(O.ongletFraisDe('manager', 'notes'), 'notes');
  assert.equal(O.ongletFraisDe('collaborateur', 'tableau'), 'notes');
  assert.ok(C.depensesParMois(dm.ds.notesFrais!, dm.ds.lignesFrais!, '2026-01-01').length > 0);
  assert.equal(C.euros(1234.5), '1 234,50 €'.replace(' ', ' '));
  assert.equal(C.euros(3, 'USD'), '3,00 USD');
  assert.equal(C.moisNote({ periode: '2026-10' }), 'Octobre 2026');
});

test('alertes de la vue manager, collaborateur et comptabilité : celles du serveur (grand déplacement, jour d’absence)', async () => {
  const { db, run, ADMIN, MEHDI, KARIM, MANON } = await fresh();
  const snap = async (u: User) => await db.lecture(async () => await buildSnapshot(db, u, { cache: false })) as Dataset;
  // Mission de Mehdi le jour d'une dépense de repas de sa note n° 1, sur un chantier en France qualifié « grand
  // déplacement » : le repas est déjà couvert par le forfait de la paie (alerte bloquante « cumul »).
  const full0 = await snap(ADMIN);
  const l1 = full0.lignesFrais!.find(l => l.noteId === 1 && l.categorie === 'repas')!;
  assert.ok(l1, 'repas de la note n° 1 de Mehdi');
  // Arrêt maladie de Mehdi le jour d'une autre dépense de la note : alerte « jour d'absence », sans la nature de l'arrêt.
  const jour2 = l1.date === '2026-10-07' ? '2026-10-08' : '2026-10-07';
  const l2 = { id: (await run(MEHDI, 'frais.ligne.ajouter', { noteId: 1, date: jour2, categorie: 'parking', montant: 4, sansJustificatif: true, attestation: true })).result.ligne as number };
  const chantier = full0.referentiels.chantiers.find(c => c.pays === 'FR')!;
  await db.tx(async () => {
    await db.update('chantiers', chantier.id, { grandDeplacement: true });
    await db.insert('missions', { empId: 2, projet: chantier.id, lieu: chantier.lieu, du: l1.date, au: l1.date, type: 'chantier', ref: null });
    await db.insert('absences', { empId: 2, type: 'MALADIE', du: jour2, au: jour2, statut: 'validee', keystone: false, justificatif: true });
  });
  const full = await snap(ADMIN), dFull = new Domain(full);
  const n1 = full.notesFrais!.find(n => n.id === 1)!;
  const attendu = alertesDeNote(dFull, n1);
  assert.ok(attendu.get(l1.id)!.some(a => a.code === 'cumul' && a.niveau === 'bloquant'), 'le serveur voit le cumul');
  assert.ok(attendu.get(l2.id)!.some(a => a.code === 'absence'), 'et le jour d’absence');
  for (const u of [MEHDI, KARIM, MANON]) {
    const ds = await snap(u), d = new Domain(ds);
    const n = ds.notesFrais!.find(x => x.id === 1)!;
    assert.ok(n, u.nom);
    assert.ok(ds.alertesFrais, `${u.nom} : alertes jointes par le serveur`);
    assert.deepEqual(C.syntheseNote(d, n).alertes, attendu, u.nom);
    assert.equal(C.syntheseNote(d, n).bloquantes, [...attendu.values()].flat().filter(a => a.niveau === 'bloquant').length, u.nom);
    // Sans les alertes du serveur, l'instantané filtré ne verrait pas le cumul (l'écart relevé à la relecture).
    assert.ok(!alertesDeNote(d, n).get(l1.id)!.some(a => a.code === 'cumul'), `${u.nom} : recalcul incomplet`);
    assert.doesNotMatch(JSON.stringify(ds.alertesFrais), /maladie|arrêt/i, `${u.nom} : jamais la nature de l’absence`);
    // Toute note en circuit de la vue a ses alertes ; jamais une ligne d'une note que la vue ne reçoit pas.
    const lignesVues = new Set((ds.lignesFrais ?? []).map(l => l.id));
    assert.ok(Object.keys(ds.alertesFrais!).every(id => lignesVues.has(Number(id))), u.nom);
    for (const x of (ds.notesFrais ?? []).filter(m => ['brouillon', 'a_corriger', 'soumise', 'validee'].includes(m.statut))) {
      assert.deepEqual(C.syntheseNote(d, x).alertes, alertesDeNote(dFull, full.notesFrais!.find(m => m.id === x.id)!), `${u.nom}, note ${x.id}`);
    }
  }
  // Le service RH reçoit l'instantané complet : alertes recalculées, identiques.
  const rh = await snap(ADMIN);
  assert.equal(rh.alertesFrais, undefined);
  assert.deepEqual(C.syntheseNote(new Domain(rh), n1).alertes, attendu);
});

test('saisie d’une dépense : contrôles par champ, paramètres par catégorie, propositions d’un reçu collé', () => {
  const c = S.champsDepense('2026-10-10', 'repas');
  assert.equal(c.tvaTaux, '10');
  assert.deepEqual(S.erreursDepense(c, '2026-10-10'), { date: null, montant: 'Indiquez le montant payé.', devise: null, invites: null });
  assert.equal(S.erreursDepense({ ...c, date: '2026-10-11', montant: '12' }, '2026-10-10').date, 'La date ne peut pas être dans le futur.');
  assert.equal(S.erreursDepense({ ...c, montant: '0' }, '2026-10-10').montant, 'Montant plus de 0 et 100 000 au plus.');
  assert.equal(S.erreursDepense({ ...c, montant: '10', devise: 'U$' }, '2026-10-10').devise, 'Code de devise à trois lettres (EUR, USD…).');
  assert.equal(S.erreursDepense({ ...c, montant: '10', devise: 'USD', taux: '-1' }, '2026-10-10').taux, 'Taux ou montant débité : nombre positif.');
  assert.equal(S.erreursDepense({ ...c, categorie: 'repas_affaires', montant: '10' }, '2026-10-10').invites, 'Indiquez les invités du repas d’affaires.');
  assert.deepEqual(S.erreursDepense({ ...c, categorie: 'ik', km: '' }, '2026-10-10'), { date: null, km: 'Indiquez la distance parcourue.', vehiculeId: 'Choisissez le véhicule (déclarez-le d’abord dans Mes frais).' });
  assert.equal(S.erreursDepense({ ...c, categorie: 'ik', km: '9000', vehiculeId: '1' }, '2026-10-10').km, 'Distance en km, plus de 0 et 5 000 au plus.');
  assert.deepEqual(S.erreursDepense({ ...c, categorie: 'forfait', forfait: 'etranger', montant: 'x' }, '2026-10-10'), { date: null, forfait: 'Choisissez le pays.', montant: 'Montant en euros, plus de 0.' });
  assert.equal(S.erreursDepense({ ...c, categorie: 'forfait' }, '2026-10-10').forfait, 'Choisissez le forfait.');
  assert.equal(S.erreursDepense({ ...c, date: '' }, '2026-10-10').date, 'Indiquez la date de la dépense.');
  assert.equal(S.erreursDepense({ ...c, date: '2026-02-30' }, '2026-10-10').date, 'Date invalide.');
  assert.deepEqual(S.payloadDepense({ ...c, montant: '12,50', commercant: ' Café ' }), {
    date: '2026-10-10', categorie: 'repas', commercant: 'Café', sansJustificatif: false, attestation: false, montant: 12.5, devise: 'EUR', tvaTaux: 10, tvaMontant: '', invites: '', motifDepassement: '',
  });
  assert.deepEqual(S.payloadDepense({ ...c, montant: '10', devise: 'usd', taux: '0,9', montantEur: '9,2' }).montantEur, 9.2);
  assert.deepEqual(S.payloadDepense({ ...c, categorie: 'ik', km: '42', vehiculeId: '3', depart: ' Usine ' }), { date: '2026-10-10', categorie: 'ik', commercant: '', sansJustificatif: false, attestation: false, km: 42, vehiculeId: 3, depart: 'Usine', arrivee: '' });
  assert.equal(S.payloadDepense({ ...c, categorie: 'forfait', forfait: 'etranger', pays: 'MA' }).forfait, 'etranger:MA');
  assert.equal(S.payloadDepense({ ...c, categorie: 'forfait', forfait: 'panier' }).forfait, 'panier');
  assert.equal(S.payloadDepense({ ...c, tvaTaux: '' }).tvaTaux, '');
  assert.deepEqual(S.categoriesProposees(true), ['medical']);
  assert.ok(!S.categoriesProposees(false).includes('medical') && !S.CATEGORIES_RAPIDES.includes('ik'));
  assert.equal(S.nombreSaisi(' 1 234,5 '), 1234.5);
  assert.equal(S.nombreSaisi('abc'), null);
  // Reprise d'une dépense à modifier (devise saisie au montant débité, forfait étranger).
  const l = ligne({ devise: 'USD', taux: null, montant: 10, montantEur: 9.2, forfait: null });
  assert.equal(S.champsDepense('2026-10-10', 'repas', l).montantEur, '9,2');
  assert.deepEqual([S.champsDepense('2026-10-10', 'repas', ligne({ categorie: 'forfait', forfait: 'etranger:MA' })).forfait, S.champsDepense('2026-10-10', 'repas', ligne({ categorie: 'forfait', forfait: 'etranger:MA' })).pays], ['etranger', 'MA']);
  const r = S.propositionsRecu(lireRecu('BRASSERIE DU PORT\n09/10/2026\nTVA 10% 2,05\nTOTAL TTC 22,50 EUR'), c);
  assert.deepEqual([r.champs.montant, r.champs.date, r.champs.devise, r.champs.tvaTaux, r.champs.tvaMontant, r.champs.commercant], ['22,5', '2026-10-09', 'EUR', '10', '2,05', 'BRASSERIE DU PORT']);
  assert.deepEqual(r.reconnus, ['montant', 'date', 'devise', 'TVA', 'commerçant']);
  assert.deepEqual(S.propositionsRecu({}, c).reconnus, []);
  assert.ok(S.demandeRecu('repas') && !S.demandeRecu('ik'));
});
