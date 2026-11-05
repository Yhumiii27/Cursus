// lot 14 — personnes sur site : fiche d'un salarié d'entreprise extérieure (`exterieur.creer`, `exterieur.modifier`) ;
// le matricule E est posé par le serveur à la création, jamais modifié. Règles : shared/rules/personnes-site.ts.
import { useState } from 'react';
import { erreursExterieur, normaliserExterieur, TEXTE_MAX } from '../../../shared/rules/personnes-site.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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
    <Dialog title={e ? `Fiche d’extérieur — ${e.nom}` : 'Nouvel extérieur'} width={520} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{e ? 'Enregistrer' : 'Créer la fiche'}</SubmitButton>
    </>}>
      <Field label="Nom et prénom" htmlFor="ext-nom" requis>
        <input className="input" id="ext-nom" maxLength={TEXTE_MAX} value={nom} onChange={ev => setNom(ev.target.value)} />
      </Field>
      <Field label="Entreprise" htmlFor="ext-ent" requis>
        <input className="input" id="ext-ent" maxLength={TEXTE_MAX} value={entreprise} onChange={ev => setEntreprise(ev.target.value)} />
      </Field>
      <Field label="Adresse e-mail professionnelle" htmlFor="ext-mail">
        <input className="input" id="ext-mail" type="email" value={email} onChange={ev => setEmail(ev.target.value)} />
      </Field>
      {v.erreur(erreurs[0] ?? null) && <p className="text-danger fine" role="alert">{erreurs[0]}</p>}
      <p className="text-muted fine">
        {e ? `Matricule de site ${e.matriculeSite}, permanent.` : 'Un matricule de site E est attribué à la création, définitivement : la personne le retrouve à chaque venue.'}
        {' '}La fiche sert aux titres, aux habilitations et aux présences sur site ; elle n’entre ni dans la paie, ni dans les congés, ni dans les effectifs.
        L’adresse e-mail permet de rattacher le compte Microsoft de la personne dans les autres outils.
      </p>
    </Dialog>
  );
}
