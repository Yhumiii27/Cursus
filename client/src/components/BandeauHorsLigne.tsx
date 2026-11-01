// Bandeaux de l'application mobile (lot 11, chantier C2, t196), sous l'en-tête de chaque page :
// - « Hors ligne » : le réseau manque ; les heures, une ligne de projet et une demande de congé restent saisissables et
//   partent au retour du réseau ; tout le reste attend le réseau (message de l'action) ;
// - saisies gardées sur l'appareil : « N saisies en attente d'envoi », « À reprendre » après un refus, liste dépliable
//   (components/FileEnAttente.tsx ; « Abandonner… » par le dialogue « confirmer ») ; celles d'un autre espace du compte
//   sont comptées à part (elles partent depuis cet espace, et la déconnexion les efface aussi) ;
// - « Nouvelle version » : la version suivante de Cursus est prête ; « Recharger » la met en place (jamais d'office, pour
//   ne pas perdre une saisie en cours : pwa/enregistrement.ts).
import { useState } from 'react';
import { ArrowClockwiseIcon, CloudSlashIcon, CloudArrowUpIcon } from '@phosphor-icons/react';
import { plural } from '../../../shared/format.ts';
import type { ISODate } from '../../../shared/types.ts';
import { appliquerMiseAJour, useEtatPwa } from '../pwa/enregistrement.ts';
import { abandonSaisie } from '../state/confirmations.ts';
import { libelleSaisie } from '../pwa/saisie-hors-ligne.ts';
import { useStore } from '../state/store.tsx';
import { FileEnAttente } from './FileEnAttente.tsx';
import { Btn } from './ui.tsx';

export function BandeauHorsLigne() {
  const { horsLigne: hl, session, openDialog, go } = useStore();
  const { miseAJour } = useEtatPwa();
  const [ouvert, setOuvert] = useState(false);
  const attente = hl.entrees.filter(e => e.etat === 'attente').length;
  const aReprendre = hl.entrees.length - attente;
  const connecte = !!session?.user;
  // Rien à signaler : aucun bandeau (l'espace de la page reste entier).
  if ((hl.enLigne || !connecte) && !hl.entrees.length && !hl.autres && !miseAJour) return null;
  return (
    <div className="bandeaux-pwa">
      {miseAJour && (
        <div className="bandeau-pwa" role="status">
          <ArrowClockwiseIcon size={16} aria-hidden="true" />
          <span className="grow">Nouvelle version de Cursus prête : rechargez quand votre saisie est terminée.</span>
          <Btn small variant="primary" onClick={appliquerMiseAJour}>Recharger</Btn>
        </div>
      )}
      {/* Sans session (page « Hors ligne » d'une ouverture sans réseau) : la page dit déjà tout. */}
      {!hl.enLigne && connecte && (
        <div className="bandeau-pwa hors-ligne" role="status">
          <CloudSlashIcon size={16} aria-hidden="true" />
          <span className="grow">
            {hl.disponible
              ? 'Hors ligne : vos heures et vos demandes de congé sont gardées sur cet appareil et envoyées au retour du réseau. Le reste attend le réseau.'
              : 'Hors ligne : les données affichées ne se mettent plus à jour, et rien ne peut être enregistré avant le retour du réseau.'}
          </span>
        </div>
      )}
      {connecte && (hl.entrees.length > 0 || hl.autres > 0) && (
        <div className="bandeau-pwa" role="status">
          <CloudArrowUpIcon size={16} aria-hidden="true" />
          <span className="grow">
            {[attente ? `${plural(attente, 'saisie en attente d’envoi', 'saisies en attente d’envoi')}${hl.rejeu ? ' (envoi en cours)' : ''}` : '',
              aReprendre ? `${plural(aReprendre, 'saisie', 'saisies')} à reprendre` : '',
              hl.autres ? `${plural(hl.autres, 'saisie gardée', 'saisies gardées')} dans un autre espace` : ''].filter(Boolean).join(' · ')}
          </span>
          {attente > 0 && hl.enLigne && <Btn small disabled={hl.rejeu} onClick={() => void hl.rejouer()}>Envoyer maintenant</Btn>}
          {hl.entrees.length > 0 && <Btn small onClick={() => setOuvert(o => !o)}>{ouvert ? 'Masquer' : 'Voir'}</Btn>}
        </div>
      )}
      {ouvert && <FileEnAttente entrees={hl.entrees} reprendre={hl.reprendre} occupe={hl.rejeu}
        abandonner={e => openDialog({ type: 'confirmer', c: abandonSaisie(e.id, libelleSaisie(e.nom, e.payload), !!e.conflit) })}
        ouvrirFeuille={e => go('temps', { weekStart: typeof e.payload.week === 'string' ? e.payload.week as ISODate : null })} />}
    </div>
  );
}
