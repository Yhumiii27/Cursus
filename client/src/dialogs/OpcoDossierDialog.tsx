// lot 11 — dossiers OPCO : création d'un dossier depuis une ligne du plan (`opco.creer`), ou modification de ses champs
// (`opco.modifier`). À la création, les champs sont proposés d'après la ligne (dates des sessions rattachées, durée du
// catalogue, effectif, coût retenu) et les réglages (OPCO, subrogation) ; tout reste modifiable. Une fois le dossier déposé,
// une modification est une correction : motif obligatoire, gardé au service RH. Contrôles : shared/rules/opco.ts
// (`controlerSaisieOpco`), les mêmes que ceux du serveur.
import { useState } from 'react';
import { fmtEur } from '../../../shared/format.ts';
import {
  controlerSaisieOpco, DISPOSITIFS_OPCO, LISTE_DISPOSITIFS, CODES_OPCO, OPCOS, propositionDossier, type SaisieOpco,
} from '../../../shared/rules/opco.ts';
import type { CodeOpco, DispositifOpco } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { erreurTexte } from '../components/controles.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { AIDE_MOTIF_OPCO } from '../state/confirmations-opco.ts';
import { MOTIF_MAX } from '../state/confirmations.ts';

/** Nombre affiché dans un champ (virgule décimale), vide pour null. */
const champ = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export function OpcoDossierDialog({ planActionId, id }: { planActionId?: number | null; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog, setUi } = useStore();
  const dossier = id != null ? (d.ds.dossiersOpco ?? []).find(x => x.id === id) ?? null : null;
  const l = d.ds.plan.find(x => x.id === (dossier?.planActionId ?? planActionId)) ?? null;
  const fm = l?.f ? d.fm(l.f) : null;
  const s = d.ds.settings;
  const [v0] = useState(() => {
    if (dossier) return dossier;
    const p = l ? propositionDossier(l, d.ds.sessions, fm?.dureeHeures) : null;
    return {
      opco: s.opcoDefaut, dispositif: 'plan' as DispositifOpco, reference: null, du: p?.du ?? null, au: p?.au ?? null, heures: p?.heures ?? null,
      effectif: p?.effectif ?? null, montantDemande: p?.montantDemande ?? null, montantDemandeAnnexes: null, subrogation: s.opcoSubrogation,
      organismeSiret: null, organismeNda: null, organismeQualiopi: false,
    };
  });
  const [opco, setOpco] = useState<CodeOpco>(v0.opco);
  const [dispositif, setDispositif] = useState<DispositifOpco>(v0.dispositif);
  const [reference, setReference] = useState(v0.reference ?? '');
  const [du, setDu] = useState(v0.du ?? '');
  const [au, setAu] = useState(v0.au ?? '');
  const [heures, setHeures] = useState(champ(v0.heures));
  const [effectif, setEffectif] = useState(champ(v0.effectif));
  const [montant, setMontant] = useState(champ(v0.montantDemande));
  const [annexes, setAnnexes] = useState(champ(v0.montantDemandeAnnexes));
  const [subrogation, setSubrogation] = useState(v0.subrogation);
  const [siret, setSiret] = useState(v0.organismeSiret ?? '');
  const [nda, setNda] = useState(v0.organismeNda ?? '');
  const [qualiopi, setQualiopi] = useState(v0.organismeQualiopi);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!l || (id != null && !dossier)) return null;

  const correction = !!dossier && dossier.statut !== 'a_deposer';
  const annexesPermises = DISPOSITIFS_OPCO[dispositif].annexes;
  const saisie: SaisieOpco = {
    opco, dispositif, reference, du, au, heures, effectif, montantDemande: montant, montantDemandeAnnexes: annexesPermises ? annexes : '',
    subrogation, organismeSiret: siret, organismeNda: nda, organismeQualiopi: qualiopi,
  };
  const { erreurs } = controlerSaisieOpco(saisie);
  const motifErr = correction ? erreurTexte(motif, 'Indiquez le motif de la correction.') ?? (motif.trim().length > MOTIF_MAX ? `${MOTIF_MAX} caractères au plus.` : null) : null;
  // Erreur d'un champ : dès la saisie (valeur mal écrite), toutes après une première tentative.
  const err = (k: keyof SaisieOpco) => erreurs[k] ?? null;

  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), motifErr)) return;
    setBusy(true);
    const champs = {
      opco, dispositif, reference: reference.trim(), du, au, heures: heures.trim(), effectif: effectif.trim(), montantDemande: montant.trim(),
      montantDemandeAnnexes: annexesPermises ? annexes.trim() : '', subrogation, organismeSiret: siret.trim(), organismeNda: nda.trim(),
      organismeQualiopi: qualiopi,
    };
    const r = dossier
      ? await run('opco.modifier', { id: dossier.id, ...champs, ...(correction ? { motif: motif.trim() } : {}) })
      : await run('opco.creer', { planActionId: l.id, ...champs });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    // Nouveau dossier : ouvert dans l'onglet des dossiers OPCO.
    const nouveau = (r.result as { id?: number } | undefined)?.id;
    if (!dossier && nouveau) setUi({ budgetOnglet: 'opco', opcoSel: nouveau, exercice: l.exercice, opcoFiltre: 'tous', opcoCode: null, opcoDispositif: null });
  };

  return (
    <Dialog title={dossier ? (correction ? 'Corriger le dossier OPCO' : 'Modifier le dossier OPCO') : 'Nouveau dossier OPCO'} width={620} tall onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{dossier ? (correction ? 'Corriger le dossier' : 'Enregistrer') : 'Créer le dossier'}</SubmitButton>
    </>}>
      <Field label="Action du plan">
        <Static>{fm ? fm.nom : l.libelle}<div className="text-muted sub">{l.equipe} · {l.periode} {l.exercice} · {fmtEur(l.coutReel ?? l.cout)} pour {l.effectifReel ?? l.effectif} pers.{fm ? ` · ${fm.organisme}` : ''}</div></Static>
      </Field>
      <div className="grid-2">
        <Field label="OPCO" htmlFor="opco-code" requis erreur={v.erreur(err('opco'))}>
          <select className="input" id="opco-code" value={opco} onChange={e => setOpco(e.target.value as CodeOpco)}>
            {CODES_OPCO.map(c => <option key={c} value={c}>{OPCOS[c]}</option>)}
          </select>
        </Field>
        <Field label="Dispositif" htmlFor="opco-dispositif" requis erreur={v.erreur(err('dispositif'))}>
          <select className="input" id="opco-dispositif" value={dispositif} onChange={e => setDispositif(e.target.value as DispositifOpco)}>
            {LISTE_DISPOSITIFS.map(x => <option key={x} value={x}>{DISPOSITIFS_OPCO[x].label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Numéro du dossier chez l’OPCO" htmlFor="opco-reference" erreur={reference.trim() ? err('reference') : null}>
        <input className="input" id="opco-reference" value={reference} placeholder="Attribué au dépôt sur le portail" onChange={e => setReference(e.target.value)} autoComplete="off" />
      </Field>
      <div className="grid-2">
        <Field label="Formation du" htmlFor="opco-du" erreur={err('du')}>
          <input className="input" id="opco-du" type="date" value={du} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label="Au" htmlFor="opco-au" erreur={err('au')}>
          <input className="input" id="opco-au" type="date" min={du || undefined} value={au} onChange={e => setAu(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Heures de formation" htmlFor="opco-heures" erreur={heures.trim() ? err('heures') : null}>
          <input className="input tnum" id="opco-heures" inputMode="decimal" value={heures} onChange={e => setHeures(e.target.value)} />
        </Field>
        <Field label="Effectif" htmlFor="opco-effectif" erreur={effectif.trim() ? err('effectif') : null}>
          <input className="input tnum" id="opco-effectif" inputMode="numeric" value={effectif} onChange={e => setEffectif(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Coûts pédagogiques demandés (€)" htmlFor="opco-montant" erreur={montant.trim() ? err('montantDemande') : null}>
          <input className="input tnum" id="opco-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} />
        </Field>
        {annexesPermises && (
          <Field label="Frais annexes ou rémunération (€)" htmlFor="opco-annexes" erreur={annexes.trim() ? err('montantDemandeAnnexes') : null}>
            <input className="input tnum" id="opco-annexes" inputMode="decimal" value={annexes} onChange={e => setAnnexes(e.target.value)} />
          </Field>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={subrogation} onChange={e => setSubrogation(e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Subrogation : l’OPCO paie directement l’organisme de formation</span>
      </label>
      <div className="grid-2">
        <Field label="SIRET de l’organisme" htmlFor="opco-siret" erreur={siret.trim() ? err('organismeSiret') : null}>
          <input className="input tnum" id="opco-siret" inputMode="numeric" value={siret} placeholder="14 chiffres" onChange={e => setSiret(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Déclaration d’activité (NDA)" htmlFor="opco-nda" erreur={nda.trim() ? err('organismeNda') : null}>
          <input className="input tnum" id="opco-nda" inputMode="numeric" value={nda} placeholder="11 chiffres" onChange={e => setNda(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={qualiopi} onChange={e => setQualiopi(e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>Organisme certifié Qualiopi (condition de la prise en charge)</span>
      </label>
      {correction && (
        <Field label="Motif de la correction" htmlFor="opco-motif" requis erreur={v.erreur(motifErr) || (motif.trim().length > MOTIF_MAX ? motifErr : null)}>
          <textarea className="input" id="opco-motif" rows={2} value={motif} placeholder="Numéro mal recopié, dates de la formation déplacées…" onChange={e => setMotif(e.target.value)} />
        </Field>
      )}
      <Fine>
        {correction ? `${AIDE_MOTIF_OPCO} ` : ''}
        {dossier ? '' : 'Le dossier commence « À déposer » : ses échéances (dépôt avant le début, justificatifs après la fin) partent des dates de la formation. '}
        Saisie à reporter aussi sur le portail de l’OPCO : Cursus ne s’y connecte pas.
      </Fine>
    </Dialog>
  );
}
