// Bouton d'affichage sombre / clair de l'en-tête (Norma 1.0, propriétaire 24 novembre 2026). Contrôle segmenté de la
// charte (`.seg`, comme le choix de l'espace de la barre latérale) : lune = affichage sombre, soleil = affichage clair,
// libellés lus par un lecteur d'écran et en infobulle. Change l'attribut data-theme de <html> et le cookie epc2i-theme
// dans le navigateur (client/src/theme/theme.ts), sans aller-retour au serveur. Il suit le sélecteur de langue FR / EN
// (i18n/BoutonLangue.tsx) et est le dernier élément de l'en-tête, à droite ; libellés traduits (i18n/langue.ts).
import { useState } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { t } from '../i18n/langue.ts';
import { appliquerTheme, LIBELLE_GROUPE_THEME, LIBELLE_THEME, themeCourant, type Theme } from './theme.ts';

const OPTIONS = [['dark', MoonIcon], ['light', SunIcon]] as const;

export function BoutonTheme() {
  const [theme, setTheme] = useState<Theme>(() => themeCourant());
  const choisir = (th: Theme) => { appliquerTheme(th); setTheme(th); };
  return (
    <div className="seg bouton-theme" role="radiogroup" aria-label={t(LIBELLE_GROUPE_THEME)}>
      {OPTIONS.map(([th, Icone]) => (
        <label key={th} className="seg-opt" title={t(LIBELLE_THEME[th])}>
          <input type="radio" name="affichage" value={th} checked={theme === th} onChange={() => choisir(th)} />
          <Icone size={16} aria-hidden="true" />
          <span className="sr-only">{t(LIBELLE_THEME[th])}</span>
        </label>
      ))}
    </div>
  );
}
