# Norma — journal des versions

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
  `epc2i-theme`, `ds/theme.ts`, bouton `ds/ThemeToggle.tsx` à côté du sélecteur de langue.
- Dépendances de Cursus déclarées (Express, Vite, tests d'interface).
