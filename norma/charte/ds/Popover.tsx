'use client';
// Anchored popover / menu (docs/spec/02 C-20). Closes on outside click, on Esc (topmost overlay only)
// and, by default, when a button or link inside it is activated.
import { useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { useOverlay } from './overlay';
import s from './Popover.module.css';

export interface PopoverProps {
  /** Content of the trigger `<button>` (translated label, icons, badge…). */
  trigger: ReactNode;
  /** Classes of the trigger button, e.g. `'btn btn-secondary'` or `statusTagButtonClass(tone)`. Unstyled when omitted. */
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  /** Accessible name / tooltip of the trigger (translated). */
  triggerLabel?: string;
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where the panel sits: below (default) or above the trigger (role menu), aligned start/end, or stretched. */
  side?: 'below' | 'above';
  align?: 'start' | 'end' | 'stretch';
  /** Gap between trigger and panel in px (4 default; −4 for in-table status menus; 6 notifications/role). */
  offset?: number;
  /** Horizontal inset from the aligned edge in px (6 for in-table status menus). */
  inset?: number;
  /** 20 in-table menus (default) · 30 project picker · 40 role menu · 49 search/notifications. */
  zIndex?: number;
  /** Panel width (CSS value), e.g. 'min(440px,90vw)'. */
  width?: string;
  /** Panel min-width (CSS value), e.g. '240px'. */
  minWidth?: string;
  maxHeight?: string;
  /** Panel padding in px: 6 (default), 8 (notifications), 10 (deliverables). */
  padding?: number;
  /** Panel gap in px (default 0). */
  gap?: number;
  /** Transparent full-screen click-catcher under the panel (z − 1), as for global search and notifications. */
  catcher?: boolean;
  /** Close when a button/link inside the panel is clicked. Default true. */
  closeOnSelect?: boolean;
  /** Anchor is `display:block` (full-width triggers such as the viewer switch). */
  block?: boolean;
  anchorClassName?: string;
  className?: string;
  children: ReactNode;
}

/** `.elev-md` panel: absolute, flex column, padding 6px, radius 8, surface background. */
export function Popover({
  trigger,
  triggerClassName,
  triggerStyle,
  triggerLabel,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = 'below',
  align = 'start',
  offset,
  inset,
  zIndex = 20,
  width,
  minWidth,
  maxHeight,
  padding,
  gap,
  catcher,
  closeOnSelect = true,
  block,
  anchorClassName,
  className,
  children,
}: PopoverProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setInner(v);
    onOpenChange?.(v);
  };
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useOverlay({ active: open, onEscape: () => setOpen(false), outsideRef: anchorRef, onOutside: () => setOpen(false) });

  const onPanelClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!closeOnSelect) return;
    const el = (e.target as HTMLElement).closest('button, a');
    if (el && e.currentTarget.contains(el)) setOpen(false);
  };

  const vars = {
    '--pop-z': zIndex,
    '--pop-offset': offset != null ? `${offset}px` : undefined,
    '--pop-inset': inset != null ? `${inset}px` : undefined,
    '--pop-w': width,
    '--pop-min-w': minWidth,
    '--pop-max-h': maxHeight,
    '--pop-pad': padding != null ? `${padding}px` : undefined,
    '--pop-gap': gap != null ? `${gap}px` : undefined,
  } as CSSProperties;

  return (
    <div ref={anchorRef} className={cx(s.anchor, block && s.block, anchorClassName)}>
      <button
        type="button"
        className={triggerClassName ?? s.bare}
        style={triggerStyle}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <>
          {catcher && <span className={s.catcher} style={vars} onClick={() => setOpen(false)} aria-hidden />}
          <div
            id={panelId}
            className={cx('elev-md', s.panel, side === 'below' ? s.below : s.above, align === 'start' ? s.start : align === 'end' ? s.end : s.stretch, className)}
            style={vars}
            onClick={onPanelClick}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
