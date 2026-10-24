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

/** Délais proposés, tous acceptés par le réglage (`entier(30, 365)`, shared/reglages.ts). */
const DELAIS: [number, string][] = [60, 90, 120, 180].map(n => [n, `${n} jours`]);
const REPONDANTS = Object.entries(REPONDANTS_FROID_LABEL) as [RepondantsFroid, string][];

export function EvaluationsFormation({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  const off = !admin || !s.evaluationsActives;
  const cocher = (c: CategorieEvaluee, oui: boolean) =>
    enregistrer({ evaluationFroidCategories: CATEGORIES_EVALUEES.filter(x => (x === c ? oui : s.evaluationFroidCategories.includes(x))) });
  return (
    <Panel title="Évaluation des formations" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.evaluationsActives} disabled={!admin} onChange={e => enregistrer({ evaluationsActives: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Demander l’avis des participants après chaque formation, et l’efficacité quelques mois plus tard</span>
      </label>
      <Field label="Évaluation à froid après la formation">
        <Seg name="param-eval-delai" label="Délai de l’évaluation à froid" value={s.evaluationFroidDelai} disabled={off} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={DELAIS.some(([n]) => n === s.evaluationFroidDelai) ? DELAIS : [...DELAIS, [s.evaluationFroidDelai, `${s.evaluationFroidDelai} jours`]]}
          onChange={v => enregistrer({ evaluationFroidDelai: v })} />
      </Field>
      <Field label="Remplie par">
        <Seg name="param-eval-par" label="Évaluation à froid remplie par" value={s.evaluationFroidPar} disabled={off} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={REPONDANTS} onChange={v => enregistrer({ evaluationFroidPar: v })} />
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Formations évaluées à froid</legend>
        {CATEGORIES_EVALUEES.map(c => (
          <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.evaluationFroidCategories.includes(c)} disabled={off} onChange={e => cocher(c, e.target.checked)}
              style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
            <span>{c === 'Hors catalogue' ? 'Formations hors catalogue' : `${c}s`}</span>
          </label>
        ))}
      </fieldset>
      <Fine>
        À chaud : le salarié note la formation de 1 à 5 dans son espace (encart « À faire » pendant {DELAI_CHAUD_JOURS} jours, un e-mail), ou le service RH
        recueille son avis à la clôture de la session. À froid : le jour venu, l’efficacité (efficace, partiellement, pas efficace) est demandée par
        e-mail, puis relancée {RELANCES_FROID.join(' et ')} jours après ; elle reste dans « À faire » du salarié et dans l’écran Formations du manager.
        Les commentaires ne sont lus que par le service RH ; le référent HSE et la lecture seule voient les indicateurs, sans moyenne sous 3 réponses.
        Indicateurs par organisme et par formation : Plan & budget. Désactivée : plus de demande ni de relance, les avis déjà donnés restent.
      </Fine>
    </Panel>
  );
}
