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
  const err = montant.trim() && (n === null || n < 0 || n > l.montantEur) ? `Montant de 0 à ${euros(l.montantEur)}.` : null;

  const envoyer = async () => {
    if (busy || !v.verifier(err)) return;
    setBusy(true);
    const r = await run('frais.ligne.plafonner', { id: l.id, montant: montant.trim() ? n : '' });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Montant retenu" width={480} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <Field label="Dépense"><Static>{`${l.date} · ${CATEGORIES_FRAIS[l.categorie].label} · ${euros(l.montantEur)} demandés`}</Static></Field>
      <Field label="Montant retenu (€), vide : le montant demandé" htmlFor="frais-plafond" erreur={v.erreur(err) || err}>
        <input className="input tnum" id="frais-plafond" inputMode="decimal" value={montant} onChange={ev => setMontant(ev.target.value)} autoFocus />
      </Field>
      <Fine>{plafond !== null ? `Plafond de la politique pour cette catégorie : ${euros(plafond)}.` : 'Aucun plafond réglé pour cette catégorie.'} Seul le montant retenu est remboursé.</Fine>
    </Dialog>
  );
}
