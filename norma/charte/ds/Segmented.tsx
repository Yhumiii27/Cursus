// Segmented control (docs/spec/02 C-08, prototype seg() logic 3889). Server-compatible:
// options with `href` render links (URL view state, e.g. ?view=); otherwise pass `onChange` from a
// Client Component.
import Link from 'next/link';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import s from './Segmented.module.css';

export interface SegmentedOption<V extends string = string> {
  value: V;
  /** Translated label. */
  label: ReactNode;
  icon?: Icon;
  /** Count shown after the label (11px tabular neutral-400), e.g. zone counts. */
  count?: ReactNode;
  /** Link target — makes the option a `<Link>` (selection driven by the URL). */
  href?: string;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string = string> {
  options: SegmentedOption<V>[];
  /** Selected value (`null` = none selected). */
  value: V | null | undefined;
  onChange?: (value: V) => void;
  /** `flex-wrap:wrap` (most in-page switches). */
  wrap?: boolean;
  /** Options stretch (`flex:1; justify-content:center`) — dialogs/wizard fields, project-picker scope. */
  fullWidth?: boolean;
  /** Accessible group name (translated). */
  label?: string;
  className?: string;
}

/**
 * Selected option: `color:accent; box-shadow:inset 0 0 0 1px accent`; idle: `neutral-300`; 1px divider
 * between options; 12px text, `padding:4px 10px`. Buttons expose `aria-pressed`, links `aria-current`.
 */
export function Segmented<V extends string = string>({ options, value, onChange, wrap, fullWidth, label, className }: SegmentedProps<V>) {
  return (
    <div role="group" aria-label={label} className={cx(s.seg, wrap && s.wrap, className)}>
      {options.map((o) => {
        const on = o.value === value;
        const cls = cx(s.opt, on && s.on, fullWidth && s.full);
        const inner = (
          <>
            {o.icon && <o.icon aria-hidden />}
            {o.label}
            {o.count != null && <span className={s.count}>{o.count}</span>}
          </>
        );
        return o.href ? (
          <Link key={o.value} href={o.href} className={cls} title={o.title} aria-current={on ? 'true' : undefined} scroll={false}>
            {inner}
          </Link>
        ) : (
          <button
            key={o.value}
            type="button"
            className={cls}
            title={o.title}
            aria-label={o.label === '' ? o.title : undefined}
            disabled={o.disabled}
            aria-pressed={on}
            onClick={onChange ? () => onChange(o.value) : undefined}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
