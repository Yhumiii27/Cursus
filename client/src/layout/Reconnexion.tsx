// Reconnexion après l'expiration de la session (12 h), par-dessus l'écran : la page et le dialogue ouverts
// restent montés, avec leur saisie, et le reste de l'écran est inerte. Compte Cursus ou démonstration :
// mot de passe, puis les actions interrompues sont rejouées. Compte Microsoft : la connexion passe par
// Microsoft (redirection) ; le brouillon du dialogue ouvert est gardé dans l'onglet et restauré au retour.
import { useState, type FormEvent } from 'react';
import { plural } from '../../../shared/format.ts';
import { Field, Static } from '../components/Dialog.tsx';
import { useStore } from '../state/store.tsx';

export function Reconnexion() {
  const { reconnexion: rc, dialog, reconnecter, reconnecterMicrosoft, abandonnerReconnexion } = useStore();
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rc) return null;
  const microsoft = rc.methode === 'microsoft';
  // Démonstration : mot de passe quelconque, aucun pour l'espace RH (comme à la connexion).
  const needPwd = rc.methode === 'local' || (rc.methode === 'demo' && rc.role !== 'rh');
  const attente = rc.enAttente ? plural(rc.enAttente, 'action interrompue', 'actions interrompues') : null;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || (needPwd && !pwd)) return;
    setBusy(true);
    const err = await reconnecter(pwd);
    setBusy(false);
    setError(err);
    if (err) setPwd('');
  };

  return (
    <div className="dialog-backdrop reconnexion">
      <form className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="rc-titre" aria-describedby="rc-texte" onSubmit={submit}>
        <div className="dialog-title" id="rc-titre">Session expirée</div>
        <div className="dialog-body">
          <p id="rc-texte" style={{ margin: 0 }}>
            Votre session a pris fin : reconnectez-vous pour continuer. {dialog ? 'La page et le formulaire ouverts restent' : 'La page reste'} en l’état.
          </p>
          <Field label="Compte"><Static>{rc.compte.nom} · {rc.compte.identifiant}</Static></Field>
          {microsoft ? (
            <p className="text-muted fine">
              Vous allez passer par la page de connexion Microsoft, puis revenir ici.
              {dialog && ' La saisie du formulaire ouvert est gardée sur ce poste et remise en place au retour.'}
              {attente && ` ${attente} ${rc.enAttente > 1 ? 'n’ont pas été enregistrées' : 'n’a pas été enregistrée'} : validez de nouveau au retour.`}
            </p>
          ) : (
            <>
              {needPwd && (
                <Field label="Mot de passe" htmlFor="rc-pwd">
                  <input className="input" id="rc-pwd" type="password" value={pwd} onChange={e => setPwd(e.target.value)} autoComplete="current-password" autoFocus />
                </Field>
              )}
              {attente && <p className="text-muted fine">{attente} {rc.enAttente > 1 ? 'seront enregistrées' : 'sera enregistrée'} dès la reconnexion.</p>}
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={abandonnerReconnexion} disabled={busy}>Changer de compte</button>
          {microsoft
            ? <button type="button" className="btn btn-primary" autoFocus onClick={() => location.assign(reconnecterMicrosoft())}>Se reconnecter avec Microsoft</button>
            : <button type="submit" className="btn btn-primary" autoFocus={!needPwd} disabled={busy || (needPwd && !pwd)}>Se reconnecter</button>}
        </div>
      </form>
    </div>
  );
}
