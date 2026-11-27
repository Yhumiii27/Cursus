// Paramètres → Forfait jours (t043, shared/rules/forfait-jours.ts) : seuil d'alerte du cumul annuel des jours travaillés
// (suivi toujours actif), et renonciation à des jours de repos par avenant — fermée par défaut, ouverte seulement avec la
// référence de l'accord collectif qui autorise le forfait jours (COHERENCE de shared/reglages.ts, art. L3121-63 et
// L3121-64) : plafond des jours travaillés avec avenant (235 à défaut d'accord, art. L3121-66), majoration minimale (10 %,
// art. L3121-59), période de paie des jours rachetés (JREN). Réglages de l'administrateur RH ; les autres profils de
// l'espace RH consultent. Le seuil s'enregistre aussitôt ; la renonciation, au bouton « Enregistrer ».
import { useEffect, useState } from 'react';
import { FORFAIT_LEGAL, MAJORATION_MINIMALE, PLAFOND_SUPPLETIF } from '../../../../shared/rules/forfait-jours.ts';
import type { EmissionJren, Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, Panel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t } from '../../i18n/langue.ts';

const ALERTES = Array.from({ length: 11 }, (_, i) => 50 + i * 5);
/** Choix : sources anglaises, traduites au rendu. */
const EMISSIONS: [EmissionJren, string][] = [['signature', 'Month of the signature'], ['cloture', 'December of the year']];

export function ForfaitJours({ s }: SectionProps) {
  const { admin, espaceRh } = useRole();
  const save = useEnregistrerReglages();
  // Renonciation : champs enregistrés ensemble (la case exige la référence de l'accord).
  const [rachat, setRachat] = useState(s.forfaitJoursRachat);
  const [accord, setAccord] = useState(s.forfaitJoursAccord);
  const [plafond, setPlafond] = useState(String(s.forfaitJoursPlafond));
  const [majoration, setMajoration] = useState(String(s.forfaitJoursMajorationMin));
  const [emission, setEmission] = useState<EmissionJren>(s.forfaitJoursJren);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRachat(s.forfaitJoursRachat); setAccord(s.forfaitJoursAccord); setPlafond(String(s.forfaitJoursPlafond));
    setMajoration(String(s.forfaitJoursMajorationMin)); setEmission(s.forfaitJoursJren); setTente(false);
  }, [s.forfaitJoursRachat, s.forfaitJoursAccord, s.forfaitJoursPlafond, s.forfaitJoursMajorationMin, s.forfaitJoursJren]);
  if (!espaceRh) return null;

  const p = Number(plafond), m = Number(majoration);
  const erreurAccord = rachat && !accord.trim() ? t('Enter the reference of the collective agreement that authorises the fixed-days arrangement.') : null;
  const erreurPlafond = !/^\d{3}$/.test(plafond.trim()) || p < FORFAIT_LEGAL || p > 282 ? `${t('Enter a whole number of days, from ')}${FORFAIT_LEGAL}${t(' to 282.')}` : null;
  const erreurMajoration = !/^\d{1,3}$/.test(majoration.trim()) || m < MAJORATION_MINIMALE || m > 100 ? `${t('Enter a whole percentage, from ')}${MAJORATION_MINIMALE}${t(' to 100.')}` : null;
  const modifie = rachat !== s.forfaitJoursRachat || accord.trim() !== s.forfaitJoursAccord || p !== s.forfaitJoursPlafond || m !== s.forfaitJoursMajorationMin || emission !== s.forfaitJoursJren;
  const enregistrer = async () => {
    const erreur = [['fj-accord', erreurAccord], ['fj-plafond', erreurPlafond], ['fj-majoration', erreurMajoration]].find(([, e]) => e);
    if (erreur) { setTente(true); document.getElementById(erreur[0]!)?.focus(); return; }
    setBusy(true);
    await save({ forfaitJoursRachat: rachat, forfaitJoursAccord: accord, forfaitJoursPlafond: p, forfaitJoursMajorationMin: m, forfaitJoursJren: emission } satisfies Partial<Settings>);
    setBusy(false);
  };

  return (
    <Panel title={t('Fixed-days arrangement')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Alert of the annual cumulative')} htmlFor="fj-alerte">
        <select className="input" id="fj-alerte" value={s.forfaitJoursAlerte} disabled={!admin} onChange={e => save({ forfaitJoursAlerte: Number(e.target.value) })} style={{ maxWidth: 240 }}>
          {ALERTES.map(v => <option key={v} value={v}>{v}{t(' % of the ceiling')}</option>)}
        </select>
      </Field>
      <Fine>
        {t('Days worked on the approved timesheets of the year (a half-day up to 4 h, a day beyond), compared with the fixed-days of the sheet (')}{FORFAIT_LEGAL}{t(' days at most, art. L3121-64) pro rata of presence. Alert on the timesheet, the approval queue and the sheet; beyond the ceiling, the approval of the timesheet requires a reason. The remaining rest days are recalled on the sheet.')}
      </Fine>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={rachat} disabled={!admin} onChange={e => { setRachat(e.target.checked); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Allow waiving rest days by amendment')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('Only if the collective agreement that authorises the fixed-days arrangement provides for it (art. L3121-63 and L3121-64).')}</span>
        </span>
      </label>
      <Field label={t('Reference of the collective agreement')} htmlFor="fj-accord" requis={rachat} erreur={tente && erreurAccord}>
        <input className="input" id="fj-accord" maxLength={120} placeholder={t('Company agreement on working time of …')} value={accord} disabled={!admin} onChange={e => setAccord(e.target.value)} />
      </Field>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Ceiling with amendment (days)')} htmlFor="fj-plafond" requis erreur={tente && erreurPlafond}>
          <input className="input tnum" id="fj-plafond" inputMode="numeric" value={plafond} disabled={!admin} onChange={e => setPlafond(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
        <Field label={t('Minimum increase (%)')} htmlFor="fj-majoration" requis erreur={tente && erreurMajoration}>
          <input className="input tnum" id="fj-majoration" inputMode="numeric" value={majoration} disabled={!admin} onChange={e => setMajoration(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Field label={t('Days bought back in payroll (JREN)')}>
        <Seg name="fj-jren" label={t('Days bought back in payroll (JREN)')} value={emission} options={EMISSIONS.map(([k, l]) => [k, t(l)])} disabled={!admin} onChange={setEmission} style={{ flexWrap: 'wrap' }} />
      </Field>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the waiver')}</Btn></div>}
      {!s.forfaitJoursRachat && <NoteAccent>{t('Collective agreement on the fixed-days arrangement not referenced: follow-up of the cumulative and alerts only, no waiver amendment.')}</NoteAccent>}
      <Fine>
        {t('Values of the law failing an agreement: ')}{PLAFOND_SUPPLETIF}{t(' days worked at most with an amendment (art. L3121-66), increase of at least ')}{MAJORATION_MINIMALE}{t(' % (art. L3121-59). The amendment, written and valid for the year, is recorded on the employee’s sheet; its bought-back days go to payroll under the JREN item, deactivated as long as payroll has not given its code: they are then listed “to be entered in Sage” in the batch summary.')}
      </Fine>
    </Panel>
  );
}
