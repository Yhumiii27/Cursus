// lot 11 — dossiers OPCO : pièce jointe à un dossier (`piece.joindre`, objet `dossierOpco`), avec sa nature (convention,
// accord, facture…). Pièce non nominative, visible du seul service RH ; la facture et l'accord sont gardés 10 ans après
// la fin de l'exercice (pièces comptables, shared/rules/opco.ts). Les pièces déjà jointes sont listées au-dessus.
import { useState } from 'react';
import { NATURES_PIECE_OPCO, piecesAttendues, piecesManquantes, versementsDe } from '../../../shared/rules/opco.ts';
import { piecesDe } from '../../../shared/rules/pieces.ts';
import type { NaturePiece } from '../../../shared/types.ts';
import { ChoixPiece, PiecesJointes, usePieceJointe } from '../components/PieceJointe.tsx';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { nomDossierOpco } from '../components/opco/commun.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function OpcoPieceDialog({ id, nature: proposee }: { id: number; nature?: NaturePiece | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const piece = usePieceJointe();
  const dossier = (d.ds.dossiersOpco ?? []).find(x => x.id === id) ?? null;
  // Nature proposée : celle demandée, sinon la première pièce requise qui manque.
  const [nature, setNature] = useState<NaturePiece | ''>(() => {
    if (proposee) return proposee;
    if (!dossier) return '';
    const natures = piecesDe(d.ds.pieces, 'dossierOpco', dossier.id).map(p => p.nature);
    return piecesManquantes(piecesAttendues(dossier, versementsDe(d.ds.versementsOpco, dossier.id).length), natures)[0] ?? '';
  });
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!dossier) return null;
  const manque = !piece.fichier ? 'Choisissez le fichier à joindre.' : null;
  const natureErr = !nature ? 'Choisissez la nature de la pièce.' : null;

  const confirm = async () => {
    if (busy || !v.verifier(natureErr, manque, piece.erreur)) return;
    setBusy(true);
    const jetons = await piece.envoyer();
    const r = jetons ? await run('piece.joindre', { jetons, objet: 'dossierOpco', objetId: dossier.id, nature }) : null;
    setBusy(false);
    if (r?.ok) closeDialog();
  };

  return (
    <Dialog title="Pièce du dossier OPCO" width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Joindre la pièce</SubmitButton>
    </>}>
      <Field label="Dossier"><Static>{nomDossierOpco(d, dossier)}</Static></Field>
      <PiecesJointes objet="dossierOpco" objetId={dossier.id} label="Déjà jointes" />
      {piece.actif ? <>
        <Field label="Nature" htmlFor="opco-piece-nature" requis erreur={v.erreur(natureErr)}>
          <select className="input" id="opco-piece-nature" value={nature} onChange={e => setNature(e.target.value as NaturePiece)}>
            <option value="">Choisir…</option>
            {(Object.keys(NATURES_PIECE_OPCO) as NaturePiece[]).map(n => <option key={n} value={n}>{NATURES_PIECE_OPCO[n]}</option>)}
          </select>
        </Field>
        <ChoixPiece piece={piece} id="opco-piece-fichier" label="Fichier" requis erreur={v.erreur(manque)} />
      </> : <Fine>Pièces justificatives désactivées : l’administrateur RH les active dans Paramètres → Pièces justificatives.</Fine>}
      <Fine>
        Pièce de l’entreprise, sans salarié : visible du seul service RH. La facture et l’accord sont gardés 10 ans après la fin de
        l’exercice (pièces comptables) ; avant, seul l’administrateur RH peut les retirer. Le journal garde sa nature, jamais le nom du fichier.
      </Fine>
    </Dialog>
  );
}
