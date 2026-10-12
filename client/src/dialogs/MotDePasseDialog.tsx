// Changement volontaire du mot de passe d'un compte Cursus (bouton de la barre latérale).
import { CancelButton, Dialog, SubmitButton } from '../components/Dialog.tsx';
import { useMotDePasse } from '../pages/MotDePasse.tsx';
import { useStore } from '../state/store.tsx';

export function MotDePasseDialog() {
  const { closeDialog, notify } = useStore();
  const f = useMotDePasse(() => { closeDialog(); notify('Mot de passe changé'); });
  return (
    <Dialog title="Changer mon mot de passe" width={440} onSubmit={() => f.submit()} actions={<>
      <CancelButton />
      <SubmitButton busy={f.busy}>Enregistrer</SubmitButton>
    </>}>
      {f.fields}
    </Dialog>
  );
}
