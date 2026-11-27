// Synthèse du feedback 360° jointe à un entretien (lot 12, chantier C3, étape 3 ; calculée par le serveur :
// shared/rules/feedback360.ts, `synthese360`) : moyenne de chaque question par groupe de répondants d'au moins 3 réponses
// (catégories regroupées en dessous), ensemble des réponses, commentaires restitués après la relecture du service RH. Rien
// n'est restitué sous le seuil. Montrée à l'évaluateur, à l'évalué et au service RH, dans le compte rendu.
import { fmtIso } from '../../../shared/format.ts';
import { ECHELLE_360, type Groupe360, libelleGroupe360, QUESTIONNAIRE_360, type Synthese360 } from '../../../shared/rules/feedback360.ts';
import { Fine, NoteAccent } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Moyenne affichée (une décimale, virgule) ; « — » : moins de notes que le seuil pour cette question. */
const moyenne = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export function Synthese360Vue({ s }: { s: Synthese360 }) {
  if (s.insuffisant) {
    return (
      <NoteAccent>
        {t('Collection closed on ')}{fmtIso(s.closeLe)}{t(': ')}{tn(s.reponses, 'answer received', 'answers received')}{t(' out of ')}{s.envoyees}{t(', fewer than ')}{s.seuil}{t('. Nothing is passed on, to keep the answers confidential; they have been deleted.')}
      </NoteAccent>
    );
  }
  const colonnes: Groupe360[] = [...s.groupes, ...(s.ensemble ? [s.ensemble] : [])];
  const titre = (g: Groupe360, i: number) => (i === colonnes.length - 1 && s.ensemble ? t('All together') : libelleGroupe360(g));
  return (<>
    <div className="text-muted sub">
      {t('Collection closed on ')}{fmtIso(s.closeLe)} · {tn(s.reponses, 'answer', 'answers')}{t(' out of ')}{s.envoyees}{t(' requested')} · {t('questionnaire ')}{s.version} · {t('scale from 1 (')}{ECHELLE_360[0][1].toLowerCase()}{t(') to 4 (')}{ECHELLE_360[3][1].toLowerCase()})
    </div>
    <div className="scroll-x">
      <table className="table">
        <caption className="sr-only">{t('Averages of the 360° feedback by question and by group of respondents')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Question')}</th>
            {colonnes.map((g, i) => <th key={i} scope="col" className="right">{titre(g, i)}<span className="text-muted sub" style={{ display: 'block', fontWeight: 400 }}>{tn(g.reponses, 'answer', 'answers')}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {QUESTIONNAIRE_360.questions.map(q => (
            <tr key={q.cle}>
              <th scope="row" style={{ fontWeight: 400 }}>{q.theme}<span className="text-muted sub" style={{ display: 'block' }}>{q.libelle}</span></th>
              {colonnes.map((g, i) => <td key={i} className="right tnum">{moyenne(g.moyennes[q.cle])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <Fine>{t('“—”: fewer than ')}{s.seuil}{t(' answers to this question in the group, nothing is passed on. The categories of fewer than ')}{s.seuil}{t(' respondents are grouped with others.')}</Fine>
    {s.verbatims.length > 0 && (
      <div className="list">
        {s.verbatims.map((v, i) => <div key={i} className="list-row" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>« {v} »</div>)}
      </div>
    )}
    {s.aModerer > 0 && <Fine>{tn(s.aModerer, 'comment is', 'comments are')}{t(s.aModerer > 1 ? ' being reviewed by HR, passed on afterwards if they are kept.' : ' being reviewed by HR, passed on afterwards if it is kept.')}</Fine>}
    {!!s.nonRelus && <Fine>{tn(s.nonRelus, 'comment was', 'comments were')}{t(s.nonRelus > 1 ? ' not reviewed before the closing of the review: never passed on.#plural' : ' not reviewed before the closing of the review: never passed on.')}</Fine>}
  </>);
}
