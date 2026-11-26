// lot 11 — notes de frais : dépense ramenée à un montant retenu au contrôle (`frais.ligne.plafonner`), plafond de la
// politique interne proposé ; vide : remise au montant demandé. Ce n'est pas une réintégration dans l'assiette des
// cotisations (shared/rules/frais-politique.ts).
import { useState } from 'react';
import { CATEGORIES_FRAIS } from '../../../shared/rules/frais.ts';
import { plafondInterne } from '../../../shared/rules/frais-politique.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { euros } from '../components/frais/commun.ts';
import { nombreSaisi } from '../components/frais/saisie.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function FraisPlafondDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const l = (d.ds.lignesFrais ?? []).find(x => x.id === id) ?? null;
  const plafond = l ? plafondInterne(d.ds.settings.fraisPlafonds, l) : null;
  const [montant, setMontant] = useState(() => String(l?.montantRetenu ?? plafond ?? '').replace('.', ','));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!l) return null;
  const n = nombreSaisi(montant);
  const err = montant.trim() && (n === null || n < 0 || n > l.montantEur) ? `${t('Amount from 0 to ')}${euros(l.montantEur)}.` : null;

  const envoyer = async () => {
    if (busy || !v.verifier(err)) return;
    setBusy(true);
    const r = await run('frais.ligne.plafonner', { id: l.id, montant: montant.trim() ? n : '' });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Amount retained')} width={480} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <Field label={t('Expense')}><Static>{`${l.date} · ${CATEGORIES_FRAIS[l.categorie].label} · ${euros(l.montantEur)}${t(' requested#plural')}`}</Static></Field>
      <Field label={t('Amount retained (€), empty: the amount requested')} htmlFor="frais-plafond" erreur={v.erreur(err) || err}>
        <input className="input tnum" id="frais-plafond" inputMode="decimal" value={montant} onChange={ev => setMontant(ev.target.value)} autoFocus />
      </Field>
      <Fine>{plafond !== null ? `${t('Cap of the policy for this category: ')}${euros(plafond)}.` : t('No cap set for this category.')}{t(' Only the amount retained is reimbursed.')}</Fine>
    </Dialog>
  );
}
