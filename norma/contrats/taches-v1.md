# Contrat commun « tâches et approbations » v1 (Norma 2.4)

Décision du propriétaire du 27 novembre 2026 : dans chaque outil, « Mes tâches » et « Mes approbations » montrent
**toutes** les tâches et **toutes** les approbations de la personne, même quand elles viennent d'un autre outil
(TA-16) ; réponses TA-1 à TA-14 confirmées le même jour (`propositions/TACHES-ET-APPROBATIONS.md` § 7). Ce contrat fixe ce
que chaque outil publie, ce que Matrix réunit, et comment un outil consulte et décide une tâche d'un autre outil.

Il s'ajoute aux règles d'échange (`REGLES.md` § 5) : lecture par les vues `pub_` définies par Matrix (M-18), écriture par
l'API de l'outil propriétaire, droits relus dans `clavis.pub_acces`.

## 1. Principe

```
 outil A (propriétaire)                Matrix                                outil B (où la personne travaille)
 taches_publiees (projection) ──► A.pub_taches ─┐
 outil C ……………………………………………… ► C.pub_taches ─┼─► matrix.pub_taches ──► « Mes tâches », « Mes approbations »,
                                                └─► matrix.pub_taches_sources     pastilles du tronc commun
                                                                                  │
   GET  /api/v1/taches/{tache_id}           ◄── fiche (phase 2, jeton Clavis) ────┤
   POST /api/v1/taches/{tache_id}/decision  ◄── décision (phase 2, jeton Clavis) ─┘
   lien profond `lien` (phase 1)            ◄── « Ouvrir dans A »
```

- **Source de vérité** : l'outil propriétaire. `pub_taches` est une publication recalculée, jamais relue pour décider.
- **Projection** (TA-3) : chaque outil tient une table `taches_publiees` réécrite par ses propres règles de routage
  (fournisseurs de Keystone, `approvalsOf` d'Arche, `decisionQueue` de Crucible, `computePersonTodo` de Vigie…), dans la
  transaction de chaque écriture qui ouvre, ferme ou réaffecte une tâche, et par une tâche planifiée toutes les 15 minutes
  pour les échéances. La vue `<outil>.pub_taches` lit cette table ; sa **requête de référence** est tenue dans le dépôt de
  l'outil (comme Clavis `src/server/publications/definitions.ts`) et appliquée par Matrix.
- Contenu : les tâches et approbations **ouvertes**, plus celles fermées depuis moins de 30 jours (« décidé cette
  semaine »), puis retirées (l'historique reste dans le journal de l'outil).

## 2. Colonnes de `<outil>.pub_taches`

Une ligne par tâche ou approbation **et par personne destinataire**. Ordre fixe ; une colonne publiée ne se retire ni ne se
renomme, un ajout va en fin, un changement incompatible est une vue `pub_taches_v2`.

| Colonne | Type | Contenu |
| --- | --- | --- |
| `outil` | text | code du registre (`registre/outils.json`) |
| `tache_id` | text | identifiant stable dans l'outil, unique avec `outil` (`po:PO-1082`, `step:G2-CPX-ALG-007-3`) |
| `nature` | text | `tache` (à faire, échéance) · `approbation` (décision attendue) |
| `type` | text | code propre à l'outil (`po`, `step`, `absence`…), stable |
| `type_libelle` | text | libellé français du type (« Commande d'achat ») |
| `type_libelle_en` | text | libellé anglais du type, sinon nul |
| `objet_ref` | text | référence affichée de l'objet (« PO-1082 », « CPX-ALG-007 »), sinon nulle |
| `titre` | text | titre **neutre** (§ 3) |
| `personne_id` | uuid | destinataire : identifiant Clavis (`sub` = `oid`) |
| `pour_le_compte_de` | uuid | titulaire remplacé (délégation, absence), sinon nul |
| `etat` | text | `a_faire` · `en_cours` · `en_attente` · `faite` · `annulee` (les quatre premiers sont les colonnes du tableau kanban) |
| `resultat` | text | approbation décidée : `approuvee` · `refusee` ; sinon nul (seulement avec `etat = faite`) |
| `echeance` | date | échéance, sinon nulle (le retard se calcule à la lecture, jamais stocké) |
| `priorite` | text | `normale` · `haute` |
| `actions` | text[] | actions ouvertes par l'outil propriétaire : `ouvrir`, `commenter`, `approuver`, `refuser` (approbations) ; `demarrer` (→ en cours), `suspendre` (→ en attente), `reprendre` (→ en cours), `terminer` (→ faite) (tâches) |
| `decision_a_distance` | boolean | vrai : la décision ou la transition peut être faite depuis un autre outil (phase 2) ; faux pour les types exclus (§ 3) |
| `sensible` | boolean | vrai : hors de l'outil propriétaire, seul `type_libelle` s'affiche ; jamais décidée à distance |
| `projet` | text | code de projet Keystone, sinon nul |
| `site` | text | code de site Matrix, sinon nul |
| `filiale` | text | code de filiale Matrix, sinon nul |
| `lien` | text | **lien profond absolu** vers la tâche dans l'outil propriétaire |
| `version` | text | version de l'objet (`row_version`, étape attendue, numéro du journal) : une décision périmée est refusée |
| `cree_le` | timestamptz | création de la tâche |
| `maj_le` | timestamptz | dernière modification de la ligne |

Contraintes (dans la table de projection, Norma § 4) : domaines de `nature`, `etat`, `resultat`, `priorite` et de chaque
élément d'`actions` ; `resultat` seulement pour une approbation faite ; `lien` commence par `https://` (ou `http://` en
local) ; `sensible` exclut `decision_a_distance`. Contrôle commun : `rowProblems` de `charte/ds/task-rules.ts`, à jouer
dans les tests de la requête de référence de l'outil.

## 3. Règles de contenu (TA-9, TA-10)

- **Titre neutre** : jamais une donnée de santé, la nature d'une absence, un montant de paie, une note d'entretien, le titre
  d'un document confidentiel. Le nom d'une personne de l'annuaire interne est permis (avis RGPD de Cursus, TA-10).
- `sensible = true` : la ligne est comptée et listée ailleurs sous son seul `type_libelle` (« Demande d'absence »), avec
  « Ouvrir dans <outil> ».
- `decision_a_distance = false` (consultation et lien profond seulement, bouton « Ouvrir dans <outil> ») : signature
  électronique avancée (G2 / AFE d'Arche par Yousign) ; signatures et constats de terrain de Vigie (émargement d'une
  causerie, délivrance d'un permis, vérification d'une consignation, signature d'un plan de prévention, avis du registre
  des dangers graves et imminents) ; toute tâche portant une donnée de santé ; arbitrages à options et scénarios de
  Crucible ; émargement d'un compte rendu d'entretien de Cursus.
- Une tâche n'est comptée qu'une fois (clé `outil` + `tache_id`, `dedupe`) où qu'on la regarde.

## 4. `matrix.pub_taches` et `matrix.pub_taches_sources` (Matrix, TA-1)

- `matrix.pub_taches` : **réunion** (`UNION ALL`) des `<outil>.pub_taches` lisibles et conformes au contrat (mêmes colonnes,
  même ordre), sur le modèle de `matrix.journal_unifie` : une vue absente ou hors contrat est laissée de côté et la
  réunion reconstruite sans elle (rejouable). Chaque outil reçoit **un** lien `lecture matrix.pub_taches`.
- `matrix.pub_taches_sources` : une ligne par outil du registre — `outil`, `etat` (`ok` · `absente` · `hors_contrat` ·
  `illisible`), `verifie_le`, `message` — pour que chaque outil affiche « <outil> : source indisponible ».
- Lecture par l'outil : filtrée par `personne_id` de la personne connectée (et `pour_le_compte_de` pour ses suppléances),
  cache d'une minute au plus ; la vue elle-même ne sait pas qui regarde (`session_user` = rôle de l'outil) : d'où § 3.
- Tant que Matrix n'a pas appliqué la réunion, un outil montre ses seules tâches et le bandeau « source indisponible » pour
  les autres.

## 5. Identité de la personne d'un outil à l'autre (Clavis, TA-4 — prérequis de la phase 2)

Échange de jeton **RFC 8693** chez Clavis :

1. à la connexion, Clavis rend aussi un **jeton de rafraîchissement** (durée de la session Clavis, 12 h ; révoqué à la
   déconnexion, au départ de la personne, au retrait de l'accès) ;
2. l'outil A, authentifié par son secret client, échange ce jeton (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`)
   contre un **jeton d'accès JWT pour l'outil B** : `aud` = B, `sub` = `oid` = `personne_id`, `act.sub` = A,
   `scope` = `taches:lire` ou `taches:decider`, durée 5 minutes ;
3. Clavis tient le registre « A peut demander un jeton pour B » (par défaut : tout outil de la suite pour tout autre,
   portées `taches:*` seulement) et journalise chaque émission ;
4. B vérifie le JWT avec les clés publiques de Clavis (`/oauth/jwks`) : signature, `aud`, durée, `act.sub` autorisé.

Tant que Clavis ne l'a pas construit, **aucune décision à distance** : la phase 1 lit et renvoie par lien profond.

## 6. API de l'outil propriétaire

### `GET /api/v1/taches/{tache_id}` (fiche, phase 2)

`tache_id` encodé dans l'URL ; `Authorization: Bearer <jeton Clavis, aud = l'outil, scope taches:lire>`. L'outil relit
`clavis.pub_acces` (lecture impossible = refus), relit l'objet dans son filtre de visibilité (hors périmètre = 404) et rend
la **fiche normalisée** v1 :

```json
{ "outil": "arche", "tache_id": "step:G2-CPX-ALG-007-3", "nature": "approbation", "type_libelle": "Étape de circuit",
  "titre": "G2 — visa du DAF", "etat": "a_faire", "echeance": "2026-11-28",
  "objet": { "ref": "CPX-ALG-007", "libelle": "Ligne de conditionnement 4", "lien": "https://…/capex/CPX-ALG-007" },
  "circuit": [ { "ordre": 1, "libelle": "Avis du chef de projet", "qui": "…", "etat": "approuve", "le": "2026-11-20", "motif": null } ],
  "a_verifier": [ { "libelle": "Budget G2", "valeur": "4 250", "unite": "k€", "reference": "4 000", "ecart": "+6,3 %" } ],
  "documents": [ { "codex_id": "DOS-CPX-ALG-007-002", "revision": "B", "libelle": "Dossier G2" } ],
  "actions": ["approuver", "refuser", "commenter"], "motif_obligatoire": ["refuser"],
  "decision_a_distance": true, "version": "17", "lien": "https://…/capex/CPX-ALG-007/gates?step=3" }
```

Les documents cités s'ouvrent par l'aperçu de Codex avec le jeton de la personne pour Codex (TA-8) ; l'outil appelant ne
garde rien.

### `POST /api/v1/taches/{tache_id}/decision` (décision, phase 2)

`Authorization: Bearer <jeton Clavis, scope taches:decider>`, `Idempotency-Key: <cle>` ; corps :

```json
{ "decision": "approuver", "motif": "…", "version": "17", "cle": "<uuid tiré par l'outil appelant>" }
```

`decision` ∈ `actions` de la ligne (`approuver`, `refuser`, ou une transition `demarrer`, `suspendre`, `reprendre`,
`terminer`). L'outil propriétaire : vérifie le jeton (§ 5) ; relit `clavis.pub_acces` ; relit l'objet dans son filtre de
visibilité ; refait **ses** contrôles de droit (titulaire, délégation, seuil) ; compare `version` dans la transaction ;
exige le motif d'un refus ; applique son circuit et son **journal d'audit** avec l'auteur et l'outil d'où la décision
vient (« depuis Keystone ») ; rejoue sans effet une même `cle` ; réécrit sa projection ; répond l'état nouveau.

| Code | Corps | Cas |
| --- | --- | --- |
| 200 | `{ "etat", "resultat", "version" }` | décision enregistrée (ou rejouée) |
| 401 | `{ "erreur": "jeton" }` | jeton absent, expiré, mauvaise audience |
| 403 | `{ "erreur": "interdit" }` | la personne n'a pas ce droit, ou l'outil appelant n'est pas autorisé |
| 404 | — | tâche inconnue ou hors périmètre de la personne |
| 409 | `{ "erreur": "perimee", "fiche": … }` | `version` dépassée ou tâche déjà décidée |
| 422 | `{ "erreur": "motif_obligatoire" }` | refus sans motif, décision hors `actions` |
| 423 | `{ "erreur": "a_ouvrir_dans_l_outil", "lien" }` | type exclu (`decision_a_distance = false`) |
| 503 | `{ "erreur": "source_indisponible" }` | outil propriétaire en maintenance |

Outil sans API HTTP (Vigie) : il ajoute cette API (TA-12). Outil propriétaire qui ne répond pas : **aucune décision mise
en attente** (TA-13) ; l'appelant affiche « source indisponible, réessayez ou ouvrez <outil> ».

## 7. Phases

| Phase | Contenu | Prérequis |
| --- | --- | --- |
| 1 (Norma 2.4) | tronc commun des menus ; projection `taches_publiees` et requête de référence `pub_taches` de chaque outil ; `matrix.pub_taches` ; « Mes tâches » (liste, kanban, calendrier) et « Mes approbations » de toute la suite **en lecture**, lien profond vers l'outil propriétaire ; décision et déplacement seulement sur les lignes de l'outil lui-même | publication de chaque `pub_taches` et lien `lecture matrix.pub_taches` (Matrix) |
| 2 | fiche (`GET`) et décision (`POST`) depuis tout outil ; aperçu des documents de Codex | échange de jeton de Clavis (§ 5), API de chaque outil, aperçu de Codex |
| 3 | résumé quotidien commun envoyé par Matrix (TA-5, TA-6), préférences dans Clavis (TA-7) | transport d'e-mail choisi par la DSI |

Composants de la charte : `charte/ds/MyTasks.tsx`, `MyApprovals.tsx`, `BaseNav.tsx` ; règles pures
`charte/ds/task-rules.ts` (`decisionsHere`, `moveAction` : la phase 2 s'active par `remote`).

## 8. Évolution

Une colonne de plus va en fin et se demande à Matrix pour chaque `pub_taches` ; un changement incompatible est un contrat
v2 (`contrats/taches-v2.md`, vues `…_v2`), la v1 restant publiée tant qu'un outil la lit.
