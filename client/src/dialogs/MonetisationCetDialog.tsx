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
    <Dialog title={`Monétiser des jours du CET — ${emp.nom}`} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Demander la monétisation</SubmitButton>
    </>}>
      <Field label="Jours à monétiser" htmlFor="mon-j" requis erreur={v.erreur(joursErr)}>
        <input className="input" id="mon-j" type="number" min={0.5} step={0.5} max={m.possible} value={jours} onChange={ev => setJours(ev.target.value)} style={{ textAlign: 'right', maxWidth: 140 }} />
      </Field>
      <p className="text-muted fine">
        {fJ(m.possible)} monétisables aujourd’hui : jours venus des RTT{m.reprisMonetisable ? ' et du solde repris de l’ancien outil' : ''} ({fJ(m.parOrigine)}),
        plafond de {fJ(m.plafond)} par an ({fJ(m.parPlafond)} encore possibles en {d.year}), solde du compte ({fJ(m.solde)}).
        Les CP placés ne se monétisent pas (art. L3151-3).
      </p>
      <p className="text-muted fine">
        Le service RH valide ou refuse la demande ; validés, les jours sont déduits du compte et payés avec le salaire du mois (rubrique CET_MON, montant calculé par la paie).
        {m.accord ? ` Accord : ${m.accord}.` : ''}
      </p>
    </Dialog>
  );
}
