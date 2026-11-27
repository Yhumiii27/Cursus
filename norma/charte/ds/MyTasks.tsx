'use client';
// « Mes tâches » (Norma 2.4, charte/COQUE.md § 2 bis.4) : toutes les tâches de la personne dans toute la suite, sous trois
// vues comme Microsoft Teams / Planner — liste (groupée, triable), tableau kanban (À faire · En cours · En attente · Fait),
// calendrier (mois ou semaine, par échéance). Vue choisie par le `Segmented` de la charte, dans l'URL (`?vue=`) quand
// l'outil passe `hrefs`. Les données arrivent par les props (`matrix.pub_taches` lue par l'outil, contrats/taches-v1.md) :
// la charte ne va rien chercher. Un déplacement sur le tableau n'est possible que si l'outil propriétaire l'ouvre
// (`actions` de la ligne) et que l'outil peut agir sur la ligne (`moveAction`) ; sinon les cartes ne se déplacent pas.
import { CalendarBlank, CaretLeft, CaretRight, Kanban as KanbanIcon, ListBullets } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState, type DragEvent } from 'react';
import { useI18n } from '@/i18n/client';
import { EmptyState } from './EmptyState';
import { FilterBar, FilterGroup, FilterLabel } from './FilterBar';
import { Segmented, type SegmentedOption } from './Segmented';
import { DueText, OpenInTool, SourcesBanner, StateTag, STATE_LABELS, TaskSource } from './TaskParts';
import { cx } from './cx';
import {
  byDay, DEFAULT_TASK_VIEW, groupTasks, kanban, monthWeeks, moveAction, shiftPeriod, shownTitle, sortTasks, TASK_VIEWS, weekDays,
  type CalendarMode, type DecideContext, type DueBucket, type GroupBy, type SortDir, type SortKey, type TaskAction, type TaskRow,
  type TaskState, type TaskView,
} from './task-rules';

export const VIEW_LABELS: Record<TaskView, string> = { liste: 'List', kanban: 'Board', calendrier: 'Calendar' };
export const BUCKET_LABELS: Record<DueBucket, string> = {
  retard: 'Late', aujourdhui: 'Today', semaine: 'This week', plus_tard: 'Later', sans_echeance: 'No due date', terminee: 'Completed',
};
const VIEW_ICONS = { liste: ListBullets, kanban: KanbanIcon, calendrier: CalendarBlank };

export interface MyTasksProps extends DecideContext {
  /** Rows of the person (tasks only, or tasks and approvals), already deduplicated by the tool (`dedupe`). */
  items: readonly TaskRow[];
  /** Business day of the tool (AAAA-MM-JJ). */
  today: string;
  view?: TaskView;
  /** URL of each view (`?vue=`): the views become links. Otherwise `onView`. */
  viewHref?: (v: TaskView) => string;
  onView?: (v: TaskView) => void;
  /** Tools whose publication could not be read (« source indisponible » banner). */
  unavailable?: readonly string[];
  /** Kanban move: called with the action the owner tool opened; without it, cards never move. */
  onMove?: (row: TaskRow, action: TaskAction, to: TaskState) => void;
  /** Calendar: mode and shown day, kept by the tool (URL) or by the component. */
  calendar?: { mode: CalendarMode; date: string; href?: (mode: CalendarMode, date: string) => string };
}

export function MyTasks({ items, today, view = DEFAULT_TASK_VIEW, viewHref, onView, unavailable, onMove, calendar, ...ctx }: MyTasksProps) {
  const { t } = useI18n();
  const options: SegmentedOption<TaskView>[] = TASK_VIEWS.map((v) => ({
    value: v, label: t(VIEW_LABELS[v]), icon: VIEW_ICONS[v], href: viewHref?.(v),
  }));
  return (
    <div className="coque-tasks">
      <FilterBar>
        <Segmented options={options} value={view} onChange={viewHref ? undefined : onView} label={t('Task view')} />
      </FilterBar>
      <SourcesBanner unavailable={unavailable} />
      {view === 'liste' && <TaskList items={items} today={today} ctx={ctx} />}
      {view === 'kanban' && <TaskBoard items={items} today={today} ctx={ctx} onMove={onMove} />}
      {view === 'calendrier' && <TaskCalendar items={items} today={today} ctx={ctx} calendar={calendar} />}
    </div>
  );
}

// ── Liste ────────────────────────────────────────────────────────────────────────────────────────────────────────
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'titre', label: 'Task' }, { key: 'outil', label: 'Source' }, { key: 'echeance', label: 'Due' },
  { key: 'etat', label: 'State' }, { key: 'priorite', label: 'Priority' },
];
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'echeance', label: 'Due date' }, { value: 'outil', label: 'Tool' }, { value: 'etat', label: 'State' }, { value: 'type', label: 'Type' },
];

function TaskList({ items, today, ctx }: { items: readonly TaskRow[]; today: string; ctx: DecideContext }) {
  const { t } = useI18n();
  const [by, setBy] = useState<GroupBy>('echeance');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'echeance', dir: 'asc' });
  const groups = useMemo(() => groupTasks(sortTasks(items, sort.key, sort.dir), by, today), [items, sort, by, today]);
  const groupLabel = (k: string) =>
    by === 'echeance' ? t(BUCKET_LABELS[k as DueBucket]) : by === 'etat' ? t(STATE_LABELS[k as TaskState]) : by === 'outil' ? k : items.find((r) => r.type === k)?.type_libelle ?? k;
  if (!items.length) return <EmptyState variant="boxed">{t('No task')}</EmptyState>;
  return (
    <>
      <FilterBar>
        <FilterGroup>
          <FilterLabel>{t('Group by')}</FilterLabel>
          <Segmented options={GROUPS.map((g) => ({ value: g.value, label: t(g.label) }))} value={by} onChange={setBy} label={t('Group by')} />
        </FilterGroup>
      </FilterBar>
      <table className="table coque-task-table">
        <thead>
          <tr>
            {SORTS.map((s) => {
              const on = sort.key === s.key;
              return (
                <th key={s.key} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="coque-task-sort" onClick={() => setSort({ key: s.key, dir: on && sort.dir === 'asc' ? 'desc' : 'asc' })}>
                    {t(s.label)}
                  </button>
                </th>
              );
            })}
            <th><span className="coque-sr-only">{t('Open')}</span></th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="coque-task-group">
              <th scope="rowgroup" colSpan={SORTS.length + 1}>
                {groupLabel(g.key)} <span className="coque-task-count">{g.items.length}</span>
              </th>
            </tr>
            {g.items.map((r) => (
              <tr key={`${r.outil}:${r.tache_id}`}>
                <td>
                  <span className="coque-task-title">{shownTitle(r, ctx.tool)}</span>
                  <span className="coque-task-sub">{r.type_libelle}{r.objet_ref ? ` · ${r.objet_ref}` : ''}</span>
                </td>
                <td><TaskSource outil={r.outil} /></td>
                <td><DueText row={r} today={today} /></td>
                <td><StateTag etat={r.etat} /></td>
                <td>{r.priorite === 'haute' ? t('High') : <span className="coque-task-muted">{t('Normal')}</span>}</td>
                <td className="coque-task-actions"><OpenInTool row={r} tool={ctx.tool} /></td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </>
  );
}

// ── Tableau kanban ───────────────────────────────────────────────────────────────────────────────────────────────
const DRAG_TYPE = 'application/x-atrium-task';

function TaskBoard({ items, today, ctx, onMove }: { items: readonly TaskRow[]; today: string; ctx: DecideContext; onMove?: MyTasksProps['onMove'] }) {
  const { t } = useI18n();
  const [dragged, setDragged] = useState<TaskRow | null>(null);
  const [over, setOver] = useState<TaskState | null>(null);
  const cols = useMemo(() => kanban(items), [items]);
  const targetsOf = (r: TaskRow) => (onMove ? cols.map((c) => c.state).filter((s) => moveAction(r, s, ctx)) : []);
  const drop = (to: TaskState) => {
    const a = dragged && moveAction(dragged, to, ctx);
    if (dragged && a && onMove) onMove(dragged, a, to);
    setDragged(null); setOver(null);
  };
  return (
    <div className="coque-kanban">
      {cols.map((c) => {
        const accepts = !!dragged && !!moveAction(dragged, c.state, ctx);
        return (
          <section
            key={c.state}
            className={cx('coque-kanban-col', accepts && over === c.state && 'is-over')}
            aria-label={t(STATE_LABELS[c.state])}
            onDragOver={(e: DragEvent) => { if (accepts) { e.preventDefault(); setOver(c.state); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e: DragEvent) => { e.preventDefault(); drop(c.state); }}
          >
            <h3 className="coque-kanban-head">
              {t(STATE_LABELS[c.state])} <span className="coque-task-count">{c.items.length}</span>
            </h3>
            {c.items.map((r) => {
              const targets = targetsOf(r);
              return (
                <article
                  key={`${r.outil}:${r.tache_id}`}
                  className={cx('coque-kanban-card', targets.length > 0 && 'is-draggable')}
                  draggable={targets.length > 0}
                  aria-grabbed={targets.length > 0 ? dragged === r : undefined}
                  onDragStart={(e: DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, `${r.outil}:${r.tache_id}`); setDragged(r); }}
                  onDragEnd={() => { setDragged(null); setOver(null); }}
                >
                  <TaskSource outil={r.outil} />
                  <a className="coque-task-title" href={r.lien} target={r.outil !== ctx.tool ? '_blank' : undefined} rel="noopener">
                    {shownTitle(r, ctx.tool)}
                  </a>
                  <span className="coque-task-sub">{r.type_libelle}{r.objet_ref ? ` · ${r.objet_ref}` : ''}</span>
                  <span className="coque-kanban-meta">
                    <DueText row={r} today={today} />
                    {r.priorite === 'haute' && <span className="coque-task-high">{t('High')}</span>}
                  </span>
                  {targets.length > 0 && (
                    <span className="coque-kanban-moves" role="group" aria-label={t('Move to')}>
                      {targets.map((s) => (
                        <button key={s} type="button" className="btn btn-ghost coque-kanban-move" onClick={() => onMove!(r, moveAction(r, s, ctx)!, s)}>
                          → {t(STATE_LABELS[s])}
                        </button>
                      ))}
                    </span>
                  )}
                </article>
              );
            })}
            {!c.items.length && <EmptyState>{t('No task')}</EmptyState>}
          </section>
        );
      })}
    </div>
  );
}

// ── Calendrier ───────────────────────────────────────────────────────────────────────────────────────────────────
function TaskCalendar({ items, today, ctx, calendar }: { items: readonly TaskRow[]; today: string; ctx: DecideContext; calendar?: MyTasksProps['calendar'] }) {
  const { t, lang } = useI18n();
  const [own, setOwn] = useState<{ mode: CalendarMode; date: string }>({ mode: calendar?.mode ?? 'mois', date: calendar?.date ?? today });
  const { mode, date } = calendar?.href ? calendar : own;
  const go = (m: CalendarMode, d: string) => (calendar?.href ? undefined : () => setOwn({ mode: m, date: d }));
  const href = (m: CalendarMode, d: string) => calendar?.href?.(m, d);
  const days = byDay(items);
  const loc = lang === 'en' ? 'en-GB' : 'fr-FR';
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const weeks = mode === 'mois' ? monthWeeks(date) : [weekDays(date)];
  const month = date.slice(0, 7);
  const title = mode === 'mois' ? fmt(`${month}-01`, { month: 'long', year: 'numeric' }) : `${fmt(weeks[0][0], { day: 'numeric', month: 'short' })} – ${fmt(weeks[0][6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const nav = (label: string, d: string, I: typeof CaretLeft) => {
    const h = href(mode, d);
    return h ? (
      <a className="btn btn-ghost btn-icon" href={h} aria-label={label} title={label}><I size={14} aria-hidden /></a>
    ) : (
      <button type="button" className="btn btn-ghost btn-icon" onClick={go(mode, d)} aria-label={label} title={label}><I size={14} aria-hidden /></button>
    );
  };
  return (
    <div className="coque-cal">
      <FilterBar>
        <Segmented
          options={(['mois', 'semaine'] as const).map((m) => ({ value: m, label: t(m === 'mois' ? 'Month' : 'Week'), href: href(m, date) }))}
          value={mode}
          onChange={calendar?.href ? undefined : (m) => setOwn({ mode: m, date })}
          label={t('Calendar period')}
        />
        <FilterGroup>
          {nav(t('Previous period'), shiftPeriod(date, mode, -1), CaretLeft)}
          <span className="coque-cal-title" aria-live="polite">{title}</span>
          {nav(t('Next period'), shiftPeriod(date, mode, 1), CaretRight)}
        </FilterGroup>
      </FilterBar>
      <table className={cx('coque-cal-grid', mode === 'semaine' && 'is-week')}>
        <caption className="coque-sr-only">{title}</caption>
        <thead>
          <tr>{weeks[0].map((d) => <th key={d} scope="col">{fmt(d, { weekday: 'short' })}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w[0]}>
              {w.map((d) => {
                const list = days.get(d) ?? [];
                return (
                  <td key={d} className={cx('coque-cal-day', mode === 'mois' && d.slice(0, 7) !== month && 'is-out', d === today && 'is-today')}>
                    <span className="coque-cal-num" aria-current={d === today ? 'date' : undefined}>{fmt(d, { day: 'numeric' })}</span>
                    {list.map((r) => (
                      <a key={`${r.outil}:${r.tache_id}`} className={cx('coque-cal-item', r.etat === 'faite' && 'is-done')} href={r.lien}
                        target={r.outil !== ctx.tool ? '_blank' : undefined} rel="noopener" title={`${r.type_libelle} · ${shownTitle(r, ctx.tool)}`}>
                        <TaskSource outil={r.outil} />
                        <span className="coque-cal-item-title">{shownTitle(r, ctx.tool)}</span>
                      </a>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.some((r) => r.echeance) && <EmptyState>{t('No task with a due date')}</EmptyState>}
    </div>
  );
}
