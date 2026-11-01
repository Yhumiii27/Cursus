// Plan & budget : indicateurs de formation de l'exercice affiché (t122, shared/rules/heures-formation.ts) — stagiaires,
// formations réalisées et heures par catégorie, par équipe et par statut, coûts prévu et réalisé, taux de réalisation ;
// formations de durée inconnue signalées (durée en heures à compléter au catalogue ou sur la formation suivie). Exports
// CSV des indicateurs et des formations suivies de l'exercice. Indicateurs BDESE (pas de bilan social sous 300 salariés).
// En dessous, les indicateurs des évaluations de l'exercice (lot 7, t121 : components/Evaluations.tsx).
// lot 11 — indicateurs : renvoi vers l'écran Indicateurs sociaux (onglet Formation : stagiaires et heures par catégorie
// d'emploi et par sexe, taux d'accès, masqués sous le seuil d'anonymat), pour le service RH et la lecture seule.
import { useMemo } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fH, fmtEur, plural } from '../../../shared/format.ts';
import { indicateursFormation, type LigneIndicateur } from '../../../shared/rules/heures-formation.ts';
import { csvFormationsSuivies, csvIndicateurs } from '../formations-csv.ts';
import { downloadCsv } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent, Panel } from './ui.tsx';
import { IndicateursEvaluationPanel } from './Evaluations.tsx';
// lot 11 — indicateurs
import { droitsRh } from '../../../shared/constants.ts';

function Tableau({ titre, lignes }: { titre: string; lignes: LigneIndicateur[] }) {
  const visibles = lignes.filter(l => l.realisations > 0);
  return (
    <table className="table">
      <thead><tr><th scope="col">{titre}</th><th scope="col" className="right">Stagiaires</th><th scope="col" className="right">Formations</th><th scope="col" className="right">Heures</th></tr></thead>
      <tbody>
        {visibles.map(l => (
          <tr key={l.cle}>
            <th scope="row" style={{ fontWeight: 'normal' }}>{l.cle}</th>
            <td className="right tnum">{l.stagiaires}</td>
            <td className="right tnum">{l.realisations}</td>
            <td className="right tnum">{fH(l.heures)}{l.inconnues ? ` + ${l.inconnues} ?` : ''}</td>
          </tr>
        ))}
        {!visibles.length && <tr><td colSpan={4} className="text-muted">Aucune formation réalisée.</td></tr>}
      </tbody>
    </table>
  );
}

export function IndicateursFormationPanel({ exercice }: { exercice: number }) {
  const d = useDomain();
  const { notify, go } = useStore();
  // Écran Indicateurs sociaux : droit « consultation » (service RH et lecture seule).
  const versIndicateurs = droitsRh(d.ds.user).includes('consultation');
  const x = useMemo(() => indicateursFormation(d, exercice), [d, exercice]);
  const exporter = () => {
    const c = csvIndicateurs(d, x);
    downloadCsv(c.fichier, c.head, c.rows);
    notify('Export CSV des indicateurs généré');
  };
  const exporterSuivies = () => {
    const c = csvFormationsSuivies(d, exercice);
    downloadCsv(c.fichier, c.head, c.rows);
    notify(`Export CSV généré — ${plural(c.rows.length, 'formation suivie', 'formations suivies')}`);
  };
  return (<>
    <Panel title={`Indicateurs de formation ${exercice}`} aside={<div className="actions-end">
      <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporterSuivies}>Formations suivies</Btn>
      <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>Exporter les indicateurs</Btn>
    </div>} style={{ gap: 'var(--space-3)' }}>
      <div className="text-muted sub">
        {plural(x.total.stagiaires, 'stagiaire', 'stagiaires')} · {plural(x.total.realisations, 'formation réalisée', 'formations réalisées')} · {fH(x.total.heures)}
        {' '}· {x.tauxRealisation == null ? 'aucune action au plan' : `${x.actionsRealisees} / ${x.actions} actions du plan réalisées (${x.tauxRealisation} %)`}
        {' '}· coût prévu {fmtEur(x.coutPrevu)}, réalisé {fmtEur(x.coutRealise)}
      </div>
      <div className="scroll-x"><Tableau titre="Catégorie" lignes={x.parCategorie} /></div>
      <div className="scroll-x"><Tableau titre="Équipe" lignes={x.parEquipe} /></div>
      <div className="scroll-x"><Tableau titre="Statut" lignes={x.parStatut} /></div>
      {x.inconnues.length > 0 && (
        <NoteAccent>
          {plural(x.inconnues.length, 'formation de durée inconnue', 'formations de durée inconnue')}, hors des heures :{' '}
          {x.inconnues.slice(0, 5).map(r => `${r.intitule} (${r.nom})`).join(', ')}{x.inconnues.length > 5 ? '…' : ''} — complétez la durée en heures
          (Référentiels → Formations, ou la formation suivie).
        </NoteAccent>
      )}
      <Fine>
        Formations réalisées dans l’année : participations présentes aux sessions clôturées (horaires de la session, sinon durée du
        catalogue), certifications enregistrées sans session et formations suivies, hors catalogue comprises. Le site compte moins de
        300 salariés : pas de bilan social obligatoire, ces indicateurs servent à la BDESE.
        {versIndicateurs && <>{' '}Par sexe et par catégorie d’emploi, avec le taux d’accès :{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('indicateurs', { indOnglet: 'formation', indAnnee: exercice })}>Indicateurs sociaux</button></>}
      </Fine>
    </Panel>
    {/* Évaluation des formations (lot 7, t121) : par organisme et par formation, export CSV. */}
    <IndicateursEvaluationPanel exercice={exercice} />
  </>);
}
