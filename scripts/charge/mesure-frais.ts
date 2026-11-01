// npm run charge:frais : essai de charge des notes de frais (lot 11, chantier C5 ; refait au lot 12, chantier C2, avant
// l'activation du module). Base SQLite temporaire (jamais CURSUS_DB) : jeu de charge d'un an de la fabrique (120 fiches,
// feuilles, absences, lots), mesuré sans frais puis avec `--ans` années de frais (3 et 5 par défaut, une base par durée ;
// une note par salarié et par mois, 20 dépenses en moyenne, justificatifs de ~75 % des dépenses, 2 % de notes de frais
// médicaux). Mesures, médiane de 5 essais : lecture brute complète (`lireBrut`, fenêtre de 13 mois après paiement des
// notes de frais, lot 12), assemblage, vue RH (dérivés repris, et à froid : lot 12) et sa sérialisation, vue d'un manager
// et d'un collaborateur, taille du JSON de la vue RH (brut et brotli), relecture complète de `lignes_frais` dans la fenêtre (marqueur « toute la table » du journal des changements)
// et delta d'une dépense écrite (journal des changements, relecture, fusion).
// Verdicts (docs/ARCHITECTURE.md, « Performances » ; lot 12, chantier C2) :
// - vue RH calculée en deçà de 800 ms ; vues manager et collaborateur en deçà de 300 ms ;
// - JSON de la vue RH au plus 1,5 fois celui sans frais ; lecture brute au plus 2 fois celle sans frais ;
// - delta d'une dépense écrite en deçà de 100 ms.
// Les seuils de l'essai de charge (scripts/charge/seuils.ts) ne changent pas. Code de sortie 1 si un verdict échoue
// (contrôle de seuil).
//   npm run charge:frais [-- --ans 3]
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
const { appliquerDelta, lireDelta } = await import('../../server/src/delta.ts');
const { sansMemo } = await import('../../server/src/memo-vues.ts');
const { borneFrais } = await import('../../shared/rules/frais-fenetre.ts');
const { aleatoire, entier, lireArguments } = await import('./commun.ts');
const { insererPortable, peuplerJeu } = await import('./fabrique.ts');
const { peuplerFrais } = await import('./frais.ts');
type Db = InstanceType<typeof SqliteDb>;

const args = lireArguments();
const DUREES = args.has('ans') ? [entier(args, 'ans', 3)] : [3, 5];
const ESSAIS = 5;
const T = process.env.CURSUS_TODAY!;

/** Budgets du lot 12, chantier C2 (proposés par l'éclaireur, retenus par le brief). */
const BUDGETS_FRAIS = { vueRhMs: 800, vueSalarieMs: 300, jsonRhFacteur: 1.5, lectureBruteFacteur: 2, deltaDepenseMs: 100 } as const;

const mediane = async (f: () => Promise<unknown> | unknown) => {
  const t: number[] = [];
  for (let i = 0; i < ESSAIS; i++) { const d = performance.now(); await f(); t.push(performance.now() - d); }
  return Math.round(t.sort((a, b) => a - b)[ESSAIS >> 1]);
};

type Mesure = Record<string, number>;

async function mesurer(db: Db, titre: string): Promise<Mesure> {
  const rh = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin']))!.id, role: 'rh', methode: 'demo' }))!;
  const mgr = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 12'))!.id, role: 'manager', methode: 'demo' }))!;
  const coll = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id, role: 'collaborateur', methode: 'demo' }))!;
  const brut = await db.lecture(async () => await lireBrut(db, T));
  const full = assembler(brut, T, 0, rh);
  const json = JSON.stringify(vueDe(full, rh));
  const compter = async (sql: string) => Number((await db.one<{ n: number }>(sql))?.n ?? 0);
  const r = {
    notesEnBase: await compter('SELECT COUNT(*) AS n FROM notes_frais'), notesFrais: brut.notesFrais.length,
    lignesEnBase: await compter('SELECT COUNT(*) AS n FROM lignes_frais'), lignesFrais: brut.lignesFrais.length,
    piecesEnBase: await compter('SELECT COUNT(*) AS n FROM pieces'), pieces: brut.pieces.length,
    lectureBruteMs: await mediane(async () => await db.lecture(async () => await lireBrut(db, T))),
    assemblageMs: await mediane(() => assembler(brut, T, 0, rh)),
    vueRhMs: await mediane(() => vueDe(assembler(brut, T, 1, rh), rh)),
    // Vue RH « à froid » (lot 12 — C2) : lecture brute copiée (aucun dérivé repris de l'assemblage précédent) et vue
    // calculée sans mémo, comme à la première requête d'une révision ; puis sa sérialisation, que le cache fait une fois.
    vueRhFroideMs: await mediane(() => sansMemo(() => vueDe(assembler(copie(brut), T, 4, rh), rh))),
    jsonRhMs: await mediane(() => JSON.stringify(vueDe(full, rh))),
    vueManagerMs: await mediane(() => vueDe(assembler(brut, T, 2, mgr), mgr)),
    vueCollaborateurMs: await mediane(() => vueDe(assembler(brut, T, 3, coll), coll)),
    jsonRhMo: Math.round(json.length / 1e4) / 100,
    jsonRhBrotliMo: Math.round(brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length / 1e4) / 100,
    relectureLignesFraisMs: await mediane(async () => await db.lecture(async () => await lireTable(db, 'lignesFrais', T))),
    deltaDepenseMs: await deltaDepense(db),
  };
  console.log(`${titre} :`, r);
  return r;
}

/** Lecture brute dont chaque table est un nouveau tableau : l'assemblage ne reprend aucun dérivé mémoïsé. */
const copie = <B extends object>(brut: B): B => Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])) as B;

/**
 * Delta d'une dépense écrite (médiane de 5) : une dépense d'une note en saisie modifiée, puis, comme le cache
 * incrémental, journal des changements, relecture des tables changées (`lignes_frais` en entier dans sa fenêtre) et
 * fusion dans la lecture brute précédente. Sans note en saisie (jeu sans frais) : 0.
 */
async function deltaDepense(db: Db): Promise<number> {
  const ligne = await db.one<{ id: number }>(`SELECT l.id FROM lignes_frais l JOIN notes_frais n ON n.id = l.note_id WHERE n.statut = 'brouillon' ORDER BY l.id DESC LIMIT 1`);
  if (!ligne) return 0;
  let etat = await db.lecture(async () => ({ n: (await db.etatRevision()).n, brut: await lireBrut(db, T) }));
  const t: number[] = [];
  for (let i = 0; i < ESSAIS; i++) {
    await db.run('UPDATE lignes_frais SET commercant = ? WHERE id = ?', [`Essai de charge ${i}`, ligne.id]);
    const d = performance.now();
    etat = await db.lecture(async () => {
      const { n } = await db.etatRevision();
      const ch = await db.lireChangements(etat.n, n);
      if (!ch) throw new Error('journal des changements incomplet');
      return { n, brut: appliquerDelta(etat.brut, await lireDelta(db, etat.brut, ch)).brut };
    });
    t.push(performance.now() - d);
  }
  return Math.round(t.sort((a, b) => a - b)[ESSAIS >> 1]);
}

/** Verdicts d'une durée : mesure avec frais contre budgets et mesure sans frais. */
function verdicts(sans: Mesure, avec: Mesure): { critere: string; mesure: string; seuil: string; ok: boolean }[] {
  const b = BUDGETS_FRAIS;
  return [
    { critere: 'vue RH (à froid)', mesure: `${avec.vueRhFroideMs} ms`, seuil: `< ${b.vueRhMs} ms`, ok: avec.vueRhFroideMs < b.vueRhMs },
    { critere: 'vue manager', mesure: `${avec.vueManagerMs} ms`, seuil: `< ${b.vueSalarieMs} ms`, ok: avec.vueManagerMs < b.vueSalarieMs },
    { critere: 'vue collaborateur', mesure: `${avec.vueCollaborateurMs} ms`, seuil: `< ${b.vueSalarieMs} ms`, ok: avec.vueCollaborateurMs < b.vueSalarieMs },
    { critere: 'JSON de la vue RH', mesure: `${avec.jsonRhMo} Mo (${Math.round((avec.jsonRhMo / sans.jsonRhMo) * 100) / 100} ×)`, seuil: `≤ ${b.jsonRhFacteur} × ${sans.jsonRhMo} Mo`, ok: avec.jsonRhMo <= b.jsonRhFacteur * sans.jsonRhMo },
    { critere: 'lecture brute', mesure: `${avec.lectureBruteMs} ms`, seuil: `≤ ${b.lectureBruteFacteur} × ${sans.lectureBruteMs} ms`, ok: avec.lectureBruteMs <= b.lectureBruteFacteur * sans.lectureBruteMs },
    { critere: 'delta d’une dépense', mesure: `${avec.deltaDepenseMs} ms`, seuil: `< ${b.deltaDepenseMs} ms`, ok: avec.deltaDepenseMs < b.deltaDepenseMs },
  ];
}

let echecs = 0;
for (const ans of DUREES) {
  const dir = mkdtempSync(join(tmpdir(), 'cursus-frais-'));
  const db = new SqliteDb(join(dir, 'frais.db'));
  try {
    await migrate(db);
    await appliquerMigrations(db, MIGRATIONS);
    await seedDemo(db);
    await comptesDemo(db);
    const jeu = await peuplerJeu(db, aleatoire(42), { ans: 1, effectif: 100, interimaires: 20 }, insererPortable(db), t => console.log(`  ${t}`));
    const sans = await mesurer(db, 'Sans frais');
    const f = await db.tx(async () => await peuplerFrais(db, aleatoire(7), jeu.employes.map(e => e.id), jeu.today, { ans, lignesMin: 10, lignesMax: 30 }, insererPortable(db)));
    console.log(`Frais : ${f.notes} notes (${f.medicales} médicales), ${f.lignes} dépenses, ${f.pieces} justificatifs, ${f.vehicules} véhicules, ${f.avances} avances sur ${ans} an${ans > 1 ? 's' : ''} ; fenêtre : notes payées depuis le ${borneFrais(T)}`);
    const avec = await mesurer(db, `Avec ${ans} an${ans > 1 ? 's' : ''} de frais`);
    console.log('Écart :', Object.fromEntries(Object.entries(avec).map(([k, v]) => [k, Math.round((v - sans[k]) * 100) / 100])));
    const v = verdicts(sans, avec);
    console.log(`Verdicts (${ans} an${ans > 1 ? 's' : ''}) :`);
    for (const x of v) console.log(`  ${x.ok ? 'OK    ' : 'ÉCHEC '} ${x.critere} : ${x.mesure} (seuil ${x.seuil})`);
    echecs += v.filter(x => !x.ok).length;
  } finally {
    await db.fermer();
    rmSync(dir, { recursive: true, force: true });
  }
}
if (echecs) {
  console.log(`${echecs} verdict${echecs > 1 ? 's' : ''} en échec`);
  process.exitCode = 1;
}
