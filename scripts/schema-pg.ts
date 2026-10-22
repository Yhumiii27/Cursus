// Ouverture du serveur PostgreSQL de DATABASE_URL comme au démarrage de Cursus (migrations de server/migrations-pg/,
// contrôle du schéma, amorçages d'une base neuve, démonstration si CURSUS_DEMO=1 sur un schéma vide), puis état du
// schéma : tables de cursus, rien dans public. Sert à l'intégration continue (job postgres) et aux essais sur le socle.
//   DATABASE_URL=postgres://cursus_app:…@127.0.0.1:5432/epc2i node scripts/schema-pg.ts
import { demoActive } from '../server/src/config.ts';
import { openDb, TABLES, urlPostgres } from '../server/src/db.ts';
import { mettreAJourBase } from '../server/src/demarrage.ts';
import { comptesDemo, seedDemo } from '../server/src/seed.ts';

if (!urlPostgres()) {
  console.error('DATABASE_URL absente : ce script ne vérifie que le serveur PostgreSQL.');
  process.exit(2);
}
const db = await openDb();
try {
  await mettreAJourBase(db);
  if (demoActive()) await db.tx(async () => { if (await db.count('employes') === 0) { await seedDemo(db); await comptesDemo(db); } });
  const n = async (schema: string) => Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = ? AND tablename <> 'schema_migrations'`, [schema]))!.n);
  const cursus = await n('cursus'), pub = await n('public');
  const vues = (await db.query<{ v: string }>(`SELECT viewname AS v FROM pg_views WHERE schemaname = 'cursus' ORDER BY viewname`)).map(r => r.v);
  const migrations = (await db.query<{ nom: string }>('SELECT nom FROM schema_migrations ORDER BY nom')).map(r => r.nom);
  console.log(`schéma cursus : ${cursus} tables (TABLES : ${Object.keys(TABLES).length}), ${vues.length} vues (${vues.join(', ')}) ; public : ${pub} table(s)`);
  console.log(`migrations : ${migrations.join(', ')} · salariés : ${await db.count('employes')}`);
  if (cursus !== Object.keys(TABLES).length || pub !== 0) process.exitCode = 1;
} finally {
  await db.fermer();
}
