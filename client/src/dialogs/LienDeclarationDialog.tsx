// lot 14 — lien de pré-déclaration d'une entreprise extérieure ou d'une agence d'intérim (`presence.lien.creer`) : l'adresse
// complète (jeton compris) n'est montrée qu'ici, une fois ; le serveur n'en garde que l'empreinte.
import { useState } from 'react';
import { CancelButton, Dialog, Field, SubmitButton } from '../components/Dialog.tsx';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

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
      <Dialog title={`${t('Declaration link')} — ${entreprise.trim()}`} width={560} actions={<button type="button" className="btn btn-primary" onClick={closeDialog}>{t('I have copied the link')}</button>}>
        <p>{t(categorie === 'interimaire' ? 'Send this link to the agency: it will not be shown again. If it is lost, revoke it and create another one.' : 'Send this link to the company: it will not be shown again. If it is lost, revoke it and create another one.')}</p>
        <Field label={t('Address of the form')} htmlFor="lien-adresse">
          <input className="input" id="lien-adresse" readOnly value={adresse} onFocus={ev => ev.target.select()} />
        </Field>
        <button type="button" className="btn btn-secondary btn-sm" onClick={copier}>{t(copie ? 'Copied' : 'Copy')}</button>
      </Dialog>
    );
  }
  return (
    <Dialog title={t('New declaration link')} width={520} onSubmit={creer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Create the link')}</SubmitButton>
    </>}>
      <Field label={t('For')} htmlFor="lien-cat">
        <select className="input" id="lien-cat" value={categorie} onChange={ev => setCategorie(ev.target.value as 'exterieur' | 'interimaire')}>
          <option value="exterieur">{t('An outside company')}</option>
          <option value="interimaire">{t('A temporary work agency')}</option>
        </select>
      </Field>
      <Field label={t(categorie === 'interimaire' ? 'Agency' : 'Company')} htmlFor="lien-ent" requis>
        <input className="input" id="lien-ent" maxLength={120} value={entreprise} onChange={ev => setEntreprise(ev.target.value)} />
      </Field>
      <p className="text-muted fine">
        {t('One link per company or per agency, permanent until it is revoked. Each declaration received awaits the approval of HR; nothing is published or created before.')}
      </p>
    </Dialog>
  );
}
