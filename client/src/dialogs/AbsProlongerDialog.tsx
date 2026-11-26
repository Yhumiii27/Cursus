// Prolonger un arrêt ou une absence hors congés : nouvelle fin, sans chevauchement d'une autre absence.
// Hors service RH, une absence qualifiée repasse « à qualifier » : le RH enregistre l'avis de prolongation.
import { useState } from 'react';
import { ABS_LABEL } from '../../../shared/constants.ts';
import { addD } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { periodeTexte } from '../../../shared/rules/absences.ts';
import { checkNature } from '../../../shared/rules/conges.ts';
import type { NatureAbsence } from '../../../shared/types.ts';
import { erreurDate } from '../components/controles.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function AbsProlongerDialog({ id }: { id: number }) {
  const d = useDomain();
  const { rh, soi } = useRole();
  const { run, closeDialog } = useStore();
  const a = d.ds.absences.find(x => x.id === id);
  const [au, setAu] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = a ? d.emp(a.empId) : undefined;
  if (!a || !emp) return null;

  const debut = addD(a.au, 1);
  // Durée légale contrôlée sur toute l'absence, prolongation comprise (`depuis`).
  const chk = au ? checkNature(d, emp, a.type as NatureAbsence | 'ABSENCE', debut, au, { exclure: a.id, quand: 'avant de prolonger l’absence', depuis: a.du }) : null;
  const auErr = erreurDate(au, t('Enter the new end of the absence.')) ?? (au < debut ? `${t('New end after the current end, from ')}${fmtIso(debut)}.` : null);
  const confirm = async () => {
    if (busy || !v.verifier(auErr, chk?.cant)) return;
    setBusy(true);
    const r = await run('absence.prolonger', { id, au });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Extend an absence')} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Extend')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom}</Static></Field>
        <Field label={t('Absence')}><Static>{ABS_LABEL[a.type]}</Static></Field>
      </div>
      <div className="boxed text-muted sub">
        {periodeTexte(a.du, a.au)}{a.finInitiale ? `${t(' · already extended, initial end on ')}${fmtIso(a.finInitiale)}` : ''}
      </div>
      <Field label={t('New end (inclusive)')} htmlFor="ap-au" requis erreur={v.erreur(auErr)}>
        <input className="input" id="ap-au" type="date" min={debut} value={au} onChange={ev => setAu(ev.target.value)} style={{ maxWidth: 200 }} />
      </Field>
      {chk && <Controles msgs={chk.msgs} />}
      <Fine>
        {/* Un membre du RH prolonge sa propre absence comme intéressé : elle repasse aussi « à qualifier ». */}
        {(rh && emp.id !== soi) || a.statut === 'signalee'
          ? t('Keystone receives the extension of the unavailability.')
          : t('The absence goes back to “to qualify”: HR records the extension notice. Keystone receives the extension of the unavailability.')}
      </Fine>
    </Dialog>
  );
}
