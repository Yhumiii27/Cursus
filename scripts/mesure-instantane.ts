// npm run mesure : taille de l'instantané et durée des actions pour l'effectif prévu (t171). Base temporaire, jamais
// celle de CURSUS_DB : jeu de démonstration porté à 100 salariés (fiches, titres), feuilles validées et absences sur
// 3 ans, journal d'une action par feuille. Mesures : instantané complet (RH) et réduits (manager, collaborateur), en
// JSON brut puis compressé comme par Cursus (brotli qualité 5, gzip) ; durée de /api/data et d'une saisie d'heures
// (temps.setCell, chemin de POST /api/actions : lecture de la base, action, journal, instantané renvoyé), médiane de
// plusieurs essais. `npm run mesure -- 200` : autre effectif ; `--sans-index` : sans la migration des index par salarié,
// pour comparer. Résultats du jour : docs/ARCHITECTURE.md, « Exploitation : démarrage, arrêt, santé ».
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
process.env.CURSUS_TODAY ??= '2026-10-10';
process.env.CURSUS_DEMO ??= '1';

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../server/src/migrations/liste.ts');
const { INDEX_SALARIES } = await import('../server/src/migrations/exploitation.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { addD, mondayOf } = await import('../shared/dates.ts');
const { contratFige } = await import('../shared/rules/temps.ts');
type Employe = Awaited<ReturnType<typeof loadFull>>['employes'][number];
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const args = process.argv.slice(2);
const EFFECTIF = Number(args.find(a => /^\d+$/.test(a)) ?? 100);
const sansIndex = args.includes('--sans-index');
const ANS = 3;

const dir = mkdtempSync(join(tmpdir(), 'cursus-mesure-'));
const db = new Db(join(dir, 'mesure.db'));
try {
  await migrate(db);
  await appliquerMigrations(db, sansIndex ? MIGRATIONS.filter(m => m !== INDEX_SALARIES) : MIGRATIONS);
  await seedDemo(db);
  const today = process.env.CURSUS_TODAY!;
  const debut = mondayOf(addD(today, -365 * ANS));
  const projet = (await db.all<{ code: string }>('projets', 'rowid'))[0].code;

  await db.tx(async () => {
    // Fiches : celles de la démonstration, recopiées (avec leurs titres) jusqu'à l'effectif voulu.
    const modeles = (await loadFull(db, { role: 'rh', empId: null, nom: 'Mesure', intitule: '', profilRh: 'rh_admin' })).employes;
    for (let i = modeles.length; i < EFFECTIF; i++) {
      const m = modeles[i % modeles.length];
      const { id: _id, certs, habs, visas: _v, vaccins: _va, passeport: _p, ...fiche } = m;
      const e = await db.insert<Employe>('employes', { ...fiche, nom: `${m.nom} ${i}`, email: null, matriculePaie: null, entree: m.entree < debut ? m.entree : debut });
      for (const { id: _c, ...c } of certs) await db.insert('certifications', { ...c, empId: e.id });
      for (const { id: _h, ...h } of habs) await db.insert('habTitres', { ...h, empId: e.id });
    }
    // 3 ans de feuilles validées (35 h, une ligne) et de congés (3 semaines l'été, une à Noël, 10 RTT), journal compris.
    const existantes = new Set((await db.all<{ empId: number; week: string }>('feuilles')).map(f => `${f.empId}|${f.week}`));
    const employes = (await loadFull(db, { role: 'rh', empId: null, nom: 'Mesure', intitule: '', profilRh: 'rh_admin' })).employes;
    for (const e of employes) {
      for (let w = debut; w < mondayOf(addD(today, -7)); w = addD(w, 7)) {
        if (w < mondayOf(e.entree) || existantes.has(`${e.id}|${w}`)) continue;
        await db.insert('feuilles', {
          empId: e.id, week: w, statut: 'validee', comment: null, sage: true, keystone: false, contrat: contratFige(e), heuresSup: 'paiement', majDimanche: 0,
          lignes: [{ projet, tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }],
        });
        await db.run('INSERT INTO journal (at, actor, role, action, message, payload, salaries, paie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [`${addD(w, 7)}T08:00:00.000Z`, 'Mesure', 'manager', 'temps.validate', 'Feuille validée', JSON.stringify({ empId: e.id, week: w }), JSON.stringify([e.id]), 1]);
      }
      for (let a = Number(debut.slice(0, 4)); a <= Number(today.slice(0, 4)); a++) {
        const conges: [string, string, string][] = [['CP', `${a}-08-03`, `${a}-08-21`], ['CP', `${a}-12-21`, `${a}-12-24`]];
        for (let r = 0; r < 10; r++) { const j = mondayOf(`${a}-${String(1 + r).padStart(2, '0')}-15`); conges.push(['RTT', addD(j, 4), addD(j, 4)]); }
        for (const [type, du, au] of conges) {
          if (du < e.entree || du > today) continue;
          await db.insert('absences', { empId: e.id, type, du, au, statut: 'validee', keystone: false });
        }
      }
    }
  });

  const compte = async (sql: string, ...p: number[]) => (await db.one(sql, [...p]) as { id: number } | undefined)?.id;
  const utilisateur = async (compteId: number | undefined, role: User['role']) => (await currentUser(db, { compteId: compteId!, role, methode: 'demo' }))!;
  const RH = await utilisateur(await compte(`SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = 'rh_admin'`), 'rh');
  const mgrId = (await db.all<{ managerId: number | null }>('equipes')).find(e => e.managerId)!.managerId!;
  const MGR = await utilisateur(await compte('SELECT id FROM comptes WHERE emp_id = ?', mgrId), 'manager');
  const COLLAB = await utilisateur(await compte('SELECT id FROM comptes WHERE emp_id = ?', 1), 'collaborateur');

  const mediane = async (n: number, fn: () => unknown) => {
    const durees: number[] = [];
    for (let i = 0; i < n; i++) { const t = performance.now(); await fn(); durees.push(performance.now() - t); }
    return durees.sort((a, b) => a - b)[Math.floor(n / 2)];
  };
  const taille = async (u: User) => {
    const json = Buffer.from(JSON.stringify(await buildSnapshot(db, u)));
    return {
      brut: json.length,
      brotli: brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
      gzip: gzipSync(json).length,
    };
  };
  const ko = (o: number) => `${(o / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko`;
  const ms = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ms`;

  // Saisie d'heures : feuille en brouillon de la semaine en cours, comme dans l'écran Temps de travail.
  const semaine = mondayOf(today);
  let valeur = 0;
  const saisie = (u: User, empId: number) => async () => {
    await db.tx(async () => {
      const p = { empId, week: semaine, li: 0, di: 0, value: String(7 + (valeur++ % 2)) };
      const trace = await preparerTrace(db, 'temps.setCell', p);
      await ACTIONS['temps.setCell'](makeCtx(db, u, await loadFull(db, u)), p);
      await journaliserAction(db, trace, { user: u, compte: (await db.get('comptes', u.compteId))!, message: null, result: undefined });
    });
    JSON.stringify(await buildSnapshot(db, u));
  };
  await db.tx(async () => {
    const p = { empId: 1, week: semaine, projet };
    await ACTIONS['temps.addLine'](makeCtx(db, RH, await loadFull(db, RH)), p);
  });

  console.log(`Mesure Cursus — ${await db.count('employes')} salariés, ${ANS} ans : ${await db.count('feuilles')} feuilles, ${await db.count('absences')} absences, `
    + `${await db.count('journal')} lignes de journal${sansIndex ? ' (sans les index par salarié)' : ''}`);
  for (const [nom, u] of [['RH', RH], ['manager', MGR], ['collaborateur', COLLAB]] as const) {
    const t = await taille(u);
    console.log(`  Instantané ${nom} : ${ko(t.brut)} en JSON, ${ko(t.brotli)} en brotli, ${ko(t.gzip)} en gzip`);
  }
  console.log(`  Lecture complète de la base (loadFull) : ${ms(await mediane(7, async () => await loadFull(db, RH)))}`);
  console.log(`  /api/data (RH) : ${ms(await mediane(7, async () => JSON.stringify(await buildSnapshot(db, RH))))}`);
  console.log(`  Saisie d'une cellule d'heures (RH) : ${ms(await mediane(9, saisie(RH, 1)))}`);
  console.log(`  Saisie d'une cellule d'heures (collaborateur) : ${ms(await mediane(9, saisie(COLLAB, 1)))}`);
} finally {
  db.sql.close();
  rmSync(dir, { recursive: true, force: true });
}
