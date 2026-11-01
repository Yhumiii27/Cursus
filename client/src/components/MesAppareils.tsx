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
  const basculer = (t: string, oui: boolean) => setTypes(l => oui ? [...new Set([...(l ?? []), t])] : (l ?? []).filter(x => x !== t));
  const partage = agir(async () => { await hl.definirPartage(!hl.partage); await charger(); });

  return (
    <Panel title="Mes appareils" aside={etat.appareils.length ? <Tag cls="tag-neutral">{etat.appareils.length} abonné{etat.appareils.length > 1 ? 's' : ''}</Tag> : undefined}>
      {!etat.active ? (
        <Fine>Les notifications sur le téléphone ne sont pas activées sur ce serveur.</Fine>
      ) : hl.partage ? (
        <div style={{ fontSize: 14 }}>Appareil partagé : aucune notification ni saisie gardée hors ligne sur cet appareil.</div>
      ) : !possible ? (
        <Fine>Ce navigateur ne reçoit pas de notifications ici. Sur iPhone ou iPad, installez d’abord Cursus sur l’écran d’accueil (iOS 16.4 ou plus récent), puis ouvrez-le depuis l’icône.</Fine>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {ici
            ? <><Tag cls="tag-neutral">Notifications activées sur cet appareil</Tag><Btn small disabled={occupe} onClick={desactiver}>Désactiver sur cet appareil</Btn></>
            : <Btn small variant="primary" disabled={occupe} onClick={activer}>Recevoir les notifications sur cet appareil</Btn>}
          {etat.appareils.length > 0 && <Btn small disabled={occupe} onClick={agir(async () => { await run('push.tester'); })}>Envoyer une notification d’essai</Btn>}
        </div>
      )}
      {etat.active && etat.appareils.length > 0 && types && (
        <form onSubmit={enregistrer} className="choix-notifications" aria-label="Notifications reçues">
          <span className="text-muted sub">Notifications reçues sur tous vos appareils (aucune tant que rien n’est coché) :</span>
          {TYPES_PUSH.map(t => (
            <label key={t} className="check-row">
              <input type="checkbox" checked={types.includes(t)} onChange={e => basculer(t, e.target.checked)} />
              <span>{NOTIFICATIONS_PUSH[t].titre}</span>
            </label>
          ))}
          <div><Btn small type="submit" disabled={occupe}>Enregistrer mes choix</Btn></div>
        </form>
      )}
      {etat.appareils.length > 0 && (
        <ul className="liste-appareils">
          {etat.appareils.map(a => (
            <li key={a.id}>
              <div className="grow">
                <div>{a.appareil ?? 'Appareil'}</div>
                <div className="text-muted sub">Ajouté le {fmtIso(a.creation.slice(0, 10))}{a.dernierSucces ? ` · dernière notification le ${fmtIso(a.dernierSucces.slice(0, 10))}` : ''}</div>
              </div>
              <Btn small disabled={occupe} onClick={retirer(a.id)}>Retirer</Btn>
            </li>
          ))}
        </ul>
      )}
      {etat.active && <NoteAccent>Notifications sans nom ni date (elles s’affichent sur l’écran verrouillé) ; aucune de {SILENCE_PUSH.debut} h à {SILENCE_PUSH.fin} h ni le week-end : elles partent le jour ouvré suivant.</NoteAccent>}
      <label className="check-row">
        <input type="checkbox" checked={hl.partage} disabled={occupe} onChange={partage} />
        <span>Appareil partagé (tablette d’atelier ou de chantier) : ne rien garder sur cet appareil</span>
      </label>
    </Panel>
  );
}
