// Ajouter une certification au dossier d'un collaborateur.
import { useState } from 'react';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function CertDialog({ empId }: { empId: number }) {
  const { d, forms } = useEnriched();
  const { run, closeDialog } = useStore();
  const [f, setF] = useState(forms[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const emp = d.emp(empId);
  if (!emp) return null;
  const fm = d.fm(f);
  const valid = isValidDate(date);

  const confirm = async () => {
    setBusy(true);
    const r = await run('cert.ajouter', { empId, f, date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Ajouter une certification" actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={confirm}>Ajouter</button>
    </>}>
      <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
      <Field label="Formation" htmlFor="cert-f">
        <select className="input" id="cert-f" value={f} onChange={e => setF(e.target.value)}>
          {forms.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Date d’obtention" htmlFor="cert-date"><input className="input" id="cert-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Validité"><Static pad>{fm ? `${validiteLabel(fm.validite)}${valid ? ' · expire le ' + fmt(addMonths(parse(date), fm.validite)) : ''}` : '—'}</Static></Field>
      </div>
    </Dialog>
  );
}
