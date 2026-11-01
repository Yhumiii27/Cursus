-- Demande de Cursus à Matrix (lot 12, chantier C1, forfait annuel en heures) : colonnes de la table clotures_forfait_heures
-- à ajouter à droits.colonnes_sensibles, en 'convention'. Elles sont déclarées « Sensible » par la migration
-- server/migrations-pg/0022_forfait_heures.sql : quantités d'heures d'un salarié (éléments de paie ; un total d'heures
-- d'absence élevé peut laisser deviner un arrêt) et motifs de réouverture et d'annulation (textes libres). Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; ce fichier n'est jamais exécuté sur le serveur commun par Cursus, il
-- attend la validation du propriétaire puis son report dans infra/postgres/init/03-droits.sql de Matrix. Statut : à valider.
-- Fichier propre au chantier C1 (un fichier par chantier, comme au lot 11) : aucune fusion avec les demandes des autres
-- chantiers du lot 12.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot12-forfait-heures.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'clotures_forfait_heures', 'absences', 'Santé : total des heures d''absence déduites de la cible (un total élevé peut laisser deviner un arrêt)', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'cible', 'Vie personnelle : cible proratisée d''un salarié (heures)', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'realise', 'Vie personnelle : heures réalisées d''un salarié sur la période', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'hfa25', 'Vie personnelle : heures majorées à payer à un salarié (élément de paie)', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'hfa50', 'Vie personnelle : heures majorées à payer à un salarié (élément de paie)', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'hca10', 'Vie personnelle : heures complémentaires à payer à un salarié (élément de paie)', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'hca25', 'Vie personnelle : heures complémentaires à payer à un salarié (élément de paie)', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'non_realise', 'Vie personnelle : heures non réalisées d''un salarié sur la période', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'rouverte_motif', 'Texte libre : motif de la réouverture d''une clôture', 'convention'),
  ('cursus', 'clotures_forfait_heures', 'annulee_motif', 'Texte libre : motif de l''annulation d''une clôture', 'convention');
