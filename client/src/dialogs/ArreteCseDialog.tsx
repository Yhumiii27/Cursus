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
import { t } from '../i18n/langue.ts';

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
  const err = erreurDate(le, t('Enter the day it was made available.'))
    ?? (le > d.ti ? t('Making available cannot be dated in the future.') : le < min ? t('Making available cannot come before the freeze.') : null);
  const envoyer = async () => {
    if (busy || !v.verifier(err)) return;
    setBusy(true);
    const r = await run('indicateurs.marquerCse', { id: a.id, le });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={t('Made available to the CSE#title')} width={480} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <Field label={t('Freeze')}>
        <Static>{t('Indicators ')}{a.annee} · {t('freeze no. ')}{a.id}<div className="text-muted sub">{t('frozen on ')}{fmtIso(jourArrete)}</div></Static>
      </Field>
      <Field label={t('Made available on')} htmlFor="arrete-cse-le" requis erreur={v.erreur(err) || (err && le ? err : null)}>
        <input className="input" id="arrete-cse-le" type="date" min={min} max={d.ti} value={le} onChange={ev => setLe(ev.target.value)} />
      </Field>
      <Fine>
        {t('Day when the freeze was filed in the BDESE (print or export of the BDESE tab of the Social indicators): the elected members have no access to Cursus.')}
        {a.cseLe ? `${t(' Already noted at ')}${fmtIso(a.cseLe)}${t(': the new date replaces it.')}` : ''}
      </Fine>
    </Dialog>
  );
}
