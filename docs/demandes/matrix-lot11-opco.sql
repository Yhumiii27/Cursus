-- Demande de Cursus à Matrix (lot 11, chantier C4 : dossiers OPCO) : motifs des dossiers de prise en charge et des
-- versements de l'OPCO à ajouter à droits.colonnes_sensibles, en 'convention' (migration 0019_dossiers_opco.sql, commentaires
-- « Sensible »). Rien d'autre à partager : aucune vue pub_ demandée ; les dossiers ne sont pas nominatifs (emp_id réservé aux
-- dossiers d'alternance, plus tard : une demande suivra avant de les remplir). Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; jamais exécuté sur le serveur commun par Cursus : la CI le rejoue sur
-- son socle d'essai (une fois appliqué, aucune colonne déclarée sensible ne reste lisible par matrix_lecture).
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot11-opco.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'dossiers_opco', 'refus_motif', 'Motif du refus de l''OPCO (code), réservé au service RH', 'convention'),
  ('cursus', 'dossiers_opco', 'corrige_motif', 'Texte libre : motif d''une correction ou d''une réouverture du dossier', 'convention'),
  ('cursus', 'dossiers_opco', 'annule_motif', 'Texte libre : motif de la suppression d''un dossier saisi par erreur', 'convention'),
  ('cursus', 'versements_opco', 'annule_motif', 'Texte libre : motif de l''annulation d''un versement saisi par erreur', 'convention')
ON CONFLICT (schema_nom, table_nom, colonne_nom) DO UPDATE SET origine = 'convention', motif = EXCLUDED.motif;
