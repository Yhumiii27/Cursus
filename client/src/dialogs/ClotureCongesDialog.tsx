// Clôture d'une période de congés (service RH, `conges.cloturer`). Congés payés : solde restant de chaque salarié et
// décision ligne par ligne — report (plafonné au solde, jusqu'au 31 mai suivant) ou perte ; jamais de perte d'office, ni
// des jours d'un report imposé (absence de santé, maternité, paternité ou adoption dans la période : 15 mois ; report
// légal reçu encore en cours : jusqu'à son échéance). Une ligne sans décision reste à clôturer ; une ligne dont une demande
// de CP de la période attend une décision aussi ; un salarié sans solde est clos d'emblée ; un membre du RH ne décide pas
// de son propre solde. RTT : non reportables, soldes non pris photographiés après le rappel du compte épargne-temps.
// Règles : shared/rules/clotures.ts ; relancer une clôture est sans effet.
import { useMemo, useState } from 'react';
import { parse } from '../../../shared/dates.ts';
import { equipeLabel, fJ, fmt, fmtIso } from '../../../shared/format.ts';
import { periodeDemiTexte } from '../../../shared/rules/demi-journees.ts';
import { echeanceReport, lignesClotureCp, lignesClotureRtt, MOTIF_CLOTURE_LABEL, type LigneClotureCp } from '../../../shared/rules/clotures.ts';
import { finPeriodeCp, periodeCp, plafondsCet } from '../../../shared/rules/conges.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent, Seg, Tag } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function ClotureCongesDialog({ conges, periode }: { conges: 'CP' | 'RTT'; periode: number }) {
  return conges === 'CP' ? <ClotureCp A={periode} /> : <ClotureRtt Y={periode} />;
}

/** Choix du service RH pour une ligne : décision (vide : pas encore décidée) et jours reportés saisis (report imposé compris). */
interface Choix { decision: 'reporter' | 'perdre' | ''; jours: string }

const egal = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const saisie = (n: number) => String(n).replace('.', ',');

/** Choix initial d'une ligne : la proposition de Cursus. */
const initial = (l: LigneClotureCp): Choix => ({ decision: l.proposition.decision ?? '', jours: saisie(l.proposition.jours) });

/** Erreur d'une ligne à reporter : jours (tout le solde, le report imposé, ou une partie par demi-journée). */
function erreur(l: LigneClotureCp, c: Choix): string | null {
  if (c.decision !== 'reporter') return null;
  const j = Number(c.jours.replace(',', '.'));
  return !c.jours.trim() || Number.isNaN(j) ? t('Enter the number of days.')
    : egal(j, l.solde) || egal(j, l.legal) ? null
    : !(j > 0) || (j * 2) % 1 !== 0 ? t('Number of days per half day: 0.5, 1, 1.5…')
    : j > l.solde ? `${fJ(l.solde)}${t(' at most.')}`
    : j < l.legal ? `${fJ(l.legal)}${t(' at least (legal carry-over).')}` : null;
}

function ClotureCp({ A }: { A: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const lignes = useMemo(() => lignesClotureCp(d, A), [d, A]);
  // Décisions saisies ; une ligne apparue depuis l'ouverture (données relues) part de la proposition de Cursus.
  const [saisis, setChoix] = useState<Record<number, Choix>>({});
  const choix = (l: LigneClotureCp) => saisis[l.e.id] ?? initial(l);
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  // Demande de CP de la période en attente : la ligne attend sa décision, même à solde nul.
  const enAttente = lignes.filter(l => !l.deja && l.attente.length);
  const ouvertes = lignes.filter(l => !l.deja && !l.attente.length && l.solde > 0);
  const decidables = ouvertes.filter(l => l.e.id !== soi);
  const miennes = ouvertes.filter(l => l.e.id === soi);
  const sansSolde = lignes.filter(l => !l.deja && !l.attente.length && l.solde <= 0);
  const faites = lignes.filter(l => l.deja);
  const decidees = decidables.filter(l => choix(l).decision);
  const sansDecision = decidables.length - decidees.length;
  const set = (l: LigneClotureCp, patch: Partial<Choix>) => setChoix(c => ({ ...c, [l.e.id]: { ...(c[l.e.id] ?? initial(l)), ...patch } }));
  // Report proposé à toutes les lignes encore sans décision (jamais une perte en bloc : elle se décide ligne par ligne).
  const reporterTout = () => setChoix(c => ({
    ...c, ...Object.fromEntries(decidables.filter(l => !(c[l.e.id] ?? initial(l)).decision).map(l => [l.e.id, { decision: 'reporter' as const, jours: saisie(l.solde) }])),
  }));

  const rien = !decidees.length && !sansSolde.length ? t('Choose the carry-over or the loss of the balance for at least one employee.') : null;
  const bloquants = decidees.map(l => erreur(l, choix(l)));
  const reportes = decidees.filter(l => choix(l).decision === 'reporter').length;
  const pertes = decidees.length - reportes;

  const confirm = async () => {
    if (busy || !v.verifier(rien, ...bloquants)) return;
    setBusy(true);
    const r = await run('conges.cloturer', {
      type: 'CP', periode: A,
      lignes: decidees.map(l => {
        const c = choix(l);
        return c.decision === 'perdre' ? { empId: l.e.id, decision: 'perdre' } : { empId: l.e.id, decision: 'reporter', jours: Number(c.jours.replace(',', '.')) };
      }),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (!ouvertes.length && !sansSolde.length && !enAttente.length) {
    return (
      <Dialog title={`${t('Closing of paid leave ')}${periodeCp(A)}`} actions={<CancelButton label={t('Close')} />}>
        <p className="text-muted" style={{ margin: 0 }}>
          {faites.length ? `${t('Period already closed for ')}${tn(faites.length, 'employee#salarie', 'employees#salarie')}${t(': nothing to redo.')}` : t('No employee concerned by this period.')}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog title={`${t('Closing of paid leave ')}${periodeCp(A)}`} width={720} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Close #verb')}{decidees.length ? tn(decidees.length + sansSolde.length, 'line', 'lines') : t('the zero balances')}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {t('Period ended on ')}{fmt(parse(finPeriodeCp(A)))}{t('. No day is lost automatically: for each employee, choose to carry over the balance to the period ')}{periodeCp(A + 1)}{t(' (capped at the balance, usable until ')}{fmt(parse(echeanceReport(A)))}{t(') or to lose it. A line without a decision remains to be closed.')}
      </p>
      {decidables.length > 0 && sansDecision > 0 && (
        <div className="actions-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reporterTout}>{t('Carry over the ')}{tn(sansDecision, 'balance without a decision', 'balances without a decision')}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {decidables.map(l => {
          const c = choix(l), err = erreur(l, c), j = Number(c.jours.replace(',', '.'));
          const perdus = c.decision === 'perdre' ? l.solde : c.decision === 'reporter' && !err && j < l.solde ? Math.round((l.solde - j) * 100) / 100 : 0;
          return (
            <div key={l.e.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.e.nom}</div>
                  <div className="text-muted sub">
                    {equipeLabel(l.e)}{t(' · balance ')}{fJ(l.solde)}{l.accorde ? `${t(' · carry-over granted during the period: ')}${fJ(l.accorde)}` : ''}
                  </div>
                </div>
                <Seg name={`cl-${l.e.id}`} label={`${t('Decision for ')}${l.e.nom}`} value={c.decision}
                  options={l.legal > 0 ? [['reporter', t('Carry over')]] : [['reporter', t('Carry over')], ['perdre', t('Lose')]]}
                  onChange={x => set(l, { decision: x })} />
              </div>
              {l.impose && (
                <NoteAccent>
                  {MOTIF_CLOTURE_LABEL[l.impose]}{t(': loss impossible for ')}{egal(l.legal, l.solde) ? t('the whole balance') : fJ(l.legal)}{t(l.legal > 1 ? ', carried over until #plural' : ', carried over until ')}{fmtIso(l.expireLegal!)}
                  {l.impose === 'report_legal' && ` (${[l.acquisArret > 0 ? `${fJ(l.acquisArret)}${t(' accrued during the absence')}` : '', l.empeches > 0 ? `${fJ(l.empeches)}${t(' working days of absence during the taking period')}` : ''].filter(Boolean).join(', ')})`}.
                </NoteAccent>
              )}
              {c.decision === 'reporter' && (
                <div className="grid-2">
                  <Field label={t(l.legal > 0 && !egal(l.legal, l.solde) ? 'Days carried over, legal carry-over included' : 'Days carried over')} htmlFor={`cl-j-${l.e.id}`} erreur={v.erreur(err)}>
                    <input className="input" id={`cl-j-${l.e.id}`} type="text" inputMode="decimal" value={c.jours} onChange={ev => set(l, { jours: ev.target.value })} />
                  </Field>
                  <Field label={t('Usable until')}>
                    <Static>
                      {l.legal > 0 ? `${fmtIso(l.expireLegal!)}${t(' (legal carry-over)')}${egal(l.legal, l.solde) ? '' : `, ${fmtIso(echeanceReport(A))}${t(' beyond')}`}` : fmtIso(echeanceReport(A))}
                    </Static>
                  </Field>
                </div>
              )}
              {perdus > 0 && <Fine>{fJ(perdus)}{t(perdus > 1 ? ' lost at closing.#plural' : ' lost at closing.')}</Fine>}
              {!c.decision && <Tag cls="tag-outline" style={{ alignSelf: 'flex-start' }}>{t('No decision: remains to be closed')}</Tag>}
            </div>
          );
        })}
        {enAttente.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">
              {t('Paid leave request pending (')}{l.attente.map(periodeDemiTexte).join(', ')}{t('): to approve or refuse before closing their balance.')}
            </div>
          </div>
        ))}
        {miennes.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">{t('Your balance (')}{fJ(l.solde)}{t('): decision by another member of HR.')}</div>
          </div>
        ))}
        {!ouvertes.length && !enAttente.length && <Empty pad="sm">{t('No balance left to decide.')}</Empty>}
      </div>
      {rien && v.tente && <Bloquant>{rien}</Bloquant>}
      <Fine>
        {t('On validation: ')}{tn(reportes, 'carry-over', 'carry-overs')}{t(' (carry-over received on the period ')}{periodeCp(A + 1)}{t(', until its due date),')}
        {' '}{tn(pertes, 'loss', 'losses')}{sansSolde.length ? `, ${tn(sansSolde.length, 'employee without balance closed', 'employees without balance closed')}${t(' at once')}` : ''}
        {sansDecision + miennes.length + enAttente.length ? `${t('; ')}${tn(sansDecision + miennes.length + enAttente.length, 'line remains', 'lines remain')}${t(' to decide')}` : ''}.
        {faites.length ? `${t(' Already closed: ')}${tn(faites.length, 'employee#salarie', 'employees#salarie')}.` : ''}{t(' Each closed line is recorded and final.')}
      </Fine>
    </Dialog>
  );
}

function ClotureRtt({ Y }: { Y: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const lignes = useMemo(() => lignesClotureRtt(d, Y).filter(l => !l.deja), [d, Y]);
  const [busy, setBusy] = useState(false);
  // Demande de RTT de l'année en attente : le salarié n'est pas clôturé tant qu'elle n'est pas décidée.
  const attente = lignes.filter(l => l.attente.length), closes = lignes.filter(l => !l.attente.length);
  const perdus = closes.reduce((n, l) => n + Math.max(0, l.solde), 0);
  const cet = lignes.filter(l => l.cet > 0);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await run('conges.cloturer', { type: 'RTT', periode: Y });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (!lignes.length) {
    return (
      <Dialog title={`${t('Closing of RTT ')}${Y}`} actions={<CancelButton label={t('Close')} />}>
        <p className="text-muted" style={{ margin: 0 }}>{t('Year already closed: nothing to redo.')}</p>
      </Dialog>
    );
  }

  return (
    <Dialog title={`${t('Closing of RTT and rest days ')}${Y}`} width={640} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Close the RTT ')}{Y}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {t('RTT and rest days cannot be carried over: the balance not taken on 31 December ')}{Y}{t(' is lost. The closing records it for each employee; those of ')}{Y + 1}{t(' can still be requested on their own entitlement.')}
      </p>
      {cet.length > 0 && (
        <NoteAccent>
          {t('Reminder: up to ')}{plafondsCet(d).rtt}{t(' RTT a year can be placed on the time savings account. ')}{tn(cet.length, 'employee can', 'employees can')}{t(' still place RTT of ')}{Y}{t(' there until this confirmation (button “Save” of the Leave & absences screen).')}
        </NoteAccent>
      )}
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>{t('Employee')}</th><th>{t('Entitlement')}</th><th>{t('Taken')}</th><th>{t('Not taken')}</th><th>{t('Can be placed on the CET')}</th></tr></thead>
          <tbody>
            {lignes.map(l => (
              <tr key={l.e.id}>
                <td><div className="nowrap">{l.e.nom}</div><div className="text-muted sub">{l.info.label}</div></td>
                <td className="tnum">{fJ(l.info.droit)}</td>
                <td className="tnum">{fJ(l.info.pris + l.info.poses)}</td>
                <td className="tnum">
                  {l.solde > 0 ? fJ(l.solde) : '—'}
                  {l.attente.length > 0 && <div className="text-muted sub">{t('Request pending (')}{l.attente.map(periodeDemiTexte).join(', ')}{t('): not closed')}</div>}
                </td>
                <td className="tnum">{l.cet > 0 ? fJ(l.cet) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {attente.length > 0 && (
        <NoteAccent>
          {tn(attente.length, 'employee has', 'employees have')}{t(' an RTT request of ')}{Y}{t(' pending: to approve or refuse first, then run the closing again (')}{attente.map(l => l.e.nom).join(', ')}).
        </NoteAccent>
      )}
      <Fine>{t('On validation: ')}{tn(closes.length, 'employee closed', 'employees closed')}, {perdus ? `${fJ(perdus)}${t(' not taken lost')}` : t('no RTT lost')}{t('. Recorded and final.')}</Fine>
    </Dialog>
  );
}
