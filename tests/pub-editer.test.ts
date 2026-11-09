// lot 15 — demande M-19 de Matrix : fonction PostgreSQL `pub_editer` (server/migrations-pg/0033_pub_editer.sql), correction
// depuis la visionneuse de Matrix des libellés des référentiels de Cursus (périmètre choisi par le propriétaire le
// 9 novembre 2026). Vérifie : convention de Matrix (SECURITY DEFINER, search_path figé avec pg_temp en dernier, exécution
// retirée à PUBLIC), « corriger » seulement, colonnes ouvertes, contrôles des formulaires de Cursus, valeurs inchangées
// non tracées, journal de Cursus (auteur, motif, avant et après), instantané relu. PostgreSQL seulement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { PG, nouvelleBase } = await import('./base.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { currentUser, loadFull } = await import('../server/src/dataset.ts');
const { JOURNAL_LABEL } = await import('../shared/journal.ts');
type Db = import('../server/src/db.ts').Db;

const SEUL = { skip: !PG && 'PostgreSQL seulement (CURSUS_TEST_ENGINE=pg)' };

async function fresh() {
  const db = await nouvelleBase();
  await seedDemo(db);
  const editer = async (table: string, action: string, cle: unknown, valeurs: unknown, par = 'Ana Martin', motif = 'Coquille dans le libellé') =>
    ((await db.one<{ r: Record<string, unknown> }>('SELECT pub_editer(?, ?, ?::jsonb, ?::jsonb, ?, ?) AS r',
      [table, action, cle == null ? null : JSON.stringify(cle), valeurs == null ? null : JSON.stringify(valeurs), par, motif]))!).r;
  const refus = async (re: RegExp, ...args: Parameters<typeof editer>) => await assert.rejects(async () => await editer(...args), re);
  const journal = async () => (await db.all<{ action: string; actor: string; role: string; message: string; payload: Record<string, any> }>('journal')).filter(l => l.action === 'matrix.editer');
  return { db, editer, refus, journal };
}

test('M-19 pub_editer : convention de Matrix (SECURITY DEFINER, search_path figé, pg_temp en dernier, exécution retirée à PUBLIC)', SEUL, async () => {
  const { db } = await fresh();
  const f = (await db.one<{ secdef: boolean; config: string[]; public: boolean }>(
    `SELECT p.prosecdef AS secdef, p.proconfig AS config,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = current_schema() AND p.proname = 'pub_editer'`))!;
  assert.equal(f.secdef, true);
  const sp = f.config.find(c => c.startsWith('search_path='))!;
  assert.match(sp, /^search_path=("?[a-z0-9_]+"?), pg_temp$/, 'schéma de Cursus puis pg_temp');
  assert.equal(f.public, false, 'EXECUTE retiré à PUBLIC : le droit est un lien accordé par Matrix');
});

test('M-19 pub_editer : libellés corrigés, journal de Cursus (auteur, motif, avant et après), instantané relu', SEUL, async () => {
  const { db, editer, journal } = await fresh();
  const r = await editer('formations', 'corriger', { id: 'sst' }, { nom: '  Sauveteur   secouriste du travail ', court: 'SST (MAC)', cout: '195,5' });
  assert.deepEqual([r.nom, r.court, Number(r.cout), r.validite], ['Sauveteur secouriste du travail', 'SST (MAC)', 195.5, 24], 'espaces réduits, validité intacte');
  const [l] = await journal();
  assert.deepEqual([l.actor, l.role], ['Ana Martin (Matrix)', 'integration']);
  assert.match(l.message, /^Correction depuis Matrix — formations « sst » : nom, cout, court$/, 'ordre des clés jsonb');
  assert.deepEqual(l.payload.champs, ['nom', 'cout', 'court']);
  assert.equal(l.payload.motif, 'Coquille dans le libellé');
  assert.equal(l.payload.avant.court, 'SST');
  assert.equal(l.payload.apres.court, 'SST (MAC)');
  assert.ok(JOURNAL_LABEL['matrix.editer']);
  // L'instantané se relit (révision montée par les déclencheurs) : le nouveau libellé est servi à l'application.
  const compte = (await db.one<{ id: number }>('SELECT id FROM comptes WHERE emp_id IS NULL'))!.id;
  const rh = (await currentUser(db, { compteId: compte, role: 'rh', methode: 'demo' }))!;
  assert.equal((await loadFull(db, rh)).referentiels.formations.find(f => f.id === 'sst')!.court, 'SST (MAC)');
  // Autres tables ouvertes.
  assert.equal((await editer('habilitations', 'corriger', { id: 'he' }, { signataire: 'Directeur du site' })).signataire, 'Directeur du site');
  assert.equal((await editer('destinations', 'corriger', { code: 'MA' }, { visa_sub: 'séjour de 90 jours au plus' })).visa_sub, 'séjour de 90 jours au plus');
  const org = (await db.one<{ id: number }>('SELECT id FROM organismes WHERE fusionne_dans IS NULL ORDER BY id LIMIT 1'))!.id;
  assert.equal((await editer('organismes', 'corriger', { id: org }, { site_web: 'https://www.exemple.example/formations' })).site_web, 'https://www.exemple.example/formations');
  // Valeur identique : rien d'écrit ni de tracé.
  const n = (await journal()).length;
  await editer('formations', 'corriger', { id: 'sst' }, { court: 'SST (MAC)', cout: 195.5 });
  assert.equal((await journal()).length, n);
});

test('M-19 pub_editer : refus — tables, actions et colonnes fermées, contrôles des formulaires, motif et auteur obligatoires', SEUL, async () => {
  const { refus, journal } = await fresh();
  await refus(/n'est pas modifiable depuis Matrix/, 'employes', 'corriger', { id: 2 }, { nom: 'X' });
  await refus(/n'est pas modifiable depuis Matrix/, 'postes', 'corriger', { id: 1 }, { nom: 'X' });
  await refus(/Ajout refusé/, 'formations', 'ajouter', null, { nom: 'Nouvelle' });
  await refus(/Retrait refusé/, 'formations', 'retirer', { id: 'sst' }, null);
  await refus(/Action inconnue/, 'formations', 'supprimer', { id: 'sst' }, null);
  await refus(/colonne formations\.validite n'est pas modifiable/, 'formations', 'corriger', { id: 'sst' }, { validite: 12 });
  await refus(/colonne habilitations\.prereqs n'est pas modifiable/, 'habilitations', 'corriger', { id: 'he' }, { prereqs: ['sst'] });
  await refus(/Élément introuvable/, 'formations', 'corriger', { id: 'inconnue' }, { nom: 'X' });
  await refus(/Clé manquante/, 'formations', 'corriger', {}, { nom: 'X' });
  await refus(/obligatoire/, 'formations', 'corriger', { id: 'sst' }, { nom: '   ' });
  await refus(/trop longue/, 'formations', 'corriger', { id: 'sst' }, { court: 'x'.repeat(41) });
  await refus(/porte déjà ce libellé/, 'formations', 'corriger', { id: 'sst' }, { nom: 'intervention en zone atex (niveau 1)' });
  await refus(/Coût en euros/, 'formations', 'corriger', { id: 'sst' }, { cout: 200000 });
  await refus(/nombre attendu/, 'formations', 'corriger', { id: 'sst' }, { duree_heures: 'sept' });
  await refus(/Durée en heures/, 'formations', 'corriger', { id: 'sst' }, { duree_heures: 0.1 });
  await refus(/texte ou nombre attendu/, 'formations', 'corriger', { id: 'sst' }, { nom: { fr: 'X' } });
  await refus(/Site web/, 'organismes', 'corriger', { id: 1 }, { site_web: 'ftp://exemple.example' });
  await refus(/Aucune valeur/, 'formations', 'corriger', { id: 'sst' }, {});
  await refus(/motif est obligatoire/, 'formations', 'corriger', { id: 'sst' }, { court: 'SST' }, 'Ana Martin', ' ');
  await refus(/nom de la personne est obligatoire/, 'formations', 'corriger', { id: 'sst' }, { court: 'SST' }, '', 'Motif');
  assert.equal((await journal()).length, 0, 'un refus n’écrit rien');
});

test('M-19 pub_editer : SQLite sans objet (la fonction n’existe que sur le serveur PostgreSQL commun)', { skip: PG && 'sur PostgreSQL : tests ci-dessus' }, async () => {
  const db: Db = await nouvelleBase();
  await assert.rejects(async () => await db.one('SELECT pub_editer(?, ?, ?, ?, ?, ?)', ['formations', 'corriger', '{}', '{}', 'x', 'y']));
});
