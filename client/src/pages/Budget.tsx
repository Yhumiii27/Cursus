// Plan & budget : enveloppes par équipe, consommation (réalisé + engagé), plan prévisionnel de formation.
// Tous les exercices présents en base se consultent ; un exercice clos (shared/rules/exercices.ts) est en lecture seule.
// Le réalisé compte le coût réel saisi à la clôture de chaque action (PlanRealiserDialog), avec son écart au prévu.
// lot 11 — dossiers OPCO : onglet « Dossiers OPCO » (components/opco/), colonne OPCO des lignes et coût net du réalisé.
import { useMemo } from 'react';
import { DownloadSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { PLAN_CLS, PLAN_LABEL } from '../../../shared/constants.ts';
import { fmtEur, fmtIso } from '../../../shared/format.ts';
import { budgetSummary } from '../../../shared/rules/budget.ts';
import { clotureDe, coutRetenu, exercicesProposes } from '../../../shared/rules/exercices.ts';
import { ligneCorrigeable, sessionsDeLaLigne } from '../../../shared/rules/corrections.ts';
import { suppressionLignePlan } from '../state/confirmations-corrections.ts';
import type { PlanAction, PlanStatut } from '../../../shared/types.ts';
import { Bar, Btn, Empty, Kpi, Kpis, Page, Panel, Seg, StackBar, Tag, Two } from '../components/ui.tsx';
// lot 12 — C4 (organismes de formation et e-learning) : marque Qualiopi et NDA de l'organisme prévu d'une ligne.
import { avertissementsPlan } from '../../../shared/rules/organismes-suivi.ts';
import { organismeDuPlan } from '../../../shared/rules/organismes.ts';
import { csvPlan } from '../listes-csv.ts';
import { downloadCsv } from '../print.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useAgir } from '../state/actions.ts';
import { useStore } from '../state/store.tsx';
import { IndicateursFormationPanel } from '../components/IndicateursFormation.tsx';
// lot 11 — dossiers OPCO : onglet, colonne du plan et coût net (components/opco/, shared/rules/opco.ts).
import { coutNetPlan } from '../../../shared/rules/opco.ts';
import { ColonneOpco } from '../components/opco/ColonneOpco.tsx';
import { DossiersOpco } from '../components/opco/DossiersOpco.tsx';
import { t, tn } from '../i18n/langue.ts';

const C_REAL = 'var(--color-accent-300)', C_ENG = 'var(--color-accent-600)', C_PREVU = 'var(--color-neutral-700)';
const share = (x: number, base: number) => base ? Math.min(100, x / base * 100) : 0;
const parts = (r: number, g: number, p: number, base: number) => [
  { pct: share(r, base), color: C_REAL }, { pct: share(g, base), color: C_ENG }, { pct: share(p, base), color: C_PREVU },
];

export function Budget() {
  const d = useDomain();
  const { ui, setUi, openDialog, run, notify } = useStore();
  // Lecture seule : plan et enveloppes consultés, sans import ni avancement.
  const { rh, admin, consultation } = useRole();
  const { occupe, agir } = useAgir();
  const year = d.year;
  const ex = ui.exercice ?? year;
  const seuil = d.ds.settings.seuilBudget;
  const b = useMemo(() => budgetSummary(d, ex, seuil), [d, ex, seuil]);

  const exOptions = [...new Set([...exercicesProposes(d.ds, year), ex])].sort((a, z) => a - z).map(y => [y, String(y)] as [number, string]);
  // Exercice clos : ni enveloppes, ni import, ni avancement.
  const clos = clotureDe(d.ds, ex);
  const modifiable = rh && !clos;
  const count = (st: PlanStatut) => b.planEx.filter(l => l.statut === st).length;
  const ecart = (n: number) => `${n > 0 ? '+' : '−'}${fmtEur(Math.abs(n))}`;
  const qMax = Math.max(1, ...b.quarters.map(q => q.r + q.g + q.p));
  // lot 11 — dossiers OPCO : service RH et lecture seule ; coût net du plan (réalisé moins les versements de l'OPCO).
  const voitOpco = rh || consultation;
  const onglet = voitOpco ? ui.budgetOnglet : 'plan';
  const net = voitOpco ? coutNetPlan(b.realise, ex, b.planEx, d.ds.dossiersOpco, d.ds.versementsOpco) : null;
  const planRows = b.planEx
    .filter(l => ui.planFilter === 'tous' || l.statut === ui.planFilter)
    .sort((a, z) => a.periode.localeCompare(z.periode) || a.equipe.localeCompare(z.equipe));

  const openImport = () => openDialog({ type: 'planImport', exercice: ex });
  // Plan de l'exercice affiché, avec le filtre de statut.
  const exporter = () => {
    const x = csvPlan(d, ex, planRows);
    downloadCsv(x.fichier, x.head, x.rows);
    notify(`${t('CSV export generated — ')}${tn(planRows.length, 'action', 'actions')}`);
  };
  // Le statut affiché accompagne la demande : un second clic n'avance pas l'action d'un cran de plus.
  // Clôturer une action engagée : coût et effectif réels demandés (PlanRealiserDialog).
  const act = (l: PlanAction) => {
    if (l.statut === 'prevu' && l.f) openDialog({ type: 'session', f: l.f, planId: l.id, places: l.effectif });
    else if (l.statut === 'engage') openDialog({ type: 'planRealiser', id: l.id });
    else return run('plan.avancer', { id: l.id, de: l.statut });
  };

  return (
    <Page
      kicker={`${t('Financial year ')}${ex} · ${tn(b.planEx.length, 'action', 'actions')} · ${fmtEur(b.envTotal)}${t(' of envelope')}`}
      title={t('Plan & budget')}
      actions={<>
        <Seg name="exercice" label={t('Financial year')} value={ex} onChange={v => setUi({ exercice: v, planFilter: 'tous' })} options={exOptions} style={{ flexWrap: 'wrap' }} />
        {modifiable && <>
          <Btn onClick={() => openDialog({ type: 'budget', exercice: ex })}>{t('Envelopes')}</Btn>
          <Btn variant="secondary" icon={<UploadSimpleIcon size={14} />} onClick={openImport}>{t('Import a plan')}</Btn>
        </>}
        {admin && !clos && ex < year && <Btn onClick={() => openDialog({ type: 'exerciceCloture', exercice: ex })}>{t('Close the financial year')}</Btn>}
      </>}
      note={clos ? `${t('Financial year closed on ')}${fmtIso(clos.le)}${t(' by ')}${clos.par}${t(': plan and envelopes read only.')}` : undefined}
    >
      {voitOpco && (
        <Seg name="budgetOnglet" label={t('Plan & budget tab')} value={onglet} onChange={v => setUi({ budgetOnglet: v, opcoSel: null })} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}
          options={[['plan', t('Plan & budget')], ['opco', t('OPCO files')]]} />
      )}
      {onglet === 'opco' ? <DossiersOpco key={ex} exercice={ex} /> : <>
      <Kpis>
        <Kpi kicker={t('Annual envelope')} value={fmtEur(b.envTotal)} sub={`${d.equipes.length}${t(' teams#count')} · ${tn(b.planEx.length, 'action in the plan', 'actions in the plan')}`} />
        <Kpi kicker={t('Done#budget')} value={fmtEur(b.realise)}
          sub={`${b.envTotal ? Math.round(b.realise / b.envTotal * 100) : 0}${t(' % of the envelope')} · ${tn(count('realise'), 'action done', 'actions done')}${b.ecart ? ` · ${ecart(b.ecart)}${t(' compared with the plan')}` : ''}${net?.verse ? ` · ${t('net cost ')}${fmtEur(net.net)}${t(' after ')}${fmtEur(net.verse)}${t(' paid by the OPCO')}` : ''}`} />
        <Kpi kicker={t('Committed')} value={fmtEur(b.engage)} sub={`${tn(count('engage'), 'session ordered', 'sessions ordered')} · ${t('to carry out')}`} />
        <Kpi kicker={t('Available')} value={fmtEur(b.dispo)} sub={b.dispo < 0 ? t('envelope exceeded') : `${t('of which ')}${fmtEur(b.prevu)}${t(' already planned')}`} />
      </Kpis>

      <div className="row-wrap">
        <Panel style={{ flex: '1 1 560px', gap: 'var(--space-4)' }} title={t('Consumption by team')} aside={`${b.pctConso}${t(' % consumed (done + committed)')}`}>
          <Bar pct={b.pctConso} color={b.pctConso >= seuil ? C_REAL : C_ENG} />
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Team')}</th><th>{t('Envelope')}</th><th>{t('Done#budget')}</th><th>{t('Committed')}</th><th>{t('Planned#budget')}</th><th>{t('Available')}</th><th style={{ width: '30%' }}>{t('Consumption')}</th></tr></thead>
              <tbody>
                {b.teams.map(eq => {
                  const flag = eq.over ? t('Exceeded') : eq.tension ? t('Tension') : eq.overPlan ? t('Plan > envelope') : null;
                  return (
                    <tr key={eq.nom}>
                      <td className="nowrap">{eq.nom}</td>
                      <td className="tnum nowrap">{fmtEur(eq.env)}</td>
                      <td className="tnum nowrap">{fmtEur(eq.r)}</td>
                      <td className="tnum nowrap">{fmtEur(eq.g)}</td>
                      <td className="text-muted tnum nowrap">{fmtEur(eq.p)}</td>
                      <td className="tnum nowrap">{fmtEur(eq.env - eq.r - eq.g)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <div style={{ flex: 1, minWidth: 60 }}><StackBar parts={parts(eq.r, eq.g, eq.p, eq.env)} /></div>
                          <span className="right tnum muted-70" style={{ width: 40, fontSize: 12 }}>{eq.pct} %</span>
                          {flag && <Tag cls={eq.over ? 'tag-accent' : 'tag-outline'}>{flag}</Tag>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="legend">
            {([['Done#budget', C_REAL], ['Committed', C_ENG], ['Planned#budget', C_PREVU]] as const).map(([label, color]) => (
              <span key={label}><span style={{ width: 10, height: 4, borderRadius: 2, background: color }} />{t(label)}</span>
            ))}
          </div>
        </Panel>

        <Panel style={{ flex: '1 1 300px', gap: 'var(--space-4)' }} title={t('By quarter')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {b.quarters.map(q => (
              <div key={q.t} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', fontSize: 13 }}>
                  <span>
                    <span className="section-label" style={{ marginRight: 'var(--space-3)' }}>{q.t}</span>
                    <span className="text-muted sub">{tn(q.n, 'action', 'actions')}</span>
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
          <h2>{t('Forecast plan ')}{ex}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Seg name="planFilter" label={t('Status of the plan')} value={ui.planFilter} onChange={v => setUi({ planFilter: v })}
              options={[['tous', t('All#everything')], ['prevu', t('Planned#budget')], ['engage', t('Committed')], ['realise', t('Done#budget')], ...(count('reporte') ? [['reporte', t('Postponed')] as ['reporte', string]] : [])]} />
            {planRows.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>{t('Export (CSV)')}</Btn>}
          </div>
        </div>
      }>
        {b.planEx.length > 0 && planRows.length > 0 && (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Training#course')}</th><th>{t('Team')}</th><th>{t('Period')}</th><th>{t('Headcount')}</th><th>{t('Cost')}</th><th>{t('Status')}</th>{voitOpco && <th>OPCO</th>}<th></th></tr></thead>
              <tbody>
                {planRows.map(l => {
                  const fm = (l.f && d.fm(l.f)) || null;
                  // lot 12 — C4 : organisme prévu (fiche) et ses avertissements (Qualiopi échu ou absent, NDA absent).
                  const prevu = organismeDuPlan(d.ds, l), avert = avertissementsPlan(d.ds, l, d.ti);
                  return (
                    <tr key={l.id}>
                      <td>
                        <Two main={fm ? fm.nom : l.libelle} sub={fm ? `${fm.type} · ${prevu?.nomUsuel ?? fm.organisme}` : prevu ? `${t('Outside the catalogue')} · ${prevu.nomUsuel}` : t('Outside the catalogue')} />
                        {avert.length > 0 && <div className="sub" style={{ color: 'var(--color-accent-300)' }} title={avert.join(' · ')}>{t(avert.some(a => a.includes('Qualiopi')) ? 'Qualiopi to check' : 'NDA missing')}</div>}
                      </td>
                      <td className="text-muted nowrap">{l.equipe}</td>
                      <td>{l.periode}</td>
                      <td className="tnum">{l.statut === 'realise' && l.effectifReel != null ? l.effectifReel : l.effectif}</td>
                      <td>
                        <div className="tnum nowrap">{fmtEur(coutRetenu(l))}</div>
                        {/* Réalisée : coût réel, avec le prévu s'il diffère ; sinon coût par personne. */}
                        {l.statut === 'realise' && l.coutReel != null && l.coutReel !== l.cout
                          ? <div className="text-muted sub nowrap">{t('planned ')}{fmtEur(l.cout)} · {ecart(l.coutReel - l.cout)}</div>
                          : l.effectif > 0 && <div className="text-muted sub nowrap">{fmtEur(l.cout / l.effectif)}{t(' / pers.')}</div>}
                      </td>
                      <td>
                        <Tag cls={PLAN_CLS[l.statut]}>{PLAN_LABEL[l.statut]}</Tag>
                        {l.statut === 'reporte' && <div className="text-muted sub nowrap">{t('to#year')}{l.exercice + 1}</div>}
                        {l.origine === 'report' && <div className="text-muted sub nowrap">{t('postponed from ')}{l.exercice - 1}</div>}
                        {/* lot 12 — C3 (entretiens suivis) : ligne née d'un souhait exprimé en entretien (bilan formation, dossier OPCO). */}
                        {l.origine === 'entretien' && <div className="text-muted sub nowrap">{t('from a review')}</div>}
                      </td>
                      {voitOpco && <td><ColonneOpco l={l} /></td>}
                      <td className="right">
                        {modifiable && ligneCorrigeable(l) && (
                          <div className="actions-end" style={{ flexWrap: 'nowrap' }}>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => act(l))}>
                              {t(l.statut === 'prevu' ? (fm ? 'Plan the session' : 'Commit') : 'Close#action')}
                            </button>
                            {/* Saisie erronée : correction (service RH), suppression sans session ouverte rattachée (administrateur RH). */}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'planLigne', id: l.id })}>{t('Correct')}</button>
                            {admin && !sessionsDeLaLigne(d, l).length && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: suppressionLignePlan(l, fm ? fm.nom : l.libelle ?? '') })}>{t('Delete')}</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {b.planEx.length > 0 && planRows.length === 0 && <Empty pad="sm">{t('No action with this status.')}</Empty>}
        {b.planEx.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-6) 0' }}>
            <p style={{ fontSize: 15, margin: 0 }}>{t('No plan for this financial year.')}</p>
            {!clos && (
              <p className="text-muted" style={{ fontSize: 13, margin: 0, maxWidth: '56ch' }}>
                {t('Import the forecast plan (CSV exported from your spreadsheet): each line becomes a “Planned” action, attached to a team and a quarter, and feeds the envelopes above.')}
              </p>
            )}
            {modifiable && <Btn variant="primary" onClick={openImport}>{t('Import a plan')}</Btn>}
          </div>
        )}
      </Panel>

      {/* Indicateurs de formation de l'exercice (t122) : stagiaires, heures par catégorie, équipe et statut ; exports CSV. */}
      <IndicateursFormationPanel exercice={ex} />
      </>}
    </Page>
  );
}
