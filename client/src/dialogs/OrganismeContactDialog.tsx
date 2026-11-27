// lot 12 — C4 (organismes de formation et e-learning) : contact d'un organisme (droit « formations ») et tarif (service
// RH), nouveau ou modifié. Contrôles partagés avec le serveur (shared/rules/organismes.ts). Un contact est une donnée
// personnelle d'un tiers : jamais au journal, ni hors du service RH et du référent formation.
import { useState } from 'react';
import { controlerContact, controlerTarif, MODALITES_TARIF, ROLES_CONTACT, tarifEnVigueur, UNITES_TARIF, type ChampContact, type ChampTarif } from '../../../shared/rules/organismes.ts';
import { fmtEur } from '../../../shared/format.ts';
import type { ModaliteTarif } from '../../../shared/types-organismes.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function OrganismeContactDialog({ organismeId, id }: { organismeId: number; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const o = (d.ds.organismes ?? []).find(x => x.id === organismeId) ?? null;
  const [avant] = useState(() => (id != null ? (d.ds.organismeContacts ?? []).find(c => c.id === id && !c.archive) ?? null : null));
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [fonction, setFonction] = useState(avant?.fonction ?? '');
  const [email, setEmail] = useState(avant?.email ?? '');
  const [telephone, setTelephone] = useState(avant?.telephone ?? '');
  const [role, setRole] = useState<string>(avant?.role ?? 'administratif');
  const [principal, setPrincipal] = useState(!!avant?.principal);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !o || (id != null && !avant);
  const champs = { nom, fonction, email, telephone, role, principal };
  const { erreurs } = controlerContact(champs, avant);
  const erreur = (k: ChampContact, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), disparu)) return;
    setBusy(true);
    const r = await run('organisme.contact.enregistrer', avant ? { id: avant.id, ...champs } : { organismeId, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`${avant ? t('Contact') : t('New contact')} — ${o?.nomUsuel ?? t('provider')}`} width={520} onSubmit={envoyer}
      actions={disparu ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? t('Save') : t('Add the contact')}</SubmitButton></>}>
      {disparu ? <Bloquant>{t('This contact or this provider no longer exists.')}</Bloquant> : <>
        <Field label={t('Name')} htmlFor="oc-nom" requis erreur={erreur('nom', nom)}>
          <input className="input" id="oc-nom" type="text" autoFocus value={nom} maxLength={80} autoComplete="off" onChange={e => setNom(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={t('Role')} htmlFor="oc-role" requis erreur={v.erreur(erreurs.role)}>
            <select className="input" id="oc-role" value={role} onChange={e => setRole(e.target.value)}>
              {Object.entries(ROLES_CONTACT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label={t('Function')} htmlFor="oc-fonction" erreur={erreur('fonction', fonction)}>
            <input className="input" id="oc-fonction" type="text" value={fonction} maxLength={80} placeholder={t('Account manager')} onChange={e => setFonction(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('E-mail')} htmlFor="oc-email" erreur={erreur('email', email)}>
            <input className="input" id="oc-email" type="email" inputMode="email" autoComplete="off" value={email} maxLength={120} onChange={e => setEmail(e.target.value)} />
          </Field>
          <Field label={t('Phone')} htmlFor="oc-tel" erreur={erreur('telephone', telephone)}>
            <input className="input" id="oc-tel" type="tel" inputMode="tel" autoComplete="off" value={telephone} maxLength={25} onChange={e => setTelephone(e.target.value)} />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
          <input type="checkbox" checked={principal} onChange={e => setPrincipal(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {t('Main contact (offered recipient of the list of enrolled)')}
        </label>
        <Fine>{t('Personal data of a third party: HR and training referent only. Kept for the duration of the relationship, plus 3 years.')}</Fine>
      </>}
    </Dialog>
  );
}

export function OrganismeTarifDialog({ organismeId, id }: { organismeId: number; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const o = (d.ds.organismes ?? []).find(x => x.id === organismeId) ?? null;
  const [avant] = useState(() => (id != null ? (d.ds.organismeTarifs ?? []).find(t => t.id === id && !t.archive) ?? null : null));
  const [formation, setFormation] = useState(avant?.formation ?? '');
  const [libelle, setLibelle] = useState(avant?.libelle ?? '');
  const [modalite, setModalite] = useState<string>(avant?.modalite ?? 'inter');
  const [unite, setUnite] = useState<string>(avant?.unite ?? 'stagiaire');
  const [montant, setMontant] = useState(avant ? String(avant.montantHt) : '');
  const [du, setDu] = useState(avant?.valableDu ?? d.ti);
  const [au, setAu] = useState(avant?.valableAu ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !o || (id != null && !avant);
  const champs = { formation, libelle: formation ? '' : libelle, modalite, unite, montantHt: montant, valableDu: du, valableAu: au };
  const { erreurs } = controlerTarif(champs, d.ds.referentiels.formations, avant, d.ti);
  const erreur = (k: ChampTarif, saisi: string) => (saisi.trim() ? erreurs[k] ?? null : v.erreur(erreurs[k]));
  // Tarif déjà en vigueur pour la même formation et modalité : il sera devancé par le plus récent.
  const existant = o && !avant && formation ? tarifEnVigueur(d.ds.organismeTarifs, o.id, formation, du || d.ti, modalite as ModaliteTarif) : null;
  const envoyer = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), disparu)) return;
    setBusy(true);
    const r = await run('organisme.tarif.enregistrer', avant ? { id: avant.id, ...champs } : { organismeId, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const catalogue = d.ds.referentiels.formations.filter(f => !f.archive || f.id === avant?.formation);
  return (
    <Dialog title={`${avant ? t('Rate') : t('New rate')} — ${o?.nomUsuel ?? t('provider')}`} width={560} onSubmit={envoyer}
      actions={disparu ? <CancelButton label={t('Close')} /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? t('Save') : t('Add the rate')}</SubmitButton></>}>
      {disparu ? <Bloquant>{t('This rate or this provider no longer exists.')}</Bloquant> : <>
        <Field label={t('Catalogue training course')} htmlFor="ot-formation" erreur={v.erreur(erreurs.formation)}>
          <select className="input" id="ot-formation" autoFocus value={formation} onChange={e => setFormation(e.target.value)}>
            <option value="">{t('Outside the catalogue (label)')}</option>
            {catalogue.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </Field>
        {!formation && (
          <Field label={t('Label')} htmlFor="ot-libelle" requis erreur={erreur('libelle', libelle)}>
            <input className="input" id="ot-libelle" type="text" value={libelle} maxLength={120} placeholder={t('Audit day, annual licence…')} onChange={e => setLibelle(e.target.value)} />
          </Field>
        )}
        <div className="grid-2">
          <Field label={t('Modality')} htmlFor="ot-modalite" requis erreur={v.erreur(erreurs.modalite)}>
            <select className="input" id="ot-modalite" value={modalite} onChange={e => setModalite(e.target.value)}>
              {Object.entries(MODALITES_TARIF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label={t('Unit')} htmlFor="ot-unite" requis erreur={v.erreur(erreurs.unite)}>
            <select className="input" id="ot-unite" value={unite} onChange={e => setUnite(e.target.value)}>
              {Object.entries(UNITES_TARIF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('Amount excluding taxes (€)')} htmlFor="ot-montant" requis erreur={erreur('montantHt', montant)}>
          <input className="input tnum" id="ot-montant" inputMode="decimal" value={montant} placeholder="450" onChange={e => setMontant(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={t('Valid from')} htmlFor="ot-du" requis erreur={erreur('valableDu', du)}>
            <input className="input" id="ot-du" type="date" value={du} onChange={e => setDu(e.target.value)} />
          </Field>
          <Field label={t('To (optional)')} htmlFor="ot-au" erreur={erreur('valableAu', au)}>
            <input className="input" id="ot-au" type="date" value={au} onChange={e => setAu(e.target.value)} />
          </Field>
        </div>
        {existant && <NoteAccent>{t('Rate in force for this training course: ')}{fmtEur(existant.montantHt)} {UNITES_TARIF[existant.unite]}{t(' since #date')}{existant.valableDu.split('-').reverse().join('/')}{t('; the most recent will be offered.')}</NoteAccent>}
        <Fine>{t('Offered to prefill a cost, never imposed. Commercial data: HR.')}</Fine>
      </>}
    </Dialog>
  );
}
