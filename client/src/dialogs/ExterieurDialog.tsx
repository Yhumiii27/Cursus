// lot 14 — personnes sur site : fiche d'un salarié d'entreprise extérieure (`exterieur.creer`, `exterieur.modifier`) ;
// le matricule E est posé par le serveur à la création, jamais modifié. Règles : shared/rules/personnes-site.ts.
import { useState } from 'react';
import { erreursExterieur, normaliserExterieur, TEXTE_MAX } from '../../../shared/rules/personnes-site.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function ExterieurDialog({ id }: { id?: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const e = id != null ? (d.ds.exterieurs ?? []).find(x => x.id === id) : undefined;
  const [nom, setNom] = useState(e?.nom ?? '');
  const [entreprise, setEntreprise] = useState(e?.entreprise ?? '');
  const [email, setEmail] = useState(e?.email ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const saisie = normaliserExterieur({ nom, entreprise, email });
  const erreurs = erreursExterieur(saisie);
  const confirm = async () => {
    if (busy || !v.verifier(erreurs[0] ?? null)) return;
    setBusy(true);
    const r = await run(e ? 'exterieur.modifier' : 'exterieur.creer', e ? { id: e.id, ...saisie } : { ...saisie });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={e ? `${t('Outside worker’s sheet')} — ${e.nom}` : t('New outside worker')} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(e ? 'Save' : 'Create the sheet')}</SubmitButton>
    </>}>
      <Field label={t('Full name')} htmlFor="ext-nom" requis>
        <input className="input" id="ext-nom" maxLength={TEXTE_MAX} value={nom} onChange={ev => setNom(ev.target.value)} />
      </Field>
      <Field label={t('Company')} htmlFor="ext-ent" requis>
        <input className="input" id="ext-ent" maxLength={TEXTE_MAX} value={entreprise} onChange={ev => setEntreprise(ev.target.value)} />
      </Field>
      <Field label={t('Work e-mail address')} htmlFor="ext-mail">
        <input className="input" id="ext-mail" type="email" value={email} onChange={ev => setEmail(ev.target.value)} />
      </Field>
      {v.erreur(erreurs[0] ?? null) && <p className="text-danger fine" role="alert">{erreurs[0]}</p>}
      <p className="text-muted fine">
        {e ? `${t('Site number ')}${e.matriculeSite}${t(', permanent.')}` : t('A site number E is given at creation, for good: the person finds it again at each visit.')}
        {' '}{t('The sheet is used for titles, authorisations and presences on site; it enters neither payroll, nor leave, nor headcount. The e-mail address allows the person’s Microsoft account to be attached in the other tools.')}
      </p>
    </Dialog>
  );
}
