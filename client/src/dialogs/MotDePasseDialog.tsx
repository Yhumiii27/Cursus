// Changement volontaire du mot de passe d'un compte Cursus (bouton de la barre latérale).
import { CancelButton, Dialog } from '../components/Dialog.tsx';
import { useMotDePasse } from '../pages/MotDePasse.tsx';
import { useStore } from '../state/store.tsx';

export function MotDePasseDialog() {
  const { closeDialog, notify } = useStore();
  const f = useMotDePasse(() => { closeDialog(); notify('Mot de passe changé'); });
  return (
    <Dialog title="Changer mon mot de passe" width={440} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={!f.ok || f.busy} onClick={() => f.submit()}>Enregistrer</button>
    </>}>
      <form onSubmit={f.submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {f.fields}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
