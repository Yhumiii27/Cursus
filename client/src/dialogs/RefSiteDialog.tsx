// Référentiels → Entités et sites (lot 11, chantier C1, étape 2) : nouveau site de rattachement (code de Matrix, choisi
// une fois pour toutes) ou modification du libellé et de l'état. Le cache `sites` reprend matrix.pub_sites ; il est tenu
// à la main tant que Matrix ne le fournit pas. Contrôles partagés avec le serveur (shared/rules/entites.ts, `controlerSite`).
import { useState } from 'react';
import { controlerSite, LIBELLE_SITE_MAX } from '../../../shared/rules/entites.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

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
    <Dialog title={avant ? `${t('Site ')}${avant.libelle}` : t('New site')} width={480} onSubmit={envoyer}
      actions={disparu ? <CancelButton label={t('Close')} /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? t('Save') : t('Add to the reference data')}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>{t('This site no longer exists.')}</Bloquant> : <>
        {!avant && (
          <Field label={t('Code (Matrix)')} htmlFor="rsite-code" requis erreur={tape(saisi, erreurs.code)}>
            <input className="input" id="rsite-code" type="text" autoFocus value={saisi} maxLength={32} placeholder="lab67" autoComplete="off" spellCheck={false}
              onChange={e => setSaisi(e.target.value.toLowerCase())} style={{ maxWidth: 220 }} />
          </Field>
        )}
        <Field label={t('Label')} htmlFor="rsite-libelle" requis erreur={tape(libelle, erreurs.libelle)}>
          <input className="input" id="rsite-libelle" type="text" autoFocus={!!avant} value={libelle} maxLength={LIBELLE_SITE_MAX} placeholder={t('Laboratory 67')}
            onChange={e => setLibelle(e.target.value)} />
        </Field>
        {avant && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={actif} onChange={e => setActif(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
            {t('Active site (offered for attaching teams and entities)')}
          </label>
        )}
        <Fine>{t('The code is that of Matrix’s common reference data (lower-case letters, digits, “_”) and no longer changes. An inactive site stays carried by the teams that already have it.')}</Fine>
      </>}
    </Dialog>
  );
}
