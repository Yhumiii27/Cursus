// Écran Temps, transmission à Sage Paie (components/LotsPaie.tsx) : déplacements en attente du fichier de paie (t031,
// calculés par le serveur : `deplacementsPaie` de l'instantané) et éléments « à saisir dans Sage » des lots (rubrique
// désactivée ou réglage décoché : shared/rules/elements-lot.ts), nominatifs, pour que la paie les saisisse à la main.
// Chantiers en France encore à qualifier (grand déplacement) signalés, avec le lien vers l'écran Missions.
import { plural } from '../../../shared/format.ts';
import { FAMILLES_A_SAISIR, ligneASaisir } from '../../../shared/rules/elements-lot.ts';
import { totauxDeplacements } from '../../../shared/rules/deplacements-paie.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import type { ElementASaisir, LotPaie } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent } from './ui.tsx';

/** Déplacements en attente d'un lot, par période : salariés, quantités, ceux à saisir dans Sage ; chantiers à qualifier. */
export function DeplacementsEnAttente() {
  const d = useDomain();
  const { go } = useStore();
  const { rh } = useRole();
  const dp = d.ds.deplacementsPaie;
  if (!dp || (!dp.elements.length && !dp.aQualifier.length)) return null;
  const periodes = [...new Set(dp.elements.map(x => x.periode))].sort();
  const pays = (code: string) => (code === 'FR' ? 'France' : d.destOf(code)?.pays ?? code);
  return (
    <>
      {periodes.map(p => {
        const l = dp.elements.filter(x => x.periode === p);
        const aSaisir = l.filter(x => x.aSaisir);
        const salaries = [...new Set(l.map(x => x.empId))];
        return (
          <Fine key={p}>
            Déplacements {/^[aeiou]/.test(periodeLabel(p)) ? 'd’' : 'de '}{periodeLabel(p)} : {plural(salaries.length, 'salarié', 'salariés')} ({totauxDeplacements(l)})
            {aSaisir.length > 0 && ` — à saisir dans Sage : ${[...new Set(aSaisir.map(x => x.empId))].map(id => {
              const siens = aSaisir.filter(x => x.empId === id);
              return `${d.personName(id)} (${siens.map(x => `${x.rubrique} ${x.quantite.toLocaleString('fr-FR')}${x.rubrique === 'ETR_JOUR' ? ` ${pays(x.pays)}` : ''}`).join(', ')})`;
            }).join(' ; ')}`}
            {l.some(x => x.rappel) ? ' · dont rappel d’une période close' : ''}.
          </Fine>
        );
      })}
      {dp.aQualifier.length > 0 && (
        <NoteAccent>
          Grand déplacement à qualifier : {dp.aQualifier.map(c => `${c.chantier} · ${c.nom} (${plural(c.missions, 'mission', 'missions')})`).join(', ')} — rien ne part à la paie pour ces missions tant que le service RH ne les a pas qualifiées.
          {rh && <> <Btn small onClick={() => go('missions')}>Écran Missions</Btn></>}
        </NoteAccent>
      )}
    </>
  );
}

/** « 2 éléments à saisir dans Sage : 1 absence, 1 déplacement ». */
export function resumeASaisir(l: readonly ElementASaisir[]): string {
  const familles = [...new Set(l.map(x => x.famille))].map(f => {
    const n = l.filter(x => x.famille === f).length, [s, p] = FAMILLES_A_SAISIR[f] ?? ['élément', 'éléments'];
    return plural(n, s, p);
  });
  return `${plural(l.length, 'élément', 'éléments')} à saisir dans Sage${familles.length ? ` : ${familles.join(', ')}` : ''}`;
}

/** Liste nominative des éléments à saisir dans Sage d'un lot (résumé du lot), pour un lot à confirmer ou le dernier transmis. */
export function ASaisirDuLot({ lot }: { lot: Pick<LotPaie, 'id' | 'statut' | 'resume'> }) {
  const d = useDomain();
  const l = lot.resume.aSaisir ?? [];
  if (!l.length) return null;
  return (
    <Fine>
      Lot n° {lot.id}{lot.statut === 'genere' ? ' (import à confirmer)' : ''} — {resumeASaisir(l)}, absents du fichier : {l.map(x => ligneASaisir(x, id => d.personName(id))).join(' ; ')}.
    </Fine>
  );
}
