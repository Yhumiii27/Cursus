// Saisies gardées sur l'appareil (lot 11, chantier C2, t196) : en attente d'envoi, ou « À reprendre » après un refus du
// serveur (conflit sur la cellule, feuille validée entre-temps, règle de congés), avec le motif. « Renvoyer » remet une
// saisie refusée dans la file ; « Abandonner » la retire, après une confirmation sur place (jamais window.confirm).
// Montrée par le bandeau hors ligne (components/BandeauHorsLigne.tsx) ; la page « Hors ligne » d'une ouverture sans réseau
// en montre la liste seule (pages/HorsLigne.tsx).
import { useState } from 'react';
import { fmt } from '../../../shared/format.ts';
import { libelleSaisie } from '../pwa/saisie-hors-ligne.ts';
import type { EntreeFile } from '../state/hors-ligne.ts';
import { Btn, Tag } from './ui.tsx';

/** Heure de la saisie sur l'appareil (indicative : celle qui fait foi est l'heure de réception par le serveur). */
const quand = (iso: string) => {
  const d = new Date(iso);
  return `${fmt(d)} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function FileEnAttente({ entrees, reprendre, abandonner, occupe }: {
  entrees: Pick<EntreeFile, 'id' | 'nom' | 'payload' | 'creeLe' | 'etat' | 'motif'>[];
  /** Absents : liste seule (page « Hors ligne »). */
  reprendre?: (id: string) => Promise<void>; abandonner?: (id: string) => Promise<void>; occupe?: boolean;
}) {
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);
  if (!entrees.length) return null;
  return (
    <ul className="file-attente" aria-label="Saisies gardées sur cet appareil">
      {entrees.map(e => (
        <li key={e.id}>
          <div className="grow">
            <div>{libelleSaisie(e.nom, e.payload)}</div>
            <div className="text-muted sub">Saisie le {quand(e.creeLe)}</div>
            {e.etat === 'a_reprendre' && e.motif && <div className="note-accent">{e.motif}</div>}
          </div>
          <Tag cls={e.etat === 'a_reprendre' ? 'tag-accent' : 'tag-outline'}>{e.etat === 'a_reprendre' ? 'À reprendre' : 'En attente d’envoi'}</Tag>
          {(reprendre || abandonner) && (
            <div className="file-boutons">
              {aConfirmer === e.id ? (
                <>
                  <span className="text-muted sub">Abandonner cette saisie ?</span>
                  <Btn small variant="primary" disabled={occupe} onClick={() => { setAConfirmer(null); void abandonner?.(e.id); }}>Abandonner</Btn>
                  <Btn small onClick={() => setAConfirmer(null)}>Garder</Btn>
                </>
              ) : (
                <>
                  {e.etat === 'a_reprendre' && reprendre && <Btn small disabled={occupe} onClick={() => void reprendre(e.id)}>Renvoyer</Btn>}
                  {abandonner && <Btn small disabled={occupe} onClick={() => setAConfirmer(e.id)}>Abandonner…</Btn>}
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
