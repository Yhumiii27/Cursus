// Demande de visite médicale (service RH) : motif, puis demande envoyée par e-mail au service de prévention et de santé
// au travail (adresse de Paramètres → Messagerie), ou imprimée pour lui. La demande reste en cours jusqu'à la saisie de
// l'avis du médecin du travail, ou son annulation.
import { useState } from 'react';
import { MOTIFS_VISITE } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { motifParDefaut } from '../../../shared/rules/sante.ts';
import type { MotifVisite } from '../../../shared/types.ts';
import { imprimerDemandeVisite } from '../components/Aptitude.tsx';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { annulationVisite } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** `motif` : celui de la visite due d'où vient la demande (échéance) ; sinon celui de la visite due la plus proche. */
export function VisiteDialog({ empId, motif: propose }: { empId: number; motif?: MotifVisite }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, openDialog, notify } = useStore();
  const emp = emps.find(e => e.id === empId);
  const [motif, setMotif] = useState<MotifVisite>(() => propose ?? (emp ? motifParDefaut(emp, emp.med.dues) : 'periodique'));
  const [busy, setBusy] = useState(false);
  if (!emp || !rh) return null;
  const demande = emp.med.demande;
  // Adresse du service de santé au travail : la demande lui part par e-mail à son enregistrement.
  const sante = d.ds.messagerie?.santeTravail ?? null;

  const imprimer = () => {
    if (demande && !imprimerDemandeVisite(d, emp, demande)) notify(t('Allow pop-up windows to print the request'), true);
  };
  const enregistrer = async () => {
    if (busy) return;
    setBusy(true);
    await run('medical.demander', { empId, motif });
    setBusy(false);
    // Une fois enregistrée, la demande s'affiche ici même, prête à imprimer.
  };
  const annuler = () => { if (demande) openDialog({ type: 'confirmer', c: annulationVisite(demande, emp.nom, fmtIso(demande.le)) }); };

  // Demande en cours (ou tout juste enregistrée) : impression, annulation.
  if (demande) {
    return (
      <Dialog title={t('Medical visit request')} width={560} actions={<>
        <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={annuler}>{t('Cancel the request')}</button>
        <CancelButton label={t('Close')} />
        <button type="button" className="btn btn-primary" onClick={imprimer}>{t('Print the request')}</button>
      </>}>
        <div className="grid-2">
          <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
          <Field label={t('Requested on#label')}><Static>{fmtIso(demande.le)} · {demande.par}</Static></Field>
        </div>
        <Field label={t('Reason')}><Static>{MOTIFS_VISITE[demande.motif].label}</Static></Field>
        <div className="boxed text-muted sub">{emp.med.text}</div>
        <Fine>
          {sante
            ? `${t('Sent by e-mail to the occupational health and prevention service (')}${sante}${t(') when recorded: follow-up in Settings → Sendings. ')}`
            : t('Pass the printed request (or saved as PDF) to the occupational health and prevention service. ')}
          {t('It contains no medical information and stays open until the occupational physician’s opinion is recorded on the sheet.')}
        </Fine>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('Request a medical visit')} width={560} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save the request')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label={t('Medical fitness')}><Static>{t(emp.med.ok ? 'Valid#fem' : 'Not valid#fem')}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{emp.med.text}</div>
      {/* Visites dues à un événement : le motif proposé est celui de l'échéance d'où vient la demande, ou la plus proche. */}
      {!!emp.med.dues?.length && (
        <Field label={t('Visits due')}>
          <ul className="rules">
            {emp.med.dues.map(x => <li key={x.motif}>{x.label} — {t(x.le < d.ti ? 'overdue since' : 'at the latest on')} {fmtIso(x.le)}{t(': ')}{x.detail}</li>)}
          </ul>
        </Field>
      )}
      <Field label={t('Reason for the visit')}>
        <div role="radiogroup" aria-label={t('Reason for the visit')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(Object.keys(MOTIFS_VISITE) as MotifVisite[]).map(k => (
            <label key={k} className={`radio radio-opt${motif === k ? ' checked' : ''}`}>
              <input type="radio" name="vi-motif" checked={motif === k} onChange={() => setMotif(k)} />
              <span className="dot" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14 }}>{MOTIFS_VISITE[k].label}</div>
                <div className="text-muted sub">{MOTIFS_VISITE[k].article}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>
      <Fine>
        {sante
          ? `${t('The request is recorded and sent by e-mail to the occupational health and prevention service (')}${sante}).`
          : t('The request is recorded, then printed for the occupational health and prevention service (no address in Settings → Messaging).')}
        {' '}{t('The manager is not informed of it.')}
      </Fine>
    </Dialog>
  );
}
