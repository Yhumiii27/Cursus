// Reporter des congés payés au-delà du 31 mai (décision RH tracée).
import { useState } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fJ, fmt } from '../../../shared/format.ts';
import { cpInfo } from '../../../shared/rules/conges.ts';
import { erreurJours, erreurTexte } from '../components/controles.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ReportDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [jours, setJours] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  const cp = emp ? cpInfo(d, emp) : null;
  if (!emp || !cp) return null;

  const P = cp.periodes;
  const max = cp.solde;
  const j = Number(jours);
  const joursErr = erreurJours(jours, max);
  const motifErr = erreurTexte(motif, 'Indiquez le motif du report.');
  const hist = d.ds.reports.filter(r => r.empId === empId);

  const confirm = async () => {
    if (busy || !v.verifier(joursErr, motifErr)) return;
    setBusy(true);
    const r = await run('report.accorder', { empId, jours: j, motif: motif.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Reporter des congés payés — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Accorder le report</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Solde CP {P.label} : {fJ(cp.solde)} — à prendre normalement avant le {fmt(parse(P.deadline))}. Les RTT ne sont pas reportables (perdus au 31 décembre).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 'var(--space-3)', alignItems: 'start' }}>
        <Field label="Jours" htmlFor="rp-j" requis erreur={v.erreur(joursErr)}>
          <input className="input" id="rp-j" type="number" min={0.5} step={0.5} max={max} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right' }} />
        </Field>
        <Field label="Motif" htmlFor="rp-m" requis erreur={v.erreur(motifErr)}>
          <input className="input" id="rp-m" type="text" placeholder="Arrêt de travail, charge de projet…" value={motif} onChange={ev => setMotif(ev.target.value)} />
        </Field>
      </div>
      {hist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {hist.map(r => (
            <div key={r.id} className="text-muted sub">
              {r.sens === 'recu' ? 'Report reçu' : 'Report accordé'} : {fJ(r.jours)} le {fmt(parse(r.date))} par {r.par} — {r.motif}
            </div>
          ))}
        </div>
      )}
      <p className="text-muted fine">Les jours reportés restent utilisables jusqu’au {fmt(parse(P.reportDeadline))}. Décision tracée (auteur, date, motif).</p>
    </Dialog>
  );
}
