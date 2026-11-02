// Bouton « Pointer » du badgeage virtuel (lot 12, chantier C6, étape 2) : sur l'Accueil du collaborateur
// (pages/Portail.tsx), la saisie du jour au téléphone (pages/SaisieJour.tsx) et l'écran Pointages (raccourci de
// l'application installée, /pointages). Montré seulement le module activé et pour un salarié d'une population badgée
// (components/temps/pointage-etat.ts) ; le serveur le contrôle de nouveau (server/src/actions/pointage.ts).
// - L'heure est celle du serveur ; hors ligne, la file de l'appareil garde le pointage avec l'heure de l'appareil, marqué
//   « différé » (pwa/saisie-hors-ligne.ts), jamais avec une position.
// - État du jour et débit-crédit : lus à la demande (GET /api/pointages/etat), jamais dans l'instantané, relus toutes les
//   minutes tant que l'écran est ouvert (sans websocket) et après chaque pointage.
import { useCallback, useEffect, useState } from 'react';
import { SignInIcon, SignOutIcon } from '@phosphor-icons/react';
import { plural } from '../../../shared/format.ts';
import { api, type EtatPointages } from '../api.ts';
import { useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';
import { Fine, Panel, Tag } from './ui.tsx';
import { fMinutes, fSolde, pointe } from './temps/pointage-etat.ts';

/** Relecture de l'état du jour : toutes les minutes. */
const RELECTURE_MS = 60_000;

/** État du jour de la personne connectée, relu toutes les minutes ; `recharger` après un pointage. */
export function useEtatPointage(actif: boolean) {
  const [etat, setEtat] = useState<EtatPointages | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const recharger = useCallback(async () => {
    try {
      setEtat(await api.etatPointages());
      setErreur(null);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!actif) return;
    void recharger();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void recharger(); }, RELECTURE_MS);
    return () => clearInterval(t);
  }, [actif, recharger]);
  return { etat, erreur, recharger };
}

export function BoutonPointer({ titre = 'Pointage du jour' }: { titre?: string }) {
  const data = useData();
  const { me } = useRole();
  const { run, go } = useStore();
  const actif = pointe(data, me);
  const { etat, erreur, recharger } = useEtatPointage(actif);
  const [busy, setBusy] = useState(false);
  if (!actif || me == null) return null;

  const present = !!etat?.present;
  const pointer = async () => {
    if (busy) return;
    setBusy(true);
    const r = await run('pointage.pointer', { empId: me });
    setBusy(false);
    if (r.ok) void recharger();
  };
  const dc = etat?.debitCredit;
  const nAnomalies = etat?.anomalies.length ?? 0;

  return (
    <Panel title={titre} aside={etat ? <Tag cls={present ? 'tag-accent' : 'tag-outline'}>{present ? `Présent depuis ${etat.depuis}` : etat.postes.length ? 'Parti' : 'Non pointé'}</Tag> : undefined}>
      <div className="row-wrap" style={{ alignItems: 'center', gap: 'var(--space-3)' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={pointer} style={{ minHeight: 44 }}>
          {present ? <SignOutIcon size={16} /> : <SignInIcon size={16} />} {present ? 'Pointer le départ' : 'Pointer l’arrivée'}
        </button>
        {etat && etat.pointages.length > 0 && (
          <span className="text-muted sub">
            {etat.pointages.map(p => `${p.heure} ${p.sens === 'S' ? 'départ' : 'arrivée'}${p.differe ? ' (différé)' : ''}`).join(' · ')}
          </span>
        )}
      </div>
      {dc && (
        <div className="row-wrap" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
          <span className="sub"><span className="text-muted">Aujourd’hui </span><span className="tnum">{fMinutes(dc.jour.realise)} / {fMinutes(dc.jour.theorique)}</span></span>
          <span className="sub"><span className="text-muted">Semaine </span><span className="tnum">{fMinutes(dc.semaine.realise)} · solde {fSolde(dc.semaine.solde)}</span></span>
        </div>
      )}
      {nAnomalies > 0 && (
        <Fine muted={false}>
          {plural(nAnomalies, 'point à justifier', 'points à justifier')} cette semaine :{' '}
          <a href="/pointages" onClick={e => { e.preventDefault(); go('pointages'); }}>voir mes pointages</a>.
        </Fine>
      )}
      {erreur && <Fine>État du jour indisponible : {erreur}</Fine>}
      <Fine>
        Heure du serveur.{' '}
        {data.settings.pointageHorsLigne
          ? 'Sans réseau, le pointage est gardé sur l’appareil avec son heure et part « différé » au retour du réseau.'
          : 'Sans réseau, le pointage n’est pas possible : pointez une fois connecté.'}{' '}
        Aucune position n’est enregistrée.
      </Fine>
    </Panel>
  );
}
