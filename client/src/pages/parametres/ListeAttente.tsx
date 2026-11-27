// Paramètres → Liste d'attente des sessions (lot 7, chantier C, t120 ; shared/rules/liste-attente.ts) : activée par défaut ;
// une place libérée est proposée au service RH, qui confirme l'inscription (réponse de l'entreprise du 23 octobre 2026), ou,
// en option, le premier admissible est inscrit et convoqué aussitôt. Désactivée, une demande acceptée sur une session complète
// va au plan de formation, comme avant. Réglages de l'administrateur RH, enregistrés aussitôt ; les autres profils consultent.
import type { ModeAttente } from '../../../../shared/types.ts';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Modes : sources anglaises, traduites au rendu. */
const MODES: [ModeAttente, string][] = [['confirmer', 'Offered to HR'], ['automatique', 'Automatic enrolment']];

export function ListeAttente({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title={t('Waiting list of the sessions')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.formationsListeAttente} disabled={!admin} onChange={e => enregistrer({ formationsListeAttente: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Offer the waiting list when the requested session is full')}</span>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 14 }}>{t('When a place is freed')}</span>
        <Seg name="attente-mode" label={t('When a place is freed')} value={s.formationsAttenteMode} disabled={!admin} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={MODES.map(([k, l]) => [k, t(l)])} onChange={mode => enregistrer({ formationsAttenteMode: mode })} />
      </div>
      <Fine>
        {t('A training request accepted on a full session places the employee in the session’s queue, in order of acceptance, without any other priority; the answer and the e-mail tell them the session is full and what their place is. A freed place (unenrolment, change of session, refresher recorded, places added, departure, request reopened) is ')}{s.formationsAttenteMode === 'automatique'
          ? t('given to the first one still eligible, enrolled and invited at once')
          : t('offered to HR for the first one still eligible: the enrolment is confirmed in the session detail, and the invitation goes at that moment')}{t('. An employee who is no longer eligible (absent or enrolled elsewhere on those days, left, refresher already recorded) is skipped, the reason in the log. The queue is closed when the session is cancelled or closed: the requests go back to the training plan. The employee, their manager and HR can remove a person from the queue. List deactivated: the request goes to the training plan, the answer says the session was full.')}
      </Fine>
    </Panel>
  );
}
