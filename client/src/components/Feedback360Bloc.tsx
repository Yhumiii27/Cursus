// Bloc « Feedback 360° » du compte rendu d'un entretien annuel ou de mi-année (lot 12, chantier C3, étape 3), rendu par
// dialogs/EntDialog.tsx sous les objectifs et les souhaits, le module activé (ou une synthèse déjà jointe) :
// - le salarié propose des répondants internes, l'évaluateur les valide ou en sollicite d'autres (3 à 8), relance ceux
//   qui n'ont rien fait sans savoir qui, et clôt la collecte (réponses versées par lot, synthèse jointe) ;
// - qui a été sollicité est affiché, jamais qui a répondu : un compteur global seulement, pour tous, service RH compris
//   (il conduit lui aussi des entretiens ; onglet « Feedback 360° » de l'écran Entretiens : même compteur) ;
// - après la clôture : la synthèse (moyennes par groupe d'au moins 3 réponses, commentaires relus par le service RH).
// Vocabulaire : « confidentiel », jamais « anonyme ».
import { fmtIso } from '../../../shared/format.ts';
import {
  collecte360, lireSynthese360, RELATION_360_UN, sollicitationMasquee, STATUT_360_LABEL, suivi360, TYPES_360,
} from '../../../shared/rules/feedback360.ts';
import type { Employe, Entretien } from '../../../shared/types.ts';
import { useAgir } from '../state/actions.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { type DialogState, useStore } from '../state/store.tsx';
import { useEvaluateur } from './EntretienSuivi.tsx';
import { Synthese360Vue } from './Synthese360.tsx';
import { Fine, NoteAccent, SectionLabel, Tag } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function Feedback360Bloc({ x, e, ouvrir }: { x: Entretien; e: Employe; ouvrir: (dlg: DialogState) => void }) {
  const d = useDomain();
  const { collab, me } = useRole();
  const { run } = useStore();
  const { occupe, agir } = useAgir();
  const evaluateur = useEvaluateur(e);
  const synthese = lireSynthese360(x.syntheseFeedback);
  const actif = d.ds.settings.feedback360Actif;
  if (!TYPES_360.includes(x.type) || (!actif && !synthese)) return null;
  const salarie = collab && x.empId === me;
  const planifie = x.statut === 'planifie';
  const brutes = (d.ds.feedbackSollicitations ?? []).filter(s => s.entretienId === x.id && s.statut !== 'annulee');
  // Même vue pour tous dans le compte rendu : qui a été sollicité, jamais qui a répondu (le serveur masque déjà pour
  // l'évaluateur, l'évalué et le service RH ; masquée ici aussi par sûreté).
  const liste = brutes.map(sollicitationMasquee).sort((a, b) => a.statut.localeCompare(b.statut) || a.id - b.id);
  const suivi = d.ds.suiviFeedback?.find(s => s.entretienId === x.id) ?? suivi360(brutes, x.id);
  const c = collecte360(brutes, x.id);
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? d.emp(id)?.nom ?? t('Employee#salarie');
  const proposees = liste.filter(s => s.statut === 'proposee');
  const echue = !!suivi.echeance && suivi.echeance < d.ti;

  return (<>
    <SectionLabel>{t('360° feedback')}</SectionLabel>
    {synthese ? <Synthese360Vue s={synthese} /> : (<>
      {liste.length > 0 ? (
        <div className="list">
          {liste.map(s => (
            <div key={s.id} className="list-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{nom(s.repondantEmpId)}</div>
                <div className="text-muted sub">{RELATION_360_UN[s.relation]}{s.proposeePar && s.statut === 'proposee' ? t(' · proposed by the employee') : ''}</div>
              </div>
              <Tag cls={s.statut === 'proposee' ? 'tag-outline' : 'tag-neutral'} style={{ flex: 'none' }}>{STATUT_360_LABEL[s.statut]}</Tag>
              {planifie && actif && s.statut === 'proposee' && (evaluateur || salarie) && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={() => ouvrir({
                  type: 'confirmer', c: {
                    titre: t('Withdraw the proposal#respondent'), question: `${t('Remove #person')}${nom(s.repondantEmpId)}${t(' from the proposed respondents?')}`, bouton: t('Remove'),
                    suites: [t('This person will not be asked.')], action: 'feedback360.retirer', payload: { id: s.id }, ensuite: { retour: { type: 'ent', entId: x.id } },
                  },
                })}>{t('Remove')}</button>
              )}
            </div>
          ))}
        </div>
      ) : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t(salarie ? 'No respondent proposed.' : 'No respondent proposed or asked.')}</p>}
      {suivi.envoyees > 0 && (
        <p style={{ fontSize: 14, margin: 0 }}>
          {tn(suivi.reponses, 'feedback received', 'feedbacks received')}{suivi.declinees ? ` · ${tn(suivi.declinees, 'refusal', 'refusals')}` : ''}{t(' out of ')}{tn(suivi.envoyees, 'respondent asked', 'respondents asked')}
          {suivi.echeance ? ` · ${t(echue ? 'window ended on' : 'answers until')} ${fmtIso(suivi.echeance)}` : ''}
        </p>
      )}
      {planifie && actif && !c.close && (evaluateur || salarie) && (
        <div className="actions-end" style={{ flexWrap: 'wrap' }}>
          {evaluateur && c.ouverte && (<>
            <button type="button" className="btn btn-ghost btn-sm" disabled={occupe || echue} onClick={agir(() => run('feedback360.relancer', { entretienId: x.id }))}>{t('Remind')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({
              type: 'confirmer', c: {
                titre: t('Close the collection'), question: t('Close the collection of the 360° feedback?'), bouton: t('Close the collection'),
                suites: [
                  t('The answers received are added in one block, without name or date, and the summary is attached to the report.'),
                  `${t('Below ')}${d.ds.settings.feedback360Seuil}${t(' answers, nothing is passed on and the answers are deleted.')}`,
                  t('The people who have not answered will no longer be able to.'),
                ],
                action: 'feedback360.clore', payload: { entretienId: x.id }, ensuite: { retour: { type: 'ent', entId: x.id } },
              },
            })}>{t('Close the collection')}</button>
          </>)}
          {!echue && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'feedback360Solliciter', entretienId: x.id, retour: x.id })}>
              {t(salarie ? 'Propose respondents' : proposees.length ? 'Ask the respondents' : 'Ask respondents')}
            </button>
          )}
        </div>
      )}
      {planifie && evaluateur && c.ouverte && <NoteAccent>{t('Collection in progress: it closes before the review (otherwise at the due date), and the review closes only afterwards.')}</NoteAccent>}
      {planifie && evaluateur && !c.ouverte && proposees.length > 0 && <NoteAccent>{tn(proposees.length, 'proposed respondent awaits', 'proposed respondents await')}{t(' your approval.')}</NoteAccent>}
    </>)}
    <Fine>
      {t('Feedback of colleagues, of the N+2 and of managed employees, confidential: added in one block at the closing, without name or date; passed on as an average per group of at least ')}
      {d.ds.settings.feedback360Seuil}{t(' answers, comments after review by HR. Nobody sees who answered.')}
    </Fine>
  </>);
}
