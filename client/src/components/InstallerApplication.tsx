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
import { t } from '../i18n/langue.ts';

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
        <button type="button" className="coque-entry installer-menu" onClick={installerMaintenant}>
          <DeviceMobileIcon size={16} className="coque-entry-icon" aria-hidden="true" /><span className="coque-entry-label">{t('Install the application')}</span>
        </button>
      );
    }
    return (
      <Panel title={t('Cursus on your phone')}>
        <div style={{ fontSize: 14 }}>{t('Open Cursus in one gesture from the home screen, full screen; your hours can still be entered if the network goes down.')}</div>
        <div><Btn small variant="primary" icon={<DeviceMobileIcon size={14} />} onClick={installerMaintenant}>{t('Install the application')}</Btn></div>
      </Panel>
    );
  }
  if (menu || masque || !estIos()) return null;
  return (
    <Panel title={t('Cursus on your iPhone')}>
      <ol className="etapes-installation">
        <li>{t('In Safari, tap “Share” (the square with an arrow pointing up).')}</li>
        <li>{t('Choose “Add to Home Screen”, then “Add”.')}</li>
        <li>{t('Open Cursus from the icon and sign in once: the installed application has its own session.')}</li>
      </ol>
      <Fine>{t('Notifications on the iPhone only work in the installed application (iOS 16.4 or later).')}</Fine>
      <div><Btn small onClick={() => { masquerEncartIos(); setMasque(true); }}>{t('Do not show again')}</Btn></div>
    </Panel>
  );
}
