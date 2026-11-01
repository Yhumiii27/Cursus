// Référentiels → Entités et sites (lot 11, chantier C1, étape 2) : nouveau site de rattachement (code de Matrix, choisi
// une fois pour toutes) ou modification du libellé et de l'état. Le cache `sites` reprend matrix.pub_sites ; il est tenu
// à la main tant que Matrix ne le fournit pas. Contrôles partagés avec le serveur (shared/rules/entites.ts, `controlerSite`).
import { useState } from 'react';
import { controlerSite, LIBELLE_SITE_MAX } from '../../../shared/rules/entites.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefSiteDialog({ code }: { code?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const sites = d.ds.referentiels.sites ?? [];
  const [avant] = useState(() => (code ? sites.find(s => s.code === code) ?? null : null));
  const [saisi, setSaisi] = useState('');
  const [libelle, setLibelle] = useState(avant?.libelle ?? '');
  const [actif, setActif] = useState(avant?.actif ?? true);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !!code && !avant;
  const { erreurs } = controlerSite({ code: saisi, libelle, actif }, sites, avant);
  const tape = (s: string, e: string | undefined) => (s.trim() ? e ?? null : v.erreur(e));

  const envoyer = async () => {
    if (busy || !v.verifier(avant ? null : erreurs.code, erreurs.libelle, disparu)) return;
    setBusy(true);
    const r = await run('site.enregistrer', avant ? { id: avant.code, libelle, actif } : { code: saisi, libelle, actif });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={avant ? `Site ${avant.libelle}` : 'Nouveau site'} width={480} onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>Ce site n’existe plus.</Bloquant> : <>
        {!avant && (
          <Field label="Code (Matrix)" htmlFor="rsite-code" requis erreur={tape(saisi, erreurs.code)}>
            <input className="input" id="rsite-code" type="text" autoFocus value={saisi} maxLength={32} placeholder="lab67" autoComplete="off" spellCheck={false}
              onChange={e => setSaisi(e.target.value.toLowerCase())} style={{ maxWidth: 220 }} />
          </Field>
        )}
        <Field label="Libellé" htmlFor="rsite-libelle" requis erreur={tape(libelle, erreurs.libelle)}>
          <input className="input" id="rsite-libelle" type="text" autoFocus={!!avant} value={libelle} maxLength={LIBELLE_SITE_MAX} placeholder="Laboratoire 67"
            onChange={e => setLibelle(e.target.value)} />
        </Field>
        {avant && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={actif} onChange={e => setActif(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
            Site actif (proposé au rattachement des équipes et des entités)
          </label>
        )}
        <Fine>Le code est celui du référentiel commun de Matrix (lettres minuscules, chiffres, « _ ») et ne change plus. Un site inactif reste porté par les équipes qui l’ont déjà.</Fine>
      </>}
    </Dialog>
  );
}
