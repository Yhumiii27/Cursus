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
        Solde CP {P.label} : {fJ(cp.solde)}{cp.accorde ? `, dont ${fJ(cp.accorde)} déjà reportés` : ''} — à prendre normalement avant le {fmt(parse(P.deadline))}.
        Les jours reportés s’ajoutent aux droits de la période {periodeCp(A + 1)} à la clôture du {fmt(parse(finPeriodeCp(A)))}, dans la limite du solde restant alors.
        Les RTT ne sont pas reportables (perdus au 31 décembre).
      </p>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Field label="Jours" htmlFor="rp-j" requis erreur={v.erreur(joursErr)}>
          <input className="input" id="rp-j" type="number" min={0.5} step={0.5} max={plafond} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right' }} />
        </Field>
        <Field label="Utilisables jusqu’au">
          <Static>{fmt(parse(expire))}</Static>
        </Field>
      </div>
      <Field label="Motif" htmlFor="rp-m" requis erreur={v.erreur(motifErr)}>
        <input className="input" id="rp-m" type="text" placeholder="Arrêt de travail, charge de projet…" value={motif} onChange={ev => setMotif(ev.target.value)} />
      </Field>
      {hist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {hist.map(r => {
            const x = periodeReport(r);
            return (
              <div key={r.id} className="text-muted sub">
                {r.sens === 'recu' ? `Report reçu sur ${periodeCp(x.periode)}` : `Report accordé vers ${periodeCp(x.periode)}`} : {fJ(r.jours)} le {fmt(parse(r.date))} par {r.par}
                {' '}— jusqu’au {fmt(parse(x.expire))}{r.motif ? ` — ${r.motif}` : ''}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-muted fine">Échéance : le {fmt(parse(expire))}, fin de la période suivante (seul un report légal court au-delà). Décision tracée (auteur, date, échéance) ; le motif n’est lu que par le service RH et le salarié.</p>
    </Dialog>
  );
}
