// Connexion. « Se connecter avec Microsoft » (compte Microsoft 365 de l'entreprise) quand la connexion
// Microsoft est configurée : un simple lien vers /api/auth/microsoft, qui redirige vers Microsoft (un
// formulaire serait bloqué par la CSP form-action 'self'). En dessous, le compte Cursus (identifiant et mot
// de passe) pour le personnel sans compte Microsoft. En démonstration, choix libre d'un compte de l'espace
// (tout mot de passe est accepté), ou connexion par compte Cursus pour essayer le parcours réel.
// Un échec de la connexion Microsoft revient ici avec ?connexion=<code> (ERREURS_MICROSOFT).
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BLOCAGE_MINUTES, ECHECS_MAX, ERREURS_MICROSOFT, type ErreurMicrosoft } from '../../../shared/constants.ts';
import { lienMicrosoft, type LoginOption } from '../api.ts';
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

/** Échec de la connexion Microsoft signalé dans l'adresse (?connexion=<code>), ou null. */
function erreurMicrosoft(): ErreurMicrosoft | null {
  const code = new URLSearchParams(location.search).get('connexion');
  return code && code in ERREURS_MICROSOFT ? code as ErreurMicrosoft : null;
}

export function Login() {
  const { session } = useStore();
  const demo = !!session?.loginOptions;
  const [erreur] = useState(erreurMicrosoft);
  const [cursus, setCursus] = useState(!!erreur);
  // Le code d'erreur quitte l'adresse une fois lu : un rechargement ne le réaffiche pas.
  useEffect(() => { if (location.search) history.replaceState(null, '', location.pathname); }, []);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'calc(var(--space-8) * 2)' }}>
      {demo && !cursus ? <DemoLogin onCursus={() => setCursus(true)} /> : <CursusLogin erreur={erreur} onDemo={demo ? () => setCursus(false) : undefined} />}
    </div>
  );
}

/** Logo Microsoft (quatre carrés), dans la couleur du texte du bouton. */
function LogoMicrosoft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="0" y="0" width="7.5" height="7.5" /><rect x="8.5" y="0" width="7.5" height="7.5" />
      <rect x="0" y="8.5" width="7.5" height="7.5" /><rect x="8.5" y="8.5" width="7.5" height="7.5" />
    </svg>
  );
}

/** Connexion Microsoft 365 : lien vers Cursus, qui redirige vers Microsoft puis revient sur la page demandée. */
function MicrosoftLogin({ erreur }: { erreur: ErreurMicrosoft | null }) {
  // Accès refusé : proposer de choisir un autre compte Microsoft plutôt que de reprendre le même d'office.
  const choix = erreur === 'acces' || erreur === 'ferme';
  return (
    <>
      <a className="btn btn-primary btn-block btn-microsoft" href={lienMicrosoft({ retour: location.pathname, choix })}>
        <LogoMicrosoft />{choix ? 'Se connecter avec un autre compte Microsoft' : 'Se connecter avec Microsoft'}
      </a>
      <p className="text-muted fine">Salariés dotés d’un compte Microsoft 365 de l’entreprise (adresse professionnelle).</p>
    </>
  );
}

/** Compte Cursus : identifiant et mot de passe ; le message d'échec ne dit pas lequel est faux. */
function CursusLogin({ onDemo, erreur }: { onDemo?: () => void; erreur: ErreurMicrosoft | null }) {
  const { session, login } = useStore();
  const microsoft = !!session?.microsoft;
  const echec = erreur ? ERREURS_MICROSOFT[erreur] : null;
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
      {echec && <p className="boxed connexion-erreur" role="alert"><strong>{echec.titre}</strong> : {echec.texte}</p>}
      {microsoft && <MicrosoftLogin erreur={erreur} />}
      <h4 className="section-label">Compte Cursus</h4>
      <div className="field">
        <label htmlFor="lg-ident">Identifiant</label>
        <input className="input" id="lg-ident" type="text" value={identifiant} onChange={e => setIdentifiant(e.target.value)}
          autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!microsoft} />
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
