// Paramètres → Postes à risques particuliers (t061, shared/rules/formation-renforcee.ts) : formation du catalogue exigée,
// comme formation renforcée à la sécurité, des CDD, intérimaires et alternants affectés à un poste coché « à risques
// particuliers » (art. L4154-2) dans Référentiels → Postes. Non désignée par défaut : aucune exigence, et un avertissement
// tant qu'elle ne l'est pas. Réglage de l'administrateur RH, enregistré aussitôt ; les autres profils le consultent.
import { actifs } from '../../../../shared/rules/referentiels.ts';
import { avertissementRenforcee, postesARisques } from '../../../../shared/rules/formation-renforcee.ts';
import { plural } from '../../../../shared/format.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function PostesRisques({ s }: SectionProps) {
  const d = useDomain();
  const { admin, espaceRh } = useRole();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  const formations = actifs(d.ds.referentiels.formations);
  // Formation désignée puis archivée : gardée dans la liste pour que la valeur affichée soit celle enregistrée.
  const inconnue = s.formationRenforceeCode && !formations.some(f => f.id === s.formationRenforceeCode);
  const avertissement = avertissementRenforcee({ ...d.ds, settings: s });
  const postes = postesARisques(d.ds.referentiels.postes);
  return (
    <Panel title="Postes à risques particuliers" style={{ gap: 'var(--space-4)' }}>
      <Field label="Formation renforcée à la sécurité" htmlFor="param-formation-renforcee">
        <select className="input" id="param-formation-renforcee" value={s.formationRenforceeCode} disabled={!admin}
          onChange={e => enregistrer({ formationRenforceeCode: e.target.value })} style={{ maxWidth: 360 }}>
          <option value="">Non désignée</option>
          {inconnue && <option value={s.formationRenforceeCode}>{s.formationRenforceeCode} (archivée ou absente du catalogue)</option>}
          {formations.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
      </Field>
      {avertissement && <NoteAccent>{avertissement}</NoteAccent>}
      <Fine>
        Exigée des salariés en CDD, des intérimaires et des alternants affectés à un poste coché « Liste des postes à risques particuliers »
        dans Référentiels → Postes ({plural(postes.length, 'poste coché', 'postes cochés')}) : seule une certification obtenue depuis leur
        entrée la remplit. Sans elle, le salarié est « Non conforme », l’échéance propose de l’inscrire, et le Go / No Go des chantiers
        répond No Go (motif « CERTIFICATION ») — réserve si une session est planifiée avant le démarrage. La liste des postes s’établit
        après avis du médecin du travail et du CSE (art. L4154-2) et s’imprime depuis l’onglet Postes.
      </Fine>
    </Panel>
  );
}
