// Installation de Cursus sur le téléphone (lot 11, chantier C2, t196) : dans l'Accueil, l'Aide et le menu.
// - Android, Chrome et Edge : le navigateur propose l'installation (beforeinstallprompt, gardé par pwa/enregistrement.ts) ;
//   bouton « Installer l'application ».
// - iPhone et iPad : Safari n'a pas d'invitation ; encart d'explication (« Partager », puis « Sur l'écran d'accueil »),
//   masquable pour l'appareil (« Ne plus afficher »).
// Rien une fois l'application installée (mode standalone), ni hors contexte sécurisé (HTTP simple : ni installation ni
// service worker).
import { useState } from 'react';
import { DeviceMobileIcon } from '@phosphor-icons/react';
import { encartIosMasque, masquerEncartIos } from '../pwa/appareil.ts';
import { estIos, installer, useEtatPwa } from '../pwa/enregistrement.ts';
import { Btn, Fine, Panel } from './ui.tsx';

export function InstallerApplication({ menu, fermer }: {
  /** Entrée du menu (tiroir) : bouton seul, sans encart iOS. */
  menu?: boolean; fermer?: () => void;
}) {
  const { installable, standalone } = useEtatPwa();
  const [masque, setMasque] = useState(encartIosMasque);
  if (standalone || typeof window === 'undefined' || !window.isSecureContext) return null;
  if (installable) {
    const installerMaintenant = () => { fermer?.(); void installer(); };
    if (menu) {
      return (
        <button type="button" className="nav-item installer-menu" onClick={installerMaintenant}>
          <DeviceMobileIcon size={16} /><span>Installer l’application</span>
        </button>
      );
    }
    return (
      <Panel title="Cursus sur votre téléphone">
        <div style={{ fontSize: 14 }}>Ouvrez Cursus d’un geste depuis l’écran d’accueil, en plein écran ; vos heures restent saisissables si le réseau tombe.</div>
        <div><Btn small variant="primary" icon={<DeviceMobileIcon size={14} />} onClick={installerMaintenant}>Installer l’application</Btn></div>
      </Panel>
    );
  }
  if (menu || masque || !estIos()) return null;
  return (
    <Panel title="Cursus sur votre iPhone">
      <ol className="etapes-installation">
        <li>Dans Safari, touchez « Partager » (le carré avec une flèche vers le haut).</li>
        <li>Choisissez « Sur l’écran d’accueil », puis « Ajouter ».</li>
        <li>Ouvrez Cursus depuis l’icône et connectez-vous une fois : l’application installée a sa propre session.</li>
      </ol>
      <Fine>Les notifications sur l’iPhone ne fonctionnent que dans l’application installée (iOS 16.4 ou plus récent).</Fine>
      <div><Btn small onClick={() => { masquerEncartIos(); setMasque(true); }}>Ne plus afficher</Btn></div>
    </Panel>
  );
}
