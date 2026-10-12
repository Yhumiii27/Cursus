// Mot de passe provisoire d'un compte Cursus, affiché une seule fois après la création du compte
// ou sa réinitialisation : Cursus n'en garde que l'empreinte. Ni le fond ni Échap ne ferment le dialogue.
import { useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import { useStore } from '../state/store.tsx';

export function MotDePasseProvisoireDialog({ nom, identifiant, motDePasse }: { nom: string; identifiant: string; motDePasse: string }) {
  const { closeDialog } = useStore();
  const [copie, setCopie] = useState<string | null>(null);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(motDePasse);
      setCopie('Copié dans le presse-papiers.');
    } catch {
      setCopie('Copie impossible depuis ce navigateur : recopiez le mot de passe.');
    }
  };
  return (
    <Dialog title="Mot de passe provisoire" width={480} fermerParBouton actions={
      <button type="button" className="btn btn-primary" onClick={closeDialog}>J’ai transmis le mot de passe</button>
    }>
      <p style={{ fontSize: 14, margin: 0 }}>{nom} · identifiant <span className="mono-input">{identifiant}</span></p>
      <div className="boxed-lg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span className="mono-input tnum" style={{ fontSize: 18, letterSpacing: '0.04em', userSelect: 'all' }}>{motDePasse}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={copier}>Copier</button>
      </div>
      {copie && <p className="text-muted fine">{copie}</p>}
      <p className="text-muted fine">
        Il ne sera plus affiché. Remettez-le à la personne par un canal sûr (en main propre, par téléphone), jamais par
        un message qui le garde. Elle le remplacera par un mot de passe personnel à sa première connexion.
      </p>
    </Dialog>
  );
}
