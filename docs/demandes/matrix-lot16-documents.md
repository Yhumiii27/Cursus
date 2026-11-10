# Demande à Matrix — documents de Cursus stockés dans Codex (lot 16)

**Statut : validée par le propriétaire et portée le 10 novembre 2026** dans le `REQUESTS.md` de Matrix (PR Matrix#87),
ouverte.

## Contexte

Décision du propriétaire du 10 novembre 2026 : tous les documents de la suite sont stockés dans Codex. Cursus y déposera
ses pièces justificatives (demande à Codex : `codex-lot16-documents.md`, catégories, dépôt sans circuit, lecture et
destruction par l'application).

**Catégories** : Matrix ne tient aucun référentiel des types de documents ; le registre est celui de Codex, publié dans
`codex.pub_types_document`. Les catégories manquantes se créent donc dans Codex (demande ci-dessus), pas dans Matrix.

## Liens demandés (registre `matrix.liens`)

| Lecteur | Objet | Nature | Justification |
| --- | --- | --- | --- |
| `cursus_app` | `codex.pub_types_document` | lecture | Vérifier, avant d'activer le stockage dans Codex, que chaque catégorie de pièce de Cursus existe dans le registre (contrôle de démarrage, écran Paramètres → Pièces justificatives). |
| `cursus_app` | `codex.pub_documents` | lecture | Suivre l'état des documents déposés par Cursus (gel juridique, archivage) pour refuser un retrait que Codex refuserait ; les documents « Très confidentiel » n'y figurent pas, Cursus n'en lit que l'identifiant et l'état. |
| `codex_app` | `cursus.pub_salaries` | lecture | Déjà inscrit (D01) : Codex y lit le départ d'un salarié, qui déclenche la conservation des pièces de son dossier. |

Aucune colonne sensible nouvelle, aucune publication de Cursus nouvelle.
