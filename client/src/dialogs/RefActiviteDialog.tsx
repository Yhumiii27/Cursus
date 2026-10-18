// Écran Référentiels, onglet Activités internes : nouvelle activité (code INT-… ou ECOLE, choisi une fois pour toutes, et
// libellé) ou renommage. Contrôles partagés avec le serveur (shared/rules/activites.ts).
import { useState } from 'react';
import { controlerActivite, NOM_ACTIVITE_MAX, normaliserCodeActivite } from '../../../shared/rules/activites.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefActiviteDialog({ code }: { code?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const projets = d.ds.referentiels.projets;
  const [avant] = useState(() => (code ? projets.find(p => p.code === code) ?? null : null));
  const [saisi, setSaisi] = useState('INT-');
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !!code && !avant;
  const { erreurs } = controlerActivite({ code: saisi, nom }, projets, avant);
  // Code incomplet (« INT- ») : signalé à l'envoi ; code déjà pris ou mal formé : dès la saisie.
  const codeIncomplet = normaliserCodeActivite(saisi).length <= 4;

  const envoyer = async () => {
    if (busy || !v.verifier(avant ? null : erreurs.code, erreurs.nom, disparu)) return;
    setBusy(true);
    const r = await run('referentiel.activite.enregistrer', avant ? { id: avant.code, nom } : { code: saisi, nom });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={avant ? `Activité ${avant.code}` : 'Nouvelle activité interne'} width={480} onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>Cette activité n’existe plus.</Bloquant> : <>
        {!avant && (
          <Field label="Code" htmlFor="ract-code" requis erreur={codeIncomplet ? v.erreur(erreurs.code) : erreurs.code ?? null}>
            <input className="input" id="ract-code" type="text" autoFocus value={saisi} maxLength={16} placeholder="INT-FORM"
              onChange={e => setSaisi(e.target.value.toUpperCase())} style={{ maxWidth: 200 }} />
          </Field>
        )}
        <Field label="Libellé" htmlFor="ract-nom" requis erreur={nom.trim() ? erreurs.nom ?? null : v.erreur(erreurs.nom)}>
          <input className="input" id="ract-nom" type="text" autoFocus={!!avant} value={nom} maxLength={NOM_ACTIVITE_MAX} placeholder="Formation interne"
            onChange={e => setNom(e.target.value)} />
        </Field>
        <Fine>
          Le code désigne l’activité sur les feuilles de temps et ne change plus. Une activité interne n’est jamais envoyée à Keystone, qui ne reçoit que
          les heures passées sur ses projets.
        </Fine>
      </>}
    </Dialog>
  );
}
