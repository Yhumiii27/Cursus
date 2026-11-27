// Délégation des validations d'un manager absent (t135) : suppléant, période et périmètre. Ouvert par le manager pour
// lui-même (Mon espace) ou par le service RH (Équipes & managers). Suppléant proposé : le responsable du manager (N+1),
// sinon à choisir ; congés et feuilles de temps cochés par défaut, entretiens seulement si le réglage les ouvre.
// Suppléants et contrôles partagés avec le serveur : state/delegation-saisie.ts (shared/rules/delegations-manager.ts).
import { useState } from 'react';
import { addD } from '../../../shared/dates.ts';
import { DUREE_MAX_DELEGATION, PERIMETRES_DELEGATION } from '../../../shared/rules/delegations-manager.ts';
import { equipeLabel } from '../../../shared/format.ts';
import type { PerimetreDelegation } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { suppleantsCandidats, verifierDelegation } from '../state/delegation-saisie.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function DelegationDialog({ managerId }: { managerId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const mgr = d.emp(managerId);
  // Suppléants possibles : salariés présents, hors intérim et hors le manager ; le N+1 en tête.
  const { liste: candidats, n1 } = suppleantsCandidats(d, managerId);
  const [suppleant, setSuppleant] = useState(n1 ? String(n1) : '');
  const [du, setDu] = useState(d.ti);
  const [au, setAu] = useState(addD(d.ti, 13));
  const entretiens = d.ds.settings.delegationEntretiens;
  // lot 11 — notes de frais : périmètre proposé seulement le module activé.
  const frais = !!d.ds.settings.notesFraisActives;
  // lot 12 — C5 (planning d'équipe)
  const planning = !!d.ds.settings.planningActif;
  const [perimetre, setPerimetre] = useState<PerimetreDelegation[]>(['absences', 'feuilles']);
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  const erreurs = verifierDelegation(d, managerId, { suppleant, du, au, perimetre }, candidats);
  const erreurSuppleant = erreurs.suppleant, erreurPerimetre = erreurs.perimetre, erreurPeriode = erreurs.periode;

  const basculer = (p: PerimetreDelegation, oui: boolean) => setPerimetre(x => (oui ? [...x, p] : x.filter(y => y !== p)));
  const envoyer = async () => {
    if (busy || !v.verifier(erreurSuppleant, erreurPerimetre, erreurPeriode, !mgr)) return;
    setBusy(true);
    const r = await run('equipe.delegation', { managerId, suppleantId: Number(suppleant), du, au, perimetre });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`${t('Delegate the approvals')}${mgr ? `${t(' of #de-name')}${mgr.nom}` : ''}`} width={540} onSubmit={envoyer}
      actions={!mgr ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{t('Delegate')}</SubmitButton></>}>
      {!mgr ? <Bloquant>{t('This manager no longer exists.')}</Bloquant> : <>
        <Field label={t('Deputy')} htmlFor="delegation-suppleant" requis erreur={v.erreur(erreurSuppleant)}>
          <select className="input" id="delegation-suppleant" value={suppleant} onChange={ev => setSuppleant(ev.target.value)}>
            <option value="">{t('Choose the deputy…')}</option>
            {candidats.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.id === n1 ? t('superior (N+1)') : equipeLabel(e)}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label={t('From#label')} htmlFor="delegation-du" requis erreur={null}>
            <input className="input" id="delegation-du" type="date" value={du} onChange={ev => setDu(ev.target.value)} />
          </Field>
          <Field label={t('To (included)')} htmlFor="delegation-au" requis erreur={erreurPeriode && (du && au ? erreurPeriode : v.erreur(erreurPeriode))}>
            <input className="input" id="delegation-au" type="date" value={au} onChange={ev => setAu(ev.target.value)} />
          </Field>
        </div>
        <Field label={t('The deputy approves')} erreur={v.erreur(erreurPerimetre)}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
            {(Object.keys(PERIMETRES_DELEGATION) as PerimetreDelegation[]).filter(p => (p !== 'entretiens' || entretiens) && (p !== 'frais' || frais) && /* lot 12 — C5 (planning d'équipe) : module activé */ (p !== 'planning' || planning)).map(p => (
              <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={perimetre.includes(p)} onChange={ev => basculer(p, ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                {PERIMETRES_DELEGATION[p].label}
              </label>
            ))}
          </div>
        </Field>
        <Fine>
          {t('During the period, the deputy receives the team’s requests and decides on them; the Manager space of Cursus is open to them and their decisions are signed “by delegation of ')}{mgr.nom}{t('”. ')}{mgr.nom}{t(' takes over again on their return. The deputy never decides on their own requests: they go to the superior of ')}{mgr.nom}{t(', or to HR. ')}{DUREE_MAX_DELEGATION}{t(' days at most; a delegation can be revoked at any time.')}
          {!entretiens && t(' The reviews stay with the manager (setting of Settings → Managers’ hierarchy).')}
        </Fine>
      </>}
    </Dialog>
  );
}
