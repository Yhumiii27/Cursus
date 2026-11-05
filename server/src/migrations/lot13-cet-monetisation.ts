// Migration nommée du lot 13 (monétisation du compte épargne-temps) : index de lecture de la table `monetisations_cet`
// (créée, avec la colonne json `lots_paie.monetisations_cet`, par le schéma déclaratif de server/src/db.ts) : demandes
// d'un salarié, demandes d'un lot de paie (réservation, confirmation et libération). Aucune donnée à reprendre : aucune
// demande n'existe avant ce lot. Mêmes index sur PostgreSQL : server/migrations-pg/0030_cet_monetisation.sql.
import { index } from './exploitation.ts';

export const CET_MONETISATION = index('lot13-cet-monetisation', {
  monetisations_cet_emp: 'CREATE INDEX IF NOT EXISTS monetisations_cet_emp ON monetisations_cet (emp_id)',
  monetisations_cet_lot: 'CREATE INDEX IF NOT EXISTS monetisations_cet_lot ON monetisations_cet (lot_id)',
});
