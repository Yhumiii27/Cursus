// Plan & budget : indicateurs de formation de l'exercice affiché (t122, shared/rules/heures-formation.ts) — stagiaires,
// formations réalisées et heures par catégorie, par équipe et par statut, coûts prévu et réalisé, taux de réalisation ;
// formations de durée inconnue signalées (durée en heures à compléter au catalogue ou sur la formation suivie). Exports
// CSV des indicateurs et des formations suivies de l'exercice. Indicateurs BDESE (pas de bilan social sous 300 salariés).
// En dessous, les indicateurs des évaluations de l'exercice (lot 7, t121 : components/Evaluations.tsx).
// lot 11 — indicateurs : renvoi vers l'écran Indicateurs sociaux (onglet Formation : stagiaires et heures par catégorie
// d'emploi et par sexe, taux d'accès, masqués sous le seuil d'anonymat), pour le service RH et la lecture seule.
import { useMemo } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { fH, fmtEur } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import { indicateursFormation, type LigneIndicateur } from '../../../shared/rules/heures-formation.ts';
import { csvFormationsSuivies, csvIndicateurs } from '../formations-csv.ts';
import { downloadCsv } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent, Panel } from './ui.tsx';
import { IndicateursEvaluationPanel } from './Evaluations.tsx';
// lot 11 — indicateurs
import { droitsRh } from '../../../shared/constants.ts';
// lot 12 — C3 (entretiens suivis)
import { souhaitsVersesDeLExercice } from '../../../shared/rules/objectifs-suivi.ts';

function Tableau({ titre, lignes }: { titre: string; lignes: LigneIndicateur[] }) {
  const visibles = lignes.filter(l => l.realisations > 0);
  return (
    <table className="table">
      <thead><tr><th scope="col">{titre}</th><th scope="col" className="right">{t('Trainees')}</th><th scope="col" className="right">{t('Trainings')}</th><th scope="col" className="right">{t('Hours')}</th></tr></thead>
      <tbody>
        {visibles.map(l => (
          <tr key={l.cle}>
            <th scope="row" style={{ fontWeight: 'normal' }}>{l.cle}</th>
            <td className="right tnum">{l.stagiaires}</td>
            <td className="right tnum">{l.realisations}</td>
            <td className="right tnum">{fH(l.heures)}{l.inconnues ? ` + ${l.inconnues} ?` : ''}</td>
          </tr>
        ))}
        {!visibles.length && <tr><td colSpan={4} className="text-muted">{t('No training done.')}</td></tr>}
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
  // lot 12 — C3 (entretiens suivis) : demandes versées depuis les souhaits exprimés en entretien, et leur suite.
  const souhaits = useMemo(() => souhaitsVersesDeLExercice(d.ds, exercice), [d, exercice]);
  const exporter = () => {
    const c = csvIndicateurs(d, x);
    downloadCsv(c.fichier, c.head, c.rows);
    notify(t('CSV export of the indicators generated'));
  };
  const exporterSuivies = () => {
    const c = csvFormationsSuivies(d, exercice);
    downloadCsv(c.fichier, c.head, c.rows);
    notify(`${t('CSV export generated — ')}${tn(c.rows.length, 'training attended', 'trainings attended')}`);
  };
  return (<>
    <Panel title={`${t('Training indicators ')}${exercice}`} aside={<div className="actions-end">
      <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporterSuivies}>{t('Trainings attended')}</Btn>
      <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>{t('Export the indicators')}</Btn>
    </div>} style={{ gap: 'var(--space-3)' }}>
      <div className="text-muted sub">
        {tn(x.total.stagiaires, 'trainee', 'trainees')} · {tn(x.total.realisations, 'training done', 'trainings done')} · {fH(x.total.heures)}
        {' '}· {x.tauxRealisation == null ? t('no action in the plan') : `${x.actionsRealisees} / ${x.actions}${t(' actions of the plan done (')}${x.tauxRealisation} %)`}
        {' '}· {t('planned cost ')}{fmtEur(x.coutPrevu)}{t(', done ')}{fmtEur(x.coutRealise)}
      </div>
      {souhaits.versees > 0 && (
        <div className="text-muted sub">
          {t('From the reviews: ')}{tn(souhaits.versees, 'request filed', 'requests filed')}{t(' from a wish with a favourable opinion')} · {souhaits.acceptees}{t(' accepted#fem-plural-after')}
          {' '}· {tn(souhaits.lignesPlan, 'line of the plan', 'lines of the plan')}{t(' of “review” origin')}
        </div>
      )}
      <div className="scroll-x"><Tableau titre={t('Category')} lignes={x.parCategorie} /></div>
      <div className="scroll-x"><Tableau titre={t('Team')} lignes={x.parEquipe} /></div>
      <div className="scroll-x"><Tableau titre={t('Status')} lignes={x.parStatut} /></div>
      {x.inconnues.length > 0 && (
        <NoteAccent>
          {tn(x.inconnues.length, 'training of unknown length', 'trainings of unknown length')}{t(', outside the hours:')}{' '}
          {x.inconnues.slice(0, 5).map(r => `${r.intitule} (${r.nom})`).join(', ')}{x.inconnues.length > 5 ? '…' : ''}{t(' — complete the length in hours (Reference data → Trainings, or the training attended).')}
        </NoteAccent>
      )}
      <Fine>
        {t('Trainings done in the year: participations present at the closed sessions (times of the session, otherwise length in the catalogue), certifications recorded without a session and trainings attended, outside the catalogue included. The site has fewer than 300 employees: no compulsory social report, these indicators serve the BDESE.')}
        {versIndicateurs && <>{' '}{t('By sex and by job category, with the access rate:')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('indicateurs', { indOnglet: 'formation', indAnnee: exercice })}>{t('Social indicators')}</button></>}
      </Fine>
    </Panel>
    {/* Évaluation des formations (lot 7, t121) : par organisme et par formation, export CSV. */}
    <IndicateursEvaluationPanel exercice={exercice} />
  </>);
}
