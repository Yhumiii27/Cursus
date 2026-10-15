// Menu en tiroir sur écran étroit (900 px et moins : téléphone, tablette en portrait). Sans lui, la barre latérale
// (espaces, 14 entrées du menu RH, utilisateur) s'empilait au-dessus de chaque page. Elle se range hors de l'écran et
// s'ouvre par le bouton « Menu » de l'en-tête (aria-expanded, aria-controls). Ouverte, elle est modale : focus piégé
// (useModale de components/focus.ts), page derrière inerte (layout/Shell.tsx), fermeture par Échap, par le fond, par
// « Fermer le menu » ou au choix d'une page ; le focus revient alors au bouton « Menu », ou au titre de la page choisie
// (layout/navigation.ts). Le menu lui-même (navGroups de Shell.tsx) ne change pas, seul son affichage. Sur grand écran,
// la barre latérale reste affichée en permanence.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ListIcon } from '@phosphor-icons/react';
import { useModale } from '../components/focus.ts';
import { useMedia } from '../components/media.ts';
import { ECRAN_ETROIT } from '../components/panneau.ts';

/** Identifiant de la barre latérale, que le bouton « Menu » contrôle. */
export const ID_MENU = 'menu-principal';

export interface Tiroir { ouvert: boolean; ouvrir: () => void; fermer: () => void }

/** État du tiroir : jamais ouvert sur grand écran (une tablette tournée en paysage le referme). */
export function useTiroir(): Tiroir {
  const etroit = useMedia(ECRAN_ETROIT);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => { if (!etroit) setOuvert(false); }, [etroit]);
  const ouvrir = useCallback(() => setOuvert(true), []);
  const fermer = useCallback(() => setOuvert(false), []);
  return { ouvert: ouvert && etroit, ouvrir, fermer };
}

/** Bouton « Menu » de l'en-tête (écran étroit seulement) ; sa pastille totalise celles du menu. */
export function BoutonMenu({ tiroir, aTraiter }: { tiroir: Tiroir; aTraiter: number }) {
  return (
    <button type="button" className="btn btn-ghost menu-btn" aria-expanded={tiroir.ouvert} aria-controls={ID_MENU} onClick={tiroir.ouvrir}>
      <ListIcon size={18} aria-hidden="true" /><span>Menu</span>
      {aTraiter > 0 && <span className="tag tag-accent nav-badge"><span aria-hidden="true">{aTraiter}</span><span className="sr-only">, {aTraiter} à traiter</span></span>}
    </button>
  );
}

/**
 * Tiroir ouvert (monté seulement tant qu'il l'est) : focus sur la page en cours du menu, piégé dans la barre latérale,
 * rendu à la fermeture ; Échap le ferme ; la page derrière ne défile plus. `actif` faux : reconnexion par-dessus.
 */
export function PiegeTiroir({ barre, actif, fermer }: { barre: RefObject<HTMLElement | null>; actif: boolean; fermer: () => void }) {
  // À l'ouverture, avant useModale qui garde un focus déjà posé dans la fenêtre : l'entrée de la page affichée, sinon la
  // première du menu.
  const ouverture = useRef(actif);
  useEffect(() => {
    const b = barre.current;
    if (ouverture.current && b) (b.querySelector<HTMLElement>('.nav-item[aria-current="page"]') ?? b.querySelector<HTMLElement>('.nav-item'))?.focus();
  }, [barre]);
  useModale(barre, actif);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !actif || ev.defaultPrevented) return;
      ev.preventDefault();
      fermer();
    };
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('tiroir-ouvert');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('tiroir-ouvert');
    };
  }, [actif, fermer]);
  return null;
}
