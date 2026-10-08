// Planifier un entretien (parcours professionnel, état des lieux, annuel, forfait jours) et convoquer le salarié.
import { useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isValidDate } from '../../../shared/dates.ts';
import type { EntretienType } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function EntPlanDialog({ empId, kind: kind0 }: { empId: number; kind: EntretienType }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [kind, setKind] = useState<EntretienType>(kind0);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const emp = d.emp(empId);
  if (!emp) return null;
  const cant = !isValidDate(date) || date < d.ti;

  const confirm = async () => {
    setBusy(true);
    const r = await run('entretien.planifier', { empId, kind, date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Planifier un entretien — ${emp.nom}`} label="Planifier un entretien" width={520} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>Planifier et convoquer</button>
    </>}>
      <Field label="Type" htmlFor="ep-k">
        <select className="input" id="ep-k" value={kind} onChange={e => setKind(e.target.value as EntretienType)}>
          {(Object.keys(ENT_TYPES) as EntretienType[]).map(k => <option key={k} value={k}>{ENT_TYPES[k].nom}</option>)}
        </select>
      </Field>
      <Field label="Date" htmlFor="ep-d">
        <input className="input" id="ep-d" type="date" min={d.ti} value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <div style={{ fontSize: 13 }}>Évaluateur : {d.mgrName(d.mgrOf(emp))}</div>
      <Fine>{ENT_TYPES[kind].base}</Fine>
    </Dialog>
  );
}
