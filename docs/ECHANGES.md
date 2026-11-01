# Échanges de Cursus avec les autres outils

Inventaire demandé par la décision M-17 de Matrix (demande M-17 de `REQUESTS.md`, 30 octobre 2026), relevé le
1er novembre 2026 sur le code (lot 12, socle). Règles R2 à R5 : `docs/ARCHITECTURE.md`, « Échanges avec les autres
outils », et `docs/demandes/LISEZ-MOI.md`. À tenir à jour à chaque nouvel échange.

Bilan : **aucun accès non conforme côté Cursus**. Cursus ne lit aucune table d'un autre schéma, n'écrit dans aucun autre
schéma, et ses vues `pub_` sont définies par ses migrations. Deux points sont à signaler à Matrix (fin du document).

## 1. Lectures SQL vers d'autres schémas (R2)

| Objet lu | Par quoi | État | Conformité |
| --- | --- | --- | --- |
| `matrix.pub_sites` (D14, sites de rattachement) | Table locale `sites`, cache tenu à la main par le service RH (Référentiels → Entités et sites, lot 11) ; aucun accès SQL | Aucune requête vers le schéma `matrix` | Conforme ; une synchronisation automatique lira `matrix.pub_sites` (vue `pub_`) |
| `matrix.pub_organigramme` (D15, unités) | Code d'unité saisi à la main (`equipes.unite_code`, `employes.unite_code`) ; aucun accès SQL | Aucune requête vers le schéma `matrix` | Conforme ; même remarque |
| `matrix.pub_entites` (proposée, `docs/demandes/matrix-lot11-entites.md`) | Table locale `entites` en attendant | Demande à valider | Conforme : la proposition lit une vue `pub_` de Matrix |

Relevé : aucune requête du code (`server/src`) ne nomme un schéma `matrix`, `keystone`, `codex`, `vigie`, `crucible` ou
`arche` ; sur le serveur commun, le pool de Cursus travaille dans le schéma `cursus` (`search_path`).

## 2. Écritures chez un autre outil (R4)

| Échange | Moyen | Conformité |
| --- | --- | --- |
| Cursus → Keystone : décisions sur les demandes de déplacement, heures validées sur les projets, absences validées ou annulées (période seule), verdicts Go / No Go modifiés | API de Keystone `POST ${KEYSTONE_URL}/api/cursus/v1/evenements` (jeton, `Idempotency-Key`), par la file `envois` (`server/src/integrations/keystone.ts`, `server/src/envois.ts`) | Conforme (API) |
| Cursus → Matrix : déclaration du schéma de la base (catalogue `matrix.schema/1`) | API de Matrix `POST ${MATRIX_URL}/api/declarations` (`server/src/integrations/matrix.ts`), au démarrage, jamais bloquant | Conforme (API) |
| Cursus → Codex : pièces justificatives dans la GED | Adaptateur `server/src/integrations/ged.ts`, non raccordé (interface de Codex inconnue) ; aucune pièce envoyée | Conforme : le raccordement passera par l'API de Codex (`docs/demandes/codex-lot11-pieces.md`) |
| Cursus → Vigie, Crucible, Arche | Aucun envoi | — |

Hors du groupe (ni schéma ni outil EPC2I) : e-mails par Microsoft Graph, notifications push par les services des
navigateurs, connexion Microsoft Entra ID, fichier d'import de Sage Paie téléchargé par la paie.

## 3. Écritures d'un autre outil chez Cursus

| Échange | Moyen | Conformité |
| --- | --- | --- |
| Keystone → Cursus : projets, chantiers, affectations, tâches, demandes de déplacement ; lecture de l'instantané et des verdicts | API de Cursus `/api/integrations/keystone/v1` (`X-Api-Key`, filtre d'adresses facultatif ; `server/src/integrations/keystone-routes.ts`, contrat `docs/keystone-openapi.json`) | Conforme (API de Cursus) |
| Fonctions `pub_<verbe>_<objet>` de Cursus | Aucune | — |

## 4. Vues `pub_` de Cursus et leurs lecteurs (R3)

Toutes définies par les migrations de Cursus (`WITH (security_barrier)`, aucune colonne sensible) ; droits de lecture
accordés par Matrix (`partage/90-droits.sql`), futurs liens du registre `matrix.liens`.

| Vue (contrat) | Migration | Lecteurs | Conformité |
| --- | --- | --- | --- |
| `pub_salaries` (D01) | `0002_partage.sql` (commentaire de contrat enrichi par `0018_indicateurs.sql`) | `keystone_app`, `codex_app`, `vigie_app`, `matrix_app` | Conforme |
| `pub_titres` (D08) | `0002_partage.sql` | `vigie_app`, `keystone_app`, `matrix_app` | Conforme |
| `pub_titres_detenus` (D09, avenant du lot 8) | `0002_partage.sql`, `0011_pub_titres_valides.sql` | `vigie_app`, `keystone_app`, `matrix_app` | Conforme |
| `pub_parametres` (D19) | `0002_partage.sql` | `vigie_app`, `matrix_app` | Conforme |
| `pub_journal` (D18) | `0002_partage.sql` | `matrix_app` (`matrix.journal_unifie`) | Conforme |
| `pub_absences` (CU-1, demande de Crucible) | `0004_pub_absences.sql` | `crucible_app`, `matrix_app` | Conforme (droit à poser par Matrix, demande CU-1) |

La copie qualifiée `infra/postgres-partage/20-cursus.sql` (reprise par le `partage/20-cursus.sql` de Matrix) reste en
place pendant la transition (lots M17-1 à M17-5 de Matrix) ; aucune nouvelle copie n'est demandée (R3). Les vues de
contrôle `*_v1` de Matrix (D06, D07) ne sont pas créées par Cursus. Le lot 12 ne crée aucune vue `pub_`.

## 5. Points à signaler à Matrix

- **Lecture des tables de Cursus par `matrix_lecture`** : ce rôle lit toutes les tables du schéma `cursus`, hors des
  colonnes de `droits.colonnes_sensibles` (catalogue et contrôles d'administration de Matrix), et non par des vues `pub_`.
  C'est un accès d'administration du serveur, décidé par Matrix, plutôt qu'un échange entre outils ; il reste à
  inscrire comme tel dans le registre `matrix.liens`. Les fermetures de colonnes demandées par Cursus (lots 8, 11 et 12,
  `docs/demandes/matrix-*.sql`) restent nécessaires tant qu'il existe.
- **Copie de partage** : `infra/postgres-partage/20-cursus.sql` date de la migration 0011 ; elle ne doit plus être mise à
  jour par Cursus (R3). Matrix pourra la retirer de son dossier `partage/` à la fin de sa transition.

Entrée à porter dans le `REQUESTS.md` de Matrix une fois ce document validé (rien n'est écrit dans Matrix) :

> **[2026-11-01] Cursus → Matrix — M-17 appliquée par Cursus, deux points à inscrire au registre.** Cursus applique R2 à
> R5 (`docs/ARCHITECTURE.md`, `docs/demandes/LISEZ-MOI.md`, inventaire `docs/ECHANGES.md`) : aucune lecture de table ni
> écriture dans un autre schéma ; lectures de `matrix.pub_sites` et `pub_organigramme` encore saisies à la main. Liens à
> inscrire dans `matrix.liens` (lecture) : `cursus.pub_salaries` → keystone, codex, vigie, matrix ; `cursus.pub_titres`
> et `cursus.pub_titres_detenus` → vigie, keystone, matrix ; `cursus.pub_parametres` → vigie, matrix ;
> `cursus.pub_journal` → matrix ; `cursus.pub_absences` → crucible, matrix. Accès de `matrix_lecture` aux tables de
> `cursus` à inscrire comme accès d'administration.
