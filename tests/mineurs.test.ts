// Date de naissance complète (lot 5, chantier E, étape 1) : âge exact aux dates anniversaires, repli sur l'année d'une
// fiche qui n'a qu'elle, saisie contrôlée, reprise depuis Lucca qui garde la date, sections de fin de carrière à 58 ans à
// la date de l'entretien, et date jamais transmise au manager ni aux profils restreints (année et indication « mineur »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { nouvelleBase, json, texteJson } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { Domain } = await import('../shared/domain.ts');
const { lireCsv } = await import('../shared/rules/imports.ts');
const R = await import('../shared/rules/reprise.ts');
const { ageAu, dateDesAns, MAJORITE, mineurAu, naissanceVueManager } = await import('../shared/rules/mineurs.ts');
const { needsFinCarriere } = await import('../shared/rules/entretiens.ts');
const { PROFIL_VIDE, validerProfil } = await import('../shared/rules/profil.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// Comptes de démonstration : Sandrine Vidal (administratrice RH), Aïcha Diallo (7, paie), Élodie Bernard (11, lecture
// seule) ; Karim Haddad (12) encadre Mehdi Benali (2).
async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const compteId = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', [...(empId ? [empId] : [])])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: (await compteId(empId)), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, payload: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, payload);
    const r = await ACTIONS[name](makeCtx(db, u, await loadFull(db, u)), payload);
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: typeof r === 'string' ? r : null, result: null });
    return r;
  });
  return { db, user, run, RH: await user(null, 'rh') };
}

test('âge exact : atteint le jour anniversaire, la veille encore l’âge d’avant', () => {
  const e = { naissance: 2008, naissanceLe: '2008-10-11' };
  assert.equal(ageAu(e, '2026-10-10'), 17);
  assert.equal(ageAu(e, '2026-10-11'), 18);
  assert.equal(ageAu(e, '2026-12-31'), 18);
  assert.equal(ageAu(e, '2027-10-10'), 18);
  assert.equal(dateDesAns(e, MAJORITE), '2026-10-11');
  assert.equal(mineurAu(e, '2026-10-10'), true, 'la veille des 18 ans : mineur');
  assert.equal(mineurAu(e, '2026-10-11'), false, 'le jour des 18 ans : majeur');
  // Né un 29 février : 18 ans le 28 février d'une année non bissextile, le 29 d'une année bissextile.
  const b = { naissance: 2008, naissanceLe: '2008-02-29' };
  assert.equal(dateDesAns(b, 18), '2026-02-28');
  assert.equal(ageAu(b, '2026-02-27'), 17);
  assert.equal(ageAu(b, '2026-02-28'), 18);
  assert.equal(dateDesAns(b, 16), '2024-02-29');
  assert.equal(ageAu(b, '2024-02-28'), 15);
  assert.equal(ageAu(b, '2024-02-29'), 16);
  // Le 31 décembre et le 1er janvier : changement d'année civile sans anniversaire.
  const c = { naissance: 1968, naissanceLe: '1968-12-31' };
  assert.equal(ageAu(c, '2026-12-30'), 57);
  assert.equal(ageAu(c, '2026-12-31'), 58);
  assert.equal(ageAu(c, '2027-01-01'), 58);
});

test('année seule : âge atteint dans l’année civile, même règle pour l’âge et la mention « mineur »', () => {
  const e = { naissance: 2008, naissanceLe: null };
  assert.equal(ageAu(e, '2026-01-01'), 18);
  assert.equal(ageAu(e, '2025-12-31'), 17);
  assert.equal(dateDesAns(e, 18), null);
  // Une seule règle : `mineurAu` et `ageAu` ne se contredisent ni le 31 décembre, ni le 1er janvier.
  for (const [date, mineur] of [['2025-12-31', true], ['2026-01-01', false], ['2026-10-10', false], ['2026-12-31', false]] as const) {
    assert.equal(mineurAu(e, date), mineur, date);
    assert.equal(mineurAu(e, date), ageAu(e, date) < MAJORITE, date);
  }
  // Date complète : idem, au jour anniversaire.
  const d = { naissance: 2008, naissanceLe: '2008-12-31' };
  for (const date of ['2026-01-01', '2026-12-30', '2026-12-31']) assert.equal(mineurAu(d, date), ageAu(d, date) < MAJORITE, date);
  // Date invalide : traitée comme inconnue ; vue sans la date : indication du serveur.
  assert.equal(ageAu({ naissance: 1990, naissanceLe: '1990-02-31' }, '2026-10-10'), 36);
  assert.equal(mineurAu({ naissance: 2008, naissanceLe: null, mineur: false }, '2026-10-10'), false);
  assert.equal(mineurAu({ naissance: 2009, naissanceLe: null, mineur: true }, '2026-10-10'), true);
  assert.deepEqual(naissanceVueManager({ naissance: 2008, naissanceLe: '2008-10-11' }, '2026-10-10'), { naissanceLe: null, mineur: true });
  assert.deepEqual(naissanceVueManager({ naissance: 2008, naissanceLe: '2008-10-11' }, '2026-10-11'), { naissanceLe: null, mineur: false });
});

test('fiche : la date donne l’année, au moins 14 ans à l’entrée, date requise sans année', () => {
  const fiche = { ...PROFIL_VIDE('Maintenance', '2026-10-10'), nom: 'Léo Martin', poste: 'Apprenti', email: 'leo.martin@entreprise.example', matriculePaie: 'N0001' };
  const opts = { equipes: ['Maintenance'], year: 2026 };
  const v = validerProfil({ ...fiche, naissance: 1990, naissanceLe: '2010-05-04', entree: '2026-07-01' }, opts);
  assert.deepEqual(v.errors, []);
  assert.equal(v.profil.naissance, 2010, 'l’année suit la date');
  assert.equal(v.profil.naissanceLe, '2010-05-04');
  // 14 ans la veille de l'entrée : accepté ; le lendemain : refusé.
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: '2012-06-30', entree: '2026-06-30' }, opts).errors, []);
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: '2012-07-01', entree: '2026-06-30' }, opts).errors, ['Date de naissance : moins de 14 ans à la date d’entrée.']);
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: '2012-02-31' }, opts).errors, ['Date de naissance invalide.']);
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: '1939-12-31' }, opts).errors, ['Date de naissance invalide.']);
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: null, naissance: Number.NaN }, opts).errors, ['Date de naissance requise.']);
  // Fiche antérieure : l'année seule reste contrôlée comme avant.
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: null, naissance: 1985 }, opts).errors, []);
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: null, naissance: 2013 }, opts).errors, ['Année de naissance invalide.']);
  // Date déjà enregistrée : l'année seule ne la remplace pas (champ vidé par erreur).
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: null, naissance: 1985 }, { ...opts, naissance: { enregistree: true } }).errors, ['Date de naissance requise.']);
  assert.deepEqual(validerProfil({ ...fiche, naissanceLe: '1985-11-03' }, { ...opts, naissance: { enregistree: true } }).errors, []);
  // Vue du manager, sans la date : la naissance n'est pas contrôlée sur l'année (14 ans atteints à l'entrée, contrôlés
  // par le serveur, alors que l'année seule le refuserait).
  const jeune = { ...fiche, naissanceLe: null, naissance: 2013, entree: '2027-07-01' };
  assert.deepEqual(validerProfil(jeune, opts).errors, ['Année de naissance invalide.']);
  assert.deepEqual(validerProfil(jeune, { ...opts, naissance: { masquee: true } }).errors, []);
});

test('serveur : date enregistrée avec son année, nommée au journal sans sa valeur', async () => {
  const { db, run, RH } = await fresh();
  await run(RH, 'employe.modifier', { id: 2, naissanceLe: '1986-03-09' });
  const e = (await loadFull(db, RH)).employes.find(x => x.id === 2)!;
  assert.deepEqual([e.naissanceLe, e.naissance], ['1986-03-09', 1986]);
  const j = (await db.one(`SELECT payload FROM journal WHERE action = 'employe.modifier' ORDER BY id DESC LIMIT 1`)) as { payload: string };
  assert.deepEqual(json(j.payload).champsModifies, ['naissanceLe']);
  assert.doesNotMatch(texteJson(j.payload), /1986/);
  await assert.rejects(async () => await run(RH, 'employe.modifier', { id: 2, naissanceLe: '2016-01-01' }),
    (x: unknown) => x instanceof ActionError && /moins de 14 ans à la date d’entrée/.test(x.message));
  // Date enregistrée : vidée, elle est refusée (la fiche ne revient pas à l'année seule).
  await assert.rejects(async () => await run(RH, 'employe.modifier', { id: 2, naissanceLe: null, naissance: 1986 }), /Date de naissance requise/);
  assert.equal((await loadFull(db, RH)).employes.find(x => x.id === 2)!.naissanceLe, '1986-03-09');
  // Création : la date de naissance suffit, l'année en est tirée.
  const r = await run(RH, 'employe.creer', {
    nom: 'Léo Martin', poste: 'Apprenti électromécanicien', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', jourOff: [],
    entree: '2026-09-01', fin: '2028-08-31', naissanceLe: '2010-05-04', email: 'leo.martin@entreprise.example',
  }) as { result: { id: number } };
  const leo = (await loadFull(db, RH)).employes.find(x => x.id === r.result.id)!;
  assert.deepEqual([leo.naissanceLe, leo.naissance], ['2010-05-04', 2010]);
  assert.equal(mineurAu(leo, '2026-10-10'), true);
});

test('démonstration : dates complètes, de l’année de chaque profil', async () => {
  const { db, RH } = await fresh();
  const employes = (await loadFull(db, RH)).employes;
  assert.ok(employes.every(e => e.naissanceLe && Number(e.naissanceLe.slice(0, 4)) === e.naissance));
});

test('manager et profils restreints : ni la date ni l’âge exact, l’année et l’indication « mineur »', async () => {
  const { db, run, user, RH } = await fresh();
  // Apprenti de l'équipe Maintenance (Karim Haddad), 18 ans demain.
  const { result: { id } } = await run(RH, 'employe.creer', {
    nom: 'Léo Martin', poste: 'Apprenti électromécanicien', equipe: 'Maintenance', statut: 'ouvrier', typeContrat: 'alternance', temps: '35h', jourOff: [],
    entree: '2026-09-01', fin: '2028-08-31', naissanceLe: '2008-10-11', email: 'leo.martin@entreprise.example',
  }) as { result: { id: number } };
  const MGR = await user(12, 'manager');
  const vue = await buildSnapshot(db, MGR);
  const leo = vue.employes.find(e => e.id === id)!;
  assert.deepEqual([leo.naissanceLe, leo.naissance, leo.mineur], [null, 2008, true]);
  assert.deepEqual([vue.employes.find(e => e.id === 2)!.naissanceLe, vue.employes.find(e => e.id === 2)!.mineur], [null, false]);
  // Sa propre fiche : complète.
  assert.equal(vue.employes.find(e => e.id === 12)!.naissanceLe, '1967-08-19');
  // L'intéressé voit sa date.
  assert.equal((await buildSnapshot(db, await user(2, 'collaborateur'))).employes.find(e => e.id === 2)!.naissanceLe, '1985-11-02');
  // Paie, lecture seule : année et indication, jamais la date.
  for (const empId of [7, 11]) {
    const v = await buildSnapshot(db, await user(empId, 'rh'));
    assert.ok(v.employes.every(e => e.naissanceLe === null && typeof e.mineur === 'boolean'), `profil du salarié ${empId}`);
    assert.deepEqual([v.employes.find(e => e.id === 1)!.mineur, v.employes.find(e => e.id === id)!.mineur], [false, true]);
  }
  // Le lendemain de ses 18 ans, l'indication tombe.
  process.env.CURSUS_TODAY = '2026-10-11';
  try {
    assert.equal((await buildSnapshot(db, MGR)).employes.find(e => e.id === id)!.mineur, false);
  } finally {
    process.env.CURSUS_TODAY = '2026-10-10';
  }
  // Service RH : la date complète.
  assert.equal((await buildSnapshot(db, RH)).employes.find(e => e.id === id)!.naissanceLe, '2008-10-11');
});

test('fin de carrière : 58 ans à la date de l’entretien, même réponse pour l’évaluateur sans la date de naissance', async () => {
  const { db, run, user, RH } = await fresh();
  await run(RH, 'employe.modifier', { id: 2, naissanceLe: '1968-12-15' });
  const veille = await db.insert<any>('entretiens', { empId: 2, type: 'epp', date: '2026-12-14', statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null, planifieLe: '2026-10-10' });
  const jour = await db.insert<any>('entretiens', { empId: 2, type: 'reprise', date: '2026-12-15', statut: 'planifie', cr: {}, info: false, signSal: null, signMgr: null, planifieLe: '2026-10-10' });
  const d = new Domain(await loadFull(db, RH));
  const mehdi = (await d.emp(2))!;
  assert.equal(needsFinCarriere(d, mehdi, veille), false, 'la veille des 58 ans');
  assert.equal(needsFinCarriere(d, mehdi, jour), true, 'le jour des 58 ans');
  assert.equal(needsFinCarriere(d, mehdi, { ...jour, type: 'annuel' }), false, 'entretien annuel : sans objet');
  // Année seule : règle à l'année, à l'année de l'entretien.
  assert.equal(needsFinCarriere(d, { ...mehdi, naissanceLe: null }, veille), true);
  // Évaluateur (manager) : la réponse du serveur, sans la date.
  const MGR = await user(12, 'manager');
  const vue = await buildSnapshot(db, MGR);
  const dm = new Domain(vue);
  const fc = (id: number) => vue.entretiens.find(x => x.id === id)!;
  assert.deepEqual([fc(veille.id).finCarriere, fc(jour.id).finCarriere], [false, true]);
  assert.equal(needsFinCarriere(dm, (await dm.emp(2))!, fc(veille.id)), false);
  assert.equal(needsFinCarriere(dm, (await dm.emp(2))!, fc(jour.id)), true);
  // Le serveur accepte la section le jour des 58 ans, la refuse la veille.
  await run(MGR, 'entretien.modifier', { id: jour.id, section: 'fincarriere', value: 'Aménagement souhaité' });
  await assert.rejects(async () => await run(MGR, 'entretien.modifier', { id: veille.id, section: 'fincarriere', value: 'Aménagement souhaité' }), /Section inconnue/);
  // Service RH : aucun précalcul, la date est connue.
  assert.equal((await buildSnapshot(db, RH)).entretiens.find(x => x.id === jour.id)!.finCarriere, undefined);
  // Entretien reprogrammé avant l'anniversaire, section déjà rédigée : elle reste (écran, impression, serveur).
  await run(MGR, 'entretien.planifier', { empId: 2, kind: 'reprise', date: '2026-12-10' });
  const reprog = (await loadFull(db, RH)).entretiens.find(x => x.id === jour.id)!;
  assert.equal(reprog.date, '2026-12-10');
  assert.equal(needsFinCarriere(d, mehdi, reprog), true, 'texte rédigé gardé');
  assert.equal(needsFinCarriere(d, mehdi, { ...reprog, cr: {} }), false, 'sans texte : la veille des 58 ans');
  assert.equal((await buildSnapshot(db, MGR)).entretiens.find(x => x.id === jour.id)!.finCarriere, true);
  await run(MGR, 'entretien.modifier', { id: jour.id, section: 'fincarriere', value: 'Aménagement précisé' });
});

test('reprise depuis Lucca : date complète gardée, année seule sans effacer une date de la même année', async () => {
  const db = await nouvelleBase();
  await db.insert('comptes', { empId: null, nom: 'Responsable RH', adresse: 'rh@exemple.fr', identifiant: 'rh@exemple.fr', type: 'microsoft', oid: null, profilRh: 'rh_admin', actif: true, motDePasse: null, changerMotDePasse: false, echecs: 0, blocageFin: null, creation: '2026-10-01T08:00:00Z', creePar: null, derniereConnexion: null });
  const ADMIN = { role: 'rh', empId: null, nom: 'Responsable RH', intitule: '', profilRh: 'rh_admin', compteId: 1 } as unknown as User;
  const importer = async (texte: string) => {
    const colonnes = R.reconnaitreColonnes('salaries', lireCsv(texte).lignes[0]);
    const apercu = R.analyserReprise(new Domain(await loadFull(db, ADMIN)), 'salaries', texte, { colonnes } as any);
    await db.tx(async () => await ACTIONS['reprise.importer'](makeCtx(db, ADMIN, await loadFull(db, ADMIN)), { type: 'salaries', texte, colonnes }));
    return apercu;
  };
  const emp = async (nom: string) => (await loadFull(db, ADMIN)).employes.find(e => e.nom === nom)!;
  const entete = 'Matricule;Prénom;Nom;Poste;Équipe;Date d’entrée;Date de naissance';
  await importer([entete, 'A0123;Julie;Martin;Technicienne;Maintenance;01/09/2015;12/04/1988', 'A0456;Marc;Petit;Opérateur;Production;05/01/2026;1997'].join('\n'));
  assert.deepEqual([(await emp('Julie Martin')).naissanceLe, (await emp('Julie Martin')).naissance], ['1988-04-12', 1988]);
  assert.deepEqual([(await emp('Marc Petit')).naissanceLe, (await emp('Marc Petit')).naissance], [null, 1997]);
  // Second fichier : l'année seule de Julie (la même) ne retire pas sa date ; la date de Marc complète sa fiche.
  const a = await importer([entete, 'A0123;Julie;Martin;Technicienne;Maintenance;01/09/2015;1988', 'A0456;Marc;Petit;Opérateur;Production;05/01/2026;1997-07-14'].join('\n'));
  assert.deepEqual(a.lignes.map(l => l.issue), ['ignoree', 'maj']);
  assert.deepEqual([(await emp('Julie Martin')).naissanceLe, (await emp('Marc Petit')).naissanceLe, (await emp('Marc Petit')).naissance], ['1988-04-12', '1997-07-14', 1997]);
  // Une année qui contredit la date : l'année du fichier l'emporte, la date est retirée.
  await importer([entete, 'A0123;Julie;Martin;Technicienne;Maintenance;01/09/2015;1989'].join('\n'));
  assert.deepEqual([(await emp('Julie Martin')).naissanceLe, (await emp('Julie Martin')).naissance], [null, 1989]);
});

test('base existante : colonne de la date ajoutée à l’ouverture, fiches gardées à l’année', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-'));
  const file = join(dir, 'ancienne.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE employes (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT, equipe TEXT, poste TEXT, statut TEXT, type_contrat TEXT, temps TEXT, jour_off TEXT, entree TEXT, naissance INTEGER)`);
    old.exec(`INSERT INTO employes (nom, equipe, poste, statut, type_contrat, temps, jour_off, entree, naissance) VALUES ('A', 'Production', 'Opérateur', 'ouvrier', 'cdi', '35h', '[]', '2020-01-01', 1968)`);
    old.close();
    const db = new Db(file);
    const [a] = await db.all<{ naissance: number; naissanceLe: string | null }>('employes');
    assert.deepEqual([a.naissance, a.naissanceLe], [1968, null]);
    assert.equal(ageAu(a, '2026-01-01'), 58, 'règle à l’année, comme avant');
    db.sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
