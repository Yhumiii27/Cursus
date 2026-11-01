-- Demande de Cursus à Matrix (lot 12, chantier C3 : entretiens suivis et feedback 360°) : colonnes et tables à ajouter à
-- droits.colonnes_sensibles, en 'convention' (migration 0024_entretiens_suivis.sql, commentaires « Sensible ») :
-- textes libres des objectifs (libellé, mesure, évaluation, commentaire du salarié, motif d'ajustement, libellé d'origine),
-- souhaits de formation et synthèse du feedback 360° des entretiens (comme entretiens.cr), tables du feedback 360° en
-- entier (répondants, réponses en attente, réponses versées). Statut : proposition à valider par le propriétaire (une
-- demande par chantier, docs/demandes/LISEZ-MOI.md). Rien d'autre à partager : aucune vue pub_ demandée. Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; jamais exécuté sur le serveur commun par Cursus : la CI le rejoue
-- sur son socle d'essai (une fois appliqué, aucune colonne déclarée sensible ne reste lisible par matrix_lecture).
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot12-entretiens.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'objectifs', 'libelle', 'Texte libre : libellé d''un objectif nominatif (évaluation professionnelle)', 'convention'),
  ('cursus', 'objectifs', 'mesure', 'Texte libre : indicateur ou critère de mesure d''un objectif nominatif', 'convention'),
  ('cursus', 'objectifs', 'evaluation', 'Texte libre : évaluation d''un objectif par le manager', 'convention'),
  ('cursus', 'objectifs', 'commentaire_sal', 'Texte libre : commentaire du salarié sur son objectif', 'convention'),
  ('cursus', 'objectifs', 'ajuste_motif', 'Texte libre : motif de l''ajustement d''un objectif en cours d''année', 'convention'),
  ('cursus', 'objectifs', 'libelle_initial', 'Texte libre : libellé d''origine d''un objectif ajusté', 'convention'),
  ('cursus', 'entretiens', 'souhaits', 'Souhaits de formation exprimés à l''entretien (intitulés libres, avis du manager), comme le compte rendu', 'convention'),
  ('cursus', 'entretiens', 'synthese_feedback', 'Synthèse du feedback 360° jointe à l''entretien (évaluation par des tiers)', 'convention'),
  ('cursus', 'feedback_sollicitations', '*', 'Feedback 360° : répondants nommés et relation à l''évalué (confidentialité des répondants)', 'convention'),
  ('cursus', 'feedback_tampon', '*', 'Feedback 360° : réponses en attente du versement, chiffrées', 'convention'),
  ('cursus', 'feedback_reponses', '*', 'Feedback 360° : réponses versées par lot (notes, verbatims de tiers)', 'convention')
ON CONFLICT (schema_nom, table_nom, colonne_nom) DO UPDATE SET origine = 'convention', motif = EXCLUDED.motif;
