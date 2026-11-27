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
import { t } from '../i18n/langue.ts';

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
  const manque = !piece.fichier ? t('Choose the file to attach.') : null;
  const natureErr = !nature ? t('Choose the nature of the document.') : null;

  const confirm = async () => {
    if (busy || !v.verifier(natureErr, manque, piece.erreur)) return;
    setBusy(true);
    const jetons = await piece.envoyer();
    const r = jetons ? await run('piece.joindre', { jetons, objet: 'dossierOpco', objetId: dossier.id, nature }) : null;
    setBusy(false);
    if (r?.ok) closeDialog();
  };

  return (
    <Dialog title={t('Document of the OPCO file')} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Attach the document')}</SubmitButton>
    </>}>
      <Field label={t('File#opco')}><Static>{nomDossierOpco(d, dossier)}</Static></Field>
      <PiecesJointes objet="dossierOpco" objetId={dossier.id} label={t('Already attached')} />
      {piece.actif ? <>
        <Field label={t('Nature')} htmlFor="opco-piece-nature" requis erreur={v.erreur(natureErr)}>
          <select className="input" id="opco-piece-nature" value={nature} onChange={e => setNature(e.target.value as NaturePiece)}>
            <option value="">{t('Choose…')}</option>
            {(Object.keys(NATURES_PIECE_OPCO) as NaturePiece[]).map(n => <option key={n} value={n}>{NATURES_PIECE_OPCO[n]}</option>)}
          </select>
        </Field>
        <ChoixPiece piece={piece} id="opco-piece-fichier" label={t('File#upload')} requis erreur={v.erreur(manque)} />
      </> : <Fine>{t('Supporting documents disabled: the HR administrator enables them in Settings → Supporting documents.')}</Fine>}
      <Fine>
        {t('Document of the company, without an employee: visible to HR only. The invoice and the approval are kept 10 years after the end of the financial year (accounting documents); before, only the HR administrator can remove them. The log keeps its nature, never the name of the file.')}
      </Fine>
    </Dialog>
  );
}
