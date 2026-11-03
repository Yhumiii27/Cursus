-- Demande de Cursus à Matrix (lot 13, monétisation du compte épargne-temps) : colonnes de la table monetisations_cet à
-- ajouter à droits.colonnes_sensibles, en 'convention'. Elles sont déclarées « Sensible » par la migration
-- server/migrations-pg/0030_cet_monetisation.sql : jours payés à un salarié (élément de paie nominatif) et motif d'un refus
-- ou d'une annulation (texte libre). Même forme que docs/demandes/matrix-lot8-colonnes-sensibles.sql ; ce fichier n'est
-- jamais exécuté sur le serveur commun par Cursus, il attend la validation du propriétaire puis son report dans
-- infra/postgres/init/03-droits.sql de Matrix. Statut : à valider. Note : docs/demandes/matrix-lot13-cet-monetisation.md.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot13-cet-monetisation.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'monetisations_cet', 'jours', 'Vie personnelle : jours du compte épargne-temps payés à un salarié (élément de paie)', 'convention'),
  ('cursus', 'monetisations_cet', 'motif', 'Texte libre : motif du refus ou de l''annulation d''une demande de monétisation', 'convention');
