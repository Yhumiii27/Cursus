// Mot de passe provisoire d'un compte Cursus, affiché une seule fois après la création du compte
// ou sa réinitialisation : Cursus n'en garde que l'empreinte. Ni le fond ni Échap ne ferment le dialogue.
import { useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function MotDePasseProvisoireDialog({ nom, identifiant, motDePasse }: { nom: string; identifiant: string; motDePasse: string }) {
  const { closeDialog } = useStore();
  const [copie, setCopie] = useState<string | null>(null);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(motDePasse);
      setCopie(t('Copied to the clipboard.'));
    } catch {
      setCopie(t('Copy impossible from this browser: copy the password by hand.'));
    }
  };
  return (
    <Dialog centre title={t('Temporary password')} width={480} fermerParBouton actions={
      <button type="button" className="btn btn-primary" onClick={closeDialog}>{t('I have passed on the password')}</button>
    }>
      <p style={{ fontSize: 14, margin: 0 }}>{nom} · {t('login ')}<span className="mono-input">{identifiant}</span></p>
      <div className="boxed-lg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span className="mono-input tnum" style={{ fontSize: 18, letterSpacing: '0.04em', userSelect: 'all' }}>{motDePasse}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={copier}>{t('Copy')}</button>
      </div>
      {copie && <p className="text-muted fine">{copie}</p>}
      <p className="text-muted fine">
        {t('It will not be shown again. Give it to the person through a safe channel (in person, by phone), never through a message that keeps it. They will replace it with a personal password at their first sign-in.')}
      </p>
    </Dialog>
  );
}
