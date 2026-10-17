// Paramètres → Santé : périodicité des visites médicales selon le type de suivi (shared/rules/suivi-medical.ts), quand le
// médecin du travail n'a pas fixé la date de la prochaine visite avec son avis. 24 mois pour tous par défaut, le plus
// prudent, dans les maximums légaux. Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent.
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const mois = (valeurs: number[]): [number, string][] => valeurs.map(n => [n, `${n} mois`]);

export function Sante({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title="Santé" style={{ gap: 'var(--space-4)' }}>
      <Field label="Visite d’information et de prévention (VIP)">
        <Seg name="param-sante-vip" label="Périodicité de la VIP" value={s.santeVipMois} options={mois([12, 24, 36, 48, 60])} disabled={!admin}
          onChange={v => save({ santeVipMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="VIP adaptée (travail de nuit, handicap, invalidité)">
        <Seg name="param-sante-vip-adaptee" label="Périodicité de la VIP adaptée" value={s.santeVipAdapteeMois} options={mois([12, 24, 36])} disabled={!admin}
          onChange={v => save({ santeVipAdapteeMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="Suivi renforcé : visite intermédiaire">
        <Seg name="param-sante-sir-intermediaire" label="Visite intermédiaire du suivi renforcé" value={s.santeSirIntermediaireMois} options={mois([12, 24])} disabled={!admin}
          onChange={v => save({ santeSirIntermediaireMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="Suivi renforcé : examen d’aptitude">
        <Seg name="param-sante-sir-aptitude" label="Examen d’aptitude du suivi renforcé" value={s.santeSirAptitudeMois} options={mois([24, 36, 48])} disabled={!admin}
          onChange={v => save({ santeSirAptitudeMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        La date de la prochaine visite fixée par le médecin du travail, saisie avec son avis, prime toujours. À défaut, la visite suit la
        périodicité du type de suivi du salarié : VIP 5 ans au plus (art. R4624-16), VIP adaptée 3 ans au plus (art. R4624-17), suivi
        individuel renforcé avec une visite intermédiaire à 2 ans au plus et un examen d’aptitude à 4 ans au plus (art. R4624-28). Le suivi
        renforcé se déduit des habilitations et des postes cochés « suivi individuel renforcé » dans Référentiels ; sans examen d’aptitude
        enregistré, l’échéance « Examen d’aptitude requis » s’affiche.
      </Fine>
    </Panel>
  );
}
