// Création d'une équipe (nom, manager facultatif) ou modification (renommage, changement de manager).
import { useState } from 'react';
import { equipeLabel, key } from '../../../shared/format.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { managerCandidates } from '../pages/Equipes.tsx';

export function EquipeDialog({ nom: nom0 }: { nom?: string | null }) {
  const d = useDomain();
  const { run, closeDialog, notify } = useStore();
  // Équipe figée à l'ouverture : pendant l'enregistrement (renommage puis changement de manager),
  // elle ne se retrouve plus sous son nom initial, sans pour autant avoir disparu.
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
  const nomErr = !nouveau ? 'Indiquez le nom de l’équipe.' : doublon ? 'Une équipe porte déjà ce nom.' : null;

  const chosen = mgr ? d.emp(mgr) : undefined;
  const autres = mgr ? d.teamsOf(mgr).filter(n => !noms.has(n)) : [];
  const hint = !chosen ? 'Sans manager, les heures, absences et entretiens de l’équipe sont validés par le service RH.'
    : [
      `${chosen.nom} validera les heures, les absences et les entretiens de l’équipe.`,
      members.has(chosen.id) ? 'Membre de l’équipe : ses propres validations reviendront au service RH.' : `Rattachement actuel : ${equipeLabel(chosen)}.`,
      autres.length ? `Encadre déjà : ${autres.join(', ')}.` : '',
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
      // Renommage puis changement de manager : un seul message récapitulatif quand les deux changent.
      let cible = equipe!.nom, renameMsg = '';
      if (renamed) {
        const r = await run('equipe.renommer', { nom: equipe!.nom, nouveau }, { silent: mgrChanged });
        if (!r.ok) return;
        renameMsg = r.message ?? '';
        cible = nouveau;
      }
      if (mgrChanged) {
        const r = await run('equipe.manager', { nom: cible, managerId: mgr }, { silent: renamed });
        if (!r.ok && !renamed) return;
        if (renamed) notify([renameMsg, r.ok ? r.message : r.error].filter(Boolean).join(' — '), !r.ok);
      }
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={edit ? `Équipe ${nom0}` : 'Nouvelle équipe'} onSubmit={confirm} actions={disparue ? <CancelButton label="Fermer" /> : <>
      <CancelButton />
      <SubmitButton busy={busy}>{edit ? 'Enregistrer' : 'Créer l’équipe'}</SubmitButton>
    </>}>
      {disparue ? <Bloquant>Cette équipe n’existe plus.</Bloquant> : <>
        <Field label="Nom de l’équipe" htmlFor="equipe-nom" requis erreur={doublon ? nomErr : v.erreur(nomErr)}>
          <input className="input" id="equipe-nom" type="text" autoFocus value={nom} placeholder="Maintenance — site de Lyon" onChange={e => setNom(e.target.value)} />
        </Field>
        <Field label={<>Manager <span className="who">· facultatif</span></>} htmlFor="equipe-mgr">
          <select className="input" id="equipe-mgr" value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="">Aucun manager — validations par le RH</option>
            {mgrMissing && <option value={String(equipe!.managerId)}>{d.personName(equipe!.managerId!)}</option>}
            {inTeam.length > 0 && (
              <optgroup label="Membres de l’équipe">
                {inTeam.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={inTeam.length ? 'Autres collaborateurs' : 'Collaborateurs'}>
                {others.map(e => <option key={e.id} value={e.id}>{e.nom} — {equipeLabel(e)}</option>)}
              </optgroup>
            )}
          </select>
        </Field>
        <p className="text-muted fine">{hint}</p>
        {renamed && <p className="text-muted fine">Le nouveau nom s’applique aux fiches des membres, aux enveloppes budgétaires et au plan de formation.</p>}
        {!edit && <p className="text-muted fine">Les intérimaires ne peuvent pas être désignés manager. Les membres s’ajoutent ensuite depuis l’écran Équipes & managers.</p>}
      </>}
    </Dialog>
  );
}
