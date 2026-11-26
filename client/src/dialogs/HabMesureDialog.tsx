// Suspendre ou retirer une habilitation après un incident ou une restriction, ou lever sa suspension.
// Motif obligatoire, date et auteur tracés ; Keystone ne reçoit que le matricule et un code de motif.
import { useState } from 'react';
import { HAB_CLS, HAB_LABEL, type HabMesureAction } from '../../../shared/constants.ts';
import { isValidDate, parse } from '../../../shared/dates.ts';
import { fmt } from '../../../shared/format.ts';
import { erreurTexte } from '../components/controles.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { t } from '../i18n/langue.ts';
import { useStore } from '../state/store.tsx';

// Chaînes sources anglaises, traduites au rendu (CU-N01).
const TITRE: Record<HabMesureAction, string> = { suspendre: 'Suspend an authorisation', lever: 'Lift the suspension', retirer: 'Withdraw an authorisation' };
const BOUTON: Record<HabMesureAction, string> = { suspendre: 'Suspend the title', lever: 'Lift the suspension', retirer: 'Withdraw the title' };

export function HabMesureDialog({ empId, h, action }: { empId: number; h: string; action: HabMesureAction }) {
  const { d, emps } = useEnriched();
  // Levée de la suspension : service RH et référent HSE.
  const { formations } = useRole();
  const { run, closeDialog } = useStore();
  const [motif, setMotif] = useState('');
  const [date, setDate] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = emps.find(e => e.id === empId);
  const hi = emp?.habs.find(x => x.h === h);
  if (!emp || !hi?.delivree) return null;

  const lever = action === 'lever';
  // Date contrôlée dès la saisie (elle est préremplie) ; motif manquant, à l'envoi.
  const dateErr = lever ? null : !date ? t('Enter the effective date.') : !isValidDate(date) ? t('Invalid date.')
    : date > d.ti ? t('The date cannot be after today.')
    : date < hi.delivree ? `${t('Date before the issue of the title (')}${fmt(parse(hi.delivree))}).` : null;
  const motifErr = lever ? null : erreurTexte(motif, t('Enter the reason for the measure.'));
  // Après la levée, le titre reste non valide si ses prérequis manquent ou s'il est expiré.
  const apres = hi.d! < 0 ? t('The title has expired: it will remain to be renewed.')
    : !hi.prereqOk ? `${t('The title will remain suspended while the prerequisite is missing: ')}${hi.failing.map(c => c.label).join(', ')}.`
    : t('The title becomes valid again until ') + fmt(hi.exp!) + '.';

  const confirm = async () => {
    if (busy || !v.verifier(dateErr, motifErr)) return;
    setBusy(true);
    const r = await run(`hab.${action}`, lever ? { empId, h } : { empId, h, motif: motif.trim(), date });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t(TITRE[action])} width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t(BOUTON[action])}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label={t('Authorisation')}><Static>{hi.hm.nom}</Static></Field>
      </div>
      <div className="boxed" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div className="text-muted sub" style={{ minWidth: 0 }}>{t('Issued on ')}{fmt(parse(hi.delivree))}{hi.par ? `${t(' by ')}${hi.par}` : ''} · {t('expires on ')}{fmt(hi.exp!)}</div>
        <Tag cls={HAB_CLS[hi.key]} style={{ flex: 'none' }}>{HAB_LABEL[hi.key]}</Tag>
      </div>
      {hi.mesure && <NoteAccent>{hi.note}</NoteAccent>}

      {lever ? (
        <Fine>{apres} {t('The new verdict of the worksites concerned is sent to Keystone.')}</Fine>
      ) : <>
        <Field label={t('Effective date')} htmlFor="hm-date" requis erreur={date ? dateErr : v.erreur(dateErr)}>
          <input className="input" id="hm-date" type="date" min={hi.delivree} max={d.ti} value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 200 }} />
        </Field>
        <Field label={t('Reason')} htmlFor="hm-motif" requis erreur={v.erreur(motifErr)}>
          <textarea className="input mid" id="hm-motif" rows={3} maxLength={500} placeholder={t('Incident, instruction not followed, fitness restriction…')}
            value={motif} onChange={e => setMotif(e.target.value)} />
        </Field>
        <Fine>{t('Free text, visible to the employee and their manager: do not put any medical information in it (condition, treatment, detail of a restriction). A restriction or an unfitness is recorded with the occupational physician’s opinion (HR), which suspends the incompatible titles.')}</Fine>
        <Fine>
          {action === 'retirer'
            ? t('The withdrawal is final: the title can only be restored by a new issue, after the prerequisites are checked.')
            : `${t('The title is no longer valid from this date.')} ${formations ? t('You will be able to lift the suspension.') : t('Only HR and the HSE officer will be able to lift the suspension.')}`}
          {' '}{t('The worksites that require it go to No Go: Keystone only receives the employee number and a reason code.')}
        </Fine>
      </>}
    </Dialog>
  );
}
