'use client';
// Centered modal (docs/spec/02 C-22): sits above drawers (z 70/71). Scrim click, × and Esc close it.
import { X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/client';
import { IconButton } from './Button';
import { cx } from './cx';
import { useIsClient, useOverlay } from './overlay';
import s from './CenteredModal.module.css';

export interface CenteredModalProps {
  open: boolean;
  onClose?: () => void;
  closeHref?: string;
  /** `.card-title` (translated). */
  title?: ReactNode;
  /** 12px neutral-400 line under the title. */
  subtitle?: ReactNode;
  /** Element before the title block (e.g. the 34px "Cx" tile of the Codex deposit). */
  leading?: ReactNode;
  /** 640 (default) or 720 (engineering import). */
  width?: 640 | 720;
  closeLabel?: string;
  className?: string;
  children?: ReactNode;
}

export function CenteredModal({ open, onClose, closeHref, title, subtitle, leading, width = 640, closeLabel, className, children }: CenteredModalProps) {
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

  return createPortal(
    <>
      <div className={s.scrim} onClick={close} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx('card', 'elev-lg', s.panel, className)}
        style={{ '--modal-w': `${width}px` } as CSSProperties}
      >
        <div className={s.header}>
          {leading}
          <div className={s.titleBlock}>
            {title && (
              <div id={titleId} className="card-title">
                {title}
              </div>
            )}
            {subtitle && <span className={s.sub}>{subtitle}</span>}
          </div>
          <IconButton icon={X} muted label={closeLabel ?? t('Close')} onClick={close} />
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
