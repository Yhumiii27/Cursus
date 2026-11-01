// Graphiques SVG faits maison (lot 11, indicateurs sociaux) : sans bibliothèque ni script ni style en ligne (CSP
// script-src 'self', style-src 'self') ; couleurs par les classes `graph-*` de styles/app.css (jetons Nocturne). Chaque
// graphique est une image nommée (role="img", <title>, <desc> qui donne toutes les valeurs) ; le tableau qui l'accompagne
// reste la source lisible au clavier et par un lecteur d'écran. Une case masquée n'a jamais de barre : un cadre en
// pointillé et « < k ».
import type { Case } from '../../../../shared/rules/indicateurs-legaux.ts';

/** Valeur affichée d'une case : nombre à la française, « < k » si masquée, « — » si absente. */
export function texteCase(c: Case | undefined, seuil: number, suffixe = ''): string {
  if (!c) return '—';
  if (c.masque) return `< ${seuil}`;
  if (c.valeur == null) return '—';
  return `${c.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${suffixe}`;
}

/** Plus grande valeur visible (1 au moins : une échelle jamais nulle). */
export const maximum = (cases: readonly (Case | undefined)[]) => Math.max(1, ...cases.map(c => (c && !c.masque && c.valeur != null ? c.valeur : 0)));

/** Largeur logique des graphiques : ils s'étirent jusqu'à leur largeur maximale (styles/app.css, `.graph`). */
export const LARGEUR = 360;
