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

export function DetachementDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const t = d.ds.voyages.find(v => v.id === id);
  const [certificat, setCertificat] = useState(t?.detachementLe ?? '');
  const [information, setInformation] = useState(t?.informationLe ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = t ? d.emp(t.empId) : undefined, dest = t ? d.destOf(t.dest) : undefined;
  if (!t || !emp || !dest) return null;

  const secu = SECU_RULES[secuDe(dest)];
  const duree = days(parse(t.depart), parse(t.retour)) + 1;
  // L'information écrite n'est due qu'au-delà de 4 semaines ; une saisie antérieure reste modifiable.
  const longue = duree > MISSION_LONGUE_JOURS || !!t.informationLe;
  // Dates facultatives (vide : saisie effacée) : une date incorrecte est signalée dès la saisie.
  const erreur = (x: string) => !x ? null : !isValidDate(x) ? 'Date invalide.' : x > d.ti ? 'Aujourd’hui au plus tard.' : null;
  const certErr = erreur(certificat), infoErr = longue ? erreur(information) : null;
  const inchange = certificat === (t.detachementLe ?? '') && (!longue || information === (t.informationLe ?? ''));

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
    <Dialog title="Formalités de détachement" width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label="Déplacement"><Static>{dest.pays} · {fmtShort(parse(t.depart))} → {fmt(parse(t.retour))}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{secu.label} — {secu.portee.toLowerCase()} : {secu.demarche}, avant le départ.</div>
      <Field label={`${secu.label} obtenu le`} htmlFor="dt-secu" erreur={certErr}>
        <input className="input" id="dt-secu" type="date" max={d.ti} value={certificat} onChange={ev => setCertificat(ev.target.value)} style={{ maxWidth: 200 }} />
      </Field>
      {longue && (
        <Field label={`Information écrite remise le (mission de ${duree} jours)`} htmlFor="dt-info" erreur={infoErr}>
          <input className="input" id="dt-info" type="date" max={d.ti} value={information} onChange={ev => setInformation(ev.target.value)} style={{ maxWidth: 200 }} />
        </Field>
      )}
      <Fine>
        {longue ? 'Au-delà de 4 semaines consécutives à l’étranger, le salarié reçoit avant son départ un document écrit : pays, durée, devise de la rémunération, avantages, conditions de rapatriement. ' : ''}
        Formalités non faites au départ : la ressource est « No Go » pour Keystone (motif DETACHEMENT). Une date effacée annule la saisie.
      </Fine>
    </Dialog>
  );
}
