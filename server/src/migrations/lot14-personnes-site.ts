// Migration nommée du lot 14 (personnes sur site, shared/rules/personnes-site.ts). Les colonnes `exterieur`, `entreprise`
// et `matricule_site` de `employes` sont déclarées dans TABLES (server/src/db.ts) : SQLite les crée à l'ouverture. Passent
// par ici l'unicité du matricule de site et la reprise : chaque intérimaire existant sans matricule de site reçoit le
// sien (I00001, I00002… dans l'ordre des fiches, à la suite du plus grand déjà attribué). PostgreSQL : même contrainte et
// même reprise dans server/migrations-pg/0031_personnes_site.sql.
import { prochainMatriculeSite } from '../../../shared/rules/personnes-site.ts';
import type { SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

const UNICITE = 'CREATE UNIQUE INDEX IF NOT EXISTS employes_matricule_site_unique ON employes (matricule_site) WHERE matricule_site IS NOT NULL';
const sansMatricule = async (db: SqliteDb) =>
  await db.query<{ id: number }>(`SELECT id FROM employes WHERE type_contrat = 'interim' AND COALESCE(exterieur, 0) = 0 AND matricule_site IS NULL ORDER BY id`);

export const PERSONNES_SITE: Migration = {
  nom: 'lot14-personnes-site',
  necessaire: async (db: SqliteDb) => !indexExiste(db, 'employes_matricule_site_unique') || (await sansMatricule(db)).length > 0,
  executer: async (db: SqliteDb) => {
    await db.exec(UNICITE);
    const lignes = await sansMatricule(db);
    const pris = (await db.query<{ m: string }>('SELECT matricule_site AS m FROM employes WHERE matricule_site IS NOT NULL')).map(r => r.m);
    for (const { id } of lignes) {
      const m = prochainMatriculeSite('I', pris);
      pris.push(m);
      await db.run('UPDATE employes SET matricule_site = ? WHERE id = ?', [m, id]);
    }
    return `matricule de site unique ; ${lignes.length} intérimaire(s) reçoivent leur matricule I`;
  },
};
