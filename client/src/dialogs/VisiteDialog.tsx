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

export function VisiteDialog({ empId }: { empId: number }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, openDialog, notify } = useStore();
  const emp = emps.find(e => e.id === empId);
  const [motif, setMotif] = useState<MotifVisite>(() => emp ? motifParDefaut(emp) : 'periodique');
  const [busy, setBusy] = useState(false);
  if (!emp || !rh) return null;
  const demande = emp.med.demande;
  // Adresse du service de santé au travail : la demande lui part par e-mail à son enregistrement.
  const sante = d.ds.messagerie?.santeTravail ?? null;

  const imprimer = () => {
    if (demande && !imprimerDemandeVisite(d, emp, demande)) notify('Autorisez les fenêtres surgissantes pour imprimer la demande', true);
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
      <Dialog title="Demande de visite médicale" width={560} actions={<>
        <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={annuler}>Annuler la demande</button>
        <CancelButton label="Fermer" />
        <button type="button" className="btn btn-primary" onClick={imprimer}>Imprimer la demande</button>
      </>}>
        <div className="grid-2">
          <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
          <Field label="Demandée le"><Static>{fmtIso(demande.le)} · {demande.par}</Static></Field>
        </div>
        <Field label="Motif"><Static>{MOTIFS_VISITE[demande.motif].label}</Static></Field>
        <div className="boxed text-muted sub">{emp.med.text}</div>
        <Fine>
          {sante
            ? `Envoyée par e-mail au service de prévention et de santé au travail (${sante}) à son enregistrement : suivi dans Paramètres → Envois. `
            : 'Transmettez la demande imprimée (ou enregistrée en PDF) au service de prévention et de santé au travail. '}
          Elle ne contient aucune information médicale et reste en cours jusqu’à l’enregistrement de l’avis du médecin du travail sur la fiche.
        </Fine>
      </Dialog>
    );
  }

  return (
    <Dialog title="Demander une visite médicale" width={560} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer la demande</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label="Aptitude médicale"><Static>{emp.med.ok ? 'Valide' : 'Non valide'}</Static></Field>
      </div>
      <div className="boxed text-muted sub">{emp.med.text}</div>
      <Field label="Motif de la visite">
        <div role="radiogroup" aria-label="Motif de la visite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
          ? `La demande est enregistrée et envoyée par e-mail au service de prévention et de santé au travail (${sante}).`
          : 'La demande est enregistrée, puis imprimée pour le service de prévention et de santé au travail (aucune adresse dans Paramètres → Messagerie).'}
        {' '}Le manager n’en est pas informé.
      </Fine>
    </Dialog>
  );
}
