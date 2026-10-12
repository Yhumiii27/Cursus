// Prolonger un arrêt ou une absence hors congés : nouvelle fin, sans chevauchement d'une autre absence.
// Hors service RH, une absence qualifiée repasse « à qualifier » : le RH enregistre l'avis de prolongation.
import { useState } from 'react';
import { ABS_LABEL } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { checkNature } from '../../../shared/rules/conges.ts';
import type { NatureAbsence } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function AbsProlongerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const a = d.ds.absences.find(x => x.id === id);
  const [au, setAu] = useState('');
  const [busy, setBusy] = useState(false);
  const emp = a ? d.emp(a.empId) : undefined;
  if (!a || !emp) return null;

  const debut = addD(a.au, 1);
  const chk = au ? checkNature(d, emp, a.type as NatureAbsence | 'ABSENCE', debut, au, { exclure: a.id, quand: 'avant de prolonger l’absence' }) : null;
  const confirm = async () => {
    setBusy(true);
    const r = await run('absence.prolonger', { id, au });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Prolonger une absence" width={520} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!chk || chk.cant || busy} onClick={confirm}>Prolonger</button>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Absence"><Static>{ABS_LABEL[a.type]}</Static></Field>
      </div>
      <div className="boxed text-muted sub">
        {periodeTexte(a.du, a.au)}{a.finInitiale ? ` · déjà prolongée, fin initiale le ${fmtIso(a.finInitiale)}` : ''}
      </div>
      <Field label="Nouvelle fin (incluse)" htmlFor="ap-au">
        <input className="input" id="ap-au" type="date" min={debut} value={au} onChange={ev => setAu(ev.target.value)} style={{ maxWidth: 200 }} />
      </Field>
      {chk && <Controles msgs={chk.msgs} />}
      <Fine>
        {rh || a.statut === 'signalee'
          ? 'Keystone reçoit la prolongation de l’indisponibilité.'
          : 'L’absence repasse « à qualifier » : le service RH enregistre l’avis de prolongation. Keystone reçoit la prolongation de l’indisponibilité.'}
      </Fine>
    </Dialog>
  );
}
