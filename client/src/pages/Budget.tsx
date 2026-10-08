// Plan & budget : enveloppes par équipe, consommation (réalisé + engagé), plan prévisionnel de formation.
import { useMemo } from 'react';
import { UploadSimpleIcon } from '@phosphor-icons/react';
import { PLAN_CLS, PLAN_LABEL } from '../../../shared/constants.ts';
import { fmtEur, plural } from '../../../shared/format.ts';
import { budgetSummary } from '../../../shared/rules/budget.ts';
import type { PlanAction, PlanStatut } from '../../../shared/types.ts';
import { Bar, Btn, Empty, Kpi, Kpis, Page, Panel, Seg, StackBar, Tag, Two } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const C_REAL = 'var(--color-accent-300)', C_ENG = 'var(--color-accent-600)', C_PREVU = 'var(--color-neutral-700)';
const share = (x: number, base: number) => base ? Math.min(100, x / base * 100) : 0;
const parts = (r: number, g: number, p: number, base: number) => [
  { pct: share(r, base), color: C_REAL }, { pct: share(g, base), color: C_ENG }, { pct: share(p, base), color: C_PREVU },
];

export function Budget() {
  const d = useDomain();
  const { ui, setUi, openDialog, run } = useStore();
  const year = d.year;
  const ex = ui.exercice ?? year;
  const seuil = d.ds.settings.seuilBudget;
  const b = useMemo(() => budgetSummary(d, ex, seuil), [d, ex, seuil]);

  const exOptions = [...new Set([year, year + 1, ex])].sort((a, z) => a - z).map(y => [y, String(y)] as [number, string]);
  const count = (st: PlanStatut) => b.planEx.filter(l => l.statut === st).length;
  const qMax = Math.max(1, ...b.quarters.map(q => q.r + q.g + q.p));
  const planRows = b.planEx
    .filter(l => ui.planFilter === 'tous' || l.statut === ui.planFilter)
    .sort((a, z) => a.periode.localeCompare(z.periode) || a.equipe.localeCompare(z.equipe));

  const openImport = () => openDialog({ type: 'planImport', exercice: ex });
  const act = (l: PlanAction) => {
    if (l.statut === 'prevu' && l.f) openDialog({ type: 'session', f: l.f, planId: l.id, places: l.effectif });
    else run('plan.avancer', { id: l.id });
  };

  return (
    <Page
      kicker={`Exercice ${ex} · ${plural(b.planEx.length, 'action', 'actions')} · ${fmtEur(b.envTotal)} d’enveloppe`}
      title="Plan & budget"
      actions={<>
        <Seg name="exercice" label="Exercice" value={ex} onChange={v => setUi({ exercice: v, planFilter: 'tous' })} options={exOptions} />
        <Btn onClick={() => openDialog({ type: 'budget', exercice: ex })}>Enveloppes</Btn>
        <Btn variant="secondary" icon={<UploadSimpleIcon size={14} />} onClick={openImport}>Importer un plan</Btn>
      </>}
    >
      <Kpis>
        <Kpi kicker="Enveloppe annuelle" value={fmtEur(b.envTotal)} sub={`${d.equipes.length} équipes · ${plural(b.planEx.length, 'action au plan', 'actions au plan')}`} />
        <Kpi kicker="Réalisé" value={fmtEur(b.realise)}
          sub={`${b.envTotal ? Math.round(b.realise / b.envTotal * 100) : 0} % de l’enveloppe · ${plural(count('realise'), 'action réalisée', 'actions réalisées')}`} />
        <Kpi kicker="Engagé" value={fmtEur(b.engage)} sub={`${plural(count('engage'), 'session commandée', 'sessions commandées')} · à réaliser`} />
        <Kpi kicker="Disponible" value={fmtEur(b.dispo)} sub={b.dispo < 0 ? 'enveloppe dépassée' : `dont ${fmtEur(b.prevu)} déjà prévus au plan`} />
      </Kpis>

      <div className="row-wrap">
        <Panel style={{ flex: '1 1 560px', gap: 'var(--space-4)' }} title="Consommation par équipe" aside={`${b.pctConso} % consommés (réalisé + engagé)`}>
          <Bar pct={b.pctConso} color={b.pctConso >= seuil ? C_REAL : C_ENG} />
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Équipe</th><th>Enveloppe</th><th>Réalisé</th><th>Engagé</th><th>Prévu</th><th>Disponible</th><th style={{ width: '30%' }}>Consommation</th></tr></thead>
              <tbody>
                {b.teams.map(t => {
                  const flag = t.over ? 'Dépassé' : t.tension ? 'Tension' : t.overPlan ? 'Plan > enveloppe' : null;
                  return (
                    <tr key={t.nom}>
                      <td className="nowrap">{t.nom}</td>
                      <td className="tnum nowrap">{fmtEur(t.env)}</td>
                      <td className="tnum nowrap">{fmtEur(t.r)}</td>
                      <td className="tnum nowrap">{fmtEur(t.g)}</td>
                      <td className="text-muted tnum nowrap">{fmtEur(t.p)}</td>
                      <td className="tnum nowrap">{fmtEur(t.env - t.r - t.g)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <div style={{ flex: 1, minWidth: 60 }}><StackBar parts={parts(t.r, t.g, t.p, t.env)} /></div>
                          <span className="right tnum muted-70" style={{ width: 40, fontSize: 12 }}>{t.pct} %</span>
                          {flag && <Tag cls={t.over ? 'tag-accent' : 'tag-outline'}>{flag}</Tag>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="legend">
            {([['Réalisé', C_REAL], ['Engagé', C_ENG], ['Prévu', C_PREVU]] as const).map(([label, color]) => (
              <span key={label}><span style={{ width: 10, height: 4, borderRadius: 2, background: color }} />{label}</span>
            ))}
          </div>
        </Panel>

        <Panel style={{ flex: '1 1 300px', gap: 'var(--space-4)' }} title="Par trimestre">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {b.quarters.map(q => (
              <div key={q.t} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', fontSize: 13 }}>
                  <span>
                    <span className="section-label" style={{ marginRight: 'var(--space-3)' }}>{q.t}</span>
                    <span className="text-muted sub">{plural(q.n, 'action', 'actions')}</span>
                  </span>
                  <span className="tnum">{fmtEur(q.r + q.g + q.p)}</span>
                </div>
                <StackBar variant="thick" parts={parts(q.r, q.g, q.p, qMax)} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel head={
        <div className="panel-head center">
          <h2>Plan prévisionnel {ex}</h2>
          <Seg name="planFilter" label="Statut du plan" value={ui.planFilter} onChange={v => setUi({ planFilter: v })}
            options={[['tous', 'Tout'], ['prevu', 'Prévu'], ['engage', 'Engagé'], ['realise', 'Réalisé']]} />
        </div>
      }>
        {b.planEx.length > 0 && planRows.length > 0 && (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Formation</th><th>Équipe</th><th>Période</th><th>Effectif</th><th>Coût</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {planRows.map(l => {
                  const fm = (l.f && d.fm(l.f)) || null;
                  return (
                    <tr key={l.id}>
                      <td><Two main={fm ? fm.nom : l.libelle} sub={fm ? `${fm.type} · ${fm.organisme}` : 'Hors catalogue'} /></td>
                      <td className="text-muted nowrap">{l.equipe}</td>
                      <td>{l.periode}</td>
                      <td className="tnum">{l.effectif}</td>
                      <td>
                        <div className="tnum nowrap">{fmtEur(l.cout)}</div>
                        {l.effectif > 0 && <div className="text-muted sub nowrap">{fmtEur(l.cout / l.effectif)} / pers.</div>}
                      </td>
                      <td><Tag cls={PLAN_CLS[l.statut]}>{PLAN_LABEL[l.statut]}</Tag></td>
                      <td className="right">
                        {l.statut !== 'realise' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(l)}>
                            {l.statut === 'prevu' ? (fm ? 'Planifier la session' : 'Engager') : 'Clôturer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {b.planEx.length > 0 && planRows.length === 0 && <Empty pad="sm">Aucune action avec ce statut.</Empty>}
        {b.planEx.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-6) 0' }}>
            <p style={{ fontSize: 15, margin: 0 }}>Aucun plan pour cet exercice.</p>
            <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: '56ch' }}>
              Importez le plan prévisionnel (CSV exporté de votre tableur) : chaque ligne devient une action « Prévue », rattachée à une équipe et à un trimestre, et vient alimenter les enveloppes ci-dessus.
            </p>
            <Btn variant="primary" onClick={openImport}>Importer un plan</Btn>
          </div>
        )}
      </Panel>
    </Page>
  );
}
