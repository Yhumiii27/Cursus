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

const { Db } = await import('../server/src/db.ts');
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
type Employe = ReturnType<typeof loadFull>['employes'][number];
type User = NonNullable<ReturnType<typeof currentUser>>;

const args = process.argv.slice(2);
const EFFECTIF = Number(args.find(a => /^\d+$/.test(a)) ?? 100);
const sansIndex = args.includes('--sans-index');
const ANS = 3;

const dir = mkdtempSync(join(tmpdir(), 'cursus-mesure-'));
const db = new Db(join(dir, 'mesure.db'));
try {
  migrate(db);
  appliquerMigrations(db, sansIndex ? MIGRATIONS.filter(m => m !== INDEX_SALARIES) : MIGRATIONS);
  seedDemo(db);
  const today = process.env.CURSUS_TODAY!;
  const debut = mondayOf(addD(today, -365 * ANS));
  const projet = db.all<{ code: string }>('projets', 'rowid')[0].code;

  db.tx(() => {
    // Fiches : celles de la démonstration, recopiées (avec leurs titres) jusqu'à l'effectif voulu.
    const modeles = loadFull(db, { role: 'rh', empId: null, nom: 'Mesure', intitule: '', profilRh: 'rh_admin' }).employes;
    for (let i = modeles.length; i < EFFECTIF; i++) {
      const m = modeles[i % modeles.length];
      const { id: _id, certs, habs, visas: _v, vaccins: _va, passeport: _p, ...fiche } = m;
      const e = db.insert<Employe>('employes', { ...fiche, nom: `${m.nom} ${i}`, email: null, matriculePaie: null, entree: m.entree < debut ? m.entree : debut });
      certs.forEach(({ id: _c, ...c }) => db.insert('certifications', { ...c, empId: e.id }));
      habs.forEach(({ id: _h, ...h }) => db.insert('habTitres', { ...h, empId: e.id }));
    }
    // 3 ans de feuilles validées (35 h, une ligne) et de congés (3 semaines l'été, une à Noël, 10 RTT), journal compris.
    const existantes = new Set(db.all<{ empId: number; week: string }>('feuilles').map(f => `${f.empId}|${f.week}`));
    const employes = loadFull(db, { role: 'rh', empId: null, nom: 'Mesure', intitule: '', profilRh: 'rh_admin' }).employes;
    for (const e of employes) {
      for (let w = debut; w < mondayOf(addD(today, -7)); w = addD(w, 7)) {
        if (w < mondayOf(e.entree) || existantes.has(`${e.id}|${w}`)) continue;
        db.insert('feuilles', {
          empId: e.id, week: w, statut: 'validee', comment: null, sage: true, keystone: false, contrat: contratFige(e), heuresSup: 'paiement', majDimanche: 0,
          lignes: [{ projet, tache: '', ks: false, h: [7, 7, 7, 7, 7, 0, 0] }],
        });
        db.sql.prepare('INSERT INTO journal (at, actor, role, action, message, payload, salaries, paie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(`${addD(w, 7)}T08:00:00.000Z`, 'Mesure', 'manager', 'temps.validate', 'Feuille validée', JSON.stringify({ empId: e.id, week: w }), JSON.stringify([e.id]), 1);
      }
      for (let a = Number(debut.slice(0, 4)); a <= Number(today.slice(0, 4)); a++) {
        const conges: [string, string, string][] = [['CP', `${a}-08-03`, `${a}-08-21`], ['CP', `${a}-12-21`, `${a}-12-24`]];
        for (let r = 0; r < 10; r++) { const j = mondayOf(`${a}-${String(1 + r).padStart(2, '0')}-15`); conges.push(['RTT', addD(j, 4), addD(j, 4)]); }
        for (const [type, du, au] of conges) {
          if (du < e.entree || du > today) continue;
          db.insert('absences', { empId: e.id, type, du, au, statut: 'validee', keystone: false });
        }
      }
    }
  });

  const compte = (sql: string, ...p: number[]) => (db.sql.prepare(sql).get(...p) as { id: number } | undefined)?.id;
  const utilisateur = (compteId: number | undefined, role: User['role']) => currentUser(db, { compteId: compteId!, role, methode: 'demo' })!;
  const RH = utilisateur(compte(`SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = 'rh_admin'`), 'rh');
  const mgrId = db.all<{ managerId: number | null }>('equipes').find(e => e.managerId)!.managerId!;
  const MGR = utilisateur(compte('SELECT id FROM comptes WHERE emp_id = ?', mgrId), 'manager');
  const COLLAB = utilisateur(compte('SELECT id FROM comptes WHERE emp_id = ?', 1), 'collaborateur');

  const mediane = (n: number, fn: () => void) => {
    const durees: number[] = [];
    for (let i = 0; i < n; i++) { const t = performance.now(); fn(); durees.push(performance.now() - t); }
    return durees.sort((a, b) => a - b)[Math.floor(n / 2)];
  };
  const taille = (u: User) => {
    const json = Buffer.from(JSON.stringify(buildSnapshot(db, u)));
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
  const saisie = (u: User, empId: number) => () => {
    db.tx(() => {
      const p = { empId, week: semaine, li: 0, di: 0, value: String(7 + (valeur++ % 2)) };
      const trace = preparerTrace(db, 'temps.setCell', p);
      ACTIONS['temps.setCell'](makeCtx(db, u, loadFull(db, u)), p);
      journaliserAction(db, trace, { user: u, compte: db.get('comptes', u.compteId)!, message: null, result: undefined });
    });
    JSON.stringify(buildSnapshot(db, u));
  };
  db.tx(() => {
    const p = { empId: 1, week: semaine, projet };
    ACTIONS['temps.addLine'](makeCtx(db, RH, loadFull(db, RH)), p);
  });

  console.log(`Mesure Cursus — ${db.count('employes')} salariés, ${ANS} ans : ${db.count('feuilles')} feuilles, ${db.count('absences')} absences, `
    + `${db.count('journal')} lignes de journal${sansIndex ? ' (sans les index par salarié)' : ''}`);
  for (const [nom, u] of [['RH', RH], ['manager', MGR], ['collaborateur', COLLAB]] as const) {
    const t = taille(u);
    console.log(`  Instantané ${nom} : ${ko(t.brut)} en JSON, ${ko(t.brotli)} en brotli, ${ko(t.gzip)} en gzip`);
  }
  console.log(`  Lecture complète de la base (loadFull) : ${ms(mediane(7, () => loadFull(db, RH)))}`);
  console.log(`  /api/data (RH) : ${ms(mediane(7, () => JSON.stringify(buildSnapshot(db, RH))))}`);
  console.log(`  Saisie d'une cellule d'heures (RH) : ${ms(mediane(9, saisie(RH, 1)))}`);
  console.log(`  Saisie d'une cellule d'heures (collaborateur) : ${ms(mediane(9, saisie(COLLAB, 1)))}`);
} finally {
  db.sql.close();
  rmSync(dir, { recursive: true, force: true });
}
