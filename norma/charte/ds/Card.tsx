// Nocturne card surface (docs/spec/02 DS-CLASSES › Cards). Server-compatible.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import s from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Elevation utility: `sm` (all cards/tiles, 1px neutral-800 ring), `md` (popovers), `lg` (drawers, toast, modals). Default `sm`; `false` = none. */
  elev?: 'sm' | 'md' | 'lg' | false;
  children?: ReactNode;
}

/** `<div class="card elev-…">` — surface, radius 8, DS gap/padding (override via className). */
export function Card({ elev = 'sm', className, children, ...rest }: CardProps) {
  return (
    <div className={cx('card', elev && `elev-${elev}`, className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardTitleProps {
  /** `compact` = 15px (Task screen cards); default DS 17px. */
  compact?: boolean;
  /** `margin-right:auto` (title followed by hints/actions in a header row). */
  push?: boolean;
  /** `text-wrap:pretty` (drawer titles). */
  pretty?: boolean;
  as?: 'div' | 'span';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** `.card-title` — heading font, 500, 17px, line-height 1.2. */
export function CardTitle({ compact, push, pretty, as: As = 'div', className, style, children }: CardTitleProps) {
  return (
    <As className={cx('card-title', compact && s.compact, push && s.push, pretty && s.pretty, className)} style={style}>
      {children}
    </As>
  );
}
