// Nouvelle session de formation (éventuellement depuis une action du plan).
import { useState } from 'react';
import { isValidDate } from '../../../shared/dates.ts';
import { plural } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function SessionDialog({ f: f0, planId, places: places0 }: { f?: string; planId?: number; places?: number }) {
  const { d, emps, forms } = useEnriched();
  const { run, closeDialog, go } = useStore();
  const [f, setF] = useState(f0 && forms.some(x => x.id === f0) ? f0 : forms[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [places, setPlaces] = useState(String(places0 ?? 8));
  const [lieu, setLieu] = useState('');
  const [busy, setBusy] = useState(false);
  const fm = d.fm(f);
  const waiting = emps.flatMap(e => e.certs).filter(c => c.f === f && c.key !== 'ok' && !c.session).length;
  const cant = !isValidDate(date) || !lieu.trim() || !(Number(places) > 0);

  const confirm = async () => {
    setBusy(true);
    const r = await run('session.creer', { f, date, lieu, places: Number(places), planId });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    if (planId) go('budget');
    else go('formations', { formationFilter: f });
  };

  return (
    <Dialog title="Nouvelle session" actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>Créer la session</button>
    </>}>
      <Field label="Formation" htmlFor="sess-f">
        <select className="input" id="sess-f" value={f} onChange={e => setF(e.target.value)}>
          {forms.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Date" htmlFor="sess-date"><input className="input" id="sess-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Places" htmlFor="sess-places"><input className="input" id="sess-places" type="number" min={1} max={60} value={places} onChange={e => setPlaces(e.target.value)} /></Field>
      </div>
      <Field label="Lieu" htmlFor="sess-lieu"><input className="input" id="sess-lieu" type="text" placeholder="Site de Lyon — salle B" value={lieu} onChange={e => setLieu(e.target.value)} /></Field>
      <p className="text-muted fine">
        {fm && (waiting ? `${plural(waiting, 'collaborateur attend', 'collaborateurs attendent')} un renouvellement ${fm.court}.` : `Aucun renouvellement ${fm.court} en attente.`)}
      </p>
    </Dialog>
  );
}
