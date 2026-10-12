// Nouveau compte (administrateur RH) : un salarié ou une personne externe, compte Microsoft 365 ou compte
// Cursus (mot de passe provisoire affiché une seule fois), profil RH.
import { useEffect, useMemo, useState } from 'react';
import { COMPTE_TYPE_LABEL, PROFILS_RH } from '../../../shared/constants.ts';
import { equipeLabel } from '../../../shared/format.ts';
import { adresseValide, controleIdentifiant, identifiantSuggere, normaliserIdentifiant, typeSuggere } from '../../../shared/rules/comptes.ts';
import type { CompteType, CompteVue, ProfilRh } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { CancelButton, Dialog, Field } from '../components/Dialog.tsx';
import { Seg } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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

  const domaine = useMemo(() => domaineHabituel(comptes ?? []), [comptes]);
  // Salariés présents sans compte (un compte par personne).
  const candidats = useMemo(() => {
    const pris = new Set((comptes ?? []).map(c => c.empId));
    return d.ds.employes.filter(e => !pris.has(e.id) && !(e.fin && e.fin < d.ti)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [d, comptes]);
  const emp = empId ? d.emp(Number(empId)) : undefined;

  /** Propose le type et l'identifiant à partir de la personne choisie. */
  const proposer = (personne: string, t: CompteType) => { if (!saisi) setIdentifiant(personne ? identifiantSuggere(personne, t, domaine) : ''); };
  const choisirSalarie = (v: string) => {
    setEmpId(v);
    const e = v ? d.emp(Number(v)) : undefined;
    const t = e ? typeSuggere(e) : type;
    setType(t);
    proposer(e?.nom ?? '', t);
  };
  const choisirType = (t: CompteType) => { setType(t); proposer(externe ? nom : emp?.nom ?? '', t); };
  const choisirExterne = (x: boolean) => {
    setExterne(x);
    if (x && profil === 'aucun') setProfil('rh_gestionnaire');
    proposer(x ? nom : emp?.nom ?? '', type);
  };

  const ident = normaliserIdentifiant(identifiant);
  const identErr = ident ? controleIdentifiant(type, ident) : null;
  const doublon = !!ident && (comptes ?? []).some(c => c.identifiant === ident);
  const adresseErr = externe && adresse.trim() && !adresseValide(adresse.trim()) ? 'Adresse e-mail invalide' : null;
  const sansEspace = externe && profil === 'aucun';
  const cant = !comptes || !ident || !!identErr || doublon || (externe ? !nom.trim() || !adresse.trim() || !!adresseErr || sansEspace : !emp);

  const confirm = async () => {
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
    <Dialog title="Nouveau compte" width={560} actions={<>
      <CancelButton />
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>Créer le compte</button>
    </>}>
      {erreur && <p className="form-error">{erreur}</p>}
      <Field label="Personne">
        <Seg name="cpt-externe" label="Personne" value={externe ? 'ext' : 'sal'} onChange={v => choisirExterne(v === 'ext')}
          options={[['sal', 'Salarié'], ['ext', 'Personne externe']]} />
      </Field>
      {externe ? (
        <div className="grid-2">
          <Field label="Nom" htmlFor="cpt-nom">
            <input className="input" id="cpt-nom" type="text" value={nom} placeholder="Prénom Nom" onChange={e => { setNom(e.target.value); proposer(e.target.value, type); }} />
          </Field>
          <Field label="Adresse e-mail" htmlFor="cpt-adresse">
            <input className="input" id="cpt-adresse" type="email" value={adresse} placeholder="prenom.nom@cabinet.fr" onChange={e => setAdresse(e.target.value)} />
            {adresseErr && <span className="form-error">{adresseErr}</span>}
          </Field>
        </div>
      ) : (
        <Field label="Salarié" htmlFor="cpt-emp">
          <select className="input" id="cpt-emp" value={empId} onChange={e => choisirSalarie(e.target.value)} disabled={!comptes}>
            <option value="">{comptes ? (candidats.length ? 'Choisir un salarié sans compte…' : 'Tous les salariés ont un compte') : 'Chargement…'}</option>
            {candidats.map(e => <option key={e.id} value={e.id}>{e.nom} — {e.poste} · {equipeLabel(e)}</option>)}
          </select>
        </Field>
      )}
      <Field label="Type de compte">
        <Seg name="cpt-type" label="Type de compte" value={type} onChange={choisirType}
          options={[['microsoft', COMPTE_TYPE_LABEL.microsoft], ['local', COMPTE_TYPE_LABEL.local]]} />
      </Field>
      <p className="text-muted fine">
        {type === 'microsoft'
          ? 'Connexion avec le compte Microsoft 365 de l’entreprise (identifiant : son adresse). Aucun mot de passe n’est géré par Cursus.'
          : 'Pour le personnel sans compte d’entreprise (ouvriers, intérimaires, alternants) : un mot de passe provisoire sera affiché une seule fois, à remplacer à la première connexion.'}
      </p>
      <Field label={type === 'microsoft' ? 'Adresse Microsoft 365' : 'Identifiant'} htmlFor="cpt-ident">
        <input className="input" id="cpt-ident" type="text" value={identifiant} autoCapitalize="none" spellCheck={false}
          placeholder={type === 'microsoft' ? `prenom.nom@${domaine || 'entreprise.fr'}` : 'prenom.nom'}
          onChange={e => { setIdentifiant(e.target.value); setSaisi(!!e.target.value); }} />
        {(identErr || doublon) && <span className="form-error">{doublon ? 'Identifiant déjà utilisé' : identErr}</span>}
      </Field>
      <Field label="Profil RH" htmlFor="cpt-profil">
        <select className="input" id="cpt-profil" value={profil} onChange={e => setProfil(e.target.value as ProfilRh)}>
          {(Object.keys(PROFILS_RH) as ProfilRh[]).map(p => <option key={p} value={p} disabled={externe && p === 'aucun'}>{PROFILS_RH[p].label}</option>)}
        </select>
        <span className="text-muted sub">{PROFILS_RH[profil].aide}.</span>
      </Field>
      <p className="text-muted fine">
        {externe
          ? 'Une personne externe n’a pas de fiche salarié : son compte n’ouvre que l’espace RH.'
          : 'Espaces ouverts : collaborateur ; manager s’il encadre une équipe ; RH selon le profil.'}
      </p>
    </Dialog>
  );
}
