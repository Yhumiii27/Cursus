// Confirmation d'un refus ou d'une action irréversible (state/confirmations.ts) : la question, ses conséquences,
// le motif d'un refus (obligatoire ; son aide nomme ceux qui le liront) et le bouton qui exécute l'action. Le
// dialogue reste ouvert si le serveur refuse (écran en retard, droits) : le message s'affiche et le motif saisi
// est gardé.
import { useId, useState } from 'react';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { erreurMotif, MOTIF_MAX, parametres, type Confirmation } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';

export function ConfirmerDialog({ c }: { c: Confirmation }) {
  const { run, closeDialog, openDialog, setUi, horsLigne, notify } = useStore();
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const questionId = useId();
  const erreur = erreurMotif(c, motif);

  const confirmer = async () => {
    if (busy || !v.verifier(erreur)) return;
    setBusy(true);
    // lot 11 — pwa : action faite sur l'appareil seulement (saisie gardée hors ligne abandonnée), sans le serveur.
    const r: { ok: boolean; result?: unknown } = c.action ? await run(c.action, parametres(c, motif))
      : c.local === 'abandonSaisie' ? await horsLigne.abandonner(String(c.payload.id)).then(() => ({ ok: true }), () => { notify('Saisie impossible à retirer de cet appareil : réessayez', true); return { ok: false }; })
      : { ok: false };
    setBusy(false);
    if (!r.ok) return;
    const mdp = (r.result as { motDePasse?: string | null } | undefined)?.motDePasse;
    if (c.ensuite?.motDePasse && mdp) openDialog({ type: 'motDePasseProvisoire', ...c.ensuite.motDePasse, motDePasse: mdp });
    else if (c.ensuite?.retour) openDialog(c.ensuite.retour);
    else closeDialog();
    if (c.ensuite?.ui) setUi(c.ensuite.ui);
  };

  return (
    <Dialog title={c.titre} width={520} decrit={questionId} onSubmit={confirmer} actions={<>
      {c.ensuite?.retour
        ? <button type="button" className="btn btn-secondary" onClick={() => openDialog(c.ensuite!.retour!)}>Retour</button>
        : <CancelButton />}
      <SubmitButton busy={busy}>{c.bouton}</SubmitButton>
    </>}>
      <p id={questionId} style={{ margin: 0, fontSize: 14 }}>{c.question}</p>
      {c.suites?.map(s => <Fine key={s} muted={false}>{s}</Fine>)}
      {c.motif && <>
        <Field label={c.motif.label} htmlFor="cf-motif" requis={c.motif.requis} erreur={v.erreur(erreur)}>
          <textarea className="input mid" id="cf-motif" rows={3} maxLength={MOTIF_MAX} placeholder={c.motif.placeholder}
            value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>{c.motif.aide}</Fine>
      </>}
    </Dialog>
  );
}
