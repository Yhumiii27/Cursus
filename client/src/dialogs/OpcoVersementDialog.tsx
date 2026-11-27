// lot 11 — dossiers OPCO : versement de l'OPCO (acompte ou solde, `opco.versement`) sur un dossier accordé, aux
// justificatifs envoyés ou déjà remboursé : date, montant, destinataire (l'entreprise, ou l'organisme en subrogation,
// proposé d'après le dossier), référence du virement ou de l'avis de paiement. Le nombre de versements affichés part avec
// la demande : un double clic n'enregistre pas le versement deux fois. Le dossier passe « Remboursé ».
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { eurosOpco, montantOpco, montantsOpco, referenceValide, versementsDe } from '../../../shared/rules/opco.ts';
import type { DestinataireVersementOpco } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurDate } from '../components/controles.ts';
import { Fine, Seg } from '../components/ui.tsx';
import { nomDossierOpco } from '../components/opco/commun.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function OpcoVersementDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const dossier = (d.ds.dossiersOpco ?? []).find(x => x.id === id) ?? null;
  const m = dossier ? montantsOpco(dossier, d.ds.versementsOpco) : null;
  const [le, setLe] = useState(d.ti);
  // Proposé : ce qui reste attendu (de l'entreprise, ou de l'organisme en subrogation).
  const [montant, setMontant] = useState(() => {
    const reste = m ? (dossier?.subrogation ? m.attenduOrganisme : m.aRecuperer) : 0;
    return reste > 0 ? String(reste).replace('.', ',') : '';
  });
  const [destinataire, setDestinataire] = useState<DestinataireVersementOpco>(dossier?.subrogation ? 'organisme' : 'entreprise');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!dossier || !m) return null;
  const deja = versementsDe(d.ds.versementsOpco, dossier.id);

  const montantNum = montant.trim() ? montantOpco(montant) : null;
  const montantErr = !montant.trim() ? t('Enter the amount paid.#opco') : montantNum === null || montantNum === 0 ? t('Amount in euros, more than 0 and 1,000,000 at most.') : null;
  const dateErr = erreurDate(le, t('Enter the date of the payment.'))
    ?? (le > d.ti ? t('The date cannot be in the future.') : dossier.accordLe && le < dossier.accordLe ? `${t('The payment comes before the approval (')}${fmtIso(dossier.accordLe)}).` : null);
  const refErr = reference.trim() && !referenceValide(reference.trim()) ? t('Letters, digits, “.”, “/”, “_” or “-”, without a space, 40 characters at most.') : null;

  const envoyer = async () => {
    if (busy || !v.verifier(montantErr, dateErr, refErr)) return;
    setBusy(true);
    const r = await run('opco.versement', {
      id: dossier.id, le, montant: montant.trim().replace(/\s/g, '').replace(',', '.'), destinataire, reference: reference.trim(), versements: deja.length,
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Payment of the OPCO')} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save the payment')}</SubmitButton>
    </>}>
      <Field label={t('File#opco')}>
        <Static>{nomDossierOpco(d, dossier)}
          <div className="text-muted sub">
            {`${t('Expected ')}${eurosOpco(m.attendu)} · ${t('received ')}${eurosOpco(m.recuEntreprise + m.payeOrganisme)}`}
            {deja.length ? ` · ${tn(deja.length, 'payment already recorded', 'payments already recorded')}` : ''}
          </div>
        </Static>
      </Field>
      <div className="grid-2">
        <Field label={t('Paid on')} htmlFor="opco-v-le" requis erreur={v.erreur(dateErr) || (le ? dateErr : null)}>
          <input className="input" id="opco-v-le" type="date" min={dossier.accordLe ?? undefined} max={d.ti} value={le} onChange={e => setLe(e.target.value)} />
        </Field>
        <Field label={t('Amount (€)')} htmlFor="opco-v-montant" requis erreur={v.erreur(montantErr) || (montant.trim() ? montantErr : null)}>
          <input className="input tnum" id="opco-v-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} autoFocus />
        </Field>
      </div>
      <Field label={t('Paid to')}>
        <Seg name="opco-destinataire" label={t('Recipient of the payment')} value={destinataire} onChange={setDestinataire} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={[['entreprise', t('The company')], ['organisme', t('The provider (subrogation)')]]} />
      </Field>
      <Field label={t('Reference of the transfer or of the payment advice')} htmlFor="opco-v-ref" erreur={refErr}>
        <input className="input" id="opco-v-ref" value={reference} onChange={e => setReference(e.target.value)} autoComplete="off" />
      </Field>
      <Fine>
        {t('The file becomes “Reimbursed”; an advance does not prevent sending the supporting documents afterwards. A payment entered by mistake is cancelled with a reason, by the HR administrator.')}
      </Fine>
    </Dialog>
  );
}
