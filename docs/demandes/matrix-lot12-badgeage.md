# Demande à Matrix — badgeage virtuel (lot 12, chantier C6)

**Statut** : proposition à valider par le propriétaire ; rien n'est écrit dans le dépôt de Matrix. En attendant, Cursus
déclare ses tables « Sensible » dans sa migration (`server/migrations-pg/0027_badgeage.sql`) et ne publie aucune vue.

## Besoin

Le badgeage enregistre les heures d'arrivée et de départ nominatives des salariés des populations désignées par l'accord
d'entreprise (moyen de contrôle de l'activité, art. L2312-38). Ces données ne servent qu'au décompte du temps dans Cursus :
aucun autre outil du groupe n'en a l'usage, et Matrix ne doit pas les lire.

## Ce qui est demandé

1. **Fermer à `matrix_lecture`**, en entier, les tables de `docs/demandes/matrix-lot12-badgeage.sql` (à reporter dans
   `infra/postgres/init/03-droits.sql` de Matrix) :
   - `cursus.pointages` (pointages bruts : instants, sens, origine, heure de l'appareil d'un pointage différé) ;
   - `cursus.corrections_pointage` (demandes de correction : commentaire libre, motif d'un refus) ;
   - `cursus.zones_pointage` (zones de la géolocalisation, étape 3, option désactivée).
   Ni `badges` ni `appareils_pointage` : pas de badgeuse (réponse du propriétaire du 1er novembre 2026), aucune table.
2. **Aucune vue `pub_`** sur le badgeage. Les heures validées restent publiées comme aujourd'hui (feuille de temps).
3. **Colonnes ajoutées à des tables déjà lues par Matrix** (étape 2), sans donnée sensible : `feuilles.mode_temps`
   (déclaratif, contrôlé, calculé), `feuilles.pointe_fige` (heures pointées par jour, figées sur une feuille au mode
   calculé : même nature que les heures de la feuille), `horaires.variable`, `plages`, `duree_reference`,
   `report_max_semaine`, `cumul_max`, `accord_variable` (référence d'un accord collectif). Rien à fermer de plus.

## Hors du périmètre

- Liste des présents pour l'évacuation (site chimique) : finalité distincte, non retenue au lot 12 ; à étudier avec Vigie
  si elle est demandée (registre et CSE à part).
- `pub_sites` sans coordonnées : les zones de la géolocalisation (étape 3) restent tenues dans Cursus ; aucune colonne
  demandée à Matrix tant que l'option n'est pas activée.
