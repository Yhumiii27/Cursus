// Changement volontaire du mot de passe d'un compte Cursus (bouton de la barre latérale).
import { CancelButton, Dialog, SubmitButton } from '../components/Dialog.tsx';
import { t } from '../i18n/langue.ts';
import { useMotDePasse } from '../pages/MotDePasse.tsx';
import { useStore } from '../state/store.tsx';

export function MotDePasseDialog() {
  const { closeDialog, notify } = useStore();
  const f = useMotDePasse(() => { closeDialog(); notify(t('Password changed')); });
  return (
    <Dialog title={t('Change my password')} width={440} onSubmit={() => f.submit()} actions={<>
      <CancelButton />
      <SubmitButton busy={f.busy}>{t('Save')}</SubmitButton>
    </>}>
      {f.fields}
    </Dialog>
  );
}
