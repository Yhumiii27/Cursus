// Ajouter une certification au dossier d'un collaborateur, ou corriger une certification saisie par erreur (`certId` :
// mauvaise date ou mauvaise formation, motif obligatoire ; shared/rules/corrections.ts). Une correction qui ferait tomber
// le prérequis d'une habilitation délivrée est refusée, comme par le serveur : la suspendre d'abord.
import { useState } from 'react';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { certsApres, habilitationsAppuyees, MOTIF_CORRECTION_MAX, refusAppui } from '../../../shared/rules/corrections.ts';
import { erreurDate } from '../components/controles.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function CertDialog({ empId, certId }: { empId: number; certId?: number }) {
  const { d, forms } = useEnriched();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const actuelle = certId != null ? emp?.certs.find(c => c.id === certId) : undefined;
  const [f, setF] = useState(actuelle?.f ?? forms[0]?.id ?? '');
  const [date, setDate] = useState(actuelle?.obtenue ?? '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || (certId != null && !actuelle)) return null;
  // Correction : la formation actuelle reste proposée, même archivée ou hors du filtre « réglementaires uniquement ».
  const choix = actuelle && !forms.some(o => o.id === actuelle.f) ? [d.fm(actuelle.f), ...forms] : forms;
  const fm = d.fm(f);
  const valid = isValidDate(date);
  const fErr = !fm ? (forms.length ? 'Choisissez la formation.' : 'Catalogue des formations vide : ajoutez-les dans l’écran Référentiels.') : null;
  const dateErr = erreurDate(date, 'Indiquez la date d’obtention.') ?? (actuelle && date > d.ti ? 'La date d’obtention ne peut pas être postérieure à aujourd’hui.' : null);
  const motifErr = actuelle && !motif.trim() ? 'Indiquez le motif de la correction.' : null;
  const inchange = !!actuelle && f === actuelle.f && date === actuelle.obtenue;
  // Habilitation délivrée qui s'appuie sur la certification : correction refusée tant qu'elle n'est pas suspendue.
  const appui = actuelle && fm && valid && !inchange ? refusAppui(habilitationsAppuyees(d, emp, certsApres(emp.certs, actuelle.id, { f, obtenue: date })), 'modifier') : null;

  const confirm = async () => {
    if (busy || !v.verifier(fErr, dateErr, motifErr, appui)) return;
    if (inchange) { closeDialog(); return; }
    setBusy(true);
    const r = actuelle
      ? await run('cert.modifier', { id: actuelle.id, f, date, motif: motif.trim() })
      : await run('cert.ajouter', { empId, f, date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={actuelle ? 'Corriger la certification' : 'Ajouter une certification'} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{actuelle ? 'Enregistrer la correction' : 'Ajouter'}</SubmitButton>
    </>}>
      <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
      <Field label="Formation" htmlFor="cert-f" requis erreur={v.erreur(fErr)}>
        <select className="input" id="cert-f" value={f} onChange={e => setF(e.target.value)}>
          {choix.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Date d’obtention" htmlFor="cert-date" requis erreur={v.erreur(dateErr)}><input className="input" id="cert-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Validité"><Static pad>{fm ? `${validiteLabel(fm.validite)}${valid ? ' · expire le ' + fmt(addMonths(parse(date), fm.validite)) : ''}` : '—'}</Static></Field>
      </div>
      {actuelle && <>
        <Field label="Motif de la correction" htmlFor="cert-motif" requis erreur={v.erreur(motifErr)}>
          <textarea className="input mid" id="cert-motif" rows={2} maxLength={MOTIF_CORRECTION_MAX} placeholder="Date de l’attestation mal recopiée, formation confondue…"
            value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        {appui && <Bloquant>{appui}</Bloquant>}
        <Fine>
          Saisie du {fmt(parse(actuelle.obtenue))} pour {d.fm(actuelle.f)?.court ?? actuelle.f}. La correction est datée et signée ; le motif reste au service RH
          (jamais montré au manager ni au salarié, jamais recopié au journal). N’y indiquez aucune information médicale.
          {f !== actuelle.f && actuelle.sessionId ?' La nouvelle formation libère sa place à la session prévue, convocation annulée par e-mail.' : ''}
        </Fine>
      </>}
    </Dialog>
  );
}
