// lot 12 — C4 (organismes de formation et e-learning) : fiche d'un organisme (identité et Qualiopi, droit « formations »),
// nouvelle ou modifiée (son code ne change plus), et conditions commerciales (service RH, dialogue à part). Contrôles
// partagés avec le serveur (shared/rules/organismes.ts : SIRET par clé de Luhn, déclaration d'activité sur 11 chiffres,
// nom usuel unique, SIRET d'une seule fiche). Le nom usuel est recopié sur les formations du catalogue rattachées.
import { useState } from 'react';
import {
  CATEGORIES_QUALIOPI, codePropose, CONDITIONS_MAX, controlerConditions, controlerOrganisme, NOM_ORGANISME_MAX, TYPES_ORGANISME, type ChampOrganisme,
} from '../../../shared/rules/organismes.ts';
import type { CategorieQualiopi } from '../../../shared/types-organismes.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const caseStyle = { accentColor: 'var(--color-accent)' } as const;

export function OrganismeDialog({ id }: { id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog, setUi } = useStore();
  const liste = d.ds.organismes ?? [];
  const [avant] = useState(() => (id != null ? liste.find(o => o.id === id) ?? null : null));
  const [nomUsuel, setNomUsuel] = useState(avant?.nomUsuel ?? '');
  const [code, setCode] = useState('');
  const [raisonSociale, setRaisonSociale] = useState(avant?.raisonSociale ?? '');
  const [type, setType] = useState<string>(avant?.type ?? 'externe');
  const [siret, setSiret] = useState(avant?.siret ?? '');
  const [nda, setNda] = useState(avant?.nda ?? '');
  const [ndaRegion, setNdaRegion] = useState(avant?.ndaRegion ?? '');
  const [qualiopi, setQualiopi] = useState(!!avant?.qualiopi);
  const [categories, setCategories] = useState<CategorieQualiopi[]>(avant?.qualiopiCategories ?? ['formation']);
  const [certificateur, setCertificateur] = useState(avant?.qualiopiCertificateur ?? '');
  const [numero, setNumero] = useState(avant?.qualiopiNumero ?? '');
  const [valide, setValide] = useState(avant?.qualiopiValideJusquau ?? '');
  const [verifie, setVerifie] = useState(avant?.qualiopiVerifieLe ?? '');
  const [adresse, setAdresse] = useState(avant?.adresse ?? '');
  const [siteWeb, setSiteWeb] = useState(avant?.siteWeb ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = id != null && !avant;

  const propose = nomUsuel.trim() ? codePropose(nomUsuel, new Set(liste.map(o => o.code))) : '';
  const champs = {
    nomUsuel, raisonSociale, type, siret, nda, ndaRegion, qualiopi, qualiopiCategories: categories, qualiopiCertificateur: certificateur,
    qualiopiNumero: numero, qualiopiValideJusquau: valide, qualiopiVerifieLe: verifie, adresse, siteWeb,
  };
  const { erreurs } = controlerOrganisme({ ...champs, code: code.trim() || propose }, liste, avant);
  // Champ vide : signalé à l'envoi ; saisie incorrecte : dès la saisie.
  const erreur = (k: ChampOrganisme, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  const basculer = (c: CategorieQualiopi) => setCategories(l => (l.includes(c) ? l.filter(x => x !== c) : [...l, c]));

  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), disparu)) return;
    setBusy(true);
    const r = await run('organisme.enregistrer', avant ? { id: avant.id, ...champs } : { code: code.trim() || propose, ...champs });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    const nouveau = (r.result as { id?: number } | undefined)?.id;
    if (!avant && nouveau) setUi({ orgSel: nouveau, orgFiltre: 'tous' });
  };

  return (
    <Dialog title={avant ? `Organisme ${avant.nomUsuel}` : 'Nouvel organisme de formation'} width={640} tall onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton></>}>
      {disparu ? <Bloquant>Cet organisme n’existe plus.</Bloquant> : <>
        <Field label="Nom usuel" htmlFor="org-nom" requis erreur={erreur('nomUsuel', nomUsuel)}>
          <input className="input" id="org-nom" type="text" autoFocus value={nomUsuel} maxLength={NOM_ORGANISME_MAX} placeholder="Apave" onChange={e => setNomUsuel(e.target.value)} />
        </Field>
        <div className="grid-2">
          {avant
            ? <Field label="Code"><Static pad>{avant.code}</Static></Field>
            : (
              <Field label="Code" htmlFor="org-code" erreur={erreur('code', code)}>
                <input className="input" id="org-code" type="text" value={code} maxLength={32} placeholder={propose || 'd’après le nom usuel'} onChange={e => setCode(e.target.value)} />
              </Field>
            )}
          <Field label="Type" htmlFor="org-type" requis erreur={v.erreur(erreurs.type)}>
            <select className="input" id="org-type" value={type} onChange={e => setType(e.target.value)}>
              {Object.entries(TYPES_ORGANISME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Raison sociale" htmlFor="org-rs" erreur={erreur('raisonSociale', raisonSociale)}>
          <input className="input" id="org-rs" type="text" value={raisonSociale} maxLength={120} onChange={e => setRaisonSociale(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="SIRET" htmlFor="org-siret" erreur={erreur('siret', siret)}>
            <input className="input tnum" id="org-siret" inputMode="numeric" value={siret} maxLength={17} placeholder="14 chiffres" onChange={e => setSiret(e.target.value)} />
          </Field>
          {type !== 'interne' && (
            <Field label="Déclaration d’activité (NDA)" htmlFor="org-nda" erreur={erreur('nda', nda)}>
              <input className="input tnum" id="org-nda" inputMode="numeric" value={nda} maxLength={14} placeholder="11 chiffres" onChange={e => setNda(e.target.value)} />
            </Field>
          )}
        </div>
        {type !== 'interne' && <>
          <Field label="Région de déclaration" htmlFor="org-region" erreur={erreur('ndaRegion', ndaRegion)}>
            <input className="input" id="org-region" type="text" value={ndaRegion} maxLength={80} placeholder="Grand Est" onChange={e => setNdaRegion(e.target.value)} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
            <input type="checkbox" checked={qualiopi} onChange={e => setQualiopi(e.target.checked)} style={caseStyle} />
            Certifié Qualiopi
          </label>
          {qualiopi && <>
            <Field label="Catégories certifiées" erreur={v.erreur(erreurs.qualiopiCategories)}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                {(Object.keys(CATEGORIES_QUALIOPI) as CategorieQualiopi[]).map(c => (
                  <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13 }}>
                    <input type="checkbox" checked={categories.includes(c)} onChange={() => basculer(c)} style={caseStyle} />{CATEGORIES_QUALIOPI[c]}
                  </label>
                ))}
              </div>
            </Field>
            <div className="grid-2">
              <Field label="Certificateur" htmlFor="org-certif" erreur={erreur('qualiopiCertificateur', certificateur)}>
                <input className="input" id="org-certif" type="text" value={certificateur} maxLength={80} placeholder="AFNOR Certification" onChange={e => setCertificateur(e.target.value)} />
              </Field>
              <Field label="Numéro de certificat" htmlFor="org-num" erreur={erreur('qualiopiNumero', numero)}>
                <input className="input" id="org-num" type="text" value={numero} maxLength={40} onChange={e => setNumero(e.target.value)} />
              </Field>
            </div>
            <Field label="Fin de validité" htmlFor="org-valide" erreur={erreur('qualiopiValideJusquau', valide)}>
              <input className="input" id="org-valide" type="date" value={valide} onChange={e => setValide(e.target.value)} />
            </Field>
          </>}
          <Field label="Dernière vérification (liste publique, certificat)" htmlFor="org-verifie" erreur={erreur('qualiopiVerifieLe', verifie)}>
            <input className="input" id="org-verifie" type="date" value={verifie} onChange={e => setVerifie(e.target.value)} />
          </Field>
        </>}
        <Field label="Adresse" htmlFor="org-adresse" erreur={erreur('adresse', adresse)}>
          <input className="input" id="org-adresse" type="text" value={adresse} maxLength={200} onChange={e => setAdresse(e.target.value)} />
        </Field>
        <Field label="Site web" htmlFor="org-web" erreur={erreur('siteWeb', siteWeb)}>
          <input className="input" id="org-web" type="url" inputMode="url" value={siteWeb} maxLength={200} placeholder="https://" onChange={e => setSiteWeb(e.target.value)} />
        </Field>
        <Fine>
          {avant
            ? 'Le nom usuel est recopié sur les formations du catalogue qui désignent cet organisme. '
            : 'Le code identifie la fiche dans le journal (jamais son nom, qui peut être celui d’un formateur indépendant) : il ne change plus. '}
          Sans date de validité, une certification Qualiopi reste « à vérifier ». Qualiopi absent ou échu : avertissement seulement.
        </Fine>
      </>}
    </Dialog>
  );
}

/** Conditions commerciales d'un organisme (service RH) : subrogation, délai d'annulation, texte court. */
export function OrganismeConditionsDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [avant] = useState(() => (d.ds.organismes ?? []).find(o => o.id === id) ?? null);
  const [subrogation, setSubrogation] = useState(!!avant?.subrogationAcceptee);
  const [delai, setDelai] = useState(avant?.delaiAnnulationJours != null ? String(avant.delaiAnnulationJours) : '');
  const [conditions, setConditions] = useState(avant?.conditions ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const champs = { subrogationAcceptee: subrogation, delaiAnnulationJours: delai, conditions };
  const { erreurs } = avant ? controlerConditions(champs, avant) : { erreurs: {} as Record<string, string> };
  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), !avant)) return;
    setBusy(true);
    const r = await run('organisme.conditions', { id, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`Conditions — ${avant?.nomUsuel ?? 'organisme'}`} width={520} onSubmit={envoyer}
      actions={!avant ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>Enregistrer</SubmitButton></>}>
      {!avant ? <Bloquant>Cet organisme n’existe plus.</Bloquant> : <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={subrogation} onChange={e => setSubrogation(e.target.checked)} style={caseStyle} />
          Accepte la subrogation de paiement (l’OPCO le paie directement)
        </label>
        <Field label="Délai d’annulation sans frais (jours)" htmlFor="org-delai" erreur={delai.trim() ? erreurs.delaiAnnulationJours ?? null : null}>
          <input className="input tnum" id="org-delai" type="number" inputMode="numeric" min={0} max={365} step={1} value={delai} onChange={e => setDelai(e.target.value)} />
        </Field>
        <Field label="Conditions (paiement, annulation…)" htmlFor="org-cond" erreur={erreurs.conditions ?? null}>
          <textarea className="input" id="org-cond" rows={3} value={conditions} maxLength={CONDITIONS_MAX} onChange={e => setConditions(e.target.value)}
            placeholder="Paiement à 30 jours, annulation facturée 50 % sous 10 jours…" />
        </Field>
        <Fine>Données commerciales tenues par le service RH ; lisibles du référent formation et de la lecture seule, jamais recopiées au journal.</Fine>
      </>}
    </Dialog>
  );
}
