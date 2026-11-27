// Paramètres → Suivi des feuilles de temps (t130) : semaines affichées dans le tableau de l'écran Temps, jour et heure de
// la semaine suivante où une feuille est attendue (par défaut le lundi à 12 h), au-delà desquels elle est en retard et se
// relance (shared/rules/suivi-feuilles.ts). Réglages de l'administrateur RH ; les autres profils consultent. La date de
// clôture des variables de paie se règle dans la section Paie.
import { delaiTexte } from '../../../../shared/rules/suivi-feuilles.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const SEMAINES = Array.from({ length: 11 }, (_, i) => i + 2);
/** Jour limite : sources anglaises, traduites au rendu. */
const JOURS: [number, string][] = [[1, 'Following Monday'], [2, 'Following Tuesday'], [3, 'Following Wednesday'], [4, 'Following Thursday'], [5, 'Following Friday']];
const HEURES = Array.from({ length: 24 }, (_, i) => i);

export function FeuillesTemps({ s }: SectionProps) {
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  return (
    <Panel title={t('Follow-up of timesheets')} style={{ gap: 'var(--space-4)' }}>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Timesheet expected on')} htmlFor="ft-jour">
          <select className="input" id="ft-jour" value={s.feuilleLimiteJour} disabled={!admin} onChange={e => save({ feuilleLimiteJour: Number(e.target.value) })}>
            {JOURS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
        </Field>
        <Field label={t('At#time')} htmlFor="ft-heure">
          <select className="input" id="ft-heure" value={s.feuilleLimiteHeure} disabled={!admin} onChange={e => save({ feuilleLimiteHeure: Number(e.target.value) })}>
            {HEURES.map(h => <option key={h} value={h}>{h}{t(' h#hours')}</option>)}
          </select>
        </Field>
        <Field label={t('Weeks shown')} htmlFor="ft-semaines">
          <select className="input" id="ft-semaines" value={s.suiviSemaines} disabled={!admin} onChange={e => save({ suiviSemaines: Number(e.target.value) })}>
            {SEMAINES.map(n => <option key={n} value={n}>{n}{t(' weeks#count')}</option>)}
          </select>
        </Field>
      </div>
      <Fine>
        {t('A timesheet is expected ')}{delaiTexte(s)}{t(': past this time limit, a timesheet not entered, in draft or to correct is late, flagged in the Working time screen and reminded in one click (e-mail to the employee and their approver). The closing of payroll variables is set in the Payroll section.')}
      </Fine>
    </Panel>
  );
}
