// Écran Référentiels, onglet Horaires : horaire variable (lot 12, chantier C6, étape 2 ; horaires individualisés, art.
// L3121-48 à L3121-52). Plages fixes (présence obligatoire) entourées de plages mobiles, durée de référence d'une journée,
// plafonds du report d'une semaine à l'autre et du cumul (supplétifs 3 h et 10 h ; d'autres valeurs exigent la référence
// de l'accord collectif). Contrôles partagés avec le serveur (shared/rules/horaires-variables.ts, action
// `referentiel.horaire.variable`, service RH).
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import { CUMUL_MAX_MIN, REPORT_MAX_SEMAINE_MIN } from '../../../shared/rules/debit-credit.ts';
import { ACCORD_VARIABLE_MAX, controlerHoraireVariable, PLAGES_MAX, TYPES_PLAGE } from '../../../shared/rules/horaires-variables.ts';
import { dureeHoraire, horaireDe, plageTexte } from '../../../shared/rules/horaires.ts';
import type { PlageHoraire } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { CloseButton, Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

/** Minutes → heures saisies (« 7,5 ») ; vide sans valeur. */
const heures = (m: number | null | undefined) => (m == null ? '' : String(Math.round((m / 60) * 100) / 100).replace('.', ','));

export function HoraireVariableDialog({ code }: { code: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [h] = useState(() => horaireDe(d.ds.referentiels, code));
  const [variable, setVariable] = useState(!!h?.variable);
  const [plages, setPlages] = useState<PlageHoraire[]>(() => h?.plages?.length ? h.plages : h ? [
    { type: 'mobile', debut: h.debut, fin: '' }, { type: 'fixe', debut: '', fin: '' }, { type: 'mobile', debut: '', fin: h.fin },
  ] : []);
  const [duree, setDuree] = useState(heures(h?.dureeReference));
  const [report, setReport] = useState(heures(h?.reportMaxSemaine));
  const [cumul, setCumul] = useState(heures(h?.cumulMax));
  const [accord, setAccord] = useState(h?.accordVariable ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!h) return <Dialog title={t('Variable schedule')} width={480} actions={<CancelButton label={t('Close')} />}><Bloquant>{t('This schedule no longer exists.')}</Bloquant></Dialog>;

  const saisie = { variable, plages, dureeReference: duree, reportMaxSemaine: report, cumulMax: cumul, accordVariable: accord };
  const { erreurs } = controlerHoraireVariable(h, saisie);
  const changer = (i: number, x: Partial<PlageHoraire>) => setPlages(l => l.map((p, j) => (j === i ? { ...p, ...x } : p)));

  const envoyer = async () => {
    if (busy || (variable && !v.verifier(erreurs.plages, erreurs.dureeReference, erreurs.reportMaxSemaine, erreurs.cumulMax, erreurs.accordVariable))) return;
    setBusy(true);
    const r = await run('referentiel.horaire.variable', { id: h.code, ...saisie });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`${t('Schedule ')}${h.code}${t(' · variable schedule')}`} width={600} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <Field label={t('Schedule')}><Static>{h.nom} · {plageTexte(h)}{t(', break ')}{h.pause}{t(' min (')}{fH(dureeHoraire(h))}{t(' of work)')}</Static></Field>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={variable} onChange={x => setVariable(x.target.checked)} style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Variable schedule (individualised hours)')}
          <span className="text-muted sub" style={{ display: 'block' }}>{t('Arrival and departure at will in the mobile ranges, presence mandatory in the fixed ranges; assumes the CSE does not oppose it (art. L3121-48).')}</span>
        </span>
      </label>
      {variable && <>
        <Field label={t('Ranges, in the order of the day')} requis erreur={v.erreur(erreurs.plages)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {plages.map((p, i) => (
              <div key={i} className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                <select className="input" aria-label={`${t('Type of range ')}${i + 1}`} value={p.type} onChange={x => changer(i, { type: x.target.value as PlageHoraire['type'] })} style={{ maxWidth: 230 }}>
                  {Object.entries(TYPES_PLAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input className="input tnum" aria-label={`${t('Start of range ')}${i + 1}`} inputMode="numeric" maxLength={8} placeholder="09:00" value={p.debut} onChange={x => changer(i, { debut: x.target.value })} style={{ maxWidth: 96 }} />
                <span className="text-muted">–</span>
                <input className="input tnum" aria-label={`${t('End of range ')}${i + 1}`} inputMode="numeric" maxLength={8} placeholder="11:30" value={p.fin} onChange={x => changer(i, { fin: x.target.value })} style={{ maxWidth: 96 }} />
                {plages.length > 1 && <CloseButton size={28} label={`${t('Remove range ')}${i + 1}`} onClick={() => setPlages(l => l.filter((_, j) => j !== i))} />}
              </div>
            ))}
            {plages.length < PLAGES_MAX && (
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlages(l => [...l, { type: 'fixe', debut: '', fin: '' }])}>{t('Add a range')}</button></div>
            )}
          </div>
        </Field>
        <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
          <Field label={t('Reference duration (hours per day)')} htmlFor="hv-duree" erreur={v.erreur(erreurs.dureeReference)}>
            <input className="input tnum" id="hv-duree" inputMode="decimal" maxLength={6} placeholder={heures(Math.round(dureeHoraire(h) * 60))} value={duree} onChange={x => setDuree(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
          <Field label={t('Carry-over per week (hours)')} htmlFor="hv-report" erreur={v.erreur(erreurs.reportMaxSemaine)}>
            <input className="input tnum" id="hv-report" inputMode="decimal" maxLength={6} placeholder={heures(REPORT_MAX_SEMAINE_MIN)} value={report} onChange={x => setReport(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
          <Field label={t('Authorised cumulative (hours)')} htmlFor="hv-cumul" erreur={v.erreur(erreurs.cumulMax)}>
            <input className="input tnum" id="hv-cumul" inputMode="decimal" maxLength={6} placeholder={heures(CUMUL_MAX_MIN)} value={cumul} onChange={x => setCumul(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
        </div>
        <Field label={t('Reference of the collective agreement')} htmlFor="hv-accord" erreur={v.erreur(erreurs.accordVariable)}>
          <input className="input" id="hv-accord" maxLength={ACCORD_VARIABLE_MAX} placeholder={t('Company agreement on variable schedules of …')} value={accord} onChange={x => setAccord(x.target.value)} />
        </Field>
        <Fine>
          {t('Empty: the duration of the schedule and the default ceilings (')}{fH(REPORT_MAX_SEMAINE_MIN / 60)}{t(' carried over from one week to the next, ')}{fH(CUMUL_MAX_MIN / 60)}{t(' cumulative). Other ceilings require the reference of the agreement. A carry-over within the ceilings is not overtime (art. L3121-51); beyond, the excess is flagged in the debit-credit. Clock-ins outside a fixed range are flagged to be justified.')}
        </Fine>
      </>}
    </Dialog>
  );
}
