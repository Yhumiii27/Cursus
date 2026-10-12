// Poser une absence (CP, RTT / repos, récupération) : décompte et contrôles en direct.
// Posée par le manager direct pour un membre de son équipe, l'absence est validée d'emblée.
// Intérim : aucun type ouvert (congés gérés par l'agence), le dialogue l'indique sans proposer d'envoi.
import { useState } from 'react';
import { absenceKinds, checkAbsence } from '../../../shared/rules/conges.ts';
import type { CongeType } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function AbsDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { manager, me } = useRole();
  const emp = d.emp(empId);
  const kinds = emp ? absenceKinds(d, emp) : [];
  const [kind, setKind] = useState<CongeType>(() => kinds[0]?.[0] || 'CP');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [busy, setBusy] = useState(false);
  if (!emp) return null;

  if (!kinds.length) {
    return (
      <Dialog title="Poser une absence" width={520} actions={<CancelButton label="Fermer" />}>
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Congés gérés par l’agence d’intérim — aucune absence à poser dans Cursus</p>
      </Dialog>
    );
  }

  const parManager = manager && emp.id !== me && d.mgrOf(emp) === me;
  // Posée par le manager, l'absence est validée d'emblée : des heures saisies ces jours-là la bloquent.
  const chk = checkAbsence(d, emp, kind, du, au, parManager);

  const pickDu = (v: string) => { setDu(v); if (!au || au < v) setAu(v); };
  const confirm = async () => {
    setBusy(true);
    const r = await run('absence.demander', { empId, kind, du, au });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Poser une absence" width={520} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={chk.cant || busy} onClick={confirm}>{parManager ? 'Poser et valider' : 'Envoyer la demande'}</button>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Type" htmlFor="ab-k">
          <select className="input" id="ab-k" value={kind} onChange={ev => setKind(ev.target.value as CongeType)}>
            {chk.kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Du" htmlFor="ab-du"><input className="input" id="ab-du" type="date" value={du} onChange={ev => pickDu(ev.target.value)} /></Field>
        <Field label="Au (inclus)" htmlFor="ab-au"><input className="input" id="ab-au" type="date" value={au} min={du || undefined} onChange={ev => setAu(ev.target.value)} /></Field>
      </div>
      <div style={{ fontSize: 13 }}>{chk.soldeLabel}</div>
      {chk.msgs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {chk.msgs.map(m => <p key={m.text} style={{ fontSize: 12, margin: 0, color: m.bad ? 'var(--color-accent-300)' : 'var(--color-neutral-400)' }}>{m.text}</p>)}
        </div>
      )}
      {parManager && <p style={{ fontSize: 12, margin: 0, color: 'var(--color-neutral-400)' }}>Posée par le manager : l’absence est validée immédiatement et transmise à Keystone</p>}
    </Dialog>
  );
}
