// Changement de page annoncé. Cursus change de page sans recharger le navigateur : sans aide, l'onglet garde le même
// titre et un lecteur d'écran ne dit rien. Le titre de l'onglet devient « <page> — Cursus » (historique, onglets,
// lecteurs d'écran) et, après chaque changement de page (pas au premier affichage, où le navigateur part du haut du
// document), le focus va au titre de la page (h1, tabIndex -1) : la nouvelle page est annoncée et Tab repart du haut
// de son contenu. Le lien « Aller au contenu » (layout/Shell.tsx) mène au même contenu (main id="contenu").
import { useEffect, useRef } from 'react';

/** Identifiant du contenu de la page (balise main), cible du lien d'évitement. */
export const ID_CONTENU = 'contenu';

/** Titre de l'onglet : « Feuilles de temps — Cursus ». */
export const titreOnglet = (page: string | null) => (page ? `${page} — Cursus` : 'Cursus');

/** Focus sur le titre de la page affichée (sinon sur le contenu), sauf sous une fenêtre modale (dialogue, reconnexion). */
export function focusTitrePage() {
  if (document.querySelector('[aria-modal="true"]')) return;
  const cible = document.querySelector<HTMLElement>(`#${ID_CONTENU} h1`) ?? document.getElementById(ID_CONTENU);
  if (!cible) return;
  if (!cible.hasAttribute('tabindex')) cible.setAttribute('tabindex', '-1');
  cible.focus({ preventScroll: true });
}

/**
 * `cle` : page affichée (espace et vue ; null pendant le chargement) ; `titre` : son libellé. Le premier affichage ne
 * déplace pas le focus ; chaque changement suivant (menu, retour arrière du navigateur, changement d'espace, connexion)
 * le pose sur le titre de la nouvelle page.
 */
export function useNavigationAnnoncee(cle: string | null, titre: string | null) {
  useEffect(() => { document.title = titreOnglet(titre); }, [titre]);
  const precedente = useRef<string | null>(null);
  useEffect(() => {
    if (cle == null) return;
    if (precedente.current != null && precedente.current !== cle) focusTitrePage();
    precedente.current = cle;
  }, [cle]);
}
