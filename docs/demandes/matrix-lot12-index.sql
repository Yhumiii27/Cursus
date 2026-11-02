-- Demande de Cursus à Matrix (lot 12, chantier C2, activation des notes de frais) : index des notes de frais sur le
-- serveur commun EPC2I. Statut : à valider. Ce fichier n'est jamais exécuté sur le serveur commun par Cursus ; il attend la
-- validation du propriétaire puis son report dans le REQUESTS.md de Matrix. Fichier propre au chantier C2 (avec
-- matrix-lot12-frais-sante.sql) : aucune fusion avec les demandes des autres chantiers du lot 12.
--
-- Objet : information et coordination, aucun droit nouveau (la fermeture de la table des frais médicaux est demandée à
-- part : docs/demandes/matrix-lot12-frais-sante.sql).
-- 1. Index posés par Cursus dans son schéma, au déploiement du lot 12 (verrou bref de CREATE INDEX : quelques milliers de
--    lignes au plus à la mise en service) :
--    - `notes_frais_statut_payee` (statut, payee_le), migration 0023_frais_fenetre.sql : fenêtre de 13 mois de
--      l'instantané, historique ;
--    - `lignes_frais_sante_note` (note_id) et `lignes_frais_sante_emp` (emp_id), migration 0029_frais_sante.sql :
--      dépenses des notes de frais médicaux (scission) ;
--    - déjà présents, non recréés : `lignes_frais_note` (note_id) et `lignes_frais_emp` (emp_id) de 0020_notes_frais.sql,
--      `pieces_objet` (objet, objet_id) de 0001_init.sql.
--    Les résumés des notes, les parts réintégrables et les alertes des vues du service RH et de la comptabilité sont
--    calculés à chaque lecture, jamais stockés : rien de plus à fermer.
-- 2. Demande à Matrix : surveiller ces index dans son suivi du serveur commun (taille, utilisation), et confirmer qu'aucune
--    règle du socle ne s'oppose à leur création par cursus_app dans le schéma cursus (droit CREATE sur son seul schéma).
--
-- Contrôle en lecture seule, à lancer après le déploiement (aucune écriture) :
--   psql -d epc2i -v ON_ERROR_STOP=1 -At -f docs/demandes/matrix-lot12-index.sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'cursus' AND indexname IN ('notes_frais_statut_payee', 'lignes_frais_note', 'lignes_frais_emp', 'lignes_frais_sante_note', 'lignes_frais_sante_emp', 'pieces_objet')
ORDER BY indexname;
