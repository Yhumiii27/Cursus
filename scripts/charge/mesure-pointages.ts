// npm run charge:pointages : essai de charge du badgeage (lot 12, chantier C6), à faire avant d'activer le module. Base
// SQLite temporaire (jamais CURSUS_DB) : jeu de charge d'un an de la fabrique (100 salariés, feuilles, absences, lots), mesuré
// sans pointage puis avec `--ans` années de pointages (3 par défaut, durée de conservation proposée : 4 pointages par jour
// travaillé et par salarié, environ 230 jours par an, soit environ 90 000 lignes par an).
// Mesures, médiane de 5 essais :
// - instantané : lecture brute complète, assemblage, vue RH (les pointages sont hors de l'instantané : rien ne doit bouger) ;
// - lecture à la demande : pointages de 6 semaines d'un salarié (GET /api/pointages), état du jour et débit-crédit d'un
//   salarié (GET /api/pointages/etat), présences du jour d'une équipe (`equipe=1`) ;
// - écriture d'un pointage (insertion seule) et purge de la conservation (rien à purger à 3 ans).
// Budgets : ceux de l'instantané (docs/ARCHITECTURE.md, « Performances ») inchangés ; lecture à la demande en deçà de 100 ms.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
process.env.CURSUS_TODAY ??= '2026-10-10';
process.env.CURSUS_DEMO ??= '1';

const { SqliteDb } = await import('../../server/src/db.ts');
const { migrate } = await import('../../server/src/migrate.ts');
const { appliquerMigrations } = await import('../../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../../server/src/migrations/liste.ts');
const { comptesDemo, seedDemo } = await import('../../server/src/seed.ts');
const { currentUser, loadFull, vueDe } = await import('../../server/src/dataset.ts');
const { assembler, lireBrut } = await import('../../server/src/lecture-brute.ts');
const { etatDuSalarie, instantServeur, lirePointages, presenceDuJour, bilanPeriode, purgerPointages } = await import('../../server/src/pointages.ts');
const { addD, mondayOf, weekday } = await import('../../shared/dates.ts');
const { instantParis } = await import('../../shared/rules/pointage.ts');
const { aleatoire, entier, lireArguments } = await import('./commun.ts');
const { insererPortable, peuplerJeu } = await import('./fabrique.ts');

const args = lireArguments();
const ANS = entier(args, 'ans', 3), ESSAIS = 5;
const TODAY = process.env.CURSUS_TODAY!;
const dir = mkdtempSync(join(tmpdir(), 'cursus-pointages-'));
const fichier = join(dir, 'pointages.db');
const db = new SqliteDb(fichier);

const mediane = async (f: () => Promise<unknown> | unknown) => {
  const t: number[] = [];
  for (let i = 0; i < ESSAIS; i++) { const d = performance.now(); await f(); t.push(performance.now() - d); }
  return Math.round(t.sort((a, b) => a - b)[ESSAIS >> 1] * 10) / 10;
};

/** Pointages de `ans` années : 4 par jour ouvré (arrivée, pause méridienne, retour, départ), un jour sur 8 sans pointage. */
async function peuplerPointages(empIds: readonly number[], ans: number): Promise<number> {
  const r = aleatoire(11);
  const debut = addD(TODAY, -365 * ans);
  let lot: (string | number)[][] = [], n = 0;
  const vider = async () => {
    if (!lot.length) return;
    await db.run(`INSERT INTO pointages (emp_id, horodatage, jour, sens, source, hors_ligne, recu_le) VALUES ${lot.map(() => `(?, ?, ?, ?, 'virtuel', FALSE, ?)`).join(', ')}`, lot.flat());
    n += lot.length;
    lot = [];
  };
  await db.tx(async () => {
    for (let jour = debut; jour < TODAY; jour = addD(jour, 1)) {
      if (weekday(jour) >= 5) continue;
      for (const empId of empIds) {
        if (r.si(0.12)) continue;
        const minutes = [7 * 60 + 45 + r.entre(0, 30), 12 * 60 + r.entre(0, 15), 12 * 60 + 45 + r.entre(0, 15), 16 * 60 + 30 + r.entre(0, 45)];
        minutes.forEach((m, i) => {
          const h = new Date(instantParis(jour, m) + r.entre(0, 59) * 1000).toISOString();
          lot.push([empId, h, jour, i % 2 ? 'S' : 'E', h]);
        });
        if (lot.length >= 400) await vider();
      }
    }
    await vider();
  });
  return n;
}

async function mesurerInstantane(titre: string) {
  const rh = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin']))!.id, role: 'rh', methode: 'demo' }))!;
  const brut = await db.lecture(async () => await lireBrut(db, TODAY));
  const r = {
    lectureBruteMs: await mediane(async () => await db.lecture(async () => await lireBrut(db, TODAY))),
    assemblageMs: await mediane(() => assembler(brut, TODAY, 0, rh)),
    vueRhMs: await mediane(() => vueDe(assembler(brut, TODAY, 1, rh), rh)),
  };
  console.log(`${titre} :`, r);
  return { r, rh };
}

try {
  await migrate(db);
  await appliquerMigrations(db, MIGRATIONS);
  await seedDemo(db);
  await comptesDemo(db);
  const jeu = await peuplerJeu(db, aleatoire(42), { ans: 1, effectif: 100, interimaires: 20 }, insererPortable(db), t => console.log(`  ${t}`));
  const sans = await mesurerInstantane('Sans pointage');
  const ids = jeu.employes.slice(0, 100).map(e => e.id);
  const t0 = performance.now();
  const n = await peuplerPointages(ids, ANS);
  console.log(`Pointages : ${n} lignes sur ${ANS} an${ANS > 1 ? 's' : ''} (${Math.round(n / ANS)} par an), insérées en ${Math.round(performance.now() - t0)} ms ; base ${Math.round(statSync(fichier).size / 1e5) / 10} Mo`);
  const avec = await mesurerInstantane(`Avec ${ANS} an${ANS > 1 ? 's' : ''} de pointages`);
  // Lecture à la demande (ce que font les routes, hors HTTP) pour un salarié pris dans le jeu et pour l'équipe de son manager.
  const ds = await loadFull(db, sans.rh);
  const e = ds.employes.find(x => x.id === ids[0])!;
  const maintenant = instantServeur(), du = addD(TODAY, -41), lundi = mondayOf(TODAY);
  const equipe = ds.employes.filter(x => x.equipe === e.equipe && !x.fin).map(x => x.id);
  const lecture = {
    sixSemainesMs: await mediane(async () => {
      const l = await lirePointages(db, [e.id], addD(du, -1), addD(TODAY, 1));
      bilanPeriode(ds, e, l, du, TODAY, maintenant);
    }),
    lignesSixSemaines: (await lirePointages(db, [e.id], du, TODAY)).length,
    etatDuJourMs: await mediane(async () => etatDuSalarie(ds, e, await lirePointages(db, [e.id], addD(lundi, -1), addD(TODAY, 1)), maintenant)),
    presencesEquipeMs: await mediane(async () => {
      const l = await lirePointages(db, equipe, addD(TODAY, -1), addD(TODAY, 1));
      for (const id of equipe) presenceDuJour(ds, ds.employes.find(x => x.id === id)!, l.filter(p => p.empId === id), maintenant);
    }),
    equipe: equipe.length,
    insertionMs: await mediane(async () => await db.tx(async () => {
      const h = new Date(maintenant).toISOString();
      await db.insert('pointages', { empId: e.id, horodatage: h, jour: TODAY, sens: 'E', source: 'virtuel', horsLigne: false, recuLe: h });
    })),
    purgeMs: await mediane(async () => await purgerPointages(db, TODAY)),
  };
  console.log('Lecture à la demande :', lecture);
  console.log('Écart de l’instantané :', Object.fromEntries(Object.entries(avec.r).map(([k, v]) => [k, Math.round((v - (sans.r as Record<string, number>)[k]) * 10) / 10])));
} finally {
  await db.fermer();
  rmSync(dir, { recursive: true, force: true });
}
