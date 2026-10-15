// Nouveau déplacement : collaborateur, destination, dates et motif.
// Conflits de dates contrôlés en direct : un autre déplacement ou une absence en vigueur bloquent, le reste avertit.
import { useState } from 'react';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { actifs } from '../../../shared/rules/referentiels.ts';
import { CancelButton, Controles, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreursPeriode, erreurTexte } from '../components/controles.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function TripDialog() {
  const d = useDomain();
  const { run, closeDialog, go } = useStore();
  const employes = d.ds.employes;
  const dests = actifs(d.ds.referentiels.destinations);
  const empOptions = [...employes].sort((a, b) => a.nom.localeCompare(b.nom));
  const [empId, setEmpId] = useState((employes.find(e => e.passeport) ?? employes[0])?.id ?? 0);
  const [dest, setDest] = useState(dests[0]?.code ?? '');
  const [depart, setDepart] = useState('');
  const [retour, setRetour] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const destDef = d.destOf(dest);
  const dates = erreursPeriode(depart, retour, { du: 'Indiquez la date de départ.', au: 'Indiquez la date de retour.' });
  const motifErr = erreurTexte(motif, 'Indiquez le motif du déplacement.');
  const destErr = destDef ? null : dests.length ? 'Choisissez la destination.' : 'Aucune destination au référentiel : ajoutez-la dans l’écran Référentiels.';
  // Conflits d'une période valide, affichés en direct : un autre déplacement ou une absence en vigueur bloquent l'envoi.
  const conflits = !dates.du && !dates.au ? conflitsDates(d, empId, depart, retour, 'voyage') : [];

  const confirm = async () => {
    if (busy || !v.verifier(destErr, dates.du, dates.au, motifErr, blocage(conflits))) return;
    setBusy(true);
    const r = await run('voyage.creer', { empId, dest, depart, retour, motif });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    go('voyages', { tripSel: (r.result as { id: number } | undefined)?.id ?? null });
  };

  return (
    <Dialog title="Nouveau déplacement" width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Créer le déplacement</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur" htmlFor="tr-emp">
          <select className="input" id="tr-emp" value={empId} onChange={e => setEmpId(Number(e.target.value))}>
            {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
        <Field label="Destination" htmlFor="tr-dest" erreur={v.erreur(destErr)}>
          <select className="input" id="tr-dest" value={dest} onChange={e => setDest(e.target.value)}>
            {dests.map(o => <option key={o.code} value={o.code}>{o.pays}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Départ" htmlFor="tr-dep" requis erreur={v.erreur(dates.du)}><input className="input" id="tr-dep" type="date" value={depart} onChange={e => setDepart(e.target.value)} /></Field>
        <Field label="Retour" htmlFor="tr-ret" requis erreur={retour && dates.au && !dates.du ? dates.au : v.erreur(dates.au)}>
          <input className="input" id="tr-ret" type="date" min={depart || undefined} value={retour} onChange={e => setRetour(e.target.value)} />
        </Field>
      </div>
      <Controles msgs={conflits} />
      <Field label="Motif" htmlFor="tr-motif" requis erreur={v.erreur(motifErr)}><input className="input" id="tr-motif" type="text" placeholder="Visite client — Casablanca" value={motif} onChange={e => setMotif(e.target.value)} /></Field>
      <p className="text-muted fine">{destDef ? d.destSummary(destDef) : ''}</p>
    </Dialog>
  );
}
