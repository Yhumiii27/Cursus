-- Demande de Cursus à Matrix (lot 12, chantier C4 : organismes de formation et e-learning) : colonnes et tables à ajouter
-- à droits.colonnes_sensibles, en 'convention' (migration server/migrations-pg/0025_organismes_elearning.sql, commentaires
-- « Sensible ») : contacts des organismes (données personnelles de tiers) et tarifs négociés en entier, SIRET et adresse
-- (personnels pour un formateur indépendant), conditions commerciales et motif d'une fusion (textes libres du service RH),
-- avancement nominatif et motifs des inscriptions aux modules d'e-learning. Rien d'autre à partager : aucune vue pub_ demandée (pub_titres_detenus lit toujours
-- formations.organisme et certifications.organisme, tenus à jour par Cursus). Même forme que
-- docs/demandes/matrix-lot8-colonnes-sensibles.sql ; jamais exécuté sur le serveur commun par Cursus : la CI le rejoue sur
-- son socle d'essai (une fois appliqué, aucune colonne déclarée sensible ne reste lisible par matrix_lecture).
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot12-organismes.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'organisme_contacts', '*', 'Données personnelles de tiers : contacts des organismes de formation (table entière)', 'convention'),
  ('cursus', 'organisme_tarifs', '*', 'Données commerciales : tarifs négociés avec les organismes de formation (table entière)', 'convention'),
  ('cursus', 'organismes', 'siret', 'Identité d''un formateur indépendant (entreprise individuelle) : SIRET, donnée personnelle', 'convention'),
  ('cursus', 'organismes', 'adresse', 'Identité d''un formateur indépendant (entreprise individuelle) : adresse, donnée personnelle', 'convention'),
  ('cursus', 'organismes', 'conditions', 'Texte libre : conditions commerciales d''un organisme (service RH)', 'convention'),
  ('cursus', 'organismes', 'fusionne_motif', 'Texte libre : motif de la fusion d''un doublon (administrateur RH)', 'convention'),
  ('cursus', 'inscriptions_elearning', 'avancement', 'Avancement nominatif dans un module d''e-learning (jamais un moyen de contrôle de l''activité)', 'convention'),
  ('cursus', 'inscriptions_elearning', 'corrige_motif', 'Texte libre : motif d''une correction de l''inscription', 'convention'),
  ('cursus', 'inscriptions_elearning', 'annule_motif', 'Texte libre : motif de l''annulation d''une inscription saisie par erreur', 'convention')
ON CONFLICT (schema_nom, table_nom, colonne_nom) DO UPDATE SET origine = 'convention', motif = EXCLUDED.motif;
