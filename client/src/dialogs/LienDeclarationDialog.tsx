// lot 14 — lien de pré-déclaration d'une entreprise extérieure ou d'une agence d'intérim (`presence.lien.creer`) : l'adresse
// complète (jeton compris) n'est montrée qu'ici, une fois ; le serveur n'en garde que l'empreinte.
import { useState } from 'react';
import { CancelButton, Dialog, Field, SubmitButton } from '../components/Dialog.tsx';
import { useStore } from '../state/store.tsx';

export function LienDeclarationDialog() {
  const { run, closeDialog } = useStore();
  const [categorie, setCategorie] = useState<'exterieur' | 'interimaire'>('exterieur');
  const [entreprise, setEntreprise] = useState('');
  const [busy, setBusy] = useState(false);
  const [adresse, setAdresse] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const creer = async () => {
    if (busy || adresse) return;
    setBusy(true);
    const r = await run('presence.lien.creer', { categorie, entreprise });
    setBusy(false);
    const jeton = (r.result as { jeton?: string } | undefined)?.jeton;
    if (r.ok && jeton) setAdresse(`${location.origin}/declarer/${jeton}`);
  };
  const copier = async () => {
    try { await navigator.clipboard.writeText(adresse!); setCopie(true); } catch { setCopie(false); }
  };
  if (adresse) {
    return (
      <Dialog title={`Lien de déclaration — ${entreprise.trim()}`} width={560} actions={<button type="button" className="btn btn-primary" onClick={closeDialog}>J’ai copié le lien</button>}>
        <p>Transmettez ce lien à {categorie === 'interimaire' ? 'l’agence' : 'l’entreprise'} : il ne sera plus affiché. S’il est perdu, révoquez-le et créez-en un autre.</p>
        <Field label="Adresse du formulaire" htmlFor="lien-adresse">
          <input className="input" id="lien-adresse" readOnly value={adresse} onFocus={ev => ev.target.select()} />
        </Field>
        <button type="button" className="btn btn-secondary btn-sm" onClick={copier}>{copie ? 'Copié' : 'Copier'}</button>
      </Dialog>
    );
  }
  return (
    <Dialog title="Nouveau lien de déclaration" width={520} onSubmit={creer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Créer le lien</SubmitButton>
    </>}>
      <Field label="Pour" htmlFor="lien-cat">
        <select className="input" id="lien-cat" value={categorie} onChange={ev => setCategorie(ev.target.value as 'exterieur' | 'interimaire')}>
          <option value="exterieur">Une entreprise extérieure</option>
          <option value="interimaire">Une agence d’intérim</option>
        </select>
      </Field>
      <Field label={categorie === 'interimaire' ? 'Agence' : 'Entreprise'} htmlFor="lien-ent" requis>
        <input className="input" id="lien-ent" maxLength={120} value={entreprise} onChange={ev => setEntreprise(ev.target.value)} />
      </Field>
      <p className="text-muted fine">
        Un lien par entreprise ou par agence, permanent jusqu’à sa révocation. Chaque déclaration reçue attend la validation
        du service RH ; rien n’est publié ni créé avant.
      </p>
    </Dialog>
  );
}
