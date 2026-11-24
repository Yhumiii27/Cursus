# Norma — journal des versions

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
