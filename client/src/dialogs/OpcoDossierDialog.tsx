// lot 11 — dossiers OPCO : création d'un dossier depuis une ligne du plan (`opco.creer`), ou modification de ses champs
// (`opco.modifier`). À la création, les champs sont proposés d'après la ligne (dates des sessions rattachées, durée du
// catalogue, effectif, coût retenu) et les réglages (OPCO, subrogation) ; tout reste modifiable. Une fois le dossier déposé,
// une modification est une correction : motif obligatoire, gardé au service RH. Contrôles : shared/rules/opco.ts
// (`controlerSaisieOpco`), les mêmes que ceux du serveur.
import { useState } from 'react';
import { fmtEur } from '../../../shared/format.ts';
import {
  controlerSaisieOpco, DISPOSITIFS_OPCO, dossierActif, dossiersDeLaLigne, LISTE_DISPOSITIFS, CODES_OPCO, OPCOS, propositionDossier, STATUTS_OPCO, type SaisieOpco,
} from '../../../shared/rules/opco.ts';
import type { CodeOpco, DispositifOpco } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { erreurTexte } from '../components/controles.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { aideMotifOpco } from '../state/confirmations-opco.ts';
import { MOTIF_MAX } from '../state/confirmations.ts';
// lot 12 — C4 (organismes de formation et e-learning) : organisme du dossier (fiche), qui préremplit SIRET, NDA et Qualiopi.
import { ChoixOrganisme } from '../components/organismes/ChoixOrganisme.tsx';
import { organismeDuPlan, organismeFinal, qualiopiValideLe } from '../../../shared/rules/organismes.ts';
import type { Organisme } from '../../../shared/types-organismes.ts';
import { t } from '../i18n/langue.ts';

/** lot 12 — C4 : SIRET, NDA et Qualiopi (valide à la date `le`) proposés par une fiche ; vides sans fiche. */
const declaresPar = (o: Organisme | null, le: string) => ({ organismeSiret: o?.siret ?? null, organismeNda: o?.nda ?? null, organismeQualiopi: !!o && qualiopiValideLe(o, le) });

/** Nombre affiché dans un champ (virgule décimale), vide pour null. */
const champ = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export function OpcoDossierDialog({ planActionId, id }: { planActionId?: number | null; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog, setUi } = useStore();
  const dossier = id != null ? (d.ds.dossiersOpco ?? []).find(x => x.id === id) ?? null : null;
  const l = d.ds.plan.find(x => x.id === (dossier?.planActionId ?? planActionId)) ?? null;
  const fm = l?.f ? d.fm(l.f) : null;
  const s = d.ds.settings;
  // lot 12 — C4 : à la création, organisme de la ligne du plan (ou du catalogue), modifiable ; ensuite, celui du dossier.
  const ficheDe = (id: number | null | undefined) => organismeFinal(d.ds.organismes, id);
  const organismeDefaut = l ? organismeDuPlan(d.ds, l) : null;
  const [organismeId, setOrganismeId] = useState(organismeDefaut ? String(organismeDefaut.id) : '');
  const [v0] = useState(() => {
    if (dossier) return dossier;
    const p = l ? propositionDossier(l, d.ds.sessions, fm?.dureeHeures) : null;
    return {
      opco: s.opcoDefaut, dispositif: 'plan' as DispositifOpco, reference: null, du: p?.du ?? null, au: p?.au ?? null, heures: p?.heures ?? null,
      effectif: p?.effectif ?? null, montantDemande: p?.montantDemande ?? null, montantDemandeAnnexes: null, subrogation: s.opcoSubrogation,
      ...declaresPar(organismeDefaut, p?.du ?? d.ti),
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
  // lot 12 — C4 : autre fiche choisie à la création → ses SIRET, NDA et Qualiopi remplacent ceux proposés (tout reste modifiable).
  const choisirOrganisme = (v: string) => {
    setOrganismeId(v);
    const x = declaresPar(ficheDe(Number(v) || null), du || d.ti);
    setSiret(x.organismeSiret ?? ''); setNda(x.organismeNda ?? ''); setQualiopi(x.organismeQualiopi);
  };
  const ficheDossier = dossier ? ficheDe(dossier.organismeId) ?? organismeDefaut : null;

  const correction = !!dossier && dossier.statut !== 'a_deposer';
  // Création d'un second dossier sur la ligne (autre dispositif ou autre financeur) : admise, avec un avertissement quand un
  // dossier actif du même dispositif existe déjà (risque de doublon).
  const memeDispositif = dossier ? [] : dossiersDeLaLigne(d.ds.dossiersOpco, l.id).filter(x => dossierActif(x) && x.dispositif === dispositif);
  const annexesPermises = DISPOSITIFS_OPCO[dispositif].annexes;
  const saisie: SaisieOpco = {
    opco, dispositif, reference, du, au, heures, effectif, montantDemande: montant, montantDemandeAnnexes: annexesPermises ? annexes : '',
    subrogation, organismeSiret: siret, organismeNda: nda, organismeQualiopi: qualiopi,
  };
  const { erreurs } = controlerSaisieOpco(saisie);
  const motifErr = correction ? erreurTexte(motif, t('Enter the reason for the correction.')) ?? (motif.trim().length > MOTIF_MAX ? t(`${MOTIF_MAX} characters at most.`) : null) : null;
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
      : await run('opco.creer', { planActionId: l.id, ...champs, /* lot 12 — C4 */ organismeId });
    setBusy(false);
    if (!r.ok) return;
    closeDialog();
    // Nouveau dossier : ouvert dans l'onglet des dossiers OPCO.
    const nouveau = (r.result as { id?: number } | undefined)?.id;
    if (!dossier && nouveau) setUi({ budgetOnglet: 'opco', opcoSel: nouveau, exercice: l.exercice, opcoFiltre: 'tous', opcoCode: null, opcoDispositif: null });
  };

  return (
    <Dialog title={t(dossier ? (correction ? 'Correct the OPCO file' : 'Edit the OPCO file') : 'New OPCO file')} width={620} tall onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(dossier ? (correction ? 'Correct the file' : 'Save') : 'Create the file')}</SubmitButton>
    </>}>
      <Field label={t('Action of the plan')}>
        <Static>{fm ? fm.nom : l.libelle}<div className="text-muted sub">{l.equipe} · {l.periode} {l.exercice} · {fmtEur(l.coutReel ?? l.cout)}{t(' for ')}{l.effectifReel ?? l.effectif}{t(' pers.')}{fm ? ` · ${fm.organisme}` : ''}</div></Static>
      </Field>
      <div className="grid-2">
        <Field label="OPCO" htmlFor="opco-code" requis erreur={v.erreur(err('opco'))}>
          <select className="input" id="opco-code" value={opco} onChange={e => setOpco(e.target.value as CodeOpco)}>
            {CODES_OPCO.map(c => <option key={c} value={c}>{OPCOS[c]}</option>)}
          </select>
        </Field>
        <Field label={t('Scheme')} htmlFor="opco-dispositif" requis erreur={v.erreur(err('dispositif'))}>
          <select className="input" id="opco-dispositif" value={dispositif} onChange={e => setDispositif(e.target.value as DispositifOpco)}>
            {LISTE_DISPOSITIFS.map(x => <option key={x} value={x}>{DISPOSITIFS_OPCO[x].label}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('Number of the file at the OPCO')} htmlFor="opco-reference" erreur={reference.trim() ? err('reference') : null}>
        <input className="input" id="opco-reference" value={reference} placeholder={t('Given at the filing on the portal')} onChange={e => setReference(e.target.value)} autoComplete="off" />
      </Field>
      <div className="grid-2">
        <Field label={t('Training from')} htmlFor="opco-du" erreur={err('du')}>
          <input className="input" id="opco-du" type="date" value={du} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label={t('To#date-cap')} htmlFor="opco-au" erreur={err('au')}>
          <input className="input" id="opco-au" type="date" min={du || undefined} value={au} onChange={e => setAu(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('Training hours')} htmlFor="opco-heures" erreur={heures.trim() ? err('heures') : null}>
          <input className="input tnum" id="opco-heures" inputMode="decimal" value={heures} onChange={e => setHeures(e.target.value)} />
        </Field>
        <Field label={t('Headcount')} htmlFor="opco-effectif" erreur={effectif.trim() ? err('effectif') : null}>
          <input className="input tnum" id="opco-effectif" inputMode="numeric" value={effectif} onChange={e => setEffectif(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('Teaching costs requested (€)')} htmlFor="opco-montant" erreur={montant.trim() ? err('montantDemande') : null}>
          <input className="input tnum" id="opco-montant" inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} />
        </Field>
        {annexesPermises && (
          <Field label={t('Ancillary costs or pay (€)')} htmlFor="opco-annexes" erreur={annexes.trim() ? err('montantDemandeAnnexes') : null}>
            <input className="input tnum" id="opco-annexes" inputMode="decimal" value={annexes} onChange={e => setAnnexes(e.target.value)} />
          </Field>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={subrogation} onChange={e => setSubrogation(e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Subrogation: the OPCO pays the training provider directly')}</span>
      </label>
      {/* lot 12 — C4 : organisme du dossier ; ses SIRET, NDA et Qualiopi sont proposés, ce qui est déclaré à l'OPCO reste saisi ici. */}
      {dossier
        ? <Field label={t('Training provider')}><Static>{ficheDossier?.nomUsuel ?? fm?.organisme ?? '—'}</Static></Field>
        : <ChoixOrganisme id="opco-organisme" valeur={organismeId} onChange={choisirOrganisme} actuel={organismeDefaut?.id ?? null} vide={t('None (manual entry)')} le={du || d.ti} />}
      {subrogation && (dossier ? ficheDossier : ficheDe(Number(organismeId) || null))?.subrogationAcceptee === false && (
        <Fine>{t('The provider has not declared it accepts subrogation (sheet of the reference data): to check with them.')}</Fine>
      )}
      <div className="grid-2">
        <Field label={t('SIRET of the provider')} htmlFor="opco-siret" erreur={siret.trim() ? err('organismeSiret') : null}>
          <input className="input tnum" id="opco-siret" inputMode="numeric" value={siret} placeholder={t('14 digits')} onChange={e => setSiret(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('Declaration of activity (NDA)')} htmlFor="opco-nda" erreur={nda.trim() ? err('organismeNda') : null}>
          <input className="input tnum" id="opco-nda" inputMode="numeric" value={nda} placeholder={t('11 digits')} onChange={e => setNda(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={qualiopi} onChange={e => setQualiopi(e.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Provider certified Qualiopi (condition of the funding)')}</span>
      </label>
      {memeDispositif.length > 0 && (
        <NoteAccent>
          {t('This line already carries ')}{memeDispositif.length > 1 ? `${memeDispositif.length}${t(' files in progress')}` : t('a file in progress')}{t(' for this scheme (')}{memeDispositif.map(x => STATUTS_OPCO[x.statut].label.toLowerCase()).join(', ')}{t('): a second file is only justified for another funder.')}
        </NoteAccent>
      )}
      {correction && (
        <Field label={t('Reason for the correction')} htmlFor="opco-motif" requis erreur={v.erreur(motifErr) || (motif.trim().length > MOTIF_MAX ? motifErr : null)}>
          <textarea className="input" id="opco-motif" rows={2} value={motif} placeholder={t('Number copied wrongly, dates of the training moved…')} onChange={e => setMotif(e.target.value)} />
        </Field>
      )}
      <Fine>
        {correction ? `${aideMotifOpco()} ` : ''}
        {dossier ? '' : t('The file starts “To file”: its due dates (filing before the start, supporting documents after the end) start from the dates of the training. ')}
        {t('Entry to copy also on the portal of the OPCO: Cursus does not connect to it.')}
      </Fine>
    </Dialog>
  );
}
