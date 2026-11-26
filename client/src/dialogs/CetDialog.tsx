// Alimenter le compte épargne-temps : RTT de l'année (et de l'année précédente tant que sa clôture n'est pas faite) ou CP
// de la 5e semaine.
import { useState } from 'react';
import { cpPeriods } from '../../../shared/dates.ts';
import { fJ } from '../../../shared/format.ts';
import { cetInfo } from '../../../shared/rules/conges.ts';
import { erreurJours } from '../components/controles.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** RTT de l'année, RTT de l'année précédente (encore ouverte) ou CP de la 5e semaine. */
type CetKind = 'CP' | 'RTT' | 'RTT_PREC';

export function CetDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const ct = emp ? cetInfo(d, emp) : null;
  const [kind, setKind] = useState<CetKind>(ct && ct.placeRttPrec > 0 ? 'RTT_PREC' : ct && ct.placeRtt > 0 ? 'RTT' : 'CP');
  const [jours, setJours] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !ct) return null;

  const P = cpPeriods(d.ti), Y = d.year;
  const max = kind === 'CP' ? ct.placeCp : kind === 'RTT' ? ct.placeRtt : ct.placeRttPrec;
  const j = Number(jours);
  const joursErr = erreurJours(jours, max);
  const kinds: [CetKind, string, number][] = [
    ...(ct.placeRttPrec > 0 ? [['RTT_PREC', `${ct.rttLabel} ${ct.anneePrec}${t(' (year to close)')}`, ct.placeRttPrec] as [CetKind, string, number]] : []),
    ['RTT', `${ct.rttLabel} ${Y}`, ct.placeRtt], ['CP', `${t('CP — 5th week (')}${P.label})`, ct.placeCp],
  ];
  const rule = kind === 'CP'
    ? `${t('Only the days of the 5th week can be saved (beyond the first 20 working days, which remain to be taken). Accrued 5th week: ')}${fJ(ct.cp5)}${t(' · already placed this period: ')}${fJ(ct.cpDone)} / ${fJ(ct.plafondCp)}.`
    : kind === 'RTT_PREC'
      ? `${t('Up to ')}${fJ(ct.plafondRtt)}${t(' a year: the RTT of ')}${ct.anneePrec}${t(' not taken can still be placed until HR closes the year — afterwards, they are lost.')}`
      : `${t('Up to ')}${fJ(ct.plafondRtt)}${t(' a year, to place before 31 December — otherwise they are lost. Already placed in ')}${Y}${t(': ')}${fJ(ct.rttDone)} / ${fJ(ct.plafondRtt)}.`;

  const confirm = async () => {
    if (busy || !v.verifier(joursErr)) return;
    setBusy(true);
    const r = await run('cet.placer', kind === 'RTT_PREC' ? { empId, kind: 'RTT', annee: ct.anneePrec, jours: j } : { empId, kind, jours: j });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`${t('Time savings account')} — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Place on the CET')}</SubmitButton>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: 'var(--space-3)', alignItems: 'start' }}>
        <Field label={t('Days to save')} htmlFor="ce-k">
          <select className="input" id="ce-k" value={kind} onChange={ev => { setKind(ev.target.value as CetKind); setJours(''); }}>
            {kinds.map(([k, l, m]) => <option key={k} value={k}>{l} · {fJ(m)}{t(' can be saved')}</option>)}
          </select>
        </Field>
        <Field label={t('Number')} htmlFor="ce-j" requis erreur={v.erreur(joursErr)}>
          <input className="input" id="ce-j" type="number" min={0.5} step={0.5} max={max} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right' }} />
        </Field>
      </div>
      <p className="text-muted fine">{rule}</p>
      <div style={{ fontSize: 13 }}>
        {t('Current CET balance: ')}{fJ(ct.solde)} ({ct.cp}{t(' d CP · ')}{ct.rtt}{t(' d RTT')}{ct.repris ? ` · ${ct.repris}${t(' d taken over from the former tool')}` : ''}{ct.pris ? ` · ${fJ(ct.pris)}${t(' taken as leave')}` : ''}{ct.poses ? ` · ${fJ(ct.poses)}${t(' requested#plural')}` : ''})
      </div>
    </Dialog>
  );
}
