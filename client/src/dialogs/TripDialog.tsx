// Nouveau déplacement : collaborateur, destination, dates et motif.
// Conflits de dates contrôlés en direct : un autre déplacement ou une absence en vigueur bloquent, le reste avertit.
import { useState } from 'react';
import { isValidDate } from '../../../shared/dates.ts';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { CancelButton, Controles, Dialog, Field } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function TripDialog() {
  const d = useDomain();
  const { run, closeDialog, go } = useStore();
  const employes = d.ds.employes;
  const dests = d.ds.referentiels.destinations;
  const empOptions = [...employes].sort((a, b) => a.nom.localeCompare(b.nom));
  const [empId, setEmpId] = useState((employes.find(e => e.passeport) ?? employes[0])?.id ?? 0);
  const [dest, setDest] = useState(dests[0]?.code ?? '');
  const [depart, setDepart] = useState('');
  const [retour, setRetour] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const destDef = d.destOf(dest);
  const dates = isValidDate(depart) && isValidDate(retour) && retour >= depart;
  const conflits = dates ? conflitsDates(d, empId, depart, retour, 'voyage') : [];
  const cant = !(dates && motif.trim()) || !!blocage(conflits);

  const confirm = async () => {
    setBusy(true);
    const r = await run('voyage.creer', { empId, dest, depart, retour, motif });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    go('voyages', { tripSel: (r.result as { id: number } | undefined)?.id ?? null });
  };

  return (
    <Dialog title="Nouveau déplacement" width={560} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>Créer le déplacement</button>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur" htmlFor="tr-emp">
          <select className="input" id="tr-emp" value={empId} onChange={e => setEmpId(Number(e.target.value))}>
            {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
        <Field label="Destination" htmlFor="tr-dest">
          <select className="input" id="tr-dest" value={dest} onChange={e => setDest(e.target.value)}>
            {dests.map(o => <option key={o.code} value={o.code}>{o.pays}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Départ" htmlFor="tr-dep"><input className="input" id="tr-dep" type="date" value={depart} onChange={e => setDepart(e.target.value)} /></Field>
        <Field label="Retour" htmlFor="tr-ret"><input className="input" id="tr-ret" type="date" value={retour} onChange={e => setRetour(e.target.value)} /></Field>
      </div>
      <Controles msgs={conflits} />
      <Field label="Motif" htmlFor="tr-motif"><input className="input" id="tr-motif" type="text" placeholder="Visite client — Casablanca" value={motif} onChange={e => setMotif(e.target.value)} /></Field>
      <p className="text-muted fine">{destDef ? d.destSummary(destDef) : ''}</p>
    </Dialog>
  );
}
