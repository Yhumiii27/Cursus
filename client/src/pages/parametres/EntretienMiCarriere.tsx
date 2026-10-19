// Paramètres → Entretien de mi-carrière (t069, shared/rules/entretien-mi-carriere.ts) : entretien de parcours proposé
// après la visite médicale de mi-carrière, dans le délai réglé (2 mois par défaut, lecture la plus prudente du texte).
// Délai à confirmer juridiquement (bandeau) : réforme de l'entretien de parcours professionnel, accord de branche ou
// d'entreprise. Réglages de l'administrateur RH, enregistrés aussitôt ; les autres profils les consultent.
import { Field } from '../../components/Dialog.tsx';
import { Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Délais proposés, tous acceptés par le réglage (`entier(1, 12)`, shared/reglages.ts). */
const DELAIS: [number, string][] = [1, 2, 3, 6, 12].map(n => [n, `${n} mois`]);

export function EntretienMiCarriere({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  return (
    <Panel title="Entretien de mi-carrière" style={{ gap: 'var(--space-4)' }}>
      <NoteAccent>Délai à confirmer juridiquement (conseil de l’entreprise ou service RH), ainsi que l’effet d’un accord de branche ou d’entreprise.</NoteAccent>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.entretienMiCarriereActif} disabled={!admin} onChange={e => enregistrer({ entretienMiCarriereActif: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Proposer un entretien de parcours après la visite de mi-carrière</span>
      </label>
      <Field label="Délai après la visite">
        <Seg name="param-mi-carriere-delai" label="Délai de l’entretien après la visite de mi-carrière" value={s.entretienMiCarriereMois}
          options={DELAIS.some(([n]) => n === s.entretienMiCarriereMois) ? DELAIS : [...DELAIS, [s.entretienMiCarriereMois, `${s.entretienMiCarriereMois} mois`]]}
          disabled={!admin || !s.entretienMiCarriereActif} onChange={v => enregistrer({ entretienMiCarriereMois: v })} style={{ flexWrap: 'wrap' }} />
      </Field>
      <Fine>
        Dès qu’une visite de mi-carrière est enregistrée (avis du médecin du travail de ce motif), l’entretien de parcours du salarié est
        dû dans ce délai : il apparaît dans les entretiens à planifier et le récapitulatif des échéances, et avance l’échéance périodique
        de 4 ans si elle est plus lointaine. Un entretien de parcours réalisé depuis la visite le remplit. Le manager voit « entretien de
        mi-carrière à planifier avant le … », jamais la visite. Sans visite enregistrée, rien n’est déclenché : la visite elle-même reste
        suivie dans les visites dues (Paramètres → Santé).
      </Fine>
    </Panel>
  );
}
