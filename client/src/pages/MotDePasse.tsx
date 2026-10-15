// Changer mon mot de passe (compte Cursus). Obligatoire après un mot de passe provisoire : aucune donnée
// n'est accessible avant. Le même formulaire sert au changement volontaire (dialogue « motDePasse »).
import { useState, type FormEvent } from 'react';
import { MOT_DE_PASSE_MIN } from '../../../shared/constants.ts';
import { controleMotDePasse } from '../../../shared/rules/comptes.ts';
import { Field, focusPremiereErreur } from '../components/Dialog.tsx';
import { useStore } from '../state/store.tsx';

/** État et envoi du formulaire ; `onDone` après un changement réussi. */
export function useMotDePasse(onDone?: () => void) {
  const { session, changerMotDePasse } = useStore();
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Envoi tenté : les champs vides sont signalés (la règle et la confirmation le sont dès la saisie).
  const [tente, setTente] = useState(false);
  const provisoire = !!session?.compte?.changerMotDePasse;
  const regle = nouveau ? controleMotDePasse(nouveau, session?.compte?.identifiant ?? '') : null;
  const erreurs = {
    actuel: !actuel ? (provisoire ? 'Indiquez le mot de passe provisoire.' : 'Indiquez votre mot de passe actuel.') : null,
    nouveau: !nouveau ? 'Indiquez le nouveau mot de passe.' : regle,
    confirmation: !confirmation ? 'Saisissez de nouveau le mot de passe.' : confirmation !== nouveau ? 'Les deux saisies diffèrent.' : null,
  };
  const ok = !Object.values(erreurs).some(Boolean);
  const montrer = (k: keyof typeof erreurs, live: boolean) => (live || tente ? erreurs[k] : null);

  const submit = async (ev?: FormEvent) => {
    ev?.preventDefault();
    if (busy) return;
    if (!ok) { setTente(true); focusPremiereErreur(); return; }
    setBusy(true);
    const err = await changerMotDePasse(actuel, nouveau);
    setBusy(false);
    setError(err);
    if (!err) onDone?.();
  };

  const fields = (
    <>
      <Field label={provisoire ? 'Mot de passe provisoire' : 'Mot de passe actuel'} htmlFor="mdp-actuel" requis erreur={montrer('actuel', false)}>
        <input className="input" id="mdp-actuel" type="password" value={actuel} onChange={e => setActuel(e.target.value)} autoComplete="current-password" autoFocus />
      </Field>
      <Field label={<>Nouveau mot de passe <span className="who">· {MOT_DE_PASSE_MIN} caractères au moins</span></>} htmlFor="mdp-nouveau" requis erreur={montrer('nouveau', !!nouveau)}>
        <input className="input" id="mdp-nouveau" type="password" value={nouveau} onChange={e => setNouveau(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Confirmation" htmlFor="mdp-confirmation" requis erreur={montrer('confirmation', !!confirmation)}>
        <input className="input" id="mdp-confirmation" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="text-muted fine">Une phrase de plusieurs mots, facile à retenir, convient mieux qu’un mot compliqué. Vos autres sessions ouvertes seront fermées.</p>
    </>
  );
  return { fields, submit, ok, busy };
}

/** Écran obligatoire après une connexion avec un mot de passe provisoire. */
export function MotDePasse() {
  const { session, logout } = useStore();
  const f = useMotDePasse();
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'calc(var(--space-8) * 2)' }}>
      <form className="card elev-md" noValidate onSubmit={f.submit} style={{ width: '100%', maxWidth: 420, padding: 'calc(var(--space-6) * 1.5)', gap: 'var(--space-4)' }}>
        <div>
          <div className="kicker">{session?.compte?.nom ?? 'Compte Cursus'}</div>
          <h1 style={{ fontSize: 25, margin: 0 }}>Changer mon mot de passe</h1>
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Votre mot de passe provisoire doit être remplacé par un mot de passe personnel avant d’accéder à Cursus.
        </p>
        {f.fields}
        <button type="submit" className="btn btn-primary btn-block" disabled={f.busy}>Enregistrer et continuer</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Se déconnecter</button>
      </form>
    </div>
  );
}
