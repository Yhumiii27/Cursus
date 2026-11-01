// Migration nommée du lot 12, chantier C1 (forfait annuel en heures, t044) : index de lecture de la table
// `clotures_forfait_heures` (créée, avec son unicité (emp_id, debut, version) et la colonne json `lots_paie.forfait_heures`,
// par le schéma déclaratif de server/src/db.ts) : lignes d'un salarié, lignes d'un lot de paie (réservation, confirmation et
// libération). Aucune donnée à reprendre : aucune clôture n'existe avant ce chantier. Mêmes index sur PostgreSQL :
// server/migrations-pg/0022_forfait_heures.sql.
import { index } from './exploitation.ts';

export const FORFAIT_HEURES = index('lot12-forfait-heures', {
  clotures_forfait_heures_emp: 'CREATE INDEX IF NOT EXISTS clotures_forfait_heures_emp ON clotures_forfait_heures (emp_id)',
  clotures_forfait_heures_lot: 'CREATE INDEX IF NOT EXISTS clotures_forfait_heures_lot ON clotures_forfait_heures (lot_id)',
});
