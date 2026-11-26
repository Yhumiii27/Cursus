// Changer mon mot de passe (compte Cursus). Obligatoire après un mot de passe provisoire : aucune donnée
// n'est accessible avant. Le même formulaire sert au changement volontaire (dialogue « motDePasse »).
import { useState, type FormEvent } from 'react';
import { MOT_DE_PASSE_MIN } from '../../../shared/constants.ts';
import { controleMotDePasse } from '../../../shared/rules/comptes.ts';
import { Field, focusPremiereErreur } from '../components/Dialog.tsx';
import { t } from '../i18n/langue.ts';
import { EnTetePage } from '../layout/Coque.tsx';
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
    actuel: !actuel ? t(provisoire ? 'Enter the temporary password.' : 'Enter your current password.') : null,
    nouveau: !nouveau ? t('Enter the new password.') : regle,
    confirmation: !confirmation ? t('Type the password again.') : confirmation !== nouveau ? t('The two entries differ.') : null,
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
      <Field label={t(provisoire ? 'Temporary password' : 'Current password')} htmlFor="mdp-actuel" requis erreur={montrer('actuel', false)}>
        <input className="input" id="mdp-actuel" type="password" value={actuel} onChange={e => setActuel(e.target.value)} autoComplete="current-password" autoFocus />
      </Field>
      <Field label={<>{t('New password')} <span className="who">· {t(`at least ${MOT_DE_PASSE_MIN} characters`)}</span></>} htmlFor="mdp-nouveau" requis erreur={montrer('nouveau', !!nouveau)}>
        <input className="input" id="mdp-nouveau" type="password" value={nouveau} onChange={e => setNouveau(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label={t('Confirmation')} htmlFor="mdp-confirmation" requis erreur={montrer('confirmation', !!confirmation)}>
        <input className="input" id="mdp-confirmation" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="text-muted fine">{t('A phrase of several words, easy to remember, is better than a complicated word. Your other open sessions will be closed.')}</p>
    </>
  );
  return { fields, submit, ok, busy };
}

/** Écran obligatoire après une connexion avec un mot de passe provisoire. */
export function MotDePasse() {
  const { session, logout } = useStore();
  const f = useMotDePasse();
  return (
    <>
    {/* En-tête commun (Norma 2.0) : titre de la page et paire langue / affichage. */}
    <EnTetePage titre={t('Change my password')} />
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-8)' }}>
      <form className="card elev-md" noValidate onSubmit={f.submit} style={{ width: '100%', maxWidth: 420, padding: 'calc(var(--space-6) * 1.5)', gap: 'var(--space-4)' }}>
        <h2 className="card-title">{session?.compte?.nom ?? t('Cursus account')}</h2>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {t('Your temporary password must be replaced by a personal password before you can use Cursus.')}
        </p>
        {f.fields}
        <button type="submit" className="btn btn-primary btn-block" disabled={f.busy}>{t('Save and continue')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>{t('Sign out')}</button>
      </form>
    </div>
    </>
  );
}
