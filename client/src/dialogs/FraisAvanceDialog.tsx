// lot 11 — notes de frais : avance sur frais (`frais.avance.demander`) pour un déplacement ou une mission ; validée par le
// manager (ou le service RH), versée avec la paie, puis déduite des remboursements des notes du même séjour.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { nombreSaisi } from '../components/frais/saisie.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function FraisAvanceDialog({ empId }: { empId?: number | null }) {
  const d = useDomain();
  const { me } = useRole();
  const { run, closeDialog } = useStore();
  const qui = empId ?? me;
  const [montant, setMontant] = useState('');
  const [rattache, setRattache] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const voyages = d.ds.voyages.filter(x => x.empId === qui && !x.annuleLe && x.retour >= d.ti);
  const missions = d.ds.missions.filter(x => x.empId === qui && x.au >= d.ti);
  const n = nombreSaisi(montant);
  const errMontant = !montant.trim() ? t('Enter the amount of the advance.') : n === null || n <= 0 || n > 20000 ? t('Amount in euros, more than 0 and 20,000 at most.') : null;

  const envoyer = async () => {
    if (busy || !v.verifier(errMontant)) return;
    setBusy(true);
    const r = await run('frais.avance.demander', {
      empId: qui, montant: n, voyageId: rattache.startsWith('v') ? Number(rattache.slice(1)) : null, missionId: rattache.startsWith('m') ? Number(rattache.slice(1)) : null,
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Request an expense advance')} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Request the advance')}</SubmitButton>
    </>}>
      <Field label={t('Amount (€)')} htmlFor="frais-av-montant" requis erreur={v.erreur(errMontant) || (montant ? errMontant : null)}>
        <input className="input tnum" id="frais-av-montant" inputMode="decimal" value={montant} onChange={ev => setMontant(ev.target.value)} autoFocus />
      </Field>
      <Field label={t('Trip or assignment')} htmlFor="frais-av-rattache">
        <select className="input" id="frais-av-rattache" value={rattache} onChange={ev => setRattache(ev.target.value)}>
          <option value="">{t('None')}</option>
          {voyages.map(x => <option key={`v${x.id}`} value={`v${x.id}`}>{t('Trip: ')}{d.destOf(x.dest)?.pays ?? x.dest}, {fmtIso(x.depart)} → {fmtIso(x.retour)}</option>)}
          {missions.map(x => <option key={`m${x.id}`} value={`m${x.id}`}>{t('Assignment: ')}{x.projet} · {x.lieu}, {fmtIso(x.du)} → {fmtIso(x.au)}</option>)}
        </select>
      </Field>
      <Fine>{t('The advance is paid with the payroll once approved, then deducted from the reimbursements of the notes of the same trip or the same assignment.')}</Fine>
    </Dialog>
  );
}
