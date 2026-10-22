// En-tête de colonne triable et pied d'une liste paginée (t145 ; logique : components/tri.ts). L'en-tête est un bouton
// dans la cellule <th> : nom de la colonne et indicateur du sens, aria-sort sur la colonne triée. Le pied dit combien de
// lignes sont affichées et en ajoute 50, ou toutes.
import type { ReactNode } from 'react';
import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { plural } from '../../../shared/format.ts';
import { ariaSort, TAILLE_PAGE, titreTri, type EtatTri, type Pagination, type Sens } from './tri.ts';

/** En-tête triable : `col` est la clé de la colonne dans la table des colonnes de la liste ; `premier` : sens du premier clic. */
export function ThTri({ t, col, premier, className, children }: { t: EtatTri; col: string; premier?: Sens; className?: string; children: ReactNode }) {
  const s = ariaSort(t.tri, col);
  const Icone = s === 'ascending' ? CaretUpIcon : s === 'descending' ? CaretDownIcon : CaretUpDownIcon;
  return (
    <th aria-sort={s} className={className}>
      <button type="button" className={`th-tri${s ? ' actif' : ''}`} onClick={() => t.cliquer(col, premier)}
        title={titreTri(t.tri, col, premier)}>
        <span>{children}</span>
        <Icone size={11} weight="bold" aria-hidden="true" />
      </button>
    </th>
  );
}

/** Pied d'une liste de plus de 50 lignes : lignes affichées sur le total, « Afficher 50 de plus » et « Tout afficher ». */
export function SuiteListe({ p, unite }: { p: Pagination<unknown>; unite: [string, string] }) {
  if (!p.active) return null;
  return (
    <div className="suite-liste">
      <span className="text-muted sub" role="status">{`Affichage : ${p.affichees} sur ${plural(p.total, unite[0], unite[1])}`}</span>
      {p.reste > 0 && (
        <div className="actions-end">
          <button type="button" className="btn btn-secondary btn-sm" onClick={p.plus}>{`Afficher ${Math.min(TAILLE_PAGE, p.reste)} de plus`}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={p.tout}>Tout afficher</button>
        </div>
      )}
    </div>
  );
}
