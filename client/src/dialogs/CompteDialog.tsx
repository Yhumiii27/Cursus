// Nouveau compte (administrateur RH) : un salarié ou une personne externe, compte Microsoft 365 ou compte
// Cursus (mot de passe provisoire affiché une seule fois), profil RH.
import { useEffect, useMemo, useState } from 'react';
import { COMPTE_TYPE_LABEL, PROFILS_RH } from '../../../shared/constants.ts';
import { equipeLabel } from '../../../shared/format.ts';
import { adresseValide, controleIdentifiant, identifiantSuggere, normaliserIdentifiant, typeSuggere } from '../../../shared/rules/comptes.ts';
import type { CompteType, CompteVue, ProfilRh } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Seg } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Domaine le plus fréquent des comptes Microsoft 365 existants, pour proposer l'adresse d'un salarié. */
function domaineHabituel(comptes: CompteVue[]): string {
  const n = new Map<string, number>();
  comptes.filter(c => c.type === 'microsoft').forEach(c => { const dom = c.identifiant.split('@')[1]; if (dom) n.set(dom, (n.get(dom) ?? 0) + 1); });
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

export function CompteDialog() {
  const d = useDomain();
  const { run, closeDialog, openDialog } = useStore();
  const [comptes, setComptes] = useState<CompteVue[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => { api.comptes().then(setComptes).catch(err => setErreur((err as Error).message)); }, []);

  const [externe, setExterne] = useState(false);
  const [empId, setEmpId] = useState('');
  const [nom, setNom] = useState('');
  const [adresse, setAdresse] = useState('');
  const [type, setType] = useState<CompteType>('microsoft');
  const [identifiant, setIdentifiant] = useState('');
  /** Identifiant saisi à la main : il n'est plus remplacé par la proposition. */
  const [saisi, setSaisi] = useState(false);
  const [profil, setProfil] = useState<ProfilRh>('aucun');
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  const domaine = useMemo(() => domaineHabituel(comptes ?? []), [comptes]);
  // Salariés présents sans compte (un compte par personne).
  const candidats = useMemo(() => {
    const pris = new Set((comptes ?? []).map(c => c.empId));
    return d.ds.employes.filter(e => !pris.has(e.id) && !(e.fin && e.fin < d.ti)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [d, comptes]);
  const emp = empId ? d.emp(Number(empId)) : undefined;

  /** Propose le type et l'identifiant à partir de la personne choisie. */
  const proposer = (personne: string, ty: CompteType) => { if (!saisi) setIdentifiant(personne ? identifiantSuggere(personne, ty, domaine) : ''); };
  const choisirSalarie = (v: string) => {
    setEmpId(v);
    const e = v ? d.emp(Number(v)) : undefined;
    const ty = e ? typeSuggere(e) : type;
    setType(ty);
    proposer(e?.nom ?? '', ty);
  };
  const choisirType = (ty: CompteType) => { setType(ty); proposer(externe ? nom : emp?.nom ?? '', ty); };
  const choisirExterne = (x: boolean) => {
    setExterne(x);
    if (x && profil === 'aucun') setProfil('rh_gestionnaire');
    proposer(x ? nom : emp?.nom ?? '', type);
  };

  const ident = normaliserIdentifiant(identifiant);
  const identErr = ident ? controleIdentifiant(type, ident) : null;
  const doublon = !!ident && (comptes ?? []).some(c => c.identifiant === ident);
  // Erreurs de format (adresse, identifiant) affichées dès la saisie ; champs manquants, à l'envoi.
  const adresseErr = externe && adresse.trim() && !adresseValide(adresse.trim()) ? t('Invalid e-mail address.') : null;
  const identFormat = doublon ? t('Login already used.') : identErr;
  const erreurs = {
    emp: !externe && !emp ? t('Choose the employee.#salarie') : null,
    nom: externe && !nom.trim() ? t('Enter the name of the person.') : null,
    adresse: externe ? (!adresse.trim() ? t('Enter their e-mail address.') : adresseErr) : null,
    ident: !ident ? t(type === 'microsoft' ? 'Enter the Microsoft 365 address.' : 'Enter the login.') : identFormat,
    profil: externe && profil === 'aucun' ? t('An external person only opens the HR space: choose an HR profile.') : null,
  };

  const confirm = async () => {
    if (busy || !v.verifier(!comptes, ...Object.values(erreurs))) return;
    setBusy(true);
    const r = await run('compte.creer', {
      ...(externe ? { nom: nom.trim(), adresse: adresse.trim() } : { empId: emp!.id }), type, identifiant: ident, profilRh: profil,
    });
    setBusy(false);
    if (!r.ok) return;
    const mdp = (r.result as { motDePasse?: string | null } | undefined)?.motDePasse;
    if (mdp) openDialog({ type: 'motDePasseProvisoire', nom: externe ? nom.trim() : emp!.nom, identifiant: ident, motDePasse: mdp });
    else closeDialog();
  };

  return (
    <Dialog title={t('New account')} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Create the account')}</SubmitButton>
    </>}>
      {erreur && <Bloquant>{t('Existing accounts unreadable: ')}{erreur}</Bloquant>}
      <Field label={t('Person')}>
        <Seg name="cpt-externe" label={t('Person')} value={externe ? 'ext' : 'sal'} onChange={v => choisirExterne(v === 'ext')}
          options={[['sal', t('Employee#salarie')], ['ext', t('External person')]]} />
      </Field>
      {externe ? (
        <div className="grid-2">
          <Field label={t('Name')} htmlFor="cpt-nom" requis erreur={v.erreur(erreurs.nom)}>
            <input className="input" id="cpt-nom" type="text" value={nom} placeholder={t('First name Last name')} onChange={e => { setNom(e.target.value); proposer(e.target.value, type); }} />
          </Field>
          <Field label={t('E-mail address')} htmlFor="cpt-adresse" requis erreur={adresseErr ?? v.erreur(erreurs.adresse)}>
            <input className="input" id="cpt-adresse" type="email" value={adresse} placeholder="prenom.nom@cabinet.fr" onChange={e => setAdresse(e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label={t('Employee#salarie')} htmlFor="cpt-emp" requis erreur={v.erreur(erreurs.emp)}>
          <select className="input" id="cpt-emp" value={empId} onChange={e => choisirSalarie(e.target.value)} disabled={!comptes}>
            <option value="">{comptes ? (candidats.length ? t('Choose an employee without an account…') : t('All the employees have an account')) : t('Loading…')}</option>
            {candidats.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste} · {equipeLabel(e)}</option>)}
          </select>
        </Field>
      )}
      <Field label={t('Type of account')}>
        <Seg name="cpt-type" label={t('Type of account')} value={type} onChange={choisirType}
          options={[['microsoft', COMPTE_TYPE_LABEL.microsoft], ['local', COMPTE_TYPE_LABEL.local]]} />
      </Field>
      <p className="text-muted fine">
        {type === 'microsoft'
          ? t('Sign-in with the Microsoft 365 account of the company (login: its address). No password is managed by Cursus.')
          : t('For staff without a company account (workers, temporary workers, work-study students): a temporary password will be shown only once, to replace at the first sign-in.')}
      </p>
      <Field label={t(type === 'microsoft' ? 'Microsoft 365 address' : 'Login')} htmlFor="cpt-ident" requis erreur={identFormat ?? v.erreur(erreurs.ident)}>
        <input className="input" id="cpt-ident" type="text" value={identifiant} autoCapitalize="none" spellCheck={false}
          placeholder={type === 'microsoft' ? `${t('first.last@')}${domaine || t('company.fr')}` : t('first.last')}
          onChange={e => { setIdentifiant(e.target.value); setSaisi(!!e.target.value); }} />
      </Field>
      <Field label={t('HR profile')} htmlFor="cpt-profil" erreur={v.erreur(erreurs.profil)}>
        <select className="input" id="cpt-profil" value={profil} onChange={e => setProfil(e.target.value as ProfilRh)}>
          {(Object.keys(PROFILS_RH) as ProfilRh[]).map(p => <option key={p} value={p} disabled={externe && p === 'aucun'}>{PROFILS_RH[p].label}</option>)}
        </select>
        <span className="text-muted sub">{PROFILS_RH[profil].aide}.</span>
      </Field>
      <p className="text-muted fine">
        {externe
          ? t('An external person has no employee sheet: their account only opens the HR space.')
          : t('Spaces opened: employee; manager if they lead a team; HR according to the profile.')}
      </p>
    </Dialog>
  );
}
