// Menu parts for <Popover> (docs/spec/02 C-20). Server-compatible: `MenuItem` renders a Link with
// `href`, or a button with `onClick` (from a Client Component).
import Link from 'next/link';
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import s from './Popover.module.css';

/** Uppercase menu header: 10px · .08em · neutral-500 · padding 4px 8px 6px ("Move to", "View as", "Switch project"). */
export function MenuHeader({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx(s.header, className)} style={style}>
      {children}
    </div>
  );
}

export interface MenuItemProps {
  icon?: Icon;
  /** Icon colour: `accent` (e.g. "Move to" arrows) or inherit. */
  iconTone?: 'accent' | 'inherit';
  /** Right-aligned meta (11px neutral-400), e.g. the stage gate text. */
  meta?: ReactNode;
  /** Selected row: background accent-900 (hover still turns it neutral-900, as in the prototype). */
  selected?: boolean;
  /** 13px (default) or 12.5px (role menu, picker rows). */
  size?: 13 | 12.5;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Menu row: flex, gap 8px, padding 6px 8px, radius 6px; hover neutral-900. */
export function MenuItem({ icon: I, iconTone = 'inherit', meta, selected, size = 13, href, onClick, disabled, title, className, style, children }: MenuItemProps) {
  const cls = cx(s.item, size === 12.5 && s.sm, selected && s.selected, className);
  const inner = (
    <>
      {I && <I className={cx(s.itemIcon, iconTone === 'accent' && s.accentIcon)} aria-hidden />}
      {children}
      {meta != null && <span className={s.meta}>{meta}</span>}
    </>
  );
  return href ? (
    <Link href={href} className={cls} style={style} title={title} aria-current={selected ? 'true' : undefined}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} style={style} title={title} disabled={disabled} onClick={onClick} aria-pressed={selected || undefined}>
      {inner}
    </button>
  );
}

/** Empty line inside a menu (12px neutral-500, padding 6px 8px), e.g. "No page matches". */
export function MenuEmpty({ children }: { children: ReactNode }) {
  return <span className={s.empty}>{children}</span>;
}
