# Demande à Keystone et à Matrix — coûts des notes de frais par projet (lot 11, chantier C5)

Demande rédigée par Cursus, **à valider par le propriétaire avant tout envoi** : rien n'est écrit dans les dépôts de
Keystone ni de Matrix, et aucune vue `pub_` n'est créée dans Cursus tant que la demande n'est pas validée.

## Besoin

Une note de frais peut être rattachée à une mission Keystone (`notes_frais.mission_id`), à un déplacement, ou à un code
de projet ou de chantier saisi (`notes_frais.projet`). Keystone pourrait en tirer le coût réel des déplacements par projet
pour son contrôle de coûts. Cursus ne lui envoie rien aujourd'hui (l'API sortante ne porte que les heures, absences et
décisions de déplacement).

## Proposition : vue future `pub_frais_projets` (Matrix), agrégats seulement

| Colonne | Contenu |
| --- | --- |
| `projet` | Code du projet ou du chantier Keystone (celui de la mission, sinon celui saisi sur la note) |
| `mois` | Mois des dépenses (AAAA-MM) |
| `nature` | Grande nature : repas, logement, transport, véhicule, autre (dépenses diverses) |
| `montant` | Montant retenu des notes contrôlées, en paiement ou payées, en euros, **hors notes médicales** |
| `notes` | Nombre de notes |

**Les notes médicales (`notes_frais.medicale`) sont exclues de la vue** : ni comptées dans « autre » ni dans le nombre
de notes. Un mois-projet où la seule dépense « autre » serait un vaccin publierait sinon, dans une vue `pub_`, un montant
tiré d'une donnée de santé d'un salarié reconnaissable par l'équipe du projet ; le seuil d'anonymat, qui ne porte que sur
le nombre de notes, ne l'empêcherait pas. Aucune donnée de santé n'entre dans une vue `pub_` (règle du lot 11).

Jamais de salarié, de commerçant, d'invité, de motif ni de montant d'une dépense ; seuil d'anonymat (un agrégat d'une ou
deux notes d'un mois révèle les frais d'une personne) à fixer avec le DPO, comme pour les indicateurs sociaux (k = 5) ;
`lignes_frais` reste fermée en entier à `matrix_lecture` (`docs/demandes/matrix-lot11-frais.sql`).

## Questions

- Keystone : préfère-t-il lire cette vue par Matrix, ou recevoir un événement agrégé par son connecteur (mensuel) ?
- Keystone : le code projet d'une mission (`missions.projet`) suffit-il, ou faut-il un code de chantier distinct ?
- Matrix : numéro de la migration de contrat et colonnes ajoutées en fin seulement, comme les autres vues `pub_`.
