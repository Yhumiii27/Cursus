'use client';
// Modal dialog (docs/spec/02 C-21; z-index scale DS-LAYOUT): DS backdrop + dialog, header with title,
// sub-line and close button. Esc closes, Tab is trapped, focus is restored on close (Q-9).
import { X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/client';
import { IconButton } from './Button';
import { cx } from './cx';
import { useIsClient, useOverlay } from './overlay';
import s from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  /** Close request (× button, Esc, optional backdrop click). */
  onClose?: () => void;
  /** URL to navigate to on close (dialogs opened through a search param). */
  closeHref?: string;
  /** `.dialog-title` text (translated). */
  title?: ReactNode;
  /** Sub-line under the title (neutral-400). */
  subtitle?: ReactNode;
  /** Sub-line font size: 12.5 (wizard, force, request — default) or 12 (generic add-form). */
  subtitleSize?: 12 | 12.5;
  /** Replaces the whole default header (title block + close button). */
  header?: ReactNode;
  /** Accessible label of the × button (translated); defaults to t('Close'). */
  closeLabel?: string;
  hideClose?: boolean;
  /** Max width in px: 440 (DS), 560 (force), 640 (add-form, default), 720 (wizard, resource request). */
  width?: number;
  /** `top` (default): `align-items:start; padding-top:{offsetTop}` · `center`: DS centring (force dialog). */
  placement?: 'top' | 'center';
  /** Top offset when `placement="top"`: '8vh' (add-form, default) or '6vh' (wizard, request). */
  offsetTop?: string;
  /** `max-height` + `overflow:auto` ('84vh' add-form, '88vh' wizard). `null` = no limit (force dialog). */
  maxHeight?: string | null;
  /** 50 (default) · 55 (force stage change). */
  zIndex?: number;
  /** The prototype has no backdrop click; opt in here. */
  closeOnBackdrop?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Controlled modal. Body and `<DialogActions>` go in `children`. Rendered in a portal on `document.body`. */
export function Dialog({
  open,
  onClose,
  closeHref,
  title,
  subtitle,
  subtitleSize = 12.5,
  header,
  closeLabel,
  hideClose,
  width = 640,
  placement = 'top',
  offsetTop = '8vh',
  maxHeight = '84vh',
  zIndex = 50,
  closeOnBackdrop,
  className,
  children,
}: DialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const isClient = useIsClient();

  const close = () => {
    onClose?.();
    if (closeHref) router.push(closeHref, { scroll: false });
  };
  useOverlay({ active: open && isClient, onEscape: close, trapRef: panelRef });

  if (!open || !isClient) return null;

  const vars = {
    '--dialog-z': zIndex,
    '--dialog-top': offsetTop,
    '--dialog-w': `${width}px`,
    '--dialog-max-h': maxHeight ?? undefined,
  } as CSSProperties;

  return createPortal(
    <div
      className={cx('dialog-backdrop', s.backdrop, placement === 'top' && s.top)}
      style={vars}
      onClick={closeOnBackdrop ? (e) => e.target === e.currentTarget && close() : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx('dialog', s.dialog, maxHeight && s.scroll, className)}
      >
        {header ?? (
          <div className={s.header}>
            <div className={s.titleBlock}>
              {title && (
                <div id={titleId} className="dialog-title">
                  {title}
                </div>
              )}
              {subtitle && <span className={cx(s.sub, subtitleSize === 12 && s.sub12)}>{subtitle}</span>}
            </div>
            {!hideClose && <IconButton icon={X} variant="secondary" label={closeLabel ?? t('Close')} onClick={close} />}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
