// Sélecteur d'affichage sombre | clair (Norma 2.0, COQUE.md § 4) : le bas de la paire langue / affichage
// (layout/Coque.tsx, `Preferences`), sous le sélecteur FR | EN, de même taille (classes coque-pref de
// norma/charte/coque.css). Lune = affichage sombre, soleil = affichage clair, `aria-pressed`, noms lus par un lecteur
// d'écran et en infobulle (i18n/langue.ts). Change l'attribut data-theme de <html> et le cookie epc2i-theme dans le
// navigateur (theme/theme.ts), sans aller-retour au serveur ; le changement est diffusé (THEME_EVENT) pour que les deux
// copies de la paire (en-tête de page, barre supérieure du téléphone) restent d'accord.
import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { t } from '../i18n/langue.ts';
import { appliquerTheme, LIBELLE_GROUPE_THEME, LIBELLE_THEME, THEME_EVENT, themeCourant, type Theme } from './theme.ts';

const OPTIONS = [['dark', MoonIcon], ['light', SunIcon]] as const;

export function BoutonTheme() {
  const [theme, setTheme] = useState<Theme>(() => themeCourant());
  useEffect(() => {
    const suivre = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    document.addEventListener(THEME_EVENT, suivre);
    return () => document.removeEventListener(THEME_EVENT, suivre);
  }, []);
  return (
    <div className="coque-pref" role="group" aria-label={t(LIBELLE_GROUPE_THEME)}>
      {OPTIONS.map(([th, Icone]) => (
        <button key={th} type="button" className="coque-pref-opt" aria-pressed={theme === th} aria-label={t(LIBELLE_THEME[th])}
          title={t(LIBELLE_THEME[th])} onClick={() => { if (theme !== th) { appliquerTheme(th); setTheme(th); } }}>
          <Icone aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
