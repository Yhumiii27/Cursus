// Paramètres → Données de démonstration : réinitialisation (administrateur RH, mode démonstration seulement).
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Btn, Panel } from '../../components/ui.tsx';
import { reinitialisationDemo } from '../../state/confirmations.ts';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import type { SectionProps } from './commun.ts';
import { t } from '../../i18n/langue.ts';

export function Demonstration(_: SectionProps) {
  const { session, openDialog } = useStore();
  const { admin } = useRole();
  if (!session?.demo || !admin) return null;
  const reset = () => openDialog({ type: 'confirmer', c: reinitialisationDemo() });
  return (
    <Panel title={t('Demonstration data')}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {t('Resets the employees, training courses, timesheets, absences, reviews and settings to their initial demonstration state. The log of actions is kept (the reset is traced in it). A backup of the current database is made beforehand on the server.')}
      </p>
      <div>
        <Btn variant="secondary" icon={<ArrowCounterClockwiseIcon size={14} />} onClick={reset}>{t('Reset the data')}</Btn>
      </div>
    </Panel>
  );
}
