-- Demande de Cursus à Matrix (lot 11, chantier C5, notes de frais) : colonnes et tables de Cursus à ajouter à
-- droits.colonnes_sensibles, en 'convention', avant l'activation des notes de frais (réglage notesFraisActives). Elles
-- sont déclarées « Sensible » par la migration server/migrations-pg/0020_notes_frais.sql : lignes_frais en entier (frais
-- médicaux en mission, invités nommés, commerçants, trajets), montants et motifs des autres tables. Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; ce fichier n'est jamais exécuté sur le serveur commun par Cursus, il
-- attend la validation du propriétaire puis son report dans infra/postgres/init/03-droits.sql de Matrix.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot11-frais.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'lignes_frais', '*', 'Santé et vie personnelle : dépenses nominatives des notes de frais, frais médicaux compris (table entière)', 'convention'),
  ('cursus', 'lignes_frais', 'montant', 'Vie personnelle : montant d''une dépense nominative', 'convention'),
  ('cursus', 'lignes_frais', 'montant_eur', 'Vie personnelle : montant d''une dépense nominative, en euros', 'convention'),
  ('cursus', 'lignes_frais', 'montant_retenu', 'Vie personnelle : montant retenu d''une dépense nominative', 'convention'),
  ('cursus', 'lignes_frais', 'categorie', 'Santé : catégorie de la dépense (frais médicaux)', 'convention'),
  ('cursus', 'lignes_frais', 'commercant', 'Vie personnelle : commerçant (lieux fréquentés)', 'convention'),
  ('cursus', 'lignes_frais', 'invites', 'Texte libre : invités d''un repas d''affaires (tiers nommés)', 'convention'),
  ('cursus', 'lignes_frais', 'km', 'Vie personnelle : kilomètres d''un trajet', 'convention'),
  ('cursus', 'lignes_frais', 'depart', 'Vie personnelle : lieu de départ d''un trajet', 'convention'),
  ('cursus', 'lignes_frais', 'arrivee', 'Vie personnelle : lieu d''arrivée d''un trajet', 'convention'),
  ('cursus', 'lignes_frais', 'motif_depassement', 'Texte libre : motif d''un dépassement de la politique de dépenses', 'convention'),
  ('cursus', 'lignes_frais', 'refus_motif', 'Texte libre : motif du refus d''une dépense', 'convention'),
  ('cursus', 'notes_frais', 'medicale', 'Santé : note de frais médicaux en mission', 'convention'),
  ('cursus', 'notes_frais', 'renvoi_motif', 'Texte libre : motif du renvoi d''une note pour correction', 'convention'),
  ('cursus', 'notes_frais', 'annule_motif', 'Texte libre : motif de l''annulation d''une note', 'convention'),
  ('cursus', 'avances_frais', 'montant', 'Vie personnelle : montant d''une avance sur frais', 'convention'),
  ('cursus', 'avances_frais', 'refus_motif', 'Texte libre : motif du refus d''une avance', 'convention'),
  ('cursus', 'exports_frais', 'contenu', 'Vie personnelle : écritures comptables nominatives figées', 'convention');
