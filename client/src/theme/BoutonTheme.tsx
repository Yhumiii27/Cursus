// Bouton d'affichage sombre / clair de l'en-tête (Norma 1.0, propriétaire 24 novembre 2026). Contrôle segmenté de la
// charte (`.seg`, comme le choix de l'espace de la barre latérale) : lune = affichage sombre, soleil = affichage clair,
// libellés lus par un lecteur d'écran et en infobulle. Change l'attribut data-theme de <html> et le cookie epc2i-theme
// dans le navigateur (client/src/theme/theme.ts), sans aller-retour au serveur. Cursus n'a pas de sélecteur de langue
// FR / EN (interface en français seul) : le bouton est le dernier élément de l'en-tête, à droite.
import { useState } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { appliquerTheme, LIBELLE_GROUPE_THEME, LIBELLE_THEME, themeCourant, type Theme } from './theme.ts';

const OPTIONS = [['dark', MoonIcon], ['light', SunIcon]] as const;

export function BoutonTheme() {
  const [theme, setTheme] = useState<Theme>(() => themeCourant());
  const choisir = (t: Theme) => { appliquerTheme(t); setTheme(t); };
  return (
    <div className="seg bouton-theme" role="radiogroup" aria-label={LIBELLE_GROUPE_THEME}>
      {OPTIONS.map(([t, Icone]) => (
        <label key={t} className="seg-opt" title={LIBELLE_THEME[t]}>
          <input type="radio" name="affichage" value={t} checked={theme === t} onChange={() => choisir(t)} />
          <Icone size={16} aria-hidden="true" />
          <span className="sr-only">{LIBELLE_THEME[t]}</span>
        </label>
      ))}
    </div>
  );
}
