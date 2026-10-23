// Tableau de bord du service RH (t016) : dossiers de salariés sortis dont une durée de conservation est échue, signalés à
// l'administrateur RH (calculés par le serveur, server/src/conservation.ts). Rien n'est effacé sans sa confirmation, dans
// Paramètres → Conservation des dossiers.
import { plural } from '../../../shared/format.ts';
import { useData, useStore } from '../state/store.tsx';
import { Fine, Panel } from './ui.tsx';

export function DossiersEchusPanel() {
  const data = useData();
  const { go } = useStore();
  const echus = data.conservation ?? [];
  if (!echus.length) return null;
  const anonymiser = echus.filter(x => x.dossier).length;
  return (
    <Panel highlight title="Dossiers à effacer" aside={<a href="/parametres" className="link-more" onClick={e => { e.preventDefault(); go('parametres'); }}>Paramètres →</a>}>
      <div style={{ fontSize: 14 }}>
        {plural(echus.length, 'dossier de salarié sorti', 'dossiers de salariés sortis')} avec une durée de conservation échue
        {anonymiser ? `, dont ${plural(anonymiser, 'dossier', 'dossiers')} à anonymiser` : ''}.
      </div>
      <Fine>Cursus n’efface rien de lui-même : examinez et confirmez dans Paramètres → Conservation des dossiers.</Fine>
    </Panel>
  );
}
