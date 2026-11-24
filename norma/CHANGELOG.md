# Norma — journal des versions

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
