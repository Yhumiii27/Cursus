// Paramètres → Hiérarchie des managers (t136, shared/rules/hierarchie.ts) : consultation N+2, désactivée par défaut
// (réponse de l'entreprise du 18 octobre 2026). Activée, un manager consulte en lecture seule les membres des équipes
// rattachées aux siennes (équipe parente, écran Équipes & managers), sans donnée médicale ni entretien ; les décisions
// restent à leur manager direct. Réglage de l'administrateur RH, enregistré aussitôt ; les autres profils le consultent.
// Lot 11 (organigramme) : réglage `organigrammeOuvert`, espaces auxquels l'organigramme est ouvert (tous par défaut).
import { PROFONDEUR_MAX } from '../../../../shared/rules/hierarchie.ts';
import { ORGANIGRAMME_OUVERT } from '../../../../shared/rules/organigramme.ts';
import type { OrganigrammeOuvert } from '../../../../shared/types.ts';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

export function Hierarchie({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title={t('Hierarchy of managers')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.consultationN2} disabled={!admin} onChange={e => enregistrer({ consultationN2: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('N+2 consultation: the manager sees, read only, the members of the teams attached to theirs')}</span>
      </label>
      {/* Délégation des validations (t135) : congés et feuilles de temps ; les entretiens seulement si cette case l'ouvre. */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.delegationEntretiens} disabled={!admin} onChange={e => enregistrer({ delegationEntretiens: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Delegation of reviews: the deputy of an absent manager can also receive their reviews')}</span>
      </label>
      <Fine>
        {t('A team can be attached to a parent team (Teams & managers screen, ')}{PROFONDEUR_MAX}{t(' levels at most): the team’s manager, when they are a member of it, then submits their absences, timesheets and reviews to the parent team’s manager, and no longer to HR. The requests already pending change approver on saving; the new approver is notified. The N+2 consultation shows the sheet, absences and timesheets of the members of the attached teams, with the same restrictions as for the direct team and without detailed medical fitness nor review; the decisions stay with their direct manager.')}
      </Fine>
      {/* lot 11 — organigramme */}
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="reglage-organigramme">{t('Organisation chart open to')}</label>
        <select className="input" id="reglage-organigramme" value={s.organigrammeOuvert ?? 'tous'} disabled={!admin}
          onChange={e => enregistrer({ organigrammeOuvert: e.target.value as OrganigrammeOuvert })}>
          {(Object.entries(ORGANIGRAMME_OUVERT) as [OrganigrammeOuvert, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <Fine>
        {t('The organisation chart only shows the directory (name, job, team, manager) of those present on the day: neither contract, nor absence, nor health. A manager’s deputy only appears in it for the people who already see the delegation, without the dates. HR always sees it.')}
      </Fine>
      <Fine>
        {t('During their absences, a manager can delegate their approvals to a deputy for a dated period (My space; or HR, Teams & managers screen): their superior is offered first. The deputy receives the leave and timesheets of the team, and the reviews if the box above is ticked; they never decide their own requests, which go to the manager’s superior or to HR.')}
      </Fine>
    </Panel>
  );
}
