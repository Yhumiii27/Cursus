# Échanges de Cursus avec les autres outils

Inventaire demandé par la décision M-17 de Matrix (demande M-17 de `REQUESTS.md`, 30 octobre 2026), relevé le
1er novembre 2026 sur le code (lot 12, socle), mis à jour le 2 novembre 2026 pour la décision M-18 (Matrix définit et
applique les vues `pub_` des outils, les liens et les droits d'écriture). Règles R2 à R5 : `docs/ARCHITECTURE.md`, « Échanges avec les autres
outils », et `docs/demandes/LISEZ-MOI.md`. À tenir à jour à chaque nouvel échange.

Bilan : **aucun accès non conforme côté Cursus**. Cursus ne lit aucune table d'un autre schéma, n'écrit dans aucun autre
schéma ; ses vues `pub_`, créées par ses migrations publiées, sont reprises puis gérées par Matrix (M-18), et aucune
migration nouvelle n'y touche (`tests/m18-publications.test.ts`). Deux points sont à signaler à Matrix (fin du document).

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

## 4. Vues `pub_` de Cursus et leurs lecteurs (R3, M-18)

Créées par les migrations publiées de Cursus (`WITH (security_barrier)`, aucune colonne sensible), jamais rejouées ;
**reprises par Matrix** à la bascule (`partage/14-reprise-publications.sql -v outils=cursus` : propriétaire
`matrix_gestion`, définition et contrat inscrits au registre `matrix.publications`), qui les fait évoluer ensuite.
Droits de lecture : liens du registre `matrix.liens`, appliqués par Matrix. Répétition du 2 novembre 2026 (socle et
partage de Matrix à jour, PostgreSQL 16) : les six vues passent à `matrix_gestion`, les lecteurs gardent leur droit,
Cursus redémarre sans erreur, `droits.verifier()` ne signale aucune erreur.

| Vue (contrat) | Migration | Lecteurs | Conformité |
| --- | --- | --- | --- |
| `pub_salaries` (D01) | `0002_partage.sql` (commentaire de contrat enrichi par `0018_indicateurs.sql`) | `keystone_app`, `codex_app`, `vigie_app`, `matrix_app` | Conforme |
| `pub_titres` (D08) | `0002_partage.sql` | `vigie_app`, `keystone_app`, `matrix_app` | Conforme |
| `pub_titres_detenus` (D09, avenant du lot 8) | `0002_partage.sql`, `0011_pub_titres_valides.sql` | `vigie_app`, `keystone_app`, `matrix_app` | Conforme |
| `pub_parametres` (D19) | `0002_partage.sql` | `vigie_app`, `matrix_app` | Conforme |
| `pub_journal` (D18) | `0002_partage.sql` | `matrix_app` (`matrix.journal_unifie`) | Conforme |
| `pub_absences` (CU-1, demande de Crucible) | `0004_pub_absences.sql` | `crucible_app`, `matrix_app` | Conforme (droit à poser par Matrix, demande CU-1) |

La copie qualifiée `infra/postgres-partage/20-cursus.sql` (et le `partage/20-cursus.sql` de Matrix) n'est plus jouée une
fois les vues reprises par Matrix (M-18) ; elle ne sert plus qu'au rejeu d'essai du socle. Toute évolution d'une vue se
demande à Matrix comme une publication. Les vues de
contrôle `*_v1` de Matrix (D06, D07) ne sont pas créées par Cursus. Le lot 12 ne crée aucune vue `pub_`.

## 5. Points à signaler à Matrix

- **Lecture des tables de Cursus par `matrix_lecture`** : ce rôle lit toutes les tables du schéma `cursus`, hors des
  colonnes de `droits.colonnes_sensibles` (catalogue et contrôles d'administration de Matrix), et non par des vues `pub_`.
  C'est un accès d'administration du serveur, décidé par Matrix, plutôt qu'un échange entre outils ; il reste à
  inscrire comme tel dans le registre `matrix.liens`. Les fermetures de colonnes demandées par Cursus (lots 8, 11 et 12,
  `docs/demandes/matrix-*.sql`) restent nécessaires tant qu'il existe.
- **Copie de partage** : `infra/postgres-partage/20-cursus.sql` date de la migration 0011 et n'est plus mise à jour
  (M-18 : Matrix reprend les vues). Matrix pourra retirer son `partage/20-cursus.sql` une fois les vues de Cursus
  reprises (fichier 14).
- **Publications demandées en attente** (à redéfinir comme publications de l'écran de Matrix, M-18) :
  `cursus.pub_indicateurs_rh` (`docs/demandes/matrix-lot11-indicateurs.md`) et `cursus.pub_frais_projets`
  (`docs/demandes/keystone-lot11-frais.md`) ; `matrix.pub_entites` (`docs/demandes/matrix-lot11-entites.md`) est une
  vue de Matrix.

Entrée à porter dans le `REQUESTS.md` de Matrix une fois ce document validé (rien n'est écrit dans Matrix) :

> **[2026-11-02] Cursus → Matrix — M-17 et M-18 appliquées par Cursus, vues à reprendre et liens à inscrire.** Cursus
> applique R2 à R5 et M-18 (`docs/ARCHITECTURE.md`, `docs/demandes/LISEZ-MOI.md`, inventaire `docs/ECHANGES.md`) : aucune
> lecture de table ni écriture dans un autre schéma ; plus aucune vue `pub_` dans ses migrations après `0029`
> (garde-fou en test) ; lectures de `matrix.pub_sites` et `pub_organigramme` encore saisies à la main. À la bascule de
> Cursus : `partage/14-reprise-publications.sql -v outils=cursus` (répété le 2 novembre 2026 sans erreur), puis
> `20-cursus.sql` n'est plus joué. Liens à
> inscrire dans `matrix.liens` (lecture) : `cursus.pub_salaries` → keystone, codex, vigie, matrix ; `cursus.pub_titres`
> et `cursus.pub_titres_detenus` → vigie, keystone, matrix ; `cursus.pub_parametres` → vigie, matrix ;
> `cursus.pub_journal` → matrix ; `cursus.pub_absences` → crucible, matrix. Accès de `matrix_lecture` aux tables de
> `cursus` à inscrire comme accès d'administration.
