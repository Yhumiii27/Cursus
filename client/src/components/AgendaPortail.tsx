// Agenda personnel (t036, server/src/agenda.ts) : panneau du portail. Le salarié crée une adresse d'abonnement (jeton long
// et aléatoire, montré une seule fois : le serveur n'en garde que l'empreinte), l'ajoute à Outlook (« Ajouter un
// calendrier » → « À partir d'Internet ») et la révoque quand il veut. Rien ne s'affiche tant que l'administrateur RH n'a
// pas activé le flux (Paramètres → Agenda), sauf un abonnement encore en vigueur, à révoquer.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { useAgir } from '../state/actions.ts';
import { useData, useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent, Panel, Tag } from './ui.tsx';

/** Adresse d'abonnement d'un jeton, sur le nom de la page (celui que voit le salarié, derrière le reverse proxy). */
export const adresseAgenda = (jeton: string, origine = window.location.origin) => `${origine}/api/agenda/${jeton}.ics`;

export function AgendaPortail() {
  const data = useData();
  const { run, notify } = useStore();
  const { occupe, agir } = useAgir();
  const [adresse, setAdresse] = useState<string | null>(null);
  const jeton = data.agendaJeton ?? null;
  if (!data.settings.agendaFluxActif && !jeton) return null;

  const creer = agir(async () => {
    const r = await run('agenda.creerJeton');
    const j = (r.result as { jeton?: string } | undefined)?.jeton;
    if (r.ok && j) setAdresse(adresseAgenda(j));
  });
  const revoquer = agir(async () => { const r = await run('agenda.revoquerJeton'); if (r.ok) setAdresse(null); });
  const copier = async () => {
    if (!adresse) return;
    try { await navigator.clipboard.writeText(adresse); notify('Adresse copiée : collez-la dans Outlook'); } catch { notify('Copie impossible : sélectionnez l’adresse et copiez-la', true); }
  };

  return (
    <Panel title="Mon agenda dans Outlook" aside={jeton ? <Tag cls="tag-neutral">Abonnement en vigueur</Tag> : undefined}>
      {adresse ? (
        <>
          <label className="text-muted sub" htmlFor="agenda-adresse">Adresse d’abonnement (affichée une seule fois)</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <input className="input" id="agenda-adresse" readOnly value={adresse} onFocus={e => e.target.select()} style={{ flex: '1 1 260px', minWidth: 0 }} />
            <Btn small onClick={copier}>Copier</Btn>
          </div>
          <NoteAccent>Gardez cette adresse pour vous : qui la connaît voit votre agenda. En cas de doute, révoquez-la et créez-en une autre.</NoteAccent>
        </>
      ) : (
        <div style={{ fontSize: 14 }}>
          {jeton ? `Abonnement créé le ${fmtIso(jeton.creeLe.slice(0, 10))}. L’adresse ne s’affiche plus : créez-en une nouvelle si vous l’avez perdue (l’ancienne cesse de fonctionner).`
            : 'Vos formations, entretiens, absences et déplacements dans votre agenda Outlook, mis à jour automatiquement.'}
        </div>
      )}
      {data.settings.agendaFluxActif && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Btn small variant={jeton ? 'ghost' : 'primary'} disabled={occupe} onClick={creer}>{jeton ? 'Nouvelle adresse' : 'Créer mon adresse d’abonnement'}</Btn>
          {jeton && <Btn small disabled={occupe} onClick={revoquer}>Révoquer l’abonnement</Btn>}
        </div>
      )}
      {!data.settings.agendaFluxActif && jeton && (
        <>
          <Fine>L’abonnement à l’agenda est suspendu par le service RH : votre agenda ne se met plus à jour.</Fine>
          <div><Btn small disabled={occupe} onClick={revoquer}>Révoquer l’abonnement</Btn></div>
        </>
      )}
      <Fine>
        Dans Outlook : « Ajouter un calendrier », puis « À partir d’Internet », et collez l’adresse. Les absences y figurent sous « Absent »,
        sans leur nature. Les congés validés arrivent aussi par l’e-mail de décision (fichier joint).
      </Fine>
    </Panel>
  );
}
