// Affichage sombre / clair (Norma 1.0, propriétaire 24 novembre 2026 ; norma/charte/README.md, « Thème sombre / clair »).
// Même convention dans toute la suite : préférence par personne dans le cookie `atrium-theme` (`dark` | `light`, un an,
// tout le site ; Norma 3.0 : l'ancien nom `LEGACY_THEME_COOKIE` reste lu à défaut, jamais écrit), appliquée par l'attribut `data-theme` de <html> ; les variables de norma/charte/nocturne.css font le
// reste. Thème sombre par défaut. Sans rendu serveur de la page (interface Vite servie telle quelle, aussi depuis le
// service worker), l'attribut est posé avant le premier rendu par le script d'amorçage client/public/theme.js (même
// règle, sans module : CSP `script-src 'self'`, aucun script en ligne) ; le bouton de l'en-tête le change ensuite.
import { DEFAULT_THEME, LEGACY_THEME_COOKIE, THEME_COOKIE, themeCookie, themeFromCookieHeader, themeOf, type Theme } from '../../../norma/charte/ds/theme.ts';

export { DEFAULT_THEME, LEGACY_THEME_COOKIE, THEME_COOKIE, themeCookie, themeOf, type Theme };

/** Événement diffusé sur `document` à chaque changement (détail : le thème) : les copies du sélecteur le suivent. */
export const THEME_EVENT = 'atrium-theme';

/** Couleur de fond de chaque thème (`--color-bg` de nocturne.css) : barre d'état du téléphone (`theme-color`). */
export const FOND_THEME: Record<Theme, string> = { dark: '#161826', light: '#f4f5f9' };

/**
 * Libellés du bouton : chaînes sources de Norma (charte/ds/ThemeToggle.tsx, 1.1.0), traduites à l'affichage (i18n/fr.ts :
 * « Affichage sombre », « Affichage clair », groupe « Affichage »).
 */
export const LIBELLE_THEME: Record<Theme, string> = { dark: 'Dark display', light: 'Light display' };
export const LIBELLE_GROUPE_THEME = 'Dark / light display';

/**
 * Thème lu dans un en-tête Cookie ou `document.cookie` (« a=1; atrium-theme=light ») : `atrium-theme` d'abord, l'ancien
 * nom à défaut (Norma 3.0, `themeFromCookieHeader`) ; absent ou inconnu : sombre.
 */
export function themeDuCookie(cookies: string | null | undefined): Theme {
  return themeFromCookieHeader(cookies);
}

/** Thème posé sur la page (attribut `data-theme` de <html>, posé par theme.js) ; sinon celui du cookie. */
export function themeCourant(doc: Document = document): Theme {
  const attr = doc.documentElement.dataset.theme;
  return attr === 'light' || attr === 'dark' ? attr : themeDuCookie(doc.cookie);
}

/** Applique un thème dans le navigateur, sans aller-retour au serveur : attribut, couleurs du navigateur et cookie. */
export function appliquerTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', FOND_THEME[theme]);
  doc.cookie = themeCookie(theme);
  doc.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}
