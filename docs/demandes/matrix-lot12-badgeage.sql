-- Demande de Cursus à Matrix (lot 12, chantier C6, badgeage virtuel) : tables de Cursus à ajouter à
-- droits.colonnes_sensibles, en 'convention', avant l'activation du badgeage (réglage pointageActif). Elles sont déclarées
-- « Sensible » par la migration server/migrations-pg/0027_badgeage.sql : pointages bruts (heures d'arrivée et de départ
-- nominatives, moyen de contrôle de l'activité), demandes de correction (textes libres) et zones de la géolocalisation
-- (étape 3, option désactivée), en entier. Ni badges ni appareils : pas de badgeuse (réponse du propriétaire du
-- 1er novembre 2026). Aucune vue pub_ demandée. Même forme que docs/demandes/matrix-lot8-colonnes-sensibles.sql ; ce
-- fichier n'est jamais exécuté sur le serveur commun par Cursus, il attend la validation du propriétaire puis son report
-- dans infra/postgres/init/03-droits.sql de Matrix.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot12-badgeage.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('cursus', 'pointages', '*', 'Contrôle de l''activité : pointages bruts nominatifs (heures d''arrivée et de départ), table entière', 'convention'),
  ('cursus', 'corrections_pointage', '*', 'Contrôle de l''activité et texte libre : demandes de correction de pointage (commentaire, motif de refus), table entière', 'convention'),
  ('cursus', 'zones_pointage', '*', 'Géolocalisation au pointage : zones de contrôle (option désactivée), table entière', 'convention');
