// Panneau de détail d'une liste (fiche collaborateur, dossier voyage, équipe, chantier). Sur écran étroit
// (900 px et moins, téléphone, tablette en portrait), la page passe en une colonne et le panneau s'affiche sous
// toute la liste : toucher une ligne semblait sans effet. La sélection amène donc le panneau dans le champ de
// vision et lui donne le focus (un lecteur d'écran l'annonce) ; sa fermeture ramène là où la personne était
// dans la liste. Sur grand écran, le panneau est déjà visible à côté de la liste : rien ne bouge.
import { useEffect, useRef } from 'react';

/** Mise en page en une colonne (app.css, « Écrans étroits »). */
export const ECRAN_ETROIT = '(max-width: 900px)';

const media = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;

/**
 * Effet d'un changement de sélection `cle` sur le panneau `el` : sur écran étroit, défilement vers le panneau et focus
 * à la sélection, retour à la position gardée dans `position` à la fermeture ; rien sur grand écran. Logique de
 * `usePanneauVisible`, testée sous Node (tests/client-modules.test.ts).
 */
export function placerPanneau(el: HTMLElement | null, cle: string | number | null | undefined, position: { current: number | null }): void {
  if (!media(ECRAN_ETROIT)) { position.current = null; return; }
  if (cle == null) {
    if (position.current != null) window.scrollTo({ top: position.current });
    position.current = null;
    return;
  }
  if (!el) return;
  position.current ??= window.scrollY;
  el.scrollIntoView({ block: 'start', behavior: media('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

/**
 * Panneau de détail de l'élément sélectionné `cle` (null : aucun) : la référence se pose sur le panneau, qui
 * porte tabIndex={-1} et un nom (aria-labelledby). Une sélection présente à l'affichage de la page (fiche
 * ouverte depuis le tableau de bord) amène aussi le panneau dans le champ de vision.
 */
export function usePanneauVisible<T extends HTMLElement>(cle: string | number | null | undefined) {
  const ref = useRef<T>(null);
  // Défilement de la page avant la première sélection : rétabli à la fermeture du panneau.
  const position = useRef<number | null>(null);
  useEffect(() => placerPanneau(ref.current, cle, position), [cle]);
  return ref;
}
