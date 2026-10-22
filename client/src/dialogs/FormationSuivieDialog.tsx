// Formation suivie par un collaborateur (t116, shared/rules/formations-suivies.ts) : saisie directe par le service RH ou
// le référent HSE, du catalogue ou hors catalogue ; clôture d'une demande hors catalogue acceptée (`demandeId` : intitulé
// repris) ; correction d'une saisie (`id`, motif obligatoire). Une formation hors catalogue est « non obligatoire » par
// défaut : elle compte alors pour l'état des lieux du bilan à 8 ans. Contrôles partagés avec le serveur.
import { useState } from 'react';
import { MOTIF_CORRECTION_MAX } from '../../../shared/rules/corrections.ts';
import { controlerSuivie, LIBELLE_SUIVIE_MAX, obligatoireParDefaut, ORGANISME_SUIVIE_MAX, suiviesEnVigueur } from '../../../shared/rules/formations-suivies.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { AIDE_MOTIF_CORRECTION } from '../state/confirmations-corrections.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Valeur du sélecteur pour une formation hors catalogue. */
const HORS = '';

export function FormationSuivieDialog({ empId, id, demandeId }: { empId: number; id?: number | null; demandeId?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const [avant] = useState(() => (id ? suiviesEnVigueur(d.ds).find(x => x.id === id) ?? null : null));
  const demande = demandeId ? d.ds.demandesCollab.find(r => r.id === demandeId) ?? null : null;
  const [f, setF] = useState(avant?.f ?? HORS);
  const [libelle, setLibelle] = useState(avant?.libelle ?? demande?.libelle ?? '');
  const [du, setDu] = useState(avant?.du ?? '');
  const [au, setAu] = useState(avant?.au ?? '');
  const [duree, setDuree] = useState(avant?.duree != null ? String(avant.duree) : '');
  const [organisme, setOrganisme] = useState(avant?.organisme ?? '');
  const [obligatoire, setObligatoire] = useState<boolean | null>(avant ? avant.obligatoire : null);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || (id && !avant)) return null;

  // Catalogue en vigueur, et la formation de la ligne corrigée même archivée depuis.
  const catalogue = d.ds.referentiels.formations.filter(x => actif(x) || x.id === avant?.f);
  const fm = f ? d.fm(f) : null;
  // Case « obligatoire » : la valeur par défaut de la formation tant qu'elle n'a pas été touchée.
  const oblig = obligatoire ?? obligatoireParDefaut(fm);
  const { erreurs, valeur } = controlerSuivie(d, { f, libelle, du, au, duree, organisme, obligatoire: oblig }, avant);
  const motifErr = avant && !motif.trim() ? 'Indiquez le motif de la correction.' : null;
  const erreur = (k: keyof typeof erreurs, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));

  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), motifErr) || !valeur) return;
    setBusy(true);
    const champs = { f, libelle: f ? '' : libelle.trim(), du, au: au || du, duree: duree.trim().replace(',', '.'), organisme: organisme.trim(), obligatoire: oblig };
    const r = avant
      ? await run('formationSuivie.modifier', { id: avant.id, ...champs, motif: motif.trim() })
      : await run('formationSuivie.enregistrer', { empId, ...champs, ...(demande ? { demandeId: demande.id } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={avant ? 'Corriger la formation suivie' : 'Enregistrer une formation suivie'} width={600} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{avant ? 'Enregistrer la correction' : 'Enregistrer'}</SubmitButton>
    </>}>
      <Field label="Collaborateur"><Static>{emp.nom}{demande ? <div className="text-muted sub">Demande hors catalogue acceptée : {demande.libelle}</div> : null}</Static></Field>
      <Field label="Formation" htmlFor="fs-f" erreur={v.erreur(erreurs.f)}>
        <select className="input" id="fs-f" value={f} onChange={e => { setF(e.target.value); setObligatoire(null); }}>
          <option value={HORS}>Hors catalogue</option>
          {catalogue.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
      </Field>
      {!f && (
        <Field label="Intitulé" htmlFor="fs-libelle" requis erreur={erreur('libelle', libelle)}>
          <input className="input" id="fs-libelle" type="text" value={libelle} maxLength={LIBELLE_SUIVIE_MAX} placeholder="Anglais technique, conduite de réunion…" onChange={e => setLibelle(e.target.value)} />
        </Field>
      )}
      <div className="grid-2">
        <Field label="Du" htmlFor="fs-du" requis erreur={erreur('du', du)}>
          <input className="input" id="fs-du" type="date" max={d.ti} value={du} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label="Au" htmlFor="fs-au" erreur={erreur('au', au)}>
          <input className="input" id="fs-au" type="date" min={du || undefined} max={d.ti} value={au} placeholder={du} onChange={e => setAu(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Durée (heures)" htmlFor="fs-duree" erreur={erreur('duree', duree)}>
          <input className="input tnum" id="fs-duree" inputMode="decimal" value={duree} placeholder={fm?.dureeHeures != null ? `${fm.dureeHeures} (catalogue)` : '14'} onChange={e => setDuree(e.target.value)} />
        </Field>
        <Field label="Organisme" htmlFor="fs-organisme" erreur={erreur('organisme', organisme)}>
          <input className="input" id="fs-organisme" type="text" value={organisme} maxLength={ORGANISME_SUIVIE_MAX} placeholder={fm?.organisme || 'Organisme de formation'} onChange={e => setOrganisme(e.target.value)} />
        </Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
        <input type="checkbox" checked={oblig} onChange={e => setObligatoire(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
        Formation obligatoire (exigée par une règle ou une convention)
      </label>
      {avant && (
        <Field label="Motif de la correction" htmlFor="fs-motif" requis erreur={v.erreur(motifErr)}>
          <textarea className="input mid" id="fs-motif" rows={2} maxLength={MOTIF_CORRECTION_MAX} placeholder="Dates mal recopiées, durée erronée…" value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
      )}
      <Fine>
        Une formation non obligatoire compte pour l’état des lieux du bilan à 8 ans (formation autre que réglementaire). Sans durée
        saisie, celle du catalogue s’applique ; sans l’une ni l’autre, la formation compte « durée inconnue » dans les indicateurs.
        {avant ? ` ${AIDE_MOTIF_CORRECTION}` : ''}
      </Fine>
    </Dialog>
  );
}
