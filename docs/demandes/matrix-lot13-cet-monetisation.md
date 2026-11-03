# Demande à Matrix — lot 13 : monétisation du compte épargne-temps

**Statut : proposition à valider par le propriétaire** (3 novembre 2026). Rien n'est écrit dans le dépôt de Matrix depuis
Cursus ; une fois validée, la demande se porte dans le `REQUESTS.md` de Matrix.

## Besoin

Le lot 13 ajoute au schéma `cursus` la table `monetisations_cet` (migration `server/migrations-pg/0030_cet_monetisation.sql`)
et la colonne `lots_paie.monetisations_cet` : une ligne par demande de monétisation de jours du compte épargne-temps
(salarié, jours, état, décision du service RH, période de paie, lot de paie qui emporte les jours sous la rubrique CET_MON)
et, pour un refus ou une annulation, un motif libre.

Les jours monétisés sont un élément de paie nominatif ; le motif est un texte libre. Cursus les réserve, dans
l'application, au service RH, à la paie et au salarié (le manager ne reçoit que les jours et l'état, pour le solde du CET
de son équipe ; jamais le motif). Ces deux colonnes doivent donc être fermées à `matrix_lecture`, comme celles du lot 8.

## Ce qui est demandé

1. **Fermer à `matrix_lecture`** les colonnes de `docs/demandes/matrix-lot13-cet-monetisation.sql` (ajout à
   `droits.colonnes_sensibles`, origine `convention`) : `jours`, `motif`. La migration 0030 les marque déjà « Sensible »
   (commentaire lu par `scripts/colonnes-sensibles-pg.sql`).
2. Rien d'autre : `lots_paie.monetisations_cet` ne porte que des identifiants (demande, salarié) ; les quantités sont dans
   `lots_paie.contenu`, déjà fermée (demande du lot 8).

## Conformité aux règles M-17 et M-18 (`docs/demandes/LISEZ-MOI.md`)

- **Aucune vue `pub_`** nouvelle ni modifiée (M-18 : la migration 0030 n'en touche aucune, `tests/m18-publications.test.ts`).
  Aucune colonne de la table n'entre dans une vue `pub_` existante.
- **Aucun lien** du registre `matrix.liens` : aucun outil ne lit ni n'écrit ces données.
- **Aucune écriture** chez un autre outil.
- Le journal des actions (`journal`, lu par `pub_journal`) garde de la demande le salarié, les jours demandés, l'identifiant,
  le statut et la période de paie : jamais le texte d'un motif.

## Entrée proposée pour le `REQUESTS.md` de Matrix

> **Cursus, lot 13** — Ajouter à `droits.colonnes_sensibles` les colonnes `jours` et `motif` de `cursus.monetisations_cet`
> listées dans `docs/demandes/matrix-lot13-cet-monetisation.sql` du dépôt Cursus (jours du CET payés à un salarié, motif
> libre d'un refus ou d'une annulation), origine `convention`. Aucune vue ni lien nouveau. À appliquer avant l'ouverture de
> la monétisation en production (réglage fermé par défaut, ouvert seulement avec la référence de l'accord sur le CET).
