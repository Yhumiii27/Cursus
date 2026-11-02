// Migrations nommées du chantier C3 du lot 12 (entretiens suivis et feedback 360°, t194). Les tables `objectifs`,
// `feedback_sollicitations`, `feedback_tampon` et `feedback_reponses`, les colonnes `entretiens.souhaits`,
// `entretiens.synthese_feedback` et `demandes_collab.entretien_id` sont déclarées dans TABLES (server/src/db.ts) : SQLite
// les crée à l'ouverture, sans contrainte CHECK (le type d'entretien n'en a pas ici). Seuls les index de lecture passent
// par ici. PostgreSQL : mêmes index dans server/migrations-pg/0024_entretiens_suivis.sql.
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

const INDEX: Record<string, string> = {
  objectifs_emp: 'CREATE INDEX IF NOT EXISTS objectifs_emp ON objectifs (emp_id)',
  objectifs_entretien: 'CREATE INDEX IF NOT EXISTS objectifs_entretien ON objectifs (entretien_id)',
  demandes_collab_entretien: 'CREATE INDEX IF NOT EXISTS demandes_collab_entretien ON demandes_collab (entretien_id)',
  feedback_sollicitations_emp: 'CREATE INDEX IF NOT EXISTS feedback_sollicitations_emp ON feedback_sollicitations (emp_id)',
  feedback_sollicitations_repondant: 'CREATE INDEX IF NOT EXISTS feedback_sollicitations_repondant ON feedback_sollicitations (repondant_emp_id)',
  feedback_reponses_entretien: 'CREATE INDEX IF NOT EXISTS feedback_reponses_entretien ON feedback_reponses (entretien_id)',
};

export const ENTRETIENS_SUIVIS_INDEX: Migration = {
  nom: 'lot12-entretiens-index',
  necessaire: (db: SqliteDb) => Object.keys(INDEX).some(i => !indexExiste(db, i)),
  executer: async (db: Db) => {
    for (const sql of Object.values(INDEX)) await db.exec(sql);
    return `index ${Object.keys(INDEX).join(', ')}`;
  },
};
