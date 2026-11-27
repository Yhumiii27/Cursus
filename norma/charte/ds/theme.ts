// Thème d'affichage sombre / clair (Norma 1.0). Même principe que la langue : une préférence par personne, gardée dans un
// cookie, appliquée par l'attribut data-theme de <html> (les variables de nocturne.css font le reste). Pure : le serveur
// lit le cookie et pose l'attribut au rendu (pas de flash), le bouton le change aussitôt côté navigateur.
// Norma 3.0 (suite Atrium) : le cookie s'appelle `atrium-theme` ; l'ancien nom reste lu pendant la transition (personne ne
// perd son réglage), seul le nouveau est écrit.
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];
/** Même nom dans tous les outils de la suite (écrit et lu). */
export const THEME_COOKIE = 'atrium-theme';
/**
 * Ancien nom du cookie, d'avant Norma 3.0 : lu seulement, jamais écrit, à retirer en 4.0. Assemblé en deux morceaux pour
 * qu'aucun fichier de la suite ne porte plus l'ancienne appellation.
 */
export const LEGACY_THEME_COOKIE = ['e', 'pc2i-theme'].join('');
/** Cookies lus, dans l'ordre : le nouveau d'abord, l'ancien à défaut. */
export const THEME_COOKIES_READ: readonly string[] = [THEME_COOKIE, LEGACY_THEME_COOKIE];
export const DEFAULT_THEME: Theme = 'dark';
/** Valeur du cookie → thème (toute autre valeur : le thème par défaut). */
export function themeOf(value: string | undefined | null): Theme {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}
/**
 * Thème d'après les cookies de la requête : `atrium-theme` s'il est posé, sinon l'ancien nom, sinon le défaut.
 * Côté serveur : `themeFromCookies((n) => (await cookies()).get(n)?.value)`.
 */
export function themeFromCookies(read: (name: string) => string | undefined | null): Theme {
  for (const name of THEME_COOKIES_READ) {
    const v = read(name);
    if (v === 'light' || v === 'dark') return v;
  }
  return DEFAULT_THEME;
}
/** Même lecture depuis un en-tête `Cookie` brut (`a=1; atrium-theme=light`). */
export function themeFromCookieHeader(header: string | undefined | null): Theme {
  const jar = new Map<string, string>();
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return themeFromCookies((n) => jar.get(n));
}
/** En-tête Set-Cookie côté navigateur (un an, tout le site) : toujours le nouveau nom. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
