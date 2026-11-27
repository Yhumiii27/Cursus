// Paramètres → Évaluation des formations (lot 7, chantier C, t121 ; shared/rules/evaluation-formation.ts) : activée par
// défaut ; avis à chaud du salarié après chaque formation ; efficacité à froid 90 jours après, remplie par le salarié et son
// manager (réponse de l'entreprise du 23 octobre 2026), pour les formations réglementaires et recommandées. Échelles fixes
// (1 à 5 ; efficace, partiellement, non) en attendant un questionnaire qualité de l'entreprise. Réglages de
// l'administrateur RH, enregistrés aussitôt ; les autres profils les consultent.
import { CATEGORIES_EVALUEES, DELAI_CHAUD_JOURS, REPONDANTS_FROID_LABEL, RELANCES_FROID } from '../../../../shared/rules/evaluation-formation.ts';
import type { CategorieEvaluee, RepondantsFroid } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

/** Délais proposés, tous acceptés par le réglage (`entier(30, 365)`, shared/reglages.ts). */
const DELAIS = (): [number, string][] => [60, 90, 120, 180].map(n => [n, tn(n, 'day', 'days')]);
const REPONDANTS = Object.entries(REPONDANTS_FROID_LABEL) as [RepondantsFroid, string][];

export function EvaluationsFormation({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  const off = !admin || !s.evaluationsActives;
  const cocher = (c: CategorieEvaluee, oui: boolean) =>
    enregistrer({ evaluationFroidCategories: CATEGORIES_EVALUEES.filter(x => (x === c ? oui : s.evaluationFroidCategories.includes(x))) });
  return (
    <Panel title={t('Evaluation of training courses')} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.evaluationsActives} disabled={!admin} onChange={e => enregistrer({ evaluationsActives: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Ask the participants’ feedback after each training course, and the effectiveness a few months later')}</span>
      </label>
      <Field label={t('Cold evaluation after the training course')}>
        <Seg name="param-eval-delai" label={t('Time limit of the cold evaluation')} value={s.evaluationFroidDelai} disabled={off} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={DELAIS().some(([n]) => n === s.evaluationFroidDelai) ? DELAIS() : [...DELAIS(), [s.evaluationFroidDelai, tn(s.evaluationFroidDelai, 'day', 'days')]]}
          onChange={v => enregistrer({ evaluationFroidDelai: v })} />
      </Field>
      <Field label={t('Filled in by')}>
        <Seg name="param-eval-par" label={t('Cold evaluation filled in by')} value={s.evaluationFroidPar} disabled={off} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={REPONDANTS} onChange={v => enregistrer({ evaluationFroidPar: v })} />
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>{t('Training courses evaluated cold')}</legend>
        {CATEGORIES_EVALUEES.map(c => (
          <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.evaluationFroidCategories.includes(c)} disabled={off} onChange={e => cocher(c, e.target.checked)}
              style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
            <span>{c === 'Hors catalogue' ? t('Training courses outside the catalogue') : `${c}s`}</span>
          </label>
        ))}
      </fieldset>
      <Fine>
        {t('Hot: the employee rates the training course from 1 to 5 in their space (“To do” box for ')}{DELAI_CHAUD_JOURS}{t(' days, one e-mail), or HR collects their feedback at the closing of the session. Cold: on the day, the effectiveness (effective, partly, not effective) is requested by e-mail, then reminded ')}{RELANCES_FROID.join(t(' and #et'))}{t(' days afterwards; it stays in the employee’s “To do” and in the manager’s Training screen. The comments are only read by HR; the HSE referent and the read-only role see the indicators, without an average under 3 answers. Indicators by provider and by training course: Plan & budget. Deactivated: no more request nor reminder, the feedback already given stays.')}
      </Fine>
    </Panel>
  );
}
