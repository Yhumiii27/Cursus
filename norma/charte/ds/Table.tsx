// Table helpers over the Nocturne `.table` (docs/spec/02 C-11). Server-compatible; `Tr` accepts
// `onClick` from Client Components (use `ClickableRow` from components/app for link rows).
import type { CSSProperties, HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';
import s from './Table.module.css';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Font size: 13 (registers), 12.5 (secondary tables), `ds` = DS 14px. Default 13. */
  size?: 13 | 12.5 | 'ds';
  /**
   * Tablet layout (R-146): the table scrolls horizontally inside its own box when it is wider than the screen. Default
   * true; false for a table already inside a scrolling box (its sticky header needs that box as scroll container).
   */
  scroll?: boolean;
}

/** `<table class="table">` — themed header, fading row rules, row hover tint. */
export function Table({ size = 13, scroll = true, className, children, ...rest }: TableProps) {
  const table = (
    <table className={cx('table', size === 13 ? s.t13 : size === 12.5 ? s.t125 : undefined, className)} {...rest}>
      {children}
    </table>
  );
  return scroll ? <TableScroll>{table}</TableScroll> : table;
}

/**
 * Horizontal scroll box of a table on tablets (R-146): no box of its own above 1024 px (`display: contents`, the
 * prototype's layout), a horizontally scrolling block up to 1024 px. For tables written as a plain `<table>`.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className={s.scrollX}>{children}</div>;
}

type Align = 'left' | 'right' | 'center';

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  /** Column width hint, e.g. "24%" (bar columns). */
  width?: string;
  nowrap?: boolean;
}

/** Header cell (DS: 11px, .08em, uppercase, text 60%). Numeric columns use `align="right"`. */
export function Th({ align, width, nowrap, className, style, children, ...rest }: ThProps) {
  return (
    <th
      className={cx(align === 'right' && s.right, align === 'center' && s.center, nowrap && s.nowrap, className)}
      style={width ? { width, ...style } : style}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  /** tabular-nums (numeric cells; combine with `align="right"` and `nowrap`). */
  numeric?: boolean;
  nowrap?: boolean;
  /** `secondary` = 12px neutral-300 · `muted` = 12px neutral-400. */
  tone?: 'secondary' | 'muted';
  /** Data-driven text colour (e.g. `LO` / `OK` from components/app tones). */
  color?: string;
  /** max-width for long text cells (180–300px in the prototype); combine with `Ellipsis`. */
  maxWidth?: number;
  valign?: 'top';
}

export function Td({ align, numeric, nowrap, tone, color, maxWidth, valign, className, style, children, ...rest }: TdProps) {
  const st = color || maxWidth ? { color, maxWidth, ...style } : style;
  return (
    <td
      className={cx(
        align === 'right' && s.right,
        align === 'center' && s.center,
        numeric && s.num,
        nowrap && s.nowrap,
        tone && s[tone],
        valign === 'top' && s.top,
        className,
      )}
      style={st}
      {...rest}
    >
      {children}
    </td>
  );
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Selected row: background accent-900. */
  selected?: boolean;
  /** cursor:pointer (set automatically when onClick is given). */
  clickable?: boolean;
}

export function Tr({ selected, clickable, className, children, ...rest }: TrProps) {
  return (
    <tr className={cx((clickable || rest.onClick) && s.clickable, selected && s.selected, className)} aria-selected={selected || undefined} {...rest}>
      {children}
    </tr>
  );
}

/** Primary cell content: title (500) over an 11.5px neutral-400 sub-line, line-height 1.3. */
export function CellStack({ title, sub, children, className, style }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx(s.stack, className)} style={style}>
      <span className={s.stackTitle}>{title}</span>
      {sub != null && sub !== '' && <span className={s.stackSub}>{sub}</span>}
      {children}
    </div>
  );
}

/** ID text (A1250, PO-…): 12px · 500 · tabular · neutral-300, accent-300 when the row is selected. */
export function IdText({ selected, children }: { selected?: boolean; children: ReactNode }) {
  return <span className={cx(s.id, selected && s.idOn)}>{children}</span>;
}

/** Single-line ellipsis (`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`); parent needs a width/max-width. */
export function Ellipsis({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={cx(s.ellipsis, className)} title={title}>
      {children}
    </span>
  );
}
