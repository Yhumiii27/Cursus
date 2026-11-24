# Charte graphique de la suite : Nocturne

Reprise de Keystone (commit `13659c8`, 24 novembre 2026), qui l'a construite d'après la maquette Claude Design. Police
Inter reprise de Codex (`69e7aec`), servie depuis le dépôt.

| Fichier | Contenu |
| --- | --- |
| `nocturne.css` | variables (couleurs, rampes tonales, polices, espacements, rayons, ombres) et classes de base. **Source de la charte.** |
| `touch.css` | cibles agrandies sur écran tactile |
| `nocturne-readme.md` | principes de la charte (couleur, typographie, états, composants) |
| `ds/` | composants React de base : `Button`, `Tag`, `Card`, `Field` / `Input` / `Select`, `Segmented`, `Table`, `Dialog`, `Drawer`, `CenteredModal`, `Popover`, `Menu`, `Toast`, `cx`, `overlay` |
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

## Conventions d'écran (communes à Keystone, Arche, Crucible, Clavis)

- **Coque** : barre latérale à sections regroupées par thème, avec compteurs ; recherche de pages ⌘K ; en-tête de page
  avec titre, actions, cloche, date, sélecteur FR / EN.
- **Actions** : l'action principale en `primary` de l'en-tête, les autres en `actions` ; au-delà de trois, menu
  « Actions ». Filtres et navigation par période dans la barre d'outils (`toolbar`).
- **Affichage** : bouton sombre / clair juste à côté du sélecteur FR / EN (section « Thème sombre / clair »).
- **Formulaires** : jamais ouverts dans la page ; un bouton ouvre un panneau latéral (`Drawer`), fermé au succès.
- **État d'écran dans l'URL** : onglet, filtres, sélection (`?onglet=`, `?sel=`).
- **Texte saisi** affiché tel quel (jamais `t()`).
- **Impression** : les pages imprimables cachent la coque (`aside`, `[data-print-hide]`).

## Changer la charte

Dans Norma seulement : modifier `nocturne.css` (les variables d'abord), noter le changement dans `CHANGELOG.md`, monter
la version, puis chaque outil reprend la copie (`node norma/outils/norma.mjs copier`).

## Thème sombre / clair

Le thème sombre reste celui par défaut ; le thème clair se choisit par le bouton placé **juste à côté du sélecteur de
langue FR / EN**, dans l'en-tête de chaque outil (propriétaire, 24 novembre 2026).

- `nocturne.css` porte les deux thèmes : `<html data-theme="light">` redéfinit les variables (rampes inversées, accent
  plus sombre, ombres douces). Un CSS d'outil qui ne prend que des variables passe d'un thème à l'autre sans changement ;
  une couleur en dur se remplace par sa variable.
- Préférence par personne dans le cookie **`epc2i-theme`** (`dark` | `light`, un an, même nom dans tous les outils) :
  `ds/theme.ts` (`THEME_COOKIE`, `themeOf`, `themeCookie`).
- Le serveur lit le cookie et pose `data-theme` sur `<html>` au rendu (pas de flash) :
  `<html data-theme={themeOf(cookies().get(THEME_COOKIE)?.value)}>`.
- Le bouton : `ds/ThemeToggle.tsx` (icônes lune / soleil, libellés « Dark display » / « Light display » à traduire
  « Affichage sombre » / « Affichage clair », groupe « Display » → « Affichage »), posé à droite du sélecteur de langue.
  Il change l'attribut et le cookie dans le navigateur, sans aller-retour au serveur.
- Un outil sans React (Matrix) ou avec sa propre feuille (Codex, Vigie, Cursus) applique la même convention : même
  cookie, même attribut, mêmes valeurs claires.
