// Grille du planning des missions (t148), lisible sans la couleur : un vrai tableau (en-têtes de jour à la date
// complète, en-tête de ligne au nom du salarié), une lettre dans chaque case et un résumé par ligne. Chaque case est un
// bouton : la toucher (téléphone, tablette) ou la focaliser affiche son détail sous la grille, annoncé au lecteur
// d'écran. Un seul arrêt de tabulation pour toute la grille : les flèches, Début et Fin déplacent le focus d'une case à
// l'autre (focus « itinérant »).
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { parse } from '../../../shared/dates.ts';
import type { ISODate } from '../../../shared/types.ts';
import { MARQUE, jourComplet, type LignePlanning, type NatureCase } from './planning-missions.ts';

export const ferieBg = (c: string) => `repeating-linear-gradient(45deg, var(${c}), var(${c}) 3px, transparent 3px, transparent 6px)`;

/** Couleur de chaque nature (la légende de l'écran Missions reprend les mêmes). */
export const FOND: Record<NatureCase, CSSProperties> = {
  mission: { background: 'var(--color-accent-500)' },
  absence: { background: 'var(--color-neutral-500)' },
  demande: { boxShadow: 'inset 0 0 0 1px var(--color-neutral-500)' },
  ferie: { background: ferieBg('--color-neutral-800') },
  present: { background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' },
};

export function PlanningGrille({ days, lignes, ti }: { days: ISODate[]; lignes: LignePlanning[]; ti: ISODate }) {
  // Case active : celle qui reçoit le focus à la tabulation et dont le détail s'affiche (aujourd'hui, première ligne).
  const [actif, setActif] = useState<[number, number]>(() => [0, Math.max(0, days.indexOf(ti))]);
  const [detail, setDetail] = useState<string | null>(null);
  const grille = useRef<HTMLTableElement>(null);
  const [li, co] = [Math.min(actif[0], lignes.length - 1), Math.min(actif[1], days.length - 1)];

  const montrer = (l: number, c: number) => {
    setActif([l, c]);
    setDetail(`${lignes[l].nom} — ${lignes[l].cases[c].texte}`);
  };
  const deplacer = (e: KeyboardEvent, l: number, c: number) => {
    const cible: Record<string, [number, number]> = {
      ArrowLeft: [l, c - 1], ArrowRight: [l, c + 1], ArrowUp: [l - 1, c], ArrowDown: [l + 1, c],
      Home: [l, 0], End: [l, days.length - 1],
    };
    const t = cible[e.key];
    if (!t) return;
    e.preventDefault();
    const [nl, nc] = [Math.max(0, Math.min(lignes.length - 1, t[0])), Math.max(0, Math.min(days.length - 1, t[1]))];
    grille.current?.querySelector<HTMLButtonElement>(`[data-case="${nl}-${nc}"]`)?.focus();
  };

  return (
    <>
      <table ref={grille} className="planning" aria-describedby="planning-aide">
        <caption className="sr-only">Planning des 4 prochaines semaines : missions, absences et fériés par collaborateur</caption>
        <colgroup><col className="planning-nom" />{days.map(s => <col key={s} />)}<col className="planning-resume" /></colgroup>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Collaborateur</span></th>
            {days.map(s => (
              <th key={s} scope="col" className={`planning-jour tnum${s === ti ? ' aujourdhui' : ''}`}>
                <span aria-hidden="true"><span>{parse(s).toLocaleDateString('fr-FR', { weekday: 'narrow' })}</span><span>{parse(s).getDate()}</span></span>
                <span className="sr-only">{jourComplet(s)}{s === ti ? ' (aujourd’hui)' : ''}</span>
              </th>
            ))}
            <th scope="col" className="planning-jour"><span className="sr-only">Résumé des 4 semaines</span></th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((r, l) => (
            <tr key={r.id}>
              <th scope="row" className="ellipsis planning-qui">{r.nom}</th>
              {r.cases.map((c, i) => (
                <td key={c.s}>
                  <button type="button" className={`planning-case planning-marque ${c.nature}`} style={FOND[c.nature]} data-case={`${l}-${i}`}
                    tabIndex={l === li && i === co ? 0 : -1} aria-label={`${r.nom}, ${c.texte}`} title={c.texte}
                    onFocus={() => montrer(l, i)} onClick={() => montrer(l, i)} onKeyDown={e => deplacer(e, l, i)}>
                    <span aria-hidden="true">{MARQUE[c.nature]}</span>
                  </button>
                </td>
              ))}
              <td className="planning-total sub" title={r.resume}>{r.resume}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p id="planning-aide" className="sr-only">Flèches pour passer d’un jour ou d’un collaborateur à l’autre, Début et Fin pour aller au premier ou au dernier jour.</p>
      <p className="planning-detail sub" aria-live="polite">{detail ?? 'Touchez ou sélectionnez une case pour afficher le détail du jour.'}</p>
    </>
  );
}
