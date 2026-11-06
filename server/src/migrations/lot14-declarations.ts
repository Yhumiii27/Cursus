// Migration nommée du lot 14, étape 2 (pré-déclarations de présence sur site) : index de lecture de la table
// `declarations_presence` (créée, avec `liens_declaration`, par le schéma déclaratif de server/src/db.ts) : déclarations
// en attente d'un lien (plafond du dépôt public), déclarations rattachées à une fiche. Aucune donnée à reprendre. Mêmes
// index sur PostgreSQL : server/migrations-pg/0032_declarations_presence.sql.
import { index } from './exploitation.ts';

export const DECLARATIONS = index('lot14-declarations-index', {
  declarations_presence_lien: 'CREATE INDEX IF NOT EXISTS declarations_presence_lien ON declarations_presence (lien_id, statut)',
  declarations_presence_emp: 'CREATE INDEX IF NOT EXISTS declarations_presence_emp ON declarations_presence (emp_id)',
});
