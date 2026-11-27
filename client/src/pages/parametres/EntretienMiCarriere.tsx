// Paramètres → Entretien de mi-carrière (t069, shared/rules/entretien-mi-carriere.ts) : entretien de parcours proposé
// après la visite médicale de mi-carrière, dans le délai réglé (2 mois par défaut, lecture la plus prudente du texte).
// Délai à confirmer juridiquement (bandeau) : réforme de l'entretien de parcours professionnel, accord de branche ou
// d'entreprise. Réglages de l'administrateur RH, enregistrés aussitôt ; les autres profils les consultent.
import { Field } from '../../components/Dialog.tsx';
import { Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

/** Délais proposés, tous acceptés par le réglage (`entier(1, 12)`, shared/reglages.ts). */
const DELAIS = (): [number, string][] => [1, 2, 3, 6, 12].map(n => [n, `${n}${t(' months#count')}`]);

export function EntretienMiCarriere({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title={t('Mid-career review')} style={{ gap: 'var(--space-4)' }}>
      <NoteAccent>{t('Time limit to be confirmed legally (company counsel or HR), as well as the effect of a branch or company agreement.')}</NoteAccent>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.entretienMiCarriereActif} disabled={!admin} onChange={e => enregistrer({ entretienMiCarriereActif: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Offer a career review after the mid-career visit')}</span>
      </label>
      <Field label={t('Time limit after the visit')}>
        <Seg name="param-mi-carriere-delai" label={t('Time limit of the review after the mid-career visit')} value={s.entretienMiCarriereMois}
          options={DELAIS().some(([n]) => n === s.entretienMiCarriereMois) ? DELAIS() : [...DELAIS(), [s.entretienMiCarriereMois, `${s.entretienMiCarriereMois}${t(' months#count')}`]]}
          disabled={!admin || !s.entretienMiCarriereActif} onChange={v => enregistrer({ entretienMiCarriereMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        {t('As soon as a mid-career visit is recorded (opinion of the occupational doctor for this reason), the employee’s career review is due within this time limit: it appears in the reviews to plan and the summary of due dates, and brings forward the periodic due date of 4 years if it is further away. A career review held since the visit fulfils it. The manager sees “mid-career review to plan before …”, never the visit. Without a visit recorded, nothing is triggered: the visit itself stays followed in the visits due (Settings → Health).')}
      </Fine>
    </Panel>
  );
}
