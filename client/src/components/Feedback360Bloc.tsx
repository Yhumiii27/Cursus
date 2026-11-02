// Bloc « Feedback 360° » du compte rendu d'un entretien annuel ou de mi-année (lot 12, chantier C3, étape 3), rendu par
// dialogs/EntDialog.tsx sous les objectifs et les souhaits, le module activé (ou une synthèse déjà jointe) :
// - le salarié propose des répondants internes, l'évaluateur les valide ou en sollicite d'autres (3 à 8), relance ceux
//   qui n'ont rien fait sans savoir qui, et clôt la collecte (réponses versées par lot, synthèse jointe) ;
// - qui a été sollicité est affiché, jamais qui a répondu : un compteur global seulement, pour tous, service RH compris
//   (il conduit lui aussi des entretiens ; onglet « Feedback 360° » de l'écran Entretiens : même compteur) ;
// - après la clôture : la synthèse (moyennes par groupe d'au moins 3 réponses, commentaires relus par le service RH).
// Vocabulaire : « confidentiel », jamais « anonyme ».
import { fmtIso, plural } from '../../../shared/format.ts';
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
  const nom = (id: number) => d.ds.annuaire.find(p => p.id === id)?.nom ?? d.emp(id)?.nom ?? 'Salarié';
  const proposees = liste.filter(s => s.statut === 'proposee');
  const echue = !!suivi.echeance && suivi.echeance < d.ti;

  return (<>
    <SectionLabel>Feedback 360°</SectionLabel>
    {synthese ? <Synthese360Vue s={synthese} /> : (<>
      {liste.length > 0 ? (
        <div className="list">
          {liste.map(s => (
            <div key={s.id} className="list-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{nom(s.repondantEmpId)}</div>
                <div className="text-muted sub">{RELATION_360_UN[s.relation]}{s.proposeePar && s.statut === 'proposee' ? ' · proposé par le salarié' : ''}</div>
              </div>
              <Tag cls={s.statut === 'proposee' ? 'tag-outline' : 'tag-neutral'} style={{ flex: 'none' }}>{STATUT_360_LABEL[s.statut]}</Tag>
              {planifie && actif && s.statut === 'proposee' && (evaluateur || salarie) && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={() => ouvrir({
                  type: 'confirmer', c: {
                    titre: 'Retirer la proposition', question: `Retirer ${nom(s.repondantEmpId)} des répondants proposés ?`, bouton: 'Retirer',
                    suites: ['Cette personne ne sera pas sollicitée.'], action: 'feedback360.retirer', payload: { id: s.id }, ensuite: { retour: { type: 'ent', entId: x.id } },
                  },
                })}>Retirer</button>
              )}
            </div>
          ))}
        </div>
      ) : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucun répondant {salarie ? 'proposé' : 'proposé ni sollicité'}.</p>}
      {suivi.envoyees > 0 && (
        <p style={{ fontSize: 14, margin: 0 }}>
          {plural(suivi.reponses, 'avis reçu', 'avis reçus')}{suivi.declinees ? ` · ${plural(suivi.declinees, 'refus', 'refus')}` : ''} sur {plural(suivi.envoyees, 'répondant sollicité', 'répondants sollicités')}
          {suivi.echeance ? ` · ${echue ? 'fenêtre échue le' : 'réponses jusqu’au'} ${fmtIso(suivi.echeance)}` : ''}
        </p>
      )}
      {planifie && actif && !c.close && (evaluateur || salarie) && (
        <div className="actions-end" style={{ flexWrap: 'wrap' }}>
          {evaluateur && c.ouverte && (<>
            <button type="button" className="btn btn-ghost btn-sm" disabled={occupe || echue} onClick={agir(() => run('feedback360.relancer', { entretienId: x.id }))}>Relancer</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({
              type: 'confirmer', c: {
                titre: 'Clore la collecte', question: 'Clore la collecte du feedback 360° ?', bouton: 'Clore la collecte',
                suites: [
                  'Les réponses reçues sont versées d’un bloc, sans nom ni date, et la synthèse est jointe au compte rendu.',
                  `Sous ${d.ds.settings.feedback360Seuil} réponses, rien n’est restitué et les réponses sont supprimées.`,
                  'Les personnes qui n’ont pas répondu ne le pourront plus.',
                ],
                action: 'feedback360.clore', payload: { entretienId: x.id }, ensuite: { retour: { type: 'ent', entId: x.id } },
              },
            })}>Clore la collecte</button>
          </>)}
          {!echue && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'feedback360Solliciter', entretienId: x.id, retour: x.id })}>
              {salarie ? 'Proposer des répondants' : proposees.length ? 'Solliciter les répondants' : 'Solliciter des répondants'}
            </button>
          )}
        </div>
      )}
      {planifie && evaluateur && c.ouverte && <NoteAccent>Collecte en cours : elle se clôt avant l’entretien (sinon à l’échéance), et l’entretien ne se clôt qu’après.</NoteAccent>}
      {planifie && evaluateur && !c.ouverte && proposees.length > 0 && <NoteAccent>{plural(proposees.length, 'répondant proposé attend', 'répondants proposés attendent')} votre validation.</NoteAccent>}
    </>)}
    <Fine>
      Avis de collègues, du N+2 et de collaborateurs encadrés, confidentiels : versés d’un bloc à la clôture, sans nom ni date ; restitués en moyenne par groupe d’au moins
      {` ${d.ds.settings.feedback360Seuil}`} réponses, commentaires après relecture du service RH. Personne ne voit qui a répondu.
    </Fine>
  </>);
}
