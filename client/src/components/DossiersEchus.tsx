// Tableau de bord du service RH (t016) : dossiers de salariés sortis dont une durée de conservation est échue, signalés à
// l'administrateur RH (calculés par le serveur, server/src/conservation.ts). Rien n'est effacé sans sa confirmation, dans
// Paramètres → Conservation des dossiers.
import { useData, useStore } from '../state/store.tsx';
import { Fine, Panel } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function DossiersEchusPanel() {
  const data = useData();
  const { go } = useStore();
  const echus = data.conservation ?? [];
  if (!echus.length) return null;
  const anonymiser = echus.filter(x => x.dossier).length;
  return (
    <Panel highlight title={t('Files to erase')} aside={<a href="/parametres" className="link-more" onClick={e => { e.preventDefault(); go('parametres'); }}>{t('Settings →')}</a>}>
      <div style={{ fontSize: 14 }}>
        {tn(echus.length, 'file of an employee who left', 'files of employees who left')}{t(' with a retention period expired')}
        {anonymiser ? `${t(', of which #comma')}${tn(anonymiser, 'file', 'files')}${t(' to anonymise')}` : ''}.
      </div>
      <Fine>{t('Cursus erases nothing by itself: examine and confirm in Settings → Retention of files.')}</Fine>
    </Panel>
  );
}
