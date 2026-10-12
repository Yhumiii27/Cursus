# API Keystone de Cursus — version 1

Guide destiné au développeur de Keystone. Keystone et Cursus échangent par HTTP, sans base partagée :
Cursus conserve des données de santé et de paie que Keystone n'a pas à lire. Dans ce sens
(Keystone → Cursus), Keystone transmet son référentiel (projets, chantiers, affectations, tâches
planifiées), interroge le verdict Go / No Go d'un chantier et dépose des demandes de déplacement.
Dans l'autre sens (Cursus → Keystone), Cursus envoie ses décisions, les heures et absences validées
et les changements de verdict à une route de Keystone (« Événements envoyés par Cursus »).
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
- Le reverse proxy de Cursus peut n'admettre ces routes que depuis l'adresse de Keystone, avec un débit
  limité (voir `docs/DEPLOIEMENT.md`) : une autre adresse reçoit `403` du proxy, un débit excessif
  `429` (à rejouer plus tard).
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

Les activités internes (codes `INT-…`, par exemple `INT-PROD`) et les cours en CFA (`ECOLE`) sont
aussi imputables : elles se créent et se modifient par cette même route, mais ne sont pas des projets
Keystone. Leurs heures ne sont jamais renvoyées à Keystone (`heures.validees`), et un instantané qui
les omet ne les archive pas : pour en clore une, `PUT` avec `"statut": "archive"`.

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
  et historique s'y réfèrent). Exception : les activités internes (`INT-…`, `ECOLE`), que l'instantané
  peut omettre sans les archiver (voir « Projets »).
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

`GET /chantiers/{id}/go-no-go` — réévalué à chaque appel, pour chaque ressource : contrat en cours et
aucune absence sur sa présence, habilitations et certifications exigées, valides sur les dates du
chantier, et, hors de France, déplacement validé couvrant sa présence, formalités de voyage (passeport,
visa, vaccinations) et de détachement (certificat de sécurité sociale, information écrite au-delà de
4 semaines). La présence d'une ressource est celle de ses affectations, ramenée aux dates du chantier
(sans affectation connue, les dates du chantier).

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
| `CONTRAT` | contrat (CDD, mission d'intérim, alternance) qui se termine avant la fin de la présence, ou qui commence après son début (No Go) |
| `ABSENCE` | absence validée ou signalée pendant la présence (No Go), demande d'absence en attente (réserve) ; jamais la nature de l'absence, même dans le libellé |
| `DEPLACEMENT_PARTIEL` | déplacement qui ne couvre pas toute la présence : départ après le premier jour ou retour avant le dernier (réserve) |
| `DETACHEMENT` | formalités de détachement à faire avant le départ (réserve) — certificat de sécurité sociale (A1 en Europe, formulaire de la convention bilatérale ailleurs, maintien au régime français sans convention) et, pour une mission de plus de 4 semaines, information écrite du salarié —, ou qui ne seront pas faites au départ (No Go) |
| `APTITUDE` | avis d'inaptitude du médecin du travail (No Go) ; visite médicale périodique en retard ou à renouveler avant la fin de la présence, ou restrictions d'aptitude en vigueur pendant la présence : affectation à vérifier avec le service RH (réserve). Le verdict seulement : jamais la date d'une visite, l'avis détaillé ni le texte d'une restriction, même dans le libellé |

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
de décision (`decidee`). Les demandes décidées sont conservées. La décision est aussi envoyée à
Keystone (`demande.decision`, voir « Événements envoyés par Cursus ») : cette lecture permet de se
recaler après un envoi en échec.

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

Chaque appel authentifié, accepté ou refusé, est tracé dans le journal de Cursus (Paramètres →
Journal des actions, vue « Appels de Keystone », action `keystone.appel`) : date, méthode, chemin,
statut, code d'erreur et noms des champs refusés, référence (identifiant Keystone). Le contenu reçu
n'y est jamais recopié : ni matricule, ni dates, ni destination. Les clés de l'objet `heures` sont
remplacées par `heures.<date>` ou `heures.<clé invalide>` ; un identifiant ou un segment de chemin
mal formé, par `…` (la réponse à Keystone garde, elle, le détail complet).

Les appels sans clé valide (`401`, `503`), que n'importe qui peut émettre, ne sont pas tracés un par
un : ils sont comptés et résumés en une ligne par minute au plus (« 12 appels refusés sans clé
valide (401 × 12) depuis 10:02:13 »), sans chemin ni contenu.

## Limites actuelles

- Pas de limitation de débit dans Cursus même (le reverse proxy peut en poser une, voir
  « Authentification ») : éviter d'interroger le Go / No Go en boucle (chaque appel est tracé). Les
  changements de verdict sont poussés par Cursus (`verdict.modifie`) : une interrogation par chantier
  et par jour suffit pour se recaler.
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

Dans ce sens (Cursus → Keystone), Cursus pousse ses décisions et ses changements de verdict à une route
que **Keystone implémente**. Contrat formel : webhook `evenement` de la spécification OpenAPI
(`webhooks` et schémas `Evenement…` de `docs/keystone-openapi.json`).

| | |
| --- | --- |
| Adresse | `POST {KEYSTONE_URL}/api/cursus/v1/evenements` — `KEYSTONE_URL` est l'adresse de base de Keystone sur le réseau interne, configurée dans Cursus (`http://keystone.interne:8080`) |
| Authentification | `Authorization: Bearer <jeton>` : jeton `KEYSTONE_TOKEN` convenu avec Keystone, distinct de la clé `X-Api-Key` des appels entrants |
| Idempotence | en-tête `Idempotency-Key`, égal au champ `id` du corps, le même à chaque tentative |
| Format | JSON en UTF-8, un événement par appel |
| Délai | réponse attendue en 10 s au plus |
| Réponse | `2xx`, avec de préférence `{ "accuse": "<identifiant de réception>" }` |

### Enveloppe

```json
{
  "id": "0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20",
  "type": "demande.decision",
  "emis_le": "2026-10-10T08:41:07.512Z",
  "donnees": { "demande": 7, "reference": "DK-2026-0412", "matricule": "EMP-0018", "chantier": "K-2611", "decision": "acceptee", "date": "2026-10-10" }
}
```

- `id` : identifiant unique de l'événement (UUID), égal à l'en-tête `Idempotency-Key`.
- `type` : un des types ci-dessous. Un type inconnu est à accepter (`2xx`) et ignorer : Cursus pourra en
  ajouter, annoncés à l'avance et ajoutés à la spécification.
- `emis_le` : date de mise en file (ISO 8601, UTC), inchangée d'une tentative à l'autre. Elle ordonne
  les événements.
- `donnees` : contenu propre au type. Seuls des matricules, des identifiants, des dates, des heures et
  des codes sortent de Cursus : jamais de nom, de motif saisi ni de donnée de santé.

### Réponse attendue et reprise sur échec

Cursus met chaque événement en file dans la transaction de l'action qui le produit (une action
refusée n'envoie rien), puis un processus de fond l'envoie : un envoi à la fois, dans l'ordre
d'émission.

| Réponse de Keystone | Effet dans Cursus |
| --- | --- |
| `2xx` | reçu ; l'accusé (`accuse` du corps JSON, sinon le statut HTTP) est conservé et montré au service RH |
| `408`, `429`, `5xx`, pas de réponse en 10 s, erreur réseau | nouvelle tentative après 1, 2, 4, 8, 16, 32 min puis toutes les heures (`Retry-After` respecté jusqu'à 1 h) ; après 10 tentatives (environ 4 h), échec |
| autre `4xx` | échec définitif, sans nouvelle tentative ; le corps `{ "error", "code" }` est repris dans le détail de l'erreur |
| redirection `3xx` | non suivie : échec définitif (adresse à corriger) |

- **Doublons** : un événement peut arriver deux fois (coupure après réception, avant la réponse).
  Keystone conserve les clés reçues (90 jours au moins) et répond `2xx` à une clé déjà vue, avec le
  même accusé, sans retraiter.
- **Ordre** : tant que l'événement en tête attend une nouvelle tentative, les suivants attendent aussi ;
  un échec définitif ne retient pas la file. Le service RH peut relancer un envoi en échec
  (Paramètres → Envois) : il repart avec son contenu, son `emis_le` et sa clé d'origine, et peut donc
  arriver après des événements plus récents. Pour un même objet (demande, absence, ressource d'un
  chantier, salarié et semaine), Keystone n'applique un événement que s'il est plus récent (`emis_le`)
  que le dernier appliqué.
- **Échec** : visible dans Cursus (Paramètres → Envois, et journal : `keystone.echec`). Keystone peut
  se recaler par les lectures de l'API (`GET /chantiers/{id}/go-no-go`, `GET /demandes/{reference}`).

### `demande.decision`

Le service RH accepte ou refuse une demande de déplacement (écran Voyages).

| Champ | Type | Contenu |
| --- | --- | --- |
| `demande` | entier | identifiant Cursus de la demande (`demande.id` renvoyé par `POST /demandes`) |
| `reference` | identifiant ou `null` | référence Keystone ; `null` pour une demande déposée sans référence par l'ancienne route |
| `matricule` | matricule | |
| `chantier` | identifiant | |
| `decision` | `acceptee` / `refusee` | acceptée : le déplacement est créé dans Cursus, rattaché au chantier |
| `date` | date | jour de la décision |

Une acceptation lève en général la réserve `DEPLACEMENT` : le nouveau verdict suit dans un événement
`verdict.modifie` distinct.

### `heures.validees`

Le manager ou le service RH valide une feuille de temps. Seules partent les heures passées sur les
projets Keystone : les activités internes (codes `INT-…`) et les cours en CFA (`ECOLE`) ne sont jamais
transmis, pas plus que les projets sans heure. Une semaine sans heure sur un projet Keystone n'envoie
rien.

| Champ | Type | Contenu |
| --- | --- | --- |
| `matricule` | matricule | |
| `semaine` | date | lundi de la semaine |
| `projets` | objet `{ "code projet": heures }` | total de la semaine par projet, en heures décimales (deux décimales au plus) |

```json
{ "matricule": "EMP-0012", "semaine": "2026-10-05", "projets": { "K-2614": 15, "K-2611": 15 } }
```

Une feuille validée n'est plus modifiable : un événement par salarié et par semaine. Si un nouvel
événement arrivait pour le même salarié et la même semaine, il remplacerait le précédent.

### `absence.validee` et `absence.annulee`

Une absence est validée par le manager ou le service RH (ou posée et validée d'emblée par le manager) ;
`absence.annulee` signale l'annulation d'une absence déjà validée. La nature de l'absence (congé payé,
RTT, maladie…) n'est jamais transmise : seule l'indisponibilité compte pour la planification.

| Champ | Type | Contenu |
| --- | --- | --- |
| `absence` | entier | identifiant Cursus de l'absence, repris par l'annulation |
| `matricule` | matricule | |
| `du`, `au` | dates | premier et dernier jour d'absence, inclus |

```json
{ "absence": 31, "matricule": "EMP-0018", "du": "2026-12-14", "au": "2026-12-18" }
```

### `verdict.modifie`

Le verdict Go / No Go d'une ressource change : statut ou codes de motif. Cursus mémorise le dernier
verdict transmis par chantier et par ressource et le recalcule après chaque action qui peut le changer
(habilitation suspendue, levée, retirée ou délivrée, certification enregistrée, recyclage planifié,
déplacement créé, formalités de voyage ou de détachement mises à jour, absence posée, validée, prolongée
ou annulée, fin de contrat modifiée…), après chaque écriture de Keystone (affectation,
exigences ou dates d'un chantier, instantané) et chaque jour (expirations, délais des formalités). Une
nouvelle ressource reçoit aussi son premier verdict (`precedent: null`), comme chaque ressource des
chantiers en cours ou à venir à la mise en service des envois : les verdicts calculés tant que Cursus
fonctionnait sans `KEYSTONE_URL` (simulation) ne comptent pas comme transmis, et repartent tous au
premier démarrage en mode API. Une ressource retirée, un chantier archivé ou terminé ne produisent pas
d'événement.

| Champ | Type | Contenu |
| --- | --- | --- |
| `chantier` | identifiant | |
| `statut` | `GO` / `GO_RESERVE` / `NO_GO` | verdict du chantier après le changement |
| `ressource.matricule` | matricule | |
| `ressource.statut` | `GO` / `GO_RESERVE` / `NO_GO` | nouveau verdict de la ressource |
| `ressource.motifs` | liste de `{ code, niveau }` | codes de motif seulement (voir « Verdict Go / No Go »), jamais de libellé, même en partage détaillé |
| `ressource.precedent` | statut ou `null` | dernier verdict transmis pour cette ressource ; `null` : premier verdict |

```json
{
  "chantier": "K-2614", "statut": "NO_GO",
  "ressource": { "matricule": "EMP-0018", "statut": "NO_GO", "motifs": [{ "code": "HABILITATION_SUSPENDUE", "niveau": "NO_GO" }], "precedent": "GO" }
}
```

Un événement par ressource dont le verdict change ; l'ordre des motifs n'est pas significatif. Le
verdict complet du chantier reste lisible par `GET /chantiers/{id}/go-no-go`.

### Côté Cursus

- Configuration : `KEYSTONE_URL` et `KEYSTONE_TOKEN` (voir `docs/DEPLOIEMENT.md`). En production,
  Cursus refuse de démarrer avec `KEYSTONE_URL` sans `KEYSTONE_TOKEN`, avec une adresse qui n'est
  pas en `http(s)` ou qui porte des identifiants (`utilisateur:motdepasse@`).
- Sans `KEYSTONE_URL` (simulation, démonstration) : les événements sont tracés dans le journal et
  marqués « simulés » ; rien n'est envoyé, ni rattrapé plus tard, sauf les verdicts : à la mise en
  service, chaque ressource suivie reçoit son verdict actuel (`verdict.modifie`, `precedent: null`).
- Suivi : Paramètres → Envois (statut, tentatives, dernière erreur, accusé, contenu, boutons Relancer
  et Classer pour un envoi en échec) ; l'état affiché de l'intégration reprend le dernier envoi reçu et
  les échecs en cours. Un échec que la relance ne corrigera pas (refus définitif examiné par le service
  RH) se classe : il reste dans la liste, sans plus compter parmi les échecs en cours.

### Tester la réception

Un appel identique à ceux de Cursus, à rejouer tel quel pour vérifier l'idempotence (`$KEYSTONE` :
adresse de base de Keystone, `$JETON` : jeton convenu) :

```bash
curl -s -X POST "$KEYSTONE/api/cursus/v1/evenements" \
  -H "Authorization: Bearer $JETON" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 9e7f3b21-48ac-4d0e-b5f6-12c8a7d3e940' -d '{
  "id": "9e7f3b21-48ac-4d0e-b5f6-12c8a7d3e940", "type": "verdict.modifie", "emis_le": "2026-10-10T10:02:18.377Z",
  "donnees": { "chantier": "K-2614", "statut": "NO_GO",
    "ressource": { "matricule": "EMP-0018", "statut": "NO_GO", "motifs": [{ "code": "HABILITATION_SUSPENDUE", "niveau": "NO_GO" }], "precedent": "GO" } }
}'
```

```json
{ "accuse": "KS-EVT-48213" }
```
