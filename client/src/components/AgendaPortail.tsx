// Agenda personnel (t036, server/src/agenda.ts) : panneau du portail. Le salarié crée une adresse d'abonnement (jeton long
// et aléatoire, montré une seule fois : le serveur n'en garde que l'empreinte), l'ajoute à Outlook (« Ajouter un
// calendrier » → « À partir d'Internet ») et la révoque quand il veut. Rien ne s'affiche tant que l'administrateur RH n'a
// pas activé le flux (Paramètres → Agenda), sauf un abonnement encore en vigueur, à révoquer.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { useAgir } from '../state/actions.ts';
import { useData, useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent, Panel, Tag } from './ui.tsx';
import { t } from '../i18n/langue.ts';

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
    try { await navigator.clipboard.writeText(adresse); notify(t('Address copied: paste it into Outlook')); } catch { notify(t('Copy impossible: select the address and copy it'), true); }
  };

  return (
    <Panel title={t('My calendar in Outlook')} aside={jeton ? <Tag cls="tag-neutral">{t('Subscription in force')}</Tag> : undefined}>
      {adresse ? (
        <>
          <label className="text-muted sub" htmlFor="agenda-adresse">{t('Subscription address (shown only once)')}</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <input className="input" id="agenda-adresse" readOnly value={adresse} onFocus={e => e.target.select()} style={{ flex: '1 1 260px', minWidth: 0 }} />
            <Btn small onClick={copier}>{t('Copy')}</Btn>
          </div>
          <NoteAccent>{t('Keep this address for yourself: whoever knows it sees your calendar. If in doubt, revoke it and create another.')}</NoteAccent>
        </>
      ) : (
        <div style={{ fontSize: 14 }}>
          {jeton ? `${t('Subscription created on ')}${fmtIso(jeton.creeLe.slice(0, 10))}${t('. The address is no longer shown: create a new one if you have lost it (the old one stops working).')}`
            : t('Your training courses, reviews, absences and trips in your Outlook calendar, updated automatically.')}
        </div>
      )}
      {data.settings.agendaFluxActif && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Btn small variant={jeton ? 'ghost' : 'primary'} disabled={occupe} onClick={creer}>{jeton ? t('New address') : t('Create my subscription address')}</Btn>
          {jeton && <Btn small disabled={occupe} onClick={revoquer}>{t('Revoke the subscription')}</Btn>}
        </div>
      )}
      {!data.settings.agendaFluxActif && jeton && (
        <>
          <Fine>{t('The calendar subscription is suspended by HR: your calendar no longer updates.')}</Fine>
          <div><Btn small disabled={occupe} onClick={revoquer}>{t('Revoke the subscription')}</Btn></div>
        </>
      )}
      <Fine>
        {t('In Outlook: “Add calendar”, then “From Internet”, and paste the address. The absences appear in it under “Absent”, without their nature. Approved leave also arrives with the decision e-mail (attached file).')}
      </Fine>
    </Panel>
  );
}
