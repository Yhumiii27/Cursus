// Enregistrer une formalité de voyage : passeport, visa ou vaccination.
import { useState } from 'react';
import { VACCINS, VISA_RULES } from '../../../shared/constants.ts';
import type { FormaliteKind } from '../../../shared/domain.ts';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import type { VaccinId } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function FormaliteDialog({ empId: empId0, kind: kind0, dest: dest0, v: v0 }: { empId?: number | null; kind?: FormaliteKind; dest?: string; v?: VaccinId }) {
  const d = useDomain();
  const { collab, me } = useRole();
  const { run, closeDialog } = useStore();
  const employes = d.ds.employes;
  const empOptions = [...employes].sort((a, b) => a.nom.localeCompare(b.nom));
  const visaDests = d.ds.referentiels.destinations.filter(x => x.visa !== 'none');
  const lockEmp = collab || !!empId0;
  const ruleLabel = (code: string) => { const x = d.destOf(code); return x ? VISA_RULES[x.visa].label : ''; };

  const [empId, setEmpId] = useState(collab ? me! : empId0 || ((employes.find(e => e.passeport) ?? employes[0])?.id ?? 0));
  const [kind, setKind] = useState<FormaliteKind>(kind0 ?? 'passeport');
  const [numero, setNumero] = useState('');
  const [expire, setExpire] = useState('');
  const [dest, setDestState] = useState(dest0 ?? visaDests[0]?.code ?? '');
  const [visaType, setVisaType] = useState(ruleLabel(dest0 ?? visaDests[0]?.code ?? ''));
  const [obtenu, setObtenu] = useState('');
  const [v, setV] = useState<VaccinId>(v0 ?? 'fj');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  const setDest = (code: string) => { setDestState(code); setVisaType(ruleLabel(code)); };
  const vm = VACCINS[v];
  const vacHint = `${vm.validite == null ? 'Certificat valable à vie' : 'Validité ' + validiteLabel(vm.validite)}${isValidDate(date) && vm.validite ? ' · rappel le ' + fmt(addMonths(parse(date), vm.validite)) : ''}`;
  const cant = kind === 'passeport' ? !(numero.trim() && isValidDate(expire)) : kind === 'visa' ? !isValidDate(expire) : !isValidDate(date);

  const confirm = async () => {
    setBusy(true);
    const r = await run('formalite.enregistrer', { empId, kind, numero, expire, dest, visaType, obtenu, v, date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Enregistrer une formalité" width={520} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>Enregistrer</button>
    </>}>
      <Field label="Collaborateur" htmlFor="fo-emp">
        <select className="input" id="fo-emp" value={empId} disabled={lockEmp} onChange={e => setEmpId(Number(e.target.value))}>
          {empOptions.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <Seg name="foKind" label="Type de formalité" value={kind} onChange={setKind}
        options={[['passeport', 'Passeport'], ['visa', 'Visa'], ['vaccin', 'Vaccination']]} />
      {kind === 'passeport' && (
        <div className="grid-2">
          <Field label="Numéro" htmlFor="fo-num"><input className="input" id="fo-num" type="text" placeholder="22AB12345" value={numero} onChange={e => setNumero(e.target.value)} /></Field>
          <Field label="Date d’expiration" htmlFor="fo-pexp"><input className="input" id="fo-pexp" type="date" value={expire} onChange={e => setExpire(e.target.value)} /></Field>
        </div>
      )}
      {kind === 'visa' && (
        <div className="grid-2">
          <Field label="Pays" htmlFor="fo-dest">
            <select className="input" id="fo-dest" value={dest} onChange={e => setDest(e.target.value)}>
              {visaDests.map(o => <option key={o.code} value={o.code}>{o.pays}</option>)}
            </select>
          </Field>
          <Field label="Type" htmlFor="fo-vt"><input className="input" id="fo-vt" type="text" value={visaType} onChange={e => setVisaType(e.target.value)} /></Field>
          <Field label="Date d’obtention" htmlFor="fo-vob"><input className="input" id="fo-vob" type="date" value={obtenu} onChange={e => setObtenu(e.target.value)} /></Field>
          <Field label="Valable jusqu’au" htmlFor="fo-vexp"><input className="input" id="fo-vexp" type="date" value={expire} onChange={e => setExpire(e.target.value)} /></Field>
        </div>
      )}
      {kind === 'vaccin' && <>
        <div className="grid-2">
          <Field label="Vaccin" htmlFor="fo-v">
            <select className="input" id="fo-v" value={v} onChange={e => setV(e.target.value as VaccinId)}>
              {(Object.keys(VACCINS) as VaccinId[]).map(id => <option key={id} value={id}>{VACCINS[id].nom}</option>)}
            </select>
          </Field>
          <Field label="Date d’injection" htmlFor="fo-vd"><input className="input" id="fo-vd" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <p className="text-muted fine">{vacHint} · seule la date est conservée, aucune donnée médicale détaillée.</p>
      </>}
    </Dialog>
  );
}
