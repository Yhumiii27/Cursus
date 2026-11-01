// npm run charge:frais : essai de charge des notes de frais (lot 11, chantier C5), critère de fusion de l'étape 1, à faire
// avant d'activer le module. Base SQLite temporaire (jamais CURSUS_DB) : jeu de charge d'un an de la fabrique (120 fiches,
// feuilles, absences, lots), mesuré sans frais puis avec `--ans` années de frais (3 par défaut ; une note par salarié et
// par mois, 20 dépenses en moyenne). Mesures, médiane de 5 essais : lecture brute complète (`lireBrut`), assemblage, vue
// RH, vue d'un manager et d'un collaborateur, taille du JSON de la vue RH (brut et brotli), relecture complète de
// `lignes_frais` (ce que coûte au cache chaque dépense écrite : table inscrite « toute la table » au journal des
// changements). Budgets (docs/ARCHITECTURE.md, « Performances ») : vue RH en deçà de 800 ms, vue manager et collaborateur
// en deçà de 300 ms ; au-delà, les notes payées depuis plus de 13 mois sortent de l'instantané (règle prévue, non faite
// tant que la mesure ne l'exige pas).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, constants } from 'node:zlib';
process.env.CURSUS_TODAY ??= '2026-10-10';
process.env.CURSUS_DEMO ??= '1';

const { SqliteDb } = await import('../../server/src/db.ts');
const { migrate } = await import('../../server/src/migrate.ts');
const { appliquerMigrations } = await import('../../server/src/migrations/cadre.ts');
const { MIGRATIONS } = await import('../../server/src/migrations/liste.ts');
const { comptesDemo, seedDemo } = await import('../../server/src/seed.ts');
const { currentUser, vueDe } = await import('../../server/src/dataset.ts');
const { assembler, lireBrut, lireTable } = await import('../../server/src/lecture-brute.ts');
const { aleatoire, entier, lireArguments } = await import('./commun.ts');
const { insererPortable, peuplerJeu } = await import('./fabrique.ts');
const { peuplerFrais } = await import('./frais.ts');

const args = lireArguments();
const ANS = entier(args, 'ans', 3), ESSAIS = 5;
const dir = mkdtempSync(join(tmpdir(), 'cursus-frais-'));
const db = new SqliteDb(join(dir, 'frais.db'));

const mediane = async (f: () => Promise<unknown> | unknown) => {
  const t: number[] = [];
  for (let i = 0; i < ESSAIS; i++) { const d = performance.now(); await f(); t.push(performance.now() - d); }
  return Math.round(t.sort((a, b) => a - b)[ESSAIS >> 1]);
};

async function mesurer(titre: string) {
  const rh = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin']))!.id, role: 'rh', methode: 'demo' }))!;
  const mgr = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 12'))!.id, role: 'manager', methode: 'demo' }))!;
  const coll = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id, role: 'collaborateur', methode: 'demo' }))!;
  const brut = await db.lecture(async () => await lireBrut(db));
  const full = assembler(brut, process.env.CURSUS_TODAY!, 0, rh);
  const json = JSON.stringify(vueDe(full, rh));
  const r = {
    lignesFrais: brut.lignesFrais.length, notesFrais: brut.notesFrais.length,
    lectureBruteMs: await mediane(async () => await db.lecture(async () => await lireBrut(db))),
    assemblageMs: await mediane(() => assembler(brut, process.env.CURSUS_TODAY!, 0, rh)),
    vueRhMs: await mediane(() => vueDe(assembler(brut, process.env.CURSUS_TODAY!, 1, rh), rh)),
    vueManagerMs: await mediane(() => vueDe(assembler(brut, process.env.CURSUS_TODAY!, 2, mgr), mgr)),
    vueCollaborateurMs: await mediane(() => vueDe(assembler(brut, process.env.CURSUS_TODAY!, 3, coll), coll)),
    jsonRhMo: Math.round(json.length / 1e4) / 100,
    jsonRhBrotliMo: Math.round(brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length / 1e4) / 100,
    relectureLignesFraisMs: await mediane(async () => await db.lecture(async () => await lireTable(db, 'lignesFrais'))),
  };
  console.log(`${titre} :`, r);
  return r;
}

try {
  await migrate(db);
  await appliquerMigrations(db, MIGRATIONS);
  await seedDemo(db);
  await comptesDemo(db);
  const jeu = await peuplerJeu(db, aleatoire(42), { ans: 1, effectif: 100, interimaires: 20 }, insererPortable(db), t => console.log(`  ${t}`));
  const sans = await mesurer('Sans frais');
  const f = await db.tx(async () => await peuplerFrais(db, aleatoire(7), jeu.employes.map(e => e.id), jeu.today, { ans: ANS, lignesMin: 10, lignesMax: 30 }, insererPortable(db)));
  console.log(`Frais : ${f.notes} notes, ${f.lignes} dépenses, ${f.vehicules} véhicules, ${f.avances} avances sur ${ANS} an${ANS > 1 ? 's' : ''}`);
  const avec = await mesurer(`Avec ${ANS} an${ANS > 1 ? 's' : ''} de frais`);
  console.log('Écart :', Object.fromEntries(Object.entries(avec).map(([k, v]) => [k, Math.round((v - (sans as Record<string, number>)[k]) * 100) / 100])));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
