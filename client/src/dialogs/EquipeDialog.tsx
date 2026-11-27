// Création d'une équipe (nom, manager facultatif) ou modification (renommage, changement de manager).
import { useState } from 'react';
import { equipeLabel, key } from '../../../shared/format.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { managerCandidates } from '../pages/Equipes.tsx';
import { t } from '../i18n/langue.ts';

export function EquipeDialog({ nom: nom0 }: { nom?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  // Équipe figée à l'ouverture : pendant l'enregistrement d'un renommage, elle ne se retrouve plus sous son nom
  // initial, sans pour autant avoir disparu.
  const [equipe] = useState(() => nom0 ? d.ds.referentiels.equipes.find(q => q.nom === nom0) ?? null : null);
  const edit = !!nom0;
  const [nom, setNom] = useState(equipe?.nom ?? '');
  const [managerId, setManagerId] = useState(equipe?.managerId != null ? String(equipe.managerId) : '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  const nouveau = nom.trim();
  const renamed = edit && nouveau !== equipe?.nom;
  // Noms sous lesquels l'équipe peut figurer : l'initial et, pendant l'enregistrement, le nouveau.
  const noms = new Set([equipe?.nom, busy && renamed ? nouveau : null].filter((n): n is string => !!n));
  const disparue = edit && (!equipe || (!busy && !d.ds.referentiels.equipes.some(q => q.nom === equipe.nom)));

  const candidates = managerCandidates(d);
  const members = new Set(d.ds.employes.filter(e => e.equipe && noms.has(e.equipe)).map(e => e.id));
  const inTeam = candidates.filter(e => members.has(e.id));
  const others = candidates.filter(e => !members.has(e.id));
  const mgrMissing = !!equipe?.managerId && !candidates.some(e => e.id === equipe.managerId);

  const doublon = !busy && !!nouveau && d.ds.referentiels.equipes.some(q => !noms.has(q.nom) && key(q.nom) === key(nouveau));
  const mgr = managerId ? Number(managerId) : null;
  const mgrChanged = edit && mgr !== (equipe?.managerId ?? null);
  // Doublon signalé dès la saisie ; nom manquant, à l'envoi.
  const nomErr = !nouveau ? t('Enter the name of the team.') : doublon ? t('A team already has this name.') : null;

  const chosen = mgr ? d.emp(mgr) : undefined;
  const autres = mgr ? d.teamsOf(mgr).filter(n => !noms.has(n)) : [];
  const hint = !chosen ? t('Without a manager, the hours, absences and reviews of the team are approved by HR.')
    : [
      `${chosen.nom}${t(' will approve the hours, absences and reviews of the team.')}`,
      // Hiérarchie (t136) : manager membre de l'équipe validé par celui de l'équipe parente, à défaut par le RH.
      members.has(chosen.id) ? `${t('Member of the team: their own approvals will go ')}${equipe?.parente ? `${t('to the manager of the parent team (')}${equipe.parente})` : t('to HR#au')}.` : `${t('Current attachment: ')}${equipeLabel(chosen)}.`,
      autres.length ? `${t('Already manages: ')}${autres.join(', ')}.` : '',
    ].filter(Boolean).join(' ');

  const confirm = async () => {
    if (busy || !v.verifier(nomErr, disparue)) return;
    // Rien de changé : rien à envoyer.
    if (edit && !renamed && !mgrChanged) { closeDialog(); return; }
    setBusy(true);
    try {
      if (!edit) {
        const r = await run('equipe.creer', { nom: nouveau, managerId: mgr });
        if (r.ok) closeDialog();
        return;
      }
      // Renommage et changement de manager en une seule action, dans une seule transaction : un refus n'enregistre
      // rien, le dialogue reste ouvert avec la saisie (le message d'erreur s'affiche).
      const r = await run('equipe.modifier', { nom: equipe!.nom, ...(renamed ? { nouveau } : {}), ...(mgrChanged ? { managerId: mgr } : {}) });
      if (r.ok) closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={edit ? `${t('Team ')}${nom0}` : t('New team')} onSubmit={confirm} actions={disparue ? <CancelButton label={t('Close')} /> : <>
      <CancelButton />
      <SubmitButton busy={busy}>{t(edit ? 'Save' : 'Create the team')}</SubmitButton>
    </>}>
      {disparue ? <Bloquant>{t('This team no longer exists.')}</Bloquant> : <>
        <Field label={t('Name of the team')} htmlFor="equipe-nom" requis erreur={doublon ? nomErr : v.erreur(nomErr)}>
          <input className="input" id="equipe-nom" type="text" autoFocus value={nom} placeholder={t('Maintenance — Lyon site')} onChange={e => setNom(e.target.value)} />
        </Field>
        <Field label={<>{t('Manager')} <span className="who">{t('· optional')}</span></>} htmlFor="equipe-mgr">
          <select className="input" id="equipe-mgr" value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="">{t('No manager — approvals by HR')}</option>
            {mgrMissing && <option value={String(equipe!.managerId)}>{d.personName(equipe!.managerId!)}</option>}
            {inTeam.length > 0 && (
              <optgroup label={t('Members of the team')}>
                {inTeam.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={t(inTeam.length ? 'Other employees' : 'Employees')}>
                {others.map(e => <option key={e.id} value={e.id}>{e.nom} — {equipeLabel(e)}</option>)}
              </optgroup>
            )}
          </select>
        </Field>
        <p className="text-muted fine">{hint}</p>
        {renamed && <p className="text-muted fine">{t('The new name applies to the members’ sheets, to the budget envelopes and to the training plan.')}</p>}
        {!edit && <p className="text-muted fine">{t('Temporary workers cannot be appointed manager. The members are then added from the Teams & managers screen.')}</p>}
      </>}
    </Dialog>
  );
}
