// Paramètres → Santé : périodicité des visites médicales selon le type de suivi (shared/rules/suivi-medical.ts), quand le
// médecin du travail n'a pas fixé la date de la prochaine visite avec son avis. 24 mois pour tous par défaut, le plus
// prudent, dans les maximums légaux ; âge de la visite de mi-carrière (shared/rules/visites-dues.ts, 45 ans par défaut).
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent.
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const mois = (valeurs: number[]): [number, string][] => valeurs.map(n => [n, `${n}${t(' months#count')}`]);
/**
 * Âges proposés pour la visite de mi-carrière, tous ceux qu'accepte le réglage (`entier(40, 55)`, shared/reglages.ts) :
 * 45 ans à défaut d'accord de branche (art. L4624-2-2), l'âge fixé par l'accord sinon.
 */
const AGES_MI_CARRIERE = Array.from({ length: 16 }, (_, i) => 40 + i);

export function Sante({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title={t('Health')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Information and prevention visit (VIP)')}>
        <Seg name="param-sante-vip" label={t('Frequency of the VIP')} value={s.santeVipMois} options={mois([12, 24, 36, 48, 60])} disabled={!admin}
          onChange={v => save({ santeVipMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Adapted VIP (night work, disability, invalidity)')}>
        <Seg name="param-sante-vip-adaptee" label={t('Frequency of the adapted VIP')} value={s.santeVipAdapteeMois} options={mois([12, 24, 36])} disabled={!admin}
          onChange={v => save({ santeVipAdapteeMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Enhanced monitoring: intermediate visit')}>
        <Seg name="param-sante-sir-intermediaire" label={t('Intermediate visit of the enhanced monitoring')} value={s.santeSirIntermediaireMois} options={mois([12, 24])} disabled={!admin}
          onChange={v => save({ santeSirIntermediaireMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Enhanced monitoring: fitness examination')}>
        <Seg name="param-sante-sir-aptitude" label={t('Fitness examination of the enhanced monitoring')} value={s.santeSirAptitudeMois} options={mois([24, 36, 48])} disabled={!admin}
          onChange={v => save({ santeSirAptitudeMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label={t('Mid-career visit')} htmlFor="param-sante-mi-carriere">
        <select className="input" id="param-sante-mi-carriere" value={s.santeMiCarriereAge} disabled={!admin}
          onChange={e => save({ santeMiCarriereAge: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {AGES_MI_CARRIERE.map(n => <option key={n} value={n}>{n}{t(' years old')}{n === 45 ? t(' (failing a branch agreement)') : ''}</option>)}
        </select>
      </Field>
      <Fine>
        {t('The date of the next visit set by the occupational doctor, entered with their opinion, always prevails. Failing that, the visit follows the frequency of the employee’s type of monitoring: VIP 5 years at most (art. R4624-16), adapted VIP 3 years at most (art. R4624-17), enhanced individual monitoring with an intermediate visit at 2 years at most and a fitness examination at 4 years at most (art. R4624-28). The enhanced monitoring is deduced from the authorisations and the jobs ticked “enhanced individual monitoring” in Reference data; without a fitness examination recorded, the due date “Fitness examination required” is shown.')}
      </Fine>
      <Fine>
        {t('Visits due flagged in the due dates: hiring within 3 months of the entry, the same day for enhanced monitoring or a minor (art. R4624-10, R4624-18 and R4624-24); return after a maternity leave or an occupational disease, 30 days of work accident or 60 days of illness (art. R4624-31, thresholds of the law); mid-career in the year of the age chosen above, 45 years failing a branch agreement (art. L4624-2-2); end of career or post-exposure before the departure of an employee under enhanced monitoring or exposed to particular risks (art. L4624-2-1).')}
      </Fine>
    </Panel>
  );
}
