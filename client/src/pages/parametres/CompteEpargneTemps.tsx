// Paramètres → Compte épargne-temps : plafonds de placement (RTT par an, CP de la 5e semaine par période ; 5 et 5 par
// défaut, shared/rules/conges.ts) tant que l'accord sur le CET n'est pas connu, et rappel de ce que Cursus en fait : congé
// pris sur le CET validé comme un CP, rubrique de paie « CET » à confirmer, liquidation en entier à la sortie.
// lot 13 — monétisation (shared/rules/cet-monetisation.ts, art. L3151-3) : fermée par défaut, ouverte seulement avec la
// référence de l'accord (COHERENCE de shared/reglages.ts) ; plafond de jours monétisés par an ; solde repris de l'ancien
// outil monétisable ou non. Les plafonds s'enregistrent aussitôt ; la monétisation, au bouton « Enregistrer ».
// Réglages de l'administrateur RH ; les autres profils de l'espace RH les consultent.
import { useEffect, useState } from 'react';
import type { Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const PLAFONDS_RTT = [0, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25];
const PLAFONDS_CP = [0, 1, 2, 3, 4, 5];
const PLAFONDS_MONETISATION = [1, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60];

export function CompteEpargneTemps({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  // Monétisation : champs enregistrés ensemble (la case exige la référence de l'accord).
  const [ouverte, setOuverte] = useState(s.cetMonetisation);
  const [accord, setAccord] = useState(s.cetMonetisationAccord);
  const [plafond, setPlafond] = useState(s.cetMonetisationPlafond);
  const [repris, setRepris] = useState(s.cetReprisMonetisable);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOuverte(s.cetMonetisation); setAccord(s.cetMonetisationAccord); setPlafond(s.cetMonetisationPlafond); setRepris(s.cetReprisMonetisable); setTente(false);
  }, [s.cetMonetisation, s.cetMonetisationAccord, s.cetMonetisationPlafond, s.cetReprisMonetisable]);
  if (!espaceRh) return null;
  const liste = (valeurs: number[], v: number) => [...new Set([...valeurs, v])].sort((a, b) => a - b);
  const erreurAccord = ouverte && !accord.trim() ? t('Enter the reference of the collective agreement that provides for monetisation.') : null;
  const modifie = ouverte !== s.cetMonetisation || accord.trim() !== s.cetMonetisationAccord || plafond !== s.cetMonetisationPlafond || repris !== s.cetReprisMonetisable;
  const enregistrer = async () => {
    if (erreurAccord) { setTente(true); document.getElementById('param-cet-accord')?.focus(); return; }
    setBusy(true);
    await save({ cetMonetisation: ouverte, cetMonetisationAccord: accord, cetMonetisationPlafond: plafond, cetReprisMonetisable: repris } satisfies Partial<Settings>);
    setBusy(false);
  };
  return (
    <Panel title={t('Time savings account')} style={{ gap: 'var(--space-4)' }}>
      <div className="grid-2">
        <Field label={t('RTT placed per year, at most')} htmlFor="param-cet-rtt">
          <select className="input" id="param-cet-rtt" value={s.cetPlafondRtt} disabled={!admin} onChange={e => save({ cetPlafondRtt: Number(e.target.value) })}>
            {liste(PLAFONDS_RTT, s.cetPlafondRtt).map(n => <option key={n} value={n}>{n ? `${n}${t(' d#days')}` : t('None')}</option>)}
          </select>
        </Field>
        <Field label={t('CP of the 5th week per period, at most')} htmlFor="param-cet-cp">
          <select className="input" id="param-cet-cp" value={s.cetPlafondCp} disabled={!admin} onChange={e => save({ cetPlafondCp: Number(e.target.value) })}>
            {liste(PLAFONDS_CP, s.cetPlafondCp).map(n => <option key={n} value={n}>{n ? `${n}${t(' d#days')}` : t('None')}</option>)}
          </select>
        </Field>
      </div>
      <Fine>
        {t('Default ceilings pending the agreement on the time savings account: only the CP beyond 20 working days (5th week) are saved (art. L3151-2). The days saved are taken as leave on the CET, approved by the manager like a paid leave and counted in working days; the leave goes in the payroll file under the “CET” item, deactivated and to be confirmed by payroll: until then, each leave is listed “to be entered in Sage” in the batch. The balance is fully paid out on leaving.')}
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={ouverte} disabled={!admin} onChange={e => { setOuverte(e.target.checked); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Allow the monetisation of the days saved')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('Only if the collective agreement that sets up the time savings account provides for it (art. L3151-3).')}</span>
        </span>
      </label>
      <Field label={t('Reference of the collective agreement')} htmlFor="param-cet-accord" requis={ouverte} erreur={tente && erreurAccord}>
        <input className="input" id="param-cet-accord" maxLength={120} placeholder={t('Company agreement on the time savings account of …')} value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      <Field label={t('Days monetised per employee and per year, at most')} htmlFor="param-cet-plafond-mon">
        <select className="input" id="param-cet-plafond-mon" value={plafond} disabled={!admin} onChange={e => setPlafond(Number(e.target.value))} style={{ maxWidth: 240 }}>
          {liste(PLAFONDS_MONETISATION, plafond).map(n => <option key={n} value={n}>{n}{t(' d#days')}</option>)}
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={repris} disabled={!admin} onChange={e => setRepris(e.target.checked)}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Balance taken over from the former tool monetisable')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('To tick only if it contains no paid leave day: its origin (CP or RTT) is not known to Cursus.')}</span>
        </span>
      </label>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the monetisation')}</Btn></div>}
      {!s.cetMonetisation && <NoteAccent>{t('Agreement on the monetisation of the time savings account not referenced: the days saved are taken as leave or paid out on leaving, no monetisation.')}</NoteAccent>}
      <Fine>
        {t('Only the days coming from RTT are monetised: the CP placed (5th week) cannot be, the law reserving the monetisation of rights from annual leave to the days beyond 30 working days (art. L3151-3). Leave taken on the CET is charged first to the CP placed. The employee requests, HR approves or refuses; once approved, the days go to payroll under the CET_MON item (Sage calculates the amount), deactivated as long as payroll has not given its code: they are then listed “to be entered in Sage” in the batch summary.')}
      </Fine>
    </Panel>
  );
}
