// Langue de l'interface (Norma § 2 et § 7, CU-N01 ; client/src/i18n/) sous node --test : moteur de traduction (anglais
// source, français par défaut), cookie cursus-lang, sélecteur FR / EN de l'en-tête (juste avant le bouton d'affichage),
// changement de langue sans rechargement, et complétude du dictionnaire français sur les fichiers migrés.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('./outils/rendu.ts');
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { enFrancais, frExact, makeT, localeIntl } = await import('../client/src/i18n/traduire.ts');
const { FR, MEMES_EN_FRANCAIS } = await import('../client/src/i18n/fr.ts');
const { choisirLangue, LANGUE_COOKIE, langueCookie, langueCourante, langueDe, langueDuCookie, t } = await import('../client/src/i18n/langue.ts');
const { BoutonLangue } = await import('../client/src/i18n/BoutonLangue.tsx');
const { BoutonTheme } = await import('../client/src/theme/BoutonTheme.tsx');

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
afterEach(() => { cleanup(); choisirLangue('fr'); document.cookie = `${LANGUE_COOKIE}=; path=/; max-age=0`; });

test('moteur : entrée exacte, règles à paramètres, segments ; anglais = identité ; chaîne inconnue gardée', () => {
  assert.equal(enFrancais('Timesheets'), 'Feuilles de temps');
  assert.equal(enFrancais('3 to handle'), '3 à traiter');
  assert.equal(enFrancais('Worksites · Go / No Go'), 'Chantiers · Go / No Go');
  assert.equal(enFrancais('Help — Privacy'), 'Aide — Confidentialité');
  assert.equal(enFrancais('12,5 %'), '12,5 %', 'nombre seul');
  assert.equal(enFrancais(''), '');
  assert.equal(enFrancais('Not in the dictionary'), 'Not in the dictionary');
  assert.equal(frExact('constructor'), undefined, 'propriétés héritées ignorées');
  assert.equal(makeT('en')('Timesheets'), 'Timesheets');
  assert.equal(makeT('fr')('Timesheets'), 'Feuilles de temps');
  assert.equal(localeIntl('fr'), 'fr-FR');
  assert.equal(localeIntl('en'), 'en-GB');
});

test('cookie cursus-lang : « en » donne l’anglais, toute autre valeur ou son absence le français (par défaut)', () => {
  assert.equal(LANGUE_COOKIE, 'cursus-lang');
  assert.equal(langueDe('en'), 'en');
  for (const v of ['fr', 'EN', '', undefined, null, 'de']) assert.equal(langueDe(v), 'fr', String(v));
  assert.equal(langueDuCookie('a=1; cursus-lang=en; b=2'), 'en');
  assert.equal(langueDuCookie('x-cursus-lang=en; lang=en'), 'fr', 'nom exact du cookie seulement');
  assert.equal(langueDuCookie(undefined), 'fr');
  assert.equal(langueCookie('en'), 'cursus-lang=en; path=/; max-age=31536000; samesite=lax');
  assert.equal(langueCourante(), 'fr', 'français par défaut');
});

test('choisirLangue : t() suit la langue, attribut lang de <html> et cookie posés ; même langue sans effet', () => {
  assert.equal(t('Sign out'), 'Se déconnecter');
  choisirLangue('en');
  assert.equal(t('Sign out'), 'Sign out');
  assert.equal(document.documentElement.getAttribute('lang'), 'en');
  assert.match(document.cookie, /cursus-lang=en/);
  choisirLangue('en');
  assert.equal(langueCourante(), 'en');
  choisirLangue('fr', null);
  assert.equal(t('Sign out'), 'Se déconnecter', 'sans document : la langue change quand même');
});

test('sélecteur FR / EN : groupe « Langue », français choisi par défaut, l’anglais traduit aussitôt le sélecteur d’affichage', () => {
  render(createElement('div', null, createElement(BoutonLangue), createElement(BoutonTheme)));
  screen.getByRole('group', { name: 'Langue' });
  const fr = screen.getByRole('button', { name: 'FR' });
  const en = screen.getByRole('button', { name: 'EN' });
  assert.equal(fr.getAttribute('aria-pressed'), 'true');
  assert.equal(fr.getAttribute('title'), 'Français', 'infobulle');
  assert.equal(en.getAttribute('title'), 'English');
  assert.equal(en.getAttribute('lang'), 'en');
  act(() => { fireEvent.click(en); });
  assert.equal(langueCourante(), 'en');
  assert.equal(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed'), 'true');
  screen.getByRole('group', { name: 'Language' });
  // Le sélecteur d'affichage est rendu de nouveau par la coque (useLangue) : ici, rendu neuf en anglais.
  cleanup();
  render(createElement(BoutonTheme));
  screen.getByRole('group', { name: 'Dark / light display' });
  screen.getByRole('button', { name: 'Light display' });
});

/** Fichiers passés aux chaînes sources anglaises (CU-N01) : chacun de leurs littéraux de t() a sa traduction. */
const FICHIERS_MIGRES = [
  'client/src/App.tsx', 'client/src/layout/Shell.tsx', 'client/src/layout/Tiroir.tsx', 'client/src/layout/BarreOnglets.tsx',
  'client/src/theme/BoutonTheme.tsx', 'client/src/theme/theme.ts', 'client/src/i18n/BoutonLangue.tsx', 'client/src/components/Dialog.tsx',
  'client/src/pages/Login.tsx', 'client/src/layout/Coque.tsx',
];

/** Chaînes sources d'un fichier : arguments littéraux de t(), libellés du menu et des options, textes de la connexion. */
function chainesSources(f: string): string[] {
  const s = lire(f);
  const out: string[] = [];
  for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) out.push(m[1]);
  for (const m of s.matchAll(/\bt\(\s*`([^`$]*)`\s*\)/g)) out.push(m[1]);
  // t(cond ? 'a' : 'b'), t(x === y ? 'a' : z === w ? 'b' : 'c') : chaque branche littérale.
  for (const m of s.matchAll(/\bt\(([^()]*\?[^()]*)\)/g)) for (const l of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) if (!/^[a-z]+$/.test(l[1])) out.push(l[1]);
  for (const m of s.matchAll(/\blabel: (?:role === 'collaborateur' \? )?'([^']+)'(?: : '([^']+)')?/g)) out.push(...[m[1], m[2]].filter(Boolean) as string[]);
  for (const m of s.matchAll(/\[\['?([A-Z][^',]+)', \{ view:/g)) out.push(m[1]);
  for (const m of s.matchAll(/^\s*\['([A-Z][^']+)', \[/gm)) out.push(m[1]);
  for (const m of s.matchAll(/\b(?:title|text|dark|light): '([^'#][^']*)'/g)) out.push(m[1]);
  for (const m of s.matchAll(/\['(?:fr|en|rh|manager|collaborateur)', '[^']*', '([^']+)'\]|\['(?:rh|manager|collaborateur)', '([^']+)'\]/g)) out.push((m[1] ?? m[2])!);
  for (const m of s.matchAll(/LIBELLE_GROUPE_THEME = '([^']+)'/g)) out.push(m[1]);
  for (const m of s.matchAll(/\bfrais\('([^']+)'/g)) out.push(m[1]);
  return out.map(x => x.replace(/\\'/g, "'"));
}

test('complétude : chaque chaîne source des fichiers migrés a sa traduction française (ou est relue identique)', () => {
  const manquantes: string[] = [];
  let n = 0;
  for (const f of FICHIERS_MIGRES) {
    for (const c of chainesSources(f)) {
      n++;
      if (MEMES_EN_FRANCAIS.includes(c)) continue;
      if (enFrancais(c) === c) manquantes.push(`${f} : ${c}`);
    }
  }
  assert.deepEqual(manquantes, []);
  assert.ok(n > 100, `${n} chaînes relevées`);
  for (const [en, fr] of Object.entries(FR)) assert.notEqual(en, fr, `${en} : traduction identique, à mettre dans MEMES_EN_FRANCAIS`);
  for (const c of MEMES_EN_FRANCAIS) assert.ok(!Object.hasOwn(FR, c), `${c} : dans le dictionnaire et parmi les chaînes identiques`);
});

test('fichiers migrés : plus de texte français en dur dans le rendu de la coque et de la connexion', () => {
  for (const f of ['client/src/layout/Shell.tsx', 'client/src/layout/BarreOnglets.tsx', 'client/src/layout/Tiroir.tsx', 'client/src/pages/Login.tsx']) {
    // Chaînes JSX entre balises et attributs texte, hors commentaires : aucune lettre accentuée française.
    const code = lire(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    assert.doesNotMatch(code.replace(/\/\/.*$/gm, ''), /(aria-label|title)="[^"]*[éèàêç][^"]*"/, `${f} : attribut en français`);
    assert.doesNotMatch(code.replace(/\/\/.*$/gm, ''), />[^<>{}]*[éèàêçÉ][^<>{}]*</, `${f} : texte en français`);
  }
});
