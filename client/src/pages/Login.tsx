// Connexion aux espaces manager et collaborateur (démonstration : tout mot de passe est accepté).
// Hors démonstration, aucun compte n'est listé : la connexion passe par l'authentification unique.
import { useMemo, useState, type FormEvent } from 'react';
import type { LoginOption } from '../api.ts';
import { useStore } from '../state/store.tsx';

const TEXTS = {
  rh: { title: 'Espace RH', text: 'Pilotez la conformité des formations et habilitations, les temps, les congés, les entretiens et les déplacements.' },
  manager: { title: 'Espace manager', text: 'Validez les heures et les absences de votre équipe, suivez ses formations, ses habilitations et ses missions, et menez ses entretiens.' },
  collaborateur: { title: 'Espace collaborateur', text: 'Consultez vos formations, habilitations, congés et entretiens, déclarez vos heures et envoyez vos demandes au service RH.' },
};

/** Comptes proposés, une seule fois chacun (un manager de plusieurs équipes n'apparaît qu'une fois). */
function uniques(list: LoginOption[]): LoginOption[] {
  const seen = new Set<number>();
  return list.filter(o => !seen.has(o.id) && !!seen.add(o.id));
}

export function Login() {
  const { session, login } = useStore();
  const role = session?.role ?? 'rh';
  const sso = !session?.loginOptions;
  const options = useMemo(() => uniques(session?.loginOptions?.[role] ?? []), [session, role]);
  const [id, setId] = useState<number>(options[0]?.id ?? 0);
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = TEXTS[role];
  const needPwd = !sso && role !== 'rh';
  const sel = options.some(o => o.id === id) ? id : options[0]?.id ?? 0;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (needPwd && !pwd.trim()) return;
    setBusy(true);
    const err = await login(role, sso || role === 'rh' ? null : sel, sso ? '' : pwd);
    setBusy(false);
    setError(err);
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'calc(var(--space-8) * 2)' }}>
      <form className="card elev-md" onSubmit={submit} style={{ width: '100%', maxWidth: 400, padding: 'calc(var(--space-6) * 1.5)', gap: 'var(--space-4)' }}>
        <div>
          <div className="kicker">{t.title}</div>
          <h1 style={{ fontSize: 25, margin: 0 }}>Connexion</h1>
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t.text}</p>
        {sso ? (
          <p style={{ fontSize: 14, margin: 0 }}>Connexion par l’authentification unique de l’entreprise.</p>
        ) : (
          <div className="field">
            <label htmlFor="lg-id">Identifiant</label>
            <select className="input" id="lg-id" value={sel} onChange={e => setId(Number(e.target.value))}>
              {options.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
            </select>
          </div>
        )}
        {needPwd && (
          <div className="field">
            <label htmlFor="lg-pwd">Mot de passe</label>
            <input className="input" id="lg-pwd" type="password" value={pwd} onChange={e => setPwd(e.target.value)} autoComplete="current-password" />
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || (needPwd && !pwd.trim()) || (!sso && !options.length)}>
          {sso ? 'Continuer avec l’authentification unique' : 'Se connecter'}
        </button>
        {!sso && (
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {session?.demo
              ? 'Démo : choisissez un collaborateur et saisissez n’importe quel mot de passe. En production : authentification unique de l’entreprise.'
              : 'Authentification unique de l’entreprise.'}
          </p>
        )}
      </form>
    </div>
  );
}
