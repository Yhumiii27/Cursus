// Montée en charge, lot 8, chantier E, étape 2, sur les deux moteurs :
// - tâches du quart d'heure (`tachesEmails`) : aucune lecture complète de la base quand aucune tâche n'a rien à faire
//   (tests rapides avant lecture : agences sans adresse, réglages), une seule au plus par passage, partagée ; une
//   transaction par tâche, une tâche en échec n'annulant pas les autres ;
// - lots de paie lus sans leur contenu figé, éléments d'absence émis lus dans la seule partie « absences » des lots non
//   annulés, mêmes résultats qu'avec la lecture complète des lots ;
// - relevés des agences avec le statut de leur e-mail, sans une lecture par relevé ;
// - index du journal par compte et par action (migration PostgreSQL 0013, migration nommée SQLite lot8-index-journal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';
delete process.env.CURSUS_DEMO;

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { loadFull } = await import('../server/src/dataset.ts');
const { tachesEmails } = await import('../server/src/notifications.ts');
const { relevesAutomatiques } = await import('../server/src/releves.ts');
const { demanderEvaluations } = await import('../server/src/evaluations-formation.ts');
const { lecturePartagee } = await import('../server/src/lecture-partagee.ts');
const { lireLots } = await import('../server/src/lots-paie.ts');
const { emisEtReservees } = await import('../server/src/absences-paie.ts');
const { lireMessagerie } = await import('../server/src/messagerie.ts');
const { mettreAJourBase } = await import('../server/src/demarrage.ts');
type Db = Awaited<ReturnType<typeof nouvelleBase>>;
type User = Parameters<typeof loadFull>[1];
type LotEnregistre = import('../server/src/lots-paie.ts').LotEnregistre;

const RH: User = { role: 'rh', empId: null, nom: 'Sandrine Vidal', intitule: 'Administrateur RH', profilRh: 'rh_admin' };

async function demo(): Promise<Db> {
  const db = await nouvelleBase();
  await seedDemo(db);
  return db;
}

/** Lectures complètes de la base (`loadFull` passe par une lecture stable) faites pendant `fn`. */
async function lecturesPendant(db: Db, fn: () => Promise<unknown>): Promise<number> {
  const lecture = db.lecture.bind(db);
  let n = 0;
  db.lecture = (async (f: () => unknown, o?: { courte?: boolean }) => { n++; return await lecture(f, o); }) as typeof db.lecture;
  try {
    await fn();
  } finally {
    db.lecture = lecture;
  }
  return n;
}

test('quart d’heure : aucune lecture complète sans rien à faire, une seule au plus par passage', async () => {
  const db = await demo();
  const m = await lireMessagerie(db);
  // Rien à faire : agences sans adresse, avant 7 h (ni récapitulatif, ni évaluations), aucune délégation qui commence.
  await db.setSetting('messagerie', { ...m, agences: m.agences.map(a => ({ ...a, adresse: '' })) });
  assert.equal(await lecturesPendant(db, async () => await tachesEmails(db, 6)), 0);
  assert.deepEqual(await db.tx(async () => await relevesAutomatiques(db)), [], 'test rapide : aucune agence avec une adresse');
  // Tout à faire (relevé de l'agence, récapitulatif des échéances, évaluations) : une lecture, partagée.
  await db.setSetting('messagerie', m);
  await db.exec(`UPDATE feuilles SET statut = 'validee' WHERE emp_id = 15 AND week = '2026-09-28'`);
  let r: Awaited<ReturnType<typeof tachesEmails>> | undefined;
  assert.equal(await lecturesPendant(db, async () => { r = await tachesEmails(db, 8); }), 1);
  assert.equal(r!.releves, 1, 'relevé de l’agence parti');
  assert.equal(await db.getSetting('relancesEcheancesLe', null), '2026-10-10');
  assert.equal(await db.getSetting('evaluationsDemandeesLe', null), '2026-10-10');
  // Évaluations désactivées : réglages seuls, sans lecture complète.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), evaluationsActives: false });
  assert.equal(await lecturesPendant(db, async () => assert.deepEqual(await db.tx(async () => await demanderEvaluations(db)), { emails: 0, demandes: 0 })), 0);
});

test('quart d’heure : une transaction par tâche, une tâche en échec n’annule pas les autres', async () => {
  const db = await demo();
  await db.exec(`UPDATE feuilles SET statut = 'validee' WHERE emp_id = 15 AND week = '2026-09-28'`);
  const releves = await db.count('releves');
  // La troisième transaction de premier niveau (récapitulatif des échéances) échoue après avoir écrit.
  const tx = db.tx.bind(db);
  let niveau = 0, rang = 0;
  db.tx = (async (fn: () => unknown) => {
    const premier = niveau === 0;
    if (premier) rang++;
    niveau++;
    try {
      return await tx(async () => {
        const v = await fn();
        if (premier && rang === 3) throw new Error('récapitulatif en échec');
        return v;
      });
    } finally {
      niveau--;
    }
  }) as typeof db.tx;
  try {
    await assert.rejects(tachesEmails(db, 8), /récapitulatif en échec/);
  } finally {
    db.tx = tx;
  }
  assert.equal(await db.count('releves'), releves + 1, 'relevé validé avant l’échec');
  assert.equal(await db.getSetting('relancesEcheancesLe', null), null, 'récapitulatif annulé seul');
  assert.equal(await db.getSetting('evaluationsDemandeesLe', null), '2026-10-10', 'tâches suivantes faites');
  assert.equal(await db.getSetting('recapitulatifLe', null), '2026-10-10');
});

test('lecture partagée : une lecture pour plusieurs lecteurs ; lecture échouée non gardée', async () => {
  const db = await demo();
  const lire = lecturePartagee(db);
  const a = await lire(RH), b = await lire({ ...RH, nom: 'Cursus', intitule: 'Relance des échéances' });
  assert.equal(lire.faites(), 1);
  assert.equal(a.employes, b.employes, 'mêmes données');
  assert.equal(b.user.intitule, 'Relance des échéances', 'avec le lecteur de chaque tâche');
  const echec = lecturePartagee(db);
  const lecture = db.lecture.bind(db);
  db.lecture = (async () => { throw new Error('occupé'); }) as typeof db.lecture;
  await assert.rejects(echec(RH), /occupé/);
  db.lecture = lecture;
  assert.ok((await echec(RH)).employes.length, 'relue après l’échec');
  assert.equal(echec.faites(), 2);
});

test('lots de paie sans contenu ; éléments émis lus dans la partie « absences » des lots non annulés : même résultat', async () => {
  const db = await demo();
  const element = (absence: number, empId: number) => ({ absence, empId, periode: '2026-09', rubrique: 'CP', quantite: 1 });
  const lot = async (statut: string, absences: unknown[] | null, cle: string) => await db.insert('lotsPaie', {
    cle, mode: 'fichier', statut, periode: '2026-09', periodes: ['2026-09'], creation: new Date().toISOString(), auteur: 'Essai', feuilles: [], resume: {},
    contenu: absences ? { lignes: [{ x: 'y'.repeat(1000) }], absences } : null, historique: false,
  });
  await lot('genere', [element(9001, 2)], 'essai-genere');
  await lot('transmis', [element(9002, 3), element(9003, 4)], 'essai-transmis');
  await lot('annule', [element(9004, 5)], 'essai-annule');
  await lot('transmis', null, 'essai-historique');
  // Lecture de référence : tous les lots avec leur contenu, comme avant le lot 8.
  const tous = await db.all<LotEnregistre>('lotsPaie');
  const emis = tous.filter(l => l.statut !== 'annule').flatMap(l => l.contenu?.absences ?? []);
  const reservees = new Set(tous.filter(l => l.statut === 'genere').flatMap(l => (l.contenu?.absences ?? []).map(x => x.absence)));
  const r = await emisEtReservees(db);
  assert.deepEqual(r.emis, emis);
  assert.deepEqual([...r.reservees].sort(), [...reservees].sort());
  assert.ok(r.reservees.has(9001) && !r.reservees.has(9002) && !r.emis.some(x => x.absence === 9004));
  const lots = await lireLots(db);
  assert.deepEqual(lots.map(l => l.id), tous.map(l => l.id).reverse(), 'du plus récent au plus ancien');
  assert.ok(lots.every(l => !('contenu' in l)), 'sans le contenu figé');
  assert.deepEqual(lots.map(l => ({ ...l })), tous.reverse().map(({ contenu: _c, ...l }) => l));
});

test('relevés : statut de l’e-mail de chaque relevé, sans une lecture par relevé', async () => {
  const db = await demo();
  const envoi = async (statut: string, cle: string) => (await db.insert<{ id: number }>('envois', { cible: 'email', type: 'releve.interim', cle, contenu: {}, statut, tentatives: 0, creation: new Date().toISOString() })).id;
  const releve = async (envoiId: number | null) => await db.insert('releves', { agence: 'Proman Lyon', semaine: '2026-09-21', adresse: 'a@b.example', creation: new Date().toISOString(), par: 'Cursus', envoiId, interimaires: 1, heures: 35, enAttente: 0 });
  await releve(await envoi('envoye', 'essai-1'));
  await releve(await envoi('echec', 'essai-2'));
  await releve(null);
  await releve(999_999);
  const get = db.get.bind(db);
  let lectures = 0;
  db.get = (async (table: never, id: unknown) => { if (table === 'envois') lectures++; return await get(table, id); }) as typeof db.get;
  const ds = await loadFull(db, RH);
  db.get = get;
  assert.equal(lectures, 0, 'aucune lecture d’envoi une à une');
  assert.deepEqual(ds.releves.slice(-4).map(r => r.envoi), ['envoye', 'echec', null, null]);
});

test('index du journal par compte et par action', async () => {
  const db = await demo();
  // SQLite : migrations nommées, comme au démarrage (PostgreSQL : migration 0013, appliquée à l'ouverture).
  await mettreAJourBase(db);
  const index = PG
    ? await db.query<{ n: string }>(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'journal'`)
    : await db.query<{ n: string }>(`SELECT name AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'journal'`);
  assert.ok(index.some(i => i.n === 'journal_compte_action'), JSON.stringify(index));
});
