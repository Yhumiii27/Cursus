# Charte graphique de la suite : Nocturne

Reprise de Keystone (commit `13659c8`, 24 novembre 2026), qui l'a construite d'après la maquette Claude Design. Police
Inter reprise de Codex (`69e7aec`), servie depuis le dépôt.

| Fichier | Contenu |
| --- | --- |
| `nocturne.css` | variables (couleurs, rampes tonales, polices, espacements, rayons, ombres) et classes de base. **Source de la charte.** |
| `touch.css` | cibles agrandies sur écran tactile |
| `nocturne-readme.md` | principes de la charte (couleur, typographie, états, composants) |
| `COQUE.md`, `coque.css` | **coque commune** (Norma 2.0) : places et mesures communes à tous les outils, classes `.coque-…` ; audit d'origine `AUDIT-2026-11-24.md` |
| `ds/` | composants React de base : `Button`, `Tag`, `Card`, `Field` / `Input` / `Select`, `Segmented`, `Table`, `Dialog`, `Drawer`, `CenteredModal`, `Popover`, `Menu`, `Toast`, `cx`, `overlay` |
| `ds/BaseNav.tsx`, `ds/MyTasks.tsx`, `ds/MyApprovals.tsx` | tronc commun des menus, « Mes tâches » (liste, kanban, calendrier), « Mes approbations » (Norma 2.4, `COQUE.md` § 2 bis, contrat `../contrats/taches-v1.md`) |
| `fonts/inter.ts`, `fonts/inter/` | Inter 4.001 en `next/font/local` (licence OFL) |

## Brancher la charte dans un outil

1. `tsconfig.json` : `"paths": { "@/*": ["./src/*"], "@norma/*": ["./norma/*"] }`.
2. Mise en page racine : `import '@norma/charte/nocturne.css'; import '@norma/charte/touch.css';` et
   `import { interClassName } from '@norma/charte/fonts/inter';` posé sur `<html className={interClassName}>`.
   Repli de police : déclarer `'Inter Fallback'` dans le CSS global de l'outil (voir `fonts/inter.ts`).
3. Composants : `import { Button, Dialog, Table } from '@norma/charte/ds';`.
4. L'outil fournit `@/i18n/client` qui exporte `useI18n()` → `{ lang, t }` : les composants traduisent leurs quelques
   libellés (« Close », « Dismiss ») par lui ; ces clés vont dans le dictionnaire français de l'outil.
5. Icônes : `@phosphor-icons/react/dist/ssr`.

## Conventions d'écran (tous les outils, Norma 2.0)

- **Coque** : le contrat est `COQUE.md` (barre latérale, en-tête de page, ordre des outils, paire langue / affichage
  empilée, barre d'outils, panneau latéral, barre supérieure) ; composants `AppShell`, `Sidebar`, `PageHeader`,
  `HeaderTools`, `PrefsStack`… de `ds/`, classes de `coque.css` (à importer après `nocturne.css` et `touch.css`).
- **Actions** : l'action principale en `primary` de l'en-tête, les autres en `actions` ; au-delà de trois, menu
  « Actions ». Filtres et navigation par période dans la barre d'outils (`toolbar`).
- **Langue et affichage** : `PrefsStack` — FR | EN au-dessus de sombre | clair, même taille, dernier élément à droite de l'en-tête (COQUE.md § 4).
- **Formulaires** : jamais ouverts dans la page ; un bouton ouvre un panneau latéral (`Drawer`), fermé au succès.
- **État d'écran dans l'URL** : onglet, filtres, sélection (`?onglet=`, `?sel=`).
- **Texte saisi** affiché tel quel (jamais `t()`).
- **Impression** : les pages imprimables cachent la coque (`aside`, `[data-print-hide]`).

## Changer la charte

Dans Norma seulement : modifier `nocturne.css` (les variables d'abord), noter le changement dans `CHANGELOG.md`, monter
la version, puis chaque outil reprend la copie (`node norma/outils/norma.mjs copier`).

## Thème sombre / clair

Le thème sombre reste celui par défaut ; le thème clair se choisit par le sélecteur d'affichage placé **sous le sélecteur
de langue FR / EN, de même taille**, à droite de l'en-tête de chaque page (propriétaire, 24 novembre 2026 ; Norma 2.0 :
`ds/HeaderTools.tsx` `PrefsStack` / `ThemeSwitch`, COQUE.md § 4).

- `nocturne.css` porte les deux thèmes : `<html data-theme="light">` redéfinit les variables (rampes inversées, accent
  plus sombre, ombres douces). Un CSS d'outil qui ne prend que des variables passe d'un thème à l'autre sans changement ;
  une couleur en dur se remplace par sa variable.
- Préférence par personne dans le cookie **`atrium-theme`** (`dark` | `light`, un an, même nom dans tous les outils) :
  `ds/theme.ts` (`THEME_COOKIE`, `themeFromCookies`, `themeFromCookieHeader`, `themeCookie`). Norma 3.0 : l'ancien nom du
  cookie d'avant le renommage de la suite (`LEGACY_THEME_COOKIE`) reste **lu** à défaut du nouveau pendant la transition,
  pour que personne ne perde son réglage ; seul `atrium-theme` est **écrit** (`themeCookie`). À retirer en 4.0.
- Le serveur lit le cookie et pose `data-theme` sur `<html>` au rendu (pas de flash) :
  `const jar = await cookies(); <html data-theme={themeFromCookies((n) => jar.get(n)?.value)}>` (ne plus lire
  `THEME_COOKIE` seul : l'ancien cookie serait ignoré).
- Le bouton : `ds/HeaderTools.tsx` `ThemeSwitch` (dans `PrefsStack`) ; l'ancien `ds/ThemeToggle.tsx`, gardé jusqu'en 4.0, (icônes lune / soleil, libellés « Dark display » / « Light display » à traduire
  « Affichage sombre » / « Affichage clair », groupe « Dark / light display » → « Affichage » (pas « Display », déjà pris par d’autres écrans dans Keystone), posé à droite du sélecteur de langue.
  Il change l'attribut et le cookie dans le navigateur, sans aller-retour au serveur.
- **Contraste en clair** : la rampe neutre est inversée ; un texte en `--color-neutral-500` ou plus clair ne fait que
  3,9:1 sur blanc (sous 4,5:1) : pour du texte, prendre `--color-neutral-400` ou plus foncé (100 à 400 en clair), ou les
  classes `.text-muted` / `.card-meta` de la charte. Vérifier chaque écran avec l'a11y de l'outil dans les deux thèmes.
- Un outil sans React (Matrix) ou avec sa propre feuille (Codex, Vigie, Cursus) applique la même convention : même
  cookie, même attribut, mêmes valeurs claires.
