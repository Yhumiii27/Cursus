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

export function PieceDialog({ objet, objetId, empId, libelle }: { objet: ObjetPiece; objetId: number; empId: number; libelle?: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const piece = usePieceJointe();
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = d.emp(empId);
  const sante = OBJETS_PIECE[objet].sante;
  const manque = !piece.fichier ? 'Choisissez le fichier à joindre.' : null;

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
      <SubmitButton busy={busy}>Joindre la pièce</SubmitButton>
    </>}>
      <Field label="Collaborateur"><Static>{emp?.nom ?? '—'}{libelle ? ` · ${libelle}` : ''}</Static></Field>
      <PiecesJointes objet={objet} objetId={objetId} label="Déjà jointes" />
      {piece.actif
        ? <ChoixPiece piece={piece} id="piece-fichier" label="Fichier" requis erreur={v.erreur(manque)} />
        : <Fine>Pièces justificatives désactivées : l’administrateur RH les active dans Paramètres → Pièces justificatives.</Fine>}
      <Fine>
        {sante
          ? 'Le document n’est visible que du salarié et du service RH, jamais de son manager ni de Keystone.'
          : 'Le document est visible du service RH, du référent HSE / formation, du salarié et de son manager.'}
      </Fine>
    </Dialog>
  );
}
