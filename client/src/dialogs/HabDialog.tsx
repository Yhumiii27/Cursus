// Délivrer ou renouveler une habilitation, après contrôle des prérequis.
import { useState } from 'react';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { CancelButton, CheckList, Dialog, Field } from '../components/Dialog.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function HabDialog({ empId: empId0, h: h0, mode }: { empId?: number | null; h?: string | null; mode: 'new' | 'deliver' | 'renew' }) {
  const { d, emps, horizon } = useEnriched();
  const { run, closeDialog } = useStore();
  const habs = d.ds.referentiels.habilitations;
  const [empId, setEmpId] = useState<number>(empId0 ?? d.ds.employes[0]?.id ?? 0);
  const [h, setH] = useState<string>(h0 ?? habs[0]?.id ?? '');
  const [date, setDate] = useState<string>(d.ds.today);
  const [par, setPar] = useState<string>(d.hm(h0 ?? habs[0]?.id ?? '')?.signataire ?? '');
  const [busy, setBusy] = useState(false);
  const emp = emps.find(e => e.id === empId) ?? emps[0];
  const hm = d.hm(h);
  if (!emp || !hm) return null;

  const lock = mode !== 'new';
  const valid = isValidDate(date);
  const info = d.habInfo({ h, delivree: valid ? date : null }, emp.rawCerts, emp.med, horizon);
  const checks = info.checks.map(c => ({
    key: c.label, label: c.label, text: c.text,
    cls: c.ok ? (c.due ? 'tag-outline' : 'tag-neutral') : 'tag-accent', statut: c.ok ? (c.due ? 'À renouveler' : 'OK') : 'Manquant',
  }));
  const hint = info.prereqOk
    ? `Validité ${validiteLabel(hm.validite)}${valid ? ' — le titre expirera le ' + fmt(addMonths(parse(date), hm.validite)) : ''}.`
    : `Délivrance impossible — ${info.failing.map(c => c.label).join(', ')}.`;
  const cant = !info.prereqOk || !valid || !par.trim();
  const empOptions = [...d.ds.employes].sort((a, b) => a.nom.localeCompare(b.nom));

  const changeH = (id: string) => {
    setH(id);
    setPar(d.hm(id)?.signataire ?? '');
  };

  const confirm = async () => {
    setBusy(true);
    const r = await run('hab.delivrer', { empId: emp.id, h, date, par: par.trim(), mode });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={mode === 'renew' ? 'Renouveler une habilitation' : 'Délivrer une habilitation'} label="Habilitation" width={560} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>{mode === 'renew' ? 'Renouveler le titre' : 'Délivrer le titre'}</button>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur" htmlFor="hab-emp">
          <select className="input" id="hab-emp" value={emp.id} disabled={lock} onChange={e => setEmpId(Number(e.target.value))}>
            {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
        <Field label="Habilitation" htmlFor="hab-h">
          <select className="input" id="hab-h" value={h} disabled={lock} onChange={e => changeH(e.target.value)}>
            {habs.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Contrôle des prérequis"><CheckList checks={checks} /></Field>
      <div className="grid-2">
        <Field label="Date de délivrance" htmlFor="hab-date"><input className="input" id="hab-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Signataire (employeur)" htmlFor="hab-par"><input className="input" id="hab-par" type="text" value={par} onChange={e => setPar(e.target.value)} /></Field>
      </div>
      <p className="text-muted fine">{hint}</p>
    </Dialog>
  );
}
