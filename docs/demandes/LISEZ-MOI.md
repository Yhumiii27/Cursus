# Demandes de Cursus aux autres outils

Ce dossier rassemble les demandes que Cursus adresse aux autres outils du groupe (Matrix, Keystone, Codex, Vigie,
Crucible, Arche). Chacune est **rédigée ici et attend la validation du propriétaire** : rien n'est jamais écrit dans le
dépôt d'un autre outil depuis Cursus. Une fois validée, le propriétaire la porte dans le `REQUESTS.md` de l'outil
concerné, qui la réalise chez lui.

## Règles des échanges entre outils (décision M-17 de Matrix, 30 octobre 2026)

Matrix décide de chaque accès d'un outil aux données d'un autre ; PostgreSQL l'applique. Toute demande de ce dossier les
respecte (détail : `docs/ARCHITECTURE.md`, « Échanges avec les autres outils » ; inventaire : `docs/ECHANGES.md`).

1. **R2 — Lire** les données d'un autre outil seulement par ses vues `pub_`, jamais par ses tables. Une donnée qui manque
   se demande à son propriétaire : colonne ajoutée en fin de vue, ou nouvelle vue.
2. **R4 — Écrire** chez un autre outil seulement par son API, ou par une fonction `pub_` qu'il fournit ; jamais
   d'`INSERT`, d'`UPDATE` ni de `DELETE` dans son schéma.
3. **R3 — Ne plus demander à Matrix de recopier une vue** : la migration de Cursus (`server/migrations-pg/`) est la seule
   définition de ses vues `pub_`. Une vue `pub_` est un contrat : aucune colonne retirée ni renommée (sinon une vue
   `_v2`), ajouts en fin de liste seulement, jamais une colonne sensible (santé, motifs, textes libres) ; aucune vue
   nouvelle sans demande validée.
4. **R5 — Déclarer un besoin d'accès** comme un lien du registre `matrix.liens` : lecteur (rôle de l'outil), objet
   (`schéma.pub_…`), nature (`lecture` ou `execution`) et justification. En attendant l'API `POST /api/liens` de Matrix
   (lot M17-4) : une entrée courte pour le `REQUESTS.md` de Matrix, rédigée dans ce dossier, jamais écrite dans Matrix.
5. **Écriture qu'un autre outil ferait chez Cursus** : une API de Cursus, ou une fonction `pub_<verbe>_<objet>` créée par
   une migration de Cursus — `SECURITY DEFINER`, `SET search_path = cursus, pg_temp`, appelant identifié par
   `session_user`, règles métier et journal de Cursus appliqués, `REVOKE EXECUTE … FROM PUBLIC` ; le droit d'exécution
   est un lien de nature `execution`, accordé par Matrix.

Les fermetures de colonnes sensibles à `matrix_lecture` (`droits.colonnes_sensibles`, fichiers `matrix-*.sql`) restent
demandées comme avant : elles ne copient aucune vue et ne donnent aucun accès.

## Forme d'une demande

- Fichier `<outil>-lot<n>-<objet>.md` (besoin, contrat proposé, conformité aux règles ci-dessus), ou `.sql` pour une
  liste de colonnes sensibles à fermer (jamais exécuté sur le serveur commun par Cursus).
- En tête : **statut** (proposition à valider, validée le…, portée le…), ce qui reste écrit côté Cursus en attendant.
- Pour un accès entre outils, l'entrée prête à porter dans le `REQUESTS.md` de Matrix (lien du registre `matrix.liens`).

## Demandes en cours

| Fichier | Outil | Objet | Statut |
| --- | --- | --- | --- |
| `matrix-lot8-colonnes-sensibles.sql` | Matrix | Colonnes et tables sensibles du lot 8 à fermer à `matrix_lecture` | À valider (`docs/DEMANDES-LOT8-DONNEES.md`) |
| `matrix-lot11-entites.md` | Matrix | Référentiel des entités juridiques (`pub_entites` chez Matrix, lu par Cursus) | À valider |
| `matrix-lot11-frais.sql`, `matrix-lot11-indicateurs.sql`, `matrix-lot11-opco.sql`, `matrix-lot11-pwa.sql`, `matrix-lot11-indicateurs.md` | Matrix | Colonnes sensibles du lot 11 | À valider |
| `keystone-lot11-frais.md` | Keystone, Matrix | Coûts des notes de frais par projet | À valider |
| `codex-lot11-pieces.md` | Codex | Types de documents des pièces du lot 11 | À valider |
| `matrix-lot12-forfait-heures.sql` | Matrix | Colonnes sensibles de la clôture du forfait annuel en heures (lot 12, C1) | À valider |
| `matrix-lot12-entretiens.sql` | Matrix | Colonnes et tables sensibles des entretiens suivis et du feedback 360° (lot 12, C3) | À valider |
| `matrix-lot12-organismes.sql` | Matrix | Lot 12, C4 : contacts et tarifs des organismes de formation (tables entières), conditions, motif d'une fusion, avancement et motifs des inscriptions e-learning, à fermer à `matrix_lecture` | À valider |
