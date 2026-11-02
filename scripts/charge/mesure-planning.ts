// npm run charge:planning : essai de charge du planning d'équipe (lot 12, chantier C5, étape 1), à faire avant d'activer le
// module. Base SQLite temporaire (jamais CURSUS_DB) : jeu de charge d'un an de la fabrique (120 fiches, feuilles, absences,
// lots), mesuré sans planning puis avec `--ans` années de créneaux (3 par défaut, cycle 3x8, un créneau par salarié et par
// jour, 12 semaines à venir en brouillon). Mesures, médiane de 5 essais : lecture brute complète (`lireBrut`, créneaux dans
// leur fenêtre de 8 semaines passées à 12 semaines à venir), assemblage, vue RH, vue d'un manager et d'un collaborateur,
// taille du JSON de la vue RH (brut et brotli), relecture de la fenêtre des créneaux, contrôles d'une publication de 4
// semaines pour une équipe (lecture des postes de chacun et contrôles sur la fenêtre glissante), historique d'un an
// (route à la demande, lecture et filtre). Budgets (docs/ARCHITECTURE.md, « Performances ») : vue RH en deçà de 800 ms,
// vues manager et collaborateur en deçà de 300 ms.
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
const { addD, mondayOf } = await import('../../shared/dates.ts');
const { creneauxPlanificateur, horaireDuCreneau } = await import('../../shared/rules/planning.ts');
const { controlesPlanning, JOURS_APRES, SEMAINES_AVANT } = await import('../../shared/rules/planning-controles.ts');
const { creneauxPourProfil } = await import('../../server/src/vues-planning.ts');
const { aleatoire, entier, lireArguments } = await import('./commun.ts');
const { insererPortable, peuplerJeu } = await import('./fabrique.ts');
const { peuplerPlanning } = await import('./planning.ts');
type Creneau = import('../../shared/types-planning.ts').Creneau;

const args = lireArguments();
const ANS = entier(args, 'ans', 3), ESSAIS = 5, TODAY = process.env.CURSUS_TODAY!;
const dir = mkdtempSync(join(tmpdir(), 'cursus-planning-'));
const db = new SqliteDb(join(dir, 'planning.db'));

const mediane = async (f: () => Promise<unknown> | unknown) => {
  const t: number[] = [];
  for (let i = 0; i < ESSAIS; i++) { const d = performance.now(); await f(); t.push(performance.now() - d); }
  return Math.round(t.sort((a, b) => a - b)[ESSAIS >> 1]);
};

async function mesurer(titre: string, planning: boolean) {
  const rh = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL AND profil_rh = ?', ['rh_admin']))!.id, role: 'rh', methode: 'demo' }))!;
  const mgr = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 12'))!.id, role: 'manager', methode: 'demo' }))!;
  const coll = (await currentUser(db, { compteId: (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id = 2'))!.id, role: 'collaborateur', methode: 'demo' }))!;
  const brut = await db.lecture(async () => await lireBrut(db, TODAY));
  const full = assembler(brut, TODAY, 0, rh);
  const json = JSON.stringify(vueDe(full, rh));
  const r: Record<string, number> = {
    creneauxEnBase: Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM creneaux'))?.n ?? 0), creneauxLus: brut.creneaux.length,
    lectureBruteMs: await mediane(async () => await db.lecture(async () => await lireBrut(db, TODAY))),
    assemblageMs: await mediane(() => assembler(brut, TODAY, 0, rh)),
    vueRhMs: await mediane(() => vueDe(assembler(brut, TODAY, 1, rh), rh)),
    vueManagerMs: await mediane(() => vueDe(assembler(brut, TODAY, 2, mgr), mgr)),
    vueCollaborateurMs: await mediane(() => vueDe(assembler(brut, TODAY, 3, coll), coll)),
    jsonRhMo: Math.round(json.length / 1e4) / 100,
    jsonRhBrotliMo: Math.round(brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length / 1e4) / 100,
    relectureCreneauxMs: await mediane(async () => await db.lecture(async () => await lireTable(db, 'creneaux', TODAY))),
  };
  if (planning) {
    // Contrôles d'une publication de 4 semaines pour l'équipe de Karim Haddad (Maintenance), comme planning.publier.
    const du = mondayOf(addD(TODAY, 14)), au = addD(du, 27);
    const equipe = full.employes.filter(e => e.equipe === 'Maintenance');
    r.controlesPublicationMs = await mediane(async () => {
      for (const e of equipe) {
        const lignes = creneauxPlanificateur(await db.allDans<Creneau>('creneaux', { where: 'emp_id = ? AND jour >= ? AND jour <= ?', params: [e.id, addD(mondayOf(du), -7 * SEMAINES_AVANT), addD(au, JOURS_APRES)] }));
        controlesPlanning({ employe: e, jours: lignes.map(c => ({ jour: c.jour, horaire: horaireDuCreneau(c) })), du, au, reglages: full.settings, derogationDominicale: true });
      }
    });
    r.salariesControles = equipe.length;
    r.historiqueUnAnMs = await mediane(async () => creneauxPourProfil(await db.allDans<Creneau>('creneaux', { where: 'jour >= ? AND jour <= ?', params: [addD(TODAY, -365), TODAY] }), ['consultation']));
  }
  console.log(`${titre} :`, r);
  return r;
}

try {
  await migrate(db);
  await appliquerMigrations(db, MIGRATIONS);
  await seedDemo(db);
  await comptesDemo(db);
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  const jeu = await peuplerJeu(db, aleatoire(42), { ans: 1, effectif: 100, interimaires: 20 }, insererPortable(db), t => console.log(`  ${t}`));
  const sans = await mesurer('Sans planning', false);
  const p = await db.tx(async () => await peuplerPlanning(db, aleatoire(7), jeu.employes, jeu.today, { ans: ANS, semainesAVenir: 12 }, insererPortable(db)));
  console.log(`Planning : ${p.creneaux} créneaux, ${p.roulements} affectations, ${p.publications} publications, ${p.echanges} échanges sur ${ANS} an${ANS > 1 ? 's' : ''}`);
  const avec = await mesurer(`Avec ${ANS} an${ANS > 1 ? 's' : ''} de planning`, true);
  console.log('Écart :', Object.fromEntries(Object.entries(sans).map(([k, v]) => [k, Math.round(((avec[k] ?? 0) - v) * 100) / 100])));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
