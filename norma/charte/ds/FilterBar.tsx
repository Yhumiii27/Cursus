// Barre d'outils de la page : onglets / vues (Segmented), filtres, période, note (Norma 2.0, charte/COQUE.md § 5), reprise de
// Keystone (src/components/app/Filter.tsx). Server-compatible : une puce avec `href` est un lien (filtre dans l'URL), sinon
// passer `onChange` depuis un Client Component. Classes de charte/coque.css.
import Link from 'next/link';
import { Funnel } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cx } from './cx';

/** Row right under the page header: tabs first, then filters, then a right-pushed note. */
export function FilterBar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('coque-toolbar', className)} data-print-hide>{children}</div>;
}

/** Label + controls cluster inside the bar. */
export function FilterGroup({ children }: { children: ReactNode }) {
  return <div className="coque-filter-group">{children}</div>;
}

/** 15 px accent icon + 12 px neutral-400 text (`Eye` view, `Funnel` filters, `Tag` type…). */
export function FilterLabel({ icon: I = Funnel, children }: { icon?: Icon; children: ReactNode }) {
  return (
    <span className="coque-filter-label">
      <I className="coque-filter-label-icon" aria-hidden />
      {children}
    </span>
  );
}

/** Right-pushed hint (counts, « 12 sur 40 »). */
export function FilterNote({ children }: { children: ReactNode }) {
  return <span className="coque-filter-note">{children}</span>;
}

export interface FilterChipOption<V extends string = string> {
  value: V;
  label: ReactNode;
  count?: ReactNode;
  href?: string;
}

/** Single-select chips; the first option is usually « Tous » (`'all'`). */
export function FilterChips<V extends string = string>({ options, value, onChange, label }: { options: FilterChipOption<V>[]; value: V | null | undefined; onChange?: (v: V) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="coque-chips">
      {options.map((o) => {
        const on = o.value === value;
        const inner = (
          <>
            {o.label}
            {o.count != null && o.count !== '' && <span className="coque-chip-count">{o.count}</span>}
          </>
        );
        return o.href ? (
          <Link key={o.value} href={o.href} className="coque-chip" aria-current={on ? 'true' : undefined} scroll={false}>
            {inner}
          </Link>
        ) : (
          <button key={o.value} type="button" className="coque-chip" aria-pressed={on} onClick={onChange ? () => onChange(o.value) : undefined}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
