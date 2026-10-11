// Suspendre ou retirer une habilitation après un incident ou une restriction, ou lever sa suspension.
// Motif obligatoire, date et auteur tracés ; Keystone ne reçoit que le matricule et un code de motif.
import { useState } from 'react';
import { HAB_CLS, HAB_LABEL, type HabMesureAction } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const TITRE: Record<HabMesureAction, string> = { suspendre: 'Suspendre une habilitation', lever: 'Lever la suspension', retirer: 'Retirer une habilitation' };
const BOUTON: Record<HabMesureAction, string> = { suspendre: 'Suspendre le titre', lever: 'Lever la suspension', retirer: 'Retirer le titre' };

export function HabMesureDialog({ empId, h, action }: { empId: number; h: string; action: HabMesureAction }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const [motif, setMotif] = useState('');
  const [date, setDate] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const emp = emps.find(e => e.id === empId);
  const hi = emp?.habs.find(x => x.h === h);
  if (!emp || !hi?.delivree) return null;

  const lever = action === 'lever';
  const dateErr = !isValidDate(date) ? 'Date invalide.'
    : date > d.ti ? 'La date ne peut pas être postérieure à aujourd’hui.'
    : date < hi.delivree ? `Date antérieure à la délivrance du titre (${fmt(parse(hi.delivree))}).` : '';
  const cant = !lever && (!motif.trim() || !!dateErr);
  // Après la levée, le titre reste non valide si ses prérequis manquent ou s'il est expiré.
  const apres = hi.d! < 0 ? 'Le titre est expiré : il restera à renouveler.'
    : !hi.prereqOk ? `Le titre restera suspendu tant que le prérequis manque : ${hi.failing.map(c => c.label).join(', ')}.`
    : 'Le titre redevient valide jusqu’au ' + fmt(hi.exp!) + '.';

  const confirm = async () => {
    setBusy(true);
    const r = await run(`hab.${action}`, lever ? { empId, h } : { empId, h, motif: motif.trim(), date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={TITRE[action]} width={540} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>{BOUTON[action]}</button>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label="Habilitation"><Static>{hi.hm.nom}</Static></Field>
      </div>
      <div className="boxed" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div className="text-muted sub" style={{ minWidth: 0 }}>Délivrée le {fmt(parse(hi.delivree))}{hi.par ? ` par ${hi.par}` : ''} · expire le {fmt(hi.exp!)}</div>
        <Tag cls={HAB_CLS[hi.key]} style={{ flex: 'none' }}>{HAB_LABEL[hi.key]}</Tag>
      </div>
      {hi.mesure && <NoteAccent>{hi.note}</NoteAccent>}

      {lever ? (
        <Fine>{apres} Le nouveau verdict des chantiers concernés est transmis à Keystone.</Fine>
      ) : <>
        <Field label="Date d’effet" htmlFor="hm-date">
          <input className="input" id="hm-date" type="date" min={hi.delivree} max={d.ti} value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 200 }} />
        </Field>
        {dateErr && <p className="form-error">{dateErr}</p>}
        <Field label="Motif (obligatoire)" htmlFor="hm-motif">
          <textarea className="input mid" id="hm-motif" rows={3} maxLength={500} placeholder="Incident, non-respect d’une consigne, restriction d’aptitude…"
            value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>Texte libre, visible du collaborateur et de son manager : n’y indiquez aucune information médicale (pathologie, traitement, détail d’une restriction). Pour une inaptitude, écrivez seulement « restriction d’aptitude ».</Fine>
        <Fine>
          {action === 'retirer'
            ? 'Le retrait est définitif : le titre ne pourra être rétabli que par une nouvelle délivrance, après contrôle des prérequis.'
            : `Le titre n’est plus valide dès cette date. ${rh ? 'Vous pourrez lever la suspension.' : 'Seul le service RH pourra lever la suspension.'}`}
          {' '}Les chantiers qui l’exigent passent en No Go : Keystone ne reçoit que le matricule et un code de motif.
        </Fine>
      </>}
    </Dialog>
  );
}
