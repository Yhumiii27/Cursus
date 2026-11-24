// Affichage sombre / clair (Norma 1.0, propriétaire 24 novembre 2026 ; client/src/theme/) sous node --test :
// cookie epc2i-theme → thème (sombre par défaut), script d'amorçage client/public/theme.js (même règle, attribut posé
// avant le rendu), bouton de l'en-tête (attribut, couleurs du navigateur et cookie changés sans aller-retour au serveur),
// place du bouton dans l'en-tête, charte de Norma importée avec ses valeurs claires.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

await import('./outils/rendu.ts');
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { appliquerTheme, FOND_THEME, THEME_COOKIE, themeCookie, themeCourant, themeDuCookie, themeOf } = await import('../client/src/theme/theme.ts');
const { BoutonTheme } = await import('../client/src/theme/BoutonTheme.tsx');

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/** Remet la page dans l'état d'une première visite : sans attribut, sans cookie, avec les balises meta de index.html. */
function pageNeuve() {
  delete document.documentElement.dataset.theme;
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
  document.head.innerHTML = '<meta name="color-scheme" content="dark" /><meta name="theme-color" content="#161826" />';
}
afterEach(() => { cleanup(); pageNeuve(); });

test('cookie → thème : « light » donne le clair, toute autre valeur ou son absence le sombre (par défaut)', () => {
  assert.equal(THEME_COOKIE, 'epc2i-theme');
  assert.equal(themeOf('light'), 'light');
  for (const v of ['dark', 'LIGHT', '', undefined, null, 'clair']) assert.equal(themeOf(v), 'dark', String(v));
  assert.equal(themeDuCookie('a=1; epc2i-theme=light; b=2'), 'light');
  assert.equal(themeDuCookie('epc2i-theme=dark'), 'dark');
  assert.equal(themeDuCookie('x-epc2i-theme=light; theme=light'), 'dark', 'nom exact du cookie seulement');
  assert.equal(themeDuCookie(''), 'dark');
  assert.equal(themeDuCookie(undefined), 'dark');
  assert.equal(themeCookie('light'), 'epc2i-theme=light; path=/; max-age=31536000; samesite=lax', 'un an, tout le site');
});

test('script d’amorçage theme.js : même règle que le module, attribut et couleurs du navigateur posés avant le rendu', () => {
  const script = lire('client/public/theme.js');
  for (const cookie of ['', 'epc2i-theme=light', 'a=1; epc2i-theme=light', 'epc2i-theme=dark', 'epc2i-theme=autre', 'theme=light']) {
    const attributs: Record<string, string> = {};
    const metas: Record<string, Record<string, string>> = { 'meta[name="color-scheme"]': {}, 'meta[name="theme-color"]': {} };
    const document = {
      cookie,
      documentElement: { setAttribute: (n: string, v: string) => { attributs[n] = v; } },
      querySelector: (s: string) => (metas[s] ? { setAttribute: (n: string, v: string) => { metas[s][n] = v; } } : null),
    };
    runInNewContext(script, { document });
    const attendu = themeDuCookie(cookie);
    assert.equal(attributs['data-theme'], attendu, cookie);
    assert.equal(metas['meta[name="color-scheme"]'].content, attendu);
    assert.equal(metas['meta[name="theme-color"]'].content, FOND_THEME[attendu]);
  }
});

test('index.html : theme.js chargé de manière bloquante après les balises meta, avant le module de l’interface ; coque du service worker', () => {
  const page = lire('client/index.html');
  const script = page.indexOf('<script src="/theme.js"></script>');
  assert.ok(script > page.indexOf('<meta name="theme-color"') && script > page.indexOf('<meta name="color-scheme"'), 'après les balises meta');
  assert.ok(script < page.indexOf('</head>') && script < page.indexOf('<script type="module"'), 'dans le head, avant le module');
  assert.match(lire('client/public/sw.js'), /'\/theme\.js'\]/, 'gardé par le service worker (page hors ligne)');
});

test('appliquerTheme : attribut de <html>, color-scheme et theme-color, cookie ; themeCourant relit l’attribut puis le cookie', () => {
  pageNeuve();
  assert.equal(themeCourant(), 'dark', 'première visite : sombre');
  appliquerTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.querySelector('meta[name="color-scheme"]')!.getAttribute('content'), 'light');
  assert.equal(document.querySelector('meta[name="theme-color"]')!.getAttribute('content'), '#f4f5f9');
  assert.match(document.cookie, /epc2i-theme=light/);
  delete document.documentElement.dataset.theme;
  assert.equal(themeCourant(), 'light', 'sans attribut : le cookie');
  appliquerTheme('dark');
  assert.equal(themeCourant(), 'dark');
  assert.match(document.cookie, /epc2i-theme=dark/);
});

test('sélecteur d’affichage : groupe « Affichage », lune « Affichage sombre » et soleil « Affichage clair », aria-pressed, thème changé au clic', () => {
  pageNeuve();
  render(createElement(BoutonTheme));
  const groupe = screen.getByRole('group', { name: 'Affichage' });
  const sombre = screen.getByRole('button', { name: 'Affichage sombre' });
  const clair = screen.getByRole('button', { name: 'Affichage clair' });
  assert.ok(groupe.contains(sombre) && groupe.contains(clair));
  assert.ok(groupe.classList.contains('coque-pref') && sombre.classList.contains('coque-pref-opt'), 'classes de la coque (Norma 2.0)');
  assert.equal(sombre.getAttribute('aria-pressed'), 'true', 'sombre par défaut');
  assert.equal(clair.getAttribute('aria-pressed'), 'false');
  assert.equal(sombre.getAttribute('title'), 'Affichage sombre', 'infobulle');
  fireEvent.click(clair);
  assert.equal(clair.getAttribute('aria-pressed'), 'true');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.match(document.cookie, /epc2i-theme=light/);
  fireEvent.click(sombre);
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.match(document.cookie, /epc2i-theme=dark/);
});

test('sélecteur monté sur l’attribut posé par theme.js : l’affichage clair d’une visite précédente reste choisi', () => {
  pageNeuve();
  document.documentElement.dataset.theme = 'light';
  render(createElement(BoutonTheme));
  assert.equal(screen.getByRole('button', { name: 'Affichage clair' }).getAttribute('aria-pressed'), 'true');
});

test('deux copies du sélecteur (en-tête de page, barre supérieure) : un choix dans l’une est suivi par l’autre (THEME_EVENT)', () => {
  pageNeuve();
  render(createElement('div', null, createElement(BoutonTheme), createElement(BoutonTheme)));
  const [premier, second] = screen.getAllByRole('button', { name: 'Affichage clair' });
  fireEvent.click(premier);
  assert.equal(second.getAttribute('aria-pressed'), 'true');
});

test('coque (Norma 2.0) : paire langue au-dessus de l’affichage, dernier élément de l’en-tête de page et de la barre supérieure, nulle part ailleurs', () => {
  const coque = lire('client/src/layout/Coque.tsx');
  assert.match(coque, /<div className="coque-prefs"[^>]*>\s*<BoutonLangue \/>\s*<BoutonTheme \/>\s*<\/div>/, 'FR | EN au-dessus de ☾ | ☀');
  const entete = coque.slice(coque.indexOf('<header className="coque-header">'), coque.indexOf('</header>'));
  assert.match(entete, /<Preferences \/>\s*$/, 'dernier élément de l’en-tête de page');
  const shell = lire('client/src/layout/Shell.tsx');
  assert.match(shell, /<div className="coque-topbar-tools"><Preferences \/><\/div>\s*<\/div>/, 'dernier élément de la barre supérieure');
  assert.equal(shell.match(/<Preferences \/>/g)?.length, 1, 'une seule fois dans la coque (barre latérale exclue)');
  assert.doesNotMatch(shell, /<BoutonLangue|<BoutonTheme/, 'jamais dans la barre latérale');
  const main = lire('client/src/main.tsx');
  assert.ok(main.indexOf("norma/charte/nocturne.css") < main.indexOf("norma/charte/touch.css") && main.indexOf("norma/charte/touch.css") < main.indexOf("norma/charte/coque.css"), 'nocturne, touch puis coque');
});

test('charte : nocturne.css de Norma importé (thème clair compris), plus de copie locale ; surcharges claires de Cursus', () => {
  assert.match(lire('client/src/main.tsx'), /import '\.\.\/\.\.\/norma\/charte\/nocturne\.css';/);
  const nocturne = lire('norma/charte/nocturne.css');
  assert.match(nocturne, /:root\[data-theme="light"\] \{\s*color-scheme: light;\s*--color-bg: #f4f5f9;/);
  assert.match(nocturne, /--color-bg: #161826;/, 'sombre par défaut');
  assert.throws(() => lire('client/src/styles/nocturne.css'), /ENOENT/);
  const app = lire('client/src/styles/app.css');
  assert.match(app, /:root\[data-theme='light'\] input\[type='date'\]\.input \{ color-scheme: light; \}/);
  assert.match(app, /@media print \{[\s\S]*?:root, :root\[data-theme='light'\] \{/, 'impression identique quel que soit l’affichage');
  assert.equal(FOND_THEME.dark, /--color-bg: (#[0-9a-f]{6});/.exec(nocturne)![1]);
  assert.equal(FOND_THEME.light, /data-theme="light"\] \{[^}]*--color-bg: (#[0-9a-f]{6});/.exec(nocturne)![1]);
});
