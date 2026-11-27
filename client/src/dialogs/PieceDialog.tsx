// Joindre une pièce justificative à un objet déjà enregistré (`piece.joindre`) : justificatif d'une absence signalée,
// envoyé ensuite par l'intéressé ; attestation d'une certification ou titre signé d'une habilitation (service RH, référent
// HSE). Les pièces déjà jointes sont listées au-dessus, à ouvrir ou retirer (components/PieceJointe.tsx).
import { useState } from 'react';
import { OBJETS_PIECE } from '../../../shared/rules/pieces.ts';
import type { ObjetPiece } from '../../../shared/types.ts';
import { ChoixPiece, PiecesJointes, usePieceJointe } from '../components/PieceJointe.tsx';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function PieceDialog({ objet, objetId, empId, libelle }: { objet: ObjetPiece; objetId: number; empId: number; libelle?: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const piece = usePieceJointe();
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  const sante = OBJETS_PIECE[objet].sante;
  const manque = !piece.fichier ? t('Choose the file to attach.') : null;

  const confirm = async () => {
    if (busy || !v.verifier(manque, piece.erreur)) return;
    setBusy(true);
    const jetons = await piece.envoyer();
    const r = jetons ? await run('piece.joindre', { jetons, objet, objetId }) : null;
    setBusy(false);
    if (r?.ok) closeDialog();
  };

  return (
    <Dialog title={OBJETS_PIECE[objet].label} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Attach the document')}</SubmitButton>
    </>}>
      <Field label={t('Employee')}><Static>{emp?.nom ?? '—'}{libelle ? ` · ${libelle}` : ''}</Static></Field>
      <PiecesJointes objet={objet} objetId={objetId} label={t('Already attached')} />
      {piece.actif
        ? <ChoixPiece piece={piece} id="piece-fichier" label={t('File')} requis erreur={v.erreur(manque)} />
        : <Fine>{t('Supporting documents disabled: the HR administrator enables them in Settings → Supporting documents.')}</Fine>}
      <Fine>
        {sante
          ? t('The document is visible only to the employee and HR, never to their manager or Keystone.')
          : t('The document is visible to HR, the HSE / training officer, the employee and their manager.')}
      </Fine>
    </Dialog>
  );
}
