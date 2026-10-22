// Fichier de paie (lot 5, chantier A, étape 1 : t019 et clôture de t024) : plus de mode « api » ni d'adresse d'envoi
// fictive, plus de cible « sage » dans la file d'envoi ; format du fichier d'import complété par l'encodage (UTF-8 sans
// BOM par défaut, Windows-1252 au choix) et des colonnes facultatives désactivées par défaut (code dossier, libellé de la
// rubrique, début et fin de période), avec le fichier téléchargé octet par octet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
process.env.CURSUS_TODAY = '2026-10-10';

const express = (await import('express')).default;
const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { openSession } = await import('../server/src/auth.ts');
const { routesFichierPaie } = await import('../server/src/fichier-paie.ts');
const { lireFormatFichier } = await import('../server/src/lots-paie.ts');
const { CIBLES } = await import('../server/src/envois.ts');
const { SAGE_MODES } = await import('../server/src/integrations/sage.ts');
const { MODE_API_RETIRE } = await import('../server/src/migrations/paie.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { Domain } = await import('../shared/domain.ts');
const { encoderTexte, horsWindows1252 } = await import('../shared/encodage.ts');
const { buildSagePayload, sagePending } = await import('../shared/rules/temps.ts');
const { MODES_SAGE } = await import('../shared/rules/paie.ts');
const { JOURNAL_LABEL } = await import('../shared/journal.ts');
const { RUBRIQUES_PAIE } = await import('../shared/constants.ts');
const L = await import('../shared/rules/lots-paie.ts');
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Format = Parameters<typeof L.fichierLot>[1] & object;

/** Jeu de démonstration ; `run` suit le chemin de POST /api/actions/:nom (trace au journal comprise). */
async function fresh(db: Db = new Db(':memory:')) {
  await seedDemo(db);
  const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), p);
    const o = typeof r === 'object' && r !== null ? r : { message: r };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result });
    return o.message;
  });
  const refus = async (u: User, name: string, p: Record<string, unknown>, status: number, re?: RegExp) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && e.status === status && (!re || re.test(e.message)), `${name} : refus ${status}`);
  return { db, compteDe, run, refus, ADMIN: await user(null, 'rh'), PAIE: await user(7, 'rh'), GEST: await user(14, 'rh') };
}
async function avecEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const avant = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  try { return await fn(); } finally {
    Object.entries(avant).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}

const CONTENU: Parameters<typeof L.fichierLot>[0] = {
  dossier: 'CURSUS-CHIMIE',
  lignes: [
    { matricule: '004102', semaine: '2026-S41', periode: '2026-10', rubriques: { HN: 35, HS25: 2.5 } },
    { matricule: '004101', semaine: '2026-S36', periode: '2026-09', rubriques: { HN: 7 } },
  ],
  libelles: { HN: 'Heures normales', HS25: 'Heures supplémentaires payées, majorées à 25 %' },
};

// — Mode API et cible « sage » retirés —

test('t019 plus de mode « api » : modes simulation et fichier seulement, sans adresse d’envoi fictive', async () => {
  assert.deepEqual([...SAGE_MODES], ['simulation', 'fichier']);
  assert.deepEqual(Object.keys(MODES_SAGE), ['simulation', 'fichier']);
  const { db, ADMIN } = await fresh();
  const d = new Domain(await loadFull(db, ADMIN));
  const p = buildSagePayload(d, sagePending(d), 'CURSUS-CHIMIE', new Date('2026-10-10T10:00:00Z'), 'fichier');
  assert.ok(!('endpoint' in p), 'aucune adresse « POST /sage-paie/v1/variables »');
  assert.deepEqual([p.dossier, p.mode], ['CURSUS-CHIMIE', 'fichier']);
});

test('t024 file d’envoi : Keystone et e-mails seulement, plus de cible « sage » ni de libellé d’échec Sage', () => {
  assert.deepEqual(CIBLES, ['keystone', 'email']);
  assert.equal(JOURNAL_LABEL['sage.echec'], undefined);
  assert.ok(JOURNAL_LABEL['sage.fichier'], 'le téléchargement du fichier reste tracé');
});

test('t019 migration : un lot de l’ancien mode « api » passe en mode fichier, une seule fois', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-mode-api-'));
  try {
    const file = join(dir, 'cursus.db');
    const db = new Db(file);
    await appliquerMigrations(db);
    await seedDemo(db);
    db.sql.close();
    const ancienne = new Db(file);
    assert.equal(await MODE_API_RETIRE.necessaire!(ancienne), false, 'base existante sans lot en mode « api » : notée faite');
    // Lot historique repris d'une transmission sous l'ancienne bascule SAGE_URL.
    const [lot] = await ancienne.all<{ id: number }>('lotsPaie');
    (await ancienne.run(`UPDATE lots_paie SET mode = 'api' WHERE id = ?`, [lot.id]));
    await ancienne.exec(`DELETE FROM migrations WHERE nom = 'lot5-paie-mode-api-retire'`);
    assert.equal(await MODE_API_RETIRE.necessaire!(ancienne), true);
    assert.deepEqual(await appliquerMigrations(ancienne), ['lot5-paie-mode-api-retire']);
    assert.equal((await ancienne.get<{ mode: string }>('lotsPaie', lot.id))!.mode, 'fichier');
    assert.deepEqual(await appliquerMigrations(ancienne), [], 'rien à refaire');
    ancienne.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// — Encodage —

test('t019 Windows-1252 : accents sur un octet, plage 0x80–0x9F, caractère absent remplacé par « ? »', () => {
  assert.deepEqual([...encoderTexte('é;à;ç;€;’;œ;°', 'windows-1252')], [0xe9, 0x3b, 0xe0, 0x3b, 0xe7, 0x3b, 0x80, 0x3b, 0x92, 0x3b, 0x9c, 0x3b, 0xb0]);
  // Espace fine insécable (toLocaleString) : espace insécable ; caractère absent : « ? ».
  assert.deepEqual([...encoderTexte('1 225', 'windows-1252')], [0x31, 0xa0, 0x32, 0x32, 0x35]);
  assert.deepEqual([...encoderTexte('Ω→', 'windows-1252')], [0x3f, 0x3f]);
  assert.deepEqual(horsWindows1252('Été 2026 : 25 % — œuvre Ω'), ['Ω']);
  // UTF-8 sans BOM : « é » sur deux octets, aucun EF BB BF en tête.
  assert.deepEqual([...encoderTexte('é', 'utf-8')], [0xc3, 0xa9]);
  // Tous les libellés des rubriques passent en Windows-1252 sans perte.
  assert.deepEqual(horsWindows1252(Object.values(RUBRIQUES_PAIE).map(r => r.label).join(' ')), []);
});

// — Colonnes facultatives —

test('t019 colonnes facultatives : désactivées par défaut, code dossier, libellé figé, bornes de la période', () => {
  const d = L.FORMAT_FICHIER_DEFAUT;
  assert.deepEqual([d.colonnes, d.encodage, d.formatDate], [['matricule', 'periode', 'rubrique', 'quantite'], 'utf-8', 'JJ/MM/AAAA']);
  assert.deepEqual(L.COLONNES_FACULTATIVES, ['dossier', 'libelle', 'debut', 'fin']);
  // Sans colonne facultative : le fichier d'avant, inchangé.
  assert.equal(L.fichierLot(CONTENU), 'matricule;periode;rubrique;quantite\r\n004101;2026-09;HN;7\r\n004102;2026-10;HN;35\r\n004102;2026-10;HS25;2,5\r\n');
  const f: Format = { ...d, colonnes: ['dossier', 'matricule', 'periode', 'debut', 'fin', 'rubrique', 'libelle', 'quantite'] };
  assert.deepEqual(L.fichierLot(CONTENU, f).split('\r\n'), [
    'dossier;matricule;periode;debut;fin;rubrique;libelle;quantite',
    'CURSUS-CHIMIE;004101;2026-09;01/09/2026;30/09/2026;HN;Heures normales;7',
    'CURSUS-CHIMIE;004102;2026-10;01/10/2026;31/10/2026;HN;Heures normales;35',
    'CURSUS-CHIMIE;004102;2026-10;01/10/2026;31/10/2026;HS25;Heures supplémentaires payées, majorées à 25 %;2,5',
    '',
  ]);
  // Libellé qui contient le séparateur : entre guillemets ; dates aux autres formats ; février d'une année bissextile.
  const virgule: Format = { ...f, separateur: ',', decimale: '.', formatDate: 'AAAA-MM-JJ', entete: false };
  assert.equal(L.fichierLot(CONTENU, virgule).split('\r\n')[2], 'CURSUS-CHIMIE,004102,2026-10,2026-10-01,2026-10-31,HS25,"Heures supplémentaires payées, majorées à 25 %",2.5');
  assert.equal(L.dateFichier('2026-10-01', 'JJMMAAAA'), '01102026');
  assert.deepEqual(L.bornesPeriode('2028-02'), { debut: '2028-02-01', fin: '2028-02-29' });
  // Lot sans libellés figés : le code Sage tient lieu de libellé, sauf libellés fournis (table en vigueur).
  const ancien = { lignes: CONTENU.lignes };
  assert.equal(L.fichierLot(ancien, { ...d, colonnes: ['matricule', 'rubrique', 'libelle', 'quantite', 'periode'], entete: false }).split('\r\n')[0], '004101;HN;HN;7;2026-09');
  assert.equal(L.fichierLot(ancien, { ...d, colonnes: ['matricule', 'rubrique', 'libelle', 'quantite', 'periode'], entete: false }, { HN: 'Heures' }).split('\r\n')[0], '004101;HN;Heures;7;2026-09');
});

test('t019 libellés : rubriques actives portées sur chaque code Sage, additionnées sous un même code', () => {
  const table = [
    { code: 'HS25', codeSage: 'HS25', active: true, label: 'Heures supplémentaires payées, majorées à 25 %' },
    { code: 'HSF25', codeSage: 'HS25', active: true, label: 'Heures supplémentaires incluses au forfait' },
    { code: 'HN', codeSage: 'HN', active: false, label: 'Heures normales' },
  ];
  assert.deepEqual(L.libellesSage({ lignes: [{ matricule: 'A', semaine: '', rubriques: { HS25: 3, HN: 1, X9: 1 } }] }, table), {
    HN: 'HN', HS25: 'Heures supplémentaires payées, majorées à 25 % + Heures supplémentaires incluses au forfait', X9: 'X9',
  });
});

test('t019 contrôle du format : encodage, dates, colonnes facultatives une fois au plus, obligatoires toujours', () => {
  const d = L.FORMAT_FICHIER_DEFAUT;
  assert.match(String(L.controlerFormat({ encodage: 'latin9' }, d)), /Encodage inconnu : UTF-8 ou Windows-1252/);
  assert.match(String(L.controlerFormat({ formatDate: 'JJ.MM.AA' }, d)), /Format de date inconnu/);
  assert.match(String(L.controlerFormat({ colonnes: ['matricule', 'periode', 'rubrique', 'quantite', 'libelle', 'libelle'] }, d)), /une colonne facultative une fois au plus/);
  assert.match(String(L.controlerFormat({ colonnes: ['matricule', 'periode', 'rubrique', 'libelle'] }, d)), /matricule, période, rubrique et quantité/);
  assert.match(String(L.controlerFormat({ colonnes: ['matricule', 'periode', 'rubrique', 'quantite', 'societe'] }, d)), /chacune une fois/);
  // Requête forgée : une colonne qui n'est pas une chaîne (['dossier'] vaut « dossier » une fois convertie) est refusée,
  // de même pour un séparateur : rien de tel n'est enregistré, le fichier reste téléchargeable.
  assert.match(String(L.controlerFormat({ colonnes: ['matricule', 'periode', 'rubrique', 'quantite', ['dossier'], 'dossier'] }, d)), /^Colonnes : /);
  assert.match(String(L.controlerFormat({ colonnes: ['matricule', 'periode', 'rubrique', ['quantite']] }, d)), /^Colonnes : /);
  assert.match(String(L.controlerFormat({ separateur: [';'] }, d)), /Séparateur inconnu/);
  assert.deepEqual(L.controlerFormat({ encodage: 'windows-1252', colonnes: ['dossier', 'matricule', 'periode', 'rubrique', 'quantite'] }, d),
    { ...d, encodage: 'windows-1252', colonnes: ['dossier', 'matricule', 'periode', 'rubrique', 'quantite'] });
  // Format enregistré avant ces réglages : complété par les valeurs par défaut.
  const ancien = { separateur: ',', colonnes: ['matricule', 'periode', 'rubrique', 'quantite'], formatPeriode: 'AAAAMM', decimale: '.', entete: false } as unknown as Format;
  assert.deepEqual(L.controlerFormat({}, ancien), { ...ancien, encodage: 'utf-8', formatDate: 'JJ/MM/AAAA', negatifs: true });
  // Quantités négatives refusées par l'import (t131) : les feuilles corrigées partent en « annule et remplace ».
  assert.equal((L.controlerFormat({ negatifs: false }, d) as Format).negatifs, false);
  assert.equal(L.typeFichierLot({ encodage: 'windows-1252' }), 'text/csv; charset=windows-1252');
  assert.equal(L.typeFichierLot(), 'text/csv; charset=utf-8');
});

// — Fichier téléchargé —

test('t019 fichier téléchargé en Windows-1252 avec libellés figés à la génération ; UTF-8 sans BOM par défaut', async () => {
  const { db, compteDe, run, refus, ADMIN, PAIE, GEST } = await fresh();
  for (const code of Object.keys(RUBRIQUES_PAIE)) await run(ADMIN, 'paie.rubrique', { code, confirmer: true });
  // Format enregistré avant le lot 5 (sans encodage) : lu avec UTF-8 et les dates par défaut.
  await db.setSetting('formatFichierPaie', { separateur: ';', colonnes: ['matricule', 'periode', 'rubrique', 'quantite'], formatPeriode: 'AAAA-MM', decimale: ',', entete: true });
  assert.deepEqual([(await lireFormatFichier(db)).encodage, (await lireFormatFichier(db)).formatDate], ['utf-8', 'JJ/MM/AAAA']);
  const lot = await avecEnv({ SAGE_MODE: 'fichier' }, async () => {
    await run(PAIE, 'paie.lotGenerer', { periode: '2026-10' });
    return (await db.all<{ id: number; contenu: { libelles?: Record<string, string> } }>('lotsPaie')).at(-1)!;
  });
  assert.equal(lot.contenu.libelles!.HN, 'Heures normales', 'libellés figés avec le contenu');
  const app = express();
  app.get('/essai/session/:compte', async (req, res) => { await openSession(db, res, { compteId: Number(req.params.compte), role: 'rh', methode: 'demo' }); res.end(); });
  app.use(routesFichierPaie(db));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const cookie = (await fetch(`${base}/essai/session/${await compteDe(7)}`)).headers.get('set-cookie')!.split(';')[0];
    const telecharger = async () => {
      const r = await fetch(`${base}/api/paie/lots/${lot.id}/fichier`, { headers: { cookie } });
      assert.equal(r.status, 200);
      return { type: r.headers.get('content-type')!, octets: new Uint8Array(await r.arrayBuffer()) };
    };
    const utf8 = await telecharger();
    assert.match(utf8.type, /^text\/csv; charset=utf-8/);
    assert.notDeepEqual([...utf8.octets.slice(0, 3)], [0xef, 0xbb, 0xbf], 'sans BOM');
    // Réglage par la paie (refusé au gestionnaire RH) : Windows-1252 et libellé de la rubrique.
    await refus(GEST, 'paie.formatFichier', { encodage: 'windows-1252' }, 403);
    await refus(PAIE, 'paie.formatFichier', { encodage: 'ansi' }, 400, /Encodage inconnu/);
    await run(PAIE, 'paie.formatFichier', { encodage: 'windows-1252', colonnes: ['matricule', 'periode', 'rubrique', 'libelle', 'quantite', 'debut', 'fin'] });
    const ansi = await telecharger();
    assert.match(ansi.type, /^text\/csv; charset=windows-1252/);
    const texte = new TextDecoder('windows-1252').decode(ansi.octets);
    assert.equal(texte.split('\r\n')[0], 'matricule;periode;rubrique;libelle;quantite;debut;fin');
    assert.ok(texte.split('\r\n').slice(1).filter(Boolean).every(l => /^\d{6};2026-10;[A-Z0-9_]+;[^;]+;\d+(,\d+)?;01\/10\/2026;31\/10\/2026$/.test(l)), texte);
    // « é » de « supplémentaires » sur un seul octet 0xE9 (jamais la suite UTF-8 C3 A9).
    assert.ok(texte.split('\r\n').find(l => l.includes(';HS25;'))!.includes(';Heures supplémentaires payées, majorées à 25 %;'));
    assert.ok(ansi.octets.includes(0xe9));
    assert.ok(!Buffer.from(ansi.octets).includes(Buffer.from([0xc3, 0xa9])), 'aucun caractère encodé en UTF-8');
    assert.equal(texte, L.fichierLot((await db.get<{ contenu: typeof CONTENU }>('lotsPaie', lot.id))!.contenu, await lireFormatFichier(db)));
    // Le journal du téléchargement porte le format (codes seulement).
    const trace = (await db.all<{ action: string; payload: Record<string, any> }>('journal')).filter(l => l.action === 'sage.fichier').at(-1)!;
    assert.deepEqual([trace.payload.format.encodage, trace.payload.format.colonnes.includes('libelle')], ['windows-1252', true]);
  } finally {
    await new Promise(r => srv.close(r));
  }
});
