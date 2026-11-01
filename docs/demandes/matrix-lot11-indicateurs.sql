-- Demande de Cursus à Matrix (lot 11, chantier C3, indicateurs légaux et BDESE) : colonnes de Cursus à ajouter à
-- droits.colonnes_sensibles, en 'convention', sur le modèle de matrix-lot8-colonnes-sensibles.sql. Colonnes ajoutées par
-- la migration server/migrations-pg/0018_indicateurs.sql, commentées « Sensible » : sans cette ligne, le déclencheur
-- droits_ddl du socle les donnerait à matrix_lecture. Ce fichier n'est jamais exécuté sur le serveur commun par Cursus :
-- il propose les lignes à reporter dans infra/postgres/init/03-droits.sql de Matrix (bloc « Convention du 15/10/2026 »),
-- et la CI de Cursus le rejoue sur son socle d'essai. Le reste de la demande (vue future pub_indicateurs_rh, heures
-- travaillées pour Vigie) est écrit à l'étape 2 du chantier, sans rien écrire dans le dépôt de Matrix.
--   psql -d epc2i -v ON_ERROR_STOP=1 -1 -f docs/demandes/matrix-lot11-indicateurs.sql   (superutilisateur)
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  -- Données de la fiche réservées au service RH et à l'intéressé (index d'égalité, BDESE) ; jamais dans une vue pub_.
  ('cursus', 'employes', 'sexe', 'Vie personnelle : sexe du salarié (indicateurs agrégés seulement)', 'convention'),
  ('cursus', 'employes', 'categorie', 'Vie professionnelle : catégorie d''emploi du salarié (indicateurs agrégés seulement)', 'convention'),
  -- Arrêtés annuels de la BDESE : agrégats de l'effectif (absentéisme, âges, sexe), masqués mais à ne publier que par une
  -- vue pub_indicateurs_rh validée ; motif d'annulation (texte libre du service RH).
  ('cursus', 'indicateurs_arretes', 'donnees', 'Santé (agrégats) : indicateurs sociaux masqués de l''arrêté annuel', 'convention'),
  ('cursus', 'indicateurs_arretes', 'annule_motif', 'Texte libre : motif d''annulation d''un arrêté', 'convention')
ON CONFLICT (schema_nom, table_nom, colonne_nom) DO UPDATE SET origine = 'convention', motif = EXCLUDED.motif;
