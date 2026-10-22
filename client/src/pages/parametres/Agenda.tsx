// Paramètres → Agenda (t036, server/src/agenda.ts) : abonnement de chaque salarié à son agenda personnel (Outlook),
// désactivé par défaut, et ce que le flux publie. Les absences y figurent toujours sous « Absent », quelle que soit leur
// nature. L'administrateur RH révoque tous les abonnements d'un coup (adresse divulguée, changement de règle) ; chaque
// salarié gère le sien depuis son portail. Les congés validés arrivent aussi par l'e-mail de décision (.ics joint).
import type { ContenuAgenda } from '../../../../shared/types.ts';
import { Btn, Fine, Panel, Tag } from '../../components/ui.tsx';
import type { Confirmation } from '../../state/confirmations.ts';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

const CONTENUS: [ContenuAgenda, string][] = [
  ['sessions', 'Sessions de formation où il est inscrit'],
  ['entretiens', 'Entretiens planifiés'],
  ['absences', 'Absences et congés en vigueur (sous « Absent »)'],
  ['deplacements', 'Déplacements (pays et dates)'],
];

/** Révocation de tous les abonnements : chacun en recrée un depuis son espace. */
const revocationAgendas = (): Confirmation => ({
  titre: 'Révoquer tous les abonnements',
  question: 'Révoquer les abonnements de tous les salariés à leur agenda ?',
  suites: ['Les agendas abonnés cessent de se mettre à jour ; les événements déjà reçus restent jusqu’à la prochaine lecture.', 'Chacun peut créer une nouvelle adresse depuis son espace.'],
  bouton: 'Révoquer tout',
  action: 'agenda.revoquerTout',
  payload: {},
});

export function Agenda({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const { openDialog } = useStore();
  const enregistrer = useEnregistrerReglages();
  if (!espaceRh) return null;
  const basculer = (c: ContenuAgenda, oui: boolean) => enregistrer({ agendaContenu: CONTENUS.map(([k]) => k).filter(k => (k === c ? oui : s.agendaContenu.includes(k))) });
  return (
    <Panel title="Agenda" aside={<Tag cls={s.agendaFluxActif ? 'tag-neutral' : 'tag-outline'}>{s.agendaFluxActif ? 'Abonnement ouvert' : 'Désactivé'}</Tag>} style={{ gap: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.agendaFluxActif} disabled={!admin} onChange={e => enregistrer({ agendaFluxActif: e.target.checked })}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Abonnement à l’agenda personnel : chaque salarié peut ajouter son agenda Cursus à Outlook depuis son espace</span>
      </label>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend className="text-muted sub" style={{ marginBottom: 'var(--space-2)' }}>Contenu publié</legend>
        {CONTENUS.map(([k, l]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.agendaContenu.includes(k)} disabled={!admin} onChange={e => basculer(k, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
            <span>{l}</span>
          </label>
        ))}
      </fieldset>
      {admin && <div><Btn small onClick={() => openDialog({ type: 'confirmer', c: revocationAgendas() })}>Révoquer tous les abonnements…</Btn></div>}
      <Fine>
        Adresse personnelle et secrète (jeton aléatoire, gardé seulement sous forme d’empreinte), révocable par le salarié ; elle cesse de fonctionner
        à sa sortie ou quand son compte est désactivé. Trois mois passés et un an à venir, actualisés par Outlook toutes les quelques heures. Les
        congés validés partent aussi en fichier d’agenda avec l’e-mail de décision, et leur annulation le retire.
      </Fine>
    </Panel>
  );
}
