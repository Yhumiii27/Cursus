// Paramètres → Hiérarchie des managers (t136, shared/rules/hierarchie.ts) : consultation N+2, désactivée par défaut
// (réponse de l'entreprise du 18 octobre 2026). Activée, un manager consulte en lecture seule les membres des équipes
// rattachées aux siennes (équipe parente, écran Équipes & managers), sans donnée médicale ni entretien ; les décisions
// restent à leur manager direct. Réglage de l'administrateur RH, enregistré aussitôt ; les autres profils le consultent.
import { PROFONDEUR_MAX } from '../../../../shared/rules/hierarchie.ts';
import { Fine, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

export function Hierarchie({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title="Hiérarchie des managers" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.consultationN2} disabled={!admin} onChange={e => enregistrer({ consultationN2: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Consultation N+2 : le manager voit, en lecture seule, les membres des équipes rattachées aux siennes</span>
      </label>
      {/* Délégation des validations (t135) : congés et feuilles de temps ; les entretiens seulement si cette case l'ouvre. */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.delegationEntretiens} disabled={!admin} onChange={e => enregistrer({ delegationEntretiens: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Délégation des entretiens : le suppléant d’un manager absent peut aussi recevoir ses entretiens</span>
      </label>
      <Fine>
        Une équipe peut être rattachée à une équipe parente (écran Équipes & managers, {PROFONDEUR_MAX} niveaux au plus) : le manager de l’équipe,
        quand il en est membre, soumet alors ses absences, ses feuilles de temps et ses entretiens au manager de l’équipe parente, et non plus au
        service RH. Les demandes déjà en attente changent de valideur à l’enregistrement ; le nouveau valideur en est prévenu. La consultation N+2
        montre la fiche, les absences et les feuilles des membres des équipes rattachées, avec les mêmes restrictions que pour l’équipe directe et
        sans aptitude médicale détaillée ni entretien ; les décisions restent à leur manager direct.
      </Fine>
      <Fine>
        Pendant ses absences, un manager peut déléguer ses validations à un suppléant pour une période datée (Mon espace ; ou le service RH, écran
        Équipes & managers) : son responsable est proposé d’abord. Le suppléant reçoit les congés et les feuilles de temps de l’équipe, et les entretiens
        si la case ci-dessus est cochée ; il ne décide jamais de ses propres demandes, qui vont au responsable du manager ou au service RH.
      </Fine>
    </Panel>
  );
}
