-- Demande de Cursus à Matrix (lot 12, chantier C2, activation des notes de frais, étape 2) : scission des frais médicaux.
-- Statut : à valider. Choix par défaut du chantier (« scission lignes_frais_sante dans une migration du lot, avec une
-- demande à Matrix » si le delta d'une dépense dépasse son budget, ce que la remesure a montré). Les dépenses des notes de
-- frais médicaux en mission sont rangées dans une table à part par la migration server/migrations-pg/0029_frais_sante.sql,
-- qui les déclare « Sensible » ; les autres dépenses restent dans lignes_frais, inscrites par clé au journal des
-- changements. Même forme que docs/demandes/matrix-lot8-colonnes-sensibles.sql ; ce fichier n'est jamais exécuté sur le
-- serveur commun par Cursus, il attend la validation du propriétaire puis son report dans infra/postgres/init/03-droits.sql
-- de Matrix.
-- 1. À fermer à matrix_lecture : lignes_frais_sante en entier (donnée de santé : l'existence même d'une ligne la révèle),
--    et ses colonnes sensibles, comme celles de lignes_frais.
-- 2. Remplace, dans la demande du lot 11 (docs/demandes/matrix-lot11-frais.sql, pas encore reportée), la fermeture de
--    lignes_frais en entier : ses colonnes sensibles (montants, catégorie, commerçant, invités, trajets, motifs) restent
--    fermées une à une. Si cette fermeture a déjà été reportée chez Matrix, la retirer
--    (DELETE FROM droits.colonnes_sensibles WHERE schema_nom = 'cursus' AND table_nom = 'lignes_frais' AND colonne_nom = '*').
-- 3. Journal des changements (`changements`, déjà fermé en entier) : lignes_frais y est désormais inscrite par clé,
--    lignes_frais_sante par le seul marqueur « toute la table ».
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot12-frais-sante.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'lignes_frais_sante', '*', 'Santé : dépenses des notes de frais médicaux en mission (table entière)', 'convention'),
  ('cursus', 'lignes_frais_sante', 'montant', 'Santé : montant d''une dépense de santé nominative', 'convention'),
  ('cursus', 'lignes_frais_sante', 'montant_eur', 'Santé : montant d''une dépense de santé nominative, en euros', 'convention'),
  ('cursus', 'lignes_frais_sante', 'montant_retenu', 'Santé : montant retenu d''une dépense de santé nominative', 'convention'),
  ('cursus', 'lignes_frais_sante', 'categorie', 'Santé : catégorie de la dépense (frais médicaux)', 'convention'),
  ('cursus', 'lignes_frais_sante', 'commercant', 'Santé : commerçant (pharmacie, centre de vaccination)', 'convention'),
  ('cursus', 'lignes_frais_sante', 'refus_motif', 'Texte libre : motif du refus d''une dépense', 'convention');
