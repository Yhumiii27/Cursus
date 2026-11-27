'use client';
// « Mes approbations » (Norma 2.4, charte/COQUE.md § 2 bis.5) : toutes les décisions attendues de la personne dans toute la
// suite, filtrables par outil, type et échéance, plus celles décidées dans les sept derniers jours. Chaque ligne montre son
// outil d'origine, son titre, son échéance, son état et un lien profond vers l'outil propriétaire. Les boutons Approuver /
// Refuser ne sont rendus que si la ligne le permet ici (`decisionsHere` : ligne de l'outil, ou décision à distance ouverte
// par l'outil propriétaire et phase 2 active) ; sinon « Ouvrir dans <outil> ». Données par les props, rien n'est chargé ici ;
// le motif d'un refus se saisit dans le panneau latéral de l'outil (`onDecide`).
import { Check, Funnel, X } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { EmptyState } from './EmptyState';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from './FilterBar';
import { DueText, OpenInTool, SourcesBanner, StateTag, TaskSource, toolName } from './TaskParts';
import {
  decisionsHere, filterApprovals, isOpen, shownTitle, toolsOf, typesOf,
  type ApprovalFilter, type DecideContext, type DueFilter, type TaskRow,
} from './task-rules';

export const DUE_FILTER_LABELS: Record<DueFilter, string> = { tout: 'All', retard: 'Late', semaine: 'Due this week', sans_echeance: 'No due date' };

export interface MyApprovalsProps extends DecideContext {
  items: readonly TaskRow[];
  today: string;
  /** Initial filter (or the one of the URL). */
  filter?: ApprovalFilter;
  unavailable?: readonly string[];
  /** Approve or refuse: the tool calls the owner (its own Server Function, or the owner's API in phase 2). */
  onDecide?: (row: TaskRow, decision: 'approuver' | 'refuser') => void;
}

export function MyApprovals({ items, today, filter, unavailable, onDecide, ...ctx }: MyApprovalsProps) {
  const { t } = useI18n();
  const [f, setF] = useState<ApprovalFilter>({ due: 'tout', ...filter });
  const all = useMemo(() => items.filter((r) => r.nature === 'approbation'), [items]);
  const rows = useMemo(() => filterApprovals(all, f, today), [all, f, today]);
  const tools = toolsOf(all);
  const types = typesOf(f.outil ? all.filter((r) => r.outil === f.outil) : all);
  const open = rows.filter(isOpen).length;
  return (
    <div className="coque-approvals">
      <FilterBar>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Tool')}</FilterLabel>
          <FilterChips
            label={t('Tool')}
            options={[{ value: '', label: t('All tools') }, ...tools.map((o) => ({ value: o, label: toolName(o) }))]}
            value={f.outil ?? ''}
            onChange={(v) => setF({ ...f, outil: v || null, type: null })}
          />
        </FilterGroup>
        <FilterGroup>
          <FilterLabel>{t('Type')}</FilterLabel>
          <select className="input coque-appr-type" aria-label={t('Type')} value={f.type ?? ''} onChange={(e) => setF({ ...f, type: e.target.value || null })}>
            <option value="">{t('All types')}</option>
            {types.map((ty) => <option key={ty.value} value={ty.value}>{ty.label}</option>)}
          </select>
        </FilterGroup>
        <FilterGroup>
          <FilterLabel>{t('Due')}</FilterLabel>
          <FilterChips
            label={t('Due')}
            options={(Object.keys(DUE_FILTER_LABELS) as DueFilter[]).map((d) => ({ value: d, label: t(DUE_FILTER_LABELS[d]) }))}
            value={f.due ?? 'tout'}
            onChange={(v) => setF({ ...f, due: v })}
          />
        </FilterGroup>
        <FilterNote>{open} {t('to decide')}</FilterNote>
      </FilterBar>
      <SourcesBanner unavailable={unavailable} />
      {!rows.length ? (
        <EmptyState variant="boxed">{t('No approval')}</EmptyState>
      ) : (
        <ul className="coque-appr-list">
          {rows.map((r) => {
            const here = onDecide ? decisionsHere(r, ctx) : [];
            return (
              <li key={`${r.outil}:${r.tache_id}`} className="coque-appr-row">
                <TaskSource outil={r.outil} />
                <span className="coque-appr-main">
                  <span className="coque-task-title">{shownTitle(r, ctx.tool)}</span>
                  <span className="coque-task-sub">
                    {r.type_libelle}{r.objet_ref ? ` · ${r.objet_ref}` : ''}{r.pour_le_compte_de ? ` · ${t('as a stand-in')}` : ''}
                  </span>
                </span>
                <DueText row={r} today={today} />
                {r.resultat ? <span className="coque-appr-result">{t(r.resultat === 'approuvee' ? 'Approved' : 'Refused')}</span> : <StateTag etat={r.etat} />}
                <span className="coque-task-actions">
                  {here.includes('refuser') && (
                    <button type="button" className="btn btn-secondary" onClick={() => onDecide!(r, 'refuser')}>
                      <X size={13} aria-hidden /> {t('Refuse')}
                    </button>
                  )}
                  {here.includes('approuver') && (
                    <button type="button" className="btn btn-primary" onClick={() => onDecide!(r, 'approuver')}>
                      <Check size={13} aria-hidden /> {t('Approve')}
                    </button>
                  )}
                  <OpenInTool row={r} tool={ctx.tool} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
