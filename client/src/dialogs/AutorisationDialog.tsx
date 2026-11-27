// Titre de séjour valant autorisation de travail (service RH) : non requise (ressortissant français, de l'UE, de l'EEE ou
// de la Suisse), ou titre { type, numéro, expiration, demande d'authentification et réponse de la préfecture }, sans copie
// du document (GED à venir).
// Contrôles partagés avec le serveur (`validerAutorisation` de shared/rules/contrats.ts) ; information du salarié (art. 13
// du RGPD) affichée avant l'enregistrement, sur le modèle des vaccinations.
import { useState } from 'react';
import { fmtIso } from '../../../shared/format.ts';
import { INFO_TITRE_SEJOUR, joursOuvrablesAvant, TYPES_TITRE_SEJOUR, validerAutorisation } from '../../../shared/rules/contrats.ts';
import type { TypeTitreSejour } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent, SectionLabel, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Information du salarié (art. 13 du RGPD), à porter à sa connaissance avant l'enregistrement. */
function InfoTitre() {
  return (
    <div className="boxed-lg" role="note" aria-label={INFO_TITRE_SEJOUR.titre} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <SectionLabel>{INFO_TITRE_SEJOUR.titre}</SectionLabel>
      <p className="text-muted fine">{t('To bring to the employee’s attention before recording their permit (art. 13 of the GDPR); text to have validated by the data protection officer.')}</p>
      <ul className="rules">
        {INFO_TITRE_SEJOUR.points.map(([k, v]) => <li key={k}><span style={{ color: 'var(--color-text)' }}>{k}</span>{t(': ')}{v}</li>)}
      </ul>
    </div>
  );
}

export function AutorisationDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const t0 = emp?.autorisationTravail ?? null;
  const [requise, setRequise] = useState<'non' | 'oui'>(t0 ? 'oui' : 'non');
  const [type, setType] = useState<TypeTitreSejour | ''>(t0?.type ?? '');
  const [numero, setNumero] = useState(t0?.numero ?? '');
  const [expire, setExpire] = useState(t0?.expire ?? '');
  const [demandeLe, setDemandeLe] = useState(t0?.demandeLe ?? '');
  const [verifieLe, setVerifieLe] = useState(t0?.verifieLe ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const saisie = { requise: requise === 'oui', type, numero, expire, demandeLe, verifieLe };
  const r = validerAutorisation(saisie, { entree: emp.entree, ti: d.ti });
  // Erreurs rattachées à leur champ, reconnues à leur message (comme la fiche).
  const erreur = (re: RegExp) => r.errors.filter(m => re.test(m)).join(' ') || null;
  const errType = erreur(/^Type de titre/), errNumero = erreur(/^Numéro du titre/), errExpire = erreur(/expiration/), errVerif = erreur(/vérification en préfecture/i);
  const errDemande = erreur(/demande d’authentification/);
  const permanent = type === 'resident_permanent';
  const limite = joursOuvrablesAvant(emp.entree, 2);

  const confirm = async () => {
    if (busy || !v.verifier(r.errors.length)) return;
    setBusy(true);
    const res = await run('employe.autorisationTravail', { id: emp.id, ...saisie, type: saisie.requise ? type : null, expire: permanent ? null : expire });
    setBusy(false);
    if (res.ok) closeDialog();
  };

  return (
    <Dialog title={`${t('Residence permit — ')}${emp.nom}`} width={620} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label={t('Hiring')}><Static>{t('Started on ')}{fmtIso(emp.entree)}</Static></Field>
      </div>
      <Field label={t('Work authorisation')}>
        <Seg name="titre-requise" label={t('Work authorisation')} value={requise} onChange={setRequise} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={[['non', t('Not required#fem')], ['oui', t('Residence permit')]]} />
      </Field>
      {requise === 'non' ? (
        <Fine>{t('National of France, of a European Union State, of the European Economic Area or of Switzerland: no permit to track')}{t0 ? t(' — the recorded permit will be erased') : ''}.</Fine>
      ) : <>
        <div className="grid-2">
          <Field label={t('Type of permit')} htmlFor="titre-type" requis erreur={v.erreur(errType)}>
            <select className="input" id="titre-type" value={type} onChange={ev => setType(ev.target.value as TypeTitreSejour | '')}>
              <option value="">{t('Choose…')}</option>
              {(Object.keys(TYPES_TITRE_SEJOUR) as TypeTitreSejour[]).map(k => <option key={k} value={k}>{TYPES_TITRE_SEJOUR[k].label}</option>)}
            </select>
          </Field>
          <Field label={t('Permit number')} htmlFor="titre-numero" requis erreur={numero ? errNumero : v.erreur(errNumero)}>
            <input className="input" id="titre-numero" type="text" autoComplete="off" spellCheck={false} maxLength={40} value={numero} onChange={ev => setNumero(ev.target.value)} />
            <span className="text-muted sub">{t('Single staff register; visible to HR only, never in the log')}</span>
          </Field>
          {!permanent && (
            <Field label={t('Expires on')} htmlFor="titre-expire" requis erreur={expire ? errExpire : v.erreur(errExpire)}>
              <input className="input" id="titre-expire" type="date" value={expire} onChange={ev => setExpire(ev.target.value)} />
            </Field>
          )}
          <Field label={t('Authentication requested from the prefecture on')} htmlFor="titre-demande" erreur={errDemande}>
            <input className="input" id="titre-demande" type="date" max={d.ti} value={demandeLe} onChange={ev => setDemandeLe(ev.target.value)} />
            <span className="text-muted sub">{t('Hiring: at least 2 working days before, i.e. on ')}{fmtIso(limite)} (art. R5221-41)</span>
          </Field>
          <Field label={t('Answer from the prefecture on')} htmlFor="titre-verif" erreur={errVerif}>
            <input className="input" id="titre-verif" type="date" min={demandeLe || undefined} max={d.ti} value={verifieLe} onChange={ev => setVerifieLe(ev.target.value)} />
            <span className="text-muted sub">{t('Empty without an answer: after 2 working days, the check is deemed done')}</span>
          </Field>
        </div>
        {r.warnings.map(w => <NoteAccent key={w}>{w}</NoteAccent>)}
        <Fine>
          {t('Alert ')}{d.ds.settings.titreSejourAlerte}{t(' days before expiry (renewal request at the prefecture), reminder at ')}{d.ds.settings.titreSejourRelance}{t(' days (Settings → Contracts). Once expired, the permit makes the employee non-compliant and switches them to “No Go” on the worksites; Keystone only receives a “contractual situation to regularise”. The copy of the permit will go in the document management system, not in Cursus.')}
        </Fine>
        <InfoTitre />
      </>}
      {v.tente && r.errors.length > 0 && !errType && !errNumero && !errExpire && !errVerif && !errDemande && <Controles msgs={r.errors.map(text => ({ text, bad: true }))} />}
    </Dialog>
  );
}
