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
    <Dialog title={avant ? `Module ${avant.code}` : 'Nouveau module d’e-learning'} width={600} tall onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter le module'}</SubmitButton></>}>
      {disparu ? <Bloquant>Ce module n’existe plus.</Bloquant> : <>
        <Field label="Intitulé" htmlFor="me-intitule" requis erreur={erreur('intitule', intitule)}>
          <input className="input" id="me-intitule" type="text" autoFocus value={intitule} maxLength={INTITULE_MODULE_MAX} placeholder="Risque chimique — les bases" onChange={e => setIntitule(e.target.value)} />
        </Field>
        <div className="grid-2">
          {avant
            ? <Field label="Code"><Static pad>{avant.code}</Static></Field>
            : (
              <Field label="Code" htmlFor="me-code" requis erreur={erreur('code', code)}>
                <input className="input" id="me-code" type="text" value={code} maxLength={32} placeholder="CHIM-BASES" onChange={e => setCode(e.target.value)} />
              </Field>
            )}
          <Field label="Langue" htmlFor="me-langue" requis erreur={v.erreur(erreurs.langue)}>
            <select className="input" id="me-langue" value={langue} onChange={e => setLangue(e.target.value)}>
              {Object.entries(LANGUES_MODULE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Lien d’accès (https)" htmlFor="me-url" requis erreur={erreur('url', url)}>
          <input className="input" id="me-url" type="url" inputMode="url" value={url} maxLength={URL_MODULE_MAX} placeholder="https://formation.exemple.fr/module" onChange={e => setUrl(e.target.value)} />
        </Field>
        <ChoixOrganisme id="me-organisme" valeur={organismeId} onChange={setOrganismeId} actuel={avant?.organismeId ?? null} vide="Aucun (module interne)" erreur={v.erreur(erreurs.organismeId)} />
        <Field label="Formation du catalogue validée à la fin" htmlFor="me-formation" erreur={v.erreur(erreurs.formation)}>
          <select className="input" id="me-formation" value={formation} onChange={e => setFormation(e.target.value)}>
            <option value="">Aucune (formation suivie hors catalogue)</option>
            {catalogue.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Durée (heures)" htmlFor="me-duree" erreur={erreur('dureeHeures', duree)}>
            <input className="input tnum" id="me-duree" inputMode="decimal" value={duree} placeholder="2" onChange={e => setDuree(e.target.value)} />
          </Field>
          <Field label="Validité de l’accès (mois)" htmlFor="me-acces" erreur={erreur('accesMois', acces)}>
            <input className="input tnum" id="me-acces" type="number" inputMode="numeric" min={1} max={ACCES_MOIS_MAX} step={1} value={acces} placeholder="sans limite" onChange={e => setAcces(e.target.value)} />
          </Field>
        </div>
        <Field label="Coût d’une licence (€ HT)" htmlFor="me-cout" erreur={erreur('coutLicence', cout)}>
          <input className="input tnum" id="me-cout" inputMode="decimal" value={cout} placeholder="0" onChange={e => setCout(e.target.value)} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={attestation} onChange={e => setAttestation(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          Attestation de fin exigée (jamais de fin automatique à l’import)
        </label>
        <Fine>
          Le lien s’ouvre dans un nouvel onglet, chez l’organisme : Cursus n’intègre aucune plateforme. La fin d’un module rattaché au catalogue, validée par
          le service RH, crée la certification ; les heures comptent dans le plan et les indicateurs, jamais sur la feuille de temps.
        </Fine>
      </>}
    </Dialog>
  );
}
