// Paramètres → Liste d'attente des sessions (lot 7, chantier C, t120 ; shared/rules/liste-attente.ts) : activée par défaut ;
// une place libérée est proposée au service RH, qui confirme l'inscription (réponse de l'entreprise du 23 octobre 2026), ou,
// en option, le premier admissible est inscrit et convoqué aussitôt. Désactivée, une demande acceptée sur une session complète
// va au plan de formation, comme avant. Réglages de l'administrateur RH, enregistrés aussitôt ; les autres profils consultent.
import type { ModeAttente } from '../../../../shared/types.ts';
import { Fine, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const MODES: [ModeAttente, string][] = [['confirmer', 'Proposée au service RH'], ['automatique', 'Inscription automatique']];

export function ListeAttente({ s }: SectionProps) {
  const { admin } = useRole();
  const enregistrer = useEnregistrerReglages();
  return (
    <Panel title="Liste d’attente des sessions" style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.formationsListeAttente} disabled={!admin} onChange={e => enregistrer({ formationsListeAttente: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Proposer la liste d’attente quand la session demandée est complète</span>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 14 }}>Quand une place se libère</span>
        <Seg name="attente-mode" label="Quand une place se libère" value={s.formationsAttenteMode} disabled={!admin} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={MODES} onChange={mode => enregistrer({ formationsAttenteMode: mode })} />
      </div>
      <Fine>
        Une demande de formation acceptée sur une session complète place le salarié dans la file de la session, dans l’ordre d’acceptation, sans
        autre priorité ; la réponse et l’e-mail lui disent que la session est pleine et quelle est sa place. Une place libérée (désinscription,
        changement de session, recyclage enregistré, places ajoutées, sortie, demande rouverte) est {s.formationsAttenteMode === 'automatique'
          ? 'donnée au premier encore admissible, inscrit et convoqué aussitôt'
          : 'proposée au service RH pour le premier encore admissible : l’inscription se confirme dans le détail de la session, et la convocation part à ce moment-là'}.
        Un salarié qui n’est plus admissible (absent ou inscrit ailleurs ces jours-là, sorti, recyclage déjà enregistré) est passé, le motif au
        journal. La file est close à l’annulation ou à la clôture de la session : les demandes repassent au plan de formation. Le salarié, son
        manager et le service RH peuvent retirer une personne de la file. Liste désactivée : la demande va au plan de formation, la réponse dit
        que la session était complète.
      </Fine>
    </Panel>
  );
}
