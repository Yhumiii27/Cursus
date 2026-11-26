// Reporter des congés payés sur la période suivante (décision RH tracée, au cas par cas) : jours de la période en cours,
// dans la limite du solde non encore reporté, utilisables jusqu'au 31 mai suivant (seul un report légal court au-delà).
// Le report est appliqué à la clôture de la période (31 mai), qui le plafonne au solde restant alors.
import { useState } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fJ, fmt } from '../../../shared/format.ts';
import { echeanceReport } from '../../../shared/rules/clotures.ts';
import { anneeCp, cpInfo, finPeriodeCp, periodeCp, periodeReport } from '../../../shared/rules/conges.ts';
import { erreurJours, erreurTexte } from '../components/controles.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function ReportDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const A = anneeCp(d.ti), expire = echeanceReport(A);
  const [jours, setJours] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  const cp = emp ? cpInfo(d, emp) : null;
  if (!emp || !cp) return null;

  const P = cp.periodes;
  // Solde non encore reporté : les reports déjà accordés sur la période suivante en sont déduits.
  const plafond = Math.max(0, cp.solde - cp.accorde);
  const j = Number(jours);
  const joursErr = erreurJours(jours, plafond);
  const motifErr = erreurTexte(motif, t('Enter the reason for the carry-over.'));
  const hist = d.ds.reports.filter(r => r.empId === empId);

  const confirm = async () => {
    if (busy || !v.verifier(joursErr, motifErr)) return;
    setBusy(true);
    const r = await run('report.accorder', { empId, jours: j, motif: motif.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`${t('Carry over paid leave')} — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Grant the carry-over')}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {t('CP balance ')}{P.label}{t(': ')}{fJ(cp.solde)}{cp.accorde ? `${t(', of which #comma')}${fJ(cp.accorde)}${t(' already carried over')}` : ''}{t(' — to take normally before ')}{fmt(parse(P.deadline))}{t('. The days carried over are added to the entitlement of the period ')}{periodeCp(A + 1)}{t(' at the closing of ')}{fmt(parse(finPeriodeCp(A)))}{t(', within the limit of the balance then remaining. RTT cannot be carried over (lost on 31 December).')}
      </p>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Field label={t('Days')} htmlFor="rp-j" requis erreur={v.erreur(joursErr)}>
          <input className="input" id="rp-j" type="number" min={0.5} step={0.5} max={plafond} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right' }} />
        </Field>
        <Field label={t('Usable until')}>
          <Static>{fmt(parse(expire))}</Static>
        </Field>
      </div>
      <Field label={t('Reason')} htmlFor="rp-m" requis erreur={v.erreur(motifErr)}>
        <input className="input" id="rp-m" type="text" placeholder={t('Sick leave, project workload…')} value={motif} onChange={ev => setMotif(ev.target.value)} />
      </Field>
      {hist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {hist.map(r => {
            const x = periodeReport(r);
            return (
              <div key={r.id} className="text-muted sub">
                {r.sens === 'recu' ? `${t('Carry-over received on ')}${periodeCp(x.periode)}` : `${t('Carry-over granted to ')}${periodeCp(x.periode)}`}{t(': ')}{fJ(r.jours)}{t(' on #le')}{fmt(parse(r.date))}{t(' by ')}{r.par}
                {' '}{t('— until ')}{fmt(parse(x.expire))}{r.motif ? ` — ${r.motif}` : ''}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-muted fine">{t('Due: ')}{fmt(parse(expire))}{t(', end of the next period (only a legal carry-over runs beyond). Decision recorded (author, date, due date); the reason is read only by HR and the employee.')}</p>
    </Dialog>
  );
}
