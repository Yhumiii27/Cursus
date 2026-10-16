// Lignes et cartes cliquables, ouvertes aussi au clavier (Tab, Entrée, Espace) et lues par un lecteur d'écran.
// Ligne de tableau ou de liste : un vrai bouton sur le nom (`Ouvrir`), la ligne entière restant cliquable à la souris
// (`tr.clickable`, `.list-row.clickable`). Carte sélectionnable (catalogue, chantier, équipe) : `CartePick`, un
// bouton avec `aria-pressed`. Les boutons secondaires d'une ligne arrêtent leur clic (`stop` de components/ui.tsx,
// `garde` de state/actions.ts) : il ne remonte pas à la ligne. tests/cliquable.test.ts vérifie qu'aucune ligne
// `.clickable` n'est dépourvue de son bouton.
import type { KeyboardEvent, ReactNode } from 'react';

/**
 * Bouton d'ouverture d'une ligne cliquable, posé sur le nom (première cellule) : même effet que le clic sur la ligne,
 * dont il arrête le clic (sinon une ligne qui bascule une sélection l'annulerait aussitôt). `pressed` : ligne qui
 * sélectionne (fiche ou dossier affiché à côté) ; `expanded` : ligne qui déplie son détail en dessous.
 */
export function Ouvrir({ onOpen, children, pressed, expanded, label }: {
  onOpen: () => void; children: ReactNode; pressed?: boolean; expanded?: boolean; label?: string;
}) {
  return (
    <button type="button" className="ouvrir" aria-pressed={pressed} aria-expanded={expanded} aria-label={label}
      onClick={ev => { ev.stopPropagation(); onOpen(); }}>
      {children}
    </button>
  );
}

/**
 * Carte sélectionnable : rôle de bouton, focalisable, activée par Entrée ou Espace comme par un clic ; `aria-pressed`
 * dit si elle est choisie. La carte garde sa mise en page (titres, chiffres) ; elle ne contient aucun autre contrôle.
 */
export function CartePick({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  const onKeyDown = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    onSelect();
  };
  return (
    <article className={`card elev-sm pick${selected ? ' selected' : ''}`} role="button" tabIndex={0} aria-pressed={selected}
      onClick={onSelect} onKeyDown={onKeyDown}>
      {children}
    </article>
  );
}
