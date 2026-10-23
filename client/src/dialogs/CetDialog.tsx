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
    ...(ct.placeRttPrec > 0 ? [['RTT_PREC', `${ct.rttLabel} ${ct.anneePrec} (année à clôturer)`, ct.placeRttPrec] as [CetKind, string, number]] : []),
    ['RTT', `${ct.rttLabel} ${Y}`, ct.placeRtt], ['CP', `CP — 5e semaine (${P.label})`, ct.placeCp],
  ];
  const rule = kind === 'CP'
    ? `Seuls les jours de la 5e semaine sont épargnables (au-delà des 20 premiers jours ouvrés, qui restent à prendre). Acquis 5e semaine : ${fJ(ct.cp5)} · déjà placés cette période : ${fJ(ct.cpDone)} / ${fJ(ct.plafondCp)}.`
    : kind === 'RTT_PREC'
      ? `Jusqu’à ${fJ(ct.plafondRtt)} par an : les RTT ${ct.anneePrec} non pris se placent encore jusqu’à la clôture de l’année par le service RH — ensuite, ils sont perdus.`
      : `Jusqu’à ${fJ(ct.plafondRtt)} par an, à placer avant le 31 décembre — à défaut ils sont perdus. Déjà placés en ${Y} : ${fJ(ct.rttDone)} / ${fJ(ct.plafondRtt)}.`;

  const confirm = async () => {
    if (busy || !v.verifier(joursErr)) return;
    setBusy(true);
    const r = await run('cet.placer', kind === 'RTT_PREC' ? { empId, kind: 'RTT', annee: ct.anneePrec, jours: j } : { empId, kind, jours: j });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Compte épargne-temps — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Placer sur le CET</SubmitButton>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px', gap: 'var(--space-3)', alignItems: 'start' }}>
        <Field label="Jours à épargner" htmlFor="ce-k">
          <select className="input" id="ce-k" value={kind} onChange={ev => { setKind(ev.target.value as CetKind); setJours(''); }}>
            {kinds.map(([k, l, m]) => <option key={k} value={k}>{l} · {fJ(m)} épargnables</option>)}
          </select>
        </Field>
        <Field label="Nombre" htmlFor="ce-j" requis erreur={v.erreur(joursErr)}>
          <input className="input" id="ce-j" type="number" min={0.5} step={0.5} max={max} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right' }} />
        </Field>
      </div>
      <p className="text-muted fine">{rule}</p>
      <div style={{ fontSize: 13 }}>
        Solde CET actuel : {fJ(ct.solde)} ({ct.cp} j CP · {ct.rtt} j RTT{ct.repris ? ` · ${ct.repris} j repris de l’ancien outil` : ''}{ct.pris ? ` · ${fJ(ct.pris)} pris en congé` : ''}{ct.poses ? ` · ${fJ(ct.poses)} demandés` : ''})
      </div>
    </Dialog>
  );
}
