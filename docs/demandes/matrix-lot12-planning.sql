-- Demande de Cursus à Matrix (lot 12, chantier C5, planning d'équipe) : colonnes de Cursus à ajouter à
-- droits.colonnes_sensibles, en 'convention', avant l'activation du planning d'équipe (réglage planningActif, après l'avis
-- du CSE). Elles sont déclarées « Sensible » par la migration server/migrations-pg/0026_planning_equipe.sql : motifs (textes
-- libres) et codes des alertes acceptées, dont la réserve d'aptitude médicale. Aucune vue pub_creneaux n'est demandée
-- (choix par défaut du chantier : rien n'est publié pour Keystone ni Vigie au lot 12). Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; ce fichier n'est jamais exécuté sur le serveur commun par Cursus, il
-- attend la validation du propriétaire puis son report dans infra/postgres/init/03-droits.sql de Matrix.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot12-planning.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'creneaux', 'motif', 'Texte libre : circonstances exceptionnelles d''une publication hors du délai de prévenance', 'convention'),
  ('cursus', 'creneaux', 'motif_alertes', 'Texte libre : motif des alertes acceptées à la publication du planning', 'convention'),
  ('cursus', 'creneaux', 'alertes_acceptees', 'Santé : codes des alertes acceptées, dont la réserve d''aptitude médicale', 'convention'),
  ('cursus', 'creneaux', 'annule_motif', 'Texte libre : motif de l''annulation d''un créneau', 'convention'),
  ('cursus', 'roulements', 'fin_motif', 'Texte libre : motif de la fin d''une affectation au roulement', 'convention'),
  ('cursus', 'echanges_poste', 'motif_refus', 'Texte libre : motif du refus d''un échange de poste', 'convention'),
  ('cursus', 'echanges_poste', 'alertes_acceptees', 'Santé : codes des alertes acceptées à la validation d''un échange, dont la réserve d''aptitude médicale', 'convention');
