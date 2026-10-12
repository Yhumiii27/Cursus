// Connexion. Compte Cursus (identifiant et mot de passe), pour le personnel sans compte Microsoft 365 de
// l'entreprise ; la connexion Microsoft 365 s'ajoutera au-dessus. En démonstration, choix libre d'un compte
// de l'espace (tout mot de passe est accepté), ou connexion par compte Cursus pour essayer le parcours réel.
import { useMemo, useState, type FormEvent } from 'react';
import { BLOCAGE_MINUTES, ECHECS_MAX } from '../../../shared/constants.ts';
import type { LoginOption } from '../api.ts';
import { useStore } from '../state/store.tsx';

const TEXTS = {
  rh: { title: 'Espace RH', text: 'Pilotez la conformité des formations et habilitations, les temps, les congés, les entretiens et les déplacements.' },
  manager: { title: 'Espace manager', text: 'Validez les heures et les absences de votre équipe, suivez ses formations, ses habilitations et ses missions, et menez ses entretiens.' },
  collaborateur: { title: 'Espace collaborateur', text: 'Consultez vos formations, habilitations, congés et entretiens, déclarez vos heures et envoyez vos demandes au service RH.' },
};

/** Comptes proposés, une seule fois chacun. */
function uniques(list: LoginOption[]): LoginOption[] {
  const seen = new Set<number>();
  return list.filter(o => !seen.has(o.id) && !!seen.add(o.id));
}

const CARD = { width: '100%', maxWidth: 400, padding: 'calc(var(--space-6) * 1.5)', gap: 'var(--space-4)' };

export function Login() {
  const { session } = useStore();
  const demo = !!session?.loginOptions;
  const [cursus, setCursus] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'calc(var(--space-8) * 2)' }}>
      {demo && !cursus ? <DemoLogin onCursus={() => setCursus(true)} /> : <CursusLogin onDemo={demo ? () => setCursus(false) : undefined} />}
    </div>
  );
}

/** Compte Cursus : identifiant et mot de passe ; le message d'échec ne dit pas lequel est faux. */
function CursusLogin({ onDemo }: { onDemo?: () => void }) {
  const { login } = useStore();
  const [identifiant, setIdentifiant] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = !!identifiant.trim() && !!pwd;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    const err = await login(identifiant.trim(), pwd);
    setBusy(false);
    setError(err);
    if (err) setPwd('');
  };

  return (
    <form className="card elev-md" onSubmit={submit} style={CARD}>
      <div>
        <div className="kicker">Cursus</div>
        <h1 style={{ fontSize: 25, margin: 0 }}>Connexion</h1>
      </div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Formations, habilitations, temps, congés, entretiens et déplacements.</p>
      <h4 className="section-label">Compte Cursus</h4>
      <div className="field">
        <label htmlFor="lg-ident">Identifiant</label>
        <input className="input" id="lg-ident" type="text" value={identifiant} onChange={e => setIdentifiant(e.target.value)}
          autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="lg-pwd">Mot de passe</label>
        <input className="input" id="lg-pwd" type="password" value={pwd} onChange={e => setPwd(e.target.value)} autoComplete="current-password" />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !ok}>Se connecter</button>
      <p className="text-muted fine">
        Pour le personnel sans compte Microsoft 365 de l’entreprise : identifiant et mot de passe provisoire remis par le service RH.
        {!error && ` Après ${ECHECS_MAX} essais infructueux, le compte est bloqué ${BLOCAGE_MINUTES} minutes.`}
      </p>
      {onDemo && <button type="button" className="btn btn-ghost btn-sm" onClick={onDemo}>Revenir au choix d’un compte de démonstration</button>}
    </form>
  );
}

/** Démonstration : choix d'un compte de l'espace, mot de passe quelconque (aucun pour l'espace RH). */
function DemoLogin({ onCursus }: { onCursus: () => void }) {
  const { session, loginDemo } = useStore();
  const role = session?.role ?? 'rh';
  const options = useMemo(() => uniques(session?.loginOptions?.[role] ?? []), [session, role]);
  const [id, setId] = useState<number>(options[0]?.id ?? 0);
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = TEXTS[role];
  const needPwd = role !== 'rh';
  const sel = options.some(o => o.id === id) ? id : options[0]?.id ?? 0;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (needPwd && !pwd.trim()) return;
    setBusy(true);
    const err = await loginDemo(role, sel, pwd);
    setBusy(false);
    setError(err);
  };

  return (
    <form className="card elev-md" onSubmit={submit} style={CARD}>
      <div>
        <div className="kicker">{t.title}</div>
        <h1 style={{ fontSize: 25, margin: 0 }}>Connexion</h1>
      </div>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{t.text}</p>
      <div className="field">
        <label htmlFor="lg-id">Compte</label>
        <select className="input" id="lg-id" value={sel} onChange={e => setId(Number(e.target.value))}>
          {options.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </div>
      {needPwd && (
        <div className="field">
          <label htmlFor="lg-pwd">Mot de passe</label>
          <input className="input" id="lg-pwd" type="password" value={pwd} onChange={e => setPwd(e.target.value)} autoComplete="current-password" />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || (needPwd && !pwd.trim()) || !options.length}>Se connecter</button>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        Démo : choisissez un compte{needPwd ? ' et saisissez n’importe quel mot de passe' : ''}. En production : compte Microsoft 365 de l’entreprise, ou compte Cursus.
      </p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCursus}>Se connecter avec un compte Cursus</button>
    </form>
  );
}
