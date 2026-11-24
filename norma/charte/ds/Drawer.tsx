'use client';
// Drawer — right side panel over a scrim (docs/spec/02 C-19). Scrim click, × and Esc close it; focus is
// trapped while open and restored on close.
import { X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/client';
import { IconButton } from './Button';
import { CardTitle } from './Card';
import { cx } from './cx';
import { useIsClient, useOverlay } from './overlay';
import s from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  /** URL to navigate to on close (drawers opened through a search param such as `?act=A1250`). */
  closeHref?: string;
  /** 640 (default) or 680 (document drawer). */
  width?: 640 | 680;
  /** Object id shown first in the header (12px neutral-400 tabular), e.g. "A1250", "PO-2026-0412"; names the dialog when there is no title. */
  id?: ReactNode;
  /** `.card-title` (translated). */
  title?: ReactNode;
  /**
   * `inline` (activity drawer): id · title (margin-right:auto) · meta · × · actions on one wrapping row.
   * `below` (ECO, PO, NCR…): id (margin-right:auto) · meta · × on the header row, title on its own line. Default `below`.
   */
  titlePlacement?: 'inline' | 'below';
  /** Tags/status shown in the header row before the close button. */
  meta?: ReactNode;
  /** Header actions after the close button (e.g. "Show in Gantt"). */
  actions?: ReactNode;
  /** Accessible label of the × button (translated); defaults to t('Close'). */
  closeLabel?: string;
  className?: string;
  children?: ReactNode;
}

/** `card elev-lg` fixed panel (z 61, width min(640px,100vw), padding 18px 22px, gap 12px) over a 60% bg scrim (z 60). */
export function Drawer({ open, onClose, closeHref, width = 640, id, title, titlePlacement = 'below', meta, actions, closeLabel, className, children }: DrawerProps) {
  const { t } = useI18n();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const headId = useId();
  const isClient = useIsClient();

  const close = () => {
    onClose?.();
    if (closeHref) router.push(closeHref, { scroll: false });
  };
  useOverlay({ active: open && isClient, onEscape: close, trapRef: panelRef });

  if (!open || !isClient) return null;

  const inline = titlePlacement === 'inline';
  const titleEl = title ? (
    <CardTitle push={inline} pretty={!inline}>
      <span id={titleId}>{title}</span>
    </CardTitle>
  ) : null;

  return createPortal(
    <>
      <div className={s.scrim} onClick={close} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : id != null ? headId : undefined}
        tabIndex={-1}
        className={cx('card', 'elev-lg', s.panel, className)}
        style={{ '--drawer-w': `${width}px` } as CSSProperties}
      >
        <div className={s.header}>
          {id != null ? (
            <span id={headId} className={cx(s.id, (!inline || !title) && s.push)}>
              {id}
            </span>
          ) : (
            !inline && <span className={s.push} />
          )}
          {inline && titleEl}
          {meta}
          <IconButton icon={X} muted label={closeLabel ?? t('Close')} onClick={close} />
          {actions}
        </div>
        {!inline && titleEl}
        {children}
      </div>
    </>,
    document.body,
  );
}
