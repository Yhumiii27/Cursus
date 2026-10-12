// Planifier un entretien (parcours professionnel, état des lieux, annuel, forfait jours) et convoquer le salarié.
import { useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import type { EntretienType } from '../../../shared/types.ts';
import { erreurDate } from '../components/controles.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function EntPlanDialog({ empId, kind: kind0 }: { empId: number; kind: EntretienType }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [kind, setKind] = useState<EntretienType>(kind0);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  if (!emp) return null;
  const dateErr = erreurDate(date, 'Indiquez la date de l’entretien.') ?? (date < d.ti ? `Date passée : à partir du ${fmtIso(d.ti)}.` : null);

  const confirm = async () => {
    if (busy || !v.verifier(dateErr)) return;
    setBusy(true);
    const r = await run('entretien.planifier', { empId, kind, date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Planifier un entretien — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Planifier et convoquer</SubmitButton>
    </>}>
      <Field label="Type" htmlFor="ep-k">
        <select className="input" id="ep-k" value={kind} onChange={e => setKind(e.target.value as EntretienType)}>
          {(Object.keys(ENT_TYPES) as EntretienType[]).map(k => <option key={k} value={k}>{ENT_TYPES[k].nom}</option>)}
        </select>
      </Field>
      <Field label="Date" htmlFor="ep-d" requis erreur={v.erreur(dateErr)}>
        <input className="input" id="ep-d" type="date" min={d.ti} value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <div style={{ fontSize: 13 }}>Évaluateur : {d.mgrName(d.mgrOf(emp))}</div>
      <Fine>{ENT_TYPES[kind].base}</Fine>
    </Dialog>
  );
}
