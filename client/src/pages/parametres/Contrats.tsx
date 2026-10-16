// Paramètres → Contrats : alertes avant l'expiration d'un titre de séjour valant autorisation de travail (première alerte,
// dans la fenêtre de la demande de renouvellement en préfecture, puis relance). Réglages de l'administrateur RH ; les
// autres profils de l'espace RH les consultent. Les fins d'essai et de contrat suivent le seuil d'alerte (Règles de suivi).
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const ALERTES: [number, string][] = [[90, '90 j'], [120, '120 j'], [150, '150 j'], [180, '180 j']];
const RELANCES: [number, string][] = [[30, '30 j'], [45, '45 j'], [60, '60 j'], [90, '90 j']];

export function Contrats({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title="Contrats" style={{ gap: 'var(--space-4)' }}>
      <Field label="Titre de séjour : première alerte">
        <Seg name="param-titre-alerte" label="Titre de séjour : première alerte" value={s.titreSejourAlerte} options={ALERTES} disabled={!admin}
          onChange={v => save({ titreSejourAlerte: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Field label="Titre de séjour : relance">
        <Seg name="param-titre-relance" label="Titre de séjour : relance" value={s.titreSejourRelance} options={RELANCES} disabled={!admin}
          onChange={v => save({ titreSejourRelance: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        Le renouvellement d’un titre de séjour se demande en préfecture dans les quatre mois qui précèdent son expiration : l’échéance passe
        « Renouvellement à demander » à la première alerte, « Relance » ensuite. Expiré, le titre rend le salarié non conforme et le passe en
        « No Go » sur les chantiers (art. L5221-8). Les fins de période d’essai, datées du dernier jour où notifier une rupture dans le délai
        de prévenance, et les fins de contrat suivent le seuil d’alerte des règles de suivi.
      </Fine>
    </Panel>
  );
}
