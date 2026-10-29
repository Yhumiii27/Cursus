# Cursus

Outil RH de suivi des **formations, certifications et habilitations**, des **feuilles de
temps**, des **congés**, des **entretiens obligatoires** et des **déplacements**, avec
un verdict **Go / No Go** par chantier pour Keystone et la transmission des variables
de paie à **Sage Paie**.

Construit à partir de la maquette Claude Design « Outil RH gestion formations »
(design system Nocturne) — voir `design/` : prototype de référence, guide du design system et archive complète de
la maquette (`design/maquette-handoff.zip`, seul exemplaire gardé dans le dépôt).

## Démarrer

Prérequis : Node.js 22.18 ou plus récent, version 22 de référence (`.nvmrc` : `nvm use`) ; aucune base de données à
installer : SQLite est intégré à Node.

```bash
npm install
```

```bash
npm run dev
```

Ouvrir http://localhost:5173. `npm run dev` active le mode démonstration (`CURSUS_DEMO=1`) :
au premier lancement, la base `data/cursus.db` (dossier du code, quel que soit le dossier de lancement) est créée
avec les données de démonstration
(24 collaborateurs d'un site industriel, CCN Industries chimiques). Hors démonstration, une base
vide le reste.

### Trois espaces

Le sélecteur **Vue** de la barre latérale bascule entre les espaces (mode démonstration) :

- **RH** : tout l'outil, dont la création et la modification des fiches
  (statut, contrat, organisation du temps), l'écran « Équipes & managers » (créer, renommer,
  supprimer une équipe, désigner son manager, affecter les collaborateurs, rattacher une équipe à une équipe parente :
  le manager de l'équipe est alors validé par son responsable, consultation N+2 en lecture seule réglable ; délégation
  datée des validations d'un manager absent à un suppléant, aussi saisie par le manager dans son espace), la **sortie** d'un salarié, CDI compris
  (dernier jour et motif en liste fermée : ce qui était prévu après son départ est annulé, il quitte la conformité et les
  échéances et reste consultable avec le filtre « Sortis » de Collaborateurs ; son solde de congés, de RTT, de
  récupération et de CET à la date est montré avant la confirmation, photographié pour la paie, imprimable et exportable,
  et part dans le lot de paie du mois une fois les rubriques de sortie activées, code Sage confirmé pour un lot réel ;
  sinon il se saisit dans Sage, et la confirmation du lot du mois le marque réglé hors fichier) et l'écran « Référentiels »
  (catalogue des formations, habilitations et destinations : création, modification, archivage, référentiel
  type à charger dans une base vide ; formations et habilitations aussi pour le référent HSE ; postes et formations ou
  habilitations exigées par poste et par équipe), et l'écran « Mise en
  service » (Paramètres : reprise depuis Lucca des salariés, des soldes de congés, des certifications, des
  habilitations et des visites médicales par imports CSV, avec aperçu et compte rendu ; administrateur RH). Deux profils : les
  **gestionnaires RH** (fiches, formations, absences…) et l'**administrateur RH**, seul à régler les
  paramètres, supprimer et gérer les comptes (Paramètres → Comptes et accès) et, avec le gestionnaire de paie, à
  transmettre la paie.
  En démonstration : Sandrine Vidal, administratrice RH, et Antoine Leroy, gestionnaire RH. Un membre du RH qui
  est aussi salarié ne décide jamais de ses propres absences, feuilles de temps ou entretiens : son manager ou
  un autre membre du RH le fait. Son profil RH est porté par le compte rattaché à sa fiche (un compte externe créé
  avant la fiche s'y rattache dans Comptes et accès).
  Trois profils restreints ouvrent aussi l'espace RH, sans rien voir ni faire d'autre que leur mission :
  **référent HSE / formation** (catalogue, sessions et présences, certifications et habilitations, verdicts
  Go / No Go ; aptitude médicale réduite, comme pour un manager, au verdict et aux restrictions en vigueur),
  **gestionnaire de paie**, interne ou
  cabinet extérieur (temps, absences et soldes en lecture, transmission à Sage Paie ; ni formations, ni entretiens, ni
  données de santé) et **lecture seule** pour la direction, le DPO ou un auditeur (tableaux de bord, alertes et
  journal des actions, sans modification ni donnée de santé détaillée). En démonstration : Sarah Cohen,
  Aïcha Diallo et Élodie Bernard.
- **Manager** : son équipe — inscriptions aux sessions et demandes de formation / habilitation,
  absences posées et validées, absences imprévues signalées (le service RH en précise la nature, jamais
  communiquée au manager pour un arrêt de travail ou la santé d'un enfant), saisie et correction des feuilles de temps, intitulé du poste et jours non
  travaillés des fiches, ajout de salariés « à affecter » (libérés par leur manager d'origine ; une mutation
  directe passe par le service RH) et retrait de membres, entretiens (ses propres entretiens, que mène son responsable,
  se préparent et se signent dans son espace collaborateur), missions.
  Pas d'accès aux données de santé : seuls le verdict d'aptitude et les restrictions de poste en vigueur sont transmis,
  sans date de visite ; du passeport de ses membres, la seule date d'expiration.
- **Utilisateur** (collaborateur) : ses formations, habilitations, voyages, heures,
  absences, entretiens et demandes au service RH. Un refus (demande d'absence, demande au service RH)
  lui parvient avec son motif, obligatoire à l'écran de celui qui refuse ; le motif d'un refus d'absence
  est aussi lu par son manager, celui d'une demande au service RH par lui seul.
  Les documents de voyage qu'il déclare (passeport, visa, vaccination) n'entrent dans son
  dossier qu'après validation par le service RH. Ses vaccinations (vaccin et date d'injection) sont des données de
  santé réservées au service RH : l'information sur leur traitement (art. 13 du RGPD) s'affiche avant la saisie.
  Ce qui l'attend (compte rendu d'entretien à signer, feuille de temps renvoyée ou semaine passée à soumettre) est
  signalé par une pastille dans le menu et dans l'encart « À faire » de son accueil.

Chaque personne se connecte avec son compte nominatif : compte Microsoft 365 de l'entreprise pour
les salariés qui en ont un (« Se connecter avec Microsoft », voir `docs/CONNEXION-MICROSOFT.md`),
compte Cursus (identifiant et mot de passe) pour les autres (ouvriers, intérimaires, alternants). Le
compte ouvre ses espaces : RH selon son profil RH, manager s'il encadre une équipe, collaborateur s'il
est salarié. Le journal porte le nom de la personne connectée.
En démonstration, chaque salarié a un compte et n'importe quel mot de passe est accepté.

Le **journal des actions** (Paramètres → Journal des actions) trace qui a fait quoi et quand : actions,
corrections d'heures, connexions, changements d'espace, refus d'accès, exports. Il ne retient que l'utile
(liste blanche par action, anciennes et nouvelles valeurs), jamais un numéro de passeport, un mot de passe,
un texte libre ni une donnée de santé ; il se filtre (période, personne, action, salarié), se pagine et
s'exporte en CSV. Conservation : 1 an ; les actions liées à la paie passent ensuite dans une archive
consultable sur demande, gardée 3 ans. La fiche d'un collaborateur montre son historique et permet au
service RH d'exporter toutes ses données (droit d'accès) ; chaque salarié télécharge les siennes depuis
son espace (« Télécharger mes données »).

Cursus s'utilise aussi sur **téléphone et tablette** (accès depuis Internet) : menu replié derrière un bouton
« Menu », feuilles de temps saisies jour par jour, champs et boutons à la taille du doigt ; la grille de la semaine
reste sur PC. Chaque page a son titre d'onglet et un lien « Aller au contenu » pour le clavier ; chaque ligne ou carte
cliquable s'ouvre aussi au clavier (bouton sur le nom). Les grandes listes se trient en cliquant sur l'en-tête d'une
colonne et s'affichent par 50 lignes (« Afficher plus ») ; la recherche de l'en-tête (service RH, manager sur son
équipe ; « / » ou Ctrl+K) propose les collaborateurs au fil de la frappe (nom, poste, équipe ou matricule) et ouvre la
fiche, et les listes de salariés des dialogues se filtrent de la même façon. L'annuaire, le registre des habilitations, les soldes et les
absences, et le plan de formation s'exportent en CSV (« Exporter (CSV) »), avec les filtres de l'écran et sans donnée de
santé ; chaque export est tracé au journal. La page
**Confidentialité**, ouverte depuis l'écran de connexion et depuis chaque espace, informe les salariés sur le
traitement de leurs données ; le responsable du traitement et le DPO se règlent dans Paramètres → Confidentialité, et
`docs/RGPD.md` décrit le traitement pour le registre et l'analyse d'impact de l'employeur.
La page **Aide**, ouverte de même depuis chaque espace et depuis l'écran de connexion, donne un guide court par rôle
(collaborateur, manager, service RH, gestionnaire de paie), l'ouverture progressive au groupe pilote et ce qui reste à
fournir avant la mise en service ; sa version détaillée, avec la procédure mensuelle de paie, est
`docs/GUIDE-UTILISATEUR.md`.

## Application de bureau (macOS)

```bash
npm run app
```

Crée `Cursus.app` sur le Bureau : double-cliquez pour ouvrir Cursus dans sa propre fenêtre. L'application
démarre le serveur local en mode démonstration (port 3217, accessible uniquement depuis ce Mac) et l'arrête à la fermeture.
Relancez `npm run app` après une modification du code ou un déplacement du dossier. Journal du serveur :
`~/Library/Logs/Cursus/serveur.log`. L'application utilise la même base que `npm run dev`
(`data/cursus.db`) : les deux ne peuvent pas tourner en même temps.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | API (port 3210) + interface Vite (port 5173) avec rechargement à chaud, en mode démonstration (`CURSUS_DEMO=0 npm run dev` pour le couper) |
| `npm run build` puis `npm start` | Production (`NODE_ENV=production`, Windows compris) : l'API sert l'interface compilée sur le port `PORT` (3210 par défaut), derrière un reverse proxy HTTPS — voir `docs/DEPLOIEMENT.md` (service systemd et fichiers prêts à copier de `deploy/`, ou `Dockerfile` facultatif) |
| `npm test` | Tests des règles métier, des droits d'accès et de la sécurité |
| `npm run lint` | Contrôle du code par oxlint (`.oxlintrc.json`) : erreurs courantes, règles des hooks React (bloquantes), dépendances des effets (avertissements) |
| `npm run typecheck` | Vérification TypeScript (noms des actions appelées par le client compris), puis contrôle des promesses non attendues (`npm run check:await`, `scripts/verifier-await.mjs`) |
| `CURSUS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:pg` | Même suite de tests sur un serveur PostgreSQL 16 de test (une base créée puis supprimée par fichier) ; `npm run test:coverage:pg` mesure la couverture de l'adaptateur PostgreSQL |
| `npm run test:coverage` | Tests avec mesure de la couverture du serveur et de `shared/` (client et tests exclus) ; échoue sous les seuils fixés dans `package.json` |
| `npm run test:client` | Tests du client (`tests/client-*.test.ts` : modules, exécution des actions, rendu des dialogues avec happy-dom et Testing Library) avec mesure de sa couverture, à seuils modestes |
| `npm run check` | Tout ce que vérifie la CI avant d'accepter une modification : contrôle du code, typage, tests avec seuils de couverture (serveur, puis client), compilation de l'interface |
| `npm run build` puis `npm run e2e` | Parcours de bout en bout par rôle (Playwright, `e2e/`) dans Chrome, Edge et un téléphone simulé, sur une base de démonstration jetable à date figée ; navigateurs installés une fois par `npx playwright install chromium msedge` (sans Edge : `CURSUS_E2E_SANS_EDGE=1`) |
| `CURSUS_DEMO=1 npm run reset-demo -- --yes` | Recharge les données de démonstration : efface la base après l'avoir copiée. Refusé hors démonstration, avec `NODE_ENV=production` (sauf l'application de bureau) et si un serveur utilise la base (`--force` pour passer outre) ; sans `--yes`, le mot `EFFACER` est demandé dans un terminal |
| `npm run audit` | Failles connues des dépendances de production (`npm audit`), en échec à partir de la gravité « high » |
| `npm run mesure` | Taille de l'instantané et durée des actions sur une base temporaire de 100 salariés et 3 ans (`npm run mesure -- 200` : autre effectif) |
| `npm run charge:generer -- --ans 5` puis `npm run charge -- --scenario S3 --duree 120` | Essai de charge sur PostgreSQL (`CURSUS_TEST_DATABASE_URL` : serveur de test, jamais le serveur commun) : jeu réaliste de 5 ans dans un schéma jetable, scénarios simultanés S1 à S6, rapport et seuils dans `data/charge/rapports/` (`docs/ARCHITECTURE.md`, « Performances ») ; `-- --supprimer` retire les schémas de l'essai ; `--verifier-exactitude [k]` compare en plus, toutes les k actions validées, le cache à la relecture complète (invariant « 0 divergence ») ; `--client-brut` fait lire chaque réponse d'un bloc et la décompresser en une opération (temps du serveur, sans le décodage morceau par morceau de fetch dans la boucle de Cursus) ; `--sans-prechauffage-vues` ne préchauffe que l'entrée du cache |
| `npm run backup` | Copie à chaud vérifiée de la base dans `data/backups`, avec rotation |
| `npm run restore -- <fichier>` | Remplace la base par une sauvegarde (serveur arrêté) |
| `DATABASE_URL=… npm run reprise-postgres -- [<base SQLite>] [--a-blanc]` | Reprise d'une base SQLite sur le serveur PostgreSQL commun, une fois, service arrêté ; `--a-blanc` : contrôles et compte rendu sans rien écrire (`docs/DEPLOIEMENT.md`) |
| `npm run pieces:chiffrer -- [--apercu]` | Chiffre les pièces justificatives déposées avant la clé `CURSUS_PIECES_KEY` (lot 8), une fois Cursus redémarré avec elle ; service en marche admis, relançable (`docs/SAUVEGARDE.md`, section 10) |
| `npm run pieces:verifier` | Contrôle complet des pièces, sans rien écrire : chaque fichier lu, déchiffré et comparé à l'empreinte de son envoi (après une restauration) ; code 1 si un fichier est absent, altéré ou illisible |
| `npm run revision:epoque` | Change l'époque de la base (journal des changements du lot 9) : les instances dont le cache compare l'époque (cache incrémental du lot 9) relisent alors l'instantané en entier ; sans ce cache, seul le redémarrage des instances le fait. À lancer après un rechargement des données seules sur le serveur PostgreSQL (`pg_restore --data-only`) ; service en marche admis (`docs/SAUVEGARDE.md`, section 10) |
| `npm run comptes -- admin <identifiant> [--local]` | Crée le premier administrateur RH, ou rétablit son accès (voir `docs/DEPLOIEMENT.md`) |
| `npm run verifier-production -- [--config-seule] [--json] [--strict]` | Pré-vol de la mise en production, avec l'environnement de l'application : configuration jugée comme en production et base en lecture seule ; code 0 prête, 1 bloquant, 2 avertissements (`docs/DEPLOIEMENT.md`, « Vérification avant la mise en production ») |

## Configuration (variables d'environnement)

Modèle commenté : `.env.example`. En production (`NODE_ENV=production`), le serveur refuse de démarrer
et liste les problèmes si `CURSUS_SECRET` manque ou fait moins de 32 caractères, si `KEYSTONE_API_KEY`
manque ou reprend la clé de démonstration `demo-keystone` (hors démonstration), si `KEYSTONE_URL` est définie
sans `KEYSTONE_TOKEN`, n'est pas une adresse http(s) ou porte des identifiants, si `CURSUS_TODAY` est
définie, si la démonstration est active sans `CURSUS_HOST` (ou `HOST`) posée explicitement sur la boucle
locale, si `CURSUS_INSECURE_COOKIE=1` hors de ce cas, si la connexion Microsoft 365 n'est configurée
qu'en partie (les quatre variables `CURSUS_OIDC_*` et `CURSUS_PUBLIC_URL`, ou aucune), avec un locataire
qui n'est pas un GUID ou une adresse publique qui n'est pas en https, ou si `CURSUS_OIDC_AUTORITE` est
définie ; hors production, il les signale seulement.
De même pour l'envoi des e-mails (`docs/EMAILS.md`) : `CURSUS_MAIL_FROM` qui n'est pas une adresse, application
d'envoi non entièrement désignée (`CURSUS_MAIL_*` ou `CURSUS_OIDC_*`), variables `CURSUS_MAIL_*` sans `CURSUS_MAIL_FROM` ;
et pour un `CURSUS_SUPERVISION_TOKEN` de moins de 32 caractères. En production toujours, il refuse une base restée
accessible à d'autres comptes que le sien (droits impossibles à ramener à `600`).
Et pour Sage Paie : `SAGE_MODE` inconnu, `api` compris (pas d'envoi par API : la paie importe le fichier), `SAGE_URL` définie,
`SAGE_MODE=simulation` hors application de bureau (des feuilles seraient marquées transmises sans que rien ne parte).
En production, la démonstration refuse aussi (403) toute requête relayée par un proxy (`Forwarded`,
`X-Forwarded-*`) ou adressée à un autre nom que 127.0.0.1 / localhost / [::1].

| Variable | Effet |
| --- | --- |
| `NODE_ENV` | `production` : contrôle strict de la configuration, cookie de session `Secure`, écoute sur 127.0.0.1 par défaut |
| `PORT` / `CURSUS_API_PORT` | Port du serveur (3210 par défaut) |
| `CURSUS_HOST` / `HOST` | Adresse d'écoute : 127.0.0.1 en production (derrière le reverse proxy), 0.0.0.0 sinon |
| `CURSUS_TRUST_PROXY` | Proxys dont les en-têtes `X-Forwarded-*` sont crus (`loopback` par défaut : proxy sur la même machine) |
| `CURSUS_DB` | Fichier SQLite (`data/cursus.db` du dossier du code par défaut ; un chemin relatif part du dossier de lancement). Son chemin complet s'affiche au démarrage ; le fichier est réservé au compte du serveur (`600`, dossier en `700`) |
| `DATABASE_URL` | Serveur PostgreSQL commun EPC2I (`postgres://cursus_app:<mot de passe>@<hôte>:5432/epc2i`) : Cursus y travaille dans le schéma `cursus` et y applique ses migrations (`server/migrations-pg/`). Absente ou vide : fichier SQLite `CURSUS_DB`. Voir `docs/ARCHITECTURE.md`, « Accès à la base : PostgreSQL » |
| `CURSUS_PG_POOL` | Connexions au plus du pool PostgreSQL (10 par défaut) |
| `CURSUS_PG_DELAI_CONNEXION_MS`, `CURSUS_PG_DELAI_VERROU_MS`, `CURSUS_PG_DELAI_REQUETE_MS` | Délais du serveur PostgreSQL, en millisecondes (0 : sans limite) : attente d'une connexion du pool (5 s), d'un verrou, verrou d'écriture compris (`lock_timeout`, 30 s), durée d'une requête (`statement_timeout`, 60 s). Un dépassement répond 503 « Cursus est occupé, réessayez », sans rien écrire. Voir `docs/DEPLOIEMENT.md` |
| `CURSUS_CACHE_INSTANTANE` | Cache de l'instantané, indexé par la révision de la base (actif par défaut ; `0` le désactive : chaque instantané relit toute la base). Voir `docs/ARCHITECTURE.md`, « Performances » |
| `CURSUS_CACHE_INCREMENTAL` | Cache incrémental (lot 9) : l'entrée d'une révision nouvelle, le jeu d'une action et celui du suivi des verdicts sont dérivés de la lecture précédente par le seul delta des lignes changées (journal `changements`), sans relire toute la base (actif par défaut ; `0` : relecture complète à chaque révision, pour comparer ou dépanner) |
| `CURSUS_VUES_REPORT` | Report des vues (lot 9) : après une écriture, les vues collaborateur et manager dont le périmètre n'est pas touché, et qu'aucune donnée commune changée n'atteint, sont reprises telles quelles à la révision suivante, corps JSON compris ; les vues RH sont toujours recalculées (actif par défaut ; `0` : chaque vue est recalculée à chaque révision) |
| `CURSUS_PRECHAUFFAGE_VUES` | Préchauffage des vues (lot 10) : au démarrage et au changement de jour, après l'entrée du cache, les vues des comptes actifs (RH par profil, managers, puis collaborateurs les plus récemment connectés) sont calculées en tâche de fond, une à une, avec la version compressée des grandes vues (actif par défaut ; `0` : l'entrée seule, chaque vue calculée à sa première demande) |
| `CURSUS_CORPS_COMPRESSES` | Grands corps compressés gardés avec la vue (lot 10) : le corps brotli (ou gzip) d'une vue RH est calculé une fois par révision et par compte, hors de la boucle d'événements, puis renvoyé tel quel (actif par défaut ; `0` : compressé à chaque requête par le module de compression) |
| `CURSUS_CORPS_OCTETS` | Grands corps en octets et JSON gardé par ligne (lot 10) : le corps d'une grande vue (vue RH) est gardé en octets UTF-8 et le JSON de chaque ligne partagée d'un grand tableau n'est sérialisé qu'une fois (actif par défaut ; `0` : chaque corps est sérialisé en texte d'un bloc, comme au lot 9, sans corps compressé gardé ; même corps servi, pour comparer ou dépanner) |
| `CURSUS_MEMO_VUES` | Mémos des calculs de vue (lot 10) : indication « mineur » des feuilles, synthèse du C2P par salarié, gardées tant que leurs données ne changent pas (actif par défaut ; `0` : tout est recalculé à chaque vue) |
| `CURSUS_DIST` | Interface compilée servie (`dist/` du dossier du code par défaut) : pour les tests automatiques et une installation qui la place ailleurs |
| `CURSUS_SUPERVISION_TOKEN` | Jeton (32 caractères au moins) de l'outil de supervision : avec `Authorization: Bearer <jeton>`, `/api/health` donne aussi la version, le mode et les envois en échec. Facultatif ; ce détail est toujours donné à un appel local fait sur la machine (dans le conteneur avec Docker : `docker exec`) |
| `CURSUS_LOG_FORMAT` | Journaux du serveur : `json` (par défaut en production : une ligne JSON par message et par requête, pour l'agrégateur de Coolify ou du service informatique) ou `texte` (par défaut ailleurs). Jamais le corps ni les paramètres des requêtes |
| `CURSUS_COMPRESSION` | `1` par défaut : Cursus compresse ses réponses (brotli, sinon gzip) ; `0` si le proxy compresse déjà |
| `CURSUS_BACKUP_DIR` | Dossier des sauvegardes (`backups/` à côté de la base par défaut) |
| `CURSUS_BACKUP_KEEP` | Sauvegardes conservées par type (14 par défaut, `0` pour tout garder) |
| `CURSUS_PIECES_DIR` | Dossier des pièces justificatives en stockage local (`pieces/` à côté de la base par défaut : `/data/pieces` dans l'image Docker). Réservé au compte du serveur (`700`, fichiers en `600`) |
| `CURSUS_TODAY` | Fige la date du jour (AAAA-MM-JJ), utile pour la démonstration — les données de démo sont datées d'octobre 2026. Refusée en production |
| `CURSUS_DEMO` | `1` pour activer le mode démonstration (connexion libre, sélecteur de vue, réinitialisation, données fictives dans une base vide). Inactif par défaut ; en production, admis seulement pour l'application de bureau (`CURSUS_HOST=127.0.0.1` explicite), ou derrière le reverse proxy avec `CURSUS_DEMO_PUBLIQUE=1` |
| `CURSUS_DEMO_PUBLIQUE` | `1` : instance de démonstration publiée derrière le proxy (Coolify), données fictives seulement, accès restreint en amont (« Mise en ligne » ci-dessous). Sans effet hors démonstration |
| `CURSUS_SECRET` | Clé de signature des sessions, 32 caractères au moins (`openssl rand -hex 32`). Obligatoire en production ; ailleurs, générée et stockée en base, puis retirée de la base au premier démarrage avec la variable |
| `CURSUS_INSECURE_COOKIE` | `1` : cookie sans l'attribut `Secure`, pour l'application de bureau en http://127.0.0.1 uniquement. Refusée en production hors application de bureau |
| `KEYSTONE_API_KEY` | Clé attendue des appels entrants de Keystone (en-tête `X-Api-Key`). Obligatoire en production ; sans elle, les routes Keystone répondent 503. La clé `demo-keystone` n'est acceptée qu'en mode démonstration, quand la variable est vide |
| `KEYSTONE_URL`, `KEYSTONE_TOKEN` | Envois à Keystone : adresse de base (`POST {KEYSTONE_URL}/api/cursus/v1/evenements`) et jeton (`Authorization: Bearer`), obligatoire en production avec l'adresse. Sans `KEYSTONE_URL`, les messages sont seulement tracés dans le journal (simulation) |
| `SAGE_MODE` | Transmission à Sage Paie : `fichier` (fichier d'import, mode de production par défaut), `simulation` (par défaut hors production : rien ne part, les feuilles sont seulement marquées transmises). Pas de mode `api` : aucun envoi automatique, la paie importe le fichier dans Sage. Voir `docs/DEPLOIEMENT.md`, « Sage Paie » |
| `SAGE_DOSSIER` | Dossier de paie inscrit dans les variables transmises (`CURSUS-CHIMIE` par défaut), et dans la colonne facultative « code dossier » du fichier d'import. `SAGE_URL` ne sert plus : refusée en production |
| `CURSUS_OIDC_TENANT`, `CURSUS_OIDC_CLIENT_ID`, `CURSUS_OIDC_CLIENT_SECRET` | Connexion Microsoft 365 : ID de l'annuaire (GUID), ID d'application et secret client de l'inscription dans Entra (`docs/CONNEXION-MICROSOFT.md`). Les quatre variables avec `CURSUS_PUBLIC_URL`, ou aucune |
| `CURSUS_PUBLIC_URL` | Adresse publique de Cursus, en https (`https://cursus.example.fr`) : Microsoft renvoie à `${CURSUS_PUBLIC_URL}/api/auth/microsoft/retour` |
| `CURSUS_OIDC_SECRET_EXPIRE` | Facultative : date d'expiration du secret client Entra (`AAAA-MM-JJ`). 30 jours avant, `/api/health` passe en `degrade` et le récapitulatif des échéances prévient la boîte du service RH (`docs/CONNEXION-MICROSOFT.md`, section 3). Démarrage refusé si ce n'est pas une date ou sans `CURSUS_OIDC_CLIENT_SECRET` |
| `CURSUS_OIDC_AUTORITE` | Remplace `https://login.microsoftonline.com` : réservée aux tests automatiques (faux fournisseur local). Refusée en production |
| `CURSUS_MAIL_FROM` | Boîte d'envoi dédiée des e-mails (`cursus@entreprise.fr`), envoyés par Microsoft Graph. Sans elle : simulation (e-mails tracés dans le journal et visibles dans Paramètres → Envois, rien ne part). Mise en service : `docs/EMAILS.md` |
| `CURSUS_MAIL_TENANT`, `CURSUS_MAIL_CLIENT_ID`, `CURSUS_MAIL_CLIENT_SECRET` | Application Entra autorisée à envoyer (`Mail.Send`, restreinte à la boîte d'envoi) ; par défaut celle de la connexion Microsoft (`CURSUS_OIDC_*`) |
| `CURSUS_MAIL_SECRET_EXPIRE` | Facultative, avec `CURSUS_MAIL_CLIENT_SECRET` seulement : date d'expiration (`AAAA-MM-JJ`) du secret de l'application d'envoi distincte. 30 jours avant, `/api/health` passe en `degrade` et le récapitulatif des échéances prévient la boîte du service RH |
| `CURSUS_SAUVEGARDE_TEMOIN` | Facultative : chemin absolu du fichier témoin écrit par la sauvegarde du serveur commun ; plus de 26 h sans sauvegarde, `/api/health` passe en `degrade` (`docs/BASCULE-PRODUCTION.md`, section 7) |
| `CURSUS_KEYSTONE_ADRESSES` | Facultative : adresses ou réseaux admis à appeler l'API Keystone (`10.0.1.0/24`) ; les autres reçoivent 403. Vide : aucun filtre |
| `MATRIX_URL`, `MATRIX_TOKEN`, `MATRIX_DECLARATIONS_DIR` | Déclaration du schéma de la base à Matrix, le catalogue des bases : voir « Mise en ligne » ci-dessous |

Les sessions durent 12 heures au plus depuis la connexion ; la déconnexion les révoque (pour un compte
Microsoft, elle passe aussi par la déconnexion Microsoft), et une session est refusée dès que la date de
sortie du salarié rattaché est passée ou que son compte est désactivé. À l'expiration, la reconnexion
s'affiche par-dessus l'écran, sans perdre la page ni le formulaire ouverts : avec un compte Cursus,
l'action interrompue est enregistrée dès la reconnexion ; avec un compte Microsoft, la saisie du
formulaire est gardée dans l'onglet et remise en place au retour de Microsoft.

## Sauvegarde

Toutes les données tiennent dans le fichier SQLite `CURSUS_DB`. `npm run backup` en fait une copie
cohérente sans arrêter le serveur (`VACUUM INTO`), la vérifie et ne garde que les 14 plus récentes ;
le code de sortie signale un échec à la supervision. Une copie est aussi faite automatiquement avant
une migration de la base et avant la réinitialisation de la démonstration. `npm run restore -- <fichier>`
vérifie la sauvegarde, refuse de s'exécuter si le serveur tourne (sauf `--force`), copie la base
actuelle puis la remplace. Le serveur signale qu'il utilise la base par un verrou (`<base>.pid`) et
refuse de démarrer si un autre serveur l'utilise déjà, ou si une version plus récente de Cursus a migré la base
(migrations nommées, `server/src/migrations/` : restaurer alors la copie avant-migration).

Pièces justificatives (lot 6, désactivées par défaut) : une fois activées par l'administrateur RH, leurs fichiers
sont dans `pieces/` à côté de la base ; chaque sauvegarde copie ceux que sa base désigne dans `backups/pieces-<base>/`,
et la restauration les remet en place (`docs/SAUVEGARDE.md`, section 1).

Conservation des dossiers (lot 6, t016) : durées préremplies, inactives tant que l'administrateur RH n'a pas saisi la
référence de la décision du DPO (Paramètres → Conservation des dossiers) ; Cursus propose ensuite chaque jour les
dossiers des salariés sortis dont une durée est échue, l'administrateur RH confirme l'effacement ou l'anonymisation.
Rien n'est effacé automatiquement ; les sauvegardes gardent les données jusqu'à leur rotation. Agenda (t036) : `.ics`
joint aux congés validés, et abonnement personnel à Outlook (Paramètres → Agenda, désactivé par défaut).

Planification (timer systemd), copie chiffrée hors de la machine, restauration pas à pas et test
périodique : `docs/SAUVEGARDE.md`.

## Exploitation

- **Installation** : `docs/DEPLOIEMENT.md` (machine Linux louée dans l'UE, service systemd, Caddy). Les unités systemd,
  la configuration Caddy et le script de copie externe sont livrés prêts à copier dans `deploy/` ; un `Dockerfile`
  facultatif sert si l'hébergeur impose des conteneurs.
- **Démarrage** : chemins complets de la base et des sauvegardes affichés ; port déjà pris, interface non compilée ou
  base accessible à d'autres comptes signalés en clair (code de sortie 1 quand le démarrage est impossible).
- **Arrêt** (SIGTERM, Ctrl+C) : requêtes en cours terminées (10 s au plus), base fermée, verrou retiré.
- **Santé** : `GET /api/health`, sans connexion : `{"statut":"ok","base":"ok"}` (503 si la base ne répond pas ;
  `"degrade"` si elle contient des références orphelines, comptées au démarrage et inscrites au journal, ou si le secret
  client Entra expire dans 30 jours ou moins (`CURSUS_OIDC_SECRET_EXPIRE`), détail réservé au poste local et au jeton de
  supervision).
- **Journaux** : une ligne par requête (heure, méthode, chemin sans paramètres, statut, durée, compte), en JSON en
  production ; erreurs de l'API toujours en JSON (`404`, `400`, `413`, `500` « Erreur interne » sans pile d'appels).
- **Performances** : réponses compressées par Cursus (brotli, gzip), interface découpée par écran et chargée à la
  demande, fichiers de l'interface gardés un an en cache (noms hachés), `index.html` revalidé à chaque ouverture, API
  jamais en cache ; mesure à 100 salariés sur 3 ans par `npm run mesure`. Détails : `docs/DEPLOIEMENT.md`,
  « Exploitation courante ».
- **Disque** : la base et ses sauvegardes sont sur un volume chiffré, prérequis de l'installation.

## Vérification automatique

Chaque modification poussée sur GitHub passe `npm run check` (`.github/workflows/ci.yml`) : `npm ci`, contrôle du code
(oxlint), typage, tests avec seuils de couverture (serveur, puis client), compilation de l'interface, sur Node 22
(`.nvmrc`), avec un essai non bloquant sur Node 24. Une tâche séparée, non bloquante pour commencer, rejoue les
parcours de bout en bout (`npm run e2e`) dans Chromium, Edge et un téléphone simulé, et publie leur rapport.
L'interface compilée est publiée comme artefact pour l'instance de recette. Toute la logique est dans `npm run check` :
une autre forge (GitLab, Azure DevOps) l'appelle en une ligne après `npm ci`. Les seuils de couverture (lignes,
branches, fonctions) sont fixés juste sous la mesure du jour, dans le script `test:coverage` de `package.json`, et se
relèvent au fil des tests ajoutés.

Dépendances : la CI lance aussi `npm run audit` (failles connues des dépendances de production, bloquant à partir de
la gravité « high » ; celles des outils de développement sont seulement signalées), et Dependabot
(`.github/dependabot.yml`) propose chaque lundi les mises à jour des paquets npm, des actions GitHub et de l'image Docker
`node:22-slim`, mineures et correctifs regroupés. **Le service informatique** examine ces demandes et les accepte une
fois la vérification passée (une version majeure arrive seule, à lire avec ses notes de version). Si le dépôt quitte
GitHub, Renovate ou l'outil de la forge remplace Dependabot ; `npm run audit` reste valable partout.

Cas de paie : `tests/cas-paie/` reçoit les cas réels anonymisés promis par la paie (un fichier JSON par cas : salarié,
contrat, absences, heures, compteurs et lignes du fichier Sage attendus), rejoués par `npm test` sans écrire de code ;
trois cas construits sur les règles légales et les réglages par défaut y sont déjà. Un cas réel n'y est versionné
qu'une fois anonymisé (identité fictive, dates décalées, aucune nature d'absence médicale) ; celui qui garde une donnée
de santé reste hors du dépôt et se rejoue par `CURSUS_CAS_PAIE=/chemin/absolu npm test`. Format et anonymisation :
`tests/cas-paie/LISEZMOI.md`.

Oracle d'exactitude du cache (lot 9) : `tests/oracle-cache.test.ts` rejoue une suite d'écritures aléatoire et
reproductible (actions par des comptes tirés au hasard, SQL direct) sur la démonstration et sur le jeu de charge d'un an,
et compare après chaque pas ce que sert le cache de l'instantané (vues de chaque compte et profil, jeu des actions) à la
relecture complète ; `tests/regles-incrementales.test.ts` fait de même pour les règles de paie et de congés de chaque
salarié. `CURSUS_ORACLE_GRAINES=1,2,3`, `CURSUS_ORACLE_PAS=300` ou `CURSUS_ORACLE_COMPLET=1` (passage long : trois
graines de 300 pas sur la démonstration, 60 pas sur le jeu d'un an ; job `oracle` de la CI sur les deux moteurs, pour
chaque pull request) allongent la suite (`docs/ARCHITECTURE.md`, « Oracle d'exactitude »). Le banc exige que le cache
incrémental ait servi (entrées dérivées par le delta, aucun repli : compteurs `statistiquesCache`).

## Ce qui reste simulé

- **Keystone** : les appels entrants sont réels — API versionnée `/api/integrations/keystone/v1`
  (projets, chantiers, affectations, tâches planifiées, synchronisation complète, verdict Go / No Go,
  demandes de déplacement), contrat OpenAPI `docs/keystone-openapi.json` et guide du développeur de
  Keystone `docs/API-KEYSTONE.md` ; hors démonstration, chantiers, projets, missions et tâches ne
  viennent que de cette API. Les messages sortants (décisions sur les demandes,
  heures validées sur les projets Keystone, absences validées et annulées (période seulement, jamais la nature), changements de verdict Go / No Go) passent
  par une file d'envoi persistante : envoyés à Keystone avec `KEYSTONE_URL` (nouvelles tentatives, suivi
  et relance dans Paramètres → Envois), seulement tracés dans le journal sans elle (`server/src/envois.ts`).
- **Sage Paie** (`SAGE_MODE`, `server/src/integrations/sage.ts`) : en mode fichier (production), la paie génère le lot de
  chaque période de paie (feuilles validées réservées, contenu figé, rappels compris), télécharge son fichier d'import CSV
  (format réglable, téléchargement tracé), l'importe dans Sage puis confirme l'import, confirmation datée et signée qui
  seule marque les feuilles transmises ; avant elle, le lot peut être annulé. Historique des lots dans l'écran Temps de
  travail (`docs/DEPLOIEMENT.md`, « Sage Paie »). En simulation, rien n'est envoyé : les feuilles sont marquées
  transmises, en un clic ou par un lot d'essai, ce que l'écran, la confirmation et le message disent. Le mode API est
  refusé, sans accusé fictif. Les codes des rubriques dans le plan de paie se saisissent et se confirment dans l'écran Temps de travail
  (administrateur RH, gestionnaire de paie) : tant qu'une rubrique utilisée n'est pas confirmée, seule la simulation transmet.
  Chaque salarié y est désigné par son matricule de paie, saisi sur sa fiche (Paramètres → Matricules de paie liste
  ceux qui manquent) : sans lui, il part sous son matricule Cursus en simulation, et une transmission réelle est refusée.
  Absences validées dans le même fichier (lot 5, Paramètres → Absences et paie, activé par défaut) : jours ventilés par
  mois, demi-journées comprises, régularisation négative d'une absence annulée ou raccourcie après sa transmission ;
  leurs rubriques restent à confirmer par la paie. Export CSV des variables de la période (droit « paie », tracé).
- **E-mails** (`docs/EMAILS.md`) : notifications des étapes de validation (demande de congés et décision,
  feuille soumise ou renvoyée, compte rendu d'entretien à signer ou mis à disposition, réponse à une demande au service RH),
  aussitôt ou en récapitulatif quotidien selon le réglage de chacun ; convocations aux formations (envoi
  unitaire ou groupé, daté, désinscription) et aux entretiens, avec fichier `.ics` ; relevé hebdomadaire des
  heures des intérimaires envoyé à leur agence (CSV) ; récapitulatif des échéances (titres, visites, formalités,
  entretiens, fins de contrat) au service RH, à chaque manager pour son équipe (sans donnée de santé) et au référent HSE,
  une seule fois par palier (90, 30, 7 jours, échu), désactivable dans Paramètres → Messagerie. Envoyés par Microsoft Graph depuis la boîte
  `CURSUS_MAIL_FROM`, par la file d'envoi (suivi et relance dans Paramètres → Envois) ; sans elle, simulés
  et tracés dans le journal. Adresse professionnelle sur la fiche (reprise du compte Microsoft 365), adresses
  du service RH, du service de santé au travail et des agences dans Paramètres → Messagerie.
- **Demandes de visite médicale** : enregistrées et suivies jusqu'à la saisie de la visite, envoyées par e-mail au service
  de prévention et de santé au travail (adresse de Paramètres → Messagerie) et imprimables, sans information médicale.
- **Liste des inscrits d'une session pour l'organisme** : affichée et exportée en CSV à la confirmation, sans envoi d'e-mail.
- **Sessions sur plusieurs jours** : premier et dernier jour, jours de la session (ouvrés par défaut) et horaires
  facultatifs ; conflits, contrat, convocation (`.ics`) et clôture (certification datée du dernier jour) sur toute la
  session ; heures prévues proposées dans la feuille de temps des inscrits (ligne interne INT-FORM, jamais envoyée à
  Keystone ; Paramètres → Formations).
- **Liste d'attente des sessions complètes** (lot 7) : une demande acceptée sur une session pleine place le salarié en
  file, dans l'ordre où le service RH accepte les demandes, avec sa place dans Mon espace ; une place libérée est proposée au service RH, qui confirme
  l'inscription (la convocation part alors), ou inscrit aussitôt en option ; file close à l'annulation ou à la clôture
  (demandes au plan de formation). Paramètres → Liste d'attente des sessions.
- **Évaluation des formations** (lot 7, t121) : avis à chaud du salarié (note de 1 à 5) dans Mon espace ou recueilli par le
  service RH à la clôture ; efficacité à froid (efficace, partiellement, non) demandée au salarié et à son manager 90 jours
  après les formations réglementaires et recommandées, avec e-mails de demande et de relance ; indicateurs par organisme
  et par formation (Plan & budget, export CSV), agrégats seuls pour le référent HSE ; commentaires au service RH seulement.
  Paramètres → Évaluation des formations.
- **Corrections d'une saisie erronée** : certification corrigée (date, formation ; service RH et référent HSE) ou supprimée
  (administrateur RH), ligne du plan corrigée ou supprimée, demande retirée par son auteur tant qu'elle attend ou rouverte
  par le service RH (inscription, ligne du plan ou titre en attente défaits). Motif obligatoire, réservé au service RH ;
  rien n'est effacé : une certification ou une ligne supprimée sort des calculs et reste tracée. Une certification sur
  laquelle s'appuie une habilitation délivrée ne se corrige qu'après la suspension de l'habilitation.

## Contrat et temps de travail

Chaque fiche distingue le **statut** (catégories de la CCN Industries chimiques : ouvrier / employé,
technicien / agent de maîtrise, ingénieur / cadre), la **nature du contrat** (CDI, CDD, intérim,
alternance) et l'**organisation du temps** : horaire collectif 35 h, 39 h avec RTT, forfait
hebdomadaire en heures, forfait annuel en heures, forfait annuel en jours, temps partiel, cadre
dirigeant. Un changement d'organisation du temps prend effet à une date choisie et s'inscrit dans
l'**historique du contrat** : les semaines antérieures gardent l'ancien régime (y compris une feuille
créée plus tard pour une semaine ancienne), les RTT / jours de repos de l'année sont comptés au prorata
de chaque régime, et une date future programme un avenant appliqué à sa date. Pour un **CDD**, la fiche
porte le motif de recours et le terme initial ; « Renouveler le CDD » inscrit chaque renouvellement, et
Cursus avertit d'une durée maximale ou d'un nombre de renouvellements dépassés et d'un délai de carence
non écoulé, sans rien bloquer (Paramètres → Contrats pour un accord de branche).

Pour un **forfait annuel en jours**, Cursus compte les jours travaillés des feuilles validées de l'année (une
demi-journée jusqu'à 4 h) et les compare au forfait au prorata de la présence : cumul, cible à date et jours de repos
restants sur la fiche, la feuille et la file de validation, alerte à 90 % du plafond (réglable) et motif exigé du valideur
au-delà. Un **avenant de renonciation** à des jours de repos (majoration de 10 % au moins, 235 jours au plus) ne
s'enregistre que si la référence de l'accord collectif qui autorise le forfait est saisie dans Paramètres → Forfait jours ;
ses jours rachetés partent à la paie sous la rubrique JREN, désactivée tant que la paie n'a pas donné son code (« à saisir
dans Sage » dans le résumé du lot ; `docs/ARCHITECTURE.md`, « Forfait jours »).

La fiche porte aussi la **période d'essai** écrite au contrat (aucune durée proposée : Cursus avertit au-delà du maximum
légal) et, pour un salarié étranger, le **titre de séjour** valant autorisation de travail (type, numéro réservé au
service RH, expiration, vérification en préfecture). L'écran Échéances (filtre « Contrats »), le tableau de bord et le
résumé du manager signalent les fins d'essai (au dernier jour du délai de prévenance), les fins de CDD, de mission et
d'alternance et les titres à renouveler (alertes à 120 et 60 jours, Paramètres → Contrats) ; un titre expiré rend le
salarié non conforme et le passe en « No Go » sur les chantiers (`docs/ARCHITECTURE.md`, « Contrat et temps de travail »).

La fiche porte la **date de naissance** complète (saisie, ou reprise de Lucca telle quelle) : l'âge exact décide des
sections de fin de carrière des entretiens (58 ans à la date de l'entretien) et des règles des salariés de moins
de 18 ans. Une fiche qui n'a que l'année garde la règle à l'année ; le supplément de 5 jours de congés à 59 ans reste
calculé sur l'année. Le manager n'en voit que l'année et l'indication « mineur » (`docs/ARCHITECTURE.md`, « Date de
naissance et âge »).

Pour un **salarié de moins de 18 ans**, la feuille de temps exige un motif ou la référence d'une dérogation de
l'inspection du travail au-delà de 8 h par jour ou de 35 h par semaine, et signale le travail du dimanche ou l'absence de
deux jours de repos consécutifs. Une équipe cochée « travail de nuit ou en continu » (Référentiels → Postes, exigences
communes) ne reçoit aucun mineur ; tant que la case n'est pas renseignée, sa fiche rappelle l'interdiction du travail de
nuit. La dérogation pour travaux réglementés se saisit sur la fiche (échéance à 3 ans) ; l'échéance « 18 ans » lève ces
règles (`docs/ARCHITECTURE.md`, « Salariés de moins de 18 ans »).

## Règles métier implémentées

Validité des certifications et seuil d'alerte (30–180 j) · prérequis des habilitations
(formation + aptitude médicale : prochaine visite fixée par le médecin, sinon périodicité selon le type de suivi — VIP, VIP adaptée, suivi renforcé —, 24 mois par défaut) avec suspension automatique, suspension et
retrait manuels (motif, date, auteur) · aptitude médicale dans le statut et les échéances, avis du médecin
du travail (apte, restrictions datées, inapte) avec suspension des habilitations incompatibles, demandes de
visite suivies jusqu'à la visite · visites dues signalées d'elles-mêmes : embauche (3 mois, le jour même en suivi
renforcé ou pour un mineur), reprise après une maternité, une maladie professionnelle, 30 jours d'accident du travail ou
60 jours de maladie, mi-carrière (45 ans, réglable), fin de carrière ou post-exposition à la sortie ; le manager ne voit
que « visite à programmer », jamais pour une reprise · entretien de parcours dû 2 mois (réglable, à confirmer
juridiquement) après la visite de mi-carrière · postes à risques particuliers (art. L4154-2) : formation renforcée des
CDD, intérimaires et alternants depuis leur entrée (Non conforme, No Go), liste imprimable · couverture minimale des
équipes en SST et équipiers incendie, alerte datée (expiration, sortie, absence) · formations suivies par salarié, hors
catalogue comprises (bilan à 8 ans) · titre d'habilitation imprimé à signer (NF C18-510, autorisation de conduite, générique),
historique des délivrances, passeport formation imprimable depuis le portail · durée en heures et indicateurs de formation
par exercice (catégorie, équipe, statut), exports CSV · seule la dernière certification compte après un
recyclage, les précédentes restent en historique · formalités de
voyage par destination (passeport, visas, vaccins, délais) et de détachement (certificat A1 ou de la
convention bilatérale de sécurité sociale, information écrite au-delà de 4 semaines) · Go / No Go par
chantier (matricules et codes de motif uniquement) : contrat et absences sur la présence, aptitude médicale, habilitations,
certifications, déplacement couvrant la présence, formalités de voyage et de détachement · heures supplémentaires +25 % / +50 %,
payées avec majoration (ou remplacées par un repos compensateur avec la référence de l'accord qui le prévoit, mode figé sur
chaque feuille à sa validation), heures complémentaires +10 % / +25 %, forfait jours, alertes 10 h / 48 h · période de paie
déduite de la semaine (mois du dimanche par défaut, clôture des variables, rappel d'une période close) · lots de paie figés,
fichier d'import pour Sage, absences validées comprises (jours ventilés par mois, régularisations), transmis seulement à
la confirmation de l'import, variables de la période exportées en CSV · réouverture d'une feuille validée par
l'administrateur RH (motif obligatoire), écart d'une feuille déjà transmise envoyé dans un lot correctif (ou « annule et
remplace » sans quantité négative), Keystone mis à jour · suivi des feuilles de temps semaine par
semaine (échéance le lundi suivant à 12 h, relance, validation groupée) · journée de 24 h au plus, motif exigé au-delà des durées maximales ·
semaine à 7 jours (samedi et dimanche grisés mais saisissables, repos hebdomadaire et dominical signalés, dérogation par équipe,
heures du dimanche HDIM et majoration réglable) · jours fériés saisissables et repérés (1er mai majoré de 100 %, autres
fériés en quantité, majoration réglable) · journée de solidarité et fériés chômés réglés année par année à partir de 2027,
sans effet rétroactif · horaires de poste (référentiel, horaire par défaut de l'équipe, horaire du jour sur la feuille,
figé à la soumission) · repos quotidien de 11 h et pause contrôlés d'après l'horaire (motif), heures de nuit (HNUIT, MAJ_NUIT
« à saisir dans Sage » tant qu'inactives), nuit refusée aux mineurs, travailleur de nuit repéré avec son suivi médical adapté · heures complémentaires au dixième de la durée (au tiers avec un accord), motif
au-delà · moyenne sur 12 semaines (44 h), temps partiel à requalifier, contingent annuel d'heures supplémentaires (220 h,
alerte à 90 %) et contrepartie obligatoire en repos créditée et transmise à la paie · activités internes tenues par le service RH, heures de délégation du CSE
(mandats, crédit R2314-1, compteur mensuel avec report sur 12 mois) · CP 25 jours
ouvrés (+5 j à 59 ans, CCN Chimie), chaque jour imputé sur sa période de référence, prise par
anticipation dans la limite des jours acquis à la date du congé · CP, RTT et récupération posables à la demi-journée
(après-midi du premier jour, matin du dernier ; une demi-journée de travail au plus ce jour-là) · RTT et jours de repos forfait
calculés au prorata de l'entrée et de la fin du contrat, ceux de l'année suivante posables dès maintenant, CET (5 RTT/an,
5e semaine de CP, plafonds réglables ; congé pris sur le CET, validé par le manager comme un CP, rubrique de paie « à saisir dans
Sage » tant que la paie ne l'a pas confirmée), reports de CP rattachés à une période et datés · congé principal (12 jours
ouvrables continus entre le 1er mai et le 31 octobre, 24 au plus d'affilée : avertissements, alerte avant le 31 octobre) et
jours de fractionnement proposés au 1er novembre, crédités par le service RH ou écartés par la renonciation du salarié
(règle légale par défaut, accord réglable) · clôture des congés proposée au 1er juin (CP : report
ou perte décidés salarié par salarié, jamais d'office, report de 15 mois des jours acquis pendant une absence de santé, une
maternité ou une paternité, ou qu'elle a empêché de prendre) et au 1er janvier (RTT non reportables) · acquisition des CP
pendant les absences (loi du 22 avril 2024 : accident du travail et maladie professionnelle sans limite, maladie à 2 jours
ouvrables par mois au minimum légal, réglable, congé parental et absences non payées au prorata) et information du
salarié sur ses congés à son retour d'arrêt (tâche du service RH, e-mail, report de 15 mois à compter de l'information) · compteurs repris de l'ancien outil datés (période de leur date
d'arrêté) · matricule de paie unique sur la fiche (réembauche confirmée par l'administrateur RH), identifiant envoyé à
Keystone réglable (matricule Cursus par défaut) · doublons et conflits de dates (formation, absence, déplacement, entretien) signalés ou
bloqués · absences hors congés
(maladie, accident du travail ou de trajet, maladie professionnelle, maternité, paternité, adoption,
congé parental, événements familiaux, enfant malade, absences non payées) signalées par le manager et
qualifiées par le service RH, prolongation, reprise inscrite automatiquement, nature médicale réservée au RH
et à l'intéressé · annulation des absences selon le rôle, solde recrédité · absences et feuilles de temps
bornées par le contrat · entretiens de
parcours (L6315-1 : 1re année puis tous les 4 ans, reprise, état des lieux 8 ans avec
risque d'abondement CPF), entretien annuel forfait jours (L3121-64), campagne d'entretiens annuels réglable (dates,
ancienneté, contrats exclus), compte rendu imprimable dès la clôture et remise de la copie tracée (main propre, refus de
signer, mise à disposition dans le portail), entretien annulé (`.ics` d'annulation) et entretien planifié à une date
dépassée compté en retard · déplacements modifiés ou annulés (historique gardé, hors du Go / No Go, Keystone prévenu) · plan de formation, enveloppes par équipe, import CSV, coût réel saisi à la
clôture d'une action, exercices passés consultables, clôture d'exercice avec report des actions engagées · sessions de formation : confirmation, modification, annulation,
clôture (présence, évaluation selon la formation, certification datée du jour de la session, absents et
échecs à replanifier, évaluation à chaud), nombre d'inscrits calculé · référentiels administrés (formations,
habilitations, destinations), archivés plutôt que supprimés, validité modifiée appliquée aux titres détenus ·
échéances au dernier jour du mois cible quand le jour n'y existe pas (29/02 + 36 mois = 28/02) · renouvellement
accepté d'une habilitation expirée compté « en attente » · exigences par poste et par équipe : une formation ou une
habilitation exigée jamais obtenue rend « Non conforme », avec une échéance « exigence manquante » (inscrire, demander
l'habilitation) et un indicateur au tableau de bord ; postes créés depuis les intitulés déjà saisis, choisis en liste ·
compte professionnel de prévention (C2P) : nuits comptées d'après les horaires de poste des feuilles validées (1 h au moins
entre 0 h et 5 h ; 120 nuits par an, 50 en équipes successives alternantes, au prorata du contrat), horaires de nuit à
qualifier, facteurs du poste cochés par le service RH ou le référent HSE, synthèse annuelle et export « à saisir dans la DSN »
(codes à confirmer par la paie) · Passeport de prévention : formations santé-sécurité marquées au catalogue (SST, CACES,
ATEX, électrique, AIPR, EPI, hauteur, PRAP, modifiable), lignes à déclarer de l'année dans l'écran Formations, suivi
« déclarée le » pour ne pas déclarer deux fois, export CSV tracé au gabarit de colonnes réglable (format de la plateforme à
confirmer, aucun NIR).

Interface fiable : une réponse arrivée après une plus récente ne réaffiche pas un état ancien (révision de la base dans
chaque instantané) · deux personnes qui modifient la même fiche ne s'écrasent plus (seuls les champs modifiés partent,
refus nommant les champs changés entre-temps, fiche à reprendre sans perdre sa saisie) · équipe renommée et manager changé
en une seule action · impression sans fenêtre surgissante, en A4 clair, avec l'en-tête de l'employeur (responsable du
traitement) et les matricules ; Ctrl+P lisible sur tous les écrans · déplacements importés sans référence numérotés
DD-<n°>, demandeur gardé.

Jours fériés et périodes de référence (CP, RTT, campagnes) calculés à partir de la date du jour, celle de Paris
quel que soit le fuseau du serveur ; dates impossibles (« 31/02 ») refusées à la saisie et à l'import.

Architecture et conventions : `docs/ARCHITECTURE.md`. Travail restant, priorisé : `docs/RESTE_A_FAIRE.md`. Guide des
utilisateurs, par rôle, avec la procédure mensuelle de paie et le groupe pilote : `docs/GUIDE-UTILISATEUR.md`.

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` à la racine construit l'interface et lance le serveur en production. Réglages à donner à l'hébergeur :

| Réglage | Valeur |
| --- | --- |
| Port interne | `3000` |
| Volume persistant | `/data` : base SQLite `cursus.db`, ses sauvegardes (`/data/backups`) et, une fois activées, les pièces justificatives (`/data/pieces`). Avec `DATABASE_URL` (serveur PostgreSQL commun), la base n'est plus dans `/data`, mais le volume reste nécessaire aux pièces justificatives |
| Adresse | en `https://` : le cookie de session est marqué `Secure` en production |
| Variables obligatoires | `CURSUS_SECRET` et `KEYSTONE_API_KEY` ; les autres selon les intégrations (tableau ci-dessus) |
| Journaux | onglet « Logs » de l'application : une ligne JSON par message et par requête (`CURSUS_LOG_FORMAT=json` par défaut en production), que l'agrégateur du service informatique collecte sans réglage |
| Compression | faite par Cursus (brotli, sinon gzip) : rien à activer dans Coolify. Si l'on active la compression du proxy de Coolify, poser `CURSUS_COMPRESSION=0` |
| Sonde de santé | celle du `Dockerfile` (`/api/health`, toutes les 30 s) : la laisser active ; ses appels réussis ne remplissent pas les journaux |

Dans le conteneur, Cursus écoute sur toutes les interfaces (`CURSUS_HOST=0.0.0.0`) : le proxy de l'hébergeur, placé
dans un autre conteneur, doit pouvoir le joindre. Il ne croit les en-têtes `X-Forwarded-*` que des adresses privées du
réseau Docker (`CURSUS_TRUST_PROXY=loopback,uniquelocal`), où se trouve le proxy de Coolify : c'est ce qui lui fait reconnaître
le HTTPS et l'adresse réelle des utilisateurs. Le mode démonstration est refusé derrière ce proxy : la connexion passe
par les comptes nominatifs (premier administrateur créé avec `npm run comptes` dans le conteneur, `docs/DEPLOIEMENT.md`),
puis par Microsoft 365 une fois configuré (`docs/CONNEXION-MICROSOFT.md`).

**Instance de démonstration en ligne.** Pour montrer Cursus avant la mise en service, `CURSUS_DEMO=1` avec
`CURSUS_DEMO_PUBLIQUE=1` admet la démonstration derrière le proxy : 24 salariés fictifs chargés dans une base vide, espace RH
ouvert sans mot de passe à qui atteint l'adresse, avertissement à chaque démarrage. L'accès se restreint en amont
(authentification HTTP de Coolify, liens diffusés à quelques personnes) ; `CURSUS_SECRET` et `KEYSTONE_API_KEY` restent
exigées. Jamais avec de vraies données : au passage en production, arrêter l'instance, vider les données fictives en
gardant le paramétrage saisi pendant la démonstration (`npm run purge-demo -- --a-blanc`, puis `npm run purge-demo --
--yes` : copie avant-purge, transaction, premier vrai salarié EMP-1001), retirer les variables de démonstration, puis
créer le premier administrateur (`docs/DEPLOIEMENT.md`, « Passage de la démonstration à la production » : nouvelle
application Coolify « cursus-prod » sur un espace neuf, alimentée par la base purgée). Une base purgée ou exploitée
refuse ensuite le mode démonstration.

**Passage en production.** La bascule de la démonstration vers la production (nouvelle application Coolify
`cursus-prod`, gel et purge de la démonstration, pré-vol `npm run verifier-production`, premier administrateur, reprise
Lucca, retrait de l'authentification basique en dernier), le tableau des secrets, les réglages Traefik et le retour
arrière sont décrits pas à pas dans `docs/BASCULE-PRODUCTION.md`.

**Déclaration du schéma à Matrix.** Au démarrage, une fois les migrations faites, Cursus lit le schéma réel de sa base
(tables, colonnes, clés, unicités) et l'envoie à Matrix, le catalogue des bases de Keystone, Codex, Cursus et Vigie
(`POST {MATRIX_URL}/api/declarations`, contrat `matrix.schema/1` ; `server/src/integrations/matrix.ts`). Une table
ajoutée entre ainsi d'elle-même au catalogue. La table technique `migrations` n'est pas déclarée. L'envoi ne bloque
jamais le démarrage : si Matrix est arrêté ou refuse la déclaration, Cursus démarre normalement et écrit un
avertissement `[matrix]` dans sa console.

| Variable | Effet |
| --- | --- |
| `MATRIX_URL` | Adresse de Matrix (`https://matrix.votre-domaine`). Derrière l'authentification HTTP de Coolify : `https://identifiant:mot-de-passe@matrix.votre-domaine` (envoyés en `Authorization: Basic`). Sans elle, rien n'est envoyé (tests, poste local) |
| `MATRIX_TOKEN` | Jeton partagé avec Matrix (même valeur que `MATRIX_TOKEN` sur le serveur Matrix), envoyé dans l'en-tête `X-Matrix-Token` |
| `MATRIX_DECLARATIONS_DIR` | Facultatif : écrit aussi la déclaration dans ce dossier (`cursus.json`), pour un volume partagé ou un poste sans réseau |
