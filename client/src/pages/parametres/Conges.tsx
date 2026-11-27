// Paramètres → Congés et clôtures : proposition faite à la clôture des congés payés (administrateur RH), acquisition des CP
// pendant un arrêt maladie (minimum légal ou maladie assimilée), date à partir de laquelle les RTT de l'année suivante se
// posent, et clôtures déjà faites (périodes de CP au 31 mai, RTT au 31 décembre).
import { parse } from '../../../../shared/dates.ts';
import { fJ, fmt } from '../../../../shared/format.ts';
import { RTT_ANNEE_SUIVANTE_DES } from '../../../../shared/reglages.ts';
import { periodeCp } from '../../../../shared/rules/conges.ts';
import type { ClotureConges } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, SectionLabel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

/** Libellé d'un jour « MM-JJ » de l'année : « 1er octobre ». */
const jourDeLAnnee = (mmjj: string) => fmt(parse(`2000-${mmjj}`)).replace(/ 2000$/, '').replace(/^1 /, '1er ');

/** Clôtures faites, une ligne par période : salariés, jours reportés et perdus, date de la dernière ligne. */
function bilans(clotures: ClotureConges[]) {
  const par = new Map<string, ClotureConges[]>();
  for (const c of clotures) par.set(`${c.type}|${c.periode}`, [...(par.get(`${c.type}|${c.periode}`) ?? []), c]);
  return [...par.values()].map(l => ({
    type: l[0].type, periode: l[0].periode, n: l.length, le: l.map(c => c.le).sort().at(-1)!,
    reportes: l.reduce((s, c) => s + c.reportes, 0), perdus: l.reduce((s, c) => s + c.perdus, 0),
  })).sort((a, b) => b.le.localeCompare(a.le) || b.periode - a.periode);
}

export function Conges({ s }: SectionProps) {
  const data = useData();
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const faites = bilans(data.clotures);
  return (
    <Panel title={t('Leave and closings')} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Closing of paid leave on 31 May')}>
        <Seg name="param-report-cp" label={t('Closing of paid leave on 31 May')} value={s.politiqueReportCp} disabled={!admin}
          options={[['cas_par_cas', t('Decision case by case')], ['proposer_report', t('Offer the carry-over of the balance')]]} onChange={v => save({ politiqueReportCp: v })} />
      </Field>
      <Fine>
        {t('No day is lost automatically: from 1 June, HR chooses for each employee the carry-over of the balance (capped at the balance, until the next 31 May) or its loss. “Offer the carry-over” prefills the carry-over of the whole balance, to be confirmed. After a health absence, a maternity, a paternity or an adoption, the days acquired during the absence and those it prevented from taking are not lost: carry-over of 15 months (art. L3141-19-1), which runs from the employee being informed on their return.')}
      </Fine>
      <Field label={t('Paid leave acquired during sick leave')}>
        <Seg name="param-cp-maladie" label={t('Paid leave acquired during sick leave')} value={s.cpMaladie} disabled={!admin}
          options={[['legal', t('Legal minimum')], ['assimile', t('Like actual work')]]} onChange={v => save({ cpMaladie: v })} />
      </Field>
      <Fine>
        {t('Legal minimum (law of 22 April 2024, art. L3141-5-1): 2 working days (ouvrables) per month of sick leave, i.e. 1.67 working day (ouvré), 24 working days (20 ouvrés) per period at most. “Like actual work” only if a company agreement or the chemical industries CCN provides for it. Work or commuting accident and occupational disease always count as actual work, without time limit; an absence still to be qualified counts as an illness.')}
      </Fine>
      <Field label={t('RTT of the next year that can be booked from')} htmlFor="param-rtt-suivante">
        <select className="input" id="param-rtt-suivante" value={s.rttAnneeSuivanteDes} disabled={!admin} onChange={ev => save({ rttAnneeSuivanteDes: ev.target.value })}>
          {RTT_ANNEE_SUIVANTE_DES.map(v => <option key={v} value={v}>{v ? jourDeLAnnee(v) : t('Without restriction')}</option>)}
        </select>
      </Field>
      <Fine>
        {t('RTT cannot be carried over: the closing of 31 December takes a snapshot of the balances not taken, after the reminder of the time savings account. Those of the next year are booked on its entitlement: setting of 39 h contracts (Leave & absences screen) or rest days of the fixed-days arrangement. A request straddling two years is refused.')}
      </Fine>
      <SectionLabel>{t('Completed closings')}</SectionLabel>
      {faites.length > 0 ? (
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {faites.map(b => (
            <div key={`${b.type}|${b.periode}`} className="list-row">
              <div className="grow">
                <div style={{ fontSize: 14 }}>{b.type === 'CP' ? `${t('Paid leave ')}${periodeCp(b.periode)}` : `${t('RTT and rest days ')}${b.periode}`}</div>
                <div className="text-muted sub">
                  {tn(b.n, 'employee#count', 'employees#count')} · {b.type === 'CP' ? `${fJ(b.reportes)}${t(' carried over · ')}` : ''}{fJ(b.perdus)}{t(' lost · on ')}{fmt(parse(b.le))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Fine>{t('No period closed for now: the first closing is offered at the end of the first period kept by Cursus.')}</Fine>}
    </Panel>
  );
}
