// Affichage sombre / clair (Norma 1.0, propriétaire 24 novembre 2026 ; norma/charte/README.md, « Thème sombre / clair »).
// Même convention dans toute la suite : préférence par personne dans le cookie `epc2i-theme` (`dark` | `light`, un an,
// tout le site), appliquée par l'attribut `data-theme` de <html> ; les variables de norma/charte/nocturne.css font le
// reste. Thème sombre par défaut. Sans rendu serveur de la page (interface Vite servie telle quelle, aussi depuis le
// service worker), l'attribut est posé avant le premier rendu par le script d'amorçage client/public/theme.js (même
// règle, sans module : CSP `script-src 'self'`, aucun script en ligne) ; le bouton de l'en-tête le change ensuite.
import { DEFAULT_THEME, THEME_COOKIE, themeCookie, themeOf, type Theme } from '../../../norma/charte/ds/theme.ts';

export { DEFAULT_THEME, THEME_COOKIE, themeCookie, themeOf, type Theme };

/** Couleur de fond de chaque thème (`--color-bg` de nocturne.css) : barre d'état du téléphone (`theme-color`). */
export const FOND_THEME: Record<Theme, string> = { dark: '#161826', light: '#f4f5f9' };

/**
 * Libellés du bouton : chaînes sources de Norma (charte/ds/ThemeToggle.tsx, 1.1.0), traduites à l'affichage (i18n/fr.ts :
 * « Affichage sombre », « Affichage clair », groupe « Affichage »).
 */
export const LIBELLE_THEME: Record<Theme, string> = { dark: 'Dark display', light: 'Light display' };
export const LIBELLE_GROUPE_THEME = 'Dark / light display';

/** Thème lu dans un en-tête Cookie ou `document.cookie` (« a=1; epc2i-theme=light ») ; absent ou inconnu : sombre. */
export function themeDuCookie(cookies: string | null | undefined): Theme {
  for (const part of (cookies ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === THEME_COOKIE) return themeOf(part.slice(i + 1).trim());
  }
  return DEFAULT_THEME;
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
}
