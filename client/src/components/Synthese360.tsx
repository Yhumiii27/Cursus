// Synthèse du feedback 360° jointe à un entretien (lot 12, chantier C3, étape 3 ; calculée par le serveur :
// shared/rules/feedback360.ts, `synthese360`) : moyenne de chaque question par groupe de répondants d'au moins 3 réponses
// (catégories regroupées en dessous), ensemble des réponses, commentaires restitués après la relecture du service RH. Rien
// n'est restitué sous le seuil. Montrée à l'évaluateur, à l'évalué et au service RH, dans le compte rendu.
import { fmtIso, plural } from '../../../shared/format.ts';
import { ECHELLE_360, type Groupe360, libelleGroupe360, QUESTIONNAIRE_360, type Synthese360 } from '../../../shared/rules/feedback360.ts';
import { Fine, NoteAccent } from './ui.tsx';

/** Moyenne affichée (une décimale, virgule) ; « — » : moins de notes que le seuil pour cette question. */
const moyenne = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export function Synthese360Vue({ s }: { s: Synthese360 }) {
  if (s.insuffisant) {
    return (
      <NoteAccent>
        Collecte close le {fmtIso(s.closeLe)} : {plural(s.reponses, 'réponse reçue', 'réponses reçues')} sur {s.envoyees}, moins de {s.seuil}. Rien n’est restitué, pour garder les
        réponses confidentielles ; elles ont été supprimées.
      </NoteAccent>
    );
  }
  const colonnes: Groupe360[] = [...s.groupes, ...(s.ensemble ? [s.ensemble] : [])];
  const titre = (g: Groupe360, i: number) => (i === colonnes.length - 1 && s.ensemble ? 'Ensemble' : libelleGroupe360(g));
  return (<>
    <div className="text-muted sub">
      Collecte close le {fmtIso(s.closeLe)} · {plural(s.reponses, 'réponse', 'réponses')} sur {s.envoyees} sollicités · questionnaire {s.version} · échelle de 1 ({ECHELLE_360[0][1].toLowerCase()}) à 4 ({ECHELLE_360[3][1].toLowerCase()})
    </div>
    <div className="scroll-x">
      <table className="table">
        <caption className="sr-only">Moyennes du feedback 360° par question et par groupe de répondants</caption>
        <thead>
          <tr>
            <th scope="col">Question</th>
            {colonnes.map((g, i) => <th key={i} scope="col" className="right">{titre(g, i)}<span className="text-muted sub" style={{ display: 'block', fontWeight: 400 }}>{plural(g.reponses, 'réponse', 'réponses')}</span></th>)}
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
    <Fine>« — » : moins de {s.seuil} réponses à cette question dans le groupe, rien n’est restitué. Les catégories de moins de {s.seuil} répondants sont regroupées avec d’autres.</Fine>
    {s.verbatims.length > 0 && (
      <div className="list">
        {s.verbatims.map((v, i) => <div key={i} className="list-row" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>« {v} »</div>)}
      </div>
    )}
    {s.aModerer > 0 && <Fine>{plural(s.aModerer, 'commentaire est', 'commentaires sont')} en cours de relecture par le service RH, restitué{s.aModerer > 1 ? 's' : ''} ensuite s’il{s.aModerer > 1 ? 's sont retenus' : ' est retenu'}.</Fine>}
    {!!s.nonRelus && <Fine>{plural(s.nonRelus, 'commentaire n’a', 'commentaires n’ont')} pas été relu{s.nonRelus > 1 ? 's' : ''} avant la clôture de l’entretien : jamais restitué{s.nonRelus > 1 ? 's' : ''}.</Fine>}
  </>);
}
