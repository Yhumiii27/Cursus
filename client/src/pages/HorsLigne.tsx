// Page « Hors ligne » (lot 11, chantier C2, t196) : Cursus ouvert sans réseau (application installée lancée dans un
// tunnel, au fond d'un atelier). Réponse du propriétaire du 31 octobre 2026 : aucune donnée n'est gardée sur le
// téléphone, donc rien à afficher hors de la file d'attente : les saisies déjà gardées sur l'appareil, envoyées dès que
// Cursus s'ouvrira avec du réseau. Nouvel essai au retour du réseau, ou par « Réessayer ».
// lot 11 — notes de frais : dépense rapide (photo, montant, date, catégorie), gardée dans la file pour le dernier compte
// connecté avec les notes de frais activées (components/frais/DepenseHorsLigne.tsx).
import { useEffect, useState } from 'react';
import { CloudSlashIcon } from '@phosphor-icons/react';
import { plural } from '../../../shared/format.ts';
import { FileEnAttente } from '../components/FileEnAttente.tsx';
import { Btn, Fine, Page, Panel } from '../components/ui.tsx';
import { fileAppareil } from '../pwa/useHorsLigne.ts';
import type { EntreeFile } from '../state/hors-ligne.ts';
import { DepenseHorsLigne } from '../components/frais/DepenseHorsLigne.tsx';

export function HorsLigne({ erreur, recharger }: { erreur: string; recharger: () => void }) {
  const [entrees, setEntrees] = useState<EntreeFile[]>([]);
  const lister = () => { void fileAppareil()?.listerTout().then(setEntrees).catch(() => {}); };
  useEffect(() => {
    lister();
    addEventListener('online', recharger);
    return () => removeEventListener('online', recharger);
  }, [recharger]);
  return (
    <Page title="Hors ligne" note={<span role="alert">{erreur}</span>}>
      <Panel title="Cursus s’ouvrira au retour du réseau" aside={<CloudSlashIcon size={18} aria-hidden="true" />}>
        <div style={{ fontSize: 14 }}>
          Vérifiez le réseau (Wi-Fi ou données mobiles). Rien d’autre n’est gardé sur cet appareil : vos heures, absences et
          formations s’afficheront une fois connecté.
        </div>
        <div><Btn small variant="primary" onClick={recharger}>Réessayer</Btn></div>
      </Panel>
      <DepenseHorsLigne onGardee={lister} />
      <Panel title="Saisies gardées sur cet appareil" aside={entrees.length ? <span className="text-muted sub">{plural(entrees.length, 'saisie', 'saisies')}</span> : undefined}>
        {entrees.length
          ? <FileEnAttente entrees={entrees} />
          : <Fine>Aucune saisie en attente sur cet appareil.</Fine>}
        <Fine>Elles partent dans l’ordre dès que Cursus s’ouvre avec du réseau, sous votre compte ; celles refusées par le serveur passent dans « À reprendre ».</Fine>
      </Panel>
    </Page>
  );
}
