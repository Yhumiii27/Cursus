// Nocturne tag (docs/spec/02 DS-CLASSES › Tags). Server-compatible.
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import s from './Tag.module.css';

export type TagTone = 'accent' | 'accent-2' | 'neutral' | 'outline';
/** `md` DS 11px · `sm` 10.5px · `xs` 10px + padding 1px 7px · `micro` 10px (DS padding). */
export type TagSize = 'md' | 'sm' | 'xs' | 'micro';

export interface TagProps {
  /** `accent` = filled accent-800/accent-100 (alert) · `outline` = accent outline (watch) · `neutral` = neutral-800/neutral-100 (calm). */
  tone?: TagTone;
  size?: TagSize;
  /** Leading Phosphor icon (e.g. `Eye` for "Read-only"). */
  icon?: Icon;
  /** `white-space:nowrap` — default true (the prototype's usual inline style on tags). */
  nowrap?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** `<span class="tag tag-…">`. Labels are passed in already translated. */
export function Tag({ tone = 'neutral', size = 'md', icon: I, nowrap = true, title, className, style, children }: TagProps) {
  return (
    <span
      title={title}
      style={style}
      className={cx('tag', `tag-${tone}`, size !== 'md' && s[size], nowrap && s.nowrap, I && s.withIcon, className)}
    >
      {I && <I aria-hidden />}
      {children}
    </span>
  );
}
