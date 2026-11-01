// lot 11 — indicateurs (t197) : mise à disposition du CSE d'un arrêté annuel des indicateurs sociaux
// (`indicateurs.marquerCse`, service RH ; server/src/actions/indicateurs.ts). Le jour de la mise à disposition (dépôt dans
// la BDESE) : pas dans le futur, pas avant l'arrêté (jour de Paris de l'arrêté, borné par la date du jour métier).
import { useState } from 'react';
import { isoParis } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ArreteCseDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const a = (d.ds.indicateursArretes ?? []).find(x => x.id === id);
  const [le, setLe] = useState(a?.cseLe ?? d.ti);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!a) return null;
  // Même borne que le serveur (premierJourCse) : le jour de l'arrêté, ou la date du jour métier si elle le précède.
  const jourArrete = isoParis(new Date(a.arreteLe));
  const min = jourArrete < d.ti ? jourArrete : d.ti;
  const err = erreurDate(le, 'Indiquez le jour de la mise à disposition.')
    ?? (le > d.ti ? 'La mise à disposition ne peut pas être datée du futur.' : le < min ? 'La mise à disposition ne peut pas précéder l’arrêté.' : null);
  const envoyer = async () => {
    if (busy || !v.verifier(err)) return;
    setBusy(true);
    const r = await run('indicateurs.marquerCse', { id: a.id, le });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title="Mise à disposition du CSE" width={480} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <Field label="Arrêté">
        <Static>Indicateurs {a.annee} · arrêté n° {a.id}<div className="text-muted sub">figé le {fmtIso(jourArrete)}</div></Static>
      </Field>
      <Field label="Mis à disposition le" htmlFor="arrete-cse-le" requis erreur={v.erreur(err) || (err && le ? err : null)}>
        <input className="input" id="arrete-cse-le" type="date" min={min} max={d.ti} value={le} onChange={ev => setLe(ev.target.value)} />
      </Field>
      <Fine>
        Jour où l’arrêté a été déposé dans la BDESE (impression ou export de l’onglet BDESE des Indicateurs sociaux) : les élus n’ont pas d’accès à Cursus.
        {a.cseLe ? ` Déjà noté au ${fmtIso(a.cseLe)} : la nouvelle date la remplace.` : ''}
      </Fine>
    </Dialog>
  );
}
