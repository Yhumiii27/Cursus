# API Keystone de Cursus — version 1

Guide destiné au développeur de Keystone. Keystone et Cursus échangent par HTTP, sans base partagée :
Cursus conserve des données de santé et de paie que Keystone n'a pas à lire. Dans ce sens
(Keystone → Cursus), Keystone transmet son référentiel (projets, chantiers, affectations, tâches
planifiées), interroge le verdict Go / No Go d'un chantier et dépose des demandes de déplacement.
Seuls des matricules et des codes de motif sortent de Cursus.

Contrat formel : spécification OpenAPI 3.1 `docs/keystone-openapi.json`, servie aussi par
`GET /api/integrations/keystone/v1/openapi.json`. En cas d'écart, la spécification fait foi.

## En bref

| | |
| --- | --- |
| Adresse | `https://cursus.example.fr/api/integrations/keystone/v1` (le reverse proxy HTTPS de Cursus) |
| Authentification | en-tête `X-Api-Key: <clé>` sur chaque appel |
| Format | JSON en UTF-8, en-tête `Content-Type: application/json` pour `PUT` et `POST` ; 2 Mo au plus par appel |
| Dates | `AAAA-MM-JJ`, date existante (`2026-02-31` est refusée) |
| Salariés | matricule Cursus (`EMP-0018`), jamais de nom |
| Objets | identifiant Keystone dans l'URL : renvoyer le même objet ne crée pas de doublon |

Dans les exemples, `$CURSUS` vaut `https://cursus.example.fr/api/integrations/keystone/v1` et
`$CLE` la clé convenue.

## Authentification

La clé est définie côté Cursus par la variable `KEYSTONE_API_KEY` (voir `docs/DEPLOIEMENT.md`) et
transmise par un canal sûr. Elle est comparée en temps constant.

- En-tête absent ou clé fausse : `401` (`CLE_INVALIDE`).
- Aucune clé configurée sur le serveur Cursus : `503` (`NON_CONFIGUREE`).
- Changement de clé : Cursus redémarre avec la nouvelle valeur ; Keystone la reçoit ensuite. Les
  appels faits entre-temps reçoivent `401` et sont à rejouer.

Le corps d'un appel n'est lu qu'une fois la clé vérifiée.

## Identifiants, matricules, dates

- **Identifiants Keystone** (chantier, projet, affectation, tâche, référence de demande) : 1 à 64
  caractères, lettres, chiffres, `.`, `_`, `:` ou `-`, commençant par une lettre ou un chiffre.
  Ils sont stables : Cursus les utilise pour reconnaître un objet déjà reçu.
- **Matricule** : identifie le salarié dans Cursus. Il vaut aujourd'hui `EMP-` suivi de quatre
  chiffres, dérivé de la fiche Cursus. Il deviendra le matricule de paie (chantier distinct dans
  Cursus) : les routes et la forme des messages ne changeront pas, seules les valeurs ; Cursus
  préviendra avant la bascule. Un matricule inconnu de Cursus est refusé (`400`).
- **Dates** : `AAAA-MM-JJ`. Une période (`debut` → `fin`, `du` → `au`, `depart` → `retour`) se
  termine le jour même au plus tôt.

## Idempotence

- `PUT` sur un identifiant Keystone crée l'objet (`201`, `"resultat": "cree"`) ou le met à jour
  (`200`, `"modifie"`). Un envoi identique à l'état enregistré répond `200`, `"inchange"`, sans rien
  écrire. Un `PUT` peut donc être rejoué sans risque après une coupure.
- `DELETE` répond `200` (`"supprime"`) puis `404` aux envois suivants : un `404` sur une suppression
  signifie « déjà fait », rien à rejouer.
- `POST /demandes` : la `reference` est unique. Un réessai reçoit `409` (`DEMANDE_EN_DOUBLE`) avec la
  demande déjà enregistrée dans le champ `demande` : elle a bien été reçue. Une demande identique
  (même salarié, chantier et dates) encore en attente, envoyée sous une autre référence, reçoit le
  même `409`.
- `PUT /instantane` s'applique en une transaction : tout ou rien.

## Ordre des envois

Un objet ne peut citer qu'un objet déjà reçu : projets, puis chantiers, puis affectations et tâches.
Une demande de déplacement exige l'affectation du salarié au chantier sur ses dates. Dans un
instantané, les sections sont traitées dans cet ordre : un chantier et ses affectations peuvent
arriver dans le même appel.

Synchronisation conseillée : chaque modification envoyée aussitôt par les routes unitaires, et un
instantané chaque nuit pour rattraper un envoi perdu (voir « Synchronisation complète »).

## Référentiels de Cursus

`GET /referentiels` donne les codes admis : habilitations et certifications exigibles d'un chantier,
destinations des déplacements (pays dont Cursus connaît les formalités de voyage). Ces référentiels
sont tenus dans Cursus.

```bash
curl -s -H "X-Api-Key: $CLE" "$CURSUS/referentiels"
```

```json
{
  "habilitations": [{ "code": "he", "nom": "Habilitation électrique" }, { "code": "atex", "nom": "Habilitation ATEX" }],
  "certifications": [{ "code": "sst", "nom": "Sauveteur secouriste du travail (SST)" }],
  "destinations": [{ "code": "MA", "pays": "Maroc" }, { "code": "CI", "pays": "Côte d’Ivoire" }]
}
```

## Projets

`PUT /projets/{code}` — projet sur lequel les heures s'imputent dans les feuilles de temps (chantiers
clients, projets internes, formation en alternance…).

| Champ | Type | Obligatoire | Contenu |
| --- | --- | --- | --- |
| `nom` | texte (120) | oui | libellé affiché dans la feuille de temps |
| `statut` | `actif` / `archive` | non (`actif`) | archivé : plus proposé à la saisie, jamais supprimé |

```bash
curl -s -X PUT -H "X-Api-Key: $CLE" -H 'Content-Type: application/json' \
  -d '{ "nom": "Rétrofit presse hydraulique" }' "$CURSUS/projets/K-2614"
```

```json
{ "resultat": "cree", "projet": { "code": "K-2614", "nom": "Rétrofit presse hydraulique", "statut": "actif" } }
```

Un chantier n'est pas un projet : pour que les heures passées sur un chantier soient saisissables,
transmettez aussi son projet (souvent de même code).

## Chantiers

`PUT /chantiers/{id}` — chantier évalué par le Go / No Go.

| Champ | Type | Obligatoire | Contenu |
| --- | --- | --- | --- |
| `nom` | texte (120) | oui | |
| `client` | texte (120) | non | |
| `lieu` | texte (120) | oui | ville ou site |
| `pays` | code ISO 3166-1 (`FR`, `MA`…) | oui | hors de France, le Go / No Go contrôle aussi le déplacement et les formalités |
| `debut`, `fin` | dates | oui | période évaluée par le Go / No Go |
| `chef` | texte (120) | non | chef de projet, affiché au service RH |
| `habilitations` | liste de codes | non (`[]`) | exigées de chaque ressource (codes de `GET /referentiels`) |
| `certifications` | liste de codes | non (`[]`) | exigées de chaque ressource (codes de `GET /referentiels`) |
| `statut` | `actif` / `archive` | non (`actif`) | archivé : plus de verdict (`410`), missions gardées en historique ; réactivable |

```bash
curl -s -X PUT -H "X-Api-Key: $CLE" -H 'Content-Type: application/json' -d '{
  "nom": "Rétrofit presse hydraulique", "client": "Atlas Emboutissage", "lieu": "Tanger", "pays": "MA",
  "debut": "2026-10-27", "fin": "2026-11-06", "chef": "Karim Haddad",
  "habilitations": ["he", "hauteur"], "certifications": ["sst"]
}' "$CURSUS/chantiers/K-2614"
```

```json
{
  "resultat": "modifie",
  "chantier": {
    "id": "K-2614", "nom": "Rétrofit presse hydraulique", "client": "Atlas Emboutissage", "lieu": "Tanger", "pays": "MA",
    "debut": "2026-10-27", "fin": "2026-11-06", "chef": "Karim Haddad", "habilitations": ["he", "hauteur"],
    "certifications": ["sst"], "statut": "actif", "ressources": ["EMP-0018", "EMP-0006", "EMP-0012"]
  }
}
```

Les ressources ne s'envoient pas : ce sont les salariés dont une affectation chevauche les dates du
chantier. Archiver un chantier fini le retire de l'écran Go / No Go de Cursus.

## Affectations

`PUT /affectations/{id}` — présence d'un salarié sur un chantier. Elle devient sa mission dans Cursus
(planning, feuille de temps, alerte sur une demande de congés pendant le chantier) et, si elle chevauche les
dates du chantier, il entre dans son Go / No Go.

| Champ | Type | Obligatoire | Contenu |
| --- | --- | --- | --- |
| `matricule` | matricule | oui | |
| `chantier` | identifiant | oui | chantier déjà transmis |
| `du`, `au` | dates | oui | dates de présence |

```bash
curl -s -X PUT -H "X-Api-Key: $CLE" -H 'Content-Type: application/json' \
  -d '{ "matricule": "EMP-0018", "chantier": "K-2614", "du": "2026-10-27", "au": "2026-11-06" }' \
  "$CURSUS/affectations/AF-K-2614-18"
```

```json
{ "resultat": "cree", "affectation": { "id": "AF-K-2614-18", "matricule": "EMP-0018", "chantier": "K-2614", "du": "2026-10-27", "au": "2026-11-06", "ressource": true } }
```

`ressource: false` : l'affectation est hors des dates du chantier (repérage, préparation) ; la
mission existe mais le salarié n'est pas évalué. Élargir les dates du chantier l'y fait entrer.

`DELETE /affectations/{id}` retire la mission et la ressource. Une demande de déplacement encore en
attente pour cette affectation ne pourra plus être acceptée par le service RH.

## Tâches planifiées

`PUT /taches/{id}` — tâche d'un projet planifiée pour un salarié, avec les heures prévues jour par jour.
Dans la feuille de temps, « Proposer depuis Keystone » reprend les heures de la semaine affichée, du
lundi au vendredi ; les jours fériés, d'absence validée ou non travaillés (temps partiel) restent à
zéro. Une semaine sans heure planifiée ne propose rien.

| Champ | Type | Obligatoire | Contenu |
| --- | --- | --- | --- |
| `projet` | identifiant | oui | projet déjà transmis |
| `tache` | texte (160) | oui | libellé repris dans la feuille de temps |
| `matricule` | matricule | oui | une tâche par salarié : une tâche à plusieurs salariés s'envoie une fois par salarié, avec un identifiant chacun |
| `debut`, `fin` | dates | oui | |
| `heures` | objet `{ "AAAA-MM-JJ": heures }` | oui | entre `debut` et `fin`, de 0 à 24 h ; un jour absent ou à 0 n'est pas planifié |

```bash
curl -s -X PUT -H "X-Api-Key: $CLE" -H 'Content-Type: application/json' -d '{
  "projet": "K-2614", "tache": "Rétrofit — circuit hydraulique", "matricule": "EMP-0018",
  "debut": "2026-10-27", "fin": "2026-10-30",
  "heures": { "2026-10-27": 8, "2026-10-28": 8, "2026-10-29": 8, "2026-10-30": 7 }
}' "$CURSUS/taches/KT-8812-18"
```

```json
{ "resultat": "cree", "tache": { "id": "KT-8812-18", "projet": "K-2614", "tache": "Rétrofit — circuit hydraulique", "matricule": "EMP-0018", "debut": "2026-10-27", "fin": "2026-10-30", "heures": { "2026-10-27": 8, "2026-10-28": 8, "2026-10-29": 8, "2026-10-30": 7 } } }
```

Les heures du samedi et du dimanche sont acceptées et conservées, mais pas proposées : la feuille
de temps couvre le lundi au vendredi. `DELETE /taches/{id}` retire la tâche ; les feuilles déjà
saisies ne changent pas.

## Synchronisation complète

`PUT /instantane` — état de référence de Keystone, pour rattraper un envoi perdu ou initialiser Cursus.

```json
{
  "depuis": "2026-10-01",
  "projets": [{ "code": "K-2614", "nom": "Rétrofit presse hydraulique" }],
  "chantiers": [{ "id": "K-2614", "nom": "Rétrofit presse hydraulique", "lieu": "Tanger", "pays": "MA", "debut": "2026-10-27", "fin": "2026-11-06", "habilitations": ["he"] }],
  "affectations": [{ "id": "AF-K-2614-18", "matricule": "EMP-0018", "chantier": "K-2614", "du": "2026-10-27", "au": "2026-11-06" }],
  "taches": [{ "id": "KT-8812-18", "projet": "K-2614", "tache": "Rétrofit — circuit hydraulique", "matricule": "EMP-0018", "debut": "2026-10-27", "fin": "2026-10-28", "heures": { "2026-10-27": 8, "2026-10-28": 8 } }]
}
```

- Chaque section transmise (`projets`, `chantiers`, `affectations`, `taches`) est l'état complet :
  chaque objet porte son identifiant (`code` pour un projet, `id` sinon) et est créé ou mis à jour.
- Un projet ou un chantier **absent** de sa section est archivé, jamais supprimé (feuilles de temps
  et historique s'y réfèrent).
- Une affectation ou une tâche **absente** est supprimée. Avec `depuis`, seules celles qui se
  terminent ce jour-là ou après sont concernées : l'historique antérieur est gardé sans avoir à le
  renvoyer.
- Une section omise n'est pas touchée : l'instantané peut être découpé en plusieurs appels, une
  section chacun, si le corps dépasse 2 Mo.
- Tout ou rien : une seule erreur annule l'appel, avec chaque champ fautif dans `details`
  (`chantiers[2].fin`).

```json
{
  "resultat": "synchronise",
  "bilan": {
    "projets": { "crees": 0, "modifies": 0, "inchanges": 1, "archives": 2 },
    "chantiers": { "crees": 0, "modifies": 1, "inchanges": 0, "archives": 1 },
    "affectations": { "crees": 1, "modifies": 0, "inchanges": 0, "supprimes": 3 },
    "taches": { "crees": 1, "modifies": 0, "inchanges": 0, "supprimes": 12 }
  }
}
```

## Verdict Go / No Go

`GET /chantiers/{id}/go-no-go` — réévalué à chaque appel, pour chaque ressource : habilitations et
certifications exigées, valides sur les dates du chantier, et, hors de France, déplacement validé
et formalités de voyage (passeport, visa, vaccinations).

```bash
curl -s -H "X-Api-Key: $CLE" "$CURSUS/chantiers/K-2614/go-no-go"
```

```json
{
  "chantier": "K-2614",
  "evalue_le": "2026-10-10T07:12:44.120Z",
  "statut": "NO_GO",
  "ressources": [
    { "matricule": "EMP-0018", "statut": "GO", "motifs": [] },
    { "matricule": "EMP-0006", "statut": "NO_GO", "motifs": [
      { "code": "HABILITATION", "niveau": "NO_GO" },
      { "code": "HABILITATION", "niveau": "NO_GO" },
      { "code": "CERTIFICATION", "niveau": "NO_GO" },
      { "code": "DEPLACEMENT", "niveau": "GO_RESERVE" }
    ] },
    { "matricule": "EMP-0012", "statut": "GO_RESERVE", "motifs": [{ "code": "DEPLACEMENT", "niveau": "GO_RESERVE" }] }
  ]
}
```

- `statut` (chantier et ressource) : `GO`, `GO_RESERVE` (go sous réserve), `NO_GO`. Celui du chantier
  est le plus défavorable de ses ressources.
- `motifs` : toujours une liste d'objets `{ code, niveau }`, `niveau` étant l'effet du motif
  (`GO_RESERVE` ou `NO_GO`). Un motif par exigence non satisfaite : le même code revient si deux
  habilitations manquent. Si le service RH a choisi le partage détaillé (Paramètres), un `libelle`
  s'y ajoute (« Habilitation ATEX — non détenue »), sans aucune donnée de santé.
- Chantier inconnu : `404` ; archivé : `410` (`CHANTIER_ARCHIVE`).

| Code de motif | Signification |
| --- | --- |
| `HABILITATION` | habilitation exigée absente, en attente de délivrance, non valide au démarrage, ou expirant pendant le chantier (réserve) |
| `HABILITATION_SUSPENDUE` | habilitation exigée suspendue par l'employeur |
| `HABILITATION_RETIREE` | habilitation exigée retirée par l'employeur |
| `CERTIFICATION` | certification exigée absente ou expirée (réserve si un recyclage est planifié avant le démarrage, ou si elle expire pendant le chantier) |
| `DEPLACEMENT` | chantier hors de France sans déplacement validé (demande en attente ou déplacement à créer) |
| `FORMALITES_VOYAGE` | passeport, visa ou vaccination à régulariser (réserve), ou hors délai (No Go) |

Un nouveau code de motif sera annoncé et ajouté à la spécification : Keystone doit traiter un code
inconnu selon son `niveau`.

## Demandes de déplacement

`POST /demandes` — demande de déplacement d'une ressource vers un chantier hors de France. Le service
RH l'accepte (le déplacement est créé, rattaché au chantier, avec la référence Keystone) ou la refuse
dans l'écran Voyages.

| Champ | Type | Obligatoire | Contenu |
| --- | --- | --- | --- |
| `reference` | identifiant | oui | référence unique de la demande dans Keystone |
| `matricule` | matricule | oui | salarié affecté au chantier sur ces dates |
| `chantier` | identifiant | oui | chantier actif |
| `destination` | code pays | non (pays du chantier) | doit être le pays du chantier, connu du référentiel des destinations |
| `depart`, `retour` | dates | oui | retour le jour du départ au plus tôt, et pas avant aujourd'hui |

```bash
curl -s -X POST -H "X-Api-Key: $CLE" -H 'Content-Type: application/json' -d '{
  "reference": "DK-2026-0412", "matricule": "EMP-0018", "chantier": "K-2611",
  "depart": "2026-11-09", "retour": "2026-11-27"
}' "$CURSUS/demandes"
```

```json
{ "resultat": "cree", "demande": { "id": 7, "reference": "DK-2026-0412", "matricule": "EMP-0018", "chantier": "K-2611", "destination": "CI", "depart": "2026-11-09", "retour": "2026-11-27", "statut": "en_attente_rh", "recue": "2026-10-10", "decidee": null } }
```

Contrôles (`400`, chaque champ dans `details`) : référence, matricule connu, chantier connu et actif,
destination du pays du chantier, dates existantes et ordonnées, déplacement non terminé, salarié
encore dans les effectifs au départ, **affectation du salarié au chantier sur ces dates**. Le service
RH ne voit que des demandes contrôlées ; à l'acceptation, Cursus les revalide (affectation retirée
ou chantier archivé depuis, déplacement déjà créé…) : une demande devenue invalide ne peut qu'être
refusée.

`GET /demandes/{reference}` donne le statut : `en_attente_rh`, `acceptee` ou `refusee`, avec la date
de décision (`decidee`). Les demandes décidées sont conservées. En attendant les envois de Cursus
(section suivante), Keystone peut lire ici la décision.

## Erreurs

Toute erreur est en JSON : `error` (message en français), `code` (stable, à tester) et, selon le cas,
`details` (champs refusés) ou `demande` (demande déjà enregistrée).

```json
{ "error": "Données invalides : retour", "code": "VALIDATION", "details": [{ "champ": "retour", "message": "Antérieure à depart" }] }
```

| Statut | Code | Signification | Que faire |
| --- | --- | --- | --- |
| 400 | `VALIDATION` | champs refusés, détaillés dans `details` | corriger l'envoi ; ne pas rejouer tel quel |
| 400 | `JSON_INVALIDE`, `CORPS_INVALIDE` | corps illisible | corriger l'envoi |
| 401 | `CLE_INVALIDE` | clé absente ou fausse | vérifier la clé |
| 404 | `CHANTIER_INCONNU`, `AFFECTATION_INCONNUE`, `TACHE_INCONNUE`, `DEMANDE_INCONNUE` | objet jamais reçu (ou déjà supprimé) | sur un `DELETE` : rien à faire |
| 404 | `ROUTE_INCONNUE` | adresse inconnue | vérifier la route |
| 409 | `DEMANDE_EN_DOUBLE` | demande déjà reçue | lire `demande` : c'est la demande enregistrée |
| 410 | `CHANTIER_ARCHIVE` | chantier archivé : plus de verdict | |
| 413 | `CORPS_TROP_VOLUMINEUX` | corps de plus de 2 Mo | découper l'instantané par section |
| 415 | `TYPE_NON_PRIS_EN_CHARGE` | en-tête `Content-Type` absent ou autre que JSON | ajouter `Content-Type: application/json` |
| 500 | `ERREUR_INTERNE` | incident côté Cursus | rejouer plus tard (les `PUT` sont rejouables) |
| 503 | `NON_CONFIGUREE` | intégration non configurée dans Cursus | prévenir l'exploitant de Cursus |

## Journal des appels

Chaque appel, accepté ou refusé (clé fausse comprise), est tracé dans le journal de Cursus
(Paramètres → Journal des actions, action `keystone.appel`) : date, méthode, chemin, statut, code
d'erreur et noms des champs refusés, référence (identifiant Keystone). Le contenu reçu n'y est jamais
recopié : ni matricule, ni dates, ni destination.

## Limites actuelles

- Pas de limitation de débit : éviter d'interroger le Go / No Go en boucle (chaque appel est tracé).
  Une interrogation par chantier et par heure suffit ; les changements de verdict seront poussés par
  Cursus (section suivante).
- Les référentiels (habilitations, certifications, destinations) sont tenus dans Cursus : un code
  manquant se demande au service RH.
- Pas de lecture d'un objet par `GET` (hors verdict et demandes) : l'état enregistré est renvoyé par
  chaque `PUT`.

## Anciennes routes (obsolètes)

Les deux routes antérieures à la version 1 restent servies à l'identique, avec les en-têtes
`Deprecation: true` et `Link` vers la route v1. Elles seront retirées dans une version ultérieure,
annoncée à l'avance.

| Ancienne route | Remplacée par | Différences |
| --- | --- | --- |
| `GET /api/integrations/keystone/chantiers/{id}/go-no-go` | `GET …/v1/chantiers/{id}/go-no-go` | motifs en codes simples (`"HABILITATION"`), ou en objets `{ code, libelle }` en partage détaillé : forme variable, sans `niveau` |
| `POST /api/integrations/keystone/demandes` | `POST …/v1/demandes` | `reference` facultative (sans elle, pas de détection des réessais autre que la demande identique en attente) ; réponse `{ "id": 7, "statut": "en_attente_rh" }`. Mêmes contrôles qu'en v1 |

## Événements envoyés par Cursus

*Section à compléter avec les envois sortants (Cursus → Keystone).*

Aujourd'hui, ces messages sont seulement tracés dans le journal de Cursus (mode simulation,
`server/src/integrations/keystone.ts`) ; leur adresse, leur authentification, leur format définitif
et la reprise sur échec restent à fixer :

| Type | Déclencheur | Contenu prévu |
| --- | --- | --- |
| `demande.decision` | le service RH accepte ou refuse une demande de déplacement | `reference`, `demandeId`, `matricule`, `chantier`, `decision` (`acceptee` / `refusee`) |
| `heures.validees` | une feuille de temps est validée | `matricule`, `semaine`, heures par projet |
| `absence.validee` | une absence est validée | `matricule`, `du`, `au`, `nature` |
| `verdict.modifie` | une suspension, une levée, un retrait ou une nouvelle délivrance d'habilitation change un verdict | `chantier`, `statut`, ressource (`matricule`, `statut`, codes de motif) |
