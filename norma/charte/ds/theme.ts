// Thème d'affichage sombre / clair (Norma 1.0). Même principe que la langue : une préférence par personne, gardée dans un
// cookie, appliquée par l'attribut data-theme de <html> (les variables de nocturne.css font le reste). Pure : le serveur
// lit le cookie et pose l'attribut au rendu (pas de flash), le bouton le change aussitôt côté navigateur.
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];
/** Même nom dans tous les outils de la suite. */
export const THEME_COOKIE = 'epc2i-theme';
export const DEFAULT_THEME: Theme = 'dark';
/** Valeur du cookie → thème (toute autre valeur : le thème par défaut). */
export function themeOf(value: string | undefined | null): Theme {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}
/** En-tête Set-Cookie côté navigateur (un an, tout le site). */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
