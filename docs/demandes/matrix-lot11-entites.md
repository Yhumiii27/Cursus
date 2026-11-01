# Demande de Cursus à Matrix : référentiel des entités juridiques (lot 11, chantier C1)

**Statut : proposition, à valider par le propriétaire avant tout envoi.** Rien n'est écrit dans le dépôt de Matrix. Cette
demande décrit un contrat de vue nouveau ; elle s'ajoute aux demandes de fermeture de colonnes du lot 11
(`docs/demandes/matrix-lot11-*.sql`).

## Le besoin

Cursus a maintenant une structure société > établissement > équipes (organigramme, t195). Aucun outil du groupe ne
connaît la société ni l'établissement : Matrix tient les sites (D14, `matrix.sites`, vue `pub_sites`) et l'organigramme
département > service > équipe (D15, `matrix.organigramme`, vue `pub_organigramme`), mais pas l'employeur juridique.

Or plusieurs obligations en dépendent :

| Besoin | Niveau | Outil |
| --- | --- | --- |
| DSN, registre unique du personnel | établissement (SIRET) | Cursus, Sage Paie |
| Dossier de paie | société (un dossier Sage par société) | Sage Paie |
| OPCO (dossiers de prise en charge) | société (IDCC de la branche ; Industries chimiques : 0044, OPCO 2i à confirmer) et établissement employeur (SIRET) | Cursus |
| BDESE, effectifs, seuils (CSE…) | entreprise, et établissement s'il y a un CSE d'établissement | Cursus |
| Notes de frais (société qui rembourse, export comptable par dossier) | société | Cursus |
| En-tête des documents | société | Codex, Cursus |

En attendant, Cursus garde une table locale `cursus.entites` (colonne `source = 'local'`), tenue par le service RH
(Référentiels → Entités et sites). Pour ne pas recréer le doublon que D15 a supprimé, Cursus propose que Matrix devienne
la source, et que `cursus.entites` en soit une copie (`source = 'matrix'` : non modifiable dans Cursus), sur le modèle
de `cursus.equipes` et de D15.

## Le contrat proposé : `pub_entites`

Une ligne par entité, sociétés et établissements, fermées comprises (jamais supprimées).

| Colonne | Type | Contenu |
| --- | --- | --- |
| `code` | text, clé | code stable, jamais modifié, au format des codes de site de Matrix : `^[a-z][a-z0-9_]{1,31}$` |
| `nom` | text | raison sociale (société) ou nom de l'établissement |
| `type` | text | `societe` ou `etablissement` |
| `parente` | text, nullable | code de la société d'un établissement ; null pour une société |
| `siren` | text, nullable | 9 chiffres (société seulement), clé de Luhn |
| `siret` | text, nullable | 14 chiffres (établissement ; siège pour une société), commençant par le SIREN de la société, clé de Luhn (règle de l'INSEE propre à La Poste admise) |
| `idcc` | text, nullable | identifiant de la convention collective, 4 chiffres (société) |
| `site_code` | text, nullable | site de rattachement (`pub_sites.code`) |
| `actif` | boolean | ouverte ou fermée |
| `ferme_le` | date, nullable | date de fermeture |

Contrôles souhaités côté Matrix (ceux que Cursus applique déjà, `shared/rules/entites.ts`) : deux niveaux seulement (un
établissement a une société parente ouverte, une société n'en a pas), unicité du SIREN parmi les sociétés et du SIRET
parmi toutes les entités, pas de fermeture d'une société qui a des établissements ouverts.

Ces données sont publiques (répertoire SIRENE) et non personnelles : la vue peut être lue par tous les rôles `*_app`.

## Ce que Cursus fera ensuite (rien avant la validation)

1. Copie de `pub_entites` dans `cursus.entites` (`source = 'matrix'`) par une tâche de synchronisation, comme `sites`
   depuis `pub_sites` ; les entités `local` déjà saisies sont rapprochées par leur SIRET ou leur SIREN, sans changer
   leur code s'il est le même.
2. Une entité tenue par Matrix ne se modifie plus dans Cursus (déjà refusé par `entite.modifier`, `entite.fermer`,
   `entite.rouvrir`).
3. Le rattachement des équipes racines à une entité reste dans Cursus (`cursus.equipes.entite`) tant que l'organigramme
   réel n'est pas fourni (C-09 de Matrix, O-04 de Codex) ; il pourra ensuite passer dans `matrix.organigramme`.

## Ce que Cursus publie déjà, sans nouvelle vue

Depuis l'étape 2 du chantier, `cursus.employes.site_code` et `unite_code` sont remplis : ils sont tirés de l'équipe du
salarié (site de l'équipe, d'une équipe au-dessus ou de l'entité ; unité de l'équipe ou d'une équipe au-dessus, code de
`pub_organigramme` saisi à la main par le service RH), recalculés à chaque affectation. `pub_salaries` (0002_partage.sql)
cesse donc de les publier vides : Keystone (`persons.department_id`) et Codex (département) peuvent s'en servir.
Aucune colonne de `pub_salaries` ne change. `cursus.entites` et `cursus.sites` ne portent aucune donnée personnelle ni
sensible : aucune fermeture de colonne n'est demandée pour elles.

## Questions pour Matrix

- Matrix accepte-t-il de tenir l'entité juridique (sinon : Cursus reste la source et publierait `pub_entites` lui-même,
  ce qui demande une décision du propriétaire) ?
- Faut-il un troisième niveau (filiale par pays) ? Choix par défaut de Cursus : non, plus tard.
- Faut-il porter l'employeur au niveau du salarié (mise à disposition, groupe) ? Choix par défaut : l'équipe racine porte
  l'entité, un champ employeur sur le salarié est prévu plus tard s'il y a plusieurs sociétés.
