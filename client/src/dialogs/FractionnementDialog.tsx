// Jours de fractionnement d'une période de congés payés (service RH, `conges.fractionnement`, t046) : après la fin de la
// période du congé principal, Cursus propose pour chaque salarié les jours dus (shared/rules/fractionnement.ts) ; le
// service RH les crédite, note la renonciation du salarié (art. L3141-19) ou laisse la ligne pour plus tard. Jamais de
// crédit d'office ; un membre du RH ne décide pas pour lui-même. Une ligne décidée entre-temps (autre onglet, autre
// membre du RH) est ignorée par le serveur, qui le dit dans son message.
import { useMemo, useState } from 'react';
import { equipeLabel, fJ, fmtIso } from '../../../shared/format.ts';
import { finPeriodeCp, periodeCp } from '../../../shared/rules/conges.ts';
import { CREDIT_MAX, etatTexte, fenetrePrincipale, fenetreTexte, fractionnementsAProposer, regleFractionnement, type LigneFractionnement } from '../../../shared/rules/fractionnement.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** Choix du service RH pour une ligne : vide (plus tard), crédit (jours saisis) ou renonciation du salarié. */
interface Choix { decision: 'crediter' | 'renoncer' | ''; jours: string }

const initial = (l: LigneFractionnement): Choix => ({ decision: '', jours: String(l.propose) });

export function FractionnementDialog({ periode }: { periode: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const lignes = useMemo(() => fractionnementsAProposer(d, periode), [d, periode]);
  const [saisis, setChoix] = useState<Record<number, Choix>>({});
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const regle = regleFractionnement(d.ds.settings);
  const max = regle === 'aucun' ? 0 : CREDIT_MAX[regle];
  const choix = (l: LigneFractionnement) => saisis[l.e.id] ?? initial(l);
  const set = (l: LigneFractionnement, patch: Partial<Choix>) => setChoix(c => ({ ...c, [l.e.id]: { ...(c[l.e.id] ?? initial(l)), ...patch } }));
  const decidables = lignes.filter(l => l.e.id !== soi), miennes = lignes.filter(l => l.e.id === soi);
  const decidees = decidables.filter(l => choix(l).decision);

  /** Jours saisis pour un crédit : 1 ou 2 selon la loi ; par demi-journée jusqu'au plafond retenu sous un accord. */
  const erreur = (l: LigneFractionnement): string | null => {
    const c = choix(l);
    if (c.decision !== 'crediter') return null;
    const j = Number(c.jours.replace(',', '.'));
    return !c.jours.trim() || Number.isNaN(j) ? t('Enter the number of days.')
      : regle === 'legal' && j !== 1 && j !== 2 ? t('1 or 2 days (art. L3141-23).')
      : !(j > 0) || j > max || (j * 2) % 1 !== 0 ? `${fJ(max)}${t(' at most, per half day.')}` : null;
  };
  const rien = !decidees.length ? t('Choose the credit or the waiver for at least one employee.') : null;

  const confirm = async () => {
    if (busy || !v.verifier(rien, ...decidees.map(erreur))) return;
    setBusy(true);
    const r = await run('conges.fractionnement', {
      periode,
      lignes: decidees.map(l => {
        const c = choix(l);
        return c.decision === 'renoncer' ? { empId: l.e.id, decision: 'renoncer' } : { empId: l.e.id, decision: 'crediter', jours: Number(c.jours.replace(',', '.')) };
      }),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const titre = `${t('Split days — paid leave ')}${periodeCp(periode)}`;
  if (!lignes.length) {
    return (
      <Dialog title={titre} actions={<CancelButton label={t('Close')} />}>
        <p className="text-muted" style={{ margin: 0 }}>{t('No split day to decide over this period.')}</p>
      </Dialog>
    );
  }
  const credites = decidees.filter(l => choix(l).decision === 'crediter').length;

  return (
    <Dialog title={titre} width={720} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save #verb')}{decidees.length ? tn(decidees.length, 'decision', 'decisions') : t('the decisions')}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        {t('Period of the main leave ')}{fenetreTexte(fenetrePrincipale(d.ds.settings, periode))}{t(' ended. Days of the main leave (4 weeks, 5th excluded) taken outside this period: 2 days for 6 working days (Mon–Sat) or more, 1 day for 3 to 5 (art. L3141-23')}{regle === 'accord' ? t('; rule of the company agreement to apply') : ''}{t('). The days credited are added to the entitlement of the period, until ')}{fmtIso(finPeriodeCp(periode))}{t('. The employee may waive them in writing (art. L3141-19).')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {decidables.map(l => {
          const c = choix(l);
          return (
            <div key={l.e.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.e.nom}</div>
                  <div className="text-muted sub">{equipeLabel(l.e)} · {etatTexte(l.etat)}{t(' · offered: ')}{fJ(l.propose)}</div>
                </div>
                <Seg name={`fr-${l.e.id}`} label={`${t('Decision for ')}${l.e.nom}`} value={c.decision}
                  options={[['', t('Later')], ['crediter', t('Credit')], ['renoncer', t('Waiver')]]} onChange={x => set(l, { decision: x })} />
              </div>
              {c.decision === 'crediter' && (
                <Field label={t('Days credited')} htmlFor={`fr-j-${l.e.id}`} erreur={v.erreur(erreur(l))}>
                  <input className="input" id={`fr-j-${l.e.id}`} type="text" inputMode="decimal" value={c.jours} onChange={ev => set(l, { jours: ev.target.value })} style={{ maxWidth: 120 }} />
                </Field>
              )}
              {c.decision === 'renoncer' && <Fine>{t('Written waiver of the employee, to keep in their file: no day credited.')}</Fine>}
            </div>
          );
        })}
        {miennes.map(l => (
          <div key={l.e.id} className="boxed">
            <div style={{ fontSize: 14 }}>{l.e.nom}</div>
            <div className="text-muted sub">{t('Your split days (')}{fJ(l.propose)}{t(' offered): decision by another member of HR.')}</div>
          </div>
        ))}
        {!decidables.length && <Empty pad="sm">{t('No line for you to decide.')}</Empty>}
      </div>
      {rien && v.tente && <Bloquant>{rien}</Bloquant>}
      <Fine>
        {t('On validation: ')}{tn(credites, 'credit', 'credits')}, {tn(decidees.length - credites, 'waiver', 'waivers')}{t('; a line left “Later” stays offered. Each decision is recorded and final.')}
      </Fine>
    </Dialog>
  );
}
