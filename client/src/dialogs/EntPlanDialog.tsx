// Planifier un entretien (parcours professionnel, état des lieux, annuel, forfait jours) et convoquer le salarié.
// Un seul entretien planifié par type : déjà prévu (à venir, ou passé sans avoir été clos), il est reprogrammé à la nouvelle
// date ; passé avec un compte rendu commencé, seulement si l'évaluateur confirme qu'il n'a pas été tenu (`reprogrammation`).
// Conflits de dates contrôlés en direct : salarié absent (bloquant), déplacement, session ou autre entretien (avertissement).
import { useState } from 'react';
import { ENT_TYPES } from '../../../shared/constants.ts';
import { isValidDate } from '../../../shared/dates.ts';
import { blocage, type Conflit, conflitsDates } from '../../../shared/rules/conflits.ts';
import { reprogrammation } from '../../../shared/rules/entretiens.ts';
import type { EntretienType } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { fmtIso } from '../../../shared/format.ts';
import { erreurDate } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function EntPlanDialog({ empId, kind: kind0 }: { empId: number; kind: EntretienType }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [kind, setKind] = useState<EntretienType>(kind0);
  const [date, setDate] = useState('');
  const [nonTenu, setNonTenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  if (!emp) return null;
  const dateErr = erreurDate(date, 'Indiquez la date de l’entretien.') ?? (date < d.ti ? `Date passée : à partir du ${fmtIso(d.ti)}.` : null);
  const { prevu, aConfirmer, msg } = reprogrammation(d, empId, kind, date, nonTenu);
  const msgs: Conflit[] = [
    ...(msg ? [msg] : []),
    ...(isValidDate(date) ? conflitsDates(d, empId, date, date, 'entretien', { entretienId: prevu?.id }) : []),
  ];

  const confirm = async () => {
    if (busy || !v.verifier(dateErr, blocage(msgs))) return;
    setBusy(true);
    const r = await run('entretien.planifier', { empId, kind, date, ...(aConfirmer && nonTenu ? { nonTenu: true } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Planifier un entretien — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{prevu ? 'Reprogrammer et convoquer' : 'Planifier et convoquer'}</SubmitButton>
    </>}>
      <Field label="Type" htmlFor="ep-k">
        <select className="input" id="ep-k" value={kind} onChange={e => { setKind(e.target.value as EntretienType); setNonTenu(false); }}>
          {(Object.keys(ENT_TYPES) as EntretienType[]).map(k => <option key={k} value={k}>{ENT_TYPES[k].nom}</option>)}
        </select>
      </Field>
      <Field label="Date" htmlFor="ep-d" requis erreur={v.erreur(dateErr)}>
        <input className="input" id="ep-d" type="date" min={d.ti} value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <Controles msgs={msgs} />
      {aConfirmer && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13 }}>
          <input type="checkbox" checked={nonTenu} onChange={ev => setNonTenu(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          L’entretien prévu n’a pas eu lieu : le reprogrammer, avec son compte rendu
        </label>
      )}
      <div style={{ fontSize: 13 }}>Évaluateur : {d.mgrName(d.mgrOf(emp))}</div>
      <Fine>{ENT_TYPES[kind].base}</Fine>
    </Dialog>
  );
}
