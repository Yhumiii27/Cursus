// Migration nommée du chantier « astreintes » (lot 7, t049, étape 1) : activité interne INT-AST des interventions
// d'astreinte amorcée dans les projets, en production comme en démonstration (sans elle, une intervention ne trouverait pas
// sa ligne de feuille de temps), et index de lecture des tables `astreintes` et `astreinte_interventions` (créées par le
// schéma déclaratif de server/src/db.ts). Base PostgreSQL : server/migrations-pg/0005_astreintes.sql, et l'amorçage d'une
// base neuve par server/src/demarrage.ts.
import { ACTIVITE_ASTREINTE } from '../../../shared/constants.ts';
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

/** Activité interne INT-AST ajoutée si elle manque (aussi pour une base PostgreSQL neuve et le jeu de démonstration). */
export async function amorcerActiviteAstreinte(db: Db): Promise<boolean> {
  const r = await db.run(`INSERT INTO projets (code, nom, statut) VALUES (?, ?, 'actif') ON CONFLICT (code) DO NOTHING`, [ACTIVITE_ASTREINTE.code, ACTIVITE_ASTREINTE.nom]);
  return Number(r.changes) > 0;
}

/** Index de lecture : astreintes d'un salarié, interventions d'une astreinte et d'un salarié. */
const INDEX_ASTREINTES: Record<string, string> = {
  astreintes_emp: 'CREATE INDEX IF NOT EXISTS astreintes_emp ON astreintes (emp_id)',
  astreinte_interventions_astreinte: 'CREATE INDEX IF NOT EXISTS astreinte_interventions_astreinte ON astreinte_interventions (astreinte_id)',
  astreinte_interventions_emp: 'CREATE INDEX IF NOT EXISTS astreinte_interventions_emp ON astreinte_interventions (emp_id)',
};

export const ASTREINTES_ACTIVITE_INDEX: Migration = {
  nom: 'lot7-astreintes-activite-index',
  necessaire: async (db: SqliteDb) => !await db.one('SELECT 1 FROM projets WHERE code = ?', [ACTIVITE_ASTREINTE.code])
    || Object.keys(INDEX_ASTREINTES).some(i => !indexExiste(db, i)),
  executer: async (db: Db) => {
    const ajoutee = await amorcerActiviteAstreinte(db);
    for (const sql of Object.values(INDEX_ASTREINTES)) await db.exec(sql);
    return `${ajoutee ? `activité interne ${ACTIVITE_ASTREINTE.code} ajoutée, ` : ''}index ${Object.keys(INDEX_ASTREINTES).join(', ')}`;
  },
};
