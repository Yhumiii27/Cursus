// Migrations nommées du chantier C du lot 7 (sessions de formation). Étape 1, liste d'attente des sessions complètes
// (t120) : la table `attentes_session` est déclarée dans TABLES (server/src/db.ts), sa clé unique (session, salarié) sert
// la file d'une session ; seul son index de lecture par salarié (instantané du collaborateur et du manager, sortie,
// réouverture d'une demande) passe par ici. PostgreSQL : même index dans server/migrations-pg/0007_formations.sql.
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

const INDEX: Record<string, string> = {
  attentes_session_emp: 'CREATE INDEX IF NOT EXISTS attentes_session_emp ON attentes_session (emp_id)',
};

export const INDEX_ATTENTES: Migration = {
  nom: 'lot7-formations-index-attentes',
  necessaire: (db: SqliteDb) => Object.keys(INDEX).some(i => !indexExiste(db, i)),
  executer: async (db: Db) => {
    for (const sql of Object.values(INDEX)) await db.exec(sql);
    return `index ${Object.keys(INDEX).join(', ')}`;
  },
};
