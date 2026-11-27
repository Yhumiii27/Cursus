# Norma — journal des versions

## 3.1.0 — 27 novembre 2026

Décisions du propriétaire du même jour : l'outil des équipes d'ingénierie, construit en sortant des éléments d'ingénierie de
Keystone, s'appelle **Ingenium** (ING-01, réponse en séance) ; le dépôt `Yhumiii27/ingenium` est créé (ING-02).

- **Registre** (`registre/outils.json`) : ligne `ingenium` — schéma `ingenium`, rôle `ingenium_app`, ports 4000 / 4010,
  dépôt `Yhumiii27/ingenium`, connexion par Clavis (`ENTRA_ISSUER`, `INGENIUM_ACCESS_FROM_CLAVIS=on`), commits en anglais ;
  champ facultatif `domaine` (adresse publique dans Coolify), posé pour Ingenium : `ingenium.projectdirection.fr`.
- `REGLES.md` § 1 (tableau de la suite) et § 2 (langue des commits) ; `README.md`.
- **Logo** `charte/logos/ingenium.svg` (tuile carmin, compas de dessin traçant un arc) et entrée `ingenium` de `ToolLogo`
  (`ToolCode`, `TOOL_CODES`).
- **Tronc commun des menus** (`charte/COQUE.md` § 2 bis, `ds/base-nav.ts`, `ds/BaseNav.tsx`, `ds/taches-fr.ts`) : accueil
  « Ma discipline », entrées Mes projets (`FolderUser`, `/my/projects`) et Référentiel technique (`Gear`, `/reference`,
  source « Technical reference ») ; icône `Gear` ajoutée.
- **Suivi** : `reste-a-faire/ingenium.json` (livraisons 0 à 5, mise en service, points de Keystone qui suivraient
  l'ingénierie selon ING-03) ; `decisions/ingenium.json` : ING-01 et ING-02 décidées, nom pris au registre ;
  `OUTILS_A_VENIR` vide (`outils/suivi/build.mjs`, `decisions/SCHEMA.md`, `test/suivi.test.mjs`).
- **Version mineure** : aucun outil ne change son code ; chacun reprend la copie à sa prochaine mise à jour de Norma.

## 3.0.0 — 27 novembre 2026

Décisions du propriétaire : « Supprime les appellations […] de tous nos fichiers : pour le moment l'outil n'est pas approuvé
au niveau groupe » — la suite s'appelle **Atrium** ; « Fais un seul artifact pour la liste des décisions et le
questionnaire où tu attends des réponses de ma part ; tiens-le à jour au fur et à mesure. C'est cet artifact qui nous fera
suivre tous les softs au même endroit. »

- **Suite Atrium** : plus aucune appellation de l'ancienne suite ni de l'entreprise dans Norma (règles, charte, registre,
  outils, propositions, reste à faire, journal — anciennes entrées comprises, sens gardé). Là où un texte nommait
  l'entreprise, il dit « l'entreprise », « le groupe », « l'ingénierie », « Keystone » pour ses projets, ou rien ; l'entité
  partenaire de Crucible est « l'entité partenaire ». `REGLES.md` § 1 donne le nom de la suite.
- **Cookie d'affichage** `atrium-theme` (`charte/ds/theme.ts`) : seul nom **écrit** (`themeCookie`) ; l'ancien nom reste
  **lu** à défaut du nouveau pendant la transition (`LEGACY_THEME_COOKIE`, `THEME_COOKIES_READ`, `themeFromCookies`,
  `themeFromCookieHeader`), à retirer en 4.0 ; événement `THEME_EVENT` = `atrium-theme` ; glisser-déposer de « Mes tâches »
  `application/x-atrium-task`. `charte/README.md` : le serveur lit le thème par `themeFromCookies`.
- **Serveur commun** : noms cibles au registre (`registre/outils.json`, `serveur_commun` : base `atrium`, hôte
  `atrium-postgres`, `/etc/atrium/`, rôle `atrium_sauvegarde`) et `REGLES.md` § 9. **Le serveur en service n'est pas
  renommé par cette version** : Matrix le fait dans une opération séparée (MX-N11, question `matrix:REN-1`).
- **Page unique « Suivi Atrium »** (`outils/suivi/`, `npm run suivi` → `.artifacts/suivi.html`, `RESTE-A-FAIRE.md` ;
  `npm run reste-a-faire` en est un alias) : onglets « À décider » (réponse enregistrée dans la base de l'artefact,
  collection `answers`, un document par question, même forme que les anciens questionnaires ; lecture seule sans base),
  « Décidé » et « Reste à faire », une carte par outil (questions à décider, points restants). Publiée à l'adresse
  d'artefact de la suite avec les capacités `db` et `user`.
- **Décisions** `decisions/<outil>.json` (schéma `decisions/SCHEMA.md`, contrôle `validerDecisions`) : un fichier par outil
  du registre, `norma.json` et `ingenium.json` (outil d'ingénierie en cadrage). Repris : questionnaires d'Arche, Crucible,
  Modulus, Vector (dépôts sur `main`), de l'outil d'ingénierie et `propositions/questionnaire-taches` (décidé) ; réponses
  déjà données dans les pages d'Arche, Crucible et Modulus (source « questionnaire <outil> ») ; questions ouvertes des
  sessions (Keystone R-N01, Vigie VG-N04, Codex O-12 et dossier du personnel, Cursus CU-037, CU-142, CU-051, Arche dépôt
  dans Codex, Clavis DR-7 à DR-13, DM-2, DM-3, Matrix REN-1, suite : déploiement du tronc commun, transport des e-mails,
  ajustement de TA-2).
- `REGLES.md` § 3 : une seule page de suivi ; toute question pour le propriétaire va dans `decisions/<outil>.json` ; les
  pages de questionnaire des outils ne sont plus publiées (le modèle `outils/questionnaire/` reste distribué).
- Tests : `test/theme.test.mjs` (nom écrit, ancien nom lu, priorité du nouveau), `test/suivi.test.mjs` (schéma, un fichier
  par outil, ids uniques, réponses reprises, page, aucune ancienne appellation).
- **Reste à faire** : NO-010 et NO-011 faits ; un point d'adoption par outil (R-N06, CX-N10, AR-N06, VG-N10, CR-N08,
  CU-N08, CL-N10, MX-N10, MO-N03, VE-N03) ; MX-N11 (renommage du serveur commun).
- **Version majeure** : chaque outil change son code — lecture du thème par `themeFromCookies` (sinon l'ancien réglage est
  ignoré), tests qui citent l'ancien nom du cookie, textes de l'outil.

## 2.4.0 — 27 novembre 2026

Décision du propriétaire : « le tronc commun des menus n'est pas disponible sur tous les sites. Je veux dans ce tronc commun
les menus suivants : 1- Accueil ; 2- Mes tâches (sous le même format que Teams, un affichage en liste, un en kanban et un en
calendrier) ; 3- Mes approbations. […] les tâches et approbations doivent montrer toutes les tâches et toutes les
approbations qu'un utilisateur a même si la provenance est d'un autre outil. » Elle tranche TA-11, TA-15 et TA-16 ; le
propriétaire a confirmé le même jour la réponse proposée pour TA-1 à TA-10, TA-12, TA-13 et TA-14
(`propositions/TACHES-ET-APPROBATIONS.md` § 7 bis).

- **Tronc commun des menus** (`charte/COQUE.md` § 2 bis) : premier bloc de la barre latérale, sous ⌘K — Accueil (typé selon
  l'outil : contenu fixé pour les dix outils), Mes tâches, Mes approbations, puis une ou deux entrées métier par outil
  (tableau § 2 bis.3) ; mêmes place, ordre, icônes Phosphor (`House`, `CheckSquare`, `Stamp`) et libellés partout ;
  pastilles = tâches et approbations ouvertes de toute la suite.
- **Composants** `charte/ds` : `BaseNav` (rendu) et `base-nav.ts` (modèle pur : `BASE_ENTRIES`, `TOOL_BASE`, `baseNav`,
  `activeEntry`, `baseNavProblems`) ; `MyTasks` — liste groupée et triable, kanban À faire · En cours · En attente · Fait
  (déplacement seulement par une transition ouverte par l'outil propriétaire, boutons clavier), calendrier mois / semaine ;
  `MyApprovals` — filtres outil, type, échéance ; Approuver / Refuser seulement quand la décision peut être prise ici ;
  `TaskSource`, `DueText`, `StateTag`, `OpenInTool`, `SourcesBanner` ; règles pures `task-rules.ts` ; français des
  libellés `taches-fr.ts` (`TACHES_FR`). Données par les props, rien n'est chargé par la charte.
- `coque.css` : classes `.coque-base-nav`, `.coque-task-*`, `.coque-kanban-*`, `.coque-cal-*`, `.coque-appr-*`,
  `.coque-sr-only` (variables seulement) ; ≤ 1024 px, le kanban défile en largeur.
- **Contrat** `contrats/taches-v1.md` (nouveau dossier distribué aux outils) : `<outil>.pub_taches` v1 (24 colonnes),
  `matrix.pub_taches` et `matrix.pub_taches_sources` (Matrix), échange de jeton RFC 8693 chez Clavis (prérequis de la
  phase 2), `GET /api/v1/taches/{tache_id}` et `POST /api/v1/taches/{tache_id}/decision` (motif, version, clé
  d'idempotence, contrôles et journal de l'outil propriétaire, codes 401 à 503), phases 1 à 3. `REGLES.md` § 5 et § 7.
- Plan de déploiement `propositions/DEPLOIEMENT-TRONC-COMMUN.md` (par outil, pilote Keystone + Codex + Arche) ;
  questionnaire `questionnaire-taches` : questions marquées décidées.
- Tests `test/taches.test.mjs` : tronc commun pour chaque outil du registre, colonnes du contrat = `PUB_TACHES_COLUMNS`,
  règles des vues (échéances, tri, kanban, calendrier), décisions possibles ici, traduction française de chaque libellé.
- **Reste à faire** : NO-009 en cours ; un point d'adoption par outil (R-N05, CX-N09, AR-N05, VG-N09, CR-N07, CU-N07,
  CL-N08, MX-N08, MO-N02, VE-N02), MX-N09 (réunion `matrix.pub_taches`), CL-N09 (échange de jeton).
- **Version mineure** : rien n'est retiré ni changé dans les exports existants ; un outil reprend la copie (`copier`) sans
  changer son code et passe `verifier`. L'adoption du tronc commun est suivie par outil dans le reste à faire, comme les
  logos de 2.3.0.

## 2.3.0 — 25 novembre 2026

Logos des outils, validés par le propriétaire (page de proposition du 25 novembre 2026).

- **`charte/logos/<code>.svg`** : un logo par outil du registre (Keystone, Codex, Vigie, Cursus, Arche, Crucible, Clavis,
  Matrix, Modulus, Vector) — tuile de 64 × 64, dégradé propre à l'outil, glyphe blanc.
- **`charte/ds/ToolLogo.tsx`** : le logo en composant (`<ToolLogo code="arche" />`, identifiants de dégradé uniques).
- **Marque** : `Sidebar` et `MobileTopBar` prennent `logo` (prioritaire) ; `icon` devient facultatif (compatibilité).
  `coque.css` : `.coque-logo-mark` (26 px) et `.coque-topbar-mark` (20 px).
- **Favicon** : le SVG de l'outil (`COQUE.md` § 8 bis).

## 2.2.0 — 24 novembre 2026

Retours des outils pendant leur alignement sur la coque commune (Crucible, Keystone, Vigie, Codex).

- **En-tête de page passé à la ligne** (`coque.css`, `.coque-header`) : `justify-content: flex-end` — la seconde ligne
  (recherche, actions, date, cloche, paire langue / affichage) reste alignée à droite ; le bloc du titre garde la gauche par
  sa marge automatique, sur une ligne comme sur deux (vérifié sur une page d'essai à 1400 et 1100 px).
- **Indication ⌘K lisible en affichage clair** (`.coque-kbd`) : `--color-neutral-400` au lieu de `--color-neutral-500`
  (3,9:1 en clair, relevé par axe dans Codex) ; contraste AA vérifié dans les deux affichages, sur la surface et le fond.
- **Une seule cloche visible ≤ 1024 px** : quand la barre supérieure porte la cloche (`.coque-bell`), celle de l'en-tête de
  page est masquée (`.coque:has(.coque-topbar .coque-bell) .coque-header .coque-bell`).
- `COQUE.md` § 2, § 3 et § 8 : règle du passage à la ligne, couleur de ⌘K, une seule cloche.
- Tests `test/coque.test.mjs` : en-tête passé à la ligne, contraste de ⌘K (sombre et clair), cloche unique.
- **Reste à faire** : coque reprise par Clavis, Matrix, Arche, Crucible, Vector, Codex, Cursus et Keystone (points
  « Coque commune » faits), Vigie en revue (Vigie#44) ; R-N02, CU-191, VG-N03, VG-N05 à VG-N07, NO-006 faits, VG-N01 en
  cours ; nouveaux points R-N04 (écran Plan à 390 px), CU-N06 (tableau du tableau de bord RH à 390 px), CX-N08 (CLAUDE.md
  de Codex cite `ThemeToggle.tsx`).
- Version mineure : un outil reprend la copie (`copier`) sans changer son code.

## 2.1.0 — 24 novembre 2026

À la demande du propriétaire (« oui » à la demande DN-1 de Vector) : un dixième outil dans la suite.

- **Registre** : `vector` (Vector, expéditions nationales et internationales : demandes, colisage, transport, douane,
  documents, suivi, coûts), dépôt `Yhumiii27/vector`, schéma `vector`, rôle `vector_app`, ports 3900 (dev) et 3910
  (tests), connexion `ENTRA_ISSUER` et `VECTOR_ACCESS_FROM_CLAVIS=on`, commits en anglais.
- `REGLES.md` § 1 et § 2 : ligne Vector au tableau de la suite, Vector parmi les outils aux commits en anglais ;
  `README.md` : Vector dans la liste des outils.
- **Reste à faire** : `reste-a-faire/vector.json` (repris de `docs/reste-a-faire-vector.json` de Vector : livraisons VE-L0
  à VE-L6, plus VE-N01 « Coque commune Norma 2.0 ») ; identifiants `VE-L<n>` dans `SCHEMA.md`.
- Mise à jour du reste à faire de la solution (Arche, Crucible, Clavis, Matrix, Codex, Cursus, Vigie, Modulus, Norma).
- Version mineure : un outil reprend la copie (`copier`) sans changer son code ; Vector peut passer `npm run norma:check`.

## 2.0.0 — 24 novembre 2026

À la demande du propriétaire : « un audit du design de toutes les pages de tous les softs afin d'aligner proprement tous
les designs. Ce qui est commun à tous les outils doit se retrouver à la même place dans toutes les pages », puis « les
boutons de changement de langue et thème clair/sombre alignés l'un au-dessus de l'autre et de même taille ».

- **Audit** : `charte/AUDIT-2026-11-24.md` — matrice des écarts (9 outils × 20 éléments de la coque) et, par outil, la liste
  des fichiers à changer. Deux défauts relevés : Arche et Clavis n'ont plus de menu sous 1024 px.
- **Coque commune** : `charte/COQUE.md` (contrat, reprise de Keystone `f412d0e`) et `charte/coque.css` (classes `.coque-…`,
  variables seulement, utilisables sans React). Barre latérale 232 px (marque, ⌘K, sections, compte en pied) ; en-tête de
  chaque page dans un ordre fixe — fil et titre `<h1>` 26 px · recherche globale · actions (principale à droite, menu
  « Actions » au-delà de trois) · date · aide · cloche · **langue / affichage** ; barre d'outils (onglets `Segmented`,
  filtres, période, note) ; panneau latéral 640 px ; barre supérieure et tiroir ≤ 1024 px.
- **Langue et affichage empilés, de même taille** : `PrefsStack` = `LangSwitch` (FR | EN) au-dessus de `ThemeSwitch`
  (☾ | ☀), deux options de 36 × 26 px chacun, bords alignés ; dernier élément à droite de l'en-tête de page, et de la barre
  supérieure ≤ 1024 px ; jamais dans la barre latérale. Un outil sans anglais garde le bloc, EN désactivé.
- **Jetons** dans `nocturne.css` : échelle des textes (`--text-micro` 10 px … `--text-title` 26 px, `--weight-strong`,
  `--tracking-caps`) et mesures de la coque (`--shell-*`, `--control-h`, `--touch-target`, `--pref-*`, `--panel-w*`).
- **Composants** `charte/ds` : `AppShell`, `MobileTopBar`, `Sidebar`, `PageSearch`, `NavList`, `NavSections`, `NavSection`,
  `NavGroup`, `NavEntry`, `PageHeader`, `HeaderActions` (+ `HeaderMenuContext`), `HeaderTools`, `PrefsStack`, `LangSwitch`,
  `ThemeSwitch`, `StatusDate`, `FilterBar`, `FilterGroup`, `FilterLabel`, `FilterNote`, `FilterChips`, `KpiGrid`, `KpiTile`,
  `EmptyState`, `SidePanel` (= `Drawer`) ; règles pures `coque-rules.ts` (`splitActions`, `matchPages`). `ThemeToggle` est
  gardé, déprécié (retrait en 3.0).
- `REGLES.md` § 7 : « ce qui est commun est au même endroit dans tous les outils », renvoi à `COQUE.md` ; paire empilée.
- Tests `test/coque.test.mjs` (jetons, aucune couleur en dur, classes posées = classes définies, exports, paire empilée et
  dernière, ordre de l'en-tête, règles pures) ; Node 22.18 au moins (`engines`) pour les `.ts` des tests.
- Reste à faire : NO-007, et un point « Coque commune Norma 2.0 » par outil.
- **Version majeure** : chaque outil change son code (coque, en-tête, place de la langue et de l'affichage) — voir
  l'audit § 2.

## 1.2.0 — 24 novembre 2026

À la demande du propriétaire : un standard commun plutôt que des copies d'un outil à l'autre.

- **Questionnaire du responsable produit** dans le socle : `outils/questionnaire/build.mjs` (sans dépendance) et
  `page.template.html` (reprise du modèle de Crucible et Modulus, le plus récent ; palette Nocturne sombre et clair,
  `outils/pages/nocturne-page.css`, contrastes AA testés). Réglé par `scripts/questionnaire/config.json` de l'outil ;
  questions contrôlées (ids uniques, groupe connu, champs obligatoires). Réponses inchangées (collection `answers`).
  Distribué aux outils par `copier` (`outils/questionnaire`, `outils/pages`).
- **Reste à faire de la solution** : `reste-a-faire/<outil>.json` (schéma `reste-a-faire/SCHEMA.md`, repris de Keystone),
  générateur `outils/reste-a-faire/build.mjs` (`npm run reste-a-faire` → `RESTE-A-FAIRE.md`, `.artifacts/reste-a-faire.html`).
  Reprise : copie fidèle de Keystone, Arche, Crucible ; conversion des listes de Codex, Vigie, Cursus, Matrix, Clavis et
  Modulus ; écarts de l'audit Norma du 24 novembre (PR d'adoption de chaque outil) en catégorie « alignement Norma ».
- `REGLES.md` § 3 : la liste se tient dans Norma (plus de page « reste à développer » par outil) ; questionnaire par le
  modèle de Norma. Version mineure : un outil reprend la copie, puis remplace ses scripts `remaining:page` et
  `questionnaire:page` (voir `README.md`).

## 1.1.0 — 24 novembre 2026

- `charte/ds/ThemeToggle.tsx` : nom du groupe `t('Dark / light display')` (traduit « Affichage ») au lieu de
  `t('Display')`, déjà traduit « Vue » dans Keystone (une clé n'a qu'une traduction). Version mineure : un outil qui
  utilise ce composant ajoute la nouvelle clé à son dictionnaire français.

## 1.0.3 — 24 novembre 2026

- `dependances.json` : `cytoscape` (graphe des liens de Matrix) et `rolldown` (tests de rendu de Cursus) autorisées.
- `registre/outils.json` : ports de Cursus nommés d'après leur usage (`dev` 3210 = API et serveur, `vite` 5173,
  `app_mac` 3217) au lieu d'un `api: 3217` trompeur.

## 1.0.2 — 24 novembre 2026

- `nocturne.css` : en thème clair, `figcaption`, `.text-muted` et `.card-meta` à 68 % du texte (3,7:1 → 5,2:1, seuil AA) ; relevé par
  l'a11y de Codex (plus de 400 violations en clair).
- `charte/README.md` : contraste en clair (rampe neutre inversée : texte en neutral-400 ou plus foncé).

## 1.0.1 — 24 novembre 2026

- `charte/ds/Segmented.module.css` : une option à icône seule (bouton d'affichage) a la même hauteur qu'une option
  texte (FR / EN) ; constaté par l'alignement d'Arche, qui l'avait compensé localement.

## 1.0.0 — 24 novembre 2026

Première version, à la demande du propriétaire (un dépôt pour le socle commun plutôt qu'une copie par outil).

- `REGLES.md` : règles communes rassemblées depuis les `CLAUDE.md` de Keystone, Arche, Crucible, Clavis, Codex, Vigie,
  Cursus et Matrix (langues, travail dans les dépôts, PostgreSQL commun, échanges M-17 / M-18 / M-19, Clavis, charte,
  dépendances, exploitation, ce que Claude fait seul).
- `charte/` : Nocturne de Keystone `13659c8` (`nocturne.css`, `touch.css`, composants `ds/`, principes), police Inter
  locale de Codex `69e7aec`.
- `registre/outils.json` : les neuf outils (Modulus compris), schémas, rôles, ports, connexion par Clavis.
- `dependances.json` : minimums (Next.js 16.4.6), autorisées, interdites et dérogations (PGlite : Keystone, Codex, Vigie).
- `outils/norma.mjs` : `copier` et `verifier`.
- Thème clair (propriétaire, 24 novembre 2026) : variables `[data-theme="light"]` dans `nocturne.css`, cookie
  `atrium-theme`, `ds/theme.ts`, bouton `ds/ThemeToggle.tsx` à côté du sélecteur de langue.
- Dépendances de Cursus déclarées (Express, Vite, tests d'interface).
