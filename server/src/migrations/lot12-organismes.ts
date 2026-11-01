// Migrations nommées du chantier C4 du lot 12 (organismes de formation et e-learning, t190). Les tables `organismes`,
// `organisme_contacts`, `organisme_tarifs`, `modules_elearning` et `inscriptions_elearning`, les colonnes `organisme_id`
// (formations, sessions, formations suivies, dossiers OPCO, lignes du plan) et `certifications.organisme` (jusqu'ici
// seulement sur le serveur PostgreSQL, 0002_partage : les deux moteurs voient désormais les mêmes textes) sont déclarées
// dans TABLES (server/src/db.ts) : une base SQLite les reçoit à l'ouverture, avant ces migrations et avant la reprise des
// textes libres (server/src/reprise-organismes.ts, commune aux deux moteurs, lancée après les migrations). Seuls les
// index passent par ici ; PostgreSQL : mêmes index dans server/migrations-pg/0025_organismes_elearning.sql.
import type { Db, SqliteDb } from '../db.ts';
import type { Migration } from './cadre.ts';
import { indexExiste } from './outils.ts';

/** Index de lecture des rattachements à une fiche (fusion, activité d'un organisme) et des sous-tables. */
const INDEX_ORGANISMES: Record<string, string> = {
  formations_organisme: 'CREATE INDEX IF NOT EXISTS formations_organisme ON formations (organisme_id)',
  sessions_organisme: 'CREATE INDEX IF NOT EXISTS sessions_organisme ON sessions (organisme_id)',
  formations_suivies_organisme: 'CREATE INDEX IF NOT EXISTS formations_suivies_organisme ON formations_suivies (organisme_id)',
  plan_actions_organisme: 'CREATE INDEX IF NOT EXISTS plan_actions_organisme ON plan_actions (organisme_id)',
  dossiers_opco_organisme: 'CREATE INDEX IF NOT EXISTS dossiers_opco_organisme ON dossiers_opco (organisme_id)',
  organisme_contacts_organisme: 'CREATE INDEX IF NOT EXISTS organisme_contacts_organisme ON organisme_contacts (organisme_id)',
  organisme_tarifs_organisme: 'CREATE INDEX IF NOT EXISTS organisme_tarifs_organisme ON organisme_tarifs (organisme_id)',
};

export const ORGANISMES: Migration = {
  nom: 'lot12-organismes-index',
  necessaire: (db: SqliteDb) => Object.keys(INDEX_ORGANISMES).some(i => !indexExiste(db, i)),
  executer: async (db: Db) => {
    for (const sql of Object.values(INDEX_ORGANISMES)) await db.exec(sql);
    return `index ${Object.keys(INDEX_ORGANISMES).join(', ')}`;
  },
};

/**
 * Inscriptions aux modules d'e-learning : lecture par salarié (instantané du collaborateur et du manager, effacement d'un
 * dossier) et une seule inscription ouverte (inscrit, en cours) par salarié et module, contrôlée aussi par l'action.
 */
const INDEX_ELEARNING: Record<string, string> = {
  inscriptions_elearning_emp: 'CREATE INDEX IF NOT EXISTS inscriptions_elearning_emp ON inscriptions_elearning (emp_id)',
  inscriptions_elearning_ouverte: `CREATE UNIQUE INDEX IF NOT EXISTS inscriptions_elearning_ouverte ON inscriptions_elearning (emp_id, module_id)
    WHERE annule_le IS NULL AND statut IN ('inscrit', 'en_cours')`,
  modules_elearning_organisme: 'CREATE INDEX IF NOT EXISTS modules_elearning_organisme ON modules_elearning (organisme_id)',
};

export const ELEARNING_INDEX: Migration = {
  nom: 'lot12-elearning-index',
  necessaire: (db: SqliteDb) => Object.keys(INDEX_ELEARNING).some(i => !indexExiste(db, i)),
  executer: async (db: Db) => {
    for (const sql of Object.values(INDEX_ELEARNING)) await db.exec(sql);
    return `index ${Object.keys(INDEX_ELEARNING).join(', ')}`;
  },
};
