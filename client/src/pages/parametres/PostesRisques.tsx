// Paramètres → Postes à risques particuliers (t061, shared/rules/formation-renforcee.ts) : formation du catalogue exigée,
// comme formation renforcée à la sécurité, des CDD, intérimaires et alternants affectés à un poste coché « à risques
// particuliers » (art. L4154-2) dans Référentiels → Postes. Non désignée par défaut : aucune exigence, et un avertissement
// tant qu'elle ne l'est pas. Réglage de l'administrateur RH, enregistré aussitôt ; les autres profils le consultent.
import { actifs } from '../../../../shared/rules/referentiels.ts';
import { avertissementRenforcee, postesARisques } from '../../../../shared/rules/formation-renforcee.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

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
    <Panel title={t('Jobs with particular risks')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Enhanced safety training')} htmlFor="param-formation-renforcee">
        <select className="input" id="param-formation-renforcee" value={s.formationRenforceeCode} disabled={!admin}
          onChange={e => enregistrer({ formationRenforceeCode: e.target.value })} style={{ maxWidth: 360 }}>
          <option value="">{t('Not designated#fem')}</option>
          {inconnue && <option value={s.formationRenforceeCode}>{s.formationRenforceeCode}{t(' (archived or missing from the catalogue)')}</option>}
          {formations.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
      </Field>
      {avertissement && <NoteAccent>{avertissement}</NoteAccent>}
      <Fine>
        {t('Required from fixed-term employees, temps and work-study students assigned to a job ticked “List of jobs with particular risks” in Reference data → Jobs (')}{tn(postes.length, 'job ticked', 'jobs ticked')}{t('): only a certification obtained since their entry fulfils it. Without it, the employee is “Non-compliant”, the due date offers to enrol them, and the Go / No Go of the worksites answers No Go (reason “CERTIFICATION”) — reservation if a session is planned before the start. The list of jobs is drawn up after the opinion of the occupational doctor and the CSE (art. L4154-2) and is printed from the Jobs tab.')}
      </Fine>
    </Panel>
  );
}
