// Page « Hors ligne » (lot 11, chantier C2, t196) : Cursus ouvert sans réseau (application installée lancée dans un
// tunnel, au fond d'un atelier). Réponse du propriétaire du 31 octobre 2026 : aucune donnée n'est gardée sur le
// téléphone, donc rien à afficher hors de la file d'attente : les saisies déjà gardées sur l'appareil, envoyées dès que
// Cursus s'ouvrira avec du réseau. Nouvel essai au retour du réseau, ou par « Réessayer ».
// lot 11 — notes de frais : dépense rapide (photo, montant, date, catégorie), gardée dans la file pour le dernier compte
// connecté avec les notes de frais activées (components/frais/DepenseHorsLigne.tsx).
import { useEffect, useState } from 'react';
import { CloudSlashIcon } from '@phosphor-icons/react';
import { FileEnAttente } from '../components/FileEnAttente.tsx';
import { Btn, Fine, Page, Panel } from '../components/ui.tsx';
import { fileAppareil } from '../pwa/useHorsLigne.ts';
import type { EntreeFile } from '../state/hors-ligne.ts';
import { DepenseHorsLigne } from '../components/frais/DepenseHorsLigne.tsx';
import { t, tn } from '../i18n/langue.ts';

export function HorsLigne({ erreur, recharger }: { erreur: string; recharger: () => void }) {
  const [entrees, setEntrees] = useState<EntreeFile[]>([]);
  const lister = () => { void fileAppareil()?.listerTout().then(setEntrees).catch(() => {}); };
  useEffect(() => {
    lister();
    addEventListener('online', recharger);
    return () => removeEventListener('online', recharger);
  }, [recharger]);
  return (
    <Page title={t('Offline')} note={<span role="alert">{erreur}</span>}>
      <Panel title={t('Cursus will open when the network is back')} aside={<CloudSlashIcon size={18} aria-hidden="true" />}>
        <div style={{ fontSize: 14 }}>
          {t('Check the network (Wi-Fi or mobile data). Nothing else is kept on this device: your hours, absences and training will show once you are connected.')}
        </div>
        <div><Btn small variant="primary" onClick={recharger}>{t('Retry')}</Btn></div>
      </Panel>
      <DepenseHorsLigne onGardee={lister} />
      <Panel title={t('Entries kept on this device')} aside={entrees.length ? <span className="text-muted sub">{tn(entrees.length, 'entry', 'entries')}</span> : undefined}>
        {entrees.length
          ? <FileEnAttente entrees={entrees} />
          : <Fine>{t('No entry waiting on this device.')}</Fine>}
        <Fine>{t('They are sent in order as soon as Cursus opens with a network, under your account; those refused by the server move to “To resume”.')}</Fine>
      </Panel>
    </Page>
  );
}
