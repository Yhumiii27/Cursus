# Demandes de Cursus à Matrix — lot 11, chantier C3 (indicateurs sociaux légaux et BDESE)

Rédigées par Cursus, **en attente de la validation du propriétaire** (réponse du 31 octobre 2026 : rien n'est écrit dans
un autre dépôt). Aucune ne modifie le dépôt de Matrix ni celui de Vigie ; chacune propose ce qu'il faudrait y reporter.
Ordre de priorité : la demande 1 avant la reprise de Lucca (1er janvier 2027) ; les demandes 2 et 3 plus tard, sur
décision.

## 1. Fermer les colonnes sensibles des indicateurs (prioritaire)

- **Quoi** : ajouter à `droits.colonnes_sensibles` (origine `convention`) les quatre colonnes posées par la migration
  `server/migrations-pg/0018_indicateurs.sql` de Cursus, toutes commentées « Sensible » :
  - `cursus.employes.sexe` et `cursus.employes.categorie` : visibles du service RH et de l'intéressé seulement ;
  - `cursus.indicateurs_arretes.donnees` : agrégats de l'arrêté annuel (absentéisme pour raison de santé, âges, sexe),
    masqués mais publiables seulement par une vue validée (demande 2) ;
  - `cursus.indicateurs_arretes.annule_motif` : texte libre du service RH.
- **Pourquoi** : sans ces lignes, le déclencheur `droits_ddl` du socle donne toute nouvelle colonne du schéma `cursus` à
  `matrix_lecture` ; le sexe nominatif serait alors lisible hors de Cursus, ce que la réponse de l'entreprise exclut
  (« visibles du RH et de l'intéressé seulement »).
- **Comment** : lignes prêtes dans `docs/demandes/matrix-lot11-indicateurs.sql` (modèle du lot 8), à reporter dans
  `infra/postgres/init/03-droits.sql` de Matrix, bloc « Convention du 15/10/2026 ». La CI de Cursus les rejoue sur son
  socle d'essai (`tests/colonnes-sensibles.ts`).
- **Contrat de `pub_salaries`** : son commentaire (0018) liste désormais `sexe` et `categorie` parmi les colonnes
  « Jamais » ; la vue n'est pas recréée et ne les lit pas. Rien à changer côté lecteurs (Keystone, Codex, Vigie, Matrix).

## 2. Vue future `pub_indicateurs_rh` pour la BI du groupe (à décider)

- **Quoi** : une vue `cursus.pub_indicateurs_rh` d'agrégats annuels **déjà masqués**, lue sur les arrêtés de Cursus (ou
  une table d'agrégats remplie par Cursus), jamais calculée en SQL : les règles (effectifs, absentéisme dans les jours
  ouvrés théoriques, seuil d'anonymat et masquage secondaire) restent dans `shared/rules/indicateurs-legaux.ts`.
- **Colonnes proposées** (contrat : ajout en fin seulement) : `annee` (integer), `perimetre` (text : `global`, puis
  `site_code` ou `unite_code` quand l'organigramme les remplit), `indicateur` (text : code stable, ex. `effectif_fin`,
  `taux_absenteisme`), `groupe` (text : `ensemble`, `sexe`, `categorie`, `statut`, `contrat`), `modalite` (text),
  `valeur` (numeric, NULL si masquée), `masquee` (boolean), `seuil` (integer), `regles` (text), `arrete_le` (date).
- **Jamais** : identifiant de salarié, nom, sexe ou âge individuel, nature d'absence par personne, l'équipe (non figée par
  l'arrêté), le motif d'une annulation. Seules les années arrêtées et non annulées sont publiées.
- **Lecteurs** : à désigner (`matrix_app` pour la BI ? direction du groupe ?) ; `GRANT SELECT` par Matrix.
- **En attendant** : l'export CSV au format long de l'écran Indicateurs sociaux (`GET /api/indicateurs/csv`, tracé au
  journal sans valeur) se dépose à la main dans la BI.
- **Préalable** : site et unité des salariés (`site_code`, `unite_code`), remplis par l'organigramme (chantier C1), pour un
  découpage par site.

## 3. Heures travaillées pour Vigie (TF1, TG) et accidents avec arrêt (à décider, hors du lot 11)

- **Heures travaillées** : Vigie calcule le taux de fréquence et le taux de gravité d'après des heures travaillées que
  Cursus détient (feuilles validées, relevés des intérimaires). Proposition : une vue `cursus.pub_heures_travaillees`
  (mois × site, total d'heures sans aucune personne : `mois`, `site_code`, `heures_salaries`, `heures_interimaires`,
  `maj_le`), lecteur `vigie_app`. Contrat à écrire avec Vigie (périmètre des heures : validées seulement, heures
  supplémentaires comprises, absences exclues).
- **Accidents avec arrêt** : la rubrique « conditions de travail » de la BDESE gagnerait le nombre d'accidents du travail
  avec arrêt et le taux de gravité, que Vigie détient (déclarations). Lecture par Cursus d'une vue `pub_` de Vigie, à
  demander à Vigie par Matrix ; d'ici là, l'écran les liste « hors de Cursus, source : Vigie ».

## Ce que Cursus fait déjà, sans rien demander

- Indicateurs calculés à la demande par le serveur de Cursus (droit « consultation »), hors de l'instantané, mémorisés par
  révision ; réponse en agrégats masqués seulement.
- Arrêtés annuels figés dans `cursus.indicateurs_arretes` (jamais supprimés, couverts par le cache incrémental).
- Aucune vue `pub_` nouvelle : aucune n'est créée sans demande validée.
