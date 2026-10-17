// Paramètres → Santé : périodicité des visites médicales selon le type de suivi (shared/rules/suivi-medical.ts), quand le
// médecin du travail n'a pas fixé la date de la prochaine visite avec son avis. 24 mois pour tous par défaut, le plus
// prudent, dans les maximums légaux ; âge de la visite de mi-carrière (shared/rules/visites-dues.ts, 45 ans par défaut).
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent.
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const mois = (valeurs: number[]): [number, string][] => valeurs.map(n => [n, `${n} mois`]);
/** Âges proposés pour la visite de mi-carrière : 45 ans à défaut d'accord de branche (art. L4624-2-2). */
const AGES_MI_CARRIERE: [number, string][] = [40, 42, 45, 47, 50].map(n => [n, `${n} ans`]);

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
      <Field label="Visite de mi-carrière">
        <Seg name="param-sante-mi-carriere" label="Âge de la visite de mi-carrière" value={s.santeMiCarriereAge} options={AGES_MI_CARRIERE} disabled={!admin}
          onChange={v => save({ santeMiCarriereAge: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        La date de la prochaine visite fixée par le médecin du travail, saisie avec son avis, prime toujours. À défaut, la visite suit la
        périodicité du type de suivi du salarié : VIP 5 ans au plus (art. R4624-16), VIP adaptée 3 ans au plus (art. R4624-17), suivi
        individuel renforcé avec une visite intermédiaire à 2 ans au plus et un examen d’aptitude à 4 ans au plus (art. R4624-28). Le suivi
        renforcé se déduit des habilitations et des postes cochés « suivi individuel renforcé » dans Référentiels ; sans examen d’aptitude
        enregistré, l’échéance « Examen d’aptitude requis » s’affiche.
      </Fine>
      <Fine>
        Visites dues signalées dans les échéances : embauche dans les 3 mois de l’entrée, le jour même pour un suivi renforcé ou un mineur
        (art. R4624-10, R4624-18 et R4624-24) ; reprise après un congé de maternité ou une maladie professionnelle, 30 jours d’accident du
        travail ou 60 jours de maladie (art. R4624-31, seuils de la loi) ; mi-carrière l’année de l’âge choisi ci-dessus, 45 ans à défaut
        d’accord de branche (art. L4624-2-2) ; fin de carrière ou post-exposition avant le départ d’un salarié en suivi renforcé ou exposé
        à des risques particuliers (art. L4624-2-1).
      </Fine>
    </Panel>
  );
}
