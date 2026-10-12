// Signaler une absence imprévue (arrêt de travail, accident, absence inattendue) : le salarié pour lui-même,
// le manager pour son équipe. L'absence compte aussitôt (aucune heure ces jours-là, indisponibilité transmise
// à Keystone) ; le service RH en précise la nature à réception du justificatif, sans la révéler pour un arrêt.
import { useState } from 'react';
import { checkNature } from '../../../shared/rules/conges.ts';
import { CancelButton, Controles, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function AbsSignalDialog({ empId }: { empId?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { rh, manager, me } = useRole();
  // Soi-même, son équipe (manager) ou tout le monde (RH).
  const choix = d.ds.employes.filter(e => rh || e.id === me || (manager && d.mgrOf(e) === me)).sort((a, b) => a.nom.localeCompare(b.nom));
  const [sel, setSel] = useState<number | null>(() => empId ?? (manager ? choix.find(e => e.id !== me)?.id : me) ?? choix[0]?.id ?? null);
  const [du, setDu] = useState(d.ti);
  const [au, setAu] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const emp = sel != null ? d.emp(sel) : undefined;
  const chk = emp ? checkNature(d, emp, 'ABSENCE', du, au, { quand: 'avant de signaler l’absence' }) : null;

  const pickDu = (v: string) => { setDu(v); if (!au || au < v) setAu(v); };
  const confirm = async () => {
    setBusy(true);
    const r = await run('absence.signaler', { empId: sel, du, au });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Signaler une absence" width={540} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!chk || chk.cant || busy} onClick={confirm}>Signaler l’absence</button>
    </>}>
      <Field label="Collaborateur" htmlFor="as-emp">
        {empId != null || choix.length <= 1
          ? <Static>{emp?.nom ?? '—'}</Static>
          : (
            <select className="input" id="as-emp" value={String(sel ?? '')} onChange={ev => setSel(Number(ev.target.value))}>
              {choix.map(e => <option key={e.id} value={e.id}>{e.nom}{e.id === me ? ' (moi)' : ''}</option>)}
            </select>
          )}
      </Field>
      <div className="grid-2">
        <Field label="Absent depuis le" htmlFor="as-du"><input className="input" id="as-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label="Jusqu’au (inclus, prévu)" htmlFor="as-au"><input className="input" id="as-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      {chk && <Controles msgs={chk.msgs} />}
      <Fine>
        L’absence compte dès son signalement : aucune heure ne peut être saisie ces jours-là et Keystone reçoit l’indisponibilité.
        Le service RH précise ensuite sa nature (arrêt de travail, accident, événement familial…) ; un arrêt de travail n’est communiqué ni au manager ni à Keystone.
        Si l’absence dure plus longtemps, prolongez-la depuis la liste.
      </Fine>
      {sel === me && !rh && <Fine muted={false}>Transmettez votre justificatif (avis d’arrêt de travail…) au service RH sous 48 heures.</Fine>}
    </Dialog>
  );
}
