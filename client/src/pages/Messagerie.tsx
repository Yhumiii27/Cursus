// Paramètres → Messagerie (service RH) : mode d'envoi des e-mails (Microsoft 365 ou simulation), adresses du
// service RH, du service de santé au travail et des agences d'intérim (administrateur RH), salariés sans adresse,
// notifications en attente du récapitulatif quotidien, e-mail d'essai pour la mise en service (docs/EMAILS.md).
import { useEffect, useMemo, useState } from 'react';
import { EnvelopeSimpleIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { HEURE_RECAPITULATIF, MODE_NOTIFICATION_LABEL } from '../../../shared/constants.ts';
import { key } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import { MESSAGERIE_VIDE, agencesInterim, normaliserAdresse } from '../../../shared/rules/messagerie.ts';
import type { ModeNotification } from '../../../shared/types.ts';
import type { EnvoisState, NomAction } from '../api.ts';
import { Field } from '../components/Dialog.tsx';
import { Btn, Fine, Panel, SectionLabel, Seg, Tag } from '../components/ui.tsx';
import { useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';

const MODES = Object.entries(MODE_NOTIFICATION_LABEL) as [ModeNotification, string][];

/** État de la messagerie : simulation, échecs en cours, envoi en reprise, ou à jour. */
function MessagerieTag({ etat }: { etat: EnvoisState['email'] | null }) {
  if (!etat) return null;
  if (etat.mode !== 'api') return <Tag cls="tag-outline">{t('Simulation')}</Tag>;
  if (etat.echecsEnCours) return <Tag cls="tag-accent">{tn(etat.echecsEnCours, 'e-mail failed', 'e-mails failed')}</Tag>;
  if (etat.enReprise) return <Tag cls="tag-accent">{t('Microsoft 365 does not answer')}</Tag>;
  return <Tag cls="tag-neutral">Microsoft 365</Tag>;
}

interface Form { rh: string; rhMode: ModeNotification; santeTravail: string; agences: Record<string, string> }

export function MessageriePanel({ etat, reload }: { etat: EnvoisState['email'] | null; reload: () => void }) {
  const data = useData();
  const { admin } = useRole();
  const { run } = useStore();
  const m = data.messagerie ?? MESSAGERIE_VIDE;
  // Agences citées par les fiches des intérimaires, et celles déjà réglées (fiche modifiée depuis).
  const agences = useMemo(() => {
    const noms = agencesInterim(data.employes);
    m.agences.forEach(a => { if (!noms.some(n => key(n) === key(a.nom))) noms.push(a.nom); });
    return noms;
  }, [data.employes, m.agences]);
  const initial = useMemo<Form>(() => ({
    rh: m.rh ?? '', rhMode: m.rhMode, santeTravail: m.santeTravail ?? '',
    agences: Object.fromEntries(agences.map(nom => [nom, m.agences.find(a => key(a.nom) === key(nom))?.adresse ?? ''])),
  }), [m, agences]);
  const [f, setF] = useState<Form>(initial);
  // Valeurs en vigueur changées (adresses enregistrées, fiche d'un intérimaire modifiée) : le formulaire en repart.
  const enVigueur = JSON.stringify(initial);
  useEffect(() => setF(JSON.parse(enVigueur) as Form), [enVigueur]);
  const [essai, setEssai] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(f) !== enVigueur;
  const sansAdresse = data.employes.filter(e => !e.email && !(e.fin && e.fin < data.today)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const agir = async (name: NomAction, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await run(name, payload);
    setBusy(false);
    if (r.ok) reload();
    return r;
  };
  const enregistrer = () => agir('messagerie.regler', {
    rh: f.rh, rhMode: f.rhMode, santeTravail: f.santeTravail,
    agences: Object.entries(f.agences).map(([nom, adresse]) => ({ nom, adresse })),
  });
  const envoyerEssai = async () => { if ((await agir('messagerie.essai', { adresse: essai })).ok) setEssai(''); };

  return (
    <Panel title={t('Messaging')} aside={<MessagerieTag etat={etat} />} style={{ gap: 'var(--space-4)' }}>
      <Fine>
        {etat?.mode === 'api'
          ? `${t('E-mails sent by Microsoft 365 from ')}${etat.expediteur}${t(': notifications of the approval steps, notices to attend (with their .ics file), hours statements of the temporary work agencies. Each one goes through the sending queue, followed below (Sendings).')}`
          : t('Simulation mode (CURSUS_MAIL_FROM not set): no e-mail leaves. Each one is traced in the log and visible in Sendings, marked “simulated”. Set-up by the IT department: docs/EMAILS.md.')}
      </Fine>
      <Fine>{t('E-mails contain neither health data, nor medical absence reason, nor passport number, nor the comments entered in Cursus: they refer to Cursus for the detail.')}</Fine>

      <div className="grid-2">
        <Field label={t('HR department')} htmlFor="msg-rh">
          <input className="input" id="msg-rh" type="email" placeholder={t('hr@company.fr')} value={f.rh} disabled={!admin} onChange={e => setF({ ...f, rh: e.target.value })} />
          <span className="text-muted sub">{t('Approver of the employees without a manager; the answers to the e-mails reach it')}</span>
        </Field>
        <Field label={t('Notifications of HR')}>
          <Seg name="msg-rh-mode" label={t('Notifications of HR')} value={f.rhMode} options={MODES} disabled={!admin} onChange={v => setF({ ...f, rhMode: v })} style={{ flexWrap: 'wrap' }} />
        </Field>
        <Field label={t('Occupational health service')} htmlFor="msg-sante">
          <input className="input" id="msg-sante" type="email" placeholder={t('contact@occupational-health.fr')} value={f.santeTravail} disabled={!admin} onChange={e => setF({ ...f, santeTravail: e.target.value })} />
        </Field>
      </div>

      <SectionLabel>{t('Temporary work agencies')}</SectionLabel>
      {agences.length ? (
        <div className="grid-2" style={{ marginTop: 'calc(-1 * var(--space-2))' }}>
          {agences.map((nom, i) => (
            <Field key={nom} label={nom} htmlFor={`msg-agence-${i}`}>
              <input className="input" id={`msg-agence-${i}`} type="email" placeholder={t('statements@agency.fr')} value={f.agences[nom] ?? ''} disabled={!admin}
                onChange={e => setF({ ...f, agences: { ...f.agences, [nom]: e.target.value } })} />
            </Field>
          ))}
        </div>
      ) : <Fine>{t('No temporary worker: the agency is entered on the sheet of the temporary worker.')}</Fine>}
      <Fine>{t('The weekly statement of the approved hours of their temporary workers (CSV attached) goes to this address as soon as all the timesheets of the week are approved; HR follows it and sends it again from Working time.')}</Fine>
      {admin && (
        <div className="actions-end">
          <Btn variant="primary" disabled={!dirty || busy} onClick={enregistrer}>{t('Save the addresses')}</Btn>
        </div>
      )}

      <SectionLabel>{t('Recipients')}</SectionLabel>
      <Fine muted={!sansAdresse.length}>
        {sansAdresse.length
          ? `${tn(sansAdresse.length, 'employee without an e-mail address', 'employees without an e-mail address')}${t(' (sheet to complete): ')}${sansAdresse.slice(0, 8).map(e => e.nom).join(', ')}${sansAdresse.length > 8 ? '…' : ''}${t('. Their notices to attend are to hand over in person.')}`
          : t('Each employee has a work e-mail address on their sheet.')}
      </Fine>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span className="text-muted sub">
          {etat ? `${tn(etat.recapitulatif, 'notification pending', 'notifications pending')}${t(' of the daily summary (each day from ')}${HEURE_RECAPITULATIF}${t(' h)')}` : t('Daily summary: loading…')}
        </span>
        <Btn small icon={<PaperPlaneTiltIcon size={14} />} disabled={!etat?.recapitulatif || busy} onClick={() => agir('messagerie.recapituler')}>{t('Send now')}</Btn>
      </div>

      {admin && <>
        <SectionLabel>{t('Test e-mail')}</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input className="input" type="email" aria-label={t('Address of the recipient of the test e-mail')} placeholder={t('first.last@company.fr')} value={essai}
            onChange={e => setEssai(e.target.value)} style={{ flex: '1 1 220px', width: 'auto' }} />
          <Btn icon={<EnvelopeSimpleIcon size={14} />} disabled={!normaliserAdresse(essai) || busy} onClick={envoyerEssai}>{t('Send a test e-mail')}</Btn>
        </div>
        <Fine>{t('Set-up: the test e-mail leaves from the sending mailbox; its follow-up (acknowledgement of Microsoft 365 or error) appears in Sendings.')}</Fine>
      </>}
    </Panel>
  );
}
