// Requête média suivie en direct (largeur de la fenêtre, rotation de l'écran, type de pointeur) : la mise en page qui
// ne peut pas se faire en CSS seul (vue « un jour » des feuilles de temps, menu en tiroir) suit le changement.
import { useEffect, useState } from 'react';

/** Requête satisfaite maintenant ; faux sans matchMedia (rendu hors navigateur). */
export const lireMedia = (requete: string) => typeof matchMedia === 'function' && matchMedia(requete).matches;

/**
 * Suit la requête `requete` : `rappel` reçoit son état aussitôt, puis à chaque changement. Renvoie l'arrêt du suivi
 * (sans matchMedia : rien à suivre). Logique de `useMedia`, testée sous Node (tests/client-modules.test.ts).
 */
export function suivreMedia(requete: string, rappel: (ok: boolean) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const m = matchMedia(requete);
  const suivre = () => rappel(m.matches);
  suivre();
  m.addEventListener('change', suivre);
  return () => m.removeEventListener('change', suivre);
}

/** Vrai tant que la requête média `requete` est satisfaite. */
export function useMedia(requete: string): boolean {
  const [ok, setOk] = useState(() => lireMedia(requete));
  useEffect(() => suivreMedia(requete, setOk), [requete]);
  return ok;
}
