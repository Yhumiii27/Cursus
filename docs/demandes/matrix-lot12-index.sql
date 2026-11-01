-- Demande de Cursus à Matrix (lot 12, chantier C2, activation des notes de frais) : index des notes de frais sur le
-- serveur commun EPC2I. Statut : à valider. Ce fichier n'est jamais exécuté sur le serveur commun par Cursus ; il attend la
-- validation du propriétaire puis son report dans le REQUESTS.md de Matrix. Fichier propre au chantier C2 (un fichier par
-- chantier) : aucune fusion avec les demandes des autres chantiers du lot 12.
--
-- Objet : information et coordination, aucun droit nouveau, aucune colonne sensible nouvelle.
-- 1. Index posés par Cursus dans son schéma, par sa migration server/migrations-pg/0023_frais_fenetre.sql, au déploiement
--    du lot 12 (verrou bref de CREATE INDEX sur notes_frais : quelques milliers de lignes au plus à la mise en service) :
--    - `notes_frais_statut_payee` (statut, payee_le) : fenêtre de 13 mois de l'instantané, dépenses et justificatifs des
--      seules notes en circuit ou payées depuis moins de 2 mois, résumés des autres notes de la fenêtre, historique ;
--    - déjà présents, non recréés : `lignes_frais_note` (note_id) et `lignes_frais_emp` (emp_id) de 0020_notes_frais.sql,
--      `pieces_objet` (objet, objet_id) de 0001_init.sql.
--    Aucune table, aucune colonne, aucune vue pub_ ; les résumés des notes (totaux par note et par catégorie) sont calculés
--    à chaque lecture, jamais stockés : rien à fermer de plus à matrix_lecture. lignes_frais reste fermée en entier (demande
--    docs/demandes/matrix-lot11-frais.sql) et inscrite au journal des changements par le seul marqueur « toute la table ».
-- 2. Scission des frais médicaux (table `lignes_frais_sante`, qui permettrait d'inscrire par clé les autres dépenses au
--    journal des changements) : NON décidée au lot 12. Si elle l'est (remesure de docs/ARCHITECTURE.md, décision du DPO),
--    une demande séparée fermera la nouvelle table en entier à matrix_lecture, comme lignes_frais aujourd'hui.
-- 3. Demande à Matrix : surveiller ces index dans son suivi du serveur commun (taille, utilisation), et confirmer qu'aucune
--    règle du socle ne s'oppose à leur création par cursus_app dans le schéma cursus (droit CREATE sur son seul schéma).
--
-- Contrôle en lecture seule, à lancer après le déploiement (aucune écriture) :
--   psql -d epc2i -v ON_ERROR_STOP=1 -At -f docs/demandes/matrix-lot12-index.sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'cursus' AND indexname IN ('notes_frais_statut_payee', 'lignes_frais_note', 'lignes_frais_emp', 'pieces_objet')
ORDER BY indexname;
