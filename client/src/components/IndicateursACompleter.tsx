// lot 11 — indicateurs (t197) : échéance agrégée du service RH « N fiches sans sexe ou catégorie », écran Échéances. Une
// seule ligne, jamais une échéance par fiche : à la mise en service, la centaine de fiches reprises sans ces champs
// noierait les autres échéances. Le bouton ouvre l'annuaire filtré « Indicateurs à compléter » (Collaborateurs).
// Service RH seulement : lui seul reçoit le sexe et la catégorie (server/src/dataset.ts) ; ailleurs, rien n'est affiché.
import { aCompleterIndicateurs } from '../../../shared/rules/indicateurs-legaux.ts';
import { t, tn } from '../i18n/langue.ts';
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
      {tn(n, 'sheet', 'sheets')}{t(' without sex or job category: ')}{n > 1 ? t('they are counted') : t('it is counted')}{t(' “Not entered” in the social indicators (BDESE, equality index).')}{' '}
      <Btn small onClick={() => go('collaborateurs', { statut: 'acompleter', equipe: 'Toutes', search: '' })}>{t('Complete the sheets')}</Btn>
    </NoteAccent>
  );
}
