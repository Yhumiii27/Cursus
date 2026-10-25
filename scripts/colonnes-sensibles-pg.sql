-- Contrôle du lot 8 (chantier D, job postgres de .github/workflows/ci.yml) : colonnes du schéma cursus que Cursus déclare
-- sensibles et que matrix_lecture peut encore lire. Une colonne est déclarée sensible quand son commentaire, ou celui de
-- sa table (table fermée en entier), contient « Sensible » ou « à exclure de matrix_lecture » (migrations de
-- server/migrations-pg/, 0011 pour les dernières). Une ligne par colonne lisible ; aucune ligne : contrôle réussi.
-- La fermeture est faite par Matrix (droits.colonnes_sensibles du socle, déclencheur droits_ddl) : tant que la demande
-- de docs/DEMANDES-LOT8-DONNEES.md n'est pas appliquée, des lignes sortent et l'étape de la CI est non bloquante.
--   psql -d epc2i -v ON_ERROR_STOP=1 -At -f scripts/colonnes-sensibles-pg.sql
SELECT format('cursus.%I.%I lisible par matrix_lecture (%s)', c.relname, a.attname,
              CASE WHEN col_description(c.oid, a.attnum) ~ '(Sensible|à exclure de matrix_lecture)' THEN 'colonne' ELSE 'table' END || ' déclarée sensible')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'cursus' AND c.relkind IN ('r', 'p')
  AND (col_description(c.oid, a.attnum) ~ '(Sensible|à exclure de matrix_lecture)'
       OR obj_description(c.oid, 'pg_class') ~ '(Sensible|à exclure de matrix_lecture)')
  AND has_column_privilege('matrix_lecture', c.oid, a.attnum, 'SELECT')
ORDER BY c.relname, a.attnum;
