// lot 13 — CET (monétisation) : demande de monétisation de jours du compte épargne-temps, par le salarié pour lui-même ou
// par le service RH pour lui (`cet.monetiser`). Le service RH valide ensuite la demande (components/MonetisationsCet.tsx).
// Règles : shared/rules/cet-monetisation.ts (refaites par le serveur).
import { useState } from 'react';
import { fJ } from '../../../shared/format.ts';
import { monetisationInfo } from '../../../shared/rules/cet-monetisation.ts';
import { erreurJours } from '../components/controles.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function MonetisationCetDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const [jours, setJours] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp) return null;
  const m = monetisationInfo(d, emp);
  const joursErr = erreurJours(jours, m.possible);
  const confirm = async () => {
    if (busy || !v.verifier(joursErr)) return;
    setBusy(true);
    const r = await run('cet.monetiser', { empId, jours: Number(jours) });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`${t('Cash in CET days')} — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Request the cash-in')}</SubmitButton>
    </>}>
      <Field label={t('Days to cash in')} htmlFor="mon-j" requis erreur={v.erreur(joursErr)}>
        <input className="input" id="mon-j" type="number" min={0.5} step={0.5} max={m.possible} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right', maxWidth: 140 }} />
      </Field>
      <p className="text-muted fine">
        {fJ(m.possible)}{t(' can be cashed in today: days coming from RTT')}{m.reprisMonetisable ? t(' and from the balance taken over from the former tool') : ''} ({fJ(m.parOrigine)}){t(', cap of ')}{fJ(m.plafond)}{t(' a year (')}{fJ(m.parPlafond)}{t(' still possible in ')}{d.year}{t('), balance of the account (')}{fJ(m.solde)}{t('). CP placed cannot be cashed in (art. L3151-3).')}
      </p>
      <p className="text-muted fine">
        {t('HR approves or refuses the request; once approved, the days are deducted from the account and paid with the month’s salary (item CET_MON, amount calculated by payroll).')}
        {m.accord ? `${t(' Agreement: ')}${m.accord}.` : ''}
      </p>
    </Dialog>
  );
}
