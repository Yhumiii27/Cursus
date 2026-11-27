// Paramètres → Formations (t118, shared/rules/formations-temps.ts) : heures des sessions de formation proposées dans la
// feuille de temps des inscrits (ligne interne INT-FORM, jamais envoyée à Keystone). Réglage de l'administrateur RH,
// enregistré aussitôt ; les autres profils le consultent. Actif par défaut.
import { ACTIVITE_FORMATION } from '../../../../shared/constants.ts';
import { fH } from '../../../../shared/format.ts';
import { HEURES_JOUR_MAX } from '../../../../shared/rules/temps.ts';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
// lot 12 — C4 (organismes de formation et e-learning) : relance Qualiopi et fin des modules d'e-learning.
import { Field } from '../../components/Dialog.tsx';

/** lot 12 — C4 : premiers paliers proposés pour la relance Qualiopi (acceptés par le réglage, `entier(16, 180)`). */
const PALIERS_QUALIOPI = (): [number, string][] => [30, 60, 90, 120].map(n => [n, tn(n, 'day', 'days')]);
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

export function Formations({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title={t('Training')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.formationsTemps} disabled={!admin} onChange={e => enregistrer({ formationsTemps: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Offer the training hours in the timesheets')}</span>
      </label>
      <Fine>
        {t('“Offer” on the Working time screen adds to the timesheet, for each session of the week the employee is enrolled in (or present, once the session is closed), a line ')}{ACTIVITE_FORMATION.code} · {ACTIVITE_FORMATION.nom}{t(' with the planned hours: those of the session schedule, break deducted (')}{fH(HEURES_JOUR_MAX)}{t(' per day at most), otherwise the catalogue duration split over its days, one working day at most. Nothing on public holidays, absence or non-working days. The lines already entered are kept: only the line of the same training course and the Keystone tasks already offered are replaced. The hours stay editable by the employee and their approver; internal activity, they never go to Keystone.')}
      </Fine>
      {/* lot 12 — C4 (organismes de formation et e-learning) */}
      <Field label={t('Reminder before the end of Qualiopi validity of a provider')}>
        <Seg name="param-qualiopi" label={t('First Qualiopi reminder')} value={s.organismeAlerteQualiopiJours} disabled={!admin} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={PALIERS_QUALIOPI().some(([n]) => n === s.organismeAlerteQualiopiJours) ? PALIERS_QUALIOPI() : [...PALIERS_QUALIOPI(), [s.organismeAlerteQualiopiJours, tn(s.organismeAlerteQualiopiJours, 'day', 'days')]]}
          onChange={v => enregistrer({ organismeAlerteQualiopiJours: v })} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.elearningFinAutoImport} disabled={!admin} onChange={e => enregistrer({ elearningFinAutoImport: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Approve automatically the end of an e-learning module on import (“completed” and “passed”), for the modules without a required certificate')}</span>
      </label>
      <Fine>
        {t('Qualiopi: HR is reminded by the summary of due dates at this step, 15 days before, then once the certification has expired; it is a warning, never a block. E-learning: without automatic end, each end declared or imported awaits HR’s approval, which creates the training followed and, for a module attached to the catalogue, the certification. Evaluations by provider: 3 rolling financial years by default (5 to choose on the sheet).')}
      </Fine>
    </Panel>
  );
}
