// Requête média suivie en direct (largeur de la fenêtre, rotation de l'écran, type de pointeur) : la mise en page qui
// ne peut pas se faire en CSS seul (vue « un jour » des feuilles de temps, menu en tiroir) suit le changement.
import { useEffect, useState } from 'react';

const lire = (requete: string) => typeof matchMedia === 'function' && matchMedia(requete).matches;

/** Vrai tant que la requête média `requete` est satisfaite. */
export function useMedia(requete: string): boolean {
  const [ok, setOk] = useState(() => lire(requete));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(requete);
    const suivre = () => setOk(m.matches);
    suivre();
    m.addEventListener('change', suivre);
    return () => m.removeEventListener('change', suivre);
  }, [requete]);
  return ok;
}
