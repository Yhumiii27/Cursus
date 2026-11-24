# Coque commune des outils (Norma 2.0)

Demande du propriétaire (24 novembre 2026) : « ce qui est commun à tous les outils doit se retrouver à la même place dans
toutes les pages » — affichage clair / sombre, changement de langue, et plus largement le genre d'affichage, les polices,
les tailles de texte, les titres, les barres de choix, les boutons et la place des boutons communs. Puis : « les boutons de
changement de langue et thème clair/sombre alignés l'un au-dessus de l'autre et de même taille ».

La coque est **celle de Keystone** (`src/components/app/shell/`, commit `f412d0e`), la référence de la charte, avec deux
changements voulus : la paire langue / affichage empilée à l'extrémité droite (§ 4) et les actions de la page avant les
outils communs (§ 3). L'audit qui a mené à ce contrat : `AUDIT-2026-11-24.md`.

| Fichier | Contenu |
| --- | --- |
| `nocturne.css` | jetons ajoutés en 2.0 : échelle des textes `--text-*`, mesures de la coque `--shell-*`, `--control-h`, `--touch-target`, `--pref-*`, `--panel-w*` |
| `coque.css` | **toutes les classes de la coque** (`.coque-…`), en CSS simple : la source du rendu |
| `ds/AppShell.tsx` | `AppShell` (grille, lien d'évitement, tiroir), `MobileTopBar`, `useCoque` |
| `ds/Sidebar.tsx` | `Sidebar`, `PageSearch` (⌘K), `NavList`, `NavSections`, `NavSection`, `NavGroup`, `NavEntry` |
| `ds/PageHeader.tsx` | `PageHeader` |
| `ds/HeaderActions.tsx` | `HeaderActions` (menu « Actions » au-delà de trois), `HeaderMenuContext` |
| `ds/HeaderTools.tsx` | `HeaderTools`, `PrefsStack`, `LangSwitch`, `ThemeSwitch`, `StatusDate` |
| `ds/FilterBar.tsx` | `FilterBar`, `FilterGroup`, `FilterLabel`, `FilterNote`, `FilterChips` (onglets : `Segmented`) |
| `ds/Kpi.tsx`, `ds/EmptyState.tsx` | `KpiGrid`, `KpiTile`, `EmptyState` |
| `ds/index.ts` | `SidePanel` = `Drawer` (panneau latéral des formulaires) |

Les composants React posent les classes de `coque.css` ; un outil sans React (Matrix) ou dont le client n'est pas en
Next.js (Cursus, Vite + React : les composants qui n'utilisent pas `next/link` / `next/navigation` s'y reprennent, sinon le
HTML) écrit **le même HTML avec les mêmes classes**. Brancher : `import '@norma/charte/nocturne.css';
import '@norma/charte/touch.css'; import '@norma/charte/coque.css';` dans la mise en page racine (ou trois `<link>`).

## 1. Genre d'affichage et grille

```
┌──────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ barre        │  en-tête de page                                                    [FR|EN] │
│ latérale     │  fil › … · Titre de page   [recherche]  [actions]  [date · aide · 🔔] [☾|☀] │
│ 232 px       │  barre d'outils : onglets · filtres · période · note                         │
│ (sticky,     │                                                                              │
│  100 vh)     │  contenu (blocs : tuiles KPI, cartes, tableaux) — gap 18 px                   │
└──────────────┴──────────────────────────────────────────────────────────────────────────────┘
```

- Application à **barre latérale fixe + colonne de contenu** (`.coque`, grille `var(--shell-sidebar-w) minmax(0,1fr)`), fond
  `--color-bg` avec le halo d'accent en haut à droite. Pas de barre d'en-tête globale au-dessus des pages : **chaque page
  porte son en-tête** (`PageHeader`), qui porte les outils communs.
- Contenu `.coque-main` : colonne, `gap: var(--shell-gap)` (18 px), marges `var(--shell-main-pad)` (20 / 28 / 40 px), largeur
  libre (pas de `max-width` de page).
- ≤ 1024 px (tablette et téléphone, un seul point de rupture) : une colonne, barre latérale en tiroir (`--shell-drawer-w`,
  300 px au plus), barre supérieure collante (§ 8), marges `var(--shell-main-pad-compact)`, gap 14 px. Cibles tactiles de
  40 px (`--touch-target`) ≤ 1024 px ou pointeur grossier.
- Impression : la coque disparaît (`aside`, barre supérieure, outils et actions de l'en-tête, `[data-print-hide]`).

## 2. Barre latérale (`Sidebar`)

De haut en bas, padding 18 / 14 px, gap 14 px, bordure droite `--color-neutral-900` :

1. **Marque** (`.coque-brand`) : carré de 26 px à bord d'accent avec halo et glyphe Phosphor de 15 px, puis le nom de
   l'outil, 16 px (`--text-brand`), poids 500. ≤ 1024 px : bouton × « Fermer le menu » à droite.
2. **Recherche de pages ⌘K** (`PageSearch`, `.coque-pagesearch`) : champ 32 px, 12,5 px, loupe à gauche, `⌘K` à droite ;
   ⌘K / Ctrl+K y met le focus, Entrée ouvre la première page trouvée, Échap vide ; pendant la saisie les résultats
   (page + section) remplacent le menu. **Toujours juste sous la marque.**
3. **Entrées fixes** (`NavList` + `NavEntry`) : Accueil, Mon travail… — 13 px, padding 7 / 8 px, rayon 8, icône 16 px,
   `--color-neutral-300` ; page courante `aria-current="page"` : fond `--color-accent-900`, texte `--color-accent-300` ;
   pastille de compte `--color-accent-800` / `--color-accent-100`, 11 px.
4. **Sections par thème** (`NavSections` + `NavSection`) : titre en capitales 10,5 px (`--text-eyebrow`, `--tracking-caps`),
   `--color-neutral-500` (plus clair, `bright`, quand la page courante y est), chevron 11 px, compte et pastille ; ligne de
   contexte en option (projet, CAPEX, site choisi) ; entrées `NavEntry item` ; sous-groupe `NavGroup` (capitales 10 px,
   filet dégradé). Repliables, état gardé par l'outil (cookie).
5. **Pied** (`footer`, `.coque-side-foot`, poussé en bas) : la personne connectée (`.coque-user` : avatar 28 px, nom 13 px,
   rôle 11 px, caret) qui ouvre le menu du compte (rôles, déconnexion) — en démonstration, le même bloc ouvre « Voir en
   tant que ». **Ni la langue ni l'affichage dans la barre latérale.**

Sélecteurs propres à un outil (site de Vigie, CAPEX d'Arche, projet de Keystone) : dans la section qu'ils concernent ou sous
le fil d'Ariane de l'en-tête, jamais à la place des éléments ci-dessus.

## 3. En-tête de page (`PageHeader`)

Une ligne `.coque-header` (flex, `align-items: flex-end`, gap 16 px, passe à la ligne si besoin), **ordre fixe** :

| # | Élément | Mesures |
| --- | --- | --- |
| 1 | **Fil d'Ariane** (`crumbs`, `.coque-crumb`) : section › sous-page › objet ; le nom de l'outil n'y est pas (il est dans la marque) | 12 px, `--color-neutral-400`, séparateur `/` `--color-neutral-600` |
|   | **Titre** (`title`) : le seul `<h1>` de la page, suivi de ses étiquettes (`titleAside` : santé, statut, « Lecture seule ») | 26 px (`--text-title`), poids 500 ; 22 px ≤ 1024 px |
|   | **Sous-titre** en option | 12,5 px, `--color-neutral-400` |
| 2 | **Recherche globale** de l'outil (`search`), quand il en a une | 220 à 360 px, champ 32 px, 12,5 px |
| 3 | **Actions de la page** (`actions`, `primary`, § 3.3) | boutons `sm` |
| 4 | **Outils communs** (`HeaderTools`, ordre fixe) : date de situation · aide / assistant · cloche | date 12 px ; boutons-icônes nommés |
| 5 | **Langue / affichage empilés** (`PrefsStack`, § 4) — **toujours le dernier élément, à l'extrémité droite** | 74 × 56 px |

Sous l'en-tête : le bandeau « Hors de mon espace · Lecture seule » (`outside`, `.coque-outside`, les actions disparaissent),
puis la **barre d'outils de la page** (`toolbar`, § 5).

### 3.3 Actions de la page

- Toutes les actions de la page sont dans l'en-tête, jamais dans le corps de page (sauf l'action d'une ligne de tableau ou
  d'une carte) : **action principale `primary` = bouton `primary` (contour d'accent), la plus à droite des actions** ;
  autres actions `secondary` à sa gauche ; export (menu CSV / XLSX / PDF) = une action secondaire.
- Au-delà de **trois** boutons en tout : l'action principale reste un bouton, les autres vont dans le menu « Actions »
  (bouton `secondary` ⋮ ▾, à gauche ; `HeaderMenuContext` permet à un bouton d'action de se rendre en ligne de menu).
- Une action qui ouvre un formulaire ouvre un **panneau latéral** (§ 7), fermé au succès.

## 4. Langue et affichage : deux sélecteurs empilés, de même taille

Demande du propriétaire (24 novembre 2026). `PrefsStack` = `LangSwitch` au-dessus de `ThemeSwitch` :

```
 ┌────┬────┐
 │ FR │ EN │   sélecteur de langue   (role="group", aria-label « Langue »)
 ├────┼────┤   écart 4 px (--pref-gap)
 │ ☾  │ ☀  │   affichage sombre | clair (role="group", aria-label « Affichage »)
 └────┴────┘
   36 px × 2 (--pref-opt-w), hauteur 26 px chacun (--pref-h) : 74 × 56 px, bords gauches alignés
```

- **Place** : > 1024 px, dernier élément à droite de l'en-tête de page de **toutes** les pages (bas aligné avec les
  boutons) ; ≤ 1024 px, dernier élément à droite de la **barre supérieure** (celui de l'en-tête est masqué). Jamais dans la
  barre latérale, jamais ailleurs.
- **Même taille** : deux options par sélecteur, de largeur fixe 36 px, hauteur 26 px (au-dessus du minimum de 24 px de
  WCAG 2.5.8, même en tactile : la paire garde sa taille partout). Texte 12 px ; icônes Phosphor `Moon` / `Sun` 14 px.
- **État** : option choisie `aria-pressed="true"`, texte d'accent et liseré intérieur d'accent ; survol 7 % du texte ;
  focus visible (contour d'accent) ; Tab passe d'une option à l'autre, Espace / Entrée choisit.
- **Noms accessibles** : FR / EN portent `lang` et le titre « Français » / « English » ; ☾ / ☀ portent « Affichage sombre » /
  « Affichage clair » (`t('Dark display')`, `t('Light display')`) ; groupes `t('Language')`, `t('Dark / light display')`.
- **Langue** : `LangSwitch onSelect` (Server Action qui pose le cookie de langue de l'outil) puis rafraîchissement. Un outil
  dont l'interface n'existe qu'en français (Vigie, Cursus aujourd'hui) garde **le même bloc**, EN désactivé
  (`available={['fr']}`), jusqu'à ce que son i18n soit en place (Norma § 2).
- **Affichage** : cookie `epc2i-theme`, `data-theme` sur `<html>` posé par le serveur (inchangé, voir `README.md`) ; le
  changement est diffusé (`THEME_EVENT`) pour que les deux copies (en-tête, barre supérieure) restent d'accord.
- HTML simple : `<div class="coque-prefs"><div class="coque-pref" role="group" aria-label="Langue"><button class="coque-pref-opt" aria-pressed="true" lang="fr" title="Français">FR</button>…</div><div class="coque-pref" role="group" aria-label="Affichage">…</div></div>`.

## 5. Barres de choix : onglets, segments, filtres (`FilterBar`)

Sous l'en-tête, une seule ligne `.coque-toolbar` (gap 12 px, passe à la ligne), dans cet ordre :

1. **Onglets / vues de la page** : `Segmented` de la charte avec `href` (état dans l'URL, `?onglet=` / `?vue=`), 12 px,
   padding 4 / 10 px, option choisie en accent avec liseré ; compte 11 px. Pas d'onglets soulignés propres à un outil.
2. **Filtres** : `FilterLabel` (icône d'accent 15 px + 12 px `--color-neutral-400`) puis `FilterChips` (puces à choix
   unique : 12 px, bord `--color-neutral-800`, choisie `--color-accent-900` / bord `--color-accent-700` / texte
   `--color-accent-200`), `Select` de la charte pour une longue liste, champ de recherche de la liste.
3. **Navigation par période** (précédent / période / suivant, `IconButton` 28 px).
4. **Note** à droite (`FilterNote` : « 12 sur 40 », 12 px).

## 6. Textes, titres, boutons, tuiles, tableaux, états vides

- **Police** : Inter servie par l'outil (`fonts/inter.ts`), corps 15 px / 1,55 (`body`), texte d'interface aux jetons :

  | Jeton | Valeur | Usage |
  | --- | --- | --- |
  | `--text-micro` | 10 px | en-tête de menu, compteur de sous-groupe, ⌘K |
  | `--text-eyebrow` | 10,5 px | titres de section du menu, libellé de tuile (capitales, `--tracking-caps` 0,08 em) |
  | `--text-caption` | 11,5 px | sous-ligne de tuile, de cellule, de notification |
  | `--text-small` | 12 px | fil d'Ariane, onglets, puces, filtres, date, sélecteurs langue / affichage |
  | `--text-control` | 12,5 px | champs de recherche, boutons `sm`, lignes de menu, état vide |
  | `--text-ui` | 13 px | entrées du menu, tableaux, panneaux, corps des cartes |
  | `--text-dialog` | 14 px | bouton `md`, corps d'un dialogue |
  | `--text-brand` | 16 px | nom de l'outil |
  | `--text-kpi` / `--text-kpi-lg` | 22 / 24 px | valeur de tuile / tuile d'accueil |
  | `--text-title` / `--text-title-compact` | 26 / 22 px | titre de page |

  Poids : 400, et 500 (`--weight-strong`) pour titres, valeurs et marque ; jamais 600 ou 700 dans la coque. Titres de
  carte : `.card-title` de la charte. Chiffres : `font-variant-numeric: tabular-nums`.
- **Boutons** (`Button`, `.btn`) : `primary` = contour d'accent (jamais rempli), `secondary` = contour `--color-divider`,
  `ghost` = texte d'accent ; tailles `md` (dialogue), `sm` (en-tête et page, la plus courante), `xs`, `row` (ligne de
  tableau) ; bouton-icône `IconButton` 36 / 32 / 28 px **toujours nommé** (`label`). Icônes Phosphor
  `@phosphor-icons/react/dist/ssr` (ou la police `@phosphor-icons/web`), jamais d'autre jeu.
- **Tuiles KPI** (`KpiGrid` / `KpiTile`) : grille `auto-fit minmax(150px, 1fr)`, gap 10 px ; carte `elev-sm`, padding 12 / 14
  px ; libellé en capitales 10,5 px, valeur 22 px (24 px accueil) poids 500, sous-ligne 11,5 px ; alerte = valeur
  `--color-accent-300` **avec** l'icône d'avertissement.
- **Tableaux** : `Table` de la charte (`.table`, 13 px, en-têtes en capitales, survol de ligne) dans `TableScroll` ; actions de
  ligne en bouton `row` à droite ; identifiants `IdText` (12 px, tabulaires).
- **États vides** (`EmptyState`) : `inline` (12,5 px `--color-neutral-500` sous une liste) ou `boxed` (bloc centré,
  `--color-neutral-900`). Une source illisible est un état affiché, jamais une erreur de page (Norma § 5).
- **Notifications éphémères** : `Toast` de la charte, en bas à droite (22 px des bords), 420 px au plus.

## 7. Panneau latéral (`SidePanel` = `Drawer`)

- Tout formulaire s'ouvre dans un panneau à droite par-dessus un voile (60 % du fond) : largeur 640 px (`--panel-w`),
  680 px pour un document (`--panel-w-wide`), 100 vw au plus ; carte `elev-lg`, padding 18 / 22 px, gap 12 px.
- En-tête : identifiant de l'objet (12 px tabulaire) · étiquettes · × (nommé « Fermer ») ; titre `.card-title` dessous.
- Pied : `DialogActions` alignées à droite, « Annuler » (`secondary`) puis l'action (`primary`) ; collant en bas d'un long
  formulaire (`.coque-panel-foot` en HTML simple). Échap, × et le voile ferment ; focus piégé puis rendu ; **fermé au
  succès**. Une confirmation courte (supprimer, motif) peut être un `CenteredModal`.

## 8. Barre supérieure et tiroir (≤ 1024 px)

- `MobileTopBar`, premier élément de `<main>`, collante, fond 88 % flouté, bordure basse : **bouton « Menu »** (secondaire,
  icône liste) · glyphe + nom de l'outil · … · outils (cloche) · **paire langue / affichage** (dernier élément).
- Le bouton ouvre la barre latérale en tiroir (300 px, ombre `lg`, voile) ; la page derrière est inerte ; Échap, le voile, ×
  et tout lien suivi le ferment ; le focus revient au bouton. Élargir la fenêtre le ferme.

## 9. Ce qui reste propre à chaque outil

Le modèle de navigation (pages, droits, compteurs), le contenu des panneaux de la cloche et de la recherche globale, les
sélecteurs métier (projet, CAPEX, site, installation) et le contenu des pages. Tout le reste — places, tailles, ordre —
suit ce contrat.
