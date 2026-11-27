// « Modifier ma fiche » : un membre du service RH sur sa propre fiche (lot 8, chantier C). Seuls l'adresse e-mail et les
// jours non travaillés d'un temps partiel se modifient (SOI_MEME_FIELDS de shared/rules/profil.ts) ; le contrat, le temps
// de travail, l'équipe et le matricule de paie sont affichés en lecture seule et passent par un autre membre du service
// RH (refus du serveur, employe.modifier). Ouvert par EmployeDialog quand la fiche est la sienne (`fichePropre`).
import { useState } from 'react';
import { STATUTS, TYPES_CONTRAT } from '../../../shared/constants.ts';
import { equipeLabel, fmtIso } from '../../../shared/format.ts';
import { champsAEnvoyer } from '../../../shared/rules/fiche-concurrente.ts';
import { adressesPrises } from '../../../shared/rules/messagerie.ts';
import { JOURS_SEMAINE, normaliserProfil, profilOf, SOI_MEME_FIELDS, validerProfil } from '../../../shared/rules/profil.ts';
import { AIDE_SOI_MEME } from '../../../shared/rules/soi-meme.ts';
import type { Employe } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, SectionLabel } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Erreurs de `validerProfil` qui portent sur les champs de ce dialogue : adresse e-mail, jours non travaillés. */
const DU_DIALOGUE = /e-mail|^Au moins un jour travaillé|^Répartition impossible/;

export function FichePropreDialog({ emp }: { emp: Employe }) {
  const d = useDomain();
  const { run, closeDialog, notify } = useStore();
  const [initial] = useState(() => profilOf(emp));
  const [email, setEmail] = useState(initial.email ?? '');
  const [jourOff, setJourOff] = useState<number[]>(initial.jourOff);
  const [busy, setBusy] = useState(false);
  const verif = useVerification();
  const c = d.contratOf(emp);

  const v = validerProfil({ ...initial, email: email.trim() || null, jourOff }, { equipes: d.equipes, year: d.year, adressesPrises: adressesPrises(d.ds.employes, emp.id) });
  const errors = v.errors.filter(m => DU_DIALOGUE.test(m));
  const champs = champsAEnvoyer(normaliserProfil(initial), v.profil, SOI_MEME_FIELDS);

  const save = async () => {
    if (busy || !verif.verifier(errors.length > 0)) return;
    if (!champs.length) { closeDialog(); notify(t('No change to save')); return; }
    setBusy(true);
    const payload: Record<string, unknown> = { id: emp.id, avant: Object.fromEntries(champs.map(k => [k, initial[k] ?? null])) };
    for (const k of champs) payload[k] = v.profil[k];
    const r = await run('employe.modifier', payload);
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const toggle = (i: number, on: boolean) => setJourOff(j => (on ? [...j, i].sort() : j.filter(x => x !== i)));

  return (
    <Dialog title={`${t('Edit my sheet — ')}${emp.nom}`} width={640} tall onSubmit={save} actions={<><CancelButton /><SubmitButton busy={busy}>{t('Save')}</SubmitButton></>}>
      <Fine>{AIDE_SOI_MEME.fiche}</Fine>
      <Field label={t('Work e-mail address')} htmlFor="soi-email">
        <input className="input" id="soi-email" type="email" autoComplete="off" placeholder={t('firstname.lastname@company.com')} value={email} onChange={ev => setEmail(ev.target.value)} />
      </Field>
      {c.partiel && (
        <Field label={t('Days not worked')}>
          <div role="group" aria-label={t('Days not worked')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
            {JOURS_SEMAINE.map((j, i) => (
              <label key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={jourOff.includes(i)} onChange={ev => toggle(i, ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                {j}
              </label>
            ))}
          </div>
        </Field>
      )}
      {verif.tente && errors.map(m => <Bloquant key={m}>{m}</Bloquant>)}
      <SectionLabel>{t('Contract & working time')}</SectionLabel>
      <div className="grid-2">
        <Field label={t('Team')}><Static>{equipeLabel(emp)}</Static></Field>
        <Field label={t('Status')}><Static>{STATUTS[c.statut].label} <span className="text-muted">· {t(c.cadre ? 'executive' : 'non-executive')}</span></Static></Field>
        <Field label={t('Type of contract')}><Static>{TYPES_CONTRAT[c.typeContrat].label}{emp.fin ? `${t(' · until ')}${fmtIso(emp.fin)}` : ''}</Static></Field>
        <Field label={t('Working time arrangement')}><Static>{c.label}</Static></Field>
        <Field label={t('Payroll number')}><Static>{emp.matriculePaie ?? '—'}</Static></Field>
        <Field label={t('Start date')}><Static>{fmtIso(emp.entree)}</Static></Field>
      </div>
    </Dialog>
  );
}
