// Formalités de détachement d'un déplacement, accomplies par le service RH : certificat de sécurité sociale
// (A1, convention bilatérale ou maintien au régime français) et, pour une mission de plus de 4 semaines,
// information écrite remise au salarié. Elles comptent dans le dossier voyage et dans le Go / No Go.
import { useState } from 'react';
import { MISSION_LONGUE_JOURS, SECU_RULES, secuDe } from '../../../shared/constants.ts';
import { days, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, fmtShort } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function DetachementDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const vo = d.ds.voyages.find(x => x.id === id);
  const [certificat, setCertificat] = useState(vo?.detachementLe ?? '');
  const [information, setInformation] = useState(vo?.informationLe ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = vo ? d.emp(vo.empId) : undefined, dest = vo ? d.destOf(vo.dest) : undefined;
  if (!vo || !emp || !dest) return null;

  const secu = SECU_RULES[secuDe(dest)];
  const duree = days(parse(vo.depart), parse(vo.retour)) + 1;
  // L'information écrite n'est due qu'au-delà de 4 semaines ; une saisie antérieure reste modifiable.
  const longue = duree > MISSION_LONGUE_JOURS || !!vo.informationLe;
  // Dates facultatives (vide : saisie effacée) : une date incorrecte est signalée dès la saisie.
  const erreur = (x: string) => !x ? null : !isValidDate(x) ? t('Invalid date.') : x > d.ti ? t('Today at the latest.') : null;
  const certErr = erreur(certificat), infoErr = longue ? erreur(information) : null;
  const inchange = certificat === (vo.detachementLe ?? '') && (!longue || information === (vo.informationLe ?? ''));

  const confirm = async () => {
    if (busy || !v.verifier(certErr, infoErr)) return;
    // Rien de changé : rien à enregistrer.
    if (inchange) { closeDialog(); return; }
    setBusy(true);
    const r = await run('voyage.detachement', { id, detachementLe: certificat, ...(longue ? { informationLe: information } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Posting formalities')} width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label={t('Trip')}><Static>{dest.pays} · {fmtShort(parse(vo.depart))} → {fmt(parse(vo.retour))}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{secu.label} — {secu.portee.toLowerCase()}{t(': ')}{secu.demarche}{t(', before the departure.')}</div>
      <Field label={`${secu.label}${t(' obtained on')}`} htmlFor="dt-secu" erreur={certErr}>
        <input className="input" id="dt-secu" type="date" max={d.ti} value={certificat} onChange={ev => setCertificat(ev.target.value)} style={{ maxWidth: 200 }} />
      </Field>
      {longue && (
        <Field label={`${t('Written information handed over on (assignment of ')}${duree}${t(' days)')}`} htmlFor="dt-info" erreur={infoErr}>
          <input className="input" id="dt-info" type="date" max={d.ti} value={information} onChange={ev => setInformation(ev.target.value)} style={{ maxWidth: 200 }} />
        </Field>
      )}
      <Fine>
        {longue ? t('Beyond 4 consecutive weeks abroad, the employee receives before their departure a written document: country, duration, currency of the pay, benefits, repatriation conditions. ') : ''}
        {t('Formalities not done at the departure: the resource is “No Go” for Keystone (reason DETACHEMENT). An erased date cancels the entry.')}
      </Fine>
    </Dialog>
  );
}
