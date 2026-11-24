// Sélecteur de langue FR | EN (Norma 2.0, COQUE.md § 4 ; CU-N01) : le haut de la paire langue / affichage
// (layout/Coque.tsx, `Preferences`), dernier élément de l'en-tête de chaque page et de la barre supérieure. Deux options
// de même taille (classes coque-pref de norma/charte/coque.css), `aria-pressed` ; noms « Français » et « English » (chacun
// dans sa langue, attribut `lang`). Le choix vaut aussitôt (i18n/langue.ts : cookie `cursus-lang`, attribut `lang` de
// <html>, coque et pages rendues de nouveau), sans aller-retour au serveur ; français par défaut.
import { choisirLangue, t, useLangue, type Lang } from './langue.ts';

const OPTIONS: readonly [Lang, string, string][] = [['fr', 'FR', 'Français'], ['en', 'EN', 'English']];

export function BoutonLangue() {
  const { lang } = useLangue();
  return (
    <div className="coque-pref" role="group" aria-label={t('Language')}>
      {OPTIONS.map(([l, court, nom]) => (
        <button key={l} type="button" className="coque-pref-opt" aria-pressed={lang === l} lang={l} title={nom}
          onClick={() => { if (lang !== l) choisirLangue(l); }}>
          {court}
        </button>
      ))}
    </div>
  );
}
