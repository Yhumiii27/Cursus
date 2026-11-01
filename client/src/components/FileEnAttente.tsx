// Saisies gardées sur l'appareil (lot 11, chantier C2, t196) : en attente d'envoi, ou « À reprendre » après un refus du
// serveur (conflit sur la cellule, feuille validée entre-temps, règle de congés), avec le motif.
// - « Renvoyer » remet une saisie refusée dans la file : utile quand le refus peut disparaître (solde de congés,
//   feuille rouverte entre-temps). Jamais pour un conflit de cellule (`conflit`) : renvoyée avec la même valeur de base,
//   elle serait refusée de nouveau ; « Ouvrir la feuille » mène à la semaine pour y ressaisir, puis « Abandonner… ».
// - « Abandonner… » ouvre le dialogue « confirmer » (state/confirmations.ts, `abandonSaisie`), jamais window.confirm.
// Montrée par le bandeau hors ligne (components/BandeauHorsLigne.tsx) ; la page « Hors ligne » d'une ouverture sans réseau
// en montre la liste seule, sans boutons (pages/HorsLigne.tsx : pas de session).
import { fmt } from '../../../shared/format.ts';
import { boutonsSaisie, libelleSaisie } from '../pwa/saisie-hors-ligne.ts';
import type { EntreeFile } from '../state/hors-ligne.ts';
import { Btn, Tag } from './ui.tsx';

/** Heure de la saisie sur l'appareil (indicative : celle qui fait foi est l'heure de réception par le serveur). */
const quand = (iso: string) => {
  const d = new Date(iso);
  return `${fmt(d)} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

type Entree = Pick<EntreeFile, 'id' | 'nom' | 'payload' | 'creeLe' | 'etat' | 'motif'> & { conflit?: boolean };

export function FileEnAttente({ entrees, reprendre, abandonner, ouvrirFeuille, occupe }: {
  entrees: Entree[];
  /** Absents : liste seule (page « Hors ligne »). `abandonner` ouvre la confirmation. */
  reprendre?: (id: string) => Promise<void>; abandonner?: (e: Entree) => void; ouvrirFeuille?: (e: Entree) => void; occupe?: boolean;
}) {
  if (!entrees.length) return null;
  const actif = !!(reprendre || abandonner || ouvrirFeuille);
  return (
    <ul className="file-attente" aria-label="Saisies gardées sur cet appareil">
      {entrees.map(e => (
        <li key={e.id}>
          <div className="grow">
            <div>{libelleSaisie(e.nom, e.payload)}</div>
            <div className="text-muted sub">Saisie le {quand(e.creeLe)}</div>
            {e.etat === 'a_reprendre' && e.motif && <div className="note-accent">{e.motif}</div>}
            {e.etat === 'a_reprendre' && e.conflit && <div className="text-muted sub">Ressaisissez la valeur dans la feuille si elle doit remplacer celle du serveur, puis abandonnez cette saisie.</div>}
          </div>
          <Tag cls={e.etat === 'a_reprendre' ? 'tag-accent' : 'tag-outline'}>{e.etat === 'a_reprendre' ? 'À reprendre' : 'En attente d’envoi'}</Tag>
          {actif && (
            <div className="file-boutons">
              {boutonsSaisie(e).map(b => b === 'renvoyer' ? reprendre && <Btn key={b} small disabled={occupe} onClick={() => void reprendre(e.id)}>Renvoyer</Btn>
                : b === 'feuille' ? ouvrirFeuille && <Btn key={b} small disabled={occupe} onClick={() => ouvrirFeuille(e)}>Ouvrir la feuille</Btn>
                : abandonner && <Btn key={b} small disabled={occupe} onClick={() => abandonner(e)}>Abandonner…</Btn>)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
