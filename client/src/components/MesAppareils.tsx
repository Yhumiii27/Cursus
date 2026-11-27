// Mes appareils (lot 11, chantier C2, t196 ; Accueil du collaborateur) : notifications sur le téléphone et appareil
// partagé. Les abonnements se lisent par une route du compte (GET /api/push/appareils), jamais par l'instantané ; le
// serveur ne renvoie ni l'adresse du service de push ni les clés.
// - « Recevoir les notifications sur cet appareil » : permission demandée sur ce geste seulement (pwa/push.ts) ;
// - « activées sur cet appareil » seulement si l'abonnement du navigateur figure parmi les appareils du compte (empreinte
//   de son adresse, `abonnementDuCompte`) : un abonnement retiré côté serveur, ou resté au compte précédent, propose de
//   nouveau « Recevoir… », que push.abonner rattache à ce compte ;
// - préférences par type, toutes coupées par défaut, valables pour tous les appareils du compte (push.preferences) ;
//   notifications génériques, sans nom ni date, jamais de 20 h à 7 h ni le week-end (shared/notifications-push.ts) ;
// - notification d'essai, appareil retiré à distance (téléphone perdu ou changé) ;
// - « Appareil partagé » : ni saisie gardée hors ligne ni notifications sur cet appareil (tablette d'atelier).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { NOTIFICATIONS_PUSH, SILENCE_PUSH, TYPES_PUSH } from '../../../shared/notifications-push.ts';
import { api, type AppareilPush } from '../api.ts';
import { abonnementActuel, abonnementDuCompte, activerNotifications, desactiverNotifications, pushPossible } from '../pwa/push.ts';
import { useAgir } from '../state/actions.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent, Panel, Tag } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function MesAppareils() {
  const { run, notify, horsLigne: hl } = useStore();
  const { occupe, agir } = useAgir();
  const [etat, setEtat] = useState<{ active: boolean; appareils: AppareilPush[] } | null>(null);
  const [ici, setIci] = useState(false);
  const [types, setTypes] = useState<string[] | null>(null);
  const possible = typeof window !== 'undefined' && pushPossible();

  const charger = useCallback(async () => {
    try {
      const r = await api.pushAppareils();
      setEtat(r);
      setTypes(r.appareils[0]?.types ?? []);
      const sub = await abonnementActuel().catch(() => null);
      setIci(!!sub && await abonnementDuCompte(sub.endpoint, r.appareils).catch(() => false));
    } catch {
      // Hors ligne ou session expirée : le panneau reste tel quel (la reconnexion s'affiche par-dessus).
    }
  }, []);
  useEffect(() => { void charger(); }, [charger]);
  if (!etat) return null;

  const activer = agir(async () => {
    try { await activerNotifications(run); } catch (err) { notify((err as Error).message, true); }
    await charger();
  });
  const desactiver = agir(async () => { await desactiverNotifications(run, 'utilisateur'); await charger(); });
  const retirer = (id: number) => agir(async () => { await run('push.desabonnerAppareil', { id }); await charger(); });
  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    agir(async () => { await run('push.preferences', { types: types ?? [] }); await charger(); })();
  };
  const basculer = (ty: string, oui: boolean) => setTypes(l => oui ? [...new Set([...(l ?? []), ty])] : (l ?? []).filter(x => x !== ty));
  const partage = agir(async () => { await hl.definirPartage(!hl.partage); await charger(); });

  return (
    <Panel title={t('My devices')} aside={etat.appareils.length ? <Tag cls="tag-neutral">{tn(etat.appareils.length, 'subscribed#device', 'subscribed#devices')}</Tag> : undefined}>
      {!etat.active ? (
        <Fine>{t('Phone notifications are not activated on this server.')}</Fine>
      ) : hl.partage ? (
        <div style={{ fontSize: 14 }}>{t('Shared device: no notification nor entry kept offline on this device.')}</div>
      ) : !possible ? (
        <Fine>{t('This browser does not receive notifications here. On iPhone or iPad, first install Cursus on the Home Screen (iOS 16.4 or later), then open it from the icon.')}</Fine>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {ici
            ? <><Tag cls="tag-neutral">{t('Notifications activated on this device')}</Tag><Btn small disabled={occupe} onClick={desactiver}>{t('Deactivate on this device')}</Btn></>
            : <Btn small variant="primary" disabled={occupe} onClick={activer}>{t('Receive the notifications on this device')}</Btn>}
          {etat.appareils.length > 0 && <Btn small disabled={occupe} onClick={agir(async () => { await run('push.tester'); })}>{t('Send a test notification')}</Btn>}
        </div>
      )}
      {etat.active && etat.appareils.length > 0 && types && (
        <form onSubmit={enregistrer} className="choix-notifications" aria-label={t('Notifications received')}>
          <span className="text-muted sub">{t('Notifications received on all your devices (none as long as nothing is ticked):')}</span>
          {TYPES_PUSH.map(ty => (
            <label key={ty} className="check-row">
              <input type="checkbox" checked={types.includes(ty)} onChange={e => basculer(ty, e.target.checked)} />
              <span>{NOTIFICATIONS_PUSH[ty].titre}</span>
            </label>
          ))}
          <div><Btn small type="submit" disabled={occupe}>{t('Save my choices')}</Btn></div>
        </form>
      )}
      {etat.appareils.length > 0 && (
        <ul className="liste-appareils">
          {etat.appareils.map(a => (
            <li key={a.id}>
              <div className="grow">
                <div>{a.appareil ?? t('Device')}</div>
                <div className="text-muted sub">{t('Added on #masc')}{fmtIso(a.creation.slice(0, 10))}{a.dernierSucces ? `${t(' · last notification on ')}${fmtIso(a.dernierSucces.slice(0, 10))}` : ''}</div>
              </div>
              <Btn small disabled={occupe} onClick={retirer(a.id)}>{t('Remove')}</Btn>
            </li>
          ))}
        </ul>
      )}
      {etat.active && <NoteAccent>{t('Notifications without name nor date (they are shown on the lock screen); none from ')}{SILENCE_PUSH.debut}{t(' h to ')}{SILENCE_PUSH.fin}{t(' h nor at the weekend: they go on the next working day.')}</NoteAccent>}
      <label className="check-row">
        <input type="checkbox" checked={hl.partage} disabled={occupe} onChange={partage} />
        <span>{t('Shared device (workshop or worksite tablet): keep nothing on this device')}</span>
      </label>
    </Panel>
  );
}
