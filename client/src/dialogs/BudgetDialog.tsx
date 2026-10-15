// Enveloppes budgétaires de formation d'un exercice, par équipe. « Reprendre les enveloppes de N » recopie dans les
// champs celles du dernier exercice antérieur qui en a (à ajuster, puis enregistrer) : elles ne se ressaisissent plus
// équipe par équipe chaque année.
import { useState } from 'react';
import { fmtEur, key } from '../../../shared/format.ts';
import { CancelButton, Dialog, SubmitButton } from '../components/Dialog.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Dernier exercice antérieur à `exercice` qui a des enveloppes, ou null. */
const exercicePrecedent = (budgets: Record<string, Record<string, number>>, exercice: number) =>
  Object.keys(budgets).map(Number).filter(y => y < exercice && Object.values(budgets[String(y)] ?? {}).some(m => m > 0)).sort((a, z) => z - a)[0] ?? null;

export function BudgetDialog({ exercice }: { exercice: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const equipes = d.equipes;
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const env = d.ds.budgets[String(exercice)] || {};
    return Object.fromEntries(equipes.map(e => [e, env[e] != null ? String(env[e]) : '']));
  });
  const [busy, setBusy] = useState(false);
  const precedent = exercicePrecedent(d.ds.budgets, exercice);
  const reprendre = () => {
    const env = d.ds.budgets[String(precedent)] || {};
    setVals(Object.fromEntries(equipes.map(e => [e, env[e] != null ? String(env[e]) : ''])));
  };
  const amount = (e: string) => Math.max(0, Number(vals[e]) || 0);
  const total = equipes.reduce((n, e) => n + amount(e), 0);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await run('budget.enveloppes', { exercice, enveloppes: Object.fromEntries(equipes.map(e => [e, amount(e)])) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={`Enveloppes budgétaires ${exercice}`} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {precedent != null && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reprendre}>Reprendre les enveloppes de {precedent}</button>
          </div>
        )}
        {equipes.map(e => {
          const id = `bud-${key(e).replace(/ /g, '-')}`;
          return (
            <div key={e} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px', alignItems: 'center', gap: 'var(--space-3)' }}>
              <label htmlFor={id} style={{ fontSize: 14 }}>{e}</label>
              <div style={{ position: 'relative' }}>
                <input className="input tnum" id={id} type="number" min={0} step={100} value={vals[e] ?? ''}
                  onChange={ev => setVals(s => ({ ...s, [e]: ev.target.value }))} style={{ paddingRight: 'var(--space-8)', textAlign: 'right' }} />
                <span aria-hidden="true" style={{ position: 'absolute', right: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', fontSize: 13, opacity: 0.6, pointerEvents: 'none' }}>€</span>
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14, paddingTop: 'var(--space-3)', background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
          <span>Enveloppe totale</span>
          <span className="tnum" style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-heading-weight)', fontSize: 18 }}>{fmtEur(total)}</span>
        </div>
      </div>
    </Dialog>
  );
}
