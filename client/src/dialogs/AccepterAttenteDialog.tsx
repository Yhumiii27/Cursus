// Acceptation d'une demande de formation dont la session souhaitée est complète (lot 7, chantier C, t120 ;
// server/src/liste-attente.ts) : liste d'attente de la session (rang d'arrivée, inscription quand une place se libère,
// proposée au service RH qui confirme), ou plan de formation (repli : ligne prévue, à replanifier). Le salarié, et le
// manager qui a fait la demande, sont prévenus de la suite donnée ; la réponse le dit.
import { useState } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { fileDe, placeTexte } from '../../../shared/rules/liste-attente.ts';
import { plageCourte } from '../../../shared/rules/plage-session.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

type Choix = 'attente' | 'plan';

export function AccepterAttenteDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [choix, setChoix] = useState<Choix>('attente');
  const [busy, setBusy] = useState(false);
  const r = d.ds.demandesCollab.find(x => x.id === id);
  const s = r ? d.session(r.sessionId) : null;
  if (!r || !s) return null;
  const fm = d.fm(s.formation);
  const file = fileDe(d.ds.attentesSession ?? [], s.id);
  const CHOIX: Record<Choix, { label: string; aide: string }> = {
    attente: {
      label: `Liste d’attente de la session (${placeTexte(file.length + 1)})`,
      aide: `${file.length ? `${plural(file.length, 'personne attend', 'personnes attendent')} déjà. ` : ''}Quand une place se libère, Cursus propose le premier de la file au service RH, qui confirme l’inscription : la convocation part à ce moment-là.`,
    },
    plan: {
      label: 'Plan de formation',
      aide: 'Une ligne prévue est ajoutée au plan de formation de son équipe : le service RH l’inscrira à une prochaine session.',
    },
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const x = await run('demande.accepter', { id, complete: choix });
    setBusy(false);
    if (x.ok) closeDialog();
  };

  return (
    <Dialog title="Accepter la demande — session complète" width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Accepter la demande</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{d.personName(r.empId)}</Static></Field>
        <Field label="Session souhaitée"><Static>{fm?.court ?? s.formation} · {plageCourte(s)}<div className="text-muted sub">{s.inscrits} / {s.places} · complète</div></Static></Field>
      </div>
      <Field label="Suite donnée">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(Object.keys(CHOIX) as Choix[]).map(k => (
            <label key={k} className="boxed" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer' }}>
              <input type="radio" name="aa-choix" value={k} checked={choix === k} onChange={() => setChoix(k)}
                style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
              <span>
                <span style={{ fontSize: 14 }}>{CHOIX[k].label}</span>
                <span className="text-muted sub" style={{ display: 'block' }}>{CHOIX[k].aide}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Fine>La réponse dit au salarié que la session du {fmt(parse(s.date))} est complète, et la suite donnée ; il en est prévenu par e-mail, comme le manager qui a fait la demande.</Fine>
    </Dialog>
  );
}
