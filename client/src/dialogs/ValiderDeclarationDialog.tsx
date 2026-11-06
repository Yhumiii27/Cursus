// lot 14 — validation d'une pré-déclaration (`presence.valider`) : rattachement à une fiche existante (fiches proposées par
// `suggestions` : même adresse, ou mêmes nom et prénom), ou, pour un extérieur, création de sa fiche (matricule E). Un
// intérimaire est rattaché à sa fiche d'intérim, créée d'abord par le formulaire habituel.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { nomComplet, refDeclaration, suggestions } from '../../../shared/rules/declarations-presence.ts';
import { present } from '../../../shared/rules/contrats.ts';
import { CancelButton, Dialog, Field, SubmitButton } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function ValiderDeclarationDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const decl = (d.ds.declarationsPresence ?? []).find(x => x.id === id);
  const exterieur = decl?.categorie === 'exterieur';
  const fiches = exterieur ? d.ds.exterieurs ?? [] : d.ds.employes.filter(e => e.typeContrat === 'interim' && present(e, d.ti));
  const proposees = decl ? suggestions(decl, fiches) : [];
  const autres = fiches.filter(f => !proposees.includes(f)).sort((a, b) => a.nom.localeCompare(b.nom));
  const [choix, setChoix] = useState<string>(proposees[0] ? String(proposees[0].id) : exterieur ? 'nouvelle' : '');
  const [busy, setBusy] = useState(false);
  if (!decl) return null;
  const confirm = async () => {
    if (busy || !choix) return;
    setBusy(true);
    const r = await run('presence.valider', choix === 'nouvelle' ? { id } : { id, empId: Number(choix) });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`Valider la déclaration ${refDeclaration(decl.id)}`} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Valider</SubmitButton>
    </>}>
      <p>
        <strong>{nomComplet(decl)}</strong> — {decl.entreprise}{decl.email ? ` · ${decl.email}` : ''}<br />
        {d.ds.referentiels.sites?.find(s => s.code === decl.siteCode)?.libelle ?? decl.siteCode} · {decl.du === decl.au ? `le ${fmtIso(decl.du)}` : `du ${fmtIso(decl.du)} au ${fmtIso(decl.au)}`}<br />
        <span className="text-muted">{decl.objet}</span>
      </p>
      <Field label="Fiche de la personne" htmlFor="decl-fiche" requis>
        <select className="input" id="decl-fiche" value={choix} onChange={ev => setChoix(ev.target.value)}>
          {!exterieur && <option value="">— choisir la fiche d’intérim —</option>}
          {proposees.length > 0 && (
            <optgroup label="Proposées (même adresse ou même nom)">
              {proposees.map(f => <option key={f.id} value={f.id}>{f.nom} · {f.matriculeSite ?? 'sans matricule'}{f.entreprise || f.agence ? ` · ${f.entreprise ?? f.agence}` : ''}</option>)}
            </optgroup>
          )}
          {exterieur && <option value="nouvelle">Créer sa fiche d’extérieur (nouveau matricule E)</option>}
          {autres.length > 0 && (
            <optgroup label={exterieur ? 'Autres extérieurs' : 'Autres intérimaires présents'}>
              {autres.map(f => <option key={f.id} value={f.id}>{f.nom} · {f.matriculeSite ?? 'sans matricule'}{f.entreprise || f.agence ? ` · ${f.entreprise ?? f.agence}` : ''}</option>)}
            </optgroup>
          )}
        </select>
      </Field>
      <p className="text-muted fine">
        {exterieur
          ? 'Une personne déjà venue garde sa fiche et son matricule : rattachez-la plutôt que d’en créer une autre.'
          : 'Un intérimaire est rattaché à sa fiche d’intérim (contrat, agence, équipe) : créez-la d’abord dans l’annuaire s’il n’en a pas.'}
        {' '}Validée, la venue est publiée au poste de garde.
      </p>
    </Dialog>
  );
}
