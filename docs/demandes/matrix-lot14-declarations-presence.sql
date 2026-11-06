-- Demande de Cursus à Matrix (lot 14, étape 2, pré-déclarations de présence sur site) : colonnes à ajouter à
-- droits.colonnes_sensibles, en 'convention'. Elles sont déclarées « Sensible » par la migration
-- server/migrations-pg/0032_declarations_presence.sql : empreinte du jeton d'un lien public de déclaration et motif d'un
-- refus ou d'une annulation (texte libre). Même forme que docs/demandes/matrix-lot13-cet-monetisation.sql ; ce fichier
-- n'est jamais exécuté sur le serveur commun par Cursus, il attend la validation du propriétaire puis son report dans
-- infra/postgres/init/03-droits.sql de Matrix. Statut : à valider. Note : docs/demandes/matrix-lot14-personnes-site.md.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot14-declarations-presence.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'liens_declaration', 'empreinte', 'Secret : empreinte du jeton d''un lien public de déclaration de présence', 'convention'),
  ('cursus', 'declarations_presence', 'motif', 'Texte libre : motif du refus ou de l''annulation d''une déclaration de présence', 'convention');
