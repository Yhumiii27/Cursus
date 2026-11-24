// Server-compatible parts of the dialog layout (docs/spec/02 C-21).
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import s from './Dialog.module.css';

export interface DialogActionsProps {
  /**
   * `form` (generic add-form): gap 8px, DS margin-top 5.6px · `flush` (wizard, force, resource request):
   * DS gap 5.6px, margin-top 0. Default `form`.
   */
  variant?: 'form' | 'flush';
  wrap?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** `.dialog-actions` — right-aligned footer (secondary "Cancel" then primary action). */
export function DialogActions({ variant = 'form', wrap, className, style, children }: DialogActionsProps) {
  return (
    <div className={cx('dialog-actions', variant === 'form' ? s.gap8 : s.flush, wrap && s.wrap, className)} style={style}>
      {children}
    </div>
  );
}
