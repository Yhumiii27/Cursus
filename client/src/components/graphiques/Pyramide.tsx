// Pyramide des âges (ou de l'ancienneté) : femmes à gauche, hommes à droite, tranche au centre ; une barre masquée « < k »
// reste un cadre en pointillé (components/graphiques/commun.ts). Les fiches sans sexe ne figurent que dans le tableau.
import { useId } from 'react';
import type { Case } from '../../../../shared/rules/indicateurs-legaux.ts';
import { LARGEUR, maximum, texteCase } from './commun.ts';
import { t } from '../../i18n/langue.ts';

export interface TranchePyramide { libelle: string; femmes: Case | undefined; hommes: Case | undefined }

const LIGNE = 22, BARRE = 14, CENTRE = 96, ENTETE = 18;

export function Pyramide({ titre, tranches, seuil }: { titre: string; tranches: readonly TranchePyramide[]; seuil: number }) {
  const id = useId();
  if (!tranches.length) return null;
  const max = maximum(tranches.flatMap(x => [x.femmes, x.hommes]));
  const cote = (LARGEUR - CENTRE) / 2, utile = cote - 30;
  const gauche = cote, droite = cote + CENTRE;
  const h = ENTETE + tranches.length * LIGNE;
  // Plus âgés en haut : la pyramide se lit de bas en haut (première tranche en bas).
  const lignes = [...tranches].reverse();
  const barre = (c: Case | undefined, y: number, cote: 'f' | 'h') => {
    const masque = !c || c.masque || c.valeur == null;
    const w = masque ? 0 : Math.round(c!.valeur! / max * utile);
    const txt = texteCase(c, seuil);
    if (masque) {
      const x = cote === 'f' ? gauche - 32 : droite + 2;
      return <><rect className="graph-masque" x={x + 0.5} y={y + 0.5} width={29} height={BARRE - 1} rx={2} /><text className="graph-valeur" x={x + 15} y={y + 11} textAnchor="middle">{txt}</text></>;
    }
    return cote === 'f'
      ? <><rect className="graph-barre" x={gauche - 2 - w} y={y} width={w} height={BARRE} rx={2} /><text className="graph-valeur" x={gauche - 6 - w} y={y + 11} textAnchor="end">{txt}</text></>
      : <><rect className="graph-barre-b" x={droite + 2} y={y} width={w} height={BARRE} rx={2} /><text className="graph-valeur" x={droite + 6 + w} y={y + 11}>{txt}</text></>;
  };
  return (
    <svg className="graph" viewBox={`0 0 ${LARGEUR} ${h}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="xMinYMin meet">
      <title id={`${id}-t`}>{titre}</title>
      <desc id={`${id}-d`}>{tranches.map(x => `${x.libelle}${t(': women ')}${texteCase(x.femmes, seuil)}${t(', men ')}${texteCase(x.hommes, seuil)}`).join(t('; '))}</desc>
      <text className="graph-muet" x={gauche - 4} y={11} textAnchor="end">{t('Women')}</text>
      <text className="graph-muet" x={droite + 4} y={11}>{t('Men')}</text>
      {lignes.map((x, i) => {
        const y = ENTETE + i * LIGNE;
        return (
          <g key={x.libelle}>
            {barre(x.femmes, y, 'f')}
            <text className="graph-texte" x={LARGEUR / 2} y={y + 11} textAnchor="middle">{x.libelle}</text>
            {barre(x.hommes, y, 'h')}
          </g>
        );
      })}
    </svg>
  );
}
