// Paramètres → Absences et paie (t028, shared/rules/absences-paie.ts) : absences validées dans le fichier d'import de la
// paie, avec les heures. Activé par défaut (réponse de l'entreprise du 17 octobre 2026) ; décoché, le fichier se limite
// aux heures et la paie saisit les absences dans Sage. Date de mise en service : premier jour d'absence transmis, les
// jours d'avant ayant été traités par Lucca et Sage. Réglages de l'administrateur RH, enregistrés aussitôt (la date en
// quittant le champ) ; les autres profils les consultent. Les codes Sage des rubriques d'absence se confirment sur
// l'écran Temps (« Rubriques de paie »).
import { useEffect, useState } from 'react';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

export function AbsencesPaie({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  // Date saisie, enregistrée en quittant le champ : une saisie au clavier passe par des dates intermédiaires.
  const [depart, setDepart] = useState(s.absencesPaieAPartirDu ?? '');
  useEffect(() => setDepart(s.absencesPaieAPartirDu ?? ''), [s.absencesPaieAPartirDu]);
  const enregistrerDepart = () => {
    if (depart !== (s.absencesPaieAPartirDu ?? '')) enregistrer({ absencesPaieAPartirDu: depart || null });
  };
  return (
    <Panel title={t('Absences and payroll')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.absencesFichierPaie} disabled={!admin} onChange={e => enregistrer({ absencesFichierPaie: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Transmit the approved absences in the payroll import file')}</span>
      </label>
      <Fine>
        {t('Each payroll batch carries, with the hours, the approved absences: paid leave in working days, RTT or rest days in days, recovery in hours, half-days included; apart from leave, one item per pay (unpaid, compensated, salary maintained) and per category (health, parenthood, family event), in days of the nature. The days are split month by month; those of a closed period go as a back pay. An absence cancelled, shortened or requalified after its transmission goes as a negative adjustment in the next batch. The absence items stay “to be confirmed”: as long as payroll has not confirmed their Sage code (Time screen), only a simulation batch is generated; a deactivated item leaves its nature to be entered in Sage. Unticked, the file is limited to the hours; ticked again, the absences already recorded only go from the open payroll period (payroll entered the others in Sage).')}
      </Fine>
      <Field label={t('Absences transmitted from')} htmlFor="param-absences-depuis">
        <input className="input" id="param-absences-depuis" type="date" value={depart} disabled={!admin} style={{ maxWidth: 200 }}
          onChange={ev => setDepart(ev.target.value)} onBlur={enregistrerDepart} />
      </Field>
      <Fine>
        {t('Go-live date (recommended: the closing date of the counters taken over from Lucca, 1 January 2027): no absence day before it goes in the file, Lucca and Sage processed them. HR is notified when an absence recorded, approved or cancelled has days before this date, to be entered or corrected in Sage. Without a date, the first payroll batch sets its own at the first day of the open period, for the absences already recorded; an absence recorded afterwards goes in full, as a back pay for a closed month.')}
      </Fine>
    </Panel>
  );
}
