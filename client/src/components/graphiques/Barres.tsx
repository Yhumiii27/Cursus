// Barres horizontales d'un indicateur (une barre par modalité) : libellé au-dessus de sa barre, valeur au bout, pour
// rester lisible à 390 px ; une case masquée : cadre en pointillé et « < k », sans longueur (components/graphiques/commun.ts).
import { useId } from 'react';
import type { Case } from '../../../../shared/rules/indicateurs-legaux.ts';
import { LARGEUR, maximum, texteCase } from './commun.ts';

export interface BarreDonnee { libelle: string; c: Case | undefined }

const LIGNE = 34, BARRE = 12, VALEUR = 64;

export function Barres({ titre, barres, seuil, suffixe = '' }: { titre: string; barres: readonly BarreDonnee[]; seuil: number; suffixe?: string }) {
  const id = useId();
  if (!barres.length) return null;
  const max = maximum(barres.map(b => b.c));
  const utile = LARGEUR - VALEUR;
  const h = barres.length * LIGNE;
  return (
    <svg className="graph" viewBox={`0 0 ${LARGEUR} ${h}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="xMinYMin meet">
      <title id={`${id}-t`}>{titre}</title>
      <desc id={`${id}-d`}>{barres.map(b => `${b.libelle} : ${texteCase(b.c, seuil, suffixe)}`).join(' ; ')}</desc>
      {barres.map((b, i) => {
        const y = i * LIGNE;
        const masque = !b.c || b.c.masque || b.c.valeur == null;
        const w = masque ? 0 : Math.max(b.c!.valeur! > 0 ? 2 : 0, Math.round(b.c!.valeur! / max * utile));
        return (
          <g key={b.libelle}>
            <text className="graph-texte" x={0} y={y + 11}>{b.libelle}</text>
            {masque
              ? <rect className="graph-masque" x={0.5} y={y + 16.5} width={40} height={BARRE - 1} rx={2} />
              : <rect className="graph-barre" x={0} y={y + 16} width={w} height={BARRE} rx={2} />}
            <text className="graph-valeur" x={(masque ? 40 : w) + 6} y={y + 26}>{texteCase(b.c, seuil, suffixe)}</text>
          </g>
        );
      })}
    </svg>
  );
}
