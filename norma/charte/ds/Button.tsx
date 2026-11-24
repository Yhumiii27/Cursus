// Nocturne buttons (docs/spec/02 DS-CLASSES › Buttons). Server-compatible: no hooks; pass `onClick`
// only from Client Components, or use `ButtonLink` for navigation.
import Link from 'next/link';
import type { Icon, IconWeight } from '@phosphor-icons/react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/**
 * Prototype font/padding overrides of `.btn`:
 * - `md` DS default (14px) — header primary, dialog actions
 * - `sm` 12.5px — the most common in-page size
 * - `xs` 12px
 * - `row` 12px · padding 3px 10px · nowrap — table/list row actions ("Approve")
 * - `compact` 12px · padding 3px 8px (ghost)
 * - `mini` 11.5px · padding 2px 8px (ghost)
 * - `inline` 12px · padding 2px 4px · margin-left −4px · align-self flex-start — "Action →" under a text block
 */
export type ButtonSize = 'md' | 'sm' | 'xs' | 'row' | 'compact' | 'mini' | 'inline';

interface ButtonLookProps {
  /** `primary` = accent outline (never filled), `secondary` = divider outline, `ghost` = accent text. Default `secondary`. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading Phosphor icon (size follows the font size, as the prototype's `<i class="ph">`). */
  icon?: Icon;
  /** Trailing icon, e.g. `ArrowRight` for navigation actions, `ArrowSquareOut` for cross-screen opens. */
  iconRight?: Icon;
  iconWeight?: IconWeight;
  /** `.btn-block` (full width). */
  block?: boolean;
  /** `margin-left:auto` — pushes the button to the right of a flex row (card-header actions). */
  push?: boolean;
  nowrap?: boolean;
  children?: ReactNode;
}

function btnClass(p: ButtonLookProps, className?: string) {
  const size = p.size && p.size !== 'md' ? s[p.size] : undefined;
  return cx('btn', `btn-${p.variant ?? 'secondary'}`, p.block && 'btn-block', size, p.push && s.push, p.nowrap && s.nowrap, className);
}

function Content({ icon: I, iconRight: R, iconWeight, children }: ButtonLookProps) {
  return (
    <>
      {I && <I weight={iconWeight} aria-hidden />}
      {children}
      {R && <R weight={iconWeight} aria-hidden />}
    </>
  );
}

export type ButtonProps = ButtonLookProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** `<button class="btn btn-…">` with optional leading/trailing icon. `type` defaults to `button`. */
export function Button({ variant, size, icon, iconRight, iconWeight, block, push, nowrap, className, children, type = 'button', ...rest }: ButtonProps) {
  const look = { variant, size, icon, iconRight, iconWeight, block, push, nowrap };
  return (
    <button type={type} className={btnClass(look, className)} {...rest}>
      <Content {...look}>{children}</Content>
    </button>
  );
}

export type ButtonLinkProps = ButtonLookProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> & {
  href: string;
  /** Next.js `<Link prefetch>`. */
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

/** A Next.js `<Link>` styled as a button (navigation actions such as "Open schedule →"). */
export function ButtonLink({ variant, size, icon, iconRight, iconWeight, block, push, nowrap, className, children, href, ...rest }: ButtonLinkProps) {
  const look = { variant, size, icon, iconRight, iconWeight, block, push, nowrap };
  return (
    <Link href={href} className={btnClass(look, cx(s.link, className))} {...rest}>
      <Content {...look}>{children}</Content>
    </Link>
  );
}

/**
 * Icon-only button (`.btn.btn-icon`). Sizes: 36 (DS), 32, 28 (calendar prev/next), 26, 24 (compact WBS row
 * actions, 13px glyph). `muted` = neutral-400 glyph (drawer/toast/dialog close ×).
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: Icon;
  /** Accessible name (also the tooltip `title` unless `title` is given). Pass it translated. */
  label: string;
  variant?: 'ghost' | 'secondary';
  size?: 36 | 32 | 28 | 26 | 24;
  muted?: boolean;
  iconWeight?: IconWeight;
  /** Extra content positioned inside the button (e.g. the bell's unread `CountBadge variant="bell"`). */
  children?: ReactNode;
}

export function IconButton({ icon: I, label, variant = 'ghost', size = 36, muted, iconWeight, className, title, type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx('btn', 'btn-icon', `btn-${variant}`, size !== 36 && s[`s${size}`], muted && s.muted, children != null && s.rel, className)}
      {...rest}
    >
      <I weight={iconWeight} aria-hidden />
      {children}
    </button>
  );
}
