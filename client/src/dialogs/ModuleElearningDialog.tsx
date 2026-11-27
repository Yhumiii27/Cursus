// lot 12 — C4 (organismes de formation et e-learning) : module d'e-learning, nouveau ou modifié (son code ne change
// plus), droit « formations ». Lien d'accès en https seulement (ouvert hors de Cursus, jamais dans un cadre) ; formation du
// catalogue facultative, dont l'achèvement produit la certification. Contrôles partagés avec le serveur
// (shared/rules/elearning.ts, `controlerModule`).
import { useState } from 'react';
import { ACCES_MOIS_MAX, controlerModule, INTITULE_MODULE_MAX, LANGUES_MODULE, URL_MODULE_MAX, type ChampModule } from '../../../shared/rules/elearning.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ChoixOrganisme } from '../components/organismes/ChoixOrganisme.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function ModuleElearningDialog({ id }: { id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const liste = d.ds.modulesElearning ?? [];
  const [avant] = useState(() => (id != null ? liste.find(m => m.id === id) ?? null : null));
  const [code, setCode] = useState('');
  const [intitule, setIntitule] = useState(avant?.intitule ?? '');
  const [organismeId, setOrganismeId] = useState(avant?.organismeId != null ? String(avant.organismeId) : '');
  const [formation, setFormation] = useState(avant?.formation ?? '');
  const [url, setUrl] = useState(avant?.url ?? '');
  const [duree, setDuree] = useState(avant?.dureeHeures != null ? String(avant.dureeHeures) : '');
  const [langue, setLangue] = useState(avant?.langue ?? 'fr');
  const [cout, setCout] = useState(avant?.coutLicence != null ? String(avant.coutLicence) : '');
  const [acces, setAcces] = useState(avant?.accesMois != null ? String(avant.accesMois) : '');
  const [attestation, setAttestation] = useState(!!avant?.attestationRequise);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = id != null && !avant;
  const champs = { intitule, organismeId, formation, url: url.trim(), dureeHeures: duree, langue, coutLicence: cout, accesMois: acces, attestationRequise: attestation };
  const { erreurs } = controlerModule({ ...champs, code }, liste, d.ds.referentiels.formations, d.ds.organismes ?? [], avant);
  const erreur = (k: ChampModule, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  const catalogue = d.ds.referentiels.formations.filter(f => !f.archive || f.id === avant?.formation);
  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), disparu)) return;
    setBusy(true);
    const r = await run('elearning.module.enregistrer', avant ? { id: avant.id, ...champs } : { code, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={avant ? `${t('Module ')}${avant.code}` : t('New e-learning module')} width={600} tall onSubmit={envoyer}
      actions={disparu ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? t('Save') : t('Add the module')}</SubmitButton></>}>
      {disparu ? <Bloquant>{t('This module no longer exists.')}</Bloquant> : <>
        <Field label={t('Title#heading')} htmlFor="me-intitule" requis erreur={erreur('intitule', intitule)}>
          <input className="input" id="me-intitule" type="text" autoFocus value={intitule} maxLength={INTITULE_MODULE_MAX} placeholder={t('Chemical risk — the basics')} onChange={e => setIntitule(e.target.value)} />
        </Field>
        <div className="grid-2">
          {avant
            ? <Field label={t('Code')}><Static pad>{avant.code}</Static></Field>
            : (
              <Field label={t('Code')} htmlFor="me-code" requis erreur={erreur('code', code)}>
                <input className="input" id="me-code" type="text" value={code} maxLength={32} placeholder="CHIM-BASES" onChange={e => setCode(e.target.value)} />
              </Field>
            )}
          <Field label={t('Language')} htmlFor="me-langue" requis erreur={v.erreur(erreurs.langue)}>
            <select className="input" id="me-langue" value={langue} onChange={e => setLangue(e.target.value)}>
              {Object.entries(LANGUES_MODULE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('Access link (https)')} htmlFor="me-url" requis erreur={erreur('url', url)}>
          <input className="input" id="me-url" type="url" inputMode="url" value={url} maxLength={URL_MODULE_MAX} placeholder="https://formation.exemple.fr/module" onChange={e => setUrl(e.target.value)} />
        </Field>
        <ChoixOrganisme id="me-organisme" valeur={organismeId} onChange={setOrganismeId} actuel={avant?.organismeId ?? null} vide={t('None (internal module)')} erreur={v.erreur(erreurs.organismeId)} />
        <Field label={t('Catalogue training course validated at the end')} htmlFor="me-formation" erreur={v.erreur(erreurs.formation)}>
          <select className="input" id="me-formation" value={formation} onChange={e => setFormation(e.target.value)}>
            <option value="">{t('None (training followed outside the catalogue)')}</option>
            {catalogue.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label={t('Duration (hours)')} htmlFor="me-duree" erreur={erreur('dureeHeures', duree)}>
            <input className="input tnum" id="me-duree" inputMode="decimal" value={duree} placeholder="2" onChange={e => setDuree(e.target.value)} />
          </Field>
          <Field label={t('Validity of the access (months)')} htmlFor="me-acces" erreur={erreur('accesMois', acces)}>
            <input className="input tnum" id="me-acces" type="number" inputMode="numeric" min={1} max={ACCES_MOIS_MAX} step={1} value={acces} placeholder={t('without limit')} onChange={e => setAcces(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Cost of a licence (€ excl. VAT)')} htmlFor="me-cout" erreur={erreur('coutLicence', cout)}>
          <input className="input tnum" id="me-cout" inputMode="decimal" value={cout} placeholder="0" onChange={e => setCout(e.target.value)} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={attestation} onChange={e => setAttestation(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {t('End certificate required (never an automatic end on import)')}
        </label>
        <Fine>
          {t('The link opens in a new tab, at the provider: Cursus integrates no platform. The end of a module attached to the catalogue, approved by HR, creates the certification; the hours count in the plan and the indicators, never on the timesheet.')}
        </Fine>
      </>}
    </Dialog>
  );
}
