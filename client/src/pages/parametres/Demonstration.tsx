// Paramètres → Données de démonstration : réinitialisation (administrateur RH, mode démonstration seulement).
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Btn, Panel } from '../../components/ui.tsx';
import { reinitialisationDemo } from '../../state/confirmations.ts';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';

export function Demonstration(_: SectionProps) {
  const { session, openDialog } = useStore();
  const { admin } = useRole();
  if (!session?.demo || !admin) return null;
  const reset = () => openDialog({ type: 'confirmer', c: reinitialisationDemo() });
  return (
    <Panel title="Données de démonstration">
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Remet les collaborateurs, formations, feuilles de temps, absences, entretiens et paramètres dans leur état initial de démonstration. Le journal des actions est conservé (la réinitialisation y est tracée). Une sauvegarde de la base actuelle est faite au préalable sur le serveur.
      </p>
      <div>
        <Btn variant="secondary" icon={<ArrowCounterClockwiseIcon size={14} />} onClick={reset}>Réinitialiser les données</Btn>
      </div>
    </Panel>
  );
}
