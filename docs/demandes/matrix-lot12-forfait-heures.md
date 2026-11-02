# Demande à Matrix — lot 12, chantier C1 : clôture du forfait annuel en heures

**Statut : proposition à valider par le propriétaire** (1er novembre 2026). Rien n'est écrit dans le dépôt de Matrix depuis
Cursus ; une fois validée, la demande se porte dans le `REQUESTS.md` de Matrix.

## Besoin

Le lot 12 ajoute au schéma `cursus` la table `clotures_forfait_heures` (migration `server/migrations-pg/0022_forfait_heures.sql`)
et la colonne `lots_paie.forfait_heures` : une ligne par plage clôturée d'un salarié au forfait annuel en heures, avec la
photographie en heures (forfait, cible, total des absences déduites, réalisé, heures à payer par rubrique HFA25, HFA50,
HCA10, HCA25, heures non réalisées), le lot de paie et, pour la réouverture et l'annulation, un motif libre du service RH.

Ces colonnes sont des éléments de paie nominatifs ; le total des heures d'absence déduites peut laisser deviner un arrêt de
travail ; les motifs sont des textes libres. Cursus les réserve, dans l'application, au service RH, à la paie et au
salarié (le manager ne les reçoit pas). Elles doivent donc être fermées à `matrix_lecture`, comme celles du lot 8.

## Ce qui est demandé

1. **Fermer à `matrix_lecture`** les colonnes de `docs/demandes/matrix-lot12-forfait-heures.sql` (ajout à
   `droits.colonnes_sensibles`, origine `convention`) : `absences`, `cible`, `realise`, `hfa25`, `hfa50`, `hca10`, `hca25`,
   `non_realise`, `rouverte_motif`, `annulee_motif`. La migration 0022 les marque déjà « Sensible » (commentaire lu par
   `scripts/colonnes-sensibles-pg.sql`) ; la CI de Cursus signale toute colonne marquée encore lisible.
2. Rien d'autre : `lots_paie.forfait_heures` ne porte que des identifiants (ligne, salarié) ; les quantités sont dans
   `lots_paie.contenu`, déjà fermée (demande du lot 8).

## Conformité aux règles M-17 (`docs/demandes/LISEZ-MOI.md`)

- **Aucune vue `pub_`** nouvelle ni modifiée : Keystone, Vigie, Codex et Crucible ne lisent rien de la clôture. Aucune colonne
  de la table n'entre dans une vue `pub_` existante.
- **Aucun lien** du registre `matrix.liens` : aucun outil ne lit ni n'écrit ces données.
- **Aucune écriture** chez un autre outil.
- Le journal des actions (`journal`, lu par `pub_journal`) ne garde de la clôture que des identifiants, la plage, la version
  et le statut : ni heure, ni taux, ni montant, ni motif.

## Entrée proposée pour le `REQUESTS.md` de Matrix

> **Cursus, lot 12 (C1)** — Ajouter à `droits.colonnes_sensibles` les dix colonnes de `cursus.clotures_forfait_heures`
> listées dans `docs/demandes/matrix-lot12-forfait-heures.sql` du dépôt Cursus (quantités d'heures nominatives, total des
> absences déduites, motifs libres), origine `convention`. Aucune vue ni lien nouveau. À appliquer avant la première
> clôture d'un salarié au forfait annuel en heures en production (première sortie ou premier avenant de 2027 ; clôture
> annuelle en janvier 2028).
