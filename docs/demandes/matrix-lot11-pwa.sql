-- Demande de Cursus à Matrix (lot 11, chantier C2, application mobile) : colonnes et tables de Cursus à ajouter à
-- droits.colonnes_sensibles, en 'convention', avant la mise en service des notifications sur le téléphone. Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; en attente de la validation du propriétaire, jamais exécutée sur le
-- serveur commun par Cursus. Les commentaires « Sensible » correspondants sont posés par server/migrations-pg/0017_pwa.sql.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot11-pwa.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  -- Abonnements aux notifications : adresse du service de push et clés du navigateur (chiffrées au repos quand la clé
  -- des pièces est posée) ; qui les lit peut envoyer une notification à l'appareil.
  ('cursus', 'abonnements_push', 'endpoint', 'Sécurité : adresse du service de push d''un appareil', 'convention'),
  ('cursus', 'abonnements_push', 'p256dh', 'Sécurité : clé publique de chiffrement du navigateur', 'convention'),
  ('cursus', 'abonnements_push', 'auth', 'Sécurité : secret d''authentification du navigateur', 'convention'),
  -- Tables techniques : activité d'un compte (actions rejouées, notifications envoyées), sans intérêt pour les autres outils.
  ('cursus', 'idempotence', '*', 'Activité : réponses des actions rejouées par un compte (table entière)', 'convention'),
  ('cursus', 'envois_push', '*', 'Activité : notifications envoyées à un appareil (table entière)', 'convention');
