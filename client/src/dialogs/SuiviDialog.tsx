// Type de suivi médical d'un collaborateur (service RH) : VIP, VIP adaptée (travail de nuit, handicap, invalidité) ou
// suivi individuel renforcé, ou rien (VIP par défaut). Une habilitation ou un poste marqués « SIR » au référentiel placent
// le salarié en suivi renforcé quel que soit le type saisi (shared/rules/suivi-medical.ts). Réservé au service RH et à
// l'intéressé : le manager ne voit que le verdict d'aptitude. Case « exposé à des risques particuliers » (ou celle du poste,
// Référentiels) : visite post-exposition ou de fin de carrière proposée à la sortie (shared/rules/visites-dues.ts).
import { useState } from 'react';
import { posteDe } from '../../../shared/rules/exigences.ts';
import { periodicite, SUIVIS_MEDICAUX } from '../../../shared/rules/suivi-medical.ts';
import type { SuiviMedical } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton } from '../components/Dialog.tsx';
import { Fine, NoteAccent } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Choix proposés : un des types, ou aucun (VIP par défaut). */
type Choix = SuiviMedical | '';

export function SuiviDialog({ empId }: { empId: number }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = emps.find(e => e.id === empId);
  const [choix, setChoix] = useState<Choix>(() => emp?.suivi ?? '');
  const [expose, setExpose] = useState(() => !!emp?.expose);
  const [busy, setBusy] = useState(false);
  if (!emp || !rh) return null;
  const suivi = emp.med.suivi;
  const s = d.ds.settings;
  const rythme = (k: SuiviMedical) => (k === 'sir'
    ? `${t('intermediate visit at ')}${periodicite('sir', s)}${t(' months, fitness examination at ')}${s.santeSirAptitudeMois ?? 48}${t(' months#unit')}`
    : `${t('visit every ')}${periodicite(k, s)}${t(' months#unit')}`);

  const enregistrer = async () => {
    if (busy) return;
    setBusy(true);
    const r = await run('medical.suivi', { empId, suivi: choix || null, expose });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const options: [Choix, string, string][] = [
    ['', t('Not specified'), `${t('VIP by default — ')}${rythme('vip')}`],
    ...(Object.keys(SUIVIS_MEDICAUX) as SuiviMedical[]).map((k): [Choix, string, string] => [k, SUIVIS_MEDICAUX[k].label, `${SUIVIS_MEDICAUX[k].article} — ${rythme(k)}`]),
  ];
  return (
    <Dialog title={t('Type of medical monitoring')} width={560} onSubmit={enregistrer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
      {suivi?.deduit && (
        <NoteAccent>
          {t('Reinforced individual monitoring deduced from the reference data (')}{suivi.origines.join(', ')}{t('): it applies whatever type is chosen here.')}
        </NoteAccent>
      )}
      <Field label={t('Type of monitoring')}>
        <div role="radiogroup" aria-label={t('Type of monitoring')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {options.map(([k, label, sub]) => (
            <label key={k || 'aucun'} className={`radio radio-opt${choix === k ? ' checked' : ''}`}>
              <input type="radio" name="su-type" checked={choix === k} onChange={() => setChoix(k)} />
              <span className="dot" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14 }}>{label}</div>
                <div className="text-muted sub">{sub}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
        <input type="checkbox" checked={expose} onChange={e => setExpose(e.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
        {t('Exposed to particular risks (dangerous chemical agents, CMR, ATEX…): post-exposure visit on leaving (art. L4624-2-1)')}
      </label>
      {posteDe(d.ds, emp)?.expose && <Fine>{t('The job ')}{emp.poste}{t(' is ticked “exposed to particular risks” in the reference data: the visit is offered on leaving whatever this box.')}</Fine>}
      <Fine>
        {t('The date of the next visit set by the occupational physician, entered with their opinion, always prevails over these periodicities (Settings → Health). The manager sees neither the type of monitoring, nor the exposure, nor the date of the next visit.')}
      </Fine>
    </Dialog>
  );
}
