# Demande de Cursus à Matrix — lot 12, chantier C3 (entretiens suivis et feedback 360°)

**Statut : proposition à valider par le propriétaire** (réponse du 1er novembre 2026 : rien n'est écrit dans un autre
dépôt ; les demandes sont rédigées dans `docs/demandes/`). Elle ne modifie ni le dépôt de Matrix ni le serveur commun.
En attendant, la CI de Cursus rejoue `matrix-lot12-entretiens.sql` sur son socle d'essai et signale, sans bloquer, toute
colonne sensible restée lisible par `matrix_lecture`.

Priorité : **avant la mise en service du 1er janvier 2027**, puisque les objectifs et les souhaits de formation se
saisissent dès la première campagne d'entretiens annuels. Aucune autre demande du chantier n'est urgente.

## 1. Fermer les colonnes et tables sensibles à `matrix_lecture`

- **Quoi** : ajouter à `droits.colonnes_sensibles` (origine `convention`) les lignes de
  `docs/demandes/matrix-lot12-entretiens.sql`, toutes commentées « Sensible » par la migration
  `server/migrations-pg/0024_entretiens_suivis.sql` :
  - `cursus.objectifs` : `libelle`, `mesure`, `evaluation`, `commentaire_sal`, `ajuste_motif`, `libelle_initial` (textes
    libres d'une évaluation professionnelle nominative ; les colonnes de structure — dates, statut, catégorie, poids,
    avancement — restent lisibles, comme le reste du schéma) ;
  - `cursus.entretiens` : `souhaits` (souhaits de formation, intitulés libres et avis du manager) et `synthese_feedback`
    (synthèse 360°, étape 3), comme `entretiens.cr` depuis le lot 8 ;
  - tables entières du feedback 360° (module désactivé jusqu'à l'avis du CSE) : `feedback_sollicitations` (répondants
    nommés), `feedback_tampon` (réponses en attente, chiffrées), `feedback_reponses` (réponses versées par lot).
- **Pourquoi** : sans ces lignes, le déclencheur `droits_ddl` du socle donne toute nouvelle colonne du schéma `cursus` à
  `matrix_lecture`. Les résultats d'une évaluation sont confidentiels (art. L1222-3) ; la confidentialité promise aux
  répondants du 360° ne tiendrait pas si leurs sollicitations étaient lisibles hors de Cursus.
- **Comment** : reporter les lignes dans `infra/postgres/init/03-droits.sql` de Matrix, bloc « Convention du
  15/10/2026 », sur le modèle de `matrix-lot8-colonnes-sensibles.sql`.

## 2. Aucun nouvel accès, aucune vue `pub_`

- Aucune vue `pub_` n'est créée ni modifiée par le chantier (règle R3 de M-17). Les objectifs, les souhaits et le 360°
  ne sont exposés ni à Keystone (API `docs/API-KEYSTONE.md`), ni à Vigie, ni à Codex.
- `pub_journal` (contrat D18 v1, inchangé) voit passer les nouveaux codes d'action — `objectif.ajouter`, `proposer`,
  `modifier`, `retirer`, `avancer`, `ajuster`, `evaluer`, `entretien.souhait`, `entretien.avisSouhait` —, avec la
  référence de l'objet et l'auteur, jamais le texte d'un objectif ni d'un souhait (le journal est en liste blanche,
  `server/src/journal.ts`). Rien à changer pour `matrix.journal_unifie`.
- Valeurs nouvelles sans effet sur un contrat : `plan_actions.origine = 'entretien'` (texte sans contrainte, lu par
  aucune vue `pub_`) et `demandes_collab.entretien_id` (colonne de lien, sans texte).

## 3. Pas d'archivage dans Codex

Choix par défaut du chantier : le compte rendu signé (PDF) reste dans Cursus ; aucune demande à Codex pour ce lot.
