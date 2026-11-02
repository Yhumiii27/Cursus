// Migration nommée du chantier C6 du lot 12 (badgeage virtuel, t191). Les tables `pointages`, `corrections_pointage` et
// `zones_pointage`, les colonnes `feuilles.mode_temps`, `feuilles.pointe_fige` et celles des horaires variables sont
// déclarées dans TABLES (server/src/db.ts) : SQLite les crée à l'ouverture, sans contrainte CHECK. Passent par ici les
// index de lecture et le déclencheur qui refuse toute modification d'un pointage brut (ajouts seulement : une correction
// ajoute une ligne). PostgreSQL : mêmes index et même déclencheur dans server/migrations-pg/0027_badgeage.sql.
import type { SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

const INDEX: Record<string, string> = {
  pointages_emp_jour: 'CREATE INDEX IF NOT EXISTS pointages_emp_jour ON pointages (emp_id, jour)',
  pointages_jour: 'CREATE INDEX IF NOT EXISTS pointages_jour ON pointages (jour)',
  pointages_annule: 'CREATE INDEX IF NOT EXISTS pointages_annule ON pointages (annule_id) WHERE annule_id IS NOT NULL',
  corrections_pointage_emp_jour: 'CREATE INDEX IF NOT EXISTS corrections_pointage_emp_jour ON corrections_pointage (emp_id, jour)',
  corrections_pointage_pointage: 'CREATE INDEX IF NOT EXISTS corrections_pointage_pointage ON corrections_pointage (pointage_id)',
};
const DECLENCHEUR = `CREATE TRIGGER IF NOT EXISTS pointages_ajouts_seulement BEFORE UPDATE ON pointages
  BEGIN SELECT RAISE(ABORT, 'Pointage brut : ajouts seulement (une correction ajoute une ligne)'); END`;
const declencheurExiste = async (db: SqliteDb) => !!await db.one(`SELECT 1 AS x FROM sqlite_master WHERE type = 'trigger' AND name = 'pointages_ajouts_seulement'`);

export const BADGEAGE: Migration = {
  nom: 'lot12-badgeage-pointages',
  necessaire: async (db: SqliteDb) => Object.keys(INDEX).some(i => !indexExiste(db, i)) || !await declencheurExiste(db),
  executer: async (db: SqliteDb) => {
    for (const sql of Object.values(INDEX)) await db.exec(sql);
    await db.exec(DECLENCHEUR);
    return `index ${Object.keys(INDEX).join(', ')} ; pointages en ajouts seulement`;
  },
};
