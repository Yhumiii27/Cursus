// lot 11 — indicateurs (t197) : échéance agrégée du service RH « N fiches sans sexe ou catégorie », écran Échéances. Une
// seule ligne, jamais une échéance par fiche : à la mise en service, la centaine de fiches reprises sans ces champs
// noierait les autres échéances. Le bouton ouvre l'annuaire filtré « Indicateurs à compléter » (Collaborateurs).
// Service RH seulement : lui seul reçoit le sexe et la catégorie (server/src/dataset.ts) ; ailleurs, rien n'est affiché.
import { aCompleterIndicateurs } from '../../../shared/rules/indicateurs-legaux.ts';
import { plural } from '../../../shared/format.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, NoteAccent } from './ui.tsx';

/** Fiches présentes, hors intérimaires, sans sexe ou sans catégorie d'emploi (shared/rules/indicateurs-legaux.ts). */
export function useFichesACompleter(): number {
  const d = useDomain();
  return d.ds.employes.filter(e => aCompleterIndicateurs(e, d.ti)).length;
}

export function IndicateursACompleter() {
  const { rh } = useRole();
  const { go } = useStore();
  const n = useFichesACompleter();
  if (!rh || n === 0) return null;
  return (
    <NoteAccent>
      {plural(n, 'fiche', 'fiches')} sans sexe ou catégorie d’emploi : {n > 1 ? 'elles sont comptées' : 'elle est comptée'} « Non renseigné » dans les
      indicateurs sociaux (BDESE, index d’égalité).{' '}
      <Btn small onClick={() => go('collaborateurs', { statut: 'acompleter', equipe: 'Toutes', search: '' })}>Compléter les fiches</Btn>
    </NoteAccent>
  );
}
