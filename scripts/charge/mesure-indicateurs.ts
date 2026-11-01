// npm run charge:indicateurs : essai de charge des indicateurs sociaux (lot 11, chantier C3, étape 2). Base SQLite
// temporaire (jamais CURSUS_DB) : jeu de charge de la fabrique sur `--ans` années (3 par défaut, la profondeur de la
// BDESE : N-2, N-1, N) et `--effectif` fiches (100 par défaut ; 500 pour la marge), sexe et catégorie tirés pour chacune.
// Mesures (server/src/indicateurs.ts, lecture partagée de l'instantané en cache puis calcul hors de la lecture stable) :
// - premier calcul d'une année, sans groupement et par sexe (base qui vient de changer : rien en mémoire) ;
// - le même, servi par la mémoire (changement d'onglet : aucune relecture ni calcul) ;
// - onglet BDESE à froid : 12 calculs (3 années × ensemble, sexe, catégorie, contrat), comme l'écran ;
// - arrêté d'une année (5 groupements figés, `donneesArrete`) ;
// - taille de la réponse JSON (agrégats seulement).
// Budgets (docs/ARCHITECTURE.md, « Lot 11 : indicateurs sociaux légaux », étape 2) : premier calcul en deçà de 800 ms,
// réponse mémorisée en deçà de 20 ms, BDESE complète en deçà de 6 s, arrêté en deçà de 4 s.
import { mkdtempSync, rmSync } from 'node:fs';
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
const { loadFull } = await import('../../server/src/dataset.ts');
const { donneesArrete, indicateursDe, STATS_INDICATEURS } = await import('../../server/src/indicateurs.ts');
const { CATEGORIES_EMPLOI } = await import('../../shared/rules/indicateurs-legaux.ts');
const { aleatoire, entier, lireArguments } = await import('./commun.ts');
const { insererPortable, peuplerJeu } = await import('./fabrique.ts');
type Groupe = import('../../shared/rules/indicateurs-legaux.ts').GroupeIndicateurs;

const args = lireArguments();
const ANS = entier(args, 'ans', 3), EFFECTIF = entier(args, 'effectif', 100);
const BUDGETS = { premierMs: 800, memoireMs: 20, bdeseMs: 6000, arreteMs: 4000 };
const dir = mkdtempSync(join(tmpdir(), 'cursus-indicateurs-'));
const db = new SqliteDb(join(dir, 'indicateurs.db'));
const annee = Number(process.env.CURSUS_TODAY!.slice(0, 4));

const chrono = async <T>(f: () => Promise<T>): Promise<[T, number]> => { const d = performance.now(); const r = await f(); return [r, Math.round(performance.now() - d)]; };
/** Écriture sans effet métier (réglage remis à sa valeur) : la révision change, la mémoire des indicateurs est vidée. */
const changerRevision = async () => {
  await db.tx(async () => { await db.run('UPDATE settings SET value = value WHERE 1 = 1'); });
};

try {
  await migrate(db);
  await appliquerMigrations(db, MIGRATIONS);
  await seedDemo(db);
  await comptesDemo(db);
  const jeu = await peuplerJeu(db, aleatoire(42), { ans: ANS, effectif: EFFECTIF, interimaires: Math.round(EFFECTIF / 5) }, insererPortable(db), t => console.log(`  ${t}`));
  // Sexe et catégorie tirés pour chaque fiche (la fabrique ne les pose pas), une sur vingt laissée à compléter.
  const r = aleatoire(11), cats = Object.keys(CATEGORIES_EMPLOI);
  await db.tx(async () => {
    for (const e of jeu.employes) {
      await db.run('UPDATE employes SET sexe = ?, categorie = ? WHERE id = ?',
        [r.si(0.05) ? null : r.si(0.4) ? 'F' : 'M', r.si(0.05) ? null : r.choix(cats), e.id]);
    }
  });
  const fiches = (await loadFull(db, { role: 'rh', empId: null, nom: 'Mesure', intitule: '' })).employes.length;
  console.log(`Jeu : ${fiches} fiches sur ${ANS} an${ANS > 1 ? 's' : ''}`);

  await changerRevision();
  const lire = async (a: number, groupe: Groupe) => await indicateursDe(db, { annee: a, periode: 'annee', groupe });
  const [rEnsemble, premierMs] = await chrono(async () => await lire(annee, 'aucun'));
  const [, premierSexeMs] = await chrono(async () => await lire(annee, 'sexe'));
  const memoAvant = STATS_INDICATEURS.memorises;
  const [, memoireMs] = await chrono(async () => await lire(annee, 'aucun'));
  const servieParLaMemoire = STATS_INDICATEURS.memorises === memoAvant + 1;

  await changerRevision();
  const [, bdeseMs] = await chrono(async () => {
    for (const a of [annee - 2, annee - 1, annee]) for (const g of ['aucun', 'sexe', 'categorie', 'contrat'] as Groupe[]) await lire(a, g);
  });
  const ds = await loadFull(db, { role: 'rh', empId: null, nom: 'Mesure', intitule: '' });
  const [donnees, arreteMs] = await chrono(async () => donneesArrete(ds, annee - 1));
  const mesures = {
    premierMs, premierSexeMs, memoireMs, servieParLaMemoire, bdeseMs, arreteMs,
    reponseKo: Math.round(JSON.stringify(rEnsemble).length / 100) / 10,
    arreteKo: Math.round(JSON.stringify(donnees).length / 100) / 10,
  };
  console.log('Indicateurs :', mesures);
  const depasses = [
    premierMs > BUDGETS.premierMs ? `premier calcul ${premierMs} ms > ${BUDGETS.premierMs}` : '',
    memoireMs > BUDGETS.memoireMs || !servieParLaMemoire ? `réponse mémorisée ${memoireMs} ms (mémoire ${servieParLaMemoire ? 'utilisée' : 'non utilisée'})` : '',
    bdeseMs > BUDGETS.bdeseMs ? `BDESE ${bdeseMs} ms > ${BUDGETS.bdeseMs}` : '',
    arreteMs > BUDGETS.arreteMs ? `arrêté ${arreteMs} ms > ${BUDGETS.arreteMs}` : '',
  ].filter(Boolean);
  console.log(depasses.length ? `Budget dépassé : ${depasses.join(' ; ')}` : 'Budgets tenus.');
  if (depasses.length) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
