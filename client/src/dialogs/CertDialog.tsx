// Ajouter une certification au dossier d'un collaborateur, ou corriger une certification saisie par erreur (`certId` :
// mauvaise date ou mauvaise formation, motif obligatoire ; shared/rules/corrections.ts). Une correction qui ferait tomber
// le prérequis d'une habilitation délivrée est refusée, comme par le serveur : la suspendre d'abord.
import { useState } from 'react';
import { addMonths, isValidDate, parse } from '../../../shared/dates.ts';
import { fmt, validiteLabel } from '../../../shared/format.ts';
import { certsApres, habilitationsAppuyees, MOTIF_CORRECTION_MAX, refusAppui } from '../../../shared/rules/corrections.ts';
import { erreurDate } from '../components/controles.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixPiece, PiecesJointes, usePieceJointe } from '../components/PieceJointe.tsx';
import { Fine } from '../components/ui.tsx';
import { aideMotifCorrection } from '../state/confirmations-corrections.ts';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

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
  // Attestation de formation jointe à l'ajout (pièce justificative, components/PieceJointe.tsx).
  const piece = usePieceJointe();
  if (!emp || (certId != null && !actuelle)) return null;
  // Correction : la formation actuelle reste proposée, même archivée ou hors du filtre « réglementaires uniquement ».
  const choix = actuelle && !forms.some(o => o.id === actuelle.f) ? [d.fm(actuelle.f), ...forms] : forms;
  const fm = d.fm(f);
  const valid = isValidDate(date);
  const fErr = !fm ? t(forms.length ? 'Choose the training course.' : 'Training catalogue empty: add them in the Reference data screen.') : null;
  const dateErr = erreurDate(date, t('Enter the date obtained.')) ?? (actuelle && date > d.ti ? t('The date obtained cannot be later than today.') : null);
  const motifErr = actuelle && !motif.trim() ? t('Enter the reason for the correction.') : null;
  const inchange = !!actuelle && f === actuelle.f && date === actuelle.obtenue;
  // Habilitation délivrée qui s'appuie sur la certification : correction refusée tant qu'elle n'est pas suspendue.
  const appui = actuelle && fm && valid && !inchange ? refusAppui(habilitationsAppuyees(d, emp, certsApres(emp.certs, actuelle.id, { f, obtenue: date })), 'modifier') : null;

  const confirm = async () => {
    if (busy || !v.verifier(fErr, dateErr, motifErr, appui, !actuelle && piece.erreur)) return;
    if (inchange) { closeDialog(); return; }
    setBusy(true);
    const pieces = actuelle ? [] : await piece.envoyer();
    if (!pieces) { setBusy(false); return; }
    const r = actuelle
      ? await run('cert.modifier', { id: actuelle.id, f, date, motif: motif.trim() })
      : await run('cert.ajouter', { empId, f, date, ...(pieces.length ? { pieces } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t(actuelle ? 'Correct the certification' : 'Add a certification')} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(actuelle ? 'Save the correction' : 'Add')}</SubmitButton>
    </>}>
      <Field label={t('Employee')}><Static>{emp.nom}</Static></Field>
      <Field label={t('Training course')} htmlFor="cert-f" requis erreur={v.erreur(fErr)}>
        <select className="input" id="cert-f" value={f} onChange={e => setF(e.target.value)}>
          {choix.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label={t('Date obtained')} htmlFor="cert-date" requis erreur={v.erreur(dateErr)}><input className="input" id="cert-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label={t('Validity')}><Static pad>{fm ? `${validiteLabel(fm.validite)}${valid ? t(' · expires on ') + fmt(addMonths(parse(date), fm.validite)) : ''}` : '—'}</Static></Field>
      </div>
      {!actuelle && <ChoixPiece piece={piece} id="cert-piece" label={t('Training certificate (optional)')} />}
      {actuelle && <>
        <PiecesJointes objet="certification" objetId={actuelle.id} label={t('Attached certificates')} />
        <Field label={t('Reason for the correction')} htmlFor="cert-motif" requis erreur={v.erreur(motifErr)}>
          <textarea className="input mid" id="cert-motif" rows={2} maxLength={MOTIF_CORRECTION_MAX} placeholder={t('Certificate date copied wrongly, training course confused…')}
            value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        {appui && <Bloquant>{appui}</Bloquant>}
        <Fine>
          {t('Entry of ')}{fmt(parse(actuelle.obtenue))}{t(' for ')}{d.fm(actuelle.f)?.court ?? actuelle.f}{t('. The correction is dated and signed. ')}{aideMotifCorrection()}
          {f !== actuelle.f && actuelle.sessionId ? t(' The new training course frees its place at the planned session, notice cancelled by e-mail.') : ''}
        </Fine>
      </>}
    </Dialog>
  );
}
