// Sélecteur de langue FR / EN de l'en-tête (Norma § 7, CU-N01) : contrôle segmenté de la charte (`.seg`, comme le bouton
// d'affichage qui le suit), français par défaut. Le choix vaut aussitôt (i18n/langue.ts : cookie `cursus-lang`, attribut
// `lang` de <html>, coque et pages rendues de nouveau), sans aller-retour au serveur.
import { choisirLangue, t, useLangue, type Lang } from './langue.ts';

const OPTIONS: readonly [Lang, string, string][] = [['fr', 'FR', 'French'], ['en', 'EN', 'English']];

export function BoutonLangue() {
  const { lang } = useLangue();
  return (
    <div className="seg bouton-langue" role="radiogroup" aria-label={t('Language')}>
      {OPTIONS.map(([l, court, nom]) => (
        <label key={l} className="seg-opt" title={t(nom)}>
          <input type="radio" name="langue" value={l} checked={lang === l} onChange={() => choisirLangue(l)} />
          <span aria-hidden="true">{court}</span>
          <span className="sr-only">{t(nom)}</span>
        </label>
      ))}
    </div>
  );
}
