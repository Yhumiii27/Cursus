// Migration nommée du lot 8, chantier E (montée en charge) : index du journal par compte et par action, du plus récent
// au plus ancien. Le regroupement des actions répétées d'un même compte (server/src/journal.ts, `regrouper`) et la
// dernière consultation d'une pièce (server/src/pieces-routes.ts) cherchent les dernières lignes d'un compte pour une
// action. Même index sur PostgreSQL : server/migrations-pg/0013_index_journal.sql.
import { index } from './exploitation.ts';

export const INDEX_JOURNAL_COMPTE = index('lot8-index-journal', {
  journal_compte_action: 'CREATE INDEX IF NOT EXISTS journal_compte_action ON journal (compte_id, action, id DESC)',
});
