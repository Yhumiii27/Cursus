// lot 12 — C7 (organigramme) : navigation au clavier commune aux deux présentations de l'organigramme (liste indentée de
// pages/Organigramme.tsx, arbre vertical de components/organigramme/ArbreGraphique.tsx) : mêmes nœuds `role="treeitem"`
// (`data-cle`, `aria-expanded` pour un nœud dépliable), même focus itinérant (un seul nœud dans l'ordre de tabulation).
// Flèches haut et bas (nœud précédent ou suivant, dans l'ordre du document), droite (déplier, puis premier nœud
// rattaché), gauche (replier, puis nœud parent), Début, Fin, Entrée ou Espace (déplier ou replier, ou ouvrir la fiche).
import type { KeyboardEvent } from 'react';

export interface ActionsClavier {
  /** Déplie (vrai), replie (faux) ou bascule le nœud. */
  basculer: (cle: string, ouvrir?: boolean) => void;
  /** Ouvre la fiche d'une personne (quand le profil y a accès). */
  ouvrirFiche: (id: number) => void;
  /** Nœud qui reçoit le focus itinérant. */
  activer: (cle: string) => void;
}

/** Identifiant HTML d'un nœud : préfixe du composant (`useId`) et clé, caractères hors [a-zA-Z0-9] codés. */
export const idNoeud = (base: string, cle: string) => `${base}-${[...cle].map(c => (/[a-zA-Z0-9]/.test(c) ? c : `_${c.charCodeAt(0).toString(36)}`)).join('')}`;

/** Touche reçue par l'arbre `racine` (`onKeyDown` de l'élément `role="tree"`). */
export function toucheArbre(ev: KeyboardEvent<HTMLElement>, racine: HTMLElement | null, a: ActionsClavier) {
  const cur = (ev.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
  if (!cur || !racine) return;
  const items = [...racine.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const i = items.indexOf(cur), cle = cur.dataset.cle!, deplie = cur.getAttribute('aria-expanded');
  const aller = (el: HTMLElement | null | undefined) => {
    ev.preventDefault();
    if (!el) return;
    a.activer(el.dataset.cle!);
    el.focus();
  };
  switch (ev.key) {
    case 'ArrowDown': aller(items[i + 1]); break;
    case 'ArrowUp': aller(items[i - 1]); break;
    case 'Home': aller(items[0]); break;
    case 'End': aller(items.at(-1)); break;
    case 'ArrowRight':
      if (deplie === 'false') { ev.preventDefault(); a.basculer(cle, true); } else if (deplie === 'true') aller(cur.querySelector<HTMLElement>('[role="treeitem"]'));
      break;
    case 'ArrowLeft':
      if (deplie === 'true') { ev.preventDefault(); a.basculer(cle, false); } else aller(cur.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
      break;
    case 'Enter': case ' ':
      ev.preventDefault();
      if (deplie != null) a.basculer(cle);
      else if (cle.startsWith('p:')) a.ouvrirFiche(Number(cle.slice(2)));
      break;
    default:
  }
}
